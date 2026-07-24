/**
 * PerformanceCollector — captures browser performance metrics via the CDP Performance domain.
 *
 * Uses:
 *   - Performance.enable to receive periodic Performance.metrics events.
 *   - Performance.getMetrics after page load to capture the final metrics snapshot.
 *
 * Standard metrics include Timestamp, Documents, Frames, JSEventListeners, Nodes,
 * LayoutCount, RecalcStyleCount, LayoutDuration, RecalcStyleDuration,
 * ScriptDuration, TaskDuration, JSHeapUsedSize, JSHeapTotalSize,
 * FirstMeaningfulPaint, DomContentLoaded, and NavigationStart.
 */

import { type CDPSession } from 'playwright';
import type { Collector, CollectorResult } from './types.js';
import type { PerformanceRawData, PerformanceMetric } from './types.js';
import type { CollectorRunOptions } from '../shared/types.js';

/**
 * Validate the collected performance metrics are reasonable.
 *
 * @param metrics - Array of collected performance metrics
 * @returns Array of warning strings
 */
function validatePerformanceMetrics(metrics: PerformanceMetric[]): string[] {
  const warnings: string[] = [];

  if (metrics.length === 0) {
    warnings.push('No performance metrics were collected.');
    return warnings;
  }

  // Check for expected standard metrics
  const expectedMetrics = [
    'Timestamp',
    'Documents',
    'Frames',
    'JSEventListeners',
    'Nodes',
    'JSHeapUsedSize',
    'JSHeapTotalSize',
  ];

  const metricNames = new Set(metrics.map((m) => m.name));
  const missing = expectedMetrics.filter((name) => !metricNames.has(name));

  if (missing.length > 0) {
    warnings.push(
      `Performance metrics may be incomplete — missing expected metrics: ${missing.join(', ')}`,
    );
  }

  return warnings;
}

export class PerformanceCollector implements Collector {
  readonly name = 'performance';

  private session: CDPSession | null = null;
  /** Accumulated timeline metric snapshots */
  private timelineSnapshots: PerformanceMetric[][] = [];
  private collected = false;

  async start(session: CDPSession, _options?: CollectorRunOptions): Promise<void> {
    this.session = session;
    this.timelineSnapshots = [];
    this.collected = false;

    // Listen for periodic Performance.metrics events
    session.on(
      'Performance.metrics',
      ((event: { metrics: PerformanceMetric[] }) => {
        if (Array.isArray(event.metrics) && event.metrics.length > 0) {
          this.timelineSnapshots.push(event.metrics);
        }
      }) as (payload: unknown) => void,
    );

    // Enable the Performance domain to receive metrics events
    await session.send('Performance.enable');
  }

  async stop(): Promise<CollectorResult<PerformanceRawData>> {
    this.collected = true;

    if (!this.session) {
      return { ok: false, error: 'PerformanceCollector: session not initialized' };
    }

    const warnings: string[] = [];

    try {
      // Query final metrics snapshot
      const result = await this.session.send('Performance.getMetrics');
      const metrics: PerformanceMetric[] = result.metrics as PerformanceMetric[];
      const timestamp = Date.now();

      // Disable the Performance domain
      try {
        await this.session.send('Performance.disable');
      } catch {
        // Non-critical — domain may already be disabled
      }

      // Run completeness validation
      const validationWarnings = validatePerformanceMetrics(metrics);
      warnings.push(...validationWarnings);

      // Check for timeline data availability
      if (this.timelineSnapshots.length > 0) {
        warnings.push(
          `${this.timelineSnapshots.length} timeline metric snapshot(s) were collected during the session (data available for delta analysis).`,
        );
      }

      return {
        ok: true,
        data: {
          metrics,
          timestamp,
          warnings,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `PerformanceCollector: failed to get metrics — ${String(error)}`,
      };
    }
  }

  /** Return timeline metric snapshots collected during the session (useful for tests) */
  getTimelineSnapshots(): PerformanceMetric[][] {
    return [...this.timelineSnapshots];
  }
}
