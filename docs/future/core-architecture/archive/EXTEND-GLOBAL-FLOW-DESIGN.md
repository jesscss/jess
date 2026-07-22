# The global extend flow as a system — settled reasoning (clean-slate)

**Status:** design / reasoning only. NO wire-in, NO benchmark, NO production `.ts`.

**Mandate (widened).** The binding constraint is **observable behavior**, not the current
implementation. Today's `extend-roots.ts` / `processExtends` / `extendSelector` are the source of
*WHAT* behavior must hold — every scope dimension and semantic is enumerated below as a REQUIREMENT —
but the *HOW* is free. A clean-slate global system (or eliminating the per-call `extendSelector` API
entirely if the global flow subsumes it) is acceptable if it meets the requirements more simply. This
doc reasons that clean-slate system to a coherent settled architecture and flags what still needs an
owner decision.

**Ground truth (binding):**
- the `.less`→`.css` corpus (user-maintained Less v5 alpha expected outputs);
- the behavioral extend unit tests (those that assert rendered output / `valueOf()` strings);
- Less extend semantics.

**NOT binding (free to change or discard):** tests asserting INTERNALS — `extendSelector` return
shape, exact node/AST tree shape, call counts, flag-set-on-node assertions, flattening/structure
tests. House style is that tests verify real outputs, not implementation details. §6 classifies the
known ones.

Companion: `EXTEND-INDEX-DESIGN.md` (per-call own engine + IR + rung ledger). This doc owns the
*system*: what scope is, how many selectors × extends interact, how the whole reaches a fixpoint and
materializes once.

---

## 0. Requirements — the behavior that MUST hold (mined from today's code)

Extend's observable contract, factored into two independent questions. (Everything here is a
requirement on OUTPUT; the file:line citations point at where today's code *implements* it, as
evidence the requirement is real — not as structure to preserve.)

**(A) REACHABILITY — which subject selectors may an extend touch?**
A graph-reachability predicate over "extend roots" (`Rules` scopes). Dimensions:

| # | requirement (observable) | evidence (file:line) |
|---|---|---|
| A1 | An extend reaches subjects in its OWN root. | `isInstructionVisibleForRoot:624` |
| A2 | An extend reaches subjects in DESCENDANT roots (nesting, at-rule bodies) — root-can-reach-in. | `:627`→`isSameOrDescendantRoot:555` |
| A3 | An extend does NOT reach OUT of its at-rule/media into ancestors (inner-cannot-reach-out). | eval-integration A/B/C tests; child-edge direction |
| A4 | Same `@layer`-name roots are mutually reachable. | `layerName` reg `at-rule.ts:53/1265`; `getAccessibleRoots:537` |
| A5 | A `@media` body is its own root; extends declared inside reach only within/descendant. | `at-rule.ts:1192/1290` |
| A6 | Reference/import-scope extends NEVER activate a subject's visibility and never warn. | `fromReferenceScope` `:618/:1121` |
| A7 | A PROTECTED root (namespace / mixin body) is a wall: extends don't cross into it unless declared there. | `isProtected` `:621`; `getAccessibleRoots:523` |
| A8 | Reachability is a TRANSITIVE closure from an extend root (visible-roots set). | `getVisibleRoots:508` |

**(B) PLACEMENT / VISIBILITY — where does a fired extend render, and is the original still shown?**

| # | requirement (observable) | evidence (file:line) |
|---|---|---|
| B1 | A crossing (parent+child-spanning) extend renders at ROOT scope, not nested — and leaves the nested form in place (produces a root SIBLING). | crossing branch `:917`–`:971`; `hoistToRoot` consumed `ruleset.ts:273/347/677` |
| B2 | In reference/import mode, extend-ADDED selectors render but the ORIGINAL target does NOT. | `filterExtendedItems:987`; `F_EXTENDED && !F_EXTEND_TARGET` `:1009` |
| B3 | Extend-added OR-branches sort in SOURCE (document) order across selectors. | `documentOrderByRuleset` `rules.ts:6719`; `extendOrderMap` `extend.ts:842` |
| B4 | A generated single-item `:is(.d)` renders as bare `.d`. | `unwrapGeneratedIs`; `EXTEND-INDEX-DESIGN.md:102` |
| B5 | Self-extend / already-present branches do NOT duplicate. | rung-8 "FULL-append dedup" |

