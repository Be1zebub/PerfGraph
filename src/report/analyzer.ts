/**
 * Report Analyzer — core logic for Phase 5.
 *
 * Takes CausalGraph + FeatureSet and produces a comprehensive Report:
 *   - Extracts causal chains (root cause → intermediate → impact)
 *   - Builds flat issue list with remediation texts
 *   - Computes overall score
 *   - Generates prioritized recommendations
 *
 * @packageDocumentation
 */

import { Graph, alg } from '@dagrejs/graphlib';
import type { CausalGraph, CausalNode, CausalEdge } from '../causal/types.js';
import type { FeatureSet } from '../extract/types.js';
import type {
  Report,
  ReportMeta,
  ReportSummary,
  ReportIssue,
  CausalChain,
  Recommendation,
  TopIssue,
} from './types.js';
import { ReportSchema } from './types.js';
import { computeScore } from './scorer.js';
import { getRemediation } from './remediations.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reconstruct a graphlib Graph from a CausalGraph for traversal.
 */
function rebuildGraph(graph: CausalGraph): Graph {
  const g = new Graph({ directed: true });

  for (const node of graph.nodes) {
    g.setNode(node.id, node);
  }
  for (const edge of graph.edges) {
    if (!g.hasNode(edge.source)) {
      g.setNode(edge.source, { id: edge.source, label: edge.source, type: 'bottleneck' });
    }
    if (!g.hasNode(edge.target)) {
      g.setNode(edge.target, { id: edge.target, label: edge.target, type: 'impact' });
    }
    g.setEdge(edge.source, edge.target, edge);
  }

  return g;
}

/**
 * DFS from a node to find all paths to sink nodes.
 * Uses simple recursion with visited set to avoid infinite loops.
 */
function findPathsToSinks(
  g: Graph,
  nodeId: string,
  visited: Set<string> = new Set(),
): string[][] {
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const outEdges = g.outEdges(nodeId) ?? [];

  // If no outgoing edges, this is a sink — return path with just this node
  if (outEdges.length === 0) {
    return [[nodeId]];
  }

  const paths: string[][] = [];
  for (const edge of outEdges) {
    const subPaths = findPathsToSinks(g, edge.w, new Set(visited));
    for (const sub of subPaths) {
      paths.push([nodeId, ...sub]);
    }
  }

  return paths;
}

/**
 * Find the overall confidence for a chain (lowest in the path).
 */
function chainConfidence(path: string[], edges: CausalEdge[]): string {
  const confOrder: Record<string, number> = { strong: 3, medium: 2, weak: 1 };
  let minConf = 3;

  for (let i = 0; i < path.length - 1; i++) {
    const edge = edges.find(
      (e) => e.source === path[i] && e.target === path[i + 1],
    );
    if (edge) {
      minConf = Math.min(minConf, confOrder[edge.confidence] ?? 1);
    }
  }

  const reverse: Record<number, string> = { 3: 'strong', 2: 'medium', 1: 'weak' };
  return reverse[minConf] ?? 'weak';
}

// ---------------------------------------------------------------------------
// Category mapping for recommendations
// ---------------------------------------------------------------------------

function categorizeNode(nodeId: string, ruleId?: string): string {
  if (!ruleId) {
    if (nodeId.includes('lcp') || nodeId.includes('ttfb') || nodeId.includes('rb-')) return 'LCP';
    if (nodeId.includes('js-') || nodeId.includes('tbt') || nodeId.includes('inp')) return 'JavaScript';
    if (nodeId.includes('net-') || nodeId.includes('chain') || nodeId.includes('request') || nodeId.includes('bandwidth')) return 'Network';
    if (nodeId.includes('layout') || nodeId.includes('cls') || nodeId.includes('dom')) return 'Layout';
    return 'Performance';
  }

  if (ruleId.startsWith('lcp')) return 'LCP';
  if (ruleId.startsWith('net')) return 'Network';
  if (ruleId.startsWith('js')) return 'JavaScript';
  if (ruleId.startsWith('layout')) return 'Layout';
  return 'Performance';
}

