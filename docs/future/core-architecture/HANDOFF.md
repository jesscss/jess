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
  protocol, profile history, rejected experiments, speed claims, and the
  performance campaign completion target. An evidence refresh can finish a
  pass, but the performance campaign is not complete until Jess beats Less 4.x
  on the canonical Less benchmark comparison with stable/usable wall-clock
  evidence.
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

Then run the chosen focus gates from its tracker. For performance work, use
`PERFORMANCE-HANDOFF.md` before choosing the target and before making any speed
claim: target selection must come from V8/CPU profile samples, benchmark phase
timing, or scoped elapsed-time instrumentation, with counters treated only as
supporting diagnostics. Use `pnpm run verify:baseline -- --changed` when the
touched area needs a broader fixture gate. The current hook path has previously
looped, so commit and push with `--no-verify` after the explicit gates pass.

## Aggressive Cutting Self-Prosecution

- Latest pass: rules-like reference surface descriptor cut.
- Verdict: accepted as a CPU-profile-backed hot surface reduction, not as a
  wall-clock speed claim. `createRulesLikeReferenceSurface(...)` no longer
  builds a full property descriptor map and no longer deletes entries from
  that descriptor object; it creates the shallow surface with the same
  prototype, copies own string properties directly, still skips
  `sourceNode`/`parent`/`index`, still clones `_options`, and then defines the
  placement metadata explicitly.
- New traversal: one `Object.getOwnPropertyNames(...)` array walk over the
  node's own fields, replacing `Object.getOwnPropertyDescriptors(...)` plus
  descriptor deletion and `Object.defineProperties(...)` for all fields. This
  is a smaller traversal on the same shallow owned-surface boundary.
- New node/materialization: no new AST node construction. The existing shallow
  preserved rules-like surface remains because mixin-ruleset/reference
  semantics need placement-local `sourceNode`, `parent`, and `index` without
  mutating the canonical source node.
- Render path: no render/stringification path changed.
- Helper/API surface: none added.
- Metadata mutations: existing explicit preserved-surface metadata definitions
  remain; this pass removes descriptor-map mutation around that metadata.
- Evidence: ordered benchmark-path rebuild passed. Focused preserved
  rules-like reference tests and namespace/mixin-ruleset tests passed. The
  broader two complex-selector reference indentation tests are baseline-red
  with the old descriptor implementation too, so they were not used as the
  pass/fail gate. Matched external `benchmark.less` CPU profiles moved
  `createRulesLikeReferenceSurface(...)` self-time from `243.12ms` before to
  `47.43ms` after. External runner median moved `713.73ms` -> `628.40ms`, but
  variance remained high; stable hot-path wall-clock stayed mixed/noisy. No
  speed claim. See `PERFORMANCE-HANDOFF.md`.

- Latest pass: merge declaration surface pruning plus terminal mixin parse
  classification.
- Verdict: accepted as a counter-proven traversal cut and parser
  classification cleanup, not as a wall-clock speed claim. Merge-constrained
  property lookup now uses carried merge-declaration child-surface facts to
  avoid entering child rules that cannot contain merge candidates. Parsed
  non-empty-arg namespace calls now classify the terminal segment as `mixin`
  while preserving namespace prefixes as `mixin-ruleset` targets.
- New traversal: `rulesMayContainMergeDeclarationSurface(...)` scans child
  rules beside existing declaration-surface collection and registration; it
  pays at the same derived-state boundary that already scans child rules, and
  broad `benchmark.less` shows it deletes tens of thousands of recursive
  lookup entries. `requiresMergeDeclarationSurface(...)` scans only the small
  `requiredDeclarationAssignments` option list already passed to merge lookups
  and exists solely to select the narrower child-surface gate.
- New node/materialization: parsed non-empty-arg namespace calls may create one
  parse-time prefix `Reference` so the terminal call can be `type: 'mixin'`
  while namespace containers remain `type: 'mixin-ruleset'`. This replaces a
  flattened broad lookup shape; it is parser AST classification, not runtime
  eval/render materialization.
- Render path: no render/stringification path changed.
- Helper/API surface: parser-local `createTerminalMixinCallReference(...)` and
  lookup-local merge-assignment predicates. No public API added.
