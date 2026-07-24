/**
 * Third-Party Overhead extractor.
 *
 * Identifies and categorises requests to third-party origins and computes
 * aggregate metrics: count, bytes, duration, and ratio vs first-party.
 */

import type { IRBundle, NormalizedRequest } from '../normalize/types.js';
import type { ThirdPartyOverhead } from './types.js';

/** Common third-party categories keyed by hostname substring. */
const THIRD_PARTY_PATTERNS: Record<string, string> = {
  'google-analytics': 'analytics',
  'googletagmanager': 'analytics',
  'gtag': 'analytics',
  'facebook': 'social',
  'fbcdn': 'social',
  'twitter': 'social',
  'linkedin': 'social',
  'doubleclick': 'advertising',
  'adsystem': 'advertising',
  'adservice': 'advertising',
  'cloudflare': 'cdn',
  'cloudfront': 'cdn',
  'fastly': 'cdn',
  'akamai': 'cdn',
  'cdn': 'cdn',
  'stackpath': 'cdn',
  'hotjar': 'analytics',
  'amplitude': 'analytics',
  'mixpanel': 'analytics',
  'segment': 'analytics',
  'sentry': 'monitoring',
  'datadog': 'monitoring',
  'newrelic': 'monitoring',
  'stripe': 'payment',
  'paypal': 'payment',
  'recaptcha': 'utility',
  'gstatic': 'utility',
  'googleapis': 'utility',
  'googlefonts': 'fonts',
  'fontawesome': 'fonts',
  'typekit': 'fonts',
  'youtube': 'media',
  'vimeo': 'media',
};

/**
 * Extract the origin from a URL string.
 */
function getOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Categorise a third-party hostname into a known bucket.
 */
function categoriseHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  for (const [pattern, category] of Object.entries(THIRD_PARTY_PATTERNS)) {
    if (lower.includes(pattern)) return category;
  }
  return 'other';
}

/**
 * Extract third-party overhead metrics from an IRBundle.
 *
 * Returns undefined when there are no network requests.
 */
export function extractThirdPartyOverhead(ir: IRBundle): ThirdPartyOverhead | undefined {
  const requests = ir.network.requests;
  if (requests.length === 0) return undefined;

  const pageOrigin = getOrigin(ir.meta.url);
  if (!pageOrigin) return undefined;

  const byCategory = new Map<string, { requests: number; bytes: number; duration: number }>();

  let thirdPartyRequests = 0;
  let thirdPartyBytes = 0;
  let thirdPartyDuration = 0;
  let firstPartyBytes = 0;
  let firstPartyRequests = 0;

  for (const req of requests) {
    const origin = getOrigin(req.url);
    if (!origin) continue;

    if (origin === pageOrigin) {
      firstPartyRequests++;
      firstPartyBytes += Math.max(0, req.bytes);
      continue;
    }

    // Third-party
    thirdPartyRequests++;
    const bytes = Math.max(0, req.bytes);
    const duration = Math.max(0, Number.isFinite(req.duration) ? req.duration : 0);
    thirdPartyBytes += bytes;
    thirdPartyDuration += duration;

    const hostname = new URL(req.url).hostname;
    const category = categoriseHostname(hostname);
    const existing = byCategory.get(category);
    if (existing) {
      existing.requests++;
      existing.bytes += bytes;
      existing.duration += duration;
    } else {
      byCategory.set(category, { requests: 1, bytes, duration });
    }
  }

  const totalRequests = thirdPartyRequests + firstPartyRequests;
  const thirdPartyRatio = totalRequests > 0 ? thirdPartyRequests / totalRequests : 0;

  const byCategoryObj: Record<string, { requests: number; bytes: number; duration: number }> = {};
  for (const [cat, data] of byCategory) {
    byCategoryObj[cat] = data;
  }

  return {
    totalThirdPartyRequests: thirdPartyRequests,
    totalThirdPartyBytes: thirdPartyBytes,
    totalThirdPartyDuration: thirdPartyDuration,
    firstPartyBytes,
    firstPartyRequests,
    thirdPartyRatio,
    byCategory: byCategoryObj,
  };
}
