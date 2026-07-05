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
- **Vitest resolves workspace packages to `src` via exact-match ALIAS** (`vitest.config.ts`
  `workspaceSrcAliases()`), NOT a `"source"` export condition (that leaked to the non-TS config
  loader → `Cannot find module core/src/tree/index.js`, broke all-less `.cjs` fixtures). So: edit
  `core/src`, rerun ANY test → current source, no rebuild. Every OTHER loader (styles-config config
  loader, native require) resolves to built **lib**. Fixed in 50f311a61.
- **Build lib once for the config-loader path**: `pnpm --filter "jess..." build`. Core edits still
  hot-reload via the alias; only rebuild if you change what the config loader itself imports.
- Run: `cd packages/jess && TEST=true npx vitest run test/less/all-less.test.ts`. Core repros:
  `cd packages/core && npx vitest run <file> -t <name>`.
- **all-less gate baseline (jess-parseman = single gate worktree): 46 passed / 47 failed / 93.**

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

## Core gate baseline (IMPORTANT)
Core is NOT at 0 on feature/parseman — **2 KNOWN pre-existing failures**, treat as the gate baseline
(merge a cluster only if it adds NO failures beyond these 2):
- `mixin.test.ts › namespace fast path: real Less stable namespaces avoid direct-crawl and array fallback`
- `mixin.test.ts › namespace fast path: ruleset namespace path preserves callable namespace unions`
Both are **perf-guard** tests (spy on `findMixinsFast`/`findMixin` to assert the fast path is taken;
they fail because it falls back to a slow direct-crawl — rendering is unaffected). Test file + all
lookup source are UNCHANGED since CORE-CLEANUP 918834a88, so the trigger is a non-source change
(dependency/parser-output). Tracked as cluster **NS-FASTPATH** below. Not correctness-blocking.

## Clusters (from triage) — leverage-ranked

- [~] **A — node-vs-string eval/serialize (~24 tests, HIGHEST leverage). PARTIAL — merge b53590d9d.**
  DONE (3 root causes, 3 core repros): `writeSyntax is not a function` → `writeSelectorLike` helper for
  hoisted `SelectorLike` parents (serialize-helper.ts, was mistyped `Selector`); nested string selector
  lost under comparable-header (ruleset.ts `writeHeaderSelector` returned empty when `withoutComments`);
  at-rule prelude duped into body (less-parser builders.ts — restrict body to node children past the
  brace). **at-rule-bubbling 6/6 GREEN**, jess +7, zero regressions. REMAINING A sub-issues (still open,
  fold into a follow-up A2): `.eval`/`.hasFlag` on strings (~10 fixtures), `Expected node array item to
  evaluate to a node` (merge/each), `Cannot operate on Keyword/Paren` (mixins/calc). [[feedback-string-normalized-nodes]]
- [ ] **NS-FASTPATH — namespace fast-path perf-guard regression (2 core tests, perf not correctness).**
  `mixin.test.ts` namespace fast-path ×2 fall back to direct-crawl for stable namespaces (#theme/#panel).
  Test + lookup source unchanged since 918834a88 → non-source trigger (parser-output structure or a dep).
  Fix the fast-path (scope-frame/lookup-utils/callable-scope-frame) or update the guard to the current
  parser output. Disjoint from B (plugin/context). Core cluster → sequence with other core clusters.
- [x] **B — DONE (merge — see log).** import base dir = CWD not importer dirname. CONFIRMED root cause: the
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
- [~] **C — scope/binding unresolved (~10 tests). PARTIAL — sub-bug #1 done (commit 70888504e).**
  Sub-bug #1 (`Binding cell has no value`, `scope-frame.ts:53`): the Less parser assembles a multi-part
  var value (`@sizes: small 1, large 2`) as a FLAT segment array, not a List Node;
  `createVarDeclarationBindingEntry` dropped non-Node values to `undefined` so the cell was value-less.
  FIX: `Declaration.valueNode()` coalesces `Node|string|segment[]` → structured comma-List of
  space-Sequences; the cell carries a lazy `prepareValue`. Core repro in control.test.ts. Cleared the
  functions.test.ts each() nested-rules tests (2) + `functions-harness.less`; 0 regressions. REMAINING
  sub-bugs (open): #2 `'X' is not defined` — Less namespace/property ACCESSOR lookup (`#ns1[foo]`,
  `@defaults[@nested][@color]`, `#ns1.vars[$sub]`): namespacing-1/2/4/media, namespace-targeted; #3
  `No matching mixins` (namespacing-functions `.add`, mixins-interpolated). Also `scope.less` blocks on
  an UNRELATED `Cannot read properties of undefined (reading 'adopt')` (present at baseline, not the
  `'height'` leak). These are distinct root causes (accessor resolution / leaky mixin-output), not the
  binding-cell timing bug. Relates to [[mixin-output-frame-linking]], [[feedback-setdefined-cell-not-node]].
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
- [ ] **context settings single-source** (design — think before doing; owner is weighing it).
  `TreeContext` (per-file: file, plugin, mathMode/unitMode/equalityMode/leakyRules/bubbleRootAtRules)
  and the eval `Context` (one per compile: scopes/roots/errors + `_mathMode`/`_leakyRules`/... override
  fields via `_X ?? treeContext.X ?? default` getters) genuinely differ in LIFETIME (1 Context : N
  TreeContexts) — per-file settings are load-bearing (`@import … with {}`, modules with own mathMode),
  so **do NOT merge the objects**. But the bubbling settings are declared+copied in both (TreeContextOptions
  extends ContextOptions; plugin createTreeContext + Context both source them) → adding a setting touches
  ~4 places. FIX: keep both objects; single-source the settings into one `TreeSettings` bag owned by
  TreeContext; Context resolves via `this.treeContext` + ONE global-override slot (opts), not N `_X`
  shadow fields. Keep hot-path `mathMode` a direct property read; resolve any global override once at
  `context.treeContext = …` entry, not per read. Balance perf vs maintainability.
- [ ] **context-trim** — base `Node` ctor takes no context (good), but ~8 types carry their own
  `_treeContext` field: `Rules` + `import-style` (legit — doc/import roots ESTABLISH context) and
  `function`, `dimension`, `any`, `expression`, `block`, `at-rule-statement` (OVERKILL — they can read
  the eval-time `context`/`sourceRoot._treeContext`). Drop `_treeContext` from those 6 + their parser
  build sites. HOT-file refactor → sequence after B/C/E. Pairs with B (both treeContext plumbing).

## Log
- **build-health** (b06132614): compat plugin builds against current core API; from-less 'out' fix.
- **Cluster A partial** (b53590d9d): writeSelectorLike + string-selector header + less-parser prelude-dup; at-rule-bubbling 6/6, jess +7.
- **Cluster B** (merged): safeParse attaches file-bearing TreeContext to root Rules (1 line, _treeContext public field); path-resolution 3/3, all-less +6 in-worktree, 0 new. jess-parseman all-less baseline now 41/93 (single gate ref).
- **Cluster C partial** (70888504e, `less/cluster-c`, not merged): sub-bug #1 binding-cell materialization — `Declaration.valueNode()` coalesces flat parser segment-array var values; `createVarDeclarationBindingEntry` lazy `prepareValue`. functions.test.ts each() nested-rules (2) green, all-less +1 (`functions-harness.less`), full less suite 64→67 pass. Core suite unchanged (2 known ns-fastpath + pre-existing `sibling collapsed` mixin test + `extend-less-fixtures` module artifact; 0 new). Sub-bugs #2 (namespace accessor lookup) / #3 (`No matching mixins`) still open.