/**
 * Build a deterministic chain ID from a rule ID and path length.
 */
function buildChainId(ruleId: string, path: string[]): string {
  return `${ruleId}:${path.length}`;
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

/**
 * Build a comprehensive Report from a CausalGraph and FeatureSet.
 *
 * Pure function: same inputs → same Report.
 *
 * @param graph - The CausalGraph from Phase 4
 * @param features - The FeatureSet from Phase 3 (optional — included in report as-is)
 * @returns A fully populated Report
 */
export function buildReport(
  graph: CausalGraph,
  features?: FeatureSet,
  lighthousePerformance?: number,
): Report {
  const g = rebuildGraph(graph);

  // -----------------------------------------------------------------------
  // 1. Build causal chains
  // -----------------------------------------------------------------------

  const sources = g.sources() as string[];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const allPaths: { ruleId: string; path: string[] }[] = [];
  const seenPaths = new Set<string>();

  for (const source of sources) {
    const paths = findPathsToSinks(g, source);
    for (const path of paths) {
      if (path.length < 2) continue; // skip single-node "chains"

      // Determine ruleId from the first edge
      const firstEdge = graph.edges.find(
        (e) => e.source === path[0] && e.target === path[1],
      );
      const ruleId = firstEdge?.ruleId ?? 'unknown';

      // Deduplicate identical paths
      const pathKey = `${ruleId}:${path.join('→')}`;
      if (seenPaths.has(pathKey)) continue;
      seenPaths.add(pathKey);

      allPaths.push({ ruleId, path });
    }
  }

  const chains: CausalChain[] = allPaths.map(({ ruleId, path }) => {
    const chainId = buildChainId(ruleId, path);
    const headId: string = path[0]!;
    const tailId: string = path[path.length - 1]!;
    const firstNode: { label: string } = nodeMap.get(headId) ?? { label: headId };
    const lastNode: { label: string } = nodeMap.get(tailId) ?? { label: tailId };
    const conf = chainConfidence(path, graph.edges);

    // Highest severity in the chain
    let maxSev = 'info';
    for (const p of path) {
      const n = nodeMap.get(p);
      if (n?.severity === 'critical') { maxSev = 'critical'; break; }
      if (n?.severity === 'warning') maxSev = 'warning';
    }

    return {
      id: chainId,
      rootCause: firstNode.label,
      impact: lastNode.label,
      confidence: conf,
      severity: maxSev,
      path: path.map((nodeId) => {
        const n = nodeMap.get(nodeId);
        return {
          nodeId,
          label: n?.label ?? nodeId,
          type: n?.type ?? 'bottleneck',
          severity: n?.severity,
        };
      }),
      length: path.length,
    };
  });

  // -----------------------------------------------------------------------
  // 2. Build issues (flat list, sorted by severity)
  // -----------------------------------------------------------------------

  // Map each node to a chain ID
  const nodeToChain = new Map<string, string>();
  for (const chain of chains) {
    for (const step of chain.path) {
      // Prefer shorter chain (more direct causal link)
      const existing = nodeToChain.get(step.nodeId);
      if (!existing || chain.length < 3) {
        nodeToChain.set(step.nodeId, chain.id);
      }
    }
  }

  // Find edge confidence for each node (confidence of the edge leading INTO it)
  const nodeInConfidence = new Map<string, string>();
  for (const edge of graph.edges) {
    nodeInConfidence.set(edge.target, edge.confidence);
  }

  const issues: ReportIssue[] = graph.nodes.map((node) => {
    // Determine the rule ID for remediation lookup
    const incomingEdge = graph.edges.find((e) => e.target === node.id);
    const ruleId = incomingEdge?.ruleId;
    const confidence = nodeInConfidence.get(node.id) ?? 'weak';

    return {
      id: node.id,
      label: node.label,
      type: node.type,
      severity: node.severity ?? 'info',
      value: node.value,
      unit: node.unit,
      threshold: node.threshold,
      confidence,
      remediation: getRemediation(node.id, {
        evidence: node.evidence,
        value: node.value,
        unit: node.unit,
        nodeType: node.type,
        ruleId,
      }),
      chainId: nodeToChain.get(node.id) ?? 'standalone',
      evidence: node.evidence,
    };
  });

  // Sort: critical first, then warning, then info
  const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));

  // -----------------------------------------------------------------------
  // 3. Build summary
  // -----------------------------------------------------------------------

  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;
  const scoreResult = computeScore(graph, lighthousePerformance);
  const score = typeof scoreResult === 'string' ? scoreResult : scoreResult.score;
  const scoreExplanation = typeof scoreResult === 'object' ? scoreResult.explanation : undefined;

  // Top 5 issues (sorted by severity, then by confidence: strong > medium > weak)
  const confOrder: Record<string, number> = { strong: 0, medium: 1, weak: 2 };
  const sortedTop = [...issues].sort((a, b) => {
    const sevCmp = (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
    if (sevCmp !== 0) return sevCmp;
    return (confOrder[a.confidence] ?? 3) - (confOrder[b.confidence] ?? 3);
  });

  const topIssues: TopIssue[] = sortedTop.slice(0, 5).map((i) => ({
    id: i.id,
    label: i.label,
    severity: i.severity,
    confidence: i.confidence,
  }));

  const summary: ReportSummary = {
    score,
    criticalIssues: criticalCount,
    warnings: warningCount,
    infos: infoCount,
    topIssues,
    lighthousePerformance,
    scoreExplanation,
  };

  // -----------------------------------------------------------------------
  // 4. Build recommendations
  // -----------------------------------------------------------------------

  const recommendations: Recommendation[] = [];
  const recSeen = new Set<string>();

  // Build recommendations from critical and warning issues
  const actionableIssues = issues.filter(
    (i) => i.severity === 'critical' || i.severity === 'warning',
  );

  for (const issue of actionableIssues) {
    const cat = categorizeNode(issue.id);

    // Deduplicate by category + action prefix
    const dedupKey = `${cat}:${issue.remediation.slice(0, 80)}`;
    if (recSeen.has(dedupKey)) continue;
    recSeen.add(dedupKey);

    const priority = issue.severity === 'critical' ? 'critical' : 'high';

    // Extract action from remediation (first sentence)
    const actionEnd = issue.remediation.indexOf('. ');
    const action = actionEnd > 0
      ? issue.remediation.slice(0, actionEnd + 1)
      : issue.remediation;

    recommendations.push({
      priority,
      category: cat,
      title: issue.label,
      description: issue.remediation,
      action,
      expectedImpact: issue.type === 'impact'
        ? 'Target metric improvement'
        : 'Eliminates bottleneck in the degradation chain',
      relatedIssues: issues
        .filter((other) => other.chainId === issue.chainId && other.id !== issue.id)
        .map((other) => other.id),
    });
  }

  // Sort recommendations: critical first, then high, then medium, then low
  const recPriority: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort(
    (a, b) => (recPriority[a.priority] ?? 4) - (recPriority[b.priority] ?? 4),
  );

  // -----------------------------------------------------------------------
  // 5. Build metadata
  // -----------------------------------------------------------------------

  const meta: ReportMeta = {
    url: graph.metadata.targetUrl ?? features?.url ?? '',
    analyzedAt: new Date().toISOString(),
    reportVersion: REPORT_VERSION,
    featureCount: graph.metadata.featureCount,
    graphNodeCount: graph.metadata.totalNodes,
    graphEdgeCount: graph.metadata.totalEdges,
    ruleCount: graph.metadata.ruleCount,
  };

  // -----------------------------------------------------------------------
  // 6. Assemble + validate
  // -----------------------------------------------------------------------

  const report: Report = {
    meta,
    summary,
    issues,
    chains,
    recommendations,
    features: features ?? null,
  };

  return ReportSchema.parse(report);
}

/**
 * Check whether a report has actionable issues.
 */
export function hasActionableIssues(report: Report): boolean {
  return report.summary.criticalIssues > 0 || report.summary.warnings > 0;
}
