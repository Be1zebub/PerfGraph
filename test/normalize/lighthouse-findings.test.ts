import { describe, it, expect } from 'vitest';
import { parseInsightFindings } from '../../src/normalize/lighthouse-findings.js';

describe('parseInsightFindings', () => {
  it('sums the forced reflow time and names the sources', () => {
    const findings = parseInsightFindings({
      'forced-reflow-insight': {
        score: 0,
        details: {
          type: 'list',
          items: [
            {
              type: 'table',
              headings: [{ key: 'source' }, { key: 'reflowTime' }],
              items: [
                {
                  source: { type: 'source-location', url: 'https://example.com/app.js', line: 1, column: 4220 },
                  reflowTime: 100.082,
                },
              ],
            },
            {
              type: 'table',
              headings: [{ key: 'source' }, { key: 'reflowTime' }],
              items: [
                {
                  source: { type: 'source-location', url: 'https://example.com/app.js', line: 1, column: 17656 },
                  reflowTime: 97.138,
                },
              ],
            },
          ],
        },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe('forced-reflow');
    expect(findings[0]!.value).toBeCloseTo(197.22, 2);
    expect(findings[0]!.unit).toBe('ms');
    expect(findings[0]!.sources).toEqual([
      'https://example.com/app.js:1:4220',
      'https://example.com/app.js:1:17656',
    ]);
    expect(findings[0]!.auditScore).toBe(0);
  });

  it('takes the wasted bytes a byte audit reports', () => {
    const findings = parseInsightFindings({
      'image-delivery-insight': {
        score: 0,
        details: {
          type: 'table',
          headings: [{ key: 'url' }, { key: 'wastedBytes' }],
          items: [{ url: 'https://example.com/sprite.png', wastedBytes: 245_980 }],
          debugData: { type: 'debugdata', wastedBytes: 245_980 },
        },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe('image-delivery');
    expect(findings[0]!.value).toBe(245_980);
    expect(findings[0]!.unit).toBe('bytes');
    expect(findings[0]!.sources).toEqual(['https://example.com/sprite.png']);
  });

  it('sums the rows when the audit reports no total', () => {
    const findings = parseInsightFindings({
      'cache-insight': {
        score: 0,
        details: {
          type: 'table',
          headings: [{ key: 'url' }, { key: 'wastedBytes' }],
          items: [
            { url: 'https://example.com/a.js', wastedBytes: 12_000 },
            { url: 'https://example.com/b.js', wastedBytes: 9_000 },
          ],
        },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.value).toBe(21_000);
  });

  it('returns nothing for a clean run', () => {
    const findings = parseInsightFindings({
      'forced-reflow-insight': { score: 1, details: { type: 'list', items: [] } },
      'image-delivery-insight': {
        score: 1,
        details: { type: 'table', headings: [], items: [], debugData: { wastedBytes: 0 } },
      },
    });

    expect(findings).toEqual([]);
  });

  it('ignores audits that are not there', () => {
    expect(parseInsightFindings({})).toEqual([]);
  });
});
