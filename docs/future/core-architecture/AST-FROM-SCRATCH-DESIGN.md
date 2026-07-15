# Jess AST from scratch: packed-arena emit POC

Status: design record plus a real proof-of-concept, updated 2026-07-15.

> The standing, open-ended arena experiment track lives in `AST-ARENA-EXPERIMENT-HANDOFF.md`.

This document covers the greenfield `packages/core/src/tree2/` work. It is both a
design record for the Q-40 performance program **and** an accurate account of the
POC code that now exists in this worktree. Earlier drafts framed the effort as a
survey ("not permission to rewrite the tree", "candidate shapes considered, not
rewrites to schedule"). That prose under-represented what was actually built: a
genuine from-scratch, struct-of-arrays **packed arena** with tag-dispatched emit.
This rewrite reconciles the prose to the code, and — just as importantly — states
the honest limitations the code carries today.

The discipline the earlier draft got right is preserved: every production change
must first prove a real shape on `benchmark.less` or a representative fixture,
preserve Jess byte output, carry allocation/GC evidence (not one timing number),
and pass the core, spine, all-less, and aggressive-cutting gates.

## What was actually built: `tree2/`

`tree2/` is not a slimmed object AST and not a refinement of the existing tree. It
is a separate, from-scratch representation:

- **A struct-of-arrays packed arena** (`types.ts`, `Tree2Arena`). Records are
  parallel typed arrays: `Uint8Array` `tags`; `Int32Array` columns
  `childStart` / `childCount` / `children` / `escapeId` / `textId` /
  `authoredId` / `spanStart` / `spanEnd`. Only escape records retain references
  to legacy `Node` objects (`escapeNodes`).
- **A string-interning pool** (`adapter.ts` `stringId`, `strings` + `stringIds`).
  Selectors and packed declaration text are deduplicated into an id-addressed
  pool. Declaration records pack `name value` into one interned string
  (`render.ts` `declarationText`).
- **Tag-dispatched emit** (`render.ts`). Five tags
  (`Root`, `Ruleset`, `Declaration`, `LegacySubtree`, `WholeDocumentEscape`;
  `types.ts:10`) drive a switch that writes native rulesets straight to a render
  buffer and delegates everything else.

That is a legitimate packed-arena AST experiment. The rest of this document
describes what it does and does not yet do, honestly.

## Implemented vs Designed vs Proven

### Implemented (code exists and runs)

- **`buildTree2(sourceRoot, { input })`** — `adapter.ts:437`. Walks an
  **already-evaluated** `Rules` root **without cloning** it (a non-mutating
  projection, consistent with the project's "spine is projection, not mutation"
  principle). It admits only flat `selector { static-decl; … }` rulesets to
  native arena records; everything dynamic becomes an **escape record** that
  holds the original `Node`.
  - The admission gate is strict. A ruleset is native only if the selector is a
    single, comma-free, non-interpolated string with no guard and no
    `selectorBeforeExtend` (`selectorText`, `adapter.ts:273`), it is its own
    `sourceNode` (not a mixin expansion), and it carries no printable trivia
    (`nativeFlatPlan`, `adapter.ts:290`). Every child must be a static
    declaration whose value is a `NATIVE_VALUE_TYPES` leaf with no dynamic
    markers (`$`, `@{`, `#{`, `~`) and whose **authored** source proves neither a
    variable/`@`-reference nor a parenthesised operation
    (`authoredDependencyReason`, `adapter.ts:216`; `staticValueText`,
    `adapter.ts:193`). Any nested ruleset disqualifies the whole ruleset.
  - Everything else — variables, operations, interpolation, merges, nesting,
    comments, imports, mixins, extend, at-rules — becomes a `LegacySubtree`
    escape (`appendEscape`, `adapter.ts:172`) tagged with a reason
    (`EscapeReason`, `types.ts:18`). Imports anywhere in the tree, or a
    non-evaluated root, force a single `WholeDocumentEscape` covering the whole
    document (`adapter.ts:466-491`).
- **`renderTree2`** — `render.ts:169`. Emits native rulesets directly to the
  buffer (`nativeRuleset`, `render.ts:40`); escape records delegate to the legacy
  renderer (`escape.ts` → `renderNodeToString` / `writeSyntax` /
  `renderNodeToBuffer`). It threads route statistics (`Tree2RenderStats`) so a
  test can assert exactly which records went native vs legacy and why.

### Designed only (described here, **not** in the code — 0 hits)

These appear in the "recommended target shape" and POC sections below but have **no
implementation** in `tree2/`. They must not be read as built:

- **Tagged VALUE leaves with lazy materialization** (POC 1). This is the doc's own
  "decisive lever," but `tree2/` has no value-leaf representation at all —
  declaration values are captured as already-serialized text via `textOf`, and
  `NATIVE_VALUE_TYPES` is merely a whitelist deciding *whether text extraction is
  safe*, not a lazy leaf. **This is the same idea as
  [`VALUE-LITERAL-TAG-SPEC.md`](./VALUE-LITERAL-TAG-SPEC.md)** (NODE-SLIM-FOLLOWONS
  Question 1); the two must not diverge into competing plans. Treat that spec as
  the canonical home for the tagged-value-leaf design and this document's POC 1 as
  a pointer to it.
- **Placement frames / live bindings** (target-shape layer 2). No frame, cell, or
  binding structure exists; the arena has no notion of placement-local state.
- **Canonical DAG import/mixin reuse.** Imports currently force a whole-document
  escape; there is no shared-body reuse.
- **Sparse-trivia representation** (POC 4) and **stripped Parseman recognizer**
  (POC 5). Neither exists; trivia today is a disqualifier for the native path, not
  a representation.

### Proven (what the tests actually assert)

- **Correctness / byte-identity of the packed emit path.** `tree2.test.ts`
  asserts byte-identical output and route counts on small fixtures
  (static-only, single at-rule escape, variable escapes, raw-root
  whole-document escape).
- **Nothing about speed.** The benchmark, `tree2-bench.test.ts`, is
  **`it.skip` unless `TREE2_BENCH=1`** (`bench = ENABLED ? it : it.skip`,
  line 239) and asserts only exact-hash equality and routing counts
  (`nativeRenderCount > 0`, `legacyRootRenderCount === 0`, an expected at-rule
  reason). There is **no `toBeLessThan` on any timing** — it records
  medians to a `console.log`, it does not gate on them.
- The production cuts that this effort *did* land are each self-described in
  [`CORE-CLEANUP.md`](./CORE-CLEANUP.md) (merge-presence carry, coalescer
  admission, duplicate pre-scan) as **"neutral / noisy, no speed claim."**

**Bottom line: the work to date proves the feasibility and correctness of a packed
emit path, not a performance win.**

## Current limitations / what this does NOT yet address

1. **Emit-only, and it runs after full eval.** `buildTree2` requires a
   fully-evaluated root (`input: 'evaluated'`; raw roots become one escape,
   `adapter.ts:468-470`). The dominant cost — eval-walk — is paid in full before
   `tree2` runs. Per the 2026-07-15 ground truth below, eval is ~37% of CPU and
   emit only ~15%; `tree2` competes for a slice of that ~15%. **As implemented it
   cannot reach the <40 ms target**, because it does not touch the larger cost.

2. **The native path contributes ZERO on the canonical benchmark.** `renderTree2`
   **hard-rejects** the native path under `collapseNesting: true`
   (`nativeBoundaryError`, `render.ts:162`) — as well as under source-maps,
   compression, and explicit trivia. `collapseNesting: true` is `benchmark.less`'s
   own configuration, so on the canonical benchmark the whole document escapes to
   the legacy renderer and the packed path does no work. This directly contradicts
   the "must first prove a real shape on `benchmark.less`" mandate; the mandate and
   the current POC are not yet reconciled. Any claim that this POC helps the
   canonical benchmark is currently unsupported.

3. **No speedup is proven anywhere** (see "Proven" above). Feasibility and
   byte-identity only.

4. **Relationship to the committed spine is unspecified — and is an open risk.**
   The shipped render path is the "spine" (`emit-walk.ts` / `serialize-helper.ts`).
   `tree2`'s escape path bypasses the spine entirely and routes to the *legacy
   node renderer* (`escape.ts`). Whether `tree2` is meant to **replace** the spine,
   **feed** it, or **compete** with it is undecided. Standing up a third emit lane
   alongside eval and the spine is a real maintenance and correctness risk and must
   be resolved before any production wiring.

## Perf ground truth (measured 2026-07-15)

Controlled: dev `5df23b76e`, warmup 10 / N=21 median, same worktree.

- `benchmark.less`, `collapseNesting: true`: Less 4.x **35.4 ms** · jess default
  **271.6 ms** (7.7×) · jess eval-only **216.2 ms**.
- The default path **double-walks**: a speculative spine gather aborts back to
  eval at `emit-walk.ts:2533`, then runs a full eval — roughly **55 ms / 26%**
  wasted-spine tax on top of eval.
- CPU split: eval-walk ~37% · value/node ~10% · emit ~15% · parse ~12% · GC ~5% ·
  **async ≈ 0%**.

Implication for `tree2`: the gap is **raw per-node eval/emit compute**. Async /
promise overhead is **not** a lever (the `isThenable` fast-path already collapses
it); do not chase it. Because eval dominates and `tree2` is emit-only, `tree2`'s
reachable ceiling is a fraction of the ~15% emit slice — and zero on the canonical
benchmark until the `collapseNesting` rejection is addressed.

## Q-40 per-node diagnosis (measured 2026-07-15, this worktree)

Instrumented render of `benchmark.less` (`collapseNesting:true`) on branch
`feature/greenfield-ast-design-20260714`. Harnesses live in `packages/core/perf/`
(`q40-bench.mjs`, `q40-prof.mjs`, `prof-agg.mjs`). Same-worktree, warmup 10, median.
Phase split (JESS_PROFILE, steady state): **parse ~42 ms · render(eval+emit) ~220 ms
· total ~250–265 ms** — reproduces the ground truth above.

### Redundant-vs-intrinsic split (the decision inputs)

- **Grammar does NOT run at render time.** Decisive counter test: grammar-rule
  entry counts (`_r_value`, `_r_ComplexSelector`, `_r_CompoundSelector`,
  `_r_simpleSelector`) are **byte-for-byte identical** between a full `render()`
  and a parse-only `LessParser().parse()` (value 18789, ComplexSelector 6267,
  CompoundSelector 10997, simpleSelector 17644). The grammar frames in flat CPU
  profiles are 100% **parse** (getTree), conflated only because `render()`
  re-parses each call. `selector-capture.ts` is the *only* eval-path parser
  re-entry and is a niche `*[…]` node. **Suspicion #1 (grammar-at-render) is
  false — not a render lever.**
- **Render cost is node ALLOCATION, and it is ~86% selectors.** One render
  constructs **102,284 nodes** over a **21,199-node** source tree → eval creates
  **81,085 new nodes (3.8×)**, with **35,033 `inherit` provenance-copies**.
  By type, eval-new: ComplexSelector 32,995 · BasicSelector 25,709 (0 at parse) ·
  CompoundSelector 8,414 · SelectorList 1,439 · PseudoSelector 800 —
  **selector family ≈ 69.9k of 81k eval-new nodes (~86%)**. Values are tiny by
  comparison (Dimension 1,609 · Color 613). **This corrects the doc/tree2 fixation
  on tagged VALUE leaves (POC1 / VALUE-LITERAL-TAG): the measured hot allocation is
  SELECTORS, not values.**
- **Already-optimized, NOT levers:** selector `valueOf()` is memoized
  (`_valueOf`, selector-complex.ts:250); 44% of eval calls (21,772 / 49,098) are
  F_STATIC no-op short-circuits; `ComplexSelector.evalNode` runs only 117× (the
  bulk selector allocation is NOT from selector `eval`).
- **Biggest LOCALIZED lever — the extend pipeline: ~47 ms of render (~19%) for a
  stylesheet with only 26 `:extend` clauses.** `processExtends` is a single 47.4 ms
  call; skipping it (byte-changing A/B) recovers exactly that. The dominant
  selector-allocation stack is `_finishEval → processExtends → As/Tb/Ec/W → new
  ComplexSelector` (28k+ from the top bucket). The matcher re-materializes
  string-backed selector leaves into fresh node trees per match attempt
  (`materializeStringLeaves`, `selectorListItemForMatch`) and re-matches
  O(rulesets × extends). This is largely **redundant recompute + redundant
  allocation** — fixable WITHOUT a new representation.

### POC attempted + honest result

Memoized `materializeStringLeaves` (selector-match-core.ts) on input-selector
identity via a `WeakMap` — it is called **12,001×** on only **2,317** unique
inputs (5.2× redundancy) and is deterministic in its immutable post-eval input, so
caching is safe. Result: **byte-identical output ✔** but **timing neutral**
(same-worktree, same-build env-toggle A/B: baseline median 246.8 ms / min 237.9 ms
vs memo 252.0 ms / min 235.9 ms). Cause: the 5.2× redundancy is mostly the
read-only fast path (`changed===false` returns the input without allocating), so
the cached calls weren't allocating anyway, and the WeakMap get/set overhead
offsets. **The memo was reverted.** The 47 ms extend cost is diffuse across the
whole matcher (keyset prefilter, `areComplexSelectorsEquivalent`,
`selectorListItemForMatch` wrapping, O(rulesets×extends) iteration), not
concentrated in one cheap-to-cache call.

### Recommended rewrite shape + next slices

The deciding evidence: after removing the (small, cheap) redundant-recompute, the
residual ~170 ms is **intrinsic per-placement selector-object materialization** —
each placement/flatten builds fresh ComplexSelector/CompoundSelector/BasicSelector
trees + `inherit`. That favors an **evolutionary lean-SELECTOR representation**
(string-joined / interned selectors on the flatten+extend path) over a full packed
arena, and it relocates the first target from *values* to *selectors*. Next slices:
1. **Extend matcher, cheaper structural match** — profile *inside* `processExtends`
   (As/Tb/Ec) to find the 47 ms's real center; prefer string/keyset comparison over
   re-materialized node trees. Target: cut the 47 ms without changing output.
2. **Selector flatten without object rebuild** — make nesting-collapse join parent+
   child selectors as interned strings, not by allocating selector node trees +
   `inherit` (attacks the 69.9k eval-new selector allocations directly on the
   render path).
3. **Emit-time header-selector rebuild** — `renderHeaderSelectorString` /
   `writeHeaderSelector` construct ~5.5k BasicSelectors at emit just to stringify;
   emit from the already-known selector string.

## Open question: flip vs. rewrite (evidence-gated — no winner declared)

There is a pending decisive measurement that this document deliberately does **not**
pre-resolve:

- **Finish the D-EVAL flip** so `benchmark.less` renders spine-only (no
  double-walk, no eval fallback), then re-measure. If that gets materially closer
  to 35 ms, it favors **keeping the object AST** and investing in the spine.
- **If it stays far off**, that strengthens the case for a **packed-arena rewrite**
  along the lines of `tree2`.

**Pending evidence:** the flip-vs-rewrite decision is open and gated on the
post-flip re-profile. Do not declare a winner in this document or schedule a
rewrite off it. Note also that `VALUE-LITERAL-TAG-SPEC.md` is itself sequenced
*after* the D-EVAL flip and its mandated re-profile — the same gate applies here.

## Design target (the intended end shape, if the rewrite path is chosen)

The diagnosis behind the design still holds: the current tree is not slow because
one universal node class is intrinsically wrong. The cost is accumulated work
across parse, placement evaluation, fallback preparation, traversal, and
serialization. The common tree is mostly static declarations and values, but
Less's dynamic islands are real (variable rebinding, source-order lookup, mixins,
detached rulesets, interpolation, imports, guards, plugins, extend). The target is
to make the common path structurally cheap and every dynamic escape explicit —
which is exactly the native-vs-escape split `tree2` already implements structurally.

