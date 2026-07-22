# Queued: group `packages/*` by syntax

Status: **QUEUED — do not start while parallel worktrees/agents are in flight.**

## Grouping ≠ merging (the crux)

Co-locate a parser with its plugin under a per-syntax directory
(`packages/syntax/less/less-parser` + `packages/syntax/less/jess-plugin-less`) —
but keep them as **separate npm packages**. Merging them into one package was rejected up front
and stays rejected: `less-parser` is consumed by `scss-parser`,
`language-service`, and `jess-plugin-less-compat`, so folding it into
`jess-plugin-less` would drag the plugin's heavy deps (`core`, `fns`,
`style-resolver`) into the SCSS grammar and the language server, and invert the
dependency graph. This doc is about **directory co-location only** — names and
package boundaries are unchanged.

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

## Recommended organization — by syntax

A single `packages/syntax/` parent holds one directory per syntax, each with that
syntax's parser + plugin(s). Cross-syntax infra (core, the shared parser
runtime), the app/CLI, capability plugins, and tooling stay flat. Package
**names stay identical** — only directories move, so imports don't change.

```
packages/
  syntax/
    css/                     # the shared base syntax
      css-parser/
      jess-plugin-css/
    less/
      less-parser/
      jess-plugin-less/
      jess-plugin-less-compat/
    scss/
      scss-parser/
      jess-plugin-scss/
    jess/                    # the .jess syntax — nests fine (packages/syntax/jess/,
      jess-parser/           #   distinct from the packages/jess CLI package)
      jess-plugin-jess/
  ...flat: core, fns, config, style-resolver, awaitable-pipe, patch-css,
     parser, parser-runtime, internal-css-recognition,        # shared parser infra
     jess (the umbrella CLI), jess-plugin, jess-plugin-js, jess-plugin-node-modules,
     rollup-plugin-jess, language-service, language-service-tests, vscode, extension
```

Two things to know before doing it:

- **Nesting under `syntax/` resolves the `jess/` name collision.**
  `packages/jess/` remains the umbrella CLI package; the `.jess`-syntax group is
  `packages/syntax/jess/`, a different path — no clash, and the name reads
  naturally.
- **Syntax groups are not self-contained — and that's fine.** `css-parser`
  (base) is consumed by both `less-parser` and `scss-parser`; `scss-parser`
  (in `syntax/scss/`) depends on `less-parser` (in `syntax/less/`);
  `language-service` (flat) consumes both parsers. Directory grouping is purely
  cosmetic, so these cross-group edges are expected and harmless — they are
  exactly why the packages must stay separate rather than merge (see
  "Grouping ≠ merging").

## Tooling to update when landing

- `pnpm-workspace.yaml` — `packages/*` → add `packages/syntax/*` (nested), or
  switch to `packages/**`.
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
