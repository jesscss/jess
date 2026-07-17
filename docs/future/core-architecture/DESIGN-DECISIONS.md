# Design Decisions — settled semantic/design rulings (greppable log)

This is a **flat, greppable log of SETTLED design decisions** for the Jess core
architecture, so agents stop re-litigating them. One row per decision: the
ruling (one line) + a pointer to the detail doc and/or the owner-memory note.

Rules of the road:

- **A row here is the ruling.** If code, a test, or a `.css` test-data file
  disagrees with a SETTLED row, the code/test/data is what changes — not the
  ruling. Confirm against the linked detail before acting.
- **OPEN rows are explicitly not settled** — they record the current state of a
  live thread so nobody mistakes silence for a decision.
- **"Source" pointers** are relative paths inside this dir unless prefixed
  `memory:` (a note in the owner's project memory,
  `.claude/projects/-Users-matthew-git-oss-jess/memory/<name>.md`).

## 0. The epistemics — there is NO external oracle (read first)

Correctness is **the documented intended v5 design**, nothing else. The less.js
`alpha` top-level `.css` test-data AND the Jess tests are *imperfect encodings*
of that design — kept up to date toward it, and wrong as often as the engine is.
When the engine disagrees with a `.css` file, the question is "which matches the
intended design?" — then reconcile the loser TO the design. Do not treat any
file as an authority to blindly match.

Owner also **banned the words "oracle" and "golden"** — say "the intended
design" / "the expected `.css` output" / "reconcile the test-data to the design."
Several existing docs (`ORACLE.md`, `EXTEND-SEMANTICS.md` "Oracle policy",
`GOAL1-SCORECARD.md`, and many spec headers) still use the banned framing; treat
their *content* as valid consistency-check guidance, but their *"oracle/golden =
authoritative"* framing is superseded by this row. Source:
`memory:no-oracle-intended-design-is-truth` (owner 2026-07-17).

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| E1 | No external oracle: correct = documented intended v5 design; alpha `.css` + Jess tests are imperfect encodings reconciled TO the design (test-data wrong as often as engine). | SETTLED | `memory:no-oracle-intended-design-is-truth` |
| E2 | Ban the words "oracle"/"golden"; the differential-vs-alpha comparison is a consistency check, not a verdict. | SETTLED | `memory:no-oracle-intended-design-is-truth` |
| E3 | Legacy `tree/` eval + `tree/scope-frame.ts` / `reference.ts` are NOT correctness references (known bugs) — mechanism ideas only. | SETTLED | `memory:no-oracle-intended-design-is-truth`, `RESOLVER-SHAPE-SPEC.md` |
| E4 | `graduate-v5`, `upstream/alpha`, `legacy/*.css`, and `renderRealOracle`/`renderRealOracleNested` are NOT the intended-design reference. | SETTLED | `ORACLE.md` (pitfalls) |
| E5 | Real Less 4.x is NOT the target — v5 diverges intentionally; 4.x is at most a cross-check for non-diverging behaviors. | SETTLED | `memory:no-oracle-intended-design-is-truth` |

## 1. Merge operators (`+:` / `+_:`)

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| M1 | Merge ANCHOR = **LAST-occurrence** (jess v5), NOT less@4 first-occurrence anchor. Emit-order divergence on `merge.less` is intended, not a bug. | **SETTLED** ⚠ see note | `CUTOVER-STATUS.md:43` ("no less@4 first-anchor golden adopted"); `memory:spine-merge-last-occurrence-anchor` |
| M2 | `+:` = comma-merge, `+_:` = space-merge. Both LOWER (parse/build-time) to a self-ref declaration `prop: $['prop']?<sep>v` (`?` = optional self-lookup, empty if unbound, no error). Normal eval + resolver do the rest — no special merge pass. | SETTLED | `memory:less-merge-plus-lowering-self-ref` (owner 2026-07-17) |
| M3 | Flatten is associative ONLY when both operands materialize to same-kind List/Sequence nodes (→ one flat list); otherwise it is a serialize-time concat `<self><sep><value>`. | SETTLED | `memory:less-merge-plus-lowering-self-ref` |
| M4 | Flatten is a serialize-time PROJECTION — do NOT eagerly clone a merged node; materialize only if a visitor needs to traverse it. | SETTLED | `memory:less-merge-plus-lowering-self-ref`, `memory:spine-is-projection-not-mutation` |
| M5 | Nil-elision on serialize: a Nil value (unbound optional self-ref) emits nothing AND drops the separator that would follow it — so the first/unbound occurrence prints with no leading separator. | SETTLED | `memory:less-merge-plus-lowering-self-ref` |
| M6 | `!important` on any chain member propagates to the merged emit (fixed `3cc298585`). | SETTLED | `memory:spine-merge-last-occurrence-anchor` |

