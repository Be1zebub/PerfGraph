/**
 * Tests for shared utility functions.
 *
 * Covers severityOrder (src/shared/utils.ts).
 */

import { describe, it, expect } from 'vitest';
import { severityOrder } from '../../src/shared/utils.js';

// ---------------------------------------------------------------------------
// severityOrder
// ---------------------------------------------------------------------------

describe('severityOrder', () => {
  it('returns 3 for critical', () => {
    expect(severityOrder('critical')).toBe(3);
  });

  it('returns 2 for warning', () => {
    expect(severityOrder('warning')).toBe(2);
  });

  it('returns 1 for info', () => {
    expect(severityOrder('info')).toBe(1);
  });

  it('returns 0 for unknown severity', () => {
    expect(severityOrder('debug')).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(severityOrder('')).toBe(0);
  });

  it('returns 0 for arbitrary unknown strings', () => {
    expect(severityOrder('error')).toBe(0);
    expect(severityOrder('low')).toBe(0);
    expect(severityOrder('high')).toBe(0);
  });

  it('is case-sensitive (lowercase only)', () => {
    expect(severityOrder('Critical')).toBe(0);
    expect(severityOrder('WARNING')).toBe(0);
  });
});
