/**
 * PerformanceIR builder from trace and performance raw data.
 *
 * Converts CDP trace events and performance metrics into a normalized
 * PerformanceIR structure with all timestamps in ms relative to
 * navigationStart.
 */

import type { TraceRawData, PerformanceRawData } from '../collect/types.js';
import type { PerformanceIR, CoreWebVitals, TraceSummary, ThreadActivity, PerformanceNavigation } from './types.js';
import { toRelativeMs } from './clock.js';
import type { ClockDomain, ClockAnchor } from './clock.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Runtime type guard: check if value is a number */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

/** Safely access a nested property from trace event args */
function getArg(args: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = args;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Trace event names the PerformanceIR builder cares about */
const EVENT_NAMES = new Set([
  'firstContentfulPaint',
  'LargestContentfulPaint::Candidate',
  'MarkDOMContent',
  'MarkLoad',
  'LayoutShift',
  'LongTask',
]);

// ---------------------------------------------------------------------------
// Navigation builder
// ---------------------------------------------------------------------------

/**
 * Build the PerformanceNavigation part from trace events.
 *
 * MarkDOMContent → domContentLoaded
 * MarkLoad → loadEventStart
 */
function buildNavigation(
  events: TraceRawData['events'],
  anchor: ClockAnchor,
): PerformanceNavigation {
  let domContentLoaded = 0;
  let loadEventStart = 0;

  for (const ev of events) {
    if (ev.name === 'MarkDOMContent') {
      domContentLoaded = toRelativeMs(ev.ts, 'cdp-monotonic-us', anchor);
    }
    if (ev.name === 'MarkLoad') {
      loadEventStart = toRelativeMs(ev.ts, 'cdp-monotonic-us', anchor);
    }
  }

  return {
    url: '',
    navigationStart: 0,
    domContentLoaded,
    domContentLoadedEventEnd: domContentLoaded,
    loadEventStart,
    loadEventEnd: loadEventStart,
    domInteractive: domContentLoaded,
  };
}

// ---------------------------------------------------------------------------
// Core Web Vitals builder
// ---------------------------------------------------------------------------

/**
 * Build CoreWebVitals from trace events.
 *
 * - FCP: firstContentfulPaint trace event ts → relative ms
 * - LCP: LargestContentfulPaint::Candidate trace event ts → relative ms
 * - CLS: sum of LayoutShift events args.data.cumulative_score
 * - TBT: sum of (LongTask event dur - 50) in ms
 */
function buildCoreWebVitals(
  events: TraceRawData['events'],
  anchor: ClockAnchor,
): CoreWebVitals {
  let fcp: number | undefined;
  let lcp: number | undefined;
  let cls = 0;
  let tbt = 0;

  for (const ev of events) {
    switch (ev.name) {
      case 'firstContentfulPaint': {
        fcp = toRelativeMs(ev.ts, 'cdp-monotonic-us', anchor);
        break;
      }
      case 'LargestContentfulPaint::Candidate': {
        lcp = toRelativeMs(ev.ts, 'cdp-monotonic-us', anchor);
        break;
      }
      case 'LayoutShift': {
        const score = getArg(ev.args, ['data', 'cumulative_score']);
        if (isNumber(score)) {
          cls += score;
        }
        break;
      }
      case 'LongTask': {
        const dur = ev.dur;
        if (isNumber(dur)) {
          const blocking = dur - 50; // tasks over 50ms are "long"
          if (blocking > 0) {
            tbt += blocking / 1000; // dur is in microseconds, convert to ms
          }
        }
        break;
      }
    }
  }

  return {
    fcp: fcp ?? undefined,
    lcp: lcp ?? undefined,
    cls: cls > 0 ? cls : undefined,
    tbt: tbt > 0 ? tbt : undefined,
  };
}

// ---------------------------------------------------------------------------
// Trace summary builder
// ---------------------------------------------------------------------------

/**
 * Build TraceSummary from all trace events.
 *
 * - totalDuration: difference between last and first event timestamps
 *   (converted to relative ms)
 * - eventCount: total events
 * - categories: count of events per top-level category
 *   (cat field split by "," — take the first segment)
 * - threadActivity: per-tid duration sums + main thread identification
 */
function buildTraceSummary(
  events: TraceRawData['events'],
  anchor: ClockAnchor,
): TraceSummary {
  if (events.length === 0) {
    return {
      totalDuration: 0,
      eventCount: 0,
      categories: {},
      threadActivity: { totalMs: 0, byCategory: {} },
    };
  }

  const firstTs = events[0]?.ts ?? 0;
  const lastTs = events[events.length - 1]?.ts ?? 0;

  const totalDuration = toRelativeMs(lastTs, 'cdp-monotonic-us', anchor) - toRelativeMs(firstTs, 'cdp-monotonic-us', anchor);

  // Count events per top-level category
  const categories: Record<string, number> = {};
  for (const ev of events) {
    const topCat = ev.cat.split(',')[0] ?? 'unknown';
    categories[topCat] = (categories[topCat] ?? 0) + 1;
  }

  // Group by thread ID, sum durations
  const threadDurations = new Map<number, number>();
  for (const ev of events) {
    if (isNumber(ev.dur)) {
      const tid = ev.tid;
      const currentDur = threadDurations.get(tid) ?? 0;
      threadDurations.set(tid, currentDur + ev.dur);
    }
  }

  // Identify main thread: the one with the most events
  const threadCounts = new Map<number, number>();
  for (const ev of events) {
    threadCounts.set(ev.tid, (threadCounts.get(ev.tid) ?? 0) + 1);
  }

  let mainTid = 0;
  let maxCount = 0;
  for (const [tid, count] of threadCounts) {
    if (count > maxCount) {
      mainTid = tid;
      maxCount = count;
    }
  }

  // Per-category thread activity (on main thread only)
  const byCategory: Record<string, number> = {};
  for (const ev of events) {
    if (ev.tid === mainTid && isNumber(ev.dur)) {
      const topCat = ev.cat.split(',')[0] ?? 'unknown';
      byCategory[topCat] = (byCategory[topCat] ?? 0) + ev.dur / 1000;
    }
  }

  const mainThreadTotalMs = (threadDurations.get(mainTid) ?? 0) / 1000;

  return {
    totalDuration: Math.max(0, totalDuration),
    eventCount: events.length,
    categories,
    threadActivity: {
      totalMs: mainThreadTotalMs,
      byCategory,
    },
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a complete PerformanceIR from trace and performance raw data.
 *
 * @param trace - Raw trace events from the TraceCollector
 * @param perf  - Raw performance metrics from the PerformanceCollector
 * @param anchor - ClockAnchor with navigationStart time
 * @returns A fully-constructed PerformanceIR
 */
export function buildPerformanceIR(
  trace: TraceRawData,
  perf: PerformanceRawData,
  anchor: ClockAnchor,
): PerformanceIR {
  const events = trace.events ?? [];
  const eventCount = events.length;

  // Extract performance metrics as a lookup map
  const metrics = new Map<string, number>();
  for (const m of perf.metrics ?? []) {
    metrics.set(m.name, m.value);
  }

  const navigation = buildNavigation(events, anchor);
  const coreWebVitals = buildCoreWebVitals(events, anchor);
  const traceSummary = buildTraceSummary(events, anchor);

  // mainThreadBusyness = main thread activity / total trace duration
  const mainThreadBusyness =
    traceSummary.totalDuration > 0 && traceSummary.threadActivity.totalMs > 0
      ? Math.min(1, traceSummary.threadActivity.totalMs / traceSummary.totalDuration)
      : 0;

  const result: PerformanceIR = {
    navigation,
    coreWebVitals,
    traceSummary,
    mainThreadBusyness,
  };

  return result;
}
