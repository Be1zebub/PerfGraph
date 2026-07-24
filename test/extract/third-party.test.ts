/**
 * Third-Party Overhead extractor tests.
 */

import { describe, it, expect } from 'vitest';
import { extractThirdPartyOverhead } from '../../src/extract/third-party.js';
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
    dom: { stats: { totalNodes: 0, elementCount: 0, maxDepth: 0, maxChildren: 0 }, tagDistribution: [], layoutShiftCandidates: { highComplexitySubtrees: 0, deepNesting: 0 } },
    lighthouse: { categories: {}, failedAudits: [], scores: {} },
    ...overrides,
  };
}

describe('extractThirdPartyOverhead', () => {
  it('returns undefined with no network requests', () => {
    const ir = makeIRBundle();
    const result = extractThirdPartyOverhead(ir);
    expect(result).toBeUndefined();
  });

  it('classifies first-party vs third-party requests', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 5000, priority: 'VeryHigh', initiator: '', failed: false, timing: {} },
          { url: 'https://example.com/style.css', method: 'GET', resourceType: 'Stylesheet', statusCode: 200, startTime: 50, endTime: 150, duration: 100, bytes: 10000, priority: 'VeryHigh', initiator: '', failed: false, timing: {} },
          { url: 'https://www.google-analytics.com/ga.js', method: 'GET', resourceType: 'Script', statusCode: 200, startTime: 100, endTime: 500, duration: 400, bytes: 20000, priority: 'High', initiator: '', failed: false, timing: {} },
          { url: 'https://cdn.example.net/image.png', method: 'GET', resourceType: 'Image', statusCode: 200, startTime: 200, endTime: 600, duration: 400, bytes: 50000, priority: 'High', initiator: '', failed: false, timing: {} },
        ],
        summary: { totalRequests: 4, totalBytes: 85000, byType: { Document: 1, Stylesheet: 1, Script: 1, Image: 1 }, byPriority: { VeryHigh: 2, High: 2 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
    });
    const result = extractThirdPartyOverhead(ir);
    expect(result).toBeDefined();
    expect(result!.firstPartyRequests).toBe(2); // example.com/ + style.css
    expect(result!.firstPartyBytes).toBe(15000);
    expect(result!.totalThirdPartyRequests).toBe(2); // google-analytics + cdn.example.net
    expect(result!.totalThirdPartyBytes).toBe(70000);
    expect(result!.thirdPartyRatio).toBe(0.5); // 2/4
    // Categories
    expect(result!.byCategory['analytics']).toBeDefined();
    expect(result!.byCategory['analytics'].requests).toBe(1);
    expect(result!.byCategory['analytics'].bytes).toBe(20000);
    expect(result!.byCategory['cdn']).toBeDefined();
    expect(result!.byCategory['cdn'].requests).toBe(1);
  });

  it('handles empty third-party (all first-party)', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 5000, priority: 'VeryHigh', initiator: '', failed: false, timing: {} },
        ],
        summary: { totalRequests: 1, totalBytes: 5000, byType: { Document: 1 }, byPriority: { VeryHigh: 1 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
    });
    const result = extractThirdPartyOverhead(ir);
    expect(result).toBeDefined();
    expect(result!.totalThirdPartyRequests).toBe(0);
    expect(result!.firstPartyRequests).toBe(1);
    expect(result!.thirdPartyRatio).toBe(0);
  });

  it('handles all third-party requests', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://www.google-analytics.com/ga.js', method: 'GET', resourceType: 'Script', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 10000, priority: 'High', initiator: '', failed: false, timing: {} },
        ],
        summary: { totalRequests: 1, totalBytes: 10000, byType: { Script: 1 }, byPriority: { High: 1 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
    });
    const result = extractThirdPartyOverhead(ir);
    expect(result).toBeDefined();
    expect(result!.totalThirdPartyRequests).toBe(1);
    expect(result!.firstPartyRequests).toBe(0);
    expect(result!.thirdPartyRatio).toBe(1);
  });

  it('categorises multiple third-party services', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 5000, priority: 'VeryHigh', initiator: '', failed: false, timing: {} },
          { url: 'https://www.google-analytics.com/collect', method: 'GET', resourceType: 'XHR', statusCode: 200, startTime: 200, endTime: 400, duration: 200, bytes: 500, priority: 'Low', initiator: '', failed: false, timing: {} },
          { url: 'https://connect.facebook.net/sdk.js', method: 'GET', resourceType: 'Script', statusCode: 200, startTime: 250, endTime: 600, duration: 350, bytes: 30000, priority: 'High', initiator: '', failed: false, timing: {} },
          { url: 'https://js.stripe.com/v2/', method: 'GET', resourceType: 'Script', statusCode: 200, startTime: 300, endTime: 700, duration: 400, bytes: 25000, priority: 'High', initiator: '', failed: false, timing: {} },
        ],
        summary: { totalRequests: 4, totalBytes: 60500, byType: { Document: 1, XHR: 1, Script: 2 }, byPriority: { VeryHigh: 1, High: 2, Low: 1 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
    });
    const result = extractThirdPartyOverhead(ir);
    expect(result).toBeDefined();
    expect(result!.byCategory['analytics']).toBeDefined();
    expect(result!.byCategory['social']).toBeDefined();
    expect(result!.byCategory['payment']).toBeDefined();
    expect(result!.totalThirdPartyRequests).toBe(3);
  });
});
