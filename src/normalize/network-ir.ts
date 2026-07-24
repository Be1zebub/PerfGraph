/**
 * NetworkIR builder from raw CDP network data.
 *
 * Converts raw network request entries (from the Network domain) into a
 * normalized NetworkIR with all timestamps in ms relative to navigationStart.
 */

import type { NetworkRawData, NetworkRequestEntry, NetworkTiming } from '../collect/types.js';
import type { NetworkIR, NormalizedRequest, NormalizedRequestTiming, NetworkIRSummary, CriticalPathInfo, CriticalPathTreeNode } from './types.js';
import { toRelativeMs, type ClockAnchor } from './clock.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute NormalizedRequestTiming from a raw NetworkTiming object.
 *
 * For dns/connect/ssl: only compute if both start and end are >= 0 (CDP
 * convention for "not applicable"). For wait/receive: always compute as
 * differences when timing exists.
 */
function computeTiming(
  timing: NetworkTiming | null | undefined,
): NormalizedRequestTiming {
  if (!timing) {
    return {};
  }

  return {
    dns:
      timing.dnsStart >= 0 && timing.dnsEnd >= 0
        ? timing.dnsEnd - timing.dnsStart
        : undefined,
    connect:
      timing.connectStart >= 0 && timing.connectEnd >= 0
        ? timing.connectEnd - timing.connectStart
        : undefined,
    ssl:
      timing.sslStart >= 0 && timing.sslEnd >= 0
        ? timing.sslEnd - timing.sslStart
        : undefined,
    wait: timing.sendEnd - timing.sendStart,
    receive: timing.receiveHeadersEnd - timing.sendEnd,
  };
}

/**
 * Build a critical-path initiator dependency tree from normalized requests.
 *
 * Uses CDP `initiator.url` to build a parent-child tree. The Document
 * request (or first request if no Document) becomes the root. Every
 * request without a known initiatorUrl is attached to the root.
 */
function buildCriticalPathInfo(requests: NormalizedRequest[]): CriticalPathInfo {
  if (requests.length === 0) {
    return {
      tree: { url: '' },
      depth: 0,
      urlsOnLongestPath: [],
    };
  }

  // Build URL → request map
  const reqMap = new Map<string, NormalizedRequest>();
  for (const req of requests) {
    reqMap.set(req.url, req);
  }

  // Find root: the Document request, or first request
  // (requests.length > 0 is guaranteed by early return above)
  let root = requests.find((r) => r.resourceType === 'Document') ?? requests[0]!;

  // Build URL → children map
  const childrenOf = new Map<string, NormalizedRequest[]>();
  for (const req of requests) {
    if (req.url === root.url) continue;
    const parentUrl = (req.initiatorUrl && reqMap.has(req.initiatorUrl))
      ? req.initiatorUrl
      : root.url;
    const existing = childrenOf.get(parentUrl) ?? [];
    existing.push(req);
    childrenOf.set(parentUrl, existing);
  }

  // Recursively build tree nodes and find longest path
  function buildNode(url: string, depth: number): { node: CriticalPathTreeNode; maxDepth: number; longestPath: string[] } {
    const req = reqMap.get(url);
    const children = childrenOf.get(url) ?? [];
    let maxChildDepth = depth;
    let longestChildPath: string[] = [url];
    const childNodes: CriticalPathTreeNode[] = [];

    for (const child of children) {
      const result = buildNode(child.url, depth + 1);
      childNodes.push(result.node);
      if (result.maxDepth > maxChildDepth) {
        maxChildDepth = result.maxDepth;
        longestChildPath = [url, ...result.longestPath];
      }
    }

    return {
      node: {
        url,
        durationMs: req ? req.duration : undefined,
        children: childNodes.length > 0 ? childNodes : undefined,
      },
      maxDepth: maxChildDepth,
      longestPath: longestChildPath,
    };
  }

  const result = buildNode(root.url, 1);

  return {
    tree: result.node,
    depth: result.maxDepth,
    urlsOnLongestPath: result.longestPath,
  };
}

/**
 * Build Summary statistics from all normalized requests.
 */
function buildSummary(requests: NormalizedRequest[]): NetworkIRSummary {
  const totalRequests = requests.length;

  if (totalRequests === 0) {
    return {
      totalRequests: 0,
      totalBytes: 0,
      byType: {},
      byPriority: {},
      criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] },
      longestChain: { url: '', length: 0 },
    };
  }

  const totalBytes = requests.reduce((sum, r) => sum + r.bytes, 0);

  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const req of requests) {
    byType[req.resourceType] = (byType[req.resourceType] ?? 0) + 1;
    byPriority[req.priority] = (byPriority[req.priority] ?? 0) + 1;
  }

  // Build initiator dependency tree
  const criticalPath = buildCriticalPathInfo(requests);

  // Longest chain: request with max duration
  const longest = requests.reduce((max, r) =>
    r.duration > max.duration ? r : max,
  );

  return {
    totalRequests,
    totalBytes,
    byType,
    byPriority,
    criticalPath,
    longestChain: { url: longest.url, length: longest.duration },
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a complete NetworkIR from raw CDP network data.
 *
 * Maps each raw NetworkRequestEntry to a NormalizedRequest, converting
 * timestamps from the network-monotonic-s clock domain to ms relative
 * to navigationStart. Produces summary statistics including totals,
 * grouping by type/priority, and critical path chain.
 *
 * @param network - Raw network data from the NetworkCollector
 * @param anchor  - ClockAnchor with navigationStart and firstRequestWallTime
 * @returns A fully-constructed NetworkIR
 */
export function buildNetworkIR(
  network: NetworkRawData,
  anchor: ClockAnchor,
): NetworkIR {
  const requests: NormalizedRequest[] = (network.requests ?? []).map(
    (entry: NetworkRequestEntry): NormalizedRequest => {
      const timing = entry.response?.timing;
      const requestTime = timing?.requestTime;
      const startTime =
        requestTime !== undefined && requestTime !== null
          ? toRelativeMs(requestTime, 'network-monotonic-s', anchor)
          : 0;
      const endTime =
        startTime + (timing?.receiveHeadersEnd ?? 0);

      return {
        url: entry.url,
        method: entry.method,
        resourceType: entry.type ?? 'Other',
        statusCode: entry.response?.status ?? 0,
        startTime,
        endTime,
        duration: endTime - startTime,
        bytes: entry.response?.encodedDataLength ?? 0,
        priority: entry.request?.initialPriority ?? 'Low',
        initiator: entry.initiator?.type ?? 'other',
        initiatorUrl: entry.initiator?.url,
        failed: !!(entry.failed || entry.errorText),
        timing: computeTiming(timing),
      };
    },
  );

  const summary = buildSummary(requests);

  return { requests, summary };
}
