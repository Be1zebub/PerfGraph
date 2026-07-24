/**
 * Report scoring — compute overall performance score from CausalGraph.
 *
 * The score is a simple heuristic based on severity distribution:
 *   - Any critical nodes → "poor"
 *   - Any warning nodes  → "moderate"
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
 * Compute overall performance score from a CausalGraph.
 *
 * When `lighthousePerformance` is provided the score may be promoted:
 *   - Lighthouse >= 0.9 and no genuine regression → "good"
 *   - Lighthouse >= 0.7, criticalCount <= 1, no genuine regression → "moderate"
 *   - Otherwise the heuristic score is returned unchanged.
 *
 * @param graph - The causal graph to evaluate
 * @param lighthousePerformance - Optional Lighthouse performance score (0–1)
 * @returns A string score when called without lighthouse data; otherwise
 *          either a string or an object with `score` and optional `explanation`.
 */
export function computeScore(graph: CausalGraph): ReportScore;
export function computeScore(
  graph: CausalGraph,
  lighthousePerformance?: number,
): ReportScore | { score: ReportScore; explanation?: string };
export function computeScore(
  graph: CausalGraph,
  lighthousePerformance?: number,
): ReportScore | { score: ReportScore; explanation?: string } {
  let criticalCount = 0;
  let warningCount = 0;

  for (const node of graph.nodes) {
    if (node.severity === 'critical') {
      criticalCount++;
    }
    if (node.severity === 'warning') {
      warningCount++;
    }
  }

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

  // Fallback heuristic (unchanged from original)
  if (criticalCount > 0) return 'poor';
  if (warningCount > 0) return 'moderate';
  return 'good';
}
