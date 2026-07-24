/**
 * Trace data ingestion tests.
 *
 * Validates that trace fixtures can be loaded and contain the expected
 * structure. These tests run without a browser — they use saved JSON
 * fixtures only.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import type { TraceRawData, TraceEvent } from '../src/collect/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load a JSON fixture by relative path from the test directory */
function loadFixture(relativePath: string): unknown {
  const fullPath = resolve(__dirname, relativePath);
  const raw = readFileSync(fullPath, 'utf-8');
  return JSON.parse(raw);
}

describe('Trace fixture ingestion', () => {
  let fixture: TraceRawData;
  let events: TraceEvent[];

  beforeAll(() => {
    const data = loadFixture('./fixtures/trace/minimal-valid.json');
    fixture = data as TraceRawData;
    events = fixture.events ?? [];
  });

  it('loads fixture without throwing', () => {
    expect(fixture).toBeDefined();
  });

  it('has a non-empty events array', () => {
    expect(events.length).toBeGreaterThan(0);
  });

  it('has metadata with categories, totalEvents, and dataCollectedCount', () => {
    expect(fixture.metadata).toBeDefined();
    expect(fixture.metadata.categories).toBeInstanceOf(Array);
    expect(fixture.metadata.categories.length).toBeGreaterThan(0);
    expect(typeof fixture.metadata.totalEvents).toBe('number');
    expect(fixture.metadata.totalEvents).toBe(events.length);
    expect(typeof fixture.metadata.dataCollectedCount).toBe('number');
  });

  it('has warnings array', () => {
    expect(fixture.warnings).toBeInstanceOf(Array);
  });

  it('every event has required fields (cat, name, ph, ts, pid, tid)', () => {
    for (const event of events) {
      expect(typeof event.cat).toBe('string');
      expect(event.cat.length).toBeGreaterThan(0);

      expect(typeof event.name).toBe('string');
      expect(event.name.length).toBeGreaterThan(0);

      expect(typeof event.ph).toBe('string');
      expect(event.ph.length).toBeGreaterThan(0);

      expect(typeof event.ts).toBe('number');
      expect(event.ts).toBeGreaterThan(0);

      expect(typeof event.pid).toBe('number');
      expect(typeof event.tid).toBe('number');
    }
  });

  it('contains at least one navigation-related event', () => {
    const navEvent = events.find(
      (e) =>
        e.name.toLowerCase().includes('navigation') ||
        e.cat.includes('user_timing'),
    );
    expect(navEvent).toBeDefined();
  });

  it('contains at least one paint or FCP event', () => {
    const paintEvent = events.find(
      (e) =>
        e.name.toLowerCase().includes('paint') ||
        e.name === 'firstContentfulPaint',
    );
    expect(paintEvent).toBeDefined();
  });

  it('events from the same process have monotonically non-decreasing timestamps', () => {
    // Group by pid
    const byPid = new Map<number, TraceEvent[]>();
    for (const event of events) {
      const group = byPid.get(event.pid) ?? [];
      group.push(event);
      byPid.set(event.pid, group);
    }

    for (const [, pidEvents] of byPid) {
      for (let i = 1; i < pidEvents.length; i++) {
        expect(pidEvents[i]!.ts).toBeGreaterThanOrEqual(pidEvents[i - 1]!.ts);
      }
    }
  });

  it('contains the expected critical trace events', () => {
    const eventNames = new Set(events.map((e) => e.name));
    expect(eventNames.has('navigationStart')).toBe(true);
    expect(eventNames.has('firstContentfulPaint')).toBe(true);
    expect(eventNames.has('firstPaint')).toBe(true);
    expect(eventNames.has('LargestContentfulPaint')).toBe(true);
  });

  it('metadata totalEvents matches actual event count', () => {
    expect(fixture.metadata.totalEvents).toBe(events.length);
  });
});
