# Dev.to article skeleton

**Tone:** Technical story, not a pitch. "Here's what I learned building X."

## Title ideas

- "Lighthouse is lying to you: building a perf CLI/MCP that connects the dots"
- "Causal graphs for web performance: why scores aren't enough"
- "How I built a browser perf analyzer that speaks MCP"

## Structure

1. **The problem** — Every team runs Lighthouse. Every team gets a score. Nobody knows what to fix first because the score doesn't tell you what's causing what.

2. **What PerfGraph does differently** — 5-stage pipeline (collect → normalize → extract → analyze → report), 30+ causal rules, directed degradation graph from root cause to user impact.

3. **The MCP integration** — Why AI agents need structured perf data, not screenshots. `perfgraph mcp` → any Claude/Cursor/agent can analyze a URL in one call.

4. **Technical deep-dive** — CDP tracing + Lighthouse in parallel, Zod validation on every boundary, graphlib for causal inference, insights.json for agent optimization.

5. **Real example** — Analyze a real site, show the report, trace a causal chain from "render-blocking CSS" → "late LCP" → "poor user experience".

6. **What's next** — More causal rules, CI integration, community contributions.

## Code snippets to include

- One-liner: `npx perfgraph run --url https://example.com --pretty`
- MCP mode: `perfgraph mcp` + showing how Claude calls it
- Sample causal chain from a report JSON
- Pipeline diagram (assets/diagram-tall.svg)
