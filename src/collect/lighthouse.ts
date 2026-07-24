/**
 * LighthouseCollector — runs a Lighthouse audit against the target URL.
 *
 * Unlike other collectors, Lighthouse manages its own browser instance via
 * chrome-launcher. This collector does NOT participate in the normal CDP
 * start/stop flow. Instead, call `runCollection(url)` directly from the
 * orchestrator AFTER the CDP session's browser has been closed.
 *
 * This avoids interference between Lighthouse and CDP tracing/coverage.
 */

import { type CDPSession } from 'playwright';
import { launch as launchChrome, type LaunchedChrome } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import type { Collector, CollectorResult, LighthouseRawData, LighthouseCategory } from './types.js';
import type { CollectorRunOptions } from '../shared/types.js';

export class LighthouseCollector implements Collector {
  readonly name = 'lighthouse';

  /** Categories to include in every Lighthouse run */
  private readonly defaultCategories: LighthouseCategory[] = [
    'performance',
    'accessibility',
    'best-practices',
    'seo',
  ];

  /**
   * Start is a no-op because Lighthouse manages its own browser.
   * Use runCollection() instead.
   */
  async start(_session: CDPSession, _options?: CollectorRunOptions): Promise<void> {
    // No-op — Lighthouse manages its own browser lifecycle
  }

  /**
   * Stop is a no-op because Lighthouse manages its own lifecycle.
   * Use runCollection() instead.
   */
  async stop(): Promise<CollectorResult<LighthouseRawData>> {
    return {
      ok: false,
      error: 'LighthouseCollector: use runCollection() instead of stop()',
    };
  }

  /**
   * Execute a full Lighthouse audit.
   *
   * When `cdpPort` is provided, connects to an existing Chrome instance
   * (e.g. the Playwright browser used for CDP collection). Otherwise
   * launches its own headless Chrome instance via chrome-launcher.
   *
   * @param url - Target URL to audit
   * @param cdpPort - Optional CDP debugging port of an existing Chrome instance
   * @returns CollectorResult with full Lighthouse result
   */
  async runCollection(url: string, cdpPort?: number): Promise<CollectorResult<LighthouseRawData>> {
    let chrome: LaunchedChrome | null = null;

    try {
      const flags: { port: number; output: 'json'; onlyCategories: LighthouseCategory[] } = {
        port: 0,
        output: 'json',
        onlyCategories: this.defaultCategories,
      };

      if (cdpPort !== undefined) {
        // Connect to an existing browser instance (Option C — same Chrome as CDP collectors)
        flags.port = cdpPort;
      } else {
        // Fallback: launch a dedicated Chrome instance for Lighthouse
        chrome = await launchChrome({
          chromeFlags: [
            '--headless',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
          ],
        });
        flags.port = chrome.port;
      }

      const result = await lighthouse(url, flags);

      if (!result) {
        return { ok: false, error: 'LighthouseCollector: Lighthouse returned no result' };
      }

      // The LHR may be a string (JSON) or already an object depending on
      // the output flag. We handle both.
      const lhr: Record<string, unknown> =
        typeof result.lhr === 'string' ? JSON.parse(result.lhr) : result.lhr;

      return {
        ok: true,
        data: {
          lhr,
          categories: this.defaultCategories,
          warnings: [],
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `LighthouseCollector: ${String(error)}`,
      };
    } finally {
      // Always clean up the browser
      if (chrome) {
        try {
          await chrome.kill();
        } catch {
          // Best-effort cleanup
        }
      }
    }
  }
}
