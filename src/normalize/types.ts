/**
 * IR (Intermediate Representation) Zod schemas and inferred TypeScript types.
 *
 * All IR types use relative timestamps (ms since navigationStart) for
 * consistent downstream analysis regardless of the original clock domain.
 *
 * Every schema has a corresponding inferred type exported for use in
 * function signatures and property access without manual type annotations.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Performance IR
// ---------------------------------------------------------------------------

export const PerformanceNavigationSchema = z.object({
  url: z.string(),
  navigationStart: z.number(),
  domContentLoaded: z.number(),
  domContentLoadedEventEnd: z.number(),
  loadEventStart: z.number(),
  loadEventEnd: z.number(),
  domInteractive: z.number(),
  title: z.string().optional(),
});

export const CoreWebVitalsSchema = z.object({
  fcp: z.number().optional(),
  lcp: z.number().optional(),
  cls: z.number().optional(),
  tbt: z.number().optional(),
  inp: z.number().optional(),
});

export const ThreadActivitySchema = z.object({
  totalMs: z.number(),
  byCategory: z.record(z.string(), z.number()),
});

export const TraceSummarySchema = z.object({
  totalDuration: z.number(),
  eventCount: z.number(),
  categories: z.record(z.string(), z.number()),
  threadActivity: ThreadActivitySchema,
});

export const PerformanceIRSchema = z.object({
  navigation: PerformanceNavigationSchema,
  coreWebVitals: CoreWebVitalsSchema,
  traceSummary: TraceSummarySchema,
  mainThreadBusyness: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// Network IR
// ---------------------------------------------------------------------------

export const NormalizedRequestTimingSchema = z.object({
  dns: z.number().optional(),
  connect: z.number().optional(),
  ssl: z.number().optional(),
  wait: z.number().optional(),
  receive: z.number().optional(),
});

export const NormalizedRequestSchema = z.object({
  url: z.string(),
  method: z.string(),
  resourceType: z.string(),
  statusCode: z.number().int(),
  startTime: z.number(),
  endTime: z.number(),
  duration: z.number(),
  bytes: z.number(),
  priority: z.string(),
  initiator: z.string(),
  initiatorUrl: z.string().optional(),
  failed: z.boolean(),
  timing: NormalizedRequestTimingSchema,
});

export const NormalizedRequestChainSchema = z.object({
  url: z.string(),
  length: z.number(),
});

export const CriticalPathTreeNodeSchema: z.ZodType<CriticalPathTreeNode> = z.lazy(() =>
  z.object({
    url: z.string(),
    durationMs: z.number().optional(),
    children: z.array(CriticalPathTreeNodeSchema).optional(),
  })
);

export interface CriticalPathTreeNode {
  url: string;
  durationMs?: number;
  children?: CriticalPathTreeNode[];
}

export const CriticalPathInfoSchema = z.object({
  tree: CriticalPathTreeNodeSchema,
  depth: z.number().int().nonnegative(),
  urlsOnLongestPath: z.array(z.string()),
});

export const NetworkIRSummarySchema = z.object({
  totalRequests: z.number(),
  totalBytes: z.number(),
  byType: z.record(z.string(), z.number()),
  byPriority: z.record(z.string(), z.number()),
  criticalPath: CriticalPathInfoSchema,
  longestChain: NormalizedRequestChainSchema,
});

export const NetworkIRSchema = z.object({
  requests: z.array(NormalizedRequestSchema),
  summary: NetworkIRSummarySchema,
});

// ---------------------------------------------------------------------------
// Runtime IR
// ---------------------------------------------------------------------------

export const RuntimeIRStatsSchema = z.object({
  totalJSHeapSize: z.number().optional(),
  usedJSHeapSize: z.number().optional(),
  jsHeapSizeLimit: z.number().optional(),
});

export const ExecutionContextSchema = z.object({
  id: z.number(),
  origin: z.string(),
  name: z.string().optional(),
});

export const EventLoopStatsSchema = z.object({
  totalBlockingDuration: z.number(),
  longTasks: z.number(),
  maxBlockingDuration: z.number(),
});

export const HydrationCostSchema = z.object({
  bootupTime: z.number(),
  evaluatedScripts: z.number(),
});

export const RuntimeIRSchema = z.object({
  jsHeapStats: RuntimeIRStatsSchema.optional(),
  executionContexts: z.array(ExecutionContextSchema),
  eventLoopStats: EventLoopStatsSchema.optional(),
  hydrationCost: HydrationCostSchema.optional(),
});

// ---------------------------------------------------------------------------
// DOM IR
// ---------------------------------------------------------------------------

export const DOMStatsSchema = z.object({
  totalNodes: z.number(),
  elementCount: z.number(),
  maxDepth: z.number(),
  maxChildren: z.number(),
});

export const TagCountSchema = z.object({
  tag: z.string(),
  count: z.number(),
});

export const LayoutShiftCandidatesSchema = z.object({
  highComplexitySubtrees: z.number(),
  deepNesting: z.number(),
});

export const DOMIRSchema = z.object({
  stats: DOMStatsSchema,
  tagDistribution: z.array(TagCountSchema),
  layoutShiftCandidates: LayoutShiftCandidatesSchema,
});

// ---------------------------------------------------------------------------
// Lighthouse IR
// ---------------------------------------------------------------------------

export const LighthouseCategorySchema = z.object({
  title: z.string(),
  score: z.number().min(0).max(1),
});

export const LighthouseFailedAuditSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  score: z.number(),
  numericValue: z.number().optional(),
});

export const LighthouseScoresSchema = z.object({
  performance: z.number().min(0).max(1).optional(),
  accessibility: z.number().min(0).max(1).optional(),
  bestPractices: z.number().min(0).max(1).optional(),
  seo: z.number().min(0).max(1).optional(),
});

export const RenderBlockingResourceSchema = z.object({
  url: z.string(),
  totalBytes: z.number().optional(),
  wastedMs: z.number().optional(),
  resourceType: z.string().optional(),
});

export const RenderBlockingInsightSchema = z.object({
  fcpSavingsMs: z.number().optional(),
  lcpSavingsMs: z.number().optional(),
  resources: z.array(RenderBlockingResourceSchema),
});

export const LighthouseIRSchema = z.object({
  categories: z.record(z.string(), LighthouseCategorySchema),
  failedAudits: z.array(LighthouseFailedAuditSchema),
  scores: LighthouseScoresSchema,
  /** Lighthouse LCP numeric value in ms (fallback when trace lacks LCP) */
  lcpNumericValue: z.number().optional(),
  /** LCP element selector from lcp-breakdown-insight */
  lcpElementSelector: z.string().optional(),
  /** LCP element snippet from lcp-breakdown-insight */
  lcpElementSnippet: z.string().optional(),
  /** LCP element node label from lcp-breakdown-insight */
  lcpElementNodeLabel: z.string().optional(),
  /** Render-blocking resources with URL, bytes, and wasted ms */
  renderBlockingResources: z.array(RenderBlockingResourceSchema).optional(),
});

