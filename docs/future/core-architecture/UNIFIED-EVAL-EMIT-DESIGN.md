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
5. **EMIT is a per-node inline pipeline carrying a PRUNED-MINIMUM GENERIC VISITOR (owner-resolved, §6):**
   per node — produce shape (reuse canonical untouched if unchanged; fresh transient only if eval
   changed it) → invoke registered visitors inline on that node (a generic `(node, ctx) => Node | void`
   hook owned by `@jesscss/core`, Less-agnostic — NO `REMOVE`/`ABORT`/`visitDeeper`; less-compat is just
   ONE downstream consumer, §6.7) → serialize immediately → release. The node intermediate survives only
   TRANSIENTLY and LOCALLY at each emit position, never as a persistent output tree, never as a separate
   visitor or serialize pass. The pass IS the traversal, so a visitor needs no traversal of its own —
   this is what lets the whole-tree `Visitor`/`TreeVisitor` framework and the `preSerializeRoot` seam
   collapse to a per-node hook. The surface is scoped to what REAL published Less plugins actually use
   (inspect / replace), not full-4.x fidelity (§6).
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

## 6. The Jess visitor model — the pruned minimum, with less-compat as the working proof (ruling 5, OWNER-RESOLVED; PRUNED 2026-07-08)

**Owner directive (settled).** Visitors were RARELY used in Less. Make the pattern usable —
lightweight, just enough to be sane AND just enough to support the less-compat plugin as a PROOF that
it works — and push everything else OUT of core. The bar is **"just enough to be sane + prove
less-compat works."** Anything beyond that is building too much into Jess; when unsure, cut from core.

**Two evidence sources drive the pruning — this is a bottom-up cut, not a top-down spec:**

1. **The real bridge** (`packages/jess-plugin-less-compat/`). What less-compat ACTUALLY does is a
   single plain-object visitor with ONE generic `visit(node)` entry (`plugin.ts:1136`) that adapts the
   node to a `less.tree` view (`toLessNode`, `plugin.ts:1194`), runs the registered Less visitors, and
   converts any replacement back (`fromLessNode`, `plugin.ts:1247`). It never registers per-type
   methods on the core side, never uses an exit method, never uses a skip-children signal, and drives
   its OWN child walk internally (`less-compat-structures.ts:60,121` — `node.accept` over the adapter).
2. **The published-plugin audit** (`docs/investigation/scanner-first-parser-jess-assessment.md:2124–2166`).
   Public Less visitor plugins are rare. Of the sampled real, published packages:
   - `less-plugin-rtl` — a *replacing* visitor over declaration/value shapes; enter only, no removal, no
     skip-children (`:2132–2139`).
   - `less-plugin-inline-urls` — a *pre-eval* replacing visitor that touches `Rule` **enter/exit**
     state and rewrites `Url`/value islands (`:2140–2144`). This is the ONLY sampled plugin using an
     exit edge, and it is pre-eval.
   - `less-plugin-dls` — inspects `root.variables()` and patches `genCSS`; **no typed `visit*` hooks**
     (`:2145–2149`).
   - `clean-css`, `autoprefix`, `npm-import`, `glob`, `css-modules`, `rewrite-import` — postprocessors,
     preprocessors, or file managers; **no AST visitor at all** (`:2150–2155`).

   So the real-plugin operation set is: **inspect a node, optionally replace it.** Node *removal*,
   *skip-children*, and *multi-visitor chaining* have NO real published-plugin usage. Only
   `inline-urls` exercises an exit edge, and only on pre-eval.

**Consequence: less-compat is a CONSERVATIVE bridge scoped to observed real-plugin usage — NOT
full-4.x-fidelity.** It need not bridge the entire 4.x visitor matrix; it bridges the minimal common
operation (inspect / replace) plus the two features a concrete published plugin is shown to need
(exit-state for `inline-urls`, pre-eval lifecycle for `inline-urls`). Everything else in the 4.x
visitor surface is DROPPED from BOTH layers. This shrinks the core surface AND the less-compat surface.

### 6.1 The pruned core visitor contract (generic, core-owned, Less-agnostic)

The contract lives in `@jesscss/core` and is complete and testable with zero Less knowledge.

**Final signature.**

```ts
type NodeVisitor = (node: Node, ctx: VisitContext) => Node | void
```

That is the WHOLE core contract. A visitor is a function the pass fires at each node, after that
node's own eval/emit shape is produced and before it serializes.