The fuller intended shape (not yet built) is a three-layer representation:

1. **Canonical source tree** — lean containers own source order, authored spans,
   and only semantic facts all placements need; static leaves are source text plus
   a compact tag, not eager `Dimension` / `Color` / `Keyword` / `Bool` objects.
   (This leaf idea is `VALUE-LITERAL-TAG-SPEC.md`.)
2. **Placement frames** — a placement owns live bindings and sparse overlays only
   where evaluation changes the source result; imports/mixins reuse the canonical
   body instead of cloning.
3. **A direct evaluator/emitter** — a pure static region runs as a tight
   tagged-value loop writing to the buffer; dynamic nodes take an explicit escape
   into the object/runtime path, with no "preview everything, then discover what
   happened" pass.

The boundary is semantic, not syntactic: a value becomes a full runtime object
only when arithmetic, comparison, a guard, a reference result, a plugin, or an
interpolation actually needs object behavior.

## What this rules out (still valid)

- **A universal prototype-chain scope engine.** Prototype inheritance is fine for a
  bounded static-lookup experiment but cannot represent Less's live writes and
  call-site visibility; it must not become the semantic scope model.
- **A generic AST index that rediscovers facts already explicit on a node.** Carry
  facts at construction/evaluation time, as the merge-presence cut now does.
