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

- Latest pass: `Call` exact scalar render-text carry.
- Verdict: accepted as a localized render transport cut. Covered plain and
  finalized CSS-call render paths now keep exact no-trivia scalar args/content
  on direct known-text output, including async scalar resolutions, so those
  paths no longer pay per-arg trim marks or the whole-call `getSince(...)`
  readback just to return text that was already known. No speed claim.
- New traversal: none. This pass reuses the existing writer-owned arg loop and
  adds no new tree walk, callback scan, side-map lookup, or array
  materialization.
- New node/materialization: none. No new node copies, inherited wrappers, or
  arg containers were added.
- Render path: exact `Any`/`Keyword`/`Anonymous`, `Bool`, `Num`, and
  string-backed `Color` arg/content results now write known text directly into
  the active writer and carry that same text through the render return when the
  whole call stayed on that exact contract.
- Helper/API surface: one node-local `getKnownRenderedCallText(...)` helper and
  one tiny `CallRenderTextState` record were added inside `call.ts` to keep the
  direct-text render contract local. They replace repeated ad hoc scalar checks
  in plain/finalized render and delete whole-call readback on the covered path.
- Metadata mutations: none.
- Routine error control: none added. Existing calc-frame cleanup and async
  rejection handling stay where they were.
- Allocation changes: deletes per-arg trim marks for covered exact scalar args
  and deletes whole-call readback for covered exact scalar arg/content render
  returns. Async scalar cases still allocate only the existing promise
  continuation after thenable detection.
- Rejected/observed in this pass: non-scalar/custom/trivia arg trim-mark
  cleanup, shared-buffer call output splitting, and broader async/dynamic call
  output work stay queued in `Call`.
- Evidence: focused `call.test.ts` render-count subset covering rendered CSS
  call args without capture scaffolding, token/color scalar arg no-trim paths,
  async scalar arg no-readback, and async scalar content no-readback passed;
  the prior focused render subset covering direct CSS-call render, flat-buffer
  output, direct arg rendering without public resolve, evaluated/escaped arg
  syntax, dynamic arg streaming, async arg buffer/render paths, calc-frame
  rejection cleanup, and escaped rendered args also passed; targeted ESLint,
  `git diff --check`, `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` remain the commit-boundary gates.
- Latest pass: `Call` writer-owned rendered-arg transport.
- Verdict: accepted as a localized serialization transport cut. Plain and
  finalized CSS-call render paths no longer bounce through a recursive
  rendered-args helper that returns discarded intermediate strings; they now
  drive a writer-owned indexed arg loop directly and only switch to one async
  continuation after the first thenable appears. No speed claim.
- New traversal: one shared indexed arg loop plus one async rest loop in
  `writeRenderedArgs(...)` inside `packages/core/src/tree/call.ts`. This
  replaces the previous recursive `serializeArgAt(...)` ladder and does not add
  any new tree walk beyond the existing arg scan work.
- New node/materialization: none. No new node copies, inherited wrappers, or
  arg containers were added by this pass.
- Render path: rendered call args now write directly into the caller-owned
  writer instead of returning an inner args string that the caller throws away.
  Whole-call string return compatibility stays at the existing outer call
  boundary.
- Helper/API surface: one private helper was renamed and simplified from
  `serializeRenderedArgs(...) -> MaybePromise<string>` to
  `writeRenderedArgs(...) -> MaybePromise<void>`. The caller contract is
  smaller because it no longer threads discarded rendered-args text back
  through plain/finalized render.
- Metadata mutations: none.
- Routine error control: none added. Calc-frame cleanup remains on the existing
  plain-call render boundary; this pass did not add production catch/rethrow or
  fallback branches.
- Allocation changes: deletes the recursive rendered-args string-return ladder
  and its discarded inner args readback; async work now allocates one rest
  continuation only after the first thenable is observed.
- Rejected/observed in this pass: non-scalar/custom/trivia arg trim-mark
  cleanup, callable output, and remaining `evalArgNodes(...)` ownership work
  stay queued in `Call`. A broader `call.test.ts` run still contains unrelated
  existing expectation mismatches outside this helper rewrite, so proof for
  this pass stays on the focused render/serialization subsets that cover the
  touched path.
