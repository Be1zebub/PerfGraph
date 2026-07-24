/**
 * buffer-monitor — standalone trace buffer health analysis.
 *
 * Extracted from TraceCollector so that buffer health checks can be tested
 * and reused independently of the CDP session lifecycle.
 *
 * @module
 */

import type { BufferUsageSample } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Warnings are emitted when peak usage exceeds this fraction (80%) */
const WARN_THRESHOLD = 0.8;

/** Critical warnings are emitted when peak usage exceeds this fraction (95%) */
const CRITICAL_THRESHOLD = 0.95;

/** Event names that should typically appear in a complete trace */
const CRITICAL_TRACE_EVENTS = [
  'navigationStart',
  'firstContentfulPaint',
  'firstPaint',
  'LargestContentfulPaint',
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse collected buffer-usage samples and return human-readable warnings
 * when the ring buffer exceeded safe thresholds.
 *
 * @param samples - Array of buffer usage samples from `Tracing.bufferUsage`
 * @returns Warning strings (empty array = buffer health OK)
 */
export function checkBufferHealth(samples: BufferUsageSample[]): string[] {
  const warnings: string[] = [];

  if (samples.length === 0) {
    return warnings;
  }

  const peakUsage = Math.max(...samples.map((s) => s.value));

  if (peakUsage >= CRITICAL_THRESHOLD) {
    warnings.push(
      `Trace buffer usage reached ${Math.round(peakUsage * 100)}% — data is very likely incomplete. ` +
        'Consider reducing trace categories or increasing the buffer size.',
    );
  } else if (peakUsage > WARN_THRESHOLD) {
    warnings.push(
      `Trace buffer usage reached ${Math.round(peakUsage * 100)}% — data may be incomplete.`,
    );
  }

  return warnings;
}

/**
 * Validate trace completeness by checking for expected critical event names.
 *
 * @param eventNames - Set or array of event name strings present in a trace
 * @returns Warning strings for each missing critical event type
 */
export function validateTraceCompleteness(eventNames: string[] | Set<string>): string[] {
  const warnings: string[] = [];
  const present = eventNames instanceof Set ? eventNames : new Set(eventNames);
  const missing: string[] = [];

  for (const eventName of CRITICAL_TRACE_EVENTS) {
    if (!present.has(eventName)) {
      missing.push(eventName);
    }
  }

  if (missing.length > 0) {
    warnings.push(
      `Trace may be incomplete — missing expected events: ${missing.join(', ')}. ` +
        'This may be normal for early-page-load traces.',
    );
  }

  return warnings;
}
