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

- Latest pass: `Rules.toTrimmedString(...)` direct writer ownership.
- Verdict: accepted as a localized serialization transport deletion. Public
  rules-body source stringification no longer duplicates the visible/full-render
  guard plus source-body emitter dispatch; the non-fast-path wrapper now
  delegates to `writeSyntax(...)` and keeps the same caller-writer
  mark/readback boundary. No speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added.
- New node/materialization: none. No runtime node copies, wrappers, inherited
  metadata, frozen state, or new hot-path arrays were added.
- Render path: no render path changed. This pass only removes duplicated public
  source-string dispatch inside `Rules.toTrimmedString(...)`.
- Helper/API surface: none. No new helper or public API surface was added.
- Metadata mutations: none.
- Routine error control: the review-flagged thrown test error is focused
  `rules.test.ts` proof scaffolding around a temporary method swap used to
  assert `toTrimmedString(...)` now goes through `writeSyntax(...)`; no
  production error/control flow changed.
- Allocation changes: deletes one duplicated source-dispatch path and reuses
  the existing rules writer implementation for non-fast-path public source
  capture.
- Rejected/observed in this pass: broader rules body render, indentation
  capture, placement state, merge output, duplicate declaration materialization,
  and remaining root serializer capture remain queued.
- Evidence: focused `rules.test.ts` source leaf/wrapper proof plus the new
  `writeSyntax(...)` ownership proof, targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: `Ruleset.toTrimmedString(...)` direct writer ownership.
- Verdict: accepted as a localized serialization transport deletion. Public
  ruleset source stringification no longer duplicates the hoist/reference-mode
  guard plus container serializer dispatch; the non-fast-path wrapper now
  delegates to `writeSyntax(...)` and keeps the same caller-writer
  mark/readback boundary. No speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added.
- New node/materialization: none. No runtime node copies, wrappers, inherited
  metadata, frozen state, or new hot-path arrays were added.
- Render path: no render path changed. This pass only removes duplicated public
  source-string dispatch inside `Ruleset.toTrimmedString(...)`.
- Helper/API surface: none. No new helper or public API surface was added.
- Metadata mutations: none.
- Routine error control: the review-flagged thrown test error is focused
  `ruleset.test.ts` proof scaffolding around a temporary method swap used to
  assert `toTrimmedString(...)` now goes through `writeSyntax(...)`; no
  production error/control flow changed.
- Allocation changes: deletes one duplicated source-dispatch path and reuses
  the existing ruleset writer implementation for non-fast-path public source
  capture.
- Rejected/observed in this pass: deeper ruleset selector composition, body
  prep, direct container splitting, wrappers, and render branches remain
  queued.
- Evidence: focused `ruleset.test.ts` direct child-writer proof plus the new
  `writeSyntax(...)` ownership proof, targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: `SelectorList.toTrimmedString(...)` direct writer ownership.
- Verdict: accepted as a localized serialization transport deletion. Public
  selector-list source stringification no longer duplicates source assembly;
  the non-fast-path wrapper now delegates to `writeSyntax(...)` and keeps the
  same caller-writer mark/readback boundary. No speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added.
- New node/materialization: none. No runtime node copies, wrappers, inherited
  metadata, frozen state, or new hot-path arrays were added.
- Review-flagged inherit/materialized-array tokens: the diff touches the
  existing private `withSelectors(...)` / `createEvaluatedSelectorListSurface(...)`
  materialization helpers only because the unsafe `as this` cast was removed
  while fixing touched-file lint. Their owned selector-array allocation and
  `inherit(this)` call are pre-existing public evaluated-surface behavior, not
  new render/source transport machinery from this pass.
- Render path: no render path changed. This pass only removes duplicated public
  source-string assembly inside `SelectorList.toTrimmedString(...)`.
- Helper/API surface: deletes private `renderSelectorListSyntax(...)`; no new
  helper or public API surface was added.
- Metadata mutations: none.
- Routine error control: the review-flagged thrown test error is focused
  `selector-list.test.ts` proof scaffolding around a temporary prototype swap
  used to assert `toTrimmedString(...)` now goes through `writeSyntax(...)`; no
  production error/control flow changed.
- Review-flagged generic defensive read: the danger-token hit comes from the
  tracker prose phrase "public `toTrimmedString(...)` now reuses
  `writeSyntax(...)` directly" in `NODE-REWRITE-TRACKER.md`; no production
  defensive read, structural probe, or fallback runtime branch was added.
