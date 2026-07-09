# EXTEND #4a — expanded-mode crossing/hoist block-relocation (DESIGN)

Status: **LANDED**. Branch `work/extend-4a`. all-less 91→92 (extend-selector green), core 3258/0,
spine-production-ratchet 56/56. Byte-identical to the ratified `extend-selector.css` (owner-owned) —
no divergence surfaced.

## LANDED implementation (summary)

1. **Gate admission** (`isSpineExtendTopology`, `spine-extend.ts`):
   - `isNestedComposedTarget` dropped its `collapseNesting` guard — a crossing descendant target is
     admitted in BOTH modes.
   - new `isMatchableCompoundTarget` — a plain compound target that genuinely matches a subject as a
     compound-subset (`compoundMatchesRootSubjectStrict`, MULTISET subset so `.e.e ⊄ .e`, root-only
     under collapse / nested-allowed under expanded, `>`-combinator subjects rejected,
     interpolated-attribute subjects admitted via `attributeSameNameInterpolated`), with a
     `chainsIntoExtender` exclusion (a target sub-compound-matching an extender = transitive chain,
     kept on eval).
2. **Composed-hoist diversion** (`composeSpineSubjectHeaders`, expanded-nested branch): a nested
   subject whose OWN composed form is a plain descendant path AND whose full-path projection HOISTS
   with every crossing branch itself a descendant path is diverted to `runSubjectProjection` (composed
   header + `hoistToRoot`) and added to `hoisted`. The bare-local in-place path still owns the
   non-crossing expanded case, and now FILTERS exact (non-partial) instructions whose target ≠ the
   subject's full composed path (an exact `.dd` extend must not over-match the nested `.aa .dd`).
3. **Verbatim-emit + relocation** (`ruleset.ts`): the two verbatim-hoist guards
   (`composePushedSelector`, `writeHeaderSelector`) dropped their `options.collapseNesting` condition
   (gated to the strict `spineExtendHoisted` crossing subset in both modes); `isHoisted` returns true
   for a `spineExtendHoisted` member so the block RELOCATES to root under expanded mode.
4. **Gate-consistency fix** (`emit-walk.ts` `isSpineEligibleRoot`): resolve collapse from
   `context.opts.output.collapseNesting` (the source the render pass uses via
   `prepareRenderPrintState`), falling back to `context.output`, so the eligibility gate and
   `renderRootViaSpine`'s topology re-check agree now that the gate is collapse-mode-dependent.
5. **Extend-with-branch-selector** (`gatherRuleset`): a Ruleset-shaped Extend carrying its own
   `.selector` contributes via that branch only, not the ruleset's full selector-list (a decoy
   sibling branch no longer leaks into the target's Or-set).

## PERF (A/B benchmark.less, collapse:true)

Baseline median 294ms (min 283); this branch median 293–300ms (min 284) across 3 runs — within
run-to-run noise. `benchmark.less` carries no `:extend`, so `engageExtendLayer` returns false and the
extend path never executes; the only extend-free-path change is the `??`-chain in
`isSpineEligibleRoot`. Perf-neutral by construction.

---

## design pass (below, for the record)
Status: design pass complete; fold pending. Branch `work/extend-4a`.

## What #4a actually is (measured, not assumed)

The `extend-selector` fixture is the last non-network all-less fail. Its `styles.config.ts`
sets **`collapseNesting: false`** — the whole fixture runs in EXPANDED mode. The ratchet
`spine-production-ratchet` "P4: extend-selector STAYS on eval" is also `collapseNesting:false`.

The fixture stays wholly on eval today because ONE target the gate rejects forces the entire
root to eval (whole-file gate). With the gate temporarily lifted to admit every target, the
spine folds **byte-identical** for every shape EXCEPT one. Measured per-shape (real `Compiler`,
`collapseNesting:false`):

