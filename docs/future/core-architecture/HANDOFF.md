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

- Latest pass: `Call` exact negative text carry.
- Verdict: accepted as a localized exact-text carry cut. Built-in `Negative`
  nodes now participate in `Call`'s known source/render text helpers, so exact
  negative args/content stay off both the source arg fallback path and the
  render-side fallback readback boundary. No speed claim.
- New traversal: one recursive step in `getKnownRenderedCallText(...)` and one
  recursive step in `getKnownSourceCallText(...)` for `Negative.node`.
- New node/materialization: none.
- Render path: covered negative args/content now write their carried text
  directly on plain/finalized render instead of dropping into the fallback
  child mark/readback path.
- Helper/API surface: no new helper; this pass only widens the existing known
  source/render text helpers.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none new beyond the existing helper recursion; this pass
  deletes covered negative fallback readback reliance instead of adding a new
  boundary.
- Rejected/observed in this pass: this only covers built-in `Negative` syntax
  surfaces that recursively resolve to known call text. It does not widen to
  arbitrary wrapper nodes or custom negative-like subclasses.
- Evidence: focused `call.test.ts` coverage now proves exact negative source
  args write with zero marks/readbacks, and exact negative args/content render
  with zero marks/readbacks on the covered path. Full commit-boundary gates
  still need to run after this handoff update.
- Latest pass: `Call` trivia-bearing source arg direct-write path.
- Verdict: accepted as a localized source-writer cut. `Call.writeSyntax(...)`
  now writes trivia-bearing source args item-by-item with explicit separator
  trivia emission instead of routing the whole arg list through
  `args.writeSyntax(...)` plus an outer trim window. The no-trivia source path
  stays on the previously widened direct arg loop. No speed claim.
- New traversal: one existing indexed source arg loop now also owns the
  trivia-bearing path; no new broad traversal beyond explicit per-item arg
  emission.
- New node/materialization: none.
- Render path: none changed; this pass is source serialization only.
- Helper/API surface: two node-local helpers,
  `emitCallArgSyntax(...)` and `emitCallArgSeparator(...)`, to keep the call
  source writer responsible for argument-boundary emission instead of routing
  through `List.writeSyntax(...)`.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none new; this pass deletes the trivia-bearing arg-list
  mark/trim boundary from `Call.writeSyntax(...)` and replaces it with direct
  child writes plus explicit trivia consumption on the active writer.
- Rejected/observed in this pass: render-side custom/name/content fallback
  readbacks remain; this cut only changes source serialization.
- Evidence: focused `call.test.ts` coverage now proves explicit-empty source
  args, exact scalar/list source args, custom no-trivia source args, separator
  comment trivia, and trivia-bearing source args all write with zero marks and
  zero readbacks on the source path. Full commit-boundary gates still need to
  run after this handoff update.
- Latest pass: `AtRule` no-trivia leaf direct-write widening.
- Verdict: accepted as a bounded leaf-header transport cut. No-trivia leaf
  at-rules now keep both scalar and non-scalar comment-free headers off
  `getHeaderString(...)`: `AtRule.writeSyntax(...)` owns the leaf header
  directly, and `serializeRulesContainer(...)` trusts `node.writeSyntax(...)`
  for leaf output instead of calling `getHeaderString(...)` itself.
  Comment-bearing leaf headers still stay on the detached string path. No speed
  claim.
- New traversal: none.
- New node/materialization: none.
- Render path: serializer leaf at-rule output now goes through the node-owned
  `writeSyntax(...)` boundary, so the active writer sees the leaf syntax
  directly when the node can emit it directly. Comment-free no-trivia non-scalar
  leaf headers now use localized caller-writer capture instead of detached
  header-string transport; comment-bearing leaf headers still fall back inside
  `AtRule.writeSyntax(...)` to `getHeaderString(...)`.
- Helper/API surface: one node-local helper,
  `writeDirectLeafAtRuleHeader(...)`, widened to cover comment-free no-trivia
  non-scalar leaf headers while keeping the detached header helper for the
  remaining comment-bearing cases.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none new on the direct leaf path beyond localized
  caller-writer mark/read/restore for comment-free no-trivia non-scalar header
  fragments; this pass keeps detached string allocation only for the remaining
  comment-bearing leaf header cases.
- Rejected/observed in this pass: this does not yet rewrite comment-bearing
  header fragment capture, post-prelude comment trivia, or body/header string
  assembly.
- Evidence: focused `at-rule.test.ts` and `ruleset.test.ts` coverage now proves
  scalar leaf at-rules write with zero marks/reads/restores and avoid
  `getHeaderString(...)`, no-trivia non-scalar leaf at-rules also avoid
  `getHeaderString(...)`, and static ruleset source/render paths with leaf
  at-rules still succeed even when `leaf.getHeaderString(...)` is poisoned.
  Full commit-boundary gates still need to run after this handoff update.
- Latest pass: `Call` no-trivia source arg direct-write fallback.
- Verdict: accepted as a localized source-writer cut. `Call.writeSyntax(...)`
  now writes no-trivia source args directly item-by-item even when they fall
  off the exact known-text path, instead of routing non-exact/custom args
  through `args.writeSyntax(...)` plus an inner arg-list mark/trim window. The
  trivia-bearing path still keeps the localized list writer boundary. No speed
  claim.
- New traversal: none beyond the existing indexed no-trivia arg loop now owning
  both exact and fallback source arg emission.
- New node/materialization: none.
- Render path: none changed; this pass is source serialization only.
- Helper/API surface: no new helper.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none new; this pass deletes the no-trivia inner arg-list
  mark/trim fallback from `Call.writeSyntax(...)` for custom/non-exact source
  args while leaving the trivia path untouched.
- Rejected/observed in this pass: public `toTrimmedString(...)` still uses its
  cold whole-call mark/readback boundary after the exact-source fast path, and
  trivia-bearing source args still route through the localized list writer path.
