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

- Latest pass: `AtRule` render-dispatch helper split.
- Verdict: accepted as a bounded serializer cut inside the active `AtRule`
  row. `AtRule.render(...)` no longer allocates per-call local closures to
  serialize evaluated at-rules, body-eval records, and leaf-render records; it
  now dispatches through node-private methods that own the render-state
  override boundary and the evaluated-value shape directly. No speed claim.
- New traversal: none.
- Review-flagged allocations: none added on the render path. The existing
  print-state override fields are still used, but the per-call helper closure
  ladder is gone.
- New node/materialization: none.
- Render path: evaluated at-rules, owned body-state records, and leaf render
  records still render through the same direct serializer and render-buffer
  paths; only the dispatch shape changed from local closures to node-private
  methods.
- Helper/API surface: three node-private methods,
  `renderSerializedAtRule(...)`, `renderBodyRecord(...)`, and
  `renderEvaluatedValue(...)`, replace the open-coded local render closures in
  `render(...)` without adding public API.
- Metadata mutations: none added.
- Routine error control: one existing-style `try/finally` render-state restore
  boundary remains in `renderSerializedAtRule(...)` so temporary print-state
  overrides are always restored if container serialization throws. It is not a
  semantic branch ladder.
- Allocation changes: deleted the local `renderEvaluatedAtRule(...)`,
  `renderBodyResult(...)`, and `renderEvaluated(...)` closures that `render()`
  rebuilt on each call. The remaining `runtimeFrames?: (Ruleset | AtRule)[]`
  parameter is the already-carried frame override itself, not a newly
  materialized frame array.
- Evidence: focused `at-rule.test.ts` coverage passed for resolved direct
  render, owned body-state render, root-only hoist render, owned
  collapse-nesting render without temporary derivation, and owned
  collapse-nesting serialization without source frame getters. Full
  `at-rule.test.ts`, `git diff --check`, and
  `pnpm --filter @jesscss/core build` also passed. The current
  `verify:aggressive-cutting-review` run still flags the restoration
  `try/finally` and the carried `runtimeFrames` parameter for prosecution, but
  no new node/materialization path was introduced.
- Latest pass: `Rules` child-wrapper position probe split.
- Verdict: accepted as a bounded serializer cut inside the active `Rules`
  row. Child `Rules` wrappers inside `_emitRulesBody(...)` no longer spend a
  writer mark plus `hasContentSince(...)` scan just to detect whether the child
  body emitted anything; that path never needed restore semantics, so it now
  uses a plain writer-position snapshot instead. No speed claim.
- New traversal: none.
- Review-flagged allocations: none added on the render/source path.
- Review-flagged diff tokens: the current diff still contains test-only
  context/writer scaffolding in `rules-streaming.test.ts` for the focused
  wrapper-mark regression proof. No new production node or writer
  construction was added by this pass.
- New node/materialization: none.
- Render path: child `Rules` wrappers still emit their owned source/render
  body directly and still skip public wrapper transport. The change only
  removes the wrapper-local emission probe scaffolding.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the child-wrapper `mark()` plus
  `hasContentSince(...)` / `restore(...)` probe in `Rules._emitRulesBody(...)`
  and replaced it with a writer-position comparison.
- Evidence: focused red-to-green proof came from
  `rules-streaming.test.ts` case
  `does not spend an extra wrapper mark to detect child Rules source emission`.
  Targeted `rules.test.ts` coverage for
  `streams child Rules wrappers without previewing public source strings` and
  `streams child Rules wrappers without previewing public render output`
  also passed. Full batch gates still need to run after this handoff update.
- Latest pass: `Call` dynamic target/emit ladder split.
- Verdict: accepted as a bounded serializer cut inside the active `Call`
  row. Dynamic call render no longer re-spells the same mixin-ruleset target
  resolution sequence across optional fallback render, optional fallback eval,
  and dynamic render, and it no longer repeats the same string-versus-node
  output handoff ladder at each branch return site. Two node-private helpers
  now own those exact existing shapes without widening semantics. No speed
  claim.
- New traversal: none. The dynamic target helper performs the same one target
  evaluation plus existing mixin-ruleset follow-up that the duplicated sites
  already performed.
