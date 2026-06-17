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

- Latest pass: `Interpolated` public string transport cut in
  `packages/core/src/tree/interpolated.ts`.
- Verdict: accepted as a focused serialization transport cut. No speed claim.
- New traversal: two bounded string scans: `replace(...)` now uses a
  placeholder `while` loop instead of regex callback replacement, and
  `createSimpleInterpolatedSelector(...)` uses a straight character scan
  instead of regex `match(...)` plus a token array for compound selector
  interpolation. Both scans operate on the already-owned source/output strings.
- New node/materialization: no new render-path node materialization. The
  `BasicSelector`/`CompoundSelector` constructions remain the existing public
  `createSelector(...)` materialization boundary, now reached without public
  replacement string transport. Cold public string boundaries still allocate
  detached `OutputWriter` instances when a string is the result. Test-only
  `Error` throws, empty replacement arrays, and `try/finally` restoration in
  `interpolated.test.ts` are proof scaffolding, not runtime control flow.
- Render path: replacement emission now calls `replacement.writeSyntax(...)`
  instead of public `replacement.toTrimmedString(...)`; resolved render keeps
  direct replacement evaluation and writes to the prepared writer/buffer.
- Helper/API surface: no public APIs added. New local helpers
  `writeReplacementSyntax(...)` and `createSimpleInterpolatedSelector(...)`
  replace repeated public string transport and regex/token-array selector
  assembly.
- Metadata mutations: none.
- Allocation changes: removed the regex callback/token-array paths for public
  `replace(...)` and compound selector assembly. Retained string `slice(...)`
  fragments because the public result is string text and the selector
  materialization boundary needs token text for `BasicSelector` construction.
  Retained required cold writer allocation where a public string is returned.
- Evidence: focused `interpolated.test.ts` and `selector-interpolated.test.ts`
  transport tests passed before doc closeout. Full gates are recorded in the
  final response.
- Merge note: the incoming `origin/dev` binding diff also includes
  script/test-only grep loops, array filters/maps, `try` / `catch` negative
  checks, and proof arrays in `scripts/verify-binding-lookup-hot-paths.mjs` and
  `import-style.test.ts`. Those are verifier/test scaffolding from the merged
  binding batch, not serialization runtime paths.