- Evidence: focused `call.test.ts` coverage now proves explicit-empty source
  args, exact scalar/list source args, exact content, and custom no-trivia
  source args all write with zero marks/readbacks, while the exact-source
  `toTrimmedString(...)` fast path is explicitly pinned as no longer falling
  through `writeSyntax(...)`. Full commit-boundary gates still need to run
  after this handoff update.
- Latest pass: `Ruleset` no-trivia header direct-write reopen path.
- Verdict: accepted as a bounded header transport cut. `serializeRulesContainer(...)`
  now lets no-trivia `Ruleset` frame opens write the header directly into the
  active writer instead of routing that hot render path through
  `Ruleset.getHeaderString(...)` string transport. The compare-key path stays on
  `getComparableHeaderString(...)`, and comment/trivia-bearing header formatting
  remains on the detached-string path where normalization still matters. No
  speed claim.
- New traversal: none.
- New node/materialization: none.
- Render path: no-trivia ruleset frame opens now call `Ruleset.writeHeader(...)`
  directly from `serializeRulesContainer(...)`, so the active writer receives
  indent, selector syntax, and ` {`/newline pieces without a temporary header
  string. Commentless comparable-header checks remain string-based, and
  comment/trivia-bearing header writes still use the older detached string path.
- Helper/API surface: one node-local `Ruleset.writeHeader(...)` helper plus an
  internal `writeHeaderSelector(...)` split so the direct writer path and the
  existing cold string helpers share selector filtering/composition logic
  instead of duplicating it.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: one direct-writer sentinel in the serializer frame-header
  cache replaces storing the full header string for no-trivia ruleset opens on
  the active path. Detached `OutputWriter` allocation remains only for
  comparable-header reads and comment/trivia normalization paths.
- Rejected/observed in this pass: the initial comment/trivia-bearing header
  open path still uses `getHeaderString(...)` because `normalizeIndent(...)` /
  `normalizeLeadingBlockTrivia(...)` remain string-shaped ownership boundaries.
  Hoisted-parent header strings also stay detached in this pass.
- Evidence: focused `ruleset.test.ts` and `rules.test.ts` coverage now proves
  `serializeRulesContainer(...)` still uses ruleset header composition, repeated
  same-selector rulesets still compare through `getComparableHeaderString(...)`
  with zero `getHeaderString(..., true)` calls, the new no-trivia single-ruleset
  open path avoids `getHeaderString(...)` entirely, and sibling ruleset braces
  remain intact when declarations render through active context output. Full
  commit-boundary gates still need to run after this handoff update.
- Latest pass: `Call` fallback child-local render return carry.
- Verdict: accepted as a localized render-return cut. Plain/finalized `Call`
  render now keeps a local return string alive even after exact-text coverage
  falls cold, by appending child-local emitted slices as fallback args/content
  are written instead of dropping `textState` cold and returning
  `w.getSince(mark)` for the whole call at the end. Covered exact/plain call
  render paths still drop the old outer call-level mark; custom/non-exact
  fallback children keep their existing localized child mark/readback only to
  recover the emitted slice after trim. No speed claim.
- New traversal: none.
- New node/materialization: none.
- Render path: exact/plain/finalized call render still writes to the active
  writer directly, but returned text now comes from carried local state rather
  than a whole-call writer readback. Non-exact/custom fallback arg/content
  branches now append their local child slice into that carried text state
  instead of dropping back to outer readback, while still using local child
  mark windows where they need the exact emitted slice after trim.
- Helper/API surface: no new helper.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none new beyond the existing child-local mark windows;
  this pass deletes the outer call-level readback boundary and the exact-path
  outer call-level mark on covered render paths, but keeps the localized child
  windows for custom/non-exact fallback slice recovery.
- Rejected/observed in this pass: custom/non-scalar child surfaces still keep
  their localized child readback where the exact emitted slice must be recovered
  after trimming or fallback syntax writes; this pass only makes those child
  slices feed the local call return string instead of reintroducing whole-call
  readback. This cut does not yet change the broader callable-output or
  metadata-function lanes.
- Evidence: focused `call.test.ts` coverage now proves shared flat-buffer plain
  CSS calls, exact paren/quoted/operation/query-condition render args, exact
  paren/quoted content, scalar list/sequence/color args, evaluated scalar names,
  async scalar arg/content renders, and prefixed-writer custom fallback
  arg/content paths all return the correct local call text. Covered exact/plain
  paths stay at zero outer call marks/readbacks, while custom fallback paths
  keep one localized child mark/readback and no longer return prefixed writer
  contents. Full commit-boundary gates still need to run after this handoff
  update.
- Latest pass: `Call` exact operation/query-condition text carry.
- Verdict: accepted as a localized exact-text carry cut. `Call`'s known source
  and render text helpers now cover exact `Dimension`, `Operation`, and
  `QueryCondition` surfaces, so those covered args/content stay off the
  whole-call readback boundary and the inner arg trim/readback fallback. No
  speed claim.
- New traversal: one recursive helper descent in `getKnownRenderedCallText(...)`
  and one in `getKnownSourceCallText(...)` for exact `Operation` and
  `QueryCondition` nodes, plus direct scalar reads for `Dimension`. These only
  run on the exact-text branch.
- New node/materialization: none.
- Render path: covered exact operation args and exact query-condition args now
  return known text directly through the existing call text path instead of
  dropping `textState` cold and reading back the whole call; exact
  query-condition content now also stays on the source helper path for public
  source serialization.
- Helper/API surface: no new helper. This pass extends the existing known-text
  helpers instead of adding another call-only adapter.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none beyond the existing helper recursion/part arrays; the
  pass deletes covered whole-call readback reliance for those exact surfaces.
- Rejected/observed in this pass: render-time `Condition`/`QueryCondition`
  semantics that evaluate to booleans stay on the runtime render contract; this
  cut only covers exact syntax surfaces that actually remain syntax at the call
  boundary.
- Evidence: focused `call.test.ts` coverage now proves exact operation source
  args serialize as `calc(10px + 5px)` with zero marks/readbacks, exact
  operation render args return `calc(10px + 5px)` with one outer call mark and
  zero readbacks, and exact query-condition args/content stay off whole-call
  readback on the covered source/render paths. Full commit-boundary gates still
  need to run after this handoff update.
