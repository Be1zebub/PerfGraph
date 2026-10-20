/**
 * Collector orchestrator.
 *
 * Coordinates the full collection lifecycle for a single run:
 * 1. Validate URL
 * 2. Launch browser + create CDP session
 * 3. Run each active collector in the correct order
 * 4. Write results to the output directory
 * 5. Clean up browser
 * 6. Run Lighthouse audit (separate browser, after CDP session closes)
 *
 * Designed for multi-run support: `run()` wraps `runOnce()`.
 */

import ow from 'ow';
import type { Page } from 'playwright';
import type { CollectorRunOptions, RunContext, RunResult } from '../shared/types.js';
import { DEFAULT_RUN_OPTIONS } from '../shared/types.js';
import { launchBrowserServer, closeBrowser } from './session.js';
import { TraceCollector } from './trace.js';
import { NetworkCollector } from './network.js';
import { PerformanceCollector } from './performance.js';
import { RuntimeCollector } from './runtime.js';
import { CoverageCollector } from './coverage.js';
import { ConsoleCollector } from './console.js';
import { DOMCollector } from './dom.js';
import { LighthouseCollector } from './lighthouse.js';
import { captureLcpEntry, type LcpEntry } from './lcp.js';
import { createOutputDir, writeJsonFile, writeWarnings } from '../output/writer.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RawDataBundle, Collector } from './types.js';

// ---------------------------------------------------------------------------
// Collector definitions: name, class factory, bundle key, filename
// ---------------------------------------------------------------------------

interface CollectorDef {
  /** Human-readable label for console logging */
  label: string;
  /** Factory: creates a collector instance (may need the Page ref) */
  create: (helpers: { page: import('playwright').Page }) => Collector;
  /** Key used in the RawDataBundle */
  bundleKey: keyof RawDataBundle;
  /** Output filename */
  filename: string;
  /** The --no-* option flag that disables this collector, or undefined if always-on */
  disableFlag: keyof Pick<CollectorRunOptions, 'noRuntime' | 'noCoverage' | 'noConsole' | 'noDom' | 'noNetwork' | 'noPerformance'> | undefined;
}

