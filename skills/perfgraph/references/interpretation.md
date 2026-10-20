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
  is the Lighthouse run, and `insights.lighthouse.fetchedAt` says when it ran.
  When the two runs disagree on the blocking time, `dataQuality` says so by
  how much — that is two measurements under different conditions, not a
  contradiction.

## Lighthouse findings

`insights.lighthouse.failedAudits` lists the Lighthouse audits that did not
pass, with their values. Some of them are findings the causal rules cannot
derive, and they reach the report as issues with the value Lighthouse
measured:

- `forced-reflow` — a script read a layout property after changing the DOM,
  so the browser had to lay out again. The sources name the script and the
  position.
- `image-delivery` — bytes that could be saved by serving smaller images.
- `cache` — bytes fetched again on every visit because the response is not
  cacheable.
- `duplicated-javascript` and `legacy-javascript` — bytes delivered twice or
  shipped in a form the browser has to transform.
- `font-display` — time the text was blocked by a font.
- `cls-culprits` — the elements that caused the layout shifts.

These come from Lighthouse's own run, not from the traced run. Say so when
you quote them, and do not present them as measurements of the lab run.

## Document response headers

`insights.documentResponse` carries the headers of the document the visitor
received. They answer what the timings cannot:

- `cf-cache-status` / `x-cache` — was the HTML served from the edge? `DYNAMIC`
  or `MISS` on a document that is the same for every visitor means the origin
  answers every request.
- `cache-control` — `max-age=0, must-revalidate` disables caching even when
  the edge could serve it.
- `content-encoding` — whether the body was compressed.
- `alt-svc` — whether a faster protocol (HTTP/3) is offered.
- `server-timing` — where the origin spent its time.

There is no need to fetch the page again with curl to learn these.

## Render-blocking resources

`insights.renderBlocking` lists the resources that were requested before the
first paint. Each one carries its `priority` and its `initiator`, and they
decide whether it really blocked anything:

- a stylesheet the document requested normally blocks the render;
- a stylesheet a **script** injected with a **very low priority** is usually
  the `media="print"` trick — a non-blocking preload that swaps itself in
  later. The report cannot see the media attribute, so check the priority and
  the initiator before you report it as blocking.

When the Lighthouse list and the network list disagree, `renderBlockingSources`
tells you which resources only one of them saw.

## Time to the first byte

`lcpBreakdown.ttfb` is the time from the start of the request to the first
byte, split into `ttfbParts`: DNS, TCP, TLS, proxy and the server wait. The
proxy phase belongs to it — a request that spends seconds in a proxy has a slow
first byte even when the server answers instantly.

When the sum of the parts is much smaller than the time the visitor waited,
the difference is the time before the request started. Say so instead of
blaming the server.

## Document chain

`insights.criticalPath.documentChain` appears when the browser loaded more
than one document. That means it navigated away from a page it had already
received — a redirect or a client-side route change.

- `wastedServerMs` is the server time spent on the response nobody used.
- `contentAtMs` is when the content the visitor finally saw arrived, relative
  to the navigation start.

A single run cannot separate the cost of the chain from the cost of the load
itself, so report the chain as a fact with the wasted server time, not as a
measured delay. Do not describe it as "the server is slow" when the server
wait is a small part of it.

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