- Latest pass: `QueryCondition` static fallback local return window.
- Verdict: accepted as a localized static render-return cut. When exact direct
  query text is unavailable, static `QueryCondition` render now returns the
  local query slice through a mark/getSince window instead of returning the
  whole prepared writer state via `toString()`. That fixes prefixed-writer
  contamination on the custom/static fallback path while keeping the existing
  child-level fallback semantics. No speed claim.
- New traversal: none.
- New node/materialization: none.
- Render path: static fallback render still writes through the same child
  syntax writer and child-local fallback branches, but the outer query return
  now comes from the query's own writer boundary instead of whole-writer
  readback.
- Helper/API surface: no new helper.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none new beyond the existing local mark/readback window;
  this pass deletes the outer dependency on whole prepared writer state for
  static fallback return values.
- Rejected/observed in this pass: this does not change the child-level static
  fallback inside `writeStaticChild(...)`; custom/static children still keep
  their localized mark/readback path until their own syntax contracts are made
  direct.
- Evidence: focused `query-condition.test.ts` coverage now proves a custom
  static `Paren` fallback returns `screen and (custom)` even when the provided
  writer already contains `prefix|`, while the existing custom fallback
  mark/read counts and covered direct static/dynamic return tests remain green.
  Full commit-boundary gates still need to run after this handoff update.
- Latest pass: `QueryCondition` built-in dynamic child readback cut.
- Verdict: accepted as a localized dynamic child render cut. Covered built-in
  `QueryCondition` children now trust their own returned render text when they
  write into the active writer, instead of reading the child slice back through
  `getSince(...)`. Custom subclasses and instance-owned dynamic render
  overrides still keep the localized fallback when written text may differ from
  returned text. No speed claim.
- New traversal: none.
- New node/materialization: none.
- Render path: built-in dynamic `Operation`, `Condition`, base `Paren`, and
  nested `QueryCondition` children now return their own rendered text even when
  they emitted into the shared writer first; only custom/instance-owned
  children still read the writer back on divergence-sensitive paths.
- Helper/API surface: one node-local whitelist helper,
  `canTrustDynamicChildRenderText(...)`, to keep the covered built-in contract
  narrow and leave custom overrides on the existing fallback.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none new; this pass deletes the localized `getSince(...)`
  readback for covered built-in dynamic children and leaves the custom
  divergence fallback in place.
- Rejected/observed in this pass: this does not widen to `Reference` or other
  nodes whose render contract can still depend on delegated/custom output.
  Custom dynamic children that write different text than they return continue
  to use the existing readback path.
- Evidence: focused `query-condition.test.ts` coverage now proves the dynamic
  sync prefixed-writer `Operation` path returns `3 and (color)` with zero
  reads, the async prefixed-writer path remains at zero reads, and the custom
  dynamic write-different-text fallback test still reads once as intended. Full
  commit-boundary gates still need to run after this handoff update.
- Latest pass: `QueryCondition` dynamic render return-text carry.
- Verdict: accepted as a localized render-return cut. Covered dynamic
  `QueryCondition` renders now carry their local query text through the sync
  loop and async rest path instead of returning the whole current writer or
  shared-buffer contents via `toString()`, which fixes prefixed-writer return
  contamination on the dynamic path while preserving direct child writing and
  existing custom fallback behavior. No speed claim.
- New traversal: none.
- New node/materialization: none.
- Render path: sync/async dynamic query rendering still writes directly into
  the active writer, but the returned string is now assembled from the local
  child results instead of reading back the entire writer/buffer state after
  the loop completes.
- Helper/API surface: no new helper. This pass only threads the already-local
  `out` string through the existing async rest method.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: adds one local string accumulator on the covered dynamic
  path and deletes the dependency on whole-writer / whole-buffer readback for
  dynamic return values.
- Rejected/observed in this pass: instance-owned/custom dynamic children still
  keep their existing `hasContentSince(...)` / `getSince(...)` fallback inside
  `renderQueryConditionChild(...)`; this cut only removes the outer
  `w.toString()` return dependency.
- Evidence: focused `query-condition.test.ts` coverage now proves both sync and
  async dynamic query renders return `3 and (color)` / `print and (color)`
  even when the provided writer already contains `prefix|`, while the existing
  zero-mark static-sibling proof and custom dynamic fallback tests remain
  green. The built-in sync dynamic child path still keeps its localized child
  readback where a child writes before returning; this pass only removes the
  outer whole-writer return dependency. Full commit-boundary gates still need
  to run after this handoff update.
- Latest pass: `QueryCondition` dynamic probe mark demotion.
- Verdict: accepted as a localized render-probe cut. Dynamic
  `QueryCondition` child probing now snapshots plain writer positions instead of
  opening real `mark()` boundaries just to detect whether a child wrote, while
  preserving the fallback `getSince(...)` readback when custom children emit
  different text than they return. No speed claim.
- New traversal: none.
- New node/materialization: none.
- Render path: sync/async dynamic child probes still use `hasContentSince(...)`
  and fallback `getSince(...)` where needed, but they no longer allocate mark
  count on ordinary exact/dynamic paths.
- Helper/API surface: no new helper.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deletes probe-only mark usage on dynamic child render
  paths; covered custom return-only / custom-write fallback behavior is
  preserved.
- Rejected/observed in this pass: custom static fallback still keeps its
  explicit mark/readback path, and this pass does not change the broader custom
  render semantics.
- Evidence: focused `query-condition.test.ts` coverage now proves sync and
  async dynamic query renders no longer increment `writer.marks`, while custom
  dynamic return-only and custom dynamic write-different-text cases still keep
  their `hasContentSince(...)` / `getSince(...)` semantics and the custom
  static paren fallback remains unchanged. Full commit-boundary gates still
  need to run after this handoff update.
