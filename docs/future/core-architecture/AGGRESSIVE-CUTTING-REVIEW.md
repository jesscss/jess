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
- `FOCII.md` owns goal-settable focus prompts, boundaries, and stop rules.
- Focus trackers own active queues and completion gates.
- `PERFORMANCE-HANDOFF.md` owns benchmark/profile protocol and performance
  evidence.
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
