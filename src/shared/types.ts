/**
 * Shared types used across the webtrace codebase.
 */

/** Output file paths for a single collection run */
export interface OutputPaths {
  /** Root output directory */
  dir: string;
  /** Path to trace.json */
  trace: string;
  /** Path to network.json */
  network: string;
  /** Path to metrics.json */
  metrics: string;
  /** Path to runtime.json */
  runtime: string;
  /** Path to coverage.json */
  coverage: string;
  /** Path to console.json */
  console: string;
  /** Path to dom.json */
  dom: string;
  /** Path to lighthouse.json */
  lighthouse: string;
  /** Path to warnings.json */
  warnings: string;
}

/** Options for a collection run */
export interface CollectorRunOptions {
  /** Target URL to collect data from */
  url: string;
  /** Base output directory (default: ./webtrace-output) */
  output: string;
  /** Number of runs (default: 1) */
  runs: number;
  /** Skip Lighthouse collection */
  noLighthouse: boolean;
  /** Skip Coverage collection */
  noCoverage: boolean;
  /** Skip Console collection */
  noConsole: boolean;
  /** Skip DOM snapshot collection */
  noDom: boolean;
  /** Skip Network collection */
  noNetwork: boolean;
  /** Skip Performance metrics collection */
  noPerformance: boolean;
  /** Skip Runtime collection */
  noRuntime: boolean;
  /** Device name for emulation (e.g. "iPhone 13", "Pixel 7"). Empty = desktop */
  mobile?: string;
}

/** Result of a single collection run */
export interface RunResult {
  /** 1-based run index */
  index: number;
  /** Output directory for this run */
  outputDir: string;
  /** Number of warnings generated */
  warningCount: number;
  /** Files written during this run */
  files: string[];
  /** Whether the run succeeded */
  success: boolean;
  /** Error message if run failed */
  error?: string;
}

/** Default values for CollectorRunOptions */
export const DEFAULT_RUN_OPTIONS: CollectorRunOptions = {
  url: '',
  output: './webtrace-output',
  runs: 1,
  noLighthouse: false,
  noCoverage: false,
  noConsole: false,
  noDom: false,
  noNetwork: false,
  noPerformance: false,
  noRuntime: false,
  mobile: undefined,
};
