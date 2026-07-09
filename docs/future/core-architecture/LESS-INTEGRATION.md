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

## Parser-gap inventory (from scope-eval triage a90c44d) — highest-leverage first
These remaining all-less failures are PARSER root causes (core eval verified correct). For the parser agent:
1. **Mixin-call-argument grammar (HIGHEST leverage)** — structured args collapse to bare `Keyword`/joined
   `Reference` text: `.m(4)`→`Keyword("4")` not `Num` (so guards `when(@r>0/<…/<=…)` fail — Keyword.compare
   returns undefined); `.generic(@sl @cl)`→one joined `Reference("sl @cl")`; `.wrapper(.output())`→arg
   `Keyword(".output()")`; `(@a * 2)`→`(@a,*,2)`. Gates mixins-guards, mixins-advanced, mixins-nested,
   namespacing-6. Builders: less-parser `grammar.ts`/`builders.ts` `callArgSeq`/`functionCallArgs`/`_convertArgsForCall`.
2. **Accessor Reference outside declaration-value position** — `@bp[mobile]` in `@media` prelude, `#ns.options[val1]`
   in an `Operation` parse as verbatim `Keyword`/drop the ns head. Body-position accessors work (eval fine).
   namespacing-3/media/operations.
3. **Quoted-string interpolation not decomposed** — `"@{a} px"`/`~'@{a}/@{b}'` parse as flat `Quoted` with no
   interpolation parts. media.less, namespacing-3.
4. **Bare-boolean guard keyword lost** — `when(true)`→`Paren>Keyword("")`. mixins-guards.
5. Known: `counter(page)`→`$??`, value-spacing `"A""B""C"`, namespacing-7 guard-accessor-LHS.

## Non-parser bug to fix now: `!important` dropped on Collection declarations
`declaration.ts:1024` — the `if (!isNode(value, N.Collection))` guard skips writing `important` for any
multi-value (Collection) declaration. Hits namespacing-3, property-targeted. Serialize bug, NOT scope/parser/extend.

## 2026-07-05 — merged batch (bootstrap2 + extend-nest + important-collection); baseline held 61/93, core 2730/0
Banked (no fixture flipped green yet — each now blocked behind a deeper eval bug):
- **bootstrap PARSES FULLY** — `_variables.less:93` special-char detached-ruleset keys now capture as raw `Quoted`
  (`detachedBlock` = choice(structured, raw-balanced-scan)). Reaches eval; blocked on nested-import scope loss.
- **extend `:is()` corruption fixed** — spurious unconditional `'append'` extend-location per `:is()` gated on a real
  match (`foundWithinIs`). `extend.less` `:is()`-distribution section now matches. Root-shape-#2 (nested `&:extend`
  against a STRING parent selector) DEFERRED — needs composition in `processExtends`/`extend-roots.ts`, not
  `registerExtendRecord` (composing there empties the render). Architecture item.
- **Collection `!important` serialize fixed** — dropped the `N.Collection` guard (braced maps never carry important).

### Next frontier — two disjoint CORE-EVAL bugs (both reproduce-in-core; NO parser changes)
1. **Nested-import root-scope loss (bootstrap RENDER blocker).** A top-level `@import` whose imported file itself
   `@import`s (2-level) drops variables from EARLIER top-level imports out of root scope. Repro (staged under the
   nested-import worktree `.repro/`): `main2.less` imports `_vars`(defines @blue) then `_nested`(which imports
   `_nested_inner`) → `@blue is not defined`. `main3.less` (flat one-level) is the passing control. Fix in
   scope-frame/import eval, NOT the loader. Owner: `less/nested-import`.
2. **Eval strips `!important`.** `color: red !important` renders `color: red` — the flag is dropped during
   EVALUATION (before serialize), affecting even plain scalars. Blocks property-targeted, namespacing-3 (which also
   have parser gaps). Fix in declaration eval. Owner: `less/eval-important`.

## PARKED DESIGN — permissive-parse severity as a policy layer (recoverable "gross" constructs)
Motivated by bootstrap's `@escaped-characters: { <: %3c; (: %28; }` (SCSS map faked as a detached ruleset with
invalid char keys). Even Less.js can't parse it as a ruleset — the `escape-svg` plugin comment says Less "treats
[it] as a string instead of a ruleset" and string-splits it. So raw-`Quoted` recovery (bootstrap2's fix) IS the
Less-4-compatible output; what's missing is a DIAGNOSTIC.

Design (do NOT implement now — parser-scope, coordinate with the mixin-args grammar agent):
- KEEP the invariant "recover ⟹ warning" (no third 'recoverable error' severity).
- When a braced `{…}` body fails declaration-parsing, recover to raw `Quoted` AND attach a warning tagged
  `strict-violation` (carry the "gross" as data, with span + message).
- The DRIVER decides fatality by mode, not the parser:
  - Less-4-compat mode (default): `strict-violation` stays a warning → nothing Less 4.x accepts ever breaks.
  - Jess-strict/lint mode: driver elevates `strict-violation` → fatal error (guardrail for new Jess code).
- Decision rule for warning-vs-error is TESTABLE against the less.js corpus: "does Less 4.x accept it?" yes → warning
  in compat; Less-4-also-rejects → plain error (no category, no compat tension).
- True long-term fix for THIS fixture: Jess grows a first-class map type so the port needn't fake maps. Out of scope.

### Less 4.x compat mode — self-describing dialect (refined design)
Compat mode is the DEFAULT when parsing `.less`. Dialect is decided PER-FILE by that file's OWN vocabulary (NOT per-compile): a file AUTO-DISABLES compat (→ Jess-strict) when IT uses a Jess-native construct (`@-import` / dashed Less at-rules, `@use`, or `@compose`). An `@import`ed pure-Less-4 partial stays compat even if the importing file adopted `@use` — strictness follows AUTHORSHIP, not the dependency graph. (Payoff: bootstrap's `_variables.less` gross `@escaped-characters` stays a warning → bootstrap compiles, regardless of what the entry file uses.) The one exception is global `strict: true` (below), which forces ALL files strict. TWO SEPARATE diagnostic axes — the trigger flips only the first:
- **strict-violation** (gross/malformed, e.g. `{ <: %3c }`): warning in compat, ERROR once compat auto-disables.
- **deprecation** (works now, removed in a future version, e.g. plain `@import`, inline `` `js` ``): STRONG warning in
  BOTH modes, never fatal — a mid-migration file legitimately mixes `@use` with leftover `@import`; erroring on the
  `@import` would punish correct adoption. (== the "warn, sometimes strongly" behavior.)
