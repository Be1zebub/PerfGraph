# Changelog

## 0.2.0

Breaking: the MCP server is gone.

The MCP stdio transport could not carry a long analysis reliably — browser
launch, collection and Lighthouse regularly exceeded the client timeout, and
the server died mid-run without returning a partial result. The CLI is now
the only runtime interface, and the agent-facing layer is a skill.

### Removed

- the `perfgraph mcp` subcommand and the MCP server, handlers, resources,
  prompts and progress reporting
- the `@modelcontextprotocol/sdk` dependency

### Added

- `skills/perfgraph` — the agent skill: how to run the CLI, which artifacts
  to read in which order, and how to qualify causal claims. It ships in the
  npm package.
- `insights.toon` separates the two measurements: `metrics` from the
  PerfGraph run and `lighthouse` from Lighthouse's own navigation.
- `criticalPath.documentChain` reports a page that loaded more than one
  document, with the server time spent on a response nobody used and when
  the content the visitor saw arrived.
- `insights.documentResponse` carries the headers of the document the
  visitor received — cache status, cache-control, content encoding, alt-svc.
- `insights.lighthouse.failedAudits` lists the Lighthouse audits that did not
  pass, with their values.

### Fixed

- the LCP element is the one the browser reported, taken from the final
  Performance API candidate, instead of the largest downloaded image
- the trace LCP was never parsed: the event name did not match the one Chrome
  emits
- the time to the first byte is measured instead of added up wrongly; the
  report no longer tells the user the server answered instantly
- main-thread work is counted per process and only for the outermost events,
  and Total Blocking Time counts the main thread only
- the run environment and the collection warnings reach the report
- the insights and the report give the same recommendations

## 0.1.2

- Lazy-loaded CLI commands, MCP setup notes in the README.
