# Aggressive Cutting Review

This is the repo-local guardrail for Jess core architecture queue passes. It is
not a performance benchmark. It is a refusal checklist for accidental machinery
and for architectural drift across whole nodes, services, and capability
boundaries.

Use it before committing changes that touch AST nodes, eval/render, lookup,
copying, inheritance, traversal, source/root metadata, output writing, the
core architecture router, or the focus document.

This is one of the core-architecture coordination docs:

- `HANDOFF.md` is the short router.
- `archive/FOCII.md` owns goal-settable focus prompts, boundaries, and stop rules.
- `CORE-CLEANUP.md` owns active queues, completion gates, benchmark/profile
  protocol, and performance evidence.
- This file owns architecture and patch-shape review: whether a proposed edit
  keeps responsibilities on the right owner, avoids repeated methods with tiny
  deltas, avoids helper/API growth, and avoids machinery, materialization,
  traversal, metadata mutation, or state that the hot path should not pay for.

When performance work is active, this checklist still applies. A benchmark may
choose the target, but it does not excuse adding generic copy/traversal/helper
machinery unless the measured runtime result and semantic boundary justify it.

## Pass Size

This checklist is a commit-boundary guard, not permission to stop after the
first safe edit. A queue pass should cover a coherent swath of adjacent work in
the active lane before commit. That rule applies equally to binding/scope
architecture work and to broader eval/render/performance cutting work.

Use focused tests while iterating through the swath. Run this review, broader
gates, benchmark sanity, staging, commit, and push at the batch boundary, unless
the next slice has different semantics, requires user judgment, or the evidence
shows the approach should be abandoned.

## Hard Rules

`AUDIT:` and `AUDIT(category):` comments are human smell markers. Investigate
them as part of the relevant pass; do not blindly delete or preserve the marked
code. Either simplify the shape or record a short evidence-backed reason in the
owning cleanup doc for why it remains.

1. Architecture first, diff second.
   Start by naming the node/service/capability surface being changed and what
   that surface should own. A pass that mechanically explains each changed line
   but never asks whether the owning node is carrying the right capabilities has
   failed review.
2. No separation-of-concerns laundering.
   Helper files are not separation by themselves. A refactor only improves
   separation when ownership of the state, cache, versioning, invalidation, or
   rendering/eval capability moves to the right boundary or becomes simpler.
3. No near-duplicate methods.
   Methods that repeat the same traversal or algorithm except for one branch,
   one callback, or one special-case line must be unified, split around a real
   semantic boundary, or explicitly rejected with evidence. Do not preserve
   mechanical repetition because the tests are currently green.
4. No new traversal unless it deletes worse traversal.
   Added loops, recursion, `map/filter/sort`, parent walks, source walks,
   generators, side-map lookups, or object/array scans must explain why the fact
   could not be carried by parser/adoption/eval state already on the path.
5. No new node creation without a named ownership boundary.
   Classify every `new Node`, copy, `.inherit`, `.adopt`,
   `copyWithReusableLeaves`, wrapper `Rules`, materialized array, `frozen`, or
   parent/source metadata mutation.
6. Render means stringify.
   Resolving into nodes or arrays just to render is suspect by default.
7. No helper growth.
   A helper must delete more hot-path function/API surface than it adds.
8. No metadata mutation as convenience tax.
   Parent restoration, frozen/source/location inheritance, lazy context/options,
   `Reflect.*`, `Object.hasOwn`, and structural probes are guilty until proven
   necessary.
9. Evidence before performance claims.
   Tests and code-path evidence can prove "less wrong machinery." Only profiles
   or benchmarks can prove "faster."
10. No cumulative node weight laundering.
   A pass does not pass review merely because its maps, caches, helper ladders,
   or narrow-case branches were added in earlier commits. If the edit touches a
   node that already owns multiple lookup/index/render/eval responsibilities,
   the self-prosecution must classify the existing ownership it relies on and
   say whether the pass reduces, preserves, or worsens that cumulative weight.
   If the answer is "preserves," record the next concrete extraction/audit item
   in the owning focus tracker before committing.
11. Lookup utilities are not ownership by themselves.
   Moving code into helper files is not enough if the node still owns the cache
   fields, version counters, and invalidation choreography. Review lookup work
   by asking who owns the index and mutation protocol, not only where the search
   loop lives.

## Ownership Classifications

- `render-only`: rejected unless impossible to stringify directly.
- `eval-to-immediate-string`: rejected.
- `public materialization`: allowed only on a cold public path.
- `semantic placement state`: allowed when canonical source references cannot
  represent the behavior.
- `construction/adoption flag`: allowed when it removes later rediscovery.

## Required Self-Prosecution Block

Each queue pass must update `docs/future/core-architecture/HANDOFF.md` with:

```md
## Aggressive Cutting Self-Prosecution

- Architecture surface:
- Separation/duplication:
- Cumulative node weight:
- New traversal:
- New node/materialization:
- Render path:
- Helper/API surface:
- Metadata mutations:
- Review-flagged diff tokens:
- Evidence:
- Verdict:
```

Every bullet must name exact files/functions or say `none`. `Verdict` must be
one of:

- `accepted`: the pass deletes machinery or carries state earlier;
- `rejected`: the proposed change added unjustified machinery and was reverted;
- `deferred`: the pass found a real target but needs tests/profile evidence.

## Local Check

### Hot-path cost contracts

The self-prosecution block is now also a cost-accounting boundary. When a
change touches core/parser source, or introduces one of the existing danger
tokens, the latest handoff pass must include a `Hot-path cost contracts` JSON
fence. This is deliberately about shape and relations, not a magic benchmark
number. The record must name a cheap admission predicate that runs before
collection/allocation, report calls, feature-bearing calls or containers, items
visited, no-feature allocations, and no-feature misses, and point to a common
no-feature benchmark or counter test. Every production record must also carry
the canonical `benchmark.less` before/after A/B for both parse+render and
render-only, using 20 warmups and 45 alternating pairs, with byte count/hash
parity. A focused test alone is not a performance proof.

