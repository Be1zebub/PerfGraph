/**
 * Lighthouse Insights builder from Lighthouse v13+ insight audits.
 *
 * Extracts structured data from 3 specific Lighthouse insight audits:
 *   - lcp-breakdown-insight
 *   - render-blocking-insight
 *   - network-dependency-tree-insight
 *
 * Each insight audit is parsed independently so partial data does not
 * prevent the rest from being extracted.
 */

import type {
  LighthouseInsights,
  LCPBreakdownInsight,
  RenderBlockingInsight,
  RenderBlockingResource,
  NetworkDependencyTreeInsight,
  NetworkChainNode,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers for safe access
// ---------------------------------------------------------------------------

/** Assert value is a plain object (record-like). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Safely coerce a value to a string. */
function safeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Safely coerce a value to a number. */
function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Safely coerce a value to an array, filtering out non-record entries. */
function safeRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

// ---------------------------------------------------------------------------
// Insight audit parsers
// ---------------------------------------------------------------------------

/**
 * Parse the lcp-breakdown-insight audit.
 *
 * Lighthouse v13+ structures this as a list containing:
 *   - a table item with subpart rows (timeToFirstByte, elementRenderDelay,
 *     resourceLoadDelay, resourceLoadTime)
 *   - a node item with LCP element metadata (selector, snippet, nodeLabel)
 */
function parseLCPBreakdown(
  audit: Record<string, unknown>,
): LCPBreakdownInsight | undefined {
  const details = audit.details;
  if (!isRecord(details)) return undefined;

  const items = safeRecordArray(details.items);
  if (items.length === 0) return undefined;

  let timeToFirstByte = 0;
  let resourceLoadDelay: number | undefined;
  let resourceLoadTime: number | undefined;
  let elementRenderDelay = 0;
  let lcpElementSelector: string | undefined;
  let lcpElementSnippet: string | undefined;
  let lcpElementNodeLabel: string | undefined;

  for (const item of items) {
    const itemType = safeString(item.type);

    if (itemType === 'table') {
      // Extract subpart durations from the table items
      const subItems = safeRecordArray(item.items);
      for (const sub of subItems) {
        const subpart = safeString(sub.subpart);
        const duration = safeNumber(sub.duration) ?? 0;

        switch (subpart) {
          case 'timeToFirstByte': timeToFirstByte = duration; break;
          case 'elementRenderDelay': elementRenderDelay = duration; break;
          case 'resourceLoadDelay': resourceLoadDelay = duration; break;
          case 'resourceLoadTime': resourceLoadTime = duration; break;
        }
      }
    }

    if (itemType === 'node') {
      lcpElementSelector = safeString(item.selector);
      lcpElementSnippet = safeString(item.snippet);
      lcpElementNodeLabel = safeString(item.nodeLabel);
    }
  }

  // Determine source
  const scoreDisplayMode = safeString(audit.scoreDisplayMode);
  let source: 'trace' | 'lighthouse' | 'mixed' = 'lighthouse';
  if (scoreDisplayMode === 'informative') {
    // Insight audits with trace data combined are 'mixed'
    source = 'mixed';
  }

  return {
    timeToFirstByte,
    elementRenderDelay,
    resourceLoadDelay: resourceLoadDelay !== undefined ? resourceLoadDelay : undefined,
    resourceLoadTime: resourceLoadTime !== undefined ? resourceLoadTime : undefined,
    lcpElementSelector,
    lcpElementSnippet,
    lcpElementNodeLabel,
    source,
  };
}

/**
 * Parse the render-blocking-insight audit.
 *
 * Lighthouse v13+ structures this as:
 *   - metricSavings: { FCP: number, LCP: number }
 *   - details.items: array of render-blocking resources
 */
function parseRenderBlocking(
  audit: Record<string, unknown>,
): RenderBlockingInsight | undefined {
  const details = audit.details;
  if (!isRecord(details)) return undefined;

  // Extract metric savings from the audit level
  const metricSavings = isRecord(audit.metricSavings) ? audit.metricSavings : undefined;
  const fcpSavingsMs = safeNumber(metricSavings?.['FCP']);
  const lcpSavingsMs = safeNumber(metricSavings?.['LCP']);

  // Extract resource list from details.items
  const items = safeRecordArray(details.items);
  const resources: RenderBlockingResource[] = [];

  for (const item of items) {
    const url = safeString(item.url);
    if (!url) continue;

    resources.push({
      url,
      totalBytes: safeNumber(item.totalBytes),
      wastedMs: safeNumber(item.wastedMs),
      resourceType: safeString(item.resourceType),
    });
  }

  return {
    fcpSavingsMs: fcpSavingsMs,
    lcpSavingsMs: lcpSavingsMs,
    resources,
  };
}

/**
 * Recursively walk a network chain subtree to collect all leaf URLs
 * along the longest path (by navStartToEndTime).
 */
function walkLongestChain(
  node: NetworkChainNode,
  path: string[],
): { duration: number; urls: string[] } {
  let bestDuration = node.navStartToEndTime;
  let bestUrls = [...path, node.url];

  if (node.children) {
    for (const childKey of Object.keys(node.children)) {
      const child = node.children[childKey]!;
      const result = walkLongestChain(child, [...path, node.url]);
      const totalDuration = node.navStartToEndTime + result.duration;
      if (totalDuration > bestDuration) {
        bestDuration = totalDuration;
        bestUrls = result.urls;
      }
    }
  }

  return { duration: bestDuration, urls: bestUrls };
}

/**
 * Convert a raw chain record (unknown-shape) into a proper NetworkChainNode
 * by recursively walking and casting each entry.
 */
function parseChainNode(raw: unknown): NetworkChainNode | undefined {
  if (!isRecord(raw)) return undefined;

  const url = safeString(raw.url);
  if (!url) return undefined;

  const node: NetworkChainNode = {
    url,
    navStartToEndTime: safeNumber(raw.navStartToEndTime) ?? 0,
    transferSize: safeNumber(raw.transferSize),
    isLongest: raw.isLongest === true,
  };

  if (raw.children && isRecord(raw.children)) {
    const children: Record<string, NetworkChainNode> = {};
    for (const [key, childRaw] of Object.entries(raw.children)) {
      const child = parseChainNode(childRaw);
      if (child) {
        children[key] = child;
      }
    }
    if (Object.keys(children).length > 0) {
      node.children = children;
    }
  }

  return node;
}

/**
 * Parse the network-dependency-tree-insight audit.
 *
 * Lighthouse v13+ structures this as a list containing:
 *   - a network-tree item with chains and longestChain metadata
 *   - a list-section item with preconnect candidates
 */
function parseNetworkDependencyTree(
  audit: Record<string, unknown>,
): NetworkDependencyTreeInsight | undefined {
  const details = audit.details;
  if (!isRecord(details)) return undefined;

  const items = safeRecordArray(details.items);
  if (items.length === 0) return undefined;

  let chains: Record<string, NetworkChainNode> | undefined;
  let longestChainDuration: number | undefined;
  const longestChainUrls: string[] = [];
  const preconnectCandidates: string[] = [];

  for (const item of items) {
    const itemType = safeString(item.type);

    if (itemType === 'network-tree') {
      // Parse chains
      const rawChains = isRecord(item.chains) ? item.chains : undefined;
      if (rawChains) {
        const parsed: Record<string, NetworkChainNode> = {};
        for (const [key, rawNode] of Object.entries(rawChains)) {
          const node = parseChainNode(rawNode);
          if (node) {
            parsed[key] = node;
          }
        }
        if (Object.keys(parsed).length > 0) {
          chains = parsed;

          // Walk the longest chain to get URLs
          for (const rootNode of Object.values(parsed)) {
            const result = walkLongestChain(rootNode, []);
            if (result.duration > (longestChainDuration ?? 0)) {
              longestChainDuration = result.duration;
            }
            longestChainUrls.push(...result.urls);
          }
        }
      }

      // Extract longestChain duration from the item-level metadata
      const longestChain = isRecord(item.longestChain) ? item.longestChain : undefined;
      if (longestChain) {
        const duration = safeNumber(longestChain.duration);
        if (duration !== undefined) {
          longestChainDuration = duration;
        }
      }
    }

    if (itemType === 'list-section') {
      const title = safeString(item.title);
      if (title === 'Preconnect candidates' || title?.toLowerCase().includes('preconnect')) {
        const preconnectItems = safeRecordArray(item.items);
        for (const pi of preconnectItems) {
          const url = safeString(pi.url);
          if (url) {
            preconnectCandidates.push(url);
          }
        }
      }
    }
  }

  return {
    chains,
    longestChainDuration: longestChainDuration,
    longestChainUrls: longestChainUrls.length > 0 ? longestChainUrls : undefined,
    preconnectCandidates: preconnectCandidates.length > 0 ? preconnectCandidates : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a structured LighthouseInsights object from raw Lighthouse data.
 *
 * Accepts raw Lighthouse data in either form:
 *   - `{ lhr: { audits: {...} } }` — from LighthouseRawData
 *   - `{ audits: {...} }` — from a plain Lighthouse Report
 *
 * Each insight audit is parsed independently. Missing or invalid audits
 * simply result in that field being omitted from the result.
 *
 * @param rawLighthouse - Raw Lighthouse data (unknown shape, validated at parse time)
 * @returns A partially-populated LighthouseInsights object
 */
export function buildLighthouseInsights(
  rawLighthouse: unknown,
): LighthouseInsights {
  if (!isRecord(rawLighthouse)) return {};

  // Handle both { lhr: { audits } } and { audits } formats
  const root = isRecord(rawLighthouse.lhr) ? rawLighthouse.lhr : rawLighthouse;
  const audits = isRecord(root.audits) ? root.audits : {};

  const insights: LighthouseInsights = {};

  // 1. Parse lcp-breakdown-insight
  const lcpAudit = isRecord(audits['lcp-breakdown-insight'])
    ? (audits['lcp-breakdown-insight'] as Record<string, unknown>)
    : undefined;
  if (lcpAudit) {
    const parsed = parseLCPBreakdown(lcpAudit);
    if (parsed) {
      insights.lcpBreakdown = parsed;
    }
  }

  // 2. Parse render-blocking-insight
  const rbAudit = isRecord(audits['render-blocking-insight'])
    ? (audits['render-blocking-insight'] as Record<string, unknown>)
    : undefined;
  if (rbAudit) {
    const parsed = parseRenderBlocking(rbAudit);
    if (parsed) {
      insights.renderBlocking = parsed;
    }
  }

  // 3. Parse network-dependency-tree-insight
  const netAudit = isRecord(audits['network-dependency-tree-insight'])
    ? (audits['network-dependency-tree-insight'] as Record<string, unknown>)
    : undefined;
  if (netAudit) {
    const parsed = parseNetworkDependencyTree(netAudit);
    if (parsed) {
      insights.networkDependencyTree = parsed;
    }
  }

  return insights;
}
