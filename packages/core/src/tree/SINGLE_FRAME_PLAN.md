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

### 2026-07-02 (RESOLVED) — Step 2 landed, nested detached-closure test GREEN, suite delta −1
Commits: `d589bfc8c` (frame merge) → `bda707fd0` (wrapper + WART removal) → `f35fdd575`
(instanceof-Rules + closure re-point) → `8fc01a16b` (rewrite 3 old-model tests). Full
suite **101 fails vs 102 baseline (delta −1, zero regressions)**. Two fixes were needed
on top of the merge + wrapper removal:
1. **`instanceof Rules`** at the callable-path sourceNode checks (§4 re-point,
   `sourceRulesOf`, `getRootSourceRules`, `resolveCallableSingleOutputSourceRules`) — see
   the ripple analysis below. Without it the §4 re-point silently stopped firing for
   every mixin surface (its sourceNode is now a Mixin, not a plain Rules).
2. **Detached-ruleset closure re-point.** A Rules passed as an arg is eagerly evaluated
   at arg-binding (`callable-args.ts`); its free vars must resolve up the surface where it
   was WRITTEN (the re-pointed placement scope carrying params), not its canonical
   `.parent`. Capture `_closureScope = context.rulesContext` BEFORE `arg.eval` (was after —
   too late for the eager body eval), and add a `_evalPreparedRules` branch: when
   `rules === this && rules._closureScope`, re-point the frame parent to
   `_closureScope.getScopeFrame()`. This is the general Phase-C detached-closure mechanism.
The old two-instance symptom (a second canonical `.table-hover` built during the lazy
lookup) is moot once the reader chains to the re-pointed closure surface.

### 2026-07-02 (cont.) — the wrapper-removal ripple: `isNode(sourceNode, N.Rules)` misses Mixin
**Root cause of the +3 regressions AND why the §4 re-point silently stopped firing for
mixin surfaces after Step 2a.** `N.Mixin` (1<<20), `N.Rules` (1<<23) and `N.Ruleset`
(1<<25) are DISTINCT nodeType bits — `isNode(mixinNode, N.Rules)` is FALSE. Before Step 2a
a mixin's per-call surface had `sourceNode = value.rules` (a PLAIN Rules wrapper), so every
`isNode(surface.sourceNode, N.Rules)` check passed. After eliminating the wrapper,
`createCallableRulesSurface` sets `output.sourceNode = Mixin` (the canonical body IS the
Mixin) — so those checks now return FALSE and the surface is no longer recognized as a thin
surface over a canonical body. Concretely the §4 re-point condition
`isNode(enclosingScope.sourceNode, N.Rules)` fails → `.table-hover` (and every mixin-body
child) stops chaining to the per-call surface #1 → free vars/params invisible.

**Fix (applied, UNVERIFIED — pending Bash/classifier recovery):** a canonical body can be
any Rules SUBCLASS, so replace the bitmask check with `instanceof Rules` at the sourceNode
sites on the callable path:
- `rules.ts` §4 re-point condition (`enclosingScope?.sourceNode instanceof Rules`)
- `rules.ts` `sourceRulesOf`
- `callable-surface.ts` `getRootSourceRules` (the sourceNode walk) + `resolveCallableSingleOutputSourceRules`
Other `isNode(sourceNode, N.Rules)` sites to audit if regressions persist: `import-style.ts:322,995`
(import boundary — likely still plain Rules), `direct-rules-lookup.ts:150` (checks N.Ruleset, different intent).
Test rewrites (mixin.test.ts:7731 body.parent; the two recursive-namespace scope-frame tests
that manipulate the surface frame directly) are DEFERRED until this fix is verified, since the
re-point fix may change which of their assertions fail.

### 2026-07-02 progress + REFINED root cause of the 4th test (instrumented)
Landed on the worktree branch:
- `d589bfc8c` — **frame merge** (`callable-scope-frame.ts`): the per-call surface
  frame now carries BOTH body decls AND param live-slots in ONE frame
  (`rules.getScopeFrame(lexicalScopeFrame)` builds the decl index from shared
  children, then `setScopeFrameLiveBinding` overlays params). Behavior-neutral
  (102→102). Verified via `WIRE-frame surface keys=[hover-background,background]`.