- Metadata mutations: none kept.
- Evidence: ordered package rebuilds passed. Focused reference/property merge,
  live-binding/setDefined, runtime callable terminal-args, and full
  less-parser `mixins.test.ts` passed. Broad `benchmark.less`
  `declaration.cacheMiss` dropped `54780` -> `4766`, `scope.p` dropped
  `50318` -> `304`, `childEntryEntered` dropped `51551` -> `1537`, and
  `childEntriesScanned` dropped `18527` -> `1085`; lookup stress stayed
  unchanged on the variable-heavy path. Stable wall-clock remained noisy, so
  this is not a speed claim. See `PERFORMANCE-HANDOFF.md`.

- Latest pass: property-merge typed lookup.
- Verdict: accepted as a semantic lookup-family narrowing and counter cut, not
  as a wall-clock speed claim. Property merge normalization now asks for the
  property lookup lane instead of the broad any-declaration lane; variable
  merge normalization remains on the variable lane.
- New traversal: none.
- New node/materialization: none.
- Render path: no render/stringification path changed.
- Helper/API surface: none added.
- Metadata mutations: none.
- Evidence: package-scoped merge/reference tests passed; benchmark-path
  `@jesscss/core` and `jess` builds passed. With the external Less harness
  linked to this worktree, reversed broad `benchmark.less` showed
  `declaration.scope.d` `51984`, `cacheMiss` `56446`, and
  `childEntryEntered` `53217`; patched broad `benchmark.less` showed
  `declaration.scope.p` `50318`, `cacheMiss` `54780`, and
  `childEntryEntered` `51551`. Stable hot-path wall-clock runs were mostly
  unstable/noisy, so this pass makes no speed claim.

- Latest pass: Performance Evidence focus refresh.
- Verdict: accepted as a documentation/evidence pass. No runtime code changed;
  the pass refreshed wall-clock benchmark, profiler/counter, CPU-profile, and
  external Less harness evidence in `PERFORMANCE-HANDOFF.md` and made the
  performance-round measurement rule explicit. It did not complete the
  performance campaign, which remains open until Jess beats Less 4.x on the
  canonical benchmark comparison.
- New traversal: none in production code.
- New node/materialization: none.
- Render path: no render/eval/output path changed.
- Helper/API surface: none added.
- Metadata mutations: none.
- Evidence: benchmark-path package builds passed after fresh-worktree setup;
  `pnpm run measure:less:hotpath -- --stable`, lookup stress
  `profile-less-benchmark.mjs`, broad Less benchmark profiles, one noisy
  `node --cpu-prof` broad profile, and the external Less v5 alpha
  `benchmark.less` harness completed. The evidence is status/target selection
  only and makes no Jess speed claim.

- Latest pass: Less ruleset-mixin merge reference correctness.
- Verdict: accepted as a correctness fix for existing merge/reference paths.
  Prepared registration replacements now propagate child flags to their owning
  `Rules`, late async eval results are followed instead of throwing, and
  synthetic merge references exclude copied same-location declaration surfaces.
  No speed claim.
- New traversal: `sameConcreteLocation(...)` compares short source-location
  tuples only while deciding whether a synthetic merge reference is reading its
  own copied/prepared declaration; `collapseRepeatedMergedPrefix(...)` scans an
  already-materialized merged-reference item list to collapse repeated prefixes
  produced by chained ruleset-mixin merge output.
- New node/materialization: no new production node kinds. Existing synthetic
  merge references now carry explicit exclusion arrays for copied outputs;
  `items.slice(start)` returns the surviving merged-reference suffix after the
  duplicate-prefix scan has proven the earlier prefix is repeated.
- Render path: no render-to-node conversion added.
- Helper/API surface: two private helpers only, both scoped to existing
  declaration/reference merge normalization.
- Metadata mutations: one existing `Rules.adopt(...)` call is now applied to
  prepared registration replacements so parent flags match the stored child.
  The `evald.inherit(node)` path remains the existing eval replacement
  ownership path, now reached when an allegedly sync node returns a late
  promise. `sourceNode` reads are only identity guards for copied declaration
  surfaces; they do not mutate metadata.
- Evidence: `functions.test.ts -t "Less property merges"`,
  `ruleset-merge-regression.test.ts`, `test:less:custom`, and the real Less
  alpha `benchmark.less` harness all completed.

- Latest pass: `QueryCondition` whole-query static fallback recovery split.
- Verdict: accepted as a bounded `QueryCondition` serializer cut. Static
  fallback queries with custom/subclass source children no longer open a
  whole-query `mark()/getSince()` boundary just to recover the text already
  written into the active writer; they now read the active writer tail
  directly after emission while preserving the existing localized child
  fallback ownership checks. No speed claim.
