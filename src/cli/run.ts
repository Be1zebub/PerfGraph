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
import { buildInsights } from '../distill/insights.js';
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

/** Help text */
const RUN_HELP = `
RUN OPTIONS
  --url <url>           Target URL to analyze (required)
  --output <dir>        Output directory (default: ./perfgraph-output)
  --runs <n>            Number of collection runs (default: 1)
  --pretty              Pretty-print final report JSON
  --device <name>       Device name for mobile emulation (e.g. "iPhone 13")
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

  // Write extracted features
  featuresFile = resolve(runDir, 'features.toon');
  writeFileSync(featuresFile, await convertToon(features), 'utf-8');

  // Build and write insights.toon
  const insights = buildInsights(features, raw.lighthouse ?? {});
  insightsFile = resolve(runDir, 'insights.toon');
  writeFileSync(insightsFile, await convertToon(insights), 'utf-8');

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
  const report = buildReport(graph, features);

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

  console.error(`Report written to ${reportFile}`);

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
      case '--url':
        if (i + 1 >= args.length) {
          console.error('Error: --url requires a value');
          return null;
        }
        url = args[++i]!;
        break;

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

  return runRun(url, output, runs, pretty, flags, mobile);
}