/** Collectors that participate in the CDP session lifecycle */
const CDP_COLLECTORS: CollectorDef[] = [
  {
    label: 'network',
    create: () => new NetworkCollector(),
    bundleKey: 'network',
    filename: 'network.json',
    disableFlag: 'noNetwork',
  },
  {
    label: 'performance',
    create: () => new PerformanceCollector(),
    bundleKey: 'performance',
    filename: 'performance.json',
    disableFlag: 'noPerformance',
  },
  {
    label: 'trace',
    create: () => new TraceCollector(),
    bundleKey: 'trace',
    filename: 'trace.json',
    disableFlag: undefined, // always enabled
  },
  {
    label: 'runtime',
    create: () => new RuntimeCollector(),
    bundleKey: 'runtime',
    filename: 'runtime.json',
    disableFlag: 'noRuntime',
  },
  {
    label: 'coverage',
    create: () => new CoverageCollector(),
    bundleKey: 'coverage',
    filename: 'coverage.json',
    disableFlag: 'noCoverage',
  },
  {
    label: 'console',
    create: () => new ConsoleCollector(),
    bundleKey: 'consoleEntries',
    filename: 'console.json',
    disableFlag: 'noConsole',
  },
  {
    label: 'dom',
    create: ({ page }) => new DOMCollector(page),
    bundleKey: 'dom',
    filename: 'dom.json',
    disableFlag: 'noDom',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a collector is enabled according to run options.
 * Unless the --no-* flag is explicitly set, the collector is active.
 */
function isEnabled(def: CollectorDef, options: CollectorRunOptions): boolean {
  return def.disableFlag === undefined || !options[def.disableFlag];
}

/**
 * Filter enabled collectors from the definition list.
 */
function enabledCollectors(defs: CollectorDef[], options: CollectorRunOptions): CollectorDef[] {
  return defs.filter((d) => isEnabled(d, options));
}

// ---------------------------------------------------------------------------
// LCP wait
// ---------------------------------------------------------------------------

/**
 * Maximum time to wait for LargestContentfulPaint before stopping trace collection.
 * If LCP doesn't fire within this window, a warning is recorded but collection
 * proceeds with whatever data was captured.
 */
const LCP_TIMEOUT_MS = 5_000;

/**
 * Wait for LargestContentfulPaint to settle and return the final entry.
 *
 * The Performance API keeps every candidate, so the last entry is the real
 * largest contentful paint. The trace alone is not enough: it may only carry
 * the first candidate that appeared after navigation.
 *
 * @param page - Playwright Page to evaluate the observer in
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @returns The final LCP entry, or undefined when the page reported none
 */
async function waitForLCP(page: Page, timeoutMs: number): Promise<LcpEntry | undefined> {
  return captureLcpEntry(page, timeoutMs);
}

// ---------------------------------------------------------------------------
// runOnce
// ---------------------------------------------------------------------------

/**
 * Execute a single collection run against the given URL.
 *
 * @param url - Target URL to collect data from
 * @param options - Collection options
 * @param runIndex - 1-based run index (for multi-run scenarios)
 * @returns RunResult with output path and status
 */
async function runOnce(
  url: string,
  options: CollectorRunOptions,
  runIndex: number,
): Promise<RunResult> {
  ow(url, 'url', ow.string.nonEmpty);
  ow(options, 'options', ow.object);
  ow(runIndex, 'runIndex', ow.number.integer.positive);

  const bundle: RawDataBundle = {};
  const warnings: string[] = [];
  const files: string[] = [];

  // --- Phase 1: Create output directory ---
  const baseDir = options.output;
  const outputDir = await createOutputDir(baseDir, url);

  // --- Phase 2: Launch browser + CDP session ---
  console.error(`[${runIndex}] Launching browser...`);
  const { browser, page, cdp, cdpPort } = await launchBrowserServer(30_000, options.mobile);
  const viewport = page.viewportSize();
  const runContext: RunContext = {
    browser: browser.version(),
    os: `${process.platform} ${process.arch}`,
    device: options.mobile ?? 'desktop',
    viewport: viewport ?? undefined,
    cacheState: 'cold',
    networkThrottling: 'none',
    cpuThrottling: 'none',
    headless: true,
    runIndex,
    requestedRuns: options.runs,
    ownedDomains: options.ownedDomains,
  };
  (bundle as Record<string, unknown>).context = runContext;

  // Persist the environment next to the raw artifacts. The pipeline reloads
  // the bundle from disk, so an in-memory-only context would be lost and the
  // report would claim an unknown run environment.
  files.push(await writeJsonFile(outputDir, 'context.json', runContext));

  try {
    // --- Phase 3: Determine which CDP collectors to run ---
    const activeDefs = enabledCollectors(CDP_COLLECTORS, options);

    if (activeDefs.length === 0) {
      console.error(`[${runIndex}] No CDP collectors enabled — skipping navigation`);
    } else {
      // Start all active collectors (pre-navigation)
      const running: Array<{ def: CollectorDef; collector: Collector }> = [];
      for (const def of activeDefs) {
        console.error(`[${runIndex}] Starting ${def.label} collection...`);
        const collector = def.create({ page });
        await collector.start(cdp, options);
        running.push({ def, collector });
      }

      // --- Phase 4: Navigate to target URL ---
      console.error(`[${runIndex}] Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

      // --- Phase 4b: Wait for LCP before stopping collectors ---
      // This ensures the trace (and other collectors) capture the LargestContentfulPaint
      // event, which may fire after networkidle (e.g. large hero images, late fonts).
      console.error(`[${runIndex}] Waiting for LargestContentfulPaint...`);
      const lcpEntry = await waitForLCP(page, LCP_TIMEOUT_MS);
      if (lcpEntry) {
        (bundle as Record<string, unknown>).lcp = lcpEntry;
        files.push(await writeJsonFile(outputDir, 'lcp.json', lcpEntry));
        console.error(`[${runIndex}] LargestContentfulPaint captured`);
      } else {
        const lcpWarning =
          'LCP event not detected within timeout — trace may lack LargestContentfulPaint event data';
        warnings.push(lcpWarning);
        console.error(`[${runIndex}] ${lcpWarning}`);
      }

      // --- Phase 5: Stop all collectors (post-navigation) and write results ---
      for (const { def, collector } of running) {
        console.error(`[${runIndex}] Stopping ${def.label} collection...`);
        const result = await collector.stop();

        if (result.ok) {
          // Assign collector data to bundle (all data fields are `unknown`)
          (bundle as Record<string, unknown>)[def.bundleKey] = result.data;

          // Extract warnings if the data has a warnings field
          const data = result.data;
          if (
            data &&
            typeof data === 'object' &&
            'warnings' in data &&
            Array.isArray((data as Record<string, unknown>).warnings)
          ) {
            warnings.push(...((data as Record<string, unknown>).warnings as string[]));
          }

          const filePath = await writeJsonFile(outputDir, def.filename, result.data);
          files.push(filePath);
          console.error(`[${runIndex}] ${def.label}: OK — ${filePath}`);
        } else {
          warnings.push(`${def.label} collector failed: ${result.error}`);
          console.error(`[${runIndex}] ${def.label}: FAILED — ${result.error}`);
        }
      }
    }

    // --- Phase 6: Write warnings ---
    (bundle as Record<string, unknown>).warnings = warnings;
    if (warnings.length > 0) {
      const warningsPath = await writeWarnings(outputDir, warnings);
      files.push(warningsPath);
    }

    // --- Phase 7: Run Lighthouse in the SAME browser (Option C) ---
    // Browser stays alive from Phase 2. Lighthouse opens its own tab via CDP port,
    // does a fresh navigation, runs audits, and closes the tab — all in one Chrome.
    // This eliminates metric drift between CDP trace and Lighthouse.
    if (!options.noLighthouse) {
      console.error(`[${runIndex}] Starting Lighthouse audit (same browser, port ${cdpPort})...`);
      const lighthouseCollector = new LighthouseCollector();
      const lhResult = await lighthouseCollector.runCollection(url, cdpPort);

      if (lhResult.ok) {
        (bundle as Record<string, unknown>).lighthouse = lhResult.data;
        const lhPath = await writeJsonFile(outputDir, 'lighthouse.json', lhResult.data);
        files.push(lhPath);

        const lhData: unknown = lhResult.data;
        if (
          lhData &&
          typeof lhData === 'object' &&
          'warnings' in (lhData as Record<string, unknown>) &&
          Array.isArray((lhData as Record<string, unknown>).warnings)
        ) {
          warnings.push(...((lhData as Record<string, unknown>).warnings as string[]));
        }

        console.error(`[${runIndex}] Lighthouse: OK — ${lhPath}`);
      } else {
        warnings.push(`Lighthouse collector failed: ${lhResult.error}`);
        console.error(`[${runIndex}] Lighthouse: FAILED — ${lhResult.error}`);
      }
    }
  } finally {
    // --- Phase 8: Always clean up the browser ---
    await closeBrowser(browser);
  }

  return {
    index: runIndex,
    outputDir,
    warningCount: warnings.length,
    files,
    success: true,
  };
}

/**
 * Run one or more collection runs against the given URL.
 *
 * @param url - Target URL to collect data from
 * @param partialOptions - Partial options (merged with defaults)
 * @returns Array of RunResult — one per run
 */
export async function run(
  url: string,
  partialOptions?: Partial<CollectorRunOptions>,
): Promise<RunResult[]> {
  ow(url, 'url', ow.string.nonEmpty);

  // Validate URL format early (T-01-01 mitigation)
  try {
    new URL(url);
  } catch {
    throw new Error(
      `Invalid URL: "${url}". Provide a valid URL including protocol (e.g. https://example.com).`,
    );
  }

  const options: CollectorRunOptions = { ...DEFAULT_RUN_OPTIONS, ...partialOptions, url };
  const results: RunResult[] = [];

  console.error(`PerfGraph collection starting — ${options.runs} run(s) for ${url}`);
  console.error(`Output directory: ${options.output}`);
  console.error('');

  for (let i = 1; i <= options.runs; i++) {
    const runLabel = options.runs > 1 ? `Run ${i}/${options.runs}` : 'Run';
    console.error(`--- ${runLabel} ---`);

    try {
      const result = await runOnce(url, options, i);
      results.push(result);
      console.error(`[${i}] Completed — ${result.success ? 'OK' : 'FAILED'}`);
      console.error(`[${i}] Output: ${result.outputDir}`);
      if (result.warningCount > 0) {
        console.error(`[${i}] Warnings: ${result.warningCount}`);
      }
    } catch (error) {
      console.error(`[${i}] Fatal error: ${error}`);
      results.push({
        index: i,
        outputDir: '',
        warningCount: 0,
        files: [],
        success: false,
        error: String(error),
      });
    }

    console.error('');
  }

  const successCount = results.filter((r) => r.success).length;
  console.error(`Collection complete — ${successCount}/${options.runs} runs successful`);

  return results;
}
