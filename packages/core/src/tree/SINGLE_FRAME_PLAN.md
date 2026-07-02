# Single-Frame Architecture — Audit & Migration Plan

Goal: **one** lookup system where every scope is exactly one `ScopeFrame`, that frame
carries its declarations + any live-slots, and its `parent` is its lexical/placement
enclosing frame. No `direct-rules-lookup` fallback, no `Mixin.sourceNode` /
`_passedRulesWrapper` duplicate frames, no transient re-points.

## Audit (verified by instrumentation, not assumed)

### Two lookup systems (reference.ts `performRulesVariableLookup`, ~L961)
1. **scope-frame** — `lookupScopeFrameVariable` walks the frame chain; results carry
   the owner frame (T). Primary.
2. **direct-rules-lookup** — `findVariableDeclarationOccurrence` walks the node tree;
   result is a `DirectDeclarationOccurrence` whose `ownerRules = node.parent`
   (canonical, **no T**). Used as a FALLBACK.
   - Fallback triggers when a frame in the chain is `!declarationsCovered`
     (scope-frame.ts L520 → returns `{kind:'uncovered'}`).

### Two frames per mixin call (the split)
- **Per-call surface `rules`** (`createCallableRules`): `wireCallableScopeFrames`
  builds `rules.scopeFrame` = **liveSlots (params) only**, empty declaration index,
  `declarationsCovered=true`, `parent = lexicalScopeFrame`.
- **Canonical body frame** via `Mixin.sourceNode` wrapper (mixin.ts L131-141): the
  Mixin sets `sourceNode = value.rules` and re-parents body children to that wrapper
  (`child.parent = wrapper`). Body vardecls resolve on THIS frame; nested rulesets
  reach it via the static `.parent` walk.

### The actual failure (nested detached-ruleset closure)
Verified with frame dumps AND re-verified 2026-07-02 with per-node instrumentation
(`__fdbgLabel` on `getScopeFrame`/`_evalPreparedRules`/`derive`/`set scopeFrame`,
plus a lookup-chain dump keyed on the failing name). Test:
`mixin.test.ts` → "resolves local mixin body variable inside a detached ruleset when
call is nested in a child ruleset". Structure: `.table-row-variant(background)` body
declares `@hover-background: @background`, then `.table-hover { .hover({ background-color:
@hover-background }) }`. The `background-color` value fails: `'background' is not defined`.

Instrumented mechanism (node ids from one run; `R#7`=canonical `.table-row-variant`
body, has `hover-background`; `R#6`=its per-call surface, `→src#7`, holds the
`background` param live-slot in frame@10):
- `.table-hover` is evaluated as **R#5** via `_evalPreparedRules` with
  `enclosingScope = R#6` (the per-call surface). The §4 re-point **fires correctly**:
  `R#5.frame@9.parent = R#6.frame@10` (frame@10 has `background`). ✓
