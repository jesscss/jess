# Flag-Walk Deletion — audit & plan

**Goal:** achieve **zero copy-based eval** (owner invariant: nodes are ALWAYS shared — render
walks the shared body and looks up values against the frame; no per-placement node copy). Deleting
`propagateFlagsFrom` (`node-base.ts:684`) — the per-child flag-bubble crawl — is a CONSEQUENCE of
this, because the flags exist to serve the copy path. **Any copy-based eval that remains today is IN
SCOPE for this work to eliminate, not a dependency to wait on.** Every flag the walk computes is
then removable, measured-worthless, or re-scopable.

```js
// node-base.ts:684 — the walk we are killing
propagateFlagsFrom(node) {
  this.addFlag(F_HAS_NODE_CHILD);
  if (node.hasFlag(F_NON_STATIC)) { this.addFlag(F_NON_STATIC); this.removeFlag(F_STATIC); }
  else if (node.hasFlag(F_STATIC)) { this.addFlag(F_STATIC); }
  if (node.hasFlag(F_MAY_ASYNC))  { this.addFlag(F_MAY_ASYNC); }
  if (node.hasFlag(F_AMPERSAND) && this.type !== 'Rules') { this.addFlag(F_AMPERSAND); }
}
```

`F_CHILD_DERIVED` (`node-base.ts:299`) = the bubbled set `{F_MAY_ASYNC, F_STATIC,
F_NON_STATIC, F_AMPERSAND, F_HAS_NODE_CHILD}`; `clone()` copies these verbatim rather than
recomputing (node-base.ts:~1154).

---

## Verdict per flag

| flag | verdict | independence |
|---|---|---|
| `F_MAY_ASYNC` | **DELETE — go reactive** (measured neutral-to-faster) | independent, ship now |
| `F_HAS_NODE_CHILD` | **DELETE** — stale-prone cache, check `this.value` directly | independent, ship now |
| `F_AMPERSAND` | **RE-SCOPE to selectors** — off the general node walk | independent, ship now |
| `F_STATIC` / `F_NON_STATIC` | **remove readers, then DELETE the flags outright** — no legitimate keep-reader survives | staged; last |

Killing the first three empties the walk of everything except the static bit; the static
readers are all delete / relocate / value-check (none keeps the flag), so the flags AND the
bubble both go.

**ARCHITECTURAL INVARIANT (owner):** *nodes are ALWAYS shared.* A mixin renders by walking the
shared body and looking up values against the current frame as it serializes — no node ever gets
a private per-placement copy. Any code that decides "share vs clone" (the `!F_NON_STATIC` reuse
gate, `cloneForPlacement`, the "owned surface" comment) is a **mistake / pre-live-binding
remnant**, not a legitimate flag consumer. This is why `F_STATIC`/`F_NON_STATIC` has no
keep-reader: the one place it looked load-bearing (reuse) is itself cruft to remove.

---

## F_MAY_ASYNC — DELETE (go reactive)

**Measured (this session, jess-perf-walk, same-build A/B, medians of 3):** forcing
`F_MAY_ASYNC` on every node so all guards take the async-capable/reactive path —
collapse 240→246ms (within noise), **dynamic 132→122ms (faster)**. This is the CONSERVATIVE
case (the variant still pays the bubble); a real delete drops the bubble too. The sync
fast-path buys nothing, and on the eval-heavy workload it's a slight loss.

**Reads (~20, all `if (!hasFlag(F_MAY_ASYNC)) { <sync> } else { <async/MaybePromise> }`):**
`expression.ts:66`, `selector-list.ts:149/160`, `call.ts:648/665`, `paren.ts:203`,
`selector-complex.ts:268/279`, `selector-compound.ts:226/237`, `list.ts:87/348/449`,
`sequence.ts:78/437/550`, `negative.ts:78/126`, `node-base.ts:692/817`.

**Approach:** replace each guard with the reactive pattern — attempt sync, `isThenable`-check
each result, bail to the async continuation on the first thenable. The continuation machinery
already exists (`evaluateSelectorsRest` and the sync/async twins). Then drop `F_MAY_ASYNC`
from `propagateFlagsFrom`, from the constructors that set it (`Call`/`Reference`/`Control`/
`Interpolated`/`StyleImport`/`ImportJs`/`Extend`), and from `F_CHILD_DERIVED`.

**Gate:** byte-identical output on both benches + core suite green; bench neutral (per the A/B).

---

## F_HAS_NODE_CHILD — DELETE

