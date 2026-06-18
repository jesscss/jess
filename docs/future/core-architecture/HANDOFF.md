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

- Latest pass: control source syntax writer cut in
  `packages/core/src/tree/control.ts`, with the required bare parameter
  `VarDeclaration.writeSyntax(...)` support and stale Paren helper deletion.
- Verdict: accepted as localized source/writeSyntax string-transport cleanup.
  No speed claim.
- New traversal: no new production traversal; existing If branch and For tuple
  loops moved from public string wrappers into `writeSyntax(...)`. The
  review-flagged loop is test-only monkeypatch setup for source-header
  children.
- New node/materialization: no production nodes. Review-flagged `new If`,
  `new For`, `new While`, `new Nil`, and `rules([])` are focused test fixtures.
- Render path: no render output path changed. `$if`, `$for`, and `$while`
  source serialization now writes child syntax through `writeSyntax(...)`;
  runtime render/eval paths are untouched.
- Helper/API surface: added `writeControlChildSyntax(...)` to replace the old
  per-call range-bound closure and added private
  `VarDeclaration.writeBareParameterSyntax(...)` so public wrappers and
  control patterns share the same direct writer path.
- Metadata mutations: no node metadata changes. `writeControlChildSyntax(...)`
  temporarily saves/restores `suppressBoundaryTrivia`, preserving the old
  range-bound closure behavior; the review-flagged `try` is that restoration,
  not routine error control.
- Allocation changes: removes the `$for` range-bound closure allocation and
  deletes Paren's dead pre-writer child `toString(...)` helper. The remaining
  public wrapper mark/readback boundaries are cold public string APIs.
- Rejected/observed in this pass: control loop state/body surfaces and async
  branch audit remain open; Paren's shared escaped-list string boundary remains
  tied to `renderListValueSyntax(...)`. The review-flagged array-helper hit is
  tracker-row wording, not production code.
- Evidence: focused `control.test.ts`, `paren.test.ts`, and
  `var-declaration.test.ts`, targeted ESLint, `git diff --check`, and
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Merge-carried binding review: latest `origin/dev` also carries binding/lookup
  queue cleanup plus two rejected namespace-prefix shortcut audits. It is
  lookup-only: no render/stringification path changed, no runtime node
  materialization was added, and detailed status remains in
  `BINDING-LOOKUP-REMAINING.md`. The serialization pass keeps
  `NODE-REWRITE-TRACKER.md` as the active queue.
- Merge-carried binding review: latest `origin/dev` also carries direct
  declaration per-key cache invalidation in `packages/core/src/tree/rules.ts`
  with focused reference tests. It is lookup/cache-only: no
  render/stringification path changed. Review-flagged loop/map findings are
  the accepted bounded cache-key invalidation walk plus test-only cache-key
  snapshots/maps used to prove unrelated direct declaration entries survive.
  Detailed status remains in `BINDING-LOOKUP-REMAINING.md`. The serialization
  pass keeps `NODE-REWRITE-TRACKER.md` as the active queue.
- Merge-carried binding review: latest `origin/dev` also carries
  declaration/import key-version proof and dynamic promotion invalidation in
  `packages/core/src/tree/reference.ts`. It is binding/cache-state only:
  dynamic declarations queued on a scope frame that resolve to static names now
  bump the resolved key's declaration lookup version and invalidate only that
  key's direct declaration bucket/cache entries; no render/stringification path
  changed. Review-flagged loops/maps/arrays are the existing per-key cache
  invalidation walk and focused cache-key snapshots. Detailed status remains in
  `BINDING-LOOKUP-REMAINING.md`; the serialization pass keeps
  `NODE-REWRITE-TRACKER.md` as the active queue.
- Merge note: latest `origin/dev` also carries serialization work for
  `Operation`, `QueryCondition`, and scalar token-family at-rule header/leaf
  syntax readback cuts, plus Ruleset/Ampersand serialization cuts from the
  latest merge; keep that progress in `NODE-REWRITE-TRACKER.md` while this
  worktree continues serialization. Review-flagged `CountingWriter`
  constructions, detached `OutputWriter` header string boundaries, custom
  syntax subclass constructions, scalar `any(...)` fixtures, explicit
  `new Anonymous('html')`, and empty-arg `call(...)` test fixtures are
  serialization proof scaffolding from merges; they are not new binding runtime
  machinery.