- New traversal: one straight chunk join over the active writer tail in
  `getWriterTextSincePosition(...)`. This replaces the previous whole-query
  `mark()/getSince()` recovery boundary for static fallback queries and does
  not add a new scan over unrelated query state.
- Review-flagged allocations: none added on the production path.
- New node/materialization: none.
- Render path: query-condition render still stringifies directly. The pass
  deletes the whole-query recovery boundary for static fallback queries; it
  does not materialize intermediate nodes, arrays, or wrapper queries to
  recover text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/query-condition.ts`. It replaces repeated
  whole-query `mark()/getSince()` recovery in static fallback source/render
  paths; no public API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, stays boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader. This pass rejected reopening whole-query marks or public
  string wrappers just to recover already-emitted fallback text.
- Routine error control: none added.
- Allocation changes: deletes the whole-query static fallback
  `mark()/getSince()` recovery boundary from `QueryCondition.toTrimmedString`
  and static `render(...)` when direct known text is unavailable.
- Evidence: focused `query-condition.test.ts` cases for custom operation,
  custom condition, custom paren, prefixed-writer static fallback recovery,
  shared-flat-buffer static output, and prefixed shared-buffer static output
  all passed.

- Latest pass: declaration merge-list active-writer spacing split.
- Verdict: accepted as a bounded `Declaration` serializer cut. Non-custom
  merge-list value output no longer opens an inner declaration value
  mark/readback window or per-item public list-string lane just to normalize
  comma spacing; the covered path now streams directly through the active
  declaration writer and lets the existing outer public render/string boundary
  keep ownership of returned text. No speed claim.
- New traversal: one straight indexed loop over the already-owned merge-list
  items inside `renderCommaValueSyntax(...)`. This replaces the covered
  `List.renderListValueSyntax(...)` public-string lane plus its inner writer
  mark/readback instead of adding a new scan over unrelated declaration state.
- Review-flagged allocations: none added on the covered production path.
- New node/materialization: none.
- Render path: declaration render still stringifies directly. The pass deletes
  one inner writer readback boundary plus the covered public list-item string
  lane for merge-list spacing; it does not materialize temporary nodes, arrays,
  or wrapper declarations to recover text.
- Helper/API surface: one node-local helper,
  `renderCommaValueSyntax(...)`, was added in
  `packages/core/src/tree/declaration.ts`. It replaces the covered
  `renderListValueSyntax(...)` public-string lane for merge-list output and
  keeps the list merge path on the same direct declaration-writer shape as the
  adjacent space-merge path; no public API changed.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deletes the inner non-custom merge-list
  mark/getSince/replaceSince boundary and covered per-item public list-string
  transport previously used only to normalize the leading spacer and commas
  for rendered list-merge values.
- Evidence: focused `declaration.test.ts` cases for merged declaration list
  render, merged declaration list active-writer counts, merged declaration
  sequence render, merged declaration sequence active-writer counts, merge
  adapter state, and authored multiline values all passed. Full
  `declaration.test.ts` and `@jesscss/core` build passed.

- Latest pass: declaration merge-sequence active-writer spacing split.
- Verdict: accepted as a bounded `Declaration` serializer cut. Non-custom
  merge-sequence value output no longer opens an inner declaration value
  mark/readback window just to normalize leading spacing; the covered path now
  streams directly through the active declaration writer and lets the existing
  outer public render/string boundary keep ownership of returned text. No speed
  claim.
- New traversal: none added.
- Review-flagged allocations: none added on the covered production path.
- New node/materialization: none.
- Render path: declaration render still stringifies directly. The pass deletes
  one inner writer readback boundary for merge-sequence spacing; it does not
  materialize temporary nodes, arrays, or wrapper declarations to recover text.
- Helper/API surface: none added. The change stays inside
  `packages/core/src/tree/declaration.ts` and reuses the existing declaration
  writer path.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deletes the inner non-custom merge-sequence
  mark/getSince/replaceSince boundary previously used only to normalize the
  leading spacer for rendered sequence-merge values.
- Evidence: focused `declaration.test.ts` cases for merged declaration list
  render, merged declaration sequence render, merged declaration sequence
  active-writer counts, merge adapter state, and authored multiline values all
  passed. Full `declaration.test.ts` and `@jesscss/core` build passed.

- Latest pass: nested `Rules` preview-string deletion in container serialization.
- Verdict: accepted as a bounded `Rules`/`Ruleset` serializer cut. Leaf
  `Rules` wrappers inside `serializeRulesContainer(...)` no longer preview
  their body into a detached `OutputWriter` before re-inserting the resulting
  string; they now write directly through the active caller writer under the
  existing depth/reference state and let the surrounding container serializer
  keep ownership of leading/trailing trivia and newline boundaries. No speed
  claim.
- New traversal: none added. This pass deletes the detached preview branch and
  its state restore/reset bookkeeping instead of introducing a new scan.
- Review-flagged allocations: none added on the production path. The pass
  removes the detached preview writer and preview-local emitted-trivia set for
  leaf `Rules` children.
- New node/materialization: none.
- Render path: serializer/container output still stringifies directly. The pass
  removes the child-body preview string boundary for nested `Rules`; it does
  not materialize intermediate nodes or wrapper bodies to decide whether to
  emit them.
- Helper/API surface: none added. The change deletes one whole preview branch
  from `serializeRulesContainerInternal(...)` and leans on existing
  `Rules.writeSyntax(...)` ownership.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deletes the detached child body string plus detached
  emitted-trivia staging previously used for nested `Rules` leaves in
  `serializeRulesContainer(...)`.
- Evidence: the focused `ruleset.test.ts` cases for no-trivia header transport,
  repeated comparable headers, child `Rules` body transport on the caller
  writer, and declaration merge-sequence writer transport all passed. Full
  `ruleset.test.ts`, full `rules.test.ts`, and `@jesscss/core` build passed.

- Latest pass: `Call` active-writer custom render text split.
- Verdict: accepted as a bounded `Call` row cut. Custom rendered CSS-call
  args, escaped-paren inner args, dynamic rendered names, and dynamic rendered
  content now write through the active caller writer instead of rendering into
  a detached `OutputWriter` and copying the resulting string back into the call
  surface. The call row still recovers local return text for those branches,
  but it now reads that text from the same active emitted chunk range so the
  child render contract stays on one writer-owned path. No speed claim.
- New traversal: one straight chunk join over the active writer tail in
  `getWriterTextSincePosition(...)` after a custom rendered branch writes. This
  replaces the previous detached writer allocation plus full child re-add path
  and stays localized to custom rendered call children that miss the known-text
  fast path.
- Review-flagged allocations: no new production node allocations on the hot
  render path. Test-only tracking nodes/writers were added for proof. The
  deleted detached `OutputWriter` allocations on custom arg/name/content
  branches are replaced by active-writer chunk reads and existing in-place trim
  calls.
- New node/materialization: none.
- Render path: call render still stringifies directly. The pass removes the
  detached child string boundary for custom rendered args/names/content; it
  does not materialize nodes or wrapper containers to recover text.
- Helper/API surface: two node-local helpers,
  `getWriterTextSincePosition(...)` and `writeCallNodeTextToActiveWriter(...)`,
  replace repeated detached child render scaffolding across arg/name/content
  branches. No public API added.
- Metadata mutations: none added. One localized generic read,
  `Reflect.get(writer, 'chunks')`, exists only because `OutputWriter`
  currently exposes `position()` but not a cold/public tail-slice reader. This
  pass rejected reopening detached writers or call-level readback just to
  recover the emitted custom child text; the generic read stays boxed inside
  the `Call` row until the writer has a cleaner internal-only tail-text
  surface.
- Routine error control: none added.
- Allocation changes: deletes the detached custom arg/name/content writer path
  from plain/finalized call render; horizontal trimming for custom args now
  mutates the already-emitted active writer range instead of trimming a
  temporary string before re-adding it.
- Evidence: new focused call tests passed for `renders custom fallback CSS
  call arguments through the caller writer`, `renders custom fallback CSS call
  content through the caller writer`, and `renders custom fallback CSS call
  names through the caller writer`. The adjacent existing custom render tests
  for args/content/names and escaped custom args still passed, the full
  `call.test.ts` suite passed, and `@jesscss/core` build passed.

- Latest pass: `Declaration` important-source transport plus callable-ruleset
  merge replay split.
- Verdict: accepted as a bounded declaration-lane fix. Context now carries the
  exact source `!important` leaf when a declaration reference contributes it, so
  public declaration finalization can preserve the real flag node instead of
  minting a replacement. Cross-scope merged declaration coalescing also stops
  replaying already-carried merge history across mixin-output `Rules` wrappers,
  so callable-ruleset property chains keep one canonical merged sequence
  instead of concatenating the same prior items again. No speed claim.
- New traversal: none. The new `inlineCrossScopeMergedLeadingReference(...)`
  helper only rewrites the first merged container slot when an existing
  declaration-reference placeholder is present; it does not add a new scan over
  declaration families beyond the existing coalesce walk.
- Review-flagged allocations: one inlined item array can be built when a
  cross-scope merged declaration still carries the leading declaration-reference
  placeholder. That array replaces duplicate merged output growth on the
  callable-ruleset lane and stays inside the existing coalesce boundary.
- New node/materialization: no new public materialization lane. The pass may
  build one replacement merged `List`/`Sequence` only when rewriting the
  carried leading declaration-reference placeholder or preserving the exact
  source `!important` leaf on the emitted declaration surface.
- Render path: render still writes declaration text directly. The important
  source fix only changes which flag node public declaration finalization
  carries forward; the callable-ruleset fix prevents mixin-output coalescing
  from re-merging history that the current declaration render state already
  carries.
- Helper/API surface: one local `Rules._coalesceMergedDeclarations(...)`
  helper, `inlineCrossScopeMergedLeadingReference(...)`, plus the context
  important-source stack now carrying an optional exact flag node. No public API
  added.
- Metadata mutations: none added. The context important-source stack now stores
  an optional exact `Any<'flag'>` source leaf instead of a bare counter so the
  downstream declaration boundary can preserve the real node identity.
- Routine error control: none added. Existing reference cleanup still pops the
  important-source stack on rejection paths.
- Allocation changes: deletes the public `!important` replacement-node synthesis
  for exact-source declaration references and rejects the repeated merged output
  concatenation across mixin-output boundaries.
- Evidence: focused declaration tests passed for `finalizes public contextual
  important state with the exact source flag when available`, `continues a
  property merge chain with direct important state after mixin output`, and
  `continues a property merge chain after a callable ruleset emits the first
  declaration`. The full `declaration.test.ts` suite passed. Focused reference
  cleanup tests for async important-source rejection and merged-finalization
  rejection also passed, and a focused mixin-ruleset placement test still
  passed after the mixin-output coalesce change.

- Latest pass: `Declaration` synthetic scalar `writeSyntax` direct emit split.
- Verdict: accepted as a bounded serializer cut inside the active
  `Declaration` row. Plain writer-only `Declaration.writeSyntax(...)` calls for
  synthetic scalar `Any`/`Anonymous`/`Keyword` leaves now emit `name`, assign,
  value, and direct `!important` text without opening the outer declaration
  mark/readback window that only normalized string/render paths need. Render
  and context-backed declaration formatting stay on the existing declaration
  normalization boundary. No speed claim.
- New traversal: none.
- Review-flagged allocations: none added on the declaration source path.
- New node/materialization: none.
- Render path: unchanged. The direct scalar fast path is explicitly disabled
  when `options.context` is present, so render/context-backed declaration output
  still goes through `writeDeclarationValueSyntax(...)` and
  `formatNonCustomValue(...)`.
- Helper/API surface: one node-private helper,
  `writeDirectSyntheticScalarSyntax(...)`, plus a tiny scalar leaf predicate,
  replace an outer writer mark/readback on the plain syntax surface without
  adding public API.
- Metadata mutations: no mutations added. One direct `_location` probe now
  limits the fast path to synthetic leaves only, so parsed/source-backed
  declarations stay on the established trivia/normalization path instead of
  rediscovering exact-safe source semantics later.
- Routine error control: none added.
- Allocation changes: deletes one outer declaration `mark()` plus
  `getSince(...)` readback on the covered plain `writeSyntax(...)` surface;
  render and string-return paths keep their existing normalization boundary.
- Evidence: focused declaration writer proof
  `writes non-custom declaration syntax without outer string readback` passed.
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/declaration.test.ts`
  still has two existing failures on `HEAD` and on a detached `HEAD`
  verification worktree: `continues a property merge chain with direct
  important state after mixin output` and `continues a property merge chain
  after a callable ruleset emits the first declaration`. This pass does not add
  a new declaration-suite failure.