| shape | authored | expected `.css` | spine today | verdict |
|---|---|---|---|---|
| C1 root-target, nested extender | `.a,.b { .c:extend(.ext all) }` | `.ext, :is(.a,.b) .c` | `.ext, :is(.a,.b) .c` | **already folds** |
| C3 root-target, nested extender | `.issue-2586-somepage{ .content:extend(.issue-2586-bordered) }` | `…-bordered, .issue-2586-somepage .content` | same | **already folds** |
| `.replace` sub-compound + nested | in-place `:is(.replace,.rep_ace)` wrap | matches | matches | **already folds** (gate admission only) |
| attributes / interp-attr | `[data=…]` targets | matches | matches | **already folds** |
| **C2 `&`-crossing target** | `.footer{ .footer-nav{ &:extend(.header .header-nav all) } }` | `.header .header-nav, .footer .footer-nav { … &:before {…} }` | block stays nested, extend does NOT fire | **THE gap** |

So #4a reduces to TWO independent pieces:

1. **Gate admission** (mechanical): admit the `extend-selector` targets under expanded mode.
   Two clauses need relaxing:
   - `isNestedComposedTarget` (`spine-extend.ts:751`) currently `collapseNesting &&
     subjectComposedPaths.has(target) && target.includes(' ')` — drop the `collapseNesting`
     guard so a crossing descendant target (`.header .header-nav`) is admitted in expanded mode.
   - a plain compound target that matches a clean subject path as a sub-compound / nested subject
     (`.replace`) — a new `isMatchableCompoundTarget` admit clause (SOLVE handles it correctly;
     the gate just needs to stop rejecting it). This subsumes the existing `isLeadingCompoundTarget`
     SHAPE-4 clause and the `.replace` case.

2. **Expanded-mode crossing hoist** (the real fold — C2): make the crossing extend fire against
   the subject's COMPOSED path and relocate the block to root.

## Why C2 doesn't fire today

In `composeSpineSubjectHeaders` (`spine-extend.ts`), a nested subject under `!collapseNesting`
hits the **EXPANDED-MODE NESTED IN-PLACE REWRITE** branch (line ~224): it seeds SOLVE with the
subject's BARE per-level local (`.header-nav`) and applies each sibling extender's bare
`extendWith`. That is correct for the in-place case (`[data="test"]` → `[data="test"],
.attribute-test`), but a CROSSING target (`.header .header-nav`) does not match the bare local
`.header-nav`, so nothing fires → no header override → the block streams its authored nested form.

## What EVAL does (and gets wrong)

Eval's `processExtends` path DOES fire the crossing extend but composes the extender's OWN fragment
as the bare `.footer-nav` (missing the `.footer` prefix) — the same nested-extender bug EMIT was
built to fix (documented in `emit-render-probe.test.ts`). Under expanded mode eval also does NOT
relocate: forced-eval renders `.header .header-nav, .footer-nav` at root with `:is(...):before`.
So eval is NOT a correct oracle here; the ratified `.css` (owner-owned) is. The spine's EMIT
pipeline already computes the CORRECT composed crossing branch — `wireSpineExtends` returns header
`.header .header-nav, .footer .footer-nav` with `hoisted=true` (verified via probe) — it is just
not INVOKED for the expanded nested subject, and the verbatim-hoist emit is gated to collapse.

## The collapse-mode mechanism (the analogue to reuse)

Under `collapseNesting:true` the crossing subject already works end-to-end:
- `composeSpineSubjectHeaders`: the main projection path (line ~237) runs `runSubjectProjection`
  on the FULL path `[.header, .header-nav]`, producing branches `[.header .header-nav,
  .footer .footer-nav]` with `projection.hoistToRoot === true`, and adds the subject to `hoisted`.
- `Ruleset.composePushedSelector` (`ruleset.ts:1495`) and `writeHeaderSelector` (`ruleset.ts:1716`):
  when `options.collapseNesting && spineExtendHoisted.has(this)`, emit the override VERBATIM (skip
  `composeHeaderSelector`, which would re-prepend `.header` and double it).
