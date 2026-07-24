/**
 * Layout / DOM causal rules.
 *
 * Chains covered:
 *   1. Layout shift clusters → high CLS
 *   2. Complex DOM (deep nesting, many nodes) → layout instability → CLS
 *
 * @packageDocumentation
 */

import type { FeatureSet } from '../../extract/types.js';
import type { Confidence, CausalNode, CausalEdge, Evidence } from '../types.js';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const CLS_WARN = 0.1;
const CLS_CRIT = 0.25;
const CLUSTER_SCORE_WARN = 0.3;
const HIGHLY_COMPLEX_DOM = 5; // highComplexitySubtreeCount >= 5

// ---------------------------------------------------------------------------
// Rule 1: Layout shift clusters → CLS
// ---------------------------------------------------------------------------

export const layoutShiftClusterChain = {
  id: 'layout-shift-cluster-chain',
  label: 'Layout shift clusters → high CLS',

  applies(features: FeatureSet): boolean {
    const ls = features.layoutShifts;
    return ls != null && (ls.cls != null || ls.clusterScore > CLUSTER_SCORE_WARN);
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const ls = features.layoutShifts!;

    // If CLS is defined and below the warning threshold, suppress noise
    if (ls.cls != null && ls.cls < CLS_WARN) {
      if (ls.clusterScore < 0.5) {
        return { nodes: [], edges: [] }; // Skip entirely when cluster is not significant
      }
      // clusterScore >= 0.5 but CLS good — single weak info node
      return {
        nodes: [{
          id: 'cls-minor',
          label: `Layout shifts detected (CLS: ${ls.cls.toFixed(3)}) — within normal threshold`,
          type: 'metric',
          severity: 'info' as const,
          value: ls.cls,
          threshold: CLS_WARN,
        }],
        edges: [],
      };
    }

    const clsValue = ls.cls ?? 0;
    const isPoor = clsValue >= CLS_CRIT || ls.clusterScore > 0.6;
    const conf: Confidence = clsValue >= CLS_CRIT ? 'strong' : clsValue >= CLS_WARN ? 'medium' : 'weak';

    const clsEvidence: Evidence | undefined = ls.cls != null
      ? { metric: { name: 'CLS', value: ls.cls, unit: 'score' } }
      : undefined;

    const nodes: CausalNode[] = [
      {
        id: 'layout-shifts',
        label: ls.cls != null ? `Layout shifts (CLS: ${clsValue.toFixed(2)})` : 'Layout shifts detected',
        type: 'metric',
        severity: isPoor ? 'critical' : clsValue >= CLS_WARN ? 'warning' : 'info',
        value: clsValue,
        threshold: CLS_WARN,
        evidence: clsEvidence,
      },
    ];

    const edges: CausalEdge[] = [];

    // If clusterScore is high, add intermediate bottleneck
    if (ls.clusterScore > CLUSTER_SCORE_WARN) {
      nodes.push({
        id: 'layout-shift-clusters',
        label: `Layout shift clusters (score: ${ls.clusterScore.toFixed(2)})`,
        type: 'bottleneck',
        severity: ls.clusterScore > 0.6 ? 'critical' : 'warning',
        value: ls.clusterScore,
        threshold: CLUSTER_SCORE_WARN,
      });

      edges.push({
        source: 'layout-shifts',
        target: 'layout-shift-clusters',
        confidence: 'medium',
        label: 'Shifts cluster together, compounding the problem',
        ruleId: 'layout-shift-cluster-chain',
      });
    }

    nodes.push({
      id: 'high-cls',
      label: 'High Cumulative Layout Shift',
      type: 'impact',
      severity: isPoor ? 'critical' : clsValue >= CLS_WARN ? 'warning' : 'info',
      value: clsValue,
      threshold: CLS_WARN,
    });

    const sourceNode = ls.clusterScore > CLUSTER_SCORE_WARN ? 'layout-shift-clusters' : 'layout-shifts';
    edges.push({
      source: sourceNode,
      target: 'high-cls',
      confidence: conf,
      label: 'Accumulated layout shifts degrade page stability',
      ruleId: 'layout-shift-cluster-chain',
    });

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Rule 2: Complex DOM → layout instability
// ---------------------------------------------------------------------------

export const complexDomChain = {
  id: 'layout-complex-dom-chain',
  label: 'Complex DOM → layout instability → CLS',

  applies(features: FeatureSet): boolean {
    return features.layoutShifts?.highComplexitySubtreeCount != null
      && features.layoutShifts.highComplexitySubtreeCount >= HIGHLY_COMPLEX_DOM;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const ls = features.layoutShifts!;
    const isDeep = ls.deepNesting;
    const conf: Confidence = isDeep ? 'strong' : 'medium';

    const nodes: CausalNode[] = [
      {
        id: 'complex-dom-tree',
        label: `${ls.highComplexitySubtreeCount} complex DOM subtrees`,
        type: 'metric',
        severity: isDeep ? 'warning' : 'info',
        value: ls.highComplexitySubtreeCount,
        threshold: HIGHLY_COMPLEX_DOM,
      },
      {
        id: 'layout-instability',
        label: 'Layout instability',
        type: 'bottleneck',
        severity: isDeep ? 'warning' : 'info',
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'complex-dom-tree',
        target: 'layout-instability',
        confidence: conf,
        label: 'Complex DOM structure increases likelihood of shifts',
        ruleId: 'layout-complex-dom-chain',
      },
    ];

    // Connect to CLS impact if there's a CLS value
    if (ls.cls != null) {
      nodes.push({
        id: 'high-cls-dom',
        label: 'High Cumulative Layout Shift',
        type: 'impact',
        severity: 'warning',
        value: ls.cls,
        threshold: CLS_WARN,
      });
      edges.push({
        source: 'layout-instability',
        target: 'high-cls-dom',
        confidence: 'weak',
        label: 'Layout instability may lead to CLS',
        ruleId: 'layout-complex-dom-chain',
      });
    }

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Aggregated
// ---------------------------------------------------------------------------

export const layoutRules = [
  layoutShiftClusterChain,
  complexDomChain,
];