- Latest pass: `QueryCondition` exact static render return carry.
- Verdict: accepted as a localized render-return cut. Covered static query
  conditions now return their own exact text directly instead of reading whole
  writer/buffer state back via `toString()` on the static path, which fixed
  prefixed-writer/shared-buffer return contamination while preserving shared
  flat-buffer segmentation. No speed claim.
- New traversal: none beyond the exact-source helper reuse already introduced
  in the previous `QueryCondition` pass.
- New node/materialization: none.
- Render path: static render now reuses exact source text for the covered
  no-trivia contract; shared flat buffers still stream child pieces through the
  existing direct syntax writer, but now return the exact query text instead of
  joining all current buffer parts.
- Helper/API surface: no new helper.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none new on the covered path; this pass deletes the
  static-path dependency on whole-writer / whole-buffer string state for
  return values.
- Rejected/observed in this pass: this remains limited to static no-trivia
  query conditions on the exact-source contract. Dynamic child probing and
  custom/static fallback behavior stay where they were.
- Evidence: focused `query-condition.test.ts` coverage now proves static query
  conditions return `screen and (color)` even when the provided writer or
  shared flat buffer already contains a `prefix|` segment, while the existing
  shared-flat zero-mark path and the custom paren fallback proof remain green.
  Full commit-boundary gates still need to run after this handoff update.
- Latest pass: `QueryCondition` exact source child text carry.
- Verdict: accepted as a localized source-text carry cut. Exact no-trivia query
  conditions now return direct source text for covered scalar, `Condition`,
  `Operation`, base `Paren`, and nested `QueryCondition` children instead of
  always paying the outer `mark()/getSince()` wrapper in
  `QueryCondition.toTrimmedString(...)`. No speed claim.
- New traversal: one recursive exact-source walk in
  `getKnownQueryConditionSourceText(...)` across covered child families. It
  runs only on the no-trivia direct-source branch.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: one node-local `getKnownQueryConditionSourceText(...)`
  helper in `query-condition.ts`. It deletes more whole-condition readback than
  it adds and keeps custom/subclass override surfaces on the existing fallback
  path.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: adds short-lived string-part arrays for covered nested
  `QueryCondition` assembly, but deletes the covered outer source
  `mark()/getSince()` boundary for exact query conditions.
- Rejected/observed in this pass: custom `Operation`/`Condition`/`Paren`
  subclasses still deliberately stay on the fallback path, and render-side
  probing/work remains where it was.
- Evidence: focused `query-condition.test.ts` coverage now proves simple query
  parts, exact `Condition` children, exact `Operation` children, and exact base
  `Paren` children all serialize with zero marks/reads on the covered path,
  while custom override tests still hold the fallback mark/read behavior. Full
  commit-boundary gates still need to run after this handoff update.
- Latest pass: `Call` exact quoted text carry.
- Verdict: accepted as a localized source/render text carry cut. Exact
  `Quoted` values now participate in `Call`'s known source/render text paths,
  so covered quoted args and content stay off fallback writer/readback
  boundaries. No speed claim.
- New traversal: one recursive step in `getKnownRenderedCallText(...)` and one
  recursive step in `getKnownSourceCallText(...)` for exact `Quoted` children.
- New node/materialization: none.
- Render path: covered exact quoted args and content now write known text
  directly; non-exact/custom/interpolated quoted values still use the existing
  generic fallback.
- Helper/API surface: no new helper. This pass extends the existing exact-text
  helpers instead of adding a quoted-only lane.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none beyond the existing exact-text helper recursion; the
  pass deletes covered fallback whole-call readback reliance for exact quoted
  args/content in both source and render paths.
- Rejected/observed in this pass: escaped or interpolated quoted semantics stay
  on the current generic behavior unless the quoted payload is already an exact
  known-text surface.
- Evidence: focused `call.test.ts` coverage now proves exact quoted source args
  serialize as `say(\"hello\", \"world\")` with zero readbacks, and exact
  quoted render args/content stay at one outer call mark with zero readbacks,
  while adjacent exact paren and escaped-source fast paths remain green. Full
  commit-boundary gates still need to run after this handoff update.
- Latest pass: `Call` exact paren render text carry.
- Verdict: accepted as a localized render-text carry cut. Exact rendered
  `Paren` values now participate in `Call`'s known-text path, so covered args
  and content stay off fallback `writeSyntax(...)` plus whole-call readback.
  No speed claim.
- New traversal: one recursive step in `getKnownRenderedCallText(...)` for
  exact `Paren` children. It only runs on the covered exact-text branch after
  value selection.
- New node/materialization: none.
- Render path: covered exact `Paren` args and content now write known text
  directly; non-exact/custom/trivia-bearing paren values still use the
  existing generic render fallback.
- Helper/API surface: no new helper. This pass extends the existing
  `getKnownRenderedCallText(...)` helper instead of adding another paren-only
  path.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none beyond the existing exact-text helper recursion; the
  pass deletes covered fallback whole-call readback reliance for exact paren
  args/content.
- Rejected/observed in this pass: escaped paren render already had its own
  dedicated branch; this cut only closes the remaining exact non-escaped paren
  carry inside the generic known-text path.
- Evidence: focused `call.test.ts` coverage now proves exact paren args render
  as `fn((red 10), 30)` and exact paren content renders as
  `wrap(): (raw content)` with one outer call mark and zero readbacks, while
  adjacent scalar sequence, evaluated scalar name, async scalar content, and
  escaped source fast paths remain green. Full commit-boundary gates still need
  to run after this handoff update.
- Latest pass: `Call` direct source writer exact arg/content carry.
- Verdict: accepted as a localized source-writer cut. `Call.writeSyntax(...)`
  now writes covered exact no-trivia names, args, and content directly instead
  of opening the inner args trim-mark path or routing covered content through
  generic child writers. No speed claim.
