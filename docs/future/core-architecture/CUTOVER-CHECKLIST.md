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
      **Mechanism landed** in `tree/util/emit-walk.ts`: `withValueFrame` (value-frame push/pop via
      `context.rulesContext`), `emitLeaf` (resolve-against-live-frame → bytes, transient resolved node
      dropped, source node as sourcemap origin), `emitSharedBody`/`emitChildren` (leaf descent). Proven
      by `emit-walk-spine.test.ts`: static leaf + dynamic `width:@w` resolve+emit with NO output tree.
      **Still standing (next push):** wiring this into `Rules.render` to REPLACE `evalForRender`→`eval`→
      `serialize` for the container descent (structural side reused from `serializeRulesContainer`).
- [~] Mixin/loop/`$for`/`$if` bodies descended SHARED under a pushed frame (no copy); `inherit`'s per-node
      span/flag stamping ELIMINATED (span read off the source node in place).
      **Shared-body mechanism landed:** `pushBoundBodyFrame` builds a thin surface over the SHARED source
      child array under a fresh per-placement `buildScopeFrame` with live-cell bindings (mirrors
      `createIterationEvalSurface(share=true)`). Proven: one shared body emitted twice under two frames →
      `10px`/`20px` with the SAME leaf node identity (no copy). `inherit` span-stamp elimination not yet
      done (depends on the render wire-in removing the derived output node).
- [ ] Selector interpolation resolves at ruleset-enter (frame live) → concrete selector available to extend.
      NOT STARTED (structural-side; comes with the container wire-in).

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
| **(b) complexity ↓** | **pass count 3→1** (no `state.output` tree, no separate visitor walk, no `preSerializeRoot`); **flag count →0** for F_STATIC/F_NON_STATIC/F_HAS_NODE_CHILD/F_CHILD_DERIVED; deleted files | single-pass **invariant** assertion (those structures absent); flag-reference-count = 0 test; the **render-scaling linearity** test (already exists — locks algorithmic complexity) |
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