The code already treats it as unreliable: comments at `node-base.ts:892` and `:1225` say the
flag "can be stale... test the value directly," and `import-style.ts:449` notes a case that
clears it. It's a cache of "does this node have node children," used ONLY in copy/clone:
`node-base.ts:1170` (`canReuseAsLeaf`), `node-base.ts:1225`, `util/cloning.ts:15`
(`canReuseLeaf`), `util/callable-binding.ts:8`.

**Approach:** its readers are the clone/reuse gates being deleted in Stage 3b (nodes are always
shared), so `F_HAS_NODE_CHILD` mostly deletes *with* them. Any residual reader outside the clone
path becomes a direct value inspection (does `this.value` contain a `Node`). Remove
`F_HAS_NODE_CHILD` from `propagateFlagsFrom` (line 685) and `F_CHILD_DERIVED`.

**Gate:** byte-identical; copy/clone tests green.

---

## F_AMPERSAND — RE-SCOPE to selectors

Every reader is selector/extend code: `selector-complex.ts`, `selector-compound.ts`,
`ampersand.ts`, `ruleset.ts`, `util/extend.ts`, `util/extend-walk.ts`, `util/extend-roots.ts`.
No value-node reads it. It has no business bubbling through the general node tree (the walk
even special-cases `&& this.type !== 'Rules'`).

**Approach:** compute ampersand-presence within selector construction/composition and expose it
on the selector types only (a ruleset asks its selector "do you contain `&`", answered locally).
Remove `F_AMPERSAND` from the general `propagateFlagsFrom` and `F_CHILD_DERIVED`. (This is a
re-scope, not a delete — the signal stays, just off the value-node walk.)

**Gate:** byte-identical; extend + ampersand tests green.

---

## F_STATIC / F_NON_STATIC — remove readers, then delete (staged)

`F_STATIC` = "no eval needed"; `F_NON_STATIC` = sticky "must eval," exclusive with F_STATIC
(`addFlag` clears/blocks — node-base.ts:633-640). Set by leaf constructors (dimension/color/
quoted/keyword/etc. → F_STATIC; paren/expression/operation/negative/condition/control/call/
reference/extend/interpolated/import → F_NON_STATIC), bubbled by the walk.

Reader classes (full per-line table in `packages/core/perf/F_STATIC_AUDIT.md`):

1. **Leaf eval-skip micro-opts (~25)** — `hasFlag(F_STATIC) ? this.value : this.value.eval()`
   in block/list/sequence/url/at-rule-statement/query-condition/declaration/selector-capture/
   at-rule. **DELETE** — once F_MAY_ASYNC goes reactive, these just fall into the reactive eval,
   which returns a static value unchanged. (Exception: `sequence.ts:547` is NOT a pure skip — it
   preserves a single-item Sequence wrapper; needs a "keep wrapper" guard in the eval path first.)
2. **Reuse/aliasing gates** — `canReuseAsLeaf` (node-base:1169) / `canReuseLeaf` (cloning.ts:12) /
   `canReuseStaticScalarLeaf` (callable-binding:6) use `!F_NON_STATIC` to decide "share vs clone."
   **DELETE — this whole decision is a mistake (owner invariant: nodes are ALWAYS shared).** The
   gate exists to guard the pre-live-binding copy path (`reuseLeaf` freezes+shares a *static* leaf,
   implying dynamic leaves get cloned instead). Under always-share, every source-free node is
   shared and its value is looked up at render — dynamic leaves included. So delete the reuse gates
   AND the clone/`cloneForPlacement`/"owned surface" machinery they guard; nothing needs to
   re-express, because the share-vs-clone question shouldn't exist. (This deletion also removes the
   sole readers of `F_HAS_NODE_CHILD` — see its section.) NOTE: verify the clone paths are actually
   dead vs still-hit-for-correctness in today's half-migrated eval before ripping — the invariant is
   the target; the tracing confirms how much copy-based eval remains.
3. **Registration/identity gating** — `_isStatic`/`_hasStaticName` (rules.ts:5267/5383/5388) drive
   eager-vs-deferred name registration in `_prepareRegistrationOnce`. **RELOCATE** to a
   construction-time name index (the north-star "registration is a construction-time index").
4. **Render-direct fast-path** — `canRenderStaticRulesDirectly`/`isPlainStaticRuleLeaf`
   (`util/static-rules.ts`; called rules.ts:4416, ruleset.ts:792/815, at-rule.ts:933). **DELETE**
   once `Rules.evalNode`'s structural work relocates (below). This is the LLM special-case that
   papers over eval doing structure on static input.
5. **Callable-guard semantics** — `callable-guard.ts`/`callable-candidate-execution.ts` use
   static-ness to decide a `when()` guard is a compile-time constant vs evaluated per candidate.
   **RE-EXPRESS** as a guard-local property, not a bubbled node flag.