- **(uncommitted, +3 old-semantics regressions)** — Step 2a wrapper removal
  (`mixin.ts`: drop `sourceNode = value.rules` + child re-parent to wrapper) and
  Step 2b WART-guard removal (`rules.ts` §4). The +3 are tests that assert the OLD
  wrapper shape (e.g. `mixin.test.ts:7731` expects the discarded body wrapper node
  `body.parent === node`); they must be REWRITTEN to the new model (wrapper gone;
  body children parent to the Mixin), not treated as real regressions.

**REFINED root cause (supersedes the Step-2 exit note above): the merge is NECESSARY
but STILL not sufficient, and the failure is NOT on the callable-invocation path.**
Instrumented facts for the 4th test:
- The per-call surface frame #1 = `[hover-background, background]` is built correctly.
- But the detached ruleset arg `{ background-color: @hover-background }` is **eagerly
  evaluated at arg-binding** (`callable-args.ts:30` `await arg.eval(context)`), in the
  `.table-hover` caller scope — BEFORE `.hover` is ever called (only ONE
  `prepareCallableCandidateState` fires, for the outer mixin; content never reaches it).
- That eager eval reads `@hover-background` → lazily evals its value `@background` →
  resolves on the frame the reader chains to, which is a `.table-hover` instance whose
  chain reaches the CANONICAL mixin body frame #2 `[hover-background]` (NO params), NOT
  the re-pointed per-call surface #1. Hence `'background' is not defined`.
- There are **two `.table-hover` node instances**: R#5 (eval'd via `_evalPreparedRules`,
  §4-re-pointed to surface #1) and a second canonical-parented one used for the arg eval,
  which was never re-pointed. The §4 re-point fixes R#5; the arg eval walks the other.
So the remaining blocker is R1-flavored (two instances / the arg-eval reader chains to
the un-re-pointed instance), inside the mixin-body nested-ruleset context. NEXT: pin the
construction site of the second `.table-hover` instance (it is NOT `derive()` — no
DERIVE/SET-FRAME fired — and NOT `writableOutput`), and make the arg eval (or the nested
ruleset) resolve through the re-pointed surface #1. Candidate fixes explored but found
INERT for this path (reverted): threading `_closureScope` into `prepareCallableCandidateState`
`definitionFrame`; gating `reference.ts:500` closure-set on `!cell.live`. They target the
callable-invocation path, which this test does not take.

**Step 3 — Eliminate the direct-rules-lookup fallback (fixes R3, "one system").**
- Make scope-frame declaration coverage complete so `!declarationsCovered` never
  arises for a real scope: every scope's frame indexes its declarations.
- Remove the fallback branch at reference.ts ~L970 (and the `findVariable/Property
  DeclarationOccurrence` callers), OR route them through the frame path so they carry
  the owner frame.
- Exit test: grep shows no live `findVariableDeclarationOccurrence` /
  `findPropertyDeclarationOccurrence` fallback call in the variable resolver; suite
  delta = 0.

### 2026-07-02 (Step 3) — MEASURED: the uncovered-fallback is now confined to `$while` loops
Instrumented the `uncovered` returns across the FULL suite (`performVariableRulesLookup`
→ `lookupScopeFrameVariable`). After Step 2 the `!declarationsCovered` fallback fires for
ONLY a handful of distinct shapes, all traced to their construction site:
- **`$while` loop surfaces** — `control.ts` `createWhileStateSurface` (L256) and
  `createWhileIterationSurface` (L262) build `buildScopeFrame(undefined, …)` (empty index,
  `declarationsCovered=false`) BY DESIGN: the state surface is a mutable live-binding overlay
  synced per iteration (`syncWhileState`), not the body's decl index. This is the deferred
  loop rework (loops still COPY per iteration; see control.ts TODO / live-binding-spec memory).
- **`pendingDecls`** — a frame with a still-dynamic-named VarDeclaration returns `uncovered`
  to signal "retry later." Legitimate mechanism, NOT fragmentation to remove.
