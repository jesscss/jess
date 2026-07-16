# tree2 — Definitive-Rewrite Coverage Matrix & Done-Right Roadmap

> **RATIFIED 2026-07-15 (owner).**
>
> 1. **tree2 IS THE DESTINATION representation.** The `origin/dev` spine / eval-cutover
>    work — the D-EVAL flip, field-slim levers, and reuse-gate deletions — is **MOOT
>    under tree2** (stop investing in it as a destination). The spine remains the
>    **interim shipping alpha ONLY**. There is **NO second parallel cutover** on the old
>    tree. From the spine/cutover effort, port only the **DESIGNS**: the extend
>    PLAN/SOLVE/EMIT pipeline, live-binding / `BindingCell` semantics, the projection
>    visitor contract, the sourcemap/trivia divergence guards, and the governance
>    ratchets. Reaching parity, **flip the FRONT END to tree2** (a front-end swap, not a
>    monolithic in-place delete), gated on byte-identity vs the **intended-v5 goldens**.
> 2. **R0-FIRST:** build `collapseNesting:false` **nested-output** mode **BEFORE** extend.
>
> This doc is the governing coverage + roadmap plan for the tree2 core rewrite. The
> living experiment log stays in `AST-ARENA-EXPERIMENT-HANDOFF.md` (which now points
> here as the governing plan).

Branch of record: `experiment/tree2-cleanroom-20260715`. Code/doc citations are on that
branch unless marked `origin/dev`.

## What tree2 actually is today (verified against the code)

- **`packages/core/src/tree2/`** — clean-room data model. Base `Node` = a single `kind`
  tag (`node.ts`); concrete nodes in `nodes.ts`
  (Root/Rule/SelectorList/Complex/Compound/Simple/Declaration/VarDeclaration/Comment/Word/
  Dimension/SpacedValue/VarRef/Concat/Operation/FunctionCall/Paren/MixinDef/MixinCall/Param),
  `at-rule.ts` (AtRuleBlock/AtRuleStatement), `guard.ts` (GuardNode tree + `evalGuard`),
  `mixin-dispatch.ts` (arity / pattern / named / default / `@arguments` / rest selection).
- **`serialize.ts`** — external free-function eval+emit in ONE walk. Selector composition
  by interned/cached canonical strings (`Compound.canonical`, `Complex.canonical`); mixin
  placement = canonical-body + overlay frame (**zero clone / zero `inherit` —
  structurally absent**). Fast path + optional `trackPositions` lane. Value math delegated
  through an injected `ValueService` interface (`value-service.ts`).
- **`packages/core/src/tree2-frontend/`** — the boundary-crossing front end (allowed to
  touch parser + `../tree` provenance): `bridge.ts` (parser tree → tree2 nodes),
  `import-bridge.ts` (@import resolve/inline), `value-service.ts` (real impl: async record
  → sync replay, wrapping the legacy fns-registered render), `oracle.ts` + `__tests__/`
  censuses.
- **Boundary guard is real and green**: no `tree2/` file imports `../tree`.

Rungs done: selectors+nesting (3-4), mixin canonical-body+overlay (5), parser bridge+census
(6), variables+lexical scope (7), value-ops+functions (8), at-rules/@media (9a), @import
inline (9b), guards+pattern+named/default dispatch (9c). **Extend is BUILT** (`tree2/extend.ts`,
wired into `serialize.ts` — `computeExtends(root)`, zero-cost when no `:extend()` present).

**Critical distinction:** the doc `AST-FROM-SCRATCH-DESIGN.md` describes a *different,
older* arena POC (`adapter.ts`/`render.ts`/`types.ts`, emit-only after full eval, reused
`../tree`) — the **anti-pattern** preserved on `feature/greenfield-ast-design-20260714`,
NOT the clean-room tree2 on this branch. Do not conflate them; that doc's "three-layer
design target" section is a useful north star, but its "implemented" section is not this
code.

## Oracle policy governing this whole document (owner)

1. **Oracle = intended Jess v5 output.** The owner-maintained `.css` goldens are the v5
   expected outputs.
2. Where a feature mirrors less.js, the shape reference is the **less.js `alpha` branch
   output** (owner's `~/git/worktrees/less.js/` checkout) — **NOT** Less 4.x. Jess v5
   tracks alpha, which is precisely where extend output diverges from 4.x.
3. **Less 4.x and Sass are coverage / behavior-parity references only — never shape
   authorities.** A divergence from Less/Sass is intended v5, not a bug, unless the owner
   says otherwise. Jess's extend is treated as ~99–100% correct/intended (source the
   concrete `:is()`-compacted-vs-expanded form from alpha — do NOT assert it).
4. The only legitimate "bug" is an **internal regression vs Jess's own intended output**
   (e.g. an eval-vs-spine inconsistency), judged against Jess intent.