**(C) MATCH/REWRITE semantics** — owned by `EXTEND-INDEX-DESIGN.md` (the closed IR rewrite: partial
vs full, `:is`-graft, `&`-target, remainder-split, dup-multiset, element/id conflict, etc.). This doc
treats (C) as a solved black box with the contract "given one subject branch + one instruction,
produce the correct rewritten branch(es) or NOT_FOUND, string-byte-identical to Less semantics."

**The load-bearing realization.** (B) is **not recoverable from the output string alone.** Reference
suppression (B2), hoisting (B1), and ordering (B3) are decisions ABOUT branches that two different
branches with the same text need distinguished. So any design must carry (B) as explicit per-branch
STATE through the flow, then realize it at output. Today that state is node flags
(`F_EXTENDED`/`F_EXTEND_TARGET`/`F_VISIBLE`/`hoistToRoot`); a clean-slate design carries it as IR
annotations (§2.2) — but it must carry it SOMEWHERE. This is proven by the §5 evidence: a string-pure
engine drops it and reference mode breaks.

---

## 1. The clean-slate shape of the system

Three phases, one node crossing. Deliberately NOT today's gather→per-root-filter→classify→
apply-cascade→warn; instead:

```
  PLAN  →  SOLVE  →  EMIT
 (scope) (fixpoint) (materialize once)
```

- **PLAN** builds, once, two immutable structures: the **reachability relation** (A) and the
  **target index** (C's dispatch). Pure precompute over the extend-root graph + the instruction list.
  This is the ONLY place scope-(A) is decided.
- **SOLVE** runs ONE global dataflow worklist over `(subjectBranch, instruction)` work-items admitted
  by reachability, rewriting the IR to fixpoint, carrying (B) annotations on produced branches. No
  nodes built here.
- **EMIT** folds each subject's final IR `Or`-set to nodes ONCE, projecting (B) annotations to output
  (reference filter, hoist placement, ordering, `:is` unwrap). The only node crossing.

Why this is simpler than today: today's four classify passes + the ownSelector cascade (`:972`–
`:1089`) exist because match, placement, and scope are entangled and re-derived per instruction on
mutating nodes. Separating (A) into PLAN, (B) into annotations, and (C) into the IR rewrite
collapses the cascade: there is no "classify local/crossing/within-ampersand" pre-pass — a rewrite's
OUTCOME (does it cross a boundary? does it touch only the parent?) is computed once, in the IR, at
fire time, and recorded as the branch's placement annotation.

### 1.1 On eliminating the per-call `extendSelector` API

The global flow subsumes it. `extendSelector`'s single-call contract exists today only because
`processExtends` and `applyExtendsToSelector` call it per instruction on nodes. If SOLVE operates on
the IR and EMIT is the sole materializer, there is no in-flow caller for a node→node per-call extend.
**Proposal: `extendSelector` becomes internal to the IR rewrite (the (C) black box) and is no longer
a public node→node API.** The only external need for "extend one selector by one rule" is differential
TESTING (the reference), which can keep a thin test-only wrapper. This is a structural divergence from
today and invalidates the internal tests in §6.2 — acceptable per the mandate.

---

## 2. SOLVE — the document-level multi-pass fixpoint

### 2.1 One global worklist, one shared index (decision + why)

**Decision: ONE global worklist over `(subjectBranch, instruction)` sharing ONE target index,
partitioned by reachability bucket.** Rejected alternatives:
- *Per-selector independent worklists* — cannot express cross-selector transitive closure (§2.3) or
  hoist reachability changes (§2.4) without re-scanning, which is the O(I²) cost today's memo patches
  around. A produced branch on selector X must be able to become a target for selector Y.
- *Per-selector worklists with a shared read-only index* — closer, but a produced branch still needs
  to notify OTHER selectors, which is a global event; once you have the global event bus you have the
  global worklist, so collapse to it.

The shared **target index** is the thesis of `EXTEND-INDEX-DESIGN.md` §"Target index": instructions
grouped by find-target into `(extendWith, mode)` buckets, one Set-Trie/automaton, one match fires the
whole same-target bucket. Rebuilding it per-selector forfeits its reason to exist.

### 2.2 Data model