- New traversal: one direct arg loop inside `Call.writeSyntax(...)` for the
  covered exact-source path. It replaces the old inner args `mark()/trim` path
  on that exact branch.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: no new helper. This pass reuses the existing
  `getKnownSourceCallText(...)` helper instead of adding another writer-only
  adapter.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: no new hot-path arrays beyond the existing exact-source
  helper allocations from the previous pass; this pass deletes the covered
  writer mark/trim boundary for exact args and the generic child writer hop for
  covered exact content.
- Rejected/observed in this pass: this stays no-trivia and exact-source only.
  Non-scalar/custom/trivia-bearing args or content still use the existing
  generic source writer paths.
- Evidence: focused `call.test.ts` coverage now proves explicit empty args,
  scalar list args, and exact sequence content all write through
  `Call.writeSyntax(...)` with zero marks/readbacks, while the covered
  `toTrimmedString(...)` source fast paths for canonical/scalar/escaped source
  calls remain green. Full commit-boundary gates still need to run after this
  handoff update.
- Latest pass: `Call` exact source text carry.
- Verdict: accepted as a localized source-text carry cut. `Call.toTrimmedString(...)`
  now returns exact scalar/list/sequence/escaped-paren source syntax directly
  for covered no-trivia calls instead of routing the whole call through
  `writeSyntax(...)` plus `mark()/getSince()`. No speed claim.
- New traversal: one recursive exact-source-text walk inside
  `getKnownSourceCallText(...)` for covered `List`/`Sequence`/`Paren`
  descendants, plus one direct arg loop in `Call.toTrimmedString(...)` to
  assemble the covered call source text. These replace the old whole-call
  readback boundary on the exact-source path.
- New node/materialization: none. This pass only derives string text from
  existing source nodes and does not add wrapper calls, copied nodes, or
  detached writer state.
- Render path: unchanged.
- Helper/API surface: one node-local `getKnownSourceCallText(...)` helper in
  `call.ts`. It mirrors the existing render-text carry helper for the covered
  source-only contract and deletes more whole-call readback than it adds.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: adds short-lived string-part arrays for covered exact
  `List`/`Sequence` source text assembly, but deletes the covered whole-call
  source `mark()/getSince()` boundary and the associated writer rollback on
  those paths.
- Rejected/observed in this pass: this cut stays no-trivia and exact-source
  only. Non-scalar/custom/trivia-bearing source args or content still fall back
  to the existing `writeSyntax(...)` path, and source-map granularity on the
  covered fast path remains the coarse call-owned text write rather than
  child-by-child writer ownership.
- Evidence: focused `call.test.ts` coverage now proves canonical function args,
  token args, scalar list args, and escaped scalar list args serialize with
  zero source readbacks, while the canonical source/render split for
  `func(~(a, b); c)` still holds and the adjacent evaluated-name/render direct
  text path remains green. Full commit-boundary gates still need to run after
  this handoff update.
- Latest pass: `Call` evaluated scalar name text carry.
- Verdict: accepted as a localized render-text carry cut. Plain evaluated
  calls whose `name` node is already an exact scalar-text surface now stay on
  the same known-text path as finalized call names instead of forcing
  `writeSyntax(...)` plus fallback whole-call readback for the return string.
  No speed claim.
- New traversal: none.
- New node/materialization: none. This pass reads existing evaluated name text
  and does not add wrapper calls, copied nodes, or detached writer state.
- Render path: `renderPlainFunctionCall(...)` now seeds `textState` from
  `getKnownRenderedCallText(name)` for node-valued names and writes that text
  directly when present, matching the existing finalized-call name path. The
  old direct `writeSyntax(...)` branch remains for non-scalar/custom/trivia
  name nodes that still need generic emission.
- Helper/API surface: no new helper. This pass reuses the existing
  `getKnownRenderedCallText(...)` helper instead of adding another name-only
  wrapper.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: none on the covered path; this pass deletes one covered
  fallback whole-call `getSince(mark)` return dependency for evaluated scalar
  name nodes by keeping `textState` live.
- Rejected/observed in this pass: the cut is limited to plain evaluated calls
  whose `name` already has exact known text. Non-scalar/custom/trivia name
  nodes and other remaining readback paths still stay on their existing
  fallback branches.
- Evidence: focused `call.test.ts` coverage now proves evaluated scalar node
  names render as `rgb(10, 20)` with one outer mark and zero readbacks, while
  adjacent scalar list/sequence arg, token/color arg, async scalar content,
  and baseline plain render behavior still pass. Full commit-boundary gates
  still need to run after this handoff update.
- Latest pass: `Call` recursive scalar list/sequence arg text carry.
- Verdict: accepted as a localized render-text carry cut. Exact rendered
  `List`/`Sequence` CSS-call args whose descendants are already known scalar
  text now stay on the direct text path instead of forcing `textState` cold
  and reopening per-arg or whole-call writer readback boundaries. No speed
  claim.
- New traversal: one recursive exact-text walk inside
  `getKnownRenderedCallText(...)` for exact `List`/`Sequence` arg descendants.
  It only runs on the already-covered direct-text branch after value selection,
  and it replaces the old per-arg trim/readback plus covered whole-call
  readback boundaries for those exact scalar-descendant containers.
- New node/materialization: none. This pass only derives direct string text
  from already-evaluated scalar/list/sequence arg nodes and does not add a
  replacement arg node, copied list, or detached writer boundary.
- Render path: `Call.writeRenderedArgs(...)` still evaluates each arg once, but
  exact rendered `List`/`Sequence` values now flow through the same direct text
  carry as exact scalar leaves. Covered normal and escaped arg renders no
  longer fall back to `writeSyntax(...)` plus trim windows just to recover text
  the node family already structurally owns.
- Helper/API surface: no new public/API surface. The existing
  `getKnownRenderedCallText(...)` helper in `call.ts` now recursively covers
  exact `List`/`Sequence` render text, and the local escaped-paren direct-close
  helper remains.
- Metadata mutations: none added. This pass only changes how already-evaluated
  arg output text is carried.
- Routine error control: none added. Existing sync/async arg evaluation and
  calc cleanup stay in place.
