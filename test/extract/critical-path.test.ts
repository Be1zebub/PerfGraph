/**
 * Critical Path Length extractor tests.
 *
 * Tests cover:
 * - Full critical path chain with mixed request types
 * - Empty chain → undefined
 * - URLs in chain not found in requests
 * - Single-request chain
 * - No matched requests → undefined
 */

import { describe, it, expect } from 'vitest';
import { extractCriticalPath } from '../../src/extract/critical-path.js';
import type { IRBundle } from '../../src/normalize/types.js';

function makeIRBundle(overrides?: Partial<IRBundle>): IRBundle {
  const base: IRBundle = {
    meta: { url: 'https://example.com', fetchedAt: '2025-01-01T00:00:00Z', navigationStart: 0, irVersion: '1.0.0' },
    performance: {
      navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
      coreWebVitals: {},
      traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
      mainThreadBusyness: 0.3,
    },
    network: {
      requests: [],
      summary: { totalRequests: 0, totalBytes: 0, byType: {}, byPriority: {}, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
    },
    runtime: {
      executionContexts: [],
      eventLoopStats: { totalBlockingDuration: 0, longTasks: 0, maxBlockingDuration: 0 },
    },
    dom: {
      stats: { totalNodes: 0, elementCount: 0, maxDepth: 0, maxChildren: 0 },
      tagDistribution: [],
      layoutShiftCandidates: { highComplexitySubtrees: 0, deepNesting: 0 },
    },
    lighthouse: {
      categories: {},
      failedAudits: [],
      scores: {},
    },
  };
  return { ...base, ...overrides };
}

describe('extractCriticalPath', () => {
  // ---------------------------------------------------------------------------
  // Full critical path chain
  // ---------------------------------------------------------------------------
  it('computes metrics from a mixed critical path chain', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 200, duration: 200, bytes: 5000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: {},
          },
          {
            url: 'https://example.com/style.css', method: 'GET', resourceType: 'Stylesheet', statusCode: 200,
            startTime: 150, endTime: 350, duration: 200, bytes: 10_000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: {},
          },
          {
            url: 'https://example.com/app.js', method: 'GET', resourceType: 'Script', statusCode: 200,
            startTime: 180, endTime: 580, duration: 400, bytes: 50_000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: {},
          },
          {
            url: 'https://example.com/analytics.js', method: 'GET', resourceType: 'Script', statusCode: 200,
            startTime: 600, endTime: 800, duration: 200, bytes: 20_000, priority: 'Low',
            initiator: '', failed: false,
            timing: {},
          },
        ],
        summary: {
          totalRequests: 4, totalBytes: 85_000,
          byType: { Document: 1, Stylesheet: 1, Script: 2 },
          byPriority: { VeryHigh: 3, Low: 1 },
          criticalPath: {
            tree: {
              url: 'https://example.com/',
              durationMs: 200,
              children: [
                { url: 'https://example.com/style.css', durationMs: 200 },
                { url: 'https://example.com/app.js', durationMs: 400 },
              ],
            },
            depth: 2,
            urlsOnLongestPath: ['https://example.com/', 'https://example.com/style.css'],
          },
          longestChain: { url: 'https://example.com/app.js', length: 400 },
        },
      },
    });

    const result = extractCriticalPath(ir);
    expect(result).toBeDefined();
    // totalChainLength = 200 + 200 + 400 = 800
    expect(result!.totalChainLength).toBe(800);
    expect(result!.requestCount).toBe(3);
    // blocking: Document(1) + Stylesheet(1) + Script VeryHigh(1) = 3
    expect(result!.blockingCount).toBe(3);
    expect(result!.nonBlockingCount).toBe(0);
    // depth is 2 (root + one child level), not 3 (URL count)
    expect(result!.deepestChainDepth).toBe(2);
    // longest single request = app.js 400
    expect(result!.longestSingleRequest).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Empty chain → undefined
  // ---------------------------------------------------------------------------
  it('returns undefined for empty criticalPath (no tree URL)', () => {
    const ir = makeIRBundle();
    const result = extractCriticalPath(ir);
    expect(result).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Chain with unmatched URLs
  // ---------------------------------------------------------------------------
  it('skips unmatched URLs in the path tree', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 100, duration: 100, bytes: 5000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: {},
          },
        ],
        summary: {
          totalRequests: 1, totalBytes: 5000,
          byType: { Document: 1 },
          byPriority: { VeryHigh: 1 },
          criticalPath: {
            tree: {
              url: 'https://example.com/',
              durationMs: 100,
              children: [
                { url: 'https://example.com/missing.css' },
              ],
            },
            depth: 2,
            urlsOnLongestPath: ['https://example.com/', 'https://example.com/missing.css'],
          },
          longestChain: { url: 'https://example.com/', length: 100 },
        },
      },
    });

    const result = extractCriticalPath(ir);
    expect(result).toBeDefined();
    // requestCount only includes matched URLs (tree walk skips unmatched)
    expect(result!.requestCount).toBe(1);
    // totalChainLength only from matched: 100
    expect(result!.totalChainLength).toBe(100);
    // blockingCount: only matched document
    expect(result!.blockingCount).toBe(1);
    expect(result!.nonBlockingCount).toBe(0);
    // depth reflects tree depth, not URL count
    expect(result!.deepestChainDepth).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // No matched requests → undefined
  // ---------------------------------------------------------------------------
  it('returns undefined when no tree URLs match requests', () => {
    const ir = makeIRBundle({
      network: {
        requests: [],
        summary: {
          totalRequests: 0, totalBytes: 0,
          byType: {}, byPriority: {},
          criticalPath: {
            tree: { url: 'https://other.com/' },
            depth: 1,
            urlsOnLongestPath: ['https://other.com/'],
          },
          longestChain: { url: 'https://other.com/', length: 1 },
        },
      },
    });

    const result = extractCriticalPath(ir);
    expect(result).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Single-request chain
  // ---------------------------------------------------------------------------
  it('handles single-request critical path', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 300, duration: 300, bytes: 5000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: {},
          },
        ],
        summary: {
          totalRequests: 1, totalBytes: 5000,
          byType: { Document: 1 },
          byPriority: { VeryHigh: 1 },
          criticalPath: {
            tree: { url: 'https://example.com/', durationMs: 300 },
            depth: 1,
            urlsOnLongestPath: ['https://example.com/'],
          },
          longestChain: { url: 'https://example.com/', length: 300 },
        },
      },
    });

    const result = extractCriticalPath(ir);
    expect(result).toBeDefined();
    expect(result!.requestCount).toBe(1);
    expect(result!.totalChainLength).toBe(300);
    expect(result!.blockingCount).toBe(1);
    expect(result!.nonBlockingCount).toBe(0);
    expect(result!.deepestChainDepth).toBe(1);
    expect(result!.longestSingleRequest).toBe(300);
  });

  // ---------------------------------------------------------------------------
  // Mixed blocking and non-blocking
  // ---------------------------------------------------------------------------
  it('counts blocking and non-blocking correctly', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 100, duration: 100, bytes: 5000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: {},
          },
          {
            url: 'https://example.com/app.js', method: 'GET', resourceType: 'Script', statusCode: 200,
            startTime: 80, endTime: 180, duration: 100, bytes: 30_000, priority: 'High',
            initiator: '', failed: false,
            timing: {},
          },
        ],
        summary: {
          totalRequests: 2, totalBytes: 35_000,
          byType: { Document: 1, Script: 1 },
          byPriority: { VeryHigh: 1, High: 1 },
          criticalPath: {
            tree: {
              url: 'https://example.com/',
              durationMs: 100,
              children: [
                { url: 'https://example.com/app.js', durationMs: 100 },
              ],
            },
            depth: 2,
            urlsOnLongestPath: ['https://example.com/', 'https://example.com/app.js'],
          },
          longestChain: { url: 'https://example.com/app.js', length: 100 },
        },
      },
    });

    const result = extractCriticalPath(ir);
    expect(result).toBeDefined();
    expect(result!.requestCount).toBe(2);
    // Document blocks, Script at High priority does not block
    expect(result!.blockingCount).toBe(1);
    expect(result!.nonBlockingCount).toBe(1);
    // totalChainLength = 100 + 100 = 200
    expect(result!.totalChainLength).toBe(200);
  });
});
