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

- [x] **Checkbox-sync pass — DONE** (cleanup/serial-audit, pure audit, no code change). Full
  node-type × writeSyntax enumeration: every type has serialization coverage; the 8 claimed
  types (Ampersand/Mixin/AtRule/Rules/QueryCondition/Call/Declaration/Interpolated) all confirmed
  to `override writeSyntax`. Inherited-by-parent (correct): Num←Dimension, CustomDeclaration←
  Declaration, Stylesheet←Rules, Keyword←Any, RelativeSelector←ComplexSelector. JsArray/JsObject
  emit '' by design.
- [x] `Node` base single-path — **DONE by design** (re-examined). The generic `writeSyntax(options)`
  hook (node-base:1537, `@internal`) **bridges to `toTrimmedString` by default** — that bridge is
  deliberate, so a type may override *either* `writeSyntax` (direct-writer path, 43 types) *or*
  `toTrimmedString` (source-form path, 5 types) and get the other for free. The 5 so-called "residuals"
  (Block/Quoted/Url/AttributeSelector/PseudoSelector) each override `toTrimmedString` and route through
  a `renderXSyntax(value, options)` helper that is **shared with `render()`** — `render` serializes the
  *evaluated* value, `toTrimmedString` the *source* value, so the `value` parameter is load-bearing, not
  residue. Flipping them to `writeSyntax`-primary would be pure cosmetic churn on HOT files (node-base +
  selector) for zero functional change — **rejected as make-work.** The doc comment at node-base:1437-38
  is about `toString`-vs-`toTrimmedString` (it correctly says override `toTrimmedString`) and is NOT stale.
  ~~A-flip~~ — dropped, no action needed.
- [ ] `Ruleset`: source-direct eligibility + bare-ampersand selector-list header path
  (interacts with Focus D string-selector work). [HOT: ruleset.ts]

## Focus B — Binding / single-frame

The single-frame migration largely landed (frame identity stable, mixin wrapper
removed, `_passedRulesWrapper` gone, loop subsystem staged). Remaining:

- [ ] **Loops still COPY per iteration** — `$for`/`$each`/`$while` clone the body each
  pass instead of re-pointing a covered frame (see `control.ts` TODO). The last
  structural single-frame gap.
- [defer] **`direct-rules-lookup` fallback (R3)** — confined to `$while` and
  dynamic/interpolated/explicit-target names. **Deferred: downstream of Focus E2/E3** — it
  is the same "resolve through the frame the binding actually lives on" problem; fix it as
  part of the scope-identity rework, not before it (it would just re-encode the workaround).

## Focus C — Performance — **DEFERRED (out of the correctness drive)**

**Deferral rationale:** all three are performance levers with **zero failing-test signal** —
they do not move the stable failure set toward 0, which is the driver goal's target. They are
a separate perf backlog (measurements in archived PERFORMANCE-HANDOFF) to be picked up after
the correctness baseline is at its irreducible minimum, or on an explicit perf pass. Not part
of the drive-to-green loop.

- [defer] `Reference` lookup + callable output-body placement — remaining hot path (perf only).
- [defer] Copy / materialization boundary — owned-public-resolve still copies (perf only).
- [defer] `F_STATIC` eval-free static-tree lever (`static-eval-optimizations.md`) — the next
  big perf win, design-stage; explicitly deferred.

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

`'x' is not defined` / `No matching mixins found`, funneling through
`getReferenceNotFoundError` / `finalizeFallbackReferenceResult`. Single-frame lookup
isn't resolving bindings that should exist. **NOT one root cause** — three families:

- [x] **E1 — call-frame fallback to call-site scope for imported configs** (merged
  cleanup/e-lookup, commit 04c285797). Imported mixin body/guard frames wiped their
  fallback to `undefined` for non-leaky calls, dropping the call-site link where `with`-
  config vars live. Fix (callable-scope-frame.ts): body + prebound param-guard frames now
  chain the distinct call-site `parentFrame` when `fallbackScopeFrame` is absent. Cleared 2
  import-style tests. Baseline 66 → **64**.