- Block placement at root is FREE under collapse because `isHoisted` returns
  `hoistToRoot ?? collapseNesting` → true for every nested block (collapse flattens all nesting).

## The expanded-mode fold plan

The expanded-mode crossing subject must take the SAME composed-hoist path, plus explicit block
relocation (collapse got relocation for free from flattening; expanded does not).

1. **Fire the crossing extend against the composed path.** In `composeSpineSubjectHeaders`, before
   the expanded-mode bare-local in-place branch, detect whether the subject's FULL-path projection
   HOISTS (a crossing contribution). If it does, take the main `runSubjectProjection` path (which
   yields the composed 2-branch header + `hoistToRoot`) instead of the bare-local solve, and add the
   subject to `hoisted`. The bare-local in-place branch stays for the non-crossing expanded case
   (attributes, `.replace` inner) — only a crossing (hoist) contribution diverts to the composed path.

2. **Emit the header verbatim.** Relax the two verbatim-hoist guards in `ruleset.ts`
   (`composePushedSelector:1495`, `writeHeaderSelector:1716`) from `options.collapseNesting &&
   spineExtendHoisted.has(this)` to `spineExtendHoisted.has(this)` (the hoisted set is already the
   strict crossing subset — a crossing subject's override is the full root-composed projection in
   BOTH modes, so the verbatim skip is sound regardless of collapse). Guard against collateral: a
   non-crossing expanded nested subject is NOT in `spineExtendHoisted`, so it is unaffected.

3. **Relocate the block to root.** Mark the hoisted subject's block to place at root under expanded
   mode. `isHoisted` (`ruleset.ts:691`) already returns `this.hoistToRoot ?? collapseNesting` — for
   the spine we read the override's `hoistToRoot` when `spineSelectorNode === this` (line 685). The
   spine subject-header override is installed on `spineExtendHeaders`, NOT `spineSelector`; so
   `isHoisted` must additionally return true when `spineExtendHoisted.has(this)` (crossing subset),
   so the block places at root in expanded mode exactly as it does under collapse. The child
   `&:before` then composes against the hoisted multi-branch header via the existing `&`-flow →
   `:is(.header .header-nav, .footer .footer-nav):before` — which is what the ratified `.css` shows
   under the fixture's expanded config (the `&`-pseudo child stays with its relocated parent).

Coupling is EMIT-ordering only (the hoist runs after the nested block's own header composes),
bounded by the crossing-target count — matching the spec in `P4-TERMINAL-SINK-DESIGN.md §4`.

## No GAP surfaced

Every sub-shape is foldable. C1/C3/`.replace`/attributes already fold (gate admission only);
C2 folds via the composed-hoist diversion + verbatim-emit + block-relocation above, reusing the
existing collapse-mode machinery with its collapse-only guards relaxed to the (already-strict)
`spineExtendHoisted` crossing subset. The eval path is not a correctness oracle here (it produces
the bare-`.footer-nav` bug); the owner-owned `.css` is.

## OWNER-REVIEW FLAG

Under the fixture's expanded config the ratified `.css` shows the relocated block's `&:before`
child as `:is(.header .header-nav, .footer .footer-nav):before` (the `&` resolves against the
hoisted multi-branch header). The fold reproduces exactly that. No divergence from the `.css` is
expected; if any appears at fold time it will be surfaced for owner review rather than matched.

## Gate discipline

Every commit: core `pnpm test` (≥3258/0), jess `spine-production-ratchet` (56/56 — the
extend-selector ratchet FLIPS from "stays on eval" to "folds"), jess `all-less` (91→92, extend-
selector green, import-remote still network). A/B benchmark.less before landing (EMIT change must
be perf-neutral — the crossing diversion is paid only per crossing-hoist subject, and the verbatim
guards short-circuit BEFORE compose so the common path is untouched or faster).
