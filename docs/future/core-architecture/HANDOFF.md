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

- Latest pass: setDefined callback closure deletion plus constrained direct
  declaration cache guard.
- Verdict: accepted as a binding/lookup machinery cut with behavior proof. No
  speed claim.
- New traversal: no new runtime traversal, recursion, sort, map/filter, parent
  walk, or child scan. The setDefined fallback still uses the existing direct
  declaration parent/fallback walk. Constrained declaration lookups now avoid
  the recursive direct-declaration cache instead of adding a replacement cache.
- New node/materialization: no runtime node materialization. No render-only or
  eval-to-string nodes were added. One focused test constructs declarations and
  a reference to prove scalar output-binding identity invalidation.
- Render path: no render/stringification path change. Reference/property
  lookup still returns the same occurrence or fallback value; the changed cache
  guard only prevents constrained lookups from reusing a key/family recursive
  match that ignored scalar exclusions.
- Helper/API surface: deleted
  `applySetDefinedDeclarationReadonlyOccurrence(...)`,
  `SetDefinedDeclarationMatchHandler`, and the `onSetDefinedMatch` callback
  lane. Added one setDefined-only
  `findWritableSetDefinedDeclarationOccurrence(...)` helper that returns the
  final occurrence or throws readonly for the final chosen match. Mutation
  still lives in `Rules.registerNode(...)`. Review-flagged `throw new Error`
  and `foundRules.adopt(newDeclaration)` lines are the pre-existing
  non-variable setDefined fallback mutation/error path moved out of the
  callback closure, not new hot-path machinery.
- Metadata mutations: none. No source/parent/frozen metadata changed.
- Allocation changes: setDefined fallback no longer allocates a callback
  closure to carry the selected occurrence/readonly state back into `Rules`.
  Direct declaration recursive cache entries are skipped for constrained
  lookups (`excludedNode0/1`, `excludedNodes`, `excludedNodesLength`, filters,
  or `requiredNormalizedFromAssign`) so scalar bind-output identity changes
  cannot reuse stale unconstrained cache state.
- Rejected/observed in this pass: a broader callable child-surface cut was
  inspected but not forced without a sharper failing proof; the existing tests
  already cover many simple callable miss surfaces. The changed baseline run
  surfaced broader render/string transport failures and then stopped producing
  output while core Vitest workers stayed active, so it was interrupted and
  recorded in `BINDING-LOOKUP-REMAINING.md` rather than claimed green.
- Review-flagged objects/errors: the new `ReferenceOptions` object is test
  scaffolding to model the existing `bindOutput` scalar getter shape. The new
  `ReferenceError` creation is the existing readonly semantic exception moved
  into the returned-occurrence helper; misses still use `undefined`/fallback,
  not routine error control.
- Evidence: focused `rules.test.ts`, `reference.test.ts`, `mixin.test.ts`, and
  `control.test.ts` setDefined slices passed. Focused `reference.test.ts`
  static property handle/constraint slices passed, including the new
  bind-output scalar exclusion invalidation proof. `verify:binding-lookup-hot-paths`
  passed with guards against the deleted setDefined callback shape.
  `@jesscss/core` build passed before tracker updates. No speed claim.
- Merge note: the branch also incorporates the latest serialization transport
  work from `origin/dev`; keep that progress tracked in
  `NODE-REWRITE-TRACKER.md` so this handoff remains the binding/lookup router.
- Merge-carried serialization review: `origin/dev` also includes Ruleset
  source-direct/bare-ampersand callback predicate cleanup in
  `packages/core/src/tree/ruleset.ts`. `canRenderSourceDirectly(...)` and
  `isBareAmpersandSelector(...)` now use indexed loops over existing child
  arrays instead of `.every(...)` callback predicates. That is tracked in the
  serialization focus, not new binding lookup logic. No speed claim.