// ---------------------------------------------------------------------------
// Lighthouse Insights (v13+ insight audits)
// ---------------------------------------------------------------------------

export const LCPBreakdownInsightSchema = z.object({
  timeToFirstByte: z.number(),
  resourceLoadDelay: z.number().optional(),
  resourceLoadTime: z.number().optional(),
  elementRenderDelay: z.number(),
  lcpElementSelector: z.string().optional(),
  lcpElementSnippet: z.string().optional(),
  lcpElementNodeLabel: z.string().optional(),
  source: z.enum(['trace', 'lighthouse', 'mixed']),
});

export const NetworkChainNodeSchema: z.ZodType<NetworkChainNode> = z.lazy(() =>
  z.object({
    url: z.string(),
    navStartToEndTime: z.number(),
    transferSize: z.number().optional(),
    isLongest: z.boolean().optional(),
    children: z.record(z.string(), NetworkChainNodeSchema).optional(),
  })
);

export interface NetworkChainNode {
  url: string;
  navStartToEndTime: number;
  transferSize?: number;
  isLongest?: boolean;
  children?: Record<string, NetworkChainNode>;
}

export const NetworkDependencyTreeInsightSchema = z.object({
  chains: z.record(z.string(), NetworkChainNodeSchema).optional(),
  longestChainDuration: z.number().optional(),
  longestChainUrls: z.array(z.string()).optional(),
  preconnectCandidates: z.array(z.string()).optional(),
});