- **Turning every whitespace capture into a node.** Pure allocation/GC cost with no
  output benefit.
- **Replacing every node with a string.** Arithmetic, comparison, guards,
  interpolation, references, calls, and plugins need typed behavior; the target is
  a lightweight representation with explicit materialization.
- **A parser-only rewrite as the sole route to <40 ms.** Parser work is necessary
  but render/eval is the larger gap (see ground truth: parse ~12%, eval ~37%).

## Perf-gated POC sequence

Methodology (unchanged, and worth keeping): each POC is gated on byte-identical
output, allocation/GC evidence rather than a single timing number, and A/B on the
canonical benchmark **plus** a representative fixture. A variant is kept only if it
reduces total work or retained memory with identical output.

- **POC 1 — tagged value leaves.** Source text plus a compact tag for
  dimensions/numbers/colors/booleans/keywords; keep original text exactly (no
  `1.0`→`1`); materialize only on arithmetic, comparison, guard, reference,
  interpolation, or plugin. **This is the same design as
  [`VALUE-LITERAL-TAG-SPEC.md`](./VALUE-LITERAL-TAG-SPEC.md); execute it there,
  not as a divergent plan here.** Not implemented in `tree2/` today.
- **POC 2 — pure-value register island.** Compile a closed subset of
  literal/list/operation values to a tiny register representation; reference,
  interpolation, call, guard, plugin, and async operations emit explicit escapes.
  Must prove it never evaluates a dynamic node as static.