- Latest pass: binding callable frame-prep and final registryless lookup
  closure proof.
- Verdict: accepted as a focused binding/lookup closeout. Ordinary static
  callable references now prepare the existing scope frame before lookup, so
  simple mixin and mixin-ruleset reads skip the broad `findMixinsFast(...)`
  bridge on the first read and on cached reads. The production one-segment
  namespace descendant fallback-frame walk was already on `HEAD`; this pass
  adds the missing focused proof and closes the stale binding clusters in
  `BINDING-LOOKUP-REMAINING.md`. No speed claim.
- New traversal: no production traversal added in this diff. The only new
  loops are test-only iterations over reference nodes to prove
  `leakyRules`/`searchScope` stale handles clear and rebuild. The callable
  fallback-frame traversal in `Rules.findCallableDescendantsWithinMixinNamespaces(...)`
  is existing `HEAD` code and is limited to one-segment descendants; it
  replaces nested child `findMixin(...)`/broad crawl for covered fallback-frame
  hits and misses.
- Review-flagged allocations: test-only spy arrays, `Context` instances, and
  fixture node construction were added for proof. Production adds one possible
  `scope.getScopeFrame()` preparation for non-interpolated static callable
  references, trading a broad child crawl for reusable frame/binding state.
- New node/materialization: none in production. Tests construct fixture
  `Rules`, `Mixin`, and declaration nodes only.
