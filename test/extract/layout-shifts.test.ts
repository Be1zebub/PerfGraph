/**
 * Layout Shifts extractor tests.
 */

import { describe, it, expect } from 'vitest';
import { extractLayoutShifts } from '../../src/extract/layout-shifts.js';
import type { IRBundle } from '../../src/normalize/types.js';

function makeIRBundle(overrides?: Partial<IRBundle>): IRBundle {
  return {
    meta: { url: 'https://example.com', fetchedAt: '2025-01-01T00:00:00Z', navigationStart: 0, irVersion: '1.0.0' },
    performance: {
      navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
      coreWebVitals: {},
      traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 2000, byCategory: {} } },
      mainThreadBusyness: 0.4,
    },
    network: { requests: [], summary: { totalRequests: 0, totalBytes: 0, byType: {}, byPriority: {}, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } } },
    runtime: { executionContexts: [] },
    dom: {
      stats: { totalNodes: 100, elementCount: 50, maxDepth: 0, maxChildren: 0 },
      tagDistribution: [],
      layoutShiftCandidates: { highComplexitySubtrees: 0, deepNesting: false },
    },
    lighthouse: { categories: {}, failedAudits: [], scores: {} },
    ...overrides,
  };
}

describe('extractLayoutShifts', () => {
  it('returns zeroed values when no layout shift data', () => {
    const ir = makeIRBundle();
    const result = extractLayoutShifts(ir);
    expect(result.cls).toBeUndefined();
    expect(result.highComplexitySubtreeCount).toBe(0);
    expect(result.deepNesting).toBe(false);
    expect(result.clusterScore).toBe(0);
  });

  it('computes cluster score from CLS', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { cls: 0.15 },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 2000, byCategory: {} } },
        mainThreadBusyness: 0.4,
      },
    });
    const result = extractLayoutShifts(ir);
    expect(result.cls).toBe(0.15);
    // clsScore = min(1, 0.15 * 50) = 1, clusterScore = 1 * 0.5 = 0.5
    expect(result.clusterScore).toBeGreaterThan(0);
  });

  it('incorporates layoutShiftCandidates into clusterScore', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { cls: 0.05 },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 2000, byCategory: {} } },
        mainThreadBusyness: 0.4,
      },
      dom: {
        stats: { totalNodes: 200, elementCount: 80, maxDepth: 18, maxChildren: 12 },
        tagDistribution: [
          { tag: 'div', count: 30 },
          { tag: 'img', count: 15 },
          { tag: 'span', count: 20 },
          { tag: 'p', count: 15 },
        ],
        layoutShiftCandidates: { highComplexitySubtrees: 5, deepNesting: 1 },
      },
    });
    const result = extractLayoutShifts(ir);
    expect(result.cls).toBe(0.05);
    expect(result.highComplexitySubtreeCount).toBe(5);
    expect(result.deepNesting).toBe(true);
    // clsScore = 0.05 * 50 = 2.5 → clamped to 1
    // complexityScore = 5/10 = 0.5
    // nestingScore = 0.3
    // tagRisk = 15/(30+15+20+15) = 15/80 = 0.1875
    // clusterScore = 1*0.5 + 0.5*0.25 + 0.3*0.15 + 0.1875*0.1 = 0.5 + 0.125 + 0.045 + 0.01875 = 0.68875
    expect(result.clusterScore).toBeCloseTo(0.68875, 5);
  });

  it('handles NaN CLS gracefully', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { cls: NaN },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 2000, byCategory: {} } },
        mainThreadBusyness: 0.4,
      },
    });
    const result = extractLayoutShifts(ir);
    expect(result.cls).toBeUndefined();
    expect(result.clusterScore).toBe(0);
  });

  it('calculates tag risk from tagDistribution', () => {
    const ir = makeIRBundle({
      dom: {
        stats: { totalNodes: 100, elementCount: 50, maxDepth: 8, maxChildren: 5 },
        tagDistribution: [
          { tag: 'img', count: 20 },
          { tag: 'video', count: 5 },
          { tag: 'div', count: 25 },
        ],
        layoutShiftCandidates: { highComplexitySubtrees: 0, deepNesting: false },
      },
    });
    const result = extractLayoutShifts(ir);
    // highRisk = img(20) + video(5) = 25, total = 50, tagRisk = 25/50 = 0.5
    // clusterScore = 0*0.5 + 0*0.25 + 0*0.15 + 0.5*0.1 = 0.05
    expect(result.clusterScore).toBe(0.05);
  });
});
