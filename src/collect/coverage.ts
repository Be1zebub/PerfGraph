/**
 * CoverageCollector — captures JavaScript and CSS code coverage via CDP.
 *
 * Uses Profiler.startPreciseCoverage for JS and CSS.startRuleUsageTracking
 * for stylesheets. Both are started pre-navigation and stopped post-navigation
 * to capture coverage data for the full page lifecycle.
 */

import { type CDPSession } from 'playwright';
import type { Collector, CollectorResult, CoverageRawData, ScriptCoverage, StyleCoverage } from './types.js';
import type { CollectorRunOptions } from '../shared/types.js';

export class CoverageCollector implements Collector {
  readonly name = 'coverage';

  private session: CDPSession | null = null;

  /**
   * Start collecting coverage data.
   * Enables Profiler and CSS domains, then starts precise JS coverage
   * and CSS rule usage tracking.
   */
  async start(session: CDPSession, _options?: CollectorRunOptions): Promise<void> {
    this.session = session;

    // Enable required domains (CSS.enable requires DOM.enable first)
    await session.send('DOM.enable');
    await session.send('Profiler.enable');
    await session.send('CSS.enable');

    // Start precise JS coverage (detailed = true gives per-byte ranges)
    await session.send('Profiler.startPreciseCoverage', {
      callCount: false,
      detailed: true,
    });

    // Start CSS rule usage tracking
    await session.send('CSS.startRuleUsageTracking');
  }

  /**
   * Stop collecting and return coverage data.
   * Takes precise JS coverage + CSS rule usage, then stops both trackers.
   */
  async stop(): Promise<CollectorResult<CoverageRawData>> {
    if (!this.session) {
      return { ok: false, error: 'CoverageCollector: session not initialised' };
    }

    const warnings: string[] = [];
    let js: CoverageRawData['js'] = [];
    let css: CoverageRawData['css'] = [];

    // --- Collect JS coverage ---
    try {
      const jsResult = await this.session.send('Profiler.takePreciseCoverage');
      js = (jsResult.result ?? []).map(
        (entry: {
          scriptId: string;
          url: string;
          functions: Array<{
            functionName: string;
            ranges: Array<{ startOffset: number; endOffset: number; count: number }>;
            isBlockCoverage: boolean;
          }>;
        }) => ({
          scriptId: entry.scriptId,
          url: entry.url,
          functions: entry.functions.map((f) => ({
            functionName: f.functionName,
            ranges: f.ranges.map((r) => ({
              startOffset: r.startOffset,
              endOffset: r.endOffset,
              count: r.count,
            })),
            isBlockCoverage: f.isBlockCoverage,
          })),
        }),
      );
    } catch (error) {
      warnings.push(`Failed to collect JS coverage: ${String(error)}`);
    }

    // --- Collect CSS coverage ---
    try {
      const cssResult = await this.session.send('CSS.stopRuleUsageTracking');
      // CSS rule usage entries have styleSheetId + ranges but not the URL
      // directly at the rule level — group them by styleSheetId
      const cssBySheet = new Map<string, CoverageRawData['css'][number]>();
      const rawEntries: Array<{
        styleSheetId: string;
        startOffset: number;
        endOffset: number;
        used: boolean;
      }> = cssResult.ruleUsage ?? [];

      for (const entry of rawEntries) {
        let sheet = cssBySheet.get(entry.styleSheetId);
        if (!sheet) {
          sheet = { styleSheetId: entry.styleSheetId, url: '', ranges: [] };
          cssBySheet.set(entry.styleSheetId, sheet);
        }
        sheet.ranges.push({
          startOffset: entry.startOffset,
          endOffset: entry.endOffset,
          count: entry.used ? 1 : 0,
        });
      }
      css = [...cssBySheet.values()];
    } catch (error) {
      warnings.push(`Failed to collect CSS coverage: ${String(error)}`);
    }

    // --- Clean up JS profiler ---
    try {
      await this.session.send('Profiler.stopPreciseCoverage');
    } catch {
      // Non-critical cleanup
    }

    return {
      ok: true,
      data: { js, css, warnings },
    };
  }
}
