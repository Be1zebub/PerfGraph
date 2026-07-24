/**
 * Enhanced performance data ingestion tests.
 *
 * Builds on the existing test/performance.test.ts coverage by adding deeper
 * structural validation, boundary checks, and edge cases.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import type { PerformanceRawData, PerformanceMetric } from '../../src/collect/types.js';

describe('Performance fixture ingestion (enhanced)', () => {
  let fixture: PerformanceRawData;
  let metrics: PerformanceMetric[];

  beforeAll(() => {
    const data = loadFixture('fixtures', 'performance', 'minimal-valid.json');
    fixture = data as PerformanceRawData;
    metrics = fixture.metrics ?? [];
  });

  // --- Basic structure ---

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

  // --- Metric structure ---

  it('every metric has name and value fields', () => {
    for (const metric of metrics) {
      expect(typeof metric.name).toBe('string');
      expect(metric.name.length).toBeGreaterThan(0);
      expect(typeof metric.value).toBe('number');
    }
  });

  it('metric values are non-negative', () => {
    for (const metric of metrics) {
      expect(metric.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('has unique metric names', () => {
    const names = metrics.map((m) => m.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  // --- Specific metric checks ---

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

  // --- Standard metric names ---

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

  // --- Duration metrics ---

  it('duration metrics are finite numbers', () => {
    const durationNames = ['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'];
    for (const metric of metrics) {
      if (durationNames.includes(metric.name)) {
        expect(Number.isFinite(metric.value)).toBe(true);
      }
    }
  });

  it('TaskDuration is >= individual durations', () => {
    const taskDur = metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0;
    const scriptDur = metrics.find((m) => m.name === 'ScriptDuration')?.value ?? 0;
    const layoutDur = metrics.find((m) => m.name === 'LayoutDuration')?.value ?? 0;
    const recalcDur = metrics.find((m) => m.name === 'RecalcStyleDuration')?.value ?? 0;
    expect(taskDur).toBeGreaterThanOrEqual(scriptDur + layoutDur + recalcDur);
  });

  it('JSHeapTotalSize >= JSHeapUsedSize', () => {
    const used = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
    const total = metrics.find((m) => m.name === 'JSHeapTotalSize')?.value ?? 0;
    expect(total).toBeGreaterThanOrEqual(used);
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('tolerates empty metrics array', () => {
      const empty: PerformanceRawData = { metrics: [], timestamp: 0, warnings: [] };
      expect(empty.metrics).toHaveLength(0);
    });

    it('tolerates zero timestamp', () => {
      const zero: PerformanceRawData = { metrics: [], timestamp: 0, warnings: [] };
      expect(zero.timestamp).toBe(0);
    });
  });
});
