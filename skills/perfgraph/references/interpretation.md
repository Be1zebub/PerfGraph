# PerfGraph interpretation reference

## Output template

```text
Status: <good|moderate|poor>; Lighthouse Performance: <value or unavailable>.
Main finding: <one sentence grounded in summary/evidence>.

Primary causal chains:
<ASCII graph for 1–3 chains>

What to fix:
1. <action> — evidence: <metric/url/selector>; verify: <next measurement>
2. <action> — evidence: ...; verify: ...
3. <action> — evidence: ...; verify: ...

Limitations: <warnings, missing collectors, confidence caveats>.
```

## Interpretation vectors

- **Triage:** score, Lighthouse baseline, issue counts, and the dominant
  severity/priority.
- **Causality:** root signal → bottleneck → user impact, with chain confidence.
- **LCP/render path:** TTFB, resource delay, render delay, LCP element,
  render-blocking URLs, and critical request chain.
- **JavaScript/main thread:** TBT, busy/blocking time, long-task count,
  execution hotspots, third-party ratio, and the possible INP impact signal.
- **Network:** critical-chain depth and duration, waterfall/blocking evidence;
  request count alone is not a bottleneck.
- **Layout:** CLS and shift clusters; do not elevate tiny/noisy shifts without
  meaningful evidence.
- **Third-party:** overhead ratio and concrete scripts when available.
- **Data quality:** warnings, disabled collectors, missing metrics, and
  environment failures.
- **Action plan:** prioritize root causes, then high-impact blockers, then
  follow-up validation; avoid repeating equivalent recommendations.

## Sanity checks before a verdict

- A TTFB value alone supports a response-delay observation, not CSS discovery,
  render blocking, image delay, or JavaScript causality.
- A document request is not a render-blocking stylesheet or script.
- Require a matching resource and timing signal before recommending CSS, image,
  JavaScript, CDN, cache, or preload changes.
- Green CWV plus borderline TTFB should be reported as a qualified observation,
  not automatically as moderate degradation.
- If `report.toon` and `insights.toon` disagree on score or metrics, call out a
  data-quality inconsistency and avoid a confident performance verdict.
- Lab and field values from different runs must retain source, timestamp, and
  context; never present one as a substitute for the other.
- The LCP element is only reported when the browser identified it. A missing
  `lcpElement` means the element is unknown, not that the page has no LCP.
  Never substitute the largest downloaded image for the LCP element.
- Two LCP numbers may appear: the PerfGraph lab value from the traced run and
  the Lighthouse value from its own throttled run. Report each with its source
  instead of merging them. `insights.metrics` is the lab run, `insights.lighthouse`
  is the Lighthouse run.

## LCP element and resource

`insights.lcpElement` describes the element the browser reported:

- `source`: `performance-api` (the browser's own LCP entry), `lighthouse`, or
  `trace`;
- `type`: `text` or `image`. A text LCP has no image resource, so image
  recommendations do not apply to it;
- `nodeLabel` / `selector`: the element itself;
- `lcpElementUrl`: the resource, when the LCP element is an image. It may be an
  inline `data:` URI — in that case there is nothing to download, preload or
  re-encode, and the delay to attack is the render delay.

Only an image LCP has load timings. When the element is unknown, the LCP time
is reported as a single render delay rather than split into a guessed resource
delay.

## What is measured and what is not

- `insights.metrics.tbtMs` is the trace measurement. `insights.lighthouse.tbtMs`
  is Lighthouse's own audit value; a headless run can inflate it, and it is
  reported as unavailable when it exceeds a sane bound.
- `jsHotspots.longTaskCount` comes from the browser's `LongTask` events.
  `source` says so, and `console-gap` means it was inferred from the gaps
  between console messages, which is much weaker.
- `mainThreadBlocking.busyMs` covers the page lifecycle window, not the whole
  trace. Work that happened after the load event did not block the user.
- A `data:` URI request is not third-party traffic: it has no origin and no
  network cost, and it is excluded from the ownership buckets.

## ASCII causal graph

Build the graph only from `report.chains[].path`. Preserve path order and use
the chain/node labels from the report, shortened only for readability. Do not
create inferred edges. Show confidence on edges when it is present:

```text
[Main thread blocked: 3200 ms]
        │ confidence: strong
        ▼
[High Total Blocking Time]
        │ confidence: medium
        ▼
[Possible INP delay]
```

For independent chains, render separate blocks. Limit the response to the 1–3
chains with the highest severity and priority. If there are no chains, state
that no causal chain was built.

## Confidence and metric language

- `strong`: state the relationship directly, while still separating metric from
  impact.
- `medium`: use "likely", "suggests", or "may contribute".
- `weak`: use "possible signal" and recommend validation before treating it as
  a root cause.
- Never call a causal estimate a field measurement. In particular,
  `Possible INP delay` must not be reported as measured INP.

## Node basis

Use `basis` on each chain node to separate evidence from inference:

- `observed`: backed by a measured metric or direct resource evidence;
- `inferred`: generated by a causal rule and requiring qualified language.

The node `type` still describes its role (`metric`, `bottleneck`, or `impact`);
an impact node is not itself a measurement.