- **Subject** = a lifted selector's IR `Or` = list of branches. Each **branch** (`Seq`) carries an
  annotation `{ bucket, placement, origin, order, visible, generated }`:
  - `bucket` — reachability bucket id (which extend root it lives in); the fixpoint's partition key.
  - `placement` — `this-level | root` (abstract `hoistToRoot`); a hoist rewrite sets `root`.
  - `origin` — `authored | extend-added | extend-target` (abstract `F_EXTENDED`/`F_EXTEND_TARGET`).
  - `order` — document-order key for B3.
  - `visible` — reference-keep marker (B2's `F_VISIBLE`).
  - `generated` — carries into `:is` unwrap (B4).
- **Instruction** = `(target, extendWith, partial, rootId, node?)` in the target index, id'd.
- **Reachability** = `reach(bucket_of_instruction, bucket_of_subject) : bool`, the PLAN precompute.

### 2.3 Drain + cross-selector transitive closure

- **Seed:** for each branch, Set-Trie-route its content to candidate instructions; enqueue
  `(branch, instr)` for each reachable one.
- **Fire:** run the (C) rewrite. Outcomes:
  1. **produces branch(es) B′** — insert into the subject's `Or` (deduped by value, B5), annotate B′
     (`origin=extend-added`, `order` from the instruction's source order, `placement`/`bucket` per
     §2.4), and **route B′'s content to the index**, enqueuing `(B′, instr′)` for every reachable
     instruction B′ could satisfy. This is the transitive step: an added branch is itself a subject.
  2. **NOT_FOUND** — mark done, no change.
  3. **UNSUPPORTED** — record for the irreducible tail (wire-in-phase concern, not this doc).
- Closure is pure dataflow: work re-enters only when new content appears, never a full re-scan. This
  is the principled form of today's `findChainedExtends`+`queuedKeys` (`extend.ts:451/462`), lifted
  global.

### 2.4 `&`-hoist mid-fixpoint (where (A) and (B) meet)

A crossing rewrite (match spans parent+child) sets the produced branch's `placement=root`, which is
ALSO a `bucket` move to the root bucket. Consequences the worklist honors:
1. The hoisted branch is now reachable to root-bucket instructions → enqueue it against them.
2. It must NOT re-fire instructions reachable only via its old nested bucket (today's parent-only→DROP
   rule) — enforced because it carries the NEW bucket, and fire-once is keyed on branch identity.
3. The original nested branch stays; hoist appends a root SIBLING (B1). Two branches, two buckets, two
   placements — expressible precisely because bucket+placement are per-branch annotations, not a
   global mode.

This is the reason the fixpoint is document-level and bucket-aware rather than a flat set: a hoist is
a live re-bucketing event, only expressible if buckets participate in the fixpoint.

### 2.5 Fire-once (global) + termination

- **Fire-once:** global `applied` set keyed on `(branchId, instrId)`. A hoisted branch gets a fresh
  `branchId`, so it can be examined against root instructions without being blocked by the original.
- **Termination:**
  1. Monotone bounded content: every produced branch is value-deduped before insertion (B5), so
     distinct branch-values strictly increase toward a bound.
  2. Fire-once bounds total fires ≤ |branches| × |instructions|.
  3. New branches draw atoms only from `{authored} ∪ {extendWith}` composed by the finite rewrite
     constructor set; a self-referential cycle (`.a`↔`.b`) produces a duplicate on the second lap →
     deduped → no growth → halt.
  4. The one escape is `:is`-graft nesting deepening a branch (`:is(:is(...))`) — see OQ-3.

### 2.6 Ordering / determinism

Fire order must not affect OUTPUT (only performance). Because rewrites are value-deduped and the final
OR-branch list is sorted by `order` (B3) at EMIT, the fixpoint is confluent: any drain order yields
the same final `Or`-set of `(value, annotation)` pairs. This is a design INVARIANT to preserve — the
worklist may reorder freely for perf, but EMIT's sort is what pins output order. (OQ-4: confirm no
rewrite's output value depends on the current partial state in an order-sensitive way; today's
same-target BATCH `applyBatchedExtend:523` hints some do — must verify batch vs sequential are
output-equal, which the code claims but we must pin as an invariant.)

---

## 3. EMIT — materialize once

One node-construction per subject, at fixpoint end: fold the final `Or` → `SelectorList`/
`ComplexSelector`/`CompoundSelector`, assign onto the ruleset. Annotation projection:

