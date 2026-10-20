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
- The Lighthouse insight audits become findings in the report: forced
  reflows, oversized images, bytes that are not cached, duplicated or
  legacy JavaScript, fonts that block the text. Each one carries the value
  Lighthouse measured and the sources involved.
- `criticalPath.documentChain` reports a page that loaded more than one
  document, with the server time spent on a response nobody used and when
  the content the visitor saw arrived.
- `insights.documentResponse` carries the headers of the document the
  visitor received — cache status, cache-control, content encoding, alt-svc.
- `insights.lighthouse.failedAudits` lists the Lighthouse audits that did not
  pass, with their values.
- the network summary lists the heaviest resources, not only the slowest
- the run summary reports the median across runs
- the CLI prints a short summary for the person who ran it: score, issue
  counts, data-quality warnings and where the report is.

### Fixed

- a run against a site that serves a request initiated by itself — Google does
  — no longer dies with a stack overflow while building the critical path
- the LCP element is the one the browser reported, taken from the final
  Performance API candidate, instead of the largest downloaded image
- the trace LCP was never parsed: the event name did not match the one Chrome
  emits
- the time to the first byte is measured instead of added up wrongly; the
  report no longer tells the user the server answered instantly
- main-thread work is counted per process and only for the outermost events,
  and Total Blocking Time counts the main thread only
- the run environment and the collection warnings reach the report
- the report and the insights judge the quality of the data the same way
- a URL without a scheme is accepted, and a failed run prints its message
  instead of a stack trace
- the insights and the report give the same recommendations

## 0.1.2

- Lazy-loaded CLI commands, MCP setup notes in the README.
