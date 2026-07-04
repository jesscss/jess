# Core Cleanup — the single live tracker

**This is THE tracker for @jesscss/core cleanup work.** It replaces the scattered
set of focus-trackers and audit docs that had drifted out of sync with the code
(several claimed "done" for work that wasn't, or "todo" for work that had landed).

- **Live queue** = the OPEN items below, grouped by focus.
- **History** for each focus (the long completed logs / prosecution blocks) lives in
  `docs/archive/` — see [Archived sources](#archived-sources). Don't re-read those to
  find work; read them only for forensic "why did we do X" context.
- **Guides that are NOT trackers** (invariants, review rules, the router) stay where
  they are — see [Standing guides](#standing-guides).

Branch: `feature/parseman`. Author/verify convention: build core, run the core suite,
diff the **stable** failure set (run twice; flaky ±) against the prior baseline — a
change is real only if the stable set moves. Baseline at last edit: **85 stable
failures** (mid-migration; see Focus D).

---

## Focus A — Serialization / `writeSyntax`

Per-node direct-source writers. Most node families already have `override
writeSyntax` in code; the old row tracker's checkboxes were stale.

- [ ] **Checkbox-sync pass** — reconcile the archived NODE-REWRITE-TRACKER rows against
  code; Ampersand / Mixin / AtRule / Rules / QueryCondition / Call / Declaration /
  Interpolated all have `writeSyntax` and are effectively done.
- [ ] `Node` base: confirm the generic `writeSyntax(options)` hook + fallback story is
  the single path (no residual `toTrimmedString`-only nodes).
- [ ] `Ruleset`: source-direct eligibility + bare-ampersand selector-list header path
  (interacts with Focus D string-selector work).

## Focus B — Binding / single-frame

The single-frame migration largely landed (frame identity stable, mixin wrapper
removed, `_passedRulesWrapper` gone, loop subsystem staged). Remaining:

- [ ] **Loops still COPY per iteration** — `$for`/`$each`/`$while` clone the body each
  pass instead of re-pointing a covered frame (see `control.ts` TODO). The last
  structural single-frame gap.
- [ ] **`direct-rules-lookup` fallback (R3)** — confined to `$while` and
  dynamic/interpolated/explicit-target names; goal is to stop rediscovering binding
  facts the frame already knows.

## Focus C — Performance

Evidence-logged levers (archived PERFORMANCE-HANDOFF has the measurements):

- [ ] `Reference` lookup + callable output-body placement — the remaining hot path.
- [ ] Copy / materialization boundary — the owned-public-resolve path still copies in
  places (item-14 line in the archived log).
- [ ] `F_STATIC` eval-free static-tree lever (design in `static-eval-optimizations.md`)
  — deferred next big win.

## Focus D — strings-not-nodes render migration (NEW; == task #9)

Selectors/names are now bare strings / arrays, but the render+eval paths still call
node methods on them. This is the single biggest cluster of the current core test
failures (~44 of 85).

- [x] `Ruleset.needsVisibleSelectorClone` + `writeHeaderSelector` string/array-aware
  (this session — array branch hoisted above the flag check; bare surface emits via
  `emitSelectorListLike`).
- [ ] **~5 remaining `hasFlag`/`writeSyntax`/`valueOf`-on-string crash sites** in the
  render path — each fix currently clears ~1 test then the next test crashes at the
  next site; chase the chain.
- [ ] **`toBeString` assertion failures** — nodes that the migration intends to be
  bare strings are still Node-wrapped.
- [ ] **Stale materialization tests** — several `string-backed-nodes` tests assert
  string→node selector *materialization* that was proven dead and **deleted** this
  session; these tests test removed behavior and should be updated/removed, not
  "fixed".

## Focus E — scope / mixin lookup misses (== task #17 tail)

~27 of the 85 failures: `'x' is not defined` / `No matching mixins found`, funneling
through `getReferenceNotFoundError` / `finalizeFallbackReferenceResult`. Single-frame
lookup isn't resolving bindings that should exist. Deeper than Focus D (scope-frame
resolution, not mechanical).

## Focus F — node method/field sprawl (NEW; requested)

Past LLM passes accreted many narrow methods/fields on `Ruleset` / `Rules` / `AtRule`
(e.g. `needsVisibleSelectorClone`). Audit method + field surface of these three,
collapse near-duplicates, and (per the concise-naming rule) shorten burmese-python
identifiers. Feed candidates here as found. (Copy/surface/frame helper sprawl was
tracked in the archived SURFACE_PRIMITIVES_AUDIT; fold survivors here.)

---

## Done this session (log)

- **Parser reconciliation onto the provenance side-table** — css/less/scss green; jess
  Chevrotain deleted (functional parser is sole), css/less Chevrotain `@ts-nocheck`'d;
  `@jesscss/parser` package deleted.
- **`raw` "prove value or delete" audit** — deleted ≈866 lines of proven-dead core
  weight (rawArgs placement/diagnostic; raw-selector materialization island; the
  reference direct-render fast-path — evidence-backed output-neutral + no perf win;
  `RawRules`). Kept + JSDoc'd the load-bearing `raw` (unevaluated args, source-form
  lookup key, single-frame finalizers).

---

## Standing guides (NOT trackers — keep, don't fold in)

- `HANDOFF.md` — focus router + prosecution history (points here for the queue).
- `FOCII.md` — focus/goal menu.
- `AGGRESSIVE-CUTTING-REVIEW.md` — the architecture-review guardrail checklist.
- `packages/core/src/tree/LIVE_BINDING_ARCHITECTURE.md` — single-frame target invariants.
- `docs/future/pre-eval-elimination.md`, `docs/future/static-eval-optimizations.md` —
  runtime contract + static-eval design.

## Separate live concerns (own docs, not core cleanup)

`parser-parse-speed-plan.md`, `whitespace-token-proposal.md`,
`trivia-offset-inference-model.md`, and the `packages/core/src/tree/util/**/EXTEND_*`
set.

## Archived sources

Moved to `docs/archive/` (history preserved; open items lifted above):
`SINGLE_FRAME_PLAN.md`, `NODE-REWRITE-TRACKER.md`, `PERFORMANCE-HANDOFF.md`,
`BINDING-LOOKUP-REMAINING.md`, `SURFACE_PRIMITIVES_AUDIT.md`, `LOOKUP_CHAINS.md`,
`ponytail-core-audit.md`, `BINDING-INDEX-PROPOSAL.md`, `tree/README.md` (abandoned 2.0
fragment).