- Evidence: focused `call.test.ts` render-path subset covering direct CSS-call
  render, flat-buffer output, direct arg rendering without public resolve,
  evaluated/escaped arg syntax, dynamic arg streaming, async arg buffer/render
  paths, calc-frame rejection cleanup, and escaped rendered args passed; a
  focused `call.test.ts` source-syntax subset covering direct-child writer
  ownership, `writeSyntax(...)` ownership, optional lookup syntax, and comment
  trivia separators also passed; targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` remain the commit-boundary gates.
- Latest pass: `Reference` dynamic merged declaration direct-reuse cutoff.
- Verdict: accepted as a localized public materialization cut. Already-final
  dynamic merged declaration values no longer pay a final
  normalize-plus-inherit public wrapper after eval when the merged output is
  already in final list shape; only nested-list or empty-placeholder cleanup
  stays on the existing normalization path. No speed claim.
- New traversal: none beyond the preexisting direct item loop inside
  `canReturnMergedAssignReferenceValue(...)`. This pass reuses the existing
  merged-shape predicate and adds no new tree walk, parent walk, callback
  scan, side-map lookup, or array materialization.
- New node/materialization: none. This pass deletes one cold public
  normalize-plus-inherit path for already-final evaluated merged values. The
  existing normalization path still owns real merged cleanup when nested lists
  or placeholders remain.
- Render path: no render path changed. This pass only short-circuits public
  resolve/eval materialization for merged declaration references whose
  evaluated output is already final.
- Helper/API surface: none newly added. The pass reuses the existing
  `canReturnMergedAssignReferenceValue(...)` helper instead of adding another
  merged-output finalizer branch.
- Metadata mutations: fewer, because already-final evaluated merged outputs now
  skip the extra `inherit(referenceNode)` wrapper that the old public
  normalization path applied.
- Routine error control: the focused async merged-finalization throw proof in
  `reference.test.ts` stays test-only scaffolding; this pass added no
  production error/control flow.
- Allocation changes: deletes one cold public merged-reference normalization
  and inherited wrapper for the already-final dynamic path; the remaining
  nested-list / placeholder normalization branch is unchanged.
- Rejected/observed in this pass: broader public value materialization and
  deeper merged-assign normalization still stay queued in `Reference`.
- Evidence: focused `reference.test.ts` merged declaration direct-reuse,
  dynamic merged declaration direct-reuse, async merged finalization throw,
  quoted-index merged-property regression checks, targeted ESLint,
  `git diff --check`, `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: `Reference` preserved rules-like shell ownership.
- Verdict: accepted as a localized public ownership cut. Preserved
  `Rules`/`Collection`/`Mixin`/`Ruleset` reference surfaces no longer rerun
  node constructors against canonical child payloads just to carry public
  lookup/source metadata; they now materialize as descriptor-cloned shallow
  shells, so canonical child parents stay on the source tree. No speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added.
- New node/materialization: one cold public shell allocation remains for
  preserved rules-like reference values, but it now copies only the outer node
  shell and owned option bag instead of reconstructing a new node through its
  constructor and re-adopting canonical children.
- Render path: no render path changed. This pass only tightens the cold public
  preserved-surface boundary used by rules-like `Reference` results.
- Helper/API surface: no new public API surface. `createRulesLikeReferenceSurface(...)`
  stays in place but now uses descriptor cloning for the outer shell rather
  than constructor replay.
- Metadata mutations: the new preserved shell explicitly resets only its own
  `sourceNode`/`parent`/`index` metadata. Canonical child parent/source links
  are no longer mutated as a side effect of constructor-based shell creation.
- Routine error control: the review-flagged thrown test errors remain the
  existing focused `reference.test.ts` proof scaffolding around exact key
  normalization; this preserved-shell cut added no production error/control
  flow.
- Allocation changes: replaces constructor-based preserved node materialization
  plus implicit child re-adoption with one shallow shell clone and one shallow
  options clone on the cold public boundary.
- Rejected/observed in this pass: broader public value materialization and
  deeper merged-assign normalization stay queued in `Reference`.
- Evidence: focused `reference.test.ts` rules-like variable preservation,
  canonical-child-parent proof, direct mixin-ruleset hit preservation, exact
  key normalization, merged declaration reuse, quoted-index merged-property
  regression checks, targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: `Reference` merged declaration direct-reuse cutoff.
- Verdict: accepted as a localized public materialization cut. Already-normalized
  static merged declaration values no longer go through an extra merged
  reference normalization/materialization pass during public resolve; they now
  reuse the evaluated merged container directly, while nested-list or empty
  placeholder cleanup stays on the existing normalization path. No speed claim.
- New traversal: one direct item loop inside
  `canReturnMergedAssignReferenceValue(...)` checks whether a static merged
  `List` already has its final output shape. It replaces the heavier
  normalize-then-materialize path for the exact already-normalized case and
  does not add a new tree walk outside that cold/public boundary.
