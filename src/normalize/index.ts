/**
 * Normalize orchestrator.
 *
 * Entry point for the normalization pipeline. Takes a RawDataBundle from
 * collection and returns a validated IRBundle with all timestamps in ms
 * relative to navigationStart.
 */

import type { RawDataBundle, RuntimeRawData, ConsoleRawData, DomRawData } from '../collect/types.js';
import type { IRBundle } from './types.js';
import { IRBundleSchema } from './types.js';
import { resolveClockAnchor } from './clock.js';
import { buildPerformanceIR } from './trace-ir.js';
import { buildNetworkIR } from './network-ir.js';
import { buildRuntimeIR } from './runtime-ir.js';
import { buildDOMIR } from './dom-ir.js';
import { buildLighthouseIR } from './lighthouse-ir.js';
import type { PerformanceIR, NetworkIR, RuntimeIR, DOMIR, LighthouseIR, IRMeta } from './types.js';

/**
 * Normalize raw collected data into a validated Intermediate Representation
 * bundle.
 *
 * Builds all domain IRs (performance, network, runtime, DOM, lighthouse)
 * from their respective raw data sources and assembles them into a
 * validated IRBundle.
 *
 * @param raw - Raw data bundle from a single collection run
 * @returns Validated IRBundle
 * @throws {Error} If the assembled bundle fails Zod validation
 */
export function normalize(raw: RawDataBundle): IRBundle {
  // 1. Resolve the clock anchor (navigationStart time)
  const anchor = resolveClockAnchor(raw);

  // 2. Build PerformanceIR from trace + performance data
  const traceData = raw.trace as { events?: unknown[]; metadata?: unknown; warnings?: string[] } | undefined;
  const perfData = raw.performance as { metrics?: unknown[]; timestamp?: number; warnings?: string[] } | undefined;

  const performance: PerformanceIR = (traceData && perfData)
    ? buildPerformanceIR(
        raw.trace as never,
        raw.performance as never,
        anchor,
      )
    : {
        navigation: {
          url: '',
          navigationStart: 0,
          domContentLoaded: 0,
          domContentLoadedEventEnd: 0,
          loadEventStart: 0,
          loadEventEnd: 0,
          domInteractive: 0,
        },
        coreWebVitals: {},
        traceSummary: {
          totalDuration: 0,
          eventCount: 0,
          categories: {},
          threadActivity: { totalMs: 0, byCategory: {} },
        },
        mainThreadBusyness: 0,
      };

  // 3. Build domain IRs
  const network: NetworkIR = raw.network
    ? buildNetworkIR(raw.network as never, anchor)
    : {
        requests: [],
        summary: {
          totalRequests: 0,
          totalBytes: 0,
          byType: {},
          byPriority: {},
          criticalPath: { tree: { url: '' }, depth: 0, urlsOnLongestPath: [] },
          longestChain: { url: '', length: 0 },
        },
      };

  const runtimeRaw = raw.runtime as RuntimeRawData | undefined;
  const consoleRaw = raw.consoleEntries as ConsoleRawData | undefined;
  const runtime: RuntimeIR = runtimeRaw
    ? buildRuntimeIR(
        runtimeRaw,
        consoleRaw ?? { entries: [], counts: { log: 0, warn: 0, error: 0, info: 0, debug: 0, other: 0 }, warnings: [] },
      )
    : { executionContexts: [] };

  const domRaw = raw.dom as DomRawData | undefined;
  const dom: DOMIR = domRaw
    ? buildDOMIR(domRaw)
    : {
        stats: { totalNodes: 0, elementCount: 0, maxDepth: 0, maxChildren: 0 },
        tagDistribution: [],
        layoutShiftCandidates: { highComplexitySubtrees: 0, deepNesting: 0 },
      };

  const lighthouse: LighthouseIR = raw.lighthouse
    ? buildLighthouseIR(raw.lighthouse as never)
    : {
        categories: {},
        failedAudits: [],
        scores: {},
      };

  // 4. Extract URL from the first network request (most reliable source)
  const networkRaw = raw.network as { requests?: Array<{ url: string }> } | undefined;
  const firstRequestUrl = networkRaw?.requests?.[0]?.url
    ?? network.requests[0]?.url
    ?? performance.navigation.url
    ?? '';

  // 5. Assemble IRMeta
  const perfMetrics = perfData?.metrics as Array<{ name: string; value: number }> | undefined;
  const navStartMetric = perfMetrics?.find((m) => m.name === 'NavigationStart');
  const meta: IRMeta = {
    url: firstRequestUrl,
    fetchedAt: new Date().toISOString(),
    navigationStart: navStartMetric?.value ?? 0,
    irVersion: '1.0.0',
  };

  // 6. Build and validate IRBundle
  const bundle: IRBundle = {
    meta,
    performance,
    network,
    runtime,
    dom,
    lighthouse,
  };

  const parseResult = IRBundleSchema.safeParse(bundle);
  if (!parseResult.success) {
    throw new Error(
      `Error: IR validation failed: ${parseResult.error.message}`,
    );
  }

  return parseResult.data;
}
