/**
 * Compact summary builders for large raw data files.
 *
 * Each function takes a raw data structure (network.json, lighthouse.json,
 * coverage.json) and returns a small summary object that can be written
 * as a companion file (~1-5 KB) for agent consumption.
 *
 * @packageDocumentation
 */

import type {
  NetworkRawData,
  LighthouseRawData,
  CoverageRawData,
  CoverageRange,
} from '../collect/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetworkSummary {
  totalRequests: number;
  totalBytes: number;
  topRequestsByDuration: Array<{
    url: string;
    duration: number;
    resourceType: string;
    bytes: number;
  }>;
  blockingResources: Array<{ url: string; resourceType: string }>;
  initiatorChains: Array<{ url: string; depth: number }>;
}

export interface LighthouseSummary {
  categories: Record<string, number>;
  failedInsightAudits: Array<{ id: string; title: string; score: number }>;
}

export interface CoverageSummary {
  unusedBytesByUrl: Array<{
    url: string;
    totalBytes: number;
    unusedBytes: number;
    unusedPercentage: number;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge overlapping CoverageRange[] so that intersecting spans are
 * counted once. Returns a new sorted, non-overlapping array.
 */
function mergeRanges(ranges: CoverageRange[]): CoverageRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.startOffset - b.startOffset);
  const merged: CoverageRange[] = [{ ...sorted[0]! }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]!;
    const current = sorted[i]!;

    if (current.startOffset <= last.endOffset) {
      // Extend last range if current ends further
      if (current.endOffset > last.endOffset) {
        last.endOffset = current.endOffset;
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Summary builders
// ---------------------------------------------------------------------------

/**
 * Build a compact summary of network request data.
 *
 * @param network - Raw network data from NetworkCollector
 * @returns A compact NetworkSummary (~1-3 KB)
 */
export function buildNetworkSummary(network: NetworkRawData): NetworkSummary {
  const requests = network.requests ?? [];

  // Sort by response receive time descending (longest first)
  const sorted = [...requests].sort((a, b) => {
    const durA = a.response?.timing?.receiveHeadersEnd ?? 0;
    const durB = b.response?.timing?.receiveHeadersEnd ?? 0;
    return durB - durA;
  });

  return {
    totalRequests: requests.length,
    totalBytes: requests.reduce(
      (s, r) => s + (r.response?.encodedDataLength ?? 0),
      0,
    ),
    topRequestsByDuration: sorted.slice(0, 20).map((r) => ({
      url: r.url,
      duration: r.response?.timing?.receiveHeadersEnd ?? 0,
      resourceType: r.type ?? 'unknown',
      bytes: r.response?.encodedDataLength ?? 0,
    })),
    blockingResources: requests
      .filter(
        (r) => r.type === 'Stylesheet' || r.type === 'Script',
      )
      .map((r) => ({
        url: r.url,
        resourceType: r.type ?? 'unknown',
      })),
    initiatorChains: [], // Placeholder — real initiator chain data from IR
  };
}

/**
 * Build a compact summary of Lighthouse audit results.
 *
 * @param lighthouse - Raw Lighthouse data from LighthouseCollector
 * @returns A compact LighthouseSummary (~1-2 KB)
 */
export function buildLighthouseSummary(
  lighthouse: LighthouseRawData,
): LighthouseSummary {
  const lhr = isRecord(lighthouse.lhr) ? lighthouse.lhr : {};

  // Extract category scores
  const categories: Record<string, number> = {};
  const catObj = isRecord(lhr.categories) ? lhr.categories : {};
  for (const [id, cat] of Object.entries(catObj)) {
    if (isRecord(cat) && typeof cat.score === 'number') {
      categories[id] = cat.score;
    }
  }

  // Extract failed insight audits (score < 0.5)
  const failedInsightAudits: LighthouseSummary['failedInsightAudits'] = [];
  const auditsObj = isRecord(lhr.audits) ? lhr.audits : {};
  for (const [id, audit] of Object.entries(auditsObj)) {
    if (
      isRecord(audit) &&
      typeof audit.score === 'number' &&
      audit.score < 0.5
    ) {
      failedInsightAudits.push({
        id,
        title: typeof audit.title === 'string' ? audit.title : id,
        score: audit.score,
      });
    }
  }

  return { categories, failedInsightAudits };
}

/**
 * Build a compact summary of JS/CSS code coverage data.
 *
 * Coverage data from CDP does not include the full script source, so
 * `totalBytes` is approximated as the maximum `endOffset` across all
 * coverage ranges. This gives a lower-bound estimate of the script size;
 * truly uncovered code that falls outside any range is not counted.
 *
 * @param coverage - Raw coverage data from CoverageCollector
 * @returns A compact CoverageSummary (~1-3 KB)
 */
export function buildCoverageSummary(
  coverage: CoverageRawData,
): CoverageSummary {
  const entries: CoverageSummary['unusedBytesByUrl'] = [];

  // ---- JS scripts ----
  for (const script of coverage.js ?? []) {
    const allRanges: CoverageRange[] = [];
    for (const fn of script.functions ?? []) {
      for (const range of fn.ranges ?? []) {
        allRanges.push(range);
      }
    }

    if (allRanges.length === 0) continue;

    const merged = mergeRanges(allRanges);
    const totalBytes = merged[merged.length - 1]!.endOffset;
    const usedBytes = merged.reduce(
      (sum, r) => sum + (r.endOffset - r.startOffset),
      0,
    );
    const unusedBytes = Math.max(0, totalBytes - usedBytes);

    entries.push({
      url: script.url || '(inline)',
      totalBytes,
      unusedBytes,
      unusedPercentage:
        totalBytes > 0
          ? Math.round((unusedBytes / totalBytes) * 100)
          : 0,
    });
  }

  // ---- CSS stylesheets ----
  for (const sheet of coverage.css ?? []) {
    const ranges = sheet.ranges ?? [];
    if (ranges.length === 0) continue;

    const merged = mergeRanges(ranges);
    const totalBytes = merged[merged.length - 1]!.endOffset;
    const usedBytes = merged.reduce(
      (sum, r) => sum + (r.endOffset - r.startOffset),
      0,
    );
    const unusedBytes = Math.max(0, totalBytes - usedBytes);

    entries.push({
      url: sheet.url || '(inline)',
      totalBytes,
      unusedBytes,
      unusedPercentage:
        totalBytes > 0
          ? Math.round((unusedBytes / totalBytes) * 100)
          : 0,
    });
  }

  // Sort by unused bytes descending, take top 10
  entries.sort((a, b) => b.unusedBytes - a.unusedBytes);

  return { unusedBytesByUrl: entries.slice(0, 10) };
}
