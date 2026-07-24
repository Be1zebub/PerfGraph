/**
 * TST-03: E2E Feature Extraction tests.
 *
 * Validates the full extract() pipeline against known fixture data:
 * - Produces a FeatureSet with the expected shape
 * - Returns deterministic output for identical input
 * - All optional features degrade gracefully when data is absent
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import { extract } from '../../src/extract/index.js';
import { FeatureSetSchema } from '../../src/extract/types.js';
import { IRBundleSchema, type IRBundle } from '../../src/normalize/types.js';

describe('E2E extract pipeline (TST-03)', () => {
  let bundle: IRBundle;

  beforeAll(() => {
    const raw = loadFixture('fixtures', 'ir', 'e2e-bundle.json') as unknown;
    const parsed = IRBundleSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Test fixture e2e-bundle.json is not a valid IRBundle: ${parsed.error.issues[0]?.message}`,
      );
    }
    bundle = parsed.data;
  });

  it('produces a valid FeatureSet from IRBundle fixture', () => {
    const features = extract(bundle);
    const result = FeatureSetSchema.safeParse(features);
    expect(result.success).toBe(true);
  });

  it('produces deterministic output for identical input', () => {
    const a = extract(bundle);
    const b = extract(bundle);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('populates all feature fields (no undefined feature when data is present)', () => {
    const features = extract(bundle);
    // All 7 top-level features should be present from the fixture
    expect(features.lcpBreakdown).toBeDefined();
    expect(features.criticalPath).toBeDefined();
    expect(features.mainThreadBlocking).toBeDefined();
    expect(features.jsHotspots).toBeDefined();
    expect(features.layoutShifts).toBeDefined();
    expect(features.thirdPartyOverhead).toBeDefined();
    expect(features.renderBlocking).toBeDefined();
  });

  it('LCP breakdown has valid structure', () => {
    const features = extract(bundle);
    const lcp = features.lcpBreakdown!;
    expect(lcp.ttfb).toBeGreaterThanOrEqual(0);
    expect(lcp.resourceLoadDelay).toBeGreaterThanOrEqual(0);
    expect(lcp.resourceLoadTime).toBeGreaterThanOrEqual(0);
    expect(lcp.elementRenderDelay).toBeGreaterThanOrEqual(0);
    expect(lcp.totalLCP).toBeGreaterThan(0);
  });

  it('critical path has valid structure', () => {
    const features = extract(bundle);
    const cp = features.criticalPath!;
    expect(cp.totalChainLength).toBeGreaterThanOrEqual(0);
    expect(cp.requestCount).toBeGreaterThan(0);
    expect(cp.blockingCount + cp.nonBlockingCount).toBe(cp.requestCount);
  });

  it('main thread blocking has valid structure', () => {
    const features = extract(bundle);
    const mt = features.mainThreadBlocking!;
    expect(mt.blockingScore).toBeGreaterThanOrEqual(0);
    expect(mt.blockingScore).toBeLessThanOrEqual(1);
    expect(mt.busyMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(mt.categories).length).toBeGreaterThan(0);
  });

  it('JS hotspots has valid structure', () => {
    const features = extract(bundle);
    const js = features.jsHotspots!;
    expect(js.bootupTime).toBeGreaterThanOrEqual(0);
    expect(js.contextCount).toBeGreaterThan(0);
  });

  it('layout shifts has valid structure', () => {
    const features = extract(bundle);
    const ls = features.layoutShifts!;
    expect(ls.clusterScore).toBeGreaterThanOrEqual(0);
    expect(ls.clusterScore).toBeLessThanOrEqual(1);
  });

  it('third-party overhead has valid structure', () => {
    const features = extract(bundle);
    const tp = features.thirdPartyOverhead!;
    expect(tp.totalThirdPartyRequests).toBeGreaterThanOrEqual(0);
    expect(tp.thirdPartyRatio).toBeGreaterThanOrEqual(0);
    expect(tp.thirdPartyRatio).toBeLessThanOrEqual(1);
  });

  it('render blocking has valid structure', () => {
    const features = extract(bundle);
    const rb = features.renderBlocking!;
    expect(rb.renderBlockingScore).toBeGreaterThanOrEqual(0);
    expect(rb.renderBlockingScore).toBeLessThanOrEqual(1);
  });

  it('gracefully degrades on minimal IRBundle', () => {
    const minimal: IRBundle = {
      meta: { url: 'https://example.com', fetchedAt: '2025-01-01T00:00:00Z', navigationStart: 0, irVersion: '1.0.0' },
      performance: {
        navigation: { url: 'https://example.com', navigationStart: 0, domContentLoaded: 0, domContentLoadedEventEnd: 0, loadEventStart: 0, loadEventEnd: 0, domInteractive: 0 },
        coreWebVitals: {},
        traceSummary: { totalDuration: 0, eventCount: 0, categories: {}, threadActivity: { totalMs: 0, byCategory: {} } },
        mainThreadBusyness: 0,
      },
      network: {
        requests: [],
        summary: { totalRequests: 0, totalBytes: 0, byType: {}, byPriority: {}, criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] }, longestChain: { url: '', length: 0 } },
      },
      runtime: { executionContexts: [] },
      dom: {
        stats: { totalNodes: 0, elementCount: 0, maxDepth: 0, maxChildren: 0 },
        tagDistribution: [],
        layoutShiftCandidates: { highComplexitySubtrees: 0, deepNesting: 0 },
      },
      lighthouse: { categories: {}, failedAudits: [], scores: {} },
    };

    const features = extract(minimal);
    const result = FeatureSetSchema.safeParse(features);
    expect(result.success).toBe(true);
    // Most fields should be undefined when data is absent
    expect(features.lcpBreakdown).toBeUndefined();
    expect(features.criticalPath).toBeUndefined();
    expect(features.mainThreadBlocking).toBeUndefined();
    expect(features.thirdPartyOverhead).toBeUndefined();
    expect(features.renderBlocking).toBeUndefined();
    // These always return data
    expect(features.jsHotspots).toBeDefined();
    expect(features.layoutShifts).toBeDefined();
  });
});