> ⚠ **M1 CONTRADICTION FLAG (2026-07-17).** A recent agent (task #36) mis-flipped
> the `ast/` merge path + the alpha `merge.less`/`merge.css` test-data + the
> bottom section of `proposed-alpha-corrections/README.md` to **FIRST**-occurrence
> ("matches less.js `_mergeRules`"). That contradicts the LAST-occurrence ruling
> (M1). A separate agent is reverting the code/test-data flip; the ruling here is
> **LAST-occurrence**. Do not re-adopt first-anchor from those docs until the
> owner explicitly reverses M1. The legacy `tree/util/spine-merge.ts` correctly
> still implements last-occurrence.

## 2. Extend (`:extend` / `$extend`)

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| X1 | `all` extend with a COMBINATOR target = whole-selector match + append (`.ext8 > .ext9, .zoo`). Interior-combinator-span substitution mid-complex = NOT specified. | SETTLED + OPEN edge | `EXTEND-SEMANTICS.md` §9 |
| X2 | EXACT extender (no `all`) folds into a block header ONLY if the block has no child rules; if it has children, emit the extender as a SEPARATE sibling carrying the block's DIRECT declarations (dropped if empty). `all`-extend propagates into sub-parts and stays folded. | SETTLED (owner-confirmed; pending owner applying on alpha) | `proposed-alpha-corrections/README.md`, `EXTEND-SEMANTICS.md` §12.1 |
| X3 | `all` (partial) substitution grafts `:is(<matched>, <extender…>)` into the matched compound (v5 `:is()` compaction); whole-compound match → plain selector-list append (no `:is()`). | SETTLED | `EXTEND-SEMANTICS.md` §3/§5 |
| X4 | Jess `$extend .b;` ≡ Less `:extend(.b all)` (partial default); `$extend .b !exact;` ≡ Less exact `:extend(.b)`. | SETTLED | `EXTEND-SEMANTICS.md` §4 |
| X5 | The `:extend()` clause is never emitted; matching runs on the COMPILED selectors (after nesting), not source text. | SETTLED | `EXTEND-SEMANTICS.md` §1 |
| X6 | Exact-match strictness: leading star (`*.c`≠`.c`), pseudo-class order, and `nth` form are significant; attribute-quote type is NOT (`[t=x]`≡`[t="x"]`). | SETTLED (from `extend.md`; not all fixture-gated) | `EXTEND-SEMANTICS.md` §3 |
| X7 | Interpolated selector as a match TARGET matches nothing ("extend can't match selectors with variables"); interpolated EXTENDER selector works. | SETTLED | `EXTEND-SEMANTICS.md` §10 |
| X8 | v5 dedups extender branches where Less 4.x duplicated. | OPEN (recorded, confirm) | `EXTEND-SEMANTICS.md` §12.6 |
| X9 | Cross-`@import` extend routing (currently eval-routed) — final routing unsettled; output is byte-identical regardless. | OPEN | `EXTEND-SEMANTICS.md` §12.5 |

## 3. Value semantics

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| V1 | UN-OPERATED value literals (dimension AND color) = SOURCE-VERBATIM / lazy-print (`1.0px`→`1.0px`, `2PX`→`2PX`, `1e3px`→`1e3px`, `#989`→`#989`); only COMPUTED (operated) values canonicalize. Diverges from 4.x, which canonicalizes un-operated dimensions. | SETTLED | `memory:v5-preserve-unoperated-values-verbatim`, `VALUE-LITERAL-TAG-SPEC.md` §0 |
| V2 | CSS-superset verbatim pass-through: valid-CSS constructs (e.g. un-operated `rgb(50%,0,0)`) emit source verbatim; run the Less fn ONLY when the value is operated OR args are Less-non-CSS (contain a Less var/expr or a historical-Less form). | SETTLED | `memory:css-superset-verbatim-passthrough` |

## 4. Output defaults & shape

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| O1 | v5 default output = NESTED (`collapseNesting:false`), NOT 4.x flatten. 4.x flatten = explicit opt-in flag. Default owned by `jess-plugin-less`; consumers import it. | SETTLED | `memory:less-v5-default-collapsenesting-false` |
| O2 | v5 does NOT merge `@media`; extend cascades are `:is()`-compacted. `legacy/*.css` (expanded, no `:is()`) is the 4.x shape, not v5. | SETTLED | `ORACLE.md`, `memory:fixture-v5-vs-4x-legacy-convention` |
| O3 | Compressed output target = dart-sass `compressed` parity via differential comparison. | DEFERRED | `memory:compress-already-minimal-bit` |

## 5. Variables & resolution

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| R1 | Regular `@`/`$` variables are LAZY (evaluated on demand at reference time, re-evaluated per reference). | SETTLED | `VARIABLE-RESOLUTION-SEMANTICS.md` §1 |
| R2 | Regular resolution is order-INDEPENDENT, scope-UPWARD, LAST-WINS within a scope (forward refs work). | SETTLED | `VARIABLE-RESOLUTION-SEMANTICS.md` §2 |
| R3 | Resolve failure = hard EVAL ERROR, UNLESS an explicitly OPTIONAL resolve (→ sentinel). No `@name`-as-literal passthrough (delete it). | SETTLED | `memory:v5-resolve-failure-is-eval-error-unless-optional` |
| R4 | NO cyclic variables — by per-DECLARATION-NODE exclusion, NOT a recursion depth-cap. `@a:1; @a:@a+1` → `2` (second excludes only itself, sees the first). The `MAX_VAR_DEPTH` cap in `ast/` is a load-bearing STOPGAP over a real bug until exclusion lands. | SETTLED | `memory:v5-resolve-failure-is-eval-error-unless-optional`, `RESOLVER-SHAPE-SPEC.md` |
| R5 | Two variable models by `!`: `$foo`/`@foo` = Less-style stack (lazy, order-independent, last-wins); `$!foo` = Sass-style live cell (sequential, mutable, read-current-then-write). No "snapshot" mode; the `@`-vs-`$` position gate is deleted (identical). | SETTLED | `memory:v5-resolve-failure-is-eval-error-unless-optional`, `VARIABLE-RESOLUTION-SEMANTICS.md` |
| R6 | `:=` = reassign the NEAREST existing binding INCLUDING current scope ("drop the `let`", don't shadow); unbound anywhere → `ReferenceError`. `!global` just translates to `:=`. Distinct from `setDefined`. | SETTLED | `memory:nearest-outer-assign-semantic`, `memory:v5-resolve-failure-is-eval-error-unless-optional` |
| R7 | Member access `$.foo` / `$ns.foo` resolves against BOTH the var stack and same-named CSS property decls; both present → `ReferenceError` (ambiguous); neither → `ReferenceError`. Tracked via a LAZY per-name property cache, never an eager property index. | SETTLED | `memory:v5-resolve-failure-is-eval-error-unless-optional` |

## 6. Parsing & grammar

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| P1 | Math mode (`parens-division` default / `always` / `strict`) is a PARSE-TIME input — `/` parses to a different AST (or hard error) per mode. A `/` parse error CAN be a math-mode-wiring bug, not a grammar gap. | SETTLED | `memory:less-math-mode-is-parse-time` |
| P2 | Custom-property (`--*`) values AND unknown at-rule preludes = PERMISSIVE arbitrary-token-stream at the CSS base. Less adds ONLY `@{...}` interpolation; a bare `@var` or fn call inside stays LITERAL text. | SETTLED | `memory:v5-permissive-custom-prop-and-unknown-atrule` |
| P3 | Condition grammar generalized: drop parse-time name-special-casing of `if()`/`boolean()`; conditions are first-class in call-arg/paren positions. `.less` normalizes permissive forms (inserts implicit `Paren`); `.jess` is strict (must group `and`/`or`, no implicit precedence). | SETTLED (landed `ea29e208f`) | `memory:condition-grammar-generalization` |
| P4 | "Sass+" dialect REJECTS invalid CSS where Sass tolerates it (escaped at-rule keywords, bogus combinators). Valid CSS = correctness; Sass-parity is NOT the target. | SETTLED | `memory:sass-plus-dialect-reject-invalid-css` |
| P5 | SCSS should compose on the CSS base (sibling to Less), NOT on Less — via a dialect-neutral `preprocessorBase`. No dialect composes on another. | DIRECTIONAL (step 1 landable now; 2–4 gated on in-flight grammar edits) | `memory:scss-should-compose-on-css-not-less` |
| P6 | LAW: no regex outside Parseman's `regex()` combinator on the maintained path (legacy `BuilderHost` regexes die with legacy retirement). | SETTLED | `memory:parseman-functional-grammars`, `.cursor/rules` |

## 7. Modules, at-rules, JS

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| A1 | The `@-` dash prefix = "explicitly the compiler at-rule" (namespace-safe). `.jess` REQUIRES the dash; `.less` is bare-tolerant. The five: `@-import @-compose @-use @-from @-export`. | SETTLED | `memory:import-atrule-semantics-less-vs-jess` |
| A2 | `@import`/`@-import` = leaky source-fold, DISCOURAGED (warn → `@compose`); `@compose`/`@-compose` (isolated/namespaced) + `@use`/`@-use` (script import, replaces `@plugin`) = the module system, NOT deprecated. | SETTLED | `memory:import-atrule-semantics-less-vs-jess` |
| A3 | Inline backtick JavaScript (`` `expr` ``) is REMOVED entirely in v5 (not opt-in) → use `@use`/`@-use` script modules. | SETTLED | `memory:backtick-js-removed-v5` |
| A4 | `@-export` (repurposed `@forward`) first concrete role = expose ROOT/entry-level VARIABLES as an external JS API (variables-only initially); DISTINCT from module-member re-export, and distinct from R3 live-binding. | OPEN thread | `memory:forward-as-export-design-thread` |
| A5 | `%()` string-format parses as a PLAIN call to a public fn (canonical string-format = interpolation). Rename the kernel off the illegal `%` name; NOT `format` (CSS `format()` collision), NOT `sprintf` (owner-rejected). Runtime NAME is unresolved (recommended `str-format`, pending owner). | SETTLED shape, OPEN name | `memory:percent-format-to-sprintf-design` |
| A6 | Deprecation infrastructure EXISTS but is NOT wired in v5 — only `selector/parentless-ampersand` + extend-roots diagnostics fire today; deprecation emission is unstarted feature work. | SETTLED (state of the world) | `memory:deprecation-emission-not-wired-v5` |

## 8. Core architecture

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| C1 | tree2 = THE definitive core rewrite (destination representation), now shipped as the `ast/` engine — no longer "just an arena perf experiment". | SETTLED (owner-ratified 2026-07-15) | `AST-ARENA-EXPERIMENT-HANDOFF.md`, `memory:tree2-is-definitive-core-rewrite` |
| C2 | P0 KEYSTONE: the parser is the SOLE source of structure; core NEVER re-derives structure from bytes. | SETTLED | `TREE2-CONSTITUTION.md` P0, `memory:parser-owns-structure-no-byte-rederivation` |
| C3 | Unified node model: ONE plain-data representation; discriminant `type:'Dimension'` (PascalCase = Less `.type`); numeric `Kind`/lowercase `kind` are dead. Serialize + value-eval = free functions on nodes (tree-shakeable), nodes stay pure minimal data. | SETTLED | `UNIFIED-NODE-MODEL-SPEC.md`, `memory:ast-v2-unified-node-model`, `memory:arena-serialize-external-treeshake` |
| C4 | Committed render architecture = node-reuse + live-binding spine; folds are serialize-time PROJECTION, not tree mutation. | SETTLED | `memory:committed-architecture-object-reduction`, `memory:spine-is-projection-not-mutation` |
| C5 | Cutover goes to 100% — a shape may be DEFERRED but never permanently eval-fallback-abandoned (HARD RULE #6). | SETTLED | `CUTOVER-CHECKLIST.md`, `memory:feedback-no-permanent-eval-fallback` |

## 9. Positioning (context, not a code rule)

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| Z1 | Jess = spiritual successor to Less.js + Sass + CSS Modules + CSS-in-JS + PostCSS (no Stylus). | SETTLED | `memory:positioning-spiritual-successor` |
| Z2 | Immediate goal = v5 ALPHA matching Less 4.x perf on `.less` (benchmark.less, not bootstrap). SCSS perf = non-goal for the alpha. | SETTLED | `memory:immediate-goal-less-alpha-4x-perf` |
