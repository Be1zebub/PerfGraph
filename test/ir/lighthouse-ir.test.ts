/**
 * LighthouseIR builder tests.
 *
 * Validates that the lighthouse intermediate representation is built
 * correctly from raw Lighthouse Report (LHR) data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import { buildLighthouseIR } from '../../src/normalize/lighthouse-ir.js';
import { LighthouseIRSchema } from '../../src/normalize/types.js';
import type { LighthouseRawData } from '../../src/collect/types.js';
import type { LighthouseIR } from '../../src/normalize/types.js';

describe('LighthouseIR builder', () => {
  // -----------------------------------------------------------------------
  // Test 1: builds LighthouseIR from minimal valid LHR
  // -----------------------------------------------------------------------
  describe('from minimal-valid fixture', () => {
    let ir: LighthouseIR;

    beforeAll(() => {
      const lighthouse = loadFixture(
        'fixtures',
        'lighthouse',
        'minimal-valid.json',
      ) as LighthouseRawData;
      ir = buildLighthouseIR(lighthouse);
    });

    it('builds LighthouseIR from minimal valid fixtures', () => {
      expect(ir).toBeDefined();
      expect(ir.categories).toBeDefined();
      expect(ir.failedAudits).toBeDefined();
      expect(ir.scores).toBeDefined();
    });

    it('output passes Zod safeParse validation', () => {
      const result = LighthouseIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });

    it('categories include all 4 expected (performance, accessibility, best-practices, seo)', () => {
      expect(Object.keys(ir.categories)).toHaveLength(4);
      expect(ir.categories['performance']).toBeDefined();
      expect(ir.categories['accessibility']).toBeDefined();
      expect(ir.categories['best-practices']).toBeDefined();
      expect(ir.categories['seo']).toBeDefined();
    });

    it('failedAudits contains all fixture audits (all have score < 1)', () => {
      expect(ir.failedAudits.length).toBeGreaterThanOrEqual(5);

      // Verify specific audits are included
      const auditIds = ir.failedAudits.map((a) => a.id);
      expect(auditIds).toContain('first-contentful-paint');
      expect(auditIds).toContain('largest-contentful-paint');
      expect(auditIds).toContain('cumulative-layout-shift');
      expect(auditIds).toContain('total-blocking-time');
      expect(auditIds).toContain('speed-index');
    });

    it('scores map correctly to top-level keys', () => {
      expect(ir.scores.performance).toBe(0.85);
      expect(ir.scores.accessibility).toBe(0.92);
      expect(ir.scores.bestPractices).toBe(0.88);
      expect(ir.scores.seo).toBe(0.95);
    });

    it('failedAudits include numericValue when present', () => {
      const fcpAudit = ir.failedAudits.find(
        (a) => a.id === 'first-contentful-paint',
      );
      expect(fcpAudit).toBeDefined();
      expect(fcpAudit!.numericValue).toBe(1200);

      const clsAudit = ir.failedAudits.find(
        (a) => a.id === 'cumulative-layout-shift',
      );
      expect(clsAudit).toBeDefined();
      expect(clsAudit!.numericValue).toBe(0.05);
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: empty/minimal LHR produces zeroed defaults
  // -----------------------------------------------------------------------
  describe('handles empty LHR', () => {
    let ir: LighthouseIR;

    beforeAll(() => {
      const empty: LighthouseRawData = {
        lhr: {},
        categories: [],
        warnings: [],
      };
      ir = buildLighthouseIR(empty);
    });

    it('returns empty categories and failedAudits', () => {
      expect(ir.categories).toEqual({});
      expect(ir.failedAudits).toHaveLength(0);
    });

    it('scores are all undefined', () => {
      expect(ir.scores.performance).toBeUndefined();
      expect(ir.scores.accessibility).toBeUndefined();
      expect(ir.scores.bestPractices).toBeUndefined();
      expect(ir.scores.seo).toBeUndefined();
    });

    it('output passes Zod safeParse validation', () => {
      const result = LighthouseIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: LCP numeric value extracted from largest-contentful-paint audit
  // -----------------------------------------------------------------------
  describe('LCP numeric value extraction', () => {
    let ir: LighthouseIR;

    beforeAll(() => {
      const lighthouse = loadFixture(
        'fixtures',
        'lighthouse',
        'minimal-valid.json',
      ) as LighthouseRawData;
      ir = buildLighthouseIR(lighthouse);
    });

    it('extracts lcpNumericValue from largest-contentful-paint audit', () => {
      expect(ir.lcpNumericValue).toBe(2400);
    });

    it('lcpElement fields are undefined when no lcp-breakdown-insight audit', () => {
      expect(ir.lcpElementSelector).toBeUndefined();
      expect(ir.lcpElementSnippet).toBeUndefined();
      expect(ir.lcpElementNodeLabel).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: LCP element details from lcp-breakdown-insight audit
  // -----------------------------------------------------------------------
  describe('LCP element details from lcp-breakdown-insight', () => {
    let ir: LighthouseIR;

    beforeAll(() => {
      const withInsight: LighthouseRawData = {
        lhr: {
          categories: {
            performance: { id: 'performance', title: 'Performance', score: 0.85 },
          },
          audits: {
            'lcp-breakdown-insight': {
              id: 'lcp-breakdown-insight',
              title: 'LCP breakdown',
              score: null,
              details: {
                type: 'debugdata',
                items: [
                  {
                    type: 'node',
                    selector: 'img.hero',
                    snippet: '<img class="hero" src="hero.jpg">',
                    nodeLabel: 'img.hero',
                  },
                ],
              },
            },
          },
        } as Record<string, unknown>,
        categories: ['performance'],
        warnings: [],
      };
      ir = buildLighthouseIR(withInsight);
    });

    it('extracts lcpElementSelector from lcp-breakdown-insight', () => {
      expect(ir.lcpElementSelector).toBe('img.hero');
    });

    it('extracts lcpElementSnippet from lcp-breakdown-insight', () => {
      expect(ir.lcpElementSnippet).toBe('<img class="hero" src="hero.jpg">');
    });

    it('extracts lcpElementNodeLabel from lcp-breakdown-insight', () => {
      expect(ir.lcpElementNodeLabel).toBe('img.hero');
    });

    it('output passes Zod safeParse validation', () => {
      const result = LighthouseIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: extracts renderBlockingResources from Lighthouse audits
  // -----------------------------------------------------------------------
  describe('extracts renderBlockingResources', () => {
    let ir: LighthouseIR;

    beforeAll(() => {
      const lighthouse = loadFixture(
        'fixtures',
        'lighthouse',
        'minimal-valid.json',
      ) as LighthouseRawData;
      ir = buildLighthouseIR(lighthouse);
    });

    it('renderBlockingResources is defined', () => {
      expect(ir.renderBlockingResources).toBeDefined();
    });

    it('contains both style.css and app.js resources', () => {
      const resources = ir.renderBlockingResources!;
      expect(resources).toHaveLength(2);

      const styleCss = resources.find((r) => r.url.includes('style.css'));
      expect(styleCss).toBeDefined();
      expect(styleCss!.totalBytes).toBe(18000);
      expect(styleCss!.wastedMs).toBe(306);
      expect(styleCss!.resourceType).toBe('Stylesheet');

      const appJs = resources.find((r) => r.url.includes('app.js'));
      expect(appJs).toBeDefined();
      expect(appJs!.totalBytes).toBe(45000);
      expect(appJs!.wastedMs).toBe(560);
      expect(appJs!.resourceType).toBe('Script');
    });

    it('output still passes Zod safeParse validation with new fields', () => {
      const result = LighthouseIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: audit with missing numericValue still included in failedAudits
  // -----------------------------------------------------------------------
  describe('audit with missing numericValue', () => {
    let ir: LighthouseIR;

    beforeAll(() => {
      const withMissingNumeric: LighthouseRawData = {
        lhr: {
          categories: {
            performance: {
              id: 'performance',
              title: 'Performance',
              score: 0.5,
            },
          },
          audits: {
            'custom-audit': {
              id: 'custom-audit',
              title: 'Custom Audit',
              description: 'A test audit without numericValue',
              score: 0.6,
              // numericValue intentionally missing
            },
          },
        } as Record<string, unknown>,
        categories: ['performance'],
        warnings: [],
      };
      ir = buildLighthouseIR(withMissingNumeric);
    });

    it('audit without numericValue is still included', () => {
      expect(ir.failedAudits).toHaveLength(1);
      expect(ir.failedAudits[0]!.id).toBe('custom-audit');
      expect(ir.failedAudits[0]!.numericValue).toBeUndefined();
    });
  });
});