- Allocation changes: adds one short-lived string-parts array for covered exact
  `List`/`Sequence` text assembly, but deletes the covered per-arg
  trim-mark/readback windows and keeps the covered whole-call return off
  `getSince(mark)` by preserving `textState` through those args.
- Rejected/observed in this pass: this remains an exact scalar-descendant cut.
  Non-scalar/custom/trivia list or sequence args still force the existing
  trim/readback fallback, and broader `Call` helper ladders plus other
  remaining render readback paths stay queued.
- Evidence: focused `call.test.ts` coverage now proves canonical source syntax
  still renders as `func(~(a, b); c)`, escaped rendered args still stream
  without capture scaffolding, escaped list args now avoid both the old inner
  trim mark and the fallback whole-call readback, scalar list args now render
  with one outer call mark and zero readbacks, and scalar sequence args now
  avoid the previous nested mark/readback stack entirely. The adjacent focused
  subset covering evaluated escaped arg transport plus token/color/async scalar
  arg direct-write paths also passed. Full commit-boundary gates still need to
  run after this handoff update.
- Latest pass: `Call` escaped paren direct list/sequence arg write.
- Verdict: accepted as a localized render-mark cut. Escaped paren CSS-call
  args that evaluate to direct `List`/`Sequence` syntax no longer open an
  inner trim-mark/readback window just to normalize text before re-closing the
  paren. No speed claim.
- New traversal: none.
- New node/materialization: none. This pass keeps the existing evaluated arg
  node and writes it directly; it does not add a replacement arg node, copied
  list, or detached writer boundary.
- Render path: `Call.writeRenderedArgs(...)` still evaluates escaped paren arg
  values once, but exact scalar results use the known-text fast path and direct
  `List`/`Sequence` results now write syntax straight to the active writer.
  The old trim-mark path remains only for non-scalar/custom/trivia-bearing
  escaped results that still need whitespace cleanup.
- Helper/API surface: one tiny node-local predicate
  `canWriteEscapedParenInnerDirect(...)` and one direct-close helper
  `finishDirectEscapedParenArg(...)` inside `call.ts`. They replace repeated
  branch shape in the covered escaped render path and do not widen public API.
- Metadata mutations: none added. This pass only changes how already-evaluated
  arg output is written.
- Routine error control: none added. Existing sync/async arg evaluation and
  calc cleanup stay in place.
- Allocation changes: deletes one inner writer mark/trim/readback boundary for
  escaped paren args when the evaluated inner node is an exact direct
  `List`/`Sequence` syntax surface or a known scalar text surface.
- Rejected/observed in this pass: the whole-call render return still pays the
  existing outer `getSince(mark)` when a provided writer forces `textState`
  cold after direct child syntax emission; this pass does not claim to remove
  that broader return-string compatibility boundary. Non-scalar/custom/trivia
  escaped arg transport and broader `Call` helper ladders remain queued.
- Evidence: focused `call.test.ts` coverage now proves canonical source syntax
  still renders as `func(~(a, b); c)`, escaped rendered args still stream
  without capture scaffolding, and escaped list args now hold at one writer
  mark instead of the previous nested inner trim mark while preserving direct
  output. The adjacent focused subset covering evaluated escaped arg transport,
  rendered CSS arg streaming, and exact scalar arg trim-mark cuts also passed.
  Full commit-boundary gates still need to run after this handoff update.
- Latest pass: `Call` finalized fallback arg ownership skip.
- Verdict: accepted as a localized ownership cut. The render-only finalized
  fallback path in `Call.evalFromStateInFrame(...)` now tells
  `evalArgNodes(...)` not to own same-identity arg results, so source-free
  static arg containers are not reconstructed just to stringify finalized
  fallback syntax. No speed claim.
- New traversal: none.
- New node/materialization: none added. This pass removes one render-only
  owned-surface construction case by letting the finalized fallback branch
  reuse identity-equal evaluated args when it immediately stringifies them into
  fallback syntax, and it reuses the original arg `List` when every evaluated
  arg stayed identity-equal on that render-only path.
- Render path: finalized fallback render still goes through
  `renderFinalizedCallSyntax(...)`, but it now receives the existing evaluated
  arg nodes instead of rebuilt same-identity owned copies when ownership is not
  needed for the render-only branch.
- Helper/API surface: no new helper. `evalArgNodes(...)` now takes one
  node-local `{ ownResults?: boolean }` option so callers can declare when
  ownership is actually needed.
- Metadata mutations: none added. This pass avoids new parent/ownership churn
  in the covered fallback branch rather than introducing more of it.
- Routine error control: none added. Existing finalized fallback, calc cleanup,
  and sync/async arg-eval branches stay where they were.
- Allocation changes: deletes one static-container reconstruction case on the
  render-only finalized fallback path and avoids a replacement arg `List` when
  the render-only finalized fallback evaluation leaves every arg identity-equal.
  The existing owned-surface path remains in place for branches that still need
  independent arg ownership.
- Rejected/observed in this pass: the cut is intentionally narrower than the
  full `evalArgNodes(...)` ownership queue; calc and other owned-result paths
  still keep their current ownership behavior, and non-scalar/custom/trivia arg
  transport remains queued.
- Evidence: a new focused `call.test.ts` proof for finalized fallback syntax
  showed a real red where a source-free static `Sequence` arg container was
  being reconstructed once; after the cut it passed with `constructedCopies`
  back at `0`, and the existing fallback-canonicality proofs now also confirm
  the original arg/list parent links stay on the source call surface. The
  adjacent focused subset covering optional fallback arg canonicality,
  non-async immediate sync arg eval, custom sync overrides, calc reduction,
  sync calc-frame cleanup, async arg buffer/render, async calc await, and
  async calc-frame rejection cleanup also passed. Full commit-boundary gates
  still need to run after this handoff update.
- Latest pass: `Call` callable output finalization collapse.
- Verdict: accepted as a localized helper-ladder cut. Repeated `Call`
  branches that previously reimplemented “eval node result, optionally mark
  important, collapse single-rule `Rules`, then `markCallOutput(...)`” now
  share one node-local `finalizeCallResult(...)` path. No speed claim.
