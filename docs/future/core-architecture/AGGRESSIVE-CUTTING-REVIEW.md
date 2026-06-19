# Aggressive Cutting Review

This is the repo-local guardrail for Jess core architecture queue passes. It is
not a performance benchmark. It is a refusal checklist for accidental machinery.

Use it before committing changes that touch AST nodes, eval/render, lookup,
copying, inheritance, traversal, source/root metadata, output writing, the
core architecture router, or the focus document.

This is one of the core-architecture coordination docs:

- `HANDOFF.md` is the short router.
- `FOCII.md` owns goal-settable focus prompts, boundaries, and stop rules.
- Focus trackers own active queues and completion gates.
- `PERFORMANCE-HANDOFF.md` owns benchmark/profile protocol and performance
  evidence.
- This file owns patch-shape review: whether a proposed edit adds machinery,
  materialization, traversal, metadata mutation, or helper/API surface that the
  hot path should not pay for.

When performance work is active, this checklist still applies. A benchmark may
choose the target, but it does not excuse adding generic copy/traversal/helper
machinery unless the measured runtime result and semantic boundary justify it.

Deep child copies are forbidden as an eval/render/callable ownership tool.
The only allowed boundaries are narrowly scoped selector subset copies for Less
extend behavior, as a last resort after source-backed selector state has been
rejected, and materializing live binding/rules values for third-party
JavaScript function interop. Repeated mixin/callable evaluation must run from
the canonical source tree with live binding and placement state, not cloned
bodies.

`Node.sourceParent` is canonical source ancestry. Do not use it as runtime
placement state, callable output ownership, scope-frame state, or render
indentation state. Normal eval/render/callable/lookup code must not rewrite it;
a node gets `sourceParent` only when canonical construction/adoption first owns
that child, or when a documented cold materialization boundary creates new
public nodes. Materialization may stamp ancestry once; it should not leave that
ancestry mutable. Rewriting an established `sourceParent` is presumed a bug.
`inherit()` and other generic replacement helpers must not copy source ancestry,
and new hot-path
`.inherit(...)` calls are rejected unless they replace larger machinery without
moving ownership/placement/source ancestry. `inherit()` also must not call
adoption as an indirect source-parent rewrite; carry selector/keyset/source-root
metadata separately from canonical child ownership. Existing frequent
`.inherit(...)` call volume is not acceptable merely because source ancestry is
now immutable; audit hot-path uses until they are deleted, replaced with narrow
metadata transfer, or isolated behind a documented cold materialization
boundary.

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

1. No new traversal unless it deletes worse traversal.
   Added loops, recursion, `map/filter/sort`, parent walks, source walks,
   generators, side-map lookups, or object/array scans must explain why the fact
   could not be carried by parser/adoption/eval state already on the path.
2. No new node creation without a named ownership boundary.
   Classify every `new Node`, copy, `.inherit`, `.adopt`,
   `copyWithReusableLeaves`, wrapper `Rules`, materialized array, `frozen`, or
   parent/source metadata mutation.
   Deep child copies are rejected outright outside last-resort extend selector
   subset handling and third-party JavaScript interop materialization. Do not
   accept `Reflect.construct`, generic recursive value copying, spread-cloned
   node value objects, or callable body copies as internal ownership
   boundaries.
3. Render means stringify.
   Resolving into nodes or arrays just to render is suspect by default.
4. No helper growth.
   A helper must delete more hot-path function/API surface than it adds.
5. No metadata mutation as convenience tax.
   Parent restoration, `sourceParent` writes, frozen/source/location
   inheritance, lazy context/options, `Reflect.*`, `Object.hasOwn`, and
   structural probes are guilty until proven necessary.
   Runtime `sourceParent` rewrites and routine `.inherit(...)` stamping are not
   valid placement/scope mechanisms.
6. Evidence before performance claims.
   Tests and code-path evidence can prove "less wrong machinery." Only profiles
   or benchmarks can prove "faster."

## Ownership Classifications

- `render-only`: rejected unless impossible to stringify directly.
- `eval-to-immediate-string`: rejected.
- `public materialization`: allowed only on a cold public path.
- `semantic placement state`: allowed when canonical source references cannot
  represent the behavior.
- `construction/adoption flag`: allowed when it removes later rediscovery.
- `deep child copy`: rejected except for last-resort Less extend selector subset
  copies or third-party JavaScript interop materialization, both isolated from
  callable/eval/render ownership.

## Required Self-Prosecution Block

Each queue pass must update `docs/future/core-architecture/HANDOFF.md` with:

```md
## Aggressive Cutting Self-Prosecution

- New traversal:
- New node/materialization:
- Render path:
- Helper/API surface:
- Metadata mutations:
- Evidence:
- Verdict:
```

Every bullet must name exact files/functions or say `none`. `Verdict` must be
one of:

- `accepted`: the pass deletes machinery or carries state earlier;
- `rejected`: the proposed change added unjustified machinery and was reverted;
- `deferred`: the pass found a real target but needs tests/profile evidence.

## Local Check

Run:

```sh
pnpm run verify:aggressive-cutting-review
```

The script scans the current diff for danger tokens and checks that the handoff
contains the self-prosecution block. The script cannot decide architecture; it
exists to make the agent stop and prosecute its own diff before committing.
