/**
 * LCP-related causal rules.
 *
 * Chains covered:
 *   1. High TTFB → delayed HTML parse → delayed CSS discovery → blocked render → ↑LCP
 *   2. Render-blocking resources → blocked render → ↑LCP
 *   3. Slow LCP resource load → ↑LCP
 *
 * @packageDocumentation
 */

import type { FeatureSet } from '../../extract/types.js';
import type { Confidence, CausalNode, CausalEdge, Evidence } from '../types.js';

// ---------------------------------------------------------------------------
// Thresholds (Google Web Vitals + common perf engineering)
// ---------------------------------------------------------------------------

const TTFB_WARN = 800; // ms — needs improvement
const TTFB_CRIT = 2_500; // ms — poor
const LCP_WARN = 2_500; // ms
const LCP_CRIT = 4_000; // ms
const RESOURCE_DELAY_WARN = 500; // ms
const RENDER_DELAY_WARN = 500; // ms

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceFromDelta(
  value: number,
  warnThreshold: number,
  critThreshold: number,
): Confidence {
  if (value >= critThreshold) return 'strong';
  if (value >= warnThreshold) return 'medium';
  return 'weak';
}

function severityFromDelta(
  value: number,
  warnThreshold: number,
  critThreshold: number,
): 'warning' | 'critical' | undefined {
  if (value >= critThreshold) return 'critical';
  if (value >= warnThreshold) return 'warning';
  return undefined;
}

// ---------------------------------------------------------------------------
// Rule 1: TTFB → LCP chain
// ---------------------------------------------------------------------------

