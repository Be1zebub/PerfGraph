# PerfGraph — AI Agent Instructions

This file tells AI coding agents (Claude, ChatGPT, Copilot, etc.) how to work with PerfGraph.

## What PerfGraph is

A CLI tool that collects real browser performance data via CDP, runs it through a 5-stage pipeline, and produces a structured report (TOON for agents, Markdown for humans) with causal chains and prioritized fixes. Designed to be consumed by AI agents.

```
collect → normalize → extract → analyze → report
```

## How AI agents should use PerfGraph

### Quick entry point

```bash
npx perfgraph run --url https://example.com --pretty
```

This runs the full pipeline. The output directory contains:
- `insights.toon` — compact triage, metrics, warnings, and top recommendations
- `report.toon` — issues, evidence, causal chains, and prioritized remediation
- `report.md` — human-readable report
- `manifest.toon` — artifact index and read order

`summary.score` is `good` / `moderate` / `poor` and lives inside `insights.toon`
and `report.toon`.

The CLI needs Playwright's Chromium build. If it is missing, install it once
with `npx playwright install chromium` — the CLI reports the expected binary
path instead of a cryptic launch error.

### AI agent workflow

For a URL plus performance, speed, loading, Core Web Vitals, Lighthouse,
bottleneck, degradation, or causal-graph request, run:

```bash
perfgraph run --url <url> --output ./perfgraph-output --pretty
```

Read `manifest.toon`, then `insights.toon`, then `report.toon`. Read
`graph.toon` and raw `trace.json`, `network.json`, or `lighthouse.json` only for
targeted deep dives. `.toon` files are text, not JSON.

`insights.toon` holds two metric blocks: `metrics` from the PerfGraph run and
`lighthouse` from Lighthouse's own navigation. They are different runs — cite
each value with its source and never merge them.

The response should contain a short status, the 1–3 main causal chains as an
ASCII graph, 3–5 prioritized actions, evidence/confidence, warnings, and a
repeat-measurement plan. Do not treat `Possible INP delay` as measured INP or
analyze a failed collection as a slow page. See `skills/perfgraph/SKILL.md` for
the complete interpretation workflow.

## Diagnostics categories

| Category | What it detects |
|----------|----------------|
| LCP | Large Contentful Paint, TTFB, render-blocking resources, the LCP element itself |
| JavaScript | Long tasks, Total Blocking Time, heavy execution, unused code |
| Network | Request chains, bandwidth bottlenecks, waterfall depth, document chains |
| Layout | Layout shifts (CLS), DOM size, forced reflows |
| Third-party | Overhead from embedded scripts, tracking pixels, widgets |

Every issue and chain node carries `basis` (`observed` or `inferred`) and
`findingStatus`. A rule that inferred a relationship is not a measurement, and
the response has to say so.

## Development commands

```bash
npm install          # install deps
npm run setup:browser # download Playwright Chromium (one-time)
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

If PerfGraph gives wrong results, file an issue with:
- The URL tested
- The command run
- The `report.toon` (or at least the summary section)
