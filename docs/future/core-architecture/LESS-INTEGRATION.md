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
- **all-less gate baseline (jess-parseman = single gate worktree): 61 passed / 32 failed / 93. Core: 0.**

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
Core is BACK TO 0 (2692 passed) as of the A2/E/F/NS-FASTPATH wave. NS-FASTPATH fixed the 2 perf-guard tests. Gate baseline = 0.

## Clusters (from triage) — leverage-ranked

- [~] **A — node-vs-string eval/serialize (~24 tests, HIGHEST leverage). PARTIAL — merge b53590d9d.**
  DONE (3 root causes, 3 core repros): `writeSyntax is not a function` → `writeSelectorLike` helper for
  hoisted `SelectorLike` parents (serialize-helper.ts, was mistyped `Selector`); nested string selector
  lost under comparable-header (ruleset.ts `writeHeaderSelector` returned empty when `withoutComments`);
  at-rule prelude duped into body (less-parser builders.ts — restrict body to node children past the
  brace). **at-rule-bubbling 6/6 GREEN**, jess +7, zero regressions. A2 DONE (merge, all-less +3): Url.value string|Node, evaluate-node-array coercion, Operation string operands+recastNumericOperand, Paren/Negative ctor normalize, call arg coercion, extend string selector. Original remaining: `.eval`/`.hasFlag` on strings (~10 fixtures), `Expected node array item to
  evaluate to a node` (merge/each), `Cannot operate on Keyword/Paren` (mixins/calc). [[feedback-string-normalized-nodes]]
- [x] **NS-FASTPATH — DONE (merge, core 2→0).** fast path handles string-normalized parser output (staticNamespaceExcludesKey, prefixOwnsChildren >=1, findMixinPath direct dispatch). Original text:**
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
- [x] **E — DONE (merge 47d36981d). compiler-reuse+public-api 15/15.** Rules.evaluated getter + _finishEval stamp; @import url() serialize (Url.value Node in css-parser _buildUrl + less-parser url prelude); 3 stale-API test fixes.
- [ ] ~~E-old~~ (superseded): compiler-reuse(6)+public-api(1):
  `undefined.valueOf`, visitor hooks returning undefined, evaluated root not retained for
  serialization/visitors; plus `@import "x.css"` → `url("x.css")` serialize diff. Core-reproducible.
- [x] **D — DONE (merge c65dc2782). named-color resolution** via slim color-names.ts (reuses color-name pkg, no dup table, no node growth); #NaN eliminated, all-less +1, functions 18/0. Separate: Color-clone merge bug + strict-unit 10px. Orig: Channel values arriving as strings → NaN.
  May collapse into A. Recheck after A.
- [x] **F — DONE (merge e5355747b). @plugin security sandbox 6/6 green.** Deno/plugin-js lazy-load +
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
- **url-datauri** (f7a2e70fc): data-uri reads via new Context.readBinary (file manager, replaces raw-fs violation); url serialization verified+repro'd; urls.less xfail (blocked on @import interpolation). all-less→61.
- **extend** (df4a9e653): string-leaf handling across extend engine (walk :is() wrap, materializeStringLeaves, combinatorHasFlag, extendWith flatten, double-eval guard); extend-chaining+extend-media green, all-less→60. Remaining extend-nest/extend-selector/extend need a location-matcher rework (nested :is() distribution, nested &:extend parent composition).
- **calc** (2681b7560): dimension.ts no longer fabricates compound units (throw→Operation preserves operands); calc-via-Reference reduction; F_MAY_ASYNC; cast.ts ESM. all-less→58, cleared nesting.
- **color-fns** (cbeb40b01): fns color utils no longer read nonexistent node.location (sourceSpanOf/.inherit); color output correct, +4 tsc errors gone. Color all-less fixtures still blocked by: parser `red(rgb())` call-lexing (color-keyword+`(` not a Call), calc-on-relative-color-keyword, custom-property `--x:val` whitespace.
- **tail-undefined** (51ad1b565): 7 root causes, all Cannot-read-undefined/selector-is-not-a-function crashes eliminated (crashes→diffs); core 2703/0.
- **D-color** (c65dc2782): named-color table; **C-lookup** (38b269453): accessor key typing + property lane excludes VarDecl; all-less→54.
- **Cluster A partial** (b53590d9d): writeSelectorLike + string-selector header + less-parser prelude-dup; at-rule-bubbling 6/6, jess +7.
- **Cluster B** (merged): safeParse attaches file-bearing TreeContext to root Rules (1 line, _treeContext public field); path-resolution 3/3, all-less +6 in-worktree, 0 new. jess-parseman all-less baseline now 41/93 (single gate ref).
- **Cluster C partial** (70888504e, `less/cluster-c`, not merged): sub-bug #1 binding-cell materialization — `Declaration.valueNode()` coalesces flat parser segment-array var values; `createVarDeclarationBindingEntry` lazy `prepareValue`. functions.test.ts each() nested-rules (2) green, all-less +1 (`functions-harness.less`), full less suite 64→67 pass. Core suite unchanged (2 known ns-fastpath + pre-existing `sibling collapsed` mixin test + `extend-less-fixtures` module artifact; 0 new). Sub-bugs #2 (namespace accessor lookup) / #3 (`No matching mixins`) still open.

