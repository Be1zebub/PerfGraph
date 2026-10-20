/**
 * Largest Contentful Paint capture via the Performance API.
 *
 * The PerformanceObserver is the source the browser itself uses for the LCP
 * metric. Two properties make it better than the trace for this purpose:
 *
 * - it keeps every candidate, so the last entry is the real largest
 *   contentful paint instead of the first one that appeared after navigation;
 * - it exposes `loadTime` and `renderTime`, which give the genuine Chrome
 *   breakdown of the LCP timestamp without inferring it from the network log.
 */

import { type Page } from 'playwright';

/** A single largest contentful paint entry, in ms relative to navigation start */
export interface LcpEntry {
  /** LCP timestamp in ms relative to the time origin */
  startTime: number;
  /** Painted size of the element in CSS pixels */
  size: number;
  /** Resource URL of an image candidate; empty for text candidates */
  url?: string;
  /** Lowercase tag name of the candidate element */
  elementTag?: string;
  /** id attribute of the candidate element */
  elementId?: string;
  /** class attribute of the candidate element */
  elementClass?: string;
  /** Time the candidate resource finished loading */
  loadTime?: number;
  /** Time the candidate element was painted */
  renderTime?: number;
}

/** How long to wait for the LCP candidates to settle before giving up */
const DEFAULT_SETTLE_MS = 1_000;

/**
 * Capture the final largest contentful paint entry of a page.
 *
 * The observer is registered with `buffered: true`, so candidates that fired
 * before the observer existed are still delivered. The promise resolves with
 * the last entry once no new candidate has arrived for `settleMs`, or with
 * whatever was collected when the timeout expires.
 *
 * @param page - Playwright page to observe
 * @param timeoutMs - Maximum time to wait for a candidate
 * @param settleMs - Quiet period after which the LCP is considered final
 * @returns The final LCP entry, or undefined when the page reported none
 */
export async function captureLcpEntry(
  page: Page,
  timeoutMs: number,
  settleMs: number = DEFAULT_SETTLE_MS,
): Promise<LcpEntry | undefined> {
  try {
    const raw = await page.evaluate(
      ({ timeout, settle }) =>
        new Promise<Record<string, unknown> | null>((resolve) => {
          const entries: PerformanceEntry[] = [];
          const startedAt = performance.now();
          let lastEntryAt = startedAt;
          let settled = false;

          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              entries.push(entry);
              lastEntryAt = performance.now();
            }
          });

          try {
            observer.observe({ type: 'largest-contentful-paint', buffered: true });
          } catch {
            resolve(null);
            return;
          }

          const finish = () => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            const last = entries[entries.length - 1] as
              | (PerformanceEntry & {
                  size?: number;
                  url?: string;
                  element?: Element;
                  loadTime?: number;
                  renderTime?: number;
                })
              | undefined;
            if (!last) {
              resolve(null);
              return;
            }
            const element = last.element;
            resolve({
              startTime: last.startTime,
              size: last.size,
              url: last.url || undefined,
              elementTag: element?.tagName?.toLowerCase(),
              elementId: element?.id || undefined,
              elementClass:
                typeof element?.className === 'string' && element.className.length > 0
                  ? element.className
                  : undefined,
              loadTime: last.loadTime,
              renderTime: last.renderTime,
            });
          };

          const timer = setInterval(() => {
            const elapsed = performance.now() - startedAt;
            const quiet = performance.now() - lastEntryAt;
            if (entries.length > 0 && quiet >= settle) {
              clearInterval(timer);
              finish();
              return;
            }
            if (elapsed >= timeout) {
              clearInterval(timer);
              finish();
            }
          }, 100);
        }),
      { timeout: timeoutMs, settle: settleMs },
    );

    if (!raw) return undefined;

    const entry: LcpEntry = {
      startTime: Number(raw.startTime),
      size: Number(raw.size),
    };
    if (typeof raw.url === 'string' && raw.url.length > 0) entry.url = raw.url;
    if (typeof raw.elementTag === 'string') entry.elementTag = raw.elementTag;
    if (typeof raw.elementId === 'string') entry.elementId = raw.elementId;
    if (typeof raw.elementClass === 'string') entry.elementClass = raw.elementClass;
    if (typeof raw.loadTime === 'number') entry.loadTime = raw.loadTime;
    if (typeof raw.renderTime === 'number') entry.renderTime = raw.renderTime;

    return entry;
  } catch {
    // page.evaluate failed (CSP restrictions, page crash, etc.)
    return undefined;
  }
}