- Review-flagged allocations: none added on the render path. The new helpers
  only route existing return values and target evaluation.
- Review-flagged diff token: the current diff still contains the older
  declaration detached-path handoff note naming the detached declaration
  writer boundary in
  `packages/core/src/tree/util/serialize-helper.ts`. This `Call` pass did not
  add any new writer construction in production code.
- New node/materialization: none.
- Render path: dynamic render still returns the same finalized optional-call
  syntax strings and the same node outputs; the change only centralizes target
  resolution and string-or-node emission so the covered path stops repeating
  that branch ladder.
- Helper/API surface: two node-private methods,
  `resolveDynamicCallTarget(...)` and `renderDynamicOutputResult(...)`,
  replace three duplicated target-resolution blocks and four repeated
  string-versus-node output ladders inside `renderDynamicFunctionOutput(...)`
  plus the optional fallback helpers. No public API changed.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the repeated local dynamic target resolution
  scaffolding and repeated shared-writer `writeRenderTextResult(...)` ladders
  inside `renderDynamicFunctionOutput(...)`.
- Evidence: full `call.test.ts` passed, covering dynamic stylesheet
  functions, mixin/ruleset/collection targets, silent-fail finalized syntax,
  optional fallback content, dynamic CSS-call names, and flat-buffer render
  output. `pnpm --filter @jesscss/core build` also passed. Full batch gates
  still need to run after this handoff update.
- Latest pass: `Call` known-text staging loop split.
- Verdict: accepted as a bounded serializer cut inside the active `Call`
  row. The exact source/render fast-path helpers no longer allocate temporary
  string arrays for `List`, `Sequence`, and exact `QueryCondition` children
  just to decide whether call names/args/content can emit directly. They now
  build known text through straight loops and joiner writes while preserving
  the existing cold non-exact path when any child is not exact. No speed
  claim.
- New traversal: none. The helpers still walk the same children once; they now
  append into one local string instead of materializing a sibling string array
  and joining it afterward.
- Review-flagged allocations: none beyond the existing local strings already
  required to return exact known text.
- New node/materialization: none.
- Render path: no semantic optional-call or non-exact render behavior changed.
  Covered call source/render exact text paths still return direct known text
  for list, sequence, operation, and query-condition cases; only the temporary
  array staging inside the exact-text helper was removed.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the temporary `parts` arrays and `join(...)`
  staging from both `getKnownSourceCallText(...)` and
  `getKnownRenderedCallText(...)` for `List`, `Sequence`, and exact
  `QueryCondition` nodes.
- Evidence: focused `call.test.ts` coverage passed for scalar list source args,
  escaped scalar list source args, exact operation source args, exact
  query-condition call content, scalar list render args, scalar sequence render
  args, and exact query-condition render args. Full `call.test.ts` plus batch
  gates still need to run after this handoff update.
- Latest pass: binding merge/version proof, source-static handle slimming, and
  namespace/profile closeout.
- Verdict: accepted as a focused registryless binding pass. Property
  merge-chain handles now have same-key invalidation and unrelated-key reuse
  proof, setDefined variable occurrence fallback no longer allocates an
  options-spread shape to disable live bindings, and declaration-family
  source-static handle reads validate the cheap common handle shape before
  computing declaration constraint snapshots. Namespace terminal/remainder
  items were closed from existing focused proof, and the stale wording/profile
  audit leaves callable direct-crawl bridges as the main remaining binding
  target. No speed claim.
- New traversal: none.
- New node/materialization: none in production. The new merge-chain proof uses
  a test-only `declarationBridgeHits` array to spy on public declaration bridge
  calls.
- Render path: no render path changed.
- Helper/API surface: one private strategy constant,
  `VARIABLE_OCCURRENCE_LOOKUP`, replaces a per-call options object for the
  setDefined occurrence fallback. It does not add public API.
- Metadata mutations: none added.
- Routine error control: none in production. The merge-chain bridge-spy test
  uses `try/finally` only to restore `Rules.prototype.find` after the spy.
- Allocation changes: deleted the setDefined variable fallback options-spread
  allocation and delayed declaration constraint snapshot allocation until
  source-static declaration-family handle reads have a plausible common handle.
  The one new production object is the module-level
  `VARIABLE_OCCURRENCE_LOOKUP` strategy constant, created once so the hot
  fallback call does not allocate a patched options object.
