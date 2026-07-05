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
change is real only if the stable set moves.

## Driver terminal status (this pass)

**Stable failures: 85 → 41, zero regressions.** After the mechanical harvest reached 60, the
"monolithic" E2/E3 cluster is being **chipped by scoped sub-agents in an isolated worktree** — and
keeps dissolving into specific bugs, not the feared monolith:
- **E2-a** (825dc3ec0, 60→59): property lookup now consults ancestor import fallback frames.
- **E2-b** (35f8087a5, 59→59): single-key callable retry-walk drains ancestor fallback chains
  (completes the 3-way lookup consistency; prerequisite, metric-neutral).
- **E3-rebasing** (8689c52cb, 59→58): composed-selector cache was under-keyed (ruleset identity only);
  keyed by `(ruleset, composed-parent)` — fixed mixin-body rebasing. Was a cache bug, not a monolith.
- **provenance-migration stale tests** (any.test inline + control-surface, 58→53): the `501abdb8c`
  side-table migration mechanically rewrote `.location` (array) → `sourceSpanOf` (`{start,end}|undefined`)
  without fixing `.toHaveLength(0)`/`[...span]` probes. 5 tests cleared; vein now swept clean.
- **nesting-collapse** (1780adabf, 53→49): genuine source bug — `getHoistedParent` (serialize-helper.ts)
  only recovered the enclosing parent from eval-captured `AtRule.frames`, `undefined` for directly-built
  trees, so bare decls in a hoisted `@media` lost their selector header. Fix: render-pass-scoped
  `WeakMap<AtRule, frames>` fallback capturing the live frame stack at container entry. 4 tests.
- **call arg-surface** (68e28e0aa, 49→45): 4 stale tests updated to the live-binding shared-node model.
- **extend cluster (6) — DEFERRED, all 6, with a CONTRADICTION needing an owner ruling** (cleanup/extend-cluster,
  0 commits, clean):
  - [x] **Group A (4): DONE — selector copy-on-write** (merged cleanup/selector-cow, commit 7e4a00eec,
    45→41, BOTH committed test sets green + zero new). Owner ruling: collapse/extend mutation reuses in
    place when unshared, clones-to-detach when shared. Implemented via structural signals, not an explicit
    refcount bit: (1) collapse (`own-collapsed-source-child.ts`) — `shared = owner.parent === undefined`
    (a parentless collapsing owner is a re-readable root template → clone the source leaf; a parented
    interior owner's collapse is consumed once → reuse in place); (2) placement (`node-base.ts`
    `cloneForPlacement` gains `detachChildren` + `hasNodeChild()`) — extend/ruleset placement clones-to-
    detach any child that owns child nodes, so `inherit`/`adopt` reparents COPIES not the shared source.
    Extend copies opt in (`selector-utils.ts`, `cloning.ts`). Both eval-template-copy (canonical-survivor)
    and extend-reuse (0-clones) hold for the SAME reason. See [[selector-cow-shared-bit]].
    - **Follow-up (chip):** dead drifted duplicate `ownCollapsedSourceChild` in `cloning.ts:~87` (nothing
      imports it) — delete after decl-ref merges (decl-ref may touch cloning.ts).
    - **Open design note:** the `owner.parent===undefined` proxy + `detachChildren` cover all current tests
      + the per-extend-match divergence case; the fuller EXPLICIT shared-marker (set on >1-slot placement)
      is only needed if a future divergent-visibility case escapes the structural proxy — no failing test yet.
  - **Group B (1): string-backed extend target** (`extend-roots.test.ts:116`) — `.child` string component
    dropped by `typeof item!=='string'` filter → spurious empty list item; expected `.base`-only output is
    ambiguous (materialize-noop vs append). Needs a semantics decision.
  - **Group C (1): implicit-`&` over-materialization** (`extend.ts:280`) — needs target-scope-relative
    source selection (absolute `fullSel` load-bearing for the cross-scope `.issue-2586` case). Scope-ancestor
    comparison, not a dedupe.