6. **Type-guards** — `scope-frame.ts:450`, `reference.ts:187`, `url.ts` string-half guard `.eval()`
   being called on a raw string. **KEEP as a null/type check** (not a flag) — replace with a value
   type test.

**What blocks `Rules.evalNode` from short-circuiting F_STATIC (the render-direct delete):**
`_prepareForEval` does (a) registration/lookup-identity, (b) selector composition (`&`
substitution), (c) extend-gathering for walk-end `processExtends`, (d) root-only at-rule hoisting.
Each must move to the render walk (composition → ruleset-enter, writing the DEFERRED selector
slot; extend-gather → in-walk; hoist → top slot; registration → construction index). **This is
the single-render-pass rework** — the large, coupled piece.

---

## Dependency structure

```
INDEPENDENT (ship now, in parallel, gated byte-identical):
  Stage 1a  F_MAY_ASYNC   → reactive + delete            [measured safe]
  Stage 1b  F_HAS_NODE_CHILD → direct value check + delete
  Stage 1c  F_AMPERSAND   → selector-scope
  Stage 2   leaf F_STATIC eval-skips → delete (~25 sites; needs 1a first so the
            reactive eval is the fall-through)

COUPLED to the single-render-pass rework (larger, later):
  Stage 3a  registration gating → construction-time name index
  Stage 3b  reuse/aliasing gates + clone machinery → DELETE (always-share; no replacement signal)
  Stage 3c  callable-guard static semantics → guard-local property
  Stage 3d  render-direct fast-path → delete after Rules.evalNode structural work
            (composition/registration/extend/hoist) moves to the render walk

FINAL:
  Stage 4   delete F_STATIC / F_NON_STATIC (the flags themselves), F_CHILD_DERIVED, and propagateFlagsFrom
```

After Stage 1+2, `propagateFlagsFrom` bubbles ONLY F_STATIC/F_NON_STATIC (for the Stage-3
readers). After Stage 3, nothing reads them — every reader deletes, relocates, or becomes a value
check. Stage 4 deletes the flags and the walk entirely.

---

## Resolved: no keep-reader (owner invariant "nodes are always shared")

Earlier this was framed as an open decision — "if we delete F_STATIC, the reuse gate needs a
replacement signal." That framing was wrong: the reuse gate is a **mistake**, not a need. Nodes are
always shared and their values are looked up at render against the frame; there is no share-vs-clone
decision. So the reuse gate + clone/owned-surface machinery are deleted (Stage 3b) with no
replacement, and `F_STATIC`/`F_NON_STATIC` have no surviving keep-reader — the flags delete outright
(Stage 4). Any copy-based eval still present in the half-migrated tree is NOT a gate — it is part of
this work: the first step is to audit every clone/copy/reuse site in the eval path and eliminate
each (share instead of copy) until copy-based eval is zero. That elimination is what makes the clone
machinery, the reuse gates, and the static flags all fall away.

**STEP 0 (the roadmap): copy-site audit.** Classify every `clone` / `cloneForPlacement` /
`reuseLeaf` / `canReuseLeaf` / `deriveWithParts` / `ownRules`-style copy and every mixin/param
placement copy as: {already-dead | live copy → eliminate (how) | thin structural placement that
already shares its children}. That inventory is the ordered work-list to drive copy-based eval to
zero; the flag-walk deletion (Stages 1–4 above) is its tail.

### STEP 0 RESULT (done — `work/zero-copy-eval` off dev, no code changes needed)
**Deep value-tree copies are already ZERO on this branch.** Mixin/ruleset call placement does NOT
copy the body (`$for`/`$if` share it via `createIterationEvalSurface(share=true)`; `own*`/`withParts`
are constructor-time *shallow* ownership normalization that reuse leaves + share grandchildren).
`Node.clone` and `cloneForPlacement` are shallow surface wrappers that share value children. No dead
copy sites; nothing safely deep-copy→share convertible remains. The always-share invariant already
holds for value trees.

**THE SINGLE ROOT BLOCKER for the residual (shallow) copies:** `adopt()` → `setParent(node, this)`
at **`node-base.ts:669`**, gated `if (!node.frozen)`. A *frozen* (shared) node placed into a new
surface keeps its canonical parent — `adopt` skips the reparent, only flags propagate. Every
remaining shallow clone exists to produce a *frozen* node so this reparent is skipped; sharing an
UN-frozen source node would reparent the SOURCE and corrupt the shared tree. Copies forced by this:
selector COW, operation operands, ampersand/extend selector materialization, collapse-survivor.

