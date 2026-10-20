# Миграция PerfGraph с MCP на CLI skill

## Статус

Реализация завершена; ниже зафиксирован фактический migration contract и
результаты release gate.

## Контекст

PerfGraph имеет два способа запуска одного и того же диагностического
пайплайна:

```text
collect → normalize → extract → analyze → report
```

CLI уже стабильно выполняет полный пайплайн командой `perfgraph run` и пишет
агент-ориентированные артефакты. MCP дублирует orchestration layer, добавляет
stdio/JSON-RPC transport, MCP tools, resources, prompts и progress
notifications. На практике MCP нестабилен и часто заканчивается таймаутом,
тогда как CLI используется агентами без этой проблемы.

## Решение

Полностью удалить MCP из продукта и сделать CLI единственным исполняемым
интерфейсом для performance analysis. Инструкции для AI-агентов оформить как
skill, который:

1. определяет, когда запускать PerfGraph;
2. даёт безопасную команду запуска CLI;
3. описывает параметры `run` и дополнительные команды;
4. задаёт порядок чтения результатов;
5. объясняет структуру `insights.toon`, `report.toon`, `graph.toon`,
   `manifest.toon`, `report.md` и raw-артефактов;
6. описывает обработку ошибок, warnings и неполных результатов;
7. задаёт правила интерпретации отчёта без выдумывания метрик.

## Интерпретация результата

Skill должен направлять агента минимум по следующим векторам, а не заставлять
его пересказывать JSON целиком:

### 1. Executive triage

Сначала дать короткий статус: URL, общий `summary.score`, Lighthouse
Performance если доступен, количество critical/warning/info и один главный
вывод.

### 2. Root cause → impact

Для каждого приоритетного causal chain отделить наблюдаемый сигнал/metric,
bottleneck или вероятную причину, пользовательский impact и confidence цепочки.
Нельзя называть impact доказанным фактом, если chain имеет weak/medium
confidence или в отчёте есть только косвенный сигнал.

В итоговый ответ следует включать компактный ASCII causal graph для 1–3 самых
важных цепочек. Граф строится только из `report.chains[].path` и не должен
добавлять связи, которых нет в отчёте:

```text
[Main thread blocked: 3200 ms]
        │ confidence: strong
        ▼
[High Total Blocking Time]
        │ confidence: medium
        ▼
[Possible INP delay]
```

Для нескольких независимых цепочек использовать отдельные ветки. Длинные
labels нужно сокращать до 60–80 символов, сохраняя metric и severity. Если
chain отсутствует, граф не рисовать и написать, что causal chain не была
построена.

### 3. Core Web Vitals

Отдельно проверить LCP, CLS и доступный TBT/INP signal. Для LCP смотреть
breakdown и LCP element, для CLS — наличие реальных shift clusters, для TBT/INP
— long tasks и main-thread blocking. Не подменять отсутствующий INP фактически
измеренным INP.

### 4. LCP и render path

Проверить TTFB, resource delay, render delay, LCP resource, render-blocking
URLs и critical request chain. Рекомендация должна ссылаться на конкретный URL,
selector или duration, если evidence присутствует.

### 5. JavaScript и main thread

Сопоставить TBT/main-thread blocking, число long tasks, execution hotspots,
third-party ratio и предполагаемый INP impact. Дубликаты одной причинной цепи не
выдавать как независимые первопричины.

### 6. Network, layout и third-party

Оценить глубину и длительность critical chain, request waterfall, render
blocking, CLS/layout shifts и third-party overhead только при наличии
соответствующего сигнала. Большое число запросов само по себе не равно
bottleneck.

### 7. Приоритизация действий

Сформировать 3–5 действий в порядке: critical root cause, high-impact blocking,
проверка неопределённости, затем medium/low polish. Для каждого действия
указать evidence и способ проверки после исправления.

### 8. Data quality

До интерпретации прочитать warnings. Явно отметить пропущенные collectors,
неполный trace, недоступный Lighthouse или ограничения окружения. Ошибка
сбора — это не плохая производительность.

### Пример итогового ответа агента

Для результата с `score=poor`, Lighthouse Performance `61`, `2 critical`,
`6 warnings` и `2 info` хороший ответ должен выглядеть примерно так:

```text
Статус: poor. Главный bottleneck — JavaScript/main thread: TBT 3200 ms,
confidence strong; causal chain указывает на возможную задержку INP.

Вторичный фактор — render-blocking ресурсы и LCP около 2800 ms. Это повышает
задержку первого крупного элемента, но цепочка имеет medium confidence.

Что исправлять сначала:
1. Разбить long tasks и сократить JS execution/hydration.
2. Проверить render-blocking CSS/JS и critical request chain.
3. Повторить замер и сравнить TBT, LCP и число long tasks.

Ограничение: INP здесь не измерен напрямую; это causal impact, а не field INP.
Warnings и отсутствующие данные нужно показать отдельно.
```

Конкретные числа, URLs, selectors и названия chains всегда должны браться из
текущих `report.toon`/`insights.toon`, а не из этого примера.

## Цели

