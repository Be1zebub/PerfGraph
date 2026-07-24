/**
 * NetworkIR builder tests.
 *
 * Validates that the network intermediate representation is built
 * correctly from raw CDP network data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFixture } from '../setup.js';
import { buildNetworkIR } from '../../src/normalize/network-ir.js';
import { NetworkIRSchema } from '../../src/normalize/types.js';
import type { NetworkRawData } from '../../src/collect/types.js';
import type { NetworkIR } from '../../src/normalize/types.js';
import type { ClockAnchor } from '../../src/normalize/clock.js';

describe('NetworkIR builder', () => {
  // Anchor with zero offsets so requestTime * 1000 = startTime in ms
  const anchor: ClockAnchor = { navigationStart: 0, firstRequestWallTime: 0 };

  // -----------------------------------------------------------------------
  // Test 1: builds NetworkIR from minimal valid fixture
  // -----------------------------------------------------------------------
  describe('from minimal-valid fixture', () => {
    let ir: NetworkIR;
    let expected: NetworkIR;

    beforeAll(() => {
      const network = loadFixture(
        'fixtures',
        'network',
        'minimal-valid.json',
      ) as NetworkRawData;
      expected = loadFixture(
        'fixtures',
        'ir',
        'network-ir-expected.json',
      ) as NetworkIR;
      ir = buildNetworkIR(network, anchor);
    });

    it('builds NetworkIR from minimal valid fixtures', () => {
      expect(ir).toBeDefined();
      expect(ir.requests).toHaveLength(3);
      expect(ir.summary).toBeDefined();
    });

    it('output passes Zod safeParse validation', () => {
      const result = NetworkIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });

    it('request startTime/endTime are finite numbers', () => {
      for (const req of ir.requests) {
        expect(Number.isFinite(req.startTime)).toBe(true);
        expect(Number.isFinite(req.endTime)).toBe(true);
      }
    });

    it('timing fields map correctly', () => {
      // First request has dns/connect/ssl — only one with non-negative values
      const docReq = ir.requests[0]!;
      expect(docReq.timing.dns).toBeCloseTo(0.7);
      expect(docReq.timing.connect).toBeCloseTo(1.3);
      expect(docReq.timing.ssl).toBeCloseTo(0.8);
      expect(docReq.timing.wait).toBeCloseTo(0.2);
      expect(docReq.timing.receive).toBeCloseTo(7.7);

      // Second request has dnsStart=-1 → no dns/connect/ssl
      const cssReq = ir.requests[1]!;
      expect(cssReq.timing.dns).toBeUndefined();
      expect(cssReq.timing.connect).toBeUndefined();
      expect(cssReq.timing.ssl).toBeUndefined();
      expect(cssReq.timing.wait).toBeCloseTo(0.05);
      expect(cssReq.timing.receive).toBeCloseTo(5.05);
    });

    it('summary.totalRequests matches input count (3)', () => {
      expect(ir.summary.totalRequests).toBe(3);
    });

    it('criticalPath has tree root and depth', () => {
      expect(ir.summary.criticalPath.tree.url).toBe('https://example.com/');
      expect(ir.summary.criticalPath.tree.durationMs).toBeCloseTo(10.5, 4);
      expect(ir.summary.criticalPath.depth).toBe(2);
      expect(ir.summary.criticalPath.urlsOnLongestPath).toHaveLength(2);
      expect(ir.summary.criticalPath.urlsOnLongestPath[0]).toBe(
        'https://example.com/',
      );
    });

    it('output matches expected values', () => {
      // Compare requests individually
      // Use toBeCloseTo for floating-point fields to handle IEEE 754 precision
      for (let i = 0; i < ir.requests.length; i++) {
        expect(ir.requests[i]!.url).toBe(expected.requests[i]!.url);
        expect(ir.requests[i]!.method).toBe(expected.requests[i]!.method);
        expect(ir.requests[i]!.resourceType).toBe(
          expected.requests[i]!.resourceType,
        );
        expect(ir.requests[i]!.statusCode).toBe(
          expected.requests[i]!.statusCode,
        );
        expect(ir.requests[i]!.startTime).toBeCloseTo(
          expected.requests[i]!.startTime,
          4,
        );
        expect(ir.requests[i]!.endTime).toBeCloseTo(
          expected.requests[i]!.endTime,
          4,
        );
        expect(ir.requests[i]!.duration).toBeCloseTo(
          expected.requests[i]!.duration,
          4,
        );
        expect(ir.requests[i]!.bytes).toBe(expected.requests[i]!.bytes);
        expect(ir.requests[i]!.priority).toBe(
          expected.requests[i]!.priority,
        );
        expect(ir.requests[i]!.initiator).toBe(
          expected.requests[i]!.initiator,
        );
        expect(ir.requests[i]!.initiatorUrl).toBe(
          expected.requests[i]!.initiatorUrl,
        );
        expect(ir.requests[i]!.failed).toBe(expected.requests[i]!.failed);
      }

      // Compare summary
      expect(ir.summary.totalRequests).toBe(expected.summary.totalRequests);
      expect(ir.summary.totalBytes).toBe(expected.summary.totalBytes);
      expect(ir.summary.byType).toEqual(expected.summary.byType);
      expect(ir.summary.byPriority).toEqual(expected.summary.byPriority);
      expect(ir.summary.criticalPath.tree.url).toBe(
        expected.summary.criticalPath.tree.url,
      );
      expect(ir.summary.criticalPath.depth).toBe(
        expected.summary.criticalPath.depth,
      );
      expect(ir.summary.longestChain.url).toBe(
        expected.summary.longestChain.url,
      );
      expect(ir.summary.longestChain.length).toBeCloseTo(
        expected.summary.longestChain.length,
        4,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: empty requests produces zeroed summary
  // -----------------------------------------------------------------------
  describe('handles empty requests', () => {
    let ir: NetworkIR;

    beforeAll(() => {
      const empty: NetworkRawData = {
        requests: [],
        metadata: {
          totalRequests: 0,
          totalFailed: 0,
          totalBytes: 0,
          startTime: 0,
          endTime: 0,
        },
        warnings: [],
      };
      ir = buildNetworkIR(empty, anchor);
    });

    it('returns zero counts and zeroed summary', () => {
      expect(ir.requests).toHaveLength(0);
      expect(ir.summary.totalRequests).toBe(0);
      expect(ir.summary.totalBytes).toBe(0);
      expect(ir.summary.byType).toEqual({});
      expect(ir.summary.byPriority).toEqual({});
      expect(ir.summary.criticalPath).toEqual({
        tree: { url: '' },
        depth: 0,
        urlsOnLongestPath: [],
      });
      expect(ir.summary.longestChain).toEqual({ url: '', length: 0 });
    });

    it('output passes Zod safeParse validation', () => {
      const result = NetworkIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: failed request with errorText is marked failed: true
  // -----------------------------------------------------------------------
  describe('failed request marking', () => {
    let ir: NetworkIR;

    beforeAll(() => {
      const withFailure: NetworkRawData = {
        requests: [
          {
            requestId: 'FAILED_REQ',
            url: 'https://example.com/fail.js',
            method: 'GET',
            type: 'Script',
            request: {
              headers: {},
              initialPriority: 'Low',
            },
            response: {
              status: 0,
              statusText: '',
              headers: {},
              mimeType: '',
              encodedDataLength: 0,
            },
            failed: true,
            errorText: 'net::ERR_CONNECTION_RESET',
            initiator: { type: 'other' },
            timestamp: 1000,
            wallTime: 1700000000,
          },
        ],
        metadata: {
          totalRequests: 1,
          totalFailed: 1,
          totalBytes: 0,
          startTime: 1000,
          endTime: 1010,
        },
        warnings: [],
      };
      ir = buildNetworkIR(withFailure, anchor);
    });

    it('failed request is marked failed: true', () => {
      expect(ir.requests[0]!.failed).toBe(true);
    });

    it('output passes Zod safeParse validation', () => {
      const result = NetworkIRSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });
  });
});
