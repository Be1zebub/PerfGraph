/**
 * Causal Graph types — Zod schemas and TypeScript types.
 *
 * These define the output of Phase 4: a typed DAG where nodes represent
 * performance signals (metrics, bottlenecks, impacts) and edges represent
 * causal relationships with confidence scores.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** Confidence level for a causal edge */
export const ConfidenceSchema = z.enum(['strong', 'medium', 'weak']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Node severity (user-facing classification) */
export const SeveritySchema = z.enum(['critical', 'warning', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

/** Node role in the causal chain */
export const NodeTypeSchema = z.enum(['metric', 'bottleneck', 'impact']);
export type NodeType = z.infer<typeof NodeTypeSchema>;

// ---------------------------------------------------------------------------
// Evidence — optional payload attached to a causal node
// ---------------------------------------------------------------------------

/** Evidence payload attached to a causal node */
export const EvidenceSchema = z.object({
  /** Affected URLs (e.g. render-blocking resource URLs) */
  urls: z.array(z.string()).optional(),
  /** DOM selector for the LCP element or shift source */
  selector: z.string().optional(),
  /** Lighthouse audit ID for cross-referencing */
  lighthouseAuditId: z.string().optional(),
  /** Key metric (name, value, unit) */
  metric: z
    .object({
      name: z.string(),
      value: z.number(),
      unit: z.string(),
    })
    .optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---------------------------------------------------------------------------
// CausalNode
// ---------------------------------------------------------------------------

export const CausalNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: NodeTypeSchema,
  severity: SeveritySchema.optional(),
  /** Raw metric value (e.g. 3200 for TTFB in ms) */
  value: z.number().optional(),
  /** Unit label (e.g. "ms", "bytes", "score") */
  unit: z.string().optional(),
  /** Threshold that was exceeded */
  threshold: z.number().optional(),
  /** Evidence payload attached to this node */
  evidence: EvidenceSchema.optional(),
});
export type CausalNode = z.infer<typeof CausalNodeSchema>;

// ---------------------------------------------------------------------------
// CausalEdge
// ---------------------------------------------------------------------------

export const CausalEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  confidence: ConfidenceSchema,
  /** Human-readable label for this causal relationship */
  label: z.string().min(1),
  /** ID of the rule that generated this edge */
  ruleId: z.string().min(1),
});
export type CausalEdge = z.infer<typeof CausalEdgeSchema>;

// ---------------------------------------------------------------------------
// CausalGraph — the full output of the builder
// ---------------------------------------------------------------------------

export const CausalGraphMetadataSchema = z.object({
  /** How many features were present in the input */
  featureCount: z.number().nonnegative(),
  /** How many rules were evaluated (including non-applicable) */
  ruleCount: z.number().nonnegative(),
  totalNodes: z.number().nonnegative(),
  totalEdges: z.number().nonnegative(),
  hasCycle: z.boolean(),
  /** Target URL that was analyzed */
  targetUrl: z.string().optional(),
});
export type CausalGraphMetadata = z.infer<typeof CausalGraphMetadataSchema>;

export const CausalGraphSchema = z.object({
  nodes: z.array(CausalNodeSchema),
  edges: z.array(CausalEdgeSchema),
  metadata: CausalGraphMetadataSchema,
});
export type CausalGraph = z.infer<typeof CausalGraphSchema>;
