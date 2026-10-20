/**
 * JS Hotspots extractor.
 *
 * Identifies JS execution hotspots: long tasks, the largest single block and
 * the number of script execution contexts.
 *
 * The long-task numbers come from the browser's own `LongTask` trace events —
 * the same source as the measured TBT. A gap between two console messages
 * says nothing about blocking, so it is only used when the trace has no
 * long-task events at all, and the source is reported either way.
 */

import type { IRBundle } from '../normalize/types.js';
import type { JSHotspots } from './types.js';

/**
 * Extract JS hotspot metrics from an IRBundle.
 *
 * Never returns undefined — defaults to zero when runtime data is absent.
 */
export function extractJSHotspots(ir: IRBundle): JSHotspots {
  const { runtime } = ir;
  const traceLongTasks = ir.performance.longTasks;
  const consoleStats = runtime.eventLoopStats;

  const longTaskCount = traceLongTasks?.count ?? consoleStats?.longTasks ?? 0;
  const maxBlockingDuration =
    traceLongTasks?.maxBlockingMs ?? consoleStats?.maxBlockingDuration ?? 0;

  const scriptCount = ir.network.requests.filter(
    (r) => r.resourceType === 'Script' && !r.failed,
  ).length;

  return {
    // Only a measured value is reported: the previous heuristic multiplied the
    // execution-context count by a constant and presented it as bootup time.
    bootupTime: runtime.hydrationCost?.bootupTime,
    evaluatedScripts: runtime.hydrationCost?.evaluatedScripts,
    longTaskCount,
    maxBlockingDuration,
    contextCount: runtime.executionContexts.length,
    scriptCount,
    compileTimeMs: ir.performance.scriptCompile?.totalMs,
    source: traceLongTasks ? 'trace' : consoleStats ? 'console-gap' : 'none',
  };
}
