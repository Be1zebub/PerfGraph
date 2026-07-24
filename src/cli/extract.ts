/**
 * `extract` subcommand handler.
 *
 * Reads a normalised IRBundle JSON file (produced by `webtrace normalize`)
 * and runs feature extraction, outputting a FeatureSet as JSON.
 *
 * Usage:
 *   webtrace extract <ir-file>
 *   webtrace extract --input ir.json --output features.json --pretty
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extract } from '../extract/index.js';
import { IRBundleSchema } from '../normalize/types.js';
import type { IRBundle } from '../normalize/types.js';

/** Help text shown by `webtrace extract --help` */
const EXTRACT_HELP = `
EXTRACT OPTIONS
  <file>                Path to a normalised IR JSON file (positional, required)
  --input, -i <file>    Path to IR JSON file (alternative to positional)
  --output, -o <file>   Write output to a file (default: stdout)
  --pretty              Pretty-print JSON output
  --help, -h            Show this help message

EXAMPLES
  webtrace extract ./ir.json
  webtrace extract ./ir.json --output features.json
  webtrace extract ./ir.json --pretty
`;

/** Result of the extract command execution */
export interface ExtractResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Path to the input IR file */
  inputFile: string;
}

/**
 * Load and validate an IRBundle from a JSON file.
 */
function loadIRBundle(filePath: string): IRBundle {
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

  // Validate against IRBundleSchema
  const parsed = IRBundleSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    throw new Error(
      `Error: Invalid IRBundle format in ${filePath}: ${firstIssue?.path.join('.') ?? ''} ${firstIssue?.message ?? ''}`,
    );
  }

  return parsed.data;
}

/**
 * Run the extract command from an IR file path.
 *
 * @param inputFile - Path to IR JSON file
 * @param outputFile - Optional output file path (defaults to stdout)
 * @param pretty - Pretty-print JSON (default: false)
 * @returns ExtractResult
 */
export async function runExtract(
  inputFile: string,
  outputFile?: string,
  pretty?: boolean,
): Promise<ExtractResult> {
  const bundle = loadIRBundle(inputFile);
  const features = extract(bundle);
  const indent = pretty ? 2 : 0;
  const json = JSON.stringify(features, null, indent);

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
 * Parse CLI arguments for the extract command and execute.
 */
export async function runExtractFromArgs(
  args: string[],
): Promise<ExtractResult | null> {
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
        console.log(EXTRACT_HELP);
        return null;

      default:
        if (arg.startsWith('--')) {
          console.error(`Error: Unknown flag "${arg}"`);
          return null;
        }
        // First positional arg is the input file
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
    return await runExtract(inputFile, outputFile, pretty);
  } catch (err) {
    console.error(String(err));
    return null;
  }
}
