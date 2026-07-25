/**
 * Manifest generator — scans a run directory and produces a manifest.toon
 * listing all known artifacts with descriptions, sizes, and recommended read order.
 *
 * @packageDocumentation
 */

import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { convertToon } from './toon.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single artifact entry in the manifest. */
export interface ManifestEntry {
  /** File name (e.g. "report.toon") */
  filename: string;
  /** Human-readable description of what this artifact contains */
  description: string;
  /** Recommended read order — lower values should be read first */
  readOrder?: number;
  /** File size in bytes, if available */
  sizeBytes?: number;
}

/** The full manifest document written as manifest.toon. */
export interface Manifest {
  /** Absolute path to the run directory */
  runDir: string;
  /** ISO timestamp when the manifest was generated */
  generatedAt: string;
  /** All discovered artifacts */
  artifacts: ManifestEntry[];
  /** Filenames in recommended reading order (subset of artifacts) */
  recommendedReadOrder: string[];
}

// ---------------------------------------------------------------------------
// Known artifacts
// ---------------------------------------------------------------------------

/** Canonical list of known artifacts with descriptions and suggested read order. */
const KNOWN_ARTIFACTS: ReadonlyArray<{
  filename: string;
  description: string;
  readOrder: number;
}> = [
  {
    filename: 'insights.toon',
    description:
      'Agent-optimized performance summary with Lighthouse scores, LCP breakdown, render-blocking URLs, and top recommendations',
    readOrder: 1,
  },
  {
    filename: 'report.md',
    description:
      'Human-readable performance report in Markdown with score summary, issues, causal chains, and recommendations',
    readOrder: 2,
  },
  {
    filename: 'report.toon',
    description:
      'Full diagnostic report with issues sorted by severity, causal chains, and remediation text',
    readOrder: 3,
  },
  {
    filename: 'manifest.toon',
    description: 'This file — artifact index with descriptions and sizes',
    readOrder: 3,
  },
  {
    filename: 'features.toon',
    description:
      'Raw diagnostic features: LCP breakdown, critical path, TBT, CLS, render-blocking score',
    readOrder: 4,
  },
  {
    filename: 'graph.toon',
    description:
      'Causal degradation graph — DAG of performance issues and their relationships',
    readOrder: 5,
  },
  {
    filename: 'ir.json',
    description:
      'Normalized Intermediate Representation (IRBundle) — all collected data in a validated schema',
    readOrder: 6,
  },
  {
    filename: 'lighthouse.json',
    description:
      'Full Lighthouse v13+ audit results (large — read only for deep dives)',
    readOrder: 7,
  },
  {
    filename: 'network.json',
    description:
      'Raw network request data (large — read only for deep dives)',
    readOrder: 8,
  },
  {
    filename: 'network-summary.toon',
    description:
      'Top 20 requests by duration, blocking list, initiator chain summary',
    readOrder: 9,
  },
  {
    filename: 'lighthouse-summary.toon',
    description:
      'Lighthouse categories and failed insight audits only',
    readOrder: 10,
  },
  {
    filename: 'coverage-summary.toon',
    description: 'Unused bytes by URL, top 10 files',
    readOrder: 11,
  },
  {
    filename: 'trace.json',
    description:
      'Raw Chrome trace events (very large — read only for deep dives)',
    readOrder: 12,
  },
  {
    filename: 'performance.json',
    description: 'Performance API metrics from the page',
    readOrder: 13,
  },
  {
    filename: 'runtime.json',
    description: 'JS heap stats, execution contexts, event loop',
    readOrder: 14,
  },
  {
    filename: 'console.json',
    description: 'Captured console log entries',
    readOrder: 15,
  },
  {
    filename: 'dom.json',
    description: 'DOM snapshot and statistics',
    readOrder: 16,
  },
  {
    filename: 'warnings.json',
    description:
      'Collection warnings (missing data, incomplete traces)',
    readOrder: 17,
  },
  {
    filename: 'runs-summary.json',
    description:
      'Summary across multiple collection runs (only when --runs > 1)',
    readOrder: 18,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a PerfGraph run directory and write a manifest.toon describing all
 * discovered artifacts.
 *
 * Only files listed in the known-artifacts table are included with
 * descriptions and read-order hints; any other JSON / TOON files present in the
 * directory are listed with their filename and size only.
 *
 * The manifest includes itself after writing, so the `manifest.toon` entry
 * always carries the correct size.
 *
 * @param dir - Absolute or relative path to the run directory
 * @returns Absolute path to the written manifest.toon
 */
export async function writeManifest(dir: string): Promise<string> {
  const resolvedDir = resolve(dir);

  // -----------------------------------------------------------------------
  // 1. Scan the directory (exclude manifest.toon since we're about to write it)
  // -----------------------------------------------------------------------
  const dirEntries = await readdir(resolvedDir, { withFileTypes: true });
  const existingFiles = new Set(
    dirEntries
      .filter((e) => e.isFile() && e.name !== 'manifest.toon')
      .map((e) => e.name),
  );

  // -----------------------------------------------------------------------
  // 2. Build artifact entries
  // -----------------------------------------------------------------------
  const artifacts: ManifestEntry[] = [];

  // 2a. Known artifacts that actually exist
  for (const known of KNOWN_ARTIFACTS) {
    if (known.filename === 'manifest.toon') continue; // handled after writing
    if (!existingFiles.has(known.filename)) continue;

    let sizeBytes: number | undefined;
    try {
      const s = await stat(join(resolvedDir, known.filename));
      sizeBytes = s.size;
    } catch {
      // stat failed — skip size
    }

    artifacts.push({
      filename: known.filename,
      description: known.description,
      readOrder: known.readOrder,
      sizeBytes,
    });
  }

  // 2b. Any other JSON / TOON files not in the known list
  for (const filename of existingFiles) {
    if (
      (!filename.endsWith('.json') && !filename.endsWith('.toon')) ||
      KNOWN_ARTIFACTS.some((a) => a.filename === filename)
    ) {
      continue;
    }

    let sizeBytes: number | undefined;
    try {
      const s = await stat(join(resolvedDir, filename));
      sizeBytes = s.size;
    } catch {
      // ignore
    }

    artifacts.push({ filename, description: '', sizeBytes });
  }

  // -----------------------------------------------------------------------
  // 3. Sort — known artifacts by readOrder, unknown artifacts after
  // -----------------------------------------------------------------------
  artifacts.sort((a, b) => {
    const aOrder = a.readOrder ?? 999;
    const bOrder = b.readOrder ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.filename.localeCompare(b.filename);
  });

  const recommendedReadOrder = artifacts
    .filter((a) => a.readOrder !== undefined)
    .sort((a, b) => (a.readOrder ?? 0) - (b.readOrder ?? 0))
    .map((a) => a.filename);

  // -----------------------------------------------------------------------
  // 4. First write (without self-referential manifest.toon entry)
  // -----------------------------------------------------------------------
  const manifestPath = join(resolvedDir, 'manifest.toon');

  await writeFile(
    manifestPath,
    await convertToon({
      runDir: resolvedDir,
      generatedAt: new Date().toISOString(),
      artifacts,
      recommendedReadOrder,
    } satisfies Manifest),
    'utf-8',
  );

  // -----------------------------------------------------------------------
  // 5. Add self-referential entry and re-write with correct size
  // -----------------------------------------------------------------------
  const manifestStat = await stat(manifestPath);

  artifacts.push({
    filename: 'manifest.toon',
    description: 'This file — artifact index with descriptions and sizes',
    readOrder: 3,
    sizeBytes: manifestStat.size,
  });

  // Re-sort with the new entry
  artifacts.sort((a, b) => {
    const aOrder = a.readOrder ?? 999;
    const bOrder = b.readOrder ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.filename.localeCompare(b.filename);
  });

  const updatedReadOrder = artifacts
    .filter((a) => a.readOrder !== undefined)
    .sort((a, b) => (a.readOrder ?? 0) - (b.readOrder ?? 0))
    .map((a) => a.filename);

  await writeFile(
    manifestPath,
    await convertToon({
      runDir: resolvedDir,
      generatedAt: new Date().toISOString(),
      artifacts,
      recommendedReadOrder: updatedReadOrder,
    } satisfies Manifest),
    'utf-8',
  );

  return manifestPath;
}