- [ ] **E2/E3 — configured/reference import surface not on the callable resolution chain**
  (DIAGNOSED, DEFERRED — the bulk of the cluster, ~16+ tests). Detached-ruleset closures,
  child-surface `with` reads, lazy nested mixin-ruleset re-eval, and reference-import members
  (`fromRefProp`, `.z`) resolve through a chain that never contains the configured import
  surface (config lives as live-slots on a *derived* surface). Correct fix = make the
  configured surface's frame the one on the callable's definition/lexical chain — this is the
  **monolithic "wrapper is scope identity" scope rework** (see LIVE_BINDING_ARCHITECTURE.md);
  too big/risky for a single safe wave. Its own multi-step project, not a mechanical unit.

## Focus D — strings-not-nodes render (progress: 85 → 67 stable, zero regressions)

**The selector-serialization (Theme A) cluster is GREEN.** The render path no longer
calls node methods on bare strings, and the header emitter is unified:
- [x] All on-string render **crashes** gone — `ensureSelectorVisible`/`needsVisibleSelectorClone`
  array-hoist, `clone(true)→clone()` (old deep-clone API), `String(atRule.name)`.
- [x] **Stale materialize-at-registration tests deleted** (string→node SelectorList/
  ComplexSelector chain was proven dead + removed) — 10 blocks from string-backed-nodes.
- [x] **serializeTypes snapshots** updated to compact single-element arrays;
  string-backed-nodes.test.ts fully green (canonical Theme A test, 13 cases).
- [x] **Unified selector-list emission** — the bare string/array header surface
  (`emitSelectorListLike`) and the `SelectorList` node now share `emitSelectorListItems`:
  `,\n<indent>` line breaks + `:is()` hoisting + reference filter for both. Clears the
  collapsed-array `:is()` multi-selector header (ampersand test).

Remaining string failures are **NOT selector serialization** — genuine eval bugs, out of
this goal's scope, overlapping deferred work:
- [x] **Trivia loss (task #18) — was stale test fixtures, no source bug** (merged
  cleanup/decl-trivia). The `501abdb8c` provenance refactor migrated `fieldSpans` from a
  flat `[start,end,flags]` encoding to `(SourceSpan|undefined)[]` objects + reader `.[0]?.end`,
  but left unit fixtures on the dead flat shape (`[0,5,0]`), so `[0]?.end` was `undefined`
  and name-boundary trivia was dropped. Fix = align fixtures to `{start,end}`. Cleared both
  the declaration and at-rule trivia tests. Baseline 68 → 66.
- [ ] **Eval-output / collapse diffs** — recursive-mixin / merge-chain / extend / nesting-
  collapse output differs (e.g. a hoisted `.parent` wrapper ruleset dropped under `@media`);
  eval correctness coupled to Focus E lookup + the deferred F_VISIBLE eval stomps, not render.

## Focus D.1 — `F_VISIBLE` is a by-type property (major project; scoped)

**Principle (owner):** `F_VISIBLE` marks whether a node *type* is CSS output. It is set at
construction, by type, and **never mutated at runtime.** Every eval/render-time
`addFlag/removeFlag(F_VISIBLE)` is abuse — an LLM reaching for the nearest flag to force a
particular output instead of building the right mechanism. Rip them all out.

### What it currently conflates (three unrelated jobs on one flag)
1. **Static-by-type** (legit): `function`/`nil`/`mixin`/`log`/`extend`/`extend-list`/
   `declaration-var`/`comment` are born invisible because of *what they are*. ✅ keep.
2. **Dynamic reference/extend suppression** — reference imports not reached by extend.
3. **Dedup / override / already-rendered suppression** — `rules.ts` merge chains
   (last-wins declarations) + render-time "already emitted this" markers. The worst abuser.

### The ~14 runtime stomps to excise (all abuse), by subsystem
- **render dance**: `ruleset.ts:992/1750` force-visible→restore + clone during header render.
- **dedup/merge**: `rules.ts:3665-68` (comment already rendered), `3713/5803/5805` (suppress
  overridden decls).
