# Design Decisions — canonical owner decision ledger

This is the **flat, greppable canonical ledger** for owner semantic and
architecture decisions. It holds both SETTLED rulings and OPEN owner questions,
so agents do not re-litigate settled work or silently implement an unanswered
proposal. One row per decision: the ruling/proposal + a pointer to its detail
doc and/or owner-memory note.

Rules of the road:

- **A row here is the ruling.** If code, a test, or a `.css` test-data file
  disagrees with a SETTLED row, the code/test/data is what changes — not the
  ruling. Confirm against the linked detail before acting.
- **OPEN rows are explicitly not settled** — they record the current state of a
  live thread so nobody mistakes silence for a decision.
- **"Source" pointers** are relative paths inside this dir unless prefixed
  `memory:` (a note in the owner's project memory,
  `.claude/projects/-Users-matthew-git-oss-jess/memory/<name>.md`).

## Ledger process (PROPOSED)

Every owner question that can alter parser facts, AST shape, lookup, evaluation,
or emitted CSS gets an `OPEN` row here before implementation. Its linked detail
record must state the exact owner proposal, known unknowns, and required
invariants/tests. The owner changes only the row's status/ruling when deciding;
the implementing agent then links the landed code and tests. Superseded rows
remain with their status and replacement pointer rather than being deleted.

## 0. The epistemics — there is NO external authority (read first)

Correctness is **the documented intended v5 design**, nothing else. The less.js
`alpha` top-level `.css` test-data AND the Jess tests are *imperfect encodings*
of that design — kept up to date toward it, and wrong as often as the engine is.
When the engine disagrees with a `.css` file, the question is "which matches the
intended design?" — then reconcile the loser TO the design. Do not treat any
file as an authority to blindly match.

Owner also **banned the authoritative-reference framing words** — say "the intended
design" / "the expected `.css` output" / "reconcile the test-data to the design."
Several existing docs (`REFERENCE.md`, `EXTEND-SEMANTICS.md`,
`GOAL1-SCORECARD.md`, and many spec headers) still use the banned framing; treat
their *content* as valid consistency-check guidance, but their *"authoritative
reference"* framing is superseded by this row. Source:
`memory:intended-design-is-truth` (owner 2026-07-17).

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| E1 | No external authority: correct = documented intended v5 design; alpha `.css` + Jess tests are imperfect encodings reconciled TO the design (test-data wrong as often as engine). | SETTLED | `memory:intended-design-is-truth` |
| E2 | Ban the authoritative-reference framing words; the differential-vs-alpha comparison is a consistency check, not a verdict. | SETTLED | `memory:intended-design-is-truth` |
| E3 | Legacy `tree/` eval + `tree/scope-frame.ts` / `reference.ts` are NOT correctness references (known bugs) — mechanism ideas only. | SETTLED | `memory:intended-design-is-truth`, `RESOLVER-SHAPE-SPEC.md` |
| E4 | `graduate-v5`, `upstream/alpha`, `legacy/*.css`, and `renderRealOracle`/`renderRealOracleNested` are NOT the intended-design reference. | SETTLED | `REFERENCE.md` (pitfalls) |
| E5 | Real Less 4.x is NOT the target — v5 diverges intentionally; 4.x is at most a cross-check for non-diverging behaviors. | SETTLED | `memory:intended-design-is-truth` |

## 1. Merge operators (`+:` / `+_:`)

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| M1 | Merge ANCHOR = **LAST-occurrence** (jess v5), NOT less@4 first-occurrence anchor. Emit-order divergence on `merge.less` is intended, not a bug. | **SETTLED** | `archive/CUTOVER-STATUS-2026-07-18.md:44` (historical status snapshot); `memory:spine-merge-last-occurrence-anchor` |
| M2 | `+:` = comma-merge, `+_:` = space-merge. Both LOWER (parse/build-time) to a self-ref declaration `prop: $['prop']?<sep>v` (`?` = optional self-lookup, empty if unbound, no error). Normal eval + resolver do the rest — no special merge pass. | SETTLED | `memory:less-merge-plus-lowering-self-ref` (owner 2026-07-17) |
| M3 | Flatten is associative ONLY when both operands materialize to same-kind List/Sequence nodes (→ one flat list); otherwise it is a serialize-time concat `<self><sep><value>`. | SETTLED | `memory:less-merge-plus-lowering-self-ref` |
| M4 | Flatten is a serialize-time PROJECTION — do NOT eagerly clone a merged node; materialize only if a visitor needs to traverse it. | SETTLED | `memory:less-merge-plus-lowering-self-ref`, `memory:spine-is-projection-not-mutation` |
| M5 | Nil-elision on serialize: a Nil value (unbound optional self-ref) emits nothing AND drops the separator that would follow it — so the first/unbound occurrence prints with no leading separator. | SETTLED | `memory:less-merge-plus-lowering-self-ref` |
| M6 | `!important` on any chain member propagates to the merged emit (fixed `3cc298585`). | SETTLED | `memory:spine-merge-last-occurrence-anchor` |