- Убрать MCP server, MCP transport и MCP-specific surface из npm-пакета.
- Сохранить полный функциональный pipeline CLI.
- Сделать skill воспроизводимым для агентов, умеющих запускать shell-команды.
- Сохранить компактные TOON-артефакты как основной формат для чтения агентом.
- Устранить противоречивую документацию про `perfgraph_analyze` и MCP.
- Проверить, что опубликованный пакет не содержит MCP-кода и не требует MCP
  dependency.

## Не входит в задачу

- Изменение алгоритмов сбора, нормализации, extraction, causal graph или
  scoring.
- Переписывание формата `report.toon`.
- Создание отдельного AI/LLM API внутри PerfGraph.
- Автоматический fix исходного сайта.
- Добавление нового MCP compatibility mode.
- Исправление всех исторических проблем качества метрик, если они не нужны
  для стабильного CLI/skill-контракта.

## Целевое устройство

```text
AI agent
   │
   └── shell: perfgraph run --url <url> --output <dir> --pretty
                    │
                    ├── insights.toon   ← читать первым
                    ├── report.toon     ← основной диагноз
                    ├── report.md       ← человекочитаемый отчёт
                    ├── graph.toon      ← causal deep dive
                    ├── manifest.toon   ← индекс файлов
                    └── raw files       ← только при необходимости
```

Skill не должен сам реализовывать pipeline или копировать бизнес-логику
PerfGraph. Его задача — маршрутизация запроса, запуск CLI и корректное чтение
готовых артефактов.

## План реализации

### Этап 1. Зафиксировать CLI-контракт

- Проверить фактический набор файлов, который создаёт `perfgraph run`.
- Зафиксировать команды, флаги, exit behavior и правила выбора output directory.
- Определить минимальный smoke test на локальном URL и fixture-based проверки,
  не требующие сети.

### Этап 2. Удалить MCP

- Удалить MCP source, tests и CLI subcommand.
- Удалить MCP SDK и связанные package metadata.
- Проверить, что lazy loading CLI не импортирует MCP косвенно.
- Пересобрать lockfile и проверить содержимое npm-пакета.

### Этап 3. Создать skill

- Добавить skill с коротким trigger description.
- Описать стандартный запуск, параметры desktop/mobile и multi-run.
- Описать read order и deep-dive decision tree.
- Явно указать, что `.toon` читается как текст, а не как JSON.
- Добавить error/warning handling и fallback для отсутствующего глобального
  бинарника.

### Этап 4. Обновить документацию и требования

- Переписать README и AGENTS.md под CLI + skill.
- Удалить MCP из quick links, architecture tree, examples и requirements.
- Добавить traceability для skill и CLI agent UX.
- Удалить устаревшие названия `perfgraph_analyze`, если они относятся к старому
  MCP API.

### Этап 5. Верификация

- `npm run typecheck`.
- `npm test`.
- `npm run build`.
- CLI `--help` и `run --help`.
- Smoke run на доступном URL или golden/local fixture.
- Проверка `npm pack --dry-run`: MCP source и SDK не должны попадать в пакет.
- Проверка grep на оставшиеся MCP runtime/docs references.

## Критерии готовности

- В репозитории нет исполняемого MCP server, MCP CLI-команды или MCP SDK в
  dependencies.
- `perfgraph run --url ...` по-прежнему создаёт итоговый report и все заявленные
  agent-facing artifacts.
- Skill содержит однозначный workflow от URL до интерпретации результата.
- Агент сначала получает компактный summary, затем читает полный report и только
  после этого raw data.
- Документация не обещает MCP и не ссылается на несуществующий
  `perfgraph_analyze`.
- Typecheck, tests, build и package-content checks проходят.
- Незакоммиченные старые MCP-изменения не переносятся в новую реализацию:
  удаление MCP выполняется относительно текущего базового состояния проекта.

## Риски и решения

| Риск | Решение |
| --- | --- |
| Агент не имеет глобальной команды `perfgraph` | Skill описывает проверку бинарника и fallback на локальный `node dist/index.js` после build |
| Output содержит большие raw-файлы | Skill задаёт жёсткий read order и deep-dive только по необходимости |
| README и GSD-документы расходятся | Обновить продуктовые docs и отдельно пометить исторические planning artifacts |
| CLI меняет имена файлов | Добавить contract test на artifact manifest и skill-facing output |
| CLI долго выполняется | В skill явно указать увеличенный shell timeout; не маскировать timeout как успешный анализ |

## Связанные issue

- [Issue 1 — удалить MCP runtime](issues/1.md)
- [Issue 2 — закрепить CLI output contract](issues/2.md)
- [Issue 3 — создать CLI skill](issues/3.md)
- [Issue 4 — обновить документацию и project planning](issues/4.md)
- [Issue 5 — тестирование, упаковка и release gate](issues/5.md)
- [Issue 6 — interpretation contract для skill](issues/6.md)

## Реализация и проверки

- MCP source, tests, CLI subcommand и SDK dependency удалены.
- CLI skill добавлен в `skills/perfgraph/` и включён в npm package contents.
- `npm run typecheck` — passed.
- `npm test` — 36 files, 464 tests passed.
- `npm run build` — passed with stale `dist` cleanup.
- Skill validator — passed.
- `npm pack --dry-run` — skill included; MCP artifacts absent.
- Network smoke-run был заблокирован окружением (`ERR_NETWORK_ACCESS_DENIED`),
  поэтому live URL performance verdict не выдавался.