export const ttfbLcpChain = {
  id: 'lcp-ttfb-chain',
  label: 'TTFB → delayed HTML → blocked render → LCP',

  applies(features: FeatureSet): boolean {
    return features.lcpBreakdown?.ttfb != null && features.lcpBreakdown.ttfb > TTFB_WARN;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const ttfb = features.lcpBreakdown!.ttfb;
    const conf = confidenceFromDelta(ttfb, TTFB_WARN, TTFB_CRIT);
    const sev = severityFromDelta(ttfb, TTFB_WARN, TTFB_CRIT);

    const ttfbEvidence: Evidence = {
      metric: { name: 'TTFB', value: ttfb, unit: 'ms' },
    };

    const nodes: CausalNode[] = [
      {
        id: 'high-ttfb',
        label: 'TTFB exceeds normal threshold',
        type: 'metric',
        severity: sev,
        value: ttfb,
        unit: 'ms',
        threshold: TTFB_WARN,
        evidence: ttfbEvidence,
      },
      {
        id: 'delayed-html-parse',
        label: 'Delayed HTML parsing',
        type: 'bottleneck',
        severity: sev,
      },
      {
        id: 'delayed-css-discovery',
        label: 'Delayed CSS discovery',
        type: 'bottleneck',
        severity: sev,
      },
      {
        id: 'blocked-render',
        label: 'Render blocked',
        type: 'bottleneck',
        severity: 'warning',
      },
      {
        id: 'increased-lcp',
        label: 'Increased LCP',
        type: 'impact',
        severity: sev,
        value: features.lcpBreakdown?.totalLCP,
        unit: 'ms',
        threshold: LCP_WARN,
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'high-ttfb',
        target: 'delayed-html-parse',
        confidence: conf,
        label: 'High TTFB delays HTML parsing start',
        ruleId: 'lcp-ttfb-chain',
      },
      {
        source: 'delayed-html-parse',
        target: 'delayed-css-discovery',
        confidence: conf,
        label: 'HTML parsing needed for CSS resource discovery',
        ruleId: 'lcp-ttfb-chain',
      },
      {
        source: 'delayed-css-discovery',
        target: 'blocked-render',
        confidence: conf,
        label: 'CSS is critical for rendering (render-blocking by default)',
        ruleId: 'lcp-ttfb-chain',
      },
      {
        source: 'blocked-render',
        target: 'increased-lcp',
        confidence: conf,
        label: 'Blocked render increases LCP',
        ruleId: 'lcp-ttfb-chain',
      },
    ];

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Rule 2: Render-blocking resources → LCP
// ---------------------------------------------------------------------------

export const renderBlockingLcpChain = {
  id: 'lcp-render-blocking-chain',
  label: 'Render-blocking resources → blocked render → LCP',

  applies(features: FeatureSet): boolean {
    const rb = features.renderBlocking;
    return rb != null && rb.blockingRequestCount >= 2;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const rb = features.renderBlocking!;
    // Downgrade low-impact render-blocking (≤ 3 requests) to warning:
    // "Document + 2 small stylesheets" should not be critical
    const isHeavy = rb.renderBlockingScore > 0.5 && rb.blockingRequestCount > 3;

    const rbEvidence: Evidence = {
      urls: rb.resources?.map((r) => r.url),
    };
    const lcpRbEvidence: Evidence = {
      metric: features.lcpBreakdown?.totalLCP != null
        ? { name: 'LCP', value: features.lcpBreakdown.totalLCP, unit: 'ms' }
        : undefined,
    };

    const nodes: CausalNode[] = [
      {
        id: 'rb-resources',
        label: `${rb.blockingRequestCount} render-blocking resources`,
        type: 'metric',
        severity: isHeavy ? 'critical' : 'warning',
        value: rb.blockingRequestCount,
        unit: 'requests',
        threshold: 2,
        evidence: rbEvidence,
      },
      {
        id: 'blocked-render-rb',
        label: 'Render blocked (render-blocking)',
        type: 'bottleneck',
        severity: isHeavy ? 'critical' : 'warning',
      },
      {
        id: 'increased-lcp-rb',
        label: 'Increased LCP',
        type: 'impact',
        value: features.lcpBreakdown?.totalLCP,
        unit: 'ms',
        threshold: LCP_WARN,
        evidence: lcpRbEvidence.metric ? lcpRbEvidence : undefined,
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'rb-resources',
        target: 'blocked-render-rb',
        confidence: isHeavy ? 'strong' : 'medium',
        label: `Render-blocking resources block rendering`,
        ruleId: 'lcp-render-blocking-chain',
      },
      {
        source: 'blocked-render-rb',
        target: 'increased-lcp-rb',
        confidence: isHeavy ? 'strong' : 'medium',
        label: 'Render blocking directly increases LCP',
        ruleId: 'lcp-render-blocking-chain',
      },
    ];

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Rule 3: Slow LCP resource load delay
// ---------------------------------------------------------------------------

export const lcpResourceDelayChain = {
  id: 'lcp-resource-delay-chain',
  label: 'LCP resource delay → increased LCP',

  applies(features: FeatureSet): boolean {
    const lcp = features.lcpBreakdown;
    return lcp != null && (lcp.resourceLoadDelay > RESOURCE_DELAY_WARN || lcp.elementRenderDelay > RENDER_DELAY_WARN);
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const lcp = features.lcpBreakdown!;
    const isDelayed = lcp.resourceLoadDelay > RENDER_DELAY_WARN || lcp.resourceLoadTime > 1000;

    const delayEvidence: Evidence = {
      metric: { name: 'LCP resource delay', value: lcp.resourceLoadDelay, unit: 'ms' },
    };

    const nodes: CausalNode[] = [
      {
        id: 'lcp-resource-delay',
        label: `LCP resource delay: ${Math.round(lcp.resourceLoadDelay)}ms`,
        type: 'bottleneck',
        severity: isDelayed ? 'warning' : 'info',
        value: lcp.resourceLoadDelay,
        unit: 'ms',
        threshold: RESOURCE_DELAY_WARN,
        evidence: delayEvidence,
      },
      {
        id: 'increased-lcp-resource',
        label: 'Increased LCP',
        type: 'impact',
        value: lcp.totalLCP,
        unit: 'ms',
        threshold: LCP_WARN,
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'lcp-resource-delay',
        target: 'increased-lcp-resource',
        confidence: isDelayed ? 'medium' : 'weak',
        label: 'Slow LCP resource load increases total LCP',
        ruleId: 'lcp-resource-delay-chain',
      },
    ];

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Aggregated LCP rule list
// ---------------------------------------------------------------------------

export const lcpRules = [
  ttfbLcpChain,
  renderBlockingLcpChain,
  lcpResourceDelayChain,
];
