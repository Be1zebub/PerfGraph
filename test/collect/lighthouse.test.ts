/**
 * Lighthouse data ingestion tests.
 *
 * Validates that Lighthouse fixtures can be loaded and contain the expected
 * structure. These tests run without a browser — they use saved JSON
 * fixtures only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import type { LighthouseRawData, LighthouseCategory } from '../../src/collect/types.js';

const VALID_CATEGORIES: LighthouseCategory[] = ['performance', 'accessibility', 'best-practices', 'seo'];

describe('Lighthouse fixture ingestion', () => {
  let fixture: LighthouseRawData;
  let lhr: Record<string, unknown>;

  beforeAll(() => {
    const data = loadFixture('fixtures', 'lighthouse', 'minimal-valid.json');
    fixture = data as LighthouseRawData;
    lhr = fixture.lhr ?? {};
  });

  it('loads fixture without throwing', () => {
    expect(fixture).toBeDefined();
  });

  it('has warnings array', () => {
    expect(fixture.warnings).toBeInstanceOf(Array);
  });

  // --- LHR validation ---

  describe('LHR object', () => {
    it('lhr is a defined object', () => {
      expect(lhr).toBeDefined();
      expect(typeof lhr).toBe('object');
    });

    it('has lighthouseVersion string', () => {
      expect(typeof lhr.lighthouseVersion).toBe('string');
      expect((lhr.lighthouseVersion as string).length).toBeGreaterThan(0);
    });

    it('has requestedUrl string', () => {
      expect(typeof lhr.requestedUrl).toBe('string');
      expect((lhr.requestedUrl as string).length).toBeGreaterThan(0);
    });

    it('has categories key in LHR', () => {
      expect(lhr.categories).toBeDefined();
      expect(typeof lhr.categories).toBe('object');
    });

    it('has fetchTime string', () => {
      expect(typeof lhr.fetchTime).toBe('string');
      expect((lhr.fetchTime as string).length).toBeGreaterThan(0);
    });
  });

  // --- Categories in LHR ---

  describe('LHR categories', () => {
    let categories: Record<string, unknown>;

    beforeAll(() => {
      categories = lhr.categories as Record<string, unknown>;
    });

    it('has performance category', () => {
      expect(categories.performance).toBeDefined();
    });

    it('has accessibility category', () => {
      expect(categories.accessibility).toBeDefined();
    });

    it('has best-practices category', () => {
      expect(categories['best-practices']).toBeDefined();
    });

    it('has seo category', () => {
      expect(categories.seo).toBeDefined();
    });

    it('every category has id, title, and score', () => {
      for (const [key, cat] of Object.entries(categories)) {
        const category = cat as Record<string, unknown>;
        expect(category.id).toBe(key);
        expect(typeof category.title).toBe('string');
        expect((category.title as string).length).toBeGreaterThan(0);
        expect(typeof category.score).toBe('number');
      }
    });

    it('scores are between 0 and 1', () => {
      for (const cat of Object.values(categories)) {
        const category = cat as Record<string, unknown>;
        const score = category.score as number;
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });
  });

  // --- Top-level categories array ---

  describe('categories array', () => {
    it('is a non-empty array', () => {
      expect(fixture.categories).toBeInstanceOf(Array);
      expect(fixture.categories.length).toBeGreaterThan(0);
    });

    it('all category values are valid LighthouseCategory', () => {
      for (const cat of fixture.categories) {
        expect(VALID_CATEGORIES).toContain(cat);
      }
    });

    it('has unique category entries', () => {
      const unique = new Set(fixture.categories);
      expect(unique.size).toBe(fixture.categories.length);
    });

    it('matches the category keys in the LHR object', () => {
      const lhrCatKeys = Object.keys((lhr.categories as Record<string, unknown>) ?? {});
      const fixtureCats = fixture.categories;
      for (const cat of fixtureCats) {
        expect(lhrCatKeys).toContain(cat);
      }
    });
  });

  // --- Audits validation ---

  describe('LHR audits', () => {
    it('has audits key', () => {
      expect(lhr.audits).toBeDefined();
    });

    it('contains Core Web Vitals audits', () => {
      const audits = lhr.audits as Record<string, unknown>;
      expect(audits['first-contentful-paint']).toBeDefined();
      expect(audits['largest-contentful-paint']).toBeDefined();
      expect(audits['cumulative-layout-shift']).toBeDefined();
      expect(audits['total-blocking-time']).toBeDefined();
      expect(audits['speed-index']).toBeDefined();
    });

    it('every audit has id, title, score, and numericValue', () => {
      const audits = lhr.audits as Record<string, unknown>;
      for (const [, audit] of Object.entries(audits)) {
        const a = audit as Record<string, unknown>;
        expect(typeof a.id).toBe('string');
        expect((a.id as string).length).toBeGreaterThan(0);
        expect(typeof a.title).toBe('string');
        expect((a.title as string).length).toBeGreaterThan(0);
        expect(typeof a.score).toBe('number');
        expect(typeof a.numericValue).toBe('number');
      }
    });

    it('audit scores are between 0 and 1', () => {
      const audits = lhr.audits as Record<string, unknown>;
      for (const audit of Object.values(audits)) {
        const a = audit as Record<string, unknown>;
        const score = a.score as number;
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('tolerates empty categories array', () => {
      const empty: LighthouseRawData = { lhr: {}, categories: [], warnings: [] };
      expect(empty.categories).toHaveLength(0);
    });

    it('tolerates empty LHR object', () => {
      const empty: LighthouseRawData = { lhr: {}, categories: [], warnings: [] };
      expect(Object.keys(empty.lhr)).toHaveLength(0);
    });

    it('tolerates LHR with only minimal fields', () => {
      const minimalLhr: Record<string, unknown> = {
        lighthouseVersion: '11.0.0',
        requestedUrl: 'https://example.com/',
      };
      const data: LighthouseRawData = { lhr: minimalLhr, categories: [], warnings: [] };
      expect(data.lhr.lighthouseVersion).toBe('11.0.0');
      expect(data.categories).toHaveLength(0);
    });
  });
});
