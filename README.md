# PerfGraph

[![npm][badge-version]][npm] [![license][badge-license]][license]
[![npm downloads][badge-downloads]][npm] [![github stars][badge-stars]][repo]
![Visitors](https://visitor-badge.laobi.icu/badge?page_id=Be1zebub/PerfGraph)

> Real browser metrics → causal degradation graph → actionable report. Built for AI agents, useful for humans.

PerfGraph launches a headless Chromium browser, captures performance data via Chrome DevTools Protocol, runs it through a 5-stage analysis pipeline, and produces a structured report with issues sorted by severity, causal chains, and prioritized fixes.

```bash
npx perfgraph run --url https://example.com --pretty
```

PerfGraph — not a symptom list, a diagnosis.  
Root cause → impact → fix, in one graph.

**[Use from an AI agent →](#ai-agent-workflow)**

## Why

Lighthouse gives you a score. PerfGraph tells you _why_ it's bad and what to fix first.

Instead of digging through a 10k-line trace.json or a wall of Lighthouse audits, you get a focused report with root causes linked to impact. The output is designed to be read by AI agents (or you) without a decoder ring.

## Pipeline

![diagram](./assets/diagram-tall.svg)

```
collect → normalize → extract → analyze → report
```

| Step          | What it does                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Collect**   | Launches headless Chromium, captures network, trace, performance API, JS coverage, console logs, DOM snapshot, and Lighthouse audit                                                       |
| **Normalize** | Validates raw data through Zod schemas into a unified Intermediate Representation (IRBundle). All timestamps normalized, data cleaned                                                     |
| **Extract**   | Computes 7 diagnostic feature sets from the IR: LCP breakdown, critical network chain, main-thread blocking time, JS hotspots, layout shifts, third-party overhead, render-blocking score |
| **Analyze**   | Runs 30+ causal rules against the features, builds a directed graph where edges represent known causal relationships with confidence levels (strong/medium/weak)                          |
| **Report**    | Produces a structured report (TOON for agents, Markdown for humans) with issues sorted by severity, causal chains from root cause to user impact, and prioritized recommendations with expected impact estimates |

## Install

```bash
npm install -g perfgraph
```

Or skip the install:

```bash
npx perfgraph --help
```

**Requirements:** Node.js ≥ 22 and Playwright's Chromium build. The browser is
not downloaded automatically — install it once:

```bash
npx playwright install chromium
```

If the binary is missing, PerfGraph fails with the exact expected path instead
of a cryptic launch error.

## Quick start

Full pipeline, one command:

```bash
perfgraph run --url https://example.com --pretty
```

> **Want to use PerfGraph from your AI agent?** See [AI agent workflow](#ai-agent-workflow).

Step by step:

```bash
# 1. Collect data
perfgraph collect --url https://example.com --output ./results

# 2. Normalize → Extract → Report
perfgraph normalize ./results/perfgraph_example_20260609_120000 --output ir.json
perfgraph extract ir.json --output features.json
perfgraph report features.json --output report.json --pretty
```

## Commands

### `perfgraph run`

Full pipeline in one shot.

```
--url <url>           Required. Target URL to analyze.
--output <dir>            Output directory (default: ./perfgraph-output).
--runs <n>            Number of collection runs (default: 1).
--pretty              Pretty-print the final report JSON.
--device <name>       Mobile emulation (e.g. "iPhone 13").
--owned-domain <host> Treat an extra hostname as first-party CDN (repeatable).
--no-lighthouse       Skip Lighthouse collection.
--no-coverage         Skip JS/CSS coverage.
--no-console          Skip console log capture.
--no-dom              Skip DOM snapshot.
```

### `perfgraph collect`

Captures performance data from a URL. See `run` options — same flags apply.

### `perfgraph normalize <input>`

Converts raw collected data into a validated IRBundle. Accepts a run directory or a parent directory (auto-detects latest run).

```
--output, -o <file>   Write to file (default: stdout).
--pretty              Pretty-print JSON.
```

### `perfgraph extract <ir-file>`

Computes diagnostic features from a normalized IR bundle.

```
--input, -i <file>    Path to IR JSON (alternative to positional).
--output, -o <file>   Write to file (default: stdout).
--pretty              Pretty-print JSON.
```

### `perfgraph analyze <features-file>`

Applies causal rules and builds a degradation graph.

```
--input, -i <file>    Path to FeatureSet JSON (alternative to positional).
--output, -o <file>   Write to file (default: stdout).
--pretty              Pretty-print JSON.
```

### `perfgraph report <features-file>`

Generates the final performance report. Accepts a FeatureSet JSON (from `extract`) — runs the causal engine internally, no need to call `analyze` separately.

```
--input, -i <file>    Path to FeatureSet JSON (alternative to positional).
--output, -o <file>   Write to file (default: stdout).
--pretty              Pretty-print JSON.
```

## AI agent workflow

### 1. Make the CLI available

```bash
npm install -g perfgraph
npx playwright install chromium
```

### 2. Install the skill (optional but recommended)

The package ships an agent skill that describes how to invoke the CLI and how
to interpret its artifacts. Copy it into your agent's skills directory:

```bash
# OpenCode
cp -r node_modules/perfgraph/skills/perfgraph ~/.config/opencode/skills/

# Claude Code
cp -r node_modules/perfgraph/skills/perfgraph ~/.claude/skills/
```

In a checkout of this repository the skill lives at
[`skills/perfgraph/SKILL.md`](skills/perfgraph/SKILL.md), with the metric
reference in `skills/perfgraph/references/interpretation.md`.

### 3. Run the pipeline

```bash
perfgraph run --url https://example.com --output ./perfgraph-output --pretty
```

Read the resulting files progressively:

1. `manifest.toon` — files actually produced;
2. `insights.toon` — compact triage and top recommendations;
3. `report.toon` — issues, causal chains, evidence and recommendations;
4. `report.md` or `graph.toon` — readable diagnosis and causal graph;
5. raw `trace.json`, `network.json` and `lighthouse.json` only for targeted deep dives.

The agent should summarize the status, show an ASCII causal degradation graph
for the 1–3 main chains, give 3–5 prioritized actions, and mention confidence,
warnings and missing data. `.toon` files are text and should not be parsed as
JSON. The full agent instructions live in
[`skills/perfgraph/SKILL.md`](skills/perfgraph/SKILL.md).

## Insights format

`insights.toon` is the compact triage artifact. It keeps the two measurement
runs apart, because PerfGraph and Lighthouse each navigate the page on their
own:

```text
runContext:  browser, os, device, viewport, throttling, owned domains
metrics:     lcpMs, fcpMs, cls, tbtMs  — measured in the PerfGraph run
lighthouse:  performance, lcpMs, fcpMs, cls, tbtMs, failedAudits — Lighthouse's own run
lcpElement:  selector, nodeLabel, source, type
```

`metrics.lcpSource` names the run the LCP came from. `lcpElement.source` is
`performance-api` when the browser's own LCP entry identified the element,
`lighthouse` or `trace` otherwise; `lcpElement.type` is `text` or `image`, and
only an image LCP has a resource URL and load timings.

`criticalPath.documentChain` appears when the browser loaded more than one
document — it navigated away from a page it had already received.
`wastedServerMs` is the server time spent on a response nobody used,
`contentAtMs` when the content the visitor saw arrived.

## Report format

`perfgraph run` writes `report.toon` (compact, agent-facing) and
`report.md` (human-readable) next to the raw artifacts; the same report object
is printed as JSON on stdout. Key sections:
```jsonc
{
 "meta": {
  "url": "https://example.com",
  "analyzedAt": "2026-06-09T19:15:19.000Z",
  "reportVersion": "1.3.0",
  "featureCount": 7,
  "graphNodeCount": 24,
  "graphEdgeCount": 31,
  "ruleCount": 32,
 },
 "summary": {
  "score": "moderate", // "good" | "moderate" | "poor"
  "criticalIssues": 2,
  "warnings": 5,
  "infos": 3,
  "topIssues": [
   {
    "id": "js-long-task",
    "label": "Long task",
    "severity": "critical",
    "confidence": "strong",
   },
  ],
 },
 "issues": [
  {
   "id": "lcp-slow",
   "label": "LCP exceeds 2.5s threshold",
   "severity": "critical",
   "value": 4320,
   "unit": "ms",
   "threshold": 2500,
   "confidence": "strong",
   "basis": "observed",
   "findingStatus": "confirmed",
   "remediation": "Optimize largest contentful paint element...",
   "chainId": "lcp:3",
  },
 ],
 "chains": [
  {
   "id": "lcp:3",
   "rootCause": "LCP > 2.5s",
   "impact": "Poor user experience",
   "confidence": "strong",
   "severity": "critical",
   "path": [
    {
     "nodeId": "ttfb:1",
     "label": "TTFB delayed by server response",
     "type": "root-cause",
     "basis": "observed",
     "findingStatus": "confirmed",
     "impactSurface": "page",
    },
    {
     "nodeId": "render-blocking:2",
     "label": "Render-blocking stylesheets",
     "type": "bottleneck",
     "basis": "inferred",
     "findingStatus": "suspected",
     "impactSurface": "lcp",
    },
   ],
   "length": 2,
  },
 ],
 "recommendations": [
  {
   "priority": "critical",
   "category": "LCP",
   "title": "Optimize Largest Contentful Paint",
   "description": "LCP element is delayed by the render-blocking chain.",
   "action": "Inline critical styles, defer non-critical CSS",
   "expectedImpact": "Reduces LCP by ~40%",
   "expectedImpactStatus": "estimated",
   "applicability": "applicable",
   "verification": "Re-run perfgraph and compare insights.toon LCP",
   "relatedIssues": ["lcp-slow"],
  },
 ],
 "features": {
  /* raw extracted features for cross-referencing */
 },
}
```

## What it detects

| Category        | Issues                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| **LCP**         | Slow LCP, high TTFB, render-blocking resources, LCP resource delay chains           |
| **JavaScript**  | Long tasks, high TBT, heavy execution, unused code, main-thread bottlenecks         |
| **Network**     | Deep request chains, bandwidth bottlenecks, waterfall depth, critical path analysis |
| **Layout**      | Layout shifts (CLS), large DOM size, forced reflows                                 |
| **Third-party** | Third-party script overhead, tracking pixels, embedded widget impact                |

## Architecture

```
src/
├── index.ts              CLI entry — lazy-loads commands
├── collect/              CDP data collection via Playwright
│   ├── session.ts        Browser launcher + CDP session
│   ├── orchestrator.ts   Collection orchestrator
│   ├── coverage.ts       JS/CSS coverage
│   ├── network.ts        Network request capture
│   ├── performance.ts    Performance API metrics
│   ├── runtime.ts        Runtime metadata
│   ├── dom.ts            DOM snapshot
│   └── lighthouse.ts     Lighthouse audit
├── normalize/            Data normalization & IR validation
├── extract/              7 diagnostic feature extractors
├── causal/               Causal rule engine (30+ rules)
│   ├── builder.ts        Graph construction
│   ├── rules/            Individual causal rules by category
│   └── types.ts          Graph data types
├── report/               Report generation & scoring
│   ├── analyzer.ts       Report builder
│   ├── scorer.ts         Score computation
│   ├── remediations.ts   Remediation templates
│   └── types.ts          Report schema
├── distill/              Agent-optimized summary layer (insights.toon)
├── output/               TOON/JSON writers, manifest
├── cli/                  CLI command handlers
└── shared/               Shared utilities & types

skills/perfgraph/         Agent skill + interpretation reference
scripts/                  Build helpers
spec/                     Feature specs
```

## Development

```bash
npm install
npm run build          # compile TypeScript
npm run typecheck      # check types only
npm test               # run tests
npm run test:watch     # tests in watch mode
npm run dev            # tsx watch — no build step
```

## Tech

| Thing              | What                                          |
| ------------------ | --------------------------------------------- |
| Runtime            | Node.js ≥ 22                                  |
| Language           | TypeScript (strict, noUncheckedIndexedAccess) |
| Browser            | Playwright (Chromium)                         |
| Validation         | Zod at every data boundary                    |
| Graph engine       | @dagrejs/graphlib                             |
| Performance audits | Lighthouse                                    |
| Testing            | Vitest                                        |

## License

MIT

[badge-version]: https://img.shields.io/npm/v/perfgraph.svg
[badge-license]: https://img.shields.io/npm/l/perfgraph.svg
[badge-downloads]: https://img.shields.io/npm/dm/perfgraph.svg
[badge-stars]: https://img.shields.io/github/stars/Be1zebub/PerfGraph.svg?style=flat&logo=github
[npm]: https://www.npmjs.com/package/perfgraph
[license]: https://github.com/Be1zebub/PerfGraph/blob/master/LICENSE
[repo]: https://github.com/Be1zebub/PerfGraph
