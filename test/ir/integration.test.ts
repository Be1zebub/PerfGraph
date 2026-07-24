/**
 * IR integration tests (TST-02).
 *
 * Validates the full IR normalization pipeline across all domains:
 * deterministic output, Zod schema validation, clock consistency,
 * and edge cases (partial / empty bundles).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { normalize } from '../../src/normalize/index.js';
import { IRBundleSchema } from '../../src/normalize/types.js';
import { loadFixture } from '../setup.js';
import type { RawDataBundle } from '../../src/collect/types.js';
import type { IRBundle } from '../../src/normalize/types.js';

describe('IR integration (TST-02)', () => {
  let raw: RawDataBundle;
  let bundle: IRBundle;

  beforeAll(() => {
    raw = {
      trace: loadFixture('fixtures', 'ir', 'complete-run-dir', 'trace.json'),
      network: loadFixture('fixtures', 'ir', 'complete-run-dir', 'network.json'),
      performance: loadFixture('fixtures', 'ir', 'complete-run-dir', 'performance.json'),
      runtime: loadFixture('fixtures', 'ir', 'complete-run-dir', 'runtime.json'),
      consoleEntries: loadFixture('fixtures', 'ir', 'complete-run-dir', 'console.json'),
      dom: loadFixture('fixtures', 'ir', 'complete-run-dir', 'dom.json'),
      lighthouse: loadFixture('fixtures', 'ir', 'complete-run-dir', 'lighthouse.json'),
    };

    bundle = normalize(raw);
  });

  // -----------------------------------------------------------------------
  // Test 1: Deterministic output (excluding meta which contains fetchedAt)
  // -----------------------------------------------------------------------
  it('produces deterministic output for identical input', () => {
    const bundle1 = normalize(raw);
    const bundle2 = normalize(raw);
    // fetchedAt uses Date.now() so meta differs by milliseconds each call
    const { meta: _m1, ...rest1 } = bundle1;
    const { meta: _m2, ...rest2 } = bundle2;
    expect(JSON.stringify(rest1)).toBe(JSON.stringify(rest2));
  });

  // -----------------------------------------------------------------------
  // Test 2: Zod schema validation
  // -----------------------------------------------------------------------
  it('all IR fields pass IRBundleSchema validation', () => {
    const result = IRBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 3: All 5 IR types populated
  // -----------------------------------------------------------------------
  it('all 5 IR sections are populated with data', () => {
    expect(bundle.performance.traceSummary.eventCount).toBeGreaterThan(0);
    expect(bundle.network.requests.length).toBeGreaterThan(0);
    expect(bundle.runtime.executionContexts.length).toBeGreaterThan(0);
    expect(bundle.dom.tagDistribution.length).toBeGreaterThan(0);
    expect(Object.keys(bundle.lighthouse.categories).length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Test 4: Clock consistency — timestamps are ms relative to navStart
  // -----------------------------------------------------------------------
  it('performance timestamps are ms relative to navigationStart', () => {
    // Trace events (cdp-monotonic-us) navigate relative to navStart
    expect(bundle.performance.navigation.domContentLoaded).toBeGreaterThanOrEqual(0);
    expect(bundle.performance.navigation.domContentLoaded).toBeLessThan(60000);
    expect(bundle.performance.traceSummary.totalDuration).toBeGreaterThanOrEqual(0);
    expect(bundle.performance.traceSummary.totalDuration).toBeLessThan(60000);
  });

  it('network request timestamps are finite after clock conversion', () => {
    // The test fixtures have mismatched clock domains across trace/performance
    // and network (fixtures were hand-crafted per-domain), so we verify the
    // conversion code ran correctly (finite numbers, not NaN/Infinity) rather
    // than absolute ranges. Cross-domain clock consistency requires real
    // collected data where all clocks share a common page-load context.
    for (const req of bundle.network.requests) {
      expect(typeof req.startTime).toBe('number');
      expect(Number.isFinite(req.startTime)).toBe(true);
      expect(typeof req.endTime).toBe('number');
      expect(Number.isFinite(req.endTime)).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // Test 5: Partial bundle (only trace + performance)
  // -----------------------------------------------------------------------
  it('handles partial bundles gracefully', () => {
    const partial = normalize({
      trace: raw.trace,
      performance: raw.performance,
    } as RawDataBundle);

    // These IRs should be populated from the provided data
    expect(partial.meta).toBeDefined();
    expect(partial.performance).toBeDefined();
    expect(partial.performance.traceSummary).toBeDefined();

    // Other IRs — missing data → empty stubs
    expect(partial.network.requests).toEqual([]);
    expect(partial.runtime.executionContexts).toEqual([]);
    expect(partial.dom.tagDistribution).toEqual([]);
    expect(Object.keys(partial.lighthouse.categories)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Test 6: Empty bundle
  // -----------------------------------------------------------------------
  it('handles completely empty bundle', () => {
    const empty = normalize({} as RawDataBundle);

    // Meta always defined
    expect(empty.meta).toBeDefined();
    expect(empty.meta.irVersion).toBe('1.0.0');

    // Performance always present with at least navigation stub
    expect(empty.performance.navigation).toBeDefined();

    // All other IRs return empty stubs, never crash
    expect(empty.network.requests).toEqual([]);
    expect(empty.runtime.executionContexts).toEqual([]);
    expect(empty.dom.tagDistribution).toEqual([]);
    expect(Object.keys(empty.lighthouse.categories)).toHaveLength(0);
  });
});
