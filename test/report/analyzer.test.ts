/**
 * Report Analyzer tests.
 *
 * Tests cover:
 * - Full FeatureSet + CausalGraph → valid Report
 * - Report structure and schema validation
 * - Issue sorting (critical first)
 * - Causal chain extraction from the DAG
 * - Score computation (good/moderate/poor)
 * - Remediation text assignment
 * - Recommendations generation
 * - Empty/minimal graphs
 * - Edge cases: single-node, two-node chains
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import { buildCausalGraph } from '../../src/causal/builder.js';
import { buildReport, hasActionableIssues } from '../../src/report/index.js';
import { ReportSchema } from '../../src/report/types.js';
import type { FeatureSet } from '../../src/extract/types.js';
import type { CausalGraph } from '../../src/causal/types.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function baseFeatures(overrides?: Partial<FeatureSet>): FeatureSet {
  return {
    lcpBreakdown: {
      ttfb: 200,
      resourceLoadDelay: 100,
      resourceLoadTime: 300,
      elementRenderDelay: 50,
      totalLCP: 650,
    },
    criticalPath: {
      totalChainLength: 3,
      requestCount: 10,
      blockingCount: 2,
      nonBlockingCount: 8,
      deepestChainDepth: 3,
      longestSingleRequest: 450,
    },
    mainThreadBlocking: {
      blockingScore: 0.1,
      busyMs: 100,
      idleMs: 900,
      blockingRatio: 0.1,
      categories: { scripting: 60, layout: 20, other: 20 },
    },
    jsHotspots: {
      bootupTime: 800,
      evaluatedScripts: 25,
      longTaskCount: 2,
      maxBlockingDuration: 80,
      contextCount: 5,
    },
    layoutShifts: {
      cls: 0.05,
      highComplexitySubtreeCount: 2,
      deepNesting: false,
      clusterScore: 0.1,
    },
    thirdPartyOverhead: {
      totalThirdPartyRequests: 5,
      totalThirdPartyBytes: 100_000,
      totalThirdPartyDuration: 500,
      firstPartyBytes: 500_000,
      firstPartyRequests: 20,
      thirdPartyRatio: 0.2,
      byCategory: {},
    },
    renderBlocking: {
      blockingRequestCount: 1,
      blockingBytes: 20_000,
      blockingDuration: 300,
      renderBlockingScore: 0.2,
    },
    ...overrides,
  };
}

function criticalFeatures(): FeatureSet {
  return baseFeatures({
    lcpBreakdown: {
      ttfb: 1200,
      resourceLoadDelay: 600,
      resourceLoadTime: 2000,
      elementRenderDelay: 400,
      totalLCP: 4200,
    },
    criticalPath: {
      totalChainLength: 15,
      requestCount: 40,
      blockingCount: 8,
      nonBlockingCount: 32,
      deepestChainDepth: 12,
      longestSingleRequest: 1200,
    },
    mainThreadBlocking: {
      blockingScore: 0.7,
      busyMs: 1200,
      idleMs: 300,
      blockingRatio: 0.8,
      categories: { scripting: 800, layout: 200, other: 200 },
    },
    jsHotspots: {
      bootupTime: 3500,
      evaluatedScripts: 45,
      longTaskCount: 12,
      maxBlockingDuration: 350,
      contextCount: 8,
    },
    renderBlocking: {
      blockingRequestCount: 5,
      blockingBytes: 100_000,
      blockingDuration: 1200,
      renderBlockingScore: 0.7,
      resources: [
        { url: 'https://example.com/style.css', totalBytes: 50_000, wastedMs: 600, resourceType: 'Stylesheet' },
        { url: 'https://example.com/print.css', totalBytes: 20_000, wastedMs: 300, resourceType: 'Stylesheet' },
        { url: 'https://example.com/theme.css', totalBytes: 30_000, wastedMs: 300, resourceType: 'Stylesheet' },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildReport', () => {
  it('produces a valid Report from a full FeatureSet', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    // Schema validation
    const parsed = ReportSchema.safeParse(report);
    expect(parsed.success, 'Report must pass Zod schema validation').toBe(true);

    // Meta
    expect(report.meta.reportVersion).toBe('1.0.0');
    expect(report.meta.graphNodeCount).toBeGreaterThan(0);
    expect(report.meta.graphEdgeCount).toBeGreaterThan(0);

    // Summary
    expect(report.summary.score).toBeDefined();
    expect(typeof report.summary.criticalIssues).toBe('number');
    expect(typeof report.summary.warnings).toBe('number');

    // Issues
    expect(report.issues.length).toBeGreaterThan(0);

    // Chains
    expect(report.chains.length).toBeGreaterThan(0);

    // Recommendations
    expect(report.recommendations.length).toBeGreaterThan(0);

    // Features passthrough
    expect(report.features).toBe(features);
  });

  it('sorts issues by severity (critical first, then warning, then info)', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < report.issues.length; i++) {
      const prev = sevOrder[report.issues[i - 1]!.severity] ?? 3;
      const curr = sevOrder[report.issues[i]!.severity] ?? 3;
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it('assigns remediation text to every issue', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    for (const issue of report.issues) {
      expect(issue.remediation).toBeTruthy();
      expect(issue.remediation.length).toBeGreaterThan(10);
    }
  });

  it('extracts causal chains from the graph', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    for (const chain of report.chains) {
      expect(chain.rootCause).toBeTruthy();
      expect(chain.impact).toBeTruthy();
      expect(chain.path.length).toBe(chain.length);
      expect(chain.path.length).toBeGreaterThanOrEqual(2);
      expect(chain.confidence).toMatch(/^(strong|medium|weak)$/);
    }
  });

  it('computes score=poor when there are critical issues', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    expect(report.summary.score).toBe('poor');
    expect(report.summary.criticalIssues).toBeGreaterThan(0);
  });

  it('computes score=moderate with only warnings', () => {
    const features = baseFeatures({
      renderBlocking: {
        blockingRequestCount: 3,
        blockingBytes: 40_000,
        blockingDuration: 500,
        renderBlockingScore: 0.4,
      },
      criticalPath: {
        totalChainLength: 8,
        requestCount: 25,
        blockingCount: 4,
        nonBlockingCount: 21,
        deepestChainDepth: 7,
        longestSingleRequest: 600,
      },
    });
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    expect(report.summary.score).toBe('moderate');
    expect(report.summary.criticalIssues).toBe(0);
    expect(report.summary.warnings).toBeGreaterThan(0);
  });

  it('computes score=good with no critical or warning issues', () => {
    const features = baseFeatures(); // all values below thresholds
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    expect(report.summary.score).toBe('good');
    expect(report.summary.criticalIssues).toBe(0);
    expect(report.summary.warnings).toBe(0);
  });

  it('generates recommendations from critical and warning issues', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    expect(report.recommendations.length).toBeGreaterThan(0);

    for (const rec of report.recommendations) {
      expect(rec.priority).toMatch(/^(critical|high|medium|low)$/);
      expect(rec.category).toBeTruthy();
      expect(rec.title).toBeTruthy();
      expect(rec.action).toBeTruthy();
      expect(rec.relatedIssues).toBeInstanceOf(Array);
    }
  });

  it('sorts recommendations by priority (critical first)', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    const prioOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < report.recommendations.length; i++) {
      const prev = prioOrder[report.recommendations[i - 1]!.priority] ?? 4;
      const curr = prioOrder[report.recommendations[i]!.priority] ?? 4;
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it('topIssues contains up to 5 items', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    expect(report.summary.topIssues.length).toBeGreaterThan(0);
    expect(report.summary.topIssues.length).toBeLessThanOrEqual(5);
  });

  it('produces chains with valid path ordering', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    for (const chain of report.chains) {
      for (let i = 0; i < chain.path.length; i++) {
        expect(chain.path[i]!.nodeId).toBeTruthy();
        expect(chain.path[i]!.label).toBeTruthy();
      }
      // First node should be a source (metric or bottleneck)
      expect(chain.path[0]!.type).toMatch(/^(metric|bottleneck)$/);
    }
  });

  it('hasActionableIssues returns true with critical/warning issues', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    expect(hasActionableIssues(report)).toBe(true);
  });

  it('hasActionableIssues returns false with only info issues', () => {
    const features = baseFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    expect(hasActionableIssues(report)).toBe(false);
  });

  it('handles empty FeatureSet gracefully', () => {
    const features: FeatureSet = {};
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    expect(report.summary.score).toBe('good');
    expect(report.issues.length).toBe(0);
    expect(report.chains.length).toBe(0);
    expect(report.recommendations.length).toBe(0);
  });

  it('handles graph with a single chain correctly', () => {
    const features = baseFeatures({
      renderBlocking: {
        blockingRequestCount: 4,
        blockingBytes: 50_000,
        blockingDuration: 800,
        renderBlockingScore: 0.6,
      },
    });
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    const rbChain = report.chains.find((c) => c.id.includes('lcp-render-blocking'));
    expect(rbChain).toBeDefined();
    expect(rbChain!.path.length).toBeGreaterThanOrEqual(2);
  });

  it('includes evidence payloads on nodes that have them', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    // rb-resources should have evidence with URLs
    const rbIssue = report.issues.find((i) => i.id === 'rb-resources');
    expect(rbIssue).toBeDefined();
    expect(rbIssue!.evidence).toBeDefined();
    expect(rbIssue!.evidence!.urls).toBeInstanceOf(Array);
    expect(rbIssue!.evidence!.urls!.length).toBeGreaterThan(0);

    // rb-resources remediation should include the evidence URLs
    const rbUrl = rbIssue!.evidence!.urls![0];
    expect(rbIssue!.remediation).toContain(rbUrl);

    // high-ttfb should have evidence with metric
    const ttfbIssue = report.issues.find((i) => i.id === 'high-ttfb');
    expect(ttfbIssue).toBeDefined();
    expect(ttfbIssue!.evidence).toBeDefined();
    expect(ttfbIssue!.evidence!.metric).toBeDefined();
    expect(ttfbIssue!.evidence!.metric!.name).toBe('TTFB');
    expect(ttfbIssue!.evidence!.metric!.value).toBe(1200);
    expect(ttfbIssue!.evidence!.metric!.unit).toBe('ms');

    // high-ttfb remediation should include the metric value
    expect(ttfbIssue!.remediation).toContain('1200');
    expect(ttfbIssue!.remediation).toContain('ms');

    // high-main-thread-blocking should have evidence with metric
    const mtbIssue = report.issues.find((i) => i.id === 'high-main-thread-blocking');
    expect(mtbIssue).toBeDefined();
    expect(mtbIssue!.evidence).toBeDefined();
    expect(mtbIssue!.evidence!.metric).toBeDefined();
    expect(mtbIssue!.evidence!.metric!.name).toBe('Main thread blocking');
    expect(mtbIssue!.evidence!.metric!.unit).toBe('ms');

    // high-main-thread-blocking remediation should include the metric value
    expect(mtbIssue!.remediation).toContain('ms');
  });

  it('includes features passthrough in the report', () => {
    const features = criticalFeatures();
    const graph = buildCausalGraph(features);
    const report = buildReport(graph, features);

    expect(report.features).toBeDefined();
    if (features.lcpBreakdown) {
      const reportFeatures = report.features as FeatureSet;
      expect(reportFeatures.lcpBreakdown?.totalLCP).toBe(
        features.lcpBreakdown.totalLCP,
      );
    }
  });
});
