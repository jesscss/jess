# Queued: group `packages/*` by domain

Status: **QUEUED — do not start while parallel worktrees/agents are in flight.**

## Why queued (blast-radius caveat)

A directory move touches path-literals across nearly every branch, so it will
collide with essentially every open worktree/cutover branch and force painful
rebases. Land it as **one atomic, standalone PR only when the tree is quiet**
(no parallel cutover/agent branches outstanding) — never piecemeal, never
alongside other work.

This is **purely cosmetic**. Module resolution is by package name
(`@jesscss/less-parser`), not path, so grouping changes no dependency edge and
no build behaviour. It does **not** address the parser-vs-plugin layering
question that prompted it (a grouped `less-parser` still depends on `core`
exactly as today). If the real goal is legible layers, prefer a
`dependency-cruiser` layering rule or an `ARCHITECTURE.md` graph — zero churn.

## Prerequisite (do this first, independently — it pays off regardless)

De-hardcode `packages/<pkg>` literals so a move (this one or any future one) is
nearly free and the tooling gets more robust either way:

- `scripts/*.mjs` — dozens of literal `packages/<pkg>` strings
  (`verify-baseline`, `bench-compare-ref`, `verify-binding-lookup-hot-paths`,
  `test-core-debug`, `verify-node-copy-frontier`, …).
  Resolve package roots via `pnpm ls -r --json` / `require.resolve` instead.
- `vitest.config.ts` — `resolve(root, 'packages/<pkg>/...')` literals
  (css-parser jess entry, perf-test excludes).

## Recommended organization

Group only the cohesive clusters; leave core/fns/jess/plugins flat. Half the
churn, most of the readability. Package **names stay identical** — only
directories move, so imports don't change.

```
packages/
  parsers/
    css-parser/
    less-parser/
    scss-parser/
    jess-parser/
  language/
    language-service/
    language-service-tests/
    vscode/
    extension/
  ...everything else stays flat (core, fns, jess, plugin-*, style-resolver, …)
```

## Tooling to update when landing

- `pnpm-workspace.yaml` — `packages/*` → add nested globs
  (`packages/parsers/*`, `packages/language/*`) or switch to `packages/**`.
- `tsconfig.json` — the `@jess/*` → `./packages/*/src` wildcard becomes
  `./packages/**/src` (or explicit); update the ~8 explicit per-package `paths`
  entries for moved packages.
- `vitest.config.ts` — the `'packages/*'` project glob + any remaining
  `resolve(root, 'packages/<pkg>/...')` literals not removed in the prerequisite.
- `packages/config` — anything mirroring the workspace layout.
- Any remaining hardcoded `packages/<pkg>` in `scripts/` not removed by the
  prerequisite.

## Do NOT include in the move

- No package renames (`@jesscss/*` names are stable).
- No dependency-graph changes — the parser/plugin split stays as-is (see the
  reverse-dependency analysis: `less-parser` is consumed by `scss-parser`,
  `language-service`, and `plugin-less-compat`; `scss-parser` by
  `language-service` — so neither parser folds into its plugin).
