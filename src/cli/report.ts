/**
 * `report` subcommand handler.
 *
 * Reads a FeatureSet JSON file (from `webtrace extract`), runs causal analysis,
 * generates a comprehensive Report, and outputs as JSON.
 *
 * Usage:
 *   webtrace report <features-file>
 *   webtrace report --input features.json --output report.json --pretty
 *
 * @packageDocumentation
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCausalGraph } from '../causal/index.js';
import { buildReport } from '../report/index.js';
import { FeatureSetSchema } from '../extract/types.js';
import type { FeatureSet } from '../extract/types.js';

/** Help text shown by `webtrace report --help` */
const REPORT_HELP = `
REPORT OPTIONS
  <file>                Path to a FeatureSet JSON file (positional, required)
  --input, -i <file>    Path to FeatureSet JSON file (alternative to positional)
  --output, -o <file>   Write output to a file (default: stdout)
  --pretty              Pretty-print JSON output
  --help, -h            Show this help message

EXAMPLES
  webtrace report ./features.json
  webtrace report ./features.json --output report.json
  webtrace report ./features.json --pretty
`;

/** Result of the report command execution */
export interface ReportResult {
  /** Whether report generation succeeded */
  success: boolean;
  /** Path to the input FeatureSet file */
  inputFile: string;
}

/**
 * Load and validate a FeatureSet from a JSON file.
 */
function loadFeatureSet(filePath: string): FeatureSet {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Error: File not found: ${filePath}`);
  }

  let raw: unknown;
  try {
    const content = readFileSync(resolved, 'utf-8');
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `Error: Failed to parse ${filePath}: ${(err as Error).message}`,
    );
  }

  const parsed = FeatureSetSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw new Error(
      `Error: Invalid FeatureSet format in ${filePath}: ${firstIssue?.path.join('.') ?? ''} ${firstIssue?.message ?? ''}`,
    );
  }

  return parsed.data;
}

/**
 * Run the report command from a FeatureSet file path.
 *
 * @param inputFile - Path to FeatureSet JSON file
 * @param outputFile - Optional output file path (defaults to stdout)
 * @param pretty - Pretty-print JSON (default: false)
 * @returns ReportResult
 */
export async function runReport(
  inputFile: string,
  outputFile?: string,
  pretty?: boolean,
): Promise<ReportResult> {
  const features = loadFeatureSet(inputFile);
  const graph = buildCausalGraph(features);
  const report = buildReport(graph, features);
  const indent = pretty ? 2 : 0;
  const json = JSON.stringify(report, null, indent);

  if (outputFile) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outputFile, json, 'utf-8');
  } else {
    console.log(json);
  }

  return {
    success: true,
    inputFile: resolve(inputFile),
  };
}

/**
 * Parse CLI arguments for the report command and execute.
 */
export async function runReportFromArgs(
  args: string[],
): Promise<ReportResult | null> {
  let inputFile: string | undefined;
  let outputFile: string | undefined;
  let pretty = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case '--input':
      case '-i':
        if (i + 1 >= args.length) {
          console.error('Error: --input requires a value');
          return null;
        }
        inputFile = args[++i]!;
        break;

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
        console.log(REPORT_HELP);
        return null;

      default:
        if (arg.startsWith('--')) {
          console.error(`Error: Unknown flag "${arg}"`);
          return null;
        }
        if (!inputFile) {
          inputFile = arg;
        }
        break;
    }
  }

  if (!inputFile) {
    console.error('Error: <file> is required (positional or --input)');
    return null;
  }

  try {
    return await runReport(inputFile, outputFile, pretty);
  } catch (err) {
    console.error(String(err));
    return null;
  }
}
