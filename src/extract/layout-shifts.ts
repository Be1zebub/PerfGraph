/**
 * Layout Shifts extractor.
 *
 * Computes layout instability metrics from DOM IR layout shift candidates
 * and the CLS value from Core Web Vitals.
 *
 * clusterScore — композитная оценка 0-1, основанная на CLS и
 * структурных признаках нестабильности layout (сложные поддеревья,
 * глубокое вложение).
 */

import type { IRBundle } from '../normalize/types.js';
import type { LayoutShifts } from './types.js';

/** Categories that contribute to layout shift risk when over-represented. */
const HIGH_RISK_TAGS = new Set(['img', 'video', 'iframe', 'canvas', 'svg']);

/**
 * Extract layout shift metrics from an IRBundle.
 *
 * Never returns undefined — defaults to zero when DOM/Layout data is absent.
 */
export function extractLayoutShifts(ir: IRBundle): LayoutShifts {
  const { layoutShiftCandidates } = ir.dom;
  const cls = ir.performance.coreWebVitals.cls;

  const highComplexitySubtreeCount = layoutShiftCandidates?.highComplexitySubtrees ?? 0;
  const deepNesting = (layoutShiftCandidates?.deepNesting ?? 0) > 0;

  // clusterScore: heuristic weighted score combining CLS and structural risk
  const clsScore = cls !== undefined && Number.isFinite(cls) ? Math.min(1, cls * 50) : 0;
  const complexityScore = Math.min(1, highComplexitySubtreeCount / 10);
  const nestingScore = deepNesting ? 0.3 : 0;

  // Tag risk: look at tag distribution — too many img/video/iframe in small DOM
  let tagRisk = 0;
  const tags = ir.dom.tagDistribution;
  if (tags.length > 0) {
    const totalTags = tags.reduce((sum, t) => sum + t.count, 0);
    if (totalTags > 0) {
      const highRiskCount = tags
        .filter((t) => HIGH_RISK_TAGS.has(t.tag))
        .reduce((sum, t) => sum + t.count, 0);
      tagRisk = Math.min(1, highRiskCount / totalTags);
    }
  }

  const clusterScore = Math.min(1, clsScore * 0.5 + complexityScore * 0.25 + nestingScore * 0.15 + tagRisk * 0.1);

  return {
    cls: cls !== undefined && Number.isFinite(cls) ? cls : undefined,
    highComplexitySubtreeCount,
    deepNesting,
    clusterScore,
  };
}