Consequence for tree2: its tests currently use the **legacy `tree` render as the
byte-identity oracle** (`oracle.ts`, `import-oracle.ts`). That is a valid *proxy for
intended-v5* only where the legacy render agrees with the owner `.css` goldens / less.js
alpha. §4 flags exactly where that proxy is unsafe.

---

# 1. COVERAGE MATRIX

Tags: **INCORP** = handled by shipped tree2 code · **BYCON** = tree2's model gives it for
free/cleanly · **NOTYET** = deferred but straightforward on current design · **NEEDS-DESIGN**
= current design has a shortcut or gap that must change to do it right.

## 1(a) Jess feature surface

### Less 4.x language

| Feature | Tag | Evidence (tree2) | Note |
|---|---|---|---|
| Variables + lexical scope, lazy, last-wins, shadowing | INCORP | `serialize.ts` `collectVars`/`lookupVar`/`valueText`; rung 7 | Reference substitution correct; scope is a Map-chain, zero clone. |
| Nesting + `&` composition | INCORP | `serialize.ts` `compose`/`composeOne`; `Compound/Complex.canonical` | Interned-string composition; **but only the flattened form** — see collapseNesting row. |
| Selector lists / compound / combinators / `:is()` grouping | INCORP | `nodes.ts` selector model; `parentToken` | `& > .x` under a *complex* parent still a known gap (rung 3-4 log). |
| Mixins (def + call, positional params) | INCORP | `MixinDef/MixinCall`; `expandCall` canonical-body+overlay | The decisive rung: zero clone/inherit. |
| Pattern-matching mixins | INCORP | `mixin-dispatch.ts` `bindArgs` pattern params | Byte-equality on eager-resolved args. |
| Named args / default params | INCORP | `bindArgs`; bridge `callArgs`/`mixinParams` | |
| `@arguments` / `@rest` (`...`) | INCORP | `bindArgs` (`arguments` Word, rest param) | |
| Mixin guards (`when`, and/or/not, cmp, type-fns) | INCORP | `guard.ts` `evalGuard`; `selectDefinitions` | Leaf truth delegated to `ValueService.evaluateGuardCondition`. |
| `default()` mixin | INCORP | `guard.ts` `guardUsesDefault`; two-pass select | |
| Mixin recursion / loops | INCORP (bounded) | `expandCall` unbounded in eval mode; record mode capped `MAX_RECORD_DEPTH=64` | Eval terminates via guards; record cap is a value-service scaffold artifact. |
| Operations (arithmetic, color) | INCORP-via-service | `Operation` node; `valueText` → `ValueService.evaluateOperation` | **Math not native** — see cross-cutting note. |
| Built-in functions (~120, `@jesscss/fns`) | INCORP-via-service | `FunctionCall`; `ValueService.callFunction`; `value-service.ts` wraps fns render | Same shortcut. |
| `@import` + once/multiple/optional, cross-scope vars | INCORP | `import-bridge.ts` `resolveImportStatements` | reference/inline/css/url() deferred (raise `UnsupportedShape`). |
| `!important` (declaration) | INCORP (as bytes) | bridge `rawDeclValue` keeps `!important` in the value text | No `important` field; carried in value bytes. Risk: no structured control (§4 R-important). |
| `@media` block + `@charset`/statement at-rules | INCORP | `at-rule.ts`; `emitAtRuleBlock`/`emitAtRuleStatement` | v5 does NOT merge sibling `@media` — matches intent. |
| `@import (reference)` / inline / `(css)` / url()/remote | NOTYET | `import-bridge.ts` raises `UnsupportedShape` | reference-mode needs visibility/suppression state (§4 R-ref). |
| Extend (`:extend`, `&:extend`, `all`, selector-attached) | INCORP | `tree2/extend.ts` (`computeExtends`); wired into `serialize.ts` (zero-cost when no `:extend()`) | Ported from `tree/extend/{plan,solve,emit,pipeline}.ts`. |
| Detached rulesets | NEEDS-DESIGN | none | Ruleset-as-value; tree2 value model has no ruleset value. |
| Merge `+` / `+_` | NEEDS-DESIGN | none | v5 last-occurrence anchor (owner) — build to Jess intent, not Less. |
| Namespaces / accessors `#ns.mixin()`, chained lookups | NEEDS-DESIGN | none; dispatch is flat-name only (`lookupMixinCandidates`) | Needs namespace-path resolution. |
| Maps `#map[key]`, ruleset/collection indexing | NEEDS-DESIGN | none | |
| Interpolation `@{var}` (selector/value/property) | INCORP | bridge builds `Interp` value nodes (`parseValue`/`interpFromString`); `serialize.ts` `evalInterp` resolves + renders them | Landed (selector/value/property-name interpolation render). |
| Escaping `~"..."`, string interpolation, `e()`/`%()` | NEEDS-DESIGN | none (escape via fns service partial) | |
| `@plugin` | NEEDS-DESIGN | none | v5-deprecated but must parse/gate. |
| Inline JS backtick | BYCON (removed) | n/a | Removed in v5 → parse error; nothing to build. |
| Math modes / unit modes | NEEDS-DESIGN | none in tree2 (parse-time in parser) | Governs how `/` parses; the ValueService must honor the configured mode. |
| `calc()` simplification (v5) | NOTYET | none | Isolated; deferred rung. |