> ✅ **M1 CONTRADICTION RESOLVED (2026-07-17).** Task #36 (`23b78263e`) had mis-flipped
> the `ast/` merge path + docs to **FIRST**-occurrence ("matches less.js `_mergeRules`"),
> contradicting the LAST-occurrence ruling (M1). REVERTED on
> `fix/merge-anchor-revert-to-last`: `serialize.ts` `mergeFold` anchors at
> `indices[indices.length - 1]` again; `proposed-alpha-corrections/merge.css` (LAST-order
> expected output) restored; the R4 spec / feature-completeness / corrections README all read
> LAST; `alpha-oracle-baseline.json` records `merge/merge.less` as an expected `DIFF`
> (ast/ correct per design, the alpha expected output is the outlier awaiting upstream correction to
> LAST). The task-#36 `!important`-strip / value-canonicalization fix in `custom-props.ts`
> was KEPT (correct, unrelated). Legacy `tree/util/spine-merge.ts` was always LAST.

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
| V3 | Escaped `~"..."` = opaque Anonymous, never numeric-sniffed: `=` cross-compares by CONTENT (`3 = ~"3"` → true), `<`/`>` vs a number = not-comparable (guard does NOT fire). | SETTLED | `V5-OUTPUT-SEMANTICS.md` §B1 |

## 4. Output defaults & shape

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| O1 | v5 default output = NESTED (`collapseNesting:false`), NOT 4.x flatten. 4.x flatten = explicit opt-in flag. Default owned by `jess-plugin-less`; consumers import it. | SETTLED | `memory:less-v5-default-collapsenesting-false` |
| O2 | v5 does NOT merge `@media`; extend cascades are `:is()`-compacted. `legacy/*.css` (expanded, no `:is()`) is the 4.x shape, not v5. | SETTLED | `REFERENCE.md`, `memory:fixture-v5-vs-4x-legacy-convention` |
| O3 | Compressed output target = dart-sass `compressed` parity via differential comparison. | DEFERRED | `memory:compress-already-minimal-bit` |

### 4a. Output formatting — serialization detail

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| F1 | OPERATORS / SEPARATORS = SPACED: `/`, `+`, `-`, `*` and list commas emit WITH surrounding spaces regardless of source (`12px/16px`→`12px / 16px`, `grid-area:1/2/3/4`→`grid-area: 1 / 2 / 3 / 4`). They are separators, NOT values — the verbatim-value rule (V1) does NOT govern them. 4.x's tight `12px/16px` is the OLD convention, not the v5 target. | SETTLED | `V5-OUTPUT-SEMANTICS.md` §A2 |
| F2 | EXCEPTION to F1: the `An+B` microsyntax in `:nth-child()`/`:nth-*()` (`2n+1`, `-n+3`) is SELECTOR syntax — stays unspaced, never evaluated, never routed through the value/operator path. | SETTLED | `V5-OUTPUT-SEMANTICS.md` §A3 |
| F3 | CSS-function-SHAPE (`name(...)` with NO space before `(`) passes through VERBATIM even when `name` is not a real CSS function (`solid(#a8000b)`→`solid(#a8000b)`). | SETTLED | `V5-OUTPUT-SEMANTICS.md` §A4, `memory:css-superset-verbatim-passthrough` |
| F4 | Grouping-parens dissolve after evaluation: `keyword (expr)` — a SPACE then parens — is MATH GROUPING; once computed, the parens do NOT survive to output (`solid (@a*.66 + @b*.33)`→`solid #a8000b`, like `(2px+3px)`→`5px` never `(5px)`). Corollary: `ast/` must NOT collapse the space into the F3 function shape (`solid (x)` ≠ `solid(x)`). Distinct from F3. | SETTLED (owner-confirmed 2026-07-18; demonstrated by operation tests + `.less` fixtures) | `V5-OUTPUT-SEMANTICS.md` §A5 |
| F5 | CSS value-functions un-operated = bare verbatim Call: `rgb`/`rgba`/`hsl`/`hsla` with literal args + no enclosing operation emit VERBATIM (a color-tagged `Call`, NOT an eager-invoked native fn — invoking round-trips through rgb and mangles precision/spelling). Invoke ONLY when operated (`lighten(hsl(...))`, arithmetic) or given Less/variable args (`hsl(@h,...)`). | SETTLED | `V5-OUTPUT-SEMANTICS.md` §A6, `memory:css-superset-verbatim-passthrough` |