- A `reference.test.ts` artifact that builds an uncovered frame directly.

**Conclusion: the main-path "two lookup systems" fragmentation (mixin / import / derive) was
ALREADY resolved by Step 2 — those frames are all covered now.** The residual fallback is
(a) the `$while` loop subsystem, which cannot be made covered without the loop rework
(body-decl registration moved to context/render time — the state surface is intentionally an
uncovered live overlay), and (b) the legitimate pending-decl retry. Fully deleting the
`findVariableDeclarationOccurrence` fallback ALSO can't happen yet because it still serves the
`hasTarget` (targeted `@ns[@x]`) and interpolated-variable paths, which the frame path does
not cover. So Step 3's "one system" end-state is BLOCKED on the loop rework (Step 4+) and a
targeted/interpolated frame-lookup path — deferred, not a quick win. A tried `resetDerivedState`
"build covered derived frame" change was reverted: behavior-neutral (the derive path produced
no uncovered-HIT frames) and it added an eager `getScopeFrame` per derive ("most performant is
king" → don't add speculative eager work).

**Step 4 — Fold `_passedRulesWrapper` (Ruleset/If/For/While) the same way** as the
Mixin wrapper (Step 2a generalized). Task #11.

### 2026-07-02 (Step 4) — Ruleset `_passedRulesWrapper` ELIMINATED (`aa2163763`)
Done for **Ruleset** (the If/For/While copies in `control.ts` stay — they are the
deferred loop subsystem). The Ruleset is now its own canonical body:
- constructor no longer records a factory-passed `rules([...])` wrapper; body children
  parent to the Ruleset via the `ruleset()` factory `parentChildren` (childKeys has
  `'rules'`). `parentChildren` drops the wrapper adopt+reparent; `_deriveShell` drops the
  copy; the field is gone.
- nil-selector render/eval build output from the Ruleset's OWN body
  (`createNilSelectorOutputRules`, which COPIES — matching the parser path, which never
  had a wrapper; sharing was tried and reverted because rendering the output surface
  adopts its children, which would reparent the canonical source mid-render).
- `callable-special-case` uses `getRootSourceRules(candidate)` (the Ruleset) as the
  callable source rules instead of the wrapper.
- +19 regressions, ALL from tests that used the passed `rules([...])` wrapper as a LIVE
  caller/body handle (an artificial setup the parser/factory never produces). Rewritten
  to the new model: operate on the Ruleset directly, or parent a nested Rules under root;
  body-parentage assertions moved from the wrapper to the node (`child.parent === node`,
  `node.rules === body.rules`). Final: suite 101, delta 0 (zero net regressions).

### 2026-07-02 (Loop subsystem) — ALL THREE STAGES DONE
(Stage 2 was initially deferred, then completed — see the Stage 2 note below, superseded.)
The `$if`/`$for`/`$while` loop subsystem (`control.ts`) was the last holdout — it owned
the remaining wrappers AND the last uncovered scopes (R3). Landed:
- **Stage 1 (`2c2c6f23a`)** — eliminated `If`/`For`/`While` `_passedRulesWrapper` (+
  `adoptRulesWrapper`), same as Ruleset/Mixin. Control nodes are their own body; children
  parent via the factory. 2 wrapper-model tests rewritten. Suite 101, delta 0.
- **Stage 3 (`cb8acbc01`)** — `createWhileStateSurface`/`createWhileIterationSurface` now
  build `declarationsCovered=true` frames (symmetric with `$for`). **This eliminated the
  LAST `!declarationsCovered` scope in production**: instrumenting the full suite, every
  remaining uncovered frame is built by ONE test (`reference.test.ts:509`) that
  deliberately exercises the fallback. So R3 is effectively closed — the
  `direct-rules-lookup` fallback is never hit for an uncovered *real* scope anymore (it
  still legitimately serves `hasTarget`/interpolated lookups, which is why the code stays).
  Also FIXED a real state-sync lag bug — a stateful `$while` now emits the correct final
  counter (tick 1,2,3 not 1,2,2).
- **Stage 2 (thin iteration surfaces) — DONE (`75a43fad3`, cleanup `f297d66a3`).**
  `$for`/`$if` now SHARE the canonical body children across iterations/branches (a true
  thin surface: `sourceNode` → the loop body; shared children re-point their scope frame
  via §4). Two mechanisms make it non-mutating:
  - `createDerivedIterationRulesSurface` shares via direct array push (no adopt), like
    `Rules.derive`, so shared children are never reparented to the ephemeral surface.
  - `ownControlBodyChildren` (constructor): the control node OWNS its body children
    (`child.parent === node`), so the reused-source-child guard in
    `_storePreparedRegistrationNode` skips re-adopting them (this also fixed a latent
    Stage-1 inconsistency where `new For`/`makeLoop` left children parented to the
    discarded `value.rules` wrapper).
  With sharing correct, `attachIterationFallbackFrame` became dead (the §4 re-point covers
  nested-ruleset scope) and was deleted.
  **`$while` deliberately COPIES per iteration (`share=false`)** — it carries mutable state
  ACROSS iterations (body reads+writes the same vars, e.g. `i=i+1` + `tick:@i`), so each
  iteration body MUST be isolated; sharing let a counter read a stale value (verified: the
  shared `@i` handle invalidated correctly but the self-referential vardecl still produced
  `1,1,1`). This is a principled split, not a limitation: `$for`/`$if` iterations are
  independent (safe to share); `$while` is stateful (needs isolation). Verified rendering
  the same loop twice is stable (no canonical mutation). Suite 100, delta -1 (one net fix).
  The **old blocker-2** ("shared children retain first eval result") is genuinely resolved
  by the `evaluated` deletion; the real blocker was #1 (bespoke eval adopting children),
  fixed by the share-without-adopt + `ownControlBodyChildren` combination above.

### 2026-07-02 — WHY `$while` can't share yet (deep-rework root cause, verified)
A focused attempt to make `$while` share too (self-referential counter `i:i+1` + `tick:@i`,
test `keeps native loop render aligned`) was made and reverted. Five approaches
(share-without-adopt; live-slots-on-iteration-frame; source-order eval-then-render;
per-iteration `runWithRulesContext`; and combinations) all left the counter reading `1,1,1`.
Root cause is NOT the loop layer — it's TWO in-place mutations in the eval core that assume
one-eval-per-node (safe for mixins/rulesets, each placement evaluated once; unsafe for a
SHARED body re-evaluated per iteration):
1. **`Declaration.materializeValueState` (declaration.ts ~1670)**: `this.adopt(state.value);
   this.value = state.value; return this` — caches the EVALUATED value on the node in place
   (the fast path, avoiding a copy). Iteration 1 sets the shared `tick`'s `value = Num(1)`;
   every later iteration renders the stale cached `1`. The copy-on-write path (`withParts`,
   ~1674) exists but is bypassed for deferred values for perf.
2. **`Reference._rulesLookupHandle`**: the cached lookup handle keys `targetRules` on
   `context.rulesContext` (reference.ts ~2217). `$while` runs the whole loop under one
   persistent `runWithRulesContext(stateRules)`, so a shared body's `@i` handle survives
   across iterations. (Rendering each iteration under its own rulesContext helps this one,
   but #1 remains.)
Making `$while` share requires making Declaration/Reference eval **copy-on-write for shared
re-evaluation** without a copy on the common single-eval path — a cross-cutting eval-core
change (related to task #18 "trivia loss on Declaration eval with variable-ref value"). High
risk, broad blast radius. The **copy-split ($while copies) is the correct solution**: it
isolates each iteration so the in-place mutations are per-iteration-safe, exactly as they are
per-placement-safe for mixins. Not a limitation — the right model for stateful iteration.

## Ordering rationale
R1 first because it's WHY correct fixes (frame-attach, closure capture) silently fail —
without stable frame identity, Steps 2-4 will thrash exactly like the naive attempt did
(27 regressions were the duplicate-frame symptom of skipping R1). Steps 2→3→4 remove the
duplicate structures once identity is stable.
