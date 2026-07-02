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
Verified with frame dumps:
- The §4 frame-attach (`_evalPreparedRules` L5954) **does fire** for a nested child
  ruleset `.th`: it re-points `.th.getScopeFrame().parent` to the enclosing per-call
  surface, whose frame DOES have both `background` (param) and `hover-background`.
- **But at the actual `background` lookup, `.th`'s frame chains to the canonical
  Mixin frame (no `background`), NOT the re-pointed frame.** → there are **two `.th`
  frame instances**; the re-point fixes one, resolution walks another. The re-point
  is **transient** (mutates a `_scopeFrame` that is later rebuilt / a different
  instance is used).

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
  measure via the existing ratio guard); (correctness) the nested-closure dump shows
  `.th` resolving `background` via the SAME frame that was re-pointed; the 4th
  detached-closure test passes WITHOUT touching the split; suite delta ≤ 0.

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
  params+decls.

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
