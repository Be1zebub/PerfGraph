# Состояние миграции MCP → skill

## Текущее состояние

- Основной CLI entry point: `src/index.ts`.
- Полный пользовательский путь: `perfgraph run --url <url>`.
- CLI `run` создаёт `insights.toon`, `features.toon`, `graph.toon`,
  `report.toon`, `report.md`, `manifest.toon` и raw artifacts.
- MCP-код находится в `src/mcp/`, `src/cli/mcp.ts` и `test/mcp/`.
- MCP подключён через `src/index.ts` и `@modelcontextprotocol/sdk`.
- README и `AGENTS.md` содержат MCP-first инструкции и устаревшие ссылки на
  `perfgraph_analyze`.
- В рабочем дереве есть незакоммиченные MCP-related изменения. По решению
  владельца проекта они считаются экспериментом, который удаляется, и не
  должны быть перенесены в новую реализацию.
- CLI smoke-run на `https://example.com` стартовал, но в текущем окружении был
  заблокирован сетью с `ERR_NETWORK_ACCESS_DENIED`; это подтверждает, что skill
  обязан различать failed collection и плохую производительность.
- Fixture-based extraction/report run дал реальный пример: `poor`, Lighthouse
  Performance `0.61`, 2 critical, 6 warnings, 2 info; ведущая цепочка — main
  thread/TBT `3200ms` → possible INP delay.

## Принятые решения

| Решение | Причина |
| --- | --- |
| MCP удалить полностью | Нестабильность transport layer и постоянные таймауты |
| CLI оставить единственным runtime interface | CLI уже работает стабильно у агентов |
| Skill сделать инструктивным слоем | Skill не дублирует pipeline и не требует отдельного server protocol |
| TOON сохранить | Формат уже используется CLI и уменьшает объём агентского контекста |
| `insights.toon` читать первым | Это компактная точка входа для triage |
| raw data читать только для deep dive | Trace/network/Lighthouse могут быть большими |
| Не менять алгоритмы анализа в рамках миграции | Миграция касается agent UX и транспорта |

## Решения по открытым вопросам

| Вопрос | Решение |
| --- | --- |
| Где публикуется skill | `skills/perfgraph/` в репозитории, входит в npm package через `files: ["skills/"]` |
| Установленный бинарник или локальный fallback | Оба: skill предлагает `perfgraph`, при отсутствии — `node dist/index.js` |
| Явный `--runs 1` | Не рекомендуется явно: default = 1, skill описывает `--runs 3` для вариативности |
| Отдельный subcommand для чтения run directory | Не нужен: достаточно инструкций skill по чтению артефактов |
| Golden URL для сетевого smoke test в CI | Не используется: CI выполняет typecheck, tests и build без сети |
| Machine-readable `interpretation` section в report | Не нужен: правила интерпретации живут в skill и в `references/interpretation.md` |

## Следующий шаг

Реализация issue 1–6 завершена и закоммичена. Остаточные задачи вынесены за
рамки миграции: trace overlap как optional evidence source и machine-readable
interpretation section, если это потребуется позже.

## Фактический результат

- MCP source, tests, CLI subcommand и SDK dependency удалены.
- `skills/perfgraph/SKILL.md` и `references/interpretation.md` добавлены.
- Build очищает `dist` перед компиляцией, поэтому старые MCP artifacts не
  попадают в npm package.
- Typecheck, build, tests и skill validation прошли.