- Evidence: focused setDefined tests, merge-chain/property handle tests,
  style-import/dynamic promotion tests, source-static handle tests,
  terminal namespace/remainder tests, and `verify:binding-lookup-hot-paths`
  passed. `scope-lookup-stress.less` profile reported empty old
  `Rules.find`/registry/search-children counters with direct counters
  explained in `BINDING-LOOKUP-REMAINING.md`. Full batch gates still need to
  run after this handoff update.
- Latest pass: `AtRule` no-trivia frame-header direct write split.
- Verdict: accepted as a bounded serializer cut inside the active `AtRule`
  row. No-trivia at-rule frame opens in `serializeRulesContainer(...)` no
  longer route through `getHeaderString(...)`; they now write directly through
  `AtRule.writeHeader(...)` and leave detached header-string assembly for
  comparable-header and comment/trivia paths only. No speed claim.
- New traversal: none.
- Review-flagged allocations: none on the new no-trivia frame-open path. The
  existing detached writer boundaries remain isolated to comparable-header and
  comment-bearing header formatting.
- New node/materialization: none.
- Render path: container frame-open emission now writes name/prelude/block-open
  syntax directly into the active writer when trivia is off, matching the
  existing `Ruleset.writeHeader(...)` fast path. Full header-string assembly
  still owns comparable-header and trivia/comment formatting paths.
- Helper/API surface: one node-local helper method, `AtRule.writeHeader(...)`.
  It removes a hot serializer call back through `getHeaderString(...)` and
  mirrors the existing ruleset frame-open contract instead of adding a new
  public wrapper.
- Metadata mutations: none added.
- Routine error control: none on the production path. The focused test uses a
  `try/finally` wrapper only to restore the temporary `getHeaderString(...)`
  override.
