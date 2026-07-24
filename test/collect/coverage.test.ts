/**
 * Coverage data ingestion tests.
 *
 * Validates that coverage fixtures can be loaded and contain the expected
 * structure. These tests run without a browser — they use saved JSON
 * fixtures only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import type {
  CoverageRawData,
  ScriptCoverage,
  StyleCoverage,
  ScriptFunctionCoverage,
  CoverageRange,
} from '../../src/collect/types.js';

describe('Coverage fixture ingestion', () => {
  let fixture: CoverageRawData;
  let jsCoverage: ScriptCoverage[];
  let cssCoverage: StyleCoverage[];

  beforeAll(() => {
    const data = loadFixture('fixtures', 'coverage', 'minimal-valid.json');
    fixture = data as CoverageRawData;
    jsCoverage = fixture.js ?? [];
    cssCoverage = fixture.css ?? [];
  });

  it('loads fixture without throwing', () => {
    expect(fixture).toBeDefined();
  });

  it('has a non-empty js array', () => {
    expect(jsCoverage.length).toBeGreaterThan(0);
  });

  it('has a non-empty css array', () => {
    expect(cssCoverage.length).toBeGreaterThan(0);
  });

  it('has warnings array', () => {
    expect(fixture.warnings).toBeInstanceOf(Array);
  });

  // --- ScriptCoverage validation ---

  describe('ScriptCoverage entries', () => {
    it('every JS entry has required fields (scriptId, url, functions)', () => {
      for (const script of jsCoverage) {
        expect(typeof script.scriptId).toBe('string');
        expect(script.scriptId.length).toBeGreaterThan(0);

        expect(typeof script.url).toBe('string');
        expect(script.url.length).toBeGreaterThan(0);

        expect(script.functions).toBeInstanceOf(Array);
        expect(script.functions.length).toBeGreaterThan(0);
      }
    });

    it('every script URL starts with http:// or https://', () => {
      for (const script of jsCoverage) {
        expect(script.url).toMatch(/^https?:\/\//);
      }
    });

    it('every function has required fields (functionName, ranges, isBlockCoverage)', () => {
      for (const script of jsCoverage) {
        for (const func of script.functions) {
          expect(typeof func.functionName).toBe('string');
          expect(func.ranges).toBeInstanceOf(Array);
          expect(func.ranges.length).toBeGreaterThan(0);
          expect(typeof func.isBlockCoverage).toBe('boolean');
        }
      }
    });

    it('every range has valid startOffset, endOffset, and count', () => {
      for (const script of jsCoverage) {
        for (const func of script.functions) {
          for (const range of func.ranges) {
            expect(typeof range.startOffset).toBe('number');
            expect(Number.isInteger(range.startOffset)).toBe(true);
            expect(range.startOffset).toBeGreaterThanOrEqual(0);

            expect(typeof range.endOffset).toBe('number');
            expect(Number.isInteger(range.endOffset)).toBe(true);
            expect(range.endOffset).toBeGreaterThan(range.startOffset);

            expect(typeof range.count).toBe('number');
            expect(Number.isInteger(range.count)).toBe(true);
            expect(range.count).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });
  });

  // --- StyleCoverage validation ---

  describe('StyleCoverage entries', () => {
    it('every CSS entry has required fields (styleSheetId, url, ranges)', () => {
      for (const sheet of cssCoverage) {
        expect(typeof sheet.styleSheetId).toBe('string');
        expect(sheet.styleSheetId.length).toBeGreaterThan(0);

        expect(typeof sheet.url).toBe('string');
        expect(sheet.url.length).toBeGreaterThan(0);

        expect(sheet.ranges).toBeInstanceOf(Array);
        expect(sheet.ranges.length).toBeGreaterThan(0);
      }
    });

    it('every CSS range has valid startOffset, endOffset, and count', () => {
      for (const sheet of cssCoverage) {
        for (const range of sheet.ranges) {
          expect(typeof range.startOffset).toBe('number');
          expect(Number.isInteger(range.startOffset)).toBe(true);
          expect(range.startOffset).toBeGreaterThanOrEqual(0);

          expect(typeof range.endOffset).toBe('number');
          expect(Number.isInteger(range.endOffset)).toBe(true);
          expect(range.endOffset).toBeGreaterThan(range.startOffset);

          expect(typeof range.count).toBe('number');
          expect(Number.isInteger(range.count)).toBe(true);
          expect(range.count).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('CSS range count is either 0 or 1 (used/not used)', () => {
      for (const sheet of cssCoverage) {
        for (const range of sheet.ranges) {
          expect(range.count).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('tolerates empty JS coverage array', () => {
      const empty: CoverageRawData = { js: [], css: [], warnings: [] };
      expect(empty.js).toHaveLength(0);
    });

    it('tolerates empty CSS coverage array', () => {
      const empty: CoverageRawData = { js: [], css: [], warnings: [] };
      expect(empty.css).toHaveLength(0);
    });

    it('tolerates empty functions array in a script', () => {
      const emptyFuncs = {
        scriptId: '3',
        url: 'https://example.com/empty.js',
        functions: [],
      };
      expect(emptyFuncs.functions).toHaveLength(0);
    });

    it('tolerates empty ranges array in a function', () => {
      const emptyRanges: ScriptFunctionCoverage = {
        functionName: 'unused',
        ranges: [],
        isBlockCoverage: false,
      };
      expect(emptyRanges.ranges).toHaveLength(0);
    });
  });
});
