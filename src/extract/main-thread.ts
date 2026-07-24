/**
 * Main Thread Blocking Score extractor.
 *
 * Computes a blocking score from thread activity and main thread busyness.
 * Combines trace-level thread activity (by category) with the global
 * mainThreadBusyness ratio to produce a 0-1 blocking score.
 */

import type { IRBundle } from '../normalize/types.js';
import type { MainThreadBlocking } from './types.js';

/**
 * Extract main thread blocking metrics from an IRBundle.
 *
 * Returns undefined when traceSummary data is missing (zero duration).
 */
export function extractMainThreadBlocking(ir: IRBundle): MainThreadBlocking | undefined {
  const { traceSummary } = ir.performance;
  const totalDuration = traceSummary.totalDuration;

  if (!totalDuration || totalDuration <= 0) {
    return undefined;
  }

  const busyMs = traceSummary.threadActivity.totalMs;

  // idleMs = totalDuration - busyMs can produce absurd values (e.g. 210M ms ≈ 58h)
  // when totalDuration (trace event timestamps, wall-clock anchored) and busyMs
  // (CDP Tracing durations, monotonic clock) come from different clock domains.
  // Clamp idleMs to a sane maximum so clock-domain mismatch doesn't pollute the output.
  const IDLE_MS_MAX = 120_000; // 2 minutes — reasonable upper bound for idle time
  const idleMs = Math.min(IDLE_MS_MAX, Math.max(0, totalDuration - busyMs));

  const blockingRatio = totalDuration > 0 ? Math.min(1, Math.max(0, busyMs / totalDuration)) : 0;

  // blockingScore blends mainThreadBusyness with the raw busy ratio
  // to smooth out edge cases where one source is more reliable
  const busynessScore = ir.performance.mainThreadBusyness;
  const blockingScore = Number.isFinite(busynessScore)
    ? Math.min(1, Math.max(0, (busynessScore + blockingRatio) / 2))
    : blockingRatio;

  return {
    blockingScore,
    busyMs,
    idleMs,
    blockingRatio,
    categories: { ...traceSummary.threadActivity.byCategory },
  };
}
