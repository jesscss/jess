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
5. **EMIT is a per-node inline pipeline (owner-resolved, §6):** per node — produce shape (reuse
   canonical untouched if unchanged; fresh transient only if eval changed it) → run visitors inline
   on that node (the less-compat / plugin hook point, receiving node + frame) → serialize immediately
   → release. The node intermediate survives only TRANSIENTLY and LOCALLY at each emit position, never
   as a persistent output tree, never as a separate visitor or serialize pass.
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

## 6. The settled EMIT + visitor model — a per-node inline pipeline (ruling 5, OWNER-RESOLVED)

**Owner resolution (settled).** There is NO eval-stage → visitor-stage → serialize-stage sequence.
Those three whole-tree passes collapse into ONE per-node inline pipeline. The node intermediate
SURVIVES, but only TRANSIENTLY and LOCALLY at each emit position — never as a persistent materialized
output tree, never as a separate pass. This is how EMIT satisfies the visitor / less-compat consumer
without a second tree walk and without double-eval.

### 6.1 The three inline steps, per node, as the traversal reaches it

As the unified traversal (§1, §2) reaches each source node, it runs three steps back-to-back and then
moves on — nothing is retained past step 3:

1. **Produce the node's SHAPE.**
   - If eval did NOT change the node (static / unchanged) → reuse the **canonical node untouched**.
     No new object is allocated; the shared canonical node IS the shape, with any live-bound values
     swapped in via the threaded value-frame (§2) at read time. This is the no-copy principle: "emit
     straight from the shared canonical node unless it's canonical-changed."
   - If eval DID change it (dynamic value resolved, selector composed, extend-modified, hoisted,
     collapsed) → create a **FRESH TRANSIENT shape** for this emit position only. You cannot mutate
     the shared canonical, so a change always yields a fresh local object. This transient shape is the
     home of the per-branch extend annotations (§4.3) and any composed/resolved form — it is exactly
     the "changed-node" object, scoped to this position, released after step 3.

2. **Run visitors against THAT node, right there — just-in-time.** At the moment the shape is
   produced and BEFORE it is serialized, plugin visitors (including the less-compat visitor) are
   invoked on it. Visitors are **per-node hooks invoked inline by the pass, NOT tree-walkers.** A
   visitor receives:
   - **the node** (the shape from step 1 — canonical-shared or fresh-transient), presented in the
     shape the consumer expects (for less-compat, the `less.tree`-compat view — see §6.2), and
   - **the frame context** (the live value-frame + structural stack at this position), so a visitor
     or custom function that needs to resolve a value / inspect scope has the same live bindings the
     leaf resolution uses.
   If a visitor TRANSFORMS the node, it yields/uses a **fresh shape** (again, the shared canonical is
   never mutated). That visitor-produced fresh shape simply becomes the node that flows into step 3 —
   no separate re-walk, no re-eval; the transform is local and immediate.

3. **Serialize the resulting node immediately** to string/buffer (with the source node as the
   sourcemap origin, §2.4), then **release it.** The transient shape (if any) is now garbage; the
   canonical node is untouched and reusable for its next placement.

So the visitor architecture ITSELF changes: the old "walk the whole evaluated tree with a visitor
pass" becomes "the pass calls each registered visitor hook once, inline, at each node's emit moment."
There is no `preSerializeRoot` whole-tree hook doing a separate visitor walk; that seam is replaced by
the inline per-node hook. (The current `preSerializeRoot` at `rules.ts:4778` is the vestige of the
old separate-pass model — under this resolution it dissolves into the inline step 2.)

### 6.2 less-compat under the inline model (OQ-F resolved)

The less-compat consumer is satisfied by step 2, not by a persistent tree. What it needs:
- **`less.tree` node view** — at the hook point, the node handed to a 4.x visitor/function is
  presented as its compat shape. Because the hook fires per-node on a transient (or canonical) shape
  that already exists at that instant, the compat view is a LOCAL adaptation of one node, not a
  materialization of a whole subtree into a compat tree. A 4.x visitor that inspects children sees
  them lazily/adapted as the pass reaches them, in the same inline discipline.