**Return semantics — exactly two cases (this is the sane minimum, §item 1):**
- **`void` / `undefined`** → node unchanged; the same shape flows to serialize. (Output-invisible
  in-place annotation is separately governed by ruling 1 — see §6.4.)
- **a `Node`** → REPLACEMENT; the returned node is what serializes. This is `fn.call(this, n, ctx) ?? n`
  — the semantics core's `Visitor._visit` already implements (`visitor/index.ts:144-150`).

There is **no `REMOVE` and no `ABORT` in the core return vocabulary** (see the KEEP/DROP table, §6.6).
`NodeVisitReturn`/`REMOVE`/`ABORT` (`node-base.ts:64-66`) are no longer part of the visitor surface;
the return type narrows to `Node | void`. (`REMOVE`/`ABORT` may remain as internal core symbols for
other machinery, but they are NOT exposed to visitors and NOT part of this contract.)

**Context — the smallest bundle that lets less-compat build its `less.tree` adapter (§item 7):**

```ts
interface VisitContext {
  frame: ScopeFrame       // the live value-frame (top of the §2 stack)
}
```

- the live **value-frame** — so a visitor, or a custom function it calls, resolves values / inspects
  scope against the SAME bindings leaf resolution uses (§2). This is what `less.functions` custom
  functions need to run against live bindings (`plugin.ts` function-registry path).

Nothing else. The context carries NO structural-stack handle, NO output-writer handle, NO
`visitDeeper` flag, NO Less-specific view, NO consumer identity. The node passed as the first argument
is the placement-context node the pass already stands on; less-compat adapts THAT one node to a
`less.tree` view (`toLessNode`) and drives its own child adaptation lazily via its adapter's `accept`
(`less-compat-structures.ts:121`) — it does not need core to hand it ancestry, a writer, or a descent
flag. The earlier design's structural-stack + writer + `visitDeeper` fields are all dropped from `ctx`
(§6.6) because neither the bridge nor any sampled plugin reads them.

### 6.2 Hook edges — ONE (enter) in the baseline; EXIT kept only because one real plugin needs it

The owner's "after eval AND before serialize" is a per-node WINDOW. The pruned model exposes:

- **enter (post-shape, pre-children)** — the baseline and only universally-fired edge. The node's own
  shape is settled (value resolved, selector composed, extend contributions projected); children not
  yet serialized. A visitor sees the node at its settled own-shape and may replace it. This single edge
  carries `less-plugin-rtl` (`:2132`), `less-plugin-dls` (`:2145`), and the entire "inspect / replace"
  common case — i.e. the whole proof except one plugin.

- **exit (post-children, pre-close)** — KEPT ONLY BECAUSE THE PROOF NEEDS IT.
  `less-plugin-inline-urls` "touches `Rule` enter/**exit** state" (`:2141`). That is a real, published
  plugin, so dropping exit would break the compat proof for it. Exit is therefore retained — but as an
  OPTIONAL edge: a visitor exposes exit only if it needs it; if none is registered, the pass fires
  nothing at exit (zero cost). Concretely, the registration takes an optional pair:

  ```ts
  registerVisitor(enter: NodeVisitor, opts?: { exit?: NodeVisitor })
  ```

  Most visitors pass only `enter`. less-compat passes `exit` only if the wrapped Less visitor declares
  enter/exit state (the bridge already knows this from the Less visitor object).

**Per-type dispatch is NOT a core edge.** Core fires one generic `enter` (and optional `exit`) per
node, keyed on nothing. The `type → visitX` fan-out is done by the CONSUMER inside its own `enter`
(switch on `node.type`), exactly as the bridge does today (`visit${nodeType}` build,
`less-compat-structures.ts:70`, incl. the v2 `Directive→AtRule` / `Rule→Declaration` aliases,
`:76-91`). Core owes no per-type registration table.

### 6.3 SIMPLIFY — the whole-tree walk machinery is deleted (unchanged verdict, now with a smaller keep-set)

Today Less runs visitors as their OWN whole-tree walk(s): core's `TreeVisitor`
(`visitor/index.ts:192-263`) is an auto-walk that calls `n.walk(...)`, tracks `visitedNodes`, honors
`accept()`; the `preSerializeRoot` seam (`rules.ts:4795-4809`, `print.ts:69`) runs a
`(evaluatedRoot) => Rules | void` hook ONCE over the whole evaluated tree to give plugin visitors a
tree to walk. **In the unified pass the walk already happens**, so a visitor needs no traversal, no
`visitedNodes` bookkeeping, no `accept()` recursion, no root hook.

