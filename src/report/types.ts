/**
 * Report types — Zod schemas and TypeScript types for Phase 5.
 *
 * The Report is the final output of PerfGraph: a self-contained JSON document
 * designed for AI consumption. It combines the CausalGraph with remediations,
 * severity scoring, and correlated FeatureSet data.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { EvidenceSchema } from '../causal/types.js';

// ---------------------------------------------------------------------------
// ReportMeta
// ---------------------------------------------------------------------------

export const ReportMetaSchema = z.object({
  /** Target URL that was analyzed */
  url: z.string(),
  /** ISO 8601 timestamp */
  analyzedAt: z.string(),
  /** Semantic version of the report format */
  reportVersion: z.string(),
  /** Number of features that were present in the input */
  featureCount: z.number().nonnegative(),
  /** Number of nodes in the causal graph */
  graphNodeCount: z.number().nonnegative(),
  /** Number of edges in the causal graph */
  graphEdgeCount: z.number().nonnegative(),
  /** Number of causal rules evaluated */
  ruleCount: z.number().nonnegative(),
});
export type ReportMeta = z.infer<typeof ReportMetaSchema>;

// ---------------------------------------------------------------------------
// ReportSummary
// ---------------------------------------------------------------------------

export const ReportScoreSchema = z.enum(['good', 'moderate', 'poor']);
export type ReportScore = z.infer<typeof ReportScoreSchema>;

export const TopIssueSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  severity: z.string(),
  confidence: z.string(),
});
export type TopIssue = z.infer<typeof TopIssueSchema>;

export const ReportSummarySchema = z.object({
  /** Overall performance score */
  score: ReportScoreSchema,
  /** Count of critical-severity issues */
  criticalIssues: z.number().nonnegative(),
  /** Count of warning-severity issues */
  warnings: z.number().nonnegative(),
  /** Count of info-severity issues */
  infos: z.number().nonnegative(),
  /** Top 3-5 most important issues */
  topIssues: z.array(TopIssueSchema),
  /** Optional Lighthouse performance score (0–1) */
  lighthousePerformance: z.number().optional(),
  /** Optional explanation when Lighthouse data influenced the score */
  scoreExplanation: z.string().optional(),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

// ---------------------------------------------------------------------------
// ReportIssue — a single detected problem with remediation
// ---------------------------------------------------------------------------

export const ReportIssueSchema = z.object({
  /** Unique issue identifier (matches CausalNode.id) */
  id: z.string().min(1),
  /** Human-readable label */
  label: z.string().min(1),
  /** Node type: metric, bottleneck, or impact */
  type: z.string(),
  /** Severity level */
  severity: z.string(),
  /** Raw metric value if applicable */
  value: z.number().optional(),
  /** Unit label if applicable */
  unit: z.string().optional(),
  /** Threshold that was exceeded if applicable */
  threshold: z.number().optional(),
  /** Confidence of the causal link leading to this issue */
  confidence: z.string(),
  /** Human-readable remediation recommendation */
  remediation: z.string(),
  /** ID of the causal chain this issue belongs to */
  chainId: z.string(),
  /** Evidence payload from the causal node */
  evidence: EvidenceSchema.optional(),
});
export type ReportIssue = z.infer<typeof ReportIssueSchema>;

// ---------------------------------------------------------------------------
// CausalChain — a causal path from root cause to impact
// ---------------------------------------------------------------------------

export const ChainNodeSchema = z.object({
  nodeId: z.string().min(1),
  label: z.string().min(1),
  type: z.string(),
  severity: z.string().optional(),
});
export type ChainNode = z.infer<typeof ChainNodeSchema>;

export const CausalChainSchema = z.object({
  /** Unique chain identifier (derived from ruleId) */
  id: z.string().min(1),
  /** Label of the root cause node */
  rootCause: z.string(),
  /** Label of the terminal impact node */
  impact: z.string(),
  /** Overall confidence of the chain */
  confidence: z.string(),
  /** Highest severity in the chain */
  severity: z.string(),
  /** Ordered path from root to impact */
  path: z.array(ChainNodeSchema),
  /** Number of nodes in the path */
  length: z.number().positive(),
});
export type CausalChain = z.infer<typeof CausalChainSchema>;

// ---------------------------------------------------------------------------
// Recommendation — prioritized action item
// ---------------------------------------------------------------------------

export const RecommendationPrioritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
]);
export type RecommendationPriority = z.infer<
  typeof RecommendationPrioritySchema
>;

export const RecommendationSchema = z.object({
  /** Priority level */
  priority: RecommendationPrioritySchema,
  /** Category (e.g. "LCP", "JavaScript", "Network", "Layout") */
  category: z.string(),
  /** Short actionable title */
  title: z.string().min(1),
  /** Detailed description */
  description: z.string(),
  /** Concrete action steps */
  action: z.string(),
  /** Expected positive impact */
  expectedImpact: z.string(),
  /** IDs of related issues */
  relatedIssues: z.array(z.string()),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

// ---------------------------------------------------------------------------
// Full Report
// ---------------------------------------------------------------------------

export const ReportSchema = z.object({
  meta: ReportMetaSchema,
  summary: ReportSummarySchema,
  /** All detected issues, sorted by severity (critical first) */
  issues: z.array(ReportIssueSchema),
  /** Causal chains from root causes to impacts */
  chains: z.array(CausalChainSchema),
  /** Prioritized action recommendations */
  recommendations: z.array(RecommendationSchema),
  /** Raw FeatureSet for AI cross-referencing (passthrough) */
  features: z.unknown(),
});
export type Report = z.infer<typeof ReportSchema>;