- Allocation changes: no new nodes, wrappers, or carried caches.
- Evidence: focused `at-rule.test.ts` coverage now proves
  `serializeRulesContainer` opens no-trivia at-rule frames without touching
  `getHeaderString(...)`, while the existing repeated comparable-header and
  comment-trivia tests still pass. Full `at-rule.test.ts`, `git diff --check`,
  and `pnpm --filter @jesscss/core build` also passed. The current
  `verify:aggressive-cutting-review` run still reports unrelated existing
  binding/lookup worktree tokens plus the focused test's cold `new
  OutputWriter()` allocation; this pass adds no new hot-path node creation or
  metadata mutation beyond the pre-existing trivia-source probe reused from
  `getHeaderString(...)`.
- Latest pass: binding declaration visibility plus compound callable remainder
  proof.
- Verdict: accepted as a focused registryless binding pass. Declaration lookup
  gained property-side reference-import child-surface proof, and callable
  namespace lookup now consumes exact compound-selector remainder entries from
  existing callable buckets instead of falling through to a missing callable
  result or cold remainder-array fallback. No speed claim.
- New traversal: one small bucket scan helper,
  `collectCallableBucketRemainderResults(...)`, plus an inner match loop over
  the already-carried `CallableLookupEntry.match` array. This is bounded to the
  bucket the lookup already read and replaces rediscovery through broader
  namespace fallback.
- New node/materialization: none in production. Test fixtures construct small
  `Rules`/declaration/ruleset trees only as behavior probes.
- Render path: no production render path changed. Existing render-based complex
  selector tests now reach rendering instead of throwing missing-mixin lookup
  errors; current `origin/dev` still has unrelated whitespace drift there.
- Helper/API surface: one private module helper,
  `collectCallableBucketRemainderResults(...)`, reusing the existing callable
  entry model and avoiding a public wrapper or generated remainder array.
- Metadata mutations: none in production. Tests temporarily replace child
  `value` accessors and restore them in `finally` blocks to prove direct
  declaration lookup does or does not read a child surface.
- Evidence: focused `reference.test.ts` cases
  `direct property reference-import miss does not widen ordinary variable child
  scans`, `direct property lookup still skips children without property or
  reference-import surfaces`, and
  `direct complex selector callable lookup consumes compound selector remainder
  entries` passed. The real import fixture
  `import-reference: real hit and miss refs avoid public declaration bridges`
  also passed and kept public `Rules.find('declaration', ...)` bridge hits at
  zero. `verify:binding-lookup-hot-paths` passed.
- Latest pass: `Rules` root document render transport split.
- Verdict: accepted as a bounded serializer cut inside the active `Rules`
  row. Root `Rules.render(...)` and render-buffer output no longer route
  `@charset` / hoisted import document output through the public
  `Rules.toString(...)` wrapper; they now use a cold internal document-string
  boundary while keeping the existing source document serializer intact. No
  speed claim.
- New traversal: none.
- Review-flagged allocations: none beyond the pre-existing writer mark/readback
  at the cold root document-string boundary.
- New node/materialization: none.
- Render path: root render/string and root render-buffer output now call the
  internal `Rules._toDocumentString(...)` boundary instead of public
  `Rules.toString(...)` when root document semantics own `@charset` /
  top-import ordering. Non-root `Rules` render behavior is unchanged.
- Helper/API surface: one internal helper, `Rules._toDocumentString(...)`,
  which isolates the existing root document serializer from the public
  `toString(...)` wrapper so render paths can bypass the public transport
  without duplicating document-order logic.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: no new nodes, wrappers, or carried caches.
- Evidence: focused and full `rules.test.ts` coverage now proves root
  string render and render-buffer output preserve `@charset` / `@import`
  ordering while staying off public `Rules.toString(...)`, and the existing
  root no-capture serializer test still passes. `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` still need to run after this handoff update.
- Latest pass: `AtRule` comparable-header and boundary-trivia split.
- Verdict: accepted as a bounded serializer cut inside the active `AtRule`
  row. Frame comparison in `serializeRulesContainer(...)` no longer routes the
  hot repeated-header path through full `getHeaderString(..., true)` assembly,
  and comment-bearing header boundaries now explicitly own the name-to-prelude
  trivia gap instead of depending on detached prelude rendering to rediscover
  it. No speed claim.
- New traversal: none.
- Review-flagged allocations: detached `OutputWriter` boundaries remain for
  comment-bearing header fragments and the explicit name-to-prelude trivia
  bridge. They stay isolated to cold comparable-header/comment paths and
  replace caller-writer rollback/preview transport.
- New node/materialization: none.
- Render path: `AtRule.getComparableHeaderString(...)` now owns the repeated
  frame-compare key, while `getHeaderString(...)` emits explicit boundary
  trivia between `name` and `prelude` before writing the detached prelude text.
  The hot container-merge comparison now reads those comparable keys directly.
- Helper/API surface: one node-local helper,
  `renderAtRuleBetweenNameAndPreludeTrivia(...)`, plus
  `AtRule.getComparableHeaderString(...)`. Both isolate comment/comparison-only
  work away from the main header formatter and replace broader full-header
  formatting on repeated-frame checks.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: no node copies, wrapper materialization, or carried
  caches; only the detached comment/comparison writers above.
- Evidence: focused `at-rule.test.ts` now proves repeated frame comparisons
  call `getComparableHeaderString(...)` instead of `getHeaderString(..., true)`,
  dynamic leaf preludes still avoid at-rule eval transport, and
  `@-webkit-keyframes /* Safari */ hover /* and Chrome */ {` preserves the
  interstitial comment gap. Full `at-rule.test.ts`, focused `ruleset.test.ts`
  repeated-header coverage, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` still need to run after this handoff
  update.
- Latest pass: `Call` calc render-frame alignment.
- Verdict: accepted as a bounded render-behavior cut inside the active `Call`
  serialization lane. Plain/buffer calc render no longer takes the exact-text
  shortcut for `Operation` args that need calc evaluation, and dynamic
  finalized calc names now establish calc frames before rendering args. This
  keeps direct/buffer calc normalization aligned with the live call tests while
  preserving the explicit-writer exact operation syntax path. No speed claim.
- New traversal: none.
- Review-flagged allocations: none beyond one tiny render-options record on the
  render path.
- New node/materialization: none.
- Render path: `Call.writeRenderedArgs(...)` now gates the exact `Operation`
  text shortcut on whether the active render mode is preserving explicit writer
  syntax or evaluating calc args. `renderFinalizedCallSyntax(...)` now mirrors
  the calc-frame setup/cleanup already used by plain call render so dynamic
  calc names normalize their args on the same path.
- Helper/API surface: one tiny render-options record,
  `CallRenderArgOptions`, plus `getRenderedCallNameText(...)` to classify calc
  names without re-evaluating them. This removes special-case drift between the
  plain and finalized render branches.
- Metadata mutations: none added.
- Routine error control: existing calc-frame cleanup `try/catch` and rejection
  handling were widened to cover finalized calc render too; no new routine
  fallback/error channel was introduced.
- Allocation changes: none meaningful beyond the tiny render-options object; no
  node copies or wrapper materialization added.
- Evidence: focused `call.test.ts` coverage now proves the explicit-writer
  exact operation path stays `calc(10px + 5px)`, direct and buffer calc render
  reduce safe arithmetic to `calc(20px)` / `calc(15vh)`, and dynamic calc
  names still evaluate the name once. Full `call.test.ts`, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` still need to run after this handoff
  update.
- Latest pass: binding changed-baseline closeout after gate cleanup.
- Verdict: accepted as a documentation-only binding closeout. The binding-owned
  changed-baseline audit is complete: the prior selector-pseudo frontier
  blocker is fixed, smoke/profile evidence is refreshed, and the only remaining
  full-baseline blocker is pre-existing `Call` serialization/render fallout
  that reproduces with the latest diff reversed on clean `53ffb2baf`. No
  lookup runtime change. No speed claim.
- New traversal: none.
- Review-flagged allocations: none in this docs-only pass.
- New node/materialization: none in this docs-only pass.
- Render path: no render/stringification path changed.
- Helper/API surface: none in this docs-only pass.
- Metadata mutations: none in this docs-only pass.
- Allocation changes: none in this docs-only pass.
- Evidence: `BINDING-LOOKUP-REMAINING.md` has no unchecked binding rows.
  Focused rerun of representative `call.test.ts` failures still shows the
  non-lookup writer-mark/readback and `root.register(...)` failures. Prior
  batch evidence remains: focused pseudo/cloning tests passed,
  `verify:node-copy-frontier` passed, `verify:binding-lookup-hot-paths`
  passed, `verify:aggressive-cutting-review` passed, core build passed, lookup
  profile reported empty old `Rules.find`/registry counters, and one-iteration
  hotpath smoke was usable after rebuilding parser/Jess/plugin-js libs. No
  wall-clock performance claim.
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
  declaration detached preview-transport cut in
  `packages/core/src/tree/util/serialize-helper.ts`. Review-flagged
  the detached declaration writer boundary
  that replaces caller-writer preview transport. Review-flagged
  `new CountingWriter()` and `try/finally` are focused `ruleset.test.ts`
  scaffolding for restoring swapped methods around detached-writer assertions.
  No binding lookup runtime path changed.
- Merge-carried serialization review: latest `origin/dev` also carries the
  Ruleset frame-header compare-key split in
  `packages/core/src/tree/ruleset.ts` and
  `packages/core/src/tree/util/serialize-helper.ts`.
- Merge-carried serialization review: latest `origin/dev` also carries the
  AtRule comparable-header split in `packages/core/src/tree/at-rule.ts`,
  `packages/core/src/tree/util/serialize-helper.ts`, and
  `packages/core/src/tree/__tests__/at-rule.test.ts`. Repeated at-rule frame
  comparison now reads `AtRule.getComparableHeaderString(...)` instead of full
  `getHeaderString(..., true)` output, and comment-bearing header boundaries
  explicitly emit name-to-prelude trivia so detached prelude rendering no
  longer drops interstitial comments. Review-flagged detached writers,
  `CountingWriter`, thrown errors, and `try/finally` are focused serialization
  proof scaffolding or bounded comment/comparison string boundaries. No
  binding lookup runtime path changed.
- Merge-carried serialization review: latest `origin/dev` also carries the
  duplicate declaration comparison writer cut in
  `packages/core/src/tree/util/serialize-helper.ts`. Review-flagged
  the detached duplicate-comparison writer boundary is the existing string
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
  declaration detached direct-writer cut in
  `packages/core/src/tree/util/serialize-helper.ts`. Declaration detached path
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