**Cross-cutting NEEDS-DESIGN on value math:** the ValueService impl
(`tree2-frontend/value-service.ts`) computes math/functions by an **async record pass →
sync replay** that re-wraps and re-renders through the *legacy* fns-registered path. This is
byte-identical-by-construction and honored the owner's "shared value service" seam, but it
is a benchmark-tuned scaffold: it reparses expression source per key, needs a whole record
pre-pass, and re-enters the very engine tree2 replaces. For "done right" (and the
tree-shaken JS-module endgame) value math must become a **real synchronous
tree2-native/fns-backed evaluator over typed value nodes**, not a wrap-and-reparse of legacy
render.

### Less v5 changes

| Feature | Tag | Evidence | Note |
|---|---|---|---|
| **`collapseNesting:false` default (NESTED v5 output)** | **NEEDS-DESIGN** | `serialize.ts` `flatten`/`compose` only produce the *flattened* form | **Biggest silent gap.** tree2 emits only collapsed/flattened selectors (4.x / `collapseNesting:true`). The v5 *default* is nested output; tree2 has no nested-emit mode. Emit-time policy (arch E1), same walk, two forms. **R0.** |
| Deprecation system + warnings on `result.warnings` | NOTYET | none in tree2 | Infra exists in `core/deprecation.ts`,`warnings.ts`; only some fire. |
| `@use`/`@-use`/`@compose`/`@-import` semantics | NEEDS-DESIGN | @import handled; module semantics not | `@compose`/`@use` = module; `@-import`/`@import` = leaky fold + warn. |
| Backtick removal | BYCON | n/a | Nothing to build. |
| Permissive custom-prop `--*` + unknown at-rule preludes | NOTYET | at-rule prelude kept literal bytes; custom-prop not special-cased | Base CSS permissiveness; bridge opaque-bytes, likely fine but unverified. |
| calc simplification | NOTYET | none | |

### Sass+ dialect

| Feature | Tag | Evidence | Note |
|---|---|---|---|
| SCSS engine, reject-invalid-CSS stance | NEEDS-DESIGN | none | SCSS is a perf NON-GOAL but a *coverage* target; the bridge is Less-parser-only today. |
| `!default` (`$foo?:`), `!global`, `:=` nearestOuter (`setDefined` vs nearestOuter) | NEEDS-DESIGN | none | Distinct scope-write semantics; tree2 scope is read-substitution only, no live reassignment. |

### .jess dialect

| Feature | Tag | Evidence | Note |
|---|---|---|---|
| `$var`, `$foo:`/`$foo?:`/`$foo :=`, live `$!foo`, readonly `!$`, private `_name` | NEEDS-DESIGN | none | Needs live-binding cells (arch A5/B4), not just a var Map. |
| `$ > mixin()` / `$apply` / chained namespaced apply | NEEDS-DESIGN | none | |
| `$extend`, `*.name`, anonymous mixins, `$content()` | NEEDS-DESIGN | none | |
| Interpolation `$(...)`/`$[key]`, selector capture `*[...]` | NEEDS-DESIGN | none | |
| Collections/maps `$x:{…}`, dot/index access, negative index | NEEDS-DESIGN | none | |
| `$if/$else`, `$for`, ranges, destructuring | NEEDS-DESIGN | none | Control flow; needs live counters (arch A5). |
| `@-use`/`@-from`/`@-export`/`@-compose` | NEEDS-DESIGN | none | |
| `.jess` parser deliberately trails | BYCON | memory `jess-parser-intentionally-trails` | Wire after Less+SCSS leave alpha. |

### Cross-cutting

