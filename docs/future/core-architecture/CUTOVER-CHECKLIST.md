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
      **AT-RULE CONTAINERS DONE (`@media`/`@supports`/`@container`).** `serializeSpineFrameAtRule` (at-rule
      analogue of `serializeSpineFrameContainer`) resolves the PRELUDE against the ENCLOSING live frame at
      at-rule-enter and installs it via the existing `atRuleHeaderNode`/`atRuleHeaderPrelude` render-local
      override (NOT canonical mutation), pushes the at-rule body frame, descends. `@media`→root HOISTING +
      the root-only composed-stack reset are the KEPT walk machinery reused unchanged (§7). `AtRule.render`
      got a spineMode branch (skip `_evalForAtRuleRender`). Proven: nested `@media screen { .a { width:@w } }`
      → concrete, `eval=0 derives=0`; hoist `.card { @media { .inner {…} } }` → `@media screen { .card
      .inner {…} }` at root, `eval=0 derives=0`. Both collapse modes. Ratchets added: at-rule-through-spine
      + @media-hoist-through-spine. `@layer` EXCLUDED (nested layer-NAME registration is an eval-pass side
      effect the spine doesn't replicate); `@scope` EXCLUDED (special `(start)`/`(end)` prelude + scoped
      body); root-only (`@font-face`/`@keyframes`/…) excluded.
      **`&`-COMPOSITION DONE (plain `&`).** Plain ampersand — `&.foo`, `& + &`, `&:hover`, `& .child`,
      bare `&` — now composes through the spine: `serializeSpineFrameContainer` pushes the ruleset onto
      `context.rulesetFrames` (the parent link `Ampersand.eval` reads — top = immediate parent) and eval's
      the `&`-selector against it at ruleset-enter, so `&` resolves from the LIVE structural stack. Node's
      OWN frame is pushed AFTER its selector evals (so its `&` sees the PARENT, not itself); node's frame is
      the parent only for its DESCENDANTS. The resolved `&` form is the header override AND what extend sees
      (OQ-A). AMPERSAND-APPEND (`&-modifier`/`&-primary`) EXCLUDED with precise reason: the anonymous-append
      suffix materializes + hoists ONLY via `Ampersand.evalNode`'s `appendValue` path (eval-pass frame state
      the spine does not reproduce) — `selectorHasAmpersandAppend` gates it. Ratchets: plain-`&`-compose +
      ampersand-append-excluded.
      **PER-POSITION VALUE-BINDING DONE (re-declared vars + `snapshot` reads).** The single-upfront-frame
      last-wins gap is closed: `assignSpineChildIndices` numbers a scope's body children at scope-enter
      (replicating the registration counter — one increment per non-`Comment` child), so the KEPT
      position-gated `lookupScopeFrameVariable` resolves each read against the binding at the READER'S
      source position (`node.index` vs each decl's `sourceNode.index`), not last-wins. Output-INVISIBLE
      bookkeeping on the canonical node (§ruling 1) — changes neither re-serialization nor reuse; idempotent
      (skips already-numbered bodies from the eval path). Proven: `@color:red; seen(snapshot):@color;
      @color:blue; later:@color` → `seen:red` (position), `later:blue`, `eval=0 derives=0`. Re-declared vars
      admitted in eligibility.
      **`+:`/`+_:` MERGE DONE (in ruleset/at-rule bodies).** Property-merge coalesces through the spine:
      new `spine-merge.ts` `planBodyMerges` walks a body's DIRECT decls at body-enter (frame live), groups
      same-property merge chains (`+:`/`&,:` → comma `List`; `+_:`/`&_:` → space `Sequence`), records a
      per-body PLAN (WeakMap keyed by source decl: earlier members `suppress`, last member `anchor` with the
      combined value). `withSpineMergePlan` installs it on `options.spineMergePlan` for the body descent
      (scoped save/restore); `resolveSpineLeafText` consults it — a suppressed decl emits nothing, the
      anchor emits the combined value (eval'd-then-`deriveWithParts`, `normalizedFromAssign` set on the
      TRANSIENT so it prints plain `prop: value` not `prop+:`). The combined value is a genuinely NEW node
      (design "NOT copies, stays"); NO canonical mutation. Proven: `background+:red; background+:blue` →
      `background: red, blue`; `transform+_:scale(1); +_:rotate(5deg)` → `transform: scale(1) rotate(5deg)`;
      both `eval=0 derives=0`, matching the eval-path baseline. ROOT-LEVEL merge (a `+:` directly in the
      document root, not in a ruleset) stays on the eval path — the flat root-body path doesn't run the
      plan; unusual shape. Ratchets: `+:`/`+_:`-merge-through-spine + root-merge/conditional-excluded.
      **Exact boundary — still eval path (scoped frontier):** ampersand-APPEND (`&-modifier`), ROOT-LEVEL
      `+:` merge, conditional (`?:`)/`setDefined` decls, interpolated-var-NAME decls, `@layer`/`@scope`/
      root-only + interpolated-name at-rules, guarded/extend/mixin/reference containers, charset/import.
      Interpolated selectors, conditional-group at-rules, plain `&`, per-position var-binding, AND `+:`/`+_:`
      merge NOW folded. **Next push (recommended order):** (1) conditional (`?:`)/`setDefined` scope-mutating
      assigns; (2) `@layer`/`@scope` at-rules (fold their eval-pass name/scope semantics; ampersand-APPEND
      folds alongside the hoist work); (3) `inherit` in-place span attribution (narrowest — the last
      transient-leaf sourcemap-span carry).
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
- [x] Selector interpolation resolves at ruleset-enter (frame live) → concrete selector available to extend.
      **DONE.** `serializeSpineFrameContainer` now pushes the container's value-frame at ruleset-enter,
      resolves `selector.eval(context)` against that live frame, and installs the CONCRETE selector as a
      render-local override (`PrintOptions.spineSelectorNode`/`spineSelector`, mirroring the
      `atRuleHeaderPrelude` pattern — NOT a canonical-node mutation, since a resolved selector is
      output-affecting). `Ruleset.effectiveHeaderSelector(options)` is the single accessor that returns the
      override; `composePushedSelector` + `writeHeaderSelector` both read through it, so every header path
      sees the resolved form. `isSpineEligibleRoot` widened to ADMIT interpolated selectors (dropped
      `selectorHasInterpolation`). Proven: `[data=@{attr-data}]` → `[data="foo"]` through the spine with
      `eval=0 derives=0` (no eval pass, no output tree). **OQ-A prerequisite satisfied** — extend now sees
      the concrete selector, not the raw `@{…}` template. RATCHET: interpolated-selector-through-spine
      assertion added (`emit-walk-ratchet.test.ts`: single-pass counter moves + `derive` not called +
      output is `[data="foo"]` + no `@{`). The recursion guard is the override marker
      (`spineSelectorNode === node` short-circuits re-setup); always set on descend, incl. the no-eval path.

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
| **(b) complexity ↓** | **pass count 3→1** (no `state.output` tree, no separate visitor walk, no `preSerializeRoot`); **flag count →0** for F_STATIC/F_NON_STATIC/F_HAS_NODE_CHILD/F_CHILD_DERIVED; deleted files | single-pass **invariant** assertion (those structures absent); flag-reference-count = 0 test; the **render-scaling linearity** test (already exists — locks algorithmic complexity). **P1 progress: leaf-only-root AND nested-ruleset-container paths now 2→1** (eval pass + output tree eliminated) — LOCKED by `emit-walk-ratchet.test.ts` (`spineRenderCounter` moves + root `eval()` not called + **`Rules.derive` not called** on the wired container path). Now ALSO covers `calc()`/`Operation`-valued declarations (async-leaf reactive-bail), interpolated selectors (`selector.eval` at ruleset-enter → concrete header; OQ-A), conditional-group at-rules (`@media`/`@supports`/`@container`, incl. `@media`→root hoisting), plain `&` composition (`&.foo`/`& + &`/`&:hover`/`& .child`, resolved from `context.rulesetFrames` at ruleset-enter), per-position var-binding (re-declared vars + `snapshot` reads via `assignSpineChildIndices`, not last-wins), AND `+:`/`+_:` property-merge coalescing in ruleset/at-rule bodies (`spine-merge.ts` `planBodyMerges` → combined value at the anchor, earlier suppressed). Ampersand-APPEND / root-level-`+:` / conditional / `@layer`/`@scope` still 2 (eval path) — scoped frontier, not fallback. |
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
- 2026-07-08 · P1 · SELECTOR-INTERPOLATION-AT-RULESET-ENTER landed (OQ-A prerequisite). Added
  `serializeSpineFrameContainer`: at ruleset-enter it pushes the container's value-frame, resolves
  `selector.eval(context)` against that live frame, and installs the CONCRETE selector as a render-local
  OVERRIDE (`PrintOptions.spineSelectorNode`/`spineSelector`) — mirroring `atRuleHeaderPrelude`, NOT a
  canonical-node mutation (a resolved selector is output-affecting → transient per the loosened invariant).
  `Ruleset.effectiveHeaderSelector(options)` is the single accessor threading the override into BOTH
  `composePushedSelector` and `writeHeaderSelector`, so every header path sees the resolved form. Moved the
  spine frame-push to the TOP of `serializeRulesContainerInternal` (was at the bottom) so the frame + the
  resolved selector are live BEFORE header composition; re-entry is guarded by the override marker
  (`spineSelectorNode === node`). `isSpineEligibleRoot` widened to ADMIT interpolated selectors (deleted
  `selectorHasInterpolation`). Proven: `[data=@{attr-data}]` → `[data="foo"]` through the spine with
  `eval=0 derives=0`. Bug found+fixed during: the no-eval (string/plain-selector) descent path didn't set
  the override marker → infinite recursion (stack overflow in 3 tests); fix = always set the marker on
  descend, resolved-or-undefined. RATCHET: interpolated-selector-through-spine assertion (single-pass
  counter moves + `derive` not called + `[data="foo"]` + no `@{`). Core suite GREEN 3181/0/15. tsc: ZERO
  new errors (2 pre-existing `canMergeSameHeaderRuleset` `SelectorLike` lines only; verified my exact edit
  lines clean). DOCUMENTATION STANDARD: `spineSelectorNode`/`spineSelector` + `effectiveHeaderSelector` +
  `serializeSpineFrameContainer` all carry contract + invariant + OQ-A `@see`. NEVER used `git stash`
  (inspected prior state via `git show HEAD:path`). NEXT: at-rule containers, then `&`-composition.
  Backpedal self-check: override is a MODE-scoped transient on the KEPT serializer (no canonical mutation,
  no dual path); the eval path serves only not-yet-covered shapes; the frame pop chains on the async
  promise (never a sync `finally` — B1s guard preserved).
- 2026-07-08 · P1 · AT-RULE CONTAINERS landed (`@media`/`@supports`/`@container`). Added
  `serializeSpineFrameAtRule` (at-rule analogue of `serializeSpineFrameContainer`): resolves the PRELUDE
  against the ENCLOSING live frame at at-rule-enter (a `@media (@w)` prelude reads the enclosing scope, so
  eval BEFORE pushing the at-rule's own frame — mirrors `liftedAtRulePreludeRulesContext` intent), installs
  it via the EXISTING `atRuleHeaderNode`/`atRuleHeaderPrelude` render-local override (NOT canonical
  mutation), pushes the at-rule body value-frame, descends. `@media`→root HOISTING + the root-only
  composed-stack reset are the KEPT walk machinery in `serializeRulesContainerInternal` (`runContainer` +
  the `hoisted` branch), reused UNCHANGED (§7). `AtRule.render` gained a spineMode branch that serializes
  the SOURCE at-rule directly (skip `_evalForAtRuleRender`). New `PrintOptions.spineAtRuleNode` marker
  (re-entry guard + "frame pushed"). `isSpineEligibleAtRule` admits the conditional-group at-rules by NAME
  (`SPINE_ELIGIBLE_AT_RULES`). Proven: nested `@media` → concrete `eval=0 derives=0`; hoist
  `.card { @media { .inner {…} } }` → `@media screen { .card .inner {…} }` at root, `eval=0 derives=0`;
  both collapse modes. Found via core-suite delta: `@layer` needs eval-pass nested layer-NAME registration
  (3 tests) → EXCLUDED with precise reason; `@scope` excluded (special prelude/body); root-only excluded.
  RATCHET: at-rule-through-spine + @media-hoist-through-spine assertions. Core suite GREEN 3183/0/15. tsc:
  ZERO new errors (pre-existing at-rule implicit-any + serialize-helper canMerge lines only; my spine hunks
  verified clean). DOCUMENTATION STANDARD: `spineAtRuleNode` + `serializeSpineFrameAtRule` + `AtRule.render`
  spine branch carry contract + invariant + `@see §4/§7`. NEVER used `git stash` (`git show HEAD:path`).
  NEXT: `&`-composition (ampersand resolves at ruleset-enter from the live structural stack). Backpedal
  self-check: prelude override is a MODE-scoped transient on the KEPT serializer (no canonical mutation, no
  dual path — conditional-group at-rules have one path now: the spine); hoist machinery REUSED not
  reimplemented; frame pop chains on the async promise (B1s guard). Stopped at the at-rule boundary
  (ampersand is its own increment — the structural-stack `&` substitution is a distinct surface).
- 2026-07-08 · P1 · `&`-COMPOSITION landed (plain `&`). Plain ampersand — `&.foo`, `& + &`, `&:hover`,
  `& .child`, bare `&` — composes through the spine. KEY mechanism: `Ampersand.evalNode` reads the parent
  from `context.rulesetFrames` (top = immediate parent ruleset), NOT `composedSelectorStack`. So
  `serializeSpineFrameContainer` now (a) eval's the ruleset's `&`-selector against the ALREADY-present
  parent frame (resolving `&` from the live structural stack), then (b) pushes node's OWN frame onto
  `context.rulesetFrames` for its DESCENDANTS — ordering matters: node's frame must NOT be on the stack
  when its own `&` evals (else `&` = itself). The resolved selector becomes the header override (reusing
  the `spineSelector` override built for interpolation), so it emits concretely AND extend sees it (OQ-A).
  Both collapse modes. AMPERSAND-APPEND (`&-modifier`/`&-primary`) EXCLUDED with precise reason (found via
  the ampersand/nesting suite deltas — 2 residual failures after the frame fix): the anonymous-append
  suffix materializes + hoists ONLY via `Ampersand.evalNode`'s `appendValue` path (eval-pass frame state
  the spine does not reproduce); `selectorHasAmpersandAppend` (a `Node.walk` scan for an Ampersand with
  `appendValue`) gates it. Iteration story: admitting `&` naively broke 10 tests (eval-override destroyed
  `&`: `&-modifier`→`-modifier`); skip-eval-for-`&` fixed 2; the `rulesetFrames` push fixed 6 more; the
  remaining 2 were append → excluded. RATCHET: plain-`&`-compose-through-spine (`.parent.active`,
  eval/derive not called) + ampersand-append-excluded. Core suite GREEN 3184/0/15. tsc ZERO new errors
  (removed now-unused `F_AMPERSAND` imports from emit-walk + serialize-helper). DOCUMENTATION STANDARD:
  `serializeSpineFrameContainer` + `selectorHasAmpersandAppend` carry contract/invariant + `@see §7`.
  NEVER used `git stash` (`git show HEAD:path`).
  RECOMMENDED NEXT INCREMENT: the HARD DECL SHAPES (`+:`/conditional/`setDefined`/re-declared vars). Rationale:
  every structural container class (leaf-root, ruleset, at-rule, `&`) is now folded — the remaining big
  frontier is the VALUE path. Per-position value-binding (a re-declared `@x` read must see the value at the
  reader's source position, not last-wins) + cross-declaration merge (`+:` combines earlier same-prop
  decls) are what block the most remaining real content (real stylesheets shadow vars + use merges). It is
  also the P1 item that most changes the frame threading (the single upfront frame → per-position binding),
  so landing it consolidates the value-side spine before P2/P3. `@layer`/`@scope` (fold their eval-pass
  name/scope semantics) + `inherit` in-place span attribution are narrower follow-ups after.
  Backpedal self-check: `&` resolves from the LIVE structural stack (`rulesetFrames`), reusing
  `Ampersand.eval` + the header override — no canonical mutation, no dual path (plain `&` has one path: the
  spine); append is a precise coverage gap, not a safety fallback. Frame push/pop balanced across sync +
  async exits (`rulesetFrames.length = baseline` in `restore`). Stopped at the `&` boundary as directed.
- 2026-07-08 · P1 · PER-POSITION VALUE-BINDING landed (re-declared vars + `snapshot` reads — the
  eval-fold's core, as flagged). Root cause of the last-wins gap: variable resolution is ALREADY
  position-gated (`lookupScopeFrameVariable` compares the reader's `start` = `node.index` against each
  declaration's `sourceNode.index` in `declarationBucketsByName`), but those indices are assigned during
  EVAL/registration — which the spine skips — so through the spine every `node.index` was `undefined` and
  the gate was a no-op (last-wins). Fix: `assignSpineChildIndices(body)` numbers a scope's children at
  scope-enter (BEFORE `getScopeFrame`, so the buckets carry the indices), replicating the registration
  counter (one increment per non-`Comment` child). Called in `renderRootViaSpine` (root body) and
  `serializeSpineFrameContainer` (each ruleset body). Output-INVISIBLE canonical bookkeeping (§ruling 1);
  idempotent (skips already-numbered bodies). Chose the INDEX-assignment mechanism over incremental
  cell-population because the position-gated bucket lookup is the KEPT machinery — it just needed positions
  to gate on; no new frame-mutation-during-descent invariant. Proven:
  `@color:red; seen(snapshot):@color; @color:blue; later:@color` → `seen:red` (binding at its position),
  `later:blue`; `eval=0 derives=0`. Note: a PLAIN re-declared read (non-snapshot, `@color` after both
  decls) is last-wins on BOTH eval and spine (verified — matched, not a divergence); the position gate
  bites for `snapshot` / start-gated reads. Re-declared vars admitted in eligibility. `+:`/`+_:` merge +
  conditional/`setDefined` REMAIN excluded (this increment is per-position binding only — the merge needs
  `_coalesceMergedDeclarations` wired into the descent, a focused follow-up). RATCHET:
  re-declared-var/snapshot-per-position (`seen:red`/`later:blue`, eval/derive not called) +
  `+:`-merge-still-excluded. Core suite GREEN 3186/0/15. tsc ZERO new errors. serialize-helper imports
  `assignSpineChildIndices` from emit-walk (one-way dep; emit-walk does not import serialize-helper — no
  cycle). DOCUMENTATION STANDARD: `assignSpineChildIndices` JSDoc spells out the PER-POSITION INVARIANT (the
  subtle one) + why index-assignment not cell-population + `@see §2`. NEVER used `git stash`.
  RECOMMENDED NEXT ORDER: (1) `+:`/`+_:` merge (last VALUE-path piece — wire `_coalesceMergedDeclarations`
  into the spine descent); (2) conditional/`setDefined`; (3) `@layer`/`@scope` at-rules (+ ampersand-append
  hoist alongside); (4) `inherit` in-place span (narrowest). Backpedal self-check: reused the KEPT
  position-gated lookup — the only new thing is numbering canonical children (output-invisible), no dual
  path (re-declared/snapshot has one path: the spine), no cell-population invariant introduced. Merge stays
  a precise coverage gap, not a safety fallback. Stopped at the per-position boundary as directed.
- 2026-07-08 · P1 · `+:`/`+_:` PROPERTY-MERGE landed (in ruleset/at-rule bodies — the last big VALUE-path
  piece). New `tree/util/spine-merge.ts`: `planBodyMerges(children, resolveValue)` walks a body's DIRECT
  declaration children in source order at body-enter, groups same-property merge chains
  (`+:`/`&,:` → comma `List`; `+_:`/`&_:` → space `Sequence`), and returns a per-body PLAN — a WeakMap
  keyed by source decl: earlier chain members `{kind:'suppress'}`, the last member
  `{kind:'anchor', value: combined}`. Combining resolves each member's VALUE against the LIVE frame
  (`decl.eval().valueNode()`, MaybePromise). `withSpineMergePlan` (serialize-helper) installs the plan on
  `options.spineMergePlan` for the body descent (scoped save/restore; nested bodies each get their own),
  wired into `serializeSpineFrameContainer` + `serializeSpineFrameAtRule` descends. `resolveSpineLeafText`
  consults it: suppressed → emits '' (and the container leaf loop skips it like a hidden decl); anchor →
  eval the decl then `deriveWithParts({value: combined})` and set `normalizedFromAssign` on the TRANSIENT
  so it prints plain `prop: value` (not `prop+:`). Combined value = genuinely NEW node (design "NOT copies,
  stays"); NO canonical mutation, NO output tree, NO eval pass. Proven: `background+:red; +:blue` →
  `background: red, blue`; `transform+_:scale(1); +_:rotate(5deg)` → `transform: scale(1) rotate(5deg)`;
  both match the eval-path baseline, `eval=0 derives=0`. Widened `isSimpleSpineLeaf` to admit merge assigns
  (`MERGE_ASSIGNS`); kept conditional `?:`/`setDefined` excluded. ROOT-LEVEL `+:` (directly in the document
  root, not a ruleset) stays on eval path (`bodyHasDirectMergeDecl` guard in `isSpineEligibleRoot`) — the
  flat root path (`toRenderString`) doesn't run the plan; unusual shape. FINDING: the eval path's `+:`
  model is a merge-REFERENCE (reads prior value) resolved by the post-pass `_coalesceMergedDeclarations`;
  the spine PRE-COMBINES eval'd values into the anchor value instead — simpler, same output for the
  same-body subset the spine admits (cross-scope/mixin already excluded). RATCHET:
  `+:`/`+_:`-merge-through-spine (combined value emits, no `+:` operator, eval/derive not called) +
  root-merge/conditional-excluded. Core suite GREEN 3186/0/15. tsc ZERO new errors. serialize-helper
  imports `planBodyMerges` from spine-merge (one-way; no cycle). DOCUMENTATION STANDARD: `spine-merge.ts`
  module + `planBodyMerges`/`withSpineMergePlan` JSDoc spell out the plan model + no-canonical-mutation
  invariant. NEVER used `git stash`.
  RECOMMENDED NEXT ORDER: (1) conditional (`?:`)/`setDefined` scope-mutating assigns; (2) `@layer`/`@scope`
  at-rules (+ ampersand-APPEND hoist alongside); (3) `inherit` in-place span attribution (narrowest).
  Backpedal self-check: pre-combine reuses the same comma/space merge shape the eval path produces; the
  suppress/anchor plan is a side table (no `F_MERGE_SUPPRESSED` on the canonical source); `normalizedFromAssign`
  is set only on the per-emit TRANSIENT. No dual path for the covered subset (in-body `+:`/`+_:` has one
  path: the spine); root-level `+:` is a precise coverage gap, not a safety fallback. Stopped at the merge
  boundary as directed.