Every contract must also include a proof-of-necessity record. It names the
authoritative fact source, the action that rediscoveries that fact, where the
fact could be carried forward, and the evidence-backed reason it is not already
carried. `necessity.status` is `audit-required` for existing machinery awaiting
the action audit and `proven` only after the producer-to-consumer flow has been
traced. A production change cannot touch an `audit-required` owner: the agent
must carry the fact, delete the rediscovery, or prove the rediscovery is
semantically unavoidable. “It avoids a more expensive pass” is not sufficient;
the total work and the common no-feature path must be measured.

The verifier validates this registry and the matching handoff record. Its
danger-token scan is intentionally limited to parser/eval/render source under
the reviewed package roots; the verifier's own review-time loops and the prose
that documents them are not runtime hot-path changes. A source check is used
for the known failure pattern: changing the merge coalescer's owner file
requires the admission guard to appear before the coalescer call. That means a
reviewer cannot satisfy the gate by adding counters or a prose explanation
while leaving an unconditional rare-feature pass in place.

Registry ownership is closed-world: a new or changed production hot-path owner
file must add or update a registry contract in the same change. Each contract
covers exactly one production file and one named source surface, and must
provide the cheap admission predicate, required counters and relations, a
common no-feature benchmark or counter proof, and an executable source check
for that surface's guarded caller. Multiple contracts may cover one file only
when their caller/operation surfaces are disjoint. Audit records must use
registry IDs, and every changed production hot-path hunk must match exactly one
such surface. A hunk that matches none or multiple surfaces fails closed;
file-level ownership cannot silently cover an unrelated evaluator or serializer
change. A changed production contract must be `accepted`; `rejected`/`deferred`
means the experimental code was reverted before landing. Test-only paths still
receive the normal danger-token review but are excluded from this production-
file coverage requirement.

Relations are machine-checked counter expressions, not prose labels. A contract
whose admission controls an expensive operation must expose the number of
containers inspected and the work performed by that admission, in addition to
the successful-admission count. The registry names those counters explicitly
(`admission.counter`, `admission.workCounter`) and caps cheap admission work at
a small fixed number of visited items per inspected container. The record must
bind the expensive call count to successful admissions, for example
`calls <= admittedCalls` and `admittedCalls <= featureBearingContainers`, while
the executable evidence command independently asserts the admission-work
budget. This rejects both “10,000 expensive calls with no feature” and the
escape hatch of moving the same cost into a supposedly cheap recursive scan.
In every record, `calls` means invocations of the expensive operation and the
named admission counter means opportunities inspected by the admission.

### Contract kinds: precise vs conservative-filter

The default contract `kind` is `precise`: the admission proves an exact feature
bit. Combined with the audit relation `featureBearing <= calls <= admittedCalls`
and the registry-required `admittedCalls <= featureBearing*`, a precise contract
forces `calls === admittedCalls === featureBearing` and forbids any no-feature
allocation. That fits a presence bit like `hasMergeOutputSurface`, but it cannot
admit a **conservative pre-filter** that legitimately lets a *superset* through
and allocates cheaply to do so.

A `kind: "conservative-filter"` contract declares that instead. It is held to a
different but strictly-as-rigorous bar:

- **Byte-identity is the non-negotiable core.** Both benchmark phases must be
  byte-identical A/Bs (`byteIdentical: true`) *and* render the same output
  (equal `outputSha256` across phases). A filter that changes output is rejected
  outright, and the landing gate re-verifies all-less byte-identity.
- **Superset relation (flipped).** Instead of the precise `admittedCalls <=
  featureBearing*`, it must state `featureBearing* <= admittedCalls`: the filter
  may admit more than the true matches, but it must never admit *fewer* (which
  would mean it dropped a real match). The precise bound is forbidden here.
- **Measured speedup is required.** The `conservativeFilter.speedup` block names
  a governed hot function and a positive `minPercentFaster` on a benchmark phase;
  the audit record's `governedFunction { beforeMs, afterMs }` must beat that
  margin. A filter that is not measurably faster is rejected (no defensive
  slowdown).
- **Bounded allocation is allowed only when the speedup pays for it.** Unlike the
  precise zero-allocation rule, a conservative filter may allocate on the
  no-feature path, but `conservativeFilter.allocation` must acknowledge it and
  the no-feature allocation is excused *only* once the byte-identity + speedup
  proof passes.

This shape cannot launder an uncontracted regular change: it still requires the
cheap admission + enclosing source-check guard, `calls <= admittedCalls`, a
byte-identical two-phase A/B, and a measured governed-function speedup. A change
that alters output, is not faster, or drops a true match cannot honestly satisfy
those, so the only thing the kind relaxes — the no-feature allocation ban — stays
gated behind the proof rather than opened.

The correctness argument for a conservative filter (why it can never reject a
true match) is reviewed as prose in `necessity`, but it is *also* backed by the
byte-identity proof: if the gate ever dropped a real match, the output would
differ and `byteIdentical` would be false.

### Contract kind: redundant-call-elimination

Both `precise` and `conservative-filter` model an admission FILTER — a cheap gate
placed *ahead* of expensive work. Neither can model the third recurring shape the
gate kept blocking: a byte-identical work **REMOVAL** — deleting a call or
computation that is either dead or redundantly recomputed by a later authority.
A removal has no per-container admission, no `admittedCalls` surface, and no
`maxItemsPerContainer` budget, so it never fit the admission schema and was
repeatedly (3rd occurrence) refused despite being a strict improvement.

A `kind: "redundant-call-elimination"` contract declares a removal. It carries no
admission block and no admission/feature counters; instead it is held to four
non-negotiable, self-contained proofs, none of which a cost-ADDING or
output-CHANGING change can honestly produce:

- **Byte-identity (non-negotiable core).** Both benchmark phases must be
  byte-identical A/Bs (`byteIdentical: true`) *and* render the same output
  (equal `outputSha256` across phases). The landing gate re-verifies all-less.
  A removal that changes output is rejected outright.
- **Measured speedup (required).** `redundantCallElimination.speedup` names a
  governed function and a positive `minPercentFaster` on a benchmark phase; the
  audit record's `governedFunction { beforeMs, afterMs }` must beat that margin.
  A removal that isn't faster is pointless and rejected.
