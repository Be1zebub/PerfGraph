/**
 * LighthouseInsights builder tests.
 *
 * Validates that the lighthouse insight audits are parsed correctly from
 * raw Lighthouse v13+ data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { buildLighthouseInsights } from '../../src/normalize/lighthouse-insights.js';
import { LighthouseInsightsSchema } from '../../src/normalize/types.js';
import type { LighthouseInsights } from '../../src/normalize/types.js';

// ---------------------------------------------------------------------------
// Mock data factory
// ---------------------------------------------------------------------------

/**
 * Create a complete mock lighthouse.json with all 3 insight audits.
 */
function createMockLighthouse(): Record<string, unknown> {
  return {
    lhr: {
      audits: {
        'lcp-breakdown-insight': {
          id: 'lcp-breakdown-insight',
          title: 'LCP breakdown',
          scoreDisplayMode: 'informative',
          details: {
            type: 'list',
            items: [
              {
                type: 'table',
                items: [
                  { subpart: 'timeToFirstByte', duration: 7.803 },
                  { subpart: 'elementRenderDelay', duration: 688.821 },
                  { subpart: 'resourceLoadDelay', duration: 0 },
                  { subpart: 'resourceLoadTime', duration: 0 },
                ],
              },
              {
                type: 'node',
                lhId: 'page-0-H1',
                selector: 'h1.headline',
                snippet: '<h1 class="headline">',
                nodeLabel: 'Page headline',
              },
            ],
          },
        },
        'render-blocking-insight': {
          id: 'render-blocking-insight',
          title: 'Render blocking resources',
          scoreDisplayMode: 'metricSavings',
          metricSavings: { FCP: 300, LCP: 300 },
          details: {
            type: 'table',
            items: [
              {
                url: 'http://localhost:4173/_app/immutable/assets/0.COvdIlJq.css',
                totalBytes: 4075,
                wastedMs: 306,
              },
              {
                url: 'http://localhost:4173/fonts/fonts.css',
                totalBytes: 1208,
                wastedMs: 156,
              },
            ],
          },
        },
        'network-dependency-tree-insight': {
          id: 'network-dependency-tree-insight',
          title: 'Network dependency tree',
          scoreDisplayMode: 'informative',
          details: {
            type: 'list',
            items: [
              {
                type: 'network-tree',
                chains: {
                  BC670D1B4789: {
                    url: 'http://localhost:4173/',
                    navStartToEndTime: 22,
                    transferSize: 4624,
                    isLongest: true,
                    children: {
                      '29100.3': {
                        url: 'http://localhost:4173/fonts/fonts.css',
                        navStartToEndTime: 31,
                        transferSize: 1208,
                      },
                    },
                  },
                },
                longestChain: { duration: 128 },
              },
              {
                type: 'list-section',
                title: 'Preconnect candidates',
                items: [{ url: 'https://fonts.googleapis.com' }],
              },
            ],
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LighthouseInsights builder', () => {
  // -----------------------------------------------------------------------
  // Test 1: builds all 3 insights from full mock data
  // -----------------------------------------------------------------------
  describe('from full mock data', () => {
    let insights: LighthouseInsights;

    beforeAll(() => {
      insights = buildLighthouseInsights(createMockLighthouse());
    });

    it('builds all 3 insights', () => {
      expect(insights).toBeDefined();
      expect(insights.lcpBreakdown).toBeDefined();
      expect(insights.renderBlocking).toBeDefined();
      expect(insights.networkDependencyTree).toBeDefined();
    });

    it('output passes Zod safeParse validation', () => {
      const result = LighthouseInsightsSchema.safeParse(insights);
      expect(result.success).toBe(true);
    });

    // --- LCP breakdown ---
    describe('lcpBreakdown', () => {
      it('extracts timeToFirstByte and elementRenderDelay', () => {
        expect(insights.lcpBreakdown!.timeToFirstByte).toBe(7.803);
        expect(insights.lcpBreakdown!.elementRenderDelay).toBe(688.821);
      });

      it('extracts resourceLoadDelay and resourceLoadTime', () => {
        expect(insights.lcpBreakdown!.resourceLoadDelay).toBe(0);
        expect(insights.lcpBreakdown!.resourceLoadTime).toBe(0);
      });

      it('extracts LCP element metadata', () => {
        expect(insights.lcpBreakdown!.lcpElementSelector).toBe('h1.headline');
        expect(insights.lcpBreakdown!.lcpElementSnippet).toBe('<h1 class="headline">');
        expect(insights.lcpBreakdown!.lcpElementNodeLabel).toBe('Page headline');
      });

      it('sets source field', () => {
        expect(insights.lcpBreakdown!.source).toBe('mixed');
      });
    });

    // --- Render blocking ---
    describe('renderBlocking', () => {
      it('extracts fcpSavingsMs and lcpSavingsMs', () => {
        expect(insights.renderBlocking!.fcpSavingsMs).toBe(300);
        expect(insights.renderBlocking!.lcpSavingsMs).toBe(300);
      });

      it('extracts render blocking resources', () => {
        const resources = insights.renderBlocking!.resources;
        expect(resources).toHaveLength(2);
        expect(resources[0]!.url).toContain('0.COvdIlJq.css');
        expect(resources[0]!.totalBytes).toBe(4075);
        expect(resources[0]!.wastedMs).toBe(306);
        expect(resources[1]!.url).toContain('fonts.css');
        expect(resources[1]!.totalBytes).toBe(1208);
        expect(resources[1]!.wastedMs).toBe(156);
      });
    });

    // --- Network dependency tree ---
    describe('networkDependencyTree', () => {
      it('extracts chains', () => {
        expect(insights.networkDependencyTree!.chains).toBeDefined();
        const chains = insights.networkDependencyTree!.chains!;
        expect(Object.keys(chains)).toHaveLength(1);
        expect(chains['BC670D1B4789']).toBeDefined();
        expect(chains['BC670D1B4789']!.url).toBe('http://localhost:4173/');
      });

      it('extracts chain children', () => {
        const root = insights.networkDependencyTree!.chains!['BC670D1B4789']!;
        expect(root.children).toBeDefined();
        expect(root.children!['29100.3']).toBeDefined();
        expect(root.children!['29100.3']!.url).toContain('fonts.css');
      });

      it('extracts longestChainDuration', () => {
        expect(insights.networkDependencyTree!.longestChainDuration).toBe(128);
      });

      it('extracts longestChainUrls', () => {
        const urls = insights.networkDependencyTree!.longestChainUrls;
        expect(urls).toBeDefined();
        expect(urls!.length).toBeGreaterThan(0);
      });

      it('extracts preconnectCandidates', () => {
        const candidates = insights.networkDependencyTree!.preconnectCandidates;
        expect(candidates).toBeDefined();
        expect(candidates).toHaveLength(1);
        expect(candidates![0]).toBe('https://fonts.googleapis.com');
      });
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: empty input returns empty object
  // -----------------------------------------------------------------------
  describe('handles empty input', () => {
    it('returns empty object for null', () => {
      const insights = buildLighthouseInsights(null);
      expect(insights).toEqual({});
    });

    it('returns empty object for undefined', () => {
      const insights = buildLighthouseInsights(undefined);
      expect(insights).toEqual({});
    });

    it('returns empty object for empty object', () => {
      const insights = buildLighthouseInsights({});
      expect(insights).toEqual({});
    });

    it('output passes Zod safeParse validation', () => {
      const result = LighthouseInsightsSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: plain LighthouseReport format (no lhr wrapper)
  // -----------------------------------------------------------------------
  describe('handles plain LighthouseReport format', () => {
    it('parses audits when passed directly (no lhr wrapper)', () => {
      const plainReport: Record<string, unknown> = {
        audits: {
          'lcp-breakdown-insight': {
            id: 'lcp-breakdown-insight',
            scoreDisplayMode: 'informative',
            details: {
              type: 'list',
              items: [
                {
                  type: 'table',
                  items: [
                    { subpart: 'timeToFirstByte', duration: 15.0 },
                    { subpart: 'elementRenderDelay', duration: 300.0 },
                  ],
                },
              ],
            },
          },
        },
      };

      const insights = buildLighthouseInsights(plainReport);
      expect(insights.lcpBreakdown).toBeDefined();
      expect(insights.lcpBreakdown!.timeToFirstByte).toBe(15.0);
      expect(insights.lcpBreakdown!.elementRenderDelay).toBe(300.0);
      // Only LCP present — rest should be absent
      expect(insights.renderBlocking).toBeUndefined();
      expect(insights.networkDependencyTree).toBeUndefined();
    });

    it('output passes Zod safeParse validation', () => {
      const plainReport: Record<string, unknown> = {
        audits: {
          'render-blocking-insight': {
            id: 'render-blocking-insight',
            scoreDisplayMode: 'metricSavings',
            metricSavings: { FCP: 150, LCP: 200 },
            details: {
              type: 'table',
              items: [
                {
                  url: 'http://example.com/style.css',
                  totalBytes: 1000,
                  wastedMs: 50,
                },
              ],
            },
          },
        },
      };

      const insights = buildLighthouseInsights(plainReport);
      const result = LighthouseInsightsSchema.safeParse(insights);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: missing or partial audits
  // -----------------------------------------------------------------------
  describe('handles partial audits', () => {
    it('only includes LCP breakdown when others are missing', () => {
      const partial: Record<string, unknown> = {
        lhr: {
          audits: {
            'lcp-breakdown-insight': {
              id: 'lcp-breakdown-insight',
              scoreDisplayMode: 'informative',
              details: {
                type: 'list',
                items: [
                  {
                    type: 'table',
                    items: [
                      { subpart: 'timeToFirstByte', duration: 10 },
                      { subpart: 'elementRenderDelay', duration: 200 },
                    ],
                  },
                ],
              },
            },
          },
        },
      };

      const insights = buildLighthouseInsights(partial);
      expect(insights.lcpBreakdown).toBeDefined();
      expect(insights.renderBlocking).toBeUndefined();
      expect(insights.networkDependencyTree).toBeUndefined();
      expect(insights.lcpBreakdown!.timeToFirstByte).toBe(10);
    });

    it('handles render-blocking with no metricSavings', () => {
      const noSavings: Record<string, unknown> = {
        lhr: {
          audits: {
            'render-blocking-insight': {
              id: 'render-blocking-insight',
              scoreDisplayMode: 'metricSavings',
              details: {
                type: 'table',
                items: [
                  {
                    url: 'http://example.com/style.css',
                    totalBytes: 500,
                    wastedMs: 100,
                  },
                ],
              },
            },
          },
        },
      };

      const insights = buildLighthouseInsights(noSavings);
      expect(insights.renderBlocking).toBeDefined();
      expect(insights.renderBlocking!.resources).toHaveLength(1);
      expect(insights.renderBlocking!.fcpSavingsMs).toBeUndefined();
      expect(insights.renderBlocking!.lcpSavingsMs).toBeUndefined();
    });

    it('handles network-dependency-tree with no chains', () => {
      // Audit exists but details contain no network-tree item
      const noChains: Record<string, unknown> = {
        lhr: {
          audits: {
            'network-dependency-tree-insight': {
              id: 'network-dependency-tree-insight',
              scoreDisplayMode: 'informative',
              details: {
                type: 'list',
                items: [
                  {
                    type: 'list-section',
                    title: 'Preconnect candidates',
                    items: [],
                  },
                ],
              },
            },
          },
        },
      };

      const insights = buildLighthouseInsights(noChains);
      expect(insights.networkDependencyTree).toBeDefined();
      expect(insights.networkDependencyTree!.chains).toBeUndefined();
      expect(insights.networkDependencyTree!.longestChainDuration).toBeUndefined();
      expect(insights.networkDependencyTree!.preconnectCandidates).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Test 5: malformed audit data is handled gracefully
  // -----------------------------------------------------------------------
  describe('handles malformed data', () => {
    it('handles missing details gracefully', () => {
      const malformed: Record<string, unknown> = {
        lhr: {
          audits: {
            'lcp-breakdown-insight': {
              id: 'lcp-breakdown-insight',
              scoreDisplayMode: 'informative',
              // no details
            },
          },
        },
      };

      const insights = buildLighthouseInsights(malformed);
      expect(insights.lcpBreakdown).toBeUndefined();
    });

    it('handles non-object audits gracefully', () => {
      const bad: Record<string, unknown> = {
        lhr: {
          audits: {
            'lcp-breakdown-insight': 'not-an-object',
          },
        },
      };

      const insights = buildLighthouseInsights(bad);
      expect(insights.lcpBreakdown).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Test 6: Zod schema validation of the result
  // -----------------------------------------------------------------------
  describe('Zod schema validation', () => {
    it('validates a fully-populated insights object', () => {
      const insights = buildLighthouseInsights(createMockLighthouse());
      const result = LighthouseInsightsSchema.safeParse(insights);
      expect(result.success).toBe(true);
    });

    it('validates a minimal (empty) insights object', () => {
      const result = LighthouseInsightsSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
