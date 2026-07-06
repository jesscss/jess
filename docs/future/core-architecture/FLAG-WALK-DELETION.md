# Flag-Walk Deletion — audit & plan

**Goal:** delete `propagateFlagsFrom` (`node-base.ts:684`) — the per-child flag-bubble
crawl paid at construction AND re-paid at eval-time whenever a derived/eval node
"recomputes its flags by crawling shared children." Every flag it computes is either
removable, measured-worthless, or re-scopable to a narrower structure.

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
| `F_STATIC` / `F_NON_STATIC` | **remove readers, then delete** — several classes, one coupled to the single-render-pass rework | staged; last |

Killing the first three empties the walk of everything except the static bit; killing the
static readers finishes it.

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

**Approach:** replace each read with a direct value inspection (does `this.value` contain a
`Node` — an `instanceof Node` on the scalar case, or an array scan). These sites are cold
(copy/clone), so the direct check is not a hot-path concern. Remove `F_HAS_NODE_CHILD` from
`propagateFlagsFrom` (line 685) and `F_CHILD_DERIVED`.

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
2. **Reuse/aliasing gates** — `canReuseAsLeaf`/`canReuseLeaf`/`callable-binding` use
   `!F_NON_STATIC` to decide a node is safe to SHARE without cloning. **FLAG-ABUSE (owner ruling)**
   — this is not a legitimate F_STATIC use; the no-clone reuse decision must be re-expressed with
   a purpose-named signal (or folded into the copy-reduction model), not read off "static." OPEN
   DECISION — see below.
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
  Stage 3b  reuse/aliasing gates → purpose-named signal  [OPEN DECISION]
  Stage 3c  callable-guard static semantics → guard-local property
  Stage 3d  render-direct fast-path → delete after Rules.evalNode structural work
            (composition/registration/extend/hoist) moves to the render walk

FINAL:
  Stage 4   delete F_STATIC / F_NON_STATIC, F_CHILD_DERIVED, and propagateFlagsFrom
```

After Stage 1+2, `propagateFlagsFrom` bubbles ONLY F_STATIC/F_NON_STATIC (for the Stage-3
readers). After Stage 3, nothing reads them. Stage 4 is the deletion.

---

## Open decision (needs an owner ruling before Stage 3b)

The no-clone reuse model currently decides "safe to share this node without cloning" by reading
`!F_NON_STATIC`. If F_STATIC/F_NON_STATIC are deleted, that decision needs a replacement signal.
Options: (a) a purpose-named `F_SHAREABLE`/`F_FROZEN`-style bit set by the same leaf constructors
(cheaper than the bubble — a leaf knows its own shareability without crawling children); (b) fold
shareability into the copy-reduction pass so it's decided at copy-time by inspecting the node, not
a precomputed flag. (a) keeps a bit but kills the *bubble* (the walk is the cost, not the bit).
This is the one place "delete the flag" and "delete the walk" diverge — resolve it explicitly.

---

## Gates (every stage)
Build core (+jess for benches); core suite green (2737/0 on dev at time of writing — confirm the
current number; a lone `mixin.test.ts` sibling-collapsed fail is the known load flake, re-run in
isolation); output byte-identical on `collapse-bench` + `dynamic-bench`; for Stage 1a also confirm
the bench stays neutral (per the measured A/B). Same-directory A/B only.