- Render path: no binding runtime render path changed. A separate dirty
  `ruleset.test.ts` render/mark proof exists in the worktree and must remain
  outside this binding commit unless intentionally taken up in the render lane.
- Helper/API surface: no new public API or helper. The existing internal
  `shouldPrepareCallableReferenceFrame(...)` predicate now treats ordinary
  static callable keys as frame-preparable when not targeted/local/interpolated.
- Metadata mutations: no new metadata mutation. The existing scope-frame state
  may now be prepared earlier for static callable references; this is semantic
  lookup state used by the registryless frame path, not compatibility plumbing.
- Routine error control: none in production. New `try/finally` blocks are test
  cleanup for monkey-patched spies.
- Allocation changes: production may allocate/prepare one scope frame on the
  first ordinary static callable read, removing the initial broad
  `findMixinsFast(...)` crawl from covered simple callable reads. Profile
  counters remain evidence-only: old `Rules.find`/registry/search-children
  counters are empty, direct declaration counters are explained, and no timing
  win is claimed.
- Evidence: focused reference callable/stale-handle tests passed; focused
  mixin fallback-frame descendant tests passed; the broad binding matrix across
  `reference.test.ts`, `mixin.test.ts`, and `import-style.test.ts` passed with
  42 targeted tests. `git diff --check`, `verify:binding-lookup-hot-paths`,
  `@jesscss/core` build, `scope-lookup-stress.less` profile, and
  `verify:aggressive-cutting-review` passed. `verify:baseline -- --changed`
  still reports non-binding render/serialization/extend failures and is
  tracked under binding item 86.

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
- Latest pass: `Rules` child-container position probe split.
- Verdict: accepted as a bounded serializer cut inside the active `Rules`
  row. Child `Ruleset`/`AtRule` container emission inside `_emitRulesBody(...)`
  no longer spends a wrapper-local mark plus `hasContentSince(...)` scan to
  detect whether the child wrote anything; that branch now uses a plain
  writer-position snapshot and still only falls back to the returned string
  when the child wrote nothing. No speed claim.
