/**
 * Performance data ingestion tests.
 *
 * Validates that performance fixtures can be loaded and contain the expected
 * structure. These tests run without a browser — they use saved JSON
 * fixtures only.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import type { PerformanceRawData, PerformanceMetric } from '../src/collect/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load a JSON fixture by relative path from the test directory */
function loadFixture(relativePath: string): unknown {
  const fullPath = resolve(__dirname, relativePath);
  const raw = readFileSync(fullPath, 'utf-8');
  return JSON.parse(raw);
}

describe('Performance fixture ingestion', () => {
  let fixture: PerformanceRawData;
  let metrics: PerformanceMetric[];

  beforeAll(() => {
    const data = loadFixture('./fixtures/performance/minimal-valid.json');
    fixture = data as PerformanceRawData;
    metrics = fixture.metrics ?? [];
  });

  it('loads fixture without throwing', () => {
    expect(fixture).toBeDefined();
  });

  it('has a non-empty metrics array', () => {
    expect(metrics.length).toBeGreaterThan(0);
  });

  it('has a numeric timestamp', () => {
    expect(typeof fixture.timestamp).toBe('number');
    expect(fixture.timestamp).toBeGreaterThan(0);
  });

  it('has warnings array', () => {
    expect(fixture.warnings).toBeInstanceOf(Array);
  });

  it('every metric has name and value fields', () => {
    for (const metric of metrics) {
      expect(typeof metric.name).toBe('string');
      expect(metric.name.length).toBeGreaterThan(0);

      expect(typeof metric.value).toBe('number');
    }
  });

  it('contains Timestamp metric', () => {
    const tsMetric = metrics.find((m) => m.name === 'Timestamp');
    expect(tsMetric).toBeDefined();
    expect(typeof tsMetric!.value).toBe('number');
  });

  it('contains Documents metric', () => {
    const docMetric = metrics.find((m) => m.name === 'Documents');
    expect(docMetric).toBeDefined();
    expect(docMetric!.value).toBeGreaterThan(0);
  });

  it('contains JSEventListeners metric', () => {
    const listenersMetric = metrics.find((m) => m.name === 'JSEventListeners');
    expect(listenersMetric).toBeDefined();
  });

  it('contains JSHeapUsedSize metric', () => {
    const heapMetric = metrics.find((m) => m.name === 'JSHeapUsedSize');
    expect(heapMetric).toBeDefined();
    expect(heapMetric!.value).toBeGreaterThan(0);
  });

  it('contains Nodes metric', () => {
    const nodesMetric = metrics.find((m) => m.name === 'Nodes');
    expect(nodesMetric).toBeDefined();
    expect(nodesMetric!.value).toBeGreaterThan(0);
  });

  it('metric values are non-negative', () => {
    for (const metric of metrics) {
      expect(metric.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('contains the expected standard metrics', () => {
    const expectedNames = [
      'Timestamp',
      'Documents',
      'Frames',
      'JSEventListeners',
      'Nodes',
      'LayoutCount',
      'RecalcStyleCount',
      'LayoutDuration',
      'RecalcStyleDuration',
      'ScriptDuration',
      'TaskDuration',
      'JSHeapUsedSize',
      'JSHeapTotalSize',
    ];

    const metricNames = new Set(metrics.map((m) => m.name));
    for (const name of expectedNames) {
      expect(metricNames.has(name)).toBe(true);
    }
  });

  it('has unique metric names', () => {
    const names = metrics.map((m) => m.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
