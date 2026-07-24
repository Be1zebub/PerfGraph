/**
 * `normalize` subcommand handler.
 *
 * Reads raw data files from a run directory and outputs the normalized
 * Intermediate Representation (IRBundle) as JSON.
 *
 * Usage:
 *   webtrace normalize <run-dir>
 *
 * The run directory should contain the JSON files produced by a single
 * collection run (trace.json, network.json, performance.json, etc.).
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { normalize } from '../normalize/index.js';
import { loadRunDir } from '../shared/fs-utils.js';

/** Expected JSON filenames in a run directory */
const DATA_FILES = [
  'trace.json',
  'network.json',
  'performance.json',
  'runtime.json',
  'console.json',
  'dom.json',
  'lighthouse.json',
] as const;

/** Help text shown by `webtrace normalize --help` */
const NORMALIZE_HELP = `
NORMALIZE OPTIONS
  <input>               Path to a run directory OR parent output directory (positional, required)
  --output, -o <file>   Write output to a file (default: stdout)
  --pretty              Pretty-print JSON output
  --help, -h            Show this help message

EXAMPLES
  webtrace normalize ./runs/2025-01-15T10-30-00
  webtrace normalize ./runs/2025-01-15T10-30-00 --output ir.json
  webtrace normalize ./runs       (auto-detect latest run)
  webtrace normalize ./runs --pretty --output ir.json
`;

/** Result of the normalize command execution */
export interface NormalizeResult {
  /** Whether normalization succeeded */
  success: boolean;
  /** Path to the input run directory */
  runDir: string;
  /** Version of the generated IR bundle */
  irVersion: string;
}

/**
 * Run the normalize command from a directory path.
 *
 * @param runDir - Path to a collection run directory
 * @param outputFile - Optional file path to write output (defaults to stdout)
 * @param pretty - Pretty-print JSON output (default: false)
 * @returns NormalizeResult
 */
export async function runNormalize(
  runDir: string,
  outputFile?: string,
  pretty?: boolean,
): Promise<NormalizeResult> {
  const raw = loadRunDir(runDir);
  const bundle = normalize(raw);
  const indent = pretty ? 2 : 0;
  const json = JSON.stringify(bundle, null, indent);

  if (outputFile) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outputFile, json, 'utf-8');
  } else {
    console.log(json);
  }

  return {
    success: true,
    runDir: resolve(runDir),
    irVersion: bundle.meta.irVersion,
  };
}

/**
 * Find the latest run directory within a parent output directory.
 *
 * The parent directory should contain timestamped subdirectories named in
 * ISO 8601 format (e.g. "2025-01-15T10-30-00"). The latest is determined
 * by name sort, which is chronological for ISO 8601 date strings.
 *
 * @param parentDir - Parent directory containing timestamped subdirectories
 * @returns Path to the latest run directory
 * @throws Error if no subdirectories are found
 */
export function findLatestRunDir(parentDir: string): string {
  const entries = readdirSync(parentDir, { withFileTypes: true });
  const subdirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (subdirs.length === 0) {
    throw new Error(`Error: No collector output files found in ${parentDir}`);
  }

  const latest = subdirs[subdirs.length - 1]!;
  return join(parentDir, latest);
}

/**
 * Parse CLI arguments for the normalize command and execute.
 *
 * Accepts:
 *   <input>                (positional, required — run dir or parent dir)
 *   --output, -o <file>    (optional, default: stdout)
 *   --pretty               (optional, default: minified)
 *   --help, -h             (show help)
 *
 * Mode detection:
 *   - If <input> contains JSON data files directly → treat as single run dir
 *   - If <input> contains timestamped subdirectories → use latest run dir
 *   - Otherwise → error
 */
export async function runNormalizeFromArgs(
  args: string[],
): Promise<NormalizeResult | null> {
  let input: string | undefined;
  let outputFile: string | undefined;
  let pretty = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case '--output':
      case '-o':
        if (i + 1 >= args.length) {
          console.error('Error: --output requires a value');
          return null;
        }
        outputFile = args[++i]!;
        break;

      case '--pretty':
        pretty = true;
        break;

      case '--help':
      case '-h':
        console.log(NORMALIZE_HELP);
        return null;

      default:
        if (arg.startsWith('--')) {
          console.error(`Error: Unknown flag "${arg}"`);
          return null;
        }
        // First positional arg is the input path
        if (!input) {
          input = arg;
        }
        break;
    }
  }

  if (!input) {
    console.error('Error: <input> is required');
    return null;
  }

  // Validate path exists
  const resolvedPath = resolve(input);
  if (!existsSync(resolvedPath)) {
    console.error(`Error: Input path does not exist: ${input}`);
    return null;
  }

  // Validate it's a directory
  if (!statSync(resolvedPath).isDirectory()) {
    console.error(`Error: Input is not a directory: ${input}`);
    return null;
  }

  // Detect mode: single run dir vs parent output dir
  const entries = readdirSync(resolvedPath);
  const hasDataFiles = DATA_FILES.some((f) => entries.includes(f));
  const hasTimestampDirs = entries.some((name) =>
    /^\d{4}-\d{2}-\d{2}T/.test(name),
  );

  let runDir: string;
  if (hasDataFiles) {
    // Mode 1: Single run directory (contains JSON data files directly)
    runDir = resolvedPath;
  } else if (hasTimestampDirs) {
    // Mode 2: Parent output directory — auto-detect latest run
    runDir = findLatestRunDir(resolvedPath);
  } else {
    console.error(`Error: No collector output files found in ${resolvedPath}`);
    return null;
  }

  // Execute normalize with error handling
  try {
    return await runNormalize(runDir, outputFile, pretty);
  } catch (err) {
    console.error(String(err));
    return null;
  }
}
