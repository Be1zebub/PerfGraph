/**
 * Network data ingestion tests.
 *
 * Validates that network fixtures can be loaded and contain the expected
 * structure. These tests run without a browser — they use saved JSON
 * fixtures only.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import type { NetworkRawData, NetworkRequestEntry } from '../src/collect/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load a JSON fixture by relative path from the test directory */
function loadFixture(relativePath: string): unknown {
  const fullPath = resolve(__dirname, relativePath);
  const raw = readFileSync(fullPath, 'utf-8');
  return JSON.parse(raw);
}

describe('Network fixture ingestion', () => {
  let fixture: NetworkRawData;
  let requests: NetworkRequestEntry[];

  beforeAll(() => {
    const data = loadFixture('./fixtures/network/minimal-valid.json');
    fixture = data as NetworkRawData;
    requests = fixture.requests ?? [];
  });

  it('loads fixture without throwing', () => {
    expect(fixture).toBeDefined();
  });

  it('has a non-empty requests array', () => {
    expect(requests.length).toBeGreaterThan(0);
  });

  it('has metadata with totalRequests, totalFailed, totalBytes, startTime, endTime', () => {
    expect(fixture.metadata).toBeDefined();
    expect(typeof fixture.metadata.totalRequests).toBe('number');
    expect(typeof fixture.metadata.totalFailed).toBe('number');
    expect(typeof fixture.metadata.totalBytes).toBe('number');
    expect(typeof fixture.metadata.startTime).toBe('number');
    expect(typeof fixture.metadata.endTime).toBe('number');
    expect(fixture.metadata.totalRequests).toBe(requests.length);
    expect(fixture.metadata.startTime).toBeLessThan(fixture.metadata.endTime);
  });

  it('has warnings array', () => {
    expect(fixture.warnings).toBeInstanceOf(Array);
  });

  it('every request has required fields (requestId, url, method, request, timestamp)', () => {
    for (const req of requests) {
      expect(typeof req.requestId).toBe('string');
      expect(req.requestId.length).toBeGreaterThan(0);

      expect(typeof req.url).toBe('string');
      expect(req.url.length).toBeGreaterThan(0);

      expect(typeof req.method).toBe('string');
      expect(req.method.length).toBeGreaterThan(0);

      expect(req.request).toBeDefined();
      expect(req.request.headers).toBeDefined();

      expect(typeof req.timestamp).toBe('number');
      expect(req.timestamp).toBeGreaterThan(0);
    }
  });

  it('contains at least one Document-type request', () => {
    const docRequest = requests.find((r) => r.type === 'Document');
    expect(docRequest).toBeDefined();
  });

  it('completed requests have response with status and timing', () => {
    for (const req of requests) {
      expect(req.response).toBeDefined();
      expect(typeof req.response!.status).toBe('number');
      expect(req.response!.status).toBeGreaterThanOrEqual(200);
      expect(req.response!.status).toBeLessThan(600);

      // Timing should be present for non-cached requests
      if (!req.fromCache && !req.response!.fromDiskCache) {
        expect(req.response!.timing).toBeDefined();
        if (req.response!.timing) {
          expect(typeof req.response!.timing.requestTime).toBe('number');
        }
      }
    }
  });

  it('requests have correct metadata count', () => {
    expect(fixture.metadata.totalRequests).toBe(requests.length);
  });

  it('requests maintain chronological order in fixture', () => {
    for (let i = 1; i < requests.length; i++) {
      expect(requests[i]!.timestamp).toBeGreaterThanOrEqual(requests[i - 1]!.timestamp);
    }
  });

  it('has initiator info on requests', () => {
    const initiatorRequests = requests.filter((r) => r.initiator);
    expect(initiatorRequests.length).toBeGreaterThan(0);
    for (const req of initiatorRequests) {
      expect(typeof req.initiator!.type).toBe('string');
      expect(req.initiator!.type.length).toBeGreaterThan(0);
    }
  });

  it('has wallTime on requests', () => {
    for (const req of requests) {
      expect(typeof req.wallTime).toBe('number');
    }
  });
});