export const LighthouseInsightsSchema = z.object({
  lcpBreakdown: LCPBreakdownInsightSchema.optional(),
  renderBlocking: RenderBlockingInsightSchema.optional(),
  networkDependencyTree: NetworkDependencyTreeInsightSchema.optional(),
});

// ---------------------------------------------------------------------------
// IR Bundle
// ---------------------------------------------------------------------------

export const IRMetaSchema = z.object({
  url: z.string(),
  fetchedAt: z.string(),
  navigationStart: z.number(),
  irVersion: z.literal('1.0.0'),
});

export const IRBundleSchema = z.strictObject({
  meta: IRMetaSchema,
  performance: PerformanceIRSchema,
  network: NetworkIRSchema,
  runtime: RuntimeIRSchema,
  dom: DOMIRSchema,
  lighthouse: LighthouseIRSchema,
});

// ---------------------------------------------------------------------------
// Inferred TypeScript Types
// ---------------------------------------------------------------------------

export type PerformanceNavigation = z.infer<typeof PerformanceNavigationSchema>;
export type CoreWebVitals = z.infer<typeof CoreWebVitalsSchema>;
export type ThreadActivity = z.infer<typeof ThreadActivitySchema>;
export type TraceSummary = z.infer<typeof TraceSummarySchema>;
export type PerformanceIR = z.infer<typeof PerformanceIRSchema>;

export type NormalizedRequestTiming = z.infer<typeof NormalizedRequestTimingSchema>;
export type NormalizedRequest = z.infer<typeof NormalizedRequestSchema>;
export type NormalizedRequestChain = z.infer<typeof NormalizedRequestChainSchema>;
export type CriticalPathInfo = z.infer<typeof CriticalPathInfoSchema>;
export type NetworkIRSummary = z.infer<typeof NetworkIRSummarySchema>;
export type NetworkIR = z.infer<typeof NetworkIRSchema>;

export type RuntimeIRStats = z.infer<typeof RuntimeIRStatsSchema>;
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;
export type EventLoopStats = z.infer<typeof EventLoopStatsSchema>;
export type HydrationCost = z.infer<typeof HydrationCostSchema>;
export type RuntimeIR = z.infer<typeof RuntimeIRSchema>;

export type DOMStats = z.infer<typeof DOMStatsSchema>;
export type TagCount = z.infer<typeof TagCountSchema>;
export type LayoutShiftCandidates = z.infer<typeof LayoutShiftCandidatesSchema>;
export type DOMIR = z.infer<typeof DOMIRSchema>;

export type LighthouseCategory = z.infer<typeof LighthouseCategorySchema>;
export type LighthouseFailedAudit = z.infer<typeof LighthouseFailedAuditSchema>;
export type LighthouseScores = z.infer<typeof LighthouseScoresSchema>;
export type LighthouseIR = z.infer<typeof LighthouseIRSchema>;

export type LCPBreakdownInsight = z.infer<typeof LCPBreakdownInsightSchema>;
export type RenderBlockingResource = z.infer<typeof RenderBlockingResourceSchema>;
export type RenderBlockingInsight = z.infer<typeof RenderBlockingInsightSchema>;
export type NetworkDependencyTreeInsight = z.infer<typeof NetworkDependencyTreeInsightSchema>;
export type LighthouseInsights = z.infer<typeof LighthouseInsightsSchema>;

export type IRMeta = z.infer<typeof IRMetaSchema>;
export type IRBundle = z.infer<typeof IRBundleSchema>;
