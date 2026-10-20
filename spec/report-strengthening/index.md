# Спека: усиление PerfGraph reports

## Статус

Implemented. P0/P1/P2 report semantics are implemented and verified by
deterministic tests. Это следующий этап после
`spec/diagnostic-quality/`. Спека основана на
сравнении:

- `_results/perfgraph-2.md` — `example.com`;
- `_results/perfgraph-3.md` — `github.com`;
- `_results/web-perf-2.md` — `github.com`, другой инструмент и методика.

## Контекст

После исправлений resource gating и provenance PerfGraph стал безопаснее для
минимальных страниц, но сложный прогон GitHub выявил следующий класс проблем:

- `TBT` одновременно заявлен как измеренный и как unavailable proxy;
- `Total Chain Length: 75.9 s` выглядит как сумма параллельных запросов, но
  представлен как critical path;
- `github.githubassets.com` классифицируется как third-party, хотя это CDN
  самого GitHub;
- render-blocking count расходится: 22 в одном месте и 19 в другом;
- CSS correlation и LCP impact представлены как почти доказанная причинность,
  хотя Lighthouse сообщает 2454 ms savings, а другой инструмент — 0 ms;
- рекомендации для image LCP появляются при текстовом LCP element;
- report и web-perf дают разные lab-результаты, но текущий формат не описывает
  environment и variance достаточно подробно.

Цель этой спеки — сделать отчёт сильнее не за счёт большего количества
метрик, а за счёт точной семантики, reconciliation источников и приоритизации
действий.

## Цели

1. Разделить elapsed user-visible timings и aggregate work.
2. Никогда не представлять proxy как измеренную CWV-метрику.
3. Различать same-origin, first-party CDN, same-site subdomain и external
   third-party vendor.
4. Показывать расхождения между Network, Lighthouse, Trace и derived features.
5. Связывать рекомендацию с типом LCP element и доказанным user impact.
6. Дать агенту явные `verified`, `suspected`, `not-applicable` состояния.
7. Сделать lab-результаты воспроизводимыми и пригодными для сравнения.

## Non-goals

- field-data backend и самостоятельная реализация CrUX;
- попытка совместить lab и field values в одну метрику;
- автоматическое объявление внутренних GitHub CDN assets third-party;
- увеличение score за счёт количества найденных signals;
- возвращение MCP;
- вывод рекомендаций для каждого обнаруженного ресурса без доказанного impact.

## Целевой report contract

Каждая важная метрика должна иметь:

```text
value, unit, source, method, context, timestamp, status
```

Где `status` — `measured`, `proxy`, `unavailable` или `conflicting`.

Каждое finding/causal relation должно иметь:

```text
basis: observed | inferred
confidence: strong | medium | weak
findingStatus: verified | suspected | not-applicable
evidence
```

## Целевой набор timing fields

Необходимо разделить:

- `elapsedCriticalPathMs` — длительность самой длинной последовательной
  критической ветки;
- `aggregateRequestDurationMs` — сумма durations всех учтённых запросов;
- `pageLifecycleMs` — время от navigation start до выбранного lifecycle event;
- `longestSingleRequestMs` — самый долгий отдельный запрос.

`aggregateRequestDurationMs` нельзя показывать под названием `critical path`
или использовать как прямой user wait time.

## Целевой interpretation flow

1. Verdict для lab-измерения и отдельный field status, если field data есть.
2. Measurement quality и environment.
3. Verified CWV и их breakdown.
4. 1–3 chains, где для каждого node видны `basis`, `findingStatus` и evidence.
5. ASCII graph только для verified/suspected chains; parallel aggregate work не
   рисуется как последовательная degradation path.
6. Recommendations с `applicability`, evidence, expected impact и verify step.
7. Contradictions, anomalies и ограничения.

## План реализации

### Phase 1 — Timing and metric semantics

Ввести typed timing/provenance contract, исправить critical-path extractor,
отделить TBT от busy time и добавить anomaly detection для clamped/invalid
clock-domain values.

### Phase 2 — Ownership and source reconciliation

Добавить first-party ownership configuration/resolution, классификацию CDN и
vendor origins, reconciliation Network/Lighthouse resource lists и явные
conflict records.

### Phase 3 — Causal finding quality

Добавить `findingStatus`/evidence на relation level, проверять measured impact
для render-blocking/LCP claims и разделять initial viewport impact от total page
completion.

### Phase 4 — Recommendation engine

Сделать remediation LCP-element-type-aware, ввести action-specific applicability,
измеряемый verify step и не выдавать image/JS/CSS actions без соответствующих
signals.

### Phase 5 — Run context and regression suite

Сохранять environment/variance context, добавить fixture matrix для GitHub-like
pages, parallel requests, origin ownership, conflicting metrics и malformed
optional data. Обновить report/insights/markdown/skill contract.

## Acceptance criteria

- Report never labels `busyMs` as measured TBT; proxy/unavailable status is
  explicit.
- A tree with parallel requests exposes aggregate duration separately from
  elapsed longest-path duration.
- First-party CDN requests are not counted as third-party vendor overhead when
  ownership is known.
- Network/Lighthouse render-blocking count mismatches are surfaced as a
  conflict, with both counts and sources preserved.
- CSS is marked `suspected` unless measured savings or trace overlap supports a
  stronger claim.
- Text LCP element never receives image-specific remediation.
- 3D/background assets can be reported as total-page work without being claimed
  as an LCP cause unless LCP overlap evidence exists.
- Every recommendation contains evidence, applicability, expected impact
  status and a verification step.
- Environment, source and timestamp are present before lab runs are compared.
- `report.toon`, `insights.toon`, `report.md` and manifest do not contradict
  score, metric status, counts or data-quality warnings.
- All new deterministic fixtures pass without network access.

## Priorities

- P0: issues 1–4 — metric correctness, critical-path semantics, ownership and
  source reconciliation.
- P1: issues 5–8 — causal finding quality, LCP-aware recommendations, user-impact
  separation and run context.
- P2: issues 9–10 — richer agent formatting and long-term comparison support.
