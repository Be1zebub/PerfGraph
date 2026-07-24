/**
 * Console data ingestion tests.
 *
 * Validates that console fixtures can be loaded and contain the expected
 * structure. These tests run without a browser — they use saved JSON
 * fixtures only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import type { ConsoleRawData, ConsoleEntry, ConsoleEntryType, ConsoleStackFrame } from '../../src/collect/types.js';

/** All valid console entry types from the CDP spec */
const VALID_ENTRY_TYPES: ConsoleEntryType[] = [
  'log', 'warn', 'error', 'info', 'debug', 'assert', 'dir', 'dirxml',
  'table', 'trace', 'clear', 'startGroup', 'startGroupCollapsed',
  'endGroup', 'count', 'timeEnd', 'profile', 'profileEnd',
];

describe('Console fixture ingestion', () => {
  let fixture: ConsoleRawData;
  let entries: ConsoleEntry[];

  beforeAll(() => {
    const data = loadFixture('fixtures', 'console', 'minimal-valid.json');
    fixture = data as ConsoleRawData;
    entries = fixture.entries ?? [];
  });

  it('loads fixture without throwing', () => {
    expect(fixture).toBeDefined();
  });

  it('has a non-empty entries array', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('has warnings array', () => {
    expect(fixture.warnings).toBeInstanceOf(Array);
  });

  // --- Entry validation ---

  it('every entry has required fields (timestamp, type, args)', () => {
    for (const entry of entries) {
      expect(typeof entry.timestamp).toBe('number');
      expect(entry.timestamp).toBeGreaterThan(0);

      expect(typeof entry.type).toBe('string');
      expect(entry.type.length).toBeGreaterThan(0);

      expect(entry.args).toBeInstanceOf(Array);
    }
  });

  it('every entry has a valid ConsoleEntryType', () => {
    for (const entry of entries) {
      expect(VALID_ENTRY_TYPES).toContain(entry.type);
    }
  });

  it('entries are in chronological order', () => {
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.timestamp).toBeGreaterThanOrEqual(entries[i - 1]!.timestamp);
    }
  });

  // --- Args validation ---

  it('every entry has at least one arg', () => {
    for (const entry of entries) {
      expect(entry.args.length).toBeGreaterThan(0);
    }
  });

  it('entry args are valid JSON-serializable values', () => {
    for (const entry of entries) {
      for (const arg of entry.args) {
        // Should be able to round-trip through JSON
        const serialized = JSON.stringify(arg);
        const deserialized = JSON.parse(serialized);
        expect(deserialized).toBeDefined();
      }
    }
  });

  // --- Stack trace validation ---

  it('entries with stackTrace have valid frames', () => {
    for (const entry of entries) {
      if (entry.stackTrace) {
        expect(entry.stackTrace.length).toBeGreaterThan(0);
        for (const frame of entry.stackTrace) {
          expect(typeof frame.url).toBe('string');
          expect(typeof frame.lineNumber).toBe('number');
          expect(Number.isInteger(frame.lineNumber)).toBe(true);
          expect(frame.lineNumber).toBeGreaterThanOrEqual(0);
          expect(typeof frame.columnNumber).toBe('number');
          expect(Number.isInteger(frame.columnNumber)).toBe(true);
          expect(frame.columnNumber).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('stack frames with functionName have it as a string', () => {
    for (const entry of entries) {
      if (entry.stackTrace) {
        for (const frame of entry.stackTrace) {
          if (frame.functionName !== undefined) {
            expect(typeof frame.functionName).toBe('string');
          }
        }
      }
    }
  });

  // --- Counts validation ---

  describe('entry counts', () => {
    let counts: ConsoleRawData['counts'];

    beforeAll(() => {
      counts = fixture.counts!;
    });

    it('counts object is defined', () => {
      expect(counts).toBeDefined();
    });

    it('counts has all severity fields', () => {
      expect(typeof counts.log).toBe('number');
      expect(typeof counts.warn).toBe('number');
      expect(typeof counts.error).toBe('number');
      expect(typeof counts.info).toBe('number');
      expect(typeof counts.debug).toBe('number');
      expect(typeof counts.other).toBe('number');
    });

    it('counts are non-negative integers', () => {
      const fields = ['log', 'warn', 'error', 'info', 'debug', 'other'] as const;
      for (const field of fields) {
        expect(Number.isInteger(counts[field])).toBe(true);
        expect(counts[field]).toBeGreaterThanOrEqual(0);
      }
    });

    it('sum of counts equals total entries', () => {
      const total = counts.log + counts.warn + counts.error + counts.info + counts.debug + counts.other;
      expect(total).toBe(entries.length);
    });

    it('log count matches entries filtered by type', () => {
      const actualLog = entries.filter((e) => e.type === 'log').length;
      expect(counts.log).toBe(actualLog);
    });

    it('warn count matches entries filtered by type', () => {
      const actualWarn = entries.filter((e) => e.type === 'warn').length;
      expect(counts.warn).toBe(actualWarn);
    });

    it('error count matches entries filtered by type', () => {
      const actualError = entries.filter((e) => e.type === 'error').length;
      expect(counts.error).toBe(actualError);
    });

    it('info count matches entries filtered by type', () => {
      const actualInfo = entries.filter((e) => e.type === 'info').length;
      expect(counts.info).toBe(actualInfo);
    });

    it('debug count matches entries filtered by type', () => {
      const actualDebug = entries.filter((e) => e.type === 'debug').length;
      expect(counts.debug).toBe(actualDebug);
    });

    it('other count matches entries of unlisted types', () => {
      const knownTypes: ConsoleEntryType[] = ['log', 'warn', 'error', 'info', 'debug'];
      const actualOther = entries.filter((e) => !knownTypes.includes(e.type)).length;
      expect(counts.other).toBe(actualOther);
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('tolerates empty entries array', () => {
      const empty: ConsoleRawData = {
        entries: [],
        counts: { log: 0, warn: 0, error: 0, info: 0, debug: 0, other: 0 },
        warnings: [],
      };
      expect(empty.entries).toHaveLength(0);
      expect(empty.counts.log).toBe(0);
    });

    it('tolerates entry with empty args', () => {
      const minimalEntry: ConsoleEntry = {
        timestamp: 1000,
        type: 'log',
        args: [],
      };
      expect(minimalEntry.args).toHaveLength(0);
    });

    it('tolerates entry without stackTrace', () => {
      const noTrace: ConsoleEntry = {
        timestamp: 2000,
        type: 'warn',
        args: ['warning'],
      };
      expect(noTrace.stackTrace).toBeUndefined();
    });
  });
});
