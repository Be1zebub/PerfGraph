/**
 * JS Hotspots extractor tests.
 */

import { describe, it, expect } from 'vitest';
import { extractJSHotspots } from '../../src/extract/js-hotspots.js';
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
    runtime: { executionContexts: [], eventLoopStats: { totalBlockingDuration: 0, longTasks: 0, maxBlockingDuration: 0 } },
    dom: { stats: { totalNodes: 0, elementCount: 0, maxDepth: 0, maxChildren: 0 }, tagDistribution: [], layoutShiftCandidates: { highComplexitySubtrees: 0, deepNesting: 0 } },
    lighthouse: { categories: {}, failedAudits: [], scores: {} },
    ...overrides,
  };
}

describe('extractJSHotspots', () => {
  it('prefers the trace long tasks over the console-gap fallback', () => {
    const ir = makeIRBundle({
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 500, domContentLoadedEventEnd: 550, loadEventStart: 1200, loadEventEnd: 1300, domInteractive: 400 },
        coreWebVitals: { tbt: 1097 },
        longTasks: { count: 3, maxBlockingMs: 648, totalBlockingMs: 1097 },
        scriptCompile: { totalMs: 56.6, count: 533 },
        traceSummary: { totalDuration: 5000, eventCount: 100, categories: {}, threadActivity: { totalMs: 2000, byCategory: {} } },
        mainThreadBusyness: 0.4,
      },
      runtime: {
        executionContexts: [],
        eventLoopStats: { totalBlockingDuration: 0, longTasks: 0, maxBlockingDuration: 0 },
      },
    });
    const result = extractJSHotspots(ir);
    expect(result.source).toBe('trace');
    expect(result.longTaskCount).toBe(3);
    expect(result.maxBlockingDuration).toBe(648);
    expect(result.compileTimeMs).toBe(56.6);
  });

  it('counts the scripts the page loaded', () => {
    const ir = makeIRBundle({
      network: {
        requests: [
          { url: 'https://example.com/app.js', method: 'GET', resourceType: 'Script', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 1000, priority: 'High', initiator: '', failed: false, timing: {} },
          { url: 'https://example.com/vendor.js', method: 'GET', resourceType: 'Script', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 1000, priority: 'High', initiator: '', failed: false, timing: {} },
          { url: 'https://example.com/style.css', method: 'GET', resourceType: 'Stylesheet', statusCode: 200, startTime: 0, endTime: 100, duration: 100, bytes: 1000, priority: 'High', initiator: '', failed: false, timing: {} },
        ],
        summary: { totalRequests: 3, totalBytes: 3000, byType: { Script: 2, Stylesheet: 1 }, byPriority: { High: 3 }, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
    });
    const result = extractJSHotspots(ir);
    expect(result.scriptCount).toBe(2);
  });

  it('extracts all values from runtime IR', () => {
    const ir = makeIRBundle({
      runtime: {
        executionContexts: [{ id: 1, origin: 'https://example.com' }, { id: 2, origin: 'https://cdn.example.com' }],
        hydrationCost: { bootupTime: 850, evaluatedScripts: 12 },
        eventLoopStats: { totalBlockingDuration: 350, longTasks: 5, maxBlockingDuration: 120 },
      },
    });
    const result = extractJSHotspots(ir);
    expect(result.bootupTime).toBe(850);
    expect(result.evaluatedScripts).toBe(12);
    expect(result.longTaskCount).toBe(5);
    expect(result.maxBlockingDuration).toBe(120);
    expect(result.contextCount).toBe(2);
  });

  it('returns zeros when runtime data absent', () => {
    const ir = makeIRBundle();
    const result = extractJSHotspots(ir);
    // The fabricated bootup time and script-evaluation count are not reported
    // when there is nothing measured behind them.
    expect(result.bootupTime).toBeUndefined();
    expect(result.evaluatedScripts).toBeUndefined();
    expect(result.longTaskCount).toBe(0);
    expect(result.maxBlockingDuration).toBe(0);
    expect(result.contextCount).toBe(0);
    // The fixture only has console-derived stats, so the long-task numbers
    // come from the console-gap fallback rather than the trace.
    expect(result.source).toBe('console-gap');
  });

  it('handles partial hydrationCost', () => {
    const ir = makeIRBundle({
      runtime: {
        executionContexts: [],
        hydrationCost: { bootupTime: 450, evaluatedScripts: 6 },
      },
    });
    const result = extractJSHotspots(ir);
    expect(result.bootupTime).toBe(450);
    expect(result.evaluatedScripts).toBe(6);
    expect(result.contextCount).toBe(0);
  });

  it('handles partial eventLoopStats', () => {
    const ir = makeIRBundle({
      runtime: {
        executionContexts: [],
        eventLoopStats: { totalBlockingDuration: 200, longTasks: 3, maxBlockingDuration: 80 },
      },
    });
    const result = extractJSHotspots(ir);
    expect(result.longTaskCount).toBe(3);
    expect(result.maxBlockingDuration).toBe(80);
  });
});
