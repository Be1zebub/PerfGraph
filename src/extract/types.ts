/**
 * FeatureSet Zod schemas and inferred TypeScript types.
 *
 * FeatureSet — результат feature extraction из IRBundle.
 * Каждая фича опциональна (undefined если данных недостаточно).
 * Все функции extraction детерминированы: одинаковый IRBundle → одинаковый FeatureSet.
 */

import { z } from 'zod';
import { RunContextSchema } from '../normalize/types.js';

// ---------------------------------------------------------------------------
// LCP Breakdown (FEA-01)
// ---------------------------------------------------------------------------

export const LCPBreakdownSchema = z.object({
  ttfb: z.number(),
  resourceLoadDelay: z.number(),
  resourceLoadTime: z.number(),
  elementRenderDelay: z.number(),
  totalLCP: z.number(),
  lcpElementUrl: z.string().optional(),
  lcpResourceType: z.string().optional(),
  lcpElement: z.object({
    selector: z.string().optional(),
    snippet: z.string().optional(),
    nodeLabel: z.string().optional(),
    source: z.enum(['trace', 'performance-api', 'lighthouse']).optional(),
    type: z.enum(['text', 'image', 'unknown']).optional(),
  }).optional(),
  source: z.enum(['trace', 'lighthouse', 'mixed']).optional(),
});

// ---------------------------------------------------------------------------
// Critical Path Length (FEA-03)
// ---------------------------------------------------------------------------

export const CriticalPathSchema = z.object({
  /** Sum of durations for all matched requests in the dependency tree. */
  totalChainLength: z.number(),
  /** Longest root-to-leaf dependency path; not a sum of parallel branches. */
  elapsedCriticalPathMs: z.number(),
  /** Aggregate request duration across the tree; parallel work is intentionally included. */
  aggregateRequestDurationMs: z.number(),
  /** Observed page/network lifecycle span when available. */
  pageLifecycleMs: z.number().optional(),
  requestCount: z.number(),
  blockingCount: z.number(),
  nonBlockingCount: z.number(),
  deepestChainDepth: z.number(),
  longestSingleRequest: z.number(),
  /** URLs on the longest critical path chain */
  urlsOnLongestPath: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Main Thread Blocking (FEA-05)
// ---------------------------------------------------------------------------

export const MainThreadBlockingSchema = z.object({
  blockingScore: z.number().min(0).max(1),
  busyMs: z.number(),
  /** Measured Total Blocking Time, when available from the performance IR. */
  tbtMs: z.number().optional(),
  tbtStatus: z.enum(['measured', 'unavailable']),
  busyStatus: z.literal('measured'),
  idleMs: z.number(),
  blockingRatio: z.number().min(0).max(1),
  categories: z.record(z.string(), z.number()),
});

// ---------------------------------------------------------------------------
// JS Hotspots (FEA-06)
// ---------------------------------------------------------------------------

export const JSHotspotsSchema = z.object({
  bootupTime: z.number(),
  evaluatedScripts: z.number(),
  longTaskCount: z.number(),
  maxBlockingDuration: z.number(),
  contextCount: z.number(),
});

// ---------------------------------------------------------------------------
// Layout Shifts (FEA-07)
// ---------------------------------------------------------------------------

export const LayoutShiftsSchema = z.object({
  cls: z.number().optional(),
  highComplexitySubtreeCount: z.number(),
  deepNesting: z.boolean(),
  clusterScore: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// Third-Party Overhead (FEA-09)
// ---------------------------------------------------------------------------

export const ThirdPartyCategorySchema = z.object({
  requests: z.number(),
  bytes: z.number(),
  duration: z.number(),
});

export const OwnershipCategorySchema = z.enum([
  'first-party',
  'first-party-cdn',
  'third-party-vendor',
  'external-cdn',
  'unknown',
]);

export const ThirdPartyOverheadSchema = z.object({
  totalThirdPartyRequests: z.number(),
  totalThirdPartyBytes: z.number(),
  totalThirdPartyDuration: z.number(),
  firstPartyBytes: z.number(),
  firstPartyRequests: z.number(),
  thirdPartyRatio: z.number().min(0).max(1),
  byCategory: z.record(z.string(), ThirdPartyCategorySchema),
  /** Request ownership buckets, separate from vendor technology categories. */
  byOwnership: z.record(z.string(), ThirdPartyCategorySchema),
});

// ---------------------------------------------------------------------------
// Render-Blocking Score (FEA-08)
// ---------------------------------------------------------------------------

export const RenderBlockingResourceSchema = z.object({
  url: z.string(),
  totalBytes: z.number().optional(),
  wastedMs: z.number().optional(),
  resourceType: z.string().optional(),
});

export const RenderBlockingScoreSchema = z.object({
  blockingRequestCount: z.number(),
  blockingBytes: z.number(),
  blockingDuration: z.number(),
  renderBlockingScore: z.number().min(0).max(1),
  lhRenderBlockingMs: z.number().optional(),
  lcpSavingsMs: z.number().optional(),
  fcpSavingsMs: z.number().optional(),
  resources: z.array(RenderBlockingResourceSchema).optional(),
  totalWastedMs: z.number().optional(),
  networkResourceCount: z.number(),
  lighthouseResourceCount: z.number(),
  sourceConflict: z.boolean(),
  networkResources: z.array(RenderBlockingResourceSchema),
  lighthouseResources: z.array(RenderBlockingResourceSchema),
  networkOnlyCount: z.number(),
  lighthouseOnlyCount: z.number(),
  sourceStatus: z.enum(['measured', 'conflicting']),
});

// ---------------------------------------------------------------------------
// FeatureSet — полный набор вычисленных фич
// ---------------------------------------------------------------------------

export const CoreWebVitalsFeatureSchema = z.object({
  fcp: z.number().optional(),
  lcp: z.number().optional(),
  cls: z.number().optional(),
  tbt: z.number().optional(),
});

export const FeatureSetSchema = z.strictObject({
  /** Target URL that was analyzed */
  url: z.string().optional(),
  runContext: RunContextSchema.optional(),
  /** Core Web Vitals measured in the traced browser run */
  coreWebVitals: CoreWebVitalsFeatureSchema.optional(),
  lcpBreakdown: LCPBreakdownSchema.optional(),
  criticalPath: CriticalPathSchema.optional(),
  mainThreadBlocking: MainThreadBlockingSchema.optional(),
  jsHotspots: JSHotspotsSchema.optional(),
  layoutShifts: LayoutShiftsSchema.optional(),
  thirdPartyOverhead: ThirdPartyOverheadSchema.optional(),
  renderBlocking: RenderBlockingScoreSchema.optional(),
});

export type LCPBreakdown = z.infer<typeof LCPBreakdownSchema>;
export type CriticalPath = z.infer<typeof CriticalPathSchema>;
export type MainThreadBlocking = z.infer<typeof MainThreadBlockingSchema>;
export type JSHotspots = z.infer<typeof JSHotspotsSchema>;
export type LayoutShifts = z.infer<typeof LayoutShiftsSchema>;
export type ThirdPartyCategory = z.infer<typeof ThirdPartyCategorySchema>;
export type OwnershipCategory = z.infer<typeof OwnershipCategorySchema>;
export type ThirdPartyOverhead = z.infer<typeof ThirdPartyOverheadSchema>;
export type RenderBlockingResource = z.infer<typeof RenderBlockingResourceSchema>;
export type RenderBlockingScore = z.infer<typeof RenderBlockingScoreSchema>;
export type FeatureSet = z.infer<typeof FeatureSetSchema>;
