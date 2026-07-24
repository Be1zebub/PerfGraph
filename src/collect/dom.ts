/**
 * DOMCollector — captures DOM structure metadata via page.evaluate().
 *
 * Extracts the following from the live page after navigation:
 * - Total node count (elements, text nodes, comments)
 * - Maximum DOM tree depth
 * - Element type distribution (count per tag name)
 * - Total text content length
 *
 * Uses page.evaluate() rather than CDP domains for lightweight introspection.
 * Does NOT traverse the full DOM tree — collects aggregate stats only.
 */

import { type CDPSession, type Page } from 'playwright';
import type { Collector, CollectorResult, DomRawData } from './types.js';
import type { CollectorRunOptions } from '../shared/types.js';

export class DOMCollector implements Collector {
  readonly name = 'dom';

  private session: CDPSession | null = null;

  /**
   * @param page - Playwright Page instance used for evaluate() calls.
   *               The page reference is required because DOM stats are
   *               extracted via in-page JavaScript, not CDP commands.
   */
  constructor(private readonly page: Page) {}

  /**
   * Start collecting DOM data.
   * Currently a no-op — DOM snapshot is taken on stop() after navigation.
   */
  async start(session: CDPSession, _options?: CollectorRunOptions): Promise<void> {
    this.session = session;
  }

  /**
   * Stop collecting and return DOM metadata.
   * Runs page.evaluate() to extract aggregate DOM statistics.
   */
  async stop(): Promise<CollectorResult<DomRawData>> {
    const page = this.page;

    try {
      const result = await page.evaluate(() => {
        let totalNodes = 0;
        let maxDepth = 0;
        const elementCounts: Record<string, number> = {};

        /**
         * Recursively walk the DOM tree counting nodes and tracking depth.
         * Walks via childNodes to capture text nodes and comments too.
         */
        function walk(node: Node, depth: number): void {
          // Count this node
          totalNodes++;

          if (depth > maxDepth) maxDepth = depth;

          // If it's an element, count its tag and recurse through children
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            const tag = el.tagName.toLowerCase();
            elementCounts[tag] = (elementCounts[tag] ?? 0) + 1;

            // Recurse only through element children (children is live but
            // we're reading sequentially, not mutating)
            const children = el.children;
            for (let i = 0; i < children.length; i++) {
              walk(children[i]!, depth + 1);
            }
          }

          // Count non-element children (text nodes, comments, etc.)
          // These are found via childNodes but NOT recursed into since
          // they cannot contain elements
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_NODE) {
            const childNodes = node.childNodes;
            for (let i = 0; i < childNodes.length; i++) {
              const child = childNodes[i]!;
              if (
                child.nodeType === Node.TEXT_NODE ||
                child.nodeType === Node.COMMENT_NODE ||
                child.nodeType === Node.CDATA_SECTION_NODE ||
                child.nodeType === Node.PROCESSING_INSTRUCTION_NODE
              ) {
                totalNodes++;
              }
            }
          }
        }

        // Start walking from body (document is above body/html which would
        // double-count)
        if (document.body) {
          walk(document.body, 0);
        }

        const textContentLength = document.body?.textContent?.length ?? 0;

        return {
          totalNodes,
          elementCount: elementCounts,
          maxDepth,
          textContentLength,
          elementDistribution: elementCounts,
        };
      });

      const distribution = result.elementDistribution as Record<string, number>;

      return {
        ok: true,
        data: {
          stats: {
            totalNodes: result.totalNodes,
            elementCount: Object.values(distribution).reduce(
              (sum: number, n: number) => sum + n, 0,
            ),
            maxDepth: result.maxDepth,
            textContentLength: result.textContentLength,
          },
          elementDistribution: distribution,
          warnings: [],
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `DOMCollector: failed to collect DOM stats — ${String(error)}`,
      };
    }
  }
}
