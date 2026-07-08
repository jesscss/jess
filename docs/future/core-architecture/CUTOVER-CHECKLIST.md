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
- [ ] Emit descends the SOURCE tree with the live value-frame stack pushed/popped by the walk; a leaf
      resolves `resolve(sourceLeaf, currentFrame)`→bytes at its emit moment; no `state.output` tree.
- [ ] Mixin/loop/`$for`/`$if` bodies descended SHARED under a pushed frame (no copy); `inherit`'s per-node
      span/flag stamping ELIMINATED (span read off the source node in place).
- [ ] Selector interpolation resolves at ruleset-enter (frame live) → concrete selector available to extend.

### P2 — per-node inline visitor model (§6)  ·  depends on P1
- [ ] Replace the separate visitor walk + `preSerializeRoot` with the generic per-node hook
      `(node,ctx)=>void|Node|REMOVE|ABORT` at enter/exit edges; delete `TreeVisitor`/driver.
- [ ] Generic API in core, Less-agnostic (less-compat registered by the `less` pkg, optional side-dep).
- [ ] `beforeEval` pre-walk: owner-pending (§6.8) — keep as a separate structural pre-walk feeding the
      same contract unless owner drops v5 pre-eval compat.

### P3 — extend wired into the pass (§4)  ·  depends on P1; overlaps P2
- [ ] `runExtendPipeline` (PLAN reachability + target index → SOLVE global fixpoint → EMIT compose/hoist/
      collapse) REPLACES the `processExtends` apply. Buffer-then-flush discipline (§4.4): decls stream to
      per-subject buffer, headers deferred, early-flush per the §4.4.3 predicate.
- [ ] EMIT projects (B): `placement`/`origin`(`F_EXTENDED`/`F_EXTEND_TARGET`)/`order`/`visible`/`generated`
      onto branches (the B2 flag work — on the branch, never the shared source selector).
- [ ] Resolve interpolated extend TARGET at capture (OQ-A fix, `extend.ts:341`) so `:extend([data=@{attr}])` works.

### P4 — delete the dead machinery (§7 + flag-walk C4)  ·  depends on P2+P3  ·  FAN-OUT across sites
- [ ] Delete eval→output-tree staging + reuse gates + clone families + container static short-circuits.
- [ ] Delete `F_STATIC`/`F_NON_STATIC`/`F_HAS_NODE_CHILD`/`F_CHILD_DERIVED` + `propagateFlagsFrom` (the /goal endpoint).

### P5 — final gate + merge
- [ ] Byte-identical vs alpha `all-less` (both collapse modes) + core suite green + sourcemap identity.
- [ ] The 4 perf dimensions measured (fast-reject / chained / clock / memory) — now a REAL swap, not additive.
- [ ] Merge `work/cutover` → `dev`.

## Progress log
(agents append: date · phase · what landed / what's blocked)
- 2026-07-08 · P0 · checklist created.