**→ The one lever to reach zero copies:** make placement parenting **never reparent a source node**
— route placement parenting through the frame/binding layer so `adopt`/`parentChildren` never call
`setParent` on a source child. Then selectors/operations/extend share un-frozen children directly,
those 4 clone families delete, and the reuse gates + `F_STATIC`/`F_NON_STATIC` bubble die with them.
This IS the single-render-pass reparent rework — the big, coupled piece.

**NOT copies (stay regardless):** `$while` iteration body (genuine cross-iteration variable state —
`i = i+1`; needs isolated state until per-iteration state lives fully in the frame), and declaration
`+:` merge (`deriveWithParts`/rules.ts:5960/6112/6188 — constructs a genuinely NEW combined value,
not a placement copy).

**Pure-cleanup note (no copy reduction, owner ruling):** `cloning.ts` `canReuseLeaf`/`reuseLeaf`
duplicate `Node.canReuseAsLeaf`/`reuseAsLeaf`; `copyForPlacement` is a small superset of
`cloneForPlacement`. Consolidatable, but both already share children → eliminates no copies.

---

## Gates (every stage)
Build core (+jess for benches); core suite green (~2746/0 on dev at time of writing — confirm the
current number; a lone `mixin.test.ts` sibling-collapsed fail is the known load flake, re-run in
isolation); output byte-identical on `collapse-bench` + `dynamic-bench`; for Phase A1 also confirm
the bench stays neutral (per the measured A/B). Same-directory A/B only.

---

## Orchestration — the drive-to-done (this is the executable plan)

**Phased sequence (respect dependencies; fan out only across disjoint files):**

- **Phase A — independent flag work (low-risk, parallelizable):**
  - `A1` `F_MAY_ASYNC` → reactive: every `if(!hasFlag(F_MAY_ASYNC)){sync}else{async}` becomes
    attempt-sync / `isThenable`-bail (the `evaluateSelectorsRest` pattern); drop `F_MAY_ASYNC` from
    `propagateFlagsFrom` + constructors + `F_CHILD_DERIVED`. Measured neutral-to-faster.
  - `A2` `F_AMPERSAND` → compute within selector construction/composition; drop from `propagateFlagsFrom`.
  - `A3` (after A1) delete the ~25 leaf `hasFlag(F_STATIC)?this.value:this.value.eval()` skips (they
    fall into the reactive eval). Exception: keep `sequence.ts` single-item wrapper behavior.
- **Phase B — the reparent rework (serialize; prove the pattern first):** route placement parenting
  through the frame/binding layer so `adopt`/`parentChildren` never `setParent` a source child.
  `B0` prove on operation operands (most isolated) → `B1` operation operands → `B2` selector COW
  (`detachChildren`) → `B3` ampersand/extend selector materialization → `B4` collapse-survivor. Each
  deletes its clone family.
- **Phase C-early (falls out of B):** `C1` delete reuse gates (`canReuseLeaf`/`canReuseAsLeaf`/
  `!F_NON_STATIC`) + clone-to-freeze machinery; `C2` delete `F_HAS_NODE_CHILD` (residual → value check).
- **Phase D — single render pass:** `D1` relocate `Rules.evalNode`/`_prepareForEval` structural work
  to the render walk (registration → construction-time index; composition → ruleset-enter + deferred
  selector slot; extend-gather → in-walk; root at-rule hoist → top slot); `D2` delete
  `canRenderStaticRulesDirectly`/`isPlainStaticRuleLeaf`/`static-rules.ts`; `D3` collapse the Compiler
  eval-then-render split (`index.ts`) so all output flows through `render()`.
- **Phase C-late (finish):** `C3` registration gating → construction index, callable-guard static →
  guard-local, type-guard reads → value checks; `C4` delete `F_STATIC`/`F_NON_STATIC`,
  `F_CHILD_DERIVED`, and `propagateFlagsFrom` entirely.
- **Leave alone (NOT copies):** `$while` cross-iteration state; `+:` decl-merge value-bake (`deriveWithParts`).

**Protocol (dev is a HOT shared branch — the less-integration drive commits continuously):**
- One slice at a time (serialize merges; fan out only across provably disjoint files).
- Before each spawn: `git fetch origin`; branch the slice worktree off the CURRENT `origin/dev` tip
  (`git worktree add ../jess-<slice> -b work/<slice> dev`); hand the agent the invariants + slice spec
  + build/flake gotchas above.
- Agent works to the gate in ITS worktree only (never touches dev); reports diff + before/after suite
  counts + byte-identical confirmation, or a precise blocker.
- Integrate: `git fetch origin`; disjoint-check the slice's files vs `origin/dev`-since-base; merge
  `--no-ff` into dev; re-run the FULL suite; confirm NO new failures vs the freshly-pulled dev baseline
  (sibling flake re-run isolated). **ONLY if green: PUSH dev.** Tick the phase here.