| Feature | Tag | Evidence | Note |
|---|---|---|---|
| Plugin/visitor API (projection, enter + optional exit) | NOTYET / BYCON-friendly | none wired; but tree2 IS a projection serializer | Settled design (arch F1–F5) is `(node)=>Node\|void`, node in *output* form — tree2's per-emit-position node is exactly that. One exit consumer (`less-plugin-inline-urls`). Whole-tree mutate-then-observe deliberately unserved (arch G2). |
| Pre-eval visitors | NEEDS-DESIGN | none | Cannot fold into the single resolve-and-emit pass (arch F6/G1); keep as a separate gated pre-walk. |
| **less-compat bridge (`less.functions`/`less.tree`)** — the ONE external contract | NEEDS-DESIGN | none in tree2 | `less.functions`: custom fns resolve against live bindings via their own Call-eval — can plug into the ValueService seam. `less.tree`: 4.x node ctors are a real external API tree2's clean-room nodes don't expose; needs an adapter that is NOT a `../tree` import inside `tree2/`. |
| Source maps / sourcemap identity | NEEDS-DESIGN | `serialize.ts` `trackPositions` → coarse node→offset `Position[]` | Coarse rule-granularity lane exists; **sourcemap identity is the #1 divergence risk** (arch I.1); fieldSpans/valueSpans backend is an open measured fork (perf #9). Not proven. |
| Deprecation emission | NOTYET | none | |
| Error reporting (single-error vs tolerant) | NOTYET | tree2 raises `UnsupportedShape`; no diagnostic model | Grammar dual-use (strict-single-error / tolerant) is a compiler-mode concern. |
| CSS Modules | NEEDS-DESIGN | none | Positioning/roadmap; alpha-exit bar per memory. |
| CSS-in-JS / tree-shaken JS-module output | NEEDS-DESIGN | none — but tree2's lean-data + external-serializer + tagged nodes is the *right substrate* | The endgame the clean-room shape is aimed at; nothing emits JS modules yet. |
| PostCSS-like permissiveness | NOTYET | at-rule/custom-prop kept as bytes | |

## 1(b) Deferred core perf levers

Diagnosis anchors: gap ~6–7× (`benchmark.less` ~215–250ms vs Less ~35–37ms); the arena
track's own root cause = **per-placement selector reconstruction: ~73,005 selector
constructions + ~35,033 `inherit` per render, flat profile, selectors ≈86% of eval-new
allocation** (`AST-ARENA-EXPERIMENT-HANDOFF.md`; `AST-FROM-SCRATCH-DESIGN.md` §Q-40). Extend
`processExtends` ≈47ms is the one concentrated hotspot.