- Merge-carried serialization review: `origin/dev` also includes the AtRule
  no-op eval rethrow deletion in `packages/core/src/tree/at-rule.ts` plus
  serialization tracker updates. That removes catch/rethrow scaffolding and is
  tracked in `NODE-REWRITE-TRACKER.md`; it is not new binding logic. The
  review-flagged AtRule loops and `slice(...)` calls are direct whitespace
  scans replacing regex trim/probe work, the `OutputWriter` constructions are
  isolated header-fragment writers for source syntax capture, and the `try` is
  paired with trivia restoration around that cold header capture. No speed
  claim.
- Merge-carried serialization review: `origin/dev` also includes the
  QueryCondition nested static direct-child cut in
  `packages/core/src/tree/query-condition.ts` plus serialization tracker
  updates. Exact nested query-condition children now write directly instead of
  entering the unknown-child fallback mark/readback path; custom/subclassed
  children keep the fallback. The review-flagged `CountingWriter` construction
  is test-only instrumentation for mark/readback assertions. This is tracked in
  `NODE-REWRITE-TRACKER.md` and is not new binding logic. No speed claim.
- Merge-carried serialization review: `origin/dev` also includes the
  QueryCondition exact `Condition` source/static child cut. Exact condition
  children now write directly on the query source/static syntax path; exact
  `Operation` remains out because it does not own a direct syntax writer, and
  custom/subclassed children still use fallback readback. The review-flagged
  `CountingWriter` and custom condition constructions are test-only proof
  instrumentation. This is tracked in `NODE-REWRITE-TRACKER.md` and is not new
  binding logic. No speed claim.
- Merge-carried serialization review: `origin/dev` also includes declaration
  narrowed-thenable continuation cleanup in
  `packages/core/src/tree/declaration.ts`. Declaration render-assignment and
  custom-interpolated replacement eval now call already-narrowed thenables
  directly instead of adding promise wrapper allocations, while preserving the
  custom-property restoration branch. This is tracked in
  `NODE-REWRITE-TRACKER.md` and is not new binding logic. No speed claim.
- Merge-carried serialization review: `origin/dev` also includes Ampersand
  append-placement dead string snapshot deletion in
  `packages/core/src/tree/ampersand.ts`. Append placement no longer fills
  unused selector text snapshots through public `toTrimmedString(...)`; broader
  Ampersand raw string assembly remains tracked in `NODE-REWRITE-TRACKER.md`.
  The review-flagged test exception assertion and empty rules fixture are
  proof scaffolding for the no-snapshot assertion, and the flagged generic
  construction / null-child-key text is an existing tracker row note carried by
  the serialization update. This is not new binding logic. No speed claim.
- Merge-carried binding review: the scoped diff still includes the prior
  `RulesLookupHandleShape` object from the source-static handle pass as remote
  baseline context; this pass removes the temporary source-static shape
  allocation by comparing stored handle fields directly.
- Merge-carried serialization review: `origin/dev` also includes Ampersand
  exact `BasicSelector` template text work in `packages/core/src/tree/ampersand.ts`.
  Exact basic selector template replacement and comma checks read owned scalar
  text instead of public string conversion; broader Ampersand raw string
  assembly remains tracked in `NODE-REWRITE-TRACKER.md`. The review-flagged
  loop, selector construction/inheritance, result array, cleanup block, and
  test exception are serialization proof/placement machinery from that merge,
  not binding lookup logic. No speed claim.
- Merge-carried serialization review: `origin/dev` also includes AtRule
  narrowed thenable continuation cleanup in
  `packages/core/src/tree/at-rule.ts`. Async at-rule name/prelude/body
  continuations now call the already-thenable value directly instead of adding
  promise wrapper calls; the pre-existing at-rule comment-trivia failure remains
  tracked outside this binding pass. This is not new binding logic. No speed
  claim.
- Merge-carried serialization review: `origin/dev` also includes Rules static
  registration narrowed-thenable cleanup in `packages/core/src/tree/rules.ts`.
  Static child registration prep now calls the already-thenable prepared-node
  result directly instead of adding a promise wrapper call. This is not new
  binding lookup logic. No speed claim.
