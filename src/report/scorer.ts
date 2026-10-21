/**
 * Report scoring — compute overall performance score from CausalGraph.
 *
 * The score is a simple heuristic based on severity distribution:
 *   - Any critical nodes → "poor"
 *   - Actionable warning nodes → "moderate"
 *   - Info only / empty  → "good"
 *
 * Optionally accepts a Lighthouse performance score to override the
 * heuristic when Lighthouse indicates acceptable performance despite
 * causal-rule triggers (e.g., 2 small render-blocking stylesheets).
 *
 * @packageDocumentation
 */

import type { CausalGraph, CausalNode } from '../causal/types.js';
import type { ReportScore } from './types.js';

/**
 * Check whether a node represents a genuinely bad performance regression,
 * as opposed to a rule-triggered flag. Used to decide whether Lighthouse
 * data should override the heuristic score.
 *
 * A genuine regression is:
 *   - Any node (metric or impact) with a value > 4000 (e.g. LCP > 4 s)
 *   - Any ms-valued node with a value > 2500 (e.g. TTFB > 2.5 s)
 */
function isGenuineRegression(node: CausalNode): boolean {
  if (node.value == null) return false;

  // Any value above 4000 is a clear regression regardless of semantics
  if (node.value > 4000) return true;

  // ms-valued metrics above 2500 are "poor" by Google thresholds
  if (node.unit === 'ms' && node.value > 2500) return true;

  return false;
}

function hasGenuineRegression(nodes: CausalNode[]): boolean {
  return nodes.some(isGenuineRegression);
}

/**
 * Borderline TTFB is useful diagnostic context, but by itself is not enough to
 * classify a page as moderately degraded. Other warning nodes remain
 * actionable unless their rule explicitly defines them as informational.
 */
function isActionableWarning(node: CausalNode): boolean {
  if (node.basis === 'inferred') return false;
  return !(node.id === 'high-ttfb' && node.value != null && node.value < 2500);
}

/**
 * Compute overall performance score from a CausalGraph.
 *
 * When `lighthousePerformance` is provided the score may be promoted:
 *   - Lighthouse >= 0.9 and no genuine regression → "good"
 *   - Lighthouse >= 0.7, criticalCount <= 1, no genuine regression → "moderate"
 *   - Otherwise the heuristic score is returned unchanged.
 *
 * @param graph - The causal graph to evaluate
 * @param lighthousePerformance - Optional Lighthouse performance score (0–1)
 * @returns The score and a short explanation of how it was reached
 */
export function computeScore(
  graph: CausalGraph,
  lighthousePerformance?: number,
): { score: ReportScore; explanation?: string } {
  // The impact node of a chain restates the consequence of the finding above
  // it. Counting it would let one finding justify a worse verdict twice — a
  // single Lighthouse audit on one asset was enough to turn a page with green
  // Core Web Vitals into "poor". An impact only counts when nothing else in
  // the graph carries the finding.
  const criticalFindings = graph.nodes.filter(
    (node) => node.severity === 'critical' && node.type !== 'impact',
  );
  const criticalImpacts = graph.nodes.filter(
    (node) => node.severity === 'critical' && node.type === 'impact',
  );
  const criticalCount =
    criticalFindings.length > 0 ? criticalFindings.length : criticalImpacts.length;

  // When Lighthouse data is available, consider overriding the heuristic
  if (lighthousePerformance !== undefined) {
    const genuineRegression = hasGenuineRegression(graph.nodes);

    if (lighthousePerformance >= 0.9 && !genuineRegression) {
      return {
        score: 'good',
        explanation:
          'Lighthouse performance >= 0.9, no genuine regressions detected',
      };
    }

    if (lighthousePerformance >= 0.7 && criticalCount <= 1 && !genuineRegression) {
      return {
        score: 'moderate',
        explanation:
          'Lighthouse performance >= 0.7, minimal critical issues, no genuine regressions',
      };
    }
  }

  // Fallback heuristic: ignore borderline TTFB-only observations.
  if (criticalCount > 0) {
    return {
      score: 'poor',
      explanation: `${criticalCount} critical finding(s) in the causal graph`,
    };
  }
  if (graph.nodes.some((node) => node.severity === 'warning' && isActionableWarning(node))) {
    return {
      score: 'moderate',
      explanation: 'Actionable warnings in the causal graph, no critical findings',
    };
  }
  return {
    score: 'good',
    explanation: 'No critical or actionable findings in the causal graph',
  };
}
