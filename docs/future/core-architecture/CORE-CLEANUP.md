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

**Stable failures: 85 → 0. Suite FULLY GREEN (2678 passed, 0 failed), zero regressions across ~36 gated merges.**
The feared "monolith" fully dissolved — every supposed monolithic cluster (E2/E3 scope-identity,
mixin/namespace, import-style) decomposed into specific bugs or stale tests. The scope-identity/eval-model
"one big design call" turned out to be ~10 distinct facets, all fixed. **The "4 irreducible-minimum"
floor below was NOT irreducible** — all four fell to targeted fixes (see "Final four — CLOSED" block):

- **sibling-collapsed** (cleanup/sibling-collapsed, 4→3): four coupled fixes — descendant-boundary
  combinator callable-key (`lookup-utils.getOrderedSelectorKeys` skips string combinators), boundary-aware
  prep-time lexical parent for interpolated selector identity (gated on compose/import boundaries),
  retained-output definition-parent gate over the §4 placement re-point (`isRetainedOutputDefinitionParent`,
  same `hasLiveBindings` signal as the retained per-call frame), and two pre-existing nested-`&`
  serialization bugs (bubble `F_AMPERSAND` to the eval-rebuilt compound + preserve string combinators in
  `_substituteAmpInComplex`).
- **call detached-collection** (cleanup/call-collection, 3→2): `call.ts` split the `Rules|Collection`
  callable branch — a `Collection` short-circuits BEFORE the callable path and returns the reused surface
  (thin, 0-clone, 0-evalCall) instead of normalizing to `Rules`. Node identity preserved; renders from the
  shared surface. The "design decision" resolved to the thin model, not a coin-flip.
- **config with-var-survival** (cleanup/config-var, 2→1): the `with { }` config lives on the import
  placement frame; link the imported body's DEFINITION (lexical) frame's `fallbackFrame` to that placement
  config (`findInlinedImportPlacementFrame`), so lexical parents out-rank the caller's same-named decl at
  closure read-time. A no-param non-leaky imported body no longer wires a caller fallback. No clones.
- **declaration merge-chain** (cleanup/decl-merge, 1→0): TWO defects in `Rules._coalesceMergedDeclarations`
  — (1) the walk recursed into sibling `Ruleset`s because `Ruleset` carries the `N.Rules` bit, collapsing
  three independent cascade scopes into one global merge chain; scoped the walk to inline `Rules` only
  (skip `Ruleset`/`AtRule`). (2) a mixin-ruleset call shares the callee's declaration node by identity, so
  stripping `F_VISIBLE` off the superseded placement copy also hid the callee's canonical decl; COW the
  placement copy (`deriveWithParts({ value })`, parts stay shared) before the strip. Mutation-layer detach,
  NOT the render-only exclusion that regressed +6. [[fvisible-coalesce-suppression-load-bearing]]

