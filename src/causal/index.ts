/**
 * Causal Graph Builder — public API.
 *
 * Entry point for Phase 4: takes FeatureSet → returns CausalGraph.
 *
 * @packageDocumentation
 */

export { buildCausalGraph } from './builder.js';
export type { CausalRule } from './builder.js';
export {
  CausalNodeSchema,
  CausalEdgeSchema,
  CausalGraphSchema,
  type CausalNode,
  type CausalEdge,
  type CausalGraph,
  type CausalGraphMetadata,
  type Confidence,
  type Severity,
} from './types.js';
