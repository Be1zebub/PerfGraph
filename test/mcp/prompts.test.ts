/**
 * Tests for MCP diagnostic prompt templates.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  buildLcpAnalysisPrompt,
  LcpAnalysisArgsSchema,
  buildAuditPrompt,
  AuditArgsSchema,
  buildSummarizePrompt,
  SummarizeArgsSchema,
} from '../../src/mcp/prompts.js';

describe('LcpAnalysisArgsSchema', () => {
  it('accepts valid url', () => {
    const result = LcpAnalysisArgsSchema.parse({ url: 'https://example.com' });
    expect(result.url).toBe('https://example.com');
  });

  it('accepts url + reportUri', () => {
    const result = LcpAnalysisArgsSchema.parse({
      url: 'https://example.com',
      reportUri: 'perfgraph://artifacts/path/report.toon',
    });
    expect(result.reportUri).toBe('perfgraph://artifacts/path/report.toon');
  });

  it('rejects empty url', () => {
    expect(() => LcpAnalysisArgsSchema.parse({ url: '' })).toThrow();
  });

  it('rejects missing url', () => {
    expect(() => LcpAnalysisArgsSchema.parse({})).toThrow();
  });
});

describe('AuditArgsSchema', () => {
  it('accepts url with defaults', () => {
    const result = AuditArgsSchema.parse({ url: 'https://example.com' });
    expect(result.url).toBe('https://example.com');
    expect(result.runs).toBeUndefined();
    expect(result.focus).toBeUndefined();
  });

  it('accepts all optional fields', () => {
    const result = AuditArgsSchema.parse({
      url: 'https://example.com',
      runs: 3,
      focus: 'lcp',
    });
    expect(result.runs).toBe(3);
    expect(result.focus).toBe('lcp');
  });

  it('rejects runs > 5', () => {
    expect(() =>
      AuditArgsSchema.parse({ url: 'https://example.com', runs: 10 }),
    ).toThrow();
  });

  it('rejects invalid focus', () => {
    expect(() =>
      AuditArgsSchema.parse({ url: 'https://example.com', focus: 'seo' }),
    ).toThrow();
  });
});

describe('SummarizeArgsSchema', () => {
  it('accepts reportUri only', () => {
    const result = SummarizeArgsSchema.parse({
      reportUri: 'perfgraph://artifacts/foo/report.toon',
    });
    expect(result.reportUri).toBe('perfgraph://artifacts/foo/report.toon');
  });

  it('accepts reportUri with detail', () => {
    const result = SummarizeArgsSchema.parse({
      reportUri: 'perfgraph://artifacts/foo/report.toon',
      detail: 'brief',
    });
    expect(result.detail).toBe('brief');
  });

  it('rejects invalid detail', () => {
    expect(() =>
      SummarizeArgsSchema.parse({
        reportUri: 'perfgraph://artifacts/foo/report.toon',
        detail: 'ultra',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Prompt builder output structure
// ---------------------------------------------------------------------------

describe('buildLcpAnalysisPrompt', () => {
  it('returns GetPromptResult with description and messages', () => {
    const result = buildLcpAnalysisPrompt({ url: 'https://example.com' });

    expect(result.description).toContain('LCP performance analysis');
    expect(result.description).toContain('example.com');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe('user');
    expect(result.messages[0]!.content.type).toBe('text');
    expect(typeof result.messages[0]!.content.text).toBe('string');
  });

  it('includes SYSTEM_CONTEXT in the message text', () => {
    const result = buildLcpAnalysisPrompt({ url: 'https://example.com' });
    const text = result.messages[0]!.content.text;

    expect(text).toContain('perfgraph_run');
    expect(text).toContain('perfgraph://');
  });

  it('uses reportUri variant when provided', () => {
    const result = buildLcpAnalysisPrompt({
      url: 'https://example.com',
      reportUri: 'perfgraph://artifacts/path/report.toon',
    });
    const text = result.messages[0]!.content.text;

    expect(text).toContain('Analyze the LCP performance from the existing report');
    expect(text).toContain('perfgraph://artifacts/path/report.toon');
  });

  it('uses URL variant when no reportUri', () => {
    const result = buildLcpAnalysisPrompt({ url: 'https://example.com' });
    const text = result.messages[0]!.content.text;

    expect(text).toContain('perfgraph_run');
    expect(text).toContain('https://example.com');
  });
});

describe('buildAuditPrompt', () => {
  it('returns GetPromptResult with standard structure', () => {
    const result = buildAuditPrompt({ url: 'https://example.com' });

    expect(result.description).toContain('Full performance audit of');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe('user');
    expect(result.messages[0]!.content.type).toBe('text');
  });

  it('includes focus-specific content when focus is set', () => {
    const result = buildAuditPrompt({
      url: 'https://example.com',
      focus: 'js',
    });
    const text = result.messages[0]!.content.text;

    expect(text).toContain('Long tasks');
    expect(text).toContain('TBT');
    expect(text).toContain('Execution hotspots');
  });

  it('includes runs info when provided', () => {
    const result = buildAuditPrompt({
      url: 'https://example.com',
      runs: 3,
    });
    const text = result.messages[0]!.content.text;

    expect(text).toContain('runs=3');
  });
});

describe('buildSummarizePrompt', () => {
  it('returns GetPromptResult with standard structure', () => {
    const result = buildSummarizePrompt({
      reportUri: 'perfgraph://artifacts/path/report.toon',
    });

    expect(result.description).toContain('Summarize PerfGraph report');
    expect(result.messages).toHaveLength(1);
  });

  it('generates brief summary when detail=brief', () => {
    const result = buildSummarizePrompt({
      reportUri: 'perfgraph://artifacts/path/report.toon',
      detail: 'brief',
    });
    const text = result.messages[0]!.content.text;

    expect(text).toContain('concise');
    expect(text).toContain('3-5 bullet points');
  });

  it('generates detailed summary when detail=detailed', () => {
    const result = buildSummarizePrompt({
      reportUri: 'perfgraph://artifacts/path/report.toon',
      detail: 'detailed',
    });
    const text = result.messages[0]!.content.text;

    expect(text).toContain('comprehensive');
    expect(text).toContain('Executive Summary');
  });

  it('defaults to normal detail level', () => {
    const result = buildSummarizePrompt({
      reportUri: 'perfgraph://artifacts/path/report.toon',
    });
    const text = result.messages[0]!.content.text;

    expect(text).not.toContain('concise');
    expect(text).not.toContain('comprehensive');
  });
});
