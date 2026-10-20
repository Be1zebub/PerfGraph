/**
 * `run` subcommand — full pipeline in one command.
 *
 * Chains collect → normalize → extract → analyze → report,
 * writing intermediate artifacts to a temp directory and
 * outputting only the final Report JSON.
 *
 * Usage:
 *   perfgraph run --url <url> [--output <dir>] [--runs <n>] [--pretty]
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeManifest } from '../output/manifest.js';
import { convertToon } from '../output/toon.js';
import { run } from '../collect/orchestrator.js';
import type { RawDataBundle } from '../collect/types.js';
import { loadRunDir } from '../shared/fs-utils.js';
import { normalize } from '../normalize/index.js';
import type { IRBundle } from '../normalize/types.js';
import { extract } from '../extract/index.js';
import { buildInsights, collectRunWarnings, extractLighthouseScores } from '../distill/insights.js';
import {
  buildNetworkSummary,
  buildLighthouseSummary,
  buildCoverageSummary,
} from '../distill/summaries.js';
import type { NetworkRawData, LighthouseRawData, CoverageRawData } from '../collect/types.js';
import { buildCausalGraph } from '../causal/index.js';
import { buildReport } from '../report/index.js';
import { buildReportMarkdown } from '../report/markdown.js';
import { DEFAULT_RUN_OPTIONS } from '../shared/types.js';
import type { CollectorRunOptions } from '../shared/types.js';
import { normalizeUrl } from '../shared/utils.js';

/** Help text */
const RUN_HELP = `
RUN OPTIONS
  --url <url>           Target URL to analyze (required)
  --output <dir>        Output directory (default: ./perfgraph-output)
  --runs <n>            Number of collection runs (default: 1)
  --pretty              Pretty-print final report JSON
  --device <name>       Device name for mobile emulation (e.g. "iPhone 13")
  --owned-domain <host> Treat an additional hostname as first-party CDN (repeatable)
  --no-lighthouse       Skip Lighthouse collection
  --no-coverage         Skip JS/CSS coverage collection
  --no-console          Skip console log collection
  --no-dom              Skip DOM snapshot collection
  --help, -h            Show this help message

EXAMPLES
  perfgraph run --url https://example.com
  perfgraph run --url https://example.com --pretty
  perfgraph run --url https://example.com --pretty --runs 3
`;

/** Result of the full pipeline execution */
export interface RunResult {
  /** Whether all pipeline steps succeeded */
  success: boolean;
  /** Path to the generated report file, if any */
  reportFile?: string;
  /** Run output directory path */
  outputDir?: string;
  /** Paths to all written artifacts */
  files?: {
    ir: string;
    features: string;
    graph: string;
    report: string;
    insights: string;
  };
}

/**
 * Execute the full pipeline.
 *
 * @param url - Target URL
 * @param output - Base output directory for collection + final report
 * @param runs - Number of collection runs
 * @param pretty - Pretty-print final report
 * @param flags - boolean flags for skipping collectors
 * @param mobile - Device name for mobile emulation (e.g. "iPhone 13")
 * @returns RunResult
 */