- New node/materialization: none. This pass deletes one public merged-reference
  materialization path for already-normalized static merged values. The
  existing normalization path still owns real merged cleanup when nested lists
  or placeholders are present.
- Render path: no render path changed. This pass only short-circuits public
  resolve/eval materialization for merged declaration references that are
  already in final static shape.
- Helper/API surface: two node-local predicates,
  `isEmptyMergedAssignPlaceholder(...)` and
  `canReturnMergedAssignReferenceValue(...)`, were added inside `reference.ts`
  to isolate the already-normalized merged-value gate. No public API surface
  changed.
- Metadata mutations: none newly added. The accepted cut specifically avoids
  the extra merged-reference public materialization pass for already-normalized
  static merged values.
- Routine error control: the review-flagged thrown test errors remain the
  focused `reference.test.ts` key-normalization scaffolding from the prior
  adjacent `Reference` pass; this merged-value cut added no production
  error/control flow.
- Allocation changes: deletes one public merged-reference materialization pass
  for the exact already-normalized static path; the remaining nested-list /
  placeholder normalization branch is unchanged.
- Rejected/observed in this pass: rules-like surfaces, broader public value
  materialization, and deeper merged-assign normalization beyond the exact
  already-normalized static path stay queued in `Reference`.
- Evidence: focused `reference.test.ts` merged declaration direct-reuse and
  normalization proof plus quoted-index merged-property regression checks,
  targeted ESLint, `git diff --check`, `pnpm run verify:aggressive-cutting-review`,
  and `pnpm --filter @jesscss/core build` passed.
- Latest pass: `Reference` exact key normalization ownership.
- Verdict: accepted as a localized lookup-key conversion cut. Exact
  `Any`/`Quoted`/numeric/color key nodes no longer route through generic
  public `valueOf()` / `String(...)` transport just to choose the lookup key;
  `Reference` now reads owned scalar fields first and only falls back to
  generic node stringification when the key shape is genuinely dynamic. No
  speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added. The existing array-key
  normalization loop remains, but it now normalizes each segment through one
  shared scalar helper instead of unconditional generic string coercion.
- New node/materialization: none. No runtime node copies, wrappers, inherited
  metadata, frozen state, or new hot-path arrays were added.
- Render path: no render path changed. This pass only deletes generic key
  string transport on exact scalar key nodes before lookup dispatch.
- Helper/API surface: one node-local `normalizeReferenceKeyValue(...)` helper
  was added inside `reference.ts`; it replaces repeated ad hoc key coercion in
  the existing lookup path and did not add public API surface.
- Metadata mutations: none.
- Routine error control: the review-flagged thrown test errors are focused
  `reference.test.ts` proof scaffolding that patches `valueOf()` on exact key
  nodes to prove lookup no longer depends on that public transport; no
  production error/control flow changed.
- Allocation changes: no new runtime objects were added beyond the preexisting
  normalized string-array allocation for non-string key arrays. Exact scalar
  key nodes now reuse their owned fields instead of allocating through generic
  coercion paths.
- Rejected/observed in this pass: rules-like surfaces, broader public value
  materialization, and merged-assign normalization stay queued in `Reference`.