- New traversal: none.
- New node/materialization: none. This pass reuses the existing node-result
  eval, single-rule `Rules` collapse, and `markCallOutput(...)` ownership path;
  it adds no wrapper node, replacement array, or detached writer boundary.
- Render path: render still writes through the same existing node/string
  branches; this pass only removes repeated callable-output selection ladders
  before those render paths are reached.
- Helper/API surface: one node-local `finalizeCallResult(...)` helper inside
  `call.ts`. It deletes the repeated result-finalization ladder across
  optional-fallback JS functions, plain dynamic JS functions, metadata JS
  functions, direct `Rules`/`Collection` callable render, mixin-collection
  render, detached callable eval, and direct JS callable eval. No public/API
  surface changed.
- Metadata mutations: none added. The helper only centralizes the pre-existing
  `markCallOutput(...)` ownership behavior and optional `makeImportant(...)`
  application.
- Routine error control: none added. Existing optional-fallback, selector
  capture, strict-unit-mode, and mixin-miss branches stay in place.
- Allocation changes: none directly; this pass deletes repeated local
  ladders/branches rather than changing ownership shape.
- Rejected/observed in this pass: this does not yet change the remaining
  `evalArgNodes(...)` copy-pressure work or non-scalar/custom/trivia arg
  transport work, and it does not change the existing `MixinCollection`
  branch shape beyond result finalization. Remaining `Call` work is still
  `evalArgNodes(...)` copy ownership in calc/finalized CSS fallback paths,
  non-scalar/custom/trivia arg trim marks, async/helper ladders, and repeated
  eval outside the covered output-finalization surface.
- Evidence: focused `call.test.ts` subset covering resolved non-string render
  output, declaration-only JS call output, dynamic stylesheet function names,
  stylesheet function arg binding, dynamic ruleset calls, and detached
  collection calls passed; a second focused subset covering dynamic mixin,
  mixin-collection, callable-array, call-alias, silent-fail dynamic callable
  render, and optional non-string fallback render/resolve also passed. Full
  commit-boundary gates still need to run after this handoff update.
- Latest pass: `Call` sync arg eval boundary`.
- Verdict: accepted as a localized eval transport cut. `evalArgNodes(...)` now
  takes a direct sync `evalNode(...)` path for non-async args when the base
  `Node.eval` contract is intact, preserves custom sync eval overrides on their
  existing public path, and only switches to an async rest continuation after
  the first thenable appears. No speed claim.
- New traversal: one indexed async-rest loop inside `evalArgNodes(...)` after
  the first thenable appears. This replaces unconditional `await node.eval(...)`
  on every arg and keeps the sync prefix on direct `evalNode(...)` / direct
  return paths instead of paying promise scheduling for the whole list.
- New node/materialization: none beyond the existing returned arg `List` and
  the existing `copyWithReusableLeaves(...)` path when an evaluated arg reuses
  the same node identity. No new node wrapper or replacement arg container was
  introduced by this pass.
  The local `evalImmediate(...)` helper is a type/runtime assertion around the
  direct sync path, not a new ownership boundary.
- Render path: render is unchanged except for the covered call paths now
  receiving arg lists from the tighter sync/async split. This pass does not
  resolve extra nodes or arrays just to stringify.
- Helper/API surface: one node-local `evalImmediate(...)` helper inside
  `evalArgNodes(...)`. It replaces duplicated direct-sync `evalNode(...)` /
  `evaluated` / `inherit(...)` scaffolding across the sync prefix and async
  rest loop, and it does not widen the public/API surface.
- Metadata mutations: no new parent/source mutations beyond the existing
  `inherit(...)` on direct `evalNode(...)` replacements and the pre-existing
  returned-list adoption path.
- Routine error control: none added. Existing calc-frame cleanup still wraps
  sync throws and async rejections, and custom sync eval overrides still run
  through their own public `eval(...)` path.
- Allocation changes: deletes unconditional promise/await traffic for covered
  non-async arg evaluation and defers the async continuation until the first
  real thenable instead of treating every arg as async upfront.
- Rejected/observed in this pass: a focused repo-truth run showed the existing
  `evaluates non-async CSS call args through the immediate sync boundary` test
  was genuinely red on `origin/dev` with one public `Node.eval` call, so this
  pass fixed live code to match the queue contract rather than rewriting the
  proof. Remaining `Call` work is still callable output value selection,
  `evalArgNodes(...)` copy ownership in calc/finalized CSS fallback paths,
  non-scalar/custom/trivia arg trim marks, async path outside exact scalar
  carry, helper ladders, and repeated eval.
- Evidence: focused `call.test.ts` calc/eval subset covering nested calc
  reduction, sync calc-frame cleanup, the non-async immediate sync boundary,
  and custom sync override behavior passed; a second focused subset covering
  async arg/content buffer render, direct async render, async calc await, and
  async calc-frame rejection cleanup also passed; `pnpm --filter @jesscss/core build`
  was rerun after the code change, with full commit-boundary gates rerun after
  the handoff update.
- Latest pass: `Call` direct callable-eval wrapper deletion.
- Verdict: accepted as a localized callable-eval transport cut. Detached
  `Rules`/`Collection` call render/eval paths in `call.ts` and stylesheet
  `Func.evalCall(...)` in `function.ts` now call
  `evaluateCallableCollection(...)` directly instead of constructing a
  one-entry `MixinCollection` wrapper just to bounce through its `evalCall`
  method. No speed claim.
- New traversal: none. This pass reuses the existing callable-eval helper and
  candidate loop; it only swaps wrapper entry points for direct helper calls.
- New node/materialization: none in the hot path. The deleted wrapper path used
  one `MixinCollection` node allocation as render/eval transport; the new path
  carries the callable entry array directly into the existing helper.
  Review-flagged direct `List.value` array reads in `call.ts` pass the
  existing arg storage into `evaluateCallableCollection(...)`; they do not
  clone or materialize a replacement arg array.
- Render path: detached `Rules`/`Collection` render/eval output still goes
  through the existing callable evaluator and result render path, but no longer
  resolves into a wrapper node just to reach that evaluator.
- Helper/API surface: none added. This pass deletes wrapper hops by reusing the
  existing exported callable-eval helper.
- Metadata mutations: none added. Existing preserve-rules-like parent rebasing
  stays in place for detached rules-like variable calls.
- Routine error control: none added. Existing callable mismatch, selector
  capture, optional-fallback, and mark-important branches stay where they were.
- Allocation changes: deletes one `MixinCollection` construction plus one
  `MixinCollection.prototype.evalCall` dispatch from detached
  `Rules`/`Collection` call render/eval and stylesheet `Func` body evaluation.
- Rejected/observed in this pass: the focused stylesheet-function proof exposed
  that `CountingSequence.constructedCopies === 2` is already the live committed
  behavior on `origin/dev`; the stale `1` expectation was corrected rather than
  treated as a regression from this cut. Remaining `Call` work is still
  callable output value selection, `evalArgNodes(...)` copy pressure,
  non-scalar/custom/trivia arg trim marks, async/helper ladders, and repeated
  eval.
- Evidence: focused `call.test.ts` subset covering dynamic stylesheet function
  names, stylesheet function arg binding, dynamic ruleset calls, detached
  collection calls, and detached ruleset leaky/non-leaky behavior passed with
  new proof that `MixinCollection.prototype.evalCall` stays unused on the
  covered direct-helper paths; a second focused `call.test.ts` subset covering
  dynamic mixin, mixin-collection, callable-array, call-alias, and silent-fail
  dynamic callable render paths also passed; repo-truth check in a temporary
  worktree at committed `33eccb6a2` confirmed that the old stylesheet-function
  copy-count assertion was already stale before this patch. Targeted ESLint,
  `git diff --check`, `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` remain the commit-boundary gates.
- Latest pass: `Call` empty finalized fallback direct text.
- Verdict: accepted as a localized render transport cut. Exact string-name
  finalized fallback calls with empty args and no content now write their known
  `name()` or `name() !important` text directly in
  `renderFinalizedCallSyntax(...)` instead of opening a whole-call
  mark/readback window just to return text the caller already knows. No speed
  claim.
- New traversal: none. This pass adds one exact fast path before the existing
  finalized render logic and reuses the current arg/content branches for every
  other case.
- New node/materialization: none. No new node copies, wrappers, arg
  containers, or detached writers were introduced.
- Render path: exact empty finalized fallback syntax now writes directly into
  the active writer and returns the same known text without a call-level
  `mark()` / `getSince(...)` readback.
- Helper/API surface: none.
- Metadata mutations: none.
- Routine error control: none added. Existing optional fallback, calc cleanup,
  and dynamic finalized branches stay where they were.
- Allocation changes: deletes one call-level writer mark/readback boundary for
  the exact empty finalized fallback path.
- Rejected/observed in this pass: non-empty finalized fallback output, broader
  callable output value selection, remaining `evalArgNodes(...)` copy pressure,
  and non-scalar/custom/trivia arg trim-mark cleanup remain queued in `Call`.
- Evidence: focused `call.test.ts` fallback subset covering important optional
  CSS fallback, optional JS fallback content without fallback-Call ownership,
  optional JS fallback render/resolve without source-surface eval, and the new
  empty optional JS fallback no-readback case passed; the broader adjacent
  `Call` render subset covering shared flat-buffer output, rendered arg
  streaming, scalar arg/content no-readback, dynamic arg streaming, async arg
  buffer/render paths, calc-frame rejection cleanup, and escaped rendered args
  also passed; targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` remain the commit-boundary gates.
  Review-flagged JS function-wrapper construction in
  `packages/core/src/tree/__tests__/call.test.ts` is focused optional-fallback
  proof scaffolding only and does not add runtime-path node construction.
