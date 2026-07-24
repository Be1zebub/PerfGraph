/**
 * MCP diagnostic prompt templates.
 *
 * Prompts provide guided starting points for common diagnostic workflows.
 * When an AI client invokes a prompt, it receives structured messages that
 * guide it through the analysis process using WebTrace tools.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Shared: base diagnostic instructions
// ---------------------------------------------------------------------------

/**
 * Instructions injected into every diagnostic prompt to ensure the AI
 * agent uses WebTrace effectively.
 */
const SYSTEM_CONTEXT = `You are a web performance diagnostician powered by WebTrace.

WORKFLOW:
1. Call \`webtrace_run\` with the target URL to collect and analyze performance data.
2. Read the results — the tool returns a summary with score, issue counts, and resource URIs.
3. Read the full report via the \`webtrace://\` resource URIs returned in the response.
4. Analyze the findings and provide actionable recommendations.

The report contains:
- **meta**: URL, analysis timestamp, feature/graph/rule counts
- **summary**: overall score (good/moderate/poor), issue counts, top issues
- **issues**: each detected problem with severity (critical/warning/info), confidence (strong/medium/weak), metric values, and remediation text
- **chains**: causal paths from root cause to impact
- **recommendations**: prioritized actions with expected impact
- **features**: raw diagnostic features for cross-referencing

RESPONSE FORMAT:
Always structure your analysis with:
1. **Executive Summary** — score, critical count, system status
2. **Key Findings** — top issues by severity with metrics
3. **Causal Chains** — root cause → impact paths
4. **Recommendations** — prioritized actions
5. **Next Steps** — what to investigate further`;

// ---------------------------------------------------------------------------
// Prompt: LCP Performance Analysis
// ---------------------------------------------------------------------------

export const LcpAnalysisArgsSchema = z.object({
  /** Target URL to analyze */
  url: z.string().min(1, 'url is required'),
  /** Optional: existing report URI to analyze instead of running a new collection */
  reportUri: z.string().optional(),
});

/**
 * Guided LCP (Largest Contentful Paint) performance analysis.
 *
 * The prompt instructs the AI to run a focused analysis on LCP performance,
 * examining the LCP breakdown (TTFB, resource delay, render delay, element
 * render time) and all contributing factors.
 */
