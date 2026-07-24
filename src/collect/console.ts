/**
 * ConsoleCollector — captures console API calls from the page via CDP.
 *
 * Listens for Runtime.consoleAPICalled events and records each entry
 * with its type, arguments, timestamp, and optional stack trace.
 * Groups entries by severity for quick analysis.
 */

import { type CDPSession } from 'playwright';
import type { Collector, CollectorResult, ConsoleRawData, ConsoleEntry } from './types.js';
import type { CollectorRunOptions } from '../shared/types.js';

export class ConsoleCollector implements Collector {
  readonly name = 'console';

  private session: CDPSession | null = null;
  private entries: ConsoleRawData['entries'] = [];

  /**
   * Start collecting console API calls.
   * Enables Runtime domain and subscribes to consoleAPICalled events.
   */
  async start(session: CDPSession, _options?: CollectorRunOptions): Promise<void> {
    this.session = session;
    this.entries = [];

    // Ensure Runtime domain is enabled for console API events
    await session.send('Runtime.enable');

    // Capture every console API call
    session.on('Runtime.consoleAPICalled', (event: {
      type: string;
      args: Array<{ type: string; value?: unknown; description?: string }>;
      timestamp: number;
      stackTrace?: { callFrames: Array<{ url: string; lineNumber: number; columnNumber: number; functionName?: string }> };
    }) => {
      // Serialise arguments: prefer value, fall back to description, then type hint
      const args = (event.args ?? []).map(
        (a) => a.value ?? a.description ?? `<${a.type}>`,
      );

      const entry: ConsoleRawData['entries'][number] = {
        // CDP timestamp is in seconds; convert to milliseconds
        timestamp: event.timestamp * 1000,
        type: event.type as ConsoleRawData['entries'][number]['type'],
        args,
        stackTrace: event.stackTrace?.callFrames?.map((f) => ({
          url: f.url,
          lineNumber: f.lineNumber,
          columnNumber: f.columnNumber,
          functionName: f.functionName,
        })),
      };

      this.entries.push(entry);
    });
  }

  /**
   * Stop collecting and return console data with severity counts.
   */
  async stop(): Promise<CollectorResult<ConsoleRawData>> {
    if (!this.session) {
      return { ok: false, error: 'ConsoleCollector: session not initialised' };
    }

    // Compute severity counts
    const counts: ConsoleRawData['counts'] = { log: 0, warn: 0, error: 0, info: 0, debug: 0, other: 0 };

    for (const entry of this.entries) {
      switch (entry.type) {
        case 'log':   counts.log++;   break;
        case 'warn':  counts.warn++;  break;
        case 'error': counts.error++; break;
        case 'info':  counts.info++;  break;
        case 'debug': counts.debug++; break;
        default:      counts.other++; break;
      }
    }

    return {
      ok: true,
      data: {
        entries: this.entries,
        counts,
        warnings: [],
      },
    };
  }
}
