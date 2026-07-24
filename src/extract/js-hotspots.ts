/**
 * JS Hotspots extractor.
 *
 * Identifies JS execution hotspots from runtime IR data:
 * hydration cost, long tasks, and execution context count.
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

  return {
    bootupTime: runtime.hydrationCost?.bootupTime ?? 0,
    evaluatedScripts: runtime.hydrationCost?.evaluatedScripts ?? 0,
    longTaskCount: runtime.eventLoopStats?.longTasks ?? 0,
    maxBlockingDuration: runtime.eventLoopStats?.maxBlockingDuration ?? 0,
    contextCount: runtime.executionContexts.length,
  };
}
