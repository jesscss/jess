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
