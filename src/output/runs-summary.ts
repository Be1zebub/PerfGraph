/**
 * Summary of a multi-run collection.
 *
 * The metrics of the two runs are kept apart: the lab run is the traced
 * navigation PerfGraph measured, the Lighthouse run is Lighthouse's own
 * navigation with its own throttling. Mixing them makes the spread
 * meaningless, so the variance is reported for both, and the lab one first —
 * it is the run the report describes.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** The metrics of one run */
export interface RunMetrics {
  /** 1-based run number */
  run: number;
  /** The measured metrics of the traced run */
  lab: {
    lcpMs: number | null;
    fcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
  };
  /** The metrics Lighthouse reported for its own run */
  lighthouse: {
    lcpMs: number | null;
    fcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
  };
}

/** The spread of a set of values */
export interface MetricSpread {
  samples: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  standardDeviation: number;
}

/** The outcome of one collection run */
export interface RunOutcome {
  index: number;
  outputDir: string;
  success: boolean;
  warningCount: number;
  error?: string;
  files: string[];
}

const EMPTY_METRICS = {
  lcpMs: null,
  fcpMs: null,
  cls: null,
  tbtMs: null,
} as const;

/** The spread of a set of values, or null when there is none. */
export function summarize(values: Array<number | null>): MetricSpread | null {
  const numbers = values.filter((value): value is number => value != null);
  if (numbers.length === 0) return null;

  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance =
    numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);

  return {
    samples: numbers.length,
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    mean,
    median,
    standardDeviation: Math.sqrt(variance),
  };
}

/** The spread of every metric of a set of runs. */
function summarizeAll(
  metrics: RunMetrics[],
  source: 'lab' | 'lighthouse',
): Record<string, MetricSpread | null> {
  return {
    lcpMs: summarize(metrics.map((m) => m[source].lcpMs)),
    fcpMs: summarize(metrics.map((m) => m[source].fcpMs)),
    cls: summarize(metrics.map((m) => m[source].cls)),
    tbtMs: summarize(metrics.map((m) => m[source].tbtMs)),
  };
}

/** The Lighthouse metrics of one run. */
async function readLighthouseMetrics(
  outputDir: string,
): Promise<RunMetrics['lighthouse']> {
  try {
    const raw = JSON.parse(
      await readFile(resolve(outputDir, 'lighthouse.json'), 'utf8'),
    ) as Record<string, unknown>;
    const lhr =
      raw.lhr && typeof raw.lhr === 'object'
        ? (raw.lhr as Record<string, unknown>)
        : raw;
    const audits =
      lhr.audits && typeof lhr.audits === 'object'
        ? (lhr.audits as Record<string, unknown>)
        : {};

    const value = (id: string): number | null => {
      const audit = audits[id];
      if (!audit || typeof audit !== 'object') return null;
      const numericValue = (audit as Record<string, unknown>).numericValue;
      return typeof numericValue === 'number' && Number.isFinite(numericValue)
        ? numericValue
        : null;
    };

    return {
      lcpMs: value('largest-contentful-paint'),
      fcpMs: value('first-contentful-paint'),
      cls: value('cumulative-layout-shift'),
      tbtMs: value('total-blocking-time'),
    };
  } catch {
    return { ...EMPTY_METRICS };
  }
}

/**
 * Collect the metrics of every run.
 *
 * @param runs - The outcome of each run
 * @param labMetrics - The lab metrics of each run, when they are known
 * @returns The metrics of every run
 */
export async function collectRunMetrics(
  runs: RunOutcome[],
  labMetrics: Map<number, RunMetrics['lab']> = new Map(),
): Promise<RunMetrics[]> {
  return Promise.all(
    runs.map(async (run) => ({
      run: run.index,
      lab: labMetrics.get(run.index) ?? { ...EMPTY_METRICS },
      lighthouse: run.success
        ? await readLighthouseMetrics(run.outputDir)
        : { ...EMPTY_METRICS },
    })),
  );
}

/**
 * Build the summary of a multi-run collection.
 *
 * @param url - The analysed URL
 * @param runs - The outcome of each run
 * @param metrics - The metrics of every run
 * @returns The summary document
 */
export function buildRunsSummary(
  url: string,
  runs: RunOutcome[],
  metrics: RunMetrics[],
): Record<string, unknown> {
  return {
    url,
    runs: runs.length,
    completedAt: new Date().toISOString(),
    results: runs.map((run) => ({
      run: run.index,
      outputDir: run.outputDir,
      success: run.success,
      warningCount: run.warningCount,
      error: run.error ?? null,
      files: run.files,
    })),
    summary: {
      successCount: runs.filter((run) => run.success).length,
      failureCount: runs.filter((run) => !run.success).length,
      totalWarnings: runs.reduce((sum, run) => sum + run.warningCount, 0),
    },
    runMetrics: metrics,
    // The report describes the lab run, so its spread comes first.
    variance: summarizeAll(metrics, 'lab'),
    varianceLighthouse: summarizeAll(metrics, 'lighthouse'),
  };
}
