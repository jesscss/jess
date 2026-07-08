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
TESTING (the oracle), which can keep a thin test-only wrapper. This is a structural divergence from
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
  eliminated/internalized (§1.1), these move to the test-only oracle wrapper or are discarded.
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
