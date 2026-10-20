/**
 * Tests for shared utility functions.
 *
 * Covers severityOrder and normalizeUrl (src/shared/utils.ts).
 */

import { describe, it, expect } from 'vitest';
import { severityOrder, normalizeUrl } from '../../src/shared/utils.js';

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

// ---------------------------------------------------------------------------
// normalizeUrl
// ---------------------------------------------------------------------------

describe('normalizeUrl', () => {
  it('adds https to a bare hostname', () => {
    expect(normalizeUrl('google.com')).toBe('https://google.com');
  });

  it('keeps an explicit scheme', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('keeps a non-http scheme', () => {
    expect(normalizeUrl('file:///tmp/index.html')).toBe('file:///tmp/index.html');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com');
  });

  it('completes a protocol relative URL', () => {
    expect(normalizeUrl('//example.com/x')).toBe('https://example.com/x');
  });

  it('keeps a path and query', () => {
    expect(normalizeUrl('example.com/a/b?c=1')).toBe('https://example.com/a/b?c=1');
  });

  it('returns an empty string unchanged', () => {
    expect(normalizeUrl('   ')).toBe('');
  });
});
