# AST arena — standing experiment handoff

Status: living handoff, opened 2026-07-15. This is an OPEN-ENDED experimental track,
distinct from the incremental-lever perf work on `origin/dev`. An agent picks this up,
runs one radical-departure experiment, appends its result to the log at the bottom, and
either lands a proven byte-identical win or discards and records why. Then the next agent
(or the next iteration) continues from the log.

## Mission

Find a core AST *representation* that renders `benchmark.less` toward Less 4.x's ~37ms
(we are at ~215–250ms, ~6–7×). This is the "arena" idea: a packed / shared / columnar
representation that makes the dominant cost cheap **by construction**, rather than shaving
it 5% at a time. The incremental levers (extend pre-reject, etc.) are landing separately;
this track is for the departures too big to bolt onto the current node model.

## Non-negotiable guardrails

1. **Byte-identity is the oracle.** `benchmark.less`, `collapseNesting:true` →
   131578 bytes, sha `98a0536086c7e555`. No experiment counts as a "win" unless output is
   byte-identical (and all-less byte-identity holds). A representation that can't reproduce
   the bytes is not a candidate, no matter how fast.
2. **Predict before building.** Follow `CORE-CLEANUP.md` → "Predict before building":
   profile the real fixture first, state the expected win (profile-fraction × reduction −
   the new machinery's own cost), and treat a sub-threshold bet as a no-go. Synthetic
   microbenchmarks are DISQUALIFIED — only same-worktree A/B on the real fixture counts.
3. **HARD MODULE BOUNDARY: no `tree2/` file may import from `../tree` — anywhere, not
   just the hot path (owner, twice-emphasized, non-negotiable).** `tree2/` is a CLEAN-ROOM
   rewrite. It writes its OWN base node, its OWN Declaration/Rule/value nodes, its OWN
   byte-faithful serializer — it does NOT borrow node types, helpers, serializers
   (`writeSyntax`/`valueOf`), extend, or materialization from `../tree`. "Byte-faithful"
   means reproduce the exact OUTPUT BYTES `../tree` emits; it does NOT mean mirror `../tree`'s
   serialization METHOD (the owner said "absolutely not" — the legacy serializer may itself
   be too heavy, so porting it would inherit the problem). Only neutral context/config
   objects may cross the boundary. Enforced mechanically: `grep -rn "\.\./tree\b\|from
   '.*tree/" packages/core/src/tree2` must be empty (sibling tree2 refs only), plus a vitest
   guard (`tree2-harness/__tests__/boundary-guard.test.ts`) that parses every tree2 import
   specifier and fails on any legacy-tree reference. The OLD side of the comparison lives in
   the harness (`tree2-harness/`), never inside `tree2/`. A build that borrows from `../tree`
   is meaningless and will be discarded. (The first arena POC failed *specifically* by
   violating this: it reused `extend.ts`/node materialization, was emit-only after full eval,
   and was hard-disabled under `collapseNesting:true` — it moved benchmark by **zero**. That
   POC is preserved on branch `feature/greenfield-ast-design-20260714` as the anti-pattern;
   it is NOT on `origin/dev`.)
4. **Measure allocation AND time, but trust TIME.** "Fewer allocations" has been a false
   signal all session (GC is ~5%). A departure must reduce wall-clock on the real fixture,
   not just an allocation counter.

## What the profile actually says (2026-07-15 — do not re-derive; verify if in doubt)

The gap is **NOT**: pass-count (the single-eval-emit "spine" flip benched *slower*),
async (~0%, `isThenable` fast-path), allocation-as-GC (~5%), value leaves (Dimension 1,609
/ Color 613 — ~2%), grammar-at-render (measured false — grammar is 100% parse-phase),
or nesting-collapse (`composeSelector` runs only ~2,490×/render).

The gap **IS**: **eval-time per-placement SELECTOR reconstruction during mixin expansion**
— `withComponents` / `cloneForPlacement` produce **~73,005 selector constructions +
~35,033 `inherit` provenance-copies per render**, and the profile is **FLAT** (no dominant
frame), so incremental sniping caps ~5%. The extend step (`processExtends`, ~50ms) is the
one concentrated exception and is being optimized separately. **Less renders in ~37ms with
a plain object AST by doing each thing once** — so the target is reachable; jess's problem
is doing ~6× the per-node work, concentrated in per-placement reconstruction.

## Owner architectural steers (authoritative — these are the seeds for the departures)

- **"Selectors should not be cloned for placement unless placed in a DIFFERENT extend root
  than their source."** → most of the ~35k clones may be redundant (same-extend-root).
  Clone/identity should be scoped to extend-root boundaries, not every placement.
- **"A lot of our nodes can actually share positions."** → the per-placement clone +
  `inherit` may exist mainly to carry a distinct source *position/provenance*. If nodes can
  **share position data** (reference, not copy), the clone loses its reason to exist and both
  the ~70k selector ctors and ~35k inherits collapse for same-extend-root placements. Watch
  the source-map path — it's the most likely real consumer of distinct positions; sharing may
  need gating on `sourceMap` disabled. (Ties to the standing fieldSpans/valueSpans
  position/span machinery question.)

## Candidate radical departures to test (pick one per iteration, measure, log)

Each must obey guardrail #3 (no old-machinery hot path). Rough order of promise:

1. **Position-sharing / structural-sharing selectors.** Same-extend-root placements share the
   SAME selector node (or arena record) instead of cloning; position/provenance referenced,
   not copied. Directly targets the measured bulk. Prove byte-identical (gate on source-maps
   if needed). *This is the highest-value first experiment and aligns with both owner steers.*
2. **Columnar / packed selector arena where a placement is a cheap overlay/index**, not a
   rebuilt node tree — the placement records "this canonical selector + this extend-root +
   this parent-index," and the selector is materialized (as a string) only at emit, once.
3. **Emit-faithful compact selector serializer** (NOT `valueOf()` — it normalizes
   combinator/comma/pseudo spacing and is not byte-faithful to `writeSyntax()`; that killed
   the flatten POC). A real string-based arena needs its own serializer that reproduces
   `writeSyntax` byte-for-byte; build and prove it, then interning/sharing becomes viable.
4. **Canonical-body + placement-overlay for mixins**: the mixin body is stored once; a
   placement is an overlay (bindings + extend-root + parent) applied at emit, so the body's
   selectors/decls are never reconstructed per placement.
5. **Extend-root-indexed identity**: give each extend root an id; a selector's placement
   identity = (canonical selector id, extend-root id). Clone only when that pair is new.

Anti-goals (do NOT re-run — measured dead this session): the pass-count "spine flip";
the indexed extend prototype (`processExtendsByIndex` — 3.8× slower on N=26); an emit-only
arena; value-leaf tagging as the primary lever; anything that reuses `cloneForPlacement`/
`inherit` on the hot path.

## Where the code lives

- Prior POC: `packages/core/src/tree2/` (arena types, adapter, render) — read it to learn the
  arena mechanics, but treat its emit-only/old-materialization approach as the *anti-pattern*.
- Design record: `docs/future/core-architecture/AST-FROM-SCRATCH-DESIGN.md` (on `origin/dev`).
- The hot path to replace: mixin expansion `withComponents`/`cloneForPlacement` +
  selector `inherit` (find exact sites; that's where the ~73k/~35k originate).
- Benchmark + harness: `packages/jess/benchmark/benchmark.less`;
  `packages/core/perf/q40-import-placement.mjs`.

## Protocol per iteration

Same-worktree A/B (env/flag toggle, never cross-directory), warmup ≥ 10, N ≥ 21, median.
State the prediction FIRST. Confirm byte-identity (sha above) before reporting any speed
number. Land a proven byte-identical win (it may need a `verify:aggressive-cutting-review`
cost-contract admission — see the conservative-filter shape added 2026-07-15). Discard and
record WHY if it fails (that's a valid, valuable result — it narrows the space). Append to
the log below every iteration so the track compounds instead of repeating.

## Experiment log

<!-- newest first; each entry: date · hypothesis · prediction · byte-identical? · measured Δ · kept/dropped · why · next -->

- 2026-07-15 — **rung 6: parser→tree2 BRIDGE + FIRST NON-SYNTHETIC byte-identity + real-corpus
  census. VERDICT: the arena escapes the synthetic caveat — real `.less` fixtures parse → bridge
  → tree2 → serialize BYTE-IDENTICAL to the legacy `tree` render, and the census gives a grounded
  climb order (branch `experiment/tree2-cleanroom-20260715`, still an experimental scaffold, NOT
  merged).**
  - **Bridge (source + location).** Source = the Less functional parser's structural `tree` AST
    (`parseLessFn(src).tree`, a `Rules` root), NOT the raw CST. Rationale: the tree AST is exactly
    what the oracle renders and the parser builders have already resolved selectors / compounds /
    combinators / mixins into clean structural nodes; re-deriving that from CST leaves/tokens would
    duplicate the builder's work for zero gain on the shapes tree2 supports. The bridge lives
    OUTSIDE `tree2/` at `packages/core/src/tree2-frontend/bridge.ts` (touches parser + `../tree`
    provenance only — allowed; parsing is the shared ~17% front end). It maps Ruleset→Rule,
    Mixin→MixinDef, Call→MixinCall, Declaration→decl, Comment; converts string / `CompoundSelector`
    / `ComplexSelector` / selector-array into tree2 SelectorList/Complex/Compound (with `&` as its
    own Simple so tree2's composition detects it); and captures STATIC value bytes verbatim from the
    declaration's source span (tree2 does no value eval by design → an opaque token, faithful to its
    model). Anything else raises `UnsupportedShape`, which the census ranks. **tree2 boundary guard
    STILL GREEN** (grep of `src/tree2` for `../tree` empty; vitest guard passes) — the bridge's
    output is pure tree2 nodes.
  - **Non-synthetic byte-identity (tree = oracle).** Corpus scanned = 133 `.less` files under
    less.js `tests-unit`. **15 real fixtures render BYTE-IDENTICAL** through parse→bridge→tree2→
    serialize vs the legacy `tree` render. Substantive emitters among them: `import/import/imports/
    logo.less` (117B, `#logo` with 4 static decls incl `url('…')`/`url("…")`), `simple-ruleset-2162
    .less` (40B), `global-scope-nested.less` (31B); several are mixin-DEFINITION-only files that
    correctly emit empty. Plus 13 constructed real-syntax inputs (authored `.less`, parsed + bridged
    through the REAL front end: nesting, `&:hover`/`&.b`, 3-deep, compound/child/descendant/list,
    spaced values, mixin call incl nested body) — ALL byte-identical. Zero diffs among accepted-and-
    static fixtures. (Honest note: the pure-static-nesting real fixture is RARE — the corpus couples
    nesting with variables/operations, which is itself the census's headline finding.)
  - **RANKED BLOCKER CENSUS (first blocker per fixture → the grounded climb order).** Bridge-reject
    (99 fixtures): **VarDeclaration/real variable scoping = 36** (dominant), **StyleImport/`@import`
    = 18**, **at-rules (`AtRule` 15 + `AtRuleStatement` 11) = 26**, **`Extend` = 8**, bare `Any` = 4,
    mixin guard = 3, pattern/named param (`mixin:param-name`) = 3, `CustomDeclaration` = 1. Separately,
    14 fixtures BRIDGED structurally (tree2 handled the shape) but bytes DIFFER — the value-semantics
    layer: **value operations/functions ≈ 10** (color-functions, operations), variable-in-value 2,
    other 2. So the real-input climb order is: **(1) variables + real scope, (2) value operations/
    functions, (3) at-rules/@media, (4) @import, (5) extend, (6) guards, (7) pattern/overloaded
    mixins.** Deferred from rung 4 (`:is()` `&`-under-complex-parent) did not surface as a top blocker.
  - **Real-fixture race (straight, no extrapolation; same worktree, warmup 5, N=15 median,
    `--expose-gc`).** tree2 lane = build-from-parse (bridge) + serialize; tree lane = full legacy
    render (async eval+emit); parse shared/excluded; all byte-identical:
      - `logo.less`: tree2 **0.0122 ms** vs tree **0.1547 ms** = **12.7×** (117B out)
      - `simple-ruleset-2162.less`: **0.0029 vs 0.0418 ms = 14.5×** (40B)
      - `global-scope-nested.less`: **0.0019 vs 0.0448 ms = 23.9×** (31B)
      - constructed nesting-3deep: **0.0045 vs 0.1141 ms = 25.6×** (41B)
      - constructed mixin-call-nested (2 placements of a nested-body mixin): **0.0106 vs 0.4630 ms =
        43.6×** (154B)
    Small real numbers, reported straight; consistent with rungs 3–5's at-scale 30–107× and legacy's
    async mixin path. Kept (experimental scaffold). **Recommended next rung: variables + real scope
    (#1 blocker by a wide margin — 36 fixtures, and it gates most nesting fixtures), then value
    operations/functions (the #1 DIFF category). Only after those two does the corpus open up enough
    to bridge `benchmark.less` end-to-end (the real gate).** Code: `tree2-frontend/bridge.ts` +
    `__tests__/{bridge-byte-identity,census,race}.test.ts`.

- 2026-07-15 — **rung 5: tree2 mixin-placement EVAL — the decisive rung. VERDICT: tree2
  PRODUCES the compositions cheaply; eval+placement stays O(placements) with a tiny constant,
  NO wall (branch `experiment/tree2-cleanroom-20260715`, still SYNTHETIC).** Thesis under test
  was not "printing a pre-composed tree is cheap" (already proven) but "tree2 can PRODUCE the
  ~70k compositions during eval without paying tree's per-placement cost." Architecture built =
  handoff departure #4 (canonical-body + placement-overlay): a mixin body is stored ONCE; a call
  is a cheap overlay = a binding frame (param→arg value node) + the current parent-selector
  context; expansion WALKS the shared body in place — **no clone, no `cloneForPlacement`/`inherit`
  analog** — composing nested selectors via the interned-string primitive and resolving `@param`
  refs through the frame. Added tree2 `MixinDef`/`MixinCall`/`VarRef` + a minimal scope/binding
  model (mixin defs + positional params + static/spaced values). **Byte-identity (tree = oracle):
  mixin decls placed under distinct parents, mixin with nested `.inner` + `&:hover` in body, and a
  parametrized mixin called with distinct args — all triple-identical (tree2-fast === tree2-tracked
  === legacy).** At-scale eval race (both sides now eval; legacy mixin render is ASYNC = part of its
  real cost; warmup 3, N=9 median, `--expose-gc`):
    - **mixin-heavy (1,200 calls of one canonical `.card(@c)` body → 2,400 compositions):** total
      build+eval+serialize **tree2-fast 1.31 ms / tree2-track 1.35 ms vs legacy 140.7 ms = 107×**;
      creation 0.16 vs 2.07 ms; heap total 8.4 vs 29.8 MB. tree2 node count only **2,407** (body
      stored once + 1,200 call sites) — the canonical-body win made concrete; legacy materializes
      far more. **Ops: tree2 2,400 compositions (≈1 interned-string build each, clone/inherit = 0
      — it has no such op); legacy 20,400 `cloneForPlacement` + 28,800 `inherit` + 1,200
      `withComponents` = 50,400 node ops ≈ 21 legacy node-ops PER composition.**
    - flat (3,200 rules): total 1.76 vs 64.7 ms = 36.9×. composition-static (850 blocks, 4,250
      comps): total 2.20 vs 120.7 ms = 55.0× (≈14.6 legacy node-ops/comp).
  **Straight verdict: YES — producing the compositions does NOT reintroduce tree's cost.** tree2's
  eval is a linear walk of a shared body with one string build per placed selector and one frame
  lookup per declaration; the clone/inherit/withComponents columns are structurally ZERO for
  tree2. Position-tracking adds ~2–25% (still ~100× ahead). Extrapolating the O(placements)
  structure to benchmark's ~70k compositions keeps tree2 string-op-bound (no eval-engine tax),
  i.e. the ~37 ms Less-4.x neighborhood is reachable — the arena thesis is validated at the
  measured cost center. Kept (experimental scaffold, NOT merged). **Caveats/next:** (1) still
  SYNTHETIC — the real gate is running `benchmark.less` end-to-end through tree2 (needs a
  parser→tree2 front end + the deferred rungs). (2) Deferred to later rungs: value operations,
  guards, pattern-matching/overloaded mixins, `extend`, `@media`/at-rules, imports, real variable
  scoping beyond params, and the `:is()` `&`-placement gap from rung 4. (3) legacy's mixin path is
  async; tree2's is sync — a real structural difference, flagged not hidden.

- 2026-07-15 — **tree2 rungs 3–4 (selectors + nesting/`&` composition) + at-scale race —
  the thesis holds; composition SCALES, no wall (branch `experiment/tree2-cleanroom-20260715`).**
  Rung 3 (compound `.a.b` / child `.a > .b` / descendant `.a .b` / list `.a, .b`) and rung 4
  (nesting `.a{.b}`→`.a .b`, `&:hover`, `&.b`, 3-level deep, list×list `:is(.a, .b) .c`) are all
  **triple byte-identical** (tree2-fast === tree2-tracked === legacy === expected). tree2 grew a
  real selector model (SelectorList/Complex/Compound/Simple, cached canonical strings) and a
  FLATTENING serializer that composes parent×child by STRING ops on the cached canonical text —
  `&` → substitute parent for each `&`; else descendant `parent + ' ' + child`; multi-selector
  parent → `:is(...)` wrap. **No `cloneForPlacement`/`inherit` analog; composition is one
  interned-string build per placement.** Measurement (owner steer): dropped the setup-dominated
  tiny-rung microbench; built ~10k-node stylesheets (flat 3200 rules / 9,601 nodes; composition-
  heavy 850 blocks / 10,201 nodes, 4,250 compositions) and raced build+serialize at scale where
  setup contamination is negligible. **Same-worktree, warmup 3, N=9 median, `--expose-gc`:**
    - flat: creation t2 0.47 ms vs legacy 5.88 ms; serialize t2-fast 1.34 / t2-track 1.49 ms vs
      legacy 48.1 ms; total **1.81 vs 54.0 ms = 29.8×**. Heap: AST 2.7 vs 6.6 MB; serialize
      **5.7 vs 54.2 MB**.
    - composition-heavy: creation t2 0.63 vs 7.25 ms; serialize t2-fast 1.48 / t2-track 1.41 ms
      vs legacy 60.1 ms; total **2.11 vs 67.4 ms = 32×**. Heap: AST 3.8 vs 8.3 MB; serialize
      **5.4 vs 39.5 MB**.
    - **Composition-op counts (the 70k scaling indicator): tree2 = 4,250 compositions (≈1 string
      op each); legacy = 26,350 `cloneForPlacement` + 33,150 `inherit` + 2,550 `withComponents`
      = ~62,050 node ops ≈ 14.6 legacy node-ops per composition.** Position-tracking adds ~0–10%
      (often within noise). **Verdict: tree2's composition is O(compositions) with a tiny constant
      (one interned-string build); it does NOT hit a wall.** Linear extrapolation to the
      benchmark's ~70k compositions ≈ 70000/4250 × ~1.5 ms ≈ ~25 ms of compose+serialize with NO
      eval pass — in Less-4.x's ~37 ms neighborhood, and legacy stays ~14.6× node-ops-per-comp.
      Kept (experimental scaffold, NOT merged). **Known gap (deferred rung):** a standalone `&`
      followed by a combinator under a COMPLEX parent (e.g. `& > .x` under `.a .b`) → Less wraps
      `:is(.a .b) > .x`; tree2's `:is()`-wrapping rule doesn't yet cover that position (in-compound
      `&` and list parents ARE covered). Next rungs: complete the `:is()` `&`-placement algorithm,
      then mixin definition+placement (needs binding/eval — its own dispatch), then extend.

- 2026-07-15 — **clean-room `tree2` scaffold + rungs 1–2 (branch
  `experiment/tree2-cleanroom-20260715`).** Pivot from departure #1 (below): grow a
  from-scratch `tree2` bottom-up via a per-shape `tree2`-vs-`tree` serialization head-to-head.
  Delivered: clean-room `packages/core/src/tree2/` (`node.ts` own base `Tree2Node`;
  `nodes.ts` Root/Rule/Selector/Declaration/Comment + Word/Dimension/SpacedValue value nodes;
  `serialize.ts` a from-scratch byte-faithful serializer with a FAST path and an OPTIONAL
  position-tracking path), and a harness in `tree2-harness/` (byte-identity, boundary-guard,
  race — all outside `tree2/` so the OLD side's `../tree` imports never pollute the boundary).
  Hard-boundary guard: grep of `src/tree2` empty; vitest guard passes. **Byte-identity: rung 1
  (`.test { color: red; }`) and rung 2 (comment trivia + `0px`/`10px` dimensions + 3 decls) both
  triple-identical** — tree2 fast === tree2 tracked === legacy `tree` === expected literal.
  Trivia is carried STRUCTURALLY (a `Comment` body child), so byte-identity holds with ZERO
  position tracking. Race (warmup 12, N=25, batch 4000, gc on): rung 1 tree2-fast **2.35e-4 ms**
  vs legacy **1.47e-2 ms** (~63× faster); rung 2 tree2-fast **5.77e-4 ms** vs legacy
  **3.05e-2 ms** (~53× faster); tracking path adds ~1–11% over fast. **Caveat (honest): the huge
  margin at the bottom is legacy's fixed per-render setup (new `Context` + render buffer +
  `resolve` contract), NOT the per-placement selector-reconstruction cost this track targets —
  the meaningful race arrives at the selector-composition / nesting / mixin / extend rungs.**
  Next rungs (mechanical from here): selector lists/compound/combinators → nesting & `&`
  composition → mixin definition+placement → extend. Friction: legacy serialization requires a
  `Context` and goes through `renderNodeToString`'s resolve path even for fully-static shapes;
  fine for the oracle but it inflates the legacy lane's floor. Kept (experimental scaffold, NOT
  merged to dev).

- 2026-07-15 — **departure #1: position-sharing on same-extend-root placements — measured NO-GO.**
  Hypothesis: the ~35,033 per-render `inherit` provenance-copies (and the clones they back)
  exist mainly to carry distinct source positions, so same-extend-root placements could SHARE
  position data (reference, not copy) and collapse both the clones and the inherits.
  Diagnostic: no-op'ing all 35,033 `copySpanFields` calls moved render by **≤2%** and broke
  bytes by **−46** — i.e. provenance copying is NOT the cost, and it IS load-bearing for output.
  Same-extend-root is **≈100%** on `benchmark.less` (its imports are 0-byte, so cross-root is
  untestable on this fixture) → position-sharing has nothing to gate on here. The clones are
  dominated by **intrinsic per-placement composition**, not provenance. Dropped: the clone is
  not a position-carrying artifact; sharing positions saves nothing measurable and the real cost
  is rebuilding selector node trees per placement. → pivot to the clean-room `tree2` entry above:
  attack the representation itself, prove it bottom-up shape by shape.

- (seed) 2026-07-15 — track opened. Baseline ~215–250ms; sha `98a0536086c7e555`. Pending input:
  the mixin-expansion clone redundant-vs-intrinsic + position-sharing diagnostic (whether the
  clone is fundamentally a position-carrying artifact). First experiment should be departure #1
  (position/structural sharing on same-extend-root placements), informed by that diagnostic's
  same-root/different-root counts.
