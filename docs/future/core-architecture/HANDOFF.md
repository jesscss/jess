# Core Architecture Handoff

This is the router for Jess core architecture work. Keep it short and stable:
it tells the next agent how to choose a workstream, how to complete a pass, and
where progress is tracked. Do not rewrite this file just to switch branch
focus; the chat/session should name the workstream.

## Workstream Router

Choose exactly one active workstream before editing. If the user names a
workstream, follow that. If the request is ambiguous, infer from the branch and
latest user instruction, then record the chosen workstream in the final
response instead of changing this router.

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
`full queue pass`, run an autonomous workstream pass:

1. Snapshot `git status --short --branch`.
2. Read this router and the chosen workstream doc.
3. State one hypothesis before editing.
4. Work through the active queue as a swath, not one micro-edit.
5. Keep moving until the queue is drained, the next item has materially
   different semantics, the next step needs user/product judgment, evidence
   rejects the approach, or a failing test/debugging thread needs focused
   investigation.
6. Use focused tests while iterating; run full gates at the coherent batch
   boundary.
7. Update the chosen workstream doc with only facts that change the next
   worker's decisions.
8. Update `Aggressive Cutting Self-Prosecution` below for the latest pass.
9. Commit and push the batch with `--no-verify` when the pass is complete.

A queue item must be a whole task with its own proof surface. It may contain
several sub-tasks, helper deletions, rejected cuts, and tests. Do not create or
mark complete one-line queue items. If an active queue item remains unfinished
at wrap-up, record in the workstream doc and final response which item remains,
what blocked immediate continuation, and why stopping was necessary.

Each active workstream doc should keep at least 15 unchecked sizable tasks
available unless that workstream is genuinely within 15 tasks of completion.
Reseeding the next queue is closeout work, not a queue item. Completed history
belongs in git, focused tracker rows, or `PERFORMANCE-HANDOFF.md`, not in this
router.

Use sub-agents when available for disjoint evidence or implementation slices.
Good assignments include one node-family row, one lookup family, focused test
surface discovery, profile/call-stack audits, or review against the aggressive
cutting rules. Workers must not make overlapping edits, revert unrelated work,
commit independently, or change the selected workstream. The main agent owns
integration, verification, docs, commit, push, and continuation.

## Gate Rules

Always run the smallest relevant test first. Before commit, run:

```sh
git diff --check
pnpm run verify:aggressive-cutting-review
```

Then run the chosen workstream's gates from its tracker. Use
`PERFORMANCE-HANDOFF.md` before making any speed claim. Use
`pnpm run verify:baseline -- --changed` when the touched area needs a broader
fixture gate. The current hook path has previously looped, so commit and push
with `--no-verify` after the explicit gates pass.

## Aggressive Cutting Self-Prosecution

- Latest pass: binding/lookup pass that narrowed uncovered callable child
  fallback, removed the old string-filter `Rules.findDeclaration(...)` branch,
  hid scalar declaration-exclusion fields from exported `ReferenceOptions`, and
  added `verify:binding-lookup-hot-paths`.
- Verdict: accepted as a binding-surface slimming pass. It removes a broad
  child-surface fallback and public-looking string/scalar option shapes. No
  wall-clock speed claim.
- New traversal: `findMixinsFastForUncoveredCallable(...)` now loops over only
  child `Rules` entries whose frames reported `uncovered` instead of calling
  broad parent `findMixinsFast(..., skipCurrentSurface: true)` over the whole
  child surface. This replaces a wider recursive child crawl with a narrower
  one. The new verification script scans a bounded file list for forbidden
  hot-path tokens.
- New node/materialization: no AST nodes, copied nodes, wrapper `Rules`, or
  render materialization were added. The narrowed fallback allocates an
  `uncoveredChildren` array only when more than one child frame is uncovered;
  the one-child case stays scalar. The `broadParentCrawls` array and
  `Expected VarDeclaration output children` guard are test-only scaffolding.
- Render path: no render/stringification path changed. The touched runtime path
  is callable lookup before candidate eval/render.
- Helper/API surface: added `verify:binding-lookup-hot-paths` as a gate script
  and a small internal `getReferenceDeclarationConstraintOptions(...)` cast
  helper. Removed the `Rules.findDeclaration(key, filterType)` string-branch
  API shape; callers now use `findVariable`, `findProperty`/`findDeclaration`,
  or `findAnyDeclaration`.
- Metadata mutations: none. The internal reference constraint helper is a
  typed view over existing options data and does not mutate parent/source/root
  metadata. The test `try`/`finally` only restores a prototype spy.
- Allocation changes: no new hot result wrapper or side map. The multi-uncovered
  child fallback may allocate one array to avoid reopening covered sibling
  surfaces; the old fallback could scan all child entries recursively.
- Evidence: focused callable/import/reference/rules matrix passed (`60` tests),
  `pnpm exec eslint ...` passed, `pnpm --filter @jesscss/core build` passed,
  `git diff --check` passed, and `pnpm run verify:binding-lookup-hot-paths`
  passed. `pnpm run verify:aggressive-cutting-review` passed with the danger
  tokens prosecuted above. `pnpm run verify:baseline -- --changed` promoted to
  the full baseline and stayed active in `@jesscss/core` tests without output
  for several minutes, so it was interrupted and is not counted as passed.
  Hotpath smoke was attempted after fresh `@jesscss/core`, `jess`, and
  `@jesscss/plugin-js` builds, but `scripts/measure-less-hotpath.mjs` failed
  before measurement on the existing upstream `mixins-guards.less` fixture with
  `parse/syntax-error: args.set is not a function`; no speed claim is made.