- **extend**: `extend.ts:167`, `extend-roots:831/841/845`, `util/extend:871`.
- **reference/forward**: `import-style:1005`.
- **at-rule conditional**: `at-rule:438/440/608/609`.
- **filtered ruleset**: `ruleset:1999`. **clone**: `node-base:1366`.
- **callable**: `callable-live-slots:28`, `callable-surface:74`.

### Where the cost actually is (perf = #1)
- `hasFlag(F_VISIBLE)` — a bitmask `&`; cheap, but paid per-node-per-render.
- `this.fullRender` — a **prototype** read (chain walk), paid on every node render for a
  value that is `false` 100% of the time in production. Pure waste.
- **mutate-during-render dance** — a selector-subtree walk **+ a heap-allocated clone per
  ruleset header**. The genuinely expensive one.

### End-state (most performant + best DX): visibility is structural, branch-free on the hot path
1. **Static-by-type → method dispatch, no flag.** Non-CSS types override `writeSyntax` to a
   no-op; V8 monomorphically inlines it — zero flag read, zero prototype walk. Kills the 8
   gates + `fullRender` reads. The node's *type* is its CSS-ness.
2. **Dedup/override → exclude from the render list** at the merge/prepare pass (drop the
   superseded node) instead of flag-hiding it. The render loop never sees it.
3. **Reference/extend → the reference-mode render context** (`referenceMode` + filter) which
   already exists and is paid only in reference mode (a rare special path, off the common one).
4. **Render-despite-visibility (tests now, language conversion later) → a separate walker**
   that traverses everything; never on the common path. Replaces `Node.prototype.fullRender
   = true` and the header-selector force-visible.

Net: **common render path = zero visibility branches, zero `fullRender` reads, no per-header
clone/walk.** "Does it emit?" collapses to *is this type CSS?* (its `writeSyntax`) + *is it in
the render list?* (merge decided) — no overloaded mutable flag.

### Sequencing (perf-first, each stage verified against the stable 85-set)
1. **Rip the mutate/clone dance + `fullRender`** — biggest speed win, no eval semantics to
   preserve.
   - [x] **1a — `fullRender` deleted** (commit 47a6ca6df): field + all gate-branches +
     serialize-helper reads + dead test toggles. The real `F_VISIBLE` check stays; prod
     byte-identical. `fullRender` was test-only (always false in prod) → dead branching.
   - [x] **1c — the `writeHeaderSelector` mutate/clone dance DELETED**: `ensureSelectorVisible`
     + `needsVisibleSelectorClone` (both static methods) + the save/force/restore removed.
     It was **redundant**, not coupled — normal render selectors are already visible, and
     reference emission is driven by `referenceFilteredLocal`. Zero new failures.
     `copySelectorForRulesetMetadata` stays: a shared non-mutating copy for reference-filter
     + `ownSelector`, not the dance. **The render path no longer mutates `F_VISIBLE`.**
   - [ ] **1b — render-ignoring-visibility walker** (`renderNodeFull`): has **no current
     consumer** — the tests were migrated off `fullRender` to plain suppression, so nothing
     needs render-despite-visibility yet. It also couples with the by-type source render
     (stage 2, since a bare `!F_VISIBLE` gate would still block it). Build it when language
     conversion (its real consumer) lands; the comment-test TODO tracks the one gap.
2. **Static-by-type → no-op dispatch** (split in two once the enumeration was done):
   - [x] **2a — static render gate removed** (merged cleanup/fvisible-stage2): only
     function/mixin/nil reached the base `render()` gate while invisible — all static-by-type.
     Gave each a no-op `render()` override and DELETED the base `render()` gate (node-base.ts:1471).
     Also removed 4 DEAD value-type render gates (dimension/bool/combinator/color — never invisible).
     Output-neutral (66→66), tsc unchanged. The common render hot path no longer reads F_VISIBLE.
   - [ ] **2b — dynamic toString/render gates** (deferred, pairs with stage 4): base `toString()`
     gate (node-base:1441) + at-rule.ts:834 + comment.ts:56 + declaration-var render are genuine
     **per-instance dynamic** visibility (line `//` comments, false-guard at-rules, paramVar) — not
     by-type. These need the reference-mode/per-instance mechanism, not a type no-op.