### Live work-list — the 40 remaining stable failures, each mapped to an owning unit
**IN FLIGHT (3 agents, disjoint files):**
- `cleanup/decl-ref` → reference (3), declaration copy-boundary (~2), cloning (1) — the no-copy/reuse boundary.
- `cleanup/config-property` → import-style with-config property path (4).
- `cleanup/extend-bc` → extend-roots string-backed (1, Group B), extend-eval attribute (1, Group C — dir corrected).

**QUEUED (next waves, dispatch after in-flight merges to avoid rules.ts collision):**
- **mixin scope (14)** — namespace-lookup / scope failures (`No matching mixins`, param-var lazy lookup,
  mixin-ruleset namespace containers). Same config-surface/namespace-crawl family; the biggest remaining.
- **import-style namespace-cold (3)** — `findMixinsFastForUncoveredCallable` / `hasReferenceImportChildSurface`
  broad-crawl gating (distinct subsystem, verified separate from config-surface).
- **import-style wrapper-identity + misc (≈4)** — D-family (declaration-lookup-version on derived surface;
  compose finalRules `sourceNode`≠itself) + forward-only-downstream + multiple-imports placement.
- **mixin-recursion (2)** — recursive-mixin serialization + nested-mixin-from-outside scope.

**DEFERRED (written rationale above/here):**
- declaration merge-chain (1) → D1-3b (coalesce removeFlag load-bearing; merge-engine rework).
- call detached-collection→Rules (1) → callable-collection node-identity design decision.
- extend-less-fixtures (1) → ENVIRONMENTAL (`@jesscss/css-parser` entry resolve in a fresh worktree; a
  build/link artifact, not a core logic failure — passes in a fully-built tree).

**The floor:** once the queued waves land, the irreducible core is the wrapper-is-scope-identity D-family +
D1-3b, both deferred with rationale. Every one of the 40 is now IN-FLIGHT, QUEUED-with-plan, or DEFERRED-with-rationale.

---
_Earlier snapshot (mechanical harvest to 60):_ Every open tracker item is CLOSED or
DEFERRED-with-rationale. The mechanically-safe correctness + cleanup harvest is complete:
- **Done:** Focus A (serialization audit; A-node done-by-design, A-flip rejected as make-work);
  Focus D Theme A selector serialization GREEN + trivia; Focus E E1; D.1 stages 1a/1c/2a; D1-3a
  (leading-comment hoist → exclusion set); F-rename (all 3 classes, 20 identifiers); Focus F
  dead-code claims verified false (nothing deletable). Merges: E-lookup, extend-eval, decl-trivia,
  D1-2 + several inline units.
- **Deferred (with written rationale):** D1-3b (removeFlag in coalesce is load-bearing for lookup +
  re-coalesce — render-only exclusion proven insufficient by the gate, reverted; needs merge-engine
  rework); E2/E3 (monolithic "wrapper is scope identity" scope rework); D.1 1b (no consumer until
  language conversion), 2b/stage-4 (dynamic per-instance visibility, pair together); Focus B loops +
  R3, Focus C perf (no failing-test signal — perf/architecture, not correctness); Focus A Ruleset
  source-direct (perf eligibility); F-consolidate (legibility polish, no correctness impact); D-eval
  diffs (coupled to E2/E3).

**The residual 60 stable failures are traced to the deferred deep work** — dominated by E2/E3
scope-identity (~16+), the D1-3b-blocked merge-chain/lookup coupling, and eval/collapse diffs
downstream of them. Driving below 60 requires the deferred **monolithic scope-identity rework**, not
more mechanical units. That is the documented irreducible minimum for the safe drive-to-green loop.

Baseline snapshots below may cite older counts (85 mid-migration); the current stable set is **45**.

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
- [DEFERRED] `Ruleset`: source-direct eligibility + bare-ampersand selector-list header path.
  **No failing-test signal** — the string-selector header work it interacted with is already GREEN
  (Focus D Theme A). This is a render-fast-path *eligibility* refinement (perf/legibility), not a
  correctness gap; it does not move the stable set. Deferred to a dedicated perf/render pass. [HOT: ruleset.ts]

## Focus B — Binding / single-frame

The single-frame migration largely landed (frame identity stable, mixin wrapper
removed, `_passedRulesWrapper` gone, loop subsystem staged). Remaining:

