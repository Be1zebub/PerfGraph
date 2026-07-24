# WebTrace — AI Agent Instructions

This file tells AI coding agents (Claude, ChatGPT, Copilot, etc.) how to work with WebTrace.

## What WebTrace is

A CLI tool that collects real browser performance data via CDP, runs it through a 5-stage pipeline, and produces a structured JSON report with causal chains and prioritized fixes. Designed to be consumed by AI agents.

```
collect → normalize → extract → analyze → report
```

## How AI agents should use WebTrace

### Quick entry point

```bash
npx webtrace run --url https://example.com --pretty
```

This runs the full pipeline. The output is a `report.json` with:
- `summary.score` — `good` / `moderate` / `poor`
- `issues[]` — each with severity, confidence, metric value, threshold, remediation
- `chains[]` — causal degradation paths from root cause to user-facing impact
- `recommendations[]` — prioritized, with evidence and expected impact

### MCP mode (for AI agents with MCP support)

```bash
webtrace mcp
```

Starts an MCP stdio server. Agents can call `webtrace_analyze` with a URL and get structured results back. The response includes paths to:

| File | When to read |
|------|-------------|
| `insights.json` | **Read first.** Agent-optimized ~5-15 KB summary: Lighthouse scores, LCP element selector, render-blocking URLs, critical path depth |
| `report.json` | Read for causal chains and prioritized recommendations |
| `manifest.json` | File index with descriptions. Only needed if you want raw data |
| `lighthouse.json` / `trace.json` | Deep dives only — these are large |

### Workflow for agents

1. Call `webtrace_analyze` or run `webtrace run --url ... --pretty`
2. Read `insights.json` for the quick picture
3. Read `report.json` for causal analysis and prioritized fixes
4. Only open raw files (`lighthouse.json`, `trace.json`, `network.json`) when you need specifics not covered by insights

## Diagnostics categories

| Category | What it detects |
|----------|----------------|
| LCP | Large Contentful Paint, TTFB, render-blocking resources |
| JavaScript | Long tasks, Total Blocking Time, heavy execution, unused code |
| Network | Request chains, bandwidth bottlenecks, waterfall depth |
| Layout | Layout shifts (CLS), DOM size, forced reflows |
| Third-party | Overhead from embedded scripts, tracking pixels, widgets |

## Development commands

```bash
npm install          # install deps
npm run build        # compile TypeScript
npm run typecheck    # type-check only
npm test             # run tests
npm run dev          # tsx watch mode
```

## Type system

- Strict TypeScript with `noUncheckedIndexedAccess`
- Zod schemas at every data boundary: `src/*/types.ts`
- CDP data, Lighthouse audits, file I/O — all validated on ingress
- Internal code works with typed interfaces, not raw JSON

## Project conventions

- **kebab-case** for files (`lcp-breakdown.ts`, not `lcpBreakdown.ts`)
- **camelCase** for variables and functions
- **PascalCase** for types, interfaces, and classes
- Early returns. Keep nesting ≤ 3.
- No `@ts-ignore`, `@ts-expect-error`, or `as any` — ever.

## Causal rules

Rules live in `src/causal/rules/`. Each rule file exports an array of `CausalRule` objects. A rule:
- Has a unique `id`, `label`, `category`
- Has a `build()` function that takes `FeatureSet` and returns an array of `CausalNode` + `CausalEdge`
- Can attach `evidence` (URLs, selectors, metric values) to nodes

Adding a new rule: create a file in `src/causal/rules/`, register it in `src/causal/builder.ts`, write a test in `test/causal/`.

## Reporting issues

If WebTrace gives wrong results, file an issue with:
- The URL tested
- The command run
- The `report.json` (or at least the summary section)