- `placement=root` → `hoistToRoot=true` on selector + ruleset; hoisted branches emit into the root
  SelectorList, `this-level` into the nested form (B1).
- `origin` → `F_EXTENDED`/`F_EXTEND_TARGET`/neither, so the reference-compose filter
  (`ruleset.ts:987`) runs UNCHANGED (B2). *This is the fix for the §5 leak.*
- `order` → sort OR-branches before emit (B3).
- `visible` → `F_VISIBLE` (reference keep).
- `generated` → `:is` unwrap/format rules (B4).

Serialization stays HYBRID: generated branches fold from IR; original branches serialize from their
retained node (trivia/spans faithful) — EMIT keeps a handle to each original branch's node.

**Crossing folds INTO EMIT** rather than being a pre-apply side-channel: because placement is a
branch annotation, the crossing composed-form is just a `placement=root` branch the catamorphism
emits at root. (This subsumes today's `:917`–`:971` special path — see OQ-2 for the risk.)

---

## 4. PLAN — scope as precompute (the settled, low-risk part)

- Build the extend-root reachability closure once (today's `getVisibleRoots`+`isSameOrDescendant`,
  already cached `:721/:738`). Output: `reach(instrBucket, subjectBucket)`.
- Build the target index once (group instructions by find-target).
- Partition subjects + instructions into buckets. A2/A4/A5/A7/A8 are all EDGES in this graph;
  A6 (reference) is a per-instruction flag that gates warning + visibility, carried into `origin`/
  `visible` handling at EMIT.
This phase reproduces (A) exactly and is the part of today's code that survives structurally
unchanged — it is already a clean precompute.

---

## 5. Evidence (an exploratory wire-in, reverted — no `.ts` landed)

A throwaway experiment routed the own engine through `tryExtendSelector` (string-level) to find where
a naive wire-in breaks. Reverted; extend suite back to 682/0 baseline. It broke on exactly the (B)
dimensions:
- **Reference/import mode (4 tests, `extend-import-style.test.ts`, BEHAVIORAL):** leaked `.base,`
  where reference mode must suppress the original — string-pure output has no `origin` flags →
  `filterExtendedItems` can't distinguish. **⇒ motivates (B2) + IR `origin`/`visible` annotations.**
- **`&`-hoist (1 test, `extend-ampersand-boundary.test.ts`, INTERNAL assertion of `hoistToRoot`):**
  placement not propagated. The BEHAVIORAL form is "does the rendered CSS hoist" — same root cause.
  **⇒ motivates (B1) + §2.4.**
- **AST shape (1 test, `extend-eval-integration.test.ts`, INTERNAL):** string-equal, node-shape-diff.
  **⇒ non-binding per mandate; §6.2.**

Positive signal: the reachability filter (A) and per-selector worklist were untouched and unbroken —
consistent with "(A) is settled precompute, (B) is the design's real work."

---

## 6. Test classification — behavioral (binding) vs internal (free to change)

### 6.1 Behavioral — MUST hold under any design
- The whole `.less`→`.css` corpus (`all-less`, user-maintained expected outputs). PRIMARY gate.
- Extend unit tests asserting rendered output or `valueOf()` strings: `extend-simplified-cases`,
  `extend-selector-algorithm` (the `str(...)` assertions), `extend-combinator-handling`,
  `extend-import-style` (the `renderNodeToString`/`toBeString` cases), reference-mode render tests.
- Warnings: `extendNotFound`/`extendNotAccessible` emission on the right instructions.

### 6.2 Internal — expected to change or be discarded under a clean-slate design
- **AST/node-shape assertions:** `extend-eval-integration.test.ts` "AST shape: same nodes and selector
  shapes as parsed" — asserts `ComplexSelector`-wrap vs flat `CompoundSelector`. Non-binding.
- **`extendSelector`/`tryExtendSelector` return-shape + per-call unit tests** (`extend-unit.test.ts`,
  the `tryExtendSelector`/`createProcessedSelector` direct-call tests) — if the per-call API is
  eliminated/internalized (§1.1), these move to the test-only reference wrapper or are discarded.
- **Flag-set-on-node assertions** (`innerRuleset.hoistToRoot === true`) — replace with a render-level
  assertion of the hoisted output.
- **Call-count / memo / `beginExtendMatchPass` internals** — the fixpoint replaces the memo; these go.
- The `tree/extend/` differential + sweep harness — a validation scaffold, not a behavior spec; kept
  as long as useful, discarded when the global flow is the source of truth.

---

## 7. Open questions (owner decisions)

- **OQ-1 — is the per-call `extendSelector` API eliminated?** §1.1 proposes internalizing it. This is
  the biggest structural fork: keep it (smaller change, some entanglement remains) vs remove it
  (cleaner, invalidates §6.2 per-call tests). Owner call.
- **OQ-2 — crossing folded into EMIT, or kept as a pre-pass?** §3 folds it (one system) but the
  composed-form logic (`getFullComposedForm:320`, `:940`–`:952`) is intricate; folding is the riskiest
  reproduction. Keep as a documented pre-pass = smaller blast radius. Owner call.
- **OQ-3 — termination under `:is`-graft nesting.** §2.5 argues finite-alphabet termination but graft
  depth could grow. Is graft depth provably bounded by input depth, or do we keep a depth guard?
- **OQ-4 — confluence / batch-equals-sequential.** §2.6 needs "output value is independent of drain
  order." Today's `applyBatchedExtend` vs sequential must be output-equal (claimed, unpinned). Confirm
  as an invariant, or the fixpoint isn't confluent and order becomes load-bearing.
- **OQ-5 — the ownSelector / nested-resolved split (LEAST settled).** The `.aa { .dd {} }` cascade
  (`:972`–`:1089`, `analyzeNonPartialExtends:393`) decides own-fragment vs composed-whole extension.
  Does it collapse into placement (`own` vs `composed` = two placement targets), or is it a THIRD
  independent axis the IR must model? This is the one piece the clean-slate model has NOT obviously
  absorbed; needs owner reasoning before the design is truly settled.
- **OQ-6 — warnings from the fixpoint.** Confirm the fired-set + retained reachability reproduce both
  `extendNotFound` and the protected-root `extendNotAccessible` (`:1134`). Likely yes; pin it.

---

## 8. Assessment — settled vs open

**Settled:** the three-phase shape (PLAN/SOLVE/EMIT); (A) reachability as pure precompute; SOLVE as
ONE global dataflow worklist over `(branch, instruction)` with a shared index, buckets, fire-once,
and dedupe-termination; cross-selector closure as re-enqueue on produced branches; hoist as a live
re-bucketing event; EMIT as the sole node crossing projecting per-branch (B) annotations onto the
existing reference-filter/hoist/order/unwrap machinery. The (B)-as-explicit-annotation conclusion is
firm and evidence-backed (§5).

**Open (block a full spec):** OQ-1 (eliminate per-call API?), OQ-2 (crossing fold vs pre-pass), and
especially **OQ-5 (ownSelector split — a third axis or not?)**. OQ-3/4/6 are settle-able with
confirmation.

**Bottom line:** the system is coherent and, freed from replicating today's structure, SIMPLER than
the status quo — scope = reachability precompute (A) + per-branch state (B); multiple IR passes = one
global dataflow worklist over reachability buckets, confluent by construction, materialized once. It
is ready for review. It is NOT ready to implement until OQ-1/OQ-2/OQ-5 are arbitrated, because each
changes what the IR carries and how much of today's `processExtends` the flow subsumes.

---

## 9. OQ-5 behavioral characterization (own vs composed)

**Purpose.** OQ-5 was posed in the code's jargon (`analyzeNonPartialExtends`, `F_EXTEND_TARGET`,
`ownSelector`). This section restates it as PLAIN OBSERVABLE BEHAVIOR — concrete `.less`→`.css` cases,
rendered through the ACTUAL current Jess renderer (`renderNodeToString`, `collapseNesting:true`) — so
the axis can be ruled on with real examples rather than machinery.