## Milestone tail (from recon a08cf88)
**M3 — feature/parseman → dev:** CLEAN FAST-FORWARD. `dev` (tip f36e8c392) is 709 commits behind and
fully contained in parseman (`merge-base --is-ancestor dev feature/parseman` = true; 0 commits parseman
lacks). Just FF-merge. Local `dev` is ahead of `origin/dev` (3e871385a) — reconcile the remote separately.

**M4 — sync the v5 alpha branch from dev + bootstrap.less:**
- CORRECTED FLOW (not link re-pointing): the alpha branch is the integration point and merges `dev` UP.
  less.js (`/oss/less.js`, @less/root 5.0.0-alpha.2) already `link:`s Jess from `oss/jess`
  (`packages/less/package.json:159-165`: core/plugin-less/plugin-less-compat/jess → `../../../../oss/jess/packages/*`),
  and `oss/jess` is on `feature/less-v5-alpha-readiness` (tip 5fa885e6b). So after M3 (parseman→dev):
  in the `oss/jess` worktree, **`git merge dev`** to pull the 652-commit gap up onto the alpha branch,
  reconciling conflicts. The alpha branch's **3 unique commits STAY** (they ARE the alpha-readiness work:
  e868dffd1 less-compat 4.x fn/tree bridge, 214b0b7e2 extend fast-reject, 5fa885e6b serialize staging) —
  dev merges in under/around them, NOT a FF. Then `pnpm install` in less.js + rebuild Jess libs.
- No `link:` path edits; the existing target auto-tracks once the alpha branch is synced.
- **bootstrap.less** = Bootstrap 4.6 via `bootstrap-less-port@2.5.1` (jess devDep); flat 38 `@import`s / 90
  files. NOT a parse problem — blocked on **cluster C (scope/accessor + mixin-lookup, `'X' is not defined`:
  `_buttons/_tables/_badge/_list-group/_grid/_custom-forms/_utilities`) + cluster G (format/whitespace,
  e.g. `2px solidwhite`)**. Tracked by `bootstrap-perfile.test.ts` (describe.todo).
- **Timing gate ready**: `packages/jess/test/less/bootstrap-oom.test.ts` (describe.todo) renders
  bootstrap.less with `performance.now()` + heapUsed, fail-fast <10s/<500MB. Promote todo→real once C/G
  clear (after `pnpm --filter "jess..." build`; config-loader/CLI paths use built lib). CLI one-shot:
  `node packages/jess/bin/cli.mjs <bootstrap.less> -o /tmp`.

## Feature-implementation queue (post-bootstrap — all-less 93/93 IS a goal)
These remaining all-less failures are missing FEATURES to build (agents), not permanent xfails. Sequence
after bootstrap.less compiles; they're the path from all-less 56/93 → 93/93:
- **url/data-uri** (~57+15 occ): `url()` handling, `data-uri()` inlining, url-rebasing (rewrite-urls/rootpath).
- **calc reduction** (~38 occ): full `calc(...)` collapse (single-arg reduce, nested, unit-aware). calc.less/css-grid/css-3.
- **import subsystem tail** (~20 occ): import-inline, import-interpolation, import-remote.
- **color-functions**: channel fns (`red()/green()/blue()/mix()/...`) beyond named-color resolution. basic/comprehensive/modern/rgba.
- **extend diffs**: extend-chaining/media/nest/selector/extend output alignment.
- **accessor/scope remnants**: namespacing-3/6/7 (guard-accessor LHS grammar, bare-`when(true)` Bool keyword), property-targeted, deep chained mixin-call-accessor.
- **sourcemaps**: source-map annotation + artifact output (own harness).
- **value-spacing / selector-arg** (parser trivia; blocks calc.less last line, css-3, css-grid): missing spaces between value terms (`translate(...) rotate(...)` fused; `$??` spacer artifact), `:not(.one)`→`:not` and `nth-child(...)` losing args (selector-fn args dropped in serialize). Overlaps less-parser — queue behind bootstrap.
- **parser gaps** (also surfaced by bootstrap): unicode-range `U+0???`, `$??()` interpolation placeholders, multiline value newline-preservation (parser folds whitespace into spanless string terms).