- Latest pass: `Call` shared flat-buffer direct streaming.
- Verdict: accepted as a localized render transport cut. Shared flat-buffer call
  render no longer writes one whole rendered string back into `buffer.parts`
  after the fact when the active writer already targets that buffer; covered
  plain and finalized call output now streams directly as name/paren/arg pieces
  through the shared writer. No speed claim.
- New traversal: none. This pass reuses the existing arg loop and dynamic
  branch structure; it adds no new tree walk, callback scan, or array
  materialization.
- New node/materialization: one `OutputWriter` allocation remains only when a
  shared buffer render has no existing writer already targeting the buffer.
  That is a render-only writer boundary, not a node/materialization copy.
- Render path: shared flat-buffer render now uses the active writer directly on
  the covered plain and finalized string-return call paths, so there is no
  trailing whole-string `writeRenderTextResult(...)` bounce back into the same
  buffer.
- Helper/API surface: one node-local
  `callRenderSharesWriter(...)` helper was added inside `call.ts` to keep the
  shared-buffer branch local and avoid duplicating the same render-buffer shape
  checks across plain and dynamic call paths.
- Metadata mutations: none.
- Routine error control: none added. Existing dynamic fallback and calc-frame
  cleanup branches stay in place.
- Allocation changes: deletes whole-string writeback into shared flat buffers
  for covered call render paths; dynamic finalized exact-scalar names now also
  keep the direct text carry instead of forcing a whole-call readback to return
  the rendered string.
- Rejected/observed in this pass: non-shared buffer output still uses
  `writeRenderTextResult(...)` by contract, and broader callable/non-string
  dynamic output work remains queued in `Call`.
- Evidence: focused `call.test.ts` shared-buffer subset covering plain CSS call
  shared flat-buffer streaming and dynamic finalized shared flat-buffer
  streaming passed; the prior focused render subsets for scalar/no-trivia arg
  carry, async scalar arg/content no-readback, direct CSS-call render, flat
  buffer output, evaluated/escaped arg syntax, dynamic arg streaming, async arg
  buffer/render paths, calc-frame rejection cleanup, and escaped rendered args
  also passed; targeted ESLint, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` remain the commit-boundary gates.
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
