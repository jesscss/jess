# Less Integration — driving Jess `.less` to green

**Goal:** get the Jess `.less` suite (esp. `all-less` — the less.js spec corpus) to green
so the Less v5-alpha integration branch can compile `bootstrap.less` → `.css` and be
benchmarked. Sibling tracker to [CORE-CLEANUP.md](./CORE-CLEANUP.md) (which drove core's own
unit suite 85→0). Branch: `feature/parseman`.

## Method — reproduce-in-core-FIRST (non-negotiable)
Every broken Less fixture is a symptom. The fix belongs in **`packages/core`** (the engine),
not band-aided in the plugin/integration layer.

1. Take a failing fixture/cluster. Identify the throw/diff and the core file it originates in.
2. **Reproduce it as a minimal `packages/core` unit test** — a small constructed tree +
   eval/serialize call that hits the same throw/diff (no less pipeline where avoidable).
3. Fix in core so the core repro passes. Keep the core repro test.
4. The integration fixture(s) then fall out green. Gate + merge.
5. If a cluster genuinely can't be reproduced in core (needs the file layer or a subprocess),
   say so explicitly and test at the integration layer — but that's the exception.

## Test setup
- **Tests resolve to SOURCE** now (`vitest.config.ts` `source` condition) — edit `core/src`, rerun,
  no rebuild. Run: `cd packages/jess && TEST=true npx vitest run [file] [-t name]`.
- Core repros: `cd packages/core && npx vitest run <file> -t <name>`.
- **Caveat:** a few all-less fixtures load a package via NATIVE Node (`.cjs` Less config →
  `import.less`, `import-remote.less`) and can't load `.ts`; validate that narrow set against
  built `lib`. Not real rendering bugs.