Highlights of the earlier 20→4 tail: retained per-call output frame (mixin-call output carries its
params for value-eval), leaky-mode forward propagation (mixin output decls inject into the caller frame
at the call index), namespace-path reroot (structural-parent compose gated to active frames +
per-call-site hoisted-header tracking), guarded-recursion candidate filter (gate `inStack` on
`!guarded`), namespace string-selector callable registration, `Rules.resolveBodyReferenceImports`
(evaluate a mixin body's `reference:true` imports without full eager eval), `@forward` local-scope
exclusion, inline-source root pinning, first-use scalar placement-ownership, guarded-namespace guard-lift
+ value-spacing (parser builders). Earlier chips (85→20):
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
### Final four — CLOSED (were "DEFERRED; TRUE floor" — all four fixed, 4→0)
All four below were tagged the irreducible minimum for the mechanical loop; each fell to a targeted
single-unit fix, gated zero-regression, and merged. Suite is now fully green. Fix summaries are in the
Driver terminal status block above; the original characterizations are kept here for the forensic record.

### Live work-list — (historical) the 4 remaining stable failures (all now CLOSED)
The mechanical/tractable harvest is COMPLETE (85→0, ~36 verified merges, every one zero-regression). The
"Monolith-A" scope-identity narrative was WRONG: it decomposed into ~10 distinct facets, all now fixed —
retained per-call output frame (mixin value-eval), leaky forward-propagation (source-order-gated), namespace
reroot (2 render roots), guarded-recursion, string-selector namespace registration, `resolveBodyReferenceImports`,
`@forward` scope-exclusion, placement-ownership, guarded-namespace lift + value-spacing. The 4 that remain:

1. **mixin sibling-collapsed interpolated selector-identity** (`mixin.test.ts › arity failures › keeps sibling
   collapsed rulesets closed before a later interpolated mixin-ruleset call`). Its namespace-reroot + leaky
   facets are already fixed; it now needs TWO things (attempted, reverted — +2 boundary regressions from a
   blanket link): (a) prep-time lexical scope resolution for an interpolated selector identity (`.@{a1}`) that
   RESPECTS compose/import boundaries (a scope-boundary-aware wiring, not a blanket `getScopeFrame().parent`
   link); (b) `&`-composition into the mixin-ruleset callable key across a descendant boundary (verified the
   LITERAL `.b .bb{&.foo-xxx{…}} .b.bb.foo-xxx()` fails identically — a pre-existing `&`-callable-key gap).
   Bigger than a targeted fix; its own unit.
2. **declaration merge-chain** (`Declaration › continues a property merge chain after a callable ruleset emits
   the first declaration`) → **D1-3b**: coalesce `removeFlag(F_VISIBLE)` is load-bearing for lookup+re-coalesce
   (proven — render-only exclusion regressed +6, reverted). Merge-engine rework. [[fvisible-coalesce-suppression-load-bearing]]
3. **call detached-collection→Rules** (`Call › keeps detached collection calls on the collection surface`) →
   callable-collection node-identity design decision: a no-arg detached-collection call returns `Rules` (CSS-correct)
   but the test wants the `Collection` surface preserved. Design call: normalize to Rules vs keep Collection identity.
4. **config with-var-survival** (`with values › keeps child-surface additive "with" configs visible to imported
   detached ruleset variable closures`) → live-binding-across-eval: a `with` VarDeclaration is a transient pre-eval
   frame binding that doesn't survive eval as a resolvable decl; the parent same-named decl wins. Needs the config
   binding to persist onto the post-eval surface with module precedence.

**~~4 is the documented irreducible minimum~~ — ALL FOUR CLOSED.** #1 was the scope-boundary+`&`-callable
rework (4 coupled fixes); #2–#4 were the "design decisions" that each resolved cleanly in favour of the
thin/live-binding model (merge-engine COW + walk-scoping / keep-Collection-surface / lexical-config-precedence).
None turned out to need an owner ruling. Suite green. See "Final four — CLOSED" and the Driver terminal status.

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

Baseline snapshots below may cite older counts (85 mid-migration); the current stable set is **4**.

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

## Focus C — Performance: collapse the walk count (ACTIVE — the perf drive)

### ⛔ STANDING PERF RULE — FAST V8 OBJECTS ONLY (hard-coded, non-negotiable)
Hot-path objects MUST be **fixed-shape / monomorphic** so V8 keeps them in fast mode (stable hidden class +
inline caches). **BANNED on hot paths:** `Object.getOwnPropertyDescriptors`/`defineProperties`/`defineProperty`,
`Reflect.deleteProperty` / `delete obj.x`, `Object.assign` into a varying-shape object, `Object.create(proto)`
+ dynamic property attach, `setPrototypeOf`/`__proto__` mutation. These push objects into dictionary mode and
kill property-access ICs. Build objects with a **constructor or a literal that sets ALL fields up front, in a
fixed order** (add `= undefined` fields rather than attaching later). Precedent is already IN this codebase:
`node-base.ts:533/577/696` note the old per-instance `Object.defineProperties` was **~38x slower** and was
replaced with constructor-set fields — reference.ts never got the memo.
**Inventory of current violations (fix on the perf drive):**
- **`reference.ts:2594-2616` (`createRulesLikeReferenceSurface`) — HOT, per mixin-ruleset reference.** The
  `getOwnPropertyDescriptors` → `Reflect.deleteProperty`×3 → `defineProperties`×2 dance. **NUKE IT** — replace
  with a proper fixed-shape surface (a small class with declared fields, or the node's own clone constructor
  + 3 field sets). This IS the #1 dynamic-eval alloc (~921ms). Follow the node-base 38x pattern.
- `render-buffer.ts:290/297` — `Object.getOwnPropertyDescriptor(node,'render')` on the render path; verify
  frequency, replace with a direct property/flag check.
- `define-function.ts:338/628/759/775` — `defineProperties`/`assign` at FUNCTION-REGISTRATION time (cold, once
  per definition); lower priority but convert for consistency.
- `logger.ts:13` — cold, ignore.

### ⛔ STANDING PERF RULE — SLIM NODES (minimize node shape; performance is the driver)
Every field on a node is paid per-instance: memory + construction cost + a slot on the hidden class + a bigger
object to GC. Keep node shapes **AS LEAN AS POSSIBLE.** Prefer **type specialization** — distinct lean node
classes each carrying ONLY the fields it needs (e.g. the approved `DeclarationReference`/`VariableReference`/
`PropertyReference`/`MixinReference` split) — over one fat `Node` with dozens of optional/`undefined` fields.
Rare/optional data belongs on the specialized subclass that needs it, **NOT a side-table (WeakMap)** — the
provenance regression proved side-tables are strictly worse (alloc + indirection). When adding a field, first
ask: can it be a **flag bit** (boolean → `F_*`), be **derived** (computed, not stored), live on a **subtype**,
or be **dropped**? **DX may change** — getter names, method surface, even public API — as long as the new DX is
**sane** (need not match or beat the old; just not bad). **Performance is the driver.** Track field-count per
node class as a metric; slim the fat ones. Shared behavior across lean types goes in **util functions**, not a
fat base class.

**SLIM targets (audit → `packages/core/perf/SLIM_NODES_AUDIT.md`; heap census ~39k nodes/7.1MB; Ruleset 12000×
is fattest×hottest — it inherits the fat `Rules` base, so slimming `Rules` slims all 12000 Rulesets):**
1. **`Rules`: 11 eager booleans → one `rulesFlags` int** (12000× × 11) — the dominant lever. `has*ChildSurface`
   (rules.ts:905-911) + `_bodyEvaluated`(934)/`_hasExtends`(948)/`_hasReferenceImports`(954)/
   `_registrationPrepared`(956). A Rules-only int (NOT base `flags` — that'd widen the read for leaf nodes);
   `resetDerivedState`→`rulesFlags=0`; getters keep names → DX-neutral. **Do AFTER W1 merges (shares rules.ts).**
2. **Drop dead `Selector.isSelector=true`** (12000×, selector.ts:82) — always true, redundant with `instanceof`.
   Cleanest effort:payoff. **IN PROGRESS (reused audit worktree).**
3. **`Node.frozen` → base `flags` bit** (~39k×, node-base.ts:562) — flags has headroom (14/31 used). Getter keeps
   name. **Do AFTER provenance merges (shares node-base.ts).**
4. PseudoSelector rare fields (3000×: `omitWrapperForSingleSelectorList`→flag; `generatedPseudoPlacementOverride`→subtype).
5. (low-confidence) Rules `lookupVersion` counters (rules.ts:919-923) — lazy-alloc only if multi-kind lookup runs;
   MEASURE first, don't downgrade the lookup fast path for slot count.
Note: the audit calls provenance "already slim, no WeakMap" — IMPRECISE; the `PROV` WeakMap exists (F_HAS_SPAN
only gates whether to consult it), and provenance-inline is killing it.

### LANDED LOG (integration branch `perf/walk-collapse` — bench after each merge)
- **W2** incremental `refreshPositions` — collapse **1006→~290ms (~3.5x)**, nested **400→~225ms (~1.8x)**. HEADLINE (found only by profiling; walk-plan would've missed it).
- **ref-nuke** `createRulesLikeReferenceSurface` reflective→same-prototype field-copy — that fn **164→21.5ms (~8x)**; dynamic end-to-end ~170→~157ms (modest, GC-absorbed); byte-identical. FAST-V8 compliance; kills dictionary-mode surface objects. (Contract: surface must NOT clone/inherit/reparent — field-copy is the only valid shape; tests lock it.)
- **FAST-V8 sweep** `render-buffer` descriptor-check→`hasOwnProperty` walk (oracle-proven equivalent) + `define-function:338` fixed-shape; byte-identical. Hygiene. (`Object.assign` record-merge sites kept — genuine dynamic user keys.)
- Benches: `packages/core/perf/collapse-bench.mjs` (static) + `dynamic-bench.mjs` (mixin/refs).
Integrated now: static collapse ~290ms (min ~260, noisy), nested ~225ms, dynamic ~157ms. W2 = the structural win; ref-nuke/FAST-V8 = compliance/alloc.

Suite is green, so this is now the live drive. **Finding (traced this pass):** the render
pipeline runs ~4 structural passes *regardless of content*, and two of them exist only because
eval still holds serialization/collapse state it was supposed to hand off.

**Walk inventory (root render, hot path):**
1. Parse → tree.
2. **Registration-prep** (`rules.ts:4755`) — pre-eval structural walk; registers decl names /
   ordered identities / extend roots / import frames. Exists for **forward references** only.
3. **Eval** (`evalNode`) — value walk; *also* registers rulesets into the extend registry
   (`ruleset.ts:1856`), gathers `context.extends`, captures collapse frames (`ruleset.ts:1902`).
4. **processExtends** (`rules.ts:6280`, once/outermost) — snapshots `preExtendSelectors` over
   **every** registered ruleset, then applies gathered extends. Short-circuits on
   `!instructions.length` — but AFTER the snapshot walk (`extend-roots.ts:643`).
5. **Serialize** (`_emitRenderRulesBody`) — output walk; builds `composedSelectorStack`, composes
   collapse selectors.
Plus the `canRenderStaticRulesDirectly` per-container scan re-deriving what `F_STATIC` already asserts.

**Root cause — a half-migration.** collapseNesting selector *composition* IS serialization-time
(`composedSelectorStack` in serialize-helper/print; old eval collapse at `selector-complex.ts:503`
is dead-commented). But its **state** stayed in eval:
- `ruleset.ts:1902` `if (collapseNesting) this.frames = [...context.frames]` — per-ruleset frame-array
  alloc, every render. No serialize/render **read** of `Ruleset.frames` found (`getHoistedParent` is
  AtRule-only) → suspected write-only dead state, propagated by two clone-copies (`ruleset.ts:293`,
  `node-base.ts:1149`). VERIFY then delete.
- `ruleset.ts:1966` `if (collapseNesting) this.hoistToRoot = true` — hoist **decision** mutated at eval time.
The one **real** eval→serialize collapse dependency is `getHoistedParent` (`serialize-helper.ts:396`)
reading a hoisted nested at-rule's captured `AtRule.frames` to recover its severed selector header.

**`F_EVAL_FREE` is NOT needed** — this supersedes `static-eval-optimizations.md`'s second-flag proposal.
That flag only existed to name "`F_STATIC` but eval still holds collapse state." Remove the state from
eval and `F_STATIC` alone is the eval-free signal; the scan collapses to a bare flag read.

**North star: the FEWEST tree traversals for byte-identical output.** Not "1/2/3 walks by feature" —
that's just the 4-pass pipeline reworded. End state = ONE driving traversal (the render/serialize walk):
- **eval** is PULLED lazily by the render walk (memoized) when it hits a dynamic value — not a pre-pass.
- **registration** is a CONSTRUCTION-TIME name index on each `Rules` node — not a runtime pass.
- **extend** (the only non-local op) is gathered DURING the render walk; because a later `:extend` can
  rewrite an earlier target, composed selectors are BUFFERED and extend is applied at walk-end as an
  O(#extends) pass over that buffered set — one accepted concession, still not a second tree traversal.
Net: one traversal + O(#extends) apply; work ∝ the dependency DAG, not passes×nodes. Static+extend-free
is the trivial floor: the walk emits directly, pulling nothing. Signals already exist (`F_STATIC`, root
`_hasExtends` at `rules.ts:948`); they're undercut by collapse-state-in-eval and the redundant scan.

**Measurable targets.** T1: a fully static, extend-free sheet renders with ZERO eval pass
(`canRenderStaticRulesDirectly` → bare `F_STATIC`; delete `isPlainStaticRuleLeaf`/`.every()`; no evalNode
on static subtrees). T2: eval-phase time for a collapse render ≈ eval-phase time for the same tree nested
(the measured ~2.6x gap — 931 vs 357ms, 4500-ruleset synth — is ENTIRELY serialize-side; partly legit
since flattening costs more, so target is "gap is all serialize," not "gap shrinks"). T3: extend gathered
in-walk + applied at walk-end over buffered selectors; no separate discovery traversal. T4: eval owns zero
serialization/collapse state; no new visibility/eval-free flag.

### Staged plan (each gated: build core, stable set unchanged, output byte-identical, A/B the collapse bench)
- [x] **C0 — dead-walk removal (DONE, 844046cbd, zero regression).** Deleted the dead `Ruleset.frames`
  write (confirmed no serialize reader; `getHoistedParent` is AtRule-only). Reordered `processExtends` to
  bail on `!context.extends.length` BEFORE the snapshot loop. Dead-weight, not a hotspot (A/B within noise).
- [ ] **C1 — collapse state out of eval.** → T2, T4. Recover the hoisted-at-rule header from serialize-walk
  structure (the walk already carries `composedSelectorStack`) instead of eval-captured `AtRule.frames`;
  move `hoistToRoot` to a serialize-time decision. PREREQ: CPU-profile the gap (eval vs serialize) first.
- [ ] **C2 — trust the flag.** → T1. Replace the `canRenderStaticRulesDirectly` scan with `F_STATIC` (+ root
  `_hasExtends` gate); delete `isPlainStaticRuleLeaf`/`.every()`. Static+extend-free subtrees skip
  registration-prep + eval → straight to serialize.
- [ ] **C3 — extend gathered-in-walk + buffered apply at walk-end.** → T3. Static subtrees register targets
  via a cheap construction-time signal, not eval. Overlaps at-rule work landing on feature/parseman — gate hardest.
- [ ] **C4 (north star) — fold eval INTO the render walk as lazy pull.** Eliminate the eager evaluated tree
  so DYNAMIC content is also single-traversal; registration → construction-time index. Largest scope, last.

### Orchestration (perf work is branch-managed, not in-place on feature/parseman)
- **`perf/walk-collapse` (worktree jess-perf-walk) is the sole integration branch.** Integrate ONLY from
  `feature/parseman` (the shared trunk); other agents' work (e.g. less-integration) reaches you when THEY
  merge to feature/parseman — never rebase directly onto another agent's branch. Trunk divergence is the
  integrator's merge to resolve (rebase forward).
- Per stage: scope a precise spec → spawn an agent in its own worktree
  (`git worktree add ../jess-perf-<stage> -b perf/<stage> perf/walk-collapse`) with the setup block +
  spec → agent works to the gate, commits, reports before/after bench + failure set → integrator merges
  into `perf/walk-collapse`, re-runs the full gate, keeps only if green, updates this checkbox + bench #.
- **Fan out WIDE** across disjoint files — try many ideas concurrently. **Reuse worktrees:** when an agent
  finishes an idea, have it COMMIT then hand it the NEXT idea in the SAME worktree (SendMessage — keeps
  file/build context) instead of spawning fresh. Agents coordinate through the orchestrator: report → gate →
  merge → next idea. Serialize only the MERGES (avoid concurrent edits to the same file across branches).
- **Agent setup block:** `pnpm install` (~10s; NOT `pnpm -r build`). Correctness gate (no build; vitest on
  src): `cd packages/core && pnpm test` — baseline = EXACTLY 2 pre-existing fails (mixin.test.ts namespace
  fast-path x2 ~5476/5578; extend-less-fixtures collection ~47:39); clean = that set + byte-identical.
  Timing (optional): build `@jesscss/core styles-config @jesscss/fns jess` only (NOT `-r`: jess-plugin is
  pre-broken TS5096). jess default output is NESTED (collapseNesting opt-in); benchmark.less does NOT
  render on jess yet — never gate on it.

**Status:** `perf/walk-collapse` = C0 (844046cbd) → merge feature/parseman (c2f6aea01, gate green) →
ruleset.ts lint debt fixed (1636a6e6b) → orchestrated goal (84319c476, 46674b2ad). Bench harness at
`packages/core/perf/collapse-bench.mjs`.

### PROFILE PIVOT (measured — the walk plan targets the wrong 2.7%)
CPU profile of a 4500-ruleset collapse render (`packages/core/perf/collapse-bench.mjs collapse`, self-time):
- **`OutputWriter.refreshPositions` (print.ts:776) — ~51%** (single biggest cost)
- **GC — ~14%** (allocation churn), **`trimEndSince` — ~7%**
- **eval — 2.7%**, serialize composition — ~4%
So C1–C4 (walk-count / eval) chase 2.7%. The prize is the **OutputWriter**. Two root causes, both on
the goal's axes (fewest allocations / least redundant work):
1. **Per-fragment `new OutputWriter()` churn — should be ONE writer per full tree serialization.**
   Fragment sites (`serialize-helper.ts` x6, `interpolated.ts` x3, `rules.ts:614`, `declaration.ts:383/1059`)
   allocate a writer + position arrays per node, then getSince/toString and discard. The writer already
   exposes `mark`/`getSince`/`restore`/`replaceSince` — thread the single render writer and use mark/restore
   instead of allocating. Keep a separate/pooled writer ONLY where fragment rendering is genuinely reentrant
   (interleaved with the main buffer); never per-call allocation. (The `new OutputWriter(false, parts)`
   flat-parts sites in call/query-condition/sequence are a different buffer kind — classify, don't blindly convert.)
2. **`refreshPositions` rebuilds from index 0 on every trim/append** (both tracks-sources branches).
   A `trimEndSince(mark)` only invalidates `_posLength`/line/col from `mark` onward — make it incremental
   `refreshPositions(from)`, seeded from position[from-1], not a full-buffer rebuild. NOTE: `tracksSources`
   is NOT the lever — probed flipping the default to false → no speedup + 26 regressions (top-level render
   writer is already !tracksSources for no-sourcemap renders; the cost is the from-0 loop in BOTH branches).

- [ ] **W1 — single-writer serialization** (root cause 1). Highest allocation win. → fewest object creations.
- [x] **W2 — incremental `refreshPositions(from)`** — DONE + merged (b629d5af4, gate clean, byte-identical).
      `refreshPositions(from=0)` recomputes only `[from..end]`, seeded from position[from-1] (mirrors
      `restore()`); trims pass `mark`; the flat-buffer seed at line 431 stays full (from=0). **HUGE win, on the
      integration branch: collapse 1006→291ms (~3.5x), nested 400→226ms (~1.8x).** The single biggest perf
      result of the whole drive — and it was invisible to the walk-minimization plan (found only by profiling).
W1/W2 are reprioritized ABOVE C1–C4 (eval is 2.7%; the writer is >70% incl. GC+trims).

### PROFILE IS BIMODAL (measured both shapes — triage of ALL perf items)
The cost profile flips with input shape, so no single item is "the" hotspot:
- **Static / output-heavy** (4500-ruleset synth): OutputWriter dominates — `refreshPositions` 51%, GC 14%,
  trims 7%; eval 2.7%, serialize-compose 4%. → **W1/W2** own this.
- **Dynamic / eval-heavy** (1200 mixin-call+operation blocks): **parse 30%, eval 22%, GC 17%, serialize 2.4%**.
  Top eval self-time: **`createRulesLikeReferenceSurface` 921ms** (= the deferred "copy/materialization
  boundary" item — REAL, not dead), **`ensureProv` 711ms** (provenance alloc — appears in BOTH profiles).
Triage verdict:
- **W1/W2 (writer)** — biggest win for static/large-output. IN PROGRESS.
- **[promote] copy/materialization** (`createRulesLikeReferenceSurface`) — the #1 eval-side allocation on
  dynamic input; the deferred item below is confirmed real. Its own stage after W1/W2.
- **[new] provenance `ensureProv`** — cross-cutting alloc in both shapes (~488–711ms). Characterize separately.
- **parse reify (`_r_*`) 30% on dynamic** — amortized in parse-once usage; a parser-perf concern
  (`parser-parse-speed-plan.md`), not core-render. Note, don't chase here.
- **C1–C4 walk/collapse-state** — small on both shapes (the specific collapse bookkeeping is a slice of the
  2.4–4% serialize); keep as correctness-hygiene, not a headline perf win. eval's 22% (dynamic) is spread
  across surface-creation + provenance, NOT the collapse frame juggling C1 targets.

### Provenance side-table — the WeakMap is the SMELL, not a thing to optimize (NEW item)
Heap profile: native `set` = **58.9%** of sampled allocation. Source: the `PROV` WeakMap in
`provenance.ts`. `setSourceSpan(this, location)` fires **in the Node constructor** (`node-base.ts:704`) —
so every spanned node, at parse/construction, does `PROV.set(node, {})` (a WeakMap entry + a `{}`), and
clone/inherit does another (`node-base.ts:1384`). Every `sourceSpanOf`/`spanStartOf`/`spanEndOf` read is a
`WeakMap.get`. **The span is ALREADY granted at construction from the parser's `location` arg — it's just
mis-stored in a side-table instead of on the node.** This is the `501abdb8c` regression: provenance was
moved off the node (to free the old `.state` name for Parséman) into a WeakMap; the churn + get-indirection
is the cost. **FIX = put spans back INLINE on the node** (a dedicated field the parser sets at construction;
`.flags`/Parséman naming is already resolved, so the original name-collision reason is gone). The parser sets
the field ONCE at construction (parser-level, where it belongs); clone/inherit then copies it as part of the
node's **fixed shape** — a monomorphic field copy, NOT the current eval-time `setSourceSpan` WeakMap write
(`node-base.ts:1384`). Eliminate the `PROV` WeakMap entirely — do not "lazy-alloc" or "denser-store" it; it
shouldn't exist. No WeakMap, no eval churn, fast V8 object. Cross-cutting (node-base + provenance.ts + all
`*Of` readers) — own stage, gate byte-identical + baseline.

### Remaining tracker perf items — triage verdicts (explore-all pass)
- **Focus A — Ruleset source-direct render eligibility:** minor; render fast-path *eligibility* refinement,
  not on the measured hot list. Keep deferred.
- **Focus B — loops COPY per iteration — MEASURED, CLOSED (not worth a refactor).** `@each` over a list var
  (4000 rulesets, identical output): loop wall-time ≈ flat (0.97x — loop parses the body once, so it's even
  marginally faster). Per-iteration body copy + frame setup (`createForIterationSurface` +
  `copyOwnedWithReusableLeaves` + extra `clone`/`inherit` + `resolveEntries`) = **~1–1.5% of CPU** total; the
  copy already uses reusable leaves (not naive deep clone). Verdict: NOT worth a zero-copy loop refactor at
  current priorities — the real loop-render cost was serialization (`refreshPositions`), already fixed by W2.
  scss-render path (for reruns): `compiler.renderString(src, { extension: '.scss', config: { compile: {
  plugins: [scssPluginInstance] } } })`. **Bugs found in passing (out of perf scope, flag separately):**
  (1) `jess-plugin-scss/src/index.ts:87` passes `'stylesheet'` but the grammar root is `'Stylesheet'` →
  scss plugin can't parse anything as-is; (2) range `@for` (`range.ts:87` evalNode stub + no `Range` case in
  `control.ts:335 resolveEntries`) doesn't iterate; `@each` over an inline comma list mis-routes.
- **Focus D.1 — `F_VISIBLE` per-node reads:** cheap (bitmask `&`); `fullRender` prototype-read already
  deleted. Not a headline; hygiene only.

### Copy/materialization — `createRulesLikeReferenceSurface` (spec'd, #1 dynamic-eval alloc)
`reference.ts:2591-2637`. Builds a defensive "owned surface" over a Rules-like reference value (independent
`parent`/`sourceNode` per reference site, per LIVE_BINDING invariant 8) using **reflective
`Object.getOwnPropertyDescriptors` + `Object.defineProperties` + a shallow `_options` clone** — ~20-30
descriptor objects PER call, once per mixin-ruleset reference resolve (call sites 2792/2810/2833/2988/3118).
~921ms / ~8% of dynamic eval self-time.
- **MANDATORY (per the FAST V8 OBJECTS rule above): nuke the reflective descriptor dance.** Replace the
  `getOwnPropertyDescriptors`/`Reflect.deleteProperty`/`defineProperties` with a fixed-shape surface — a small
  class with declared fields, or the node's own clone-constructor + the 3 explicit field sets (sourceNode,
  parent, index). Follow the `node-base.ts` 38x precedent. This is THE fix, not an option; do it FIRST.
- **Memoization (agent's FIX A) — CAUTION, do NOT key on `(input, referenceNode)` alone.** The surface's
  `parent` is the *reference-SITE scope*, which differs when the same reference node resolves in different
  scopes (recursion / a mixin called from multiple sites). Keying without the resolution scope returns a
  surface with the WRONG parent → output corruption. Only safe with the scope-identity in the key (agent's
  FIX C), which is the higher-risk architectural version. Prefer the construction win first; memoize only
  with scope-keying and heavy gating.
- Gate: byte-identical on the 1200-mixin dynamic input + the 2-known-fail baseline. Own stage (eval-semantics;
  overlaps live reference/less work — coordinate). Full agent report in session history.

### Reference-node specialization (idea — captured; tradeoff-nuanced)
Should the one generic `Reference` split into distinct node types so eval dispatches by TYPE (monomorphic
per class) instead of branching per-reference on `options.type`/flags? Separate two axes:
- **Axis 1 — syntactic kind (known at PARSE): real win.** `.mixin()` call / `@var` / property-lookup /
  `@import (reference)` member are syntactically distinct — the parser already knows which. Distinct node
  classes → each gets a **monomorphic `evalNode`** (stable hidden class, hot ICs) instead of one mega-method
  over a varying `options` bag. This is the "repeated mixin call / import-style lookup" case: the call site
  stays monomorphic instead of megamorphic. Aligns with the FAST-V8 rule (fixed shape per type).
- **Axis 2 — resolution outcome (only known at EVAL): NOT reducible by node typing.** Same `@x` → color /
  number / ruleset / import-member by runtime scope. Distinct types can't remove that branch (one node, many
  outcomes). BUT the hot `options.type === 'mixin-ruleset'` surface branch CAN become **polymorphic dispatch
  on the resolved value's class** (`resolvedValue.createReferenceSurface()` on Rules/Collection/Mixin) — kills
  the string compare, V8-monomorphic-per-type, without knowing the outcome at parse.
- **Tradeoffs.** Pro: monomorphic hot paths, fixed shapes, less megamorphic `options` access; a second angle
  on the `createRulesLikeReferenceSurface` hotspot. Con: more node classes; parser classifies at construction
  (trivial in Less/scss — syntax disambiguates); shared lookup engine must factor into helpers so the split
  doesn't duplicate resolution; a few refs ambiguous until eval (rare). Irreducible: outcome-polymorphism
  stays; a per-node resolved-kind cache hits the same scope-variance caveat as memoization (scope-key or corrupt).
- **APPROVED (owner):** split `Reference` into distinct node classes — **`DeclarationReference`,
  `VariableReference`, `PropertyReference`, `MixinReference`** (etc.) — with SHARED util functions for the
  common lookup/walk engine (dedup is fine via helpers, not inheritance gymnastics). Axis-1 syntactic split
  (parser classifies at construction → monomorphic `evalNode` per class, fixed shape) + Axis-2 value-class-
  dispatched surface (`resolvedValue.createReferenceSurface()`). Leave the pure outcome-poly alone. **Reuse
  the `perf/ref-nuke` worktree**: after the surface-nuke lands, continue that agent into the specialization
  (it already has reference.ts context).

**Still-deferred perf backlog:**
- [defer] `Reference` lookup + callable output-body placement — remaining hot path.
- [SPEC'D ↑] Copy / materialization boundary — see above; construction-cost fix first, scope-keyed memo later.
- [NEW] Provenance side-table WeakMap churn — see above; the heap `set` 58.9%; eliminate the WeakMap (inline spans).

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
   - [PARTIALLY CLOSED] **3b — declaration-override last-wins** (rules.ts:5795/5797). **The failing
     merge-chain TEST is now GREEN** (cleanup/decl-merge, commit 1656b2e78): the real root cause was NOT
     the render-only vs physical-removal dilemma below — it was (1) the coalesce walk recursing into sibling
     `Ruleset`s (they carry the `N.Rules` bit) and (2) a shared mixin-output declaration node whose
     `F_VISIBLE` strip leaked to the callee's canonical decl. Fix: scope the walk to inline `Rules`; COW the
     shared placement copy before the strip (mutation-layer detach). **The broader 3b legibility project —
     excising the two `removeFlag` stomps at 5795/5797 in favour of a persistent non-`F_VISIBLE` merge marker
     — remains DEFERRED** (no failing-test signal now; it's a cleanliness rework). The historical block below
     records why the earlier render-only-suppression approach failed:
     **~~attempted the render-only suppression-set channel this session; ABANDONED — proven architecturally
     insufficient by the gate (+6 regressions), reverted clean.~~** The finding that blocked THAT approach:
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
