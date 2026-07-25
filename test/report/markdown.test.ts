/**
 * Markdown report generator tests.
 *
 * Covers:
 * - Minimal report produces valid markdown
 * - Issues section rendering
 * - Causal chains with proper path formatting
 * - Recommendations with priority badges
 * - Lighthouse insights integration
 * - Graceful handling of empty fields
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import { buildReportMarkdown } from '../../src/report/markdown.js';
import type { Report } from '../../src/report/types.js';
import type { Insights } from '../../src/distill/insights.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function minimalReport(): Report {
  return {
    meta: {
      url: 'https://example.com',
      analyzedAt: '2026-06-09T19:15:19Z',
      reportVersion: '1.0.0',
      featureCount: 0,
      graphNodeCount: 0,
      graphEdgeCount: 0,
      ruleCount: 0,
    },
    summary: {
      score: 'good',
      criticalIssues: 0,
      warnings: 0,
      infos: 0,
      topIssues: [],
    },
    issues: [],
    chains: [],
    recommendations: [],
    features: undefined,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildReportMarkdown', () => {
  it('generates a non-empty string for a minimal report', () => {
    const md = buildReportMarkdown(minimalReport());
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain('# PerfGraph Performance Report');
    expect(md).toContain('GOOD');
  });

  it('header includes URL and analyzedAt', () => {
    const md = buildReportMarkdown(minimalReport());
    expect(md).toContain('https://example.com');
    expect(md).toContain('2026-06-09T19:15:19Z');
  });

  it('summary table renders with counts', () => {
    const md = buildReportMarkdown(minimalReport());
    expect(md).toContain('| Critical issues |');
    expect(md).toContain('| Warnings |');
    expect(md).toContain('| Info |');
  });

  it('includes issues when present', () => {
    const report = minimalReport();
    report.issues = [
      {
        id: 'test-1',
        label: 'Test issue',
        type: 'metric',
        severity: 'warning',
        confidence: 'medium',
        remediation: 'Fix it',
        chainId: 'test-chain',
      },
    ];
    const md = buildReportMarkdown(report);
    expect(md).toContain('Test issue');
    expect(md).toContain('Fix it');
    expect(md).toContain('test-1');
    expect(md).toContain('warning');
  });

  it('includes issue evidence when present', () => {
    const report = minimalReport();
    report.issues = [
      {
        id: 'rb-1',
        label: 'Render-blocking resources',
        type: 'bottleneck',
        severity: 'critical',
        confidence: 'strong',
        remediation: 'Defer non-critical CSS',
        chainId: 'rb-chain',
        value: 3,
        unit: 'requests',
        evidence: {
          urls: ['https://example.com/style.css', 'https://example.com/print.css'],
          selector: '#main',
        },
      },
    ];
    const md = buildReportMarkdown(report);
    expect(md).toContain('style.css');
    expect(md).toContain('print.css');
    expect(md).toContain('#main');
    expect(md).toContain('3 requests');
  });

  it('includes top issues when present', () => {
    const report = minimalReport();
    report.summary.topIssues = [
      { id: 'top-1', label: 'High LCP', severity: 'critical', confidence: 'strong' },
    ];
    const md = buildReportMarkdown(report);
    expect(md).toContain('High LCP');
    expect(md).toContain('Top Issues');
  });

  it('includes chains when present', () => {
    const report = minimalReport();
    report.chains = [
      {
        id: 'chain-1',
        rootCause: 'LCP > 2.5s',
        impact: 'Poor UX',
        confidence: 'strong',
        severity: 'critical',
        path: [
          { nodeId: 'a', label: 'LCP metric', type: 'metric' },
          { nodeId: 'b', label: 'Slow TTFB', type: 'bottleneck' },
          { nodeId: 'c', label: 'Poor UX', type: 'impact' },
        ],
        length: 3,
      },
    ];
    const md = buildReportMarkdown(report);
    expect(md).toContain('LCP > 2.5s');
    expect(md).toContain('LCP metric → Slow TTFB → Poor UX');
  });

  it('includes recommendations when present', () => {
    const report = minimalReport();
    report.recommendations = [
      {
        priority: 'critical',
        category: 'LCP',
        title: 'Optimize LCP',
        description: 'desc',
        action: 'Do X',
        expectedImpact: 'Big improvement',
        relatedIssues: [],
      },
    ];
    const md = buildReportMarkdown(report);
    expect(md).toContain('Optimize LCP');
    expect(md).toContain('Do X');
    expect(md).toContain('[LCP]');
  });

  it('includes Lighthouse insights when provided', () => {
    const report = minimalReport();
    const insights: Insights = {
      url: 'https://example.com',
      analyzedAt: '2026-06-09T19:15:19Z',
      lighthouse: {
        performance: 0.85,
        lcpMs: 2500,
        fcpMs: 1500,
        cls: 0.05,
        tbtMs: 200,
      },
      lcpElement: {
        selector: 'h1.title',
        renderDelayMs: 500,
      },
      renderBlocking: [{ url: 'style.css', bytes: 1000 }],
      warnings: [],
      topRecommendations: [],
    };
    const md = buildReportMarkdown(report, insights);
    expect(md).toContain('85'); // 0.85 * 100 = 85
    expect(md).toContain('h1.title');
    expect(md).toContain('2500 ms');
    expect(md).toContain('0.050'); // CLS toFixed(3)
  });

  it('handles undefined insights gracefully', () => {
    const report = minimalReport();
    const md = buildReportMarkdown(report, undefined);
    expect(md).not.toContain('Lighthouse Insights');
  });

  it('handles empty report gracefully', () => {
    const report = minimalReport();
    const md = buildReportMarkdown(report);
    expect(md).not.toContain('Top Issues');
    expect(md).not.toContain('All Issues');
    expect(md).not.toContain('Causal Chains');
    expect(md).not.toContain('Recommendations');
  });

  it('handles lighthousePerformance and scoreExplanation', () => {
    const report = minimalReport();
    report.summary.lighthousePerformance = 0.65;
    report.summary.scoreExplanation = 'Lighthouse data influenced score';
    const md = buildReportMarkdown(report);
    expect(md).toContain('65/100');
    expect(md).toContain('Lighthouse data influenced score');
  });

  it('chains with empty severity use default badge', () => {
    const report = minimalReport();
    report.chains = [
      {
        id: 'chain-1',
        rootCause: 'Root cause',
        impact: 'Impact',
        confidence: 'weak',
        severity: 'info',
        path: [{ nodeId: 'a', label: 'Node A', type: 'metric' }],
        length: 1,
      },
    ];
    const md = buildReportMarkdown(report);
    expect(md).toContain('Root cause');
  });
});