- **Net removal (not addition).** The contract must declare the counters
  `callsBefore`, `callsAfter` and the relation `callsAfter <= callsBefore` for
  the eliminated function; the record must reduce work
  (`callsAfter < callsBefore`, or a positive `deletedLineCount` for fully-dead
  code). The admission-filter relation `calls <= admittedCalls` is forbidden — a
  removal removes work, it does not admit it. This is what blocks a cost-ADD from
  wearing this kind: a cost-add's `callsAfter > callsBefore`.
- **Redundancy proof (correctness argument).** `redundancyProof.basis` is either
  `dead` (no consumer) or `covered-by-later-check` (a NAMED later authoritative
  check re-derives and overrides the removed result). The record must restate it.
  A genuine cost-add cannot name an authority that makes its ADDED work redundant.

The danger-token and no-allocation rules are **not** relaxed for this kind (a pure
removal has no reason to allocate): `noFeatureAllocations` must be present and
zero, and any danger token in the diff must still be prosecuted. The only thing
this kind changes is the *shape* of the source-check: because the call is removed
(not gated by a new `if (guard) { … }` enclosure), the guard must instead
short-circuit the same expression as the eliminated call — `guard || call` or
`guard && call` — which the verifier checks structurally.

The first instance is `spine-import-early-admit`: `isSpineEligibleRoot` skips the
speculative `isSpineExtendTopology` topology walk for import trees (via the
`allowImport ||` short-circuit) because `renderRootViaSpine`'s post-wire re-gate
is the sole authority for an import+extend tree and decides byte-identically. A
non-import tree has no re-gate (its invariant re-check throws on a non-foldable
shape), so `allowImport` is false there and the strict topology check still runs —
byte- and cost-identical to before.

### Contract kind: neutral-or-negative (broad auto-pass)

The three kinds above each require a bespoke, per-site admission (or removal)
contract with hand-authored counters, benchmark A/B records, and a source-guard
surface. That ceremony is warranted when a change *adds* cost behind a filter or
*removes* proven-redundant work. But it repeatedly (4th occurrence) blocked a
change that adds **no cost at all** — a byte-identical, danger-token-free
refactor such as a route split, a rename, or an inlined constant — because *any*
edit to a registered hot-path file demands a registry entry, and the only entries
available forced fabricated admission counters that had no honest values.

A `kind: "neutral-or-negative"` contract is the broad auto-pass for exactly that
case. It removes the contract *ceremony* — not any safety check — for a change
that is machine-provably cost-neutral or cost-negative. It carries **no**
admission block, no counters, no benchmark A/B record, no executable-evidence
command, and no source-guard surface. It is admitted when, and only when, all
three of these hold — each machine-checked:

- **Byte-identical.** The `neutralRefactor.byteIdentity` block restates the
  benchmark reference (`fixture: "benchmark.less"`, `collapseNesting: true`,
  `outputSha256`, `outputBytes`); the audit record must restate the same sha/bytes,
  and the landing's benchmark + all-less byte-identity gates re-verify the output
  did not change. An output-changing edit fails these gates.
- **Danger-token-free.** The verifier re-runs its existing danger-token scan over
  the live diff and refuses the auto-pass if it fires. Because new
  allocation / loop / map-set / clone / node-construction / error-control
  constructs ARE the danger tokens, a cost-adding change that reaches for any of
  them is rejected here — the token scan is the gate's standing proxy for
  new cost.
- **Cost-non-increasing.** `costDelta` must be `"neutral"` or `"decrease"`, with a
  one-paragraph `why`. An admitted `"increase"` is rejected outright and must route
  to a precise or conservative-filter contract. Because the token scan already
  forecloses the allocation/traversal dimension of a cost-add, the remaining
  call-count dimension is carried by the `costDelta` attestation and its `why`
  (the same honest-attestation trust model the rest of the self-prosecution uses).