**DELETE (unnecessary under the pass):**
- **`TreeVisitor`** (`visitor/index.ts:192-263`) — the whole auto-walk / `visitChildren` /
  `visitedNodes` / `accept()`-recursion machinery. The bulk of the current visitor code.
- **The `preSerializeRoot` whole-tree seam** (`rules.ts:4795-4809`, `print.ts:69`) — its sole purpose
  was handing plugins a materialized post-eval tree to walk; with eval+emit unified the hole is gone.
- **The self-driven `Visitor.visit(n): Node` driver** (`visitor/index.ts:162-182`) — no self-driven
  descent under the pass.

**KEEP as the minimal core:**
- The **`(node, ctx) => Node | void`** shape and its two-case (void / replace) semantics (§6.1).
- The **enter edge** always; the **exit edge** as an optional registration (§6.2, kept for the
  `inline-urls` proof).
- A **trivial ordered list of registered visitors** the pass iterates per node (§6.5). This is the one
  genuinely new (tiny) piece, because today visitors are handed in ad hoc via `preSerializeRoot`.

**Verdict:** still a NET SIMPLIFICATION, now strictly smaller than the previous §6: we delete the
whole-tree walker + root seam + self-driven driver AND we drop `REMOVE`, `ABORT`, `visitDeeper`, the
structural-stack/writer context fields, and the multi-visitor chaining logic from the core surface.
What remains is "a registered `(node, ctx) => Node | void` callback the pass fires at enter (and,
optionally, exit)."

### 6.4 Interaction with the shape / canonical-mutation model (ruling 1)

Two visitor effects map onto the two sides of the loosened invariant (ruling 1):
- **Returns a NEW node** = an OUTPUT-AFFECTING change → the fresh-transient-shape path (§6.1). The
  visitor MUST NOT mutate the shared canonical node in a byte- or reuse-affecting way; it produces a
  fresh local object for this emit position, serialized then released. Identical to eval producing a
  fresh transient. `less-plugin-rtl`'s declaration/value replacements (`:2137`) and `inline-urls`'s
  `Call("data-uri", …)` construction (`:2142`) both take this path.
- **Returns VOID but annotates output-invisibly** (a cached projection, a bookkeeping flag) MAY mutate
  the canonical node in place per ruling 1, PROVIDED the annotation changes neither re-serialization
  nor reuse elsewhere.

Rule of thumb: **change the output ⇒ return a new node; observe/invisibly-cache ⇒ return void.** Same
discipline as the rest of the pass; visitors introduce no new invariant.

### 6.5 Registration and ordering — a trivial list, NOT a chaining framework

- **Registration.** `@jesscss/core` exposes `registerVisitor(enter, { exit? })` that appends to an
  ordered list held on the render/compile context. No auto-registration; the list is empty unless a
  caller registers.
- **Ordering.** Deterministic registration order. The pass iterates the list at each node, threading
  the current shape through: `shape = visitor.enter(shape, ctx) ?? shape`. A `Node` return re-seats
  `shape` for the next visitor; exit edges (if any) fire after children.
- **NO chaining semantics beyond that.** The previous §6 specified `REMOVE` short-circuit, `ABORT`
  continue-others, and LIFO exit as a registry option. All DROPPED: no sampled plugin returns a removal
  or a skip-children signal, and less-compat registers exactly ONE core visitor
  (`beforeEvalVisitor`/`visitor` getter returns a single `PluginVisitor`, `plugin.ts:135,304`). The
  MULTI-visitor chaining that DOES occur — iterating several Less visitors over one node
  (`plugin.ts:1210-1242`) — happens ENTIRELY INSIDE the bridge's single core visitor, on the Less side,
  and never surfaces to core. Core needs a list only so a native Jess visitor and a compat visitor can
  coexist; it does not need chaining/short-circuit/priority machinery.

### 6.6 KEEP / DROP / PUSH-OUT — the decision table

