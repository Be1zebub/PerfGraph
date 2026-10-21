# State

## Baseline

- Источник сравнения: `_results/perfgraph.md` и `_results/web-perf.md`.
- URL: `https://example.com`.
- PerfGraph: LCP 795 ms, CLS 0, TBT 18.5 ms, TTFB 815 ms, Lighthouse 100,
  score `MODERATE`, пять warnings.
- Web-perf: lab LCP 105 ms, CLS 0, TTFB 2 ms; field LCP 587 ms и TTFB 124 ms;
  verdict — оптимизация не нужна.
- Значения lab/field и разных запусков напрямую не сравниваются без source,
  timestamp, network profile и repeat policy.

## Подтверждено кодом

- `src/causal/rules/lcp.ts` связывает любой TTFB выше 800 ms с delayed CSS
  discovery и blocked render, не проверяя наличие stylesheet.
- Render-blocking rule использует aggregate count; текущий контракт не исключает
  HTML document из evidence.
- `src/report/scorer.ts` трактует любое warning как минимум `moderate`, если
  Lighthouse override не сработал.
- `src/report/analyzer.ts` previously строил recommendation из каждого
  critical/warning; current worktree уже ограничивает их observed metric/evidence
  nodes, но applicability по типу действия ещё требует дальнейшей работы.
- Report schema валидирует форму, но не гарантирует causal validity и provenance.

## Необходимо проверить при реализации

- Откуда именно берутся `renderBlocking` и `criticalPath` values в collectors/
  normalizers и где лучше фильтровать HTML.
- Почему сохранённый PerfGraph output содержит Lighthouse 100, но score
  `MODERATE`; нужен fixture, воспроизводящий этот путь.
- Нужно ли добавлять новые поля в публичный JSON report или сначала достаточно
  усилить существующий `Evidence`.

## Ограничения

- Markdown outputs не содержат raw artifacts, поэтому нельзя ретроспективно
  доказать точность web-perf field values.
- Тесты должны проверять причинную применимость, а не конкретные timing values
  живых внешних сайтов.

## Implemented in current worktree

- `Document` is excluded from render-blocking extraction; network blocking
  resources are retained as explicit evidence.
- TTFB LCP chains add CSS/render-blocking nodes only when stylesheet evidence is
  present; otherwise the relationship is reduced to a qualified weak signal.
- `run` passes the Lighthouse Performance score into report scoring.
- Recommendations are anchored to observed metric/evidence nodes and use
  verification-oriented impact language.
- `busyMs` is no longer emitted as TBT; measured TBT is carried separately when
  available, and the JS causal rule uses a main-thread contention signal when it
  is absent.
- Added regression coverage for the minimal HTML/borderline-TTFB case and the
  document render-blocking false positive.
- `Insights` now exposes the same partial-data status vocabulary and preserves
  real TBT separately; local tests cover missing data and LCP source conflicts.
- `Insights` falls back to FeatureSet render-blocking resources when Lighthouse
  has no resource list, keeping the agent-facing resource evidence available.
- Manifest and Markdown explicitly expose the updated metric/data-quality
  semantics.
- Borderline TTFB-only warnings no longer downgrade the fallback score to
  `moderate`; actionable warning categories still do.
- Added a deterministic diagnostic-quality fixture matrix covering minimal HTML,
  stylesheet, TBT/busyMs distinction, CLS/network signals, incomplete input and
  report/insights consistency.
- Causal graph nodes and report chain paths now carry explicit `basis` values:
  `observed` or `inferred`, while node `type` remains the role/impact category.
- Report format version is `1.1.0` because issue and chain-path records now carry
  the explicit node basis contract.

## Definition of done

Спека считается реализованной только после прохождения acceptance criteria из
`index.md`, обновления англоязычного `skills/perfgraph` interpretation guidance
и проверки всех пяти фаз тестами/сборкой.

## Completion audit

Все acceptance criteria выполнены в текущем worktree: полный test suite,
typecheck, build и diff check проходят; deterministic diagnostic-quality tests
покрывают минимальную HTML-страницу, stylesheet, measured TBT, CLS/network,
incomplete input и report/insights consistency.

## Проверка на реальных сайтах

Спека проверена двумя прогонами против живых сайтов (bzbb.dev и
silk.bzbb.dev) с независимым чтением артефактов. Прогоны выявили, что
часть «диагностик» опиралась на неверные данные, и это исправлено:

- trace-событие LCP искалось под именем, которого Chrome не выдаёт, поэтому
  трейсовый LCP не извлекался никогда; LCP-элементом назначалась самая
  «крупная» скачанная картинка (favicon);
- LCP теперь берётся из Performance API (финальный кандидат) вместе с
  настоящими `loadTime`/`renderTime`, а ресурс не атрибутируется без
  доказательства, что LCP-элемент — изображение;
- `bootupTime`, `evaluatedScripts` и счётчик long tasks были эвристиками по
  console-сообщениям; теперь long tasks берутся из trace-событий `LongTask`,
  время компиляции — из `V8.Compile*`, число скриптов — из сетевого лога;
