/**
 * Report Generator — Phase 5 public API.
 *
 * Usage:
 *   import { buildReport } from '../report/index.js';
 *   const report = buildReport(causalGraph, featureSet);
 *
 * @packageDocumentation
 */

export { buildReport, hasActionableIssues } from './analyzer.js';
export type {
  Report,
  ReportMeta,
  ReportSummary,
  ReportIssue,
  CausalChain,
  Recommendation,
  TopIssue,
  ReportScore,
  RecommendationPriority,
} from './types.js';
export { getRemediation } from './remediations.js';
