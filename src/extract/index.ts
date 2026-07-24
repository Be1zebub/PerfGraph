/**
 * Feature Extraction — entry point.
 *
 * extract() принимает IRBundle, запускает все extractor-функции и собирает
 * FeatureSet. Каждая фича опциональна (graceful degradation при нехватке данных).
 */

import type { IRBundle } from '../normalize/types.js';
import type { FeatureSet } from './types.js';
import { extractLCPBreakdown } from './lcp-breakdown.js';
import { extractCriticalPath } from './critical-path.js';
import { extractMainThreadBlocking } from './main-thread.js';
import { extractJSHotspots } from './js-hotspots.js';
import { extractLayoutShifts } from './layout-shifts.js';
import { extractThirdPartyOverhead } from './third-party.js';
import { extractRenderBlocking } from './render-blocking.js';

/**
 * Извлечь все диагностические сигналы из IRBundle.
 *
 * Чистая функция: одинаковый IRBundle → одинаковый FeatureSet.
 * Возвращает FeatureSet со всеми опциональными полями.
 */
export function extract(ir: IRBundle): FeatureSet {
  return {
    url: ir.meta.url || undefined,
    lcpBreakdown: extractLCPBreakdown(ir),
    criticalPath: extractCriticalPath(ir),
    mainThreadBlocking: extractMainThreadBlocking(ir),
    jsHotspots: extractJSHotspots(ir),
    layoutShifts: extractLayoutShifts(ir),
    thirdPartyOverhead: extractThirdPartyOverhead(ir),
    renderBlocking: extractRenderBlocking(ir),
  };
}
