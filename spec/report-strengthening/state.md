# State

## Evidence reviewed

- `perfgraph-2.md`: healthy `example.com`, LCP 1112 ms, one HTML request,
  zero render-blocking; TBT is reported as 64 ms while data quality says it is a
  proxy/unavailable.
- `perfgraph-3.md`: `github.com`, LCP 11095 ms, render delay 10444 ms, 22/19
  render-blocking resources, TBT 4414 ms but TBT unavailable in data quality,
  aggregate critical-path duration 75893 ms.
- `web-perf-2.md`: `github.com`, lab LCP 631 ms, field LCP 2604 ms, field TTFB
  1424 ms, CSS savings 0 ms, and 3D assets described as critical-path work.

## Current implementation baseline

- Report format version is now `1.2.0`.
- Nodes and chain paths carry `basis: observed|inferred`.
- Report/Insights expose partial data quality and metric provenance fields.
- `Document` is excluded from render-blocking extraction.
- Borderline TTFB-only signals do not downgrade score.
- Critical-path output now separates `elapsedCriticalPathMs`,
  `aggregateRequestDurationMs`, and `pageLifecycleMs`.
- Ownership buckets distinguish first-party, known first-party CDN,
  third-party vendor, external CDN, and unknown requests.
- Render-blocking output retains Network and Lighthouse counts and exposes a
  source conflict flag.
- Findings carry `basis` and `findingStatus`; recommendations carry evidence,
  applicability, and verification guidance.

## Implementation notes

- Causal edges now carry `basis`, `findingStatus`, and optional evidence; edges
  without direct measurement are explicitly `suspected`.
- CSS/LCP claims remain `suspected` unless Lighthouse reports positive LCP
  savings; this deliberately avoids treating stylesheet presence as causal
  proof when trace overlap is absent.
- Run environment is stored in IR/features/report/insights, and
  `runs-summary.json` includes per-run Lighthouse samples plus min/max/mean/
  standard deviation when `--runs > 1`.

## Decisions to make during implementation

- Timing/provenance additions use report `1.2.0`.
- Ownership currently uses explicit known CDN mappings, with a follow-up
  extension point for user-provided owned domains.
- `pageLifecycleMs` uses the later of the normalized network end and
  `loadEventEnd`, preserving the conservative observed lifecycle span.
- Whether field-like values are accepted as input at all, or only represented
  by the skill as external/unverified evidence.

## Definition of done

All acceptance criteria are implemented. Trace overlap remains an optional
future evidence source; in its absence the report correctly downgrades the
causal status instead of claiming verification.