export async function runRun(
  url: string,
  output: string,
  runs: number,
  pretty: boolean,
  flags: {
    noLighthouse?: boolean;
    noCoverage?: boolean;
    noConsole?: boolean;
    noDom?: boolean;
  },
  mobile?: string,
  ownedDomains: string[] = [],
): Promise<RunResult | null> {
  // -----------------------------------------------------------------------
  // 1. Collect
  // -----------------------------------------------------------------------
  const options: CollectorRunOptions = {
    ...DEFAULT_RUN_OPTIONS,
    url,
    output,
    runs,
    noLighthouse: flags.noLighthouse ?? false,
    noCoverage: flags.noCoverage ?? false,
    noConsole: flags.noConsole ?? false,
    noDom: flags.noDom ?? false,
    mobile,
    ownedDomains,
  };

  const collectResults = await run(url, options);
  const successRuns = collectResults.filter((r) => r.success);

  if (successRuns.length === 0) {
    console.error('Error: All collection runs failed');
    return null;
  }

  // Use the first successful run's output dir
  const runDir = resolve(successRuns[0]!.outputDir);

  // File paths for intermediate artifacts (set during pipeline)
  let irFile = '';
  let featuresFile = '';
  let insightsFile = '';
  let graphFile = '';

  // -----------------------------------------------------------------------
  // 2. Normalize
  // -----------------------------------------------------------------------
  const raw: RawDataBundle = loadRunDir(runDir);
  let ir: IRBundle;
  try {
    ir = normalize(raw);
  } catch (err) {
    console.error(`Error: Normalization failed: ${(err as Error).message}`);
    return null;
  }

  // Write intermediate representation
  irFile = resolve(runDir, 'ir.json');
  writeFileSync(irFile, JSON.stringify(ir, null, 2), 'utf-8');

  // Write compact summaries of raw data files
  if (raw.network) {
    const networkSummary = buildNetworkSummary(raw.network as NetworkRawData);
    writeFileSync(resolve(runDir, 'network-summary.toon'), await convertToon(networkSummary), 'utf-8');
  }
  if (raw.lighthouse) {
    const lighthouseSummary = buildLighthouseSummary(raw.lighthouse as LighthouseRawData);
    writeFileSync(resolve(runDir, 'lighthouse-summary.toon'), await convertToon(lighthouseSummary), 'utf-8');
  }
  if (raw.coverage) {
    const coverageSummary = buildCoverageSummary(raw.coverage as CoverageRawData);
    writeFileSync(resolve(runDir, 'coverage-summary.toon'), await convertToon(coverageSummary), 'utf-8');
  }

  // -----------------------------------------------------------------------
  // 3. Extract
  // -----------------------------------------------------------------------
  const features = extract(ir);

  // -----------------------------------------------------------------------
  // 4. Analyze (causal graph)
  // -----------------------------------------------------------------------
  const graph = buildCausalGraph(features);

  // Write causal graph
  graphFile = resolve(runDir, 'graph.toon');
  writeFileSync(graphFile, await convertToon(graph), 'utf-8');

  // -----------------------------------------------------------------------
  // 5. Report
  // -----------------------------------------------------------------------
  // Keep the report score aligned with the Lighthouse score already exposed
  // in insights. Without this argument, a warning-only causal graph can
  // downgrade an otherwise green Lighthouse run to MODERATE.
  const lighthousePerformance = extractLighthouseScores(raw.lighthouse ?? {}).performance;
  // The Lighthouse run warnings describe the quality of that run: a page that
  // did not finish loading or was redirected. They belong in the report, not
  // only in the insights.
  const runWarnings = collectRunWarnings(raw.lighthouse ?? {}, raw.warnings);
  const report = buildReport(graph, features, lighthousePerformance, runWarnings);

  // -----------------------------------------------------------------------
  // 6. Insights
  // -----------------------------------------------------------------------
  // The insights reuse the report's recommendations so that both artifacts
  // give an agent the same answer.
  const insights = buildInsights(
    features,
    raw.lighthouse ?? {},
    runWarnings,
    report.recommendations,
  );

  // Write extracted features
  featuresFile = resolve(runDir, 'features.toon');
  writeFileSync(featuresFile, await convertToon(features), 'utf-8');

  // Write insights.toon
  insightsFile = resolve(runDir, 'insights.toon');
  writeFileSync(insightsFile, await convertToon(insights), 'utf-8');

  // Write report as .toon (AI consumption) + keep JSON for stdout
  const reportFile = resolve(runDir, 'report.toon');
  writeFileSync(reportFile, await convertToon(report), 'utf-8');
  const reportJson = JSON.stringify(report, null, pretty ? 2 : 0);

  // Write human-readable markdown report
  const reportMarkdown = buildReportMarkdown(report, insights);
  const reportMdFile = resolve(runDir, 'report.md');
  writeFileSync(reportMdFile, reportMarkdown, 'utf-8');

  // Write manifest
  await writeManifest(runDir);

  // Also print to stdout
  console.log(reportJson);

  // A human running the CLI should see where the result is and what it says,
  // without having to read the JSON.
  console.error('');
  console.error(`Score: ${report.summary.score.toUpperCase()}`);
  if (report.summary.lighthousePerformance != null) {
    console.error(
      `Lighthouse performance: ${(report.summary.lighthousePerformance * 100).toFixed(0)}/100`,
    );
  }
  console.error(
    `Issues: ${report.summary.criticalIssues} critical, ${report.summary.warnings} warnings, ${report.summary.infos} info`,
  );
  if (report.summary.dataQuality?.warnings.length) {
    console.error(`Data quality: ${report.summary.dataQuality.status}`);
    for (const warning of report.summary.dataQuality.warnings) {
      console.error(`  - ${warning}`);
    }
  }
  console.error('');
  console.error(`Report: ${reportFile}`);
  console.error(`Markdown: ${reportMdFile}`);
  console.error(`Insights: ${insightsFile}`);

  return {
    success: true,
    reportFile,
    outputDir: runDir,
    files: {
      ir: irFile,
      features: featuresFile,
      graph: graphFile,
      report: reportFile,
      insights: insightsFile,
    },
  };
}

