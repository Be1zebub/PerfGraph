/**
 * `collect` subcommand handler.
 *
 * Parses CLI flags and delegates to the orchestrator.
 * All progress messages are written to stderr; only the final JSON summary
 * (run results) is written to stdout for piping.
 */

import { run } from '../collect/orchestrator.js';
import type { CollectorRunOptions } from '../shared/types.js';
import { DEFAULT_RUN_OPTIONS } from '../shared/types.js';

/** Result of the collect command execution */
export interface CollectResult {
  /** Whether any runs succeeded */
  success: boolean;
  /** Total number of runs attempted */
  runs: number;
  /** Number of successful runs */
  successfulRuns: number;
  /** Output directories for each run */
  outputDirs: string[];
  /** Total warning count across all runs */
  warnings: number;
}

/**
 * Parse CLI arguments and execute collection.
 *
 * @param args - Array of CLI arguments (everything after "collect")
 * @returns CollectResult or null if parsing failed
 */
export async function runCollect(args: string[]): Promise<CollectResult | null> {
  const options = parseArgs(args);
  if (!options) {
    return null;
  }

  const results = await run(options.url, options);

  const successfulRuns = results.filter((r) => r.success);
  const allOutputDirs = results.map((r) => r.outputDir).filter(Boolean);

  const result: CollectResult = {
    success: successfulRuns.length > 0,
    runs: results.length,
    successfulRuns: successfulRuns.length,
    outputDirs: allOutputDirs,
    warnings: results.reduce((sum, r) => sum + r.warningCount, 0),
  };

  // Write JSON summary to stdout (for piping)
  console.log(JSON.stringify(result, null, 2));

  return result;
}

/**
 * Parse CLI flags into CollectorRunOptions.
 *
 * Accepts:
 *   --url <url>        (required)
 *   --output <dir>     (default: ./perfgraph-output)
 *   --runs <n>         (default: 1)
 *   --no-lighthouse    (flag)
 *   --no-coverage      (flag)
 *   --no-console       (flag)
 *   --no-dom           (flag)
 *   --no-network       (flag)
 *   --no-performance   (flag)
 *   --no-runtime       (flag)
 *   --device <name>    (optional)
 */
function parseArgs(args: string[]): CollectorRunOptions | null {
  const options: CollectorRunOptions = { ...DEFAULT_RUN_OPTIONS };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case '--url':
        if (i + 1 >= args.length) {
          console.error('Error: --url requires a value');
          return null;
        }
        options.url = args[++i]!;
        break;

      case '--output':
        if (i + 1 >= args.length) {
          console.error('Error: --output requires a value');
          return null;
        }
        options.output = args[++i]!;
        break;

      case '--runs':
        if (i + 1 >= args.length) {
          console.error('Error: --runs requires a value');
          return null;
        }
        options.runs = parseInt(args[++i]!, 10);
        if (isNaN(options.runs) || options.runs < 1) {
          console.error('Error: --runs must be a positive integer');
          return null;
        }
        break;

      case '--no-lighthouse':
        options.noLighthouse = true;
        break;

      case '--no-coverage':
        options.noCoverage = true;
        break;

      case '--no-console':
        options.noConsole = true;
        break;

      case '--no-dom':
        options.noDom = true;
        break;

      case '--no-network':
        options.noNetwork = true;
        break;

      case '--no-performance':
        options.noPerformance = true;
        break;

      case '--no-runtime':
        options.noRuntime = true;
        break;

      case '--device':
        if (i + 1 >= args.length) {
          console.error('Error: --device requires a value');
          return null;
        }
        options.mobile = args[++i]!;
        break;

      default:
        if (arg.startsWith('--')) {
          console.error(`Error: Unknown flag "${arg}"`);
          return null;
        }
        // Ignore positional args for now
        break;
    }
  }

  if (!options.url) {
    console.error('Error: --url is required');
    console.error('Usage: perfgraph collect --url <url> [--output <dir>] [--runs <n>]');
    return null;
  }

  return options;
}
