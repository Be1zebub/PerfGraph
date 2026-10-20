/**
 * Render-Blocking Score extractor.
 *
 * Identifies render-blocking resources (stylesheets, render-blocking scripts)
 * and computes a weighted score combining count, bytes, and Lighthouse
 * numeric value when available.
 */

import type { IRBundle, NormalizedRequest } from '../normalize/types.js';
import type { RenderBlockingScore } from './types.js';

/** Resource types that can block first render. */
const BLOCKING_TYPES = new Set(['Stylesheet']);

/**
 * Check whether a request is render-blocking.
 *
 * - Stylesheets are render-blocking by default.
 * - Scripts at VeryHigh priority are considered blocking.
 * - Font preloads and other early-critical resources could be added here.
 */
function isRenderBlocking(req: NormalizedRequest): boolean {
  if (req.failed) return false;
  if (BLOCKING_TYPES.has(req.resourceType)) return true;
  if (req.resourceType === 'Script' && req.priority === 'VeryHigh') return true;
  return false;
}

/**
 * Clamp a number to non-negative, returning 0 for NaN/Infinity.
 */
function safe(v: number): number {
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Extract render-blocking metrics from an IRBundle.
 *
 * Returns undefined when there are no network requests.
 */
export function extractRenderBlocking(ir: IRBundle): RenderBlockingScore | undefined {
  const requests = ir.network.requests;
  if (requests.length === 0) return undefined;

  let blockingRequestCount = 0;
  let blockingBytes = 0;
  let blockingDuration = 0;

  for (const req of requests) {
    if (isRenderBlocking(req)) {
      blockingRequestCount++;
      blockingBytes += safe(req.bytes);
      blockingDuration += safe(req.duration);
    }
  }

  // Lighthouse render-blocking-resources audit
  const lhAudit = ir.lighthouse.failedAudits.find(
    (a) => a.id === 'render-blocking-resources',
  );
  const lhRenderBlockingMs = lhAudit?.numericValue !== undefined && Number.isFinite(lhAudit.numericValue)
    ? lhAudit.numericValue
    : undefined;
  const lcpSavingsMs = ir.lighthouse.renderBlockingLcpSavingsMs;

  // Score: 0 = lots of blocking, 1 = no blocking
  // Blend count (up to 20 resources = max penalty) and Lighthouse value
  const countScore = Math.max(0, 1 - blockingRequestCount / 20);
  const lhScore = lhAudit !== undefined && lhAudit.score !== undefined && Number.isFinite(lhAudit.score)
    ? lhAudit.score
    : undefined;
  const renderBlockingScore = lhScore !== undefined
    ? (countScore + lhScore) / 2
    : countScore;

  // Use Lighthouse insight data for URL-level details, but never allow a
  // document entry to re-introduce the old false-positive classification.
  const lighthouseResources = ir.lighthouse.renderBlockingResources
    ?.filter((resource) => resource.resourceType !== 'Document');
  const networkResources = requests
    .filter(isRenderBlocking)
    .map((request) => ({
      url: request.url,
      totalBytes: safe(request.bytes),
      wastedMs: undefined,
      resourceType: request.resourceType,
    }));
  const resources = lighthouseResources && lighthouseResources.length > 0
    ? lighthouseResources
    : networkResources;
  const totalWastedMs = lighthouseResources
    ?.reduce((sum, r) => sum + (r.wastedMs ?? 0), 0);
  const networkUrls = new Set(networkResources.map((resource) => resource.url));
  const lighthouseUrls = new Set((lighthouseResources ?? []).map((resource) => resource.url));

  return {
    blockingRequestCount,
    blockingBytes,
    blockingDuration,
    renderBlockingScore,
    lhRenderBlockingMs,
    lcpSavingsMs,
    fcpSavingsMs: ir.lighthouse.renderBlockingFcpSavingsMs,
    resources: resources.length > 0 ? resources : undefined,
    totalWastedMs: lighthouseResources ? totalWastedMs : undefined,
    networkResourceCount: networkResources.length,
    lighthouseResourceCount: lighthouseResources?.length ?? 0,
    sourceConflict: lighthouseResources != null && lighthouseResources.length !== networkResources.length,
    networkResources,
    lighthouseResources: lighthouseResources ?? [],
    networkOnlyCount: [...networkUrls].filter((url) => !lighthouseUrls.has(url)).length,
    lighthouseOnlyCount: [...lighthouseUrls].filter((url) => !networkUrls.has(url)).length,
    sourceStatus: lighthouseResources != null && lighthouseResources.length !== networkResources.length ? 'conflicting' : 'measured',
  };
}
