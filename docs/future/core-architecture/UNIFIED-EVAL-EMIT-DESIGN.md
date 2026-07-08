# Unified Eval-and-Emit — the settled single-pass architecture

**Status:** DESIGN / pure reasoning. NO wire-in, NO benchmark, NO production `.ts`. This document
SUPERSEDES and MERGES two priors into one coherent system:

- `EXTEND-GLOBAL-FLOW-DESIGN.md` — the extend global flow (PLAN / SOLVE / EMIT; scope = (A)
  reachability + (B) placement/visibility; OQ-5 folds into (B)).
- `SINGLE-RENDER-PASS-PLAN.md` — the eval→render fold (A0 provenance verdict; the **B1s REFUTATION**:
  a dynamic leaf's value is a function of the EVAL-MOMENT scope and cannot be re-resolved later from a
  discarded frame — the live frame must stay threaded through the pass).

It also absorbs the flag-walk endgame (`FLAG-WALK-DELETION.md` C4) as its tail and states plainly how
big that is and whether it lands incrementally or must be a coordinated cutover.

**Oracle stance — reason to the consistent end-shape; no expectation is sacred.** The target is the
COHERENT v5 output the language should produce, judged on internal consistency + intended v5
semantics. The working corpus is the v5 alpha `.less`→`.css` fixtures (`all-less` against the
`~/git/oss/less.js` **alpha** branch via `@less/test-data`, under BOTH `collapseNesting:true` and the
fixtures that set it false) plus the v5 unit tests — NEVER the `less-4x` tree, NEVER a 4.x match. But
this is in-development: any current `.css` / warning / unit expectation MAY be wrong. Where the
reasoned end-shape and an expectation agree, that expectation corroborates the design; where they
diverge, the EXPECTATION is the suspect — flagged as "looks wrong vs consistent shape Y because …"
for owner decision, not something the architecture contorts to match. Impl-detail tests (field types,
class shapes, return shapes, call counts, AST shape, "public" API surface) are NON-binding and are
expected to change.

**Owner rulings baked in (settled — not re-opened):**
1. One pass, no double-eval. Eval ONCE; serialize/emit as you go; swap live-bound references +
   computed values in DURING serialization; the live eval frame stays threaded through emit.
   **CANONICAL-MUTATION INVARIANT (LOOSENED, owner 2026-07-08 — supersedes every "never mutate the
   canonical source tree" / "you cannot mutate the shared canonical → always fresh" phrasing below,
   incl. §3 and §6 step 1):** you MAY mutate a canonical source-tree node in place, PROVIDED the
   mutation is output-invisible — i.e. it changes neither (a) the bytes produced by re-serializing that
   canonical node, nor (b) the output when that node is REUSED in another placement. In effect: the
   canonical node must stay correct-for-re-serialization and correct-for-reuse; anything invisible to
   those two (memoized projections, the cached IR/match-bitset, a cached composed-form/bucket-path,
   internal bookkeeping flags) is permitted ON the canonical node — no transient copy required for it.
   Only an OUTPUT-AFFECTING change (a different value/visibility/selector for a given placement) still
   demands a fresh transient shape. This shrinks the "fresh transient" set to genuinely
   output-differing nodes and lets output-invisible caches live on the shared node.
2. Kill the per-call `extendSelector` node→node API. Extend is a PLAN executed fast inside the pass.
3. `&`-crossing folds into EMIT (one system, not a pre-apply side-channel).
4. OQ-5 folds into (B) placement; no third axis, no stored own-selector field. The extender's
   contribution is its COMPOSED selector.
5. **EMIT is a per-node inline pipeline carrying a FIRST-CLASS GENERIC VISITOR (owner-resolved, §6):**
   per node — produce shape (reuse canonical untouched if unchanged; fresh transient only if eval
   changed it) → invoke registered visitors inline on that node (a generic `(node, ctx) => Node | void`
   hook owned by `@jesscss/core`, Less-agnostic; less-compat is just ONE downstream consumer, §6.7) →
   serialize immediately → release. The node intermediate survives only TRANSIENTLY and LOCALLY at each
   emit position, never as a persistent output tree, never as a separate visitor or serialize pass. The
   pass IS the traversal, so a visitor needs no traversal of its own — this is what lets the whole-tree
   `Visitor`/`TreeVisitor` framework and the `preSerializeRoot` seam collapse to a per-node hook.
6. Bookkeeping minimal — per-branch (B) annotations + carried provenance obey the ≤5 class-unique
   field budget (`CORE-CLEANUP.md`).
7. **No test expectation is sacred.** This is in-development v5; any current `.css` / warning / unit
   expectation may itself be wrong. The architecture is judged on INTERNAL CONSISTENCY + the intended
   v5 semantics — the CONSISTENT END SHAPE we are building toward — NOT on byte-matching a snapshot
   that may be stale. Where the reasoned end-shape and an existing expectation AGREE, good. Where they
   DIVERGE, the expectation is the suspect: call it out ("expectation X looks wrong vs consistent
   shape Y because …") for owner decision; do NOT contort the architecture to match a possibly-wrong
   fixture. NOT a 4.x match under any circumstance. Warnings/errors are a v5-NATIVE format (structured
   on `result.warnings`); the design fixes only WHERE they are produced, not their exact text.

---

## 0. The one load-bearing realization that unifies both docs

The two priors were solving the SAME problem from opposite ends, and neither could close alone:

- The extend doc concluded (B) placement/visibility is **not recoverable from the output string** —
  it must be carried as explicit per-branch STATE through the flow and realized at emit.
- The single-render-pass doc concluded (B1s) a dynamic leaf's value is **not recoverable from the
  output placement** — its value is a function of the eval-moment scope, which today is discarded.

Both are the same shape: **the thing serialize needs was decided during eval and thrown away.** The
unification is therefore a single principle:

> **Emit descends the SOURCE tree while the live eval frame stack is still on the stack.**
> Nothing is materialized into a second "output tree" that emit then re-walks. Eval and emit are
> ONE downward traversal: at each node, resolve-against-the-current-frame and write-to-buffer happen
> together, so both the value scope (B1s) and the placement/provenance state (extend (B)) are read
> at the exact moment they are known, not reconstructed afterward.

Everything below is the consequence of taking that principle literally.

---

## 1. What the pass IS (structure)

```
render(root)  ──►  ONE downward traversal of the SOURCE tree
                   │
                   │  carries a UNIFIED WALK STATE (§2):
                   │    · value-frame stack   (scope-frame chain — the B1s fix)
                   │    · structural-frame stack (ruleset/at-rule ancestry, composedSelectorStack)
                   │    · the document EXTEND MODEL (PLAN result + live SOLVE state)
                   │    · the output buffer/writer
                   │
                   ├─ at a Rules/Ruleset enter:  push value-frame + structural-frame;
                   │                              compose header selector from the stack;
                   │                              seed reachable extend work for its subject branches
                   ├─ at a Declaration/leaf:      resolve value AGAINST THE CURRENT VALUE-FRAME;
                   │                              produce shape (canonical if unchanged, else fresh
                   │                              transient) → run visitors inline (§6) → write bytes
                   │                              (+ sourcemap origin) → release
                   ├─ at an at-rule:              hoist decision from structural stack (already relocated)
                   ├─ at a mixin/loop/$for/$if:   bind params/counter into a NEW value-frame,
                   │                              descend the SHARED body under it (no copy)
                   └─ extend contributions:       projected at the target's emit position from the
                                                  live extend model (§4), composed via the structural
                                                  stack — never a pre-apply node rewrite
```

There is no `eval()` phase that returns a materialized `state.output` tree for a separate `serialize()`
to walk. `Rules.render`'s current shape (`rules.ts:4737` `evalForRender` → `this.eval(context)` →
`serialize(state)`) is **two walks behind one entry**; the unified pass collapses them to one walk.

### 1.1 Why this is one system, not eval-plus-serialize

Today three things already run on the serialize walk (banked, `FLAG-WALK-DELETION` Phase D):
selector composition (Slice 4 — `composeSelector` reads `options.composedSelectorStack`), root
at-rule hoisting (Slices 1/3), and the collapse/`:is()` reshape (`serialize-helper.ts`). What is
STILL on the separate eval walk is exactly two things: **value materialization** (a dynamic leaf is
evaluated into an output node that serialize reads) and **extend gathering/apply** (`processExtends`
at walk-end off gathered roots). The unified pass moves those two onto the same walk, at which point
"eval" and "serialize" are no longer distinguishable phases — there is one traversal that resolves
and emits.

---

## 2. Frame threading — the crux (spelled out)

This is the mechanism the whole architecture turns on. It is the concrete answer to the B1s
refutation.

### 2.1 There are TWO distinct frame stacks, and today only one survives to emit

| stack | what it carries | today's lifetime |
|---|---|---|
| **structural-frame** | ruleset/at-rule ancestry, `composedSelectorStack`, `inFrames`/`treeFrames` (`print.ts:11-15,75-78`) | **already threaded through serialize** (in `PrintOptions`) |
| **value-frame** | the `ScopeFrame` chain: `currentBindingsByName` live cells, `declarationBucketsByName`, `pendingDeclarationNames`, the **call-site lexical chain (NOT the `.parent` chain)** (`scope-frame.ts:1-49`) | **built during eval, discarded before serialize** |

