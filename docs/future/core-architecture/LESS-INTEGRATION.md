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
- [ ] **B — import base dir = CWD not importer dirname (~19 tests).** One resolver bug: relative
  `@import` resolved against `process.cwd()`/root, not the importing file's directory. Clears all 3
  path-resolution tests + import/charset/namespacing-import fixtures. Core-reproducible with a mock
  file manager (see path-resolution.test.ts). (url-rebasing subset stays failing — unimplemented.)
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
- [ ] **Build-health pass** — every Less-path package builds against the current core API. Known:
  `jess-plugin-less-compat` has stale-AST tsc errors (`.location` removed, `Any`→`string|Interpolated`,
  `SelectorLike` mismatches, `Cannot find name 'out'`). It IS in the all-less path (`lessCompatPlugin`).
  Fix to current core API; **remove proxying** where possible. Disjoint from core clusters → parallel.

## Log
_(append merges here)_