## Follow-up: proper inline-JS backtick detection (replace the pre-scan)
The current `firstInlineJsBacktick` pre-scan in `less-parser/src/functional-parser.ts` (commit 8aad9deb2)
is a FRAGILE STOPGAP: it hand-rolls comment/quote opacity and gets precedence wrong — e.g. `//` inside a
`url(http://…)` or an unquoted URL is mistaken for a line comment; Less escaped strings `~"…"` aren't
modeled. Correct model: comments/quotes are OPAQUE — once opened, everything is that token until closed,
and the tokenizer already enforces this (parseLessFn parses a comment-backtick fine). PROPER FIX: remove
the pre-scan entirely and detect inline JS IN THE GRAMMAR/TOKENIZER — a backtick token reaching the grammar
is code-position by definition → error with the friendly "inline JS not supported" message. Do this once
the parser is free of the bootstrap-driver.

## Follow-up: slim jess-plugin-less-compat (~6200L → aim 50-70% cut)
The compat plugin is bloated. Breakdown: node-conversion boilerplate (transform/* + nodes/*) = 1852L
(per-node bidirectional Jess↔less.js converters — collapse into a data-driven type-map + one generic
converter: the biggest prize); plugin.ts = 1277L (@plugin lifecycle/registry/gating, ~59 deprecated/@plugin
refs — trim the deprecated-@plugin + auto-load fat); less-compat-structures.ts = 550L (hand-rolled less.js
`less`/`tree` mock — keep only the actually-called surface); types/type-map/utils ~650L. Do this AFTER
bootstrap renders + security suite green — those become the coverage gate (don't cut a load-bearing path).
Don't promise a literal 90%; target the actually-exercised less.js API surface. No behavior change — pure slim.

### Slim METHOD: AST-diff, not just a tighter converter
The 1852L of node-conversion boilerplate is a SYMPTOM of Less-AST vs Jess-AST divergence. Deepest cut =
shrink the divergence. Steps: (1) enumerate the shape diffs (transform/type-map.ts already encodes much of
the correspondence — it's the diff map); (2) classify each divergence — ESSENTIAL (Jess is deliberately
different & better: string-normalized terminals not Operator/BasicSelector wrappers, canonical `value`,
provenance in side-table — KEEP Jess, convert at boundary) vs INCIDENTAL (arbitrary field name/nesting —
ALIGN Jess's AST to less.js so that conversion code vanishes); (3) table-driven converter handles only the
ESSENTIAL set. HARD CAVEAT (owner): only change Jess's AST where the result stays sane — do NOT regress the
opinionated string-normalized/canonical-value model Jess deliberately moved to. Default = keep Jess + convert;
align only the truly-incidental. Sequence after bootstrap renders (exercised surface known).

### AST-diff findings (analysis a6cecd6) — the slim is ~35-40% of AST boilerplate, NOT 90%
The 1852 boilerplate lines are a PROXY facade (LessAdapterBase lazily exposes less.js field names as getters
over live Jess nodes) — not deep copies. ~20 of 25 node converters are already trivial. Realistic cut:
- (b) **collapse nodes/index.ts registry (377L, 25 near-identical type-guard blocks) → one data-driven
  `Map<type,{lessType,fields}>` dispatch** = the biggest prize (~250L) + fold trivial passthrough converters
  (Keyword/Paren/Negative/Comment) (~100L).
- (a) **field-name renames via a DATA rename-table** (~150L) — Operation `operator`, AtRule `prelude`,
  Mixin `guard`, AttributeSelector `name/attributeValue`, Dimension `number`, Color `_alpha`, Declaration
  `options.assign` → less.js names.
- Total removable ≈ **500L (~27% of 1852)**; realistic AST target ~1852→1100-1200 (**35-40%**). The 6200→50-70%
  goal needs ALSO slimming plugin.ts (deprecated-@plugin fat) + less-compat-structures mock (non-AST).
ESSENTIAL FLOOR (irreducible, keep hand-written): selector flatten (~180L: hierarchical ComplexSelector +
string Combinators → flat Element[]), from-less.ts reverse path (~150L), Reference 3-way type-dispatch
(Variable/Property/VariableCall) + `@`-prefix (~40L), span-derived `index` getters (~15L), Quoted/Color value
stringification (~25L), the adapter/type-map engine (~350L, keep).
OWNER RULINGS NEEDED (do NOT guess):
1. **Do NOT rename core Jess fields** to less.js's terser names (`operator`→`op`, `prelude`→`value`,
   `guard`→`condition`, `number`→`value`) — Jess's are deliberately more explicit/better. Encode the mapping
   in a DATA rename-table, NOT by regressing core. (My earlier "align Jess's AST" framing was too loose.)
2. Ruleset `selector` (singular SelectorList node) vs less.js `selectors[]` — align or keep? (probably keep — Jess's SelectorList-as-node.)
3. Color `childKeys=['node']` is a known canonical-`value` VIOLATION; fixing it in CORE-CLEANUP would also
   simplify its converter — sequence with core-cleanup, not the slim.

ADAPTER PERF/CLARITY (owner flagged 'no Proxy wrappers'): less-adapter.ts is NOT a JS Proxy, but `createLessAdapter` (called per-node) does per-INSTANCE `Object.defineProperty` in a loop (ctor lines 114-124) → N getters + N closures on EVERY adapted node, megamorphic hidden classes, opaque. FIX = the table-driven converter done right: build ONE adapter class per less.js type from the `{lessType,fields}` table with getters on the PROTOTYPE (defineProperty once per type), `new FooAdapter(node)` per node. Monomorphic, typed, debuggable. Registry-collapse and Proxy-removal are the SAME refactor.
LAZY + IDENTITY (owner req): getters MUST stay lazy — `new FooAdapter(node)` converts nothing; a child is adapted only when its getter is READ (a plugin/visitor that ignores children pays ~0). Back it with a shared `WeakMap<jessNode, adapter>` for memoization + STABLE IDENTITY (`node.selectors[0]===node.selectors[0]` must hold; plugins do identity checks). Slim must not make conversion eager. Even selector-flatten fires only on `.selectors` read.
Top files: nodes/index.ts (377, collapse), transform/type-map.ts (the diff map), transform/less-adapter.ts
(keep — proxy engine), nodes/selector.ts (212, essential floor), transform/from-less.ts (197, essential).

## UN-PAUSED (owner lifted): finish minimally-scoped work only, NO new scope
Parser changes OK again. FINISH the already-scoped drive (all-less green + bootstrap→css + M3/M4). Do NOT start
the recorded follow-up refactors (compat-slim, AST-diff alignment, grammar-level backtick) — those are NEW scope, parked.
Prior pause note (historical):
Do NOT make less-parser/css-parser/grammar/builders changes; a separate agent is fixing incorrect parsing.
- **bootstrap milestone PAUSED**: it's parse-blocked (`_variables.less:93` detached-ruleset raw-block, then
  chain). Stopped the bootstrap-render agent + discarded its parser commit (849966b13) and incomplete eval WIP.
  Resume bootstrap AFTER the parsing agent's fixes land (on feature/parseman or via dev).
- **DEFERRED to the parsing agent** (all parser-owned): value-spacing/selector-arg cluster; color-fixture
  `red(rgb())` call-lexing (color-keyword+`(` not a Call); the guard-accessor LHS grammar in namespacing-7;
  bootstrap's detached-ruleset raw-block. Do NOT dispatch agents into these.
- **Still fair game (non-parser / core-eval)**: extend location-matcher (extend-nest, running); the
  scope/import-chain guard-var resolution (bootstrap surfaced `enable-rounded`/`g` — a mixin-body nested-guard
  free-var through the import chain; likely also gates namespacing/import all-less fixtures) — do as a vetted
  core cluster; `@import "@{...}"` interpolation IF it's eval-time (interpolate path before file-manager resolve)
  and not grammar.
