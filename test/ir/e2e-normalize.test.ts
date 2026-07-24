/**
 * E2E normalize test.
 *
 * Validates that the full normalize pipeline works end-to-end with
 * all domain IR builders wired in:
 * - Loads raw data from a complete-run-dir
 * - Runs the normalize function
 * - Validates the IRBundle schema
 * - Validates key output values for each domain IR
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { normalize } from '../../src/normalize/index.js';
import { IRBundleSchema } from '../../src/normalize/types.js';
import { loadFixture } from '../setup.js';
import type { RawDataBundle } from '../../src/collect/types.js';
import type { IRBundle } from '../../src/normalize/types.js';

describe('E2E normalize pipeline', () => {
  let bundle: IRBundle;

  beforeAll(() => {
    // Load each file individually from the complete-run-dir
    const raw: RawDataBundle = {
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

  it('produces a valid IRBundle', () => {
    const result = IRBundleSchema.safeParse(bundle);
    if (!result.success) {
      console.error('Validation error:', result.error.message);
    }
    expect(result.success).toBe(true);
  });

  it('has correct IR version', () => {
    expect(bundle.meta.irVersion).toBe('1.0.0');
  });

  it('has a navigationStart value', () => {
    expect(typeof bundle.meta.navigationStart).toBe('number');
  });

  it('performance IR has navigation data', () => {
    expect(bundle.performance.navigation).toBeDefined();
    expect(typeof bundle.performance.navigation.navigationStart).toBe('number');
    expect(bundle.performance.navigation.navigationStart).toBe(0);
  });

  it('performance IR has traceSummary', () => {
    expect(bundle.performance.traceSummary.eventCount).toBeGreaterThan(0);
    expect(bundle.performance.traceSummary.totalDuration).toBeGreaterThanOrEqual(0);
    expect(bundle.performance.traceSummary.threadActivity).toBeDefined();
  });

  it('mainThreadBusyness is between 0 and 1', () => {
    expect(bundle.performance.mainThreadBusyness).toBeGreaterThanOrEqual(0);
    expect(bundle.performance.mainThreadBusyness).toBeLessThanOrEqual(1);
  });

  it('network IR has request data', () => {
    expect(bundle.network.requests.length).toBeGreaterThan(0);
    expect(bundle.network.summary.totalRequests).toBeGreaterThan(0);
    expect(bundle.network.summary.totalBytes).toBeGreaterThan(0);
  });

  it('runtime IR has execution contexts and stats', () => {
    expect(bundle.runtime.executionContexts).toHaveLength(2);
    expect(bundle.runtime.executionContexts[0].id).toBe(1);
    expect(bundle.runtime.executionContexts[0].origin).toBe('https://example.com');
    expect(bundle.runtime.jsHeapStats).toBeDefined();
    expect(bundle.runtime.jsHeapStats!.totalJSHeapSize).toBeGreaterThan(0);
    expect(bundle.runtime.eventLoopStats).toBeDefined();
    expect(bundle.runtime.eventLoopStats!.totalBlockingDuration).toBeGreaterThan(0);
    expect(bundle.runtime.hydrationCost).toBeDefined();
    expect(bundle.runtime.hydrationCost!.bootupTime).toBeGreaterThanOrEqual(0);
  });

  it('DOM IR has real stats and tag distribution', () => {
    expect(bundle.dom.stats.totalNodes).toBeGreaterThan(0);
    expect(bundle.dom.stats.elementCount).toBeGreaterThan(0);
    expect(bundle.dom.tagDistribution.length).toBeGreaterThan(0);
    expect(bundle.dom.layoutShiftCandidates.highComplexitySubtrees).toBe(0);
    expect(bundle.dom.layoutShiftCandidates.deepNesting).toBe(0);
  });

  it('lighthouse IR has category data', () => {
    expect(Object.keys(bundle.lighthouse.categories).length).toBeGreaterThan(0);
    expect(bundle.lighthouse.categories.performance).toBeDefined();
    expect(typeof bundle.lighthouse.categories.performance.score).toBe('number');
    expect(Array.isArray(bundle.lighthouse.failedAudits)).toBe(true);
  });
});
