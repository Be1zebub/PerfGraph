# Show HN draft

## Title

> Show HN: PerfGraph – browser perf CLI with causal graphs and MCP for AI agents

## Body

PerfGraph is a CLI that runs real Chromium performance audits (not synthetic) and produces structured JSON reports with causal degradation chains — root cause → intermediate effects → user-facing impact — plus prioritized fix recommendations.

**The problem it solves:** Lighthouse gives you a score and a wall of audits. You still have to connect the dots yourself: "Which of these 50 warnings is actually causing the LCP problem? What should I fix first?"

PerfGraph connects those dots for you. It runs Lighthouse + CDP tracing, extracts 7 diagnostic feature sets (LCP breakdown, critical network chain, main-thread blocking, JS hotspots, layout shifts, third-party overhead, render-blocking score), then applies 30+ causal inference rules to build a directed graph. The output is a self-contained JSON report with causal chains and expected-impact estimates.

**MCP server built in:** Start `perfgraph mcp` and any AI agent (Claude, Cursor, etc.) can call `perfgraph_analyze` with a URL and get the full report back — structured for automated remediation.

```bash
npx perfgraph run --url https://example.com --pretty
```

Stack: TypeScript, Playwright (Chromium), Zod, @dagrejs/graphlib, 518 tests.

Looking for feedback on: output format UX, missing diagnostic categories, and the MCP integration pattern.

## Why this exists

I got tired of digging through 10k-line trace.json files and squinting at Lighthouse audit walls. AI agents can't read screenshots — they need structured data with causal context. So I built the thing I wished existed.

## Links

- GitHub: <https://github.com/Be1zebub/PerfGraph>
- npm: <https://www.npmjs.com/package/perfgraph>
- Docs in README and AGENTS.md