The B1s failure was trying to re-derive value-frame answers from the structural stack (the output
placement). It cannot work: `scope.less` lazy shadowing, `mixins-closure` capture, `mixins-guards`
guard-selected bindings, `$while` counters — all live in the value-frame, and a `Reference`'s
`.parent` is empty even during eval (it resolves via `context.rulesContext` + captured scope). The
placement frame is a DIFFERENT frame from the resolving frame.

### 2.2 The fix: the value-frame stack lives for the WHOLE pass, pushed/popped by the walk

The unified walk owns BOTH stacks and threads them together:

- **Enter a Rules/Ruleset:** push a value-frame (built from that scope's `varsByName` /
  `declarationBucketsByName`, parented to the current frame per the **lexical call-site chain**, not
  `.parent`) AND push the structural-frame. Both live on the walk state for the duration of that
  subtree.
- **Enter a mixin/loop/`$for`/`$if` body:** push a value-frame carrying the bound params / loop
  counter as live `BindingCell`s (`scope-frame.ts:31-49`), then descend the **shared** source body
  under it. The body is never copied — the per-placement difference is entirely in the pushed
  value-frame's cells. This is the always-share invariant realized: `$for`/`$if` already share the
  body via `createIterationEvalSurface(share=true)`; the unified pass makes that the ONLY mechanism.
- **Reach a leaf (Reference/Call/Operation/dynamic Declaration value):** resolve it against the
  CURRENT value-frame (top of stack) and write the resolved bytes to the buffer immediately, with
  the source node as the sourcemap origin. Because the frame is the SAME one eval would have used
  (it was pushed on the way down, not reconstructed on the way back), the value is correct by
  construction — no re-resolution, no shadowing/closure/guard divergence.

The key difference from B1s: B1s tried to re-enter the resolving frame *after* eval had popped it.
The unified pass **never pops it until the subtree is fully emitted** — resolve-and-emit are the
same downward step, so the frame is never gone when the leaf needs it.

### 2.3 Lifetime and what the stack carries — concretely

- The value-frame stack is a push-down whose depth = current source-tree nesting depth of scopes.
  Frames are pushed on scope enter, popped on scope exit — standard lexical discipline, but exit is
  **after** that scope's bytes are in the buffer, not after a separate eval phase.
- Live cells (`BindingCell.value`, updated in place for `$while` counters and mixin params —
  `scope-frame.ts:31-49`) mutate WITHIN their frame's lifetime and are read at leaf-emit within that
  same lifetime. `$while`'s cross-iteration `i = i+1` is a live-cell write inside one frame that is
  re-read each iteration — no per-iteration body copy needed, because each iteration's leaf reads the
  cell's current value at its emit moment.
- The frame carries NO output nodes. It carries bindings (names → cells) and the lexical parent
  link. A leaf's value is `resolve(sourceLeaf, currentFrame)` → bytes, never a retained node.
- Mixin closure capture (`mixins-closure`: a mixin defined in scope X, called in scope Y, whose body
  reads a var from X) is expressed as the pushed body-frame's **lexical parent = the definition-site
  frame**, not the call-site's `.parent`. This is already the ScopeFrame model (`scope-frame.ts:14`
  "the call-site lexical chain, not the node `.parent` chain") — the unified pass keeps that chain
  live through emit rather than snapshotting a value out of it.

### 2.4 Provenance (span + flags) under the threaded frame — A0 resolved

`SINGLE-RENDER-PASS` A0 already proved the split:

- **Span** (read at ~40 `writer.add(text, this)` sites, `print.ts:198`→`spanStartOf`) evaporates for
  the shared-leaf case the moment emit descends the SOURCE tree: the leaf's span is simply its
  authored span, read off the source node the walk is standing on. The span mutation in `inherit`
  (`node-base.ts:1483`) exists today ONLY because eval produced a derived output node that had to
  carry the source span back. No derived node ⇒ no span carry-back.
- **Flags** (`F_VISIBLE`/`F_EXTENDED`/`F_EXTEND_TARGET`/`F_GENERATED`/`F_IMPLICIT_AMPERSAND`) cluster
  at a ~20-site / 3-file set (`serialize-helper.ts` visibility gating; `ruleset.ts` /
  `selector-list.ts` extend/reference filtering). A0 proved these are **position-derivable** (0
  inconsistent (node,flag) pairs across 10 workloads) EXCEPT `F_EXTENDED`/`F_EXTEND_TARGET` in the
  extend multi-placement fan-out, which ride distinct intrinsic extend-contribution branches (§4) —
  so the unified pass keys those flags on the **branch**, not the source node. Everything else is a
  deterministic-per-node value the walk reads off the source node it is standing on.

**Net:** with the frame threaded and emit descending the source tree, `inherit`'s per-node mutation
(the whole reason copies survive today) is not relocated — it is **eliminated**, because there is no
derived output node to stamp. The residual provenance is (a) source-node facts read in place, and
(b) per-branch extend flags carried by the extend model (§4), never on the shared source node.

---

## 3. No-canonical-mutation + body reuse (the always-share invariant, discharged)

`FLAG-WALK-DELETION` STEP-0 established deep value-tree copies are already ZERO; the single ROOT
blocker is `adopt`→`setParent` (`node-base.ts:686-696`), which reparents a NON-frozen source child
when it is placed into a new surface, corrupting the shared tree — so today's residual shallow clones
exist to hand `adopt` a FROZEN node it will skip reparenting.

Under the unified pass this blocker dissolves for the same reason span does:

- Placement no longer builds a new surface that must `adopt` the source child. The walk descends the
  shared body directly under a pushed value-frame; the "placement context" (which frame, which
  composed selector) is the walk state, not the child's `.parent`. A node's `.parent` stays its
  canonical authored parent forever.
- Selector composition, operation operands, ampersand/extend materialization, and collapse-survivor
  — the four clone families STEP-0 named — all exist to give a placed node a private parent pointer
  or private flags. With parenting routed through the frame/walk state and flags routed through the
  extend model, none of them needs a copy. B0/B1/B2/B2-pre already proved the pattern (share the
  source child, context from `_sourceRoot`/frame, never `.parent`); the unified pass generalizes it
  to every placement.
- **Genuinely-not-copies stay:** `$while` cross-iteration counter state (a live cell, not a copy —
  §2.3) and `+:` decl-merge (`deriveWithParts` — constructs a NEW combined value, not a placement
  copy). These are unaffected.

So mixin/loop/`$for`/`$if` bodies stay shared and reusable; per-placement values differ purely by the
pushed value-frame. This is the thing copies exist for today, resolved by the threaded frame.

---

## 4. Extend inside the ONE pass (PLAN / SOLVE / EMIT, folded into the traversal)

The extend doc's three-phase system is preserved but is no longer a separate document-level pipeline
bolted onto eval — it is woven into the single traversal.

### 4.1 PLAN — precompute before the traversal (unchanged, low-risk)

