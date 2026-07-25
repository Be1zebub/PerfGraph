/**
 * PerfGraph MCP Server.
 *
 * Exposes PerfGraph's full performance diagnostic pipeline through
 * the Model Context Protocol. Primary usage is the `perfgraph_run` tool
 * (one-shot URL → report). Advanced users can invoke individual pipeline
 * steps via dedicated tools.
 *
 * Resources are available at `perfgraph://artifacts/{encoded-path}/{filename}`
 * for reading collected data and generated reports.
 *
 * Usage (AI client config):
 * ```json
 * {
 *   "mcpServers": {
 *     "perfgraph": {
 *       "command": "node",
 *       "args": ["dist/index.js", "mcp"]
 *     }
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  RunArgsSchema,
  CollectArgsSchema,
  NormalizeArgsSchema,
  ExtractArgsSchema,
  AnalyzeArgsSchema,
  ReportArgsSchema,
  ToonArgsSchema,
} from './types.js';
import {
  handleRun,
  handleCollect,
  handleNormalize,
  handleExtract,
  handleAnalyze,
  handleReport,
} from './handlers.js';
import {
  readResource,
  listArtifacts,
  encodePath,
  toon as toonResource,
} from './resources.js';
import { createProgressReporter } from './progress.js';
import {
  buildLcpAnalysisPrompt,
  LcpAnalysisArgsSchema,
  buildAuditPrompt,
  AuditArgsSchema,
  buildSummarizePrompt,
  SummarizeArgsSchema,
} from './prompts.js';

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

/**
 * Start the MCP stdio server.
 *
 * Registers all tools and resources, then listens for JSON-RPC messages
 * on stdin/stdout. Never resolves — the server runs until the process
 * is killed.
 */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'perfgraph',
    version: '1.0.0',
  });

  // -----------------------------------------------------------------------
  // Primary shortcut: full pipeline in one call
  // -----------------------------------------------------------------------

  server.registerTool(
    'perfgraph_run',
    {
      description: `Run the full PerfGraph pipeline on a URL: collect trace data, normalize, extract diagnostic features, build a causal degradation graph, and generate a performance report.

Returns a structured result with report file paths, performance score, issue counts, and a severity map of detected problems.

After calling this tool, you can read the full report via the perfgraph:// resource URIs returned in the 'files' field.

EXAMPLE:
  agent calls perfgraph_run with url = "https://example.com"
  → receives summary + file paths to report.json, features.json, graph.json
  → reads report.json via perfgraph://artifacts/<path>/report.json for full details

This is the PRIMARY tool — use this for most performance analysis tasks.`,
      inputSchema: RunArgsSchema,
    },
    async (args, extra) => {
      try {
        const progress = createProgressReporter(
          extra.sendNotification,
          extra._meta?.progressToken,
        );
        const result = await handleRun(
          args.url,
          args.outputDir,
          args.runs,
          progress,
          args.mobile,
        );

        // Enrich result with resource URIs
        const encodedPath = encodePath(result.outputDir);
        const enriched = {
          ...result,
          resourceUris: {
            report: `perfgraph://artifacts/${encodedPath}/report.json`,
            features: `perfgraph://artifacts/${encodedPath}/features.json`,
            graph: `perfgraph://artifacts/${encodedPath}/graph.json`,
          },
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(enriched, null, 2) }],
        };
      } catch (err) {
        const message = (err as Error).message;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Advanced tools: individual pipeline steps
  // -----------------------------------------------------------------------

  server.registerTool(
    'perfgraph_collect',
    {
      description: `[Advanced] Collect raw performance data from a URL without running the full pipeline.

Use this when you only need the raw CDP data (trace, network, lighthouse, etc.)
without normalization or analysis. The collected data is written to a local
output directory.

ADVANCED TOOL: For most use cases, prefer perfgraph_run which runs the full pipeline.`,
      inputSchema: CollectArgsSchema,
    },
    async (args, extra) => {
      try {
        const progress = createProgressReporter(
          extra.sendNotification,
          extra._meta?.progressToken,
        );
        const result = await handleCollect(
          args.url,
          args.outputDir,
          args.runs,
          progress,
          args.mobile,
        );
        if (!result.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: result.error }, null, 2),
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: (err as Error).message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'perfgraph_normalize',
    {
      description: `[Advanced] Normalize collected CDP data into a validated Intermediate Representation (IRBundle).

Accepts a run directory path (from perfgraph_collect) and produces a typed,
validated IRBundle with normalized timestamps across all clock domains.

ADVANCED TOOL: Usually called automatically by perfgraph_run. Use this when
you need to inspect or debug the normalization step.`,
      inputSchema: NormalizeArgsSchema,
    },
    async (args) => {
      try {
        const result = await handleNormalize(args.runDir);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: (err as Error).message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'perfgraph_extract',
    {
      description: `[Advanced] Extract diagnostic features from a normalized IRBundle.

Computes 7 feature metrics: LCP breakdown, critical path analysis, main thread
blocking, JS execution hotspots, layout shifts, third-party overhead, and
render-blocking resource score.

ADVANCED TOOL: Usually called automatically by perfgraph_run. Use this when
you want to inspect the raw feature set before causal analysis.`,
      inputSchema: ExtractArgsSchema,
    },
    async (args) => {
      try {
        const result = await handleExtract(args.irFile);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: (err as Error).message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'perfgraph_analyze',
    {
      description: `[Advanced] Build a causal degradation graph from extracted features.

Applies 30+ causal rules from 4 rule sets (LCP, JS, Network, Layout) and
produces a deterministic DAG where each edge has a confidence level
(strong/medium/weak).

ADVANCED TOOL: Usually called automatically by perfgraph_run. Use this when
you need to inspect the causal graph structure directly.`,
      inputSchema: AnalyzeArgsSchema,
    },
    async (args) => {
      try {
        const result = await handleAnalyze(args.featuresFile);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: (err as Error).message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'perfgraph_report',
    {
      description: `[Advanced] Generate a comprehensive performance report from extracted features.

Produces a self-contained JSON report with: issues sorted by severity, causal
chains from root cause to impact, prioritized recommendations with remediation
texts (in Russian), and raw features for cross-referencing.

ADVANCED TOOL: Usually called automatically by perfgraph_run. Use this when
you have already extracted features and want to generate a report separately.`,
      inputSchema: ReportArgsSchema,
    },
    async (args) => {
      try {
        const result = await handleReport(args.featuresFile);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: (err as Error).message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // TOON format tool
  // -----------------------------------------------------------------------

  server.registerTool(
    'perfgraph_toon',
    {
      description: `Convert a PerfGraph run's results into TOON (Token-Oriented Object Notation) format.

TOON is a compact, human-readable encoding of JSON designed to minimise token
usage in LLM prompts. It declares array lengths and field headers once, then
streams row values — making it ideal for AI consumption.

Accepts a run directory path (from perfgraph_run or perfgraph_collect) and
returns the run's report, features, and causal graph encoded as TOON.

After calling this tool, you can also access the TOON data via the resource
URI: webtr://runs/{encoded-runDir}/toon

ADVANCED TOOL: Use when you need token-optimised performance data for
LLM-based analysis or chaining into other AI tools.`,
      inputSchema: ToonArgsSchema,
    },
    async (args) => {
      try {
        const uri = `webtr://runs/${encodePath(args.runDir)}/toon`;
        const content = toonResource(uri);
        return {
          content: [{ type: 'text', text: content.text }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: (err as Error).message },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Resources
  // -----------------------------------------------------------------------

  server.registerResource(
    'perfgraph-artifact',
    new ResourceTemplate('perfgraph://artifacts/{path}/{filename}', {
      list: async () => {
        return {
          resources: [
            {
              uri: 'perfgraph://artifacts/<run-dir>/report.json',
              name: 'Full Diagnostic Report',
              description:
                'Complete performance report with issues, causal chains, and recommendations',
            },
            {
              uri: 'perfgraph://artifacts/<run-dir>/features.json',
              name: 'Extracted Features',
              description:
                'Raw diagnostic feature set (LCP, TBT, CLS, critical path, etc.)',
            },
            {
              uri: 'perfgraph://artifacts/<run-dir>/graph.json',
              name: 'Causal Graph',
              description:
                'Directed acyclic graph of causal degradation relationships',
            },
            {
              uri: 'perfgraph://artifacts/<run-dir>/ir.json',
              name: 'Intermediate Representation',
              description:
                'Normalized IRBundle with all collected performance data',
            },
          ],
        };
      },
    }),
    {
      title: 'PerfGraph Artifact',
      description:
        'Access PerfGraph collected data and generated reports by run directory and filename. ' +
        'The {path} segment is the filesystem path with separators replaced by underscores. ' +
        'For example, path "C:_Users_project_perfgraph-output_example" maps to ' +
        '"C:/Users/project/perfgraph-output/example". Use file paths returned by perfgraph_run.',
      mimeType: 'application/json',
    },
    async (uri, { path: encodedPath, filename }) => {
      const pathPart = Array.isArray(encodedPath) ? encodedPath.join('_') : (encodedPath ?? '');
      const filePart = Array.isArray(filename) ? filename.join('_') : (filename ?? '');
      const fullUri = `perfgraph://artifacts/${pathPart}/${filePart}`;
      const content = readResource(fullUri);

      return {
        contents: [
          {
            uri: fullUri,
            text: content.text,
            mimeType: content.mimeType,
          },
        ],
      };
    },
  );

  // Register a convenience resource for listing all artifacts in a run dir
  server.registerResource(
    'perfgraph-artifact-list',
    new ResourceTemplate('perfgraph://artifacts/{path}', {
      list: async () => ({
        resources: [
          {
            uri: 'perfgraph://artifacts/<run-dir>',
            name: 'Run Directory Contents',
            description:
              'Lists all available PerfGraph artifacts in a run directory',
          },
        ],
      }),
    }),
    {
      title: 'PerfGraph Run Directory',
      description: 'List all available artifacts in a PerfGraph run directory',
      mimeType: 'application/json',
    },
    async (uri, { path: encodedPath }) => {
      const pathPart = Array.isArray(encodedPath) ? encodedPath.join('/') : (encodedPath ?? '');
      const fullUri = `perfgraph://artifacts/${pathPart}`;
      const artifacts = listArtifacts(fullUri);

      if (artifacts.length === 0) {
        return {
          contents: [
            {
              uri: fullUri,
              text: JSON.stringify(
                {
                  error: 'No artifacts found',
                  path: pathPart.split('_').join('/'),
                },
                null,
                2,
              ),
              mimeType: 'application/json',
            },
          ],
        };
      }

      const listing = artifacts.map((a) => ({
        uri: a.uri,
        name: a.uri.split('/').pop(),
        mimeType: a.mimeType,
      }));

      return {
        contents: [
          {
            uri: fullUri,
            text: JSON.stringify(
              { artifacts: listing, count: listing.length },
              null,
              2,
            ),
            mimeType: 'application/json',
          },
        ],
      };
    },
  );

  // -----------------------------------------------------------------------
  // TOON resource
  // -----------------------------------------------------------------------

  server.registerResource(
    'perfgraph-toon',
    new ResourceTemplate('webtr://runs/{runRef}/toon', {
      list: async () => {
        return {
          resources: [
            {
              uri: 'webtr://runs/<encoded-runDir>/toon',
              name: 'Run Results (TOON)',
              description:
                'Token-efficient TOON-encoded run results (report, features, causal graph)',
            },
          ],
        };
      },
    }),
    {
      title: 'PerfGraph TOON Output',
      description:
        'Token-optimised TOON encoding of a PerfGraph run\'s report, features, and causal graph. ' +
        'The {runRef} segment is the run directory path with path separators replaced by underscores, ' +
        'matching the encoding used in perfgraph://artifacts/ URIs.',
      mimeType: 'text/plain',
    },
    async (uri, { runRef }) => {
      const ref = Array.isArray(runRef) ? runRef.join('_') : (runRef ?? '');
      const fullUri = `webtr://runs/${ref}/toon`;
      const content = toonResource(fullUri);

      return {
        contents: [
          {
            uri: fullUri,
            text: content.text,
            mimeType: content.mimeType,
          },
        ],
      };
    },
  );

  // -----------------------------------------------------------------------
  // Prompts
  // -----------------------------------------------------------------------

  server.registerPrompt(
    'perfgraph_analyze_lcp',
    {
      title: 'LCP Performance Analysis',
      description: `Run a focused diagnostic analysis of Largest Contentful Paint (LCP) performance for a URL. Analyzes LCP breakdown (TTFB, resource delay, render delay, element render time), render-blocking resources, and causal chains. Provides prioritized remediation steps.`,
      argsSchema: LcpAnalysisArgsSchema.shape,
    },
    (args) => buildLcpAnalysisPrompt(args),
  );

  server.registerPrompt(
    'perfgraph_audit',
    {
      title: 'Full Site Performance Audit',
      description: `Run a comprehensive performance audit covering all diagnostic dimensions: LCP, JavaScript, Network, Layout, and Third-party. Optionally focus on a specific category. Produces a structured report with all issues, causal chains, and prioritized recommendations.`,
      argsSchema: AuditArgsSchema.shape,
    },
    (args) => buildAuditPrompt(args),
  );

  server.registerPrompt(
    'perfgraph_summarize_report',
    {
      title: 'Summarize Performance Report',
      description: `Read an existing PerfGraph report (by resource URI) and produce a natural-language summary. Supports brief, normal, and detailed verbosity levels. Use this when you already have a report and want a human-readable overview.`,
      argsSchema: SummarizeArgsSchema.shape,
    },
    (args) => buildSummarizePrompt(args),
  );

  // -----------------------------------------------------------------------
  // Transport
  // -----------------------------------------------------------------------

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