**The distinction, in one sentence.** A nested ruleset `.aa { .dd {} }` has two selector forms: its
**own** authored fragment `.dd`, and its **composed/resolved** form `.aa .dd`. The question is whether
extend targeting/contribution needs BOTH as distinct handles, and whether that folds into the (B)
placement model or is a separate axis.

**Two directions the split shows up (critical — they are NOT the same thing):**
- **As a TARGET** — an extend elsewhere names `.dd` vs `.aa .dd` and we ask which form of the nested
  ruleset it may hit.
- **As a CONTRIBUTION (extend-with)** — the nested ruleset is itself the *extender* (`.dd:extend(.x)`
  or `.dd { &:extend(.x) }`), and we ask which form of `.dd` gets added to `.x`'s selector list.

The contribution direction is where the current renderer is actually WRONG today (§9.2), and it is the
load-bearing half of OQ-5.

### 9.1 Cases where own-vs-composed is a TARGET distinction

All rendered through Jess as of `work/oq5` (branched from `origin/dev`).

**C1 — plain `:extend(.dd)` against a nested own fragment: NO match.**
```less
.aa { .dd { color: red; } }
.zz:extend(.dd) { color: blue; }
```
```css
.aa .dd { color: red; }
.zz { color: blue; }
```
A non-`all` extend naming the bare own fragment `.dd` does **not** fire against the nested ruleset.
Neither own nor composed is extended. *(Own form is not independently targetable by a plain extend.)*