export function buildLcpAnalysisPrompt(args: z.infer<typeof LcpAnalysisArgsSchema>): GetPromptResult {
  const { url, reportUri } = args;

  const userMessage = reportUri
    ? `Analyze the LCP performance from the existing report at ${reportUri}.

Focus specifically on:
1. **LCP Breakdown** — TTFB, resource load delay, render delay, element render time
2. **Render-blocking resources** — CSS, JS, scripts blocking the LCP element
3. **Causal chain** — follow the path from root cause to LCP impact
4. **Remediations** — what specific actions would improve LCP

Read the report from ${reportUri} and provide a focused LCP analysis with specific metrics and recommendations.`
    : `Perform a detailed LCP (Largest Contentful Paint) analysis on ${url}.

Follow this workflow:
1. Call \`webtrace_run\` with url="${url}" to collect and analyze performance data
2. Read the report via the returned resource URIs
3. Focus your analysis specifically on LCP performance:

   a. **LCP Breakdown**: Examine TTFB, resource load delay, render delay, and element render time
   b. **Contributing Factors**: Check render-blocking resources, critical path depth, JS execution hotspots, and third-party scripts
   c. **Causal Chain**: Trace the degradation path from root causes to LCP impact
   d. **Remediations**: Prioritize actions that would most improve LCP

4. For each finding, include:
   - The metric value and threshold
   - Severity (critical/warning/info)
   - Confidence (strong/medium/weak)
   - Specific remediation action

Provide a structured LCP diagnostic report.`;

  return {
    description: `LCP performance analysis for ${url}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `${SYSTEM_CONTEXT}\n\n${userMessage}`,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Prompt: Full Site Audit
// ---------------------------------------------------------------------------

export const AuditArgsSchema = z.object({
  /** Target URL to audit */
  url: z.string().min(1, 'url is required'),
  /** Number of collection runs (default: 1) */
  runs: z.number().int().min(1).max(5).optional(),
  /** Whether to focus on a specific category (lcp, js, network, layout) */
  focus: z.enum(['all', 'lcp', 'js', 'network', 'layout']).optional(),
});

/**
 * Comprehensive full-site performance audit.
 *
 * Instructs the AI to perform a thorough analysis across all performance
 * dimensions and produce a complete diagnostic report.
 */
export function buildAuditPrompt(args: z.infer<typeof AuditArgsSchema>): GetPromptResult {
  const { url, runs, focus } = args;
  const focusHint = focus && focus !== 'all'
    ? `\nFOCUS AREA: ${focus.toUpperCase()}`
    : '';

  const userMessage = `Perform a comprehensive performance audit of ${url}${focusHint}.

Workflow:
1. Call \`webtrace_run\` with url="${url}"${runs ? `, runs=${runs}` : ''}
2. Read the full report from the returned resource URIs
3. Analyze ALL of the following dimensions${focus && focus !== 'all' ? ` (with primary focus on ${focus})` : ''}:

   ${focus === 'all' || !focus ? `
   a. **LCP (Largest Contentful Paint)** — TTFB, resource delay, render delay, element timing
   b. **JavaScript** — long tasks, TBT, execution hotspots, parse/compile/evaluate cost
   c. **Network** — request waterfall, critical path depth, cascade delay, bandwidth contention
   d. **Layout** — CLS, layout shift clusters, DOM complexity, forced reflows
   e. **Third-party** — origin attribution, transfer size ratio, blocking scripts` : ''}
   ${focus === 'lcp' ? `a. **LCP Breakdown** — TTFB, resource delay, render delay, element render time
   b. **Render-blocking** — CSS/JS/scripts blocking LCP
   c. **Critical path** — request chain depth to LCP element` : ''}
   ${focus === 'js' ? `a. **Long tasks** — count, duration, attribution
   b. **TBT (Total Blocking Time)** — score and contributors
   c. **Execution hotspots** — top JS files by parse/compile/evaluate time
   d. **Third-party JS** — overhead from external scripts` : ''}
   ${focus === 'network' ? `a. **Waterfall depth** — critical chain length and serial requests
   b. **Cascade delay** — sequential dependency delays
   c. **Bandwidth contention** — multiplexing opportunities
   d. **Render-blocking** — blocking request analysis` : ''}
   ${focus === 'layout' ? `a. **CLS score** — cumulative and individual shifts
   b. **Layout shift clusters** — timing and affected elements
   c. **DOM complexity** — total nodes, depth, max children
   d. **Forced reflows** — layout thrashing patterns` : ''}

4. For every critical and warning issue found, provide:
   - The metric value and threshold exceeded
   - Causal chain from root cause to impact
   - Concrete remediation steps
   - Expected impact of the fix

5. Prioritize issues by severity and provide an overall site health assessment.

Format the audit as a structured report with clear sections and actionable findings.`;

  return {
    description: `Full performance audit of ${url}${focus && focus !== 'all' ? ` (focus: ${focus})` : ''}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `${SYSTEM_CONTEXT}\n\n${userMessage}`,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Prompt: Summarize Report
// ---------------------------------------------------------------------------

export const SummarizeArgsSchema = z.object({
  /** Resource URI of the report to summarize (e.g., webtrace://artifacts/<path>/report.toon) */
  reportUri: z.string().min(1, 'reportUri is required'),
  /** Detail level for the summary */
  detail: z.enum(['brief', 'normal', 'detailed']).optional(),
});

/**
 * Summarize an existing WebTrace report in natural language.
 *
 * Takes a report resource URI (as returned by webtrace_run) and produces
 * a human-readable summary of the findings.
 */
export function buildSummarizePrompt(args: z.infer<typeof SummarizeArgsSchema>): GetPromptResult {
  const { reportUri, detail } = args;
  const verbosity = detail ?? 'normal';

  const userMessage = `Read and summarize the WebTrace performance report at ${reportUri}.

Read the report and provide a ${verbosity === 'brief' ? 'concise (3-5 bullet points)' : verbosity === 'detailed' ? 'comprehensive, section-by-section' : 'balanced'} summary.

Include:
${verbosity === 'brief' ? `
- Overall score and critical issue count
- Top 3 most important findings
- Single most impactful recommendation` : verbosity === 'detailed' ? `
- **Executive Summary**: overall score, critical/warning/info counts, system status
- **All Critical Issues**: full details with metrics, thresholds, and remediations
- **Causal Chains**: every chain from root cause to impact with confidence levels
- **All Recommendations**: prioritized with expected impact
- **Raw Features Summary**: key metric values for LCP, TBT, CLS, etc.` : `
- Overall score, critical/warning/info breakdown
- Top 5 issues with severity and confidence
- Key causal chains
- Top 3 recommendations with expected impact`}

Base your summary solely on the report data — do not add information not present in the report. Use natural language, not JSON.`;

  return {
    description: `Summarize WebTrace report at ${reportUri}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `${SYSTEM_CONTEXT}\n\n${userMessage}`,
        },
      },
    ],
  };
}