- **PULL from dev (fetch) before every spawn AND every merge.** If dev moved under a slice, the merge
  reconciles — resolve, re-gate, then push. Roll a slice back rather than push red; never force-push.
- Re-profile (collapse + dynamic bench, `JESS_PROFILE` split) after each phase to confirm no regression
  and capture wins.

---

## PROGRESS LOG

### Phase D (single render pass) — slices landing off dev, one at a time (LATEST)
- **Slice 1 — DONE** (dev `9405044f1`). Deleted `AtRule.frames`: a hoisted nested `@media` recovers its severed
  parent selector from the serialize walk's `options.composedSelectorStack` (the walk already descended through
  the ancestor rulesets) + frame identity from `atRule.parent`→nearest Ruleset, instead of the eval-captured
  snapshot. Removed `getRenderFrames`, the `directRenderFrames` WeakMap, `atRuleFrameNode/Override` PrintOptions,
  `FrameMetadataNode` deep-copy. Net −158 lines. Byte-identical (all-less 90/3), core 2937/0, bench neutral.
  (Salvaged from a crashed agent — the partial work was sound.)
- **Slice 2 (relocate Ruleset `hoistToRoot`) — WON'T-DO / not a crutch.** `ruleset.ts:1949`'s
  `if (sel.hoistToRoot) node.hoistToRoot = true` is NOT a collapse-mode decision (that already lives in the walk
  via `isHoisted`'s `?? (collapseNesting && isNestable())` fallback). It carries the AMPERSAND PARENT-REPLACEMENT
  fact set by `Ampersand.evalNode` (bare `&`/`&-X` absorbing its parent — `&-1` under `.body` → `.body-1`; "already
  contains parent, don't re-prepend"), read at `ruleset.ts:1500/1595/351`. Decided during ampersand EVAL, NOT
  reconstructible from collapse+nestability+ancestry → INTRINSIC eval output (like the composed selector itself),
  not flag-walk state. Empirically load-bearing: disabling the stamp → 4 core regressions incl. the
  `.body { @media print { &-1 } }` collapse fixtures. **LEAVE IT.** (Agent stopped + proved it; nothing changed.)
- **Slice 3 (AtRule ROOT_ONLY hoist stamp) — DONE** (dev `ef23a7c5a`). RELOCATED like Slice 1. `AtRule.isHoisted`
  now derives the root-only case from serialize-visible state (`bubbleRootAtRules` via `options.context`,
  `isRootOnly()` node method, `hasRulesetAncestor()` = nearest-Ruleset walk of `node.parent`) instead of the
  eval-captured `output.hoistToRoot`. Deleted the dead plumbing: `AtRuleBodyOutputState`, the record `output`
  field, `ownsOutput` (+ its forced `withParts` copy), the `record.output` bake, `runtimeHoist`, and
  `atRuleHoistNode`/`atRuleHoistOverride` in PrintOptions. `clearRulesetFrames` (same guard) is genuine eval-time
  frame-clearing, NOT the hoist decision — left intact. Net −22 source lines. Byte-identical across 15,607 lines
  (all 4 collapse×bubble combos), core 2979/0, bench neutral. **Root at-rule hoisting is now fully off eval —
  both AtRule.frames (Slice 1) and the hoist stamp (Slice 3) relocated to the walk.**
- **Slice 4 (selector composition → walk) — DONE / already-in-walk** (dev `7327f8094`). INVESTIGATION verdict:
  composition is ALREADY on the serialize walk, not eval — `Ruleset.composeSelector`/`composeHeaderSelector`/
  `composePushedSelector` all run from the serialize path reading `options.composedSelectorStack`;
  `Ruleset.evalNode` does ZERO parent composition (it only resolves the selector's OWN interpolated value, which is
  intrinsic value-eval, correctly on eval). The only residual was a dead write-only `_composedSelector` slot
  (written at `extend-roots.ts:967/1114` alongside load-bearing assigns, read NOWHERE in production; two tests
  asserted it stayed `undefined`). Deleted the slot + 2 clears + 2 write-only assigns + 2 stale test assertions
  (3 files, −8 lines). Core 2979/0, byte-identical 90/3, bench neutral. **Composition + root at-rule hoisting are
  both fully off eval now.**
- **Slice 5 (registration → construction-time index) — INVESTIGATED, do-NOT-relocate** (no code; Slice-2/A3-class
  verdict). Registration timing is **eval-bound** and is NOT the lever. Decisive finding: `_isStatic`/`_hasStaticName`
  (F_STATIC reader-class 3) reads a **leaf-local, construction-time** F_STATIC on the NAME node (set by Quoted's
  `:77/79` / Interpolated's `:198` constructor = "does this name contain interpolation") — **NOT the
  `propagateFlagsFrom`-bubbled body flag**. So registration never gated the bubble deletion. The only genuinely
  *bubbled* read here is the Ruleset selector branch (`rules.ts:5670`, `selector.hasFlag(F_STATIC)`), reached only
  for Interpolated/Ampersand-bearing selectors (Basic/Compound/Complex/List short-circuit to static at `:5657`).
  The real construction-time index is blocked not by the flag but by eval-bound machinery (Context-keyed
  invalidation, reference-import wiring, the interpolated-name retry loop, live-binding per-placement scopes) — the
  same multi-slice single-render-pass coupling the ENDGAME VERDICT flagged. Registration prep touched **no `rules.ts`
  regions** (clean), so the next `rules.ts` slice is unblocked.
- **RE-AIMED endgame (post hoist/composition/registration investigations): the bubbled `F_STATIC` has TWO real
  consumers — class 4 (render-direct fast-path, `static-rules.ts`) and class 2 (reuse/aliasing gates). Registration
  (class 3) and the leaf eval-skips (class 1, A3) do NOT read the bubble.** So the path to C4 is:
  - **D2 — render-direct fast-path — DONE / DELETED** (dev `93fb51fb2`). Confirmed `canRenderStaticRulesDirectly`
    reads the BUBBLED `F_STATIC` (Rules has no F_STATIC-setting constructor; it only bubbles from all-static children
    via `propagateFlagsFrom`) → genuine class-4 consumer. With hoist+composition off eval, the normal eval+serialize
    path is byte-identical for every case the shortcut handled (proven across collapse:true/false + dynamic), and
    the bench is neutral-to-FASTER even on the fully-static workload (the per-render `every(isPlainStaticRuleLeaf)`
    scan cost more than the now-cheap eval it skipped). Deleted `static-rules.ts` + all call sites
    (`ruleset.ts` `canRenderSourceDirectly`/nil-selector-direct, `at-rule.ts` `renderSourceBody`), net −186 lines.
    Core 2992/0, all-less 90/3. **Class-4 is gone — the ONLY remaining bubbled-`F_STATIC` consumer is class-2 (the
    reuse/aliasing gates).**
  - **C4-prereq — a name/selector-local `isInterpolated`/`nameIsStatic` predicate** owned by the name- and
    selector-carrying node types (parallels the Phase A2 `F_AMPERSAND` selector-scope move), so reader-class 3 and the
    `:5670` selector branch ask the node, not a bubbled flag. Overlaps `selector-*.ts` → serialize against the
    extend/selector track.
  - **class 2 reuse gates + extend-gather → in-walk** remain the deep single-render-pass pieces (dynamic-leaf-share).
  - Also: `getFullComposedForm` (`extend-roots.ts:320`) re-walks the parent chain inside extend instead of sharing
    the walk's `composedSelectorStack` — a candidate for the extend track.

- **Phase A1 — DONE** (dev `6de3c0cc7`). `F_MAY_ASYNC` deleted entirely (bit `0b10` freed); sync/async
  guards → reactive attempt-sync/isThenable-bail; dead sync-twin helpers removed. Byte-identical,
  bench-neutral, core 2744/0 (−2 = deleted flag-only tests). Net −395 lines.
- **Phase A2 — DONE** (dev `ebacd2a2c`). `F_AMPERSAND` off the general `propagateFlagsFrom` + `F_CHILD_DERIVED`;
  a `Selector`-base `propagateFlagsFrom` override bubbles it within the selector tree only. **Also fixed a
  latent stale-flag bug** in `composeHeaderSelector` (guarded on `selectorHasAmpersandNode`). Byte-identical, 2744/0.
- **Phase A3 — DONE** (dev `793467955`). Deleted 4 provably-pure leaf `F_STATIC` eval-skips (block.ts ×2,
  url.ts ×2; kept url's `typeof===string` guard). **Scope correction:** the plan's "~25 leaf skips" was
  optimistic — most F_STATIC render/eval reads are LOAD-BEARING (array-walk cost, structural branch to a
  different render fn, single-item wrapper preservation), NOT redundant. They only go away when `F_STATIC`
  itself is deleted (Phase C4, once eval is cheap-by-construction). Byte-identical, 2744/0.

**Phase A complete.** `propagateFlagsFrom` now bubbles only `F_STATIC`/`F_NON_STATIC` + `F_HAS_NODE_CHILD`.
Next: **Phase B — the reparent rework** (root lever: `adopt` stops reparenting source children).

- **Phase B0/B1 — DONE** (dev `b2afaec39`). Operation operands now shared, no clone. KEY FINDING: `withOperands`
  used the RAW `new Operation([...])` (not the `op()` factory), so per invariant 7 it never called
  `parentChildren()`/`setParent` on operands — the `cloneForPlacement` was cargo-cult, removed. **Proven pattern
  for B2-B4:** place shared children via a NON-parenting construction path (raw `new` + `propagateFlagsFrom`/
  `inherit`), OR make `adopt` skip `setParent` on a source child; placement context comes from `_sourceRoot`/frame,
  never `.parent`. B1 subsumed. Byte-identical, 2744/0.

- **Phase B2 (selector COW) — BLOCKED (precise, valid outcome; nothing committed).** The selector reparent is
  REAL (not cargo-cult): `Selector.inherit()` (selector.ts:123-133) `adopt()`s each child → `setParent`.
  Dropping `detachChildren` reparents the SOURCE compounds → `[Circular]`. **Root blocker = extend's composition
  engine reads `child.parent`**: `extend.ts:4188-4193` climbs `current.parent`/`.parent.parent` to decide
  `:is()`-append-vs-wrap; `extend.ts:4156` reparents children into generated compounds; the extend registry
  (`context.extends`) reuses the source selector across matches, so the placement copy must be independently
  owned. Placed `:is()` wrapper needs `child.parent === wrapper`; source registry needs `child.parent === source`.
  **Prerequisite (new slice B2-pre): make extend's selector composition parent-pointer-free** — thread the
  structural context (enclosing compound/pseudo) explicitly instead of reading `child.parent`. Then B2 (and
  likely B3 ampersand/extend, same subsystem) unblock. Deep extend-engine refactor — gate hardest.

- **Phase B2-pre — DONE** (dev `c1e3170ae`). Extend composition parent-pointer-free: `applyExtensionAtPath`
  threads `enclosingCompound`/`enclosingPseudo` instead of climbing `current.parent` for `:is()`-append-vs-wrap.
  12-line change, byte-identical, all 23 extend files green. Turned the feared extend-engine wall into a slice.
- **Phase B2 — DONE** (dev `49631d299`). Selector placement SHARES child selectors (no `detachChildren` deep-copy).
  **Mechanism (reusable for B3/B4):** `PlacementCloneOptions.shareChildren` — share the SAME source child but
  `frozen=true` first, so `adopt`'s `if(!node.frozen) setParent` SKIPS the reparent; shared child keeps its
  canonical parent. Proof test `b2-proof.test.ts` confirms source tree unmutated / acyclic (non-tautological).
  **New baseline 2746/0** (+2 proof tests). Byte-identical.

- **Phase B4 (collapse-survivor) — GENUINE COPY, left (documented; no change).** `inherit(owner)` mutates the node
  ITSELF (source span via `setSourceSpan`, `removeFlag(F_VISIBLE)`, `addFlag(F_GENERATED/F_EXTENDED/...)`) with
  UNCONDITIONAL writes that `frozen` does NOT guard — unlike `adopt`'s child-reparent. Freeze-share → 3
  canonical-child guard tests fail (proven). Same class as B3's `copySelectorTreeForExtend`. **Phase B complete:**
  reparent-avoidance clones (B0/B2/B3) eliminated via freeze-share; mutate-after-copy clones (B4, extend:3467) stay.

### ⚠ REASSESSMENT after Phase B — the reuse gates are NOT deletable yet (chain runs deeper)
Grep of dev post-B3: `canReuseAsLeaf`/`reuseAsLeaf` are LIVE and pervasive (selector-list/complex/compound,
declaration.ts ×8, at-rule.ts, rules.ts, mixin.ts) — they are the leaf-SHARING decision ("share this inert
source-free static leaf as-is, else copy"), fed by `!F_NON_STATIC` + `!F_HAS_NODE_CHILD`. They are NOT
reparent-avoidance cruft. So Phase C-early (delete reuse gates + `F_HAS_NODE_CHILD`) is BLOCKED, and the real
dependency chain is:
  **propagateFlagsFrom (F_STATIC/F_NON_STATIC/F_HAS_NODE_CHILD) → reuse gates (share-vs-copy) → copies remain
  wherever placement MUTATES a node → `inherit` stamps span/flags/parent onto nodes.**
To delete the reuse gates + flags, the copies must go; the copies exist because `inherit`/placement MUTATES nodes.
**The real remaining lever is: make `inherit`'s node-mutation (span/flags/parent) live in the frame/context, not
on the node** — then placement never mutates a shared node, every node shares, the reuse gates + flags delete.
This IS the single-render-pass / structural-state-to-frame rework (Phase D + C-late) — a multi-slice project, not
a quick C-early. Next step: an INVESTIGATION of `inherit`'s mutations — what each writes, who reads it, whether it
can be threaded off the node — returning a feasibility + design, not a blind rewrite.

### ⚠⚠ ENDGAME VERDICT (inherit investigation, `INHERIT_MUTATION_DESIGN.md`)
`inherit` is NOT the lever and threading its mutations off-node is NOT worth it. Regime split: ~95% of ~90
`inherit` sites are FRESH-receiver (`new X().inherit(this)` — already always-share-safe); only `selector-complex.ts:367`
(collapse-survivor) still hands `inherit` a shared node (extend already hands a fresh `cloneForPlacement` shell, so
extend is NOT a blocker). The intrinsic mutations (source span + F_VISIBLE/F_EXTENDED/F_GENERATED) are read at
SERIALIZE time off the node, and extend needs the SAME shared source to carry DIFFERENT flags per match — one node
can't hold two states, so this is per-output-node identity, not per-frame context. Relocating = per-node placement
record threaded through ~35 serializers + the render walk = bigger than the copy it removes. REJECTED.
- **Optional cheap tidy (I2):** make collapse-survivor (`selector-complex.ts:367`) hand `inherit` a fresh shell with
  B2 `shareChildren` frozen children — then `inherit` only ever mutates fresh nodes (invariant clean). Small copy
  reduction, does NOT unlock the flag deletion.
- **THE REMAINING GATE = Phase D (single-render-pass / dynamic-leaf-share), NOT inherit.** The reuse gates
  (`canReuseAsLeaf`/`!F_NON_STATIC`) hang on whether a DYNAMIC leaf can be shared at render (looked up per-frame)
  instead of copied — which needs eval folded into the render walk (structural/registration state in the frame,
  serialize reads provenance per output position). That is the multi-week, high-regression-risk rework touching
  serialize/sourcemap/extend/eval. **DECISION POINT (owner):** commit to Phase D, or bank Phase A+B and close the
  flag-walk goal as "deletable flags gone (F_MAY_ASYNC, F_AMPERSAND off the walk); F_STATIC/F_NON_STATIC/F_HAS_NODE_CHILD
  gated on the single-render-pass project."

### ⚑ REPRIORITIZED by the CPU profile (REPROFILE_CURRENT.md) — hotspots first, flag-walk as cleanup
Fresh profile verdict: **Phase D's entire surface (eval-fold / registration / copy / reuse-gates /
`propagateFlagsFrom`) is <1% of self-time** — NOT a perf lever. The real hotspots are elsewhere. Owner
decision: **attack measured hotspots for PERF first; then finish the flag-walk / single-render-pass as
code-health simplification (maintainability + the 10× "do less work" spirit), NOT as a speed project.**

PERF priority order (re-profile between each):
1. **Comment-scan quadratic — ~70% self-time (IN PROGRESS, `work/fix-comment-scan-quadratic`).**
   `commentRunsWithinSpan` scans the whole-file comment map per serialized node (O(nodes × comments)) —
   a regression from the span-array drop. Range-query / forward-cursor. Isolated, days not weeks.
2. **Extend selector matcher — ~25% on real Less** (`extendSelector`/`applyExtendsToSelector`/`wouldMatchNode`/
   `processExtends`). The next perf target after comment-scan.
3. **GC / allocation churn — ~4-6%.**

THEN (post-hotspots, as simplification not speed): resume Phase D (single-render-pass) + the flag-walk
deletion (D3 done; D1/dynamic-leaf-share/C4). Still worth doing for fewer-passes/less-work, just not the
perf headline. The `propagateFlagsFrom` deletion remains the /goal's endpoint — reached last, as cleanup.

### 🛡 GUARDRAIL SLICE (queued — land immediately AFTER the comment-scan fix)
Root cause of the comment-scan quadratic: gates were complexity-BLIND — byte-identical + suite green +
memory-win all passed while the change went O(nodes × comments). Add a STANDING guardrail so this class
of regression fails loudly:
- **Deterministic scaling test** (`render-scaling.test.ts` or similar): render the same content at N / 2N / 4N
  node counts and assert the WORK ratio is ~linear (≈2×), not super-linear (≈4× = quadratic). Prefer an
  INSTRUMENTED COUNTER over wall-clock (immune to the ~25× env noise) — e.g. count total `commentRunsWithinSpan`
  run-comparisons and assert O(nodes), not O(nodes×comments). Include a comment-heavy input so THIS exact
  regression can never return silently, plus a general render/serialize-path linearity assertion.
- Sequencing: after the comment-scan fix (it makes the path linear → the test is green and locks it in).
- Consider (follow-up): a bench-regression merge gate + a review rule "no unbounded per-node scans of
  document/whole-tree-scoped collections."