## 5. Variables & resolution

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| R1 | Regular `@`/`$` variables are LAZY (evaluated on demand at reference time, re-evaluated per reference). | SETTLED | `VARIABLE-RESOLUTION-SEMANTICS.md` §1 |
| R2 | Regular resolution is order-INDEPENDENT, scope-UPWARD, LAST-WINS within a scope (forward refs work). | SETTLED | `VARIABLE-RESOLUTION-SEMANTICS.md` §2 |
| R3 | Resolve failure = hard EVAL ERROR, UNLESS an explicitly OPTIONAL resolve (→ sentinel). No `@name`-as-literal passthrough (delete it). | SETTLED | `memory:v5-resolve-failure-is-eval-error-unless-optional` |
| R4 | NO cyclic variables — by per-DECLARATION-NODE exclusion, NOT a recursion depth-cap. `@a:1; @a:@a+1` → `2` (second excludes only itself, sees the first). The `MAX_VAR_DEPTH` cap in `ast/` is a load-bearing STOPGAP over a real bug until exclusion lands. | SETTLED | `memory:v5-resolve-failure-is-eval-error-unless-optional`, `RESOLVER-SHAPE-SPEC.md` |
| R5 | Two variable lookup modes: `$foo` = live/current; `$$foo` and Less `@foo` = scoped/final stack (lazy, order-independent, last-wins). `$!` is retired. Both `$foo:` and `$$foo:` create or update both bindings; the sigil selects lookup only. `$foo?:` tests live, `$$foo?:` tests scoped/final, `$foo :=` updates live, and `$$foo :=` updates scoped/final. No snapshot mode. | SETTLED | `memory:v5-resolve-failure-is-eval-error-unless-optional`, `VARIABLE-RESOLUTION-SEMANTICS.md` |
| R6 | `:=` = reassign the NEAREST existing binding INCLUDING current scope ("drop the `let`", don't shadow); unbound anywhere → `ReferenceError`. `!global` just translates to `:=`. Distinct from `setDefined`. | SETTLED | `memory:nearest-outer-assign-semantic`, `memory:v5-resolve-failure-is-eval-error-unless-optional` |
| R7 | Dot member access `$.foo` / `$ns.foo` resolves against BOTH variable declarations and same-named CSS property declarations in the member surface. It must produce exactly one candidate: multiple variable declarations, multiple property declarations, or candidates in both kinds are ambiguity errors; no candidate is a resolve error unless the terminal access is optional. Tracked via a LAZY per-name property cache, never an eager property index. | SETTLED | Owner correction, 2026-07-20 |
| R9 | Mixin var-unlock = LOW-PRIORITY leak: a variable unlocked by a mixin call is a low-priority binding — a LEXICAL binding always wins; the leaked var is used ONLY where nothing lexical binds. | SETTLED | `V5-OUTPUT-SEMANTICS.md` §B3 |
| R8 | Mixin self-reference = PARENT-EXCLUSION, the SAME exclusion principle as R4 (a self-reference that cannot make PROGRESS is excluded from candidacy), NOT "recursion detection". (a) A NON-PARAMETRIC ruleset self-call (`.a { .a(); }`, no new args) makes no progress → the enclosing frame is EXCLUDED from its own candidate set → renders once, NEVER errors. (b) A PARAMETRIC self-call with DIFFERENT args progresses and recurses; its guard is the termination mechanism (not part of the skip decision). (c) A genuine RUNAWAY (bad guard, e.g. `.loop($n) { .loop($n + 1) }`) is the ONLY error case: a HIGH depth backstop raises a clean `RangeError`, not a native stack overflow or low cap. | SETTLED (task #40) | canonical core mixin-recursion behavior tests |
| R10 | **Less property-merge lowering — owner-set semantic behavior:** `index+: a` yields `index: a`; then `index+: b` yields `index: a, b`. Each lowers conceptually to an ordinary declaration whose left operand is the scoped optional lookup `$$['index']?`: absent left collapses with its following separator omitted; present left yields prior value + separator + new value. The lookup is scoped/final, never live, and retains ordinary exclusion behavior. This explicitly rejects special merge anchoring and dialect-specific merge policy. **Representation remains open:** current `Reference`/`BracketLookup` has no terminal optional-reference fact, `VariableReference` has no optional field, and serializer `optional` is render-wide rather than a per-reference feature. The parser spelling, typed optional-reference/Nil shape, and lowering mechanics are not approved. **Required invariants/tests before landing:** first-miss collapse; subsequent comma and space accumulation in source order; scoped/exclusion behavior; repeated declarations, property reads, mixin/import contributions, and `!important`; typed parser facts with no source rebuild/reparse. | SETTLED semantic behavior / OPEN AST-parser representation | Owner clarification 2026-07-21; `nodes.ts` VariableLookup/Declaration/ReferenceStep, `serialize.ts` resolveVarRef/mergeFold, `VARIABLE-RESOLUTION-SEMANTICS.md`, `REFERENCE-CALL-PLAN.md` |

## 6. Parsing & grammar

## 6a. AST v2 public vocabulary

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| N1 | The canonical document node is `Stylesheet`; `Root` is deleted, not retained as an alias. | SETTLED | Owner decision, 2026-07-19; `HANDOFF.md` |
| N2 | Use `VariableDeclaration`, `VariableReference`, and `PropertyReference` as the public AST names. The shorter `VarDeclaration`, `VarRef`, and `PropRef` names are transitional vocabulary to remove in the coordinated API rename. | SETTLED | Owner decision, 2026-07-19 |
| N3 | Keep `List`, `Quoted`, `Interpolation`, and `ImportantValue` as public names. `ImportantValue` remains a node because importance can be carried by a variable/value before it is hoisted to its owning declaration. | SETTLED | Owner decision, 2026-07-19; `nodes.ts` importance wrapper |
| N4 | The selector hierarchy is `SelectorList`, `ComplexSelector`, `CompoundSelector`, and `SimpleSelector`. | SETTLED | Owner decision, 2026-07-19 |
| N5 | Less `@@name` has a Jess equivalent: `@name: color; @color: red; x: @@name` maps to `$name: color; $color: red; x: $[$name]`. It is an ambient computed **member access** whose selected member is resolved in the variable namespace: inner `$name` selects the name and the outer lookup resolves that selected variable. It is not `PropertyReference` or the Jess `$$` scoped-lookup sigil. `VarIndirect` remains the current internal AST spelling pending the coordinated member-reference public model. | SETTLED + OPEN replacement name | Owner correction, 2026-07-20; R3 correction, 2026-07-20 |
| N5a | The generic left-associated lookup/call chain is `Reference`. Its base is a leaf reference or namespace fact; its typed steps may be dot lookup, bracket lookup, or call, in any order. `VariableReference` and `PropertyReference` remain leaf bases, not competing chain representations. | SETTLED | Owner approval, 2026-07-20; `REFERENCE-CALL-PLAN.md` |
| N5b | Less `[]` is not an `UnnamedLookup`: it lowers to the existing `BracketLookup { keyKind: 'index', key: -1 }` after the implicit zero-argument `MixinCall` base. | SETTLED | Owner decision, 2026-07-20; `REFERENCE-CALL-PLAN.md` |
| N6 | `MapAccessor`, `Paren`, and `SpacedValue` are not approved public names. Their replacement must follow the actual semantic model: bracket access is a kind-specific reference/access, parens may need a broader block/value model, and an ordinary space-delimited value is not automatically a distinct semantic collection. | OPEN | Owner decision, 2026-07-19 |
| N7 | A literal CSS `@import` is an `AtRuleStatement`, not `ImportAtRule`. Sass `@use` is source syntax, not an AST node named `ModuleUse`: the SCSS parser classifies a static authored path directly. `@use "sass:math"` rewrites to Jess `@-use "#sass/math"` / `ModuleImport`; clear script-module paths (including JSON) become `ModuleImport`; stylesheet paths become `@-compose` / `StyleImport`. `@forward` is the existing `StyleImport` with `forward: true`, rendered as `@-export`; no separate `Export` node is needed. Retained Context/plugins resolve, load, cache, and evaluate those facts afterward. Dynamic paths and configuration/filtering forms remain typed-model work. Legacy `StyleImport`/`JsImport` may be farmed for semantic facts and edge cases only; their node shapes and resolver/eval machinery are not a porting source. | SETTLED | Owner correction, 2026-07-19 |

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| P1 | Math mode (`parens-division` default / `always` / `strict`) is a PARSE-TIME input — `/` parses to a different AST (or hard error) per mode. A `/` parse error CAN be a math-mode-wiring bug, not a grammar gap. | SETTLED | `memory:less-math-mode-is-parse-time` |
| P2 | Custom-property (`--*`) values AND unknown at-rule preludes = PERMISSIVE arbitrary-token-stream at the CSS base. Less adds ONLY `@{...}` interpolation; a bare `@var` or fn call inside stays LITERAL text. | SETTLED | `memory:v5-permissive-custom-prop-and-unknown-atrule` |
| P3 | Condition grammar generalized: drop parse-time name-special-casing of `if()`/`boolean()`; conditions are first-class in call-arg/paren positions. `.less` normalizes permissive forms (inserts implicit `Paren`); `.jess` is strict (must group `and`/`or`, no implicit precedence). | SETTLED (landed `ea29e208f`) | `memory:condition-grammar-generalization` |
| P4 | "Sass+" dialect REJECTS invalid CSS where Sass tolerates it (escaped at-rule keywords, bogus combinators). Valid CSS = correctness; Sass-parity is NOT the target. | SETTLED | `memory:sass-plus-dialect-reject-invalid-css` |
| P5 | SCSS should compose on the CSS base (sibling to Less), NOT on Less — via a dialect-neutral `preprocessorBase`. No dialect composes on another. | DIRECTIONAL (step 1 landable now; 2–4 gated on in-flight grammar edits) | `memory:scss-should-compose-on-css-not-less` |
| P6 | LAW: parser recognition uses Parseman grammar combinators only; handwritten regexes, scanners, and recovery parsing are deletion targets. | SETTLED | `AGENTS.md`, `GRAMMAR-RELOCATION-DESIGN.md` |
| P7 | Bare `@var` in an at-rule PRELUDE = HARD ERROR in v5 (stricter than 4.x's warning; e.g. `@supports (@cond)`), EXCEPT inside a declaration-value paren. `@{var}` interpolation is the migration target. | SETTLED | `V5-OUTPUT-SEMANTICS.md` §B4, `memory:less-supports-variable-prelude-strict` |
| P8 | `if()`/`boolean()`/`not()` conditions are BRANCH-LAZY: the untaken branch is NOT evaluated (`if(false, 1/0, 7)`→`7`). (Structuring/first-class-ness = P3.) | SETTLED | `V5-OUTPUT-SEMANTICS.md` §B5 |

## 7. Modules, at-rules, JS

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| A1 | The `@-` dash prefix = "explicitly the compiler at-rule" (namespace-safe). `.jess` REQUIRES the dash; `.less` is bare-tolerant. The five: `@-import @-compose @-use @-from @-export`. | SETTLED | `memory:import-atrule-semantics-less-vs-jess` |
| A2 | `@import`/`@-import` = leaky source-fold, DISCOURAGED (warn → `@compose`); `@compose`/`@-compose` (isolated/namespaced) + `@use`/`@-use` (script import, replaces `@plugin`) = the module system, NOT deprecated. | SETTLED | `memory:import-atrule-semantics-less-vs-jess` |
| A3 | Inline backtick JavaScript (`` `expr` ``) is REMOVED entirely in v5 (not opt-in) → use `@use`/`@-use` script modules. The grammar rejects it with one shared diagnostic; no parser-specific pre-guard or render fallback exists. | SETTLED | `memory:backtick-js-removed-v5` |
| A4 | `@-export` (repurposed `@forward`) first concrete role = expose ROOT/entry-level VARIABLES as an external JS API (variables-only initially); DISTINCT from module-member re-export, and distinct from R3 live-binding. | OPEN thread | `memory:forward-as-export-design-thread` |
| A5 | `%()` string-format parses as a PLAIN call to the public `string-format` fn (canonical string-format = interpolation; `%()` is a compat alias). Name is `string-format` (whole-word) — NOT `format` (CSS `format()` collision), NOT `sprintf` (owner-rejected). | SETTLED | `memory:percent-format-to-sprintf-design` |
| A7 | `@import (reference)` = HIDDEN rules, visible ONLY where pulled in via `:extend`/mixin (per-branch visibility). Implemented as a cheap FLAG, not by marking nodes. | SETTLED | `V5-OUTPUT-SEMANTICS.md` §B6 |
| A6 | Deprecation infrastructure EXISTS but is NOT wired in v5 — only `selector/parentless-ampersand` + extend-roots diagnostics fire today; deprecation emission is unstarted feature work. | SETTLED (state of the world) | `memory:deprecation-emission-not-wired-v5` |
| A8 | `@use`/`@compose` **member access** — sigil'd `@var`/`$var` head + `[key]` READ + `.name(args)` CALL; module KIND decides member kind (`@compose`→mixin, `@use`→function), no member functions in Less `@compose`. The core Reference-call machinery (grammar chain + node + eval + chain/call render) is the buildable prerequisite; module semantics PROPOSED, pending owner sign-off. | OPEN (PROPOSED) | `REFERENCE-CALL-PLAN.md`, R6 Part D (`spec/R6-plugins-compat-modules.md:416-543`), R4 §R4.6, `memory:namespace-access-use-compose-model` |

## 8. Core architecture

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| C1 | tree2 = THE definitive core rewrite (destination representation), now shipped as the `ast/` engine — no longer "just an arena perf experiment". | SETTLED (owner-ratified 2026-07-15) | `AST-ARENA-EXPERIMENT-HANDOFF.md`, `memory:tree2-is-definitive-core-rewrite` |
| C2 | P0 KEYSTONE: the parser is the SOLE source of structure; core NEVER re-derives structure from bytes. | SETTLED | `TREE2-CONSTITUTION.md` P0, `memory:parser-owns-structure-no-byte-rederivation` |
| C3 | Unified node model: ONE plain-data representation; discriminant `type:'Dimension'` (PascalCase = Less `.type`); numeric `Kind`/lowercase `kind` are dead. Serialize + value-eval = free functions on nodes (tree-shakeable), nodes stay pure minimal data. | SETTLED | `UNIFIED-NODE-MODEL-SPEC.md`, `memory:ast-v2-unified-node-model`, `memory:arena-serialize-external-treeshake` |
| C4 | Committed render architecture = node-reuse + live-binding spine; folds are serialize-time PROJECTION, not tree mutation. | SETTLED | `memory:committed-architecture-object-reduction`, `memory:spine-is-projection-not-mutation` |
| C5 | Cutover goes to 100% — a shape may be DEFERRED but never permanently eval-fallback-abandoned (HARD RULE #6). | SETTLED | `archive/CUTOVER-CHECKLIST-2026-07-18.md`, `memory:feedback-no-permanent-eval-fallback` |
| C6 | Every public Less/Sass function must become a behavior-complete AST-v2 implementation in its existing dialect-owned file. The 72 `less/` ↔ `builtins/` overlaps are different implementations; freeze `builtins/` as parity evidence, port one function in place with old+direct-AST proof, then delete its duplicate only when behavior is identical. Legacy-node wrappers are not a final architecture. | SETTLED | Owner correction, 2026-07-21; `HANDOFF.md` |

## 9. Positioning (context, not a code rule)

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| Z1 | Jess = spiritual successor to Less.js + Sass + CSS Modules + CSS-in-JS + PostCSS (no Stylus). | SETTLED | `memory:positioning-spiritual-successor` |
| Z2 | Immediate goal = v5 ALPHA matching Less 4.x perf on `.less` (benchmark.less, not bootstrap). SCSS perf = non-goal for the alpha. | SETTLED | `memory:immediate-goal-less-alpha-4x-perf` |

## 10. Documentation scope

| # | Ruling | Status | Source / detail |
|---|--------|--------|-----------------|
| D1 | There is NO formal plugin architecture. Public plugin docs = the DE-FACTO shape of the existing plugins (`jess-plugin`, `jess-plugin-less`, `jess-plugin-scss`, `jess-plugin-node-modules`, `rollup-plugin-jess`). IN SCOPE: (a) registering a language/dialect, (b) extending parsers + resolution. OUT OF SCOPE for public docs: the VISITOR pattern (`visitor`/`beforeEvalVisitor`/`postEvalVisitor`) — that surface is the internal `jess-plugin-less-compat` less.js-4.x mechanism, NOT a stable public API; do not present it as supported. | SETTLED | `memory:jess-plugin-api-documented-scope` (owner 2026-07-17); page `docs-content/docs/jess/06-Advanced/06-plugins.md` |
| D2 | Owner 3-LOCATION documentation rule for decided features: (1) in-code JSDoc, (2) internal design doc (`docs/future/core-architecture/**` or `.cursor/rules/**`), (3) user-facing Docusaurus page (Jess and/or Less site). Coverage matrix + ranked gap backlog = `docs/future/core-architecture/DOC-COVERAGE.md`. | SETTLED | `DOC-COVERAGE.md` |
