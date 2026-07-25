/**
 * MCP resources for PerfGraph.
 *
 * Registers resource templates and static resources that allow AI agents
 * to read collected data and diagnostic reports via MCP.
 *
 * Resource URI scheme:
 *   perfgraph://artifacts/{encoded-path}/{filename}
 *
 * Where {encoded-path} is the run directory path encoded with `/` → `_` substitution.
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { encode } from '@toon-format/toon';

// ---------------------------------------------------------------------------
// Resource content helpers
// ---------------------------------------------------------------------------

export interface ResourceContent {
  uri: string;
  text: string;
  mimeType?: string;
}

/**
 * Read a resource by its PerfGraph URI.
 *
 * Format: perfgraph://artifacts/{encoded-path}/{filename}
 *
 * The encoded-path uses `_` as path separator (safe for URIs).
 */
export function readResource(uri: string): ResourceContent {
  const parsed = /^perfgraph:\/\/artifacts\/(.+?)\/(.+)$/.exec(uri);

  if (!parsed) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const encodedPath = parsed[1]!;
  const filename = parsed[2]!;

  // Decode: `_` → `\` (Windows) or `/` (standard separator)
  const decodedPath = encodedPath.split('_').join('/');
  const filePath = resolve(decodedPath, filename);

  if (!existsSync(filePath)) {
    throw new Error(`Resource not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');

  // Determine mimeType from filename
  let mimeType = 'application/octet-stream';
  if (filename.endsWith('.json') || filename.endsWith('.toon')) {
    mimeType = 'application/json';
  } else if (filename.endsWith('.json.gz')) {
    mimeType = 'application/gzip';
  } else if (filename.endsWith('.txt')) {
    mimeType = 'text/plain';
  }

  return { uri, text: content, mimeType };
}

/**
 * List known artifacts in a PerfGraph run directory.
 */
export function listArtifacts(uri: string): ResourceContent[] {
  const parsed = /^perfgraph:\/\/artifacts\/(.+)$/.exec(uri);

  if (!parsed) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const encodedPath = parsed[1]!;
  const decodedPath = encodedPath.split('_').join('/');
  const dirPath = resolve(decodedPath);

  if (!existsSync(dirPath)) {
    return [];
  }

  // Common PerfGraph artifacts
  const artifacts = [
    'report.toon',
    'features.toon',
    'graph.toon',
    'ir.json',
    'insights.toon',
    'manifest.toon',
    'trace.json',
    'network.json',
    'performance.json',
    'lighthouse.json',
    'runtime.json',
    'console.json',
    'dom.json',
    'coverage.json',
    'warnings.json',
    'network-summary.toon',
    'lighthouse-summary.toon',
    'coverage-summary.toon',
  ];

  const results: ResourceContent[] = [];
  for (const artifact of artifacts) {
    const filePath = resolve(dirPath, artifact);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      results.push({
        uri: `perfgraph://artifacts/${encodedPath}/${artifact}`,
        text: content,
        mimeType: 'application/json',
      });
    }
  }

  return results;
}

/**
 * Encode a filesystem path for use in a perfgraph:// URI.
 *
 * Replaces path separators with `_` to produce a valid URI segment.
 */
export function encodePath(filePath: string): string {
  return filePath.replace(/[\\/]/g, '_');
}

/**
 * Resolve a webtr:// resource URI and return its content in TOON format.
 *
 * URI scheme: webtr://runs/{runRef}/toon
 *
 * The {runRef} is the run directory path with `_` as separator (same
 * encoding as perfgraph://artifacts/ URIs). Reads the run's report
 * and features JSON, then encodes them as TOON for token-efficient
 * LLM consumption.
 */
export function toon(uri: string): ResourceContent {
  const parsed = /^webtr:\/\/runs\/(.+?)\/toon$/.exec(uri);

  if (!parsed) {
    throw new Error(`Invalid TOON resource URI: ${uri}`);
  }

  const runRef = parsed[1]!;
  const decodedPath = runRef.split('_').join('/');
  const dirPath = resolve(decodedPath);

  if (!existsSync(dirPath)) {
    throw new Error(`Run directory not found: ${dirPath}`);
  }

  // Load report and/or features from the run directory
  const reportFile = resolve(dirPath, 'report.toon');
  const featuresFile = resolve(dirPath, 'features.toon');
  const graphFile = resolve(dirPath, 'graph.toon');

  const data: Record<string, unknown> = {};

  if (existsSync(reportFile)) {
    data.report = JSON.parse(readFileSync(reportFile, 'utf-8'));
  }

  if (existsSync(featuresFile)) {
    data.features = JSON.parse(readFileSync(featuresFile, 'utf-8'));
  }

  if (existsSync(graphFile)) {
    data.graph = JSON.parse(readFileSync(graphFile, 'utf-8'));
  }

  if (Object.keys(data).length === 0) {
    throw new Error(`No run data found in: ${dirPath}`);
  }

  const text = encode(data);

  return { uri, text, mimeType: 'text/plain' };
}