**C2 — `:extend(.aa .dd)` (composed) DOES match.**
```less
.aa { .dd { color: red; } }
.zz:extend(.aa .dd) { color: blue; }
```
```css
.aa .dd,
.zz { color: red; }
.zz { color: blue; }
```
The COMPOSED form drove it: the target text equals the resolved selector, so `.zz` is appended.

**C3 — `:extend(.dd all)` fires inside the composed selector.**
```less
.aa { .dd { color: red; } }
.zz:extend(.dd all) { color: blue; }
```
```css
.aa .dd,
.aa .zz { color: red; }
.zz { color: blue; }
```
`all` matches the `.dd` FRAGMENT *within* the composed `.aa .dd`, substituting to `.aa .zz`. The OWN
fragment drove the match, but the emitted contribution is re-composed under the found context `.aa`.

**C4 — `:extend(.aa .dd all)` (composed whole) replaces the whole branch.**
```less
.aa { .dd { color: red; } }
.zz:extend(.aa .dd all) { color: blue; }
```
```css
.aa .dd,
.zz { color: red; }
.zz { color: blue; }
```
The COMPOSED whole drove it; `.zz` replaces the entire `.aa .dd`, not just a fragment.

**Reading of 9.1:** target-side, own vs composed is NOT two independent handles the IR must carry — it
is one selector (the composed/resolved form) plus the `all`-mode fragment-substitution semantics of the
(C) match/rewrite engine. C3 differs from C4 ONLY by `all`-fragment vs `all`-whole matching, which (C)
already owns. The bare own fragment `.dd` is not a target at all (C1). **Target-side collapses into (C).**

### 9.2 Cases where own-vs-composed is a CONTRIBUTION distinction — and Jess is WRONG today

Here the nested ruleset is the *extender*. Rendered from the real Less test-data fixtures
`tests-unit/extend-selector` and `tests-unit/extend-nest` through the Jess corpus harness
(`all-less.test.ts`, `LESS_TEST_DATA_ROOT` = the Less.js checkout). **Both fixtures currently FAIL in
Jess**, and every failure line is this axis. The `- Expected` lines are the Less-4.x expected output; the
`+ Received` lines are what Jess emits today.

**C5 — nested extender must contribute its COMPOSED form (extend-selector).**
```less
.ext { test: 1; }
.a, .b {
  test: 2;
  .c:extend(.ext all) { test: 3; .d { test: 4; } }
}
```
```diff
  .ext,
- :is(.a, .b) .c {      // expected: composed form of the extender
+ .c {                  // Jess emits: OWN fragment only
    test: 1;
  }
```
The extender `.c` lives under `.a, .b`. Its contribution to `.ext`'s list must be the COMPOSED
`:is(.a, .b) .c`. Jess adds the OWN `.c`. **Composed form is load-bearing and currently dropped.**

**C6 — crossing extender must contribute its COMPOSED form (extend-selector, `.footer .footer-nav`).**
```less
.header { .header-nav { background: red; &:before { background: blue; } } }
.footer { .footer-nav { &:extend( .header .header-nav all ); } }
```
```diff
  .header .header-nav,
- .footer .footer-nav {   // expected: composed extender
+ .footer-nav {           // Jess emits: OWN fragment only
```
Same axis via a crossing (`all`, target spans parent+child) extend. `.footer` is not an ancestor of the
target, so the extender must compose to `.footer .footer-nav`.

