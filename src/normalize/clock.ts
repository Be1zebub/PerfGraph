/**
 * Clock domain normalization utilities.
 *
 * Raw data from different CDP domains arrives on different clock domains.
 * This module converts all timestamps to a common epoch: milliseconds
 * relative to the navigation start (navigationStart).
 *
 * Supported clock domains:
 *   - cdp-monotonic-us  : Chromium Tracing microsecond monotonic clock
 *   - cdp-monotonic-ms  : CDP millisecond monotonic clock
 *   - epoch-ms          : Standard Unix epoch in milliseconds
 *   - epoch-s           : Standard Unix epoch in seconds
 *   - network-monotonic-s : Network domain monotonic seconds (with wall-time offset)
 *   - lighthouse-ms     : Lighthouse-reported relative milliseconds
 */

import type { RawDataBundle } from '../collect/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The clock domain a raw timestamp originated from */
export type ClockDomain =
  | 'cdp-monotonic-us'
  | 'cdp-monotonic-ms'
  | 'epoch-ms'
  | 'epoch-s'
  | 'network-monotonic-s'
  | 'lighthouse-ms';

/** Anchors used to convert each clock domain to relative ms */
export interface ClockAnchor {
  /** navigationStart timestamp in ms epoch (from Performance.getMetrics or trace) */
  navigationStart: number;
  /** Wall time of the first network request (seconds since epoch), used for network clock sync */
  firstRequestWallTime?: number;
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

/**
 * Convert a raw timestamp to milliseconds relative to navigationStart.
 *
 * NaN / Infinity guard: if the result is not a finite number, return 0.
 */
export function toRelativeMs(
  raw: number,
  domain: ClockDomain,
  anchor: ClockAnchor,
): number {
  let result: number;

  switch (domain) {
    case 'cdp-monotonic-us':
      // Chrome tracing timestamps are in microseconds from boot
      result = raw / 1000 - anchor.navigationStart;
      break;

    case 'cdp-monotonic-ms':
      // Some CDP APIs return ms-monotonic
      result = raw - anchor.navigationStart;
      break;

    case 'epoch-ms':
      // Standard epoch milliseconds
      result = raw - anchor.navigationStart;
      break;

    case 'epoch-s':
      // Epoch seconds → multiply to ms, then shift
      result = raw * 1000 - anchor.navigationStart;
      break;

    case 'network-monotonic-s': {
      // Network events use a monotonic seconds clock anchored to a wall time.
      // The wall-time offset is derived from the first request's wallTime.
      const wallOffset = anchor.firstRequestWallTime ?? 0;
      result =
        raw * 1000 + (anchor.navigationStart - wallOffset * 1000);
      break;
    }

    case 'lighthouse-ms':
      // Lighthouse already reports relative ms
      result = raw;
      break;

    default: {
      // Exhaustiveness check (should never reach here if domain union is complete)
      const _exhaustive: never = domain;
      result = 0;
      break;
    }
  }

  // NaN / Infinity guard
  if (!Number.isFinite(result)) {
    return 0;
  }

  return result;
}

/**
 * Resolve a ClockAnchor from a RawDataBundle.
 *
 * navigationStart is extracted from the performance metrics (Timestamp metric)
 * or falls back to 0. firstRequestWallTime is taken from the first network
 * request's wallTime field if available.
 */
export function resolveClockAnchor(raw: RawDataBundle): ClockAnchor {
  // Extract navigation start from performance metrics
  let navigationStart = 0;

  const perfData = raw.performance as
    | { metrics?: Array<{ name: string; value: number }> }
    | undefined;
  if (perfData?.metrics) {
    const navStartMetric = perfData.metrics.find(
      (m) => m.name === 'NavigationStart',
    );
    if (navStartMetric) {
      navigationStart = navStartMetric.value;
    }
  }

  // Extract first request wall time from network data
  let firstRequestWallTime: number | undefined;

  const netData = raw.network as
    | { requests?: Array<{ wallTime?: number }> }
    | undefined;
  if (netData?.requests && netData.requests.length > 0) {
    const firstReq = netData.requests[0];
    if (firstReq && typeof firstReq.wallTime === 'number') {
      firstRequestWallTime = firstReq.wallTime;
    }
  }

  return { navigationStart, firstRequestWallTime };
}
