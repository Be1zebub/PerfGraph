/**
 * DOMIR builder tests.
 *
 * Validates that the DOM intermediate representation is built
 * correctly from DOM raw data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import { buildDOMIR } from '../../src/normalize/dom-ir.js';
import { DOMIRSchema } from '../../src/normalize/types.js';
import type { DomRawData } from '../../src/collect/types.js';
import type { DOMIR } from '../../src/normalize/types.js';

describe('DOMIR builder', () => {
  // -----------------------------------------------------------------------
  // Test 1: builds DOMIR from minimal valid fixtures
  // -----------------------------------------------------------------------
  describe('from minimal valid fixtures', () => {
    let ir: DOMIR;
    let expected: DOMIR;

    beforeAll(() => {
      const dom = loadFixture('fixtures', 'dom', 'minimal-valid.json') as DomRawData;
      expected = loadFixture('fixtures', 'ir', 'dom-ir-expected.json') as DOMIR;
      ir = buildDOMIR(dom);
    });

    it('builds DOMIR from minimal valid fixtures', () => {
      expect(ir).toBeDefined();
      expect(ir.stats).toBeDefined();
      expect(ir.tagDistribution).toBeDefined();
      expect(ir.layoutShiftCandidates).toBeDefined();
    });

    it('output passes Zod safeParse validation', () => {
      const result = DOMIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });

    it('stats match input fixture', () => {
      expect(ir.stats.totalNodes).toBe(312);
      expect(ir.stats.elementCount).toBe(99);
      expect(ir.stats.maxDepth).toBe(12);
    });

    it('maxChildren derived from elementDistribution max value', () => {
      expect(ir.stats.maxChildren).toBe(28); // div:28 is the max
    });

    it('tagDistribution length matches input elementDistribution keys count (20)', () => {
      expect(ir.tagDistribution).toHaveLength(20);
      // Verify first and last entries
      expect(ir.tagDistribution[0]).toEqual({ tag: 'html', count: 1 });
      expect(ir.tagDistribution[19]).toEqual({ tag: 'footer', count: 1 });
      // Verify a mid-point entry
      const divEntry = ir.tagDistribution.find((t) => t.tag === 'div');
      expect(divEntry).toBeDefined();
      expect(divEntry!.count).toBe(28);
    });

    it('layoutShiftCandidates computed correctly', () => {
      // maxChildren=28 (< 50) → highComplexitySubtrees=0
      expect(ir.layoutShiftCandidates.highComplexitySubtrees).toBe(0);
      // maxDepth=12 (< 15) → deepNesting=0
      expect(ir.layoutShiftCandidates.deepNesting).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: handles empty DOM (empty elementDistribution)
  // -----------------------------------------------------------------------
  describe('handles empty elementDistribution', () => {
    let ir: DOMIR;

    beforeAll(() => {
      const emptyDom: DomRawData = {
        stats: {
          totalNodes: 0,
          elementCount: 0,
          maxDepth: 0,
          textContentLength: 0,
        },
        elementDistribution: {},
        warnings: [],
      };
      ir = buildDOMIR(emptyDom);
    });

    it('stats are zeroed', () => {
      expect(ir.stats.totalNodes).toBe(0);
      expect(ir.stats.elementCount).toBe(0);
      expect(ir.stats.maxDepth).toBe(0);
      expect(ir.stats.maxChildren).toBe(0);
    });

    it('tagDistribution is empty', () => {
      expect(ir.tagDistribution).toEqual([]);
    });

    it('layoutShiftCandidates are zeroed', () => {
      expect(ir.layoutShiftCandidates.highComplexitySubtrees).toBe(0);
      expect(ir.layoutShiftCandidates.deepNesting).toBe(0);
    });

    it('output passes Zod safeParse validation', () => {
      const result = DOMIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: handles zero elementCount with distribution
  // -----------------------------------------------------------------------
  describe('zero elementCount still produces valid DOMIR', () => {
    let ir: DOMIR;

    beforeAll(() => {
      const zeroElementDom: DomRawData = {
        stats: {
          totalNodes: 0,
          elementCount: 0,
          maxDepth: 0,
          textContentLength: 0,
        },
        elementDistribution: {
          div: 0,
          span: 0,
        },
        warnings: [],
      };
      ir = buildDOMIR(zeroElementDom);
    });

    it('produces valid DOMIR with empty tagDistribution', () => {
      expect(ir.tagDistribution).toHaveLength(2);
      expect(ir.tagDistribution[0]).toEqual({ tag: 'div', count: 0 });
    });

    it('maxChildren is 0', () => {
      expect(ir.stats.maxChildren).toBe(0);
    });

    it('output passes Zod safeParse validation', () => {
      const result = DOMIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: layoutShiftCandidates with high maxChildren
  // -----------------------------------------------------------------------
  describe('layoutShiftCandidates with high complexity', () => {
    let ir: DOMIR;

    beforeAll(() => {
      // Create a DOM with high maxChildren to trigger complexity
      const highComplexityDom: DomRawData = {
        stats: {
          totalNodes: 5000,
          elementCount: 1000,
          maxDepth: 20, // depth >= 15 → deepNesting = 1
          textContentLength: 50000,
        },
        elementDistribution: {
          div: 200,  // maxChildren = 200, >= 50
          span: 80,  // 80 > 100 (maxChildren/2)
          p: 40,     // 40 < 100
          a: 30,     // 30 < 100
          li: 120,   // 120 > 100
        },
        warnings: [],
      };
      ir = buildDOMIR(highComplexityDom);
    });

    it('maxChildren is correct', () => {
      expect(ir.stats.maxChildren).toBe(200);
    });

    it('highComplexitySubtrees counts tags with count > maxChildren/2', () => {
      // div:200 > 100, span:80 < 100, p:40 < 100, a:30 < 100, li:120 > 100
      expect(ir.layoutShiftCandidates.highComplexitySubtrees).toBe(2);
    });

    it('deepNesting is 1 when maxDepth >= 15', () => {
      expect(ir.layoutShiftCandidates.deepNesting).toBe(1);
    });
  });
});