## Gate / merge rules (same discipline as CORE-CLEANUP)
- One cluster per branch `less/<slug>` + worktree off `feature/parseman`.
- Core clusters touch HOT core files (serialize-helper, ampersand, ruleset, node-base, reference,
  scope-frame) → **sequence them** (don't run two core clusters in parallel). Disjoint foci
  (compat-plugin build-health, security sandbox) may parallelize.
- DONE when: the core repro passes AND the cluster's integration fixtures pass AND no NEW stable
  failures (core suite must stay 0; jess suite must not regress). Merge only on green.
- No backwards-compat shims, no dedupe-to-hide, no runtime shape-shims. `F_VISIBLE` by-type at
  construction. Short idiomatic identifiers. Author `Matthew Dean <matthew-dean@users.noreply.github.com>`, `--no-verify`.

## Baseline
Jess suite (source mode): **~86 failed / ~69 passed** (2 are native-load artifacts). all-less = 55/93.
Split: ~70% hard crashes (empty CSS), ~11% scope 'not defined', ~19% output diffs.

## Clusters (from triage) — leverage-ranked

- [ ] **A — node-vs-string eval/serialize (~24 tests, HIGHEST leverage).** String-normalization
  migration fallout: node methods invoked on now-string values. `.writeSyntax is not a function`
  (`serialize-helper.ts:1086` → `ampersand.ts:450/467`) powers **all 6** at-rule-bubbling tests +
  3 all-less at-rules fixtures; `.eval`/`.hasFlag` on strings (~10); `Expected node array item to
  evaluate to a node` (merge/each); `Expected selector component copy` (`ruleset.ts:417`);
  `Cannot operate on Keyword/Paren` (mixins/calc). **Core-reproducible, easily.** Relates to
  [[feedback-string-normalized-nodes]]. → START HERE.
- [ ] **B — import base dir = CWD not importer dirname (~19 tests).** CONFIRMED root cause: the
  functional Less parser is context-free and `LessPlugin.safeParse` (jess-plugin-less/src/index.ts)
  never attaches its file-bearing `TreeContext` (createTreeContext → file.path=dirname) to the parsed
  root `Rules`. So `rules._treeContext` is undefined → `rules.ts:5410` never sets `context.treeContext`
  with `file` → `context.ts:490` `currentDirectory` falls back to `process.cwd()` → throw at
  `context.ts:574 File not found (from: <cwd>)`. FIX: safeParse attaches context to the root Rules
  (post-parse; Rules ctor takes `treeContext?` 4th param, stored rules.ts:3820, but the parser doesn't
  pass it). The OLD Chevrotain `parse(src,'stylesheet',{context})` passed it to the parser which
  attached it — the functional migration dropped that. **Mostly a PLUGIN fix**; may need a tiny core
  setter if `_treeContext` isn't externally assignable (check for rules.ts conflict with Cluster A).
  Core-repro: construct a Rules with vs without a file-bearing treeContext, assert `_getPath` base =
  file.path when present, cwd otherwise. Clears path-resolution(3) + import/charset/namespacing
  fixtures. (url-rebasing subset stays failing — unimplemented.)
- [ ] **C — scope/binding unresolved (~10 tests).** `Binding cell has no value` (`scope-frame.ts:53`
  via `reference.ts`), `'X' is not defined` (height/sub/primary), `No matching mixins`. Live-binding
  materialization timing. Likely 2-3 sub-bugs. Core-reproducible. Relates to [[mixin-output-frame-linking]],
  [[feedback-setdefined-cell-not-node]].
- [ ] **E — compiler lifecycle / root output (~7 tests).** compiler-reuse(6)+public-api(1):
  `undefined.valueOf`, visitor hooks returning undefined, evaluated root not retained for
  serialization/visitors; plus `@import "x.css"` → `url("x.css")` serialize diff. Core-reproducible.
- [ ] **D — color math → `#NaNNaNNaN` (3-5 tests).** Channel values arriving as strings → NaN.
  May collapse into A. Recheck after A.
- [ ] **F — @plugin security sandbox (6 tests, `security-script-runtime`).** Deno/plugin-js lazy-load +
  sandbox gating. Integration-only (spawns subprocesses) — NOT a core repro. Parallelizable, isolated.
- [ ] **G — output-format diffs (~8 one-offs).** spacing, `!important` placement, nesting collapse,
  comments/whitespace, data-uri inlining. Low leverage tail; some may be stale expectations.

## Pre-work
- [x] **Build-health pass** — DONE (merge b06132614). `jess-plugin-less-compat` now builds tsc-clean
  against current core API: `.location`→`sourceSpanOf(n)?.start`; the `.location`-as-`currentFileInfo`
  proxy removed (fileInfo defaults to `{}`); `Any` name-wrapper → `string|Interpolated` direct assign;
  `SelectorLike` widened + array branch; and a real **`from-less.ts 'out'` ReferenceError** (copy-paste
  bug: returned undefined `out` instead of `decl` for Declaration/Rule plugin nodes). Load-bearing
  less.js adapters (`less-adapter.ts` Element/Selector shape for 3rd-party plugins) kept. all-less
  unchanged (58/35) — compat build was infra, not a fixture-failure source. **Follow-up:** the compat
  package's own `vitest.config.ts` lacks the root's `source` condition, so its integration tests need
  built libs — test-harness gap to fix.

## Design / cleanup follow-ups (after correctness clusters)
- [ ] **context-trim** — base `Node` ctor takes no context (good), but ~8 types carry their own
  `_treeContext` field: `Rules` + `import-style` (legit — doc/import roots ESTABLISH context) and
  `function`, `dimension`, `any`, `expression`, `block`, `at-rule-statement` (OVERKILL — they can read
  the eval-time `context`/`sourceRoot._treeContext`). Drop `_treeContext` from those 6 + their parser
  build sites. HOT-file refactor → sequence after B/C/E. Pairs with B (both treeContext plumbing).

## Log
- **build-health** (b06132614): compat plugin builds against current core API; from-less 'out' fix.