- **`less.functions` registry** — a 4.x custom function called during value resolution runs in step 2
  (or during leaf resolution in §2) with the frame context available, so it resolves against the live
  bindings.
- **plugin/visitor hook** — the per-node hook point (post-shape, pre-serialize) IS the plugin visitor
  surface; a plugin registers a hook rather than a tree-walker.

This resolves OQ-F's "what/when": the protected surface is the **per-node hook receiving (node,
frame) post-shape/pre-serialize**, firing in traversal order — i.e. AFTER a node's own
eval/compose/extend shape is produced (so a visitor sees resolved values + composed selectors +
extend contributions for THAT node) and BEFORE its bytes are written. There is no "before extend vs
after extend" whole-tree choice to make, because there is no whole-tree visitor pass — each node is
visited once, at its own settled shape.

### 6.3 Sourcemaps under the inline model

Unchanged from §2.4: the writer needs a source ORIGIN per emitted chunk, not a retained node. Step 3
attributes each chunk to the source node the traversal stands on (canonical for static, or the
transient's `_sourceRoot`-carried origin for changed nodes). Sourcemaps do not force a persistent
output tree — they force the origin to travel with the emit position, which it does.

**Net:** EMIT writes bytes, per node, with a transient node shape living only across steps 1→3 at each
position. No retained second tree, no separate visitor pass, no double-eval. The "surviving node
crossing" is this transient-shape window, not a boundary tree.

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
- The less-compat consumer's NEEDS (`less.tree` node view, `less.functions` registry, a plugin hook)
  — satisfied by the inline per-node hook (§6), so the CAPABILITY survives even though its mechanism
  changes.

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
- The separate visitor PASS + the `preSerializeRoot` whole-tree hook (`rules.ts:4778`) → inline
  per-node visitor hooks fired at each node's emit moment (§6). Visitors stop being tree-walkers.
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

- **OQ-A — extend-closure vs downward frame threading (the new tension §4.2).** The reconciliation is
  "extend is a selector-graph fixpoint, independent of value-frames; the two layers are decoupled and
  EMIT interleaves them." This holds IF no extend decision ever depends on a dynamically-evaluated
  value (e.g. an interpolated selector `[data=@{attr}]` that is an extend target/subject). The corpus
  has interpolated-selector cases (§9.6 of the extend doc flags `[data=@{attr-data}]` unresolved
  today). **Owner ruling needed:** is selector interpolation resolved BEFORE the extend fixpoint
  (a bounded value-eval sub-pass over selectors only, then structural SOLVE), or can an extend target
  genuinely depend on a value that itself depends on placement? If the former (expected), the
  decoupling is clean and the pass is genuinely single. If the latter, the fixpoint and frame
  threading are entangled and the design needs a staged sub-pass — materially larger.

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

- **OQ-C — is the migration incremental or a coordinated cutover?** See §10 — this is the honest big
  one.

- **OQ-F — RESOLVED (§6).** The less-compat / visitor surface is the per-node inline hook
  (post-shape, pre-serialize), receiving (node, frame), firing in traversal order at each node's own
  settled shape. No whole-tree visitor pass, no before-vs-after-extend whole-tree choice. What
  remains genuinely open is narrow: whether any 4.x visitor relies on MUTATING-then-observing a
  sibling/ancestor across the whole tree (a pattern the inline per-node model cannot serve, since it
  visits each node once and releases it). If such a plugin exists in the compat corpus it needs an
  owner ruling; the common cases (per-node inspect/transform, custom-function value resolution) are
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
fixpoint → EMIT projection), emitted through a per-node inline pipeline (produce shape → inline
visitor hook → serialize → release), so a node shape exists only transiently at each emit position —
never a persistent output tree, never a separate visitor or serialize pass. It is READY for review.
It is NOT ready to implement
until OQ-A (selector-value entanglement) is arbitrated, because that determines whether the pass is
genuinely single or needs a bounded selector-value sub-pass — and it must land as a coordinated
cutover, not an incremental fold, because B1s proved the incremental path is exhausted.