| Lever | tree2 status | Evidence | Note |
|---|---|---|---|
| Structural sharing / no per-placement clone/inherit (the #1 measured cost) | **BYCON — satisfied** | `serialize.ts` `expandCall` walks shared body; clone/inherit columns structurally zero (rungs 5,7,8 races) | tree2's whole thesis and its proven win. |
| strings-over-nodes (leaf tokens as strings) | BYCON | interned selector strings; static values captured as bytes | Interning from the start; producer-flip debt is on the *legacy* tree, moot here. |
| Provenance-inline span (kill PROV WeakMap) | BYCON | tree2 has no PROV WeakMap; `Position` computed at emit | External serializer owns offsets. |
| Single-writer / writer-fragment sharing; incremental refreshPositions; emit header/span | BYCON | `serialize.ts` one `chunks[]` buffer | External serializer is the end-state these retrofits converged toward. |
| Field-budget / FAST-V8 monomorphic / frozen→flag / rulesFlags / drop always-true fields / absent-metadata / lazy caches / ref-nuke | BYCON | `node.ts` base = one `kind`; nodes minimal fixed-shape classes | Debt-repayment on the fat legacy `Rules`/`Node`; a clean build never accretes them. Construction discipline, not features. |
| de-generatorify hot walk | BYCON | `serialize.ts` is plain recursion, no generators | |
| callable-lookup caching | BYCON (do NOT add) | — | Measured neutral-to-slower twice; a clean design should not add it. |
| **value-literal type tag (VALUE-LITERAL-TAG-SPEC)** | **NEEDS-DESIGN — OPEN** | tree2 has `Dimension`(num+unit) + byte-captured `Word`; no (string,tag) lazy leaf | Still must *decide* the encoding, N=1 vs N≥2 packing, `1.0`→`1` verbatim-vs-canonical byte call. **The arena diagnosis corrects the old fixation: hot allocation is SELECTORS, not values** — so this is a memory/cleanliness lever, not the decisive perf lever. |
| selector-containers-as-nested-arrays | NEEDS-DESIGN — OPEN/risky | tree2 uses selector *classes* with cached canonical strings | Parked (match-path regression risk); if tree2 ever flattens selector containers to arrays, measure on the extend-match bench specifically. |
| **D-EVAL flip principle** (eval does VALUES; STRUCTURE→emit; `F_STATIC` fast path) | **BYCON — embodied** | tree2 is one emit walk; structure (composition) is emit-time, values resolve per-leaf | tree2 *is* the flip done natively — the single most load-bearing open decision on the old tree is already tree2's architecture. Ratified moot-under-tree2 as a *migration step*. |
| fieldSpans/valueSpans three-way fork | **NEEDS-DESIGN — OPEN** | tree2's `trackPositions` is coarse; no sub-node delimiter trivia | Interned strings + coarse spans do NOT resolve sub-node trivia offsets. Backend (WeakMap / unified / serialize-time recovery) still a measured, correctness-trap-laden owner fork. |
| source-order / merge-coalescer / doc-order admission gates | SEMI-OPEN | tree2 lacks these passes (no merge, no extend yet) | The *fact-carrying* pattern (a bit + admission predicate) must be re-instantiated deliberately when merge/extend land; some may be reframed since structure is already emit-time. |
| "Predict before building" + cost-contract governance | CARRY | `CORE-CLEANUP.md` §Predict; `AGGRESSIVE-CUTTING-REVIEW.md` | Meta-lever tree2 already follows (predict → same-worktree A/B → byte-identity gate). Keep it. |

## 1(c) Architecture learnings

| Principle | tree2 status | Evidence | Note |
|---|---|---|---|
| One downward resolve-and-emit pass, no second output tree (A1) | **EMBODIED** | `serialize.ts` single walk | |
| Frame-threading spine is monolithic; value-frame lives the whole pass (A2/A3) | EMBODIED (partial) | `Frame` chain threaded through walk | Threads a scope frame; but read-substitution only, lacks live-cell mutation. |
| Value-frame uses call-site lexical chain, not `.parent` (A4) | EMBODIED | mixin call frame `parent: frame` = lexical chain | Args eager-resolved in caller frame (Less semantics). |
| **Live cells mutate in place (`$while` counter, `!global`, `:=`) (A5/B4)** | **MISSING — NEEDS-DESIGN** | tree2 `vars: Map<string,ValueNode>` immutable per frame | No `BindingCell`. Required for Sass+ `:=`/`!global`, `.jess` live `$!`, `$for`/`$while`. |
| Canonical nodes immutable templates; placements thin surfaces; no deep clone (B1) | **EMBODIED** | overlay frame; body stored once | tree2's foundational win. |
| Loosened invariant: output-invisible in-place mutation permitted (B2) | AVAILABLE-BYCON | cached `_canon`/`_hasAmp` on Complex/Compound | tree2 already memoizes canonical strings on the node — the permitted output-invisible cache. |
| Never reparent (`adopt`/`setParent` dissolved) (B3/B5) | BYCON | tree2 nodes have no `.parent`/`adopt`/`frozen` | The reparenting problem is designed out. |
| Async: sync by default, async only on genuine thenable (C1) | PARTIAL-DIVERGENCE | `serialize.ts` fully sync; async pushed into the value-service record pre-pass | tree2 sidesteps async by precomputing; the done-right value path must keep sync-by-default without a whole record pre-pass. |
| Extend = PLAN/SOLVE/EMIT woven in one pass; structural layer decoupled from value-frame; list-append order, no sort; zero-cost gate (D1–D7) | INCORP | `tree2/extend.ts` (`computeExtends`), wired into `serialize.ts` | Ported from `tree/extend/{plan,solve,emit,pipeline}.ts` and wired (zero-cost gate live). |
| collapseNesting is an emit-time policy; same walk, both forms (E1) | **MISSING — NEEDS-DESIGN** | tree2 does only the collapsed form | The key gap — R0. |
| Plugin/visitor = projection read model, `(node)=>Node\|void`, node in output form; exit optional; whole-tree machinery deleted; whole-tree mutate-observe unserved (F1–F5, G2) | ALIGNED-BYCON (unwired) | tree2 per-emit-position node = the settled contract | Wire a hook edge, don't build a walk framework. |
| Pre-eval visitors kept as separate gated pre-walk (F6/G1) | CARRY | — | Cannot fold into the single pass. |
| Sourcemap attribution to SOURCE node; shared leaf must not re-emit authored trivia; warnings v5-native (I.1–I.3) | NEEDS-DESIGN | coarse `Position` lane | Divergence risks; each slice needs a sourcemap-identity check, not just CSS-identity. |
| Governance: drive to target not match old code; no permanent eval fallback; ratchet; oracle = intended v5 (H1–H8) | CARRY | tree2 harness ratchets byte-identity + boundary-guard + `composeStats` op-counts | Keep ratchets; add a nested-output ratchet and a sourcemap-identity ratchet. |

---

# 2. tree2 vs the existing origin/dev spine/eval-cutover — the relationship (RATIFIED)

**Ratified:** tree2 is the **successor representation**; the origin/dev spine/eval-cutover is
its **validated design source and interim shipping path** — not a parallel destination.

- **What tree2 supersedes (now moot as migration steps).** The spine/eval-cutover's whole
  difficulty is retrofitting single-pass resolve-and-emit onto the fat legacy `Node`/`Rules`
  while keeping clone/`inherit`/`adopt`/`frozen`/`treeContext`/flag-walk alive until a
  coordinated all-or-nothing D-EVAL flip. tree2 **designs all of that out**: no reparenting,
  no per-placement clone/inherit (the #1 measured cost, structurally zero), no
  `evaluated`/`frozen` dominoes, no double-walk speculative-spine tax (~55ms/26% on
  benchmark per `AST-FROM-SCRATCH-DESIGN.md`). The **D-EVAL flip, reuse-gate deletions,
  `frozen`/never-reparent endgame, flag-walk removal, and field-slim levers (perf #12–15,
  #25, #27)** are therefore moot as destination work — absent by construction. **Stop
  investing in them as a destination.**

- **What MUST port into tree2 (do not lose) — DESIGNS, not the node API:**
  1. The **PLAN/SOLVE/EMIT extend pipeline** (`tree/extend/*.ts`) — already
     differential-validated; port the algorithm.
  2. The **projection visitor contract** (arch F) + the less-compat proof that only enter
     (+ one exit) is needed.
  3. **Live-binding semantics** (`BindingCell`, live cells, `:=`/`!global`/`$while`) —
     tree2's immutable var-Map is not yet equivalent.
  4. The **frame-threading correctness rules** (value-frame = lexical call-site chain;
     closures; lazy shadowing; guard-selected bindings) and the **sourcemap/trivia
     divergence guards** (arch I).
  5. The **governance/ratchets and oracle stance** (H1–H8).

- **What the existing core does that tree2's model genuinely cannot (yet), with limits:**
  - **Whole-tree mutate-then-observe plugins (arch G2).** The projection model deliberately
    cannot serve this — but the published-plugin audit found *no* plugin needs it; accepted
    non-goal, not a blocker.
  - **Pre-eval visitors (G1).** Need an un-evaluated whole tree the single pass never
    materializes — keep a separate gated pre-walk (tree2 can host it on the bridge output
    before serialize).
  - **Reused-context document framing (charset/top-imports across renders, G3).** A
    "fresh context per compile" production shape makes this moot, but tree2 must emit the
    document prelude at depth 0 deliberately.
  - **`less.tree` node-ctor external API.** tree2's clean-room nodes aren't 4.x nodes; the
    compat bridge needs an adapter layer *outside* the boundary.

- **Sequencing (ratified).** Keep the origin/dev spine as the **interim shipping alpha**
  (112/112 all-less spine-clean per `CUTOVER-STATUS.md`; only `benchmark.less` throws on two
  foldable shapes). **NO second parallel cutover** on the old tree. Land extend +
  collapseNesting-nested + value-native + compat in tree2 behind the bridge, ratchet
  byte-identity vs the intended-v5 goldens across the full corpus, then **flip the FRONT END
  to tree2** — a front-end swap, not a monolithic in-place delete. This preserves "no
  permanent eval fallback" (H2): tree2 either handles a shape or raises `UnsupportedShape`
  (fail-loud), and the interim spine covers production until parity.

---

# 3. DONE-RIGHT ROADMAP (ordered rungs)

Each rung: what it adds · matrix rows closed · where the current tree2 design must change.

**R0 — collapseNesting:false nested-output mode (RATIFIED to precede extend). BUILT ✓.**
- Adds: the v5 *default* nested emit form; second emit policy on the same walk (arch E1).
- Closes: 1(a)/1(b) collapseNesting rows; 1(c) E1.
- Design change: `serialize.ts` `flatten`/`compose` currently *only* build flattened
  selector strings. Add a nested-emit path that preserves block structure and emits
  parent/child as nested rulesets, sharing `Compound/Complex.canonical`. Load-bearing
  because **extend's EMIT phase must project through the same collapse policy** (arch E1,
  D-EMIT); the benchmark-tuned flatten-only path would otherwise make nested extend output
  impossible. This gap is currently masked because every rung was benched under
  `collapseNesting:true`.
- **BUILT (spec: [`TREE2-DESIGN-SPEC.md` § R0](./TREE2-DESIGN-SPEC.md#r0--collapsenestingfalse-nested-output-mode-the-less-v5-default)).**
  `SerializeOptions.collapseNesting` (default `true`); nested path = the
  `emitNested*` family in `serialize.ts` (same single walk, second policy). Selectors emit
  their OWN local text (no parent composition, no `:is()`); mixin bodies splice inline under
  the call site; `@media` bodies keep inner rules nested; empty blocks elide. Proven
  byte-identical vs the REAL pipeline rendered `collapseNesting:false`: **33/33 corpus
  fixtures pass in nested form — identical set to the flattened form (0 regressions)**;
  clone/inherit/withComponents stay structurally ZERO. Flagged for owner: leading-combinator
  child selectors (`> .b` as a nested child) need the `Complex` model to carry a leading
  combinator — a pre-existing bridge/selector-model gap, orthogonal to the collapse policy.

**R1 — Extend (PLAN/SOLVE/EMIT as an emit-time index over composed selector strings).**
- Adds: `:extend`, `&:extend`, `all`, selector-attached extend, reference/import-scope
  reachability, `:is()`/nested projection.
- Closes: extend + `@import (reference)` visibility rows.
- Design: port `tree/extend/{plan,solve,emit,pipeline}.ts` into a tree2-native
  `tree2/extend.ts` (boundary-clean). PLAN builds reachability + a target index keyed by
  `(scope, find-target)`; SOLVE is one document fixpoint firing rewrites over
  already-composed selector strings, re-routing produced branches (transitive closure),
  fire-once on `(subjectId, branchValue, instructionId)`; EMIT does compose-relative-to-target
  (from the extender's bucket-path), `&`-crossing hoist-to-root, and collapse/`:is()`
  grouping — through the **same R0 emit policy**.
- Where tree2 changes: (1) selectors must resolve to concrete strings **early**, so `@{}`
  interpolation in selectors (currently left literal) must resolve at ruleset-enter (arch
  D2/OQ-A) — this pulls interpolation forward as a dependency. (2) The serializer needs
  per-subject **buffering + flush discipline** (arch D5): decl values stream to a
  per-subject buffer, only the rule header defers until SOLVE settles; add the zero-cost
  gate (no `:extend` → pure streaming). (3) reference-mode needs visibility/suppression
  state that is NOT recoverable from the output string (§4 R-ref) — carry it structurally.
- Oracle: **source the concrete extend output shape from the less.js `alpha` branch output**
  reconciled with the owner `.css` goldens — NOT Less 4.x, NOT the legacy eval render. Do
  not assert `:is()`-compacted vs expanded; reproduce what alpha emits. Judge internal
  eval-vs-spine disagreements against Jess intent only.

**R2 — Value evaluation done native (retire the record/replay scaffold).**
- Adds: real synchronous operation/function evaluation over typed value nodes; honors
  math/unit/function modes.
- Closes: operations/functions "via-service shortcut"; unblocks pattern-match by typed
  value, calc, escaping.
- Design change: replace `tree2-frontend/value-service.ts`'s async-record→sync-replay-
  wrapping-legacy-render with a real sync evaluator (tree2-native, or a boundary-clean sync
  fns binding). Introduce typed value nodes (Color/Number/Quoted/List/Bool/Nil) instead of
  eager `Word`-ification of every operand — this is where the **value-literal tag** (perf #2)
  actually lands: (string, tag) leaves materialized only when arithmetic/compare/guard/interp
  needs object behavior. Keep sync-by-default (arch C1); no whole record pre-pass.

**R3 — Live bindings + control flow.**
- Adds: `BindingCell` live cells; Sass+ `:=` nearestOuter, `!global`/`setDefined`,
  `!default`; `.jess` `$!` live read/assign, readonly `!$`; `$if/$else`, `$for/$while`,
  ranges, destructuring.
- Closes: Sass+ scope rows; .jess control-flow rows; arch A5/B4.
- Design change: tree2's immutable `vars` Map becomes a frame of mutable `BindingCell`s
  re-read each iteration; `$while` counter mutates in place, no per-iteration body copy.

**R4 — Interpolation, escaping, detached rulesets, merge, namespaces/maps.**
- Adds: `@{}`/`$(...)`/`$[key]` interpolation everywhere, `~"..."`/`e()`/string interp,
  detached rulesets as a value type, `+`/`+_` merge (v5 last-occurrence anchor, owner),
  `#ns.mixin()`/`#map[key]`/indexed access.
- Closes: the bulk of remaining Less-4.x + .jess NEEDS-DESIGN rows.
- Design change: detached rulesets need a ruleset-value node (tree2 value union has none);
  merge needs a new-combined-value + an admission gate (perf #16) reframed for emit-time;
  namespace/map lookup needs path resolution beyond flat mixin names in
  `lookupMixinCandidates`.

**R5 — Sourcemaps + trivia (the divergence-risk rung).**
- Adds: sourcemap identity; sub-node trivia; deprecation/warning emission on
  `result.warnings`.
- Closes: source maps, deprecation emission, error reporting rows; arch I.1–I.3.
- Design change: the coarse `trackPositions` lane must attribute chunks to the **source**
  node (not a derived node); pick the fieldSpans/valueSpans backend by **measured** A/B
  (perf #9 — do not assume interned strings solve it); ensure a shared leaf emitted in a new
  position does NOT re-emit authored trivia. Add a **sourcemap-identity ratchet** alongside
  CSS-identity.

**R6 — Plugin/visitor hook + less-compat + module semantics.**
- Adds: the `(node)=>Node|void` enter(+optional exit) hook on the emit walk;
  `less.functions` custom fns via the value seam; `less.tree` adapter (outside the boundary);
  `@use`/`@compose`/`@-import` module semantics; pre-eval pre-walk (gated).
- Closes: plugin/visitor, less-compat (the one external contract), module rows; arch F/G.
- Design change: expose one hook edge (node in output form) — do NOT rebuild whole-tree
  visitor machinery; register conditionally (zero cost when idle). `less.tree` node ctors
  need a compat adapter that constructs the shapes the bridge already reads, without
  importing `../tree` into `tree2/`.

**R7 — Dialect front ends + endgame outputs.**
- Adds: SCSS bridge (Sass+ reject-invalid-CSS), `.jess` bridge (after Less+SCSS leave
  alpha), CSS Modules, tree-shaken JS-module / patchable-CSS output.
- Closes: dialect + cross-cutting endgame rows.
- Design: largely front-end bridges over the same tree2 core + new emit backends; the
  lean-data/external-serializer/tagged-node substrate is already the right shape for
  JS-module emission.

**Benchmark-tuned shortcuts to unwind (flagged so they don't calcify):** (1)
collapseNesting-flatten-only emit (R0); (2) value-service async-record/replay wrapping legacy
render (R2); (3) eager `Word`-ification of all args losing types (R2/R3); (4) `@{}` left
literal (R1 dependency); (5) `MAX_RECORD_DEPTH`/`MAX_VAR_DEPTH` caps that exist only for the
record pre-pass (R2); (6) coarse rule-granularity positions (R5).

---

# 4. ORACLE POLICY + RISKS

## Where "legacy `tree` render == oracle" is INVALID

tree2's tests use the legacy render as the byte-identity oracle. That is a valid *proxy for
intended-v5* only where the legacy render agrees with the owner `.css` v5 goldens and the
less.js **alpha** output. It is unsafe — the oracle must instead be the intended-v5 goldens /
alpha output — in these places:

- **R-extend (extend, all forms).** The legacy render has **internal eval-vs-spine
  disagreements** (e.g. a nested extender where eval emits a bare fragment and spine emits
  the composed selector; a nested element-name self-extend both paths drop). These are NOT
  judged against Less 4.6.7; they are internal-regression signals resolved against **Jess
  intent = less.js alpha output + owner goldens**. Reproduce Jess's intended extend shape
  (source the concrete `:is()`-compacted-vs-expanded form from alpha — do NOT assert it).
  **Do not gate R1 on the legacy eval render.**
- **R-merge (`+`/`+_`).** v5 uses **last-occurrence anchoring** (owner, intended v5 — a
  deliberate divergence from Less). A golden or legacy render anchoring first-occurrence is
  wrong for Jess; build to Jess intent.
- **R-nested (collapseNesting:false).** Every tree2 rung so far was benched under
  `collapseNesting:true`, so the legacy-render oracle only ever validated the *flattened*
  form. The v5 **default nested** output is unproven against any oracle in tree2 — R0 must
  add nested-output byte-identity against the v5 goldens/alpha.
- **R-media.** v5 does **not** merge sibling `@media` blocks; a 4.x-style merging
  render/golden encodes 4.x behavior. (`.css` goldens should already be un-merged — verify.)
- **R-ref (reference/import-mode extend).** Reference-mode suppression (which original
  selectors are hidden) is **not recoverable from the output string** — a byte-oracle over a
  naive string render silently breaks reference mode. Carry visibility state structurally;
  oracle against the goldens, not a string round-trip.
- **R-important (custom-prop `!important`).** A direct-`writeSyntax` path drops `!important`
  on custom properties. tree2 carries `!important` in value bytes; verify custom-prop
  `!important` survives, and don't adopt any oracle that routes through that legacy writer.

Everywhere else (static rules, variables, plain values/functions, plain at-rules, plain
`@import`) the legacy render has already been shown byte-identical to the real evaluating
oracle **and** matches the goldens — so it remains a safe proxy there. When unsure whether a
Jess divergence from Less/Sass is intended, mark it **"needs owner confirmation of intended
v5 shape"** — do not call it a bug.

## Risks — benchmark-tuned choices that won't generalize + genuine unknowns

1. **collapseNesting-flatten-only is the biggest hidden risk.** The entire rung ladder
   validated only the flattened form; nested-default output, and extend's EMIT projection
   through nesting, are the real v5 target and are unbuilt. Fixing after extend would be far
   costlier — hence R0 first.
2. **Value-service record/replay** re-enters the legacy engine tree2 is meant to replace; it
   is byte-identical but architecturally circular and cannot survive to the JS-module
   endgame. It also hides real value-eval cost behind an "equal-cost both sides" race framing.
3. **Selector-representation perf is unproven at benchmark scale.** All race numbers are
   small fixtures or synthetic; `benchmark.less` end-to-end through tree2 (the real gate) is
   still blocked on extend + interpolation. The arena diagnosis says selectors (not values)
   are ~86% of eval-new allocation, so the interned-string selector model is the load-bearing
   bet — validate it on the real fixture before declaring the ~37ms neighborhood reached.
4. **Sourcemap identity + sub-node trivia are open measured forks** (perf #9), not solved by
   interned strings; the correctness trap (lost gap-attribution) survives any representation
   change.
5. **Live-binding gap.** tree2's immutable var-Map is not yet the `BindingCell` live-cell
   model; Sass+/`.jess`/control-flow correctness depends on it and it touches the
   frame-threading core.
6. **Genuine model unknowns:** whether the projection model can host `less.tree` node-ctor
   compat without leaking the boundary; whether early selector-interpolation (needed by
   extend) interacts cleanly with guard-selected/lazy bindings; whether the fail-loud
   `UnsupportedShape` posture can hold across the full corpus without a permanent eval
   fallback (H2) during the parity climb.