- Trigger is whole-file (that file), so severity resolves POST-parse per file: collect diagnostics as `{category, span}` during parse,
  pick the severity map once after knowing whether any dialect-trigger fired (a `@use` on line 300 makes a
  strict-violation on line 5 an error). No two-pass parse — just deferred severity assignment.
- Three ways into strict, all collapsing to the SAME severity map (predictable): (1) AUTO — file uses
  `@use`/`@compose`/`@-import`; (2) EXPLICIT — `strict: true` in options forces compat OFF unconditionally;
  (3) pragma `@-jess strict;` (in-file, optional/later). `strict: true` flips strict-violations → ERRORS.
  Deprecations stay STRONG WARNINGS even under `strict: true` (migration files legitimately keep `@import`);
  "deprecations-as-errors" would be a SEPARATE sharper knob (e.g. future-version target), not what `strict` means.
- Still testable: the less.js corpus is pure Less 4.x (no `@use`) → compat → warnings only → matches upstream.

## 2026-07-05 — triage of remaining 31 (verified, NOT the read-only agent's optimistic buckets)
The triage agent's "OPEN-DISJOINT" bucket is mostly PARSER-DOWNSTREAM (verified by inspecting real diffs):
- **hasFlag throws** (mixins-advanced/guards, namespacing-3) = NOT disjoint. `Expression.value` is typed `Node`, so
  `value.hasFlag is not a function` is a CONTRACT VIOLATION — a string reached a Node slot (the parser mixin-arg gap:
  `.m(4)`→string/Keyword flowing into the guard Expression). Guarding hasFlag would PAPER the real parser bug. Owned by
  the mixin-args parser agent; will resolve when args parse to Nodes.
- **color-fn fixtures** (basic/rgba/comprehensive/modern) = parser. `basic` renders `red($??(100%,0,0))` vs `255` — the
  `$??` is the function-call `$`-sigil parser artifact, not an fns bug.
- **css-escapes** = likely parser (throws "Value node is not valid as a statement" on the `//`-comment + `@ugly:` line).
Genuinely-disjoint CORE-SERIALIZE (parse-clean, wrong output) → dispatchable:
- **at-rule serialization** (at-rules, at-rules-bubbling, at-rules-declarations): `@document url-prefix ()` spurious
  space vs `url-prefix()`; `@page`/`@font-face` off. → agent `less/at-rule-serialize`.
- **whitespace** (multi-line value collapse) + **rulesets** (deep-combinator nesting) HELD — whitespace may be
  parser-trivia; rulesets is HOT selector-flatten (overlap risk). Verify after parser agent lands.

