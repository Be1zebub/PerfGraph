import { describe, expect, it } from 'vitest';
import { buildInsights } from '../../src/distill/insights.js';
import type { FeatureSet } from '../../src/extract/types.js';

function features(overrides?: Partial<FeatureSet>): FeatureSet {
  return {
    lcpBreakdown: {
      ttfb: 120,
      resourceLoadDelay: 0,
      resourceLoadTime: 0,
      elementRenderDelay: 80,
      totalLCP: 200,
    },
    layoutShifts: {
      cls: 0,
      highComplexitySubtreeCount: 0,
      deepNesting: false,
      clusterScore: 0,
    },
    mainThreadBlocking: {
      blockingScore: 0.1,
      busyMs: 100,
      tbtMs: 20,
      idleMs: 900,
      blockingRatio: 0.1,
      categories: {},
    },
    ...overrides,
  };
}

describe('buildInsights data quality', () => {
  it('keeps measured TBT separate from main-thread busy time', () => {
    const result = buildInsights(features(), {
      lhr: {
        categories: { performance: { score: 1 } },
        audits: {},
      },
    });

    expect(result.metrics.tbtMs).toBe(20);
    expect(result.metrics.tbtStatus).toBe('measured');
    expect(result.dataQuality?.status).toBe('complete');
  });

  it('marks missing measurements as partial instead of substituting values', () => {
    const result = buildInsights(features({ mainThreadBlocking: undefined }), {});

    expect(result.metrics.tbtMs).toBeUndefined();
    expect(result.dataQuality?.status).toBe('partial');
    expect(result.dataQuality?.warnings).toContain('Main-thread data is unavailable.');
  });

  it('keeps the lab LCP and the Lighthouse LCP as separate values', () => {
    const result = buildInsights(features(), {
      lhr: {
        audits: {
          'largest-contentful-paint': { numericValue: 4000 },
        },
      },
    });

    // The lab run measured 200 ms, Lighthouse reported 4000 ms in its own
    // throttled run. Neither value may overwrite the other.
    expect(result.metrics.lcpMs).toBe(200);
    expect(result.metrics.lcpSource).toBe('trace');
    expect(result.lighthouse.lcpMs).toBe(4000);
  });

  it('falls back to FeatureSet render-blocking evidence when Lighthouse has none', () => {
    const result = buildInsights(features({
      renderBlocking: {
        blockingRequestCount: 1,
        blockingBytes: 100,
        blockingDuration: 50,
        renderBlockingScore: 0.95,
        resources: [{ url: 'https://example.com/style.css', resourceType: 'Stylesheet' }],
      },
    }), {});

    expect(result.renderBlocking).toEqual([
      {
        url: 'https://example.com/style.css',
        bytes: undefined,
        wastedMs: undefined,
        resourceType: 'Stylesheet',
      },
    ]);
  });
});