- Evidence: focused `reference.test.ts` exact Any/quoted key normalization
  proof plus quoted-index and merged-property regression checks, targeted
  ESLint, `git diff --check`, `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: preserved `Operation` explicit-writer render ownership.
- Verdict: accepted as a localized render transport fix. Preserved operations
  with an explicit writer no longer let child renders write directly while the
  operator boundary exists only in the return string; child renders now run
  with a detached writer and the final combined operation text is written once.
  No speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added.
- New node/materialization: none. No runtime node copies, wrappers, inherited
  metadata, frozen state, or new hot-path arrays were added.
- Render path: preserved-operation direct render still uses the existing left
  and right child string results, but explicit-writer calls now keep child side
  effects off the caller writer and emit the final operation text once.
- Helper/API surface: none.
- Metadata mutations: none.
- Routine error control: the review-flagged thrown test errors are focused
  `operation.test.ts` proof scaffolding around `withOperands(...)` materialization
  guards; no production error/control flow changed.
- Review-flagged node construction: the danger-token hit is the focused
  `CountingWriter` test fixture in `operation.test.ts`, not a production node
  or runtime wrapper allocation.
- Allocation changes: no new runtime objects were added. This pass deletes one
  explicit-writer child-output leak and reuses the existing detached-print
  option path before the final writer add.
- Rejected/observed in this pass: broader arithmetic/list materialization,
  calc fallback ownership, and remaining repeated eval/render ladders stay
  queued.
- Evidence: focused `operation.test.ts` preserved-operation explicit-writer and
  unresolved render proof, targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: `Paren` dead string-coercion branch deletion.
- Verdict: accepted as a localized serialization guard cleanup. `Paren`
  source/eval normalization no longer carries unreachable non-`Node`
  string-coercion checks even though `Paren.node` is already typed and
  constructed as `Node | undefined`. No speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added.
- New node/materialization: none. No runtime node copies, wrappers, inherited
  metadata, frozen state, or new hot-path arrays were added.
- Render path: no render path changed. This pass only deletes dead source/eval
  branches around impossible non-`Node` values.
- Helper/API surface: none.
- Metadata mutations: none.
- Routine error control: none in production. Focused paren tests continue to
  prove direct child syntax and escaped-list normalization behavior.
- Allocation changes: none.
- Rejected/observed in this pass: segmented/async non-scalar child render, the
  shared `renderListValueSyntax(...)` mark/readback boundary, and remaining
  paren capture audit stay queued.
- Evidence: focused `paren.test.ts` source child syntax plus escaped-list
  normalization proof, targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: escaped `Paren` semicolon-list public normalization to direct
  comma text.
- Verdict: accepted as a localized public normalization cut. Escaped
  semicolon-list `evalNode(...)` / `resolve(...)` no longer materialize a
  replacement `List` with inherited source state just to surface comma output;
  they now return direct comma text as `Any`. No speed claim.
- New traversal: none. No new tree walk, parent walk, callback scan, side-map
  lookup, or array materialization was added. The remaining comma join is the
  existing `renderListValueSyntax(...)` string boundary already called from the
  old replacement-list path.
- New node/materialization: one scalar `Any` output node remains on the public
  `evalNode(...)` / `resolve(...)` boundary for escaped semicolon lists.
  Rejected render-only/public replacement `List` materialization was deleted.
- Review-flagged node construction: `new Any(renderListValueSyntax(...))` is
  the deliberate remaining public normalization boundary for escaped
  semicolon-list `evalNode(...)` / `resolve(...)`. It replaces a heavier
  replacement `List(...).inherit(...)` surface and is not used on render.
- Render path: render already avoided replacement-list materialization before
  this pass, and it stays on the existing direct comma-text path.
- Helper/API surface: deletes private `normalizeEscapedList(...)`; no new
  helper or public API surface was added.
- Metadata mutations: none. The deleted path no longer calls `.inherit(...)`
  on a replacement list during public normalization.
- Routine error control: the review-flagged thrown test errors are focused
  `paren.test.ts` proof scaffolding around temporary `inherit(...)` guards; no
  production error/control flow changed.
- Review-flagged inherit token: the danger-token hit is this handoff prose
  describing the deleted `.inherit(...)` path, not a new production metadata
  mutation.
- Allocation changes: deletes one replacement `List([...items], { sep: ',' })`
  plus inherited-source-state path and replaces it with one scalar `Any`
  output surface on the public normalization boundary.
- Rejected/observed in this pass: the shared `renderListValueSyntax(...)`
  mark/readback boundary, guard/string conversion, segmented/async non-scalar
  child render, and remaining capture audit stay queued.
- Evidence: focused `paren.test.ts` resolve/render normalization proof plus
  escaped call argument sanity checks in `call.test.ts`, targeted ESLint,
  `git diff --check`, `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed.
- Latest pass: reference handle/no-handle strategy split plus callable reader
  freshness cleanup.
- Verdict: accepted as a binding handle-access cut. Index lookup is now an
  explicit no-handle strategy instead of a fake strategy with no-op handle
  readers/writers. The old `readNoRulesLookupHandle`,
  `tryReadNoSourceStaticRulesLookupHandle`, `getNoRulesLookupHandleValueKey`,
  and `clearRulesLookupHandle` helpers are deleted. Normal and source-static
  function/callable readers now rely on the shared exact handle freshness tail
  instead of repeating local `handle.lookupType` checks. No speed claim.
- New traversal: no new production traversal. This pass adds no tree walk,
  parent walk, child scan, map/filter/sort, or side-map lookup. The
  review-flagged loops are verifier token scans and function/constant source
  checks, plus the existing focused reference tests. The review-flagged
  `slice(...)` calls are verifier-only source-block extraction for private
  function/constant checks.
