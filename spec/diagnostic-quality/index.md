# Спека: качество диагностики и интерпретации PerfGraph

## Статус

Implemented. Основана на ревью текущего кода и сравнении `_results/perfgraph.md` с
`_results/web-perf.md` на `https://example.com`.

## Контекст и проблема

Оба инструмента содержат сигналы, что тестовая страница не имеет заметной
проблемы загрузки. При этом `web-perf` выдаёт практически нулевой TTFB и
вердикт «оптимизация не нужна», а PerfGraph — `MODERATE` и цепочку:

```text
TTFB → delayed HTML parse → delayed CSS discovery → blocked render → LCP
```

Для страницы с одним HTML-запросом, без CSS/JS и с LCP около 0.8 s эта цепочка
не подтверждается фактическими ресурсами. В `src/causal/rules/lcp.ts` цепочка
строится только по `TTFB > 800 ms`, а HTML-документ попадает в
render-blocking evidence. В `src/report/analyzer.ts` каждое warning превращается
в рекомендацию, даже если подходящего ресурса или подтверждённого воздействия
нет. Поэтому агент получает правдоподобный по форме, но частично ложный отчёт.

## Цель

Сделать отчёты пригодными для агентской интерпретации:

- causal chain строится только из подтверждённых или явно обозначенных
  предположений;
- score и severity отражают пользовательский impact, а не сам факт срабатывания
  слабого правила;
- рекомендации применимы к конкретным данным;
- все числа имеют понятные источник, методику, единицы и контекст;
- `insights`, `report`, markdown и ASCII-представление не противоречат друг другу;
- регрессии ловятся детерминированными fixture-тестами.

## Не входит в эту спеку

- возвращение MCP;
- новый браузерный collector или field-data backend;
- попытка сделать lab-метрики и CrUX/field-метрики взаимозаменяемыми;
- redesign CLI, не связанный с достоверностью отчёта.

## Требуемый контракт интерпретации

Агент должен выдавать результат в порядке:

1. Короткий verdict: URL, score, Lighthouse (если есть), critical/warning/info.
2. Достоверность данных: lab/field, timestamp, повторяемость, missing metrics.
3. CWV и breakdown: LCP, CLS, TBT/INP без подмены отсутствующих значений.
4. 1–3 главные causal chains с разделением `observed`, `inferred`, `impact` и
   confidence.
5. ASCII causal/degradation graph только по реально существующим chains.
6. Приоритетные действия, каждое с evidence, applicability и способом проверки.
7. Ограничения и следующие измерения, если данных недостаточно.

Пример компактного графа:

```text
[TTFB: 814 ms, observed, medium]
        │ only if server-response evidence exists
        ▼
[Server response delay, inferred]
        │ confidence: medium
        ▼
[LCP: 795 ms, impact: low]
```

Граф не должен добавлять CSS, image, JS или render-blocking nodes, если в
features нет соответствующего ресурса и timing evidence.

## План реализации

### Phase 1 — измерительный и evidence-контракт

Добавить provenance/method/unit semantics для метрик, разделить TTFB, LCP
breakdown, critical-path duration, page lifetime и main-thread busy time.
Добавить `dataQuality`/limitations для missing, partial и conflicting data.

### Phase 2 — resource-aware causal rules

Исправить LCP rules: TTFB не создаёт CSS/render-blocking causal path без
CSS/stylesheet evidence; HTML document не считается render-blocking CSS/JS.
Ограничить JS/layout/network chains соответствующими ресурсами и сигналами.

### Phase 3 — score, severity и recommendations

Калибровать borderline warnings и отделить informational observations от
actionable regressions. Recommendations строить по causal action/evidence,
проверять applicability, дедуплицировать по причине и действию, не обещать
impact без измеримого основания.

### Phase 4 — output consistency и skill guidance

Синхронизировать `insights`, `report`, markdown и manifest. Обновить skill
правила интерпретации, ASCII graph, data-quality warnings и формат ответа.

### Phase 5 — regression fixtures

Добавить deterministic fixtures и semantic assertions для минимальной HTML
страницы, CSS/JS bottleneck, TBT, CLS, network chain, incomplete Lighthouse и
contradictory inputs.

## Acceptance criteria

- Static HTML fixture с одним HTML request не содержит CSS/render-blocking chain,
  CSS/image recommendations или неподтверждённого LCP bottleneck.
- Borderline TTFB при зелёных CWV не делает отчёт `moderate` автоматически;
  правило score явно документировано и покрыто тестом.
- Каждая causal chain имеет evidence либо явно помечена как inference; chain
  confidence не маскирует отсутствие данных.
- Recommendation нельзя получить для ресурса/категории, отсутствующей в
  features.
- Нельзя назвать `busyMs` значением TBT или field TTFB без соответствующего
  source/method label.
- Один и тот же input даёт согласованные score, counts, chains и рекомендации
  во всех представлениях.
- Формат report version отражает изменения публичной схемы (`1.1.0`).
- `npm run typecheck`, `npm test` и `npm run build` проходят; новые fixtures
  проверяют перечисленные инварианты.

## Приоритеты

P0: issues 1–3 — ложные causal chains, неверная семантика метрик и score.
P1: issues 4–6 — неприменимые рекомендации, рассинхронизация outputs и
регрессионное покрытие.
P2: issue 7 — улучшение agent-facing interpretation contract после стабилизации
данных.
