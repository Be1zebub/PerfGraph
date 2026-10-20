---
name: perfgraph
description: Analyze web performance URLs with the PerfGraph CLI and interpret its deterministic reports, causal chains, and prioritized remediation data. Use when a request asks to measure or diagnose loading speed, Core Web Vitals, Lighthouse performance, bottlenecks, or web performance regressions.
metadata:
  short-description: Run PerfGraph CLI and explain performance findings
---

# PerfGraph CLI

Use this skill when the task requires a fresh synthetic performance analysis or
interpretation of an existing PerfGraph run. The CLI is the execution layer;
the skill explains how to invoke it and how to read its artifacts.

## Run an analysis

Prefer the installed `perfgraph` command:

```bash
perfgraph run --url <url> --output ./perfgraph-output --pretty
```

Use `--runs 1` for a normal diagnostic. Use `--runs 3` or more only when the
user needs variability information and can tolerate the extra runtime. Use
`--device "iPhone 13"` for mobile emulation. Optional collectors can be
disabled with `--no-lighthouse`, `--no-coverage`, `--no-console`, and `--no-dom`.

If the command is not installed but this repository is available, use the
already-built local entry point `node dist/index.js run ...`. Do not install
packages as an implicit fallback. A missing Chromium binary is an environment
setup failure, not a performance finding.

Give the shell command enough time for browser startup, navigation, collection,
and Lighthouse. If it exits non-zero, inspect stderr and do not produce a
performance verdict.

## Read results progressively

After a successful run, locate the output directory from the CLI output and
read artifacts in this order:

1. `manifest.toon` — confirm what was actually produced and its suggested order;
2. `insights.toon` — compact triage metrics, LCP element, render-blocking
   resources, critical path, warnings, and top recommendations;
3. `report.toon` — authoritative `summary`, `issues`, `chains`, and
   `recommendations`;
4. `report.md` — human-readable fallback when it makes the chain easier to scan;
5. `graph.toon`, `network-summary.toon`, `lighthouse-summary.toon`, and
   `coverage-summary.toon` only for a targeted deep dive;
6. `trace.json`, `network.json`, `lighthouse.json`, and other raw files only
   when the compact artifacts lack the evidence needed for the question.

`insights.toon` carries two metric blocks. `metrics` holds the values measured
in the PerfGraph run (the run described by `runContext`); `lighthouse` holds
the values from Lighthouse's own throttled run. They are different runs and
must not be merged. Cite each one with its source.

`.toon` files are text in Token-Oriented Object Notation. Read them as text;
do not assume they are JSON or call `JSON.parse` on them.

## Interpret the result

The final response should contain:

1. a short status with `summary.score`, Lighthouse Performance when available,
   issue counts, and the main conclusion;
2. the 1–3 highest-priority causal chains;
3. an ASCII causal degradation graph for those chains;
4. three to five actions ordered by likely impact;
5. evidence, confidence, warnings, missing data, and a repeat-measurement plan.

For each selected chain distinguish the observed metric, likely bottleneck,
and user-facing impact. Group duplicate issues that belong to one chain instead
of presenting them as independent root causes.

Use each chain path node's `basis`: `observed` means supported by a measured
metric or direct evidence; `inferred` means produced by a causal rule. Keep the
impact node separate from the measured signal, and do not present an inferred
bottleneck as a directly observed fact.

Never invent a metric, URL, selector, byte count, or expected impact. A causal
impact such as `Possible INP delay` is not a directly measured INP value. Weak
or medium confidence requires an explicit qualification. A failed collection,
network denial, missing Lighthouse result, or warning is a data-quality issue,
not evidence that the page is slow.

Before interpreting a causal chain, apply a resource sanity check. A TTFB signal
does not prove CSS discovery, render blocking, image delay, or JavaScript work.
Require matching resource/timing evidence for those nodes. A document request is
not a render-blocking stylesheet or script. If all Core Web Vitals are green and
only a borderline TTFB warning exists, describe it as a qualified observation;
do not call the page moderately degraded without independent user-impact data.

Treat `report.toon` as the authoritative causal output and compare its score and
counts with `insights.toon`. If they disagree, report the inconsistency as a
data-quality issue and avoid a confident verdict. Lab and field values from
different runs are not interchangeable; preserve their source, timestamp, and
measurement context.

Use [references/interpretation.md](references/interpretation.md) for the output
template, metric-specific vectors, and ASCII graph rules.

## Additional report semantics

When `criticalPath` is present, use `elapsedCriticalPathMs` for the longest
dependency path and `aggregateRequestDurationMs` for the sum of request work.
The aggregate value includes parallel branches and must not be described as
user wait time. Compare it with `pageLifecycleMs` when available.

Treat `mainThreadBlocking.tbtMs` as measured TBT only when its status is
available. `busyMs` is main-thread activity, not TBT, and must be described as
a proxy or limitation when measured TBT is unavailable.

Use `thirdParty.byOwnership` to distinguish `first-party`, `first-party-cdn`,
`third-party-vendor`, `external-cdn`, and `unknown`. Do not call a known
first-party CDN a third-party vendor. If `renderBlocking.sourceConflict` is
true, show both source counts and qualify any savings or LCP attribution.
Use `--owned-domain <host>` for organization-controlled asset hosts that are
not inferable from the target URL.

Every issue and chain node has `basis` and `findingStatus`. Every
recommendation should be reported with applicability, evidence, expected
impact and expected-impact status, and a verification step. Use impact surface
to distinguish initial viewport, LCP, interaction, and total-page work. For a text LCP element, prioritize render
delay, main-thread work, and blocking styles/scripts; do not recommend image
format or image priority changes without image evidence.

The LCP element comes from the browser itself: `insights.lcpElement.source` is
`performance-api`, `lighthouse` or `trace`, and `type` is `text` or `image`.
Only an image LCP carries an `lcpElementUrl` and resource load timings, and
that URL may be an inline `data:` URI — nothing to download, preload or
re-encode. When the element is unknown, report the LCP as a single render
delay instead of naming a resource. Never present the largest downloaded
image as the LCP element. The traced lab LCP and the Lighthouse LCP come from
two different runs — report both with their source instead of merging them.
