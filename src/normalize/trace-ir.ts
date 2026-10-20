/**
 * PerformanceIR builder from trace and performance raw data.
 *
 * Converts CDP trace events and performance metrics into a normalized
 * PerformanceIR structure with all timestamps in ms relative to
 * navigationStart.
 */

import type { TraceRawData, PerformanceRawData } from '../collect/types.js';
import type { PerformanceIR, CoreWebVitals, LCPEntry, LCPCandidate, LongTaskStats, ScriptCompileStats, TraceSummary, ThreadActivity, PerformanceNavigation } from './types.js';
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
 * Parse the LCP candidate payload of a trace event.
 *
 * The candidate carries the painted size, the node label and the element
 * type. The type decides whether a network resource can be attributed to
 * the LCP at all: a text candidate has no resource to attribute.
 */
function parseLcpCandidate(ev: TraceRawData['events'][number]): LCPCandidate | undefined {
  const data = getArg(ev.args, ['data']);
  if (!data || typeof data !== 'object') return undefined;

  const record = data as Record<string, unknown>;
  const rawType = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  const type: LCPCandidate['type'] =
    rawType === 'text' ? 'text' : rawType === 'image' ? 'image' : 'unknown';

  const candidate: LCPCandidate = { type };
  if (isNumber(record.size)) candidate.size = record.size;
  if (typeof record.nodeName === 'string' && record.nodeName.length > 0) {
    candidate.nodeName = record.nodeName;
  }
  if (typeof record.url === 'string' && record.url.length > 0) {
    candidate.url = record.url;
  }
  return candidate;
}

/**
 * Build CoreWebVitals from trace events.
 *
 * - FCP: firstContentfulPaint trace event ts → relative ms
 * - LCP: largestContentfulPaint::Candidate trace event ts → relative ms
 * - CLS: sum of LayoutShift events args.data.cumulative_score
 * - TBT: sum of (LongTask event dur - 50) in ms
 *
 * The last LCP candidate event wins, matching how Chrome reports the final
 * largest contentful paint element.
 */