- **POC 3 — feature-specialized direct emitter.** Select a direct emitter only for
  a proven capability mask; count every fallback and name its reason. `tree2`'s
  native-vs-escape routing is an early form of this, but it currently emits nothing
  on the `collapseNesting` benchmark config (limitation 2).
- **POC 4 — trivia representation.** Run no-trivia, one-space, comment-heavy,
  multiline, unknown-rule, and source-map-on workloads through comment-only /
  sparse variants; keep only if total work or retained memory drops with identical
  output.
- **POC 5 — recognizer boundary.** Build a genuinely stripped Parseman recognizer
  artifact (not a runtime flag in the capture-capable parser) and compare code
  shape and CPU against the current recognizer and Less's cursor/regex fast paths.
  Keep the Parseman change grammar-general.

## Appendix: alternative representations considered (not scheduled)

Kept for design-check reference; the credible near-term candidates are the packed
struct-of-arrays already prototyped in `tree2/`, tagged value leaves (POC 1 /
`VALUE-LITERAL-TAG-SPEC.md`), and a feature-masked direct emitter (POC 3). The
remainder are recorded to show they were weighed and set aside, not to schedule
them:

- Full object AST, aggressively slimmed — lowest migration risk, but still pays
  per-leaf objects and call ladders.
- Semantic AST plus packed sidecars — separates hot facts from cold metadata at
  the cost of side-table indirection.
- Canonical source DAG plus placement frames — reuses imports/mixins but needs
  correct dependency/escape analysis.
- Fixed-shape tagged records / lean class-per-kind — predictable V8 shapes vs.
  readable debugging trade-offs.
- Parentless zipper, region/rope source tree, two-tier statement/value AST,
  normalized semantic IR, expression bytecode (stack or register), selector/extend
  decision DAGs, piece-table output IR, and a native/Wasm packed subset behind an
  explicit boundary.

Wasm or native code is not a substitute for removing unnecessary work and is not a
near-term candidate.
</content>
</invoke>
