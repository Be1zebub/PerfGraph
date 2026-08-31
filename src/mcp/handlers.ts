/**
 * MCP tool handler implementations.
 *
 * Each handler corresponds to a registered MCP tool. The primary shortcut
 * `perfgraph_run` runs the full pipeline (collect → normalize → extract →
 * analyze → report) in a single call. Advanced users can call individual
 * pipeline steps via the dedicated tools.
 *
 * @packageDocumentation
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { writeManifest } from '../output/manifest.js';
import type { RawDataBundle } from '../collect/types.js';
import { loadRunDir } from '../shared/fs-utils.js';
import { DEFAULT_RUN_OPTIONS } from '../shared/types.js';
import type { CollectorRunOptions } from '../shared/types.js';
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
import { convertToon } from '../output/toon.js';
import type { ReportIssue } from '../report/types.js';
import { severityOrder } from '../shared/utils.js';
import type { ProgressReporter } from './progress.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a JSON or TOON file and return its path. */
async function writeJson(dir: string, filename: string, data: unknown): Promise<string> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = resolve(dir, filename);
  const content = filename.endsWith('.toon')
    ? await convertToon(data)
    : JSON.stringify(data, null, 2);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/** Build a compact issues summary map from the report. */
function buildIssuesMap(issues: ReportIssue[]): Record<string, string> {
  const map: Record<string, string> = {};

  for (const issue of issues) {
    let key: string | undefined;

    if (issue.id.startsWith('rb-')) {
      key = 'renderBlocking';
    } else if (issue.id.includes('waterfall') || issue.id === 'cascade-delay') {
      key = 'cascadeDelay';
    } else if (issue.id.includes('deep-critical') || issue.id === 'deep-critical-chain') {
      key = 'deepCriticalChain';
    } else if (issue.id.includes('lcp')) {
      key = 'lcpIncrease';
    } else if (issue.id.includes('layout') || issue.id.includes('cls')) {
      key = 'layoutShifts';
    } else if (
      issue.id.includes('js') ||
      issue.id.includes('long-task') ||
      issue.id.includes('tbt')
    ) {
      key = 'javaScript';
    } else if (issue.id.includes('third-party')) {
      key = 'thirdParty';
    } else if (issue.id.includes('ttfb')) {
      key = 'ttfb';
    } else {
      key = issue.id.replace(/[^a-zA-Z0-9]/g, '');
    }

    // Upgrade severity if we already have a weaker one
    const existing = map[key];
    if (
      !existing ||
      severityOrder(issue.severity) > severityOrder(existing)
    ) {
      map[key] = issue.severity;
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

/**
 * Collect raw performance data from a URL.
 */
export async function handleCollect(
  url: string,
  outputDir?: string,
  runs?: number,
  onProgress?: ProgressReporter | null,
  mobile?: string,
): Promise<{
  success: boolean;
  runDir?: string;
  error?: string;
}> {
  const { run } = await import('../collect/orchestrator.js');
  const options: CollectorRunOptions = {
    ...DEFAULT_RUN_OPTIONS,
    url,
    output: outputDir ?? DEFAULT_RUN_OPTIONS.output,
    runs: runs ?? 1,
    mobile,
  };

  await onProgress?.report(0, 1, `Collecting data from ${url}...`);
  const results = await run(url, options);
  const successRuns = results.filter((r) => r.success);

  if (successRuns.length === 0) {
    const errors = results
      .map((r) => r.error)
      .filter(Boolean)
      .join('; ');
    return { success: false, error: errors || 'All collection runs failed' };
  }

  return { success: true, runDir: resolve(successRuns[0]!.outputDir) };
}

/**
 * Normalize collected data into an IRBundle.
 */
export async function handleNormalize(
  runDir: string,
): Promise<{ ir: IRBundle; irFile: string }> {
  if (!existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir}`);
  }

  const raw = loadRunDir(runDir);
  const ir = normalize(raw);
  const irFile = await writeJson(runDir, 'ir.json', ir);

  return { ir, irFile };
}

/**
 * Extract diagnostic features from an IRBundle.
 */
export async function handleExtract(
  irFile: string,
): Promise<{ featuresFile: string }> {
  if (!existsSync(irFile)) {
    throw new Error(`IR file not found: ${irFile}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(irFile, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse IR file: ${(err as Error).message}`);
  }

  const ir = raw as IRBundle;
  const features = extract(ir);
  const dir = resolve(irFile, '..');
  const featuresFile = await writeJson(dir, 'features.toon', features);

  return { featuresFile };
}

/**
 * Build a causal graph from extracted features.
 */
export async function handleAnalyze(
  featuresFile: string,
): Promise<{ graphFile: string }> {
  if (!existsSync(featuresFile)) {
    throw new Error(`Features file not found: ${featuresFile}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(featuresFile, 'utf-8'));
  } catch (err) {
    throw new Error(
      `Failed to parse features file: ${(err as Error).message}`,
    );
  }

  const features = raw as import('../extract/types.js').FeatureSet;
  const graph = buildCausalGraph(features);
  const dir = resolve(featuresFile, '..');
  const graphFile = await writeJson(dir, 'graph.toon', graph);

  return { graphFile };
}

/**
 * Generate a diagnostic report from extracted features.
 */
export async function handleReport(
  featuresFile: string,
): Promise<{ reportFile: string }> {
  if (!existsSync(featuresFile)) {
    throw new Error(`Features file not found: ${featuresFile}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(featuresFile, 'utf-8'));
  } catch (err) {
    throw new Error(
      `Failed to parse features file: ${(err as Error).message}`,
    );
  }

  const features = raw as import('../extract/types.js').FeatureSet;
  const graph = buildCausalGraph(features);
  const report = buildReport(graph, features);
  const dir = resolve(featuresFile, '..');
  const reportFile = await writeJson(dir, 'report.toon', report);

  return { reportFile };
}

// ---------------------------------------------------------------------------
// Primary shortcut: run full pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full PerfGraph pipeline: collect → normalize → extract → analyze → report.
 *
 * Sends progress notifications and returns structured results suitable for
 * AI agent consumption.
 */
export async function handleRun(
  url: string,
  outputDir?: string,
  runs?: number,
  onProgress?: ProgressReporter | null,
  mobile?: string,
): Promise<{
  url: string;
  outputDir: string;
  files: {
    report: string;
    features: string;
    graph: string;
    insights: string;
    networkSummary: string;
    lighthouseSummary: string;
    coverageSummary: string;
  };
  summary: {
    score: string;
    criticalIssues: number;
    warnings: number;
    infos: number;
    issues: Record<string, string>;
  };
}> {
  const { run } = await import('../collect/orchestrator.js');
  const baseOutput = outputDir ?? DEFAULT_RUN_OPTIONS.output;

  const options: CollectorRunOptions = {
    ...DEFAULT_RUN_OPTIONS,
    url,
    output: baseOutput,
    runs: runs ?? 1,
    mobile,
  };

  await onProgress?.report(1, 5, 'Collecting data...');
  const collectResults = await run(url, options);
  const successRuns = collectResults.filter((r) => r.success);

  if (successRuns.length === 0) {
    const errors = collectResults
      .map((r) => r.error)
      .filter(Boolean)
      .join('; ');
    throw new Error(
      `All collection runs failed: ${errors || 'unknown error'}`,
    );
  }

  const runDir = resolve(successRuns[0]!.outputDir);

  // Normalize
  await onProgress?.report(2, 5, 'Normalizing collected data...');
  const raw: RawDataBundle = loadRunDir(runDir);

  // Write compact summaries of raw data files before normalization
  if (raw.network) {
    const networkSummary = buildNetworkSummary(raw.network as NetworkRawData);
    await writeJson(runDir, 'network-summary.toon', networkSummary);
  }
  if (raw.lighthouse) {
    const lighthouseSummary = buildLighthouseSummary(raw.lighthouse as LighthouseRawData);
    await writeJson(runDir, 'lighthouse-summary.toon', lighthouseSummary);
  }
  if (raw.coverage) {
    const coverageSummary = buildCoverageSummary(raw.coverage as CoverageRawData);
    await writeJson(runDir, 'coverage-summary.toon', coverageSummary);
  }

  let ir: IRBundle;
  try {
    ir = normalize(raw);
  } catch (err) {
    throw new Error(`Normalization failed: ${(err as Error).message}`);
  }
  await writeJson(runDir, 'ir.json', ir);

  // Extract features
  await onProgress?.report(3, 5, 'Extracting diagnostic features...');
  const features = extract(ir);
  const featuresFile = await writeJson(runDir, 'features.toon', features);

  // Build insights
  const insights = buildInsights(features, raw.lighthouse ?? {});
  const insightsFile = await writeJson(runDir, 'insights.toon', insights);

  // Build causal graph
  await onProgress?.report(4, 5, 'Building causal degradation graph...');
  const graph = buildCausalGraph(features);
  const graphFile = await writeJson(runDir, 'graph.toon', graph);

  // Generate report (pass Lighthouse performance for score blending)
  await onProgress?.report(5, 5, 'Generating diagnostic report...');
  const lighthousePerf = ir.lighthouse.scores?.performance;
  const report = buildReport(graph, features, lighthousePerf);
  const reportFile = await writeJson(runDir, 'report.toon', report);

  // Write human-readable markdown report
  const reportMarkdown = buildReportMarkdown(report, insights);
  const reportMdFile = resolve(runDir, 'report.md');
  writeFileSync(reportMdFile, reportMarkdown, 'utf-8');

  // Write manifest
  const manifestFile = await writeManifest(runDir);

  // Build light summary for the agent
  const issuesMap = buildIssuesMap(report.issues);

  const result = {
    url,
    outputDir: runDir,
    files: {
      report: reportFile,
      reportMd: reportMdFile,
      features: featuresFile,
      graph: graphFile,
      insights: insightsFile,
      ir: resolve(runDir, 'ir.json'),
      manifest: manifestFile,
      networkSummary: resolve(runDir, 'network-summary.toon'),
      lighthouseSummary: resolve(runDir, 'lighthouse-summary.toon'),
      coverageSummary: resolve(runDir, 'coverage-summary.toon'),
    },
    summary: {
      score: report.summary.score,
      criticalIssues: report.summary.criticalIssues,
      warnings: report.summary.warnings,
      infos: report.summary.infos,
      issues: issuesMap,
    },
  };

  return result;
}
