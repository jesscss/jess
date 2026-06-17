# Core Architecture Handoff

This is the stable router for Jess core architecture work. Keep it short: it
tells the next agent where to choose a focus, how to complete a pass, and where
progress is tracked. Do not rewrite this file just to switch focus; set the
chat/Guildhall goal from `FOCII.md` instead.

## Focus Router

Choose exactly one active focus before editing. If the user names a focus,
follow that. If the request is ambiguous, infer from the branch and latest user
instruction, then record the chosen focus in the final response instead of
changing this router. Use `FOCII.md` for the goal prompt, boundaries, stop rule,
and required docs.

- **Binding / lookup:** use `BINDING-LOOKUP-REMAINING.md` for the active queue,
  remaining scope, progress notes, and completion gates. Use
  `BINDING-INDEX-PROPOSAL.md` for design intent. This stream owns registryless
  lookup, direct crawl/frame lookup, reference handles, live/current binding,
  fallback bridge deletion, and lookup profiles.
- **Serialization / `writeSyntax`:** use `NODE-REWRITE-TRACKER.md` for the
  active node-family queue, historical row status, serialization contracts, and
  completion gates. This stream owns direct syntax/render emission, cold public
  string wrappers, render readback removal, and node-family row closure.
- **Performance evidence:** use `PERFORMANCE-HANDOFF.md` for benchmark
  protocol, profile history, rejected experiments, and speed claims.
- **Patch-shape review:** use `AGGRESSIVE-CUTTING-REVIEW.md` before changing
  AST, eval/render, lookup, traversal, copying, inheritance, output writer,
  source/root metadata, or this router.

## Shared Direction

The fastest credible runtime path remains:

- one canonical source tree;
- direct eval/render-to-string for normal output;
- live lookup/binding/placement state instead of routine copied eval trees;
- cold materialization only for public APIs or real semantic ownership
  boundaries;
- fewer hot-path objects, arrays, recursive walks, helper calls, branch ladders,
  promise/generator states, and metadata mutations.

Less is the optimizing path. Preserve SCSS-enabling seams only when they are
concrete and cheap or isolated behind cold extension boundaries.

Do not preserve an unreleased or self-invented public-looking method for
compatibility alone. If repo usage does not need it and the user has not
approved it as API, delete or reshape it.

## Completion Rules

When the user says `continue`, `do all queue items`, `complete the queue`, or
`full queue pass`, run an autonomous focus pass:

1. Snapshot `git status --short --branch`.
2. Read this router, `FOCII.md`, and the chosen focus tracker.
3. State one hypothesis before editing.
4. Work through the active queue as a swath, not one micro-edit.
5. Keep moving until the queue is drained, the next item has materially
   different semantics, the next step needs user/product judgment, evidence
   rejects the approach, or a failing test/debugging thread needs focused
   investigation.
6. Use focused tests while iterating; run full gates at the coherent batch
   boundary.
7. Update the chosen focus tracker with only facts that change the next
   worker's decisions.
8. Update `Aggressive Cutting Self-Prosecution` below for the latest pass.
9. Commit and push the batch with `--no-verify` when the pass is complete.

A queue item must be a whole task with its own proof surface. It may contain
several sub-tasks, helper deletions, rejected cuts, and tests. Do not create or
mark complete one-line queue items. If an active queue item remains unfinished
at wrap-up, record in the focus tracker and final response which item remains,
what blocked immediate continuation, and why stopping was necessary.

Each active focus tracker should keep at least 15 unchecked sizable tasks
available unless that focus is genuinely within 15 tasks of completion.
Reseeding the next queue is closeout work, not a queue item. Completed history
belongs in git, focused tracker rows, or `PERFORMANCE-HANDOFF.md`, not in this
router.

Use sub-agents when available for disjoint evidence or implementation slices.
Good assignments include one node-family row, one lookup family, focused test
surface discovery, profile/call-stack audits, or review against the aggressive
cutting rules. Workers must not make overlapping edits, revert unrelated work,
commit independently, or change the selected focus. The main agent owns
integration, verification, docs, commit, push, and continuation.

## Gate Rules

Always run the smallest relevant test first. Before commit, run:

```sh
git diff --check
pnpm run verify:aggressive-cutting-review
```

Then run the chosen focus gates from its tracker. Use
`PERFORMANCE-HANDOFF.md` before making any speed claim. Use
`pnpm run verify:baseline -- --changed` when the touched area needs a broader
fixture gate. The current hook path has previously looped, so commit and push
with `--no-verify` after the explicit gates pass.

## Aggressive Cutting Self-Prosecution

- Latest pass: setDefined readonly result-object deletion.
- Verdict: accepted as a cold fallback API-shape cut with behavior proof. No
  speed claim.
- New traversal: none. The setDefined fallback still uses the existing direct
  declaration lookup traversal; it now applies the matched occurrence through a
  setDefined-only callback instead of returning a general
  `{ occurrence, readonly }` result object. Ordinary occurrence helpers remain
  branch-free and return `DirectDeclarationOccurrence | undefined`.
- New node/materialization: none. The diff re-indents the existing
  non-variable setDefined fallback that derives/adopts a declaration after a
  found property declaration; that cold fallback behavior is unchanged and is
  not used by ordinary reference reads.
- Render path: no committed render/stringification path change.
- Helper/API surface: replaced `findSetDefinedDeclarationReadonlyOccurrence`
  with `applySetDefinedDeclarationReadonlyOccurrence(...)` and removed the
  internal readonly-result overload/type. No exported/public `Rules.find*`
  surface was preserved for hot-path compatibility; production callers still
  use occurrence helpers directly.
- Metadata mutations: no new metadata mutation. The existing
  `foundRules.adopt(newDeclaration)` fallback remains only in the non-variable
  setDefined insertion path.
- Allocation changes: setDefined fallback no longer allocates or returns the
  `{ occurrence, readonly }` wrapper. It still allocates a cold callback closure
  at the assignment call site; the tracker records that as a follow-up only if
  the helper can own the full mutation without moving assignment semantics into
  ordinary lookup.
- Rejected/observed in this pass: public `Rules.findVariable` /
  `findProperty` / `findDeclaration` / `findAnyDeclaration` wrappers are now
  test/cold-only by repo search, but not deleted in this batch because parser
  and test helper call sites still need conversion or an explicit cold-facade
  decision.
- Evidence: focused setDefined tests in `reference.test.ts`, `rules.test.ts`,
  `mixin.test.ts`, and `control.test.ts` passed. `verify:binding-lookup-hot-paths`
  now requires the apply helper, forbids the old readonly occurrence helper and
  `DirectDeclarationLookupResult`, and still guards production runtime against
  public `Rules.find*` declaration wrappers. Final gates are required before
  commit. No speed claim.
- Merge note: the branch also incorporates the latest serialization transport
  work from `origin/dev`; keep that progress tracked in
  `NODE-REWRITE-TRACKER.md` so this handoff remains the binding/lookup router.
