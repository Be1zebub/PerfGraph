/**
 * Render-Blocking Score extractor tests.
 */

import { describe, it, expect } from 'vitest';
import { extractRenderBlocking } from '../../src/extract/render-blocking.js';
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
    network: { requests: [], summary: { totalRequests: 0, totalBytes: 0, byType: {}, byPriority: {}, criticalPathChain: [], longestChain: { url: '', length: 0 } } },
    runtime: { executionContexts: [] },
    dom: { stats: { totalNodes: 0, elementCount: 0, maxDepth: 0, maxChildren: 0 }, tagDistribution: [], layoutShiftCandidates: { highComplexitySubtrees: 0, deepNesting: 0 } },
    lighthouse: { categories: {}, failedAudits: [], scores: {}, renderBlockingResources: undefined },
    ...overrides,
  };
}

describe('extractRenderBlocking', () => {
  it('returns undefined with no network requests', () => {
    const ir = makeIRBundle();
    const result = extractRenderBlocking(ir);
    expect(result).toBeUndefined();
  });

  it('blocks Stylesheet, Document, VeryHigh Script', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 5000, priority: 'VeryHigh', initiator: '', failed: false, timing: {} },
          { url: 'https://example.com/style.css', method: 'GET', resourceType: 'Stylesheet', statusCode: 200, startTime: 50, endTime: 150, duration: 100, bytes: 10000, priority: 'VeryHigh', initiator: '', failed: false, timing: {} },
          { url: 'https://example.com/app.js', method: 'GET', resourceType: 'Script', statusCode: 200, startTime: 80, endTime: 280, duration: 200, bytes: 30000, priority: 'VeryHigh', initiator: '', failed: false, timing: {} },
          { url: 'https://example.com/analytics.js', method: 'GET', resourceType: 'Script', statusCode: 200, startTime: 300, endTime: 500, duration: 200, bytes: 15000, priority: 'Low', initiator: '', failed: false, timing: {} },
          { url: 'https://example.com/hero.jpg', method: 'GET', resourceType: 'Image', statusCode: 200, startTime: 100, endTime: 2100, duration: 2000, bytes: 80000, priority: 'High', initiator: '', failed: false, timing: {} },
        ],
        summary: { totalRequests: 5, totalBytes: 140000, byType: { Document: 1, Stylesheet: 1, Script: 2, Image: 1 }, byPriority: { VeryHigh: 3, High: 1, Low: 1 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
    });
    const result = extractRenderBlocking(ir);
    expect(result).toBeDefined();
    // Blocking: Document(1) + Stylesheet(1) + Script VeryHigh(1) = 3
    expect(result!.blockingRequestCount).toBe(3);
    expect(result!.blockingBytes).toBe(5000 + 10000 + 30000); // 45000
    expect(result!.blockingDuration).toBe(100 + 100 + 200); // 400
    // Score: countScore = 1 - 3/20 = 0.85, no LH audit → score = 0.85
    expect(result!.renderBlockingScore).toBeCloseTo(0.85, 5);
    expect(result!.lhRenderBlockingMs).toBeUndefined();
  });

  it('incorporates Lighthouse render-blocking-resources audit', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://example.com/style.css', method: 'GET', resourceType: 'Stylesheet', statusCode: 200, startTime: 0, endTime: 200, duration: 200, bytes: 20000, priority: 'VeryHigh', initiator: '', failed: false, timing: {} },
        ],
        summary: { totalRequests: 1, totalBytes: 20000, byType: { Stylesheet: 1 }, byPriority: { VeryHigh: 1 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
      lighthouse: {
        categories: {},
        failedAudits: [
          { id: 'render-blocking-resources', title: 'Render blocking resources', description: '', score: 0.5, numericValue: 870 },
        ],
        scores: {},
      },
    });
    const result = extractRenderBlocking(ir);
    expect(result).toBeDefined();
    expect(result!.blockingRequestCount).toBe(1);
    expect(result!.lhRenderBlockingMs).toBe(870);
    // countScore = 1 - 1/20 = 0.95, lhScore = 0.5, blend = (0.95 + 0.5)/2 = 0.725
    expect(result!.renderBlockingScore).toBeCloseTo(0.725, 5);
  });

  it('includes resources and totalWastedMs from Lighthouse renderBlockingResources', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://example.com/style.css', method: 'GET', resourceType: 'Stylesheet', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 18000, priority: 'VeryHigh', initiator: '', failed: false, timing: {} },
        ],
        summary: { totalRequests: 1, totalBytes: 18000, byType: { Stylesheet: 1 }, byPriority: { VeryHigh: 1 }, criticalPathChain: [], longestChain: { url: '', length: 0 } },
      },
      lighthouse: {
        categories: {},
        failedAudits: [],
        scores: {},
        renderBlockingResources: [
          { url: 'https://example.com/style.css', totalBytes: 18000, wastedMs: 306, resourceType: 'Stylesheet' },
          { url: 'https://example.com/app.js', totalBytes: 45000, wastedMs: 560, resourceType: 'Script' },
        ],
      },
    });
    const result = extractRenderBlocking(ir);
    expect(result).toBeDefined();
    expect(result!.resources).toHaveLength(2);
    expect(result!.resources![0]!.url).toContain('style.css');
    expect(result!.resources![0]!.wastedMs).toBe(306);
    expect(result!.resources![1]!.url).toContain('app.js');
    expect(result!.resources![1]!.wastedMs).toBe(560);
    expect(result!.totalWastedMs).toBe(306 + 560); // 866
  });

  it('handles zero blocking resources', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://example.com/hero.jpg', method: 'GET', resourceType: 'Image', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 50000, priority: 'High', initiator: '', failed: false, timing: {} },
          { url: 'https://example.com/app.js', method: 'GET', resourceType: 'Script', statusCode: 200, startTime: 50, endTime: 150, duration: 100, bytes: 20000, priority: 'High', initiator: '', failed: false, timing: {} },
        ],
        summary: { totalRequests: 2, totalBytes: 70000, byType: { Image: 1, Script: 1 }, byPriority: { High: 2 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
    });
    const result = extractRenderBlocking(ir);
    expect(result).toBeDefined();
    expect(result!.blockingRequestCount).toBe(0);
    expect(result!.renderBlockingScore).toBe(1);
  });

  it('ignores failed requests', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://example.com/style.css', method: 'GET', resourceType: 'Stylesheet', statusCode: 0, startTime: 0, endTime: 0, duration: 0, bytes: 0, priority: 'VeryHigh', initiator: '', failed: true, timing: {} },
        ],
        summary: { totalRequests: 1, totalBytes: 0, byType: { Stylesheet: 1 }, byPriority: { VeryHigh: 1 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
    });
    const result = extractRenderBlocking(ir);
    expect(result).toBeDefined();
    expect(result!.blockingRequestCount).toBe(0);
  });
});