**C7 — nested extender against a top-level target (extend-selector, issue-2586).**
```less
.issue-2586-bordered { border: solid 1px black; }
.issue-2586-somepage {
  .content:extend(.issue-2586-bordered) { &>span { margin-bottom: 10px; } }
}
```
```diff
  .issue-2586-bordered,
- .issue-2586-somepage .content {   // expected: composed
+ .content {                        // Jess emits: OWN
```
Note this is a NON-`all`, NON-crossing plain extend, yet composition is still required — so the
composed-contribution requirement is not gated on `all` or crossing.

**C8 — the `sidebar` family (extend-nest).**
```less
.sidebar { width: 300px; .box { color: white; } }
.type1 { .sidebar3 { &:extend(.sidebar all); background: green; } }
```
```diff
  .sidebar,
  .sidebar2,
- .type1 .sidebar3,   // expected: composed
+ .sidebar3,          // Jess emits: OWN
  .type2.sidebar4 { width: 300px; background: red; }
```
And the same substitution flows into the `.box` `:is(...)` line. `.sidebar2` (top-level extender, own ==
composed) is correct; only the NESTED extenders (`.sidebar3`) diverge — pinpointing that the bug is
exactly "own emitted where composed required."

**Reading of 9.2:** contribution-side, the extender's OWN fragment and its COMPOSED form are genuinely
different strings, and Less semantics require the COMPOSED form in the target's selector list. This is
NOT the target-side story of 9.1 — it is about *where the extending ruleset sits*, i.e. its placement in
the tree relative to the target. The composed contribution is `composeExtendWithRelativeToTarget`
(`extend-roots.ts:257`) / `getFullComposedForm` (`:320`); today's bug is that the nested extender's
contribution falls back to own for local/plain matches.

### 9.3 The `&{}` / reference-mode angle (B2 interaction)

**C9 — `&{}` hoist under an extender.**
```less
.base { color: black; }
.derived { &:extend(.base); & { color: green; } }
```
```css
.base,
.derived { color: black; }
.derived { color: green; }
```
Here `.derived` (own == composed, top-level) is added to `.base`, and the `& {}` block hoists to a
`.derived` sibling. In reference-import mode this is the design's known `.b { color: green }` case: the
original target `.base` must be SUPPRESSED while the extend-added `.derived` and the hoisted `& {}`
sibling remain — which is B2 (`origin`/`visible` annotations), NOT own-vs-composed. Own-vs-composed is
orthogonal to it: the reference filter operates on the composed contribution regardless of which form
was chosen. *(The full `tests-unit/import/import-reference.less` fixture is on the expected-failure list
for an unrelated at-rule-filtering reason, so C9 is an isolated inline reproduction of just the
`&{}`+extend interaction, which renders correctly today in non-reference mode.)*

### 9.4 Do the two forms ever COEXIST as targets for one ruleset simultaneously?

No case in the corpus requires the SAME ruleset to expose both `.dd` and `.aa .dd` as two live targets
at once. Target-side, only the composed form is ever a target (9.1). Contribution-side, a ruleset
contributes exactly ONE form per fire — its composed form relative to the matched target (9.2); the
"relative to target" clause means the composed string can differ per target, but it is still one
contribution per (extender, target) pair, not two coexisting handles.

### 9.5 Recommendation: OQ-5 is **(a) — folds into (B) placement, not a third axis**

**Claim:** own-vs-composed is NOT an independent scope axis. It decomposes cleanly into the two models
already in the design:
- **Target-side (9.1)** → belongs to **(C)**, the match/rewrite black box. The only "own" behavior is
  `all`-mode fragment matching inside the composed selector (C3), which (C) already owns. The composed
  form is the sole target; the bare own fragment is never independently targetable (C1). No new IR state.
- **Contribution-side (9.2)** → is a **(B) PLACEMENT** fact. "Which form does this extender contribute"
  is fully determined by WHERE the extender sits in the tree relative to the target — precisely the
  information PLAN already computes (the extend-root graph + parent chain) and EMIT already projects
  (`placement`, and the `hoistToRoot`/composed-form logic). The composed contribution is
  `composeExtendWith…RelativeToTarget` — a function of the extender's bucket/placement and the target's
  ancestor set, both PLAN outputs.

