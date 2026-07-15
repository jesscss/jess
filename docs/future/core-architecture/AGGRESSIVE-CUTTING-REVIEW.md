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
      "status": "audit-required",
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
