# Contributing

You want to help? Cool. Here's how this works.

## Project structure

```
src/
├── index.ts          CLI entry — lazy-loads everything else
├── collect/          Phase 1: browser data collection (Playwright + CDP)
├── normalize/        Phase 2: raw data → validated IRBundle
├── extract/          Phase 3: IRBundle → diagnostic FeatureSet
├── causal/           Phase 4: FeatureSet → causal degradation graph
│   └── rules/        30+ causal inference rules
├── report/           Phase 5: graph → JSON report with remediations
├── distill/          Agent-optimized summary layer (insights.json)
├── mcp/              MCP stdio server for AI agent integration
├── cli/              CLI command implementations
├── output/           Shared output writer helpers
└── shared/           Utilities, types, fs helpers
```

Stack: TypeScript (strict), Node.js ≥ 22, Playwright, Lighthouse, Zod, Vitest.

## Getting started

```bash
npm install
npm run build
npm test
```

No build step needed for development — use `npx tsx src/index.ts` or `npm run dev`.

## Guidelines

- **No implicit any, no @ts-ignore, no @ts-expect-error.** Strict mode is strict.
- **Zod at the boundary.** Validate external data (CDP, Lighthouse, file I/O) the moment it enters the system. Internal code works with typed IR.
- **Tests for every extractor and rule.** If you add a new feature extraction or causal rule, it needs a test. Look at `test/extract/` or `test/causal/` for the pattern.
- **Evidence, not boilerplate.** If you touch `causal/rules/` or `report/remediations.ts`, attach real URLs, selectors, and metric values. Generic DevTools advice isn't useful.
- **Commit style.** We keep a linear history. Rebase-friendly. Commit messages are concise and describe what changed, not why. (Why goes in the code or the PR description.)

## Reporting issues

Bug reports are welcome. Include:
- The URL you tested
- The command and flags you ran
- The output (or relevant parts of it)
- What you expected vs what happened

Feature proposals are welcome too. Open an issue with "Feature:" in the title and a brief description of what you want to build and why.

## PR workflow

1. Open an issue first so we agree on direction.
2. Fork, branch, commit.
3. Make sure `npm run typecheck && npm test` passes.
4. Open PR. Keep it focused — one change per PR.

## Code of conduct

Don't be an asshole. That's it.
