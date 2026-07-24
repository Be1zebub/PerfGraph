/**
 * Shared filesystem utilities for reading collection run data.
 *
 * Consolidates duplicated readJson / loadRunDir helpers into one module
 * with consistent error handling (most descriptive variant from normalize.ts).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CoverageRawData, RawDataBundle } from '../collect/types.js';

/** Read a JSON file, returning parsed content or undefined if missing. */
export function readJson(dir: string, filename: string): unknown | undefined {
  const filePath = join(dir, filename);
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Error: Failed to parse ${join(dir, filename)}: ${(err as Error).message}`,
    );
  }
}

/** Assemble a RawDataBundle from a run directory. */
export function loadRunDir(runDir: string): RawDataBundle {
  const dir = resolve(runDir);

  const warningsRaw = readJson(dir, 'warnings.json');

  return {
    trace: readJson(dir, 'trace.json'),
    network: readJson(dir, 'network.json'),
    performance: readJson(dir, 'performance.json'),
    runtime: readJson(dir, 'runtime.json'),
    consoleEntries: readJson(dir, 'console.json'),
    dom: readJson(dir, 'dom.json'),
    lighthouse: readJson(dir, 'lighthouse.json'),
    coverage: readJson(dir, 'coverage.json') as CoverageRawData | undefined,
    warnings:
      warningsRaw &&
      typeof warningsRaw === 'object' &&
      'warnings' in warningsRaw &&
      Array.isArray((warningsRaw as { warnings: unknown }).warnings)
        ? (warningsRaw as { warnings: string[] }).warnings
        : undefined,
  };
}
