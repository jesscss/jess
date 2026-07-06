# `inherit` mutation investigation — feasibility + design

**Branch:** `work/inherit-mutation-investigation` (off dev `52851e9c7`). READ-ONLY design; no core
logic changed.

**Question (from `FLAG-WALK-DELETION.md`, "REASSESSMENT after Phase B"):** the reuse gates
(`canReuseAsLeaf`/`reuseAsLeaf`, `!F_NON_STATIC`) + the `F_STATIC`/`F_NON_STATIC`/`F_HAS_NODE_CHILD`
bubble delete **only if** placement stops mutating shared nodes. The last remaining node-mutator is
`inherit`. Can its mutations move OFF the node (into the frame / placement record / read-time
context) so that `inherit` becomes non-mutating and every node can be shared?

**Bottom line up front:** **Partially feasible, but it does NOT cleanly unlock the reuse-gate
deletion, and the cost is disproportionate.** `inherit`'s mutations split into two regimes. The
common regime (fresh-receiver) is *already safe* and is not what forces copies. The rare regime
(shared-receiver: collapse-survivor, extend materialization) mutates a node it does not own — but the
value it stamps (source span + provenance/extend flags) is **intrinsic to the placement identity of
that specific output node**, not contextual to a frame, and the readers consume it at
**render/serialize time** off `this`, not off any frame. Threading it off-node would require giving
the serializer a per-placement "which output am I printing" record for *every* node on the render
walk — which is a strictly larger rebuild than the copy it removes. Recommendation: **do not pursue
a non-mutating `inherit` as the lever.** Instead close the 2–3 shared-receiver sites by having them
allocate a thin fresh wrapper (they already logically produce a new output node) so `inherit` only
ever writes fresh nodes — that removes the "placement mutates a shared node" hazard at those sites
without a frame rework, and is the realistic path to the reuse-gate/flag deletion.

---

## 0. The regime split (the finding that reframes the whole question)

`inherit(node)` is `this.inherit(source)` — `this` is the node that will REPLACE `source`; `source`
is what it replaces. Grepping all ~90 call sites, they fall into two regimes:

- **Fresh-receiver (≈95% of sites):** `new X(...).inherit(this)` /
  `SelectorList.create(...).inherit(src)` / `derived.inherit(this)` where `derived` is a fresh
  `_deriveShell`. The receiver is a brand-new, unshared, unfrozen node. Examples:
  `dimension.ts:84`, `operation.ts:*`, `quoted.ts:42`, `paren.ts:104`, `rules.ts:1236` (derive),
  every `ampersand.ts`/`interpolated.ts` site. **These mutations touch a node nobody else holds —
  they are safe under always-share and are NOT what forces any copy.** `inherit` here is just
  "stamp source provenance onto the eval result so it maps back to source." It is the RIGHT design.

- **Shared-receiver (2 sites, the B4 class):** the receiver is a node drawn from an existing
  (possibly frozen/shared) tree, and `inherit` mutates *it in place*:
  - `selector-complex.ts:367` — `finalizeSingleComponent`: `return only.inherit(this)` where `only`
    is the single surviving component pulled out of `this.value`.
  - `util/extend.ts:1032` (and the `copySelectorForExtend(...).inherit(el)` family) — extend
    materialization stamps `F_EXTENDED`/`F_EXTEND_TARGET`/`F_GENERATED` onto placed selectors.
    (These already copy first via `copySelectorForExtend`; `extend.ts:3467`-class in the plan note.)

**This is why the copies exist.** The shared-receiver sites must copy the source first, precisely so
that `inherit`'s in-place stamp lands on a private node instead of corrupting the shared tree. So the
question "can `inherit` be non-mutating" is really "can the *shared-receiver* sites stamp their
provenance/flags without a private copy."

---

## 1. Per-mutation table

For each field/flag `inherit` writes: what it writes, who reads it, WHEN, and whether the value is
intrinsic to the node or contextual to the placement.

