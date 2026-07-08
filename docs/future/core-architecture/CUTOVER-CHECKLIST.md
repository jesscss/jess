# Single-eval-emit CUTOVER — tracked checklist

**This is the executable plan for the OQ-C coordinated cutover** to the architecture in
`UNIFIED-EVAL-EMIT-DESIGN.md` (+ `EXTEND-GLOBAL-FLOW-DESIGN.md`, `EXTEND-INDEX-DESIGN.md`). Not
incremental. Agents work THIS checklist toward the target and update it often.

## ⛔ HARD RULE — drive to the target, do NOT match the existing structure
The failure mode this cutover exists to avoid: an agent reads the current
eval→output-tree→visitor→serialize code, its context gets poisoned by that shape, and it *matches the
old structure instead of building the target*. Guardrails, binding on every cutover agent:
1. **The design docs are the SPEC. The current code is what's being TORN OUT — never matched.** When
   existing code conflicts with the target architecture, the TARGET wins. Do not preserve, adapt-around,
   or mirror the old shape.
2. **Never "keep X to be safe."** If the target deletes it (the output tree, `propagateFlagsFrom`, the
   reuse gates, the separate visitor walk), DELETE it. A blocker is reported, not worked-around by
   keeping the old path alive.
3. **Byte-identical-vs-alpha is the FINAL gate (P5), NOT a per-step gate.** The branch is mid-rework;
   intermediate steps will NOT be byte-identical or all-less-green. Progress is tracked by THIS
   checklist + component/unit tests, not by all-less. Do not conclude "it's broken, revert to matching
   the old code" from a red all-less mid-cutover.
4. **Touch base often:** update this checklist (check items, add findings) and report progress + blockers
   each work session, so the orchestrator catches backpedaling early.
5. Work on the **cutover branch**, never dev. `.css`/warning expectations are the working oracle but not
   gospel — reason to the intended v5 shape (see the "no sacred expectations" rule).

## Branch / gate strategy
- Long-lived integration branch **`work/cutover`** off `dev`. Phase work happens on `work/cutover-<phase>`
  worktrees, integrated into `work/cutover` by the orchestrator. Merges to `dev` ONLY at P5 (byte-identical).
- The extend pipeline (`tree/extend/` PLAN/SOLVE/EMIT + `pipeline.ts`) is already built, validated, and
  bundle-excluded on dev — the cutover WIRES IT IN (it is not rebuilt).

## Phases (ordered; deps noted; fan-out only where marked)

### P0 — scaffolding
- [ ] Create `work/cutover` off `dev`; land this checklist there.
- [ ] Inventory the exact deletion targets (files/functions) so later phases delete, not preserve:
      eval→`state.output` tree build, `preSerializeRoot` (`rules.ts:~4795`), `TreeVisitor`
      (`visitor/index.ts:192-263`), reuse gates (`canReuseAsLeaf`/`canReuseLeaf`/`canReuseStaticScalarLeaf`),
      clone families, container `F_STATIC` short-circuits, `propagateFlagsFrom` + `F_STATIC`/`F_NON_STATIC`/
      `F_HAS_NODE_CHILD`/`F_CHILD_DERIVED`. (Reference: `FLAG-WALK-DELETION.md`, design §7.)