Once, up front (this is the part of today's `extend-roots.ts` that survives structurally):

- Build the **reachability relation** `reach(instrBucket, subjectBucket)` — the transitive closure
  over the extend-root graph (`getVisibleRoots`/`isSameOrDescendant`, already cached). This is scope
  dimension (A): A1–A8. Reference/import-scope (A6) is a per-instruction flag gating warning +
  visibility.
- Build the **target index** — instructions grouped by find-target into `(extendWith, mode)` buckets
  (Set-Trie / automaton), one match fires the whole same-target bucket.

PLAN is pure precompute over the source tree's extend-root structure and the instruction list. It
reproduces (A) exactly and needs no frame.

### 4.2 SOLVE — one global fixpoint, driven by the traversal

The SOLVE worklist from the extend doc is retained verbatim in its logic: ONE global worklist over
`(subjectBranch, instruction)` partitioned by reachability bucket, sharing the one target index; fire
runs the (C) match/rewrite black box; a produced branch is re-routed to the index (cross-selector
transitive closure); `&`-hoist is a live re-bucketing event; fire-once is keyed on branch identity;
termination is by value-dedup + fire-once bound; confluence is guaranteed because EMIT sorts by
document `order`.

What changes vs the prior doc: **SOLVE is seeded and drained AS THE TRAVERSAL DESCENDS**, not as a
walk-end pass off gathered roots. When the walk enters a Ruleset, its subject branches (composed from
the live structural stack) are routed to the target index and reachable work is enqueued. Because
composition is already on the walk (Slice 4) and the structural stack is live, the composed subject
form is available exactly when needed. The fixpoint still reaches global closure before any subject's
final branch set is EMITted — so a subject whose branches gain an extend contribution from a
LATER-visited selector must have its emit deferred until the fixpoint settles. **The exact deferral /
flush discipline this induces — what is buffered vs streamed, the baseline flush-at-end-of-descent, and
the sound early-flush predicate that reclaims scope-closed subjects mid-document — is settled in §4.4
(OQ-B).**

**This is the one real tension the unification introduces (see OQ-A):** extend closure is a
document-global fixpoint, but the value-frame threading is a strictly downward, push/pop-as-you-go
discipline. A subject's extend contributions may come from selectors visited later in document order,
so its final selector list is not known at the moment the walk first reaches it. The reconciliation:
**extend operates on selectors (structural), which do NOT depend on the value-frame** — a selector's
composed form is fixed by the structural stack, independent of any dynamic value. So SOLVE can run to
closure over the structural/selector layer while value-frames are threaded independently for leaf
values. The two layers are decoupled: extend closure is a selector-graph fixpoint; value resolution
is a per-leaf frame lookup. EMIT interleaves them (§4.3). This decoupling is what makes "one pass"
honest rather than a claim that hides a second traversal.

### 4.3 EMIT — project (B) + composed contribution at each subject's position

At a subject's emit position, its final `Or`-branch set (post-SOLVE) is projected to output. *WHEN a
subject's header reaches its emit position — the flush timing that reconciles this projection with the
downward pass — is §4.4 (OQ-B, settled); the projection rules below describe WHAT is written once that
position is reached.*

- `placement=root` → hoisted branches emit into the root selector list; `this-level` into the nested
  form (B1). Crossing folds in here (ruling 3) — it is just a `placement=root` branch, not a
  pre-apply side-channel.
- `origin` → `F_EXTENDED`/`F_EXTEND_TARGET`/neither drives the reference-compose filter UNCHANGED
  (B2). These are the per-branch flags A0 flagged as the one placement-varying case — they live on
  the branch, never on the shared source selector.
- `order` → sort OR-branches by document order (B3).
- `visible` → reference-keep (B2); `generated` → `:is()` unwrap (B4).

**OQ-5 (own vs composed) resolves to (a) — folds into (B) placement, NO new field.** The extender's
contribution is its COMPOSED form, derived at fire time by composing its authored fragment along its
bucket path relative to the target — exactly `composeExtendWithRelativeToTarget`
(`extend-roots.ts:257`) / `getFullComposedForm` (`:320`), which the unified pass feeds from the LIVE
`composedSelectorStack` instead of re-walking `.parent` (the flagged perf follow-up). C5–C8 (the
currently-wrong nested-extender cases) become correct because EMIT composes the contribution from the
structural stack the walk already carries. The `ownSelector`/`analyzeNonPartialExtends` cascade
(`extend-roots.ts:972-1089`) DISAPPEARS — it was the entangled re-derivation of exactly this.

### 4.4 Flush discipline — when a subject's rule-header may be written (OQ-B, SETTLED)

This settles OQ-B concretely: given that extend is a document-global fixpoint (§4.2) but emit is a
downward streaming pass (§2), **when can a subject's rule-header (its composed selector list) be
flushed to output?** The answer has five parts: the value/header split at flush, the provably-correct
baseline, the exact early-flush predicate + its soundness proof, the buffer-vs-patch decision, and the
canonical-cache interaction.

#### 4.4.1 What is buffered vs streamed — the value/selector split

A subject ruleset emits as `HEADER { DECLS }`. The two parts have opposite dependencies:

- **DECLS are resolved and streamed as bytes, into a per-subject buffer, DURING the descent.** A
  declaration's value is a function of the eval-moment value-frame (§2.2 B1s) — it is resolved against
  the LIVE frame at the instant the walk stands on the leaf, and the resolved **bytes** are appended to
  the subject's buffer. By flush time the value-frame is already popped; that is fine, because the
  buffer holds resolved bytes, not deferred value work. There is no "re-resolve at flush" — the frame
  was consumed on the way down. This is the whole point of §2: value resolution never waits for the
  fixpoint.
- **The HEADER (composed selector list) is the ONLY thing deferred.** It cannot be resolved against a
  frame — it is a function of the structural stack (fixed on descent, §4.2) PLUS the extend
  contributions the subject's branches gain during SOLVE. A subject's branch set is not final until
  every instruction that can reach it has fired and the transitive closure over its reachable set has
  settled (§4.2). Because output order puts the header BEFORE its decls, and the header is not yet
  final while the decls already are, the decls cannot go straight to the final output stream — they
  would land under a header that is still a hole. So the per-subject buffer holds `[header-slot,
  resolved-decl-bytes…]`: decls are byte-final immediately, the header slot is filled at flush.

Precisely: **buffered = the header slot (deferred) + the already-resolved decl bytes (parked, not
deferred). Streamed to final output = nothing for this subject until its header is final; then the
whole buffer (header text ++ parked decl bytes) is spliced into the output stream in document order.**
The decls are byte-complete before the header; they wait only because they follow a not-yet-final
header in output order, not because any value work remains.

Nested subjects: a child ruleset's buffer is itself a decl-region entry of its parent's buffer (the
buffer is a tree mirroring source nesting, not a flat list), so a child header that finalizes later
than its parent's decls is naturally expressed — the parent's buffer just contains a not-yet-final
child sub-buffer among its byte-final own decls.

#### 4.4.2 Baseline discipline — flush-at-end-of-descent (provably correct)

**Baseline: buffer every subject through the whole descent; after the descent completes, flush all
per-subject buffers in document order.** Correctness is immediate from §4.2:

1. After the full downward descent, EVERY `:extend` instruction in the document has been gathered
   (PLAN enumerates them up front; SOLVE has seen every subject branch, since every ruleset was
   entered).
2. PLAN is complete and SOLVE has run to global closure — the fixpoint has settled (§2.5 termination:
   value-dedup + fire-once bound). No further branch can appear for any subject.
3. Therefore every subject's final `Or`-branch set is FIXED. Composing each subject's header from its
   settled branch set (§4.3) and splicing `[header ++ parked decls]` in document order (B3's
   `order`-sort is exactly this splice) yields the correct output.

One eval descent + one flush. **Memory cost: the ENTIRE output is buffered until the fixpoint settles**
— every subject's resolved decl bytes + header slot are retained from the moment the subject is
entered until end-of-descent flush. For a large file this is O(output size) resident. This baseline is
always correct and is the fallback for any subject the early-flush predicate below cannot discharge.

#### 4.4.3 Early-flush — the exact predicate + soundness proof

**Goal:** flush a subject's buffer (and reclaim its memory) as soon as its branch set is provably
FINAL, without waiting for end-of-descent.

**When is a subject S closed?** S's branch set can only grow from (§4.2):
- (i) instructions that can REACH S — i.e. instructions whose bucket `reach(instrBucket, bucket(S))`
  holds (A1–A8), AND
- (ii) transitively, contributions from branches those instructions produce that then themselves reach
  S (the cross-selector closure, §2.3), AND
- (iii) `&`-hoist re-bucketing (§2.4), which can move a branch into the ROOT bucket mid-fixpoint and
  thereby make it reachable to root-bucket instructions.

So S is closed once: **(a) every instruction whose bucket can reach `bucket(S)` has been
gathered-and-fired against S, and (b) the transitive closure over S's reachable set has settled, and
(c) no future re-bucketing event can create a new instruction↔S edge.**

**Reduction to a document-structural condition.** The reachability graph's edge direction is the lever.
From `extend-roots.ts`:

- **A2 (root-can-reach-IN) / A3 (inner-cannot-reach-OUT):** `isSameOrDescendantRoot`
  (`extend-roots.ts:555-580`) walks ONLY the `childrenRoots` edges — an extend root reaches its OWN
  root (A1, `:624`) and DESCENDANT roots (A2, `:627`→`:555`), and NEVER ancestor roots (A3, the
  child-edge direction). `isInstructionVisibleForRoot` (`:605-637`) gates exactly on this: an
  instruction is visible for a subject's root iff the instruction's `extendRoot` is the subject's root
  (`:624`), is a same-or-descendant relationship (`:627`), or the subject's root is in the
  instruction's transitive visible set (`:633`→`getVisibleRoots:508`).

  Consequence: an instruction authored in root R can only reach subjects in R and R's descendant roots.
  A subject S in root R therefore can only be reached by instructions authored in R or in an ANCESTOR
  root of R. **Once the walk has fully descended and exited a root R (all of R's subtree is behind us),
  no not-yet-visited node can author an instruction in R or an ancestor of R that reaches back into
  R's already-closed subtree** — the not-yet-visited nodes are, by document order + the tree structure,
  either later siblings/descendants (which are in R's descendants or in disjoint sibling roots — A3
  says a disjoint sibling root's instructions do NOT reach into R) or are re-entries the single
  downward walk does not make. So:

  > **SCOPE-CLOSE PREDICATE (base case).** A subject S in root R is closed when the walk has fully
  > descended and exited R AND every ANCESTOR root of R has also been fully descended past the point
  > where it could still author an instruction reaching into R. Concretely: S is closed at the moment
  > the LAST of {R, all ancestor roots of R} finishes emitting the region from which an R-reaching
  > instruction could be authored.

  For the common case — a subject at the ROOT document scope, or a subject whose only reaching roots
  are already fully descended — S closes exactly when its own root closes, because a root's own
  `:extend` instructions are all gathered by the time the root's subtree is exited.

- **The transitive closure (ii) stays WITHIN S's reachable set.** A branch B′ produced against S is
  itself routed to the index (§2.3); it can only gain further contributions from instructions that
  reach `bucket(B′)`. If `bucket(B′) = bucket(S)` (the common case: a local rewrite keeps the branch in
  S's own root), the same reaching-set bounds it, so closing S's reaching roots closes the closure. The
  ONE exception is (iii).

**The hard cases — pinned to end-of-descent:**

1. **Root-scoped / global-reaching extends.** An instruction whose `extendRoot` is the document root
   reaches EVERY subject (A2/A8: root is same-or-ancestor of all). Such an instruction can be authored
   ANYWHERE in the document (a `:extend` at the bottom of the file whose extend root is the document
   root). Therefore NO subject can be declared closed before the document-root scope itself is fully
   descended — a later root-reaching instruction could still fire against it. **Any subject reachable
   by a root-bucket instruction is pinned to end-of-descent** unless PLAN can prove the document root
   authors no further reaching instruction after the subject's position (see 4.4.4). Since PLAN
   enumerates all instructions up front, this IS decidable: see the strengthened predicate below.

2. **`&`-hoist re-bucketing mid-fixpoint (§2.4).** A crossing rewrite moves a branch to the root bucket
   and enqueues it against root-bucket instructions. This can happen while S is being solved. A subject
   whose branches can be hoisted (it or a descendant has a crossing extend) must not early-flush until
   the root bucket's instruction set is closed — i.e. it inherits case 1's pin. Detectable in PLAN: a
   subject is hoist-exposed iff some reachable instruction is a crossing (parent+child-spanning) match
   against it.

3. **Transitive closure crossing scopes.** If a produced branch B′ re-buckets (case 2) or is composed
   into a bucket other than S's own, closing S's own root no longer bounds it — it inherits the
   reaching-set of B′'s new bucket. Pinned to end-of-descent whenever B′'s bucket ⊋ S's original
   reaching set.

**Strengthened (PLAN-exact) early-flush predicate.** Because PLAN enumerates every instruction and its
`extendRoot` up front, "has every reaching instruction been gathered" is decidable precisely rather
than conservatively:

> **EARLY-FLUSH(S).** Let `Reaching(S) = { instr : isInstructionVisibleForRoot(root(S), instr) }`
> (the A1–A8 set, computed by PLAN). S may flush at the moment the walk reaches document position `p`
> iff:
> 1. every `instr ∈ Reaching(S)` is authored at a document position `≤ p` (all reaching instructions
>    already gathered-and-fired — PLAN gives each instruction's authored position), AND
> 2. the transitive closure over S's branches has settled with no branch having re-bucketed OUTSIDE
>    `Reaching(S)` (no §2.4 hoist to a bucket with un-gathered instructions; no §2.3 cross-scope
>    escape), AND
> 3. no instruction in `Reaching(S)` is a crossing match against S that remains un-fired.
>
> Equivalently, in structural terms: **S early-flushes when the maximum authored position over
> `Reaching(S)` is behind the walk AND S is not hoist-exposed to an un-closed root bucket.**

**Soundness (never flush a subject a later instruction would still change).** Suppose S flushes at `p`
under EARLY-FLUSH(S) but some later instruction `I` (authored at `q > p`) changes S's branch set. `I`
changing S means `I` fires against some branch of S, which requires `reach(bucket(I), bucket(S'))` for
some current branch S′ of S. Two cases:
- `bucket(S′) ∈ Reaching(S)` (S′ is in S's original reachable set): then `I ∈ Reaching(S)` by
  definition, so condition (1) required `q ≤ p` — contradicting `q > p`. ∎
- `bucket(S′) ∉ Reaching(S)` (S′ re-bucketed): then a hoist/cross-scope event moved S′ outside
  `Reaching(S)`, which condition (2) forbids at flush time — contradiction. ∎

Either way the assumption fails, so no post-flush instruction can change S. The predicate is sound. It
is also non-vacuous: a subject in a leaf `@media` root with no crossing extends and whose only reaching
instructions are authored earlier in that same `@media` body flushes the instant that `@media` body's
subtree is exited — its memory reclaims mid-document, not at end.

#### 4.4.4 What CAN early-flush vs what is PINNED

- **Early-flushable:** a subject S such that `max authored position over Reaching(S)` lies within an
  already-fully-descended scope AND S is not hoist-exposed. Canonically: subjects inside a `@media` /
  `@layer`-isolated / protected (A7) root whose reaching instructions are all authored inside that same
  root (or an ancestor already past its last reaching-instruction position), with no crossing extend.
  These flush and reclaim when their scope closes — the win the optimization exists for. A7 protected
  roots (`isProtected`, `extend-roots.ts:621`) are especially clean: the wall means the only reaching
  instructions are those declared inside, so the root is self-contained — flush on exit.
- **Pinned to end-of-descent:** (1) any subject reachable by a document-root-bucket instruction
  authored after it; (2) any hoist-exposed subject (a reachable crossing extend); (3) any subject a
  produced branch re-buckets outside its original reaching set. In the limit — a document where a
  trailing root-scope `:extend .foo` targets a `.foo` used everywhere — nothing early-flushes and the
  discipline degrades gracefully to the §4.4.2 baseline. This is correct, not a failure: those subjects
  genuinely are not final until the end.

#### 4.4.5 Buffer-then-flush vs streaming-patch — DECISION

**Recommend: buffer-per-subject-then-flush, with the §4.4.3 early-flush optimization.** Reasons, against
the alternative (stream authored form immediately, write a placeholder for the header, then PATCH the
extend additions into the hole once the fixpoint settles):

- **Document-order confluence (decisive).** The fixpoint is confluent ONLY because EMIT sorts OR-branches
  by document `order` (§2.6 / §4.3 B3) — the final header is a post-fixpoint SORT over branches gathered
  in arbitrary fire order. A streaming-patch writer would have to insert branches into an already-written
  header at their sorted position, i.e. reproduce the sort by in-place splice into emitted text. That is
  the sort done the hard way, against live byte offsets. Buffer-then-flush composes the header ONCE from
  the settled, sorted branch set — the sort is a list operation, not a text-offset splice. The confluence
  invariant the whole SOLVE design rests on directly favors buffer-then-flush.
- **Sourcemaps.** Header offsets are assigned at flush, after the header text is final, so every mapping
  is written once at its true offset. Streaming-patch would assign a placeholder offset then shift every
  subsequent mapping when the hole is filled to a different width — an O(mappings) rewrite per patch, and
  a silent-divergence risk (§8.1). Buffer-then-flush has no offset rewrite.
- **Streaming-writer compatibility.** Buffer-then-flush is NOT all-or-nothing streaming: with early-flush,
  a scope-closed subject's bytes are emitted to the real writer the moment its scope closes, so output
  streams at scope granularity. A large file that is mostly leaf-`@media`/`@layer`/protected scopes with
  local extends streams progressively; only the pinned (root-reaching / hoist-exposed) subjects wait for
  end-of-descent. Streaming-patch streams sooner but at the cost above, and its "sooner" is illusory for
  pinned subjects (their header is genuinely unknown early — you would stream a hole and patch it, buying
  nothing but the offset-rewrite tax).
- **Memory.** Buffer-then-flush's cost is the §4.4.2 O(output) worst case, reduced by early-flush to
  O(largest open pinned span). Streaming-patch holds less output but must retain a patch table (hole
  positions + pending branch sets) whose worst case is the same pinned set — so its memory advantage is
  marginal and it pays the offset-rewrite CPU on top.

Streaming-patch is worse on every axis that the confluence invariant and sourcemap identity make
load-bearing, and its only theoretical edge (earlier first-byte for pinned subjects) is exactly the case
where the header is genuinely not yet known. **Buffer-then-flush + early-flush is the settled discipline.**

#### 4.4.6 Interaction with the loosened canonical-mutation invariant (ruling 1)

Ruling 1 (loosened 2026-07-08) permits OUTPUT-INVISIBLE in-place mutation on a canonical node — including
"a cached composed-form / bucket-path." This directly simplifies flush: the subject's composed header and
each branch's bucket-path (the A1–A8 routing key + the `composeExtendWithRelativeToTarget` /
`getFullComposedForm` composed contribution, `extend-roots.ts:257`/`:320`) MAY be memoized on the
canonical node the first time the walk composes it, because the composed form is output-invisible
bookkeeping (it does not change the canonical node's own re-serialization or its reuse elsewhere). So at
flush time the header composition is available WITHOUT re-walking `.parent` and without recomputing the
bucket path — it is read off the canonical cache seeded during descent (this is also the flagged
`getFullComposedForm`-reads-`composedSelectorStack` perf follow-up, §4.3, now permitted to persist on the
canonical node rather than recomputed per placement). The early-flush predicate's `Reaching(S)` set,
likewise, is PLAN data that may cache on the canonical root node. Net: the loosened invariant turns flush
from a re-composition into a cache read.

### 4.5 `extendSelector` eliminated (ruling 2)

There is no in-flow caller for a node→node per-call extend: SOLVE operates on the IR/selector layer
and EMIT is the sole materializer. `extendSelector`/`applyExtendsToSelector`/`wouldMatchNode`
(the ~25% perf hotspot) collapse into the (C) rewrite behind the target index. A thin test-only
wrapper can remain for the differential oracle; the public node→node API is gone.

---

## 5. collapseNesting on/off — emit-time policy

Collapse is already an EMIT-time policy on the walk: `serialize-helper.ts` reshapes nested rulesets
into `:is()`-grouped collapsed form (`collapseNesting:true`) vs the expanded nested form
(`false`), reading `options.collapseNesting` and the `composedSelectorStack`. The unified pass keeps
this exactly: the SAME traversal produces both shapes because the difference is purely in how EMIT
projects the structural stack into selector text at each ruleset boundary.

**Interaction with extend contribution:** an extend-added branch is projected through the same
collapse policy as an authored branch — e.g. the ratified v5 `extend-nest` reshape
`:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box` is EMIT grouping the
extend-contributed COMPOSED branch (`.type1 .sidebar3` — the nested extender's composed form, §4.3
C8) alongside the authored ones under one `:is()`. The design must reproduce THIS v5 shape (carrying
the composed `.type1 .sidebar3`), not 4.x expansion. Because both authored and extend branches carry
the same annotation
set and reach EMIT as one `Or`-set, collapse operates uniformly — it does not need to know which
branches came from extend. This yields the consistent grouped shape under both modes.

The ratified `:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box` shape CORROBORATES
the design: it is exactly what "project all `Or`-branches (authored + composed extend contributions)
through one uniform collapse grouping" produces. This agreement is evidence the composed-contribution
+ emit-time-collapse model is the consistent end-shape.

One adjacent case to REASON about rather than defer: the `:is()`-grouping of pseudo-classes
(`:is(.button, .submit):hover` vs `.button:hover, .submit:hover`). Under the consistent shape,
collapse groups a common trailing context under `:is(...)` — so if `.button` and `.submit` share a
`:hover` nested block, `:is(.button, .submit):hover` is the coherent grouped form. If any current
fixture expects the expanded `.button:hover, .submit:hover` under `collapseNesting:true`, that
expectation is the suspect (it is the un-grouped form the collapse policy exists to eliminate) — flag
for owner decision, do not special-case the pass to emit the expanded form. This is a B4
`:is()`-format question the collapse policy already owns.

---

## 6. The generic Jess visitor model — a first-class per-node hook on the unified pass (ruling 5, OWNER-RESOLVED)

**Owner resolution (settled).** A Jess visitor is a FIRST-CLASS, GENERIC capability of the unified
pass — NOT a hook shaped around any one consumer. The definition is deliberately minimal:

> **A visitor is a registered function `(node, ctx) => Node | void | REMOVE` that the pass invokes on
> each node directly AFTER that node's eval/emit shape is produced and directly BEFORE the node is
> serialized. Returning a node replaces it; returning nothing leaves it unchanged; returning `REMOVE`
> drops it from output.**

less-compat is ONE downstream consumer of this generic hook (§6.7), not a special case the pass knows
about. The pass does not import, mention, or depend on less-compat; it only invokes whatever visitors
are registered. There is NO eval-stage → visitor-stage → serialize-stage sequence and no whole-tree
visitor walk: the pass IS the traversal, so a visitor is a per-node callback with no traversal of its
own. The node intermediate SURVIVES only TRANSIENTLY and LOCALLY at each emit position — never a
persistent materialized output tree, never a separate pass.

### 6.1 The visitor contract (generic, core-owned, Less-agnostic)

The contract lives in `@jesscss/core` and is complete and testable with zero Less knowledge.

**Signature.** `type NodeVisitor = (node: Node, ctx: VisitContext) => NodeVisitReturn`, where
`NodeVisitReturn = void | Node | symbol` — this is the EXISTING core type (`node-base.ts:66`) and the
existing `REMOVE`/`ABORT` symbols (`node-base.ts:64-65`), reused verbatim. No new return vocabulary is
invented.

**Return semantics** (exactly the semantics core's `Visitor._visit` already implements at
`visitor/index.ts:144-150`, `fn.call(this, n, ctx) ?? n`):
- **`void` / `undefined`** → node unchanged; the same shape flows to serialize. (Output-invisible
  in-place annotation of the node is separately governed by ruling 1 — see §6.5.)
- **a `Node`** → REPLACEMENT; the returned node is what serializes (and what the next visitor in the
  chain sees, §6.4).
- **`REMOVE`** → the node is dropped from output (nothing serialized for it, children included). This
  is the drop signal Less visitors express by returning `undefined` under `isReplacing` — core already
  has the `REMOVE` symbol for it; the pass simply skips serialization on `REMOVE`.
- **`ABORT`** (already in core) → stop descending into this node's children but keep the node itself;
  the pass emits the node's own bytes and does not visit its subtree. This is the inline-pass
  equivalent of Less's `visitDeeper = false`.

**Context.** `VisitContext` is the MINIMAL bundle a visitor needs to make a decision at this position,
and nothing more:
- the live **value-frame** (top of the §2 stack) — so a visitor, or a custom function it calls, can
  resolve a value / inspect scope against the SAME bindings leaf resolution uses;
- the **structural stack** (ancestry + `composedSelectorStack`, §2) — so a visitor can see the
  composed placement/selector context of the node;
- the **output writer/buffer** handle (§4.4) — so a visitor that needs to emit directly (rare) can,
  though the normal path is return-a-node;
- a `visitDeeper`-style descent flag defaulted true (mirrors the existing `VisitorContext` at
  `visitor/index.ts:19-21`), which `ABORT` sets false.

The context deliberately carries NO Less-specific view, NO `less.tree`/`less.functions` shape, and no
consumer identity. It is the same `(value-frame, structural-stack, writer)` the pass already threads
(§2, §4.4) — a visitor is handed the state the pass already has, not a new subsystem.

### 6.2 Hook point(s) — ENTER and EXIT, mapping cleanly onto the 4.x visitX/visitXOut split

The owner's "after eval AND before serialize" is, in the unified pass, a per-node WINDOW with two
edges, because eval+serialize of a subtree is one nested traversal:

- **ENTER (pre-children)** — the node's own shape is produced (value resolved, selector composed,
  extend contributions projected) but its children are not yet serialized. A visitor sees the node
  with its settled own-shape and can replace/remove/abort it before its subtree is walked.
- **EXIT (post-children, pre-close)** — after the node's children have been serialized, before the
  node's closing bytes are written. A visitor can act on the fully-emitted subtree form.

This is the SAME enter/exit split core's `Visitor` already exposes as per-type `foo` / `fooExit`
(`visitor/index.ts:38-122`) and as the `enter`/`exit` bookends (`:31-36`), and it is EXACTLY what the
Less 4.x `visitX` (enter) / `visitXOut` (exit) callback pair needs. Mapping:

- A generic Jess visitor registers `enter(node, ctx)` and/or `exit(node, ctx)`. Most visitors only
  need `enter`. `exit` exists solely so the pass can carry consumers (like 4.x) that distinguish the
  two edges; if a visitor registers no `exit`, the pass invokes nothing at the exit edge (zero cost).
- **4.x per-type dispatch (`visitRuleset`, `visitDeclaration`, …) is a CONSUMER concern, not a core
  one.** Core invokes ONE generic `enter`/`exit` per node keyed on nothing. The `type → visitX`
  fan-out is a thin dispatch the CONSUMER does inside its own `enter` (switch on `node.type`), which
  is precisely what core's own `Visitor.getMethod`/`_visit` does today (`visitor/index.ts:130-150`)
  and what the less-compat bridge does today (`less-compat-structures.ts:70` builds
  `visit${nodeType}`). Core does not owe consumers a per-type registration table; it owes them the
  node + the enter/exit edge, and they dispatch.

So: **two hook edges (enter/exit), one generic signature each, per-type dispatch pushed to the
consumer.** That is the least surface that still carries the 4.x enter/exit + per-type surface.

### 6.3 Strengthen or SIMPLIFY — the verdict: SIMPLIFY (drop the walk framework; keep a two-edge hook)

The load-bearing insight: **today Less runs visitors as their OWN whole-tree walk(s)** — that is what
core's `TreeVisitor` (`visitor/index.ts:192-263`) is (an auto-walk that calls `n.walk(...)`,
tracks `visitedNodes`, honors `accept()`), and what the `preSerializeRoot` seam
(`rules.ts:4795-4809`, `print.ts:69`) triggers: a `(evaluatedRoot: Rules) => Rules | void` hook run
ONCE over the whole evaluated tree, whose whole job is to give plugin visitors a tree to walk. **In
the unified pass the walk already happens.** A visitor therefore needs no traversal, no
`visitedNodes` bookkeeping, no `accept()` recursion, no separate root hook.

**What the pass makes UNNECESSARY (delete):**
- **`TreeVisitor`** (`visitor/index.ts:192-263`) — the entire auto-walk / `visitChildren` /
  `visitedNodes` / `accept()`-recursion machinery. The pass supplies the traversal; a visitor is a
  callback fired at each node. This is the bulk of the current visitor code.
- **The `preSerializeRoot` whole-tree seam** (`rules.ts:4795-4809`, `print.ts:69`,
  referenced by ruling-5 note) — the "run post-eval plugin visitors over the evaluated root" hook. Its
  sole reason to exist is to hand plugins a materialized tree to walk after a separate eval; with
  eval+emit unified, the hole it plugged is gone. It dissolves into the per-node enter/exit invocation.
- **The standalone `Visitor.visit(n): Node` entry** (`visitor/index.ts:162-182`) as a
  driver — it self-rebinds `this.visit` to descend; under the pass there is no self-driven descent, so
  the driver collapses to "core calls your `enter`/`exit`."

**What SURVIVES as the minimal core (keep):**
- The **`(node, ctx) => NodeVisitReturn` shape** and the `void|Node|REMOVE|ABORT` semantics — already
  in core (`node-base.ts:64-66`, `visitor/index.ts:144-150`).
- The **enter/exit two-edge invocation** (§6.2) — already in core as `foo`/`fooExit` + `enter`/`exit`.
- A **registration + ordering list** (§6.4) — a small ordered array of registered visitors the pass
  iterates per node. This is the ONE genuinely new (but tiny) piece: a registry, because today
  visitors are handed in ad hoc via `preSerializeRoot`, not registered.

**Verdict:** this is a NET SIMPLIFICATION. The generic model is "a registered `(node,ctx)` callback
the pass fires at two edges," and it is strictly SMALLER than today's `Visitor`+`TreeVisitor`+
`preSerializeRoot` trio — we delete the whole-tree walker and the root seam and add only a registry.
It is expressive enough to carry the full 4.x compat surface (proof: §6.7), so no heavyweight framework
is reintroduced. Under the package-boundary constraint (§6.6) the core surface is smaller STILL,
because it carries no Less semantics — just node + edge + return.

### 6.4 Multiple visitors — registration, ordering, chaining

- **Registration.** `@jesscss/core` exposes a registration API (e.g. `registerVisitor(v, { order? })`)
  that appends to an ordered list held on the render/compile context. No auto-registration of anything;
  the list is empty unless a caller registers.
- **Ordering.** Deterministic registration order (with an optional integer `order` for priority),
  mirroring the Less pre/post ordering a consumer may need. The pass iterates the list in that order at
  each node.
- **Chaining.** Visitor N sees visitor N−1's RESULT: at a node, the pass threads the current shape
  through the list — `shape = visitorK.enter(shape, ctx) ?? shape` for each K in order; a `Node`
  return re-seats `shape` for the next visitor; `REMOVE` short-circuits the chain and drops the node;
  `ABORT` stops child descent but continues the remaining visitors on this node. The shape that exits
  the chain is what serializes (step 3). Exit edges fire in the same order (or reverse, if a consumer
  needs LIFO — a registry option, not a core default). This is exactly how the less-compat bridge
  already chains multiple Less visitors over one node (`plugin.ts:1210-1242`, the iterator loop
  re-seating `result` and returning `REMOVE` on `undefined`).
- **Flow into serialize.** The final chained shape is the node step 3 writes. A replacement produced by
  a visitor is treated identically to an eval-produced fresh transient (§6.5): it is an
  output-affecting change, so it is a fresh local object, serialized then released.

### 6.5 Interaction with the shape / canonical-mutation model (ruling 1)

Two distinct visitor effects map onto the two sides of the loosened invariant (ruling 1):

- **A visitor that RETURNS A NEW NODE** is an OUTPUT-AFFECTING change → it takes the
  fresh-transient-shape path (step 1 / §6.1). The visitor MUST NOT mutate the shared canonical node in
  a way that changes its bytes or its reuse; it produces a fresh local object for this emit position,
  which serializes and is released. This is identical to eval producing a fresh transient — a
  visitor replacement and an eval-changed node are the same category of thing (a per-position
  output-differing shape).
- **A visitor that returns VOID but annotates the node output-invisibly** (a cached projection, a
  bookkeeping flag) MAY mutate the canonical node in place, per ruling 1 (loosened 2026-07-08), PROVIDED
  the annotation changes neither the canonical node's re-serialization nor its reuse elsewhere. So a
  visitor that merely reads/tags without changing output needs no transient.

The rule of thumb the visitor author sees: **change the output ⇒ return a new node (transient);
observe or invisibly-cache ⇒ return void (canonical mutation allowed).** This is the same discipline
the rest of the pass follows; visitors introduce no new invariant.

### 6.6 Package boundary — core owns the generic API, `less` owns the compat consumer

This boundary is load-bearing and baked into the design:

- **The generic visitor registration API lives in `@jesscss/core`** and is complete and testable with
  ZERO Less knowledge. Core defines: the `(node, ctx) => NodeVisitReturn` contract (§6.1), the
  enter/exit edges (§6.2), the registry + chaining (§6.4). Native Jess visitors (a jess plugin, an
  internal transform) use this with no Less present. Core exposes ONLY general capabilities — node +
  context (value-frame, structural stack, writer) + replace/return — and MUST NOT expose a
  Less-specific hook or bake in `less.tree` / `less.functions` shapes.
- **The less-compat visitor is registered by the `less` package** (the Less-4.x-compat facade that
  depends on jess) — NOT by `jess`/core. For jess, less-compat is an OPTIONAL SIDE DEPENDENCY: jess
  never imports, depends on, or auto-registers it. The visitor story stands entirely on its own for
  native jess visitors with zero less-compat present.
- If the compat bridge needs a core capability (e.g. a per-node "view" of the shape it can adapt to a
  4.x node), that capability is framed as a GENERAL `VisitContext` affordance — access to the node and
  its live frame — that less-compat HAPPENS to use to build a `less.tree` adapter on its own side. It
  is never a Less-branded API in core. The 4.x-mapping analysis (§6.2, §6.7) validates that the generic
  core API is expressive enough, but that analysis lives BEHIND the `less` package, not in core.

### 6.7 less-compat as ONE downstream consumer (OQ-F resolved)

less-compat is satisfied entirely by registering a single generic Jess visitor whose `enter`/`exit`
bridge to the Less 4.x plugin visitors — which is EXACTLY what the bridge already is today: the
compat plugin implements a jess `Visitor` whose `visit(node)` converts the node to a Less view
(`toLessNode`, `plugin.ts:1194`), runs the registered Less visitors over it (`plugin.ts:1210-1242`),
and converts any replacement back (`fromLessNode`, `plugin.ts:1247`). It already returns `REMOVE`
when a replacing Less visitor returns `undefined` (`plugin.ts:1234-1236`) and already chains multiple
Less visitors via an iterator (`plugin.ts:1211`). Under the unified pass:

- **`less.tree` node view** — built by the `less` package inside its `enter`, adapting the ONE node
  handed to it (`toLessNode`) at that instant. It is a LOCAL adaptation of a single node, not a
  materialization of a whole subtree; a 4.x visitor that inspects children sees them adapted lazily as
  the pass reaches them (the same inline discipline the current `LessAdapterBase` accept/visitArgs
  handling in `less-compat-structures.ts:60,121` already assumes). Core knows nothing of this view.
- **`less.functions` registry** — a 4.x custom function called during value resolution runs with the
  `VisitContext` value-frame available (§6.1), so it resolves against the live bindings, exactly as a
  native leaf resolution does (§2). The registry lives in the `less` package.
- **per-type `visitRuleset`/`visitDeclaration`/… dispatch** — done inside the compat `enter` by
  switching on `node.type` (the `visit${nodeType}` build at `less-compat-structures.ts:70`), including
  the v2 `Directive→AtRule` / `Rule→Declaration` aliases (`:76-91`). Core never sees per-type methods.
- **`isReplacing` / `visitDeeper`** — map to core's return semantics: replacing → return the new node;
  non-replacing → mutate-and-return-void (or return the same node); `visitDeeper:false` → `ABORT`.

So OQ-F's "what/when" resolves to: the protected surface is the **generic per-node enter/exit hook
receiving (node, ctx) post-shape/pre-serialize**, firing in traversal order — AFTER a node's own
eval/compose/extend shape is produced (a consumer sees resolved values + composed selectors + extend
contributions for THAT node) and BEFORE its bytes are written. There is no "before extend vs after
extend" whole-tree choice, because there is no whole-tree visitor pass — each node is visited once, at
its own settled shape.

### 6.8 Pre-eval visitors — a GENUINE GAP needing an owner call

Less 4.x lets a plugin flag a visitor `isPreEvalVisitor` so it runs BEFORE eval (over the parsed,
un-evaluated tree) rather than post-eval. **Jess already HAS a pre-eval path today, and it is a
separate whole-tree pre-pass** — `PluginInterface.beforeEvalVisitor` / `beforeEvalVisitorForTree`
(`packages/core/src/plugin.ts`), driven by `applyBeforeEvalVisitors` (`packages/jess/src/index.ts`
~`:1007`), which walks the parsed tree via `visitBeforeEvalNode` BEFORE eval runs. (The post-eval side
is `preRenderVisitor` / `postEvalVisitor`, driven by `applyPreRenderVisitors` through the
`preSerializeRoot` hook — the seam §6.3 deletes.)

The unified pass cleanly subsumes the POST-eval side (that is all of §6.1–§6.7). It does NOT subsume
the PRE-eval side by construction: the pass resolves-and-emits in one downward step, so there is no
"un-evaluated whole tree" moment mid-pass for a pre-eval visitor to observe or rewrite. A pre-eval
visitor MUST see the tree before values/selectors resolve.

This is the one place the generic story cannot fold into the single pass. It is NOT a gap in
capability (the capability exists today) — it is a decision about whether pre-eval STAYS a separate
pre-pass or is dropped:
1. **Keep the pre-eval pre-pass as-is, outside the unified pass** (RECOMMENDED). It is already a
   distinct, cheap, structural pre-walk over the un-evaluated tree — orthogonal to the eval/emit fold
   and unaffected by it. The unified pass owns POST-eval visitors; the pre-pass owns PRE-eval
   visitors; both feed the SAME core-owned registry contract (§6.1), just at different lifecycle
   points. This keeps "one eval-emit pass" honest — the pre-pass does not eval or emit, it only lets
   pre-eval consumers rewrite the source tree first — while preserving the existing 4.x pre-eval
   surface (`beforeEvalVisitor`).
2. **Drop pre-eval visitor support in v5.** Cleaner (one hook lifecycle), but a compat regression if
   any 4.x plugin relies on `isPreEvalVisitor`.

**Recommendation:** option 1 — retain the existing pre-eval pre-pass unchanged, register pre-eval
visitors through the same generic contract, and let the unified pass own only the post-eval hook.
**Flag for owner decision** whether pre-eval compat is worth keeping the extra pre-pass; this is the
residual open item of the visitor design. Everything on the post-eval side is settled.

### 6.9 Sourcemaps under the inline model

Unchanged from §2.4: the writer needs a source ORIGIN per emitted chunk, not a retained node. Step 3
attributes each chunk to the source node the traversal stands on (canonical for static, or the
transient's `_sourceRoot`-carried origin for changed/visitor-replaced nodes). Sourcemaps do not force a
persistent output tree — they force the origin to travel with the emit position, which it does.

**Net:** EMIT writes bytes, per node, with a transient node shape living only across the enter →
children → exit → serialize → release window at each position. No retained second tree, no separate
visitor pass, no whole-tree walker, no double-eval. Visitors are a generic core-owned per-node hook;
less-compat is one downstream consumer of it; the only residual open item is pre-eval (§6.8).

---

## 7. What SURVIVES vs what is REPLACED

**Survives structurally (little/no change):**
- PLAN: reachability closure + target index (`extend-roots.ts` precompute; `getVisibleRoots`).
- The (C) match/rewrite black box (partial/full, `:is`-graft, remainder-split, dedup) — behind the
  target index.
- Collapse/`:is()` reshape policy in `serialize-helper.ts` (already emit-time).
- Selector composition on the walk (Slice 4), root at-rule hoist on the walk (Slices 1/3).
- The ScopeFrame model (`scope-frame.ts`) — its lexical-chain design is exactly right; the change is
  its LIFETIME (kept live through emit) not its shape.
- `+:` decl-merge and `$while` counter state (not copies).
- The GENERIC visitor CONTRACT and its semantics — `(node, ctx) => void|Node|REMOVE|ABORT`
  (`node-base.ts:64-66`, `visitor/index.ts:144-150`) and the enter/exit two-edge split (`foo`/`fooExit`,
  `enter`/`exit`) — survive as the core-owned per-node hook (§6.1–§6.2); only their INVOCATION changes
  (fired by the pass, not self-driven).
- The pre-eval visitor pre-pass (`beforeEvalVisitor` / `applyBeforeEvalVisitors`) — retained as a
  separate structural pre-walk outside the unified pass (§6.8, owner decision pending).
- The less-compat consumer's NEEDS (`less.tree` node view, `less.functions` registry, per-type
  dispatch, `isReplacing`/`visitDeeper`) — satisfied by registering ONE generic Jess visitor from the
  `less` package (§6.7); the CAPABILITY survives even though core no longer owns any Less-specific
  surface.

**Replaced / deleted:**
- The separate eval walk that materializes `state.output` (`evalForRender`→`eval`→`serialize` two-walk
  shape) → ONE traversal.
- Value materialization into output nodes → per-leaf frame lookup at emit.
- `inherit`'s per-node span/flag stamping on derived output nodes (`node-base.ts:1474-1516`) →
  eliminated (source-node facts read in place; extend flags on branches).
- The four reparent-avoidance clone families (selector COW, operation operands [done], ampersand/
  extend materialization, collapse-survivor) → share-under-frame.
- The class-2 reuse gates (`canReuseAsLeaf`/`canReuseLeaf`/`canReuseStaticScalarLeaf`) + clone-to-
  freeze machinery → deleted (nothing to gate; always share).
- The container static short-circuits (population 2) → reactive fall-through.
- `extendSelector` node→node API + `processExtends` walk-end pass → SOLVE folded into the traversal.
- `ownSelector`/`analyzeNonPartialExtends` cascade → composed-contribution derived from the stack.
- The whole-tree visitor WALK framework — `TreeVisitor` (`visitor/index.ts:192-263`, auto-walk /
  `visitChildren` / `visitedNodes` / `accept()`-recursion) + the `preSerializeRoot` root seam
  (`rules.ts:4795-4809`, `print.ts:69`) + the self-driven `Visitor.visit` driver
  (`visitor/index.ts:162-182`) + the `applyPreRenderVisitors` post-eval pass — all → a single
  core-owned per-node hook fired by the pass at each node's enter/exit edges (§6). Visitors stop being
  tree-walkers; the pass IS the walk. (The pre-eval `beforeEvalVisitor` pre-pass is NOT deleted — §6.8.)
- Finally: `F_STATIC`/`F_NON_STATIC`/`F_HAS_NODE_CHILD`/`F_CHILD_DERIVED`/`propagateFlagsFrom` (C4) —
  their only surviving readers are the reuse gates + container short-circuits, both deleted above.

---

## 8. Where the pass is most likely to diverge from a current expectation

These are the surfaces where the unified pass most plausibly produces a DIFFERENT byte/map/warning
than a current fixture. Per ruling 7, a divergence is a prompt to check the reasoned end-shape against
the expectation and owner-confirm which is right — not automatically a design defect. Sourcemaps and
trivia (1,2) are places the ARCHITECTURE must be careful (the reasoned shape wants them preserved);
warnings and compat (3,4) are places the EXPECTATION itself is most likely the suspect.

1. **Sourcemaps (highest).** Emit descending the source tree changes nothing about WHICH source
   offset a chunk maps to for authored leaves — but any place the old eval path attributed a chunk to
   a DERIVED node's inherited span, the unified pass must attribute it to the source node, and a
   mismatch is silent (same CSS, different map). Every migration slice needs a **sourcemap-identity
   check**, not just CSS-identity.
2. **Authored-trivia boundaries.** `detachTrivia` (`node-base.ts:1269`) prevents a shared leaf from
   re-consuming file-owned whitespace/comments at its authored offset when placed elsewhere. Under
   the unified pass a shared leaf emitted in a new position must NOT re-emit its authored trivia — the
   trivia belongs to the authored position. This is the exact class of bug B1s hit at the
   `variables.less` trivia boundary. The comment-scan machinery (`serialize-helper.ts`) must remain
   position-scoped.
3. **Warnings — a v5-NATIVE concern, not a 4.x match.** The design does not target reproducing 4.x
   warning/error output; v5 warnings are structured on `result.warnings` and are free to be whatever
   v5 defines. The architectural point is only WHERE they are produced: extend diagnostics
   (`extendNotFound` / not-accessible) are emitted FROM THE SOLVE FIXPOINT — a not-found is an
   instruction that fired against zero subjects across its reachable buckets; a not-accessible is an
   instruction whose only candidate subjects were excluded by reachability (A6/A7). Both are read off
   the post-fixpoint fired-set + PLAN reachability. Non-extend warnings emit in SOURCE ORDER as the
   traversal reaches the offending node (the pass is a single source-order walk, so source-order
   warning emission is natural). The v5 FORMAT is owner-defined; the design just pins the PRODUCTION
   POINT.
4. **less-compat consumer output (§6, model resolved).** A 4.x plugin/function now runs at the inline
   per-node hook (post-shape, pre-serialize) on a node already carrying its resolved values, composed
   selector, and extend contributions — so per-node inspect/transform and custom-function resolution
   are well-defined. The residual divergence risk is only the whole-tree mutate-then-observe plugin
   pattern (OQ-F) the inline model cannot serve; exercise the compat scenarios and owner-confirm any
   such case rather than reintroducing a whole-tree pass.

---

## 9. Open questions for owner arbitration

- **OQ-A — RESOLVED (owner 2026-07-08): the former — selector interpolation resolves EARLY, so extend
  sees concrete selectors; the pass is genuinely single.** Interpolated selectors CAN be extend
  targets/subjects (a real, supported feature). But a selector's interpolation (`[data=@{attr}]`)
  resolves when the walk EVALS that node — at ruleset-enter, value-frame live — and the CONCRETE result
  is what feeds PLAN/SOLVE. So extend never sees an unresolved dynamic value; it operates on the
  already-resolved selector. "Vars are resolved early" (owner) is exactly the mechanism: the
  value-dependent part is discharged during the eval descent BEFORE the selector participates in extend,
  which is WHY the extend layer is cleanly decoupled from the value-frame — no staged sub-pass, no
  entanglement. **Concrete consequence (bug to fix in the cutover):** jess currently captures the extend
  TARGET unresolved — it pushes the raw `[data="@{attr}"]` at `extend.ts:341` before interpolation runs,
  so `:extend([data=@{attr}])` silently no-ops today. The fix is bounded: resolve the target's
  interpolation at capture time (frame live) so the instruction carries the concrete target. (Fixing
  this is also what makes interpolated extend targets actually work — verify the exact output shape vs
  Less 4.x when building it.)

- **OQ-B — RESOLVED (§4.4).** The flush discipline is SETTLED: (1) decls resolve against the live
  frame and stream as bytes into a per-subject buffer during descent — only the rule HEADER is deferred
  (§4.4.1); (2) baseline is flush-at-end-of-descent, provably correct once the fixpoint settles, at
  O(output) memory (§4.4.2); (3) the early-flush optimization flushes a subject the moment
  `max authored position over Reaching(S)` (its A1–A8 reachable-instruction set) is behind the walk AND
  it is not hoist-exposed — sound by the §4.4.3 proof; leaf `@media`/`@layer`/protected-root subjects
  with local extends early-flush on scope close, while root-reaching / hoist-exposed / cross-scope
  subjects are pinned to end-of-descent (§4.4.4); (4) buffer-then-flush beats streaming-patch on
  confluence-sort, sourcemap-offset identity, and memory (§4.4.5); (5) the loosened canonical-mutation
  invariant lets the composed header + bucket-path cache on the canonical node, making flush a cache
  read (§4.4.6). **Residual owner call:** the O(largest open pinned span) memory of the pinned set under
  a pathological trailing-root-`:extend` document is a latency/memory tradeoff, not a correctness issue
  — accept the graceful degradation to baseline, or add a spill-to-writer cap? (Deferred; not blocking.)

- **OQ-C — RESOLVED (owner 2026-07-08): COORDINATED CUTOVER, not incremental.** Power the full target
  architecture out on a dedicated branch (`CUTOVER-CHECKLIST.md` is the tracked plan). **Explicit reason
  for cutover over incremental:** incremental attempts made agents BACKPEDAL — they start, read the
  existing eval→output-tree→visitor→serialize structure, and match it instead of driving to the target,
  poisoning the goal. The cutover is guardrailed against that: the design docs are the SPEC, the existing
  structure is what's being TORN OUT (never matched), agents work the checklist toward the target and
  touch base often, byte-identical-vs-alpha is the FINAL gate (not per-intermediate-step), and progress
  is tracked against the checklist, not re-derived from current code. Fan-out across disjoint phase-work;
  serialize the coupled spine.

- **OQ-F — RESOLVED (§6).** The visitor surface is a FIRST-CLASS GENERIC core-owned per-node hook —
  `(node, ctx) => void|Node|REMOVE|ABORT`, fired at enter/exit edges post-shape/pre-serialize in
  traversal order (§6.1–§6.4). less-compat is demoted to ONE downstream consumer registered by the
  `less` package (§6.7), never a core-known special case; core carries no Less semantics (§6.6). The
  model is a NET SIMPLIFICATION: the whole-tree `TreeVisitor` walker + `preSerializeRoot` seam are
  deleted because the pass already walks (§6.3). Two RESIDUAL items for the owner, both narrow: (1)
  **pre-eval visitors** — the existing `beforeEvalVisitor` pre-pass cannot fold into the single pass;
  keep it as a separate structural pre-walk (recommended) or drop v5 pre-eval compat (§6.8); (2) the
  whole-tree **mutate-then-observe** plugin pattern (a plugin that rewrites a sibling/ancestor and
  observes the effect across the tree) — the per-node model visits each node once and releases it, so
  such a plugin is unserved. None is registered in the compat corpus today; if one appears it needs an
  owner ruling. The common cases (per-node inspect/transform, custom-function value resolution) are
  fully served.

- **OQ-D — confluence / batch-equals-sequential (carried from extend doc OQ-4).** SOLVE's
  order-independence needs "no rewrite's output value depends on current partial state in an
  order-sensitive way." Today's `applyBatchedExtend` vs sequential must be output-equal (claimed,
  unpinned). Pin as an invariant or order becomes load-bearing.

- **OQ-E — `:is`-graft termination (carried from extend doc OQ-3).** Is graft depth provably bounded
  by input depth, or is a depth guard retained?

---

## 10. Realism assessment — size, and incremental vs cutover

**This absorbs the flag-walk C4 endgame. Stated plainly:**

The unified pass IS the "frame-threading spine" that `SINGLE-RENDER-PASS` §3.3 concluded B REQUIRES
after B1s refuted the incremental one-leaf-at-a-time fold. That finding is decisive and is not
re-opened here: **there is no narrow first leaf shape.** Even the scalar `width:@w` case is entangled
with shadowing/closure/guard state, so you cannot fold one leaf shape at a time via placement-frame
re-resolution. The spine — serialize genuinely descends the SOURCE tree carrying the LIVE value-frame
forward — is a **monolithic prerequisite** before ANY leaf folds.

**Size:** multi-week, high-regression. It touches the hot `rules.ts` render/eval surface, the
serialize walk, the extend engine, sourcemaps, trivia, and the less-compat bridge simultaneously,
because they all read state that today is materialized-then-walked and must become
resolved-during-walk. The reader-retirements (R3/R4/R5a — DONE) and Phase-D relocations
(hoist/composition/D2 — banked) shrank the surface but did NOT reach the spine; the spine is what
remains.

**Incremental vs cutover — the honest verdict:**

- **The spine itself is a CUTOVER, not incremental.** The pieces are mutually dependent: you cannot
  thread the value-frame through emit without also stopping value-materialization into output nodes;
  you cannot stop materialization without the leaf lookup; you cannot delete the reuse gates until
  materialization stops; extend cannot fold into the walk until composition + the frame are both live
  on the walk. B1s proved the incremental slice ladder (B1s→B2s→B3s) is dead. So the value-fold + the
  reuse-gate deletion + the extend-into-walk fold + the C4 flag deletion land together, behind ONE
  coordinated flag flip, validated against the full corpus (both collapse modes) + sourcemap identity
  + compat scenarios + warnings. Validation is against the CONSISTENT END-SHAPE (ruling 7): a
  divergent fixture is triaged — expectation-suspect vs design-defect — and owner-confirmed, not
  auto-treated as a regression. The cutover is a judgement gate, not a pure byte-diff gate.
- **What CAN still land incrementally BEFORE the cutover** (banking value and shrinking the cutover's
  blast radius, each disjoint + byte-identical): (a) A1s collapse-survivor fresh-shell — makes
  `inherit` mutate only fresh nodes tree-wide, one clean invariant; (b) the extend PLAN precompute
  and target-index construction can be built and validated against the current apply path (differential
  oracle) WITHOUT flipping the pass; (c) `getFullComposedForm` reading the live `composedSelectorStack`
  instead of re-walking `.parent` (the flagged extend-perf follow-up) — a self-contained win; (d) the
  extend-selector-matcher perf work (~25% hotspot) is worth doing regardless and de-risks the SOLVE
  fold.
- **Perf framing (do not oversell):** the reprofile puts the entire flag-walk/eval-fold surface at
  <1% self-time. **This unification is NOT a speed lever** — it is code-health / "do less work" /
  correctness (it FIXES the C5–C8 nested-extender bugs, pending owner ratification per §9.6). The
  measured hotspots (comment-scan quadratic ~70%, extend matcher ~25%) are a separate, higher-perf
  priority. The owner's standing decision — hotspots first, this as cleanup — is not contested; this
  doc makes the cleanup coherent and drivable for when it is picked up.

**Bottom line:** the architecture is coherent and settled in shape — one downward traversal carrying
two decoupled stacks (value-frame threaded live for leaf resolution, structural stack for
composition/collapse/hoist) plus the document extend model (PLAN precompute → SOLVE selector-graph
fixpoint → EMIT projection), emitted through a per-node inline pipeline (produce shape → generic
core-owned visitor hook, of which less-compat is one downstream consumer → serialize → release), so a
node shape exists only transiently at each emit position — never a persistent output tree, never a
separate whole-tree visitor or serialize pass. It is READY for review.
It is NOT ready to implement
until OQ-A (selector-value entanglement) is arbitrated, because that determines whether the pass is
genuinely single or needs a bounded selector-value sub-pass — and it must land as a coordinated
cutover, not an incremental fold, because B1s proved the incremental path is exhausted.
