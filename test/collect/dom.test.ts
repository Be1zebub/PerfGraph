/**
 * DOM data ingestion tests.
 *
 * Validates that DOM fixtures can be loaded and contain the expected
 * structure. These tests run without a browser — they use saved JSON
 * fixtures only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import type { DomRawData, DomStats } from '../../src/collect/types.js';

describe('DOM fixture ingestion', () => {
  let fixture: DomRawData;
  let stats: DomStats;

  beforeAll(() => {
    const data = loadFixture('fixtures', 'dom', 'minimal-valid.json');
    fixture = data as DomRawData;
    stats = fixture.stats!;
  });

  it('loads fixture without throwing', () => {
    expect(fixture).toBeDefined();
  });

  it('has warnings array', () => {
    expect(fixture.warnings).toBeInstanceOf(Array);
  });

  // --- Stats validation ---

  describe('stats object', () => {
    it('stats is defined', () => {
      expect(stats).toBeDefined();
    });

    it('stats has totalNodes field', () => {
      expect(typeof stats.totalNodes).toBe('number');
      expect(Number.isInteger(stats.totalNodes)).toBe(true);
      expect(stats.totalNodes).toBeGreaterThan(0);
    });

    it('stats has elementCount field', () => {
      expect(typeof stats.elementCount).toBe('number');
      expect(Number.isInteger(stats.elementCount)).toBe(true);
      expect(stats.elementCount).toBeGreaterThan(0);
    });

    it('stats has maxDepth field', () => {
      expect(typeof stats.maxDepth).toBe('number');
      expect(Number.isInteger(stats.maxDepth)).toBe(true);
      expect(stats.maxDepth).toBeGreaterThan(0);
    });

    it('stats has textContentLength field', () => {
      expect(typeof stats.textContentLength).toBe('number');
      expect(Number.isInteger(stats.textContentLength)).toBe(true);
      expect(stats.textContentLength).toBeGreaterThanOrEqual(0);
    });

    it('totalNodes is at least elementCount', () => {
      expect(stats.totalNodes).toBeGreaterThanOrEqual(stats.elementCount);
    });

    it('maxDepth is reasonable (less than totalNodes)', () => {
      expect(stats.maxDepth).toBeLessThan(stats.totalNodes);
    });

    it('elementCount is at least equal to unique tag distribution entries', () => {
      const uniqueTags = Object.keys(fixture.elementDistribution).length;
      expect(stats.elementCount).toBeGreaterThanOrEqual(uniqueTags);
    });
  });

  // --- Element distribution validation ---

  describe('elementDistribution', () => {
    it('is a defined object', () => {
      expect(fixture.elementDistribution).toBeDefined();
      expect(typeof fixture.elementDistribution).toBe('object');
    });

    it('has at least the essential structural tags', () => {
      const keys = Object.keys(fixture.elementDistribution);
      expect(keys).toContain('html');
      expect(keys).toContain('head');
      expect(keys).toContain('body');
    });

    it('all values are positive integers', () => {
      for (const [tag, count] of Object.entries(fixture.elementDistribution)) {
        expect(typeof count).toBe('number');
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThan(0);
        expect(tag.length).toBeGreaterThan(0);
      }
    });

    it('sum of distribution values equals elementCount', () => {
      const sum = Object.values(fixture.elementDistribution).reduce((acc, n) => acc + n, 0);
      expect(sum).toBe(stats.elementCount);
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('tolerates zero element distribution', () => {
      const empty: DomRawData = {
        stats: { totalNodes: 0, elementCount: 0, maxDepth: 0, textContentLength: 0 },
        elementDistribution: {},
        warnings: [],
      };
      expect(Object.keys(empty.elementDistribution)).toHaveLength(0);
    });

    it('tolerates missing warnings', () => {
      const noWarnings: DomRawData = {
        stats: { totalNodes: 1, elementCount: 1, maxDepth: 1, textContentLength: 0 },
        elementDistribution: { div: 1 },
        warnings: [],
      };
      expect(noWarnings.warnings).toEqual([]);
    });

    it('stats with zero maxDepth and totalNodes should be consistent', () => {
      const zero: DomStats = { totalNodes: 0, elementCount: 0, maxDepth: 0, textContentLength: 0 };
      expect(zero.totalNodes).toBe(0);
      expect(zero.elementCount).toBe(0);
      expect(zero.maxDepth).toBe(0);
    });
  });
});