**How the two-targets encoding reproduces every case.** In the §2.2 model, each branch carries
`{ bucket, placement, origin, order, visible, generated }`. Own-vs-composed needs NO new field:
- The extender's branch already knows its `bucket` (which root/parent chain it lives in). Its composed
  contribution is derived at fire time by composing along the path from its bucket up to the target's
  bucket's common ancestor — exactly `composeExtendWithRelativeToTarget`. C5/C6/C7/C8 are all "compose
  the extender's authored fragment along its `bucket` path relative to the target," which is a PLAN-graph
  walk + (C) rewrite, producing ONE `origin=extend-added` branch on the target with the composed value.
- A crossing extender (C6) additionally sets `placement=root` on its produced branch — already in the
  model (§2.4). Own-vs-composed adds nothing beyond the composed VALUE of the contributed branch.
- C1–C4 are pure (C): the target subject's branch is rewritten (or not) by the instruction; `all` vs
  non-`all` and fragment vs whole are (C)'s existing rewrite modes.
- C9 is pure (B2): `origin`/`visible` on the added/hoisted branches; own-vs-composed does not enter.

So the branch annotation set is sufficient: the "composed" form is a DERIVED value (compose along the
bucket path at fire time), and the "own" form is just the extender's authored fragment before that
composition. There is no third orthogonal dimension to carry — no `ownness` flag independent of
`bucket`/`placement`. The current code's `ownSelector`/`analyzeNonPartialExtends` cascade
(`extend-roots.ts:972`–`1089`) is the ENTANGLED form of this: it re-derives, per instruction on mutating
nodes, "should I emit the own fragment or the composed whole," precisely because placement and match are
not separated. In the clean-slate model that cascade DISAPPEARS: PLAN gives the bucket path, (C) gives
the match, and EMIT composes the contribution from the path — the own/composed choice is never an
explicit branch, it is the output of composing (or not) along a known path.

**Why NOT (b) a third axis.** A third axis would be justified only if own-ness were independent of both
reachability and placement — i.e. a ruleset could need its own form as a live handle in a way not
determined by its tree position. No corpus case shows that (9.4). Own-ness is a strict function of
placement (tree position relative to target), so it is a projection of (B), not an orthogonal coordinate.

**Bottom line for the design:** OQ-5 resolves to **(a)**. The IR carries no new field; the composed
contribution is a fire-time derivation from the extender branch's `bucket`/`placement` (PLAN data) run
through the (C) rewrite, and EMIT projects it exactly as it already projects placement. This REMOVES the
`ownSelector`/`analyzeNonPartialExtends` cascade rather than reproducing it — consistent with the §1
claim that separating (A)/(B)/(C) collapses today's classify passes.

### 9.6 Needs owner confirmation of intended output

The `.css` files under the Less.js checkout are the **Less-4.x expected `.css`**, NOT the user-maintained Jess v5
alpha expected outputs. The C5–C8 diffs above are Jess-vs-Less-4.x. Two points need an owner ruling
before treating them as the correctness target:
1. **Is the composed-contribution form (`:is(.a,.b) .c`, `.footer .footer-nav`, `.type1 .sidebar3`) the
   intended v5 output?** It matches Less 4.x semantics and the recommendation assumes yes, but these
   specific fixtures are not on the jess pass-list yet (extend-nest and extend-selector currently FAIL),
   so the v5 expected `.css` for them has not been ratified by the owner.
2. **Adjacent (non-OQ-5) divergences in the same fixtures, flagged so they are not conflated with OQ-5:**
   - `extend-nest`: `:is(.button, .submit):hover` (expected `.css`) vs `.button:hover, .submit:hover` (Jess) — an
     `:is()`-grouping/format question (B4-adjacent), independent of own-vs-composed.
   - `extend-nest`: the `.amp-test-*` block renders malformed in Jess (leaked `&`, runaway `:is()`
     nesting) — a `&`-substitution recursion bug, independent of OQ-5.
   - `extend-selector`: `[data=@{attr-data}]` unresolved (expected `.css` resolves to `[data="test3"]`) — an
     interpolation-eval issue, independent of OQ-5.
   These do not affect the (a)-vs-(b) ruling but WILL block making the fixtures green; they belong to
   other axes and should be tracked separately.