### P1 — the frame-threading spine (§2)  ·  SERIAL, foundational, everything depends on it
- [~] Emit descends the SOURCE tree with the live value-frame stack pushed/popped by the walk; a leaf
      resolves `resolve(sourceLeaf, currentFrame)`→bytes at its emit moment; no `state.output` tree.
      **Wired for leaf-only roots AND nested-ruleset CONTAINERS.** `tree/util/emit-walk.ts` +
      `serialize-helper.ts` `spineMode` + `Ruleset.render` spine branch. `Rules.render` routes a
      spine-eligible root through ONE downward pass; nested plain rulesets descend in place through the
      KEPT container serializer (`serializeRulesContainer`, §7) which in `spineMode` PUSHES each
      container's value-frame at enter and RESOLVES its leaves live — NO `eval()`, NO `state.output`, NO
      `Rules.derive`. Both collapse modes verified (`.a .b` vs nested). **Locked** by
      `emit-walk-ratchet.test.ts`: spine counter moves + root `eval` not called + **`Rules.derive` not
      called on the wired container path** (output-tree-absence ratchet ACTIVATED) + eligibility boundary.
      Full core suite green (3180 pass, 0 fail).
      **ASYNC-LEAF THREADING DONE.** `calc()`/`Operation`-valued declarations now flip through the spine.
      The container serializer is `MaybePromise<string>`-typed, but resolution is SYNC-BY-DEFAULT with a
      REACTIVE `isThenable`-bail (`resolveSpineLeafText` + the `isThenable(x) ? x.then() : sync(x)` twins
      through `processNode`/`renderRulesBody`/`run`/`runContainer`). NO pre-scan/flag/`Node.walk` to
      predetermine async-ness (that was `F_MAY_ASYNC`, deleted A1), NO speculative `awaitable-pipe` await —
      a fully-sync value (pure `Operation`) pays ZERO async cost (proven: `10px+20px` renders sync,
      `thenable=false`); a genuinely-async `calc()` (Call eval is async) threads a promise only because one
      actually surfaces (proven: `margin: 20px`). The spine-frame pop chains on the promise (never a sync
      `finally` that would pop before an async leaf resolves — the B1s bug). Ratchet updated: admits
      calc/Operation + asserts sync-Operation stays sync.
      **Exact boundary — still eval path (scoped frontier):** `&`-selectors (ampersand compose),
      interpolated selectors (item 3 below), `+:`/conditional/`setDefined` decls (merge), re-declared vars
      (source-order), guarded/extend/at-rule/mixin/reference containers, charset/import. **Next push:**
      selector-interpolation-at-enter (item 3), then at-rule containers + ampersand compose.
- [~] Mixin/loop/`$for`/`$if` bodies descended SHARED under a pushed frame (no copy); `inherit`'s per-node
      span/flag stamping ELIMINATED (span read off the source node in place).
      **Shared-body mechanism landed** (`pushBoundBodyFrame`, proven `10px`/`20px` same-leaf-identity).
      **`inherit` span-stamp: FINDING — NOT unblocked by the container wire-in alone.** The container
      OUTPUT TREE is gone on the wired path (`Rules.derive` not called, ratchet-proven), but `inherit` is
      STILL called ~4×/render there — by TRANSIENT LEAF-RESOLUTION nodes (a `Reference`→`Sequence`, a
      resolved `Declaration`, a composed `ComplexSelector`) that carry the source span for the sourcemap
      origin. So eliminating the stamp needs leaf sourcemap attribution reworked to read the source span
      IN PLACE (design §2.4) rather than stamp a transient — a change shared with the still-standing eval
      path. NOT force-deleted (live on both the transient-leaf path and the eval path): the target-honest
      gate. This is its own follow-up, not a byproduct of the container fold.
- [ ] Selector interpolation resolves at ruleset-enter (frame live) → concrete selector available to extend.
      **NEXT ITEM — mechanism + injection point analyzed, not yet folded.** The spine already pushes the
      live frame at ruleset-enter (the `spineFrameNode` block in `serializeRulesContainerInternal`); the
      resolve is `selector.eval(context)` there (what `_prepareRulesetSelectorIdentity`/ruleset.ts:1827 do
      on the eval path). The wrinkle: the container serializer reads `node.selector` in ~6 places
      (`composePushedSelector` :1451, `writeHeaderSelector` :1584, the `run` reference check, collapse) — a
      resolved selector must reach all of them WITHOUT mutating the canonical node (output-affecting → needs
      a transient, not the loosened-invariant in-place cache). Cleanest: resolve once at the spine-frame
      block and thread the resolved selector as an options override (like `atRuleHeaderPrelude` already
      does) OR a scoped swap-and-restore. Interpolated selectors stay EXCLUDED (`selectorHasInterpolation`)
      until folded, so current output is correct. This is the OQ-A prerequisite (extend sees concrete
      selectors). Deferred to keep the async-threading change isolated + reviewable.