3. **Dedup/override → list-exclusion** in the `rules.ts` merge engine (largest legibility win).
   - [x] **3a — leading-comment hoist** (commit 64ad7ae76): the root `writeStylesheet` path hoisted
     leading comments then `removeFlag(F_VISIBLE)`'d them + restored — a mutate/restore dance. Replaced
     with a `hoistedLeadingComments` Set threaded into `_emitRulesBody`; `emitNode` excludes them
     directly. Output-neutral (stable 60, zero delta). 2 of 4 rules.ts stomps gone.
   - [ ] **3b — declaration-override last-wins** (rules.ts:5795/5797): the merge engine
     `removeFlag(F_VISIBLE)`s the superseded declaration (and, in one branch, its whole ownerRules) so
     the body loop skips it. **Concrete plan** (verified lifecycle): `_coalesceMergedDeclarations` is the
     LAST eval step in `_finishSourceOrderEvaluation`, run on the exact tree that then renders — so use a
     dedicated **suppression-set channel**, not the by-type flag:
       1. coalesce populates `rules._mergeSuppressed: Set<Node>` (add the superseded decl / container)
          instead of `removeFlag(F_VISIBLE)`;
       2. root render seeds `options.suppressedNodes = this._mergeSuppressed` (add to `FinalPrintOptions`);
          options already thread through every nested `_emitRulesBody`, so it reaches descendant owners;
       3. `emitNode` excludes: `exclude?.has(n) || options.suppressedNodes?.has(n) || !n.visible`.
     Risk: the container-suppression branch (5795, same decl object under two owners) — exclude the
     container via the same set (emitNode handles containers). Gate hard for output-neutrality; the
     superseded fragment's value is already composed into the survivor, so nothing else should read it
     post-coalesce (all lookups ran during eval, before coalesce). [HOT: rules.ts — solo, careful.]
     **Deeper findings (traced this session — implement carefully):**
     - `options` IS the shared `context.printState` (getPrintOptions returns it by reference, threads
       into nested container renders at rules.ts:3988 `n.render(context, getPrintOptions(options))`), and
       `suppressedNodes` is NOT a RestorablePrintStateKey so save/restore won't touch it — so a set on it
       reaches every descendant `emitNode`. BUT: seed it exactly ONCE at the outermost render and CLEAR on
       exit, else (a) a nested Rules without the field would null it mid-render, (b) a stale set leaks to
       the next render (shared printState). Seed point is NOT `_emitRulesBody` (runs for nested too).
     - The coalesced tree is `evalForRender(...).output`, NOT source `this` — `_mergeSuppressed` lives on
       the OUTPUT. Seed from `value.output._mergeSuppressed` inside `renderRulesStateToString` /
       `writeRulesStateRenderOutput` (the outermost render-state entries), clear in their finally.
     - F_VISIBLE had GLOBAL reach; `suppressedNodes` is render-only. Before merging, check the other
       consumers that read the now-still-visible superseded nodes: `flatRules(true)` (rules.ts:4167) and
       `hasVisibleRules()`. If a container's ONLY content is superseded fragments, old code skipped it
       (all invisible) but new code renders-then-excludes — watch for empty-container boundary/newline
       deltas in the gate.
4. **Leave reference-mode as the sole runtime filter.**
Guardrail throughout: stable core set must not move; string selectors emit. (baseline now 60, was 85.)

## Focus F — node method/field sprawl (NEW; requested)

Past LLM passes accreted many narrow methods/fields on `Ruleset` / `Rules` / `AtRule`
(e.g. `needsVisibleSelectorClone`). Audit method + field surface of these three,
collapse near-duplicates, and (per the concise-naming rule) shorten burmese-python
identifiers. (Copy/surface/frame helper sprawl was tracked in the archived
SURFACE_PRIMITIVES_AUDIT; fold survivors here.)