| Element (prior §6) | Verdict | Reason (with citation) |
|---|---|---|
| **Signature `(node, ctx) => Node \| void`** (replace / unchanged) | **KEEP (core)** | The sane minimum. Covers the entire real-plugin operation set: "inspect a node, optionally replace it" (audit `:2129–2155`). Baseline contract. |
| **`REMOVE` return** | **DROP from core → PUSH to consumer** | No sampled published plugin removes a node (`rtl` and `inline-urls` both *replace*; `dls` only inspects — `:2132–2149`). A consumer that truly wants to drop a node returns an invisible/Nil node, which already serializes to nothing. The bridge's one internal `REMOVE` (`plugin.ts:1235`, fired when a *replacing* Less visitor returns `undefined`) maps to "return a Nil/invisible node" on the bridge side — it never needs a core removal signal. Core's `REMOVE` symbol leaves the visitor contract. |
| **`ABORT` / `visitDeeper:false` (skip children)** | **DROP from core** | NO sampled plugin uses skip-children (audit `:2129–2166`). `visitDeeper` in the bridge is purely BRIDGE-INTERNAL: it gates the bridge's own `LessAdapterBase.accept` walk over the adapted `less.tree` view (`less-compat-structures.ts:49–52,60,121`), driven on the Less side, never a core skip signal. Core supplies the traversal; there is nothing for a core `ABORT` to skip. |
| **enter/exit BOTH edges** | **enter KEEP (core); exit KEEP-ONLY-FOR-PROOF (optional)** | enter carries `rtl`, `dls`, and the whole inspect/replace common case. exit is retained solely because one real published plugin, `less-plugin-inline-urls`, "touches `Rule` **enter/exit** state" (`:2141`). Made OPTIONAL: fired only if a visitor registers it; zero cost otherwise. |
| **Per-type dispatch (`visitRuleset`…)** | **PUSH to consumer (already)** | The consumer switches on `node.type` inside its own `enter` (`less-compat-structures.ts:70`, v2 aliases `:76-91`). Core owes no per-type table. Confirmed. |
| **Multi-visitor chaining / ordering / priority** | **DROP to a trivial list (core); real chaining PUSHED to consumer** | less-compat registers exactly ONE core visitor (`plugin.ts:135,304`). The multi-Less-visitor iteration lives inside that single bridge visitor (`plugin.ts:1210-1242`) on the Less side. Core keeps only a bare ordered list so native + compat visitors coexist — no short-circuit/`REMOVE`/`ABORT`/LIFO machinery (§6.5). |
| **Context: value-frame** | **KEEP (core)** | Needed so `less.functions` custom functions resolve against live bindings, exactly as leaf resolution does (§2, §6.1). |
| **Context: structural stack (ancestry / `composedSelectorStack`)** | **DROP from core** | Neither the bridge nor any sampled plugin reads core-supplied ancestry; the bridge builds its own view from the single node via `toLessNode`/`accept` (`less-compat-structures.ts`). If a future plugin needs ancestry, it is added then — not speculatively. |
| **Context: output writer/buffer handle** | **DROP from core** | The normal (and only observed) path is return-a-node; no sampled plugin emits bytes directly. Drop the writer affordance; re-add only if a concrete plugin needs it. |
| **Context: `visitDeeper` descent flag** | **DROP from core** | Bridge-internal only (see `ABORT` row). Not a core affordance. |
| **`TreeVisitor` whole-tree walker** | **DELETE** | The pass IS the walk (§6.3). |
| **`preSerializeRoot` root seam + self-driven `Visitor.visit` driver** | **DELETE** | No materialized post-eval tree exists to hand a walker (§6.3). |
| **Pre-eval visitor pre-pass (`beforeEvalVisitor`)** | **KEEP-FOR-PROOF (separate pre-pass, owner call)** | `less-plugin-inline-urls` is a **pre-eval** replacing visitor (`:2140`). The single pass cannot host pre-eval by construction (§6.7). Retained as the existing cheap structural pre-walk, feeding the SAME contract. Owner decides whether to keep pre-eval compat at all. |

### 6.7 less-compat as the working proof under the reduced surface

less-compat still works, and proves the contract, entirely by registering ONE generic Jess visitor
whose `enter` (and, for `inline-urls`, `exit`) bridges to the Less plugin visitors — which is what the
bridge already is (`plugin.ts:1136` `visit`, `:1194` `toLessNode`, `:1247` `fromLessNode`). What the
bridge now does ITSELF vs gets from CORE, under the pruned surface:

**From core (the whole core surface it consumes):**
- the **node** at its settled shape, at the **enter** edge (and **exit** for `inline-urls`);
- the **live value-frame** in `ctx`, so wrapped `less.functions` resolve against live bindings.

**On the bridge side (everything else — this is where the conservative scope lives):**
- **`less.tree` node view** — built inside the bridge's `enter` via `toLessNode` on the ONE handed
  node; children adapted lazily via the adapter's own `accept` walk (`less-compat-structures.ts:60,121`).
  Core never materializes a subtree.