| # | mutation (line) | write kind | who reads | WHEN read | intrinsic vs contextual | classification |
|---|---|---|---|---|---|---|
| 1 | `setParent(this, node.parent)` (1397) | **guarded by `!frozen`** — frozen node keeps its own parent (`this.parent ?? node.parent`) | `sourceRootOf` walk, scope/lookup ancestor climbs | eval-time | already-handled | **already-handled (B2 frozen seam)** — a shared/frozen node is never reparented here; this is exactly the `adopt` `if(!node.frozen)` mechanism B2 relies on. Not a blocker. |
| 2 | `setSourceSpan(this, sourceSpanOf(node))` — `_spanStart`/`_spanEnd`/`F_HAS_SPAN` (1401) | **UNCONDITIONAL overwrite** | `spanStartOf(origin)` in `print.ts:197` (`sourceSegmentFor`); `sourceSpanOf` in ~35 serializers passing `this` as `origin` to `writer.add` | **render/serialize time** (sourcemap) + a few eval-time diagnostics | **intrinsic to the output node** | **intrinsic-must-stay** (see §2) |
| 3 | `_sourceRoot ??= node.sourceRoot` (1402) | `??=` (write-once) | `sourceRootOf`; sourcemap `origin.sourceRoot._treeContext` (`print.ts:201`); scope | eval + render | intrinsic; **no-op on a populated shared node** | already-handled (`??=` never overwrites a shared node's existing root) |
| 4 | `_treeContext ??= node.sourceRoot?._treeContext` (Rules only, 1404) | `??=` | sourcemap file lookup (`print.ts:201-204`); tree-context registration | render | intrinsic; no-op on populated node | already-handled (`??=`) |
| 5 | `removeFlag(F_VISIBLE)` if source hidden (1408-1410) | conditional write | ~10 files (`call.ts`, `nil.ts`, `reference.ts`, `at-rule.ts`, `condition.ts`, `import-style.ts`, …) | eval + serialize (visibility gating) | **contextual-ish** but tracks the *result's* own visibility | **intrinsic to the output node** — F_VISIBLE says "does THIS produced node render"; it is a property of the eval result, not of a frame |
| 6 | `addFlag(F_IMPLICIT_AMPERSAND)` (1413) | conditional write | `extend.ts`, `ampersand.ts`, `util/extend.ts`, `node-base` | eval (selector composition) + extend-apply | intrinsic to the selector's identity | **intrinsic-must-stay** |
| 7 | `addFlag(F_EXTENDED)` (1416) | conditional write | `selector-list.ts`, `ruleset.ts`, `serialize-helper.ts`, `extend-walk.ts`, `extend-roots.ts`, `util/extend.ts` | extend-apply + **serialize** (reference-mode output filter) | intrinsic to the placed selector | **intrinsic-must-stay** |
| 8 | `addFlag(F_EXTEND_TARGET)` (1419) | conditional write | `selector-list.ts`, `ruleset.ts`, `extend-walk.ts`, `util/extend.ts` | extend-apply + serialize (suppress target in ref mode) | intrinsic to the placed selector | **intrinsic-must-stay** |
| 9 | `this.flags |= node.flags & F_GENERATED` (1425) | **unconditional OR** (never clears) | `interpolated.ts`, `ruleset.ts`, `selector-pseudo.ts`, `selector-analysis.ts`, `extend-walk.ts`, `extend-roots.ts`, `util/extend.ts` | eval (selector gen) + serialize (`:is()` unwrap, generated-selector handling) | intrinsic — "was this node produced by eval vs authored" | **intrinsic-must-stay** |
| 10 | `index ??= node.index` (1430) | `??=` | scope lookup-start-index (`reference.ts:303/310/324`, `scope-frame.ts:440/611`, `rules.ts:4837/5493`) | **eval-time** (declaration visibility ordering) | intrinsic (source position identity); no-op on populated node | already-handled (`??=`) |
| 11 | `_closureScope ??= node._closureScope` (1436-1439) | `??=` | `reference.ts`, `rules.ts`, `call.ts`, `callable-args.ts` (detached-ruleset closure identity) | eval | intrinsic; no-op on populated node | already-handled (`??=`) |
| 12 | Selector.inherit per-child `adopt(item)` (selector.ts:126/131) | `adopt` = `setParent` **guarded by `!frozen`** | selector structure walks | eval + extend | already-handled | **already-handled (B2 frozen seam)** — B2 already made this share via `shareChildren`+freeze. |

### What the table shows

- **Rows 1, 3, 4, 10, 11, 12 are already non-mutating for a shared node.** Parent + per-child adopt
  are guarded by `!frozen` (the B2 seam); `_sourceRoot`/`_treeContext`/`index`/`_closureScope` are
  `??=` write-once, which are pure no-ops when the receiver is an already-populated shared node.
  These do **not** force any copy.
- **The irreducible in-place writes on a shared node are rows 2, 5, 6, 7, 8, 9** — the **source span
  overwrite** and the **flag stamps** (`F_VISIBLE` clear, `F_IMPLICIT_AMPERSAND`, `F_EXTENDED`,
  `F_EXTEND_TARGET`, `F_GENERATED`). `frozen` does NOT guard any of these (confirmed:
  `node-base.ts:1401-1425` — no `frozen` check on the span/flag block). This is exactly the B4
  finding: "`inherit(owner)` mutates the node ITSELF with UNCONDITIONAL writes that `frozen` does not
  guard."

So the real question narrows to: **can rows 2 + 5–9 (span + flags) be threaded off the node?**

---

## 2. Can span + the flags thread off-node? — intrinsic, not contextual

The plan's hypothesis is that these are *contextual to the placement* (belong in the frame). The
readers say otherwise:

**Span (row 2) is read at SERIALIZE time off the node being printed.** Every serializer does
`writer.add(text, this)` (e.g. `any.ts:91`, `combinator.ts:40`, `at-rule-statement.ts:160`,
`bool.ts:46`), and `OutputWriter.markSource` → `sourceSegmentFor(origin)` reads `spanStartOf(origin)`
and `origin.sourceRoot?._treeContext` where `origin === this` (the node). There is **no frame on the
serialize path** — the render walk hands each node to the writer and the writer asks the node for its
span. For the span to live off-node, the writer would need, for *every chunk of every node*, a
"current placement record" telling it which source offset this output maps to. That is a per-node,
per-placement side-channel threaded through the entire serialize walk — strictly more machinery than
the copy it would remove.

Crucially, the span `inherit` stamps is **the source span of the node this output replaces** — i.e.
the produced node's job is to map back to *that* source location. That is a property of the OUTPUT
node's identity ("I am the eval result standing in for source offset N"), not of the enclosing frame.
Two different placements of the same shared source can legitimately want *different* provenance
(that's the whole reason extend copies before stamping `F_EXTENDED`). So the value is genuinely
**per-output-node**, which is exactly what a copy gives you and what a shared node cannot carry two
of.

**The flags (rows 5–9) are read at serialize + extend-apply time off the node.** `F_EXTENDED` /
`F_EXTEND_TARGET` gate reference-mode output filtering in `serialize-helper.ts` / `ruleset.ts` /
`selector-list.ts`; `F_GENERATED` gates `:is()` unwrap and generated-selector serialization;
`F_VISIBLE` gates whether the produced node renders at all. All read `this.hasFlag(...)` during the
render walk. Same structural problem: no frame is threaded to these read-sites, and — for extend —
the *same shared selector* is deliberately placed multiple times with *different* extend flags per
placement (the extend registry reuses the source across matches). One shared node physically cannot
hold two contradictory `F_EXTENDED` states. **This is the irreducible reason extend copies.**

**Verdict on threading off-node:** rows 2 and 5–9 are **intrinsic-must-stay**. They are per-output-node
identity, consumed at render time off the node, and in the extend case explicitly need to differ per
placement of the same source. Moving them to the frame does not model the requirement (a frame is
per-scope, not per-output-node) and would require a per-node placement record on the entire serialize
walk — a larger structure than the copies.

---

## 3. Verdict: is a non-mutating `inherit` feasible?

**No — not as a way to eliminate the copies.** A truly non-mutating `inherit` is only achievable by
relocating per-output-node provenance/flags to a per-output-node *record*. But a per-output-node
record that the serializer reads at print time IS a node (or a parallel shadow of one) — you have
re-created the copy under another name, and added the cost of plumbing it through every `writer.add`.
The copies at the 2 shared-receiver sites are not an accident of `inherit` being mutating; they exist
because **extend and single-component-collapse genuinely need a second, independently-flagged output
node for the same shared source.** That need is real regardless of where the flags are stored.

The fresh-receiver regime already realizes the ideal: `inherit` mutates only the fresh eval result,
never a shared node. Nothing there forces a copy.

---

## 4. What this means for the reuse-gate + flag-walk deletion

The REASSESSMENT chain was:
`propagateFlagsFrom → reuse gates → copies remain where placement MUTATES → inherit stamps the node.`

The investigation refines the last link: **placement mutation of a *shared* node happens at only 2–3
sites, and the stamped value is intrinsic (must be per-output-node), so those sites will keep
producing a distinct output node.** Therefore:

- **The reuse gates are NOT unblocked by making `inherit` non-mutating** (which isn't feasible as a
  copy-elimination lever). But note: the reuse gates (`canReuseAsLeaf`/`!F_NON_STATIC`) are about
  **leaf value sharing** (dimension/color/quoted share-vs-copy), which is a *different* copy family
  than the selector/extend copies `inherit` guards. The Step-0 audit already found value-tree deep
  copies are zero. The reuse gates today decide whether a *static leaf* is shared or defensively
  copied; that decision is gated on `!F_NON_STATIC + !F_HAS_NODE_CHILD`, not on `inherit`.
- So the honest picture: **`inherit`'s shared-node mutation is the blocker for the SELECTOR/EXTEND
  copy families (B4), not for the leaf reuse gates.** The reuse-gate deletion depends on the separate
  claim that a dynamic leaf is safe to share (values looked up at render) — which is the Phase D
  single-render-pass work, largely orthogonal to `inherit`.

---

## 5. Blast radius + recommendation

**Blast radius of a frame-relocation (the rejected path):** every serializer's `writer.add(text,
this)` (~35 files), the `OutputWriter` mapping path, the whole render walk (to thread a placement
record), plus extend-apply and reference-mode filters. Subsystems: **serialize, sourcemap, extend,
eval**. This is the single-largest coupled surface in the tree. Effort: multi-week, high regression
risk (sourcemap + reference-mode extend are exactly the fiddly, under-tested corners). **Not worth
it** — it rebuilds more than it deletes.

**Recommended path instead (small, gated):** neutralize the *shared-receiver* hazard without a frame
rework, by making the 2–3 shared-receiver sites hand `inherit` a **fresh node** — which they already
logically produce:

1. **`selector-complex.ts:367` (collapse-survivor).** `only` is the sole surviving component. It
   is already conceptually "the new collapsed selector." Wrap/shallow-copy it to a fresh node before
   `inherit`, OR route through the same `PlacementCloneOptions.shareChildren` freeze-share seam B2
   introduced (share children, fresh shell, stamp the shell). Gate: byte-identical +
   selector/extend suites green.
2. **`util/extend.ts` `copySelectorForExtend(...).inherit(el)` family — ALREADY SAFE (verified).**
   `copySelectorForExtend` = `copySelectorForPlacement` (`selector-utils.ts:4`), which returns
   `selector.cloneForPlacement({ reuseLeaves: false, shareChildren: true })` — a **fresh top shell**
   with **shared frozen children** (the B2 seam). So `inherit`'s span/flag stamps land on the FRESH
   shell top; the shared children are frozen so `adopt` skips them. `inherit` never mutates a shared
   node here. This copy is the *intrinsic per-output-node shell* that MUST exist to carry the
   per-placement `F_EXTENDED`/`F_EXTEND_TARGET` (extend places the same shared source under many
   matches, each needing its own flags). It is not removable and not a hazard. **Extend is not a
   blocker; only site (1) remains.**

If both shared-receiver sites are closed (fresh node before stamp), then **`inherit` only ever
mutates fresh nodes** — the "placement mutates a shared node" invariant violation is gone *without*
moving anything to the frame. At that point the copies that remain are the intrinsic per-output-node
extend/collapse copies (which must stay — they model a real second output), and the leaf reuse-gate
deletion proceeds on its own Phase D track (dynamic-leaf-share), independent of `inherit`.

**Recommended sequence (each gated byte-identical + core suite green ~2746/0):**

- **Slice I1 — DONE in this investigation (verified):** extend's `inherit` receiver is already a
  fresh `cloneForPlacement` shell (shared frozen children). Extend crossed off the blocker list.
- **Slice I2 — collapse-survivor fresh-node** (`selector-complex.ts:367`): reuse B2's
  `shareChildren` freeze-share seam so `only`'s children are shared but the stamped shell is fresh.
  Small, isolated, matches an already-proven mechanism.
- **Then:** re-evaluate the reuse gates against the Phase D dynamic-leaf-share work — `inherit` is no
  longer in that chain.

**Honest bottom line:** Making `inherit` *non-mutating by threading to the frame* is **not feasible
as a copy-eliminator** — the stamped span+flags are intrinsic per-output-node identity read at
serialize time off the node, and extend needs them to differ per placement, so relocating them
rebuilds more than it removes. What IS feasible and cheap is closing the 2 (likely 1) shared-receiver
sites so `inherit` only writes fresh nodes; that removes the shared-node-mutation hazard. But that
does **not by itself** delete the leaf reuse gates + `F_STATIC`/`F_NON_STATIC` — those hang on the
separate dynamic-leaf-share question (Phase D single render pass), which `inherit` turns out not to
gate. Recommendation: **pursue I1/I2 (cheap, correct), and stop treating `inherit` as the lever for
the reuse-gate/flag-walk deletion — that lever is Phase D, not `inherit`.**
