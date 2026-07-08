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
   computed values in DURING serialization; NEVER mutate the canonical source tree. The live eval
   frame stays threaded through emit.
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
LATER-visited selector must have its emit deferred until the fixpoint settles.

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

At a subject's emit position, its final `Or`-branch set (post-SOLVE) is projected to output:

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

### 4.4 `extendSelector` eliminated (ruling 2)

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

- **OQ-B — deferred subject emit / buffer ordering.** Because a subject's extend contributions can
  come from later-visited selectors, its final selector list is only known post-fixpoint. Does EMIT
  buffer per-subject and flush after the fixpoint (simple, a little memory), or does the walk emit
  authored form first and PATCH extend additions in (harder, streaming)? The extend doc's confluence
  invariant (EMIT sorts by document order) assumes a post-fixpoint sort, favoring buffer-then-flush.
  Confirm that is acceptable for streaming/large-file memory.

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
