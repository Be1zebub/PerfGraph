import { describe, expect, it } from 'vitest';
import { buildCausalGraph } from '../../src/causal/builder.js';
import { buildReport } from '../../src/report/analyzer.js';
import { buildInsights } from '../../src/distill/insights.js';
import type { FeatureSet } from '../../src/extract/types.js';

function baseFeatures(): FeatureSet {
  return {
    lcpBreakdown: {
      ttfb: 200,
      resourceLoadDelay: 0,
      resourceLoadTime: 0,
      elementRenderDelay: 100,
      totalLCP: 300,
      lcpElement: { selector: 'p' },
      source: 'trace',
    },
    layoutShifts: {
      cls: 0,
      highComplexitySubtreeCount: 0,
      deepNesting: false,
      clusterScore: 0,
    },
    mainThreadBlocking: {
      blockingScore: 0.05,
      busyMs: 40,
      tbtMs: 10,
      idleMs: 900,
      blockingRatio: 0.05,
      categories: {},
    },
    renderBlocking: {
      blockingRequestCount: 0,
      blockingBytes: 0,
      blockingDuration: 0,
      renderBlockingScore: 1,
    },
  };
}

function reportFor(features: FeatureSet) {
  const graph = buildCausalGraph(features);
  return { graph, report: buildReport(graph, features) };
}

describe('diagnostic quality regression fixtures', () => {
  it('treats a minimal HTML page as healthy without CSS inference', () => {
    const features = baseFeatures();
    features.lcpBreakdown!.ttfb = 900;
    features.lcpBreakdown!.totalLCP = 900;

    const { graph, report } = reportFor(features);
    const ids = graph.nodes.map((node) => node.id);

    expect(ids).not.toContain('delayed-css-discovery');
    expect(ids).not.toContain('blocked-render');
    expect(report.recommendations.map((rec) => rec.category)).not.toContain('JavaScript');
    expect(report.summary.dataQuality?.status).toBe('complete');
    expect(report.summary.score).toBe('good');
    expect(graph.nodes.every((node) => node.basis)).toBe(true);
    expect(report.chains.flatMap((chain) => chain.path).every((node) => node.basis)).toBe(true);
    expect(report.issues.every((issue) => issue.findingStatus && issue.impactSurface)).toBe(true);
  });

  it('only creates CSS causal nodes when stylesheet evidence exists', () => {
    const features = baseFeatures();
    features.lcpBreakdown!.ttfb = 1200;
    features.renderBlocking = {
      blockingRequestCount: 1,
      blockingBytes: 5000,
      blockingDuration: 200,
      renderBlockingScore: 0.95,
      resources: [{ url: 'https://example.com/app.css', resourceType: 'Stylesheet' }],
    };

    const { graph } = reportFor(features);
    const ids = graph.nodes.map((node) => node.id);

    expect(ids).toContain('delayed-css-discovery');
    expect(ids).toContain('blocked-render');
  });

  it('keeps measured TBT distinct from main-thread busy time', () => {
    const features = baseFeatures();
    features.mainThreadBlocking = {
      blockingScore: 0.8,
      busyMs: 2400,
      tbtMs: 700,
      idleMs: 300,
      blockingRatio: 0.8,
      categories: { scripting: 700 },
    };

    const { graph } = reportFor(features);
    const tbt = graph.nodes.find((node) => node.id === 'high-tbt');
    const busy = graph.nodes.find((node) => node.id === 'high-main-thread-blocking');

    expect(tbt?.value).toBe(700);
    expect(tbt?.evidence?.metric?.name).toBe('Total Blocking Time');
    expect(busy?.value).toBe(2400);
    expect(busy?.evidence?.metric?.name).toBe('Main thread busy time');
  });

  it('does not emit image remediation for a text LCP element', () => {
    const features = baseFeatures();
    features.lcpBreakdown = {
      ...features.lcpBreakdown!,
      ttfb: 900,
      totalLCP: 5000,
      lcpElement: { selector: 'h1.hero-title', nodeLabel: 'H1' },
    };
    const { report } = reportFor(features);
    const lcpIssue = report.issues.find((issue) => issue.id === 'increased-lcp');
    expect(lcpIssue?.remediation).toContain('not an image');
    expect(lcpIssue?.remediation).not.toContain('WebP');
  });

  it('preserves independent CLS and network signals', () => {
    const features = baseFeatures();
    features.layoutShifts = {
      cls: 0.3,
      highComplexitySubtreeCount: 0,
      deepNesting: false,
      clusterScore: 0.7,
    };
    features.criticalPath = {
      totalChainLength: 4000,
      requestCount: 60,
      blockingCount: 6,
      nonBlockingCount: 54,
      deepestChainDepth: 8,
      longestSingleRequest: 1200,
      urlsOnLongestPath: ['https://example.com/', 'https://example.com/app.js'],
    };

    const { report } = reportFor(features);
    const chainRules = report.chains.map((chain) => chain.id);

    expect(chainRules.some((id) => id.startsWith('layout-shift-cluster-chain'))).toBe(true);
    expect(chainRules.some((id) => id.startsWith('net-critical-path-chain'))).toBe(true);
    expect(report.summary.criticalIssues).toBeGreaterThan(0);
  });

  it('marks incomplete input as partial and never invents metrics', () => {
    const { graph, report } = reportFor({});

    expect(graph.nodes).toHaveLength(0);
    expect(report.summary.dataQuality?.status).toBe('partial');
    expect(report.summary.dataQuality?.warnings.length).toBeGreaterThan(0);
    expect(report.summary.score).toBe('good');
  });

  it('keeps report and insights on the same metric and quality contract', () => {
    const features = baseFeatures();
    const { report } = reportFor(features);
    const insights = buildInsights(features, {});

    expect(insights.metrics.lcpMs).toBe(features.lcpBreakdown!.totalLCP);
    expect(insights.metrics.tbtMs).toBe(features.mainThreadBlocking!.tbtMs);
    expect(insights.dataQuality?.status).toBe(report.summary.dataQuality?.status);
    expect(insights.renderBlocking).toHaveLength(0);
  });
});
