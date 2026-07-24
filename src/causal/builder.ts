/**
 * Causal Graph Builder — deterministic rules engine.
 *
 * Takes a FeatureSet, evaluates all known causal rules, builds a DAG,
 * validates acyclicity, and returns a typed CausalGraph.
 *
 * @packageDocumentation
 */

import { Graph, alg } from '@dagrejs/graphlib';
import type { FeatureSet } from '../extract/types.js';
import type {
  CausalGraph,
  CausalNode,
  CausalEdge,
} from './types.js';
import { CausalGraphSchema } from './types.js';
import { lcpRules } from './rules/lcp.js';
import { networkRules } from './rules/network.js';
import { jsRules } from './rules/js.js';
import { layoutRules } from './rules/layout.js';

// ---------------------------------------------------------------------------
// CausalRule interface
// ---------------------------------------------------------------------------

export interface CausalRule {
  /** Unique rule identifier (e.g. "lcp-ttfb-chain") */
  id: string;
  /** Human-readable rule label */
  label: string;
  /** Check whether this rule applies to the given FeatureSet */
  applies: (features: FeatureSet) => boolean;
  /** Build nodes and edges for this causal chain */
  build: (features: FeatureSet) => { nodes: CausalNode[]; edges: CausalEdge[] };
}

// ---------------------------------------------------------------------------
// All registered rules
// ---------------------------------------------------------------------------

// IMPORTANT: order matters — rules evaluated first get priority for
// node/edge IDs if there are overlaps (unlikely, but possible).
const ALL_RULES: CausalRule[] = [
  ...lcpRules,
  ...networkRules,
  ...jsRules,
  ...layoutRules,
];

// ---------------------------------------------------------------------------
// Node deduplication: merge nodes with the same id
// ---------------------------------------------------------------------------

function mergeNodes(existing: CausalNode, incoming: CausalNode): CausalNode {
  return {
    ...existing,
    // Prefer the non-undefined value
    severity: incoming.severity ?? existing.severity,
    value: incoming.value ?? existing.value,
    unit: incoming.unit ?? existing.unit,
    threshold: incoming.threshold ?? existing.threshold,
  };
}

// ---------------------------------------------------------------------------
// Build the causal graph from a FeatureSet
// ---------------------------------------------------------------------------

/**
 * Build a deterministic CausalGraph from a FeatureSet.
 *
 * This is a pure function: same FeatureSet → same CausalGraph (given the same rules).
 *
 * @param features - The FeatureSet from Phase 3 extraction
 * @returns A typed CausalGraph with nodes, edges, and metadata
 * @throws If the graph contains cycles after all rules are applied
 */
export function buildCausalGraph(features: FeatureSet): CausalGraph {
  const g = new Graph({ directed: true });
  const nodeMap = new Map<string, CausalNode>();

  // Track which rules were applicable
  let applicableCount = 0;

  for (const rule of ALL_RULES) {
    if (!rule.applies(features)) continue;
    applicableCount++;

    const { nodes, edges } = rule.build(features);

    // Add nodes (deduplicate by id)
    for (const node of nodes) {
      const existing = nodeMap.get(node.id);
      if (existing) {
        nodeMap.set(node.id, mergeNodes(existing, node));
      } else {
        nodeMap.set(node.id, node);
      }
      g.setNode(node.id, nodeMap.get(node.id)!);
    }

    // Add edges
    for (const edge of edges) {
      // Ensure both endpoints exist in the graph
      if (!nodeMap.has(edge.source)) {
        const fallback: CausalNode = {
          id: edge.source,
          label: edge.source,
          type: 'bottleneck',
        };
        nodeMap.set(edge.source, fallback);
        g.setNode(edge.source, fallback);
      }
      if (!nodeMap.has(edge.target)) {
        const fallback: CausalNode = {
          id: edge.target,
          label: edge.target,
          type: 'impact',
        };
        nodeMap.set(edge.target, fallback);
        g.setNode(edge.target, fallback);
      }
      g.setEdge(edge.source, edge.target, edge);
    }
  }

  // -----------------------------------------------------------------------
  // Validation: check for cycles
  // -----------------------------------------------------------------------

  const cycles = alg.findCycles(g);
  const hasCycle = cycles.length > 0;

  if (hasCycle) {
    const cycleDescriptions = cycles
      .map((cycle) => cycle.join(' → '))
      .join('; ');
    throw new Error(
      `Causal graph contains cycle(s): ${cycleDescriptions}. ` +
      `Cycle-free DAG is required for deterministic analysis.`,
    );
  }

  // Topological sort (will throw if cycles remain)
  const sortedIds = alg.topsort(g);

  // -----------------------------------------------------------------------
  // Build output — sorted by topological order
  // -----------------------------------------------------------------------

  const sortedNodes: CausalNode[] = sortedIds
    .map((id: string) => g.node(id))
    .filter((n: CausalNode | undefined): n is CausalNode => n != null);

  const allEdges = g.edges().map((e) => g.edge(e.v, e.w) as CausalEdge);

  const output: CausalGraph = {
    nodes: sortedNodes,
    edges: allEdges,
    metadata: {
      featureCount: applicableCount,
      ruleCount: ALL_RULES.length,
      totalNodes: sortedNodes.length,
      totalEdges: allEdges.length,
      hasCycle: false,
      targetUrl: features.url ?? undefined,
    },
  };

  // Final schema validation
  return CausalGraphSchema.parse(output);
}