**Audit done (cleanup/serial-f, read-only).** Candidates below. ⚠️ **Caveat:** the audit
conflated "0 *external* call sites" with "dead" — a `private` method with internal callers
is NOT dead, it's private. Re-verify true dead-ness (0 callers *including* internal) before
deleting anything. The safe, high-value win is the **rename pass**; structural consolidations
are medium-risk on HOT files and must be gated individually.

- [~] **F-rename** (safest, no semantics) — shorten burmese-python identifiers per concise-naming.
  - [x] **ruleset.ts + at-rule.ts DONE** (7 renames, output-neutral, stable 60): `unwrapGeneratedReferenceIs`→
    `unwrapGeneratedIs`, `expandGeneratedIsForReferenceCompose`→`expandGeneratedIs`,
    `filterExtendedTopLevelSelectorItems`→`filterExtendedItems`, `_ownComplexComponentForCompose`→`_ownForCompose`;
    `_preludeStartOffset`→`_preludeStart`, `renderSerializedAtRule`→`serializeAtRule`, `renderBodyRecord`→`renderRecord`.
  - [ ] **rules.ts renames DEFERRED** — batch with D1-3b so the rename churn and the merge-engine edit land
    together on the same HOT file (~13 candidates below).
  Remaining vetted candidates (verify no collision, apply across all call sites):
  - Ruleset: `_ownComplexComponentForCompose`→`_ownForCompose`, `filterExtendedTopLevelSelectorItems`→
    `filterExtendedItems`, `unwrapGeneratedReferenceIs`→`unwrapGeneratedIs`,
    `expandGeneratedIsForReferenceCompose`→`expandGeneratedIs`.
  - Rules (~13): `addDirectCallableSelectorEntries`→`addCallableSelectors`, `collectCallableEntriesForKeyFrom`→
    `collectCallablesFor`, `findVisibleExactCallableRulesetPath`→`findCallableRulesetPath`,
    `frameChainHasExactMixinNamespace`→`hasMixinNamespace`, `findCompoundPrefixCallableRulesetPathFast`→
    `findCompoundPrefixPath`, `childMixinNamespaceUncertaintyIsLimitedToPrefixes`→`uncertaintyLimitedToPrefixes`,
    et al. (full list in audit output).
  - AtRule: `_nameSlotEnd`→`_nameEnd`, `_preludeStartOffset`→`_preludeStart`, `renderSerializedAtRule`→
    `serializeAtRule`, `renderBodyRecord`→`renderRecord`.
  [HOT: rules.ts/ruleset.ts/at-rule.ts — rename-only, but sequence so it doesn't collide with 3b.]
**Dead-code claims VERIFIED FALSE** (re-checked all callers incl. internal + tests): the audit's
"dead" list is entirely live — `getRenderFrames`/`getRenderRules` are called by **serialize-helper.ts**
(render path) + ruleset.ts + 19 tests; `unwrapGeneratedReferenceIs`/`simplifyGeneratedIsSelector`/
`expandGeneratedIsForReferenceCompose`/`filterExtendedTopLevelSelectorItems` all have internal (and in
one case test) callers. **Nothing on the audit's dead list is safely deletable** — do NOT delete them.
F-consolidate is therefore rename + genuine-refactor only, no free deletions.

- [ ] **F-consolidate** (medium risk, verify dead-ness first):
  - Rules CLUSTER-2: unify `collectPublicVariableAssignmentBindingsInto` / `collectPublicChildVariable…` /
    `prepareScopeFrameAssignmentBindings` into one parameterized visitor (~60 lines) — IF truly redundant.
  - Rules CLUSTER-3: `hasUncoveredVariableAssignmentSurface` + `hasUncoveredChildVariableAssignmentSurface`
    (~20 lines).
  - AtRule inline-extractors: `createBodyEvalRecord`/`evalBodyPreludeState` into `evalBodyResult`;
    `renderBodyRecord` into `renderEvaluatedValue`. `getRenderFrames`/`getRenderRules` — verify 0 callers
    (incl. plugins) before deleting.
  - Ruleset `_substitute*` ampersand cluster (~400 lines, extend-critical) — HIGHEST risk, defer last;
    only after the extend pipeline is otherwise green.

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
