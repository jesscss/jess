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
3. **DO NOT reuse the old machinery on the hot path — this is the whole point.** The first
   arena POC (`tree2/`) failed *specifically* because it: (a) required a fully-evaluated
   root, so it never touched eval; (b) was emit-only; (c) **reused `extend.ts`/node
   materialization for its rewrite step**; and (d) was hard-disabled under
   `collapseNesting:true` — the benchmark's own config. Net: it moved benchmark by **zero**.
   A real arena experiment MUST attack the eval-time cost and MUST NOT call the old node
   constructors / `withComponents` / `cloneForPlacement` / `inherit` on its hot path. If an
   experiment leans on those, it is testing the old engine in a new coat — stop and rethink.
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

## Extend architecture: adopt the bucket-path model, NOT eval's flatten model (decided 2026-07-15)

**The arena's extend renderer MUST be built on the bucket-path / walk model** (the spine's
`packages/core/src/tree/extend/emit.ts` + `spine-extend.ts` — compose/project/fold from an
explicit BucketPath), **NOT** eval's legacy **flatten model** (`extend-roots.ts` /
`extend.ts` / `extend-walk.ts`).

Why: eval's flatten model is **structurally incapable** of representing `&`-in-`:is()` +
ancestral-branch compositions — stated in eval's own source (`extend-walk.ts:22-46`:
"Flattening cannot represent this"; `:44` ComplexSelector find is "diagnostics only … falls
through to legacy"). The spine's ~2700-line bucket-path architecture exists *precisely
because* eval can't. Measured 2026-07-15 (agent a09eb84e, forced-eval): eval renders
`tests-unit/extend-nest/extend-nest.less` + `tests-unit/extend-selector/extend-selector.less`
WRONG — drops nested-extender ancestors (`.type1 .sidebar3` → `.sidebar3`), no `:is()`
collapse of pseudo-suffixed groups (`:is(.button, .submit):hover`), leaks raw `&` into
`:is()` — while the spine renders both byte-identical to golden. **These two fixtures are the
precise oracle for extend correctness.**

Consequences for the arena:
- **KEEP/adopt** the bucket-path compose/project/fold, the PLAN `reachesRoot` scope
  predicate, and the own-construction/`UNSUPPORTED` discipline. Eval's flatten extend is the
  eventual **DISCARD**, not the spine's extend renderer. (This corrects an earlier "delete the
  spine" framing — the spine's extend renderer is load-bearing and CORRECT; only the
  `CompoundSetTrie` is proven discard.)
- Do NOT port extend into a flatten model or reintroduce one.
- The ~43ms "wasted spine attempt" tax (spine gathers extends then aborts to eval on
  abort-bound trees like benchmark) **dissolves once the arena unifies on bucket-path extend
  and retires the flatten path** — rather than by deleting the spine.

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

- 2026-07-15 — **Departure #1/#4: overlay-only (share-not-clone) selectors on the EMIT path — LANDED.**
  · *Hypothesis:* the per-placement selector `cloneForPlacement`/`copyOwnedWithReusableLeaves` copies made at
  EMIT time are pure mutation-model debt: they exist only to give a placement a private `.parent`/spans, but
  (a) `processExtends` runs at eval-end (`rules.ts:7886`) so NO extend rewrite can touch a selector during
  serialize, and (b) selector composition reads its parent from an EXPLICIT parameter + the live
  `composedSelectorStack` overlay, never the node's own `.parent`. So the two emit-time selector-copy drivers
  can SHARE the canonical node (frozen so `inherit`/`adopt` skips the `.parent` re-point) with nothing left to
  carry — the clone's reason to exist is removed, not relocated.
  · *Changed:* `Ruleset._ownForCompose` (compose driver, ~7,100/render) and the comparable-header
  (`writeHeaderSelector` `withoutComments`, ~3,798/render — its comment strip is already covered by the empty
  `createTriviaMap()` on that path) now freeze-and-share the canonical selector component instead of copying.
  · *KEPT clone (the one legitimate boundary):* the registration clone `_storeOwnSelector` →
  `copySelectorForRulesetMetadata` (~1,100/render) is EVAL-time and feeds the extend matching layer (stores
  `ownSelector` + attaches per-root selector bits BEFORE `processExtends`); that is exactly "a shared node
  extend could mutate," so it stays a private copy. Reference-mode `filterExtendedItems` copy (`ruleset.ts:1826`)
  also stays — it genuinely mutates (filters extend targets).
  · *Byte-identical:* YES — benchmark.less 131578 / `98a0536086c7e555`, all-less (106), extend (762), full core
  (3332), spine-production-ratchet (137) all green.
  · *Measured Δ:* interleaved in-process A/B (runtime flag, same process/thermal state, N=21 median, 5–7 rounds;
  machine was under load ~14 so cross-run medians drift but in-process ordering is clean): ON beat OFF in EVERY
  round, ~2.5–3.4% faster (e.g. 240.9→232.7ms and 264.2→255.9ms median-of-medians).
  · *Why not more:* the big remaining bulk is the value-eval `inherit` (~35k) which is the unified-pass
  value-frame work, out of this slice's scope. The registration + reference clones are small and genuinely
  extend/mutation-bearing.
  · *Next:* the ~35k `inherit` value-provenance copies (departure #4 canonical-body + placement-overlay for
  mixin VALUES) is the next-largest lever; and whether `_storeOwnSelector`'s share can be recovered by routing
  extend match keys off the canonical node (loosened canonical-mutation invariant §4.4.6) rather than a copy.

- (seed) 2026-07-15 — track opened. Baseline ~215–250ms; sha `98a0536086c7e555`. Pending input:
  the mixin-expansion clone redundant-vs-intrinsic + position-sharing diagnostic (whether the
  clone is fundamentally a position-carrying artifact). First experiment should be departure #1
  (position/structural sharing on same-extend-root placements), informed by that diagnostic's
  same-root/different-root counts.
