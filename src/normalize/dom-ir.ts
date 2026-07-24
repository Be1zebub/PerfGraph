/**
 * DOMIR builder from DOM raw data.
 *
 * Converts CDP DOM snapshot data into a normalized DOMIR structure with
 * stats, tag distribution, and layout shift candidate analysis.
 */

import { DOMIRSchema } from './types.js';
import type { DOMIR, DOMStats, TagCount, LayoutShiftCandidates } from './types.js';
import type { DomRawData } from '../collect/types.js';

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a complete DOMIR from DOM raw data.
 *
 * @param dom - Raw DOM data from the DOMCollector
 * @returns A fully-constructed DOMIR
 */
export function buildDOMIR(dom: DomRawData): DOMIR {
  // 1. Stats: pass through totalNodes, elementCount, maxDepth
  //    maxChildren is derived from elementDistribution values (max count)
  const elementCounts = Object.values(dom.elementDistribution);
  const maxChildren = elementCounts.length > 0
    ? Math.max(...elementCounts)
    : 0;

  const stats: DOMStats = {
    totalNodes: dom.stats.totalNodes,
    elementCount: dom.stats.elementCount,
    maxDepth: dom.stats.maxDepth,
    maxChildren,
  };

  // 2. Tag distribution: convert Record<string, number> → TagCount[]
  const tagDistribution: TagCount[] = Object.entries(dom.elementDistribution).map(
    ([tag, count]) => ({ tag, count }),
  );

  // 3. Layout shift candidates
  const highComplexitySubtrees = maxChildren >= 50
    ? elementCounts.filter((count) => count > maxChildren / 2).length
    : 0;
  const deepNesting = dom.stats.maxDepth >= 15 ? 1 : 0;

  const layoutShiftCandidates: LayoutShiftCandidates = {
    highComplexitySubtrees,
    deepNesting,
  };

  const result: DOMIR = {
    stats,
    tagDistribution,
    layoutShiftCandidates,
  };

  return result;
}
