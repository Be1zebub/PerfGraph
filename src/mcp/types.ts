/**
 * MCP-specific types and Zod schemas.
 *
 * Shared input schemas for MCP tool handlers and result types.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tool input schemas
// ---------------------------------------------------------------------------

/** Schema for the primary shortcut tool — full pipeline URL→report */
export const RunArgsSchema = z.object({
  /** Target URL to analyze (required) */
  url: z.string().min(1, 'url is required'),
  /** Base output directory (default: ./perfgraph-output) */
  outputDir: z.string().optional(),
  /** Number of collection runs (default: 1) */
  runs: z.number().int().min(1).max(10).optional(),
  /** Device name for emulation (e.g. "iPhone 13", "Pixel 7"). Empty/omitted = desktop */
  mobile: z.string().optional(),
});

/** Schema for the collect tool (advanced) */
export const CollectArgsSchema = z.object({
  /** Target URL to collect data from (required) */
  url: z.string().min(1, 'url is required'),
  /** Base output directory (default: ./perfgraph-output) */
  outputDir: z.string().optional(),
  /** Number of collection runs (default: 1) */
  runs: z.number().int().min(1).max(10).optional(),
  /** Skip Lighthouse audit */
  noLighthouse: z.boolean().optional(),
  /** Skip JS/CSS coverage */
  noCoverage: z.boolean().optional(),
  /** Skip console log capture */
  noConsole: z.boolean().optional(),
  /** Skip DOM snapshot */
  noDom: z.boolean().optional(),
  /** Device name for emulation (e.g. "iPhone 13", "Pixel 7"). Empty/omitted = desktop */
  mobile: z.string().optional(),
});

/** Schema for the normalize tool (advanced) */
export const NormalizeArgsSchema = z.object({
  /** Path to the run directory containing collected data */
  runDir: z.string().min(1, 'runDir is required'),
});

/** Schema for the extract tool (advanced) */
export const ExtractArgsSchema = z.object({
  /** Path to a normalized IR JSON file */
  irFile: z.string().min(1, 'irFile is required'),
});

/** Schema for the analyze tool (advanced) */
export const AnalyzeArgsSchema = z.object({
  /** Path to a FeatureSet JSON file */
  featuresFile: z.string().min(1, 'featuresFile is required'),
});

/** Schema for the report tool (advanced) */
export const ReportArgsSchema = z.object({
  /** Path to a FeatureSet JSON file */
  featuresFile: z.string().min(1, 'featuresFile is required'),
});

/** Schema for the toon tool — encodes run results in TOON format */
export const ToonArgsSchema = z.object({
  /** Path to the run directory containing perfgraph output files */
  runDir: z.string().min(1, 'runDir is required'),
});