### P2 — per-node inline visitor model (§6)  ·  depends on P1
- [ ] Replace the separate visitor walk + `preSerializeRoot` with the generic per-node hook
      `(node,ctx)=>void|Node|REMOVE|ABORT` at enter/exit edges; delete `TreeVisitor`/driver.
- [ ] Generic API in core, Less-agnostic (less-compat registered by the `less` pkg, optional side-dep).
- [ ] `beforeEval` pre-walk: owner-pending (§6.8) — keep as a separate structural pre-walk feeding the
      same contract unless owner drops v5 pre-eval compat.

### P3 — extend wired into the pass (§4)  ·  depends on P1; overlaps P2
- [ ] **Extend-work gate (§4.0) — the fast path.** No `:extend` registered (`context.extends` empty) →
      bypass PLAN/SOLVE/buffering ENTIRELY: the pass stays a pure streaming spine, headers emit inline,
      zero extend overhead (the common case). No extend REACHES a subject (`Reaching(S)=∅`) → that subject
      emits inline (early-flush trivially holds). Buffering is paid strictly per-reaching-extend, never
      globally. **Lock:** a ratchet test asserting an extend-free stylesheet triggers zero PLAN/SOLVE and
      zero per-subject buffering (instrument a counter = 0).
- [ ] `runExtendPipeline` (PLAN reachability + target index → SOLVE global fixpoint → EMIT compose/hoist/
      collapse) REPLACES the `processExtends` apply. Buffer-then-flush discipline (§4.4): decls stream to
      per-subject buffer, headers deferred, early-flush per the §4.4.3 predicate.
- [ ] EMIT projects (B): `placement`/`origin`(`F_EXTENDED`/`F_EXTEND_TARGET`)/`order`/`visible`/`generated`
      onto branches (the B2 flag work — on the branch, never the shared source selector).
