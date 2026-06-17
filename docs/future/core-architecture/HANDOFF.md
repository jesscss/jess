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

- Latest pass: Call empty string-name render fast path in
  `packages/core/src/tree/call.ts`.
- Verdict: accepted as a localized empty-call writer readback cut. No speed
  claim.
- New traversal: none.
- New node/materialization: none.
- Render path: empty string-name CSS calls without args/content now write and
  return their known `name?() !important` text directly, matching the existing
  source-string fast path instead of opening a whole-call writer
  mark/readback. Empty/undefined argument lists also return before preparing a
  print state or mark window.
- Helper/API surface: none.
- Metadata mutations: none.
- Allocation changes: removes the empty-call render mark/readback window and
  the empty-arg `getPrintOptions(...)`/mark setup.
- Rejected/observed in this pass: broader Call argument serializer inlining was
  rejected because the current focused arg-streaming tests still expose muddy
  pre-existing mark/readback expectations; non-scalar/custom/trivia arg trim
  marks, async/helper ladders, `evalArgNodes(...)` copy pressure, and callable
  output value selection remain open in the Call row.
- Merge-carried binding review: merging `origin/dev` also brought the
  namespaced reference-import crawl deletion in `rules.ts` plus focused
  import/mixin tests. Its new loops walk existing scope-frame, prefix-match,
  and direct-child-entry state to prove covered namespace uncertainty; the
  `Parser` construction, `try/finally`, and small spy arrays are test-only
  proof scaffolding from `import-style.test.ts` / `mixin.test.ts`, not
  production render/string transport.
- Evidence: full `rules.test.ts` passed and targeted ESLint for `rules.ts`
  passed. Full gates are required before commit.
- Merge-carried binding review: merging `origin/dev` also brought the
  source-static reference handle early-read pass and binding tracker updates.
  It is lookup-only: no render/stringification path changed, no runtime node
  materialization was added, and its new helper reads already-stored lookup
  handle state under narrow guards. The review-flagged
  `for (const read of reads)` loop and JS-function fixture construction are
  test-only coverage for source-static reference handle families. The flagged
  `RulesLookupHandleShape` object is incoming private lookup state created
  only after an existing handle passes those guards; it is not render/string
  transport. Detailed binding status remains in `BINDING-LOOKUP-REMAINING.md`;
  this serialization pass keeps `NODE-REWRITE-TRACKER.md` as the active queue.