- Allocation changes: deletes one duplicated source-assembly path and reuses
  the existing selector-list writer implementation for non-fast-path public
  source capture.
- Rejected/observed in this pass: broader `SelectorList` value flattening and
  `valueOf()` work remain queued.
- Evidence: focused `selector-list.test.ts` direct top-level item proof plus
  the new `writeSyntax(...)` ownership proof, targeted ESLint,
  `git diff --check`, `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: `Reference.toTrimmedString(...)` direct writer ownership.
- Verdict: accepted as a localized serialization transport deletion. Public
  reference source stringification no longer duplicates source assembly; the
  non-fast-path wrapper now delegates to `writeSyntax(...)` and keeps the same
  caller-writer mark/readback boundary. No speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added.
- New node/materialization: none. No runtime node copies, wrappers, inherited
  metadata, frozen state, or new hot-path arrays were added.
- Render path: no render path changed. This pass only removes duplicated public
  source-string assembly inside `Reference.toTrimmedString(...)`.
- Helper/API surface: deletes private `renderReferenceSyntax(...)`; no new
  helper or public API surface was added.
- Metadata mutations: none.
- Routine error control: the review-flagged thrown test error is focused
  `reference.test.ts` proof scaffolding around a temporary prototype swap used
  to assert `toTrimmedString(...)` now goes through `writeSyntax(...)`; no
  production error/control flow changed.
- Allocation changes: deletes one duplicated source-assembly path and reuses
  the existing reference writer implementation for non-fast-path public source
  capture.
- Rejected/observed in this pass: broader `Reference` rules-like surfaces,
  public value materialization, merged assign normalization, and key
  conversion remain queued.
- Evidence: focused `reference.test.ts` direct child-writer proof plus the new
  `writeSyntax(...)` ownership proof, targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: `Call.toTrimmedString(...)` direct writer ownership.
- Verdict: accepted as a localized serialization transport deletion. Public
  call source stringification no longer duplicates source assembly; the
  non-fast-path wrapper now delegates to `writeSyntax(...)` and keeps the same
  caller-writer mark/readback boundary. No speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added.
- New node/materialization: none. No runtime node copies, wrappers, inherited
  metadata, frozen state, or new hot-path arrays were added.
- Render path: no render path changed. This pass only removes duplicated public
  source-string assembly inside `Call.toTrimmedString(...)`.
- Helper/API surface: none.
- Metadata mutations: none.
- Routine error control: the review-flagged `try/finally` and thrown test error
  are focused `call.test.ts` proof scaffolding around a temporary prototype
  swap used to assert `toTrimmedString(...)` now goes through `writeSyntax(...)`;
  no production error/control flow changed.
- Allocation changes: deletes one duplicated source-assembly path and reuses
  the existing call writer implementation for non-fast-path public source
  capture.
- Rejected/observed in this pass: broader `Call` callable output selection and
  arg-trimming fallbacks, `Rules`/`AtRule` deeper body work, remaining
  declaration materialization, and `Mixin` cleanup remain queued.
- Evidence: focused `call.test.ts` direct child-writer proof plus the new
  `writeSyntax(...)` ownership proof, targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Merge-carried binding review: latest `origin/dev` also carries positional
  reference handle reader/writer/source-static strategy APIs in
  `packages/core/src/tree/reference.ts` plus the binding verifier. It is
  binding handle-access only: private
  `ReadRulesLookupHandleArgs*`, `WriteRulesLookupHandleArgs*`, and
  `SourceStaticRulesLookupHandleArgs` object shapes are deleted, strategy
  read/write methods plus family/source-static helpers now pass positional
  facts directly, generic handle dispatch no longer allocates argument
  objects, and `verify:binding-lookup-hot-paths` guards against stale
  object-call shapes and deleted handle arg type names. No
  render/stringification path changed, no runtime node materialization was
  added, and detailed status remains in
  `BINDING-LOOKUP-REMAINING.md`.
- Merge-carried binding review: latest `origin/dev` also carries
  strategy-owned rules lookup handle readers, typed strategy policy, and
  slimmer handle dispatch in `packages/core/src/tree/reference.ts` plus the
  binding verifier. It is binding handle-policy only: the old generic
  `readRulesLookupHandle(...)` function and
  `preparedDeclarationConstraints` lookup-context field are deleted, each
  `ReferenceLookupStrategy` now owns its family-specific handle reader,
  declaration-capable readers receive declaration constraints while
  function/callable/index readers do not, the old declaration-policy boolean
  is gone in favor of declaration-capable/plain strategy types, and the stale
  temp/spread dispatch is replaced with the slimmer private dispatcher guarded
  by `verify:binding-lookup-hot-paths`. No render/stringification path
  changed, no runtime node materialization was added, and detailed status
  remains in `BINDING-LOOKUP-REMAINING.md`.
- Merge-carried serialization review: latest `origin/dev` also carries the
  child `Rules` body transport direct `writeSyntax(...)` cut in
  `packages/core/src/tree/rules.ts` and
  `packages/core/src/tree/util/serialize-helper.ts`. Detached child `Rules`
  body transport now writes through `Rules.writeSyntax(...)` instead of the
  public `toTrimmedString(...)` wrapper. Review-flagged detached writers,
  thrown errors, and `try/finally` are serialization proof scaffolding or
  bounded detached string boundaries. No binding lookup runtime path changed.
- Merge-carried serialization review: latest `origin/dev` also carries the
  declaration fallback preview-transport cut in
  `packages/core/src/tree/util/serialize-helper.ts`. Review-flagged
  `new OutputWriter()` is the detached declaration fallback string boundary
  that replaces caller-writer preview transport. Review-flagged
  `new CountingWriter()` and `try/finally` are focused `ruleset.test.ts`
  scaffolding for restoring swapped methods around detached-writer assertions.
  No binding lookup runtime path changed.
- Merge-carried serialization review: latest `origin/dev` also carries the
  Ruleset frame-header compare-key split in
  `packages/core/src/tree/ruleset.ts` and
  `packages/core/src/tree/util/serialize-helper.ts`.
- Merge-carried serialization review: latest `origin/dev` also carries the
  duplicate declaration comparison writer cut in
  `packages/core/src/tree/util/serialize-helper.ts`. Review-flagged
  `new OutputWriter()` is the existing detached duplicate-comparison string
  boundary, and `new WholeBufferCountingWriter()` / thrown test errors are
  focused rules/ruleset proof scaffolding. No binding lookup runtime path
  changed.
- Merge-carried serialization review: latest `origin/dev` also carries the
  duplicate declaration scratch-trivia cut in
  `packages/core/src/tree/util/serialize-helper.ts`. Duplicate comparison
  reuses `withScratchEmittedTrivia(...)` instead of allocating a bespoke
  emitted-trivia side set per repeated declaration. Review-flagged detached
  writers, `WholeBufferCountingWriter`, thrown test errors, and `try/finally`
  are serialization proof scaffolding or existing string-boundary comparison
  state. No binding lookup runtime path changed.
- Merge-carried binding review: latest `origin/dev` also carries
  strategy-owned rules lookup handle policy in
  `packages/core/src/tree/reference.ts` and the binding verifier. It is
  binding handle-policy only: the old generic
  `isRulesLookupHandleEligible(...)` and
  `tryReadSourceStaticRulesLookupHandle(...)` helpers are gone, each
  `ReferenceLookupStrategy` now owns its lookup type/key/declaration-constraint
  policy and source-static reader, and `verify:binding-lookup-hot-paths`
  guards that strategy-owned handle policy does not collapse back into generic
  helpers. No render/stringification path changed, no runtime node
  materialization was added, and detailed status remains in
  `BINDING-LOOKUP-REMAINING.md`.
- Merge-carried serialization review: latest `origin/dev` also carries the
  declaration fallback direct-writer cut in
  `packages/core/src/tree/util/serialize-helper.ts`. Declaration fallback
  inside container serialization now writes through `writeSyntax(...)` into
  its detached writer instead of calling public `toTrimmedString(...)`;
  duplicate declaration comparison stays on the detached string key fed by
  `writeSyntax(...)`, and surviving declarations no longer carry prerendered
  output/trivia caches forward into emission. Review-flagged detached writers,
  `WholeBufferCountingWriter`, thrown test errors, and `try/finally` are
  serialization proof scaffolding or existing string-boundary comparison
  state. No binding lookup runtime path changed.
- Merge-carried binding review: latest `origin/dev` also carries generic rules
  lookup handle shape split in `packages/core/src/tree/reference.ts` and the
  binding verifier script. It is binding handle-shape only:
  `RulesLookupHandleShape` now keeps only common start/local/parent/terminal
  facts, while declaration-specific freshness data is carried through a
  separate `ReferenceRulesLookupDeclarationConstraints` object only on
  declaration-capable read/write paths. No render/stringification path
  changed, no runtime node materialization was added, and
  `verify:binding-lookup-hot-paths` now guards that declaration-constraint
  fields do not flow back into the generic shape. Detailed status remains in
  `BINDING-LOOKUP-REMAINING.md`.
- Merge-carried binding review: latest `origin/dev` also carries
  declaration-constraint handle snapshot slimming and proof in
  `packages/core/src/tree/reference.ts` and related lookup helpers. It is
  binding handle-shape only: private declaration/property/variable lookup
  handles no longer store the scalar `excludedDeclarationCount` field, and the
  existing handleability gate keeps only the declaration-assignment key plus
  the first two excluded declaration identities when forming fresh handles.
  No render/stringification path changed, no runtime node materialization was
  added, and the focused exclusion-array mutation proof remains in the binding
  lane. Detailed status remains in `BINDING-LOOKUP-REMAINING.md`.
- Merge-carried binding review: latest `origin/dev` also carries
  declaration-constraint option cleanup and merge-chain output-binding proof
  in `packages/core/src/tree/reference.ts` and related lookup helpers. It is
  binding/API-shape only: direct declaration lookup no longer accepts scalar
  exclusion fields, `ReferenceOptions` uses semantic
  `excludedDeclarations` / `requiredDeclarationAssignments` names, and merge
  assignment keeps one mutable semantic exclusion list instead of hidden scalar
  getter fields. No render/stringification path changed. Review-flagged loops,
  arrays, and option objects belong to verifier/test/public-shape proof
  scaffolding. Detailed status remains in
  `BINDING-LOOKUP-REMAINING.md`.
- Merge-carried binding review: latest `origin/dev` also carries binding/lookup
  queue cleanup plus two rejected namespace-prefix shortcut audits. It is
  lookup-only: no render/stringification path changed, no runtime node
  materialization was added, and detailed status remains in
  `BINDING-LOOKUP-REMAINING.md`.
- Merge-carried binding review: latest `origin/dev` also carries direct
  declaration per-key cache invalidation in `packages/core/src/tree/rules.ts`
  with focused reference tests. It is lookup/cache-only: no
  render/stringification path changed. Review-flagged loop/map findings are
  the accepted bounded cache-key invalidation walk plus test-only cache-key
  snapshots/maps used to prove unrelated direct declaration entries survive.
  Detailed status remains in `BINDING-LOOKUP-REMAINING.md`.
- Merge-carried binding review: latest `origin/dev` also carries
  declaration/import key-version proof and dynamic promotion invalidation in
  `packages/core/src/tree/reference.ts`. It is binding/cache-state only:
  dynamic declarations queued on a scope frame that resolve to static names now
  bump the resolved key's declaration lookup version and invalidate only that
  key's direct declaration bucket/cache entries; no render/stringification path
  changed. Review-flagged loops/maps/arrays are the existing per-key cache
  invalidation walk and focused cache-key snapshots. Detailed status remains in
  `BINDING-LOOKUP-REMAINING.md`.
- Merge note: latest `origin/dev` also carries serialization work for
  `Operation`, `QueryCondition`, and scalar token-family at-rule header/leaf
  syntax readback cuts, plus Ruleset/Ampersand serialization cuts from the
  latest merge and the child `Rules` wrapper preview-transport cut; keep that
  progress in `NODE-REWRITE-TRACKER.md` while this worktree continues
  serialization. Review-flagged `CountingWriter`
  constructions, detached `OutputWriter` header string boundaries, custom
  syntax subclass constructions, scalar `any(...)` fixtures, explicit
  `new Anonymous('html')`, and empty-arg `call(...)` test fixtures are
  serialization proof scaffolding from merges; they are not new binding runtime
  machinery.
- Merge-carried serialization review: latest `origin/dev` also carries
  declaration merge-sequence inner readback deletion in
  `packages/core/src/tree/declaration.ts`. Review-flagged `CountingWriter`,
  `Nil`, `Node[]`, and `Reflect.get(...)` findings belong to focused
  serialization fixtures or existing helper signatures in the serialization
  tracker; they are not new binding lookup runtime machinery.
- Merge-carried serialization review: latest `origin/dev` also carries `For`
  source writer work in `control.ts`, including the existing pattern/range
  child loop plus focused `If`/`For`/`While` construction fixtures and
  `WholeBufferCountingWriter` assertions. Those review-flagged loops, arrays,
  node constructions, and thrown test errors belong to the serialization
  tracker and are not new binding lookup runtime machinery.