**Adversarial analysis — why a cost-ADD cannot slip through.** A change that adds
real cost cannot honestly take the auto-pass: (a) if it allocates, loops, builds a
map/set, clones, constructs a node, or adds error control, the danger-token scan
fires and the auto-pass is refused; (b) if it changes output, the byte-identity
reference (and the landing's benchmark + all-less gates) reject it; (c) if it admits
more cost, it must declare `costDelta: "increase"`, which the auto-pass forbids —
sending it to the precise / conservative-filter kinds. The residual dimension the
scan cannot see — a token-free *added function call* that is byte-identical yet
raises per-invocation call-count — is (i) exactly the shape a legitimate route
split produces *without* raising call-count (two static call sites, one executed
per invocation, as in `lookup-slice-2-ordinary-read-split`), so it cannot be
statically forbidden without rejecting valid refactors, and (ii) governed by the
`costDelta` attestation + `why`, the same trust boundary as every other prose
justification in this document. This kind therefore **subsumes** the simple case
of redundant-call-elimination (a removal is cost-decreasing + token-free) but the
`redundant-call-elimination` kind is deliberately **left in place** for removals
that want to additionally *prove a measured speedup* — the auto-pass is additive
and weakens nothing.

The first instance is `lookup-slice-2-ordinary-read-split`:
`performVariableRulesLookup` (reference.ts) splits ordinary `@var` reads from
member-descent reads (namespace target / interpolated `@@name` / indexed key) via
an `isOrdinaryVariableRead` branch. Per-route options are identical to the
pre-split single call and depend only on `env.readMode`, so exactly one call runs
per invocation with unchanged arguments — byte-identical, danger-token-free, and
cost-neutral, with no honest admission-counter contract to author.

**Opt-in escape: `allowsProsecutedDangerTokens` for a structural refactor that
owns structure.** The danger-token-free requirement above is exactly right for a
route split or rename, but it is *too strict* for one honest class of change: a
byte-identical **structural refactor where the parser starts owning structure it
previously left the core to re-derive from bytes**. Building the structure
(e.g. a `Sequence` of spanned `Any` tokens where a whitespace-split byte blob used
to be) necessarily introduces node-construction / array / materialization danger
tokens — but those tokens *replace* the `.split`/`.map`/`.join`/`new List`/`new
Any` work they retire, so net cost is equal-or-less. A neutral-or-negative
contract may set `neutralRefactor.allowsProsecutedDangerTokens: true` to admit
those tokens through the auto-pass. This relaxes **nothing** about safety: (a)
byte-identity is still machine-checked against the benchmark reference; (b) the
pass-level per-label prosecution (`- Review-flagged diff tokens:`) still forces
every danger category to be named in `[brackets]`; (c) the audit record must
restate a `dangerTokensJustification` (≥40 chars) explaining why each flagged
construct offsets removed work or sits off the benchmark render path; and (d)
`costDelta` is pinned to exactly `"neutral"` — a `"decrease"` claim beside
newly-added constructs is not honest and is rejected. The escape only lets a
prosecuted, cost-neutral, byte-identical structural refactor take the auto-pass
instead of forcing a speedup contract (`precise` / `conservative-filter` /
`redundant-call-elimination`) that a non-perf change cannot honestly satisfy. The
first instances are the three `atrule-prelude-unknown-tokenstream-*` contracts:
the unknown at-rule prelude becomes a grammar-owned token stream of spanned `Any`
nodes (parser owns structure; core no longer re-derives it from bytes), which is
off the benchmark render path (benchmark.less has no unknown at-rules) and hence
byte-identical.

### Contract kind: off-benchmark-call-reduction

The `precise`, `conservative-filter`, and `redundant-call-elimination` kinds all
require a positive **wall-clock speedup on benchmark.less**. That is the right bar
when the eliminated work is *on* the canonical benchmark. It becomes a blind spot
when a change is a correct, byte-identical work REMOVAL whose benefit is **off**
benchmark.less — the benchmark simply does not exercise the eliminated path, so it
shows no measurable speedup even though real workloads that DO exercise the path get
strictly less work. Blocking such a change is a false negative: the gate would
reject a proven improvement purely because its win does not land on one fixture.

A `kind: "off-benchmark-call-reduction"` contract closes that blind spot. Instead of
a benchmark speedup it proves its benefit as a **measured CALL-COUNT reduction of a
named hot function on a NAMED representative fixture**. It carries no admission block
and no admission/feature counters (like `redundant-call-elimination`), and it is held
to four non-negotiable requirements — schema in `validateOffBenchmarkCallReductionMetadata`
/ `checkOffBenchmarkCallReduction`:

- **`offBenchmarkCallReduction.governedFunction`** — the hot function whose
  invocations are eliminated.
- **`offBenchmarkCallReduction.measuredOn`** — the named representative fixture the
  reduction is measured on. It **must NOT be benchmark.less** (that is the wall-clock
  reference; this kind exists precisely because the benefit is off it). The reduction is
  bound by the declared relation `callsAfter < callsBefore` and re-checked in the
  record.
- **`offBenchmarkCallReduction.boundedTraversal`** — a self-prosecution paragraph
  asserting the ADDED traversal is bounded (a walk over the import fallback-frame
  chain, NOT a new whole-tree / per-node scan). Any new loop / map / set the traversal
  introduces is ALSO a danger token the diff must account for by label, so an
  unbounded traversal cannot hide here.
- **`offBenchmarkCallReduction.benchmarkNonRegression`** — the **hard safety rail**.
  benchmark.less must stay byte-identical AND non-regressing: the record's measured
  median on the declared phase must be within a tight noise cap (0..5%) of the before
  median, *not slower*. This is what prevents admitting a change that is cost-neutral
  off benchmark but a REGRESSION on benchmark.

Acceptance in `checkOffBenchmarkCallReduction` enforces all four on the audit record:
(1) byte-identity — both benchmark phases render equal `outputSha256`, on top of the
per-phase `byteIdentical` A/B the generic validator already enforces; (2) the
benchmark-non-regression rail on the named phase; (3) net removal — `measuredOn`
matches (and is not benchmark.less) and `callsAfter < callsBefore`; (4) the
bounded-traversal disclosure is restated.

**Adversarial analysis** (why this cannot launder a bad change):

- A change that **REGRESSES benchmark** fails the benchmark-non-regression rail
  (`afterMedianMs > beforeMedianMs * (1 + cap%)`). This rail is the whole safety of
  the extension and is not optional.
- An **output-changing** change fails byte-identity — the generic per-phase
  `byteIdentical` check and the `parseRenderSha === renderSha` equality both trip, and
  the landing's benchmark + all-less byte-identity gates re-verify it independently.
- A change that **does not actually reduce calls** fails `callsAfter < callsBefore`
  (both in the declared relation and the record check) — an inert or cost-adding
  change cannot claim a strict reduction.
- An **unbounded new traversal** must be disclosed: its loop/map/set are danger tokens
  the self-prosecution block must account for by label, and the `boundedTraversal`
  paragraph is required. It is not a bounded fallback walk and cannot be dressed as one
  without the disclosure the token scan forces.

The extension is strictly **additive**: the `precise`, `conservative-filter`,
`redundant-call-elimination`, and `neutral-or-negative` kinds, the byte-identity
requirements, and the danger-token accounting are all untouched — a change that CAN
prove a benchmark speedup still routes to the speedup-bearing kinds, and only a
byte-identical, benchmark-non-regressing, genuinely-reducing change qualifies here.

The first instance is `callable-fallback-uncovered-retire`:
`lookupScopeFrameCallable` (scope-frame.ts) walks the import `fallbackFrame` chain so
imported guarded mixins resolve on the frame, retiring the
`findMixinsFastForUncoveredCallable` child-ruleset descent for them. benchmark.less has
no imported guarded mixins (no speedup to show), but on
`packages/jess/benchmark/callable-fallback/main.less` the descent count drops
`6 -> 0`, byte-identically, with benchmark.less non-regressing.

<!-- BEGIN AGGRESSIVE-CUTTING-COST-CONTRACTS -->
```json
[
  {
    "id": "rules-merge-coalescing",
    "surface": "Rules._coalesceMergedDeclarations",
    "files": ["packages/core/src/tree/rules.ts"],
    "coverage": "owner-plus-named-carry-forward-support",
    "supportFiles": [
      "packages/core/src/tree/apply.ts",
      "packages/core/src/tree/at-rule.ts",
      "packages/core/src/tree/call.ts",
      "packages/core/src/tree/control.ts",
      "packages/core/src/tree/import-style.ts",
      "packages/core/src/tree/ruleset.ts",
      "packages/core/src/tree/util/callable-surface.ts"
    ],
    "necessity": {
      "status": "proven",
      "factSource": "Declaration.options.normalizedFromAssign explicitly identifies merge assignments at construction/evaluation boundaries",
      "rediscovery": "The old hasMergeOutputSurface recursively scanned every Rules surface and child Rules node at finish time",
      "carryForward": "Rules.rulesFlags carries one merge-presence bit; constructors, derive, actual insertions, replacements, and destructive-array repair update it",
      "whyNotCarried": "This pass establishes the missing producer-to-consumer carry path; bounded refresh remains only after destructive whole-array rewrites"
    },
    "admission": {
      "predicate": "cheap merge-output-surface presence check",
      "cost": "cheap",
      "counter": "admissionCalls",
      "workCounter": "admissionItemsVisited",
      "maxItemsPerContainer": 8,
      "before": "collection and allocation"
    },
    "counters": [
      "calls",
      "admittedCalls",
      "admissionCalls",
      "admissionItemsVisited",
      "containers",
      "featureBearingContainers",
      "itemsVisited",
      "featureItems",
      "noFeatureAllocations",
      "noFeatureMisses"
    ],
    "commonCaseProof": "counter test and no-merge benchmark workload",
    "benchmark": {
      "fixture": "benchmark.less",
      "phases": ["parse-render", "render"],
      "warmup": 20,
      "pairs": 45
    },
    "relations": [
      "calls <= admittedCalls",
      "admittedCalls <= admissionCalls",
      "admittedCalls <= featureBearingContainers",
      "featureBearingContainers < containers",
      "noFeatureAllocations === 0"
    ],
    "evidence": {
      "command": ["node", "scripts/profile-less-benchmark.mjs", "--assert-merge-contract", "--assert-live-merge-contract"]
    },
    "sourceCheck": {
      "file": "packages/core/src/tree/rules.ts",
      "caller": "_finishSourceOrderEvaluation",
      "call": "_coalesceMergedDeclarations",
      "guard": "hasMergeOutputSurface",
      "profile": ["MERGE_PROFILE_COUNTERS_KEY", "recordMergeProfile"]
    }
  },
  {
    "id": "serialize-helper-duplicate-declaration-prescan",
    "surface": "serializeRulesContainerInternal duplicate-property pre-scan",
    "files": ["packages/core/src/tree/util/serialize-helper.ts"],
    "necessity": {
      "status": "proven",
      "factSource": "declaration names and merge/output metadata are already present on child nodes",
      "rediscovery": "serializeRulesContainerInternal pre-scans a container before duplicate-property preparation",
      "carryForward": "adoption or declaration registration can carry stable singleton and duplicate facts",
      "whyNotCarried": "The current allocation cut has not yet proven the remaining pre-scan is semantically unavoidable"
    },
    "admission": {
      "predicate": "stable singleton node shape check",
      "cost": "cheap",
      "counter": "admissionCalls",
      "workCounter": "admissionItemsVisited",
      "maxItemsPerContainer": 4,
      "before": "collection and allocation"
    },
    "counters": [
      "calls",
      "admittedCalls",
      "admissionCalls",
      "admissionItemsVisited",
      "containers",
      "featureBearingContainers",
      "itemsVisited",
      "featureItems",
      "noFeatureAllocations",
      "noFeatureMisses"
    ],
    "commonCaseProof": "benchmark and duplicate-declaration counter probe",
    "benchmark": {
      "fixture": "benchmark.less",
      "phases": ["parse-render", "render"],
      "warmup": 20,
      "pairs": 45
    },
    "relations": [
      "calls <= admittedCalls",
      "admittedCalls <= admissionCalls",
      "admittedCalls <= featureBearingContainers",
      "featureBearingContainers < containers",
      "noFeatureAllocations === 0"
    ],
    "evidence": {
      "command": ["node", "scripts/profile-less-benchmark.mjs", "--assert-duplicate-contract"]
    },
    "sourceCheck": {
      "file": "packages/core/src/tree/util/serialize-helper.ts",
      "caller": "function serializeRulesContainerInternal",
      "call": "recomputeDeclCounts();",
      "guard": "skipInitialDuplicateDeclarationScan"
    }
  },
  {
    "id": "extend-keyset-pre-reject",
    "kind": "conservative-filter",
    "surface": "classifyInstructionMatch keyset pre-reject (targetCanPossiblyMatch)",
    "files": ["packages/core/src/tree/util/extend-roots.ts"],
    "necessity": {
      "status": "proven",
      "factSource": "The selector keyset library (requiredKeySetOf/visibleKeySetOf/keySetOf over context.selectorBits) already carries each selector's simple-key membership from parse/adoption.",
      "rediscovery": "classifyInstructionMatch ran the full speculative classifyExtendMatch/applyExtendsToSelector machinery for every (selector x extend) probe, ~37.9k of which can never match.",
      "carryForward": "The keyset bitsets are the carried fact; the gate reads them and unions candidate+parent key-space before any classify/apply work.",
      "whyNotCarried": "The match core already trusts the same required-subset relation deeper in tryExtendSelector; this hoists that guaranteed-false decision ahead of the expensive setup instead of rediscovering non-matches by executing it."
    },
    "admission": {
      "predicate": "targetCanPossiblyMatch keyset subset/disjoint gate",
      "cost": "cheap",
      "counter": "admissionCalls",
      "workCounter": "admissionItemsVisited",
      "maxItemsPerContainer": 8,
      "before": "collection and allocation"
    },
    "conservativeFilter": {
      "supersetOf": "featureBearingCalls",
      "governedFunction": "processExtends",
      "speedup": { "phase": "render", "minPercentFaster": 20 },
      "allocation": { "onNoFeaturePath": true, "justifiedBy": "net-speedup" }
    },
    "counters": [
      "calls",
      "admittedCalls",
      "admissionCalls",
      "admissionItemsVisited",
      "itemsVisited",
      "featureBearingCalls",
      "noFeatureAllocations",
      "noFeatureMisses"
    ],
    "commonCaseProof": "benchmark.less counter test: 37,973 admission checks, 86 admitted, 44 feature-bearing (admitted superset of matches)",
    "benchmark": {
      "fixture": "benchmark.less",
      "phases": ["parse-render", "render"],
      "warmup": 20,
      "pairs": 45
    },
    "relations": [
      "calls <= admittedCalls",
      "featureBearingCalls <= admittedCalls"
    ],
    "evidence": {
      "command": ["node", "scripts/profile-less-benchmark.mjs", "--fixture=packages/jess/benchmark/benchmark.less", "--assert-extend-filter-contract"]
    },
    "sourceCheck": {
      "file": "packages/core/src/tree/util/extend-roots.ts",
      "caller": "function classifyInstructionMatch",
      "call": "applyExtendsToSelector",
      "guard": "targetCanPossiblyMatch",
      "profile": ["recordExtendProfile", "EXTEND_PROFILE_COUNTERS_KEY", "extendProfileNow", "requiredKeySetOf", "isDisjoint"]
    }
  },
  {
    "id": "extend-chained-discovery-deferral",
    "kind": "precise",
    "surface": "applyExtendsToSelector chained-discovery lazy init (chain())",
    "files": ["packages/core/src/tree/util/extend.ts"],
    "necessity": {
      "status": "proven",
      "factSource": "The chained-discovery inputs (subtree values, expanded allExtends, tuple map, target index) are pure functions of the immutable pass inputs (originalSelector, allExtends).",
      "rediscovery": "applyExtendsToSelector built all four eagerly on every invocation, the overwhelming majority of which apply no selector-changing extend and never consult them.",
      "carryForward": "A single memoized initializer (chain()) computes them on first post-change use; identical values, computed lazily.",
      "whyNotCarried": "They depend on the per-call originalSelector and cannot be hoisted out of the call; the leanest carry is the in-call memo that skips the build entirely on the no-change path."
    },
    "admission": {
      "predicate": "afterValue !== beforeValue post-change gate before chain() consult",
      "cost": "cheap",
      "counter": "admissionCalls",
      "workCounter": "admissionItemsVisited",
      "maxItemsPerContainer": 8,
      "before": "collection and allocation"
    },
    "counters": [
      "calls",
      "admittedCalls",
      "admissionCalls",
      "admissionItemsVisited",
      "itemsVisited",
      "featureBearingContainers",
      "noFeatureAllocations",
      "noFeatureMisses"
    ],
    "commonCaseProof": "benchmark.less counter test: 116 invocations, 43 build the chain (feature-bearing), 0 no-feature allocations",
    "benchmark": {
      "fixture": "benchmark.less",
      "phases": ["parse-render", "render"],
      "warmup": 20,
      "pairs": 45
    },
    "relations": [
      "calls <= admittedCalls",
      "admittedCalls <= featureBearingContainers"
    ],
    "evidence": {
      "command": ["node", "scripts/profile-less-benchmark.mjs", "--fixture=packages/jess/benchmark/benchmark.less", "--assert-extend-defer-contract"]
    },
    "sourceCheck": {
      "file": "packages/core/src/tree/util/extend.ts",
      "caller": "export function applyExtendsToSelector",
      "call": "collectSelectorSubtreeValues",
      "guard": "!chainMemo",
      "profile": ["recordExtendProfile", "extendTargetIndex", "originalSelectorValues", "allExtendTuples", "expandedAllExtends", "buildExtendTargetIndex"]
    }
  },
  {
    "id": "spine-import-early-admit",
    "kind": "redundant-call-elimination",
    "surface": "isSpineEligibleRoot speculative extend-topology early-admit (import trees)",
    "files": ["packages/core/src/tree/util/emit-walk.ts"],
    "necessity": {
      "status": "proven",
      "factSource": "For an import tree, renderRootViaSpine's post-wire re-gate (isSpineExtendTopology over importedRootSubjects) is the sole authority on spine-vs-eval and aborts to eval byte-identically; the speculative isSpineEligibleRoot verdict is discarded/overridden.",
      "rediscovery": "isSpineEligibleRoot ran the full O(targets x tree) isSpineExtendTopology speculative walk for every import root, whose verdict the post-wire re-gate then recomputes and overrides.",
      "carryForward": "No fact is carried forward; the speculative call is removed for import trees via the allowImport short-circuit and the authoritative re-gate decides after imports resolve.",
      "whyNotCarried": "The import-tree topology cannot be decided before imports resolve, so the sync speculative walk is pure discarded work; the leanest path is to not run it and let the post-wire re-gate rule."
    },
    "redundantCallElimination": {
      "governedFunction": "isSpineExtendTopology",
      "eliminatedSite": "isSpineEligibleRoot",
      "speedup": { "phase": "render", "minPercentFaster": 3 },
      "redundancyProof": {
        "basis": "covered-by-later-check",
        "authority": "renderRootViaSpine post-wire re-gate isSpineExtendTopology(root, ..., { importedRootSubjects }) at emit-walk.ts ~line 2603, which aborts to eval byte-identically when the resolved shape is not foldable; the non-import invariant re-check (~line 2373) is intentionally SKIPPED for import trees, so removing the speculative call loses no guard."
      }
    },
    "counters": ["callsBefore", "callsAfter", "noFeatureAllocations"],
    "commonCaseProof": "benchmark.less counter test: earlyAdmit.importTopologyEliminated = 1 topology call eliminated per render at the import root, byte-identical output (sha 98a0536086c7e555)",
    "benchmark": {
      "fixture": "benchmark.less",
      "phases": ["parse-render", "render"],
      "warmup": 20,
      "pairs": 45
    },
    "relations": [
      "callsAfter <= callsBefore"
    ],
    "evidence": {
      "command": ["node", "scripts/profile-less-benchmark.mjs", "--fixture=packages/jess/benchmark/benchmark.less", "--assert-early-admit-contract", "--expect-sha=98a0536086c7e555b1a98e2372ad4000d51e25f1418c6345b6b8a9a97d80972f"]
    },
    "sourceCheck": {
      "file": "packages/core/src/tree/util/emit-walk.ts",
      "caller": "export function isSpineEligibleRoot",
      "call": "isSpineExtendTopology",
      "guard": "allowImport",
      "profile": ["SPINE_PROFILE_COUNTERS_KEY", "recordSpineProfile", "earlyAdmit.importTopologyEliminated"]
    }
  },
  {
    "id": "lookup-slice-2-ordinary-read-split",
    "kind": "neutral-or-negative",
    "surface": "performVariableRulesLookup ordinary-@var vs member-descent route split (reference.ts)",
    "files": ["packages/core/src/tree/reference.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "Pure route split: performVariableRulesLookup now branches on isOrdinaryVariableRead (plain string key, no namespace target, no interpolation) to send ordinary `@var` reads down the covered-frame probe + declaration-crawl route and member-descent reads (namespace target / interpolated @@name / indexed key) down the shared member route. The per-route options passed to findVariableDeclarationOccurrence are identical to the pre-split single call and depend only on env.readMode, so exactly one call runs per invocation with the same arguments as before — no new allocation, traversal, map/set, or node construction. Output is byte-identical (benchmark reference sha unchanged).",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "98a0536086c7e555b1a98e2372ad4000d51e25f1418c6345b6b8a9a97d80972f",
        "outputBytes": 131578
      }
    }
  },
  {
    "id": "callable-fallback-uncovered-retire",
    "kind": "off-benchmark-call-reduction",
    "surface": "lookupScopeFrameCallable import fallback-frame-chain traversal (scope-frame.ts)",
    "files": ["packages/core/src/tree/scope-frame.ts"],
    "coverage": "owner-plus-named-carry-forward-support",
    "supportFiles": ["packages/core/src/tree/rules.ts"],
    "necessity": {
      "status": "proven",
      "factSource": "A frame whose only obstruction is an imported child surface already carries its import origin as the fallbackFrame chain; imported guarded mixins resolve authoritatively on those frames once their callable coverage is prepared.",
      "rediscovery": "lookupScopeFrameCallable stopped at the first 'child-surface'/'reference-import' uncovered frame and handed off to findMixinsFastForUncoveredCallable, which re-descended the child ruleset surface for imported guarded mixins the fallback chain could have answered directly.",
      "carryForward": "No new fact is carried; the existing fallbackFrame links are walked (with a Rules-side prepareFrame hook to materialize per-frame callable coverage), retiring the uncovered descent for imported guarded mixins.",
      "whyNotCarried": "The import origin frames already exist on the fallback chain; the leanest path is to traverse them under the same visibility rules rather than rediscover the callable by re-scanning child rulesets."
    },
    "offBenchmarkCallReduction": {
      "governedFunction": "findMixinsFastForUncoveredCallable",
      "measuredOn": "packages/jess/benchmark/callable-fallback/main.less",
      "boundedTraversal": "The added traversal is walkFallbackCallable: a single acyclic walk over the frame's fallbackFrame (import) chain, visited-guarded against cycles, entered ONLY when a frame's uncovered reason is 'child-surface' or 'reference-import' and it has a fallbackFrame. It is bounded by the import-chain depth (typically 1) — NOT a whole-tree or per-node scan — and it REPLACES the heavier findMixinsFastForUncoveredCallable child-ruleset descent it retires, so it is net-negative work on the affected path.",
      "benchmarkNonRegression": { "phase": "render", "maxPercentSlower": 3 }
    },
    "counters": ["callsBefore", "callsAfter"],
    "commonCaseProof": "callable-fallback fixture counter test: findMixinsFastForUncoveredCallable total 6 -> 0 (.configured-guarded 2 -> 0, .sized-guarded 2 -> 0, .plain-surface 2 -> 0) on packages/jess/benchmark/callable-fallback/main.less, byte-identical (fixture reference sha ff73511c0756ecb6). benchmark.less canonical output stays byte-identical (98a0536086c7e555) and non-regressing.",
    "benchmark": {
      "fixture": "benchmark.less",
      "phases": ["parse-render", "render"],
      "warmup": 20,
      "pairs": 45
    },
    "relations": [
      "callsAfter < callsBefore"
    ],
    "evidence": {
      "command": ["node", "scripts/profile-less-benchmark.mjs", "--fixture=packages/jess/benchmark/callable-fallback/main.less", "--assert-callable-fallback-contract", "--expect-sha=ff73511c0756ecb623aef56a41306800c9de947cb29bb343a0f1627dc928454b"]
    },
    "sourceCheck": {
      "file": "packages/core/src/tree/scope-frame.ts",
      "caller": "export function lookupScopeFrameCallable",
      "call": "walkFallbackCallable",
      "guard": "result.reason === 'child-surface'"
    }
  },
  {
    "id": "atrule-prelude-unknown-tokenstream-builders",
    "kind": "neutral-or-negative",
    "surface": "_buildUnknownAtRuleBlock unknown at-rule prelude token-stream assembly (builders.ts)",
    "files": ["packages/css-parser/src/builders.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "allowsProsecutedDangerTokens": true,
      "why": "Byte-identical structural refactor — the unknown at-rule prelude is now built by the grammar as a token stream of spanned Any nodes instead of a whitespace-split byte blob. _buildUnknownAtRuleBlock collects the already-built Any nodes between the name and `{` and wraps 2+ of them in a Sequence, REPLACING the prior `.split`/`.map`/`.join`/`preludeSource.includes`/`new Any`/`new List` byte re-derivation, so net allocation is equal-or-less. benchmark.less has no unknown at-rules, so this builder path is never reached and render output is byte-identical (reference sha/bytes unchanged).",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "atrule-prelude-unknown-tokenstream-grammar",
    "kind": "neutral-or-negative",
    "surface": "UnknownAtRuleBlock atTokenStream verbatim per-token prelude scan (grammar.ts)",
    "files": ["packages/css-parser/src/grammar.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "allowsProsecutedDangerTokens": true,
      "why": "Byte-identical structural refactor — UnknownAtRuleBlock now consumes its prelude via atTokenStream (a `many` of verbatim per-token `node('Any', scanTo(...))` runs plus comma tokens) instead of one opaque atPrelude scanTo leaf, so the grammar OWNS the prelude structure as spanned Any nodes rather than the core re-deriving it from bytes. The scan uses the same balanced()/string skip machinery the old atPreludeScan used. benchmark.less has no unknown at-rules, so the changed alternative is never entered and render output is byte-identical (reference sha/bytes unchanged).",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "css-atrule-prelude-lossless-segments",
    "kind": "neutral-or-negative",
    "surface": "AtRulePreludeSegments direct-only lossless header grammar (grammar.ts)",
    "files": ["packages/css-parser/src/grammar.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "The new header-segment rule is exported for a future direct AST reduction but is unattached from Stylesheet, AtRuleBlock, and the legacy builder path. Normal CSS parsing therefore does not enter it or allocate segment nodes. Its only work is on the explicit direct-CST entry, where it replaces any future source split with typed whitespace, comment, comma, group, quoted, and text segments.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "atrule-prelude-unknown-tokenstream-sequence",
    "kind": "neutral-or-negative",
    "surface": "emitDirectSeparator leading-comma-token space suppression (sequence.ts)",
    "files": ["packages/core/src/tree/sequence.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "allowsProsecutedDangerTokens": true,
      "why": "Byte-identical structural refactor — emitDirectSeparator adds one allocation-free branch (isLeadingCommaToken: a type check plus a valueOf compare) so a comma token carried as its own Sequence member does not get a spurious leading space, matching List's emitListSeparator canonical `foo, bar`. The guard only fires for a bare comma Any member, which is produced solely by the new unknown-at-rule prelude token stream; benchmark.less Sequences carry no comma-Any members, so the branch is always false there and render output is byte-identical (reference sha/bytes unchanged).",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "opaque-atrule-block-vocabulary",
    "kind": "neutral-or-negative",
    "surface": "OpaqueAtRuleBlock terminal AST vocabulary (at-rule.ts)",
    "files": ["packages/core/src/ast/at-rule.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "OpaqueAtRuleBlock is a cold parser-produced vocabulary shape. Its rawBody is a scalar string, not a statement array, so construction adds no traversal or runtime state and ordinary benchmark documents do not create it. The dedicated factory is a public construction convenience only; parser reductions continue to emit literals directly.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "opaque-atrule-block-node-union",
    "kind": "neutral-or-negative",
    "surface": "OpaqueAtRuleBlock discriminant membership (node.ts)",
    "files": ["packages/core/src/ast/node.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "The new discriminant extends static AST typing and the existing membership set only. isNode still makes one Set membership check per call, and ordinary benchmark documents never carry the new type, so no added traversal, allocation, or serializer work occurs on the normal render path.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "opaque-atrule-block-statement-union",
    "kind": "neutral-or-negative",
    "surface": "OpaqueAtRuleBlock statement-union membership (nodes.ts)",
    "files": ["packages/core/src/ast/nodes.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "This is a type-only extension of the canonical Statement union. It emits no JavaScript branch, allocation, lookup, or traversal, and it gives parsers a structurally explicit terminal statement instead of a false child-body relationship.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "opaque-atrule-block-terminal-emit",
    "kind": "neutral-or-negative",
    "surface": "emitOpaqueAtRuleBlock terminal serializer write (serialize.ts)",
    "files": ["packages/core/src/ast/serialize.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "The serializer adds a single type-dispatch branch reached only for OpaqueAtRuleBlock. Its writer appends name, optional prelude, rawBody, and braces directly; it allocates no child collection and never calls evaluation or recursively walks rawBody. Ordinary benchmark documents contain no such node, leaving their route unchanged.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  }
]
```
<!-- END AGGRESSIVE-CUTTING-COST-CONTRACTS -->

The matching handoff shape is:

Executable evidence is build-freshness gated. A staged pre-commit review may
run the static contract, source-surface, and danger-token checks with
`--skip-executable-evidence`, because generated `lib/` output can still belong
to the previous source revision. The upstream/pre-push check must run the
affected baseline/runtime dependency builds first and then invoke the verifier
without that flag;
otherwise a profile result is not admissible evidence.

````md
- Hot-path cost contracts:
```json
[
  {
    "id": "rules-merge-coalescing",
    "admission": {
      "predicate": "hasMergeOutputSurface(rules)",
      "cost": "cheap",
      "before": "collection and allocation"
    },
    "calls": 15,
    "admittedCalls": 15,
    "containers": 10420,
    "featureBearingContainers": 15,
    "itemsVisited": 16730,
    "featureItems": 27,
    "noFeatureAllocations": 0,
    "noFeatureMisses": 10405,
    "benchmark": {
      "fixture": "benchmark.less",
      "warmup": 20,
      "pairs": 45,
      "parse-render": {
        "beforeMedianMs": 217.235,
        "afterMedianMs": 217.779,
        "medianDeltaMs": 0.456,
        "wins": 17,
        "byteIdentical": true,
        "outputBytes": 133983,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840"
      },
      "render": {
        "beforeMedianMs": 184.05,
        "afterMedianMs": 183.90,
        "medianDeltaMs": 0.74,
        "wins": 16,
        "byteIdentical": true,
        "outputBytes": 133983,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840"
      }
    },
    "commonCaseProof": "counter test: 10,420 admission checks, 15 admitted/coalescer calls",
    "verdict": "accepted"
  }
]
```
````

The example counts are illustrative only. Real records must come from the
focused profile or counter test for the current pass. An unguarded pass must be
reverted; it cannot remain in a changed production file under a
`rejected`/`deferred` label.

Run:

```sh
pnpm run verify:aggressive-cutting-review
```

The script scans the current diff for danger tokens and checks that the handoff
contains the self-prosecution block. The script cannot decide architecture; it
exists to make the agent stop and prosecute its own diff before committing.
Because it is diff-scoped, it is not proof that an accumulated class shape is
healthy. When live code evidence shows an already-large node is carrying too
much machinery, update the owning focus tracker with that cumulative audit even
if the script exits successfully.
