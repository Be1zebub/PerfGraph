/**
 * Network-related causal rules.
 *
 * Chains covered:
 *   1. Deep critical chain → delayed page load
 *   2. Excessive request count → bandwidth contention → slower loads
 *   3. Document chain → discarded document → delayed page load
 *
 * @packageDocumentation
 */

import type { FeatureSet } from '../../extract/types.js';
import type { Confidence, CausalNode, CausalEdge, Evidence } from '../types.js';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const CHAIN_DEPTH_WARN = 5;
const CHAIN_DEPTH_CRIT = 10;
const REQUEST_COUNT_WARN = 50;
const REQUEST_COUNT_CRIT = 100;
const REDIRECT_COST_WARN = 100; // ms spent on a document that was discarded

// ---------------------------------------------------------------------------
// Rule 1: Deep critical chain → slow page load
// ---------------------------------------------------------------------------

export const criticalPathChain = {
  id: 'net-critical-path-chain',
  label: 'Deep critical chain → slow page load',

  applies(features: FeatureSet): boolean {
    const cp = features.criticalPath;
    return cp != null && cp.deepestChainDepth >= CHAIN_DEPTH_WARN;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const cp = features.criticalPath!;
    const isDeep = cp.deepestChainDepth >= CHAIN_DEPTH_CRIT;
    const conf: Confidence = isDeep ? 'strong' : 'medium';

    const chainEvidence: Evidence = {
      urls: cp.urlsOnLongestPath,
    };

    const nodes: CausalNode[] = [
      {
        id: 'deep-critical-chain',
        label: `Deep critical chain (${cp.deepestChainDepth} levels)`,
        type: 'metric',
        severity: isDeep ? 'critical' : 'warning',
        value: cp.deepestChainDepth,
        threshold: CHAIN_DEPTH_WARN,
        evidence: chainEvidence,
      },
      {
        id: 'waterfall-delay',
        label: 'Cascading load delay',
        type: 'bottleneck',
        severity: isDeep ? 'critical' : 'warning',
      },
      {
        id: 'slow-page-load',
        label: 'Slow page load',
        type: 'impact',
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'deep-critical-chain',
        target: 'waterfall-delay',
        confidence: conf,
        label: 'Deep sequential load chain delays critical path',
        ruleId: 'net-critical-path-chain',
      },
      {
        source: 'waterfall-delay',
        target: 'slow-page-load',
        confidence: conf,
        label: 'Cascading delay increases total load time',
        ruleId: 'net-critical-path-chain',
      },
    ];

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Rule 2: Excessive requests → bandwidth contention
// ---------------------------------------------------------------------------

export const excessiveRequestsChain = {
  id: 'net-excessive-requests-chain',
  label: 'Too many requests → bandwidth contention',

  applies(features: FeatureSet): boolean {
    const cp = features.criticalPath;
    return cp != null && cp.requestCount >= REQUEST_COUNT_WARN;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const cp = features.criticalPath!;
    const isExcessive = cp.requestCount >= REQUEST_COUNT_CRIT;
    const conf: Confidence = isExcessive ? 'strong' : 'medium';

    const reqEvidence: Evidence = {
      metric: { name: 'Requests', value: cp.requestCount, unit: 'count' },
    };

    const nodes: CausalNode[] = [
      {
        id: 'excessive-requests',
        label: `${cp.requestCount} unique requests`,
        type: 'metric',
        severity: isExcessive ? 'critical' : 'warning',
        value: cp.requestCount,
        threshold: REQUEST_COUNT_WARN,
        evidence: reqEvidence,
      },
      {
        id: 'bandwidth-contention',
        label: 'Bandwidth contention',
        type: 'bottleneck',
        severity: isExcessive ? 'warning' : 'info',
      },
      {
        id: 'slow-load-many-requests',
        label: 'Slow page load',
        type: 'impact',
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'excessive-requests',
        target: 'bandwidth-contention',
        confidence: conf,
        label: 'Multiple requests compete for limited bandwidth',
        ruleId: 'net-excessive-requests-chain',
      },
      {
        source: 'bandwidth-contention',
        target: 'slow-load-many-requests',
        confidence: 'medium',
        label: 'Contention slows down loading',
        ruleId: 'net-excessive-requests-chain',
      },
    ];

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Rule 3: Document chain → discarded document
// ---------------------------------------------------------------------------

export const documentChainRule = {
  id: 'net-document-chain-chain',
  label: 'Document chain → discarded document → delayed page load',

  applies(features: FeatureSet): boolean {
    const chain = features.criticalPath?.documentChain;
    return chain != null && chain.count > 1 && chain.overheadMs >= REDIRECT_COST_WARN;
  },

  build(features: FeatureSet): { nodes: CausalNode[]; edges: CausalEdge[] } {
    const chain = features.criticalPath!.documentChain!;
    const isHeavy = chain.overheadMs >= 1000;

    const evidence: Evidence = {
      urls: chain.urls,
      metric: {
        name: 'Time added by the document chain',
        value: Math.round(chain.overheadMs),
        unit: 'ms',
        source: 'network',
        method: 'Time between the discarded document and the document the visitor finally saw',
      },
    };

    const nodes: CausalNode[] = [
      {
        id: 'document-chain',
        label: `${chain.count} document responses`,
        type: 'metric',
        severity: isHeavy ? 'critical' : 'warning',
        value: chain.count,
        unit: 'count',
        threshold: 1,
        impactSurface: 'initial-viewport',
        evidence,
      },
      {
        id: 'discarded-document',
        label: `Document discarded after ${Math.round(chain.overheadMs)}ms`,
        type: 'bottleneck',
        severity: isHeavy ? 'critical' : 'warning',
        value: Math.round(chain.overheadMs),
        unit: 'ms',
        threshold: REDIRECT_COST_WARN,
        impactSurface: 'initial-viewport',
        evidence,
      },
      {
        id: 'delayed-by-document-chain',
        label: 'Page load delayed by the document chain',
        type: 'impact',
        severity: isHeavy ? 'critical' : 'warning',
        impactSurface: 'initial-viewport',
      },
    ];

    const edges: CausalEdge[] = [
      {
        source: 'document-chain',
        target: 'discarded-document',
        confidence: 'strong',
        label: 'The browser navigated away from a document it had already received',
        ruleId: 'net-document-chain-chain',
        evidence,
      },
      {
        source: 'discarded-document',
        target: 'delayed-by-document-chain',
        confidence: 'strong',
        label: 'Time spent on the discarded document delays the content the user sees',
        ruleId: 'net-document-chain-chain',
        evidence,
      },
    ];

    return { nodes, edges };
  },
};

// ---------------------------------------------------------------------------
// Aggregated
// ---------------------------------------------------------------------------

export const networkRules = [
  criticalPathChain,
  excessiveRequestsChain,
  documentChainRule,
];