- New traversal: none.
- Review-flagged allocations: none added on the render/source path.
- Review-flagged diff tokens: the current diff still contains test-only
  context/writer scaffolding in `rules-streaming.test.ts` for the focused
  child-container regression proof. No new production node or writer
  construction was added by this pass.
- Review-flagged carried tokens: the current
  `verify:aggressive-cutting-review` run also still reports unrelated existing
  `while (fallbackFrame)` lookup loops plus `broadCallableLookups` test arrays
  from older binding/reference surfaces outside this serializer cut. This pass
  does not add a new traversal or materialized array on the `Rules`
  source/render path.
- New node/materialization: none.
- Render path: child `Ruleset`/`AtRule` containers still render and serialize
  through their owned container paths, preserve sibling block separation, and
  keep the existing resolved-string append cold branch only when the child
  wrote nothing. The change only deletes the container-local emission probe
  scaffolding.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the child-container `mark()` plus
  `hasContentSince(...)` probe in the `Rules._emitRulesBody(...)`
  `Ruleset`/`AtRule` branch and replaced it with a writer-position comparison.
- Evidence: focused red-to-green proof came from
  `rules-streaming.test.ts` case
  `does not spend an extra container mark to detect child Ruleset source emission`.
  Targeted `rules.test.ts` coverage for
  `keeps sibling ruleset braces intact when declarations render values through active context output`
  and `keeps separate sibling rulesets with the same selector in separate blocks`
  also passed. Full batch gates still need to run after this handoff update.
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
- Latest pass: `Ruleset` header-selector position probe split.
- Verdict: accepted as a bounded serializer cut inside the active `Ruleset`
  row. `writeHeaderSelector(...)` no longer opens a detached-writer
  `mark()`/`hasContentSince(...)` probe just to trim trailing selector
  whitespace and answer whether the selector wrote anything; it now snapshots
  plain writer position, trims from that position, and checks position delta
  afterward. The detached writer boundary remains the owned final shape for
  header capture; this pass only deletes unnecessary probe scaffolding. No
  speed claim.