- [DEFERRED] **Loops still COPY per iteration** — `$for`/`$each`/`$while` clone the body each
  pass instead of re-pointing a covered frame (see `control.ts` TODO). The last structural
  single-frame gap. **No failing-test signal** (loops are correct, just not zero-copy); it's a
  perf/architecture refinement, not a correctness fix, and carries real regression risk (frame
  re-pointing semantics). Deferred to a dedicated single-frame/perf pass, not the drive-to-green loop.
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

<!-- The former "Focus D (task #9)" duplicate block was removed: all its items (on-string
crashes, toBeString, stale materialization tests) are superseded and marked DONE in the
authoritative Focus D progress section below. -->

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
- **E2/E3 — configured/reference import surface not on the callable resolution chain.** Being
  chipped by scoped sub-agents in an isolated worktree (proper orchestration), NOT one monolith.
  - [x] **E2-a — reference-import property/declaration members** (merged cleanup/e-scope-identity,
    commit 825dc3ec0, 60→59). Root cause traced: property lookup (`findDeclarationLookupWithStrategy`
    in direct-rules-lookup.ts) walks the static AST parent chain and only checked `startRules`'s OWN
    fallback frame, never an ancestor's — so a `reference:true` import on the root frame was invisible
    to property refs (sibling variable `fromRef` resolved but property `fromRefProp` threw). Fix:
    `PROPERTY_LOOKUP.includeFallbackFrames=true` + capture the closest ancestor scope's fallback entry
    and descend into it after the primary chain exhausts (precedence preserved). Wire the frame — not a
    shim. Fixed `import-reference: real hit and miss refs avoid public declaration bridges`.
  - [x] **E2-b — reference-import callable LOOKUP** (merged cleanup/e-refimport-mixin, commit 35f8087a5,
    59→59 metric-neutral, zero-regression). Traced root cause: the single-key `findMixin` retry-walk
    (rules.ts ~3376) only chained the *calling* frame's direct fallback, never the fallback chains hanging
    off ancestor retry frames — so a ref-imported callable on an ancestor's `fallbackFrame` was invisible
    once the primary chain exhausted. Fix: queue every passed frame's fallback head and drain after the
    primary chain (precedence preserved). **Completes the 3-way ancestor-fallback consistency** (property
    [E2-a] / namespace-walk / single-key callable). Merged as a principled latent-lookup-bug fix + E3
    prerequisite; it is metric-neutral because the target test `reference-imported selector-list rulesets
    remain callable as mixins` now fails DOWNSTREAM on E3 selector-rebasing, not lookup.
  - [x] **E3-rebasing — selector-list mixin application** (merged cleanup/e-refimport-rebase, commit
    8689c52cb, 59→58). **Was NOT monolithic** — a cache-key bug. `composedSelectorCache` (print.ts) was
    keyed on `Ruleset` node identity ALONE; a mixin body shares the same canonical `.c`/`&` nodes as the
    ruleset's own placement, so the value composed first under the DEFINING header (`.z .c`) was cached and
    reused at the call site instead of recomposing against the call-site frame (`.b`). Fix: key the cache by
    `(ruleset, composed-parent)` — `WeakMap<Ruleset, Map<parentKey, Selector>>`. Header-clipping to the
    matched key + `&`-rebasing fall out for free (nested content composes against the call-site frame). No
    node mutation, F_VISIBLE untouched. Fixed `reference-imported selector-list rulesets remain callable`.
  - [DEFERRED] **E3 — lazy/cold namespace-mixin-body ref-imports** (`uncalled … stay cold`, `evaluated
    namespace mixin bodies expose … descendants`) — genuine eval-ordering/coldness behavior, closest to
    the true monolithic rework.
  - [DEFERRED] **E3 — `with`-config child-surface + detached-ruleset closures** — the monolithic core
    (config lives on a *derived* surface not on the callable's definition/lexical chain); the
    **"wrapper is scope identity" scope rework** (see LIVE_BINDING_ARCHITECTURE.md). Its own project.

  **import-style.test.ts full triage (cleanup/import-style-triage, no fix landed — all monolithic).**
  The 14 remaining import-style failures map to the deferred reworks (each traced to file:line, verified):
  - **A · with-config (5)** — all throw `'X' is not defined` at reference.ts:2311; config binding not on the
    callable/closure definition chain. = the monolithic config-surface rework.
  - **B · namespace cold/lazy crawl (3)** — broad-crawl suppression fires before the namespace body is
    evaluated (`findMixin` returns a stale hit / null / 0 broadFastHits). Eval-ordering, deferred.
  - **C · placement-ownership of shared static children (2)** — a source-free static `Declaration` returns
    `this` from `materializeValueState` (changed:false), so first-use plain-import placement keeps the shared
    canonical node. ATTEMPTED (cloneForPlacement) → **+2 regressions** (reference-import guards read caller
    scope via placement child identity), reverted clean. Needs frame-scoped ownership, not a placement-seam
    walk — entangled with reference-guard scope. Smallest next step noted in agent report.
  - **D · eval-surface cache / wrapper-identity (2)** — declaration-lookup-version bump runs on a derived
    output surface (copy-on-write); compose finalRules wrapper `sourceNode` ≠ itself. = wrapper-is-scope-
    identity monolith ([[parseman-wrapper-is-scope-identity]]).
  - **E · forward-only downstream visibility (1)** — forwarder links forwarded members into its LOCAL frame;
    should expose downstream-only. Scope-frame linkage change.

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
- [DEFERRED] **Eval-output / collapse diffs** — recursive-mixin / merge-chain / extend / nesting-
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
   - [DEFERRED] **1b — render-ignoring-visibility walker** (`renderNodeFull`): has **no current
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
   - [DEFERRED] **2b — dynamic toString/render gates** (deferred, pairs with stage 4): base `toString()`
     gate (node-base:1441) + at-rule.ts:834 + comment.ts:56 + declaration-var render are genuine
     **per-instance dynamic** visibility (line `//` comments, false-guard at-rules, paramVar) — not
     by-type. These need the reference-mode/per-instance mechanism, not a type no-op.
3. **Dedup/override → list-exclusion** in the `rules.ts` merge engine (largest legibility win).
   - [x] **3a — leading-comment hoist** (commit 64ad7ae76): the root `writeStylesheet` path hoisted
     leading comments then `removeFlag(F_VISIBLE)`'d them + restored — a mutate/restore dance. Replaced
     with a `hoistedLeadingComments` Set threaded into `_emitRulesBody`; `emitNode` excludes them
     directly. Output-neutral (stable 60, zero delta). 2 of 4 rules.ts stomps gone.
   - [DEFERRED] **3b — declaration-override last-wins** (rules.ts:5795/5797): **attempted the
     render-only suppression-set channel this session; ABANDONED — proven architecturally insufficient by
     the gate (+6 regressions), reverted clean (no commit).** The finding that blocks it:
     **`removeFlag(F_VISIBLE)` here is load-bearing beyond render** — it hides the superseded declaration
     from (a) **variable lookup** (`reference > resolve merged property lookups via quoted index inside a
     nested child scope` regressed — a lookup found the superseded occurrence) and (b) **re-coalesce
     idempotency** (`declaration > does not re-merge sequence assignments during post-eval coalescing`
     + 4 merge-chain tests regressed — coalesce re-read `.visible` on the still-visible node and
     double-processed). A **render-only** `options.suppressedNodes` channel structurally cannot cover
     lookup or coalesce, so it regresses both. **Physical removal** (true "drop the node") would cover all
     three consumers, but the container-suppression branch (5795: the SAME decl object registered under two
     ownerRules → suppress the earlier whole container) is unsafe to splice from the live tree.
     **Correct end-state requires untangling merge-suppression's cross-cutting lookup + coalesce dependence
     first** — i.e. make variable lookup + re-coalesce stop consulting `F_VISIBLE` on merge-superseded
     nodes (give merge-suppression its own persistent, non-`F_VISIBLE` marker honored by lookup/coalesce/
     render alike, OR restructure coalesce to physically drop survivors' losers safely). That's a
     merge-engine rework, NOT a mechanism swap — deferred as its own project. The 2 stomps at 5795/5797
     stay until then; D1-3a already removed the other 2 (render-only ones, which had no lookup/coalesce
     dependence — that's why 3a was clean and 3b is not).
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

- [x] **F-rename DONE** (all 3 classes, output-neutral, stable 60, 2 commits).
  - ruleset.ts + at-rule.ts (7): `unwrapGeneratedReferenceIs`→`unwrapGeneratedIs`,
    `expandGeneratedIsForReferenceCompose`→`expandGeneratedIs`, `filterExtendedTopLevelSelectorItems`→
    `filterExtendedItems`, `_ownComplexComponentForCompose`→`_ownForCompose`; `_preludeStartOffset`→
    `_preludeStart`, `renderSerializedAtRule`→`serializeAtRule`, `renderBodyRecord`→`renderRecord`.
  - rules.ts (13): `findVisibleExactCallableRulesetPath`→`findCallableRulesetPath`,
    `frameChainHasExactMixinNamespace`→`hasMixinNamespace`, `findCompoundPrefixCallableRulesetPathFast`→
    `findCompoundPrefixPath`, `childMixinNamespaceUncertaintyIsLimitedToPrefixes`→`uncertaintyLimitedToPrefixes`,
    et al. (done standalone once D1-3b deferred — no reason to batch with deferred work).
  <!-- original vetted candidate list (all applied):
  - Ruleset: `_ownComplexComponentForCompose`→`_ownForCompose`, `filterExtendedTopLevelSelectorItems`→
    `filterExtendedItems`, `unwrapGeneratedReferenceIs`→`unwrapGeneratedIs`,
    `expandGeneratedIsForReferenceCompose`→`expandGeneratedIs`.
  - Rules (~13): `addDirectCallableSelectorEntries`→`addCallableSelectors`, `collectCallableEntriesForKeyFrom`→
    `collectCallablesFor`, `findVisibleExactCallableRulesetPath`→`findCallableRulesetPath`,
    `frameChainHasExactMixinNamespace`→`hasMixinNamespace`, `findCompoundPrefixCallableRulesetPathFast`→
    `findCompoundPrefixPath`, `childMixinNamespaceUncertaintyIsLimitedToPrefixes`→`uncertaintyLimitedToPrefixes`,
    et al. (full list in audit output).
  - AtRule: `_nameSlotEnd`→`_nameEnd` (deferred — spans at-rule.ts + declaration.ts, ambiguous),
    `_preludeStartOffset`→`_preludeStart`, `renderSerializedAtRule`→`serializeAtRule`,
    `renderBodyRecord`→`renderRecord`. -->

**Dead-code claims VERIFIED FALSE** (re-checked all callers incl. internal + tests): the audit's
"dead" list is entirely live — `getRenderFrames`/`getRenderRules` are called by **serialize-helper.ts**
(render path) + ruleset.ts + 19 tests; `unwrapGeneratedReferenceIs`/`simplifyGeneratedIsSelector`/
`expandGeneratedIsForReferenceCompose`/`filterExtendedTopLevelSelectorItems` all have internal (and in
one case test) callers. **Nothing on the audit's dead list is safely deletable** — do NOT delete them.
F-consolidate is therefore rename + genuine-refactor only, no free deletions.

- [DEFERRED] **F-consolidate** — medium-risk pure refactors with **no correctness impact** (nothing on the
  audit's dead list is actually deletable, verified above; these are legibility-only merges of near-duplicate
  private methods). Deferred as low-priority polish behind the correctness work; each must be gated
  individually and none reduces the stable failure set. Candidates retained for when polish is warranted:
  - Rules CLUSTER-2: unify `collectPublicVariableAssignmentBindingsInto` / `collectPublicChildVariable…` /
    `prepareScopeFrameAssignmentBindings` into one parameterized visitor (~60 lines) — IF truly redundant.
  - Rules CLUSTER-3: `hasUncoveredVariableAssignmentSurface` + `hasUncoveredChildVariableAssignmentSurface`.
  - AtRule inline-extractors: `createBodyEvalRecord`/`evalBodyPreludeState` into `evalBodyResult`;
    `renderRecord` into `renderEvaluatedValue`.
  - Ruleset `_substitute*` ampersand cluster (~400 lines, extend-critical) — HIGHEST risk, only after the
    extend pipeline is otherwise green.

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
