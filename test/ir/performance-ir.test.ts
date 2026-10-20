/**
 * PerformanceIR builder tests.
 *
 * Validates that the performance intermediate representation is built
 * correctly from trace and performance raw data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import { buildPerformanceIR } from '../../src/normalize/trace-ir.js';
import { PerformanceIRSchema } from '../../src/normalize/types.js';
import type { TraceRawData, PerformanceRawData } from '../../src/collect/types.js';
import type { PerformanceIR } from '../../src/normalize/types.js';
import { resolveClockAnchor } from '../../src/normalize/clock.js';
import type { ClockAnchor } from '../../src/normalize/clock.js';

describe('PerformanceIR builder', () => {
  // -----------------------------------------------------------------------
  // Test 1: builds PerformanceIR from minimal valid fixtures
  // -----------------------------------------------------------------------
  describe('from trace-with-navigation fixtures', () => {
    let ir: PerformanceIR;
    let expected: PerformanceIR;

    beforeAll(() => {
      const trace = loadFixture('fixtures', 'ir', 'trace-with-navigation.json') as TraceRawData;
      const perf = loadFixture('fixtures', 'performance', 'minimal-valid.json') as PerformanceRawData;
      const anchor = resolveClockAnchor({ trace, performance: perf });
      expected = loadFixture('fixtures', 'ir', 'performance-ir-expected.json') as PerformanceIR;
      ir = buildPerformanceIR(trace, perf, anchor);
    });

    it('builds PerformanceIR from minimal valid fixtures', () => {
      expect(ir).toBeDefined();
      expect(ir.navigation).toBeDefined();
      expect(ir.coreWebVitals).toBeDefined();
      expect(ir.traceSummary).toBeDefined();
      expect(typeof ir.mainThreadBusyness).toBe('number');
    });

    it('output matches expected values', () => {
      expect(ir.navigation.navigationStart).toBe(0);
      expect(ir.navigation.domContentLoaded).toBe(800);
      expect(ir.navigation.loadEventStart).toBe(1200);
      expect(ir.coreWebVitals.fcp).toBe(800);
      expect(ir.coreWebVitals.lcp).toBe(1200);
      expect(ir.coreWebVitals.cls).toBe(0.05);
    });

    it('output passes Zod safeParse validation', () => {
      const result = PerformanceIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });

    it('mainThreadBusyness is between 0 and 1', () => {
      expect(ir.mainThreadBusyness).toBeGreaterThanOrEqual(0);
      expect(ir.mainThreadBusyness).toBeLessThanOrEqual(1);
    });

    it('traceSummary categories match event distribution', () => {
      expect(ir.traceSummary.categories['blink.user_timing']).toBe(4);
      expect(ir.traceSummary.categories['loading']).toBe(1);
      expect(ir.traceSummary.categories['devtools.timeline']).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: LCP candidate parsing
  // -----------------------------------------------------------------------
  describe('LCP candidate', () => {
    it('parses the candidate from the event name Chrome actually emits', () => {
      const trace = loadFixture('fixtures', 'ir', 'trace-with-navigation.json') as TraceRawData;
      const perf = loadFixture('fixtures', 'performance', 'minimal-valid.json') as PerformanceRawData;
      const anchor = resolveClockAnchor({ trace, performance: perf });
      const ir = buildPerformanceIR(trace, perf, anchor);

      const names = (trace.events ?? []).map((e) => e.name);
      expect(names).toContain('largestContentfulPaint::Candidate');
      expect(ir.coreWebVitals.lcp).toBe(1200);
      expect(ir.lcpCandidate).toBeDefined();
      expect(ir.lcpCandidate!.type).toBe('image');
      expect(ir.lcpCandidate!.size).toBe(42000);
      expect(ir.lcpCandidate!.nodeName).toBe("IMG class='hero'");
      expect(ir.lcpCandidate!.url).toBe('https://example.com/hero.jpg');
    });

    it('accepts the capitalized spelling of the event name', () => {
      const trace = loadFixture('fixtures', 'ir', 'trace-with-navigation.json') as TraceRawData;
      const perf = loadFixture('fixtures', 'performance', 'minimal-valid.json') as PerformanceRawData;
      const anchor = resolveClockAnchor({ trace, performance: perf });

      const renamed: TraceRawData = {
        ...trace,
        events: (trace.events ?? []).map((e) =>
          e.name === 'largestContentfulPaint::Candidate'
            ? { ...e, name: 'LargestContentfulPaint::Candidate' }
            : e,
        ),
      };

      const ir = buildPerformanceIR(renamed, perf, anchor);
      expect(ir.coreWebVitals.lcp).toBe(1200);
      expect(ir.lcpCandidate!.type).toBe('image');
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: Performance API LCP entry
  // -----------------------------------------------------------------------
  describe('Performance API LCP entry', () => {
    it('prefers the Performance API entry over the trace candidate', () => {
      const trace = loadFixture('fixtures', 'ir', 'trace-with-navigation.json') as TraceRawData;
      const perf = loadFixture('fixtures', 'performance', 'minimal-valid.json') as PerformanceRawData;
      const anchor = resolveClockAnchor({ trace, performance: perf });

      const ir = buildPerformanceIR(trace, perf, anchor, {
        startTime: 2400,
        size: 162_572,
        elementTag: 'h1',
        elementClass: 'headline',
      });

      expect(ir.coreWebVitals.lcp).toBe(2400);
      expect(ir.lcpEntry).toBeDefined();
      expect(ir.lcpEntry!.startTime).toBe(2400);
      expect(ir.lcpCandidate!.type).toBe('text');
      expect(ir.lcpCandidate!.nodeName).toBe('h1.headline');
    });

    it('marks an entry with a resource URL as an image candidate', () => {
      const trace = loadFixture('fixtures', 'ir', 'trace-with-navigation.json') as TraceRawData;
      const perf = loadFixture('fixtures', 'performance', 'minimal-valid.json') as PerformanceRawData;
      const anchor = resolveClockAnchor({ trace, performance: perf });

      const ir = buildPerformanceIR(trace, perf, anchor, {
        startTime: 1800,
        size: 90_000,
        url: 'https://example.com/hero.jpg',
        elementTag: 'img',
        elementId: 'hero',
      });

      expect(ir.lcpCandidate!.type).toBe('image');
      expect(ir.lcpCandidate!.url).toBe('https://example.com/hero.jpg');
      expect(ir.lcpCandidate!.nodeName).toBe('img#hero');
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: handles empty trace
  // -----------------------------------------------------------------------
  describe('handles empty trace', () => {
    let ir: PerformanceIR;

    beforeAll(() => {
      const emptyTrace: TraceRawData = {
        events: [],
        metadata: { categories: [], totalEvents: 0, dataCollectedCount: 0 },
        warnings: [],
      };
      const perf: PerformanceRawData = {
        metrics: [{ name: 'NavigationStart', value: 1000 }],
        timestamp: 1700000007000,
        warnings: [],
      };
      const anchor: ClockAnchor = { navigationStart: 1000 };
      ir = buildPerformanceIR(emptyTrace, perf, anchor);
    });

    it('returns zero counts and undefined CWV', () => {
      expect(ir.traceSummary.eventCount).toBe(0);
      expect(ir.traceSummary.totalDuration).toBe(0);
      expect(ir.traceSummary.categories).toEqual({});
      expect(ir.coreWebVitals.fcp).toBeUndefined();
      expect(ir.coreWebVitals.lcp).toBeUndefined();
      expect(ir.coreWebVitals.cls).toBeUndefined();
      expect(ir.coreWebVitals.tbt).toBeUndefined();
    });

    it('mainThreadBusyness is 0', () => {
      expect(ir.mainThreadBusyness).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: handles missing navigationStart metric
  // -----------------------------------------------------------------------
  describe('handles missing navigationStart metric', () => {
    let ir: PerformanceIR;

    beforeAll(() => {
      const trace = loadFixture('fixtures', 'trace', 'minimal-valid.json') as TraceRawData;
      const perf: PerformanceRawData = {
        metrics: [
          { name: 'Timestamp', value: 12345678.9 },
          { name: 'DomContentLoaded', value: 320.0 },
        ],
        timestamp: 1700000007000,
        warnings: [],
      };
      const anchor = resolveClockAnchor({ trace, performance: perf });
      ir = buildPerformanceIR(trace, perf, anchor);
    });

    it('still produces valid output', () => {
      expect(ir).toBeDefined();
      const result = PerformanceIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });
  });
});