- New traversal: none.
- Review-flagged allocations: none added on the header path. The existing
  detached writer stays in place because `getHeaderString(...)` still captures
  header selector text off the caller writer by design.
- Review-flagged diff tokens: the current `verify:aggressive-cutting-review`
  run still reports unrelated existing diff tokens from the in-progress
  binding/reference worktree files (`reference.ts`,
  `reference.test.ts`, `mixin.test.ts`, and
  `BINDING-LOOKUP-REMAINING.md`), plus this focused test's cold
  `new CountingWriter()` and `try/finally` restoration scaffolding. This
  `Ruleset` pass adds no new production traversal, node construction, or
  materialized array/object state on the hot header path.
- New node/materialization: none.
- Render path: `getHeaderString(...)` and `getComparableHeaderString(...)`
  still capture concrete selector syntax through the detached header writer,
  preserve trailing-whitespace trimming, and leave the caller writer untouched.
  The only change is deleting the real writer mark where a plain position
  snapshot already carried the needed fact.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the detached `mark()` probe in
  `Ruleset.writeHeaderSelector(...)`; the path now uses `writer.position()`
  for both trim start and write detection.
- Evidence: focused `ruleset.test.ts` proof
  `does not spend a detached mark to trim header selector trailing whitespace`
  passed red-to-green. Full `ruleset.test.ts`, `git diff --check`,
  and `pnpm --filter @jesscss/core build` also passed. The current
  `verify:aggressive-cutting-review` run still reports the unrelated carried
  diff tokens listed above, but this pass adds no new hot-path ownership
  machinery beyond the retained detached header writer.
- Latest pass: `QueryCondition` dynamic scalar position contract split.
- Verdict: accepted as a bounded serializer cut inside the active
  `QueryCondition` row. Exact dynamic scalar children whose render contract
  already writes and returns the same text no longer pay the sync-path
  `hasContentSince(...)` content scan before `QueryCondition` decides whether
  to reuse emitted text or fall back to localized readback. That branch now
  uses the same plain writer-position ownership check the async path already
  used, while custom/per-instance children stay on the localized readback
  path. No speed claim.
- New traversal: none.
- Review-flagged allocations: none added on the dynamic query render path.
- Review-flagged diff tokens: the focused test still contributes cold
  `new CountingWriter()` construction and `expect(...)` arrays, but this pass
  adds no new production node construction, array staging, or wrapper state.
- New node/materialization: none.
- Render path: exact dynamic scalar children (`Any`/`Anonymous`/`Keyword`,
  `Dimension`/`Num`, `Bool`, and string-backed `Color`) now share the trusted
  emitted-text contract already used by exact dynamic `QueryCondition`,
  `Paren`, `Condition`, and `Operation` children, so the sync path stays off
  the content-scan branch when the child has already written its own text.
  Custom and per-instance dynamic children still keep the localized readback
  branch when they may return text different from what they emitted.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the sync-path `hasContentSince(...)` probe in
  `renderQueryConditionChild(...)` for exact dynamic children and widened the
  exact-child trust contract to concrete scalar classes that already own direct
  render/write behavior.
- Evidence: focused red-to-green proof came from
  `query-condition.test.ts` case
  `trusts exact dynamic scalar children that write their rendered text`.
  Full `query-condition.test.ts`, `git diff --check`, and
  `pnpm --filter @jesscss/core build` also passed. The current
  `verify:aggressive-cutting-review` run still reports only this pass's cold
  test-side `new CountingWriter()` token, which is prosecuted here.
- Latest pass: `QueryCondition` static fallback position probe split.
- Verdict: accepted as a bounded serializer cut inside the active
  `QueryCondition` row. Custom/subclass static children that stay on
  `writeStaticChild(...)` no longer pay an inner child `mark()/getSince()`
  readback just to detect whether `writeSyntax(...)` emitted anything; that
  fallback now snapshots plain writer position and only drops to
  `toTrimmedString(...)` when the child wrote nothing. The outer public
  query-condition wrapper still owns its normal whole-query mark/readback
  boundary. No speed claim.