function buildCoreWebVitals(
  events: TraceRawData['events'],
  anchor: ClockAnchor,
  mainThreadKey: string,
): { coreWebVitals: CoreWebVitals; lcpCandidate?: LCPCandidate; longTasks?: LongTaskStats } {
  let fcp: number | undefined;
  let lcp: number | undefined;
  let cls = 0;
  let tbt = 0;
  let lcpCandidate: LCPCandidate | undefined;
  let longTaskCount = 0;
  let maxBlockingMs = 0;

  for (const ev of events) {
    switch (ev.name) {
      case 'firstContentfulPaint': {
        fcp = toRelativeMs(ev.ts, 'cdp-monotonic-us', anchor);
        break;
      }
      case 'largestContentfulPaint::Candidate':
      case 'LargestContentfulPaint::Candidate': {
        lcp = toRelativeMs(ev.ts, 'cdp-monotonic-us', anchor);
        lcpCandidate = parseLcpCandidate(ev);
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
        // Total Blocking Time is defined on the main thread only. A long task
        // on the font thread or a worker does not block input, so counting it
        // would inflate the metric.
        if (`${ev.pid}:${ev.tid}` !== mainThreadKey) break;

        // LongTask instant events expose duration in seconds under args;
        // complete trace events may expose dur in microseconds.
        const durationMs = isNumber(ev.dur)
          ? ev.dur / 1000
          : (() => {
              const duration = getArg(ev.args, ['duration']);
              return isNumber(duration) ? duration * 1000 : undefined;
            })();
        if (durationMs !== undefined) {
          const blocking = durationMs - 50;
          if (blocking > 0) {
            tbt += blocking;
            longTaskCount++;
            if (blocking > maxBlockingMs) maxBlockingMs = blocking;
          }
        }
        break;
      }
    }
  }

  return {
    coreWebVitals: {
      fcp: fcp ?? undefined,
      lcp: lcp ?? undefined,
      cls: cls > 0 ? cls : undefined,
      tbt: tbt > 0 ? tbt : undefined,
    },
    lcpCandidate,
    longTasks:
      longTaskCount > 0
        ? { count: longTaskCount, maxBlockingMs, totalBlockingMs: tbt }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Trace summary builder
// ---------------------------------------------------------------------------

/**
 * Sum the duration of the V8 compile events.
 *
 * These are the browser's own compilation events, so the result is a real
 * measurement of script compilation instead of a guess.
 */
function collectScriptCompile(events: TraceRawData['events']): ScriptCompileStats | undefined {
  let totalMs = 0;
  let count = 0;

  for (const ev of events) {
    if (!/^(V8|v8)\.Compile/.test(ev.name)) continue;
    if (!isNumber(ev.dur)) continue;
    totalMs += ev.dur / 1000;
    count++;
  }

  if (count === 0) return undefined;
  return { totalMs, count };
}

/**
 * Find the main thread of the trace.
 *
 * A thread id is only unique inside a process, so the process is part of the
 * key. The main thread is the one that produced the most events.
 */
function findMainThreadKey(events: TraceRawData['events']): string {
  const counts = new Map<string, number>();
  for (const ev of events) {
    const key = `${ev.pid}:${ev.tid}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let mainKey = '';
  let maxCount = 0;
  for (const [key, count] of counts) {
    if (count > maxCount) {
      mainKey = key;
      maxCount = count;
    }
  }
  return mainKey;
}

/**
 * Build TraceSummary from all trace events.
 *
 * - totalDuration: difference between last and first event timestamps
 *   (converted to relative ms)
 * - eventCount: total events
 * - categories: count of events per top-level category
 *   (cat field split by "," — take the first segment)
 * - threadActivity: per-tid duration sums + main thread identification
 *
 * Thread activity is only counted inside the page lifecycle window. A trace
 * keeps recording long after the page settled, and that post-load work is
 * not what blocked the user.
 */
function buildTraceSummary(
  events: TraceRawData['events'],
  anchor: ClockAnchor,
  windowEndMs?: number,
): TraceSummary {
  if (events.length === 0) {
    return {
      totalDuration: 0,
      eventCount: 0,
      categories: {},
      threadActivity: { totalMs: 0, byCategory: {} },
    };
  }

  // The trace starts with metadata events that carry no timestamp (ts = 0),
  // and it ends long after the page settled. The span is taken from the
  // events that actually have a timestamp, otherwise the duration is off by
  // orders of magnitude and every ratio computed from it collapses.
  let firstTs = Number.POSITIVE_INFINITY;
  let lastTs = 0;
  for (const ev of events) {
    if (!isNumber(ev.ts) || ev.ts <= 0) continue;
    if (ev.ts < firstTs) firstTs = ev.ts;
    if (ev.ts > lastTs) lastTs = ev.ts;
  }

  const totalDuration =
    Number.isFinite(firstTs) && lastTs > firstTs
      ? toRelativeMs(lastTs, 'cdp-monotonic-us', anchor) -
        toRelativeMs(firstTs, 'cdp-monotonic-us', anchor)
      : 0;

  // Count events per top-level category
  const categories: Record<string, number> = {};
  for (const ev of events) {
    const topCat = ev.cat.split(',')[0] ?? 'unknown';
    categories[topCat] = (categories[topCat] ?? 0) + 1;
  }

  // Identify the main thread: the one with the most events. A thread id is
  // only unique inside a process, so the process has to be part of the key:
  // events of two processes that happen to share a thread id would otherwise
  // be summed into one thread, reporting more busy time than the page took.
  const mainThreadKey = findMainThreadKey(events);

  // Per-category thread activity (on main thread only, inside the window).
  //
  // Trace events are nested: a task contains the script it runs, which
  // contains the function it calls. Summing every duration therefore counts
  // the same time several times and can report more busy time than the trace
  // even lasted. Only the outermost events of the thread are counted, which
  // is the actual occupancy of the main thread.
  const threadEvents: Array<{ ts: number; dur: number; cat: string }> = [];
  for (const ev of events) {
    if (`${ev.pid}:${ev.tid}` !== mainThreadKey || !isNumber(ev.dur) || ev.dur <= 0) {
      continue;
    }
    threadEvents.push({ ts: ev.ts, dur: ev.dur, cat: ev.cat });
  }
  threadEvents.sort((a, b) => a.ts - b.ts);

  const byCategory: Record<string, number> = {};
  let mainThreadTotalMs = 0;
  const ends: number[] = [];
  for (const ev of threadEvents) {
    while (ends.length > 0 && (ends[ends.length - 1] ?? 0) <= ev.ts) {
      ends.pop();
    }
    const nested = ends.length > 0;

    let durUs = ev.dur;
    if (windowEndMs !== undefined) {
      const startMs = toRelativeMs(ev.ts, 'cdp-monotonic-us', anchor);
      if (startMs > windowEndMs) continue;
      const remainingUs = (windowEndMs - startMs) * 1000;
      if (remainingUs < durUs) durUs = Math.max(0, remainingUs);
    }

    if (!nested) {
      const topCat = ev.cat.split(',')[0] ?? 'unknown';
      byCategory[topCat] = (byCategory[topCat] ?? 0) + durUs / 1000;
      mainThreadTotalMs += durUs / 1000;
    }

    ends.push(ev.ts + ev.dur);
  }

  return {
    totalDuration: Math.max(0, totalDuration),
    eventCount: events.length,
    categories,
    threadActivity: {
      totalMs: mainThreadTotalMs,
      windowMs: windowEndMs,
      byCategory,
    },
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the LCP candidate description from a Performance API entry.
 *
 * The entry is the final candidate, so it describes the element that really
 * was the largest contentful paint.
 */
function candidateFromEntry(entry: LCPEntry): LCPCandidate {
  const type: LCPCandidate['type'] = entry.url ? 'image' : 'text';
  const candidate: LCPCandidate = { type };
  if (Number.isFinite(entry.size)) candidate.size = entry.size;
  if (entry.url) candidate.url = entry.url;

  const label = describeElement(entry);
  if (label) candidate.nodeName = label;

  return candidate;
}

/** Build a short element description like `h1.headline` from an LCP entry. */
function describeElement(entry: LCPEntry): string | undefined {
  const tag = entry.elementTag;
  if (!tag) return undefined;
  const id = entry.elementId ? `#${entry.elementId}` : '';
  const className = entry.elementClass
    ? `.${entry.elementClass.trim().split(/\s+/).join('.')}`
    : '';
  return `${tag}${id}${className}`;
}

/**
 * Build a complete PerformanceIR from trace and performance raw data.
 *
 * @param trace - Raw trace events from the TraceCollector
 * @param perf  - Raw performance metrics from the PerformanceCollector
 * @param anchor - ClockAnchor with navigationStart time
 * @param lcp - Final largest contentful paint entry from the Performance API
 * @returns A fully-constructed PerformanceIR
 */
export function buildPerformanceIR(
  trace: TraceRawData,
  perf: PerformanceRawData,
  anchor: ClockAnchor,
  lcp?: LCPEntry,
): PerformanceIR {
  const events = trace.events ?? [];

  const navigation = buildNavigation(events, anchor);
  const mainThreadKey = findMainThreadKey(events);
  const { coreWebVitals, lcpCandidate: traceCandidate, longTasks } = buildCoreWebVitals(
    events,
    anchor,
    mainThreadKey,
  );

  // The page lifecycle window: from navigation start to the load event. Work
  // after that point did not block the user.
  const windowEndMs = navigation.loadEventEnd > 0
    ? navigation.loadEventEnd
    : navigation.domContentLoaded > 0
      ? navigation.domContentLoaded
      : undefined;

  const traceSummary = buildTraceSummary(events, anchor, windowEndMs);
  const scriptCompile = collectScriptCompile(events);

  // The Performance API entry is the final LCP candidate, so it wins over the
  // trace, which may only carry the first candidate after navigation.
  let lcpCandidate = traceCandidate;
  if (lcp) {
    coreWebVitals.lcp = lcp.startTime;
    lcpCandidate = candidateFromEntry(lcp);
  }

  // Busyness is the share of the page lifecycle the main thread was busy.
  // Using the whole trace span instead would dilute the number with
  // everything that happened after the page settled.
  const windowMs = traceSummary.threadActivity.windowMs ?? traceSummary.totalDuration;
  const mainThreadBusyness =
    windowMs > 0 && traceSummary.threadActivity.totalMs > 0
      ? Math.min(1, traceSummary.threadActivity.totalMs / windowMs)
      : 0;

  const result: PerformanceIR = {
    navigation,
    coreWebVitals,
    longTasks,
    scriptCompile,
    lcpEntry: lcp,
    lcpCandidate,
    traceSummary,
    mainThreadBusyness,
  };

  return result;
}