- New node/materialization: no runtime nodes, wrappers, copied rules, inherited
  metadata, frozen state, or production arrays were added. Review-flagged
  `ReferenceLookupStrategyBase`, `ReferenceHandleLookupStrategyBase`,
  `ReferenceNoHandleLookupStrategy`, and `string[]` entries are type-only
  strategy/key annotations, not materialized runtime arrays or objects.
- Render path: no render/stringification path changed.
- Helper/API surface: removes four private no-op index handle helpers and adds
  one private type guard, `isReferenceHandleLookupStrategy(...)`, so the
  ordinary lookup path can skip handle shape/value-key/source-static prep for
  index reads. The verifier now guards the no-handle index boundary and the
  shared callable reader freshness policy.
- Metadata mutations: none.
- Allocation changes: no new runtime node/materialization allocation is
  introduced. Index target reads no longer run handle shape/value-key/
  source-static handle prep and no longer call through no-op handle
  reader/writer functions. Remaining objects are actual handle values,
  reference context, semantic declaration constraints, and test/verifier
  scaffolding.
- Evidence: focused reference tests prove index target reads clear stale
  handles without handle strategy prep, source-static stable-handle reuse,
  unstable read-mode/filter fall-through, cold handle disqualification under
  searchScope/leaky contexts, reference strategy cache type changes, terminal
  mixin-only invalidation, function/callable ignored declaration options,
  mixin-ruleset cached lookup reuse, source-static declaration assignment
  constraints, and declaration exclusion/output-binding invalidation.
  `@jesscss/core` build passed. `verify:binding-lookup-hot-paths` passed with
  guards against no-op index handle plumbing, index strategy handle hooks,
  stale object-call shapes, deleted handle arg type names, and duplicated
  callable/function reader lookup-type checks.
- Merge-carried serialization review: latest `origin/dev` also carries
  `Rules.toTrimmedString(...)` direct writer ownership in
  `packages/core/src/tree/rules.ts`. Public rules-body source stringification
  now delegates to `writeSyntax(...)` instead of duplicating the visible/
  full-render guard and source-body emitter dispatch. Review-flagged thrown
  errors are focused serialization test scaffolding. No binding lookup runtime
  path changed.
- Merge-carried serialization review: latest `origin/dev` also carries
  `Ruleset.toTrimmedString(...)` direct writer ownership in
  `packages/core/src/tree/ruleset.ts`. Public ruleset source stringification
  now delegates to `writeSyntax(...)` instead of duplicating source-dispatch
  logic around hoist/reference-mode guards and container serialization.
  Review-flagged thrown errors are focused serialization test scaffolding. No
  binding lookup runtime path changed.
- Merge-carried serialization review: latest `origin/dev` also carries
  `SelectorList.toTrimmedString(...)` direct writer ownership in
  `packages/core/src/tree/selector-list.ts`. Public selector-list source
  stringification now delegates to `writeSyntax(...)` instead of a duplicated
  private `renderSelectorListSyntax(...)` helper. Review-flagged thrown errors
  are focused serialization test scaffolding, and the touched
  `withSelectors(...)` / `createEvaluatedSelectorListSurface(...)` helpers are
  pre-existing public evaluated-surface behavior. No binding lookup runtime
  path changed.
- Merge-carried serialization review: latest `origin/dev` also carries
  `Reference.toTrimmedString(...)` direct writer ownership in
  `packages/core/src/tree/reference.ts`. Public reference source
  stringification now delegates to `writeSyntax(...)` instead of a duplicated
  private `renderReferenceSyntax(...)` helper. Review-flagged thrown errors
  are focused serialization test scaffolding. No binding lookup runtime path
  changed.
- Merge-carried serialization review: latest `origin/dev` also carries
  `Call.toTrimmedString(...)` direct writer ownership in
  `packages/core/src/tree/call.ts`. Public call source stringification now
  delegates to `writeSyntax(...)` instead of duplicating source assembly.
  Review-flagged `try/finally` and thrown errors are focused serialization
  test scaffolding. No binding lookup runtime path changed.
- Merge-carried serialization review: latest `origin/dev` also carries
  AtRule/Ruleset public-string-wrapper assertion tests in
  `packages/core/src/tree/__tests__/at-rule.test.ts` and
  `packages/core/src/tree/__tests__/ruleset.test.ts`. Review-flagged
  `CountingWriter`, thrown errors, and `try/finally` are focused
  serialization proof scaffolding around public wrapper bypass checks. No
  binding lookup runtime path changed.
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