- длительность трейса считалась от события без таймстампа, из-за чего все
  производные отношения схлопывались в ноль и правило main-thread никогда не
  срабатывало — самый сильный сигнал (TBT 1.3–1.9 с) не доходил до отчёта;
- main-thread активность суммировалась по `tid` без учёта процесса, что
  завышало занятость потока в разы;
- `renderBlockingScore` был инвертирован относительно правила, которое его
  читало: семь блокирующих ресурсов выглядели хуже одного;
- ресурс считался блокирующим рендер независимо от момента запроса, поэтому
  route-CSS, загруженный после первой отрисовки, попадал в отчёт;
- TTFB брался из первого document-запроса, а LCP — из последней навигации,
  что давало физически невозможное TTFB больше LCP;
- один и тот же URL, загруженный дважды, считался дважды;
- размеры тела брались из `responseReceived` (только заголовки), поэтому
  суммарные байты были в 150 раз меньше реальных;
- предупреждения прогона и Lighthouse (`runWarnings`) не доходили до
  артефактов, и отчёт заявлял `dataQuality: complete`;
- insights и report содержали непересекающиеся наборы рекомендаций.
- время до первого байта складывалось неверно: TLS считался дважды, а под
  «ожиданием сервера» стояло время отправки запроса. Для документа с
  первым байтом через 892 мс отчёт писал 0.3 мс и рекомендовал не трогать
  сервер, пока Lighthouse писал 236 мс;
- занятость главного потока суммировала вложенные события трейса и могла
  превышать длительность самого трейса; кроме того, события разных
  процессов складывались по общему `tid`;
- Total Blocking Time включал long task с font thread, который не блокирует
  ввод;
- документ, который браузер загрузил и бросил, не попадал в отчёт вообще —
  хотя это была самая крупная измеренная потеря у bzbb.dev;
- неуспешные аудиты Lighthouse (forced reflow, main-thread work, ошибки
  консоли) были видны только в deep-dive файле.

Что добавлено по итогам:

- `criticalPath.documentChain`: цепочка документов с двумя измеренными
  величинами — во сколько миллисекунд позже пришёл контент, который
  увидел посетитель, и сколько серверного времени ушло на ответ, который
  никто не использовал;
- `insights.lighthouse.failedAudits`: неуспешные аудиты Lighthouse со
  значениями, без необходимости открывать сырой результат;
- `insights.documentResponse`: заголовки документа, которые иначе агент
  добывал отдельным запросом к сайту;
- находки из Lighthouse-insight-аудитов (forced reflow, лишние байты
  картинок, некэшируемые ресурсы, дубли и legacy JavaScript, блокирующие
  шрифты) стали issues отчёта со значением и источниками;
- дерево зависимостей берётся из инициаторов запросов, когда Lighthouse не
  смог построить своё.

Report format version is `1.3.0`.

## Проверка на естественном промпте

Прогоны с промптом пользователя, а не с директивами, выявили то, чего не
показывали проверки по артефактам:

- `perfgraph run --url google.com` падал: без схемы URL не принимался, и
  ошибка печаталась стектрейсом;
- `perfgraph --help` не упоминал skill вообще;
- агент не знал, что прогон идёт около трёх минут, и что первый прогон
  часто выброс;
- агент добывал заголовки документа и самый тяжёлый ресурс вручную, а
  медиана по прогонам отсутствовала в сводке;
- обход дерева критического пути падал на запросе, инициированном самим
  собой — Google отдаёт такой;
- отчёт и insights по-разному оценивали качество данных одного прогона.

## Что дало чтение полных сессий агентов

Отчёты агентов показывали результат, но не путь к нему. Чтение сессий
(они лежат в базе opencode) вскрыло две вещи, которых не видно в отчёте:

- агенты грузили **копию skill'а от сентября**, а не живой файл: все правки
  skill'а до этого не доходили до них. Skill теперь ставится ссылкой, а его
  версия видна в заголовке;
- агент первым действием грузил **конкурирующий skill** `web-perf` —
  июньскую версию на Chrome DevTools MCP, которую проект заменил.

После исправления установки пере-тест показал разницу в поведении:

| | копия от сентября | живой skill |
| --- | --- | --- |
| вызовов `skill` | 2, первым шёл конкурент | 1, только целевой |
| `curl` за заголовками | да | нет — «the run will provide `insights.documentResponse`» |
| знание о ~3 мин на прогон | нет | да, прогон ушёл в фон с большим таймаутом |
| медиана и холодный старт | не знал, оговорился сам | снял critical-вывод как выброс, взял медиану |

Агенты нашли и то, что не нашёл я: сводка по прогонам считала разброс по
метрикам Lighthouse, а отчёт описывает лабораторный прогон; и «21% third-party»
на github.com — это собственная инфраструктура GitHub, а не чужие вендоры.

И ещё одно: вердикт раздувался. Одна находка Lighthouse давала узел и его
impact-«эхо», и оба считались critical — страница с зелёными CWV и
Lighthouse 99/100 получала «poor». Impact-узел теперь только называет
последствие и не поднимает вердикт, а LH-находка — максимум warning:
решают измеренные сигналы самого прогона. Заодно проверка регрессии
смотрит на единицу: 245 980 байт картинок больше не читаются как
245-секундная задержка.