/**
 * Parse CLI arguments for the run command and execute.
 */
export async function runRunFromArgs(
  args: string[],
): Promise<RunResult | null> {
  let url: string | undefined;
  let output = DEFAULT_RUN_OPTIONS.output;
  let runs = DEFAULT_RUN_OPTIONS.runs;
  let pretty = false;
  let mobile: string | undefined;
  const ownedDomains: string[] = [];
  const flags: {
    noLighthouse: boolean;
    noCoverage: boolean;
    noConsole: boolean;
    noDom: boolean;
  } = {
    noLighthouse: false,
    noCoverage: false,
    noConsole: false,
    noDom: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case '--url': {
        if (i + 1 >= args.length) {
          console.error('Error: --url requires a value');
          return null;
        }
        url = normalizeUrl(args[++i]!);
        break;
      }

      case '--output':
        if (i + 1 >= args.length) {
          console.error('Error: --output requires a value');
          return null;
        }
        output = args[++i]!;
        break;

      case '--runs':
        if (i + 1 >= args.length) {
          console.error('Error: --runs requires a value');
          return null;
        }
        runs = parseInt(args[++i]!, 10);
        if (isNaN(runs) || runs < 1) {
          console.error('Error: --runs must be a positive integer');
          return null;
        }
        break;

      case '--pretty':
        pretty = true;
        break;

      case '--no-lighthouse':
        flags.noLighthouse = true;
        break;

      case '--no-coverage':
        flags.noCoverage = true;
        break;

      case '--no-console':
        flags.noConsole = true;
        break;

      case '--no-dom':
        flags.noDom = true;
        break;

      case '--device':
        if (i + 1 >= args.length) {
          console.error('Error: --device requires a value');
          return null;
        }
        mobile = args[++i]!;
        break;

      case '--owned-domain':
        if (i + 1 >= args.length) {
          console.error('Error: --owned-domain requires a hostname');
          return null;
        }
        ownedDomains.push(args[++i]!);
        break;

      case '--help':
      case '-h':
        console.log(RUN_HELP);
        return null;

      default:
        if (arg.startsWith('--')) {
          console.error(`Error: Unknown flag "${arg}"`);
          return null;
        }
        break;
    }
  }

  if (!url) {
    console.error('Error: --url is required');
    console.error('Usage: perfgraph run --url <url> [--output <dir>] [--runs <n>] [--pretty]');
    return null;
  }

  return runRun(url, output, runs, pretty, flags, mobile, ownedDomains);
}
