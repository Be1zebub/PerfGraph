/**
 * Main Thread Blocking Score extractor tests.
 */

import { describe, it, expect } from 'vitest';
import { extractMainThreadBlocking } from '../../src/extract/main-thread.js';
import type { IRBundle } from '../../src/normalize/types.js';

function makeIRBundle(overrides?: Partial<IRBundle>): IRBundle {
  return {
    meta: { url: 'https://example.com', fetchedAt: '2025-01-01T00:00:00Z', navigationStart: 0, irVersion: '1.0.0' },
    performance: {
      navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
      coreWebVitals: {},
      traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 3000, byCategory: { loading: 1500, script: 1000, other: 500 } } },
      mainThreadBusyness: 0.6,
    },
    network: { requests: [], summary: { totalRequests: 0, totalBytes: 0, byType: {}, byPriority: {}, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } } },
    runtime: { executionContexts: [] },
    dom: { stats: { totalNodes: 0, elementCount: 0, maxDepth: 0, maxChildren: 0 }, tagDistribution: [], layoutShiftCandidates: { highComplexitySubtrees: 0, deepNesting: 0 } },
    lighthouse: { categories: {}, failedAudits: [], scores: {} },
    ...overrides,
  };
}

describe('extractMainThreadBlocking', () => {
  it('computes blocking score from thread activity', () => {
    const ir = makeIRBundle();
    const result = extractMainThreadBlocking(ir);
    expect(result).toBeDefined();
    // busyMs = 3000, idleMs = 5000 - 3000 = 2000
    expect(result!.busyMs).toBe(3000);
    expect(result!.idleMs).toBe(2000);
    // blockingRatio = 3000/5000 = 0.6
    expect(result!.blockingRatio).toBe(0.6);
    // blockingScore = avg(mainThreadBusyness=0.6, blockingRatio=0.6) = 0.6
    expect(result!.blockingScore).toBeCloseTo(0.6, 5);
    expect(result!.categories).toEqual({ loading: 1500, script: 1000, other: 500 });
  });

  it('returns undefined when totalDuration is 0', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 0, domContentLoadedEventEnd: 0, loadEventStart: 0, loadEventEnd: 0, domInteractive: 0 },
        coreWebVitals: {},
        traceSummary: { totalDuration: 0, eventCount: 0, categories: {}, threadActivity: { totalMs: 0, byCategory: {} } },
        mainThreadBusyness: 0,
      },
    });
    const result = extractMainThreadBlocking(ir);
    expect(result).toBeUndefined();
  });

  it('handles fully idle main thread', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 100, domContentLoadedEventEnd: 150, loadEventStart: 200, loadEventEnd: 250, domInteractive: 80 },
        coreWebVitals: {},
        traceSummary: { totalDuration: 1000, eventCount: 10, categories: {}, threadActivity: { totalMs: 0, byCategory: {} } },
        mainThreadBusyness: 0,
      },
    });
    const result = extractMainThreadBlocking(ir);
    expect(result).toBeDefined();
    expect(result!.busyMs).toBe(0);
    expect(result!.idleMs).toBe(1000);
    expect(result!.blockingRatio).toBe(0);
    expect(result!.blockingScore).toBe(0);
  });

  it('clamps idleMs when totalDuration is unreasonably large (clock domain mismatch)', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 100, domContentLoadedEventEnd: 150, loadEventStart: 200, loadEventEnd: 250, domInteractive: 80 },
        coreWebVitals: {},
        traceSummary: { totalDuration: 210_452_598, eventCount: 100, categories: {}, threadActivity: { totalMs: 3000, byCategory: { script: 2000, other: 1000 } } },
        mainThreadBusyness: 0.6,
      },
    });
    const result = extractMainThreadBlocking(ir);
    expect(result).toBeDefined();
    // idleMs must be capped at 120_000, not the absurd ~210M
    expect(result!.idleMs).toBe(120_000);
    // busyMs should still be the real value
    expect(result!.busyMs).toBe(3000);
  });

  it('handles NaN mainThreadBusyness gracefully', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 100, domContentLoadedEventEnd: 150, loadEventStart: 200, loadEventEnd: 250, domInteractive: 80 },
        coreWebVitals: {},
        traceSummary: { totalDuration: 1000, eventCount: 10, categories: {}, threadActivity: { totalMs: 400, byCategory: {} } },
        mainThreadBusyness: NaN,
      },
    });
    const result = extractMainThreadBlocking(ir);
    expect(result).toBeDefined();
    // Falls back to blockingRatio = 0.4
    expect(result!.blockingScore).toBe(0.4);
  });
});
