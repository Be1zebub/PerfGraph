/**
 * Scorer unit tests.
 *
 * Tests cover:
 * - Empty graph → "good"
 * - Lighthouse override behavior (≥0.9, ≥0.7)
 * - Genuine regression detection (LCP > 4s, TBT > 600ms)
 * - Backward compatibility (no lighthouse data → unchanged behavior)
 * - Warning-only graphs → "moderate"
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import { computeScore } from '../../src/report/scorer.js';
import type { CausalGraph } from '../../src/causal/types.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function emptyGraph(): CausalGraph {
  return { nodes: [], edges: [], metadata: { totalRules: 0, firedRules: 0 } };
}

function graphWithCriticals(
  count: number,
  extra?: Partial<CausalGraph['nodes'][0]>,
): CausalGraph {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `c-${i}`,
    label: `Critical ${i}`,
    severity: 'critical' as const,
    confidence: 'strong' as const,
    ...extra,
  }));
  return {
    nodes,
    edges: [],
    metadata: { totalRules: count, firedRules: count },
  };
}

function graphWithWarnings(count: number): CausalGraph {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `w-${i}`,
    label: `Warning ${i}`,
    severity: 'warning' as const,
    confidence: 'medium' as const,
  }));
  return {
    nodes,
    edges: [],
    metadata: { totalRules: count, firedRules: count },
  };
}

function metricNode(
  id: string,
  value: number,
  unit?: string,
): CausalGraph['nodes'][0] {
  return {
    id,
    label: id,
    type: 'metric',
    severity: 'critical',
    value,
    unit,
  };
}

function impactNode(
  id: string,
  value: number,
  unit?: string,
): CausalGraph['nodes'][0] {
  return {
    id,
    label: id,
    type: 'impact',
    severity: 'critical',
    value,
    unit,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeScore (backward compat — no lighthouse data)', () => {
  it('returns "good" for empty graph', () => {
    expect(computeScore(emptyGraph())).toBe('good');
  });

  it('returns "poor" when critical nodes exist', () => {
    expect(computeScore(graphWithCriticals(1))).toBe('poor');
  });

  it('returns "moderate" when only warnings exist', () => {
    expect(computeScore(graphWithWarnings(1))).toBe('moderate');
  });

  it('returns "good" when only info nodes exist', () => {
    const graph: CausalGraph = {
      nodes: [
        {
          id: 'info-node',
          label: 'Info',
          type: 'metric',
          severity: undefined,
        },
      ],
      edges: [],
      metadata: { totalRules: 1, firedRules: 0 },
    };
    expect(computeScore(graph)).toBe('good');
  });
});

describe('computeScore with lighthouse data', () => {
  it('returns { score: "good" } when lighthouse >= 0.9 with minor criticals', () => {
    const result = computeScore(graphWithCriticals(1), 0.91);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.score).toBe('good');
      expect(result.explanation).toBeTruthy();
    }
  });

  it('returns { score: "good" } when lighthouse >= 0.9 with multiple criticals', () => {
    const result = computeScore(graphWithCriticals(3), 0.94);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.score).toBe('good');
    }
  });

  it('returns { score: "moderate" } when lighthouse >= 0.7 with <= 1 criticals', () => {
    const result = computeScore(graphWithCriticals(1), 0.75);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.score).toBe('moderate');
      expect(result.explanation).toBeTruthy();
    }
  });

  it('returns "poor" when lighthouse >= 0.7 but criticalCount > 1', () => {
    // 2 criticals + lighthouse 0.75 → rule #4 fails (criticalCount <= 1)
    const result = computeScore(graphWithCriticals(2), 0.75);
    // Falls through to fallback: criticalCount > 0 → 'poor'
    expect(result).toBe('poor');
  });

  it('returns "poor" when lighthouse >= 0.7 but has genuine LCP regression', () => {
    const graph = graphWithCriticals(1, {
      type: 'impact',
      value: 4320,
      unit: 'ms',
    });
    const result = computeScore(graph, 0.91);
    expect(result).toBe('poor');
  });

  it('returns "poor" when lighthouse >= 0.7 but has genuine TTFB regression', () => {
    const graph = graphWithCriticals(1, {
      type: 'metric',
      value: 3000,
      unit: 'ms',
    });
    const result = computeScore(graph, 0.91);
    expect(result).toBe('poor');
  });

  it('returns "poor" when lighthouse is low (< 0.7)', () => {
    const graph = graphWithCriticals(1);
    const result = computeScore(graph, 0.5);
    expect(result).toBe('poor');
  });

  it('returns "poor" when lighthouse is moderate (0.75) but has 2+ criticals', () => {
    const graph = graphWithCriticals(2);
    const result = computeScore(graph, 0.75);
    expect(result).toBe('poor');
  });
});

describe('computeScore genuine regression detection', () => {
  it('detects LCP > 4000ms as genuine regression', () => {
    const graph: CausalGraph = {
      nodes: [metricNode('increased-lcp', 4320, 'ms')],
      edges: [],
      metadata: { totalRules: 1, firedRules: 1 },
    };
    const result = computeScore(graph, 0.94);
    // lighthouse >= 0.9 but genuine regression → fallback → 'poor'
    expect(result).toBe('poor');
  });

  it('detects TTFB > 2500ms as genuine regression', () => {
    const graph: CausalGraph = {
      nodes: [metricNode('high-ttfb', 3000, 'ms')],
      edges: [],
      metadata: { totalRules: 1, firedRules: 1 },
    };
    const result = computeScore(graph, 0.91);
    expect(result).toBe('poor');
  });

  it('does not treat low request count as genuine regression', () => {
    const graph: CausalGraph = {
      nodes: [metricNode('rb-resources', 5, 'requests')],
      edges: [],
      metadata: { totalRules: 1, firedRules: 1 },
    };
    // 5 requests is a rule trigger, not a genuine catastrophic metric
    const result = computeScore(graph, 0.91);
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.score).toBe('good');
    }
  });

  it('detects impact node with value > 4000 as genuine regression', () => {
    const graph: CausalGraph = {
      nodes: [impactNode('increased-lcp-rb', 4200, 'ms')],
      edges: [],
      metadata: { totalRules: 1, firedRules: 1 },
    };
    const result = computeScore(graph, 0.94);
    expect(result).toBe('poor');
  });
});
