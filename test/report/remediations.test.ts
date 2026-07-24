/**
 * Remediations — targeted unit tests for the getRemediation function.
 *
 * Tests cover:
 * - Parameterized texts with evidence (URLs, metric values)
 * - Fallback to default boilerplate when no context is provided
 * - Unknown issue IDs producing sensible generic text
 * - Backward compatibility with the old signature pattern
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import { getRemediation } from '../../src/report/remediations.js';

describe('getRemediation', () => {
  // ---- Render-blocking resources ----

  it('returns URL-specific remediation for rb-resources with evidence', () => {
    const text = getRemediation('rb-resources', {
      evidence: { urls: ['style.css', 'app.js'] },
    });
    expect(text).toContain('style.css');
    expect(text).toContain('app.js');
    expect(text).toContain('Render-blocking resources');
  });

  it('returns default remediation for rb-resources without evidence', () => {
    const text = getRemediation('rb-resources');
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(10);
  });

  // ---- TTFB ----

  it('includes metric value in high-ttfb remediation', () => {
    const text = getRemediation('high-ttfb', { value: 1200 });
    expect(text).toContain('1200');
    expect(text).toContain('ms');
  });

  it('returns default text for high-ttfb without value', () => {
    const text = getRemediation('high-ttfb');
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(10);
  });

  // ---- Layout shifts ----

  it('includes CLS value in layout-shifts remediation', () => {
    const text = getRemediation('layout-shifts', { value: 0.35 });
    expect(text).toContain('0.35');
    expect(text).toContain('CLS');
  });

  it('includes CLS value in high-cls remediation', () => {
    const text = getRemediation('high-cls', { value: 0.52 });
    expect(text).toContain('0.52');
    expect(text).toContain('CLS');
  });

  // ---- Main thread blocking ----

  it('includes value in high-main-thread-blocking remediation', () => {
    const text = getRemediation('high-main-thread-blocking', { value: 850 });
    expect(text).toContain('850');
    expect(text).toContain('ms');
  });

  // ---- Deep critical chain ----

  it('includes URLs in deep-critical-chain remediation', () => {
    const text = getRemediation('deep-critical-chain', {
      value: 5,
      evidence: { urls: ['/style.css', '/app.js', '/hero.jpg'] },
    });
    expect(text).toContain('/style.css');
    expect(text).toContain('/app.js');
    expect(text).toContain('/hero.jpg');
    expect(text).toContain('Deep critical chain');
  });

  // ---- Render-blocking chain ----

  it('includes URLs in rb-chain remediation', () => {
    const text = getRemediation('rb-chain', {
      evidence: { urls: ['blocker1.css', 'blocker2.js'] },
    });
    expect(text).toContain('blocker1.css');
    expect(text).toContain('blocker2.js');
    expect(text).toContain('Render-blocking chain');
  });

  // ---- LCP ----

  it('includes value in increased-lcp remediation', () => {
    const text = getRemediation('increased-lcp', { value: 3200 });
    expect(text).toContain('3200');
    expect(text).toContain('ms');
  });

  // ---- Waterfall delay ----

  it('includes URLs in waterfall-delay remediation', () => {
    const text = getRemediation('waterfall-delay', {
      evidence: { urls: ['slow-api', 'large-image'] },
    });
    expect(text).toContain('slow-api');
    expect(text).toContain('large-image');
    expect(text).toContain('Sequential waterfall');
  });

  // ---- Edge cases ----

  it('returns generic text for unknown issue IDs', () => {
    const text = getRemediation('unknown-issue-id-12345');
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(10);
  });

  it('returns generic text for unknown issue with empty context', () => {
    const text = getRemediation('nonexistent', {});
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(10);
  });

  it('uses rule-prefix fallback when ruleId is provided', () => {
    const text = getRemediation('some-js-issue', {
      ruleId: 'js-hotspot',
    });
    expect(text).toContain('JavaScript');
  });

  it('uses node-type fallback when ruleId is absent', () => {
    const text = getRemediation('custom-metric-node', {
      nodeType: 'metric',
    });
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(10);
  });
});
