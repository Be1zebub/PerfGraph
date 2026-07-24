/**
 * Buffer monitor unit tests.
 *
 * Tests the standalone `buffer-monitor` module functions in isolation,
 * without any CDP session or browser dependency.
 */

import { describe, it, expect } from 'vitest';
import { checkBufferHealth, validateTraceCompleteness } from '../src/collect/buffer-monitor.js';
import type { BufferUsageSample } from '../src/collect/types.js';

// ---------------------------------------------------------------------------
// checkBufferHealth
// ---------------------------------------------------------------------------

describe('checkBufferHealth', () => {
  it('returns no warnings for an empty sample array', () => {
    const warnings = checkBufferHealth([]);
    expect(warnings).toEqual([]);
  });

  it('returns no warnings when peak usage is below 80%', () => {
    const samples: BufferUsageSample[] = [
      { value: 0.1, timestamp: 100 },
      { value: 0.5, timestamp: 200 },
      { value: 0.75, timestamp: 300 },
    ];
    const warnings = checkBufferHealth(samples);
    expect(warnings).toEqual([]);
  });

  it('returns a warning when peak usage exceeds 80% but is below 95%', () => {
    const samples: BufferUsageSample[] = [
      { value: 0.1, timestamp: 100 },
      { value: 0.85, timestamp: 200 },
      { value: 0.4, timestamp: 300 },
    ];
    const warnings = checkBufferHealth(samples);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('85%');
    expect(warnings[0]).toContain('may be incomplete');
  });

  it('returns a critical warning when peak usage exceeds 95%', () => {
    const samples: BufferUsageSample[] = [
      { value: 0.1, timestamp: 100 },
      { value: 0.97, timestamp: 200 },
    ];
    const warnings = checkBufferHealth(samples);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('97%');
    expect(warnings[0]).toContain('very likely incomplete');
  });

  it('returns the critical warning (not the mild one) when usage exceeds 95%', () => {
    // If peak > 0.95, only the critical warning should be emitted
    const samples: BufferUsageSample[] = [
      { value: 0.81, timestamp: 100 },
      { value: 0.99, timestamp: 200 },
    ];
    const warnings = checkBufferHealth(samples);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('very likely incomplete');
  });

  it('handles a single sample at exactly 0.8 (no warning)', () => {
    const samples: BufferUsageSample[] = [{ value: 0.8, timestamp: 100 }];
    const warnings = checkBufferHealth(samples);
    expect(warnings).toEqual([]);
  });

  it('handles a single sample just over 0.8 (warning)', () => {
    const samples: BufferUsageSample[] = [{ value: 0.81, timestamp: 100 }];
    const warnings = checkBufferHealth(samples);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('81%');
  });

  it('handles a single sample at exactly 0.95 (critical warning)', () => {
    const samples: BufferUsageSample[] = [{ value: 0.95, timestamp: 100 }];
    const warnings = checkBufferHealth(samples);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('95%');
    expect(warnings[0]).toContain('very likely incomplete');
  });
});

// ---------------------------------------------------------------------------
// validateTraceCompleteness
// ---------------------------------------------------------------------------

describe('validateTraceCompleteness', () => {
  const ALL_CRITICAL_EVENTS = [
    'navigationStart',
    'firstContentfulPaint',
    'firstPaint',
    'LargestContentfulPaint',
  ];

  it('returns no warnings when all critical events are present', () => {
    const warnings = validateTraceCompleteness(ALL_CRITICAL_EVENTS);
    expect(warnings).toEqual([]);
  });

  it('returns a warning when a critical event is missing', () => {
    const warnings = validateTraceCompleteness([
      'navigationStart',
      'firstContentfulPaint',
      'LargestContentfulPaint',
    ]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('missing expected events');
    expect(warnings[0]).toContain('firstPaint');
  });

  it('reports multiple missing events in a single warning', () => {
    const warnings = validateTraceCompleteness(['navigationStart']);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('firstContentfulPaint');
    expect(warnings[0]).toContain('firstPaint');
    expect(warnings[0]).toContain('LargestContentfulPaint');
  });

  it('returns a warning when all critical events are missing', () => {
    const warnings = validateTraceCompleteness([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('missing expected events');
  });

  it('handles extra unknown events without complaint', () => {
    const warnings = validateTraceCompleteness([
      ...ALL_CRITICAL_EVENTS,
      'unknownEvent',
      'anotherOne',
    ]);
    expect(warnings).toEqual([]);
  });

  it('accepts a Set of event names', () => {
    const warnings = validateTraceCompleteness(new Set(ALL_CRITICAL_EVENTS));
    expect(warnings).toEqual([]);
  });

  it('accepts an empty Set', () => {
    const warnings = validateTraceCompleteness(new Set<string>());
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('missing expected events');
  });
});
