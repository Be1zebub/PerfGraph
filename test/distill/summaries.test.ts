/**
 * Tests for compact summary builders (src/distill/summaries.ts).
 *
 * Covers buildNetworkSummary, buildLighthouseSummary, and
 * buildCoverageSummary with edge cases for empty, partial, and
 * typical data.
 */

import { describe, it, expect } from 'vitest';
import {
  buildNetworkSummary,
  buildLighthouseSummary,
  buildCoverageSummary,
} from '../../src/distill/summaries.js';
import type {
  NetworkRawData,
  LighthouseRawData,
  CoverageRawData,
} from '../../src/collect/types.js';

// ---------------------------------------------------------------------------
// buildNetworkSummary
// ---------------------------------------------------------------------------

describe('buildNetworkSummary', () => {
  it('returns empty summary for empty network data', () => {
    const network: NetworkRawData = {
      requests: [],
      metadata: { totalRequests: 0, totalFailed: 0, totalBytes: 0, startTime: 0, endTime: 0 },
      warnings: [],
    };
    const result = buildNetworkSummary(network);
    expect(result.totalRequests).toBe(0);
    expect(result.totalBytes).toBe(0);
    expect(result.topRequestsByDuration).toHaveLength(0);
    expect(result.blockingResources).toHaveLength(0);
    expect(result.initiatorChains).toHaveLength(0);
  });

  it('returns summary for partial data (missing response)', () => {
    const network: NetworkRawData = {
      requests: [
        {
          requestId: '1',
          url: 'https://example.com/script.js',
          method: 'GET',
          type: 'Script',
          request: { headers: {} },
          timestamp: 1000,
        },
      ],
      metadata: { totalRequests: 1, totalFailed: 0, totalBytes: 0, startTime: 0, endTime: 0 },
      warnings: [],
    };
    const result = buildNetworkSummary(network);
    expect(result.totalRequests).toBe(1);
    expect(result.totalBytes).toBe(0);
    expect(result.topRequestsByDuration).toHaveLength(1);
    expect(result.topRequestsByDuration[0]!.duration).toBe(0);
    expect(result.topRequestsByDuration[0]!.bytes).toBe(0);
    expect(result.blockingResources).toHaveLength(1);
  });

  it('sorts requests by duration descending', () => {
    const network: NetworkRawData = {
      requests: [
        {
          requestId: '1',
          url: 'https://example.com/slow.js',
          method: 'GET',
          type: 'Script',
          request: { headers: {} },
          response: {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/javascript' },
            mimeType: 'application/javascript',
            timing: {
              requestTime: 1,
              proxyStart: -1, proxyEnd: -1,
              dnsStart: -1, dnsEnd: -1,
              connectStart: -1, connectEnd: -1,
              sslStart: -1, sslEnd: -1,
              workerStart: -1, workerReady: -1,
              workerFetchStart: -1, workerRespondWithSettled: -1,
              pushStart: 0, pushEnd: 0,
              sendStart: 0, sendEnd: 0,
              receiveHeadersEnd: 500,
            },
            encodedDataLength: 1000,
          },
          timestamp: 1000,
        },
        {
          requestId: '2',
          url: 'https://example.com/fast.css',
          method: 'GET',
          type: 'Stylesheet',
          request: { headers: {} },
          response: {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/css' },
            mimeType: 'text/css',
            timing: {
              requestTime: 2,
              proxyStart: -1, proxyEnd: -1,
              dnsStart: -1, dnsEnd: -1,
              connectStart: -1, connectEnd: -1,
              sslStart: -1, sslEnd: -1,
              workerStart: -1, workerReady: -1,
              workerFetchStart: -1, workerRespondWithSettled: -1,
              pushStart: 0, pushEnd: 0,
              sendStart: 0, sendEnd: 0,
              receiveHeadersEnd: 50,
            },
            encodedDataLength: 200,
          },
          timestamp: 1000,
        },
      ],
      metadata: { totalRequests: 2, totalFailed: 0, totalBytes: 1200, startTime: 0, endTime: 0 },
      warnings: [],
    };
    const result = buildNetworkSummary(network);
    expect(result.totalRequests).toBe(2);
    expect(result.topRequestsByDuration).toHaveLength(2);
    // First should be the slowest (500ms)
    expect(result.topRequestsByDuration[0]!.url).toBe('https://example.com/slow.js');
    expect(result.topRequestsByDuration[0]!.duration).toBe(500);
    expect(result.topRequestsByDuration[0]!.bytes).toBe(1000);
    // Second should be faster
    expect(result.topRequestsByDuration[1]!.url).toBe('https://example.com/fast.css');
    expect(result.topRequestsByDuration[1]!.duration).toBe(50);
    expect(result.topRequestsByDuration[1]!.bytes).toBe(200);
    // Both are blocking resources
    expect(result.blockingResources).toHaveLength(2);
  });

  it('limits top requests to 20', () => {
    const requests = Array.from({ length: 30 }, (_, i) => ({
      requestId: `${i}`,
      url: `https://example.com/resource${i}.js`,
      method: 'GET',
      request: { headers: {} },
      response: {
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/javascript',
        timing: {
          requestTime: i,
          proxyStart: -1, proxyEnd: -1,
          dnsStart: -1, dnsEnd: -1,
          connectStart: -1, connectEnd: -1,
          sslStart: -1, sslEnd: -1,
          workerStart: -1, workerReady: -1,
          workerFetchStart: -1, workerRespondWithSettled: -1,
          pushStart: 0, pushEnd: 0,
          sendStart: 0, sendEnd: 0,
          receiveHeadersEnd: i * 10,
        },
        encodedDataLength: 100,
      },
      timestamp: i * 10,
    }));
    const network: NetworkRawData = {
      requests,
      metadata: { totalRequests: 30, totalFailed: 0, totalBytes: 3000, startTime: 0, endTime: 0 },
      warnings: [],
    };
    const result = buildNetworkSummary(network);
    expect(result.totalRequests).toBe(30);
    expect(result.topRequestsByDuration).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// buildLighthouseSummary
// ---------------------------------------------------------------------------

describe('buildLighthouseSummary', () => {
  it('returns empty categories when no lighthouse data', () => {
    const lighthouse: LighthouseRawData = {
      lhr: {},
      categories: [],
      warnings: [],
    };
    const result = buildLighthouseSummary(lighthouse);
    expect(Object.keys(result.categories)).toHaveLength(0);
    expect(result.failedInsightAudits).toHaveLength(0);
  });

  it('returns empty categories when lhr.categories is empty', () => {
    const lighthouse: LighthouseRawData = {
      lhr: { categories: {} },
      categories: [],
      warnings: [],
    };
    const result = buildLighthouseSummary(lighthouse);
    expect(Object.keys(result.categories)).toHaveLength(0);
  });

  it('extracts category scores correctly', () => {
    const lighthouse: LighthouseRawData = {
      lhr: {
        categories: {
          performance: { score: 0.85, title: 'Performance' },
          accessibility: { score: 0.92, title: 'Accessibility' },
          'best-practices': { score: 0.78, title: 'Best Practices' },
          seo: { score: 1.0, title: 'SEO' },
        },
      },
      categories: ['performance', 'accessibility', 'best-practices', 'seo'],
      warnings: [],
    };
    const result = buildLighthouseSummary(lighthouse);
    expect(result.categories).toEqual({
      performance: 0.85,
      accessibility: 0.92,
      'best-practices': 0.78,
      seo: 1.0,
    });
  });

  it('lists failed audits (score < 0.5)', () => {
    const lighthouse: LighthouseRawData = {
      lhr: {
        categories: { performance: { score: 0.5 } },
        audits: {
          'unused-javascript': { score: 0.2, title: 'Remove unused JavaScript' },
          'render-blocking-resources': { score: 0.1, title: 'Eliminate render-blocking resources' },
          'first-contentful-paint': { score: 0.8, title: 'First Contentful Paint' },
          'server-response-time': { score: 0.0, title: 'Initial server response time was slow' },
        },
      },
      categories: ['performance'],
      warnings: [],
    };
    const result = buildLighthouseSummary(lighthouse);
    expect(result.failedInsightAudits).toHaveLength(3);
    expect(result.failedInsightAudits[0]!.id).toBe('unused-javascript');
    expect(result.failedInsightAudits[0]!.score).toBe(0.2);
    expect(result.failedInsightAudits[1]!.id).toBe('render-blocking-resources');
    expect(result.failedInsightAudits[2]!.id).toBe('server-response-time');
    expect(result.failedInsightAudits[2]!.score).toBe(0.0);
  });

  it('handles missing title field in audit', () => {
    const lighthouse: LighthouseRawData = {
      lhr: {
        categories: {},
        audits: {
          'some-audit': { score: 0.3 },
        },
      },
      categories: [],
      warnings: [],
    };
    const result = buildLighthouseSummary(lighthouse);
    expect(result.failedInsightAudits).toHaveLength(1);
    expect(result.failedInsightAudits[0]!.id).toBe('some-audit');
    expect(result.failedInsightAudits[0]!.title).toBe('some-audit'); // fallback to id
  });
});

// ---------------------------------------------------------------------------
// buildCoverageSummary
// ---------------------------------------------------------------------------

describe('buildCoverageSummary', () => {
  it('returns empty for no coverage data', () => {
    const coverage: CoverageRawData = {
      js: [],
      css: [],
      warnings: [],
    };
    const result = buildCoverageSummary(coverage);
    expect(result.unusedBytesByUrl).toHaveLength(0);
  });

  it('returns empty when js and css are undefined (empty arrays)', () => {
    const coverage: CoverageRawData = {
      js: [],
      css: [],
      warnings: [],
    };
    const result = buildCoverageSummary(coverage);
    expect(result.unusedBytesByUrl).toHaveLength(0);
  });

  it('computes unused bytes for a single script', () => {
    const coverage: CoverageRawData = {
      js: [
        {
          scriptId: '1',
          url: 'https://example.com/app.js',
          functions: [
            {
              functionName: 'main',
              ranges: [{ startOffset: 0, endOffset: 200, count: 1 }],
              isBlockCoverage: false,
            },
            {
              functionName: 'unused',
              ranges: [], // never executed
              isBlockCoverage: false,
            },
            {
              functionName: 'helper',
              ranges: [{ startOffset: 100, endOffset: 150, count: 1 }],
              isBlockCoverage: false,
            },
          ],
        },
      ],
      css: [],
      warnings: [],
    };
    const result = buildCoverageSummary(coverage);
    expect(result.unusedBytesByUrl).toHaveLength(1);
    expect(result.unusedBytesByUrl[0]!.url).toBe('https://example.com/app.js');
    expect(result.unusedBytesByUrl[0]!.totalBytes).toBe(200);
    // Used: [0,200] ∪ [100,150] = [0,200] = 200 bytes
    expect(result.unusedBytesByUrl[0]!.unusedBytes).toBe(0);
    expect(result.unusedBytesByUrl[0]!.unusedPercentage).toBe(0);
  });

  it('detects unused code gaps between function ranges', () => {
    const coverage: CoverageRawData = {
      js: [
        {
          scriptId: '1',
          url: 'https://example.com/bundle.js',
          functions: [
            {
              functionName: 'header',
              ranges: [{ startOffset: 0, endOffset: 100, count: 1 }],
              isBlockCoverage: false,
            },
            {
              functionName: 'footer',
              ranges: [{ startOffset: 500, endOffset: 600, count: 1 }],
              isBlockCoverage: false,
            },
          ],
        },
      ],
      css: [],
      warnings: [],
    };
    const result = buildCoverageSummary(coverage);
    expect(result.unusedBytesByUrl).toHaveLength(1);
    expect(result.unusedBytesByUrl[0]!.totalBytes).toBe(600);
    // Used: [0,100] + [500,600] = 200 bytes
    expect(result.unusedBytesByUrl[0]!.unusedBytes).toBe(400);
    expect(result.unusedBytesByUrl[0]!.unusedPercentage).toBe(67);
  });

  it('handles overlapping ranges correctly', () => {
    const coverage: CoverageRawData = {
      js: [
        {
          scriptId: '1',
          url: 'https://example.com/overlap.js',
          functions: [
            {
              functionName: 'fn1',
              ranges: [{ startOffset: 0, endOffset: 100, count: 1 }],
              isBlockCoverage: false,
            },
            {
              functionName: 'fn2',
              ranges: [{ startOffset: 50, endOffset: 150, count: 1 }],
              isBlockCoverage: false,
            },
            {
              functionName: 'fn3',
              ranges: [{ startOffset: 100, endOffset: 200, count: 1 }],
              isBlockCoverage: false,
            },
          ],
        },
      ],
      css: [],
      warnings: [],
    };
    const result = buildCoverageSummary(coverage);
    expect(result.unusedBytesByUrl).toHaveLength(1);
    // Merged ranges: [0,200] (all overlap)
    expect(result.unusedBytesByUrl[0]!.totalBytes).toBe(200);
    expect(result.unusedBytesByUrl[0]!.unusedBytes).toBe(0);
  });

  it('includes CSS coverage data alongside JS', () => {
    const coverage: CoverageRawData = {
      js: [
        {
          scriptId: '1',
          url: 'https://example.com/app.js',
          functions: [
            {
              functionName: 'main',
              ranges: [{ startOffset: 0, endOffset: 100, count: 1 }],
              isBlockCoverage: false,
            },
          ],
        },
      ],
      css: [
        {
          styleSheetId: 's1',
          url: 'https://example.com/style.css',
          ranges: [
            { startOffset: 0, endOffset: 50, count: 1 },
            { startOffset: 200, endOffset: 400, count: 1 },
          ],
        },
      ],
      warnings: [],
    };
    const result = buildCoverageSummary(coverage);
    expect(result.unusedBytesByUrl).toHaveLength(2);
    // CSS has gap: [0,50] + [200,400], total = 400, used = 250, unused = 150
    const cssEntry = result.unusedBytesByUrl.find((e) => e.url === 'https://example.com/style.css')!;
    expect(cssEntry).toBeDefined();
    expect(cssEntry.totalBytes).toBe(400);
    expect(cssEntry.unusedBytes).toBe(150);
    expect(cssEntry.unusedPercentage).toBe(38);
  });

  it('sorts by unused bytes descending and limits to 10', () => {
    const scripts = Array.from({ length: 15 }, (_, i) => ({
      scriptId: `${i}`,
      url: `https://example.com/chunk${i}.js`,
      functions: [
        {
          functionName: 'main',
          ranges: [{ startOffset: 0, endOffset: (i + 1) * 100, count: 1 }],
          isBlockCoverage: false,
        },
      ],
    }));
    const coverage: CoverageRawData = {
      js: scripts,
      css: [],
      warnings: [],
    };
    const result = buildCoverageSummary(coverage);
    expect(result.unusedBytesByUrl).toHaveLength(10);
    // All have no unused code (single range covering everything)
    for (const entry of result.unusedBytesByUrl) {
      expect(entry.unusedBytes).toBe(0);
    }
  });

  it('handles scripts with functions but no ranges', () => {
    const coverage: CoverageRawData = {
      js: [
        {
          scriptId: '1',
          url: 'https://example.com/unused.js',
          functions: [
            {
              functionName: 'neverCalled',
              ranges: [],
              isBlockCoverage: false,
            },
          ],
        },
      ],
      css: [],
      warnings: [],
    };
    const result = buildCoverageSummary(coverage);
    expect(result.unusedBytesByUrl).toHaveLength(0);
  });

  it('uses fallback label for scripts without URL', () => {
    const coverage: CoverageRawData = {
      js: [
        {
          scriptId: '1',
          url: '',
          functions: [
            {
              functionName: 'main',
              ranges: [{ startOffset: 0, endOffset: 100, count: 1 }],
              isBlockCoverage: false,
            },
          ],
        },
      ],
      css: [],
      warnings: [],
    };
    const result = buildCoverageSummary(coverage);
    expect(result.unusedBytesByUrl).toHaveLength(1);
    expect(result.unusedBytesByUrl[0]!.url).toBe('(inline)');
  });
});
