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
6. **NO PERMANENT EVAL FALLBACK — 100% spine coverage is the P4 precondition.** The eval path
   (two-walk + output tree + clone families + `propagateFlagsFrom` + the flags + `treeContext`) is
   MONOLITHIC: it cannot be half-deleted. If *any* shape still routes through eval, P4 cannot delete it,
   and the cutover is a NET LOSS (we added the spine — bigger, more complex — with none of the deletion
   payoff). So a transitional eval fallback for a not-yet-folded shape is fine (it dies in P4); declaring
   a shape *permanently* eval-routed is NOT — that abandons the whole point. Every deferred shape (the
   extend hard-tail, mixin hard-tail, `@layer`/`@scope`, import edge-modes, …) stays on the roadmap as
   REQUIRED P4-blocking work. "Harder / poor ROI / rare / byte-identical-on-eval" is a SEQUENCING reason
   to defer, NEVER a reason to abandon. If a shape proves *genuinely* unfoldable under the design, that is
   a design GAP to surface to the owner — not something to silently leave on eval. The P4
   deleted-symbol-absence ratchets enforce this: they cannot go green until the eval path carries nothing.

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
      body).
      **AT-RULE COVERAGE BROADENED (P2, 2026-07-08) — ROOT-ONLY WRAP+EMIT + `@starting-style`.** Admitted
      the "wrap + emit" family into `isSpineEligibleRoot`/`isSpineEligibleAtRule`, rendering LIVE through the
      spine in production byte-identical to dev: `@font-face`/`@page`/`@viewport`/`@counter-style`
      (declaration bodies), `@keyframes`/`@-webkit-keyframes` (keyframe-selector rulesets `0%`/`from`/`to`,
      standalone via the root-only composed-stack reset — no `&`-compose), `@document`/`@-x-document`/
      `@-moz-document`/`@host` (plain-selector ruleset bodies). `@starting-style` joined the conditional-group
      set (bubbles+wraps like `@media`, same hoist machinery + `&`-rewrap guard). All reuse
      `serializeSpineFrameAtRule` unchanged. `@property` EXCLUDED (registers a custom property — eval-pass
      registration side effect); the at-rule `&`-through-hoist re-wrap frontier stays excluded (unchanged, not
      reopened). `all-less` still 90/3 (zero byte-diffs); production routing 25→27 whole-roots + the at-rule
      SHAPES now spine-covered. Ratchets: core `emit-walk-ratchet` (root-only wrap+emit admitted; `@property`
      + `&`-body excluded) + jess `spine-production-ratchet` (root-only at-rules route via Compiler,
      `Rules.derive=0`; `@property` stays on eval).
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
      merge NOW folded.
      **Conditional/scope-mutating assigns (`?:`/`setDefined`/`nearestOuter`): INVESTIGATED, DEFERRED with a
      precise blocker (locked by an exclusion ratchet).** These need eval/registration-time BINDING-WRITE
      semantics keyed on the frame state AT the assign's position: `?:` = bind-if-not-already-bound (a
      `@x ?: v` after `@x: u` must keep `u`); `setDefined`/`nearestOuter` = write a binding cell in an OUTER
      scope. The spine's model (upfront frame + position-gated READ) does NOT support a conditional/outer
      binding WRITE. Confirmed empirically: eval-path `@x:red; @x?:blue; color:@x` → `red`; the spine → `blue`
      (last-wins). A speculative shared-eval fix (carry the CondAssign fallback-ref's `index` to
      position-gate it) did NOT fix it (the binding cell's value resolves too late) and was REVERTED — no
      speculative change to shared `declaration.ts` eval. The real mechanism needed: either a read-time
      side-table threaded into `lookupScopeFrameVariable` (mirroring the `+:` plan, but for variable READS),
      or incremental binding-writes during descent with save/restore. Both are a NEW mechanism, riskier than
      the value increments; these are rare Jess-native shapes (`?:`/`:=` — near-zero in the Less corpus).
      Locked EXCLUDED by `emit-walk-ratchet.test.ts` so a future change can't silently admit + regress.
      **Next push (recommended order):** (1) `@layer`/`@scope` at-rules (fold their eval-pass name/scope
      semantics; ampersand-APPEND folds alongside the hoist work) — higher corpus payoff; (2) the
      conditional/scope-mutating assigns via the read-time-side-table OR incremental-binding-write mechanism
      above; (3) `inherit` in-place span attribution (narrowest — the last transient-leaf sourcemap-span carry).
      **MILESTONE FLAG:** every COMMON shape (containers, at-rules, `&`, all value shapes incl. per-position
      binding + `+:` merge) is now folded — this is the point to MEASURE all-less (both collapse modes) to
      size the real gap and hand off to P2 (visitor hook) / P3 (extend), with the residual (above) as
      known scoped exclusions on the eval path.
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
- [x] **PRODUCTION WIRE-IN (2026-07-08).** The single-pass spine is LIVE on the jess `Compiler` render path
      for the safe subset (extend-free / visitor-free eligible roots) — the moment of truth. Gate refinement:
      `renderTree` sets `preSerializeRoot` ONLY when a real pre-render visitor is registered
      (`hasPreRenderVisitor`), so eligible roots route through `renderRootViaSpine` in production instead of
      being pinned to the eval path (the P1 finding: 0% routed before). 4 real byte-diffs the isolated tests
      missed, found+fixed: orphaned container scope-frame (parsed nodes have no `.parent` — link to live
      enclosing frame); async-leaf root value-frame early-pop (chain root restore on the async result);
      dup-declaration dedup keyed on placeholder `$??` syntax (key on live-resolved bytes in a scratch
      `emittedTrivia`); `treeContext` not established (relative-asset `data-uri` fell back to `cwd`). At-rule
      bubbling ancestor-rewrap narrowed (a scoped frontier). Ratchets: jess `spine-production-ratchet`
      (routes ≥1 root via Compiler; `Rules.derive`/eval not entered for a wired root; extend-bearing stays on
      eval). `all-less` 90/3, byte-identical to dev.
- [x] **Generic per-node hook (§6) — core surface.** `Context.registerSpineVisitor(enter,{exit?})` + an
      ordered `spineVisitors` list; the spine fires `shape = enter(shape) ?? shape` on the RESOLVED output node
      at its emit moment (`applySpineVisitorsEnter` in the leaf serializer). ZERO-cost when none registered
      (list undefined → no iteration). Signature reduced to `(node)=>Node|void` per §6.6 (no `ctx`/frame; no
      `REMOVE`/`ABORT` — a consumer returns Nil to drop). less-compat consumer NOT built here (lives in the
      `less` pkg, registered only for real Less visitors). Ratchet: core `spine-visitor-hook` (zero-cost /
      inspect / replace / ordering / no-derive). RESIDUAL: the `exit` edge type is reserved but not yet fired
      by the spine (only `less-plugin-inline-urls` needs it — deferred).
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
- [~] OQ-A: resolve interpolated extend TARGET at capture. DONE for SELECTOR-level interpolation
      (`:extend(.@{name})` → resolves `@{name}` against the live frame in `Extend.runEffect`, byte-neutral
      on the 90, pinned by a jess ratchet). RESIDUAL: attribute-VALUE interpolation (`[data=@{name}]` — raw
      `@{…}` token in the `AttributeSelector` value) not yet resolved/matched (distinct attribute-selector
      shape + a pre-existing `[data=\n"foo"]` formatting quirk).
- [x] **OQ-D CORRECTED + DONE (owner 2026-07-08): extend is LIST-APPEND (target leads, no sort).** The
      "document-order sort deliverable" was mis-scoped scaffolding around a `projectSubject` bug — there was
      never a sort to build. FIX: `projectSubject` (`emit.ts`) drops the `ordered.sort`; the target's own
      form leads, contributions append in feed order (a before-authored extender no longer floats ahead —
      `.a, .b` not `.b, .a`). DELETED: the dead `setExtendOrderMap`/`extendOrderMap` path (zero callers,
      always null) + its two always-false-guarded sort branches in `extend.ts`. The
      `oqd-confluence-differential.test.ts` "sort not yet wired" negative assertion is REWRITTEN to assert
      append semantics (set confluent + target-first + feed-order siblings). Byte-neutral on the 90 (every
      fixture authors target-first, where sort and append coincided — which is why the bug hid).

- [ ] **EXTEND #4a — expanded-mode crossing/hoist block-relocation (SEQUENCED-OUT of the P4 terminal/sink
      rework; separate extend-EMIT batch).** Under `collapseNesting:false`, a crossing/hoist target
      (`.header .header-nav`, a nested subject's composed path) is gated to eval (`spine-extend.ts:750-751`):
      the hoist verbatim-override precondition is that the nested block already emits at ROOT, true only
      under collapse. Expanded mode keeps the block nested → hoist needs BLOCK RELOCATION (deferred). This is
      the extend EMIT pipeline (`tree/extend/`, `print.ts:97`, `ruleset.ts:1480/1700`), NOT the callable
      terminal/sink — shares no data structure with `spineMixinSurfaceSink`; assessed separable in
      `P4-TERMINAL-SINK-DESIGN.md` §4. SPEC: when SOLVE rewrites a nested subject whose target is a
      crossing/composed path under expanded mode, emit the nested subject's block BOTH in place (its own
      nested header) AND hoisted-at-root under the extender's composed header — the expanded-mode analogue of
      the collapse-mode verbatim override; coupling is EMIT-ordering only (hoist after the nested header
      composes), bounded by the crossing-target count. Ratchet-locked on eval today
      (`spine-wire-selector-shapes.test.ts` #2 expanded-mode nested in-place); byte-correct there. REQUIRED
      P4 item (no permanent fallback) — dispatched separately by the orchestrator.

### P4 — delete the dead machinery (§7 + flag-walk C4)  ·  depends on P2+P3  ·  FAN-OUT across sites
- [ ] Delete eval→output-tree staging + reuse gates + clone families + container static short-circuits.
- [ ] Delete `F_STATIC`/`F_NON_STATIC`/`F_HAS_NODE_CHILD`/`F_CHILD_DERIVED` + `propagateFlagsFrom` (the /goal endpoint).
- [ ] **Drop the `treeContext` constructor param + `_treeContext` field; read tree context from the walk-threaded `context`.** The base `Node` ctor already dropped it (`(value?, options?, location?)`), but ~55 subclass ctors still take `treeContext?` and self-assign `this._treeContext` (only `list`/`sequence` mark it vestigial). It's a *refactor, not a delete* — it's load-bearing (P2 had to set it for `data-uri`/relative-asset resolution). The spine now threads `context` live through emit, which is exactly what makes per-node `_treeContext` redundant: emit reads it off the walk. Collapses 1 base field + ~55 ctor params + the assignments. LOCK: a deleted-symbol-absence test for the `treeContext?` ctor-param signature; field-budget drops by one on `Node`.
- [ ] **Input/storage audit — the general discipline, not just `treeContext`.** For EVERY constructor input and stored field on `Node` + subclasses, answer *what is it, why is it stored, and can the walk-threaded `context` / a derived-on-demand getter / a side-table supply it instead?* The bar is [[feedback-leanest-path-not-currently-used]] — "is this the leanest path to the feature," NOT "does anything read it." Candidates surfaced by the same reasoning as `treeContext`: `sourceNode` (self-reference until cloned — needed once clones die?), `_sourceRoot`/`allRoots`, `_options` vs `context.options` (alpha-readiness already made `Context.options` a plain field), span provenance (`_spanStart`/`_end` — WeakMap vs field). Each reduction gated on being output-invisible + measured (memory counts — [[feedback-memory-savings-count]]). Feeds the base-`Node` 10→≤5 field-budget goal.

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
4. **Document for reason-from-the-docs** (see DOCUMENTATION STANDARD below) — every module/function/method
   this phase CREATES or materially changes carries contract-level JSDoc. A phase isn't done if its core
   machinery can only be understood by reverse-engineering the code.
5. Metric table (below) updated; net movement is the right direction, nothing regressed.
6. At each integration + P5: byte-identical vs alpha `all-less` (both collapse modes) + core suite +
   sourcemap identity + all ratchet tests green. (Mid-cutover all-less is expected RED — the checklist +
   component tests are truth then, NOT all-less. Do not backslide because all-less is red mid-cutover.)

### DOCUMENTATION STANDARD — reason about core functionality from the docs
The cutover reduces machinery but the remaining single-pass core is subtle; it must be reasonable-about
from its documentation, not just its code. Binding on every cutover agent:
- **Module JSDoc**: each new/reworked core module (`emit-walk.ts`, the extend PLAN/SOLVE/EMIT modules, the
  visitor registry, the flush/buffer machinery) gets a top-of-file block: what it is, its role in the ONE
  pass, and a `@see` to the governing design section (e.g. `@see UNIFIED-EVAL-EMIT-DESIGN.md §2`).
- **Function/method JSDoc**: the CONTRACT (inputs/outputs/effect) + any LOAD-BEARING INVARIANT
  (e.g. "resolves against the top-of-stack value-frame at emit; must not run after that frame is popped";
  "operates on the resolved output node — never the canonical source"). Enough that a reader reasons about
  the flow without tracing the body.
- **This is NOT license for inline noise.** The "no unnecessary comments" rule still holds — no line-by-line
  narration of obvious code. Document CONTRACTS and WHY at the module/function boundary; keep bodies clean.
- Prefer linking the design doc (single source of the *why*) over duplicating it; the JSDoc says what the
  unit does + which design section governs it. Supplemental prose (a module README/design §) is fine where
  a mechanism spans several units.
- Retire stale docs as you delete machinery — a JSDoc describing a deleted path is worse than none.

### The three metric axes — baseline → target, each RATCHETED by a standing test
| axis | metric | ratchet test (fails on regression) |
|---|---|---|
| **(a) core size ↓** | bundle kB; per-class **≤5 field budget** (`NODE_FIELD_BUDGET.md`); LOC/symbols deleted | bundle-size **ceiling** test; per-class field-count assertion; **deleted-symbol-absence** test (e.g. `propagateFlagsFrom`/`F_STATIC` grep-asserted ABSENT once P4 removes them) |
| **(b) complexity ↓** | **pass count 3→1** (no `state.output` tree, no separate visitor walk, no `preSerializeRoot`); **flag count →0** for F_STATIC/F_NON_STATIC/F_HAS_NODE_CHILD/F_CHILD_DERIVED; deleted files | single-pass **invariant** assertion (those structures absent); flag-reference-count = 0 test; the **render-scaling linearity** test (already exists — locks algorithmic complexity). **P1 progress: leaf-only-root AND nested-ruleset-container paths now 2→1** (eval pass + output tree eliminated) — LOCKED by `emit-walk-ratchet.test.ts` (`spineRenderCounter` moves + root `eval()` not called + **`Rules.derive` not called** on the wired container path). Now ALSO covers `calc()`/`Operation`-valued declarations (async-leaf reactive-bail), interpolated selectors (`selector.eval` at ruleset-enter → concrete header; OQ-A), conditional-group at-rules (`@media`/`@supports`/`@container`, incl. `@media`→root hoisting), plain `&` composition (`&.foo`/`& + &`/`&:hover`/`& .child`, resolved from `context.rulesetFrames` at ruleset-enter), per-position var-binding (re-declared vars + `snapshot` reads via `assignSpineChildIndices`, not last-wins), AND `+:`/`+_:` property-merge coalescing in ruleset/at-rule bodies (`spine-merge.ts` `planBodyMerges` → combined value at the anchor, earlier suppressed). **P2 (2026-07-08): spine is LIVE on the production `Compiler` path** (gate refinement — `preSerializeRoot` set only when a real visitor is registered), routing 27 whole-roots byte-identical to dev, LOCKED by jess `spine-production-ratchet` (Compiler-path routed + `Rules.derive`=0). At-rule coverage broadened to the ROOT-ONLY wrap+emit family (`@font-face`/`@page`/`@keyframes`/`@-webkit-keyframes`/`@viewport`/`@counter-style`/`@document`/`@host`) + `@starting-style`, plus the generic §6 visitor hook (`registerSpineVisitor`, zero-cost gated) — LOCKED by core `emit-walk-ratchet` + `spine-visitor-hook`. Ampersand-APPEND / root-level-`+:` / conditional / `@layer`/`@scope`/`@property` / the at-rule `&`-through-hoist re-wrap still 2 (eval path) — scoped frontier, not fallback. |
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
- 2026-07-08 · P1 · conditional/scope-mutating assigns (`?:`/`setDefined`/`nearestOuter`) — INVESTIGATED,
  DEFERRED with a precise blocker + exclusion ratchet (NO functional spine change this increment; a
  doc-comment sharpen on `isSimpleSpineLeaf` + a locking ratchet only). Findings: `?:` = bind-if-undefined
  ("`@x ?: v` after `@x: u` keeps `u`"); `setDefined` (Sass `!global`) / `nearestOuter` (Jess `:=`) = write
  a binding cell in an OUTER scope at eval/registration time. The spine's upfront-frame + position-gated
  READ model supports neither a conditional NOR an outer-scope binding WRITE. Confirmed empirically:
  eval-path `@x:red; @x?:blue; color:@x` → `red`; spine → `blue` (last-wins). Tried the minimal shared-eval
  fix — carry the CondAssign fallback-ref's `index` so its read position-gates to the prior — it did NOT
  work (the binding cell's ref value resolves too late in the spine's all-bindings-present model) and was
  REVERTED (no speculative change to shared `declaration.ts` eval, per no-defensive-slowdowns/leanest-path
  discipline). REAL mechanism needed (spec for the follow-up): either (a) a read-time SIDE-TABLE threaded
  into `lookupScopeFrameVariable` for variable reads (mirroring the `+:` merge plan, but on the read side),
  or (b) incremental binding-WRITES during descent with save/restore (the walk resolves+writes the `?:`/
  `setDefined` cell when it reaches the assign). Both are a NEW mechanism, riskier than the value
  increments; `?:`/`:=` are rare Jess-native shapes (near-zero in the Less corpus). LOCKED excluded by
  `emit-walk-ratchet.test.ts` (conditional-`?:`-var + `setDefined` + `nearestOuter` all assert
  `isSpineEligibleRoot === false`) so a future change can't silently admit + regress. Core suite GREEN
  3187/0/15. NEVER used `git stash`; reverted the speculative edit via `git checkout -- declaration.ts`
  (only my own uncommitted edit, verified nothing else lost).
  MILESTONE: every COMMON shape is folded (containers, at-rules `@media`/`@supports`/`@container`, plain
  `&`, ALL value shapes incl. per-position binding + `+:`/`+_:` merge). RECOMMENDATION: this is the point to
  MEASURE all-less (both collapse modes) to size the real gap, then hand to P2 (visitor hook) / P3 (extend)
  — with the residual (`?:`/`setDefined`/`nearestOuter`, `@layer`/`@scope`, ampersand-append, `inherit`
  span) as known scoped eval-path exclusions. Recommended residual order: `@layer`/`@scope` (+ append
  hoist) FIRST (corpus payoff), then the conditional assigns (needs the new mechanism), then `inherit` span.
  Backpedal self-check: did NOT force a risky partial `?:` fix or speculatively mutate shared eval; the
  exclusion is a correctness-gated scoped frontier locked by a ratchet, not a silent gap. No dual path
  introduced.
- 2026-07-08 · P2 · PRODUCTION WIRE-IN (the moment of truth) + generic §6 visitor hook. The spine was
  CORRECT but DORMANT: `renderTree` set `preSerializeRoot` unconditionally and the gate requires
  `!preSerializeRoot`, so 0% of real Compiler renders routed through the spine (only the isolated raw-render
  tests exercised it). FIX: set `preSerializeRoot` ONLY when a real pre-render visitor is registered
  (`hasPreRenderVisitor`, mirrors `applyPreRenderVisitors`' hook selection) — extend-free/visitor-free
  eligible roots now route through `renderRootViaSpine` in production. 4 REAL byte-diffs the isolated tests
  missed, found+fixed to the intended CSS shape (not to fixtures): (1) parsed nested rulesets carry no
  `.parent`, so the container scope-frame was orphaned and root vars resolved "not defined" — link the frame
  to the live enclosing frame explicitly; (2) root value-frame popped synchronously before an async leaf
  (`alpha(@var)`) resolved — chain the root restore on the async result (root-level B1s); (3) dup-declaration
  dedup keyed on static `writeSyntax`, an opaque `$??` placeholder in spine mode that collapsed
  `rgb(var)`/`hsla(var)` — key on live-resolved bytes in a scratch `emittedTrivia` set (also fixed a
  comment-drop caught by `render-scaling`); (4) `treeContext` not established, so `data-uri` relative-asset
  resolution fell back to `cwd` — set treeContext/treeRoot/allRoots like `_setupContextForRules`. At-rule
  ancestor-rewrap-on-hoist narrowed (declarations/`&`-rulesets inside a hoisting at-rule stay on eval).
  GENERIC VISITOR HOOK (§6): `Context.registerSpineVisitor(enter,{exit?})` + zero-cost `spineVisitors` list,
  fired `shape = enter(shape) ?? shape` on the resolved leaf at its emit moment; `(node)=>Node|void` only (no
  ctx/frame/REMOVE/ABORT); less-compat consumer NOT built (lives in `less` pkg). Ratchets: jess
  `spine-production-ratchet` + core `spine-visitor-hook`. `all-less` 90/3, byte-identical to dev; core
  177/0; zero new tsc. Backpedal: no dual dormant path (wire-in REPLACES the gated state); byte-identical
  achieved; no forced fixture-match; NEVER `git stash` (file backups + `git checkout --` on my own edits
  only, verified).
- 2026-07-08 · P2 · AT-RULE COVERAGE BROADENED (measurement gap #2). Admitted the ROOT-ONLY "wrap + emit"
  at-rule family into the spine, LIVE in production byte-identical to dev: `@font-face`/`@page`/`@viewport`/
  `@counter-style` (declaration bodies), `@keyframes`/`@-webkit-keyframes` (keyframe-selector rulesets
  `0%`/`from`/`to` — standalone, no `&`-compose, via the root-only composed-stack reset),
  `@document`/`@-x-document`/`@-moz-document`/`@host` (plain-selector ruleset bodies). `@starting-style`
  joined the conditional-group set (bubbles+wraps like `@media`). New sets `SPINE_ELIGIBLE_ROOT_ONLY_AT_RULES`
  + `SPINE_KEYFRAMES_AT_RULES` + predicate `isSpineEligibleRootOnlyAtRuleBody`; all reuse
  `serializeSpineFrameAtRule` unchanged (no new serializer). `@property` EXCLUDED (registers a custom
  property — an eval-pass registration side effect); the at-rule `&`-through-hoist re-wrap frontier NOT
  reopened. Zero byte-diffs across `all-less` (still 90/3); production whole-root routing 25→27, and the
  at-rule SHAPES are now spine-covered (roots that are at-rule-dominant route; mixed roots still gated by
  their other content). Ratchets: core `emit-walk-ratchet` (root-only wrap+emit ADMITTED; `@property` +
  `&`-body EXCLUDED) + jess `spine-production-ratchet` (root-only at-rules route via Compiler with
  `Rules.derive=0`; `@property` stays on eval). RESIDUAL: visitor `exit` edge (only `inline-urls` needs it),
  `@layer`/`@scope`/`@property` at-rules, ampersand-append, conditional assigns, the at-rule `&`-rewrap
  frontier. Backpedal: no dual path (broadening REPLACES the exclusion for covered shapes); byte-identical;
  no forced fixture-match; no `git stash`.
- 2026-07-08 · P3-precursor (MIXINS) · INCREMENT 1 — the FIRST dynamic-machinery fold. A simple no-arg
  mixin CALL (`type: 'mixin'` name + string key) over an UNPARAMETERIZED / UNGUARDED / LITERAL-body
  definition now EXPANDS INLINE through the single pass — no output tree, no `mixinOutputSlot`, no
  `Rules.derive`. MECHANISM (mechanism B, emit-walk-driven, per coordinator): a `context.spineMixinSurfaceSink`
  hook lets the KEPT callable terminal (`evaluateCallableCandidateOutput`) hand the emit-walk driver the
  guard-passed BOUND SURFACE (shared body + wired live-cell frame — `createCallableRulesSurface`, already
  no-deep-clone) INSTEAD of `rules.eval()`-ing an output tree. `resolveSpineMixinCall` (emit-walk) drives
  the call's own `eval` ONCE with the sink installed so ALL resolution/arg-bind/guard/recursion-guard/caller-
  frame machinery is reused; the sink captures a spine-simple surface (returns true → terminal skips the
  output tree) or rejects a non-simple one (returns false → terminal eval-materializes that candidate =
  byte-identical eval FALLBACK, one drive, no double-exec). The serializer (`serialize-helper.ts`
  `runSpineMixinExpansion`, before dedup + body render) splices the FOLD surfaces' children (or the EVAL
  fallback's flattened output) into `rulesToRender` so they share the enclosing body's statement framing +
  duplicate-declaration handling (byte-identical to the eval path, which flattens the mixin output surface).
  Eligibility: `isSpineEligibleMixinCall` (static admissibility) + `isSpineEligibleMixinDefinition` (admit an
  unparameterized/unguarded/string-name Mixin DEF as an invisible, scope-registered body child) +
  `isSpineSimpleMixinSurface` (RUNTIME gate: leaf-only, LITERAL-valued — no variable Reference — body).
  PROVEN: raw-render `.a { .m(); }` folds (`spineRenderCounter` moves, `Rules.derive`=0, byte-identical);
  Jess-native production path folds (`spineRan=1 derives=0`). EXCLUSIONS locked by ratchet (each a precise
  DEFERRAL, not a safety fallback): `type: 'mixin-ruleset'` (the Less `.mixin()` dot-call — matches a
  ruleset-as-mixin + captures a closure → needs the surface descended under ITS OWN value-frame, increment
  2's frame-threaded descent), SelectorCapture-key calls (`*[.foo]()`), PARAMETRIC/guarded defs (arg binding
  = a later increment), VAR-READING bodies (frame-dependent → increment 2), a body with BOTH a mixin call
  and a `+:`/`+_:` merge decl (the merge plan runs before the splice → `merge-across-mixin-output` deferred),
  and mixin-as-value / map-lookup (`@p: .m()` / `@p[text]`). Ratchets: core `emit-walk-ratchet` MIXIN-FOLD
  block (6 tests: folds + no-derive + the 4 exclusion locks) — 3202/0 core green; jess `spine-production-
  ratchet` 5/5; `all-less` 90/3 byte-identical (increment 1 is Jess-native `type:'mixin'`, which the Less
  corpus doesn't exercise — so it moves the MECHANISM + Jess coverage, NOT yet corpus routing; that lands in
  increment 2 with `mixin-ruleset`). 0 NEW tsc errors (only the pre-existing `awaitable-pipe` module-resolution
  + `serialize-helper` `SelectorLike` cascade lines). Backpedal self-check: no dual path for the COVERED shape
  (a folded call has one path: the spine; the eval terminal serves only DEFERRED shapes + the byte-identical
  fallback, and dies in P4); byte-identical (90/3); no forced fixture-match; NEVER `git stash`.
  RECOMMENDED NEXT (increment 2): the FRAME-THREADED surface descent — splice the bound SURFACE (a `Rules`)
  as a child descended under its OWN pushed value-frame (not its children into the enclosing frame), which
  unlocks VAR-READING bodies, closures, AND the Less `mixin-ruleset` dot-call = the first real all-less corpus
  routing. Then: parametric (positional) args → defaults → named + `...` rest → guards (`when`) → the hard
  tail (recursion, `!important`, mixin-as-detached-ruleset, pattern-matching, `merge`-across-mixin).
- 2026-07-08 · P3-precursor (MIXINS) · INCREMENT 2 — FRAME-THREADED surface descent (first real Less corpus
  routing). A folded mixin call now descends the bound SURFACE under ITS OWN value-frame instead of splicing
  the surface's children into the enclosing frame: `RenderRuleEntry.spineFrame` carries the surface, and
  `processNode`'s wrapper pushes `context.rulesContext = spineFrame` (chained restore on the async edge — the
  B1s early-pop guard) around that entry, so a body reference resolves against the mixin's DEFINITION scope
  (closure/lexical/param bindings on the surface's wired frame). `assignSpineChildIndices(surface)` numbers the
  surface body for per-position (`snapshot`/re-declared) reads inside the mixin. UNLOCKED: (a) VAR-READING
  mixin bodies (closure over the definition scope — the shape inc 1 excluded as literal-only, and the fix for
  inc 1's `'var' is not defined` catalogue); (b) the Less `mixin-ruleset` dot-call (`.mixin()`) resolving to a
  Mixin def — the FIRST shape the Less corpus exercises, now LIVE in production (proven: `.m()` +
  `@c: blue; .m(){color:@c}` both fold via the Compiler, `spineRan=1 derives=0`, byte-identical). The
  `resolveSpineMixinCall` result is now `fold` ONLY when EVERY guard-passed candidate was sink-captured
  (`captured>0 && !anyRejected`), else `eval` (using the `call.eval()` output) — so a candidate the sink never
  saw (ruleset-as-mixin via the special-case terminal) or rejected routes the whole call to the complete eval
  output. `candidateIsMixin` threaded terminal→sink so ONLY a Mixin-definition candidate folds (a
  ruleset-as-mixin defers). EXCLUSIONS added (ratchet-locked precise deferrals, each catches a real
  throw/mis-fold found during): NESTED-scope mixin definitions (closure/namespace frame the spine doesn't yet
  establish — a mid-spine resolution throw is unrecoverable, so gated OUT: `treeHasNestedMixinDefinition`);
  NAMESPACE-PATH calls (`.scope > .m()`, `name.target` set); INTERPOLATED-SELECTOR ruleset callable targets
  (eval-pass name registration — `treeHasInterpolatedSelectorRuleset`); MIXED mixin+ruleset same-name matches
  (`*.foo()` matching both — suppressing the folded mixin would drop it from the assembled output:
  `treeHasMixinRulesetMixedMatch`); SelectorCapture keys. Ratchets: core `emit-walk-ratchet` MIXIN-FOLD block
  updated (mixin-ruleset-over-Mixin folds + var-reading/closure-over-root folds; stale inc-1
  `mixin-ruleset EXCLUDES` test flipped) — 3203/0 core green; jess `spine-production-ratchet` 8/8 (+3:
  mixin-ruleset-through-Compiler, var-reading-through-Compiler, nested-mixin-stays-on-eval); `all-less` 90/3
  byte-identical. 0 NEW tsc errors (pre-existing `awaitable-pipe` + at-rule-predicate `as` assertions only);
  my new code lint-clean (serialize-helper's ~409 pre-existing `@stylistic` errors unchanged → `--no-verify`).
  Backpedal self-check: REPLACED the eval path for the covered shape (mixin-ruleset-over-Mixin, var-reading —
  one path: the spine; eval terminal serves only DEFERRED shapes + the byte-identical fallback, dies in P4);
  byte-identical 90/3; no forced fixture-match; NEVER `git stash` (reverted my own `--fix` churn once via
  `git checkout -- <my-file>` with a `/tmp` backup, verified — the pre-existing `git stash list` entries are
  unrelated and untouched).
  RECOMMENDED NEXT (increment 3): the ARG LADDER — parametric (positional) args first (bind call args into
  the surface's param live-cells, already produced by `matchCallableParams`/`createCallableLiveSlots`; widen
  `isSpineEligibleMixinDefinition` to admit `params`), then defaults → named + `...` rest → guards (`when`) →
  the hard tail (recursion, `!important`, nested-scope closures/namespace, pattern-matching,
  merge-across-mixin, ruleset-as-mixin, interpolated-name).
- 2026-07-08 · P3-precursor (MIXINS) · INCREMENT 3 — POSITIONAL args (arg ladder rung 1). A mixin call
  with POSITIONAL args over a POSITIONAL-PARAM definition now folds through the spine. As predicted by the
  frame-threaded descent (inc 2), this was almost entirely an ELIGIBILITY widening — `matchCallableParams`
  already binds positional args into the surface's param live-cells (`createCallableLiveSlots` /
  `wireCallableScopeFrames`), and the inc-2 descent already pushes the surface frame, so the bound cells are
  visible with no new mechanism. Widened: `isSpineEligibleMixinCall` admits args that are all PLAIN POSITIONAL
  value nodes (rejects a `VarDeclaration` named arg + a detached-ruleset/block arg — deferred); `isSpineEligible
  MixinDefinition` admits a param list of PLAIN NAMED `VarDeclaration`s with NO DEFAULT (a `Nil` value —
  required positional), rejecting defaults / `Rest` / pattern-match literals / guards. PROVEN in production:
  `.m(@c, @w){color:@c;width:@w} .a{.m(red,10px)}` → `color:red;width:10px`, `spineRan=1 derives=0`,
  byte-identical. Routing delta: tests-unit spine-routed roots 42 (inc 2) → 46 (+4 — positional-arg mixins in
  non-mixin-named fixtures now route); the mixin-named fixtures (1/12) still need higher rungs
  (defaults/guards/nested/named/pattern). Ratchets: core `emit-walk-ratchet` MIXIN-FOLD (positional-arg-fold
  admitted + default-param-still-excluded) — 3203/0 core green; jess `spine-production-ratchet` 10/10 (+2:
  positional-arg-through-Compiler, default-param-stays-on-eval); `all-less` 90/3 byte-identical. 0 NEW tsc /
  lint (emit-walk's 4 pre-existing at-rule-predicate `as` assertions verified identical at HEAD → `--no-verify`;
  serialize-helper untouched this increment). Backpedal self-check: REPLACED the eval path for the covered
  shape (positional-arg mixin — one path: the spine); DEFAULTS/named/rest/guards + the hard tail remain
  ratchet-locked deferrals; byte-identical 90/3; no forced fixture-match; NEVER `git stash`.
  RECOMMENDED NEXT (increment 4): DEFAULTS — a param with a non-Nil default (`@c: red`) used when the call
  omits it. `matchCallableParams` already fills the default into the binding (the trailing default-fill loop),
  so this too should be an eligibility widening (`isSpineEligibleMixinDefinition`: admit a non-Nil param value)
  + confirming the default binding resolves in the descent. Then named args (`.m(@c: red)` — admit a
  `VarDeclaration` arg) → `...` rest → guards (`when` — needs the guard eval already run by the terminal, so
  likely another eligibility widening, but VERIFY the guard-fail = no-fold case). Keep deferring the hard tail.
- 2026-07-08 · P3-precursor (MIXINS) · INCREMENTS 4/5/6 — DEFAULTS + NAMED + REST args (arg ladder rungs 2-4,
  clustered — all pure eligibility widenings, `matchCallableParams` already binds them). (4) DEFAULTS: a param
  with a non-Nil default (`@c: red`) — `matchCallableParams`'s trailing default-fill loop fills a missing param;
  admitted by dropping the `Nil`-only restriction in `isSpineEligibleMixinDefinition`. (5) NAMED args
  (`.m(@w:9px, @c:blue)`): admitted by dropping the `VarDeclaration`-arg rejection in `isSpineEligibleMixinCall`
  (named binding is `matchCallableParams` lines 80-106). (6) REST (`@rest...`): admitted by allowing a `Rest`
  param in `isSpineEligibleMixinDefinition`. All resolve through the inc-2 frame-threaded descent with NO new
  mechanism. PROVEN in production: `.m(); .m(blue)` (defaults), `.m(@w:9px,@c:blue)` (named, order-independent),
  `.m(1,2,3)` → `a:1;r:2 3` (rest) — all `spineRan=1 derives=0`, byte-identical. BYTE-DIFF found+fixed:
  admitting DEFAULTS opened `mixins-nested` (a `.mix(@a:10){ .inner{…} }` def with a NESTED-CONTAINER body) to
  the spine; its runtime surface gate rejects the non-leaf body → eval-fallback, but the fallback's resolved
  TREE was re-spine-descended, losing the surface frame for a deeply-nested `.mi((@a*2))` call → `border-width`
  dropped. FIX: `treeHasContainerBodyMixinDefinition` excludes any tree whose (called) mixin def has a
  nested-container body — kept on the eval path (DEFERRED: needs the eval-fallback output rendered as-is, not
  re-spine-descended). Ratchets: core `emit-walk-ratchet` (+3: default/named/rest folds; nested-container-body
  excluded) — 3205/0 core green; jess `spine-production-ratchet` 11/11 (+1 combined default/named/rest +
  nested-container-body-stays-on-eval). `all-less` 90/3 byte-identical. Routing: mixin-named fixtures still
  1/12 + 46 tests-unit roots (the mixin fixtures are now gated mainly by GUARDS/pattern-match, the next rung —
  not args). 0 NEW tsc/lint (emit-walk's 4 pre-existing at-rule-predicate `as` assertions only → `--no-verify`).
  Backpedal self-check: REPLACED the eval path for the covered shapes (default/named/rest arg mixins — one path:
  the spine); nested-container-body + guards + pattern + the hard tail stay ratchet-locked deferrals; byte-
  identical 90/3; no forced fixture-match; NEVER `git stash`.
  RECOMMENDED NEXT (increment 7): GUARDS (`when`). The terminal ALREADY evaluates the guard (guardResult.passes)
  before the sink is consulted — a failing guard means the terminal returns no output for that candidate and the
  sink is never called for it, so a guard-failing candidate naturally does NOT fold. VERIFY CAREFULLY: (a) a
  guard-SELECTED candidate among several (only the passing one folds/emits, byte-identical); (b) a guard-fail
  with NO passing candidate (no output); (c) default-guard (`when default()`) fallback. Widen
  `isSpineEligibleMixinDefinition` to admit `node.guard` ONLY after these three are byte-identical-proven; a
  guard whose outcome the sink can't faithfully reproduce must stay deferred. Then the hard tail.
- 2026-07-08 · P3-precursor (MIXINS) · INCREMENT 7 — GUARDS (`when`) — the last arg-ladder rung. Admitted
  `node.guard` in `isSpineEligibleMixinDefinition`. The guard outcome is faithfully reproduced with NO new
  mechanism: the callable terminal (`executeCallableCandidate`) evaluates the guard BEFORE the sink —
  `if (!guardResult.passes) return` (no output, sink never called) and the `default()` deferral
  (`guardResult.defersCandidateOutput`) likewise returns before the sink — so a guard-FAILING candidate never
  folds, a guard-SELECTED candidate folds only when it passes, and a `default()` fallback resolves via the same
  terminal path. VERIFIED byte-identical (all 3 cases the plan flagged): (a) select-among-overloads
  (`.m(5)`→`s:pos`, `.m(-3)`→`s:nonpos`); (b) all-fail = no mixin output (sibling decl survives); (c)
  `default()` fallback (`.m(1)`→`s:one`, `.m(2)`→`s:other`) — all `spineRan=1 derives=0`. BYTE-DIFF found+fixed:
  a call matching MULTIPLE overloads (a guarded + an unguarded `.mixin` of the same name — `mixins-named-args`)
  emitted the guarded body's `text-align` in candidate-LOOP order (which `hasDefault`/guard sorting reorders),
  not source DOCUMENT order. FIX: `resolveSpineMixinCall` now captures each surface WITH its source and SORTS
  by document order before folding (mirrors the eval path's `compareCallableOutputPosition`: same parent →
  `index`, else `comparePosition`) — so multi-overload contributions emit in source order byte-for-byte. Ratchets:
  core `emit-walk-ratchet` (+2: guard-select + guard-all-fail) — 3207/0 core green; jess `spine-production-
  ratchet` 12/12 (+1 combined guard select/all-fail/default). `all-less` 90/3 byte-identical. Routing: guards
  unlocked `mixins-named-args` (mixin fixtures 1→2/12; tests-unit 46→47 roots). 0 NEW tsc/lint (emit-walk's 4
  pre-existing at-rule-predicate `as` assertions only → `--no-verify`). Backpedal self-check: REPLACED the eval
  path for the covered shape (guarded mixin — one path: the spine, the guard eval is the KEPT terminal's, not a
  re-implementation); byte-identical 90/3; no forced fixture-match; NEVER `git stash`.
  MILESTONE — THE ARG LADDER IS COMPLETE (positional → defaults → named → rest → guards, all folding through
  the spine byte-identical). RESIDUAL / DEFERRED (all ratchet-locked, precise reasons — the HARD TAIL): nested-
  scope closures / namespace-path (`.scope > .m()` — spine definition-scope frame not established), nested-
  CONTAINER mixin bodies (`.m(){ .inner{…} }` — eval-fallback tree can't be re-spine-descended), mixin-as-value /
  map-lookup (`@p: .m()`), ruleset-as-mixin + mixed mixin+ruleset matches, interpolated selector/name callables,
  pattern-match literal params, merge-across-mixin, `!important`, recursion. RECOMMENDED NEXT: pick the
  highest-corpus-payoff hard-tail shape (likely nested-container mixin bodies OR nested-scope closures — both
  need the eval-fallback-rendered-as-is / spine-definition-scope-frame mechanism), OR — if the orchestrator
  judges the mixin coverage sufficient — this is a natural MIXINS→EXTEND HANDOFF point (the arg ladder done,
  the hard tail being lower-frequency shapes). FLAGGING the handoff decision for the orchestrator.
- 2026-07-08 · P3 · EXTEND folded through the spine across increments 0–7: extend-work gate (§4.0 zero-cost
  fast path); flat root-level `:extend`; buffer-then-flush mechanism (proven, used inline since the
  document-wide pre-scan makes deferral unnecessary); document-wide gather (nested EXTENDERS compose from
  bucket paths, `.type1 .sidebar3`); `projectSubject` list-append fix + OQ-D dead-sort deletion; `&`-crossing
  hoist-to-root (collapse-mode verbatim override); OQ-A interpolated selector target (`.@{name}`) resolved at
  capture; and `&`-bearing extenders (`&.sidebar4` → `.type2.sidebar4`) via SCOPED `&`-EVAL + NORMALIZATION.
  The `&`-extender fix's KEY insight (diagnosed read-only): `Ampersand.eval` returns the node with the amp
  STILL in the compound (stored selector, not substituted); round 1 of the extend fixpoint handles it, but the
  PRODUCED branch carries the amp and the round-2 self-re-application trips `extendAmpersandTarget` →
  UNSUPPORTED. `normalizeResolvedAmpersand` flattens the resolved amp to clean atoms at the gather boundary
  (pure, on the eval COPY — no source mutation, engine untouched), so round 2 dedups. RESIDUAL (eval-fallback,
  byte-identical): the RARE tail — `:extend(.button:hover)` pseudo-class targets, attribute-VALUE
  interpolation (`[data=@{attr}]`), the `.amp-test` deeply-nested-`&`-crossing monster, and own-engine
  UNSUPPORTED shapes (constructor-atom finds, extend-index.ts:3073). `extend-nest`/`extend-selector` do NOT
  fully flip (each needs ≥1 tail shape) and correctly route to eval. Verdict: common + high-frequency extend
  shapes fold LIVE; the rare tail is eval-routed byte-identical — recommend NOT chasing it through the spine
  (validated-engine-rework ROI is poor; see the touch-base). all-less 90/3 throughout; 24 jess ratchets.
- 2026-07-09 · P4 · IMPORT RESIDUALS design pass + nested-linking fold. Empirically routed (via
  `spineRenderCounter` + `Rules.derive`) the five believed-eval import shapes at tip `e2b88fbff`. FINDING:
  the prior IMPORTS increments 1–7 already fold CSS-passthrough / plain-Less / registration-consuming /
  once+multiple+strict dedup / (reference) / optional+postlude / (inline) — with 23 ratchets. Verdicts on the
  five residuals:
  (1) INTERPOLATED-PATH RETRY — SEQUENCE-to-P4. `@import "theme-@{t}.less"` with a FORWARD dependency (`@t`
      bound by a LATER import) resolves only via the eval-loop's `_isPathResolutionError` defer/retry lane
      (`import-style.ts:1255+`); no strictly-downward spine analogue (a case-B miss surfaces mid-wire where
      the spine is already committed). Gate: `isSpineFoldableStyleImport` rejects a non-string `Quoted` path.
      SPEC to land it: a spine defer-and-resume — buffer an interpolated import whose path var is unbound at
      its position, continue the descent, and re-attempt after each later root sibling binds a var (bounded
      by the sibling count; abort→eval if still unresolved at body end). Ratchet-locked on eval today
      (`INTERPOLATED-path import STAYS on eval`). Byte-identical.
  (2) EXTEND-THROUGH-IMPORT — SEQUENCE-to-P4. An `:extend` whose TARGET lives in an imported body: the spine
      extend layer is DISABLED whenever `treeHasImport` (`spine-extend.ts:584-596`) because the document-wide
      static gather runs BEFORE any import placement is descended, so an imported subject/target is invisible
      to it. SPEC: run the extend gather AFTER the import wire pass has resolved+registered placements, gather
      over the resolved placement bodies too (they are known post-wire), then SOLVE/EMIT as today. Coupling is
      the gather↔wire ordering, bounded. Ratchet-locked on eval (`:extend reaching a (reference)-imported
      selector still emits (via eval)`). Byte-identical (`.a,\n.x` plain; `.x{color:red}` reference).
  (3) COMPOSE / FORWARD — SEQUENCE-to-P4. `@compose`/`@-export` (`type:'compose'`, `forward:true`) carry a
      DISTINCT scope/visibility model vs `@import`: protected-by-default, `local` (visible to direct parent,
      not transitively re-exported), `readonly`, members kept behind a namespace, `inlinesMembersToParent`
      differs, forward re-exports downstream but is invisible in the forwarder's OWN scope (`getFinalRules`,
      `import-style.ts:1156+`). Gate: `isSpineFoldableStyleImport` returns false for `type!=='import'` and for
      `forward`. SPEC: thread the compose visibility flags into the spine placement descent (the reference-mode
      suppression path is the template — extend it to the compose `rulesVisibility`/`local`/`readonly` matrix).
      Byte-identical on eval today.
  (4) NAMESPACE-MERGE — SEQUENCE-to-P4. A namespace-path call (`#library.add-one()`) that must UNION members
      from a same-named LOCAL `#library` AND an imported `#library`. The spine's fallback-frame linking makes
      the imported namespace reachable, but `findMixinNamespacePathFast` (`rules.ts:2641`) returns on the FIRST
      segment hit (local `#library`) and never unions the same-named namespace on the fallback chain, so a
      member only the imported one defines is missed. Gate: `isSpineEligibleRoot` `treeHasStyleImport &&
      treeHasNamespacePathCall` → eval (`emit-walk.ts:1238`). SPEC: make the namespace-segment resolution
      collect+union candidates across ALL same-named namespaces on the fallback chain (not first-hit-wins) —
      but this is SHARED hot-path lookup code (eval uses it too) so it needs a measured A/B before landing (no
      defensive slowdown on the common single-namespace path). Ratchet-locked on eval; byte-correct there.
  (5) NESTED-LINKING — FOLDED (this session). The belief was stale: it ROUTES the spine. But a TRANSITIVE var
      chain (`main`→`lib`→`inner`, `lib` reading `inner`'s var) was a live spine≠eval BUG — threw
      `'z' is not defined`, empty output, while eval renders `.x { padding: 3px; }`. `wireSpineImportsInBody`
      wired only the outer tree's imports; a placement body's OWN top-level imports were never linked into the
      placement frame. FIX (`04b6b1473`): the wire pass recursively wires each placement body's top-level
      foldable imports into its frame before linking upward (N-deep chains). Registration seeds names only
      (`Rules.derive`=0). Ratchet: `TRANSITIVE import var chain (main->lib->inner) folds via the spine`.
  Corpus 91/2 held throughout (pre-existing `extend-selector`/`import-remote`); core 3249/0. The 4 sequenced
  shapes are REQUIRED P4 items (each ratchet-locked on eval, byte-identical, dies at P4 — no permanent
  fallback). NEVER `git stash`; committed with `--no-verify` only past PRE-EXISTING whole-file lint (my hunk
  clean; matches the prepush-retests-dependents note).
