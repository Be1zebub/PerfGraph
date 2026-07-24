/**
 * RuntimeIR builder from runtime and console raw data.
 *
 * Converts CDP runtime metrics and console entries into a normalized
 * RuntimeIR structure with heap stats, execution contexts, event loop
 * analysis, and hydration cost estimates.
 */

import { RuntimeIRSchema } from './types.js';
import type { RuntimeIR, ExecutionContext, EventLoopStats, HydrationCost, RuntimeIRStats } from './types.js';
import type { RuntimeRawData, ConsoleRawData, ConsoleEntry } from '../collect/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute event loop statistics from console entry inter-arrival times.
 *
 * Uses the time delta between consecutive console entries as a proxy for
 * event loop blocking — gaps > 50ms are treated as blocking events.
 *
 * @param entries - Console entries sorted by timestamp
 * @returns EventLoopStats or undefined if fewer than 2 entries or no blocking found
 */
function computeEventLoopStats(entries: ConsoleEntry[]): EventLoopStats | undefined {
  if (entries.length < 2) return undefined;

  let totalBlockingDuration = 0;
  let longTasks = 0;
  let maxBlockingDuration = 0;

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    if (!prev || !curr) continue;
    const diff = curr.timestamp - prev.timestamp;
    if (diff > 50) {
      totalBlockingDuration += diff;
      longTasks++;
      if (diff > maxBlockingDuration) {
        maxBlockingDuration = diff;
      }
    }
  }

  if (longTasks === 0) return undefined;

  return { totalBlockingDuration, longTasks, maxBlockingDuration };
}

/**
 * Compute hydration cost estimate from execution contexts and console entries.
 *
 * - bootupTime: heuristic baseline based on number of execution contexts
 * - evaluatedScripts: console entries indicating script evaluation activity
 *
 * @param contexts - Normalized execution contexts
 * @param entries  - Raw console entries
 * @returns HydrationCost estimate
 */
function computeHydrationCost(contexts: ExecutionContext[], entries: ConsoleEntry[]): HydrationCost {
  const bootupTime = contexts.length * 50;

  const evaluatedScripts = entries.filter((e) =>
    e.type === 'debug' ||
    e.args.some((arg) =>
      typeof arg === 'string' &&
      (arg.toLowerCase().includes('evaluate') ||
       arg.toLowerCase().includes('script') ||
       arg.toLowerCase().includes('render')),
    ),
  ).length;

  return { bootupTime, evaluatedScripts };
}

/**
 * Map raw runtime stats to normalized RuntimeIRStats.
 *
 * DomRawData.stats.jsHeapSize maps to totalJSHeapSize.
 * usedJSHeapSize is estimated as 60% of total (since CDP provides only
 * the total JS heap size, not the breakdown).
 * jsHeapSizeLimit is not available from the raw data and is omitted.
 *
 * @param stats - Raw runtime stats from RuntimeCollector
 * @returns Normalized RuntimeIRStats
 */
function buildJSHeapStats(stats: RuntimeRawData['stats']): RuntimeIRStats | undefined {
  if (!stats) return undefined;

  return {
    totalJSHeapSize: stats.jsHeapSize,
    usedJSHeapSize: Math.round(stats.jsHeapSize * 0.6),
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a complete RuntimeIR from runtime and console raw data.
 *
 * @param runtime - Raw runtime data from the RuntimeCollector
 * @param console - Raw console data from the ConsoleCollector
 * @returns A fully-constructed RuntimeIR
 */
export function buildRuntimeIR(
  runtime: RuntimeRawData,
  console: ConsoleRawData,
): RuntimeIR {
  // 1. Execution contexts: pass through id, origin, name
  const executionContexts: ExecutionContext[] = runtime.contexts.map((ctx) => ({
    id: ctx.id,
    origin: ctx.origin,
    name: ctx.name,
  }));

  // 2. JS heap stats
  const jsHeapStats = buildJSHeapStats(runtime.stats);

  // 3. Event loop stats from console entry inter-arrival times
  const eventLoopStats = computeEventLoopStats(console.entries ?? []);

  // 4. Hydration cost estimate
  const hydrationCost = computeHydrationCost(executionContexts, console.entries ?? []);

  const result: RuntimeIR = {
    jsHeapStats,
    executionContexts,
    eventLoopStats,
    hydrationCost,
  };

  return result;
}