- [ ] Resolve interpolated extend TARGET at capture (OQ-A fix, `extend.ts:341`) so `:extend([data=@{attr}])` works.
- [ ] **Wire the comma-sibling document-order determinism (OQ-D finding).** The branch SET is confluent, but
      sibling ORDER is not order-independent — and the design's EMIT document-order sort is **dead code today**
      (`setExtendOrderMap` has zero callers; `extendOrderMap` always null). Production is deterministic only via a
      document-order FEED. So the cutover MUST either build the EMIT order sort (install the value→document-order
      map the §4.2/§4.4 sort branches read) OR preserve the document-order feed. Lock: the pinned
      `oqd-confluence-differential.test.ts` negative assertion (raw sibling order NOT confluent) flips to
      `a === b` when the sort is wired — activate it then (it's the guard that the sort actually got built).

### P4 — delete the dead machinery (§7 + flag-walk C4)  ·  depends on P2+P3  ·  FAN-OUT across sites
- [ ] Delete eval→output-tree staging + reuse gates + clone families + container static short-circuits.
- [ ] Delete `F_STATIC`/`F_NON_STATIC`/`F_HAS_NODE_CHILD`/`F_CHILD_DERIVED` + `propagateFlagsFrom` (the /goal endpoint).

### P5 — final gate + merge
- [ ] Byte-identical vs alpha `all-less` (both collapse modes) + core suite green + sourcemap identity.
- [ ] The 4 perf dimensions measured (fast-reject / chained / clock / memory) — now a REAL swap, not additive.
- [ ] Merge `work/cutover` → `dev`.

## SUCCESS CRITERIA & RATCHET — how this plan guarantees itself

**The honest guarantee.** A multi-week rework can hit a genuine blocker — that's not what "guarantee"
addresses. What IS guaranteed is against the three ways a big rework actually fails silently: (1)
**backslide** — a gain later undone; (2) **drift** — agents wandering off the target; (3) **false-done**
— declaring success on vibes. Each has a mechanical defense below. "Success" = the P5 acceptance metrics
are hit AND locked; the guarantee is that nothing regresses them undetected and nothing is called done
that isn't measured done.

### How every agent checks its work (per-phase gate)
1. Build passes; **component/unit tests prove the new mechanism on small inputs** (not "looks right").
2. **Anti-backpedal self-check** (the ⛔ HARD RULE): "did I match/preserve the old structure anywhere?"
3. **Lock the gain** — every improvement this phase made is encoded as a STANDING test (see RATCHET).
4. Metric table (below) updated; net movement is the right direction, nothing regressed.
5. At each integration + P5: byte-identical vs alpha `all-less` (both collapse modes) + core suite +
   sourcemap identity + all ratchet tests green. (Mid-cutover all-less is expected RED — the checklist +
   component tests are truth then, NOT all-less. Do not backslide because all-less is red mid-cutover.)

### The three metric axes — baseline → target, each RATCHETED by a standing test
| axis | metric | ratchet test (fails on regression) |
|---|---|---|
| **(a) core size ↓** | bundle kB; per-class **≤5 field budget** (`NODE_FIELD_BUDGET.md`); LOC/symbols deleted | bundle-size **ceiling** test; per-class field-count assertion; **deleted-symbol-absence** test (e.g. `propagateFlagsFrom`/`F_STATIC` grep-asserted ABSENT once P4 removes them) |
| **(b) complexity ↓** | **pass count 3→1** (no `state.output` tree, no separate visitor walk, no `preSerializeRoot`); **flag count →0** for F_STATIC/F_NON_STATIC/F_HAS_NODE_CHILD/F_CHILD_DERIVED; deleted files | single-pass **invariant** assertion (those structures absent); flag-reference-count = 0 test; the **render-scaling linearity** test (already exists — locks algorithmic complexity). **P1 progress: leaf-only-root AND nested-ruleset-container paths now 2→1** (eval pass + output tree eliminated) — LOCKED by `emit-walk-ratchet.test.ts` (`spineRenderCounter` moves + root `eval()` not called + **`Rules.derive` not called** on the wired container path). Now ALSO covers `calc()`/`Operation`-valued declarations (async-leaf reactive-bail). Ampersand / at-rule / interpolated-selector shapes still 2 (eval path) — scoped frontier, not fallback. |
| **(c) performance ↑** | the 4 dims (fast-reject / chained / clock / memory) + collapse & dynamic benches | render-scaling **counter** (env-noise-immune) + a **bench-regression floor** gate + the **share-vs-copy counter = 0** for target shapes |

### The RATCHET principle (this is the "not undone by further work" guarantee)
As EACH gain lands, it is immediately encoded as a committed STANDING test that goes RED if a later change
regresses it — deleted a symbol → absence assertion; shrank the bundle → size ceiling; hit the field
budget → field-count assertion; made a path linear → the scaling counter; improved a bench → a floor
gate. So a later agent that reintroduces `propagateFlagsFrom`, re-adds a node field, re-bloats the
bundle, re-splits the pass, or regresses perf **trips a red test immediately** — the gain cannot be
silently undone. "Lock the gain" is a required item in every phase's gate, not an afterthought.

### Checklist coherence + drift control
- This file is the **single source of truth**. Agents update it (check items, append the progress log,
  update the metric table). The orchestrator reconciles concurrent edits at integration.
- **A checklist claim is not "done" until its ratchet test is committed and green** — the tests are the
  enforcement, the prose is just the map. This is what makes "done" objective (defeats false-done).
- Drift is caught by the ⛔ HARD RULE self-check + frequent touch-base: agents report at each stopping
  point; the orchestrator reviews progress **against the target (the design), not against current code**,
  and redirects on the first sign of structure-matching.

### DEFINITION OF DONE (P5 acceptance — all simultaneously)
byte-identical vs alpha `all-less` (both modes) · core suite green · sourcemap identity · every metric-table
target hit (size↓, complexity↓, perf↑) · every ratchet test green (all gains locked) → only then merge to `dev`.

## Progress log
(agents append: date · phase · what landed / what's blocked)
- 2026-07-08 · P0 · checklist created.
- 2026-07-08 · governance · success-criteria + ratchet + metric-table + definition-of-done added.
- 2026-07-08 · P1 · frame-threading spine MECHANISM landed as `tree/util/emit-walk.ts` (new module, not a
  rewrite of the old serializer — HARD RULE respected): `withValueFrame` (value-frame push/pop via
  `context.rulesContext`), `emitLeaf` (resolve-against-live-frame→bytes, no output node), `emitSharedBody`
  + `emitChildren` (leaf descent), `pushBoundBodyFrame` (shared body under fresh per-placement live-cell
  frame). Component proof `emit-walk-spine.test.ts` (4/4 green): (1) static leaf resolve+emit no output
  tree; (2) dynamic `width:@w` resolves against the LIVE frame at emit moment; (3) one shared body emitted
  twice under two frames → `10px`/`20px` with SAME source leaf identity (no copy); (4) push/pop restores.
  Build green; additive-only so far (basic-render 9/9 unaffected). BLOCKER / next push: wire emit-walk
  into `Rules.render` to REPLACE `evalForRender`→`eval`→`serialize` two-walk (rules.ts:4754/4788) for the
  container descent, reusing the structural `serializeRulesContainer`/`composedSelectorStack` side; then
  eliminate `inherit` span-stamp (node-base.ts:1474-1516) once the derived output node is gone.
- 2026-07-08 · P1 · WIRE-IN FLIP landed (the serial blocker). `Rules.render` now REPLACES
  `evalForRender`→`eval`→`serialize` with the single spine pass for a spine-eligible root (leaf-only body:
  declarations/comments, default `:` assign, no re-declared vars, no charset/import/reference). No `eval`
  call, no `state.output`, no separate serialize walk on that path — it reuses the KEPT statement-framing
  serializer (`toRenderString`→`_emitRulesBody('render')`, §7) with live-frame leaf resolution.
  RATCHET committed (`emit-walk-ratchet.test.ts`): `spineRenderCounter` moves + root `eval()` proven NOT
  called on the wired path (2→1 pass-count locked) + eligibility boundary asserted. Iterated eligibility to
  exclude what the spine does not yet fully handle (found via core-suite deltas, each a REAL gap not
  churn): `+:`/conditional/`setDefined` decls (eval-pass merge), re-declared vars (source-order snapshot),
  containers/imports. Core suite GREEN: 3168 pass / 0 fail / 15 skip (tree 1998/0; +7 new spine+ratchet
  tests). `inherit` span-stamp elimination + selector-interpolation-at-ruleset-enter remain BLOCKED behind
  the CONTAINER wire-in (nested ruleset/at-rule/mixin descent fused with live-frame leaf resolution) — the
  next serial push; not deletable yet because the eval path (still handling all containers) still reads
  them. Backpedal self-check: did NOT keep a dual/old path alive on the wired slice — the eval two-walk is
  genuinely not entered for an eligible root (ratchet-proven); the eval path stands ONLY for shapes the
  spine does not yet cover, which is a scoped frontier, not a safety fallback for covered shapes.
- 2026-07-08 · P1 · CONTAINER DESCENT wired. Nested plain rulesets now flip through the spine: added
  `PrintOptions.spineMode`; in `serialize-helper.ts` the KEPT container serializer (§7) — in spineMode —
  PUSHES each container's value-frame at enter (`context.rulesContext = node`, `getScopeFrame()`) and its
  leaf emission RESOLVES against that live frame (`node.eval`) instead of static `writeSyntax`;
  `Ruleset.render` gained a spineMode branch that serializes the SOURCE ruleset directly (no
  `evalForRender`). Result on the wired container path: `Rules.eval` NOT called, `Rules.derive` NOT called
  (NO output tree) — proven; both collapse modes correct (`.a .b` / nested). RATCHET activated:
  output-tree-absence (`Rules.derive` not called) test committed. Iterated eligibility from core-suite
  deltas (each a REAL coverage gap, not churn): excluded `&`-selectors (ampersand compose — 8 ampersand/
  nesting tests), `calc()`/`Operation` values (async leaf — the sync container serializer can't thread a
  promise yet; throws a clear guard if it ever slips through), interpolated selectors (resolve-at-enter,
  item 3). Core suite GREEN 3179/0/15 (+ container ratchet tests). DOCUMENTATION STANDARD applied:
  module + function JSDoc on emit-walk carry contract + load-bearing invariant + `@see §2/§4/§7`; stale
  "no nested containers" eligibility docstring retired. FINDING (important): `inherit` span-stamp is NOT
  unblocked by removing the output tree — it is still called by TRANSIENT leaf-resolution nodes for
  sourcemap span carry (§2.4); eliminating it needs in-place source-span attribution, a separate follow-up
  shared with the eval path (recorded in the P1 item). NEXT: at-rule containers, ampersand compose, async
  leaf threading (container serializer → MaybePromise in spineMode), and selector-interpolation-at-enter.
  Backpedal self-check: reused the KEPT serializer as a MODE (spineMode) rather than forking or preserving
  the old eval→output path — on the wired path the eval two-walk + output tree are genuinely gone
  (ratchet-proven); the eval path remains ONLY for not-yet-covered shapes (scoped frontier). No dual path
  for a covered shape.
- 2026-07-08 · P1 · ASYNC-LEAF THREADING landed (foundational, per owner: before ampersand/at-rules).
  `calc()`/`Operation`-valued declarations now flip through the spine. Made the container serializer
  (`serializeRulesContainerInternal` + `renderRulesBody`/`run`/`runContainer` + `serializeRulesContainer`
  /`Inline`) `MaybePromise<string>`, but resolution is SYNC-BY-DEFAULT + REACTIVE `isThenable`-bail —
  aligned with the owner's two corrections: (1) do NOT blanket-MaybePromise calc/Operation (most are sync);
  (2) REACTIVE ONLY — no static async-determination walk (that IS `F_MAY_ASYNC`, deleted A1; measured
  neutral-to-faster reactive). Deleted my earlier `declarationValueHasAsyncShape`/`Node.walk` pre-scan;
  admit calc/Operation broadly in eligibility; `resolveSpineLeafText` runs `node.eval` and only `.then()`s
  on a genuine thenable. Proven: pure `Operation` `10px+20px` renders SYNC (`thenable=false`) → `30px`;
  `calc(10px*2)` (Call eval is async) threads a promise only because one actually surfaces → `20px`. The
  spine-frame pop chains on the promise (never a sync `finally` — avoids the B1s early-pop bug). tsc:
  ZERO new errors in serialize-helper/emit-walk beyond the 2 pre-existing `canMergeSameHeaderRuleset`
  `SelectorLike` cascade lines (verified verbatim at HEAD~1). Core suite GREEN 3180/0/15. DOCUMENTATION
  STANDARD: `PrintOptions.spineMode` async-discipline note + `resolveSpineLeafText` contract/invariant.
  Backpedal self-check: no dual path (spineMode is a mode on the KEPT serializer); no speculative await;
  reactive-bail is the SAME pattern as the `evaluateSelectorsRest` twins. Selector-interp-at-enter DEFERRED
  (analyzed: resolve `selector.eval` at the spine-frame block + thread as an options override; kept
  isolated from this async change for reviewability). NEVER used `git stash` (hard rule) — inspected prior
  state via `git show HEAD~1:path`.
