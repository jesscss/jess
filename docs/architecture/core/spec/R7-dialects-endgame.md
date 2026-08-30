# R7 — Dialect front ends + endgame outputs (tree2 DESIGN SPEC)

> **Historical design — superseded.** This tree2/front-end-bridge plan does not
> describe the public architecture. In particular, its `{ tree: Rules }`,
> bridge, and separate output-route language is historical only. Current work
> uses each dialect's public Parseman `parse()` to construct canonical AST v2
> `Stylesheet` directly, followed by the retained Context/plugin dispatch and
> Jess integration migration.

> Design-spec section for **R7** of the tree2 definitive rewrite
> ([roadmap](../TREE2-DEFINITIVE-REWRITE-COVERAGE-AND-ROADMAP.md#r7--dialect-front-ends--endgame-outputs);
> [R0 spec depth reference](../TREE2-DESIGN-SPEC.md#r0--collapsenestingfalse-nested-output-mode-the-less-v5-default)).
> Same discipline as every rung: per target — **data/model · bridge or emit
> algorithm · invariants · reference · sequencing · open owner-confirm items**.
>
> Branch of record: `experiment/tree2-cleanroom-20260715`. Code citations are on
> that branch. This is a SPEC (what the code must guarantee), not a build log or
> a status tracker.

R7 is the terminal rung: three *front-end bridges* (SCSS, `.jess`, CSS Modules
analysis) over the finished tree2 core, plus one *core-emit refactor* (the
tree-shaken JS-module / patchable-CSS endgame). The governing structural fact:

- **A dialect front end is a BRIDGE** — it lives OUTSIDE `tree2/`, reads a parser
  tree + `../tree` provenance, and outputs pure tree2 nodes, exactly like the
  existing Less `tree2-frontend/bridge.ts`. It adds **zero** node kinds and
  **zero** core-emit code; every feature it needs must already exist in the core
  (i.e. be closed by R1–R6). Front-end bridges are therefore **parallelizable**
  and additive — they cannot destabilize the shared serializer.
- **The JS-module / patchable-CSS endgame is a CORE-EMIT change** — it is the ONE
  R7 item that edits `tree2/serialize.ts` itself, converting the monolithic emit
  switch into per-kind tree-shakeable emit. It is serial with (and gated on) the
  serializer being feature-complete.

The clean-room substrate is already the right shape for all four: lean tagged
nodes (`node.ts` base = `{ abstract readonly kind: Kind }`, "owns nothing but its
tag"), an EXTERNAL free-function serializer (`serialize.ts`, no `writeSyntax`/emit
methods on nodes), and an INJECTED `ValueService` (`value-service.ts`). Per the
owner steer ([[arena-serialize-external-treeshake]]), nothing about R7 is allowed
to wire behavior back INTO nodes.

---

## R7.1 — SCSS front-end bridge (the "Sass+" dialect)

**Status:** NEEDS-DESIGN (unbuilt). SCSS is a **perf NON-GOAL** but a first-class
**coverage** target for the definitive core. Code target:
`packages/core/src/tree2-frontend/scss-bridge.ts` (a sibling of `bridge.ts`,
OUTSIDE `tree2/`).

### Why a bridge and not a second core

`parseScssFn(source)` returns `{ tree: Rules, ... }` — **the same `../tree`
`Rules` root shape** the Less parser produces
(`packages/scss-parser/src/functional-parser.ts` `ScssFnParseResult.tree: Rules`;
the SCSS grammar composes over the CSS/Less builders and reuses their `buildNode`).
So the SCSS front end is structurally the same job as the Less bridge: walk a
`Rules` tree of `../tree`-shaped structural nodes and emit tree2 nodes. It targets
the **same tree2 core** — no SCSS-specific core, no SCSS-specific serializer.

### Data / model (no new tree2 node kinds)

The SCSS bridge introduces **no** tree2 node kinds. Every SCSS construct maps onto
an already-designed tree2 node from an earlier rung:

| SCSS construct | tree2 target | Rung that must be closed first |
|---|---|---|
| `$var: …` declaration; `!default`, `!global` | `VarDeclaration` + live `BindingCell` writes | R3 (live cells / `setDefined` / nearestOuter) |
| `@mixin m(…) { }` / `@include m(…)` | `MixinDef` / `MixinCall` | R0/R5 core (dispatch exists) |
| `@include m { … }` content block; `@content` | `MixinCall` + detached-ruleset arg | R4 (detached rulesets) |
| `@function f(…) { @return … }` | function registered into the `ValueService` seam | R2 (native value eval) + R6 (fn registration edge) |
| `@if / @else / @else if`, `@each`, `@for`, `@while` | live-cell control flow (frame of mutable cells) | R3 (control flow) |
| `@extend %ph`, `@extend .sel`, `!optional` | tree2 `extend` (PLAN/SOLVE/EMIT) | R1 (extend) |
| placeholder `%foo` selector (emit-suppressed) | selector model + reference-mode-style suppression | R1 (visibility state, cf. R-ref) |
| maps `(k: v, …)`, `map.get`, index access | tree2 map value node | R4 (maps) |
| interpolation `#{ … }` (selector / value / property) | interpolation value node, resolved early | R4 (interp; R1 for selector interp) |
| `@use` / `@forward` / `@import` module semantics | module semantics | R6 (`@use`/`@compose`) |

The consequence is decisive for sequencing (below): **the SCSS bridge is a thin
mapping layer whose every capability is a core feature closed by R1–R6.** It is
NOT where those features get built.

### Bridge algorithm

1. **Factor the dialect-agnostic core out of `bridge.ts`.** The current Less
   `bridge.ts` traversal (selector → `Complex`/`Compound`, `rawDeclValue`,
   `toComputedValue`, at-rule prelude recovery, `toBody`/`toStatement` dispatch)
   reads a generic `Rules` tree and is ~90% dialect-neutral. Refactor it into a
   shared `bridge-core` with a **dialect table** — a set of node-`type` → handler
   overrides plus a sigil/keyword config — so `bridge.ts` (Less) and
   `scss-bridge.ts` (SCSS) share the CSS backbone and each supplies only its
   dialect delta. This mirrors how the *parsers* compose
   (`scssGrammar = compose([cssGrammar, …])`); the bridges should compose the same
   way rather than fork the traversal. (This is a front-end refactor: it does NOT
   touch `tree2/`.)
2. **SCSS delta handlers** dispatch the SCSS-specific `../tree` node `type`s
   (`$`-sigil `VarDeclaration`, `@mixin`/`@include`/`@content`, `@if`/`@each`/…,
   `@extend`, `@function`/`@return`, map literals, `#{}` interpolation, `%`
   placeholders) to the tree2 targets in the table above.
3. **Reject where Sass+ rejects.** Any shape that is invalid CSS (see reference) —
   and any construct whose tree2 target rung is not yet closed — raises
   `UnsupportedShape(feature, detail)`, collected + ranked by an SCSS census
   (mirror `tree2-frontend/__tests__` census over an SCSS fixture corpus). Same
   fail-loud posture as the Less bridge; **no silent partial output**, **no
   permissive eval fallback** ([[feedback-no-permanent-eval-fallback]] / H2).

### Invariants

1. **Boundary held.** `scss-bridge.ts` lives OUTSIDE `tree2/`; no `tree2/` file
   gains an SCSS import; no `as any`.
2. **Zero new node kinds.** Everything routes to existing tree2 nodes; if a
   construct has no tree2 target, that is a missing *core* rung, not a bridge
   feature — the bridge raises `UnsupportedShape` rather than inventing a node.
3. **Shared CSS backbone.** The Less and SCSS bridges share one traversal core;
   an SCSS-only change must not regress the Less bridge's byte-identity suite.
4. **Reject-invalid is structural, not a warning.** Invalid-CSS shapes are a
   parse error / `UnsupportedShape`, never a tolerated-with-deprecation pass.

### Reference — Sass+ = valid CSS, NOT dart-sass parity

Per [[sass-plus-dialect-reject-invalid-css]]: **where Sass tolerates invalid CSS,
Sass+ REJECTS it.** dart-sass / sass-spec output is a coverage/behavior reference
ONLY — never a shape authority. Concretely:

- A sass-spec fixture that **fails to parse** in Jess is NOT automatically a
  coverage gap. Check its expected output FIRST: an **empty `output.css`** and/or a
  **deprecation `warning` sibling** (esp. `bogus-combinators`) means Sass is
  tolerating invalid input and Jess rejecting it is the **correct** outcome. Only a
  fixture with **non-empty, non-deprecated `output.css`** is a real must-parse
  target. Do NOT "fix" a gap by relaxing the grammar/bridge to accept invalid CSS.
- Already-settled Sass+ rejections (do not relax): bogus combinators (leading /
  trailing / doubled), escaped at-rule keywords (`@\69 f`). These are enforced at
  PARSE time in css/less/scss-parser and the bridge inherits them.
- Where SCSS emits **valid** CSS, the reference is intended Jess v5 output (owner
  `.css` expected outputs where they exist), NOT dart-sass byte output. A divergence from
  dart-sass on valid input is intended Sass+ unless the owner says otherwise — mark
  such cases **"needs owner confirmation of intended v5 shape."**

### Sequencing

- **Coverage target, perf non-goal** → SCSS does not gate the perf climb, but it
  DOES gate "definitive core is dialect-complete."
- The bridge **backbone** (rules / selectors / static declarations / plain
  `@mixin`+`@include` / plain at-rules) can begin as soon as the Less-bridge core
  is factored — it needs only rungs already closed, so it starts **in parallel**.
- **Full** SCSS coverage TRAILS the core rungs it depends on: `@extend` needs R1,
  SCSS value math / `@function` need R2, control flow + `!default`/`!global` need
  R3, maps + `#{}` interpolation need R4, modules need R6. The bridge should land
  incrementally, one dependency-satisfied feature band at a time, each with an
  SCSS census + byte-identity gate.

### Open owner-confirm items (R7.1)

- **O-SCSS-1** — the precise Sass+ reject list beyond the two settled precedents:
  enumerate which further "Sass tolerates invalid CSS" shapes Sass+ rejects vs
  silently accepts (e.g. trailing junk after `@mixin` args, unitless/`%`
  ambiguities). Needs owner confirmation per shape; do not infer from dart-sass.
- **O-SCSS-2** — does `parseScssFn().tree` expose `$var` / `@mixin` / `@if` /
  `@extend` / map / `#{}` as *distinct* `../tree` node `type`s the bridge can
  dispatch on, or are some folded into generic Less/CSS shapes that the SCSS
  delta must re-discriminate? Confirm the node-type surface before locking the
  dialect table.
- **O-SCSS-3** — placeholder `%foo` emit-suppression: reuse R1 reference-mode
  visibility state, or a distinct "never-emit-standalone" flag? Confirm the model.

---

## R7.2 — `.jess` front-end bridge

**Status:** NEEDS-DESIGN, **DELIBERATELY LAST** (unbuilt, and intentionally so).
Code target: `packages/core/src/tree2-frontend/jess-bridge.ts` (OUTSIDE `tree2/`).

### Why it trails (sequencing is the headline)

Per [[jess-parser-intentionally-trails]]: `.jess` is essentially a **superset of
BOTH Less and SCSS** plus a few native-only features. The owner **deliberately does
not finish/progress the `.jess` parser (or its bridge) until the Less + SCSS guts
are ready to leave alpha** — finishing it first means re-chasing a moving target
twice. The jess-parser today parses only statement forms (a root ruleset / `{…}`
mixin body yields an empty `StyleSheet`); ~156 `parse-only` tests are skipped **by
design**. That immaturity is sequencing, NOT a bug to fix. **The `.jess` bridge is
therefore the LAST R7 item — it starts only after Less (the shipping alpha) AND the
SCSS bridge (R7.1) are stable.** Spec the target now; wire it last.

### Data / model — the settled `.jess` syntax (bridge targets)

The `.jess` parser composes `jessGrammar = compose([scssGrammar, <Jess delta>])`
and emits `../tree` nodes (Reference / VarDeclaration with Jess options). The
bridge maps the **settled** syntax ([[jess-parser-build]]) onto tree2 core nodes —
again, **no new tree2 kinds**, every target already closed by an earlier rung:

| `.jess` construct | tree2 target | Rung |
|---|---|---|
| `$foo` live read; `$^foo` scoped/final read; `$foo:` / `$^foo:` create or update both bindings; `?:` / `:=` use their target lookup | `VarRef` / `VarDeclaration` / `VarAssignment` | R3 (scoped index + cells) |
| readonly `!$foo`; private `_name` | binding flags on the cell | R3 |
| `$base.name` STATIC member (literal keyword key → `.name`) | member/lookup value | R4 (namespaces/maps) |
| `$base[0]` / `$base['k']` / `$base[$key]` (index / literal-prop / dynamic) | indexed lookup value | R4 (maps/indexing) |
| `$extend <sel>` / `$extend .a -> .target` (NOT `:extend()`) | tree2 `extend` | R1 (extend) |
| `$apply .foo` (== `$ > *[.foo]`; selector-as-mixin) | mixin-apply over selector match | R1/R4 |
| mixin call/apply operator `$ > name()`, chain `$ > #ns > .m()` | `MixinCall` + namespace path | R4 (namespaces) |
| anonymous fns `$fn: @() > { … }` / arrow `@() > $(1+2)`; `$content()` | detached ruleset / fn value | R2/R4 |
| interpolation `$( … )` (Expression), `$[key]` (ident), `$*[…]` (selector capture) | interpolation value nodes, early-resolved | R4 (interp) |
| collections/maps `$x: { … }`, dot/index/negative-index access | map value node | R4 (maps) |
| `$if/$else`, `$for`, ranges, destructuring | live-cell control flow | R3 (control flow) |
| `@-use` / `@-from` (sugar for each other → JsImport) / `@-export` / `@-compose` | module semantics | R6 (modules) |

### Bridge algorithm

Same shape as R7.1: **compose the `.jess` bridge over the shared bridge-core**,
adding only the Jess delta handlers (the `$`-layer, live-binding options, `$extend`
/ `$apply`, `$ >` apply operator, `@-use`/`@-from`). Because `.jess` is a superset,
the delta rides on top of the SCSS + Less deltas rather than replacing them.
Fail-loud `UnsupportedShape` for anything whose core rung is not yet closed.

### Invariants

1. Boundary held (OUTSIDE `tree2/`, no `as any`), zero new node kinds — identical
   to R7.1.
2. **Sequencing gate is an invariant**: the `.jess` bridge does not advance ahead
   of Less+SCSS maturity; pulling it forward is a process error, not progress.
3. Native-only `.jess` features that neither Less nor SCSS express (live `$`
   bindings, `$extend`/`$apply` sugar, `$( )`/`$[ ]`/`$*[ ]` triad) map onto the
   SAME core rungs (R1/R3/R4) — the bridge does not get a private core.

### Reference

`.jess` = the **owner's settled syntax** ([[jess-parser-build]]), with the
canonical spec at `packages/docs-content/docs/jess/02-Language/**` (authoritative;
`packages/docs/docs/**` is a stale mirror — ignore on conflict). AST ground-truth
= how core `../tree` nodes serialize + the `serializeTypes` corpus. For rendered
CSS, the reference is intended Jess v5 output. Where a `.jess`-only feature has no
prior-art reference, mark **"needs owner confirmation of intended v5 shape."**

### Open owner-confirm items (R7.2)

- **O-JESS-1** — confirm the sequencing gate at build time: is "Less + SCSS bridge
  both byte-identity-green on their corpora" the trigger to start the `.jess`
  bridge, or is there an explicit owner go/no-go?
- **O-JESS-2** — `$apply .foo` desugaring to `$ > *[.foo]`: does the bridge desugar
  to the mixin-apply core path, or does tree2 want a distinct apply node? (Spec
  assumes desugar-in-bridge, zero new kind — confirm.)
- **O-JESS-3** — `$!`/`$$` are retired. The parser and evaluator must represent
  `$` as live/current and `$^` as scoped/final lookup without a snapshot alias.

---

## R7.3 — CSS Modules (composition / scoping + "minimum variable exposure")

**Status:** NEEDS-DESIGN. Positioning: an **alpha-exit bar**
([[positioning-spiritual-successor]]) — a *defensible, demonstrated* successor
story, not a full CSS-Modules reimplementation. This is an **analysis + emit
backend over tree2**, not a front-end bridge (there is no new source dialect —
`.less`/`.scss`/`.jess` all feed it).

### The story (owner-locked positioning)

Where CSS Modules scopes **class names**, Jess scopes **and tree-shakes
variables** → **"minimum variable exposure."** The mechanism: statically **trace
which variables are referenced in values, and which are exported, then emit only
the minimum CSS custom properties — inline the rest.** Seeded by the existing
module system (`@use`/`@compose`/exports, `packages/style-resolver`). This is a
STRONGER story than class-name scoping and is tied to the **minimal browser build**
(roadmap milestone #4, post-`.jess`).

### Data / model + algorithm

CSS Modules needs two analyses layered on the resolved tree2 tree — both are
**read models over the projection serializer**, adding no node kinds:

1. **Variable reachability / exposure graph.** As the serializer resolves each
   declaration value, record the set of `VarRef`s (and module exports) each output
   value actually depends on. A variable that is (a) referenced across a module
   boundary or (b) explicitly exported is emitted as a CSS custom property
   (`--var`); a variable used only internally is **inlined** at its use sites and
   never emitted. This is exactly the "trace referenced + exported → emit the
   minimum, inline the rest" contract. It reuses tree2's lexical scope (`Frame`
   chain / `lookupVar`) as the dependency source and the R6 module semantics
   (`@use`/`@compose`/exports) as the boundary definition.
2. **Class-name scoping.** A scope-hash transform over selector `Compound`/`Simple`
   class tokens (`.foo` → `.foo_<hash>`), plus an exported name map
   (`{ foo: 'foo_<hash>' }`) for the consuming JS. Because tree2 selectors carry
   cached canonical strings, the hash is applied at compose/emit time; the export
   map is a side output of the same walk.

Both are **gated side-lanes** on the emit walk (like `trackPositions`): off by
default (zero cost), on only for the CSS-Modules output target. Neither mutates
nodes.

### Invariants

1. No new tree2 node kinds; CSS Modules is an analysis + emit configuration over
   the existing projection serializer.
2. Variable-exposure and class-scoping lanes are **gated** (zero cost when the
   target is plain CSS).
3. The inline-vs-expose decision is derived from the reachability graph, never
   hand-flagged per variable.

### Reference

Alpha-exit bar = a **defensible, demonstrated** successor story (working feature +
docs + examples) — not byte-parity with the `css-loader` / `postcss-modules`
ecosystem. The reference is: (a) the scoped class-name map correctly renames all and
only the intended selectors; (b) the emitted custom-property set is exactly the
reachable-across-boundary ∪ exported set (minimum exposure), with all other
variables inlined and byte-correct. Divergence from JS-ecosystem CSS-Modules output
is intended (a stronger model), not a bug.

### Sequencing

Depends on R6 (module semantics = the boundary/export definition) and R2 (native
value eval, so inlining produces correct bytes). Slots **after R6**, alongside the
JS-module endgame (R7.4) with which it shares the "trace dependencies → emit the
minimum" analysis. Not a front-end bridge — parallelizable with R7.1/R7.2 only in
that it touches different code (analysis lanes, not the dialect bridges).

### Open owner-confirm items (R7.3)

- **O-CSSM-1** — the class-name scope-hash scheme (hash input: file path + name?
  content? length/alphabet?) and the exact export-map format the consuming JS
  receives. Needs owner confirmation.
- **O-CSSM-2** — the "minimum variable exposure" output CONTRACT: is the emitted
  custom-property set a distinct output artifact (a `:root`/`:where` block? a
  scoped block?), and what is the boundary rule that forces a variable to be
  exposed vs inlined (any cross-file reference? only explicit `@export`?)? Confirm
  before building the reachability lane.
- **O-CSSM-3** — is R7.3 in scope for the tree2 *definitive core* rung, or is it
  the separate "minimal browser build" milestone (#4) that the core merely enables?
  The positioning memory ties it to the browser build; confirm whether tree2 must
  ship the analysis or only expose the seam.

---

## R7.4 — Tree-shaken JS-module / patchable-CSS output (THE ENDGAME) — a CORE-EMIT refactor

**Status:** NEEDS-DESIGN. This is the endgame the clean-room shape was aimed at
([[arena-serialize-external-treeshake]], [[positioning-spiritual-successor]] —
the CSS-in-JS-successor path). It is the **one R7 item that changes the tree2
CORE serializer**, not a front end.

### The design steer (owner, 2026-07-15)

The print writer / serializer operates **ON** nodes (external free function), never
**wired INTO** them; nodes are the **smallest data shape**. The endgame is a
**tree-shaken dependency-graph → JS-modules output**: each compiled AST module must
be the **minimal shape that can re-create a serialized value**, and that runtime
serialization NEVER has output tracking (no sourcemaps at runtime). Behavior wired
into nodes bloats the shipped shape and defeats tree-shaking.

**Current state is already aligned** (verified in code): `serialize()` is a free
function switching on numeric `kind`; no node has an emit method; position tracking
is a serializer lane, not node state; `ValueService` is injected. The remaining
work is the **refactor of the monolithic switch into per-kind tree-shakeable
emit** + the runtime output target.

### The core-emit refactor (the load-bearing change)

Today `serialize.ts` is one module holding one giant `switch (node.kind)` (plus the
`emitNested*` family and the at-rule emitters). A bundler cannot drop the emit code
for a `Kind` a given compiled stylesheet never uses, because it is all one
function. The refactor:

1. **Per-kind emit modules.** Split the switch arms into **one emit function per
   `Kind`**, each in (or exported from) its own module, registered into a
   dispatch table keyed by `Kind`. A driver walks the tree and calls
   `emitters[node.kind](node, ctx)`. When a compiled stylesheet's module graph
   references only a subset of kinds, the bundler tree-shakes the unreferenced
   per-kind emitters out of the shipped output. (This is the concrete meaning of
   "the monolithic `serialize()` switch must become PER-KIND tree-shakeable
   emit.")
2. **Two lanes, explicitly separated.** Keep the existing **build-time lane** (with
   `trackPositions` / sourcemap capacity) and add a **runtime NO-TRACKING lane**
   (never allocates a `Position[]`, never computes offsets) — the runtime path a
   shipped JS module uses to re-serialize. The no-tracking lane must be the
   default-reachable one so tracking code tree-shakes away from the runtime build.
3. **Nodes ship as minimal data.** The compiled `.css`→JS module ships each node as
   its minimal `{ kind, …fields }` data (already the shape today) — no methods, no
   provenance, no tracking state. The module's runtime dependency = only the
   per-kind emitters its nodes reference.
4. **Patchable-CSS runtime.** A compiled module exposes a runtime that can
   re-create the serialized CSS, with dynamic values (interpolation slots / live
   bindings) as patch points — the CSS-in-JS successor: static structure is
   pre-serialized at build, dynamic slots re-serialize at runtime through the
   no-tracking lane. Whether the runtime needs the `ValueService` (math at runtime)
   or all math is pre-resolved with only interpolation slots patched is an owner
   decision (below).

### The cached-canonical-string decision (must be made, measured)

tree2 selector nodes cache a canonical STRING (`Complex.canonical()` /
`Compound.canonical()`) — **derived data, not behavior**, so it does not violate
the external-emit rule. But for the JS-module path there is a real fork:

- **Ship the cache** → larger module bytes, zero runtime recompute.
- **Recompute on the module path** → smaller module, runtime CPU to rebuild the
  canonical string.

Per the memory steer this is deliberately left OPEN to preserve the option;
**decide by MEASUREMENT** (module-size vs runtime-CPU on a real fixture), not by
reasoning ([[feedback-no-defensive-slowdowns]], [[feedback-predict-perf-before-building]]).
Default posture: keep emit external + nodes pure-data so BOTH remain possible until
measured.

### Invariants

1. **No behavior on nodes.** The refactor must not add a single emit/`toString`
   method to any node class; per-kind emitters stay external free functions.
   Boundary held; no `as any`.
2. **Tree-shakeable by construction.** An unused `Kind`'s emit code must be
   statically droppable — i.e. per-kind emitters must not be forced live by a
   single monolithic reference. Verify with a bundle-size check (a fixture using a
   subset of kinds ships strictly less emit code).
3. **Runtime lane carries zero tracking.** The no-tracking lane never allocates
   positions; sourcemap/tracking code is absent from the runtime build.
4. **Byte-identical to the build serializer.** The refactored per-kind emit must
   be byte-identical to the current monolithic `serialize()` on the whole corpus
   (a pure refactor gated on byte-identity), in BOTH collapse modes (R0), before
   any JS-module target is layered on.

### Reference

The refactor itself: **byte-identity vs the current `serialize()`** across the full
corpus, both collapse modes — a mechanical-equivalence gate. The JS-module /
patchable output target: the runtime-re-serialized CSS must be byte-identical to
the build-time CSS for the static case, and correct-by-construction for patched
dynamic slots (owner-confirmed contract, below). No external tool is the reference;
tree2's own build-time output is.

### Sequencing

- The **per-kind emit refactor** is gated on the serializer being
  feature-complete (all emit arms that will exist, exist) — realistically **after
  R1–R6** land their emit contributions, else the split has to be redone as arms
  are added. It is a **pure refactor** step, then the runtime target layers on.
- It is **serial** with the core (it edits `serialize.ts`), unlike the R7.1/R7.2/
  R7.3 front-ends which are additive/parallelizable.
- Shares the "trace dependencies → emit the minimum" analysis with R7.3 (CSS
  Modules) — the two are the two faces of the minimal-shipped-output endgame.

### Open owner-confirm items (R7.4)

- **O-JSM-1** — the compiled JS-module CONTRACT: what does a compiled `.css`→`.js`
  module export? A render function? A static string plus a list of patch points? An
  ESM default export of the node data + a shared runtime? Confirm the module shape
  before designing the runtime.
- **O-JSM-2** — does the patchable-CSS runtime need the `ValueService` (math at
  runtime for dynamic values), or are all values pre-resolved at build with only
  interpolation/live-binding slots patched at runtime? This decides whether the fns
  evaluator must ship to the runtime — a large size lever.
- **O-JSM-3** — canonical-string cache **ship vs recompute** (see above): parked
  pending a measured module-size-vs-runtime-CPU A/B on a real fixture. Owner ratify
  the measurement gate, not a reasoned default.
- **O-JSM-4** — per-kind emitter registration mechanism: a static import map, or a
  registry the front end populates? The former tree-shakes more reliably; confirm
  the pattern (and that it satisfies the bundle-size invariant).

---

## Summary — what R7 is, structurally

| R7 item | Kind of work | Touches `tree2/` core? | Parallelizable? | Gated on |
|---|---|---|---|---|
| R7.1 SCSS bridge | front-end bridge | No | **Yes** (backbone now; full trails R1–R6) | R1–R6 per feature band |
| R7.2 `.jess` bridge | front-end bridge | No | Yes, but **deliberately LAST** | Less + SCSS leaving alpha; R1–R6 |
| R7.3 CSS Modules | analysis + emit lanes (gated side-lanes) | No (gated lanes only) | Yes (different code) | R6 (modules), R2 (inlining) |
| R7.4 JS-module / patchable-CSS | **CORE-EMIT refactor** + runtime target | **YES** — the one core change | No — serial with the core | serializer feature-complete (post R1–R6) |

**The one core-emit change is R7.4** (monolithic `serialize()` switch → per-kind
tree-shakeable emit + a runtime no-tracking lane). **R7.1/R7.2 are pure front-end
bridges** (compose over a shared bridge-core, zero new node kinds, fail-loud).
**R7.3 is gated analysis lanes** over the projection serializer. Every dialect
feature must already exist as a closed core rung (R1–R6) before its bridge can map
to it — the bridges add coverage, never core capability.
