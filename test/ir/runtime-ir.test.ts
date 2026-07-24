/**
 * RuntimeIR builder tests.
 *
 * Validates that the runtime intermediate representation is built
 * correctly from runtime and console raw data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import { buildRuntimeIR } from '../../src/normalize/runtime-ir.js';
import { RuntimeIRSchema } from '../../src/normalize/types.js';
import type { RuntimeRawData, ConsoleRawData } from '../../src/collect/types.js';
import type { RuntimeIR } from '../../src/normalize/types.js';

// ---------------------------------------------------------------------------
// Shared empty console data for tests that need it
// ---------------------------------------------------------------------------
const EMPTY_CONSOLE: ConsoleRawData = {
  entries: [],
  counts: { log: 0, warn: 0, error: 0, info: 0, debug: 0, other: 0 },
  warnings: [],
};

describe('RuntimeIR builder', () => {
  // -----------------------------------------------------------------------
  // Test 1: builds RuntimeIR from minimal valid fixtures
  // -----------------------------------------------------------------------
  describe('from minimal valid fixtures', () => {
    let ir: RuntimeIR;
    let expected: RuntimeIR;

    beforeAll(() => {
      const runtime = loadFixture('fixtures', 'runtime', 'minimal-valid.json') as RuntimeRawData;
      const consoleData = loadFixture('fixtures', 'console', 'minimal-valid.json') as ConsoleRawData;
      expected = loadFixture('fixtures', 'ir', 'runtime-ir-expected.json') as RuntimeIR;
      ir = buildRuntimeIR(runtime, consoleData);
    });

    it('builds RuntimeIR from minimal valid fixtures', () => {
      expect(ir).toBeDefined();
      expect(ir.executionContexts).toBeDefined();
    });

    it('output passes Zod safeParse validation', () => {
      const result = RuntimeIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });

    it('executionContexts count matches input (2)', () => {
      expect(ir.executionContexts).toHaveLength(2);
      expect(ir.executionContexts[0].id).toBe(1);
      expect(ir.executionContexts[0].origin).toBe('https://example.com');
      expect(ir.executionContexts[1].id).toBe(2);
      expect(ir.executionContexts[1].origin).toBe('https://fonts.googleapis.com');
    });

    it('jsHeapStats totalJSHeapSize passes through correctly', () => {
      expect(ir.jsHeapStats).toBeDefined();
      expect(ir.jsHeapStats!.totalJSHeapSize).toBe(4194304);
      expect(ir.jsHeapStats!.usedJSHeapSize).toBe(2516582);
    });

    it('jsHeapSizeLimit is omitted (not available from raw data)', () => {
      expect(ir.jsHeapStats).toBeDefined();
      expect(ir.jsHeapStats!.jsHeapSizeLimit).toBeUndefined();
    });

    it('eventLoopStats computed from console entry inter-arrival times', () => {
      expect(ir.eventLoopStats).toBeDefined();
      expect(ir.eventLoopStats!.totalBlockingDuration).toBe(600);
      expect(ir.eventLoopStats!.longTasks).toBe(6);
      expect(ir.eventLoopStats!.maxBlockingDuration).toBe(100);
    });

    it('eventLoopStats totalBlockingDuration > 0', () => {
      expect(ir.eventLoopStats!.totalBlockingDuration).toBeGreaterThan(0);
    });

    it('hydrationCost computed correctly', () => {
      expect(ir.hydrationCost).toBeDefined();
      expect(ir.hydrationCost!.bootupTime).toBe(100); // 2 contexts × 50
      expect(ir.hydrationCost!.evaluatedScripts).toBe(1); // 1 debug entry
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: handles empty runtime (no contexts, no stats)
  // -----------------------------------------------------------------------
  describe('handles empty runtime', () => {
    let ir: RuntimeIR;

    beforeAll(() => {
      const emptyRuntime: RuntimeRawData = {
        contexts: [],
        warnings: [],
      };
      ir = buildRuntimeIR(emptyRuntime, EMPTY_CONSOLE);
    });

    it('jsHeapStats is undefined when stats absent', () => {
      expect(ir.jsHeapStats).toBeUndefined();
    });

    it('executionContexts is empty', () => {
      expect(ir.executionContexts).toEqual([]);
    });

    it('eventLoopStats is undefined with empty console', () => {
      expect(ir.eventLoopStats).toBeUndefined();
    });

    it('hydrationCost returns zeroed values', () => {
      expect(ir.hydrationCost).toBeDefined();
      expect(ir.hydrationCost!.bootupTime).toBe(0);
      expect(ir.hydrationCost!.evaluatedScripts).toBe(0);
    });

    it('output passes Zod safeParse validation', () => {
      const result = RuntimeIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: runtime without console still produces valid RuntimeIR
  // -----------------------------------------------------------------------
  describe('runtime without console data', () => {
    let ir: RuntimeIR;

    beforeAll(() => {
      const runtime = loadFixture('fixtures', 'runtime', 'minimal-valid.json') as RuntimeRawData;
      // Pass empty console (simulating no console data available)
      const emptyConsole: ConsoleRawData = {
        entries: [],
        counts: { log: 0, warn: 0, error: 0, info: 0, debug: 0, other: 0 },
        warnings: [],
      };
      ir = buildRuntimeIR(runtime, emptyConsole);
    });

    it('still produces valid RuntimeIR', () => {
      expect(ir).toBeDefined();
      const result = RuntimeIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });

    it('executionContexts still populated', () => {
      expect(ir.executionContexts).toHaveLength(2);
    });

    it('jsHeapStats still populated', () => {
      expect(ir.jsHeapStats).toBeDefined();
      expect(ir.jsHeapStats!.totalJSHeapSize).toBe(4194304);
    });

    it('eventLoopStats is undefined with empty console', () => {
      expect(ir.eventLoopStats).toBeUndefined();
    });

    it('hydrationCost has bootupTime but zero evaluatedScripts', () => {
      expect(ir.hydrationCost).toBeDefined();
      expect(ir.hydrationCost!.bootupTime).toBe(100);
      expect(ir.hydrationCost!.evaluatedScripts).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: handles runtime with stats undefined
  // -----------------------------------------------------------------------
  describe('handles runtime with stats undefined', () => {
    let ir: RuntimeIR;

    beforeAll(() => {
      const runtimeNoStats: RuntimeRawData = {
        contexts: [
          { id: 1, origin: 'https://example.com', name: 'example.com' },
        ],
        warnings: [],
        // stats is intentionally undefined
      };
      ir = buildRuntimeIR(runtimeNoStats, EMPTY_CONSOLE);
    });

    it('jsHeapStats is undefined', () => {
      expect(ir.jsHeapStats).toBeUndefined();
    });

    it('hydrationCost still computed from context count', () => {
      expect(ir.hydrationCost).toBeDefined();
      expect(ir.hydrationCost!.bootupTime).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // Test 5: handles single console entry (no inter-arrival pairs)
  // -----------------------------------------------------------------------
  describe('handles single console entry', () => {
    let ir: RuntimeIR;

    beforeAll(() => {
      const runtime = loadFixture('fixtures', 'runtime', 'minimal-valid.json') as RuntimeRawData;
      const singleEntryConsole: ConsoleRawData = {
        entries: [
          { timestamp: 1700000000000, type: 'log', args: ['single'] },
        ],
        counts: { log: 1, warn: 0, error: 0, info: 0, debug: 0, other: 0 },
        warnings: [],
      };
      ir = buildRuntimeIR(runtime, singleEntryConsole);
    });

    it('eventLoopStats is undefined with only one entry', () => {
      expect(ir.eventLoopStats).toBeUndefined();
    });
  });
});
