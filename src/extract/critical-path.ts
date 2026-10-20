/**
 * Critical Path Length extractor.
 *
 * Computes metrics from the critical path chain derived in the Network IR:
 * aggregate request duration, elapsed longest dependency path, request
 * counts, depth, and longest single request.
 */

import type { IRBundle, NormalizedRequest, CriticalPathTreeNode } from '../normalize/types.js';
import type { CriticalPath } from './types.js';

/** Safely treat any non-finite number as 0. */
function safe(v: number | undefined): number {
  return v !== undefined && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Determine whether a request is considered "render-blocking".
 *
 * - Document & Stylesheet requests are always blocking.
 * - Scripts at VeryHigh priority are considered blocking (render-blocking JS).
 * - Everything else (images, fonts, XHR, fetch, etc.) is non-blocking.
 */
function isBlocking(req: NormalizedRequest): boolean {
  if (req.failed) return false;
  if (req.resourceType === 'Document') return true;
  if (req.resourceType === 'Stylesheet') return true;
  if (req.resourceType === 'Script' && req.priority === 'VeryHigh') return true;
  return false;
}

/**
 * Result of walking the critical path tree.
 */
interface WalkResult {
  totalChainLength: number;
  elapsedCriticalPathMs: number;
  blockingCount: number;
  nonBlockingCount: number;
  longestSingleRequest: number;
  requestCount: number;
  anyMatched: boolean;
}

/**
 * Walk the critical path tree recursively and aggregate metrics.
 *
 * A URL can appear several times in the dependency tree — a module preload
 * and the import that follows it are two entries for one file. Counting
 * those separately inflated the request count and the byte totals, so every
 * URL is counted once.
 */
function walkTree(
  node: CriticalPathTreeNode,
  reqMap: Map<string, NormalizedRequest>,
  seen: Set<string> = new Set(),
): WalkResult {
  let totalChainLength = 0;
  let elapsedCriticalPathMs = 0;
  let blockingCount = 0;
  let nonBlockingCount = 0;
  let longestSingleRequest = 0;
  let requestCount = 0;
  let anyMatched = false;

  const req = reqMap.get(node.url);
  if (req && !seen.has(node.url)) {
    seen.add(node.url);
    anyMatched = true;
    const dur = safe(req.duration);
    totalChainLength += dur;
    elapsedCriticalPathMs = dur;
    longestSingleRequest = Math.max(longestSingleRequest, dur);
    requestCount++;
    if (isBlocking(req)) {
      blockingCount++;
    } else {
      nonBlockingCount++;
    }
  }

  for (const child of node.children ?? []) {
    const childResult = walkTree(child, reqMap, seen);
    totalChainLength += childResult.totalChainLength;
    elapsedCriticalPathMs = Math.max(
      elapsedCriticalPathMs,
      (req ? safe(req.duration) : 0) + childResult.elapsedCriticalPathMs,
    );
    blockingCount += childResult.blockingCount;
    nonBlockingCount += childResult.nonBlockingCount;
    longestSingleRequest = Math.max(longestSingleRequest, childResult.longestSingleRequest);
    requestCount += childResult.requestCount;
    anyMatched = anyMatched || childResult.anyMatched;
  }

  return { totalChainLength, elapsedCriticalPathMs, blockingCount, nonBlockingCount, longestSingleRequest, requestCount, anyMatched };
}

/**
 * Extract critical path metrics from an IRBundle.
 *
 * Returns undefined when the critical path info is empty or none of its
 * tree URLs can be matched to a network request.
 */
export function extractCriticalPath(ir: IRBundle): CriticalPath | undefined {
  const cpInfo = ir.network.summary.criticalPath;
  if (!cpInfo || !cpInfo.tree || !cpInfo.tree.url) {
    return undefined;
  }

  // Build a map for O(1) request lookups by URL
  const reqMap = new Map<string, NormalizedRequest>();
  for (const req of ir.network.requests) {
    reqMap.set(req.url, req);
  }

  const result = walkTree(cpInfo.tree, reqMap);

  if (!result.anyMatched) {
    return undefined;
  }

  return {
    totalChainLength: result.totalChainLength,
    elapsedCriticalPathMs: result.elapsedCriticalPathMs,
    aggregateRequestDurationMs: result.totalChainLength,
    pageLifecycleMs: getPageLifecycleMs(ir),
    requestCount: result.requestCount,
    blockingCount: result.blockingCount,
    nonBlockingCount: result.nonBlockingCount,
    deepestChainDepth: cpInfo.depth,
    longestSingleRequest: result.longestSingleRequest,
    urlsOnLongestPath: cpInfo.urlsOnLongestPath?.length ? cpInfo.urlsOnLongestPath : undefined,
    tree: cpInfo.tree,
    documentResponse: extractDocumentResponse(ir),
    documentChain: extractDocumentChain(ir),
  };
}

/**
 * Collect the response of the document the page metrics are anchored to.
 *
 * The last document is the one the visitor ended up on, so its headers
 * describe the response that mattered.
 */
function extractDocumentResponse(ir: IRBundle): CriticalPath['documentResponse'] {
  const documents = ir.network.requests.filter(
    (r) => r.resourceType === 'Document' && !r.url.startsWith('data:'),
  );
  const document = documents[documents.length - 1];
  if (!document) return undefined;

  const headers = document.responseHeaders ?? {};
  if (Object.keys(headers).length === 0 && document.statusCode === undefined) {
    return undefined;
  }

  return {
    url: document.url,
    status: document.statusCode || undefined,
    headers,
  };
}

/**
 * Collect the document responses the browser loaded.
 *
 * When the page loaded more than one document, the browser navigated away
 * from a page it had already received. The origin produced a response
 * nobody used, and that is the part of the chain this can measure: a single
 * run cannot separate the cost of the chain from the cost of the load
 * itself.
 */
function extractDocumentChain(ir: IRBundle): CriticalPath['documentChain'] {
  const documents = ir.network.requests.filter(
    (r) => r.resourceType === 'Document' && !r.url.startsWith('data:'),
  );
  if (documents.length < 2) return undefined;

  const discarded = documents.slice(0, -1);
  const final = documents[documents.length - 1]!;

  // The response time of a request, relative to the navigation start.
  const responseAt = (request: NormalizedRequest) =>
    safe(request.startTime) + safe(request.duration);

  const wastedServerMs = discarded.reduce(
    (sum, request) => sum + safe(request.timing?.receive),
    0,
  );

  return {
    count: documents.length,
    urls: documents.map((r) => r.url),
    wastedServerMs,
    contentAtMs: Math.max(0, responseAt(final)),
  };
}

function getPageLifecycleMs(ir: IRBundle): number | undefined {
  const networkEnd = ir.network.requests.reduce((max, request) => Math.max(max, safe(request.endTime)), 0);
  const loadEnd = safe(ir.performance.navigation.loadEventEnd);
  const lifecycle = Math.max(networkEnd, loadEnd);
  return lifecycle > 0 ? lifecycle : undefined;
}
