/**
 * Tests for shared filesystem utilities.
 *
 * Covers readJson and loadRunDir from src/shared/fs-utils.ts.
 * Uses temp directories to avoid polluting the real filesystem.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJson, loadRunDir } from '../../src/shared/fs-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP = resolve(__dirname, '..', '..', 'test-output', 'shared-fs-utils');

function tmpDir(name: string): string {
  return resolve(TMP, name);
}

function writeJson(dir: string, file: string, data: unknown): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = resolve(dir, file);
  writeFileSync(path, JSON.stringify(data), 'utf-8');
  return path;
}

// ---------------------------------------------------------------------------
// readJson
// ---------------------------------------------------------------------------

describe('readJson', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir('readjson');
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('returns parsed object for a valid JSON file', () => {
    writeJson(dir, 'valid.json', { key: 'value', num: 42 });
    const result = readJson(dir, 'valid.json');
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('returns parsed array for a valid JSON array file', () => {
    writeJson(dir, 'arr.json', [1, 2, 3]);
    const result = readJson(dir, 'arr.json');
    expect(result).toEqual([1, 2, 3]);
  });

  it('returns parsed primitive values', () => {
    // Write raw JSON content (not via writeJson which double-serializes)
    writeFileSync(resolve(dir, 'str.json'), '"hello"', 'utf-8');
    expect(readJson(dir, 'str.json')).toBe('hello');

    writeFileSync(resolve(dir, 'num.json'), '42', 'utf-8');
    expect(readJson(dir, 'num.json')).toBe(42);

    writeFileSync(resolve(dir, 'null.json'), 'null', 'utf-8');
    expect(readJson(dir, 'null.json')).toBeNull();
  });

  it('throws on invalid JSON content', () => {
    writeFileSync(resolve(dir, 'bad.json'), '{invalid}', 'utf-8');
    expect(() => readJson(dir, 'bad.json')).toThrow();
  });

  it('returns undefined for a missing file', () => {
    expect(readJson(dir, 'nonexistent.json')).toBeUndefined();
  });

  it('does not throw for an empty directory', () => {
    expect(readJson(dir, 'missing.json')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadRunDir
// ---------------------------------------------------------------------------

describe('loadRunDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir('loadrundir');
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('returns bundle with all fields when all JSON files are present', () => {
    writeJson(dir, 'trace.json', { events: [] });
    writeJson(dir, 'network.json', { requests: [] });
    writeJson(dir, 'performance.json', { metrics: [] });
    writeJson(dir, 'runtime.json', { contexts: [] });
    writeJson(dir, 'console.json', { entries: [] });
    writeJson(dir, 'dom.json', { stats: {} });
    writeJson(dir, 'lighthouse.json', { categories: {} });
    writeJson(dir, 'coverage.json', { js: [], css: [], warnings: [] });
    writeJson(dir, 'warnings.json', {
      warnings: ['slow trace', 'missing data'],
      timestamp: '2026-07-23T12:00:00.000Z',
    });

    const bundle = loadRunDir(dir);
    expect(bundle.trace).toEqual({ events: [] });
    expect(bundle.network).toEqual({ requests: [] });
    expect(bundle.performance).toEqual({ metrics: [] });
    expect(bundle.runtime).toEqual({ contexts: [] });
    expect(bundle.consoleEntries).toEqual({ entries: [] });
    expect(bundle.dom).toEqual({ stats: {} });
    expect(bundle.lighthouse).toEqual({ categories: {} });
    expect(bundle.coverage).toEqual({ js: [], css: [], warnings: [] });
    expect(bundle.warnings).toEqual(['slow trace', 'missing data']);
  });

  it('returns bundle with undefined fields when some files are missing', () => {
    writeJson(dir, 'trace.json', { events: [] });
    writeJson(dir, 'network.json', { requests: [] });
    // Only write trace + network, skip the rest

    const bundle = loadRunDir(dir);
    expect(bundle.trace).toEqual({ events: [] });
    expect(bundle.network).toEqual({ requests: [] });
    expect(bundle.performance).toBeUndefined();
    expect(bundle.runtime).toBeUndefined();
    expect(bundle.consoleEntries).toBeUndefined();
    expect(bundle.dom).toBeUndefined();
    expect(bundle.lighthouse).toBeUndefined();
    expect(bundle.coverage).toBeUndefined();
    expect(bundle.warnings).toBeUndefined();
  });

  it('returns bundle with undefined for every field when directory has no known files', () => {
    writeJson(dir, 'random.json', { foo: 1 }); // not a known file name

    const bundle = loadRunDir(dir);
    expect(bundle.trace).toBeUndefined();
    expect(bundle.network).toBeUndefined();
    expect(bundle.performance).toBeUndefined();
    expect(bundle.runtime).toBeUndefined();
    expect(bundle.consoleEntries).toBeUndefined();
    expect(bundle.dom).toBeUndefined();
    expect(bundle.lighthouse).toBeUndefined();
    expect(bundle.coverage).toBeUndefined();
    expect(bundle.warnings).toBeUndefined();
  });

  it('returns bundle with undefined for every field when directory is empty', () => {
    const bundle = loadRunDir(dir);
    expect(bundle.trace).toBeUndefined();
    expect(bundle.network).toBeUndefined();
    expect(bundle.performance).toBeUndefined();
    expect(bundle.runtime).toBeUndefined();
    expect(bundle.consoleEntries).toBeUndefined();
    expect(bundle.dom).toBeUndefined();
    expect(bundle.lighthouse).toBeUndefined();
    expect(bundle.coverage).toBeUndefined();
    expect(bundle.warnings).toBeUndefined();
  });

  it('propagates readJson errors for malformed files', () => {
    writeJson(dir, 'trace.json', { events: [] });
    writeFileSync(resolve(dir, 'network.json'), '{bad}', 'utf-8');

    // readJson throws on invalid JSON, which propagates through loadRunDir
    expect(() => loadRunDir(dir)).toThrow();
  });

  it('resolves the directory with resolve() before reading', () => {
    // Relative paths should work too
    writeJson(dir, 'trace.json', { events: [] });
    const bundle = loadRunDir(dir);
    expect(bundle.trace).toEqual({ events: [] });
  });

  it('loads warnings from warnings.json when present', () => {
    writeJson(dir, 'trace.json', { events: [] });
    writeJson(dir, 'warnings.json', {
      warnings: ['network timeout', 'trace buffer overflow'],
      timestamp: '2026-07-23T12:00:00.000Z',
    });

    const bundle = loadRunDir(dir);
    expect(bundle.warnings).toEqual([
      'network timeout',
      'trace buffer overflow',
    ]);
  });

  it('returns undefined warnings when warnings.json has wrong shape', () => {
    writeJson(dir, 'trace.json', { events: [] });
    // warnings.json exists but is not the expected { warnings: string[] } shape
    writeJson(dir, 'warnings.json', { notWarnings: true });

    const bundle = loadRunDir(dir);
    expect(bundle.warnings).toBeUndefined();
  });

  it('returns undefined warnings when warnings.json is missing', () => {
    writeJson(dir, 'trace.json', { events: [] });
    // No warnings.json file

    const bundle = loadRunDir(dir);
    expect(bundle.warnings).toBeUndefined();
  });
});