- **But the detached ruleset body (`background-color` decl, R#14) has node.parent =
  a DIFFERENT `.table-hover` instance R#12** — a distinct canonical node
  (`sourceNode`=self, node.parent = canonical body R#7), whose frame@11 is built
  LAZILY during the reference lookup (`getScopeFrame` ← `lookupScopeFrameVariableBinding`)
  with `parent = R#7` (canonical body, **no params**). R#12 is **not** eval'd (no
  `_evalPreparedRules`), **not** `derive()`d, **not** frame-assigned — so the re-point
  on R#5 never reaches it.
- Result: the `background` lookup walks `R#14 → R#12 → R#7 → root`; the per-call
  params frame@10 is never in that chain. `hover-background` resolves (it's on R#7),
  but evaluating its value `@background` misses.
- The `preservesRulesLikeVariableTarget` closure path (call.ts:1834, `_closureScope`)
  does **NOT** fire for this arg — resolution is purely via node.parent = R#12.

**Refined conclusion (supersedes the "transient re-point / Step 1 alone fixes it"
framing):** this is not one frame instance being rebuilt behind a live re-point. There
are two genuinely distinct `.table-hover` node instances; the detached ruleset is
parented to the canonical one (R#12) whose frame chain reaches the canonical body
(R#7), which — because of the **R2 split** — does NOT chain to the per-call params
frame. So **this test is fundamentally an R2 manifestation**: as long as params live on
a separate per-call surface frame that the canonical body frame does not chain to, ANY
nested-ruleset instance reached via the canonical body (not the re-pointed per-eval
instance) misses params. Step 1 (stable identity) is necessary but **not sufficient**
for this test; it is unblocked by the R2 frame-merge (Step 2), where the per-call
surface frame carries params+body-decls in one chain so every `.table-hover` instance
sees params regardless of which instance the closure captures.

## Root causes (ordered by how much they block the goal)
- **R1 — transient/duplicate frames.** `getScopeFrame` caches in `_scopeFrame` but it
  gets cleared/rebuilt, and canonical vs per-call surfaces each build their own frame
  for the "same" scope. Re-points don't persist; closures capture one instance,
  resolution walks another. This is why even a *correct* frame-attach fails.
- **R2 — the split.** Params and body-decls live on different frames (per-call surface
  vs Mixin.sourceNode wrapper) that never merge into one chain.
- **R3 — the fallback.** `!declarationsCovered` frames force `direct-rules-lookup`,
  which drops the owner frame (T) entirely.

## Migration steps (each independently testable; measured against base.fails)

**Step 1 — Make frame identity stable (fixes R1). PREREQUISITE for everything.**
Design chosen on the "most performant is king" rule = fewest allocations:
- `buildScopeFrame` re-allocates `declarationBucketsByName` (+ its currentBindings
  from decls) on EVERY call. That index is immutable and identical across every
  surface of a given canonical Rules. **Cache it on the canonical Rules and share it**
  (one build per canonical Rules, ever).
- A frame becomes a THIN per-placement layer over the shared index: its own `parent`,
  its own `liveSlotsByName`, and a small `currentBindings` overlay (live slots shadow
  decls). Deriving/placing a surface allocates only this thin layer, not a new index.
- **Re-points mutate the thin layer's `parent` and are durable** — the shared index is
  never rebuilt, and the thin layer is not cleared/rebuilt behind a live re-point.
- Concretely: (a) split `ScopeFrame` so `declarationBucketsByName` is a shared ref
  (memoized on the Rules); (b) rewrite the ~15 `scopeFrame = buildScopeFrame(...)` /
  `= undefined` sites to allocate/refresh only the thin layer, reusing the shared
  index; (c) the derive path (rules.ts:1005-1019) reuses the shared index + keeps the
  re-pointed parent instead of `declarationsCovered=false` rebuild.
- Exit test: (perf) allocation count for frame build drops (fewer Map allocations —
  measure via the existing ratio guard); (correctness) suite delta ≤ 0. NOTE: the 4th
  detached-closure test (`mixin.test.ts` nested-in-child-ruleset) does NOT pass at
  Step 1 — instrumentation (see "The actual failure") proved it is an R2 manifestation
  (two distinct `.table-hover` instances; the detached ruleset is parented to the
  canonical one whose frame never chains to the per-call params). It is a Step 2 exit
  criterion, not Step 1.
- Progress: Step 1a landed (`306f2014c`) — `buildScopeFrame` now shares `varsByName`
  by reference as `declarationBucketsByName` instead of copying it per build (one fewer
  Map alloc + full copy per frame; registration sites already keep the shared index in
  sync). Behavior-neutral: suite 102 → 102, zero regressions. Steps 1b/1c (durable
  thin-layer re-points; derive-path reuse) remain.

**Step 2 — Collapse the mixin two-frame split into one per-call frame (fixes R2).**
- With Step 1 done, build `rules.scopeFrame` = body declaration index + liveSlots,
  parent = lexicalScopeFrame (the earlier naive attempt, now safe because the
  duplicate canonical wrapper frame no longer independently exists — see Step 2b).
- Step 2a: stop `Mixin` setting `sourceNode = value.rules` and re-parenting body
  children to the wrapper (mixin.ts L131-141). Body children parent to the Mixin
  canonically (childKeys). The Mixin's own frame becomes the single body frame.
- Step 2b: drop the `!isNode(enclosingScope, N.Mixin)` WART guard (rules.ts L5967)
  once the wrapper is gone.
- Exit test: mixin suite delta = 0 vs pre-step (the 27-regression trap is avoided
  because there is no longer a duplicate decl frame). Frame dump shows one frame with
  params+decls. **AND** the 4th detached-closure test (`mixin.test.ts` "resolves local
  mixin body variable inside a detached ruleset when call is nested in a child ruleset")
  passes — with params+decls in one chain, every `.table-hover` instance (re-pointed
  per-eval OR canonical-body-parented closure target) chains to the per-call params, so
  the detached ruleset's `@background` resolves regardless of which instance it captured.

**Step 3 — Eliminate the direct-rules-lookup fallback (fixes R3, "one system").**
- Make scope-frame declaration coverage complete so `!declarationsCovered` never
  arises for a real scope: every scope's frame indexes its declarations.
- Remove the fallback branch at reference.ts ~L970 (and the `findVariable/Property
  DeclarationOccurrence` callers), OR route them through the frame path so they carry
  the owner frame.
- Exit test: grep shows no live `findVariableDeclarationOccurrence` /
  `findPropertyDeclarationOccurrence` fallback call in the variable resolver; suite
  delta = 0.

**Step 4 — Fold `_passedRulesWrapper` (Ruleset/If/For/While) the same way** as the
Mixin wrapper (Step 2a generalized). Task #11.

## Ordering rationale
R1 first because it's WHY correct fixes (frame-attach, closure capture) silently fail —
without stable frame identity, Steps 2-4 will thrash exactly like the naive attempt did
(27 regressions were the duplicate-frame symptom of skipping R1). Steps 2→3→4 remove the
duplicate structures once identity is stable.
