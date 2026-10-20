/**
 * LCP-related causal rules.
 *
 * Chains covered:
 *   1. High TTFB → delayed HTML parse → (CSS discovery → blocked render) → ↑LCP
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

  /**
   * CSS and render-blocking nodes require resource-level evidence. A high TTFB
   * alone proves delayed response delivery, not that this page has CSS to
   * discover or a render-blocking resource to wait for.
   */
  hasStylesheetEvidence(features: FeatureSet): boolean {
    return features.renderBlocking?.resources?.some(
      (resource) => resource.resourceType === 'Stylesheet',
    ) ?? false;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const ttfb = features.lcpBreakdown!.ttfb;
    const conf = confidenceFromDelta(ttfb, TTFB_WARN, TTFB_CRIT);
    const sev = severityFromDelta(ttfb, TTFB_WARN, TTFB_CRIT);

    const ttfbEvidence: Evidence = {
      metric: {
        name: 'TTFB',
        value: ttfb,
        unit: 'ms',
        source: features.lcpBreakdown?.source ?? 'trace',
        method: 'LCP breakdown TTFB component',
      },
      ttfbParts: features.lcpBreakdown?.ttfbParts,
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
        impactSurface: 'lcp',
        evidence: ttfbEvidence,
      },
      {
        id: 'delayed-html-parse',
        label: 'Delayed HTML parsing',
        type: 'bottleneck',
        severity: sev,
        impactSurface: 'lcp',
      },
      {
        id: 'increased-lcp',
        label: 'Increased LCP',
        type: 'impact',
        // The severity of the impact follows the LCP itself, not the TTFB that
        // triggered the chain. A chain must not turn a healthy LCP into a
        // warning.
        severity:
          features.lcpBreakdown?.totalLCP !== undefined
            ? severityFromDelta(features.lcpBreakdown.totalLCP, LCP_WARN, LCP_CRIT)
            : sev,
        value: features.lcpBreakdown?.totalLCP,
        unit: 'ms',
        threshold: LCP_WARN,
        impactSurface: 'lcp',
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
    ];

    if (ttfbLcpChain.hasStylesheetEvidence(features)) {
      nodes.splice(2, 0,
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
      );
      edges.push(
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
          label: 'Stylesheet evidence indicates a render dependency',
          ruleId: 'lcp-ttfb-chain',
        },
        {
          source: 'blocked-render',
          target: 'increased-lcp',
          confidence: conf,
          label: 'Render dependency can increase LCP',
          ruleId: 'lcp-ttfb-chain',
        },
      );
    } else {
      edges.push({
        source: 'delayed-html-parse',
        target: 'increased-lcp',
        confidence: 'weak',
        label: 'Delayed response may reduce time available before LCP',
        ruleId: 'lcp-ttfb-chain',
      });
    }

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
    const lcpImpactVerified = rb.lcpSavingsMs != null && rb.lcpSavingsMs > 0;

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
        findingStatus: lcpImpactVerified ? 'verified' : 'suspected',
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'rb-resources',
        target: 'blocked-render-rb',
        confidence: isHeavy ? 'strong' : 'medium',
        label: `Render-blocking resources block rendering`,
        ruleId: 'lcp-render-blocking-chain',
        evidence: lcpImpactVerified ? lcpRbEvidence : undefined,
      },
      {
        source: 'blocked-render-rb',
        target: 'increased-lcp-rb',
        confidence: isHeavy ? 'strong' : 'medium',
        label: 'Render blocking directly increases LCP',
        ruleId: 'lcp-render-blocking-chain',
        evidence: lcpImpactVerified ? lcpRbEvidence : undefined,
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
    return lcp != null && (lcp.resourceLoadDelay > RESOURCE_DELAY_WARN || lcp.resourceLoadTime > 1000);
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