- **per-type `visitRuleset`/`visitDeclaration`/… dispatch** — switch on `node.type` inside `enter`
  (`less-compat-structures.ts:70`, v2 aliases `:76-91`).
- **removal** — a replacing Less visitor returning `undefined` (`plugin.ts:1234`) maps to the bridge
  returning a **Nil/invisible node** (which serializes to nothing), NOT a core `REMOVE`. The bridge
  owns this translation.
- **skip-children (`visitDeeper:false`)** — handled entirely by the bridge's own adapter walk
  (`less-compat-structures.ts:49-52`); never surfaced to core. (No sampled plugin sets it anyway.)
- **multi-Less-visitor iteration + `@plugin`-inserted visitors** — the iterator loop inside the single
  bridge visitor (`plugin.ts:1210-1242`); invisible to core.
- **`isReplacing`** — a Less-side concept the bridge resolves before deciding whether to return the new
  node or void (`less-compat-structures.ts:105,111`); never a core concept.

**The proof it discharges:** a real published plugin (`less-plugin-rtl`) that inspects and replaces
declaration/value nodes runs through the enter-only path; a real published plugin
(`less-plugin-inline-urls`) that needs enter/exit state and pre-eval runs through the optional exit
edge plus the retained pre-eval pre-pass; custom functions resolve against the `ctx` value-frame. That
is the full observed real-plugin operation set, served by `Node | void` + value-frame + optional
exit + pre-eval pre-pass — and nothing more.

Because less-compat is a **conservative bridge** (scoped to observed real-plugin usage, §intro), it
does NOT claim full 4.x visitor fidelity. Any 4.x capability with no demonstrated published-plugin
usage (node removal as a core signal, skip-children as a core signal, generic multi-visitor chaining
in core, structural-stack/writer context) is intentionally NOT bridged and documented as unavailable
rather than simulated — matching the audit's own policy note (`:2156-2166`: "Unsupported leaf hooks
should be documented as intentionally unavailable rather than simulated").

### 6.8 Package boundary — core owns the generic API, `less` owns the compat consumer (unchanged)

- The generic registration API (`registerVisitor`, the `(node, ctx) => Node | void` contract, the
  enter/optional-exit edges, the trivial list) lives in `@jesscss/core`, complete and testable with
  ZERO Less knowledge. Core exposes only node + value-frame + return-a-node; it MUST NOT expose a
  Less-specific hook or bake in `less.tree`/`less.functions` shapes.
- The less-compat visitor is registered by the `less` package (the 4.x-compat facade). For jess,
  less-compat is an OPTIONAL SIDE DEPENDENCY: jess never imports or auto-registers it. The native-Jess
  visitor story stands alone.
- Any capability the bridge needs is framed as a GENERAL `VisitContext` affordance (node + live frame)
  that less-compat HAPPENS to use to build a `less.tree` adapter on its own side — never a Less-branded
  core API.

### 6.9 Pre-eval visitors — the one residual owner call (narrowed)

Less 4.x lets a plugin flag `isPreEvalVisitor` to run BEFORE eval. Jess already HAS this as a separate
whole-tree pre-pass — `beforeEvalVisitor` / `beforeEvalVisitorForTree` (`plugin.ts:135,281`), driven by
`applyBeforeEvalVisitors` (`packages/jess/src/index.ts`). The unified pass subsumes the POST-eval side
(all of §6.1–§6.8) but CANNOT subsume pre-eval by construction: it resolves-and-emits in one downward
step, so there is no "un-evaluated whole tree" moment mid-pass for a pre-eval visitor to observe.

This matters for the proof because `less-plugin-inline-urls` is a real, published **pre-eval** replacing
visitor (audit `:2140`). Options:
1. **Keep the pre-eval pre-pass as-is** (RECOMMENDED) — a cheap structural pre-walk over the
   un-evaluated tree, orthogonal to the eval/emit fold, feeding the SAME `(node, ctx) => Node | void`
   contract at a different lifecycle point. Preserves `inline-urls` compat.
2. **Drop pre-eval visitor support in v5** — one hook lifecycle, but a compat regression for
   `inline-urls` and any 4.x plugin using `isPreEvalVisitor`.

**Recommendation: option 1**, with the owner deciding whether pre-eval compat is worth the extra
pre-pass given how few plugins use it. This is the only residual open item; the entire post-eval side
is settled.

### 6.10 Sourcemaps and the net reduction