- New traversal: none.
- Review-flagged allocations: none added on the static query fallback path.
- Review-flagged diff tokens: the focused test still contributes cold
  `new CountingWriter()` construction and assertion arrays, but this pass adds
  no new production nodes, helper arrays, or fallback wrappers.
- New node/materialization: none.
- Render path: static custom `Operation`/`Condition`/`Paren` overrides still
  stay correct on the localized fallback path, but they now rely on a writer
  position ownership check instead of child readback when the override already
  emitted its final syntax. The remaining readback on those tests is the outer
  public query-condition wrapper boundary, not a second inner child probe.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the inner child `mark()/getSince()` fallback in
  `QueryCondition.writeStaticChild(...)` and replaced it with
  `writer.position()` ownership detection.
- Evidence: focused red-to-green proof came from
  `query-condition.test.ts` case
  `keeps custom operation syntax overrides on the static fallback path`.
  Full `query-condition.test.ts`, `git diff --check`, and
  `pnpm --filter @jesscss/core build` also passed. The current
  `verify:aggressive-cutting-review` run still reports only this pass's cold
  test-side `new CountingWriter()` token, which is prosecuted here.
- Latest pass: `AtRule` non-scalar leaf detached syntax split.
- Verdict: accepted as a bounded serializer cut inside the active `AtRule`
  row. No-trivia non-scalar leaf header emission no longer borrows the caller
  writer with inner `mark()/getSince()/restore()` probes just to recover child
  name/prelude syntax before writing the final leaf header. That path now
  captures non-scalar child syntax through detached leaf writers and keeps the
  caller writer on direct final output only. No speed claim.
- New traversal: none.
- Review-flagged allocations: one detached `OutputWriter` remains on the
  covered non-scalar leaf helper path, but this pass deletes the caller-writer
  rollback probes it previously depended on.
- Review-flagged diff tokens: none. `verify:aggressive-cutting-review`
  reported no danger tokens in the scoped diff.
- New node/materialization: none.
- Render path: no-trivia non-scalar leaf at-rules still stay off
  `getHeaderString(...)` and still serialize through `AtRule.writeSyntax(...)`,
  but the child text capture now lives entirely in detached leaf writers rather
  than staging text through the caller writer and rewinding it. Scalar leaf
  fast paths remain unchanged.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the inner caller-writer
  `mark()/getSince()/restore()` readback in `writeDirectLeafAtRuleHeader(...)`
  and switched non-scalar child text capture to the existing detached leaf
  syntax helper.
- Evidence: focused red-to-green proof came from
  `at-rule.test.ts` case
  `writes non-scalar no-trivia leaf at-rules without header string transport`.
  Full `at-rule.test.ts`, `git diff --check`,
  `pnpm --filter @jesscss/core build`, and
  `pnpm run verify:aggressive-cutting-review` also passed.
- Latest pass: `Ruleset` empty-header position rollback split.
- Verdict: accepted as a bounded serializer cut inside the active `Ruleset`
  row. `writeHeader(...)` no longer spends a real `mark()` only so it can
  roll back indentation when `writeHeaderSelector(...)` returns false for an
  empty header. That branch now snapshots plain writer position and restores to
  that position on the cold empty-header path. No speed claim.
- New traversal: none.
- Review-flagged allocations: none added on the ruleset header path.
- Review-flagged diff tokens: the current
  `verify:aggressive-cutting-review` run still reports only the focused
  test-side `new CountingWriter()` plus `rules([])`/`new Nil()` fixture setup.
  This pass adds no new production node construction or materialized arrays.
- New node/materialization: none.
- Render path: ruleset header emission still writes indent, selector, and
  block-open directly on the success path. The only change is that the cold
  empty-header rollback now uses `writer.position()` instead of a real mark.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the `writer.mark()` call in
  `Ruleset.writeHeader(...)`; rollback now restores from a plain position
  snapshot.
- Evidence: focused red-to-green proof came from
  `ruleset.test.ts` case
  `does not spend a real mark to roll back empty ruleset headers`.
  Full `ruleset.test.ts`, `git diff --check`, and
  `pnpm --filter @jesscss/core build` also passed. The current
  `verify:aggressive-cutting-review` run still reports only the cold test-side
  fixture constructions listed above, which are prosecuted here.
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
