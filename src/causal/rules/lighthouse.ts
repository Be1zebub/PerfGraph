/**
 * Causal rules for the findings Lighthouse measured.
 *
 * These are the costs a trace cannot produce: a forced reflow, images that
 * could be smaller, bytes that could be cached. The value is measured — by
 * Lighthouse, in its own run — so the finding is an observation, and the
 * report has to say which run it came from.
 *
 * @packageDocumentation
 */

import type { FeatureSet } from '../../extract/types.js';
import type { Confidence, CausalNode, CausalEdge, Evidence } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render a value in the unit of the finding. */
function formatValue(value: number, unit: 'ms' | 'bytes' | 'count' | 'score'): string {
  if (unit === 'bytes') {
    return value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)} MB`
      : `${Math.round(value / 1000)} kB`;
  }
  if (unit === 'ms') return `${Math.round(value)} ms`;
  if (unit === 'score') return value.toFixed(3);
  return String(Math.round(value));
}

/** The severity of a finding, from its own thresholds. */
function severityOf(value: number, warnAt: number, critAt: number): 'critical' | 'warning' | 'info' {
  if (value >= critAt) return 'critical';
  if (value >= warnAt) return 'warning';
  return 'info';
}

// ---------------------------------------------------------------------------
// Rule: Lighthouse finding → measured cost
// ---------------------------------------------------------------------------

export const lighthouseFindingsChain = {
  id: 'lh-finding-chain',
  label: 'Lighthouse finding → measured cost on the critical path',

  applies(features: FeatureSet): boolean {
    const findings = features.lighthouseFindings;
    return findings != null && findings.length > 0;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const findings = features.lighthouseFindings ?? [];
    const nodes: CausalNode[] = [];
    const edges: CausalEdge[] = [];

    for (const finding of findings) {
      const severity = severityOf(finding.value, finding.warnAt, finding.critAt);
      if (severity === 'info') continue;

      const evidence: Evidence = {
        urls: finding.sources,
        metric: {
          name: finding.title,
          value: finding.value,
          unit: finding.unit,
          source: 'lighthouse',
          method: `Lighthouse ${finding.id} audit`,
        },
      };

      const nodeId = `lh-${finding.id}`;
      const impactId = `lh-impact-${finding.id}`;

      nodes.push({
        id: nodeId,
        label: `${finding.title}: ${formatValue(finding.value, finding.unit)}`,
        type: 'metric',
        severity,
        value: finding.value,
        unit: finding.unit,
        threshold: finding.warnAt,
        impactSurface: 'total-page',
        evidence,
        basis: 'observed',
        findingStatus: 'verified',
      });

      nodes.push({
        id: impactId,
        label: `${formatValue(finding.value, finding.unit)} of avoidable work`,
        type: 'impact',
        severity,
        impactSurface: 'total-page',
        basis: 'inferred',
        findingStatus: 'suspected',
      });

      edges.push({
        source: nodeId,
        target: impactId,
        confidence: 'strong' as Confidence,
        label: 'The measured cost is avoidable work on the page',
        ruleId: 'lh-finding-chain',
        evidence,
      });
    }

    return { nodes, edges };
  },
};
