/**
 * LighthouseIR builder from raw Lighthouse data.
 *
 * Converts a Lighthouse Report (LHR) into a normalized LighthouseIR with
 * category scores, failed audits, and high-level score summary.
 * Lighthouse values are already in their own units — no clock conversion
 * is needed.
 */

import type { LighthouseRawData } from '../collect/types.js';
import type {
  LighthouseIR,
  LighthouseCategory,
  LighthouseFailedAudit,
  LighthouseScores,
} from './types.js';

// ---------------------------------------------------------------------------
// Types for internal LHR shape
// ---------------------------------------------------------------------------

/** Shape of a single audit entry in the LHR */
interface LHRAudit {
  id?: string;
  title?: string;
  description?: string;
  score?: number | null;
  numericValue?: number;
  details?: Record<string, unknown>;
}

/** Shape of a single category entry in the LHR */
interface LHRCategory {
  id?: string;
  title?: string;
  score?: number | null;
}

/** Partial shape of the Lighthouse Result object */
interface LHR {
  categories?: Record<string, LHRCategory>;
  audits?: Record<string, LHRAudit>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Narrow an unknown value to a string-keyed record */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse LCP element details from the lcp-breakdown-insight audit.
 *
 * The insight audit has a `details.items` array where each item with
 * `type === "node"` carries selector, snippet, and nodeLabel for the LCP
 * element.
 */
function parseLcpBreakdownElement(
  audit: Record<string, unknown>,
): { selector?: string; snippet?: string; nodeLabel?: string } | undefined {
  const details = isRecord(audit.details) ? audit.details : undefined;
  if (!details) return undefined;
  const items = Array.isArray(details.items) ? details.items.filter(isRecord) : [];
  for (const item of items) {
    if (item.type === 'node') {
      return {
        selector: typeof item.selector === 'string' ? item.selector : undefined,
        snippet: typeof item.snippet === 'string' ? item.snippet : undefined,
        nodeLabel: typeof item.nodeLabel === 'string' ? item.nodeLabel : undefined,
      };
    }
  }
  return undefined;
}

/**
 * Parse render-blocking resources from a Lighthouse audit (render-blocking-insight
 * or render-blocking-resources). Both use the same details.items structure with
 * url, totalBytes, wastedMs, and optional resourceType fields.
 */
function parseRenderBlockingResources(
  audit: LHRAudit,
): Array<{ url: string; totalBytes?: number; wastedMs?: number; resourceType?: string }> | undefined {
  const details = audit.details;
  if (!details) return undefined;
  const items = Array.isArray(details.items) ? details.items.filter(isRecord) : [];
  if (items.length === 0) return undefined;

  const resources = items
    .map((item) => ({
      url: typeof item.url === 'string' ? item.url : '',
      totalBytes: typeof item.totalBytes === 'number' ? item.totalBytes : undefined,
      wastedMs: typeof item.wastedMs === 'number' ? item.wastedMs : undefined,
      resourceType: typeof item.resourceType === 'string' ? item.resourceType : undefined,
    }))
    .filter((r) => r.url.length > 0);

  return resources.length > 0 ? resources : undefined;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a complete LighthouseIR from raw Lighthouse data.
 *
 * Extracts:
 *   - categories: keyed by category ID (performance, accessibility, etc.)
 *     with title and score (0-1)
 *   - failedAudits: all audits with score < 1, including id, title,
 *     description, score, and optional numericValue
 *   - scores: top-level performance/accessibility/best-practices/seo scores
 *
 * @param lighthouse - Raw Lighthouse data from the LighthouseCollector
 * @returns A fully-constructed LighthouseIR
 */
export function buildLighthouseIR(
  lighthouse: LighthouseRawData,
): LighthouseIR {
  const lhr = (lighthouse.lhr ?? {}) as LHR;

  // 1. Extract categories
  const categories: Record<string, LighthouseCategory> = {};
  const rawCategories = lhr.categories ?? {};
  for (const [key, cat] of Object.entries(rawCategories)) {
    if (cat && typeof cat.title === 'string') {
      categories[key] = {
        title: cat.title,
        score: typeof cat.score === 'number' ? cat.score : 0,
      };
    }
  }

  // 2. Extract scores map from known categories
  const scores: LighthouseScores = {
    performance: categories['performance']?.score,
    accessibility: categories['accessibility']?.score,
    bestPractices: categories['best-practices']?.score,
    seo: categories['seo']?.score,
  };

  // 3. Extract failed audits (score < 1)
  const failedAudits: LighthouseFailedAudit[] = [];
  const rawAudits = lhr.audits ?? {};
  for (const [, audit] of Object.entries(rawAudits)) {
    if (!audit) continue;
    const score = audit.score;
    // Include audits with score < 1 (including null → treated as 0)
    const effectiveScore =
      score === null || score === undefined ? 0 : score;
    if (effectiveScore >= 1) continue;

    failedAudits.push({
      id: audit.id ?? '',
      title: audit.title ?? '',
      description: audit.description ?? '',
      score: effectiveScore,
      numericValue:
        typeof audit.numericValue === 'number'
          ? audit.numericValue
          : undefined,
    });
  }

  // 4. Extract LCP numeric value from Lighthouse audit (for fallback in extract phase)
  const lcpAudit = isRecord(rawAudits['largest-contentful-paint'])
    ? rawAudits['largest-contentful-paint']
    : undefined;
  const lcpNumericValue =
    lcpAudit && typeof lcpAudit.numericValue === 'number'
      ? lcpAudit.numericValue
      : undefined;

  // 5. Extract lcp-breakdown-insight for element details
  const lcpBreakdownAudit = isRecord(rawAudits['lcp-breakdown-insight'])
    ? rawAudits['lcp-breakdown-insight']
    : undefined;
  const lcpElement = lcpBreakdownAudit
    ? parseLcpBreakdownElement(lcpBreakdownAudit)
    : undefined;

  // 6. Extract render-blocking resources from Lighthouse insight audits
  // Try render-blocking-insight (v13+) first, fall back to render-blocking-resources (older)
  const rbInsight = rawAudits['render-blocking-insight'];
  const rbOld = !rbInsight ? rawAudits['render-blocking-resources'] : undefined;
  const renderBlockingAudit = rbInsight ?? rbOld;
  const renderBlockingResources = renderBlockingAudit
    ? parseRenderBlockingResources(renderBlockingAudit)
    : undefined;

  return {
    categories,
    failedAudits,
    scores,
    lcpNumericValue: lcpNumericValue !== undefined ? lcpNumericValue : undefined,
    lcpElementSelector: lcpElement?.selector,
    lcpElementSnippet: lcpElement?.snippet,
    lcpElementNodeLabel: lcpElement?.nodeLabel,
    renderBlockingResources,
  };
}
