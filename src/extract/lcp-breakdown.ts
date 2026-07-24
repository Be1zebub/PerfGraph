/**
 * LCP (Largest Contentful Paint) Breakdown extractor.
 *
 * Splits LCP time into 4 subparts per Chrome spec:
 *   TTFB → Resource Load Delay → Resource Load Time → Element Render Delay
 */

import type { IRBundle, NormalizedRequest } from '../normalize/types.js';
import type { LCPBreakdown } from './types.js';

/** Safely clamp a number to 0 if it's negative, NaN, or Infinity. */
function clamp(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Find the Document request (first page navigation) from the network log.
 */
function findDocumentRequest(requests: NormalizedRequest[]): NormalizedRequest | undefined {
  return requests.find((r) => r.resourceType === 'Document');
}

/**
 * Find the most likely LCP resource among network requests.
 * Chrome LCP is typically the largest image (by bytes) or a text node.
 * Returns undefined for text-only LCP.
 */
function findLcpResource(requests: NormalizedRequest[]): NormalizedRequest | undefined {
  const images = requests.filter((r) => r.resourceType === 'Image' && !r.failed);
  if (images.length === 0) return undefined;
  return images.reduce((a, b) => (a.bytes >= b.bytes ? a : b));
}

/**
 * Extract TTFB from the network document request or fallback to Lighthouse.
 *
 * Primary: sum of DNS + Connect + SSL + Wait from the Document request's timing.
 * Fallback: Lighthouse audit 'server-response-time' numericValue.
 * Last resort: 0.
 */
function extractTTFB(ir: IRBundle): number {
  // Primary: Document request timing
  const doc = findDocumentRequest(ir.network.requests);
  if (doc?.timing) {
    const { dns = 0, connect = 0, ssl = 0, wait = 0 } = doc.timing;
    const ttfb = dns + connect + ssl + wait;
    if (Number.isFinite(ttfb)) return Math.max(0, ttfb);
  }

  // Fallback: Lighthouse server-response-time audit
  const lhAudit = ir.lighthouse.failedAudits.find(
    (a) => a.id === 'server-response-time',
  );
  if (lhAudit?.numericValue !== undefined && Number.isFinite(lhAudit.numericValue)) {
    return Math.max(0, lhAudit.numericValue);
  }

  return 0;
}

/**
 * Extract LCP breakdown from an IRBundle.
 *
 * Uses a fallback chain for the total LCP value:
 *   1. Trace LCP from coreWebVitals.lcp
 *   2. Lighthouse LCP from lighthouse.lcpNumericValue
 *
 * Returns undefined if neither source has LCP data.
 */
export function extractLCPBreakdown(ir: IRBundle): LCPBreakdown | undefined {
  // Fallback chain: trace → Lighthouse
  const totalLCP = ir.performance.coreWebVitals.lcp ?? ir.lighthouse.lcpNumericValue;
  if (totalLCP === undefined || !Number.isFinite(totalLCP)) {
    return undefined;
  }

  // Determine source
  const hasTrace = ir.performance.coreWebVitals.lcp !== undefined;
  const hasLighthouse = ir.lighthouse.lcpNumericValue !== undefined;
  const source: 'trace' | 'lighthouse' | 'mixed' =
    hasTrace && hasLighthouse ? 'mixed' :
    hasLighthouse ? 'lighthouse' : 'trace';

  const ttfb = extractTTFB(ir);
  const lcpResource = findLcpResource(ir.network.requests);

  // Build lcpElement if Lighthouse provides selector info
  const lcpElement = ir.lighthouse.lcpElementSelector
    ? {
        selector: ir.lighthouse.lcpElementSelector,
        snippet: ir.lighthouse.lcpElementSnippet,
        nodeLabel: ir.lighthouse.lcpElementNodeLabel,
      }
    : undefined;

  // Text-only LCP: no image resource to load
  if (!lcpResource) {
    return {
      ttfb,
      resourceLoadDelay: 0,
      resourceLoadTime: 0,
      elementRenderDelay: clamp(totalLCP - ttfb),
      totalLCP,
      lcpElementUrl: undefined,
      lcpResourceType: undefined,
      lcpElement,
      source,
    };
  }

  const resourceLoadDelay = clamp(lcpResource.startTime - ttfb);
  const resourceLoadTime = clamp(lcpResource.duration);
  const elementRenderDelay = clamp(totalLCP - ttfb - resourceLoadDelay - resourceLoadTime);

  return {
    ttfb,
    resourceLoadDelay,
    resourceLoadTime,
    elementRenderDelay,
    totalLCP,
    lcpElementUrl: lcpResource.url,
    lcpResourceType: lcpResource.resourceType,
    lcpElement,
    source,
  };
}
