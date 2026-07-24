/**
 * Enhanced network data ingestion tests.
 *
 * Builds on the existing test/network.test.ts coverage by adding deeper
 * structural validation, edge cases, and type constraint checks.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import type { NetworkRawData, NetworkRequestEntry } from '../../src/collect/types.js';

describe('Network fixture ingestion (enhanced)', () => {
  let fixture: NetworkRawData;
  let requests: NetworkRequestEntry[];

  beforeAll(() => {
    const data = loadFixture('fixtures', 'network', 'minimal-valid.json');
    fixture = data as NetworkRawData;
    requests = fixture.requests ?? [];
  });

  // --- Basic structure (overlaps with existing tests for completeness) ---

  it('loads fixture without throwing', () => {
    expect(fixture).toBeDefined();
  });

  it('has a non-empty requests array', () => {
    expect(requests.length).toBeGreaterThan(0);
  });

  it('has metadata with all expected fields', () => {
    expect(fixture.metadata).toBeDefined();
    expect(typeof fixture.metadata.totalRequests).toBe('number');
    expect(typeof fixture.metadata.totalFailed).toBe('number');
    expect(typeof fixture.metadata.totalBytes).toBe('number');
    expect(typeof fixture.metadata.startTime).toBe('number');
    expect(typeof fixture.metadata.endTime).toBe('number');
  });

  it('has warnings array', () => {
    expect(fixture.warnings).toBeInstanceOf(Array);
  });

  it('metadata counts match actual data', () => {
    expect(fixture.metadata.totalRequests).toBe(requests.length);
    expect(fixture.metadata.totalBytes).toBeGreaterThan(0);
    expect(fixture.metadata.startTime).toBeLessThan(fixture.metadata.endTime);
  });

  it('metadata totalFailed is non-negative and less than or equal to totalRequests', () => {
    expect(fixture.metadata.totalFailed).toBeGreaterThanOrEqual(0);
    expect(fixture.metadata.totalFailed).toBeLessThanOrEqual(fixture.metadata.totalRequests);
  });

  // --- Request-level validation ---

  it('every request has required fields', () => {
    for (const req of requests) {
      expect(typeof req.requestId).toBe('string');
      expect(req.requestId.length).toBeGreaterThan(0);
      expect(typeof req.url).toBe('string');
      expect(req.url.length).toBeGreaterThan(0);
      expect(typeof req.timestamp).toBe('number');
      expect(req.timestamp).toBeGreaterThan(0);
    }
  });

  it('every request has an HTTP method', () => {
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    for (const req of requests) {
      expect(validMethods).toContain(req.method);
    }
  });

  it('every request has a valid resource type', () => {
    const validTypes = [
      'Document', 'Script', 'Stylesheet', 'Image', 'Media', 'Font',
      'XHR', 'Fetch', 'EventSource', 'WebSocket', 'Manifest',
      'Ping', 'CSPViolationReport', 'Preflight', 'Other',
    ];
    for (const req of requests) {
      expect(req.type).toBeDefined();
      expect(validTypes).toContain(req.type);
    }
  });

  it('every request has request object with headers', () => {
    for (const req of requests) {
      expect(req.request).toBeDefined();
      expect(req.request.headers).toBeDefined();
      expect(Object.keys(req.request.headers).length).toBeGreaterThan(0);
    }
  });

  it('all requests have a response with status in valid range', () => {
    for (const req of requests) {
      expect(req.response).toBeDefined();
      expect(typeof req.response!.status).toBe('number');
      expect(req.response!.status).toBeGreaterThanOrEqual(100);
      expect(req.response!.status).toBeLessThan(600);
      expect(req.response!.mimeType).toBeDefined();
      expect(typeof req.response!.encodedDataLength).toBe('number');
    }
  });

  it('requests maintain chronological order in fixture', () => {
    for (let i = 1; i < requests.length; i++) {
      expect(requests[i]!.timestamp).toBeGreaterThanOrEqual(requests[i - 1]!.timestamp);
    }
  });

  it('has wallTime on every request', () => {
    for (const req of requests) {
      expect(typeof req.wallTime).toBe('number');
      expect(req.wallTime).toBeGreaterThan(0);
    }
  });

  it('has initiator with a valid type on every request', () => {
    const validInitiatorTypes = ['parser', 'script', 'preload', 'signedExchange', 'prefetch', 'other'];
    for (const req of requests) {
      expect(req.initiator).toBeDefined();
      expect(validInitiatorTypes).toContain(req.initiator!.type);
    }
  });

  it('initiator URLs, when present, are valid', () => {
    for (const req of requests) {
      if (req.initiator?.url) {
        expect(req.initiator.url.length).toBeGreaterThan(0);
      }
    }
  });

  it('requests with parser initiator have a lineNumber', () => {
    for (const req of requests) {
      if (req.initiator?.type === 'parser') {
        expect(typeof req.initiator!.lineNumber).toBe('number');
      }
    }
  });

  // --- Timing validation ---

  it('non-cached requests have timing with requestTime', () => {
    for (const req of requests) {
      if (!req.fromCache && !req.response!.fromDiskCache) {
        expect(req.response!.timing).toBeDefined();
        expect(typeof req.response!.timing!.requestTime).toBe('number');
        expect(req.response!.timing!.requestTime).toBeGreaterThan(0);
      }
    }
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('tolerates empty requests array', () => {
      const empty: NetworkRawData = {
        requests: [],
        metadata: { totalRequests: 0, totalFailed: 0, totalBytes: 0, startTime: 0, endTime: 0 },
        warnings: [],
      };
      expect(empty.requests).toHaveLength(0);
    });

    it('tolerates missing optional fields on requests', () => {
      const minimal: NetworkRequestEntry = {
        requestId: 'minimal',
        url: 'https://example.com/min',
        method: 'GET',
        request: { headers: { Accept: '*/*' } },
        timestamp: 1000,
      };
      expect(minimal.requestId).toBe('minimal');
      expect(minimal.type).toBeUndefined();
      expect(minimal.response).toBeUndefined();
      expect(minimal.initiator).toBeUndefined();
      expect(minimal.wallTime).toBeUndefined();
    });

    it('tolerates a failed request entry', () => {
      const failed: NetworkRequestEntry = {
        requestId: 'failed_req',
        url: 'https://example.com/fail',
        method: 'GET',
        type: 'XHR',
        request: { headers: {} },
        timestamp: 2000,
        failed: true,
        errorText: 'net::ERR_CONNECTION_TIMED_OUT',
        canceled: false,
      };
      expect(failed.failed).toBe(true);
      expect(failed.errorText).toBeDefined();
    });
  });
});
