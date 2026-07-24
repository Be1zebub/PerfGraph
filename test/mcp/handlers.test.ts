/**
 * Tests for MCP tool handlers.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleNormalize,
  handleExtract,
  handleAnalyze,
  handleReport,
} from '../../src/mcp/handlers.js';
import { createProgressReporter } from '../../src/mcp/progress.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP = resolve(__dirname, '..', '..', 'test-output', 'mcp-handlers');

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
// e2e fixture — load once for all handler tests that need real data
// ---------------------------------------------------------------------------

let e2eIrBundle: unknown;
let e2eFeatureSet: unknown;

try {
  const { readFileSync } = await import('node:fs');
  const { resolve: resPath } = await import('node:path');
  const fixturePath = resPath(
    __dirname, '..', 'fixtures', 'ir', 'e2e-bundle.json',
  );
  e2eIrBundle = JSON.parse(readFileSync(fixturePath, 'utf-8'));
} catch {
  e2eIrBundle = {};
}

try {
  const { extract } = await import('../../src/extract/index.js');
  e2eFeatureSet = extract(e2eIrBundle as any);
} catch {
  e2eFeatureSet = { meta: { extractedAt: '2026-01-01T00:00:00.000Z', featureCount: 0 }, features: {} };
}

// ---------------------------------------------------------------------------
// handleNormalize
// ---------------------------------------------------------------------------

describe('handleNormalize', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir('normalize'); mkdirSync(dir, { recursive: true }); });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  it('throws when run directory does not exist', async () => {
    await expect(handleNormalize('/nonexistent/path')).rejects.toThrow(
      'Run directory not found',
    );
  });

  it('produces IR from complete-run-dir fixtures', async () => {
    const fixtureDir = resolve(__dirname, '..', 'fixtures', 'ir', 'complete-run-dir');
    const files = ['trace.json','network.json','performance.json','runtime.json','console.json','dom.json','lighthouse.json'];
    for (const f of files) {
      copyFileSync(resolve(fixtureDir, f), resolve(dir, f));
    }
    const result = await handleNormalize(dir);
    expect(result).toHaveProperty('ir');
    expect(result).toHaveProperty('irFile');
    expect(result.irFile).toContain('ir.json');
  });
});

// ---------------------------------------------------------------------------
// handleExtract
// ---------------------------------------------------------------------------

describe('handleExtract', () => {
  let dir: string;
  let irFile: string;

  beforeEach(() => {
    dir = tmpDir('extract');
    irFile = writeJson(dir, 'ir.json', e2eIrBundle);
  });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  it('throws when irFile does not exist', async () => {
    await expect(handleExtract('/nonexistent/ir.json')).rejects.toThrow('IR file not found');
  });

  it('throws when irFile contains invalid JSON', async () => {
    const badFile = resolve(dir, 'bad.json');
    writeFileSync(badFile, 'not json', 'utf-8');
    await expect(handleExtract(badFile)).rejects.toThrow('Failed to parse IR file');
  });

  it('produces features file from valid IR', async () => {
    const result = await handleExtract(irFile);
    expect(result).toHaveProperty('featuresFile');
    expect(result.featuresFile).toContain('features.toon');
  });
});

// ---------------------------------------------------------------------------
// handleAnalyze
// ---------------------------------------------------------------------------

describe('handleAnalyze', () => {
  let dir: string;
  let featuresFile: string;

  beforeEach(() => {
    dir = tmpDir('analyze');
    featuresFile = writeJson(dir, 'features.toon', e2eFeatureSet);
  });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  it('throws when featuresFile does not exist', async () => {
    await expect(handleAnalyze('/nonexistent/features.toon')).rejects.toThrow(
      'Features file not found',
    );
  });

  it('throws when featuresFile contains invalid JSON', async () => {
    const badFile = resolve(dir, 'bad.json');
    writeFileSync(badFile, '{invalid}', 'utf-8');
    await expect(handleAnalyze(badFile)).rejects.toThrow('Failed to parse features file');
  });

  it('produces graph file from valid features', async () => {
    const result = await handleAnalyze(featuresFile);
    expect(result).toHaveProperty('graphFile');
    expect(result.graphFile).toContain('graph.toon');
  });
});

// ---------------------------------------------------------------------------
// handleReport
// ---------------------------------------------------------------------------

describe('handleReport', () => {
  let dir: string;
  let featuresFile: string;

  beforeEach(() => {
    dir = tmpDir('report');
    featuresFile = writeJson(dir, 'features.toon', e2eFeatureSet);
  });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  it('throws when featuresFile does not exist', async () => {
    await expect(handleReport('/nonexistent/features.toon')).rejects.toThrow(
      'Features file not found',
    );
  });

  it('throws when featuresFile contains invalid JSON', async () => {
    const badFile = resolve(dir, 'bad.json');
    writeFileSync(badFile, '{invalid}', 'utf-8');
    await expect(handleReport(badFile)).rejects.toThrow('Failed to parse features file');
  });

  it('throws when featuresFile parses to unexpected type', async () => {
    const nullFile = resolve(dir, 'null.json');
    writeFileSync(nullFile, 'null', 'utf-8');
    await expect(handleReport(nullFile)).rejects.toThrow();
  });

  it('produces report file from valid features', async () => {
    const result = await handleReport(featuresFile);
    expect(result).toHaveProperty('reportFile');
    expect(result.reportFile).toContain('report.toon');
  });
});

// ---------------------------------------------------------------------------
// Progress + pipeline integration
// ---------------------------------------------------------------------------

describe('progress integration', () => {
  it('createProgressReporter sends correct pipeline steps', async () => {
    const notifications: Array<{ progress: number; total: number; message?: string }> = [];
    const sendNotification = vi.fn(async (n: any) => {
      if (n.method === 'notifications/progress') {
        notifications.push({
          progress: n.params.progress,
          total: n.params.total,
          message: n.params.message,
        });
      }
    });

    const prog = createProgressReporter(sendNotification, 'tok_pipe')!;
    await prog.report(1, 5, 'Collecting data...');
    await prog.report(2, 5, 'Normalizing collected data...');
    await prog.report(3, 5, 'Extracting diagnostic features...');
    await prog.report(4, 5, 'Building causal degradation graph...');
    await prog.report(5, 5, 'Generating diagnostic report...');

    expect(notifications).toHaveLength(5);
    expect(notifications[0]!).toEqual({ progress: 1, total: 5, message: 'Collecting data...' });
    expect(notifications[1]!).toEqual({ progress: 2, total: 5, message: 'Normalizing collected data...' });
    expect(notifications[2]!).toEqual({ progress: 3, total: 5, message: 'Extracting diagnostic features...' });
    expect(notifications[3]!).toEqual({ progress: 4, total: 5, message: 'Building causal degradation graph...' });
    expect(notifications[4]!).toEqual({ progress: 5, total: 5, message: 'Generating diagnostic report...' });
  });
});


