/**
 * RuntimeCollector — captures JavaScript runtime context and stats via CDP.
 *
 * Enables the Runtime domain to track execution context creation (frames,
 * workers, extensions) and evaluates runtime metrics (JS heap, DOM node
 * count) on stop().
 */

import { type CDPSession } from 'playwright';
import type { Collector, CollectorResult, RuntimeRawData } from './types.js';
import type { CollectorRunOptions } from '../shared/types.js';

export class RuntimeCollector implements Collector {
  readonly name = 'runtime';

  private session: CDPSession | null = null;
  private contexts: RuntimeRawData['contexts'] = [];

  /**
   * Start collecting runtime data.
   * Enables the Runtime CDP domain and subscribes to executionContextCreated.
   */
  async start(session: CDPSession, _options?: CollectorRunOptions): Promise<void> {
    this.session = session;
    this.contexts = [];

    // Enable Runtime domain so we receive execution context events
    await session.send('Runtime.enable');

    // Track all execution contexts created during the session
    session.on('Runtime.executionContextCreated', (event: { context: { id: number; origin: string; name: string } }) => {
      if (event.context) {
        this.contexts.push({
          id: event.context.id,
          origin: event.context.origin,
          name: event.context.name,
        });
      }
    });
  }

  /**
   * Stop collecting and return runtime data.
   * Evaluates inline JavaScript to capture runtime stats.
   */
  async stop(): Promise<CollectorResult<RuntimeRawData>> {
    if (!this.session) {
      return { ok: false, error: 'RuntimeCollector: session not initialised' };
    }

    let stats: RuntimeRawData['stats'] = undefined;

    try {
      // Evaluate runtime stats within the page context
      const result = await this.session.send('Runtime.evaluate', {
        expression: `({
          jsHeapSize: performance?.memory?.usedJSHeapSize ?? null,
          domNodeCount: document?.querySelectorAll('*')?.length ?? null,
          documentUrl: document?.URL ?? ''
        })`,
        returnByValue: true,
      });

      const value = result?.result?.value as
        | { jsHeapSize: number | null; domNodeCount: number | null; documentUrl: string }
        | undefined;

      if (value) {
        stats = {
          jsHeapSize: value.jsHeapSize ?? 0,
          domNodeCount: value.domNodeCount ?? 0,
          documentUrl: value.documentUrl ?? '',
        };
      }
    } catch (error) {
      // Stats are non-critical — return contexts even if evaluation fails
      return {
        ok: true,
        data: {
          contexts: this.contexts,
          warnings: [`Failed to evaluate runtime stats: ${String(error)}`],
        },
      };
    }

    return {
      ok: true,
      data: {
        contexts: this.contexts,
        stats,
        warnings: [],
      },
    };
  }
}