Sourcemaps are unchanged from §2.4: the writer attributes each chunk to the source node the traversal
stands on (canonical for static, or a transient's carried origin for changed/visitor-replaced nodes).
No persistent output tree is forced.

**Net:** the pruned core visitor surface is: **one signature `(node, ctx: { frame }) => Node | void`,
fired at enter (always) and exit (optional, kept only for the `inline-urls` proof), threaded through a
trivial ordered list.** Deleted vs the prior §6: `REMOVE` from the return type, `ABORT`/`visitDeeper`
entirely, the structural-stack and output-writer context fields, and the multi-visitor
chaining/short-circuit/priority machinery — on top of the already-planned deletion of `TreeVisitor`,
`preSerializeRoot`, and the self-driven `Visitor.visit` driver. less-compat proves the reduced surface
with two real published plugins (`rtl` via enter; `inline-urls` via optional-exit + the retained
pre-eval pre-pass) and handles removal, skip-children, per-type dispatch, and multi-Less-visitor
chaining ENTIRELY on its own side. Residual open item: pre-eval (§6.9).

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
- The PRUNED visitor CONTRACT — `(node, ctx: { frame }) => Node | void` (replace / unchanged only;
  reuses core's `fn(n,ctx) ?? n` semantics at `visitor/index.ts:144-150`) with an always-fired **enter**
  edge and an OPTIONAL **exit** edge — survives as the core-owned per-node hook (§6.1–§6.2); only its
  INVOCATION changes (fired by the pass, not self-driven). `REMOVE`, `ABORT`, and `visitDeeper` are NOT
  in the core visitor surface (§6.6).
- The pre-eval visitor pre-pass (`beforeEvalVisitor` / `applyBeforeEvalVisitors`) — retained as a
  separate structural pre-walk outside the unified pass (kept because `less-plugin-inline-urls` is a
  real pre-eval plugin; §6.9, owner decision pending).
- The less-compat consumer's NEEDS (`less.tree` node view, `less.functions` registry, per-type
  dispatch, removal-as-Nil, skip-children, multi-Less-visitor chaining, `isReplacing`) — satisfied by
  registering ONE generic Jess visitor from the `less` package and handled ON THE BRIDGE SIDE (§6.7);
  the CAPABILITY survives even though core no longer owns any Less-specific
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
  tree-walkers; the pass IS the walk. (The pre-eval `beforeEvalVisitor` pre-pass is NOT deleted — §6.9.)
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
  this is also what makes interpolated extend targets actually work. When building it, use Less 4.x only
  to affirm BEHAVIOR — does the interpolated target extend, what does it match — NOT output shape: Jess
  emits `:is()` and supports nesting, so the SHAPE is the v5/alpha form, not 4.x's expansion.)

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

- **OQ-F — RESOLVED + PRUNED (§6).** The visitor surface is the pruned-minimum core-owned per-node
  hook — `(node, ctx: { frame }) => Node | void` (replace / unchanged only), fired at an always-on
  **enter** edge plus an OPTIONAL **exit** edge, post-shape/pre-serialize, in traversal order
  (§6.1–§6.5). less-compat is ONE downstream consumer registered by the `less` package (§6.7), never a
  core-known special case; core carries no Less semantics (§6.8). Scoped to what REAL published plugins
  use (audit `scanner-first-parser-jess-assessment.md:2124–2166`): the operation set is "inspect /
  replace." DROPPED from core vs the earlier design: `REMOVE` (removal → a consumer returns a Nil node),
  `ABORT`/`visitDeeper` (skip-children is bridge-internal, no plugin uses it), the structural-stack and
  writer context fields, and the multi-visitor chaining/short-circuit/priority machinery (§6.6). Still a
  NET SIMPLIFICATION beyond the prior §6: the whole-tree `TreeVisitor` walker + `preSerializeRoot` seam
  are deleted because the pass already walks (§6.3), and the return/context/chaining surface is narrowed
  on top. RESIDUAL for the owner: **pre-eval visitors** — the existing `beforeEvalVisitor` pre-pass
  cannot fold into the single pass; keep it as a separate structural pre-walk (recommended, needed for
  the real pre-eval plugin `less-plugin-inline-urls`) or drop v5 pre-eval compat (§6.9). The
  whole-tree **mutate-then-observe** pattern remains unserved by the per-node model; no sampled published
  plugin needs it, so it is not built. The common cases (per-node inspect/replace, custom-function value
  resolution, `rtl`/`inline-urls`/`dls`) are fully served.

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