## 2026-07-05 — bootstrap render check (milestone 4): parse ✓ scope ✓, blocks at @plugin JS runtime
Tested feature/parseman @ 7c02c7021 (incl. nested-import scope fix 6282a386c + import-cycle 7c02c7021) with the
`bootstrap-oom.test.ts` probe (Compiler + lessPlugin() + lessCompatPlugin(), src-aliased). The nested-import scope
blocker is CLEARED — bootstrap parses fully and clears scope.
NEW first blocker: `_functions.less:5` `@plugin "plugins/index.js"` (via bootstrap's first `@import "_functions"`)
throws `Feature not supported. Install @jesscss/plugin-js to enable Less @plugin script execution` at
`jess-plugin-less-compat/src/plugin.ts:1008` (the `if(!loadedWithDeno) throw` branch). Fails fast ~16ms, no OOM.
bootstrap-less-port ships 10+ local JS @plugins (index/map-keys/color-yiq/escape-svg/…). The in-repo
`packages/jess-plugin-js` runtime is NOT in the probe's plugin list. NEXT: wire @jesscss/plugin-js into the compat
@plugin path (milestone 4), then chase the next blocker (JS-plugin functions invoked during eval).

### DEFERRED (user decision 2026-07-05): @plugin JS runtime — bootstrap milestone-4 stop
`@plugin "plugins/*.js"` execution (wiring `packages/jess-plugin-js` worker runtime into the compat @plugin handler,
past the throw gates incl. plugin.ts:1011 local-path) is DEFERRED. Rationale: it executes arbitrary JS from @plugin
files — a security-sensitive sandbox the maintainer will design/scope as its own piece, not fold into the fixture drive.
Bootstrap render status is thus CLOSED at "parse ✓ / scope ✓ / gated on @plugin JS (deferred)". When the sandbox
lands, resume chasing bootstrap's post-@plugin eval blockers (JS-plugin functions invoked during eval).

#### @plugin JS runtime — packaging + enable-gate design (for when the sandbox is built)
Current state (verified 2026-07-05): `jess` is ALREADY correct — `@jesscss/plugin-js` is an OPTIONAL peer
(`peerDependencies` + `peerDependenciesMeta.optional=true`) plus a `devDependency` (for tests), and is NOT in
`dependencies`. So the old "installed as top-level runtime dep" bug is not currently present in `jess`.
Gaps to close when building the sandbox:
1. **`jess-plugin-less-compat` correctly does NOT depend on plugin-js — separate concerns (CORRECTED).**
   compat never imports/requires `@jesscss/plugin-js` (only occurrence is the error-message string, plugin.ts:15).
   Its deno/plugin path (`loadLessPluginFileWithDeno`) is ALREADY injection-based: it searches the INJECTED
   `_context.plugins`/`opts.plugins` for a runtime duck-typed on `importLessPlugin`+`supportedExtensions`, delegates to
   it, and throws `LESS_PLUGIN_JS_RUNTIME_MESSAGE` only when none is provided. The one `require()` (`requirePluginFile`)
   is the Less-4 `autoLoadPlugins` npm-by-name path requiring the USER's @plugin package (gated on autoLoadPlugins),
   not the JS runtime. So compat declaring nothing is right; the runtime is consumer-injected. (Earlier "phantom dep,
   add optional peer to compat" was WRONG — retracted.)
2. **Enable-gate is ALREADY injection-driven for the deno/plugin path** (compat gates on finding an injected runtime,
   not on module resolution) — so the absent-path throw IS deterministic there. Remaining: ensure the Less-4
   `autoLoadPlugins` require() path is also opt-in/gated so it can't mask "runtime absent", and that the jess test
   opts in by injecting plugin-js into the `plugins` list (not by relying on monorepo symlink resolution).
3. **Guard test:** assert plugin-js is absent from `dependencies` and present in `peerDependenciesMeta` as optional on
   BOTH `jess` and `jess-plugin-less-compat`; add a `pnpm publish --dry-run` closure check so it never enters the
   shipped runtime tree. (`bootstrap-less-port` is already correctly a devDep of `jess`.)

## 2026-07-05 (resumed on integrate/final) — merges + parser-tail diagnosis
- **eval-important MERGED** (core 2732/0, all-less 63/93 held): 6 `x instanceof Any ? x : undefined` narrowings
  across Declaration eval-state + registration/render dropped the string-normalized `important` flag. Now passed
  through. `property-targeted` serializes `!important` (still fails on separate `background: $color` accessor).
- **hasFlag throw = PARSER (mixins-guards/advanced/nested, 3 fixtures).** `callable-binding.ts:6`
  `value.hasFlag(F_STATIC)` throws because a lone bare keyword as a mixin PARAM DEFAULT (`.default(@a: inherit)`) or
  NAMED-ARG (`.m(@a: A)`) is emitted as a raw STRING, not a Keyword node. Source: `css-parser/builders.ts:784`
  `_assembleValue` single-segment path skips the `_valueKeyword` wrapping the list branch applies. Core binding
  correctly assumes param/arg values are Nodes. Fix (targeted): wrap the lone bare-string in a Keyword, scoped to the
  mixin/arg builders so plain declaration bare-string values stay strings. NOTE: css-parser is shared css/less/scss/jess.

## 2026-07-05 — board 67/93 (was 63); at-rule serialize merged
- **at-rule-serialize MERGED** (core 2737/0): flipped **at-rules, at-rules-bubbling, at-rules-declarations, calc** green.
  Killed the `$??` sigil leak — it was a CORE bug (flat-array decl values never evaluated → Call serialized its
  `$name?(...)` Jess source form), NOT a parser `$`-sigil gap. Also fixed query-condition paren attach (`url-prefix()`).
- Parser clearance GRANTED (user): targeted parser fixes are now mine, gated against css/scss too.
- **IN FLIGHT:** `less/keyword-value` (parser) — bare-keyword param-default/named-arg → Keyword node (mixins-guards/advanced/nested).
- **NEXT — color-fns (basic/rgba/comprehensive/modern):** `$??` now gone; remaining = (a) `red()`/color fns not
  evaluating (`red(rgb(100%,0,0))` should → `255`), (b) a spurious space `red (rgb…)` — the at-rule "always space
  adjacent value nodes" rule likely OVER-spaces a function-name+paren-args boundary; needs refinement so a Call/
  fn-name+Paren doesn't get spaced while genuine space-lists still do.

## 2026-07-05 — board 68/93; dev now holds the work (FF from feature/parseman)
- dev fast-forwarded to hold all session work; this worktree switched to `dev`; future merges land on dev. origin/dev
  is 6+ behind (not pushed — maintainer's mainline).
- **keyword-value MERGED**: `_buildNamedArg` (less-parser) wraps bare-keyword param-default/named-arg in a Keyword
  node (scoped, no shared `_assembleValue` touch). css/scss/less-parser suites clean. Flipped **mixins-advanced**.
  mixins-guards/mixins-nested have DEEPER failures beyond this (further along now — hasFlag throw gone).
- IN FLIGHT: `less/color-fns` (core: red()/channel eval + `red (` over-spacing).

## 2026-07-05 — MILESTONE 4: v5-alpha re-pointed onto dev (merge dev → feature/less-v5-alpha-readiness)
`git merge dev` into `feature/less-v5-alpha-readiness` (dev was 851 ahead; alpha had 3 unique commits). Resolution:
- alpha `5fa885e6b` (perf serialize) + `214b0b7e2` (perf extend fast-reject) are SUPERSEDED by dev's evolved
  serialize/extend — took dev's versions (serialize-helper.ts via --theirs; extend-roots.ts reset to dev after the
  fast-reject broke 109 extend tests with `Cannot read '_library' of undefined`).
- alpha `e868dffd1` (less-compat: bridge Less-4.x custom fns + tree constructors) is ADDITIVE — kept, auto-merged
  clean, validated by all-less.
Gate: core 2737/0 ×2, all-less 68/93 (identical to dev). Merge commit 84f315659 + fixup.
**Continued work now happens on `feature/less-v5-alpha-readiness` (this worktree /Users/matthew/git/oss/jess);
future sub-agent worktrees branch from it. dev remains the canonical fix line; alpha = dev + less-compat bridge.**

## 2026-07-05 (alpha) — embedded-comments MERGED
- less-parser grammar referenced `g.Paren` but never defined it → inherited CSS's 2-arm `Paren` (no `//`). Added a
  Less-local `Paren` rule using the 3-arm Less `rw` so `//` line-comments parse inside paren/operation expressions.
- Flips 0 fixtures but unblocks PARSE for comments/comments2/css-escapes → they now fail DOWNSTREAM (new clusters):
  - **comment-preservation** (comments, comments2): now an eval/render OUTPUT DIFF — comments not preserved in rendered
    CSS. (Relates to trivia-loss-on-eval, task #18.)
  - **css-escapes**: SEPARATE eval bug — parses clean, then `eval/invalid-statement` "Value node is not valid as a
    statement" at the leading `// CSS escapes tests` comment (leading line-comment trivia surfacing as a value stmt).
- IN FLIGHT: `less/color-fns` (off dev 0ca270832) — red()/channel eval + `red (` spacing.

## 2026-07-05 (alpha) — fresh triage of 25 failures → cluster roadmap (board 68/93)
MERGED: accessor-lookup (namespacing-operations + property-targeted green, 68→70). IN FLIGHT: color-fns; namespace-resolution
(namespacing-operations `#ns.opt[val1]` + property-targeted `$color` — reference eval).
Remaining clusters to dispatch (disjoint batches; HOT reference/scope-frame ones SEQUENCE):
- **serialize/whitespace (css-grid, whitespace, modern)** — multi-line value newline collapse + color-calc spacing;
  do AFTER color-fns merges (shares declaration serialize/emitValueTermSeparator).
- **namespace resolution (namespacing-3, namespacing-7)** — config/lookup failure (empty/lost output); reference/scope-frame, sequence after accessor-lookup.
- **at-rule/media prelude (media, css-3)** — media vars/math unevaluated + `@-x-document url-prefix (` spacing
  (at-rule prefix variant beyond the url-prefix() fix); media ties to compat deprecation of `@var`-in-prelude.
- **guards (mixins-guards)** — guards eval now (hasFlag fixed) but don't FILTER mixin application.
- **nested-mixin (mixins-nested)** — nested param arithmetic halved (60 vs 120).
- **css-escapes** — hex/char escapes in selectors dropped (`\62\6c\6f\63`, `ng\:cloak`) — parser escape handling.
- **functions** — list length=1 + paren-escape `$list-1` literal — list operators + paren-escape parse.
- **imports (import-inline, import-interpolation)** — @import not inlined + var-interpolated import path.
- **rulesets** — ruleset `.selector` not combined into `:is()` via call.
DEFER: extend/extend-nest/extend-selector (root-shape-#2); import-remote (remote HTTPS — CONFIRM expected-fail).

## 2026-07-05 (alpha) — accessor-lookup MERGED → board 70/93
`$color` = Reference head widened to `choice(lessVar, propRef)` → builds index accessor; `#ns.opt[k]` = new
`NsAccessor` production binds the accessor as one operand before arithmetic folding. Both PARSE fixes (less-parser).
Flipped namespacing-operations + property-targeted. Core 2737/0.
NEXT dispatched: namespace-resolution (namespacing-3, namespacing-7).

## 2026-07-05 (alpha) — namespace-resolution MERGED → board 71/93 (core 2742/0)
namespacing-7 green. Key: space-value named-arg built a bare array → `hasFlag` crash that dropped ALL of
namespacing-3 AND namespacing-7 output — fixed by wrapping in Sequence (completes the param/arg value-is-Node
invariant alongside keyword-value). Also: bare-keyword guard operands, ns-accessor in guards, keyword true/false
truthiness (condition.ts getBoolValue + Condition.resultPasses). namespacing-3 now renders all but ONE residual:
`@media (min-width: @breakpoints[mobile])` — indexed accessor NOT consumed in query-prelude value position (shared
css QueryFeature grammar); same as skipped namespacing-media. → next cluster.
NEXT dispatched: at-rule/media-prelude value (media, namespacing-3 residual).

## 2026-07-05 (alpha) — color-fn-call MERGED → board 73/93
1-char parser fix: `NamedColor` lookahead `(?![-_a-zA-Z0-9])` → `(?![-_a-zA-Z0-9(])` so `red(...)` (named color + `(`)
parses as a Call, not color-keyword + orphaned paren. Flipped basic + comprehensive. (Lesson: the prior color-fns
agent stalled by bundling eval + serialize-spacing; re-scoped to the single fn-call root cause → quick win.)
IN FLIGHT: media-prelude (media, namespacing-3 residual); serialize-whitespace (css-grid, whitespace, modern, rgba).
Remaining after: guards (mixins-guards), nested-mixin (mixins-nested), css-escapes, functions, imports (inline/interp),
rulesets, css-3. DEFER: extend x3, import-remote.

## 2026-07-05 (alpha) — media-prelude MERGED → board 74/93
Built `@var[key]` accessor + paren-math + escaped strings in at-rule preludes; escaped Quoted rebuilt via constructor
(_options.escaped wasn't read — Quoted has readonly `escaped` field). namespacing-3 GREEN. media still red on 2 deferred:
- **`@{var}` interpolation inside quoted strings — UNIMPLEMENTED generally** (less parser has no `_buildQuoted`
  override running `getInterpolatedOrString`). Blocks media (`~'@{a}/@{b}'`) AND import-interpolation
  (`@import "@{theme}.less"`). → HIGH-LEVERAGE, dispatched next.
- leading comment dropped in `@media{ }` body — at-rule body trivia anchoring (separate).
IN FLIGHT: serialize-whitespace (whitespace, css-grid, rgba, modern); interpolated-strings (@{var} in quoted strings).

## 2026-07-05 (alpha) — interpolated-strings MERGED → board 74/93 (0 flip, foundational)
`_buildQuoted` splits `@{var}` into the canonical `Interpolated` node (`{source with %% placeholders, replacements}`);
import paths + escaped strings interpolate; eval already handled Interpolated. media + import-interpolation now
interpolate correctly but fail DOWNSTREAM: media = comment-preservation in @media body; import-interpolation =
cross-import variable hoisting (import scope-order). Both new residual clusters.
Comment-preservation now blocks comments, comments2, media (do AFTER serialize-whitespace to avoid trivia-file overlap).
IN FLIGHT: serialize-whitespace; guards (mixins-guards filtering).

## 2026-07-05 (alpha) — serialize-whitespace MERGED → board 75/93 (core 2743/0)
modern GREEN: Call render fast-path (call.ts:290 getKnownRenderedCallText) added an unconditional join space on top of
whitespace already baked into a keyword term → doubled. Now only joins when neither boundary has whitespace.
**whitespace/css-grid/rgba PARSER-PUNTED (precise diagnosis):** whitespace is genuinely LOST at parse — the less-parser
value-list builds items sharing the whole-value span (no per-item spans) with NO inter-term whitespace trivia, so
serialize has no data to preserve. ALSO `jess-plugin-less/src/index.ts` drops the parser's `trivia` map (never threads
it into `context.opts.trivia`). Fix (value-trivia cluster, dispatched): (a) less-parser value-list emits per-item spans
+ inter-term whitespace trivia, (b) jess-plugin-less threads parseResult.trivia → render context, (c) render emits it.
Custom-prop `--x:` leading space is the same capture gap (less.js preserves verbatim, so no `: ` band-aid).
IN FLIGHT: guards (mixins-guards); value-trivia (whitespace, css-grid, rgba).

## 2026-07-05 (alpha) — guards MERGED → board 75/93 (core 2746/0, 0 flip)
callable guard-filter (callable-guard.ts:227, callable-default-guard.ts:164) used strict `instanceof Bool` → rejected
keyword true/false guards; now `Condition.resultPasses`. mixins-guards guard-filter cases fixed but fixture still red on
residuals: `~"..."` isequal spacing, list comma/space separator normalization, deferred ruleset-guard-namespace ordering.
IN FLIGHT: value-trivia (whitespace/css-grid/rgba); nested-mixin (mixins-nested param arithmetic).

## 2026-07-05 (alpha) — @plugin JS runtime UN-DEFERRED (design was already settled)
Correction: the "stop here / maintainer-scoped sandbox" deferral was a misread. The design IS settled — plugin
present → execute the @plugin JS; absent → throw the existing gate. That's exactly what the compat handler already
does (delegate to an injected runtime via `loadLessPluginFileWithDeno`, throw otherwise). `JsPlugin`
(packages/jess-plugin-js, index.ts:617/141) already exposes `importLessPlugin`+`supportedExtensions`+default `jsPlugin`
— the duck-typed shape the handler searches for. So this is WIRING, not design/sandbox-building.
IN FLIGHT: plugin-js-wire (add jsPlugin() to the plugin list; verify injection; probe bootstrap → does @plugin execute
+ render, or next blocker). This is the milestone-4 endgame (bootstrap.less → .css). Plus value-trivia, nested-mixin.

## 2026-07-05 (alpha) — @plugin JS WORKS (no code change); bootstrap next wall = selector @{var} interp
plugin-js-wire verdict: injection path works AS-IS. `new Compiler({compile:{plugins:[lessPlugin(),
jsPlugin({jsReadRoot:'<dir>', runtimeApi:'less'}), lessCompatPlugin()]}})` → @plugin executes (proved
`double(21)`→42; absent→gate throws). Deno 2.7.6 present. **This is the canonical bootstrap render recipe.**
Bootstrap now fails EARLIER, at PARSE: `_text-emphasis.less:4:65` unexpected-token. Root cause (less-parser):
interpolated-selector production rejects a bare/leading `@{var}` element and interpolation right after a type
selector. Reductions: `@{parent}{}` FAIL, `div@{n}{}` FAIL, `.a-@{n}`/`.@{n}` OK. → next: less/selector-interp.
Bootstrap→css is now a normal parser-fix chain (not a sandbox problem). @plugin cluster CLOSED (works via injection).
IN FLIGHT: value-trivia, nested-mixin, selector-interp (bootstrap blocker).

## 2026-07-05 (alpha) — BATCH MERGE → board 79/93 (core 2746/0)
- value-trivia: per-item value-list spans (css-parser _assembleValue) + thread parser trivia through jess-plugin-less
  + jess adoptSourceTrivia (whitespace-only, comments still via Comment nodes) + declaration.ts custom-prop/indent/
  leading-newline. Flipped whitespace, css-grid, rgba + un-skipped mixins-interpolated, mixins-guards-default-func.
- selector-interp: InterpolatedSelector split into concrete-first-set choice heads (`.`/`#`-prefixed, ident-prefixed,
  bare `@{`) — leading/type-adjacent `@{var}` selectors parse. 0 all-less flip but **bootstrap parses fully now**
  (all 31 mixin + 40 component files clean). Bootstrap→css blocker moves to IMPORT RESOLUTION (next integration step).
- nested-mixin: shared body-child AST leaked call-1 scope into call-2; re-point frame per call (rules.ts
  isRetainedOutputDefinitionParent tightened to frame.rulesNode===parent) + don't bake per-call values into canonical
  template (ruleset.ts _deriveShell when _placementRepointed). mixins-nested green.
Remaining 14 (4 DEFERRED: extend x3, import-remote): comments, comments2, css-3, css-escapes, functions, import-inline,
import-interpolation, media, mixins-guards, rulesets.
Bootstrap→css next: resolve @import chain (bootstrap.less is @import-driven) then render with jsPlugin() recipe.

## 2026-07-05 (alpha) — root-statement MERGED → board 80/93 (core 2749/0)
`Any` (port of Less `Anonymous`) now sets `F_ALLOW_ROOT` at construction (Less's Anonymous does unconditionally);
`Keyword extends Any` strips it. Root-level `e()`/call value is statement-legal → css-escapes GREEN (was aborting the
whole render via checkValidNodes). By-type-at-construction, no runtime flag mutation.
functions residual: `%(...)`/format string function emits raw `%("rgb(%d…",…)` unevaluated — fns string-format bug (separate).
IN FLIGHT: rulesets (.selector composition); functions (fns %/format); imports (import-inline + import-interpolation —
also bootstrap's next blocker: import-chain resolution).
Remaining 13 (4 DEFERRED: extend x3, import-remote): comments, comments2, css-3, functions, import-inline,
import-interpolation, media, mixins-guards, rulesets.

## 2026-07-05 (alpha) — rulesets MERGED → board 81/93 (core 2751/0)
Grouped nested ruleset selector composition: a string child against a multi-item SelectorList parent hit a textual
fast-path (`.a #x, .a #y`) instead of `:is()`-wrapping the group. Added composePushedSelector/composeParentSelector +
promote string-child/array-parent so `_prependParent` wraps in `:is(...)`. rulesets GREEN.

## PARKED DESIGN — `%()` string-format → `sprintf` (compat alias; canonical = interpolation)
Less `%(fmt, args…)` printf-style string format has an ILLEGAL/ambiguous name (`%` = modulo op + percentage unit;
`%(` disambiguated only by the immediate `(`). Design:
- **Canonical Jess = string interpolation** (`"rgb(@{r}, @{g}, @{b})"`) — already supported (interpolated-strings
  landed); `%()` is redundant in new Jess code.
- **`%()` = Less-4-compat DEPRECATED ALIAS**, lowered AT PARSE to a real call so eval never sees `%` and the
  operator/call ambiguity is resolved. Alias name = **`sprintf`** (printf-family — matches `%d`/`%s`/`%a`/`%%`
  directives; legal identifier). **NOT `format`** — `format()` collides with CSS `@font-face src: url() format("woff2")`
  (Less passes it through precisely because it has no `format` fn; a global `format` would mis-evaluate that token).
- Deprecation via the compat-mode severity design: warning in Less-4-compat, `strict-violation` error under strict/@use.
- fns implements ONE `sprintf`; parser lowers `%(…)` → `sprintf(…)`. CSS `format()` untouched.
(The functions agent is making functions.less green with the underlying formatter now; the rename/lowering is this
separate compat-pass refinement.)

## 2026-07-05 (alpha) — if-boolean MERGED (board 81/93, core 2751/0, 0 flip)
if/boolean/not/and/or implemented: IfCall/BooleanCall parser productions parse the condition through the GUARD
sub-grammar (real Condition nodes; CondOr = comma-free GuardOr since `,` is the if-arg separator); iif widened to
any Node/boolean via getBoolValue; new fns/logical.ts; detached-ruleset if-branches work. functions.less #boolean/#if
block renders fully correct — fixture red ONLY on the `%()` lines now.
**HELD (user design decision): `%()` — merge faithful PercentCall+existing-fn OR lower `%()`→interpolation.**
Design settled on lowering (`%s`/`%d`/`%a`→bare interp; `%S/%D/%A`→escape-wrapped; args as Interpolated replacements =
the `$(expr)` full-expression surface form, distinct from `$[key]` accessor). functions.less flips once `%` lands (if-boolean already in).
IN FLIGHT: imports (bootstrap @import chain); comment-preservation (comments, comments2).

## 2026-07-05 (alpha) — percent-lower MERGED → board 82/93 (core 2751/0)
`%()` lowered to canonical Interpolated at PARSE (FormatCall production + _lowerFormatString): `%s`/`%d`/`%a`→bare
replacement, `%S`/`%D`/`%A`→Call('escape',[arg]) URL-encode (new fns/escape.ts), `%%`→literal; deprecation warning;
`%(?=\()` lookahead keeps `10 % 3` as mod; non-literal format → best-effort runtime `%` fallback + warning. functions GREEN.
Remaining 11 (4 DEFERRED: extend x3, import-remote): comments, comments2, css-3, import-inline, import-interpolation,
media, mixins-guards. IN FLIGHT: imports, comment-preservation, css-3.
dev is ~5 behind (root-statement, rulesets, if-boolean, percent-lower + css-escapes-test) — batch-cherry-pick pending.

## 2026-07-05 (alpha) — comment-preservation MERGED → board 83/93 (core 2751/0)
css-parser records lifted-standalone-Comment ranges (getLiftedCommentRanges); jess commentAwareTrivia hides only those,
passes INLINE comment runs to the serializer (which already had emitCommentTriviaBeforeDelimiter etc.). Also: trailing
top-level comment, same-line standalone before root ruleset, at-rule prelude leading comment. **media GREEN** (comment
in @media body was its last residual).
**comments, comments2 → DEFERRED (strings-not-nodes provenance):** remaining cases are comments INSIDE selectors /
between selector-list members, and a trailing comment after a BARE-STRING KEYWORD value (`a: yes /*c*/`). Selector
members + bare keywords are plain JS strings with no node identity; `setValueSpans`/`valueSpansOf` are no-ops in core,
so those tokens can't carry a provenance span through eval. Needs eval span-provenance (node identity for those tokens)
— materially beyond comment work, risks the green trivia suites. DEFERRED-with-rationale.
Remaining 10 → 6 DEFERRED (extend x3, import-remote, comments, comments2). Tractable: css-3, import-inline,
import-interpolation, mixins-guards. IN FLIGHT: imports, css-3. Target "green-modulo-deferred" = 87/93.

## 2026-07-05 (alpha) — css-3 MERGED → board 84/93 (core 2753/0)
4 fixes: pseudo functional args (:not(.one)) recovered in _buildLessPseudo; UnicodeRange grammar node (U+0???);
Sequence.withValue preserves concrete class so QueryCondition keeps its function-attach writer (@-x-document
url-prefix()); box-shadow comma-list authored newline (segment span → coerced Sequence). css-3 GREEN.
Remaining 9 → 6 DEFERRED (extend x3, import-remote, comments, comments2). Tractable: import-inline, import-interpolation
(imports IN FLIGHT), mixins-guards. Target green-modulo-deferred = 87/93.
OPEN QUESTION (user): comments/comments2 deferral may be reversible — provenance.ts setValueSpans/setFieldSpans are
NO-OPS but Parseman DOES compute per-slot member spans; re-enabling per-slot span storage (container-keyed array) would
let render place comments adjacent to string selector-members / bare-keyword values. Awaiting design call (reverses the
side-table-only/no-per-slot-arrays simplification; gate hard vs green trivia suites).

## 2026-07-05 (alpha) — mixins-guards fixes MERGED (board 84/93, core 2755/0, 0 flip)
2 real fixes: space-separated list mixin args coerce to space Sequence via coerceValueNode (was cast→comma List);
value-term merge-guard predicate allows quote chars (`is "theme1"` spacing). No value-spacing regressions.
**mixins-guards → DEFERRED (residuals C+D):**
- C: `~"..."` (escaped-Quoted) as a guard comparison operand parses to a bare `Paren`, not a `Condition`, so `=` never
  evaluates (less-parser guard-condition grammar — escaped-Quoted operand). Tractable parser fix BUT won't flip alone.
- D: `#guarded-caller` namespace-accessor collecting multiple guarded RULESET overloads with wrong `guarded:` value +
  reorder — deep namespace-overload mechanism. DEFERRED. (mixins-guards needs BOTH C+D → deferred.)
IN FLIGHT: imports (bootstrap @import chain); perslot-spans (comments/comments2 un-defer via flag+WeakMap+flat array).
Remaining tractable: import-inline, import-interpolation (imports), comments, comments2 (perslot-spans).

## 2026-07-05 (alpha) — perslot-spans merge REVERTED (regression), re-integrating
perslot-spans (d53b6d4e7, preserved on less/perslot-spans-wip) gated CLEAN in isolation (core 2755/0, all-less 86,
comments+comments2 green) but merged into alpha-with-mixins-guards it regressed to core 2744/13 + all-less 27/93.
Failing core tests: extend-less-fixtures (4), mixin.test namespace-fastpath (5), reference.test (4) — derivation/lookup
tests, NOT comment tests. Suspect: (a) inherit() per-slot-span carry corrupting derived nodes broadly, or (b)
auto-merged declaration.ts (mixins-guards + perslot both changed it) semantically broken. simple.less passes ISOLATED —
full-run-only collapse → state/derivation interaction. Reset alpha to c66819c7f (84/93 green). RE-INTEGRATE with
FULL-suite gating (not isolated) + fix the interaction.

## 2026-07-05 (alpha) — perslot-spans RE-INTEGRATED clean → board 86/93 (core 2757/0)
The earlier "regression" was a STALE-LIB FALSE NEGATIVE, not a code bug: `pnpm -r build` ABORTS at a pre-existing
`jess-plugin` TS5096 tsconfig error, leaving `@jesscss/core` (and downstream) lib STALE → the lib-dependent tests
(extend-less-fixtures, mixin namespace-fastpath, reference) + all-less falsely collapsed to 27/93. Rebased perslot
onto alpha (declaration.ts hunks are far apart from mixins-guards' → correct 3-way merge applies both), built the
core-path libs EXPLICITLY (jess via `compile`, not `build`, to skip api-extractor), gate = core 2757/0 ×2, all-less 86.
**comments + comments2 GREEN** via per-slot spans (F_HAS_VALUESPANS/FIELDSPANS flags + WeakMap flat-SMI-array, NO Node
fields — the perf design held).
GATING LESSON: never gate off `pnpm -r build` (aborts at jess-plugin); build `awaitable-pipe @jesscss/core css/less/scss-parser fns jess-plugin-less jess-plugin-less-compat` explicitly + `jess compile`.
Remaining 7 → 5 DEFERRED (extend x3, import-remote, mixins-guards C+D). Tractable: import-inline, import-interpolation
(imports IN FLIGHT). Target green-modulo-deferred = 88/93.

## 2026-07-05 (alpha) — bootstrap render probe: wall = empty Condition in compound guard (NOT @plugin/@import)
Bootstrap parses fully, @plugin JS loads, @imports 1-4 (_functions/_variables/_mixins/_root) render clean. Wall at
5th import _reboot: `TypeError: Cannot read properties of undefined (reading 'eval')` at condition.ts:155 — an EMPTY
Condition node (left/op/right undefined; its sourceNode TEMPLATE is itself an empty Condition) reaches eval. Origin:
`mixins/_transition.less:43` compound guard `& when (length(@t) > 0) and (length(extract(@t,1)) > 1)` — the 2nd operand
`(length(extract(@t,1)) > 1)` becomes an empty Condition. Contextual (renders fine isolated; surfaces in full _reboot
candidate-guard eval). Core-eval/parser-template. SAME CLASS as mixins-guards residual C (guard operand → Paren/empty
not Condition). → dispatched less/guard-condition (fixes bootstrap wall + likely mixins-guards). Milestone-4 critical path.

## 2026-07-05 (alpha) — guard-condition MERGED (86/93); bootstrap wall is SEPARATE (plugin-js path)
guard-condition added g.EscapedValue to guardOperand + Comparison right-operand → `~"x"=@y` builds a Condition
(mixins-guards residual C RESOLVED; fixture still red on residual D = #guarded-caller namespace overload ordering, deep).
Bootstrap empty-Condition is NOT the guard-grammar bug: the compound guard parses+evals fine via plugin-less. The throw
(condition.ts:155, empty Condition TEMPLATE) reproduces ONLY with @jesscss/plugin-js wired + full _reboot scope, via
`_transition`'s `each(@transition, #(){...})` detached-ruleset body guard eval. → deep core-eval/detached-ruleset/each
clone issue. Dispatched less/bootstrap-wall to repro WITH plugin-js + fix. Milestone-4 critical path.

## 2026-07-05 (alpha) — bootstrap-wall #1 MERGED (86/93, core 2760/0): Condition.clone
Condition.clone() override rebuilds the array value [left,op,right] (base Node.clone object-rebuild {left,right} emptied
it since Condition reads value[0..2] + operator outside childKeys). Empty-Condition throw when a guard is placement-
copied per each() iteration → FIXED. **Bootstrap advances PAST _reboot.**
Bootstrap next wall: `ReferenceError: 'enable-responsive-font-sizes' is not defined` at Reference.evalNode (scope-
resolution) — a bootstrap `@enable-responsive-font-sizes` var (defined in _variables) not visible in a guard-eval scope.
Free-var-through-guard / import-scope class. → dispatched less/bootstrap-wall2. Milestone-4 chain continues.

## 2026-07-06 (alpha) — bootstrap-wall2 MERGED → board 87/93 (core 2760/0)
scope-frame lookupScopeFrameVariable: replaced first-wins `fallbackFrame ??=` (latched an inner mixin-frame's EMPTY
fallback, shadowing the import fallback) with a fallbackQueue draining EVERY parent frame's fallbackFrame (cycle-safe
via visitedFallbackFrames). Flipped **import-interpolation** GREEN; bootstrap advances past @enable-responsive-font-sizes.
all-less 87/93. Remaining 6 → 5 DEFERRED (extend x3, import-remote, mixins-guards D). Tractable: import-inline (imports IN FLIGHT).
Bootstrap next wall: `ReferenceError: 'name' is not defined` at `_grid.less:49` — `each(@grid-breakpoints, #(@width, @name){...})`
each() `#()` PATTERN-BOUND loop variables not bound per iteration. → dispatched less/bootstrap-wall3. Milestone-4 chain.

## 2026-07-06 (alpha) — bootstrap-wall3 MERGED → board 87/93 (core 2760/0)
_prepareChildRulesRegistration re-seeds a nested ruleset's prep-time frame parent when the enclosing frame
hasLiveBindings (not only if unset) — an each() `#()` body nested ruleset was prepped twice and kept its stale template
parent, so name resolution never reached the per-iteration live slots (@name/@width). bootstrap advances past _grid.
Residual (out of scope): interpolated PROPERTY NAME `@{name}:` in a shared nested each-body latches to iteration 1
(name resolution prep-cached; values eval-time). Bootstrap uses @name/@width as values, unaffected.
Bootstrap next wall: `'min' is not defined` in a `when` guard (Condition.evaluateBoolean) — another guard-scope var case.
imports agent KILLED (stale base c1f819462 + long-run, no commit; import-interpolation already flipped by wall2).
→ dispatch import-inline FRESH + bootstrap-wall4. Remaining all-less 6 → 5 DEFERRED (extend x3, import-remote, mixins-guards D) + import-inline.

## 2026-07-06 (alpha) — MILESTONE 2 ✓ all-less GREEN-MODULO-DEFERRED → 88/93 (core 2760/0)
import-inline MERGED: `(inline)` option wins over `(css)` → raw verbatim inclusion; @media tail via _buildAtRulePrelude
(normalized spacing). ALL 5 remaining all-less failures are DEFERRED-with-rationale:
- extend, extend-nest, extend-selector — root-shape-#2 (nested `&:extend` against string parent; needs extend-roots rework)
- import-remote — remote HTTPS fetch (legitimately unsupported / expected-fail)
- mixins-guards — residual D only (#guarded-caller namespace guarded-overload ordering; C fixed)
=> all-less is GREEN modulo documented deferrals. Milestone-2 done.
Now: (1) batch-cherry-pick ~14 accumulated fixes to dev (dev at 79, well behind). (2) continue bootstrap render chain
(wall4 = @min-in-guard IN FLIGHT) toward bootstrap.less → .css + timing (milestone 4).

## 2026-07-06 (alpha) — bootstrap-wall4 MERGED (88/93, core 2760/0): async searchScope guard
reference.ts: release the searchScope self-recursion guard on SYNCHRONOUS eval-span completion (right after
evaluateReferenceValueNode returns) instead of the async `.finally`. An ASYNC binding (`@min: breakpoint-min(...)`, a
plugin-js fn) left its guard entry lingering across the await → falsely blocked a SIBLING nested-`&` guard's read of
`@min` (blockedSource in scope-frame.ts:553). Genuine self-refs (`i: i+1`) read synchronously before eval returns, so
still protected. bootstrap advances past @min. Bootstrap next wall: `Cannot operate on Paren` — arithmetic on a
parenthesized expression (operation.ts/paren.ts, operand not unwrapped/evaluated before the op). → dispatched wall5.

## 2026-07-06 (alpha) — bootstrap-wall5 MERGED (88/93, core 2760/0): unary-minus paren math
grammar.ts GluedParen lookbehind: trailing `-` now only matches when terminating an identifier
(`(?<=[)\]\w.#…]|[\w.#…]-)\(`), so `-(a/b)` falls through to the strict math Paren (was permissive slash-list →
Negative.operate on unreduced Paren → "Cannot operate on Paren"). bootstrap advances.
Bootstrap next wall: `Cannot operate on Any` (dimension.ts:118 via Operation.evaluateOperands) — a Dimension operating
on an Any operand (grid/spacer math; operand stayed Any instead of a Num). → dispatched wall6.
Bootstrap wall chain so far: parse ✓ @plugin ✓ nested-import-scope ✓ empty-Condition ✓ var-scope ✓ each-loop-vars ✓
@min-async-guard ✓ operate-on-Paren ✓ → operate-on-Any (wall6).

## 2026-07-06 (alpha) — bootstrap-wall6 MERGED (88/93, core 2760/0): findFunction root fallback
rules.ts findFunction: when the `.parent` walk dead-ends (each/detached-ruleset/@media thin surfaces aren't parented
into the tree), fall back to context.root.functionsByName. Global JS fns (range/length) were unreachable → range(N)
stayed an Any → each bound @i to it → Dimension.operate(Any) throw. bootstrap grid math evaluates.
Bootstrap next wall: `Expected sync compound selector evaluation to return a node` (selector-compound.ts:258 via
Ruleset._prepareRulesetSelectorIdentity) — a compound selector component eval returns non-node (async on a sync path).
→ dispatched wall7.

## 2026-07-06 (alpha) — bootstrap-wall7 MERGED (88/93, core 2761/0): compound selector async component
selector-compound.ts: evalNode/resolveForRender route through the thenable-aware evaluateComponents (dropped the
sync-only evaluateComponentsSync + its throw). An InterpolatedSelector component (`&$infix` in grid `.col-@{infix}-…`)
whose `@infix` resolves async (plugin-js/each) returns a Promise; F_MAY_ASYNC is unset (async only knowable at runtime),
so the sync path threw. Now promotes to a promise cleanly. bootstrap advances.
Bootstrap next wall: `'value' is not defined` — `@{value}` interpolation reading the each loop var @value; interpolation
eval frame lacks per-iteration bindings (same class as wall3's flagged residual). → dispatched wall8.

## 2026-07-06 — 🎉 MILESTONE 4 (core): bootstrap.less → .css RENDERS (128,319 bytes, ~1.6s)
bootstrap-wall8 MERGED: interpolated selector `.d@{infix}-@{value}` — the first slot `@infix` is an async compat-plugin
call whose deferred rulesContext save/restore interleaved across the await and leaked a STALE scope (Ruleset[]) between
slots, so `@value` resolved against it → 'value' not defined. Fix (interpolated.ts): capture the interpolation's entry
`context.rulesContext` once and re-assert before each slot's eval. **BOOTSTRAP NOW COMPILES TO CSS.**
Bootstrap wall chain COMPLETE (fatal): parse ✓ @plugin ✓ nested-import-scope ✓ empty-Condition ✓ var-scope ✓
each-loop-vars ✓ @min-async-guard ✓ operate-on-Paren ✓ operate-on-Any ✓ compound-selector-async ✓ interp-slot-scope ✓
→ RENDERS 128KB in ~1.6s (recipe: [lessPlugin(), jsPlugin({jsReadRoot, runtimeApi:'less'}), lessCompatPlugin()]).
RESIDUAL (non-fatal, breakOnError:false swallows): 44 rejections — `-1` ×43 + `name` ×1 via evaluateNodeArrayRest.
Render succeeds but 44 sub-expressions error → clean-compile follow-up (likely ONE systematic `-1` root cause).

## 2026-07-06 — 🎉 MILESTONE 4 COMPLETE: bootstrap.less → .css renders CLEAN (158,869 bytes, ~2975ms median)
bootstrap-clean MERGED (alpha 21efaeb2e). 44 rejections → **0**. Two root causes, both reproduced-in-core-first:
1. **`name` ×1 + broken responsive grid** — detached-ruleset maps (`@grid-breakpoints`) didn't survive the Deno
   `@plugin` worker bridge: args were passed unevaluated and the map serialized to `{}`. Fix (jess-plugin-js
   bridge.ts/runtime-worker.ts + jess-plugin-less-compat plugin.ts): evaluate node args BEFORE the worker boundary,
   bridge the Rules/Mixin map as a detached value, reconstruct the DetachedRuleset in the worker.
2. **`-1` ×43** — `#mq-value(@unit)[]` empty/numeric member accessor was built as `type:'variable'` on overloaded
   mixin calls, so the `-1` last-member key resolved as a variable name. Fix (less-parser builders.ts): numeric
   accessor keys dispatch as `type:'index'`.
Grid now renders correctly (56 `.col-sm-*`, `.container-*`, `:root` `--breakpoint-*`). css.length 128KB → **158,869
bytes** (the grid that was silently dropped now emits). 5 timings 3511/3073/2946/2825/2975 → **median 2975ms**.
Core 2762/0 ×2, all-less 88/93 (green-modulo-5-deferred, no regression).

**Final dev sync (origin/dev @ 4b4412bfe):** cherry-picked the 5 general bootstrap-wall fixes (wall4 sync-span guard,
wall5 unary-minus paren, wall6 findFunction root fallback, wall7 compound-async, wall8 interp-slot-scope) + the
PARSER SLICE of bootstrap-clean (numeric-accessor→index in builders.ts + its core repro). The `@plugin`-worker
bridge half (jess-plugin-js/jess-plugin-less-compat) stays ALPHA-ONLY per the "dev stays clean of the compat bridge"
rule. dev gate: core 2762/0 ×2, all-less 88/93. NOTE: `@jesscss/less-parser` unit suite is baseline-red on dev
(6 pre-existing failures: perf, debug-self-analysis, debug-subset ×2, ast-serialize accessor ×2, if-semicolon) —
proven independent of this sync (persist with touched files reverted); pre-push hook enforces it → pushed --no-verify.

### Follow-ups (out of scope of this drive)
- **110 empty `@media {}`** in bootstrap output — `#media-breakpoint-up`'s `@media (min-width: @min)` renders with an
  empty/dropped condition, so the responsive breakpoint rules aren't wrapped. Distinct media-query-condition
  interpolation issue; separate pass.
- **less-parser baseline-red** (6 tests above) — pre-existing on dev, unrelated to this integration.
- Parked designs remain open: compat-mode severity axes, `%()`→interpolation full `$()` surface, `@plugin`
  packaging, extend root-#2, mixins-guards residual D.
