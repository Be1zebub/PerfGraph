/**
 * Tests for MCP resource helpers.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import { readResource, listArtifacts, encodePath } from '../../src/mcp/resources.js';

describe('encodePath', () => {
  it('replaces forward slashes with underscores', () => {
    expect(encodePath('foo/bar/baz')).toBe('foo_bar_baz');
  });

  it('replaces backslashes with underscores', () => {
    expect(encodePath('foo\\bar\\baz')).toBe('foo_bar_baz');
  });

  it('handles mixed separators', () => {
    expect(encodePath('foo/bar\\baz')).toBe('foo_bar_baz');
  });

  it('handles paths without separators', () => {
    expect(encodePath('simple')).toBe('simple');
  });

  it('handles empty string', () => {
    expect(encodePath('')).toBe('');
  });

  it('handles Windows-style absolute paths', () => {
    const encoded = encodePath('C:\\projects\\perfgraph\\output');
    // encodePath only replaces path separators, not colons
    expect(encoded).toBe('C:_projects_perfgraph_output');
    // All backslashes should be replaced
    expect(encoded).not.toContain('\\');
  });
});

describe('readResource', () => {
  it('throws on invalid URI format', () => {
    expect(() => readResource('invalid-uri')).toThrow('Invalid resource URI');
  });

  it('throws on wrong scheme', () => {
    expect(() =>
      readResource('file:///artifacts/path/file.json'),
    ).toThrow('Invalid resource URI');
  });

  it('throws on missing filename', () => {
    expect(() =>
      readResource('perfgraph://artifacts/path/'),
    ).toThrow('Invalid resource URI');
  });

  it('throws on non-existent file', () => {
    expect(() =>
      readResource('perfgraph://artifacts/nonexistent_dir/report.toon'),
    ).toThrow('Resource not found');
  });
});

describe('listArtifacts', () => {
  it('throws on invalid URI format', () => {
    expect(() => listArtifacts('bad-uri')).toThrow('Invalid resource URI');
  });

  it('returns empty array for non-existent directory', () => {
    const result = listArtifacts('perfgraph://artifacts/does_not_exist_12345');
    expect(result).toEqual([]);
  });
});
