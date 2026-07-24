/**
 * LCP Breakdown extractor tests.
 *
 * Tests cover:
 * - Full breakdown with Document request + LCP image
 * - Text-only LCP (no images)
 * - Missing LCP data → undefined
 * - Empty network requests
 * - Edge cases (NaN, negative values)
 */

import { describe, it, expect } from 'vitest';
import { extractLCPBreakdown } from '../../src/extract/lcp-breakdown.js';
import type { IRBundle } from '../../src/normalize/types.js';

function makeIRBundle(overrides?: Partial<IRBundle>): IRBundle {
  const base: IRBundle = {
    meta: { url: 'https://example.com', fetchedAt: '2025-01-01T00:00:00Z', navigationStart: 0, irVersion: '1.0.0' },
    performance: {
      navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
      coreWebVitals: { lcp: 3000, fcp: 800 },
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

describe('extractLCPBreakdown', () => {
  // ---------------------------------------------------------------------------
  // Full breakdown with Document + Image
  // ---------------------------------------------------------------------------
  it('computes full LCP breakdown with Document + Image', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { lcp: 3000 },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
        mainThreadBusyness: 0.3,
      },
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 400, duration: 400, bytes: 5000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: { dns: 10, connect: 20, ssl: 30, wait: 40, receive: 300 },
          },
          {
            url: 'https://example.com/hero.jpg', method: 'GET', resourceType: 'Image', statusCode: 200,
            startTime: 500, endTime: 2500, duration: 2000, bytes: 100_000, priority: 'High',
            initiator: '', failed: false,
            timing: { dns: 0, connect: 0, ssl: 0, wait: 100, receive: 1900 },
          },
          {
            url: 'https://example.com/small.png', method: 'GET', resourceType: 'Image', statusCode: 200,
            startTime: 600, endTime: 1000, duration: 400, bytes: 10_000, priority: 'High',
            initiator: '', failed: false,
            timing: {},
          },
        ],
        summary: { totalRequests: 3, totalBytes: 115_000, byType: { Document: 1, Image: 2 }, byPriority: { VeryHigh: 1, High: 2 }, criticalPath: { tree: { url: 'https://example.com/', durationMs: 400 }, depth: 1, urlsOnLongestPath: ['https://example.com/'] }, longestChain: { url: 'https://example.com/', length: 1 } },
      },
      lighthouse: {
        categories: {},
        failedAudits: [],
        scores: {},
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeDefined();
    // TTFB = dns(10) + connect(20) + ssl(30) + wait(40) = 100
    expect(result!.ttfb).toBe(100);
    // Resource Load Delay = hero.jpg startTime(500) - TTFB(100) = 400
    expect(result!.resourceLoadDelay).toBe(400);
    // Resource Load Time = hero.jpg duration(2000)
    expect(result!.resourceLoadTime).toBe(2000);
    // Element Render Delay = 3000 - 100 - 400 - 2000 = 500
    expect(result!.elementRenderDelay).toBe(500);
    expect(result!.totalLCP).toBe(3000);
    expect(result!.lcpElementUrl).toBe('https://example.com/hero.jpg');
    expect(result!.lcpResourceType).toBe('Image');
    expect(result!.source).toBe('trace');
    expect(result!.lcpElement).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Text-only LCP (no image requests)
  // ---------------------------------------------------------------------------
  it('handles text-only LCP (no images)', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 300, domContentLoadedEventEnd: 350, loadEventStart: 800, loadEventEnd: 900, domInteractive: 250 },
        coreWebVitals: { lcp: 2000 },
        traceSummary: { totalDuration: 4000, eventCount: 80, categories: {}, threadActivity: { totalMs: 4000, byCategory: {} } },
        mainThreadBusyness: 0.2,
      },
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 200, duration: 200, bytes: 3000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: { wait: 50 },
          },
          {
            url: 'https://example.com/app.js', method: 'GET', resourceType: 'Script', statusCode: 200,
            startTime: 100, endTime: 600, duration: 500, bytes: 50_000, priority: 'High',
            initiator: '', failed: false,
            timing: {},
          },
        ],
        summary: { totalRequests: 2, totalBytes: 53_000, byType: { Document: 1, Script: 1 }, byPriority: { VeryHigh: 1, High: 1 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
      lighthouse: {
        categories: {},
        failedAudits: [],
        scores: {},
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeDefined();
    expect(result!.ttfb).toBe(50);
    expect(result!.resourceLoadDelay).toBe(0);
    expect(result!.resourceLoadTime).toBe(0);
    expect(result!.elementRenderDelay).toBe(2000 - 50); // 1950
    expect(result!.totalLCP).toBe(2000);
    expect(result!.lcpElementUrl).toBeUndefined();
    expect(result!.lcpResourceType).toBeUndefined();
    expect(result!.source).toBe('trace');
    expect(result!.lcpElement).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Missing LCP data → undefined
  // ---------------------------------------------------------------------------
  it('returns undefined when LCP data is missing from both trace and Lighthouse', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: {},
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
        mainThreadBusyness: 0.3,
      },
      lighthouse: {
        categories: {},
        failedAudits: [],
        scores: {},
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeUndefined();
  });

  it('returns undefined when LCP is NaN (neither trace nor Lighthouse provides finite value)', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { lcp: NaN },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
        mainThreadBusyness: 0.3,
      },
      lighthouse: {
        categories: {},
        failedAudits: [],
        scores: {},
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Empty network requests
  // ---------------------------------------------------------------------------
  it('handles empty network requests', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { lcp: 1500 },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
        mainThreadBusyness: 0.3,
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeDefined();
    expect(result!.ttfb).toBe(0);
    expect(result!.resourceLoadDelay).toBe(0);
    expect(result!.resourceLoadTime).toBe(0);
    expect(result!.elementRenderDelay).toBe(1500);
    expect(result!.totalLCP).toBe(1500);
    expect(result!.lcpElementUrl).toBeUndefined();
    expect(result!.source).toBe('trace');
    expect(result!.lcpElement).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Lighthouse fallback for TTFB
  // ---------------------------------------------------------------------------
  it('uses Lighthouse server-response-time audit when no Document request timing', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { lcp: 2500 },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
        mainThreadBusyness: 0.3,
      },
      lighthouse: {
        categories: {},
        failedAudits: [
          { id: 'server-response-time', title: 'Server Response Time', description: '', score: 0, numericValue: 320 },
        ],
        scores: {},
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeDefined();
    expect(result!.ttfb).toBe(320);
    expect(result!.source).toBe('trace');
  });

  // ---------------------------------------------------------------------------
  // Lighthouse fallback for missing trace LCP (ISSUE-006)
  // ---------------------------------------------------------------------------
  it('uses Lighthouse lcpNumericValue when trace LCP is missing', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: {},
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
        mainThreadBusyness: 0.3,
      },
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 200, duration: 200, bytes: 3000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: { wait: 50 },
          },
          {
            url: 'https://example.com/hero.jpg', method: 'GET', resourceType: 'Image', statusCode: 200,
            startTime: 300, endTime: 1800, duration: 1500, bytes: 80_000, priority: 'High',
            initiator: '', failed: false,
            timing: {},
          },
        ],
        summary: { totalRequests: 2, totalBytes: 83_000, byType: { Document: 1, Image: 1 }, byPriority: { VeryHigh: 1, High: 1 }, criticalPath: { tree: { url: 'https://example.com/', durationMs: 400 }, depth: 1, urlsOnLongestPath: ['https://example.com/'] }, longestChain: { url: 'https://example.com/', length: 1 } },
      },
      lighthouse: {
        categories: {},
        failedAudits: [],
        scores: {},
        lcpNumericValue: 2400,
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeDefined();
    expect(result!.totalLCP).toBe(2400);
    // Source is 'lighthouse' because trace lcp was undefined
    expect(result!.source).toBe('lighthouse');
    // TTFB from Document timing
    expect(result!.ttfb).toBe(50);
    // Resource Load Delay = hero.jpg startTime(300) - TTFB(50) = 250
    expect(result!.resourceLoadDelay).toBe(250);
    // Resource Load Time = hero.jpg duration(1500)
    expect(result!.resourceLoadTime).toBe(1500);
    // Element Render Delay = 2400 - 50 - 250 - 1500 = 600
    expect(result!.elementRenderDelay).toBe(600);
    expect(result!.lcpElementUrl).toBe('https://example.com/hero.jpg');
    expect(result!.lcpResourceType).toBe('Image');
    expect(result!.lcpElement).toBeUndefined();
  });

  it('uses Lighthouse lcpNumericValue with lcpElement when trace LCP is missing and Lighthouse has element details', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: {},
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
        mainThreadBusyness: 0.3,
      },
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 200, duration: 200, bytes: 3000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: { wait: 50 },
          },
        ],
        summary: { totalRequests: 1, totalBytes: 3000, byType: { Document: 1 }, byPriority: { VeryHigh: 1 }, criticalPath: { tree: { url: 'https://example.com/', durationMs: 400 }, depth: 1, urlsOnLongestPath: ['https://example.com/'] }, longestChain: { url: 'https://example.com/', length: 1 } },
      },
      lighthouse: {
        categories: {},
        failedAudits: [],
        scores: {},
        lcpNumericValue: 1800,
        lcpElementSelector: 'img.hero',
        lcpElementSnippet: '<img class="hero" src="hero.jpg">',
        lcpElementNodeLabel: 'img.hero',
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeDefined();
    expect(result!.totalLCP).toBe(1800);
    expect(result!.source).toBe('lighthouse');
    // lcpElement should be populated from lighthouse fields
    expect(result!.lcpElement).toBeDefined();
    expect(result!.lcpElement!.selector).toBe('img.hero');
    expect(result!.lcpElement!.snippet).toBe('<img class="hero" src="hero.jpg">');
    expect(result!.lcpElement!.nodeLabel).toBe('img.hero');
  });

  it('produces source "mixed" when both trace and Lighthouse LCP are present', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { lcp: 2800 },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
        mainThreadBusyness: 0.3,
      },
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 200, duration: 200, bytes: 3000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: { wait: 50 },
          },
        ],
        summary: { totalRequests: 1, totalBytes: 3000, byType: { Document: 1 }, byPriority: { VeryHigh: 1 }, criticalPath: { tree: { url: 'https://example.com/', durationMs: 400 }, depth: 1, urlsOnLongestPath: ['https://example.com/'] }, longestChain: { url: 'https://example.com/', length: 1 } },
      },
      lighthouse: {
        categories: {},
        failedAudits: [],
        scores: {},
        lcpNumericValue: 2600,
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeDefined();
    expect(result!.totalLCP).toBe(2800); // Prefers trace value
    expect(result!.source).toBe('mixed');
  });

  // ---------------------------------------------------------------------------
  // Negative clamping
  // ---------------------------------------------------------------------------
  it('clamps negative elementRenderDelay to 0', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { lcp: 1000 },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 5000, byCategory: {} } },
        mainThreadBusyness: 0.3,
      },
      network: {
        requests: [
          {
            url: 'https://example.com/', method: 'GET', resourceType: 'Document', statusCode: 200,
            startTime: 0, endTime: 100, duration: 100, bytes: 3000, priority: 'VeryHigh',
            initiator: '', failed: false,
            timing: { wait: 50 },
          },
          {
            url: 'https://example.com/fast.jpg', method: 'GET', resourceType: 'Image', statusCode: 200,
            startTime: 50, endTime: 2050, duration: 2000, bytes: 80_000, priority: 'High',
            initiator: '', failed: false,
            timing: {},
          },
        ],
        summary: { totalRequests: 2, totalBytes: 83_000, byType: { Document: 1, Image: 1 }, byPriority: { VeryHigh: 1, High: 1 }, criticalPath: { tree: { url: 'https://example.com/', durationMs: 400 }, depth: 1, urlsOnLongestPath: ['https://example.com/'] }, longestChain: { url: 'https://example.com/', length: 1 } },
      },
    });

    const result = extractLCPBreakdown(ir);
    expect(result).toBeDefined();
    // TTFB=50, delay=0, load=2000, total=1000 => 1000-50-0-2000 = -1050 → clamped to 0
    expect(result!.elementRenderDelay).toBe(0);
  });
});
