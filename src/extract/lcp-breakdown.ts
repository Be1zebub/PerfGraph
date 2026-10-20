/**
 * LCP (Largest Contentful Paint) Breakdown extractor.
 *
 * Splits LCP time into 4 subparts per Chrome spec:
 *   TTFB → Resource Load Delay → Resource Load Time → Element Render Delay
 */

import type { IRBundle, LCPEntry, NormalizedRequest } from '../normalize/types.js';
import type { LCPBreakdown } from './types.js';

/** Safely clamp a number to 0 if it is negative, NaN, or Infinity. */
function clamp(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** What kind of element produced the LCP. */
type LcpElementKind = 'text' | 'image' | 'unknown';

/**
 * Find the document request the page metrics belong to.
 *
 * A redirect chain produces several document requests, and the metrics are
 * anchored to the final navigation. Taking the first document would compare
 * a TTFB from one navigation with an LCP from another — and produce a TTFB
 * larger than the LCP, which is impossible for a single page load.
 */
function findDocumentRequest(
  requests: NormalizedRequest[],
  anchorMs?: number,
): NormalizedRequest | undefined {
  const documents = requests.filter((r) => r.resourceType === 'Document');
  if (documents.length === 0) return undefined;
  if (documents.length === 1) return documents[0];

  if (anchorMs !== undefined) {
    // The document that was in flight when the page painted.
    const before = documents.filter((r) => r.startTime <= anchorMs);
    if (before.length > 0) {
      return before.reduce((a, b) => (a.startTime >= b.startTime ? a : b));
    }
  }

  // Otherwise the last document is the navigation that produced the page.
  return documents.reduce((a, b) => (a.startTime >= b.startTime ? a : b));
}

/**
 * A favicon is never a largest contentful paint element — Chrome excludes it
 * from the candidate set. Keeping it in the pool made an arbitrary icon look
 * like the LCP resource.
 */
function isFavicon(url: string): boolean {
  return /\/favicon[^/]*$|\.ico($|[?#])/i.test(url);
}

/**
 * Whether a resource is inlined in the document.
 *
 * An inline resource has no network round trip, so it has no load phase and
 * nothing to preload, re-encode or defer.
 */
function isInlineUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:');
}

/**
 * Classify an element from its label, snippet or selector.
 *
 * Only explicit image and text elements are classified. A generic container
 * stays unknown, because it may be a text block or a background image.
 */
function classifyElement(text: string): LcpElementKind {
  const value = text.toLowerCase();
  if (!value) return 'unknown';
  if (/(<|\b)(img|image|svg|video|picture|source)\b/.test(value)) return 'image';
  if (/(<|\b)(p|h1|h2|h3|h4|h5|h6|span|ul|ol|li|blockquote|em|strong)\b/.test(value)) {
    return 'text';
  }
  return 'unknown';
}

/** Extract the image source from an HTML snippet, when present. */
function urlFromSnippet(snippet: string | undefined): string | undefined {
  if (!snippet) return undefined;
  const match = /src\s*=\s*["']([^"']+)["']/i.exec(snippet);
  return match?.[1];
}

/** Describe a Performance API LCP entry as `h1.headline`. */
function describeEntryElement(entry: LCPEntry): string | undefined {
  if (!entry.elementTag) return undefined;
  const id = entry.elementId ? `#${entry.elementId}` : '';
  const className = entry.elementClass
    ? `.${entry.elementClass.trim().split(/\s+/).join('.')}`
    : '';
  return `${entry.elementTag}${id}${className}`;
}

/**
 * Resolve the element that produced the LCP.
 *
 * The element is taken from the same source as the LCP value so the two never
 * describe different navigations. The Performance API entry wins over the
 * trace candidate: it is the final candidate, while the trace may only carry
 * the first one that appeared after navigation.
 */
function resolveLcpElement(
  ir: IRBundle,
  valueSource: 'trace' | 'lighthouse' | 'mixed',
): { kind: LcpElementKind; element?: LCPBreakdown['lcpElement']; urlHint?: string } {
  const entry = ir.performance.lcpEntry;
  const candidate = ir.performance.lcpCandidate;
  const lhSelector = ir.lighthouse.lcpElementSelector;
  const lhSnippet = ir.lighthouse.lcpElementSnippet;
  const lhNodeLabel = ir.lighthouse.lcpElementNodeLabel;

  const entryElement: LCPBreakdown['lcpElement'] = entry
    ? {
        selector: describeEntryElement(entry),
        nodeLabel: describeEntryElement(entry),
        source: 'performance-api',
        type: entry.url ? 'image' : 'text',
      }
    : undefined;

  const lighthouseElement: LCPBreakdown['lcpElement'] = lhSelector
    ? {
        selector: lhSelector,
        snippet: lhSnippet,
        nodeLabel: lhNodeLabel,
        source: 'lighthouse',
      }
    : undefined;

  const traceElement: LCPBreakdown['lcpElement'] = candidate
    ? {
        nodeLabel: candidate.nodeName,
        source: 'trace',
        type: candidate.type,
      }
    : undefined;

  const preferLighthouse = valueSource === 'lighthouse';
  const ordered = preferLighthouse
    ? [lighthouseElement, entryElement, traceElement]
    : [entryElement, traceElement, lighthouseElement];

  for (const element of ordered) {
    if (!element) continue;
    if (element.source === 'lighthouse') {
      const kind = classifyElement(
        `${lhNodeLabel ?? ''} ${lhSnippet ?? ''} ${lhSelector ?? ''}`,
      );
      return {
        kind,
        element: { ...element, type: kind },
        urlHint: urlFromSnippet(lhSnippet),
      };
    }
    if (element.source === 'performance-api') {
      return { kind: entry?.url ? 'image' : 'text', element, urlHint: entry?.url };
    }
    return { kind: candidate?.type ?? 'unknown', element, urlHint: candidate?.url };
  }

  return { kind: 'unknown' };
}

/**
 * Find the network resource that the LCP element loaded, if any.
 *
 * A text LCP has no resource. An image LCP is matched by URL when the element
 * is known; only when the element is known to be an image but its URL is not
 * is the largest image used as a fallback. When the element kind is unknown
 * nothing is attributed — guessing would report an icon as the LCP.
 */
function findLcpResource(
  ir: IRBundle,
  kind: LcpElementKind,
  urlHint: string | undefined,
): NormalizedRequest | undefined {
  if (kind === 'text') return undefined;

  const images = ir.network.requests.filter(
    (r) => r.resourceType === 'Image' && !r.failed && !isFavicon(r.url),
  );
  if (images.length === 0) return undefined;

  if (urlHint) {
    const hint = urlHint.toLowerCase();
    const exact = images.find((r) => r.url.toLowerCase() === hint);
    if (exact) return exact;
    const byPath = images.find(
      (r) => r.url.toLowerCase().endsWith(hint) || hint.endsWith(r.url.toLowerCase()),
    );
    if (byPath) return byPath;
  }

  if (kind !== 'image') return undefined;

  const sized = images.filter((r) => (r.bytes ?? 0) > 0);
  if (sized.length === 0) return undefined;
  return sized.reduce((a, b) => ((b.bytes ?? 0) > (a.bytes ?? 0) ? b : a));
}

/**
 * Extract TTFB from the network document request or fallback to Lighthouse.
 *
 * The CDP timing breaks the wait down into DNS, TCP connect, TLS and the
 * time until the response headers arrive. Two details matter:
 *
 * - the TLS handshake is nested inside the connect phase, so adding both
 *   counts it twice;
 * - `wait` is the time the request was being sent, while `receive` is the
 *   time the server took to answer. The server wait is the one that says
 *   something about the backend.
 *
 * @param ir - The IR bundle
 * @param anchorMs - Timestamp the metrics are anchored to, used to pick the
 *                   document request the page metrics belong to
 * @returns The total time to the first byte and its parts
 */
function extractTTFB(
  ir: IRBundle,
  anchorMs?: number,
): { total: number; parts?: LCPBreakdown['ttfbParts'] } {
  // Primary: Document request timing
  const doc = findDocumentRequest(ir.network.requests, anchorMs);
  if (doc?.timing) {
    const dns = doc.timing.dns ?? 0;
    const ssl = doc.timing.ssl ?? 0;
    // The TLS handshake is part of the connect phase.
    const connect = Math.max(0, (doc.timing.connect ?? 0) - ssl);
    const wait = doc.timing.receive ?? doc.timing.wait ?? 0;
    const ttfb = dns + connect + ssl + wait;
    if (Number.isFinite(ttfb)) {
      return { total: Math.max(0, ttfb), parts: { dns, connect, ssl, wait } };
    }
  }

  // Fallback: Lighthouse server-response-time audit
  const lhAudit = ir.lighthouse.failedAudits.find(
    (a) => a.id === 'server-response-time',
  );
  if (lhAudit?.numericValue !== undefined && Number.isFinite(lhAudit.numericValue)) {
    return { total: Math.max(0, lhAudit.numericValue) };
  }

  return { total: 0 };
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

  // The value origin is more precise than `source`: the Performance API entry
  // overrides the trace candidate, and both are separate from Lighthouse.
  const valueOrigin: LCPBreakdown['valueOrigin'] = ir.performance.lcpEntry
    ? 'performance-api'
    : hasTrace
      ? 'trace'
      : 'lighthouse';

  const { total: ttfb, parts: ttfbParts } = extractTTFB(ir, totalLCP);
  const { kind, element, urlHint } = resolveLcpElement(ir, source);
  const lcpResource = findLcpResource(ir, kind, urlHint);
  const entry = ir.performance.lcpEntry;

  // The Performance API reports the real load and render times of the LCP
  // resource. When they are present the breakdown is measured, not inferred.
  if (entry?.url && entry.loadTime !== undefined && entry.renderTime !== undefined) {
    // An inline resource is already in the document: it has no load phase,
    // so the time is a render delay and not a resource delay.
    if (isInlineUrl(entry.url)) {
      return {
        ttfb,
        ttfbParts,
        resourceLoadDelay: 0,
        resourceLoadTime: 0,
        elementRenderDelay: clamp(entry.startTime - ttfb),
        totalLCP,
        lcpElementUrl: entry.url,
        lcpResourceType: lcpResource?.resourceType ?? 'Image',
        lcpElement: element,
        source,
        valueOrigin,
      };
    }

    const resourceLoadDelay = clamp(entry.loadTime - ttfb);
    const resourceLoadTime = clamp(entry.renderTime - entry.loadTime);
    const elementRenderDelay = clamp(entry.startTime - entry.renderTime);

    return {
      ttfb,
      ttfbParts,
      resourceLoadDelay,
      resourceLoadTime,
      elementRenderDelay,
      totalLCP,
      lcpElementUrl: entry.url,
      lcpResourceType: lcpResource?.resourceType ?? 'Image',
      lcpElement: element,
      source,
      valueOrigin,
    };
  }

  // No resource to attribute: the LCP element is text, or the element is
  // unknown and attributing a resource would be a guess.
  if (!lcpResource) {
    return {
      ttfb,
      resourceLoadDelay: 0,
      resourceLoadTime: 0,
      elementRenderDelay: clamp(totalLCP - ttfb),
      totalLCP,
      lcpElementUrl: undefined,
      lcpResourceType: undefined,
      lcpElement: element,
      source,
      valueOrigin,
    };
  }

  const resourceLoadDelay = clamp(lcpResource.startTime - ttfb);
  const resourceLoadTime = clamp(lcpResource.duration);
  const elementRenderDelay = clamp(totalLCP - ttfb - resourceLoadDelay - resourceLoadTime);

  return {
    ttfb,
    ttfbParts,
    resourceLoadDelay,
    resourceLoadTime,
    elementRenderDelay,
    totalLCP,
    lcpElementUrl: lcpResource.url,
    lcpResourceType: lcpResource.resourceType,
    lcpElement: element,
    source,
    valueOrigin,
  };
}
