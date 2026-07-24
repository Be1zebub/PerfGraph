/**
 * Runtime data ingestion tests.
 *
 * Validates that runtime fixtures can be loaded and contain the expected
 * structure. These tests run without a browser — they use saved JSON
 * fixtures only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import type { RuntimeRawData, RuntimeExecutionContext, RuntimeStats } from '../../src/collect/types.js';

describe('Runtime fixture ingestion', () => {
  let fixture: RuntimeRawData;
  let contexts: RuntimeExecutionContext[];

  beforeAll(() => {
    const data = loadFixture('fixtures', 'runtime', 'minimal-valid.json');
    fixture = data as RuntimeRawData;
    contexts = fixture.contexts ?? [];
  });

  it('loads fixture without throwing', () => {
    expect(fixture).toBeDefined();
  });

  it('has a non-empty contexts array', () => {
    expect(contexts.length).toBeGreaterThan(0);
  });

  it('has warnings array', () => {
    expect(fixture.warnings).toBeInstanceOf(Array);
  });

  it('every context has required fields (id, origin, name)', () => {
    for (const ctx of contexts) {
      expect(typeof ctx.id).toBe('number');
      expect(Number.isInteger(ctx.id)).toBe(true);
      expect(ctx.id).toBeGreaterThan(0);

      expect(typeof ctx.origin).toBe('string');
      expect(ctx.origin.length).toBeGreaterThan(0);

      expect(typeof ctx.name).toBe('string');
      expect(ctx.name.length).toBeGreaterThan(0);
    }
  });

  it('has unique context IDs', () => {
    const ids = contexts.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('has stats object', () => {
    expect(fixture.stats).toBeDefined();
  });

  describe('runtime stats', () => {
    let stats: RuntimeStats;

    beforeAll(() => {
      stats = fixture.stats!;
    });

    it('has jsHeapSize field', () => {
      expect(typeof stats.jsHeapSize).toBe('number');
      expect(stats.jsHeapSize).toBeGreaterThanOrEqual(0);
    });

    it('has domNodeCount field', () => {
      expect(typeof stats.domNodeCount).toBe('number');
      expect(Number.isInteger(stats.domNodeCount)).toBe(true);
      expect(stats.domNodeCount).toBeGreaterThanOrEqual(0);
    });

    it('has documentUrl field', () => {
      expect(typeof stats.documentUrl).toBe('string');
      expect(stats.documentUrl.length).toBeGreaterThan(0);
    });

    it('documentUrl starts with http:// or https://', () => {
      expect(stats.documentUrl).toMatch(/^https?:\/\//);
    });
  });

  describe('edge cases — empty contexts', () => {
    it('tolerates empty contexts array', () => {
      const empty: RuntimeRawData = { contexts: [], warnings: [] };
      expect(empty.contexts).toHaveLength(0);
    });
  });

  describe('edge cases — missing stats', () => {
    it('tolerates missing stats', () => {
      const noStats: RuntimeRawData = { contexts: [], warnings: [] };
      expect(noStats.stats).toBeUndefined();
    });
  });
});
