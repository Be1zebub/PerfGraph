/**
 * TraceCollector — captures Chrome trace events via the Tracing CDP domain.
 *
 * Sends `Tracing.start` with a comprehensive set of categories, buffers
 * events delivered via `Tracing.dataCollected`, and on `stop()` sends
 * `Tracing.end` and waits for `Tracing.tracingComplete`.
 *
 * Also monitors `Tracing.bufferUsage` and emits warnings when the ring
 * buffer exceeds safe thresholds. Buffer health analysis is delegated
 * to the standalone `buffer-monitor` module.
 */

import { type CDPSession } from 'playwright';
import type { Collector, CollectorResult } from './types.js';
import type { TraceRawData, TraceEvent, BufferUsageSample } from './types.js';
import type { CollectorRunOptions } from '../shared/types.js';
import { checkBufferHealth, validateTraceCompleteness } from './buffer-monitor.js';

/** Categories requested for tracing */
const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'blink.user_timing',
  'loading',
  'blink',
  'cc',
  'gpu',
  'v8',
  'disabled-by-default-v8.cpu_profiler',
  'disabled-by-default-v8.compile',
] as const;

export class TraceCollector implements Collector {
  readonly name = 'trace';

  private session: CDPSession | null = null;
  private events: TraceEvent[] = [];
  private dataCollectedCount = 0;
  private bufferUsageSamples: BufferUsageSample[] = [];
  private tracingDone = false;
  private resolveTracingComplete!: () => void;
  private tracingCompletePromise: Promise<void>;

  constructor() {
    this.tracingCompletePromise = new Promise((resolve) => {
      this.resolveTracingComplete = resolve;
    });
  }

  /**
   * Start tracing via the CDP Tracing domain.
   * Registers event listeners for data collection, completion, and buffer usage.
   */
  async start(session: CDPSession, _options?: CollectorRunOptions): Promise<void> {
    this.session = session;
    this.events = [];
    this.dataCollectedCount = 0;
    this.bufferUsageSamples = [];
    this.tracingDone = false;
    this.tracingCompletePromise = new Promise((resolve) => {
      this.resolveTracingComplete = resolve;
    });

    // Listen for batched trace events
    session.on('Tracing.dataCollected', (event: { value: unknown[] }) => {
      if (Array.isArray(event.value)) {
        this.events.push(...(event.value as TraceEvent[]));
        this.dataCollectedCount++;
      }
    });

    // Listen for tracing completion
    session.on('Tracing.tracingComplete', () => {
      this.tracingDone = true;
      this.resolveTracingComplete();
    });

    // Monitor buffer usage for overflow detection
    session.on('Tracing.bufferUsage', (event: { value?: number }) => {
      if (event.value !== undefined) {
        this.bufferUsageSamples.push({
          value: event.value,
          timestamp: Date.now(),
        });
      }
    });

    // Send Tracing.start — categories is a comma-separated string per CDP spec
    await session.send('Tracing.start', {
      categories: [...TRACE_CATEGORIES].join(','),
      transferMode: 'ReportEvents',
    });
  }

  /**
   * Stop tracing, wait for completion, and return collected trace data.
   *
   * @returns CollectorResult with TraceRawData on success
   */
  async stop(): Promise<CollectorResult<TraceRawData>> {
    if (!this.session) {
      return { ok: false, error: 'TraceCollector: session not initialized' };
    }

    try {
      // Send Tracing.end and wait for TracingComplete
      await this.session.send('Tracing.end');
      await this.tracingCompletePromise;
    } catch (error) {
      return {
        ok: false,
        error: `TraceCollector: failed to stop tracing — ${String(error)}`,
      };
    }

    // Analyze buffer health via standalone module
    const warnings: string[] = [];
    warnings.push(...checkBufferHealth(this.bufferUsageSamples));

    // Run completeness validation via standalone module
    const eventNames = this.events.map((e) => e.name);
    warnings.push(...validateTraceCompleteness(eventNames));

    const categories: string[] = [...TRACE_CATEGORIES];

    return {
      ok: true,
      data: {
        events: this.events,
        metadata: {
          categories,
          totalEvents: this.events.length,
          dataCollectedCount: this.dataCollectedCount,
        },
        warnings,
      },
    };
  }

  /** Return collected buffer usage samples (useful for tests and monitoring) */
  getBufferUsageSamples(): BufferUsageSample[] {
    return [...this.bufferUsageSamples];
  }
}
