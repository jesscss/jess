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

The scanner-first parser and binding/lookup work must be attacked
holistically. If a parser/e2e proof fails because lookup, live binding, import,
or callable resolution lacks one source of truth, move that blocker into the
binding queue instead of adding parser-local workarounds. If binding work needs
new parser shapes to prove Less-to-CSS behavior, keep the parser slice bounded
to CSS/Less and the existing corpus/benchmark gates. Do not expand SCSS/Jess
structural work until CSS/Less structural-fed output equality and benchmark
gates are green.

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

- Latest pass: direct variable occurrence current-cell projection.
- Verdict: accepted as a narrow declaration binding/direct lookup unification
  slice, not a speed claim. Covered current static variable occurrences now
  project from `lookupScopeFrameVariable(...)` / `ScopeFrame.currentBindingsByName`
  before the direct occurrence helper considers local tree buckets.
- Architecture surface: `lookupScopeFrameVariable(...)` current-frame-only
  options, direct variable occurrence lookup in
  `util/direct-rules-lookup.ts`, and focused reference/scope-frame tests.
- Separation/duplication: deleted the private
  `findScopeBindingDeclaration(...)` bucket scan. The remaining direct local
  scan is only the occurrence fallback for cases the frame path does not
  accept, such as `setDefined` source nodes, property lookup, child/import
  surfaces, filters, and source-order modes.
- Cumulative node weight: no production node, map, set, side table, wrapper,
  or retained cache was added. Non-test `packages/core/src` line count is
  `54975` in this worktree after the slice.
- New traversal: none added in production. The direct lookup path reuses the
  existing scope-frame lookup loop with parent/fallback search disabled for
  this call site and removes one duplicate bucket loop.
- New node/materialization: none in production. Tests construct small Rules
  fixtures only.
- Render path: unchanged.
- Helper/API surface: the old private helper was deleted. Two internal
  `lookupScopeFrameVariable(...)` options were added so callers can ask the
  existing frame facade to answer only the current frame, without parent or
  fallback traversal.
- Metadata mutations: production reads `sourceNode` from the frame result to
  return the existing direct occurrence projection; it does not mutate parent,
  source, location, or frozen metadata.
- Review-flagged diff tokens: [generator] is docs wording from the wider
  scoped diff; [node construction] and [materialized array/object] are test
  fixture construction; [parent/source mutation] is source-node identity reads
  from the frame hit; [routine error control] is the reference-test poison
  tripwire and restoration block.
- Evidence: the new reference test first failed on the deleted
  `findScopeBindingDeclaration(...)` bucket path, then passed after the cut.
  Focused reference occurrence/current-cell tests passed; full
  `scope-frame.test.ts`, full `rules.test.ts`,
  `pnpm run verify:binding-lookup-hot-paths`, `pnpm --filter @jesscss/core
  build`, and `git diff --check` passed. A full `reference.test.ts` attempt
  was interrupted after it produced no completion output for several minutes;
  exact reference tests for the touched direct-variable path passed.

- Latest pass: binding-cell source-of-truth cut for `setDefined`.
- Verdict: accepted as a binding cleanup plus correctness repair, not a speed
  claim.
  `setDefined` modeled paths now update the binding cell returned by
  `lookupScopeFrameVariable(...)` / `assignScopeFrameVariable(...)` without a
  second `Rules.varsByName` scan. The source AST mutation boundary from the
  previous pass remains: evaluated replacements live in binding cells or
  inserted runtime declarations, not authored declaration fields.
- Architecture surface: `Rules.registerNode(...)` setDefined assignment,
  `ScopeFrame` assignment helper, generated `$for` iteration frame coverage,
  binding queue docs, and no parser surface.
- Separation/duplication: deleted the `Rules.varsByName` sync helper because
  the scope-frame lookup result carries the canonical cell to update for the
  covered path. Sub-agent review caught the uncovered `$for` iteration-frame
  case; that was fixed by marking generated iteration frames
  declaration-covered so same-iteration reads stay on the frame chain instead
  of reopening direct occurrence lookup.
- Cumulative node weight: no new nodes, maps, sets, side tables, wrappers, or
  retained state. Non-test `packages/core/src` line count moved from 55008 to
  54991 in this slice.
- New traversal: none added. The pass deletes the
  `syncVarDeclarationBindingEntry(...)` reverse scan through a name bucket and
  deletes a redundant live/declaration assignment branch in
  `assignScopeFrameVariable(...)`.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: one private helper was deleted; one exported assignment
  helper was simplified without changing its signature.
- Metadata mutations: no new parent/source/frozen or descriptor mutation. The
  remaining write is the existing binding-cell `value` write.
- Review-flagged diff tokens: the diff contains only deletions in the runtime
  binding path, one frame-coverage correction, plus docs. No added loop, array
  helper, copy/materialization, descriptor mutation, or defensive runtime check.
- Evidence: focused setDefined/control and scope-frame tests passed; non-test
  `packages/core/src` line count moved from 55008 to 54991 for this slice.

- Latest pass: scanner-first direct semantic fields, Rules inheritance cleanup,
  and callable namespace frame-chain repair.
- Verdict: accepted as a correctness/architecture cleanup slice, not a speed
  claim. This pass removes the invented declaration `raw*`/`valueNode` public
  surface, keeps scanner-first cheap text on semantic fields, makes wrapper
  `Rules` bodies illegal where rules-bearing nodes now own arrays directly, and
  fixes array-path mixin namespace lookup so a covered miss in the current
  frame does not suppress allowed parent-frame lookup.
- Architecture surface: core node constructors/field names for declaration,
  var declaration, at-rule/statement, ruleset/mixin/control rules-bearing
  shapes; Less compat adapter tests; parser serializer fixtures; scanner-first
  Jess e2e proofs; and docs. Language service and VSCode plugin remain outside
  this slice.
- Separation/duplication: the pass deliberately cuts duplicate textual-vs-node
  declaration storage instead of adding aliases. `name`, `value`, `important`,
  `prelude`, and inherited `rules` are the semantic storage locations. The
  parser packages keep their existing parser ownership; the scanner-first e2e
  path proves thin source-backed core nodes without adding a second production
  stack for SCSS/Jess.
- Cumulative node weight: normal render paths can keep declaration names,
  values, at-rule headers, and simple selectors as strings or mixed
  string/node arrays. Materialized `Any`, `Sequence`, selector containers, and
  at-rule header nodes are cold semantic boundaries for registration, visitors,
  or parser compatibility. The lookup fix adds no retained maps, side tables,
  wrapper nodes, or fallback parser islands.
- New traversal: [loop/traversal] declaration adoption/materialization walks
  only the directly-owned mixed string/node field arrays; parser/test loops are
  fixture or existing production assembly; the lookup repair prepares/searches
  the existing callable frame chain only when `searchParents` is enabled.
- New node/materialization: [node construction] string-backed declaration,
  at-rule, at-rule statement, and selector materializers create canonical nodes
  only when semantic registration or tests explicitly request them. Render-only
  structural-fed paths remain string-backed. [materialized array/object] arrays
  introduced in the diff are direct rule/value payloads, clone payloads, parser
  fixture expectations, or cold materialization results rather than retained
  hot-path side graphs.
- Render path: scanner-first render proofs still render CSS/Less-equivalent
  output without eager field materialization for structural-only cases. The
  namespace lookup change only affects callable resolution; it does not build
  output nodes just to stringify.
- Helper/API surface: `getCallableSelectorTextKeyPath` is a small local helper
  to route string-backed selectors through the same callable key-path logic as
  node-backed selectors. The public-looking raw/value wrapper names are removed
  instead of preserved. Less compat adapter tests now construct `Ruleset` with
  direct `rules: []` arrays rather than compatibility `Rules` wrappers.
- Metadata mutations: [inherit/adopt/frozen] declaration/at-rule adoption is
  the ownership boundary for real child nodes inside mixed fields; string fields
  are not adopted. [parent/source mutation] source/root/location propagation is
  limited to cold materialization/clone paths. [generic defensive read] the
  remaining `Reflect.construct` in declaration clone/derive preserves subclass
  construction for inherited declaration types and is recorded as follow-up
  audit debt, not a pattern to widen.
- Review-flagged diff tokens: [array helper] parser/test array helpers and
  value splitting are bounded fixture or production assembly, not retained
  caches; [generator] yielded pairs are existing callable/declaration iterator
  surfaces updated for field names; [copy helper] copy calls remain in clone,
  derive, and callable output ownership paths; [routine error control] new
  throws are test assertions or cold subset-boundary materialization errors,
  not expected lookup/render control flow.
- Evidence: `git diff --check`; forbidden field/vocabulary scan for
  `rawName|rawPrelude|rawValueSegments|rawImportant|valueNode|valueSegments`;
  `pnpm --filter @jesscss/core build`; focused namespace test; broad focused
  core slice; `pnpm --filter @jesscss/plugin-less-compat exec vitest --run
  test/unit/transform/adapter.test.ts`; parser AST suites for css/less/scss;
  `pnpm --filter @jesscss/fns test -- --run src/__tests__/each.test.ts`; and
  `pnpm --filter jess test -- --run test/scanner-first-e2e.test.ts`.
- Corrective amendment: removed the bad `syncDeclarationValueNode`
  `Object.defineProperty` assignment machinery. `setDefined` updates live
  binding cells rather than replacing authored declaration values; declaration
  value mutation is reserved for progressive upgrade/materialization from
  string-backed fields to semantic nodes. Declaration textual rendering now
  caches the semantic `value` field and writes string, node, and mixed segment
  values directly without allocating one-item arrays. This is a
  simplification/correctness cleanup, not a speed claim.
- Amendment review: [loop/traversal] the only loop is the existing direct
  mixed declaration value segment walk when the field is already an array.
  String and node values no longer allocate a one-item array just to render.
  [helper/API surface] no new render helper is retained; the branch stays local
  to declaration rendering. [metadata mutations] setDefined no longer mutates
  declaration fields; no descriptor mutation is retained.
- Amendment evidence: `git diff --check`; `pnpm --filter @jesscss/core test
  -- --run src/tree/__tests__/declaration.test.ts
  src/tree/__tests__/progressive-nodes.test.ts
  src/tree/__tests__/rules.test.ts -t
  "Declaration|declaration|setDefined|progressive|important|multiline"`.
- Live-binding follow-up: this slice exposed that Rules still has parallel
  binding and lookup systems rather than one cohesive runtime binding model:
  source declaration occurrence lookup, scope-frame `currentBindingsByName`,
  `assignmentBindingsByName`, legacy `varsByName`, property lookup, callable
  lookup, and imported assignment summaries can each own part of the answer.
  The target model is a single declaration-binding layer with stable source
  nodes and mutable runtime cells; source AST fields may only mutate for
  serialization-preserving progressive upgrades such as string-to-node
  materialization. Evaluated replacements such as `setDefined` must live in
  binding cells or inserted runtime declarations, not by changing the authored
  declaration node's semantic fields.

- Latest pass: scanner-first CSS transform function declaration proof.
- Verdict: accepted as a narrow structural-fed correctness proof, not a speed
  claim. The Less structural-fed path now admits `scaleX(<number>)` only
  through the existing progressive function segment path used by already-proven
  simple function values.
- Architecture surface: Less plugin structural-fed admission/building and
  scanner-first e2e proof only. It does not change core node APIs, package
  exports, SCSS/Jess parsing, language-service behavior, or the default parser
  path.
- Separation/duplication: this reuses the existing `Call`/`Reference`/argument
  node construction path for scanner-native function values, with a small
  function policy table to keep `scaleX` constrained to one numeric argument.
  It does not add a second declaration-value parser, a raw parenthesized value
  escape hatch, or new visitor/materialization policy.
- Cumulative node weight: the accepted value creates only the existing
  function `Call`, name `Reference`, argument `List`, and numeric argument node
  required to preserve a recognized function shape. It adds no maps, side
  tables, wrapper containers, selected island requests, retained caches, or
  full-tree fallback surfaces.
- New traversal: none. The existing bounded function-argument split runs over
  the already-isolated declaration value string.
- New node/materialization: no new node classes. The proof intentionally keeps
  the declaration as raw-name plus progressive value segments rather than
  materializing `Any` property names or legacy declaration value wrappers.
- Render path: focused e2e proof renders equal CSS through structural-fed with
  zero full-tree fallback, zero selected island requests, zero actual parser
  executions, and zero promoted bytes.
- Helper/API surface: no public API. The plugin-local scanner-native function
  policy table admits the corpus-observed `scaleX` function while keeping its
  argument boundary narrower than the existing Less/color function entries.
- Metadata mutations: none added beyond normal node construction/adoption.
  Existing unrelated `AUDIT:` markers remain outside this slice.
- Review-flagged diff tokens: new `new Call`, `new Reference`, `new List`, and
  numeric node construction are all existing progressive function-value nodes
  reached through the already-proven helper path. The new policy table is
  static metadata for the existing scanner-native function helper, not a
  retained per-document cache. No new side maps, selected island request,
  full-tree fallback, parser entrypoint, or retained cache is introduced.
- Evidence: focused scanner-first e2e covers `.a { transform: scaleX(1); }`
  alongside the existing `rgb`, `rgba`, `lighten`, and `darken` progressive
  function proofs, plus boundary fallbacks for `scaleX` values with multiple
  arguments, dimensions, colors, Less variables, nested functions, strings, and
  comments.

- Latest pass: scanner-first no-prelude CSS `@starting-style` block proof.
- Verdict: accepted as a narrow structural-fed correctness proof, not a speed
  claim. The Less structural-fed path now admits `@starting-style { ... }`
  only in the no-prelude CSS block form, at root with ordinary rule children
  and inside rules with already-supported declaration children. Rule-local
  nested-rule bodies, nested at-rule bodies, and mixin-body `@starting-style`
  remain canonical fallback until separately proven.
- Architecture surface: Less plugin structural-fed admission/building only.
  It does not change core node APIs, package exports, SCSS/Jess parsing,
  language-service behavior, or the default parser path.
- Separation/duplication: this reuses the existing raw-field `AtRule`
  builder and child validation paths. It adds one plugin-local predicate for
  no-prelude CSS block at-rules rather than introducing a general unknown
  at-rule parser or raw-prelude escape hatch.
- Cumulative node weight: this slice creates only the existing raw-field
  `AtRule` plus the already-proven raw `Ruleset`/`Declaration` children for
  accepted shapes. It adds no maps, side tables, wrapper containers, selected
  island requests, or retained caches.
- New traversal: none. The child bodies already walk through the existing
  structural-fed at-rule/rule/declaration loops.
- New node/materialization: none beyond the raw-field `AtRule` already used by
  `@media`, `@layer`, and unknown block proofs. The no-prelude case deliberately
  rejects `@starting-style <prelude> { ... }` as canonical fallback.
- Render path: focused root and rule-local proofs render equal CSS through
  structural-fed with zero full-tree fallback, zero selected island requests,
  zero actual parser executions, and zero promoted bytes.
- Helper/API surface: one plugin-local predicate recognizes proven no-prelude
  CSS block at-rule names. `@starting-style` is also listed as a known semantic
  block name so it cannot accidentally use the root unknown-block path.
- Metadata mutations: none added beyond normal node construction/adoption.
  Existing unrelated `AUDIT:` markers remain outside this slice.
- Review-flagged diff tokens: [side map/set] no side-map or side-set storage is
  introduced; the only mention is this accounting line. No new canonical node
  classes, selected-island request, full-tree fallback, or parser entrypoint are
  introduced. The changed `new AtRule` path is the existing raw-field at-rule
  builder admitting one additional no-prelude CSS block family.
- Evidence: focused scanner-first e2e covers
  `@starting-style { .a { opacity: 0; } }`,
  `.a { opacity: 1; @starting-style { opacity: 0; } }`, and the negative
  `@starting-style initial { ... }`, rule-local nested-rule, rule-local nested
  at-rule, and mixin-body fallbacks. Full corpus movement is recorded in the
  strategy doc after the corpus gate is rerun.

- Latest pass: scanner-first simple Less mixin parameter/argument proof.
- Verdict: accepted as a narrow structural-fed correctness proof, not a speed
  claim. The Less structural-fed path now admits `.m(@name) { ... }` style
  definitions and `.m(literal)` calls only when every parameter is a simple
  Less variable name and every call argument is a simple literal token.
- Architecture surface: Less plugin structural-fed admission/building only.
  It does not change core node APIs, package exports, SCSS/Jess parsing,
  language-service behavior, or the default parser path.
- Separation/duplication: the scanner-native helpers live beside the existing
  no-arg mixin helpers and still construct the existing core `Mixin`, `Call`,
  `List`, `Any`, and `Reference` surfaces. Richer Less `mixinName`,
  `mixinArgs`, guard, default, rest, named-arg, accessor, and interpolated
  productions remain explicit canonical fallback rather than duplicated
  partial grammar.
- Cumulative node weight: this slice adds parameter `Any` nodes, call-argument
  literal nodes, and use-site `Reference` nodes only for the covered shape.
  It adds no `Rules` maps, lookup caches, side tables, or wrapper containers.
- New traversal: one short comma split over the already-isolated mixin
  parameter text and one short comma split over the already-isolated call
  argument text. These scans are required to avoid accepting raw strings that
  contain parameter/argument structure; they do not walk the tree.
- New node/materialization: the builder creates the existing `List`/`Any`
  parameter surface and existing `List`/literal call-argument surface needed by
  core mixin binding, plus a use-site variable `Reference` when a declaration
  reads a simple parameter. These are semantic binding surfaces, not
  render-only wrappers.
- Render path: the focused proof renders equal CSS through structural-fed with
  zero full-tree fallback, zero selected island requests, zero actual parser
  executions, and zero promoted bytes. Declaration render still uses the
  ordinary core call/eval binding path once the parameter reference is reached.
- Helper/API surface: three plugin-local helpers recognize simple mixin
  definitions, simple mixin calls, and use-site parameter references. No public
  parser/core API is introduced.
- Metadata mutations: none added beyond normal node construction/adoption.
  Existing unrelated `AUDIT:` markers remain outside this slice.
- Review-flagged diff tokens: new `new List`, `new Any`, and `new Reference`
  calls are the semantic parameter, argument, and parameter-reference nodes
  described above. New arrays/maps are bounded local construction surfaces for
  parameter and argument lists, not retained side caches.
- Evidence: focused scanner-first e2e covers
  root-level and ruleset-local simple positional parameterized mixins,
  including `.paint(@color) { color: @color; } .a { .paint(blue); }`, with
  `runtimeTreeSource: structural-fed`, zero fallback/materialization counters,
  serialized `Mixin` params, `Call` args, and value `Reference`. Full
  scanner-first e2e passes. The Less corpus gate still reports 13
  structural-fed cases out of 65, 53 canonical fallbacks, zero requested
  islands, zero actual parser executions, zero promoted bytes, and 75
  progressive nodes; the mixin fallback distribution moved from seven
  definition/one call to six definition/two call fallbacks because one corpus
  case now passes definition-signature admission and stops at richer call
  syntax.

- Latest pass: scanner-first thin `@supports` declaration-condition prelude.
- Verdict: accepted as a structural-fed correctness proof, not a speed claim.
  The Less structural-fed path now admits `@supports (property: literal)` only
  when the parenthesized condition can be represented as
  `Paren(QueryCondition([property-token, literal-token]))`. Richer supports
  expressions, variable-bearing values, comments, multiline preludes, boolean
  operators, and nested conditions remain canonical fallback.
- Architecture surface: Less structural-fed admission/building plus core
  `AtRule` raw-name/structured-prelude header identity/rendering. This does
  not widen SCSS/Jess parsing and does not add language-service surface.
- Separation/duplication: the supports predicate/builder stays plugin-local
  and reuses existing `QueryCondition`/`Paren` nodes. No package export,
  parser profile, or grammar registry is duplicated; broader supports grammar
  remains canonical fallback.
- Cumulative node weight: this slice adds only semantic prelude nodes for the
  supported `@supports` condition and one core identity test fixture. It does
  not add cumulative `Rules` lookup/cache objects or a new side table.
- New traversal: no new tree traversal. The Less plugin adds one bounded regex
  recognition step over the already-isolated at-rule prelude string and reuses
  the existing block/rule/declaration structural-fed walks. Core `AtRule`
  header rendering adds no scan; it writes an existing structured prelude node
  when a raw at-rule name owns one.
- New node/materialization: the scanner-fed builder creates one `Paren`, one
  `QueryCondition`, one property `Any`, and one literal value node for the
  supports prelude. This is accepted as semantic prelude structure because the
  condition is not a raw atom and must not be stored as a raw prelude blob.
  `AtRule` raw-name semantic materialization still materializes only the raw
  at-keyword when eval/registration needs a canonical name; it does not
  materialize a raw supports prelude string.
- Render path: supported cases render equal CSS through structural-fed with
  zero full-tree fallback, zero selected island requests, zero actual parser
  executions, and zero promoted bytes. `AtRule` can now render `rawName` plus a
  structured `prelude` node directly, so the header does not first stringify a
  raw complex supports condition.
- Helper/API surface: one plugin-local literal-token-to-node helper and one
  plugin-local supports-condition recognizer. No public parser/core API is
  introduced; `RawAtRuleValue.prelude` is widened to the existing core `Node`
  type only so raw at-keyword storage can pair with structured prelude storage.
- Metadata mutations: none added beyond normal node construction/adoption. The
  focused proof intentionally leaves unrelated `AUDIT:` markers and broader
  `AtRule` cleanup outside this slice.
- Review-flagged diff tokens: [node construction] and
  [materialized array/object] matches are the focused core `AtRule.valueOf()`
  regression fixture constructing two raw-name `AtRule` nodes with empty body
  arrays to prove distinct structured supports preludes do not collide. They
  are test-only construction, not runtime parser/eval materialization.
- Review fix: sub-agent review caught that raw-name `AtRule.valueOf()` ignored
  structured preludes. The raw-name identity branch now uses the existing
  at-rule syntax identity helper for structured preludes, and a focused core
  test proves `@supports (display: grid)` and `@supports (display: flex)` do
  not collide before semantic materialization.
- Evidence: focused scanner-first e2e now covers root, nested declaration-body,
  nested rule-body, direct nested, and mixin-body `@supports` with
  `Paren(QueryCondition(...))` serialized preludes and zero island parser
  executions. Focused core at-rule identity coverage proves structured raw-name
  preludes participate in `valueOf()`. The Less corpus gate reports 13
  structural-fed cases out of 65, 53 canonical fallbacks, zero requested
  islands, zero actual parser executions, zero promoted bytes, and 75
  progressive nodes. Verification also covered core/plugin builds, package
  exports, eslint on touched implementation/e2e files, `git diff --check`, and
  aggressive cutting review.

- Latest pass: scanner-first docs/tooling review hardening.
- Verdict: accepted as a docs/tooling guardrail pass, not a runtime or
  performance claim. It records current scanner-first corpus evidence, reopens
  cumulative `Rules` ownership as an audit item, and tightens the aggressive
  cutting verifier so danger-token accounting must live in this latest pass
  block instead of anywhere in historical prose.
- Architecture surface: architecture documentation and review tooling only.
  Runtime parser/eval/render code is not changed by this pass.
- Separation/duplication: the docs identify `Rules` exact/prefix callable
  traversal as the first DRY cleanup candidate, and the verifier now separates
  latest-pass evidence from older self-prosecution entries.
- Cumulative node weight: the new binding audit item records accumulated
  `Rules` maps/caches as unresolved ownership work rather than accepting the
  current node weight as architecture-complete.
- New traversal: none in runtime code. The verifier scans only diff text and
  the latest self-prosecution block.
- New node/materialization: none.
- Render path: no render/stringification path changed.
- Helper/API surface: one private verifier extraction of the latest
  self-prosecution block; no package exports or runtime APIs.
- Metadata mutations: none.
- Review-flagged diff tokens: [array helper] is confined to verifier label
  accounting over current diff findings; [generic defensive read] and
  [side map/set] are documentation-only mentions of existing `Reflect`/Map/Set
  audit targets, not new runtime reads or side maps.
- Evidence: `git diff --check`, `node --check
  scripts/verify-aggressive-cutting-review.mjs`,
  `pnpm run verify:aggressive-cutting-review`, and sub-agent review of the
  docs/tooling diff.

- Latest pass: scanner-first deprecated no-parens mixin-call proof.
- Verdict: accepted as a bounded Less mixin-call proof, not a performance claim.
  The structural-fed path now admits only structural `mixin-call` nodes whose
  name is a scanner-native class/id mixin name with optional empty parens.
- New traversal/allocation: a warning collector walks the structural tree only
  on successful structural-fed prototype output. It allocates warning
  diagnostics only when a no-parens mixin call is present, and only then
  materializes line/column data through the lazy source map.
- New materialization: no eager selector/value materialization. The e2e proof
  asserts zero requested islands, zero actual parses, zero promoted bytes, raw
  declaration value storage, and preservation of the canonical
  `parse/deprecated` warning.
- Helper/API surface: no exports and no compatibility shims. Namespaced
  no-parens calls such as `#theme > .mixin;`, parameterized/guarded/important
  calls, and property-accessor calls remain canonical fallback.
- Metadata mutations: none added.
- Evidence: focused red-to-green scanner-first e2e proof, full scanner-first
  e2e suite, scanner-first Less corpus parity audit, Less plugin build, eslint,
  `git diff --check`, and aggressive cutting review.

- Latest pass: scanner-first complex-target `:extend(...)` proof.
- Verdict: accepted as a bounded Less extend semantics proof, not a performance
  claim. The structural-fed path now admits cheap target-only complex selectors
  such as `.base .child` while the owning ruleset selector remains raw.
- New traversal/allocation: one private target tokenizer walks only the
  already-matched `:extend(...)` target substring. It creates the
  `BasicSelector`, `Combinator`, and `ComplexSelector` nodes required for Less
  extend matching; it does not parse unrelated selectors, declarations, values,
  or child rules.
- New materialization: target selector materialization only. The e2e proof
  asserts zero requested islands, zero actual parses, zero promoted bytes, raw
  source selector storage, and raw declaration value storage. Unsupported
  pseudo/attribute/interpolated source selectors, compound/pseudo targets,
  `&:extend(...)`, and grouped extends remain canonical fallback.
- Helper/API surface: no exports and no compatibility shims. The helper is
  private to the Less plugin prototype and should be narrowed or replaced when
  the shared scanner-native selector materializer grows a reusable target mode.
- Metadata mutations: none added.
- Evidence: focused red-to-green scanner-first e2e proof, full scanner-first
  e2e suite, scanner-first Less corpus parity audit, Less plugin build, eslint,
  `git diff --check`, and aggressive cutting review.

- Latest pass: scanner-first simple `:extend(... all)` selector-header proof.
- Verdict: accepted as a bounded Less semantics proof, not a performance claim.
  The structural-fed path now admits only the already-cheap selector-header
  extend shape with an optional lowercase `all` flag; complex targets,
  interpolated selectors, pseudo/attribute source selectors, `&:extend(...)`
  statements, and multiple extend groups remain canonical fallback.
- New traversal/allocation: no new walks, side tables, arrays, or legacy parser
  islands. The proof reuses the existing single regex gate and constructs only
  the `Extend` plus target `BasicSelector` already required for Less extend
  registration; the owning ruleset selector remains a raw string.
- New materialization: no eager selector/value materialization. The e2e proof
  asserts zero requested islands, zero actual parses, zero promoted bytes, raw
  source selector storage, and the runtime `ExtendFlag.All` value.
- Helper/API surface: no exports and no compatibility shims. This is a private
  scanner-native token widening inside the Less plugin prototype.
- Metadata mutations: none added.
- Evidence: focused red-to-green scanner-first e2e proof, full scanner-first
  e2e suite, and scanner-first Less corpus parity audit.

- Latest pass: scanner-first multiline CSS grid template-area raw declaration
  proof.
- Verdict: accepted as a bounded scanner-fed render proof, not a performance
  claim. The Less structural-fed predicate now admits only property-specific
  `grid-template-areas` quoted rows with proven continuation indentation; the
  existing two-space multiline negative case remains canonical fallback.
- New traversal: two short raw-string loops in
  `packages/core/src/tree/declaration.ts` run only when a raw declaration has
  all-string segments and at least one newline. They do not walk AST children,
  parent links, source maps, side tables, or semantic scopes.
- New node/materialization: none. Raw declarations still keep string segments
  and the e2e proof asserts no `valueNode` materialization, zero requested
  islands, zero actual parses, and zero promoted bytes.
- Render path: direct raw writer output only. The writer restores canonical
  colon/newline placement for multiline raw values without constructing `Any`,
  `Sequence`, `List`, or declaration value wrappers.
- Helper/API surface: two private helpers in `declaration.ts` and one private
  Less plugin predicate helper. Nothing is exported; remove or narrow these
  helpers when multiline raw declaration formatting is represented by packed
  source-span metadata instead of string-segment normalization.
- Metadata mutations: none added.
- Review-flagged exception: `const segments = this._rawValueSegments ?? []`
  reuses the existing raw declaration segment array; it is not a new side map,
  semantic materialization, or eval isolation container.
- Evidence: focused red-to-green multiline CSS grid e2e proof; full
  `progressive-nodes.test.ts`; core build; full scanner-first e2e; scanner-first
  Less corpus including `tests-unit/css-grid/css-grid.less` moving to
  structural-fed; Less plugin build; eslint; `git diff --check`; aggressive
  cutting review.

- Latest pass: scanner-first recursive supported at-rules inside at-rule child
  rules.
- Verdict: accepted as a thin scanner-fed proof, not a performance claim. The
  Less structural-fed validator/builder now lets ordinary rules inside
  supported `@media` / `@supports` bodies keep accepting supported at-rule
  children. Core ruleset registration now reads a raw parent `AtRule.rawName`
  when deciding whether a parent at-rule body is nestable, avoiding eager
  `Any('@media')` header materialization for this raw-field path.
- New traversal: none. The Less plugin reuses the existing recursive rule and
  at-rule validation/build paths. Core adds one direct raw-name helper read in
  an existing ruleset registration decision; it does not add a new walk or
  side table lookup.
- New node/materialization: none in production. The review script flagged one
  test-only `new Context()` in `progressive-nodes.test.ts`; that context is the
  existing registration fixture needed to prove a raw-field child ruleset can
  prepare under a raw-field parent at-rule without materializing the header.
- Render path: direct raw render still writes raw at-rule names/preludes and raw
  declaration segments. The new e2e proof asserts equal CSS, structural-fed
  runtime source, zero full-tree fallback, zero requested islands, zero actual
  parses, zero promoted bytes, and serialized raw at-rule/declaration fields
  without `BasicSelector` or `Any` value wrappers.
- Helper/API surface: one private helper, `atRuleNameText(...)`, mirrors the
  existing `atRuleStatementNameText(...)` helper and keeps the raw-name branch
  local to `rules.ts`. It is not exported.
- Metadata mutations: none added.
- Review-flagged exception: the new `TypeError` preserves the previous
  invariant behavior for a malformed parent `AtRule` with neither `rawName` nor
  `name`. It is not a lookup miss, expected branch result, or routine
  scanner-fed fallback path.
- Evidence: focused red-to-green scanner-first e2e test; focused and full
  `progressive-nodes.test.ts`; focused eslint for the clean touched files; core
  build; Less plugin build; full scanner-first e2e; scanner-first Less corpus;
  `git diff --check`; aggressive-cutting review.

- Latest pass: scanner-first raw `@media` blocks inside no-argument Less mixin
  definitions.
- Verdict: accepted as a thin proof extension, not a performance claim. The
  Less structural-fed validator now allows mixin-body `@media` blocks only by
  reusing the existing at-rule validator; non-media at-rules still fall back.
  Callable surface copying now preserves raw-field `AtRule` headers while
  copying owned callable output, so a mixin call does not have to materialize
  canonical `Any` name/prelude nodes just to emit copied `@media` output.
- New traversal: none. The mixin validator delegates an already-visited
  `at-rule` child to the existing at-rule validation path. The callable copy
  change stays inside the existing recursive callable-copy traversal and only
  chooses raw header strings when the source at-rule already carries them.
- New node/materialization: no new production materialization. The review
  script flagged `new Declaration(...)` and `rules([])` in
  `callable-candidate-state.test.ts`; both are test fixtures for the raw
  at-rule copy regression. Runtime code adds no new node construction for this
  pass and specifically avoids constructing canonical at-rule header nodes for
  raw-field at-rules during callable copy.
- Render path: copied raw `AtRule` output renders through the existing raw
  at-rule render path. The new e2e proof asserts equal CSS, zero requested
  islands, zero actual parses, zero promoted bytes, and serialization without
  `BasicSelector` or `Any` declaration value nodes for the covered mixin shape.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Review-flagged exception: the new `TypeError` is an invariant failure for an
  impossible malformed `AtRule` copy source with neither raw nor canonical
  name. It is not routine branch control, lookup miss handling, or a hot-path
  negative result.
- Evidence: touched-file eslint; core build; Less plugin build; focused core
  callable-candidate-state test; scanner-first e2e test; scanner-first Less
  corpus test; aggressive-cutting review.

- Latest pass: scanner-first raw-field at-rule-statement/at-rule/ruleset/
  declaration proof.
- Verdict: deferred. This pass intentionally adds a tiny raw-field construction
  surface for scanner-first parser evidence, not a production migration or
  speed claim. It proves real core `AtRuleStatement`, `AtRule`, `Ruleset`, and
  `Declaration` nodes can render/serialize raw statement at-rule headers,
  block at-rule headers, selectors, declaration names, and declaration value
  payloads without allocating canonical header/selector/value child nodes on
  the direct render path. Semantic registration/eval
  materializes only the currently proven scanner-native at-rule header storage,
  simple selector subset (`*`, tag, `.class`, `#id`), adjacent basic compound
  selector subset, simple/flat literal declaration value text, conservative
  quoted/url declaration and Less variable value text, conservative raw
  custom-property value text, and declaration exact `!important` flag text on
  demand. The current Less structural-fed emitter uses raw core `AtRule` for
  root `@media`, ruleset-local `@media` with scanner-native declaration bodies
  or already-supported ordinary nested rules, root `@layer` with ordinary rule
  bodies, and root `@supports` with a single scanner-native declaration
  condition. It uses raw core `AtRuleStatement` for scanner-native root
  `@charset` statements. Statement-form `@import` remains a canonical fallback
  because import/reference ordering and file-resolution semantics are not
  proven in the cheap path. Nested block at-rule families outside that shape
  remain outside this proof and still require materializers or canonical
  fallback.
- New traversal: `packages/core/src/tree/declaration.ts`
  `Declaration.writeRawDeclarationSyntax(...)` loops over
  `rawValueSegments`. This is bounded to the raw segment count and replaces
  would-be wrapper nodes on the proof path; it is not on canonical declarations.
  `Declaration.materializeRawDeclarationParts(...)` also loops over raw
  segments only when semantic registration needs to turn mixed raw segments into
  a reachable canonical value container. `Ruleset.materializeRawSelectorForSemantics(...)`
  performs no traversal; it validates and materializes one raw simple selector
  string or adjacent basic compound selector at registration/eval boundaries.
  Compound selector materialization runs `splitRawCompoundSelector(...)` over the
  raw selector string and then loops over the returned parts only when semantics
  are requested; direct raw render does not enter either loop.
  `AtRule.materializeRawHeaderForSemantics(...)` performs no traversal; it
  materializes one raw at-rule name and optional raw prelude string at
  registration/eval boundaries. Extending the structural-fed emitter to root
  `@layer`, root `@supports`, and ruleset-local `@media` with ordinary nested
  rules reuses existing raw at-rule/ruleset storage and does not add render-time
  traversal. Extending declarations and variables to conservative quoted/url and
  raw custom-property values reuses the existing raw segment loop; it does not
  add another render traversal. `AtRuleStatement` raw-name import detection is
  a direct string read during existing registration scanning; it does not
  materialize statement header nodes and adds no new traversal.
- Aggressive Cutting Self-Prosecution, scanner-first nested ampersand pseudo
  selector proof: widening the raw selector subset to `&:focus` / `&::before`
  style branches adds one anchored branch recognizer and one cold semantic
  materialization case. Direct render/serialization still writes the raw selector
  string and does not allocate `Ampersand`, `PseudoSelector`, or selector
  wrapper nodes. If registration/eval asks for selector semantics, the raw
  branch materializes to the existing canonical `CompoundSelector` shape with
  one `new Ampersand(...)` and one `new PseudoSelector(...)`. Those node
  constructions are intentionally behind `materializeRawSelectorForSemantics()`,
  not on the direct render/stringify path, and replace a full selector parse for
  this proven branch. This does not claim general pseudo-selector support,
  selector-function argument parsing, attribute selectors, or Less
  nested-selector collapse.
- Aggressive Cutting Self-Prosecution, scanner-first important spelling proof:
  Widening the important splitter to accept spaced/case-variant flags is not a
  new parser and does not add a traversal. The structural-fed declaration path
  still carries one raw value segment plus one `rawImportant` string and direct
  render/serialization still avoids value-node and important-node allocation.
  This is deliberately a behavior-preservation proof: `! important` and
  `!IMPORTANT` render the way the current Less path renders them, not as a
  forced canonical spelling. It also does not widen custom-property important
  handling or Less-variable important handling.
- Aggressive Cutting Self-Prosecution, scanner-first color function allow-list
  proof: admitting `darken(...)` and `rgba(...)` reuses the existing
  scanner-native function value materializer and the same scalar argument
  subset already proven for `lighten(...)` and `rgb(...)`. This pass does not add
  another value parser, does not widen accepted argument grammar, and does not
  change direct raw render behavior; unsupported function names, named-color
  arguments, nested calls, comments, interpolation, and variable arguments still
  fall back canonically.
- Aggressive Cutting Self-Prosecution, scanner-first raw selector classifier
  DRY pass: core now owns the scanner-native raw selector admission predicates
  used by the Less plugin's structural-fed admission gate and by `Ruleset`'s
  progressive selector construction. The hot admission helper is boolean and
  does not allocate option objects. This pass does not widen selector syntax and
  does not settle visitor exposure for selector leaf nodes.
- Aggressive Cutting Self-Prosecution, compound selector string-component
  proof: `CompoundSelector` now accepts scanner-native simple selector strings
  and raw ruleset compound materialization passes split strings through instead
  of allocating `BasicSelector` leaves. This is deliberately compound-only:
  complex selectors still use existing branch/combinator structures, selector
  lists still own selector branches, and unsupported selector syntax does not
  enter the structural-fed subset. Visibility-clone recursion skips string
  leaves because no selector node exists to flag or clone. Ordered lookup keys,
  ampersand substitution, and extend matching now compare raw components through
  shared `valueText(...)` instead of materializing leaves only to call
  `valueOf()`. Visitor and source-map behavior must still be proven separately
  before treating raw strings as a general selector-node replacement, and
  attribute selectors remain raw candidates unless equality/matching semantics
  require structured attribute fields. Visitor exposure is not an automatic
  requirement: some selector atoms may intentionally have no Jess visitor
  surface if plugin research and Jess semantics do not justify materializing
  them.
  Latest correction: single raw string atoms also remain
  `CompoundSelector` surfaces during semantic materialization and extend
  processing. The extend processor now preserves raw string compound components
  while recursing only into already-materialized selector-node components, so
  `.base` can extend/serialize correctly without allocating a `BasicSelector`.
  The scanner-first extend proof is green again for exact, `all`, and
  complex-target Less extends with raw source selectors.
  Latest cleanup proof: focused extend/import tests now cover raw string
  compound exact matches, single-component `ComplexSelector` exact matches,
  import-root selection, and reference-mode generated `:is(...)` simplification
  for both `collapseNesting` modes. That does not complete the location-search
  deletion: complex dispatch, ampersand-boundary behavior, chained extends, and
  import/reference activation still need bounded migration before
  `findExtendableLocations` can be removed.
  Cleanup target: `walk-and-consume` should be the single extend matching
  surface. The older location-search fallback remains transitional debt from
  prior work; do not widen it as a design target. Before adding support for a
  new scanner-first extend shape, ask whether the walk path can produce the
  correct result directly from existing raw strings and nodes. Only keep
  location-search behavior that is still absolutely necessary for a proven
  correct result until it can be deleted.
  Danger-token prosecution: the touched `CompoundSelector` paths still allocate
  an owned component array when deriving evaluated component surfaces, because
  evaluated selector surfaces already need a placement-owned component list.
  This pass does not add another wrapper hierarchy; it removes `BasicSelector`
  leaf construction for scanner-native compound raw selector branches, including
  one-part raw compounds.
  `valueText(...)` is a small shared primitive for string-or-node comparison; it
  avoids parser-node allocation and avoids unsafe casts. The touched
  selector-match helper keeps one existing `ComplexSelector` remainder
  construction for non-raw complex remainder shapes; this is not part of the hot
  raw compound render path. The new `filter(...)` use is a typed narrowing pass
  over an existing compound component array during extend matching, not a new
  materialization policy. The new `TypeError` is an invariant failure for
  invalid internal raw component input, not routine control flow. The
  `.inherit(...)` calls remain the existing ownership boundary for derived
  selector surfaces. Test-only `throw new Error(...)` assertions are local
  invariant guards, not runtime behavior.
- Aggressive Cutting Self-Prosecution, scanner-first raw attribute selector
  atom proof: the raw selector classifier now admits a deliberately narrow
  attribute selector atom subset such as `[data-kind]` and
  `[data-kind="primary"]`. The progressive selector constructor scans bracketed
  atoms with quote-aware loops so compound, complex, and selector-list splitting
  can preserve the attribute text as a string component instead of parsing
  attribute fields. Commas or spaces inside quoted attribute values are not
  treated as selector boundaries. This is not a general attribute grammar:
  structured
  attribute equality, interpolation, comments, newlines, and richer selector
  pseudos remain outside this proof and must fall back or get their own
  materializer. Attribute visitor exposure is not promised and may explicitly
  stay unsupported for this atom family; plugin research and Jess semantics
  must prove that a node/field surface is worth preserving before this path
  pays for it. The new scanner loop replaces a
  regex-only split because regex matching could not safely distinguish brackets
  and quoted values without either rejecting useful cheap atoms or allocating a
  richer parser surface.
- Aggressive Cutting Self-Prosecution, scanner-first no-argument pseudo selector
  atom proof: the raw selector classifier now admits a deliberately narrow
  pseudo atom subset such as `:root`, `button:hover`, and `.a::before`.
  Progressive selector construction splits pseudo atoms as raw string
  components, not structured pseudo fields; the existing
  `&:focus` / `&::before` branch remains the special case that materializes an
  `Ampersand` plus `PseudoSelector` only when semantic registration demands
  parent substitution. Pseudos with arguments such as `:is(...)`, interpolation,
  comments, newlines, and richer selector grammar remain outside this proof.
  Pseudo names use the existing ident-like non-bare-hyphen subset, so `:-` and
  `::-` do not enter the structural-fed path. Single raw string atoms stay
  `CompoundSelector` surfaces across eval/resolve instead of collapsing into
  `BasicSelector`; this keeps class/id/type/universal, pseudo, and attribute
  atoms string-backed until a real semantic consumer needs a richer selector
  node.
  Pseudo leaf visitor exposure is not promised and may explicitly stay
  unsupported for this atom family unless plugin research or Jess semantics
  proves a node/field surface is worth preserving.
- Review-flagged allocations:
  `packages/core/src/tree/declaration.ts` lets ordinary `decl(...)` construct
  scanner-first declarations from raw string or mixed string/node values.
  Scanner-first flat literal declaration cases keep the value as one raw string
  segment for direct render/serialization; important declarations additionally
  store the raw flag as `rawImportant`. Neither path tokenizes into arrays/nodes
  until a later semantic materializer is requested. Focused tests add normal
  `new Context()` render setup. `packages/core/src/tree/ruleset.ts`
  stores simple selector atoms as strings and constructs thin
  `CompoundSelector`, `ComplexSelector`, and `SelectorList` containers with raw
  string leaves for scanner-native compound/list/complex selectors. The nested
  ampersand-pseudo proof keeps `&:focus` as a string until selector semantics
  demand the existing `Ampersand` plus `PseudoSelector` branch.
  `packages/core/src/tree/at-rule.ts`
  constructs `Any` header nodes only when a raw at-rule crosses into semantic
  registration/eval; direct raw render keeps `name` / `prelude` undefined and
  uses `rawName` / `rawPrelude`.
- Review-flagged array helper: `segments.map(...)` appears only in the semantic
  materialization fallback for mixed raw string/Node segments, where it creates
  the reachable canonical sequence payload. Direct raw render does not use this
  helper. `packages/core/src/tree/util/progressive-block-render.ts` remains
  limited to earlier standalone progressive proof nodes; the structural-fed
  root `@media` path now uses raw core `AtRule` and does not rely on that
  detached writer bridge.
- Review-flagged diff tokens: the raw declaration value type includes an array
  of string/Node segments. The array is caller-owned input for the explicit
  proof path; raw core rulesets still use the existing `rules: Node[]` body
  surface and do not reintroduce a nested `Rules` wrapper.
- New node/materialization: one explicit core `Declaration` via `decl(...)`
  raw string input, one progressive core `Ruleset` selector path, one raw-header core
  `AtRule` path, and one raw-header core `AtRuleStatement` path for
  statement-form at-rules. No
  `Any`, `Reference`, selector, header, or value wrapper nodes are created for
  raw statement at-rule/block at-rule header, selector, name, or value payloads
  during direct render. If semantic registration/eval asks for canonical parts,
  `Declaration.materializeRawDeclarationParts(...)` creates the canonical
  `Any` name/value/important nodes at that boundary and hides raw segment
  children from `childKeys` serialization/traversal so the canonical value is
  not also exposed through `rawValueSegments`. `Ruleset` stores atom selectors
  as strings or creates thin selector containers with raw string components for
  the proven compound/list/complex subset. `valueOf()` on those structured
  selector containers is a normalized selector representation; exact source
  spacing belongs to source spans/trivia, not the selector value string.
  `AtRule`
  creates canonical `Any` name/prelude nodes only for the proven raw root
  `@media` subset at registration/eval boundaries. `AtRuleStatement` direct
  render keeps `name` / `prelude`
  undefined and writes `rawName` / `rawPrelude`; existing import-registration
  scanning reads `rawName` directly so `@charset` does not materialize just to
  decide it is not `@import`.
- Render path: raw declarations stringify directly in
  `writeRawDeclarationSyntax(...)` and `render(...)`; rulesets write their
  string selector or selector container through the ordinary `Ruleset`
  render/serialize path; raw
  at-rules write `rawName` / `rawPrelude` directly in the ordinary `AtRule`
  render/serialize path; raw at-rule statements write `rawName` / `rawPrelude`
  directly in the ordinary `AtRuleStatement` render/serialize path. They do not
  resolve into canonical header/selector/value nodes just to print.
- Helper/API surface: ordinary `decl(...)` accepts raw string or mixed
  string/node declaration values through the existing core declaration
  entrypoint. `RawRulesetValue` is available through the existing
  `ruleset(...)` constructor type, `RawAtRuleValue` through the existing
  `atrule(...)` constructor type, and `RawAtRuleStatementValue` through
  `atrulestatement(...)`. This is
  deliberate API surface for scanner-first proof code and remains separate from
  ordinary canonical construction.
- Metadata mutations: none added.
- Parent/adoption mutations: `Declaration.materializeRawDeclarationParts(...)`
  adopts the materialized name/value/important nodes when the raw declaration
  crosses into semantic registration/eval, preserving the normal parent/child
  invariant at the materialization boundary. `Ruleset.materializeRawSelectorForSemantics(...)`
  adopts the created raw-component selector container when a string atom crosses
  into a semantic boundary, so subsequent traversal sees one selector
  representation, not both.
  `AtRule.materializeRawHeaderForSemantics(...)`
  adopts created `Any` header nodes and moves them into canonical `name` /
  `prelude` slots while clearing `rawName` / `rawPrelude`, so subsequent
  traversal sees one header representation, not both. `AtRuleStatement` direct
  render and import detection do not mutate parent/adoption state; its cold
  semantic materializer follows the same one-representation rule if a future
  statement-form semantic path requests canonical header nodes.
- Routine error control: none added. The new `TypeError` sites are construction
  and invariant guards for invalid raw selector input or impossible raw/canonical
  callable-copy state, not expected misses or branch control.
- Allocation changes: adds raw fields on `Declaration` instances for the proof
  path, string or thin-container selector storage on `Ruleset`, and raw header
  strings on `AtRule` and `AtRuleStatement`; avoids statement/header/name/value
  child node allocation for direct render and avoids `BasicSelector`,
  `AttributeSelector`, and pseudo leaf allocation for proven selector atoms. No
  speed claim until the structural-fed path is benchmarked under corpus gates.
- Evidence: focused `progressive-nodes.test.ts` passed with raw declaration,
  raw ruleset, raw at-rule, and raw at-rule-statement
  serialize/render/materialization assertions; `pnpm --filter @jesscss/core
  build`, package-scoped `pnpm --filter @jesscss/core test -- --run
  src/tree/__tests__/progressive-nodes.test.ts`, scanner-first e2e, Less corpus
  parity, `pnpm run verify:package-exports`, `pnpm run
  verify:aggressive-cutting-review`, and `git diff --check` passed. File-scoped
  eslint that includes `packages/core/src/tree/rules.ts` is blocked by
  pre-existing file-wide lint debt in that file; it is not used as proof for
  this slice.
- Latest pass: scanner-first parser prototype AST-shape cleanup, visitor
  traversal planning, and TS7 declaration stabilization.
- Verdict: accepted as a prototype-enabling shape cut, not a completed
  runtime-performance win. `Ruleset`, block-bearing `AtRule`, `Mixin`, and
  control nodes now use inherited `Rules` body behavior with `.rules: Node[]`
  at the container, while `AtRuleStatement` owns statement-form at-rules. The
  pass removes accidental nested body wrappers and arbitrary single-payload
  names where this slice reaches them, and rejects compatibility aliases for
  the removed names. No speed claim.
- New traversal: provider and semantic-index loops in the scanner-first parser
  are bounded scans over source structure or selected island plans. They are
  cold/prototype planning surfaces, not eval/render loops. `IslandParsePlan`
  now has a traversal-time visitor request helper that scans the already
  planned visitor rules for the reached structural node and requests only that
  node's owned islands; tests assert the helper does not execute providers or
  promote siblings. Core changes keep existing body iteration patterns on
  `Node[]` after removing nested `Rules` wrappers. The collapsed serializer
  adds one bounded look-ahead only when a disabled reference-mode `Rules`
  wrapper is reached, so it can decide whether to preserve the already-written
  current frame for later renderable siblings or roll back an otherwise empty
  frame. Added loops in tests are fixture construction/assertion only.
- New node/materialization: `AtRuleStatement` is a new semantic node for
  statement-form at-rules so block-bearing `AtRule` can inherit `Rules`
  without lying about imports/charsets. Structural-fed e2e materializes only
  selected selector/value islands for the bounded CSS/Less subset and records
  canonical fallback for unsupported syntax. SCSS/Jess provider tests promote
  only selected selector/value/control/module-at-rule islands and assert
  promoted-byte counters without full-tree fallback. Test-only node
  construction is fixture setup.
- Render path: the pass must not materialize children merely to stringify.
  Focused e2e tests prove plain rules and structurally handled declarations
  render equal while selected islands remain unrequested unless needed. Control
  render tests cover selected `$if`/`$for`/`$while` output through direct render
  surfaces. Review follow-up fixed disabled reference-mode wrappers under
  `collapseNesting`: hidden terminal wrappers stay invisible, hidden wrappers
  followed by renderable siblings no longer leave declarations under the prior
  sibling frame, and leading block trivia remains printable.
- Helper/API surface: `DefinedFunction` is an exported type-only name for
  TypeScript 7 declaration emit. It preserves the existing rich callable type
  surface instead of widening `defineFunction(...)` to a bare runtime function.
  Parser service helpers are prototype package surfaces with JSDoc and
  counters; they are not core eval/render helpers. SCSS/Jess provider
  entrypoints stay package-owned, and visitor method-table planning derives
  structural island interests without importing core visitor classes. The
  visitor planner now carries exact per-method materialization rules so
  `visitDeclaration` and `visitRuleset` do not cross-product all requested
  island kinds across every parent node kind; repeated plans reuse the cached
  rule array and report cache hits. The traversal request helper reports
  visitor traversal requests, materialized node requests, promoted island
  requests, adapter-node requests, replacement requests, and fallback
  full-tree materializations without importing compiler node classes.
- Metadata mutations: constructor adoption now reflects the direct body-array
  ownership model. A `Rules` instance passed where a body array is required is
  invalid; there is no compatibility conversion from old nested body wrappers.
  The Jess parser tree validator skips metadata/root pointers while continuing
  to verify owned child parentage. Review follow-up fixed lingering
  inherited-`Rules` assumptions: `toObject()` descends only through direct
  plain `Rules` wrappers, and array namespace callable lookup now passes
  `searchParents: false` into scope-frame lookup.
- Routine error control: scanner/parser recovery records diagnostics instead
  of allocating thrown `Error` objects for ordinary parse misses. Test-only
  throws remain as assertions.
- Allocation changes: intended reduction is one less nested `Rules` wrapper for
  inherited containers and no alias objects for removed field names. Remaining
  object count and speed claims are shelved until benchmark/profile evidence.
- Evidence: `git diff --check`; `pnpm run verify:aggressive-cutting-review`;
  `pnpm --filter @jesscss/core build`; focused core
  `control`/`define-function`/`define-function-split-sequence` tests;
  `pnpm --filter @jesscss/fns build`; `pnpm --filter @jesscss/fns test`;
  `pnpm --filter @jesscss/parser test`; `pnpm --filter @jesscss/css-parser
  test`; `pnpm --filter @jesscss/less-parser test`; `pnpm --filter
  @jesscss/scss-parser test`; `pnpm --filter @jesscss/scss-parser build`;
  `pnpm --filter @jesscss/jess-parser test`; `pnpm --filter
  @jesscss/jess-parser build`; `pnpm --filter @jesscss/plugin-less build`;
  `pnpm --filter @jesscss/plugin-less test`; `pnpm --filter
  @jesscss/plugin-scss build`; `pnpm --filter @jesscss/plugin-scss test`;
  `pnpm run verify:package-exports`; and the focused scanner-first e2e/Jess
  diagnostic pair all pass in this worktree. Latest focused checks also cover
  `toObject()` plain wrapper descent, array namespace `searchParents: false`,
  disabled reference-wrapper collapse/trivia behavior, repeated reference
  imports, parser visitor traversal counters, and plugin structural activation.

- Latest pass: Less-compat raw primitive visitor boundary and scanner-first
  corpus recovery.
- Verdict: accepted as a correctness and prototype-boundary fix, not a speed
  claim. Primitive raw selector/value segments are not Less visitor nodes, and
  raw selector adapters no longer pass strings into `WeakSet`-backed adapter
  caches. Less adapter nodes now follow the current `.rules: Node[]` and
  `.value` shapes instead of removed nested `Rules.rules` and `List.items`
  aliases.
- New traversal: none added.
- New node/materialization: raw Less selector/element compatibility objects are
  created only at the Less adapter boundary for primitive selector strings; no
  core selector/value nodes are materialized for the scanner-first raw path.
- Render path: unchanged; focused scanner-first e2e continues to prove raw
  declaration and selector render paths do not request islands or promoted
  bytes.
- Helper/API surface: `RawLessSelector`, `RawLessElement`, and
  `RawLessCombinator` make the existing compatibility boundary explicit instead
  of pretending every Less-compatible object wraps a Jess `Node`.
- Metadata mutations: none.
- Evidence: `pnpm --filter @jesscss/plugin-less-compat build`; `pnpm --filter
  @jesscss/plugin-less-compat exec vitest --run
  test/integration/plugin-manager.test.ts`; `pnpm --filter @jesscss/core test
  -- --run src/tree/__tests__/progressive-nodes.test.ts
  src/tree/util/__tests__/raw-selector.test.ts`; `pnpm --filter jess test --
  --run test/scanner-first-e2e.test.ts`; and
  `JESS_SCANNER_FIRST_CORPUS_DETAILS=1 pnpm --filter jess test -- --run
  test/scanner-first-less-corpus.test.ts -t "matches current compiler output"`
  pass. The focused corpus snapshot records 12 structural-fed prototype
  records, 54 canonical fallbacks, zero requested islands, zero actual parses,
  zero promoted bytes, and 71 progressive nodes across the included 64-file /
  65-case upstream Less corpus.

- Latest pass: walk-side extend cleanup for raw compounds, single-component
  complex selectors, batched exact matches, and target-presence classification.
- Verdict: accepted as a deletion-enabling correctness split, not a speed
  claim. The walk-and-consume surface now covers raw string compound exact and
  partial matching, single-component `ComplexSelector` whole-item matching,
  same-target batched exact selector-list extension, and root activation checks
  that need target presence rather than output-change semantics.
  `classifyExtendTargetPresence` reuses the walk decomposition with the
  self-extend output-change guard disabled, and `extend-roots.ts` no longer
  calls `findExtendableLocations(...).hasMatches`.
- New traversal: no new selector walk family. `applyBatchedExtend` now asks the
  existing walk classifier instead of the legacy location-search classifier for
  its same-target selector-list branch. The target-presence helper uses the
  existing `wouldMatchNode` traversal with a boolean guard to distinguish
  presence from output-change classification.
- New node/materialization: one cold, local `CompoundSelector.create([raw])`
  surface is created inside raw compound component matching so the existing
  whole-match application path can produce the same `:is(...)`/selector-list
  shapes for raw string components. Single-component complex matching and
  target-presence classification add no node materialization.
- Render path: unchanged.
- Helper/API surface: one exported helper was added to `extend-walk.ts` and is
  immediately used to remove the legacy location-search dependency from
  `extend-roots.ts`. The batched exact-match branch uses existing
  `classifyExtendMatch`; no new public core API is intended.
- Metadata mutations: none.
- Evidence: `pnpm --filter @jesscss/core test -- --run
  src/tree/util/__tests__/extend-walk.test.ts
  src/tree/util/__tests__/extend-selector-algorithm.test.ts` passes.

- Latest pass: scanner-first internal raw-selector export and Jess module
  at-rule island owner reconstruction.
- Verdict: accepted as a package-boundary and provider-correctness fix, not a
  speed claim. Raw selector admission helpers no longer ride the public core
  barrel; the Less plugin imports the explicitly internal scanner-first
  subpath. Jess module at-rule islands reconstruct only the owning at-rule
  statement from structural `nameStart`/`nameEnd` offsets before dispatching to
  the existing Jess parser rule, because the shared structural island is the
  prelude slice rather than the whole statement.
- New traversal: none added. The Jess provider reads one owner node already on
  the island execution context and slices the existing source text.
- New node/materialization: none added. The provider still returns the existing
  Jess parser result only when a Jess module at-rule island is explicitly
  requested.
- Render path: unchanged.
- Helper/API surface: `@jesscss/core/internal/raw-selector` is an intentionally
  internal scanner-first subpath used by the Less plugin. The public core tree
  barrel no longer exports those helpers as general core API.
- Metadata mutations: none.
- Evidence: `pnpm --filter @jesscss/core build`; `pnpm run
  verify:package-exports`; `pnpm --filter @jesscss/jess-parser test --
  test/island-providers.test.ts`; `pnpm --filter @jesscss/jess-parser test`;
  `pnpm --filter @jesscss/jess-parser build`; `pnpm --filter jess test -- --run
  test/scanner-first-e2e.test.ts`; `JESS_SCANNER_FIRST_CORPUS_DETAILS=1 pnpm
  --filter jess test -- --run test/scanner-first-less-corpus.test.ts -t
  "matches current compiler output"`; and `git diff --check` pass.

- Latest pass: `Mixin` callable-wrapper source-parent preservation.
- Verdict: accepted as a bounded callable-output ownership pass inside the
  still-open `Mixin` row. Static direct mixin output and ruleset-as-mixin
  placement now keep reused canonical declaration children attached to their
  source `Rules` during registration prep instead of re-parenting them onto the
  transient output wrapper before eval completes. No speed claim.
- New traversal: none.
- Review-flagged allocations: none added.
- New node/materialization: none. The pass preserves the existing reused-child
  contract rather than introducing a new copied output surface.
- Render path: unchanged. This pass only changes registration/eval ownership
  behavior for reused callable output children and does not add a new render
  string boundary.
- Helper/API surface: none added.
- Metadata mutations: one existing registration-prep `adopt(...)` point in
  `Rules._storePreparedRegistrationNode(...)` now skips the re-parenting write
  when the prepared node is an already-reused child owned by the carried source
  `Rules`, and static callable wrappers now stamp `sourceNode` eagerly so that
  ownership check has the final source identity available before output-slot
  attachment. No generic defensive read was added.
- Routine error control: none added.
- Allocation changes: none added.
- Evidence: focused
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts -t "source-backed without moving source children|ruleset-as-mixin placement children owned"`
  now passes. Full reruns of `mixin.test.ts` and `import-style.test.ts` show
  the earlier ownership failures are gone; remaining red is confined to four
  callable namespace / child-surface lookup misses in `mixin.test.ts` and four
  import child-surface / namespace / parent-chain misses in
  `import-style.test.ts`.

- Latest pass: `ComplexSelector` leading-combinator spacing truth-sync.
- Verdict: accepted as a small serializer truth-sync inside the already-closed
  `ComplexSelector` row. Relative selectors that start with a combinator now
  emit their final `> .child` / `+ .child` shape directly instead of borrowing
  the interior-combinator spacing rule and shifting nested ruleset indentation
  by one column. No speed claim.
- New traversal: none.
- Review-flagged allocations: none.
- New node/materialization: none.
- Render path: no new render branch was added. The pass only corrects the
  direct combinator token emitted by `ComplexSelector.writeSyntax(...)` when
  the combinator is the first component.
- Helper/API surface: none added.
- Metadata mutations: none.
- Routine error control: none added.
- Allocation changes: none.
- Evidence: focused `selector-complex.test.ts` now proves the leading
  combinator shape directly, and the combined
  `selector-complex.test.ts + reference.test.ts` suite passed. This clears the
  `reference.test.ts` complex-selector render regression that had been adding
  a stray leading space before nested `>` selectors. Remaining red tests in
  `import-style.test.ts` and `mixin.test.ts` are now confined to child-surface
  / namespace lookup and placement ownership lanes outside this serializer
  truth-sync.

- Latest pass: `Sequence` direct syntax/render alignment plus collapsed
  reference-wrapper rollback.
- Verdict: accepted as a bounded serializer cut inside the active
  `Sequence` lane. `Sequence` now owns source syntax through `writeSyntax(...)`,
  compares against `Any` via direct sequence syntax plus the shared whitespace
  normalizer, keeps static/dynamic flat-buffer render aligned with the live
  shared-writer contract, and no longer leaks explicit-writer buffer text back
  into the caller writer. Collapsed container serialization also rolls back
  just-opened frame headers when a reference-only child `Rules` wrapper emits
  nothing, so collapse mode stops leaving empty wrapper shells behind. No speed
  claim.
- New traversal: the new sequence loops are the direct item walks that replace
  broader whole-sequence string transport and filtered replacement-array
  staging. No new recursive tree walk was added.
- Review-flagged allocations: one shared-writer `OutputWriter` is created only
  when a shared flat render buffer needs a live writer bound directly to the
  target `parts` array; this replaces whole-string writeback on that path.
- New node/materialization: none. No new AST nodes, wrapper `Rules`, or copied
  sequence replacement arrays were added on the render path.
- Render path: static sequence render now uses the owned sequence syntax writer
  for source-backed output, while shared flat-buffer render reuses the active
  writer and returns the local emitted slice from that same stream. Dynamic
  direct render still stringifies through the sequence-owned mark/readback
  boundary, but it no longer nests an outer buffer writeback boundary. The
  collapsed reference-wrapper fix lives in `serialize-helper.ts`: if a child
  `Rules` wrapper writes nothing under reference suppression, the serializer now
  restores the just-opened frame/header state instead of leaving an empty
  container shell in the caller output.
- Helper/API surface: two node-local helpers were added in
  `sequence.ts` (`sequenceNodeTrivia(...)` and
  `sequenceRenderSharesWriter(...)`) plus one internal direct-render helper
  that lets static render, dynamic render, and buffer render stay on the same
  owned sequence path. No public API changed.
- Metadata mutations: none added on nodes. The row now reads node-local
  `_treeContext` trivia when a sequence has not yet been rooted, because the
  focused source/render whitespace tests carry trivia directly on the leaf
  nodes rather than through a source root.
- Routine error control: none added.
- Allocation changes: deleted the old per-call compare normalizer closure in
  `Sequence.compare(...)`, deleted the static render nil-filter replacement
  array path, and deleted the empty collapsed wrapper output in the reference
  suppression case. One shared-writer `OutputWriter` remains on the shared flat
  buffer path as the owned output target instead of whole-string writeback.
- Evidence: focused `sequence.test.ts`, focused
  `nesting-collapse.test.ts -t "streams reference rule wrappers in collapsed containers without capture scaffolding"`,
  and the combined focused bundle
  `sequence.test.ts + node-render-buffer.test.ts + nesting-collapse.test.ts + any.test.ts + rules-streaming.test.ts`
  passed, along with `pnpm --filter @jesscss/core build` and `git diff --check`.
  `pnpm run verify:aggressive-cutting-review` now flags the intentional new
  direct loops/shared-writer helper so this handoff block prosecutes them
  explicitly. An attached `pnpm run verify:baseline -- --changed` rerun no
  longer fails in the old `Sequence` / `node-render-buffer` /
  `nesting-collapse` serializer cluster, but the broader branch baseline still
  stops at `6 failed | 125 passed | 2 skipped` / `21 failed | 2576 passed`
  before hanging in the late `extend-less-fixtures.test.ts` and
  `extend-serialized-target.test.ts` tail, so the changed baseline is still
  red outside this diff.

- Latest pass: `Any.compare(...)` owned-text compare branch and `Rules`
  streaming proof sync.
- Verdict: accepted as a tiny serializer truth-sync pass. `Any.compare(...)`
  now uses the shared compare normalizer while reading the left operand from
  owned scalar text, so the remaining compare branch no longer serializes the
  left token through public `toString(...)`. The `Rules` streaming mark-count
  proof was also synchronized to the already-landed child-container mark
  reduction. No speed claim.
- New traversal: none.
- Review-flagged allocations: none.
- New node/materialization: none.
- Render path: no runtime render path changed beyond the compare branch above.
  `Any.compare(...)` now normalizes `this.value` directly instead of formatting
  the left operand through the public string transport, and the `Rules`
  streaming test now expects the current four-mark behavior already produced by
  the serializer.
- Helper/API surface: no new helpers beyond reusing the existing shared
  compare normalizer.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: removed the per-call local compare normalizer closure in
  `Any.compare(...)`; no node copies, wrappers, or carried caches added.
- Evidence: focused `any.test.ts`, focused `rules-streaming.test.ts`, combined
  `any.test.ts` + `rules-streaming.test.ts`, `git diff --check`,
  `pnpm run verify:aggressive-cutting-review`, and
  `pnpm --filter @jesscss/core build` passed. An attached
  `pnpm run verify:baseline -- --changed` rerun still surfaces the existing
  branch-red `Sequence` / render-alignment cluster (`sequence.test.ts`,
  `node-render-buffer.test.ts`, `nesting-collapse.test.ts`, plus downstream
  follow-on suites) outside this diff; that broader lane still needs separate
  repair before the changed baseline will go green again.

- Latest pass: `If` / `For` / `While` outer source-capture readback split.
- Verdict: accepted as a bounded control-node serializer cut. Public source
  capture for `If`, `For`, and `While` no longer wraps `writeSyntax(...)` in
  an outer whole-buffer `mark()/getSince()` readback window just to return the
  emitted directive text; each now recovers its local control syntax from the
  active writer tail while preserving the existing direct child writers and
  loop/branch render behavior. No speed claim.
- New traversal: one straight chunk join over the active writer tail in a new
  shared node-local helper inside `packages/core/src/tree/control.ts`. This
  replaces the outer control capture windows; it does not add a new scan over
  branch selection, loop iteration, or binding state.
- Review-flagged allocations: no production node allocations. Focused proof
  adds one `WholeBufferCountingWriter` in `control.test.ts` to confirm the
  outer whole-buffer readback is gone for all three directive families.
- New node/materialization: none.
- Render path: control render/eval behavior is unchanged. The pass changes
  only public source capture and does not materialize replacement branch,
  iteration, or state wrapper nodes to recover text.
- Helper/API surface: one shared node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/control.ts`. It replaces the outer
  `If` / `For` / `While` `toTrimmedString(...)` readback wrappers; no public
  API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the shared node-local
  helper because `OutputWriter` still exposes `position()` but not a
  cold/internal tail-text reader.
- Routine error control: none added.
- Allocation changes: deletes the outer `mark()/getSince()` whole-buffer
  capture from `If.toTrimmedString(...)`, `For.toTrimmedString(...)`, and
  `While.toTrimmedString(...)`.
- Evidence: focused `control.test.ts` source-serialization and whole-buffer
  readback cases for `If`, `For`, and `While` passed, and full
  `control.test.ts` passed.

- Latest pass: `VarDeclaration` outer source-capture readback split.
- Verdict: accepted as a bounded `VarDeclaration` serializer cut. Public
  variable-declaration source capture no longer wraps `writeSyntax(...)` in an
  outer whole-buffer `mark()/getSince()` readback window just to return the
  emitted declaration text; it now recovers the local declaration text from
  the active writer tail while preserving the existing variable-prefix and
  shared declaration-body ownership. No speed claim.
- New traversal: one straight chunk join over the active writer tail in a new
  node-local helper inside `packages/core/src/tree/declaration-var.ts`. This
  replaces the outer declaration capture window; it does not add a new scan
  over unrelated declaration registration or binding state.
- Review-flagged allocations: no production node allocations. Focused proof
  adds one `WholeBufferCountingWriter` in `var-declaration.test.ts` to confirm
  the outer whole-buffer readback is gone.
- New node/materialization: none.
- Render path: variable-declaration render/eval behavior is unchanged. The
  pass changes only public source capture and does not materialize replacement
  declaration nodes or binding wrappers to recover text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/declaration-var.ts`. It replaces the outer
  `VarDeclaration.toTrimmedString(...)` readback wrapper; no public API
  changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader.
- Routine error control: none added.
- Allocation changes: deletes the outer `mark()/getSince()` whole-buffer
  capture from `VarDeclaration.toTrimmedString(...)`.
- Evidence: focused `var-declaration.test.ts` cases for public source syntax
  and source capture without outer whole-buffer readback passed, and full
  `var-declaration.test.ts` passed.

- Latest pass: `Func` outer source-capture readback split.
- Verdict: accepted as a bounded `Func` serializer cut. Public function source
  capture no longer wraps `writeSyntax(...)` in an outer whole-buffer
  `mark()/getSince()` readback window just to return the emitted definition
  text; it now recovers the local function text from the active writer tail
  while preserving the direct name/param/body writer shape and existing call
  evaluation behavior. No speed claim.
- New traversal: one straight chunk join over the active writer tail in a new
  node-local helper inside `packages/core/src/tree/function.ts`. This
  replaces the outer function capture window; it does not add a new scan over
  unrelated callable evaluation state.
- Review-flagged allocations: no production node allocations. Focused proof
  adds one `WholeBufferCountingWriter` in `func.test.ts` to confirm the outer
  whole-buffer readback is gone.
- New node/materialization: none.
- Render path: function render/eval behavior is unchanged. The pass changes
  only public source capture and direct source child writing; it does not
  materialize replacement params, wrapper rules, or callable collections to
  recover text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/function.ts`. It replaces the outer
  `Func.toTrimmedString(...)` readback wrapper; no public API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader.
- Routine error control: none added.
- Allocation changes: deletes the outer `mark()/getSince()` whole-buffer
  capture from `Func.toTrimmedString(...)` and removes public child string
  transport for function name/params on the direct source path.
- Evidence: focused `func.test.ts` cases for public source syntax and source
  capture without outer whole-buffer readback passed, and full `func.test.ts`
  passed.

- Latest pass: `Operation` outer source-capture readback split.
- Verdict: accepted as a bounded `Operation` serializer cut. Public operation
  source capture no longer wraps `writeSyntax(...)` in an outer whole-buffer
  `mark()/getSince()` readback window just to return the emitted operand text;
  it now recovers the local operation text from the active writer tail while
  preserving the existing direct operand writer and render/eval behavior. No
  speed claim.
- New traversal: one straight chunk join over the active writer tail in a new
  node-local helper inside `packages/core/src/tree/operation.ts`. This
  replaces the outer operation capture window; it does not add a new scan over
  unrelated arithmetic/calc state.
- Review-flagged allocations: no production node allocations. Focused proof
  adds one `WholeBufferCountingWriter` in `operation.test.ts` to confirm the
  outer whole-buffer readback is gone.
- New node/materialization: none.
- Render path: operation render behavior is unchanged. The pass changes only
  public source capture and does not materialize replacement operands or
  wrapper operations to recover text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/operation.ts`. It replaces the outer
  `Operation.toTrimmedString(...)` readback wrapper; no public API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader.
- Routine error control: none added.
- Allocation changes: deletes the outer `mark()/getSince()` whole-buffer
  capture from `Operation.toTrimmedString(...)`.
- Evidence: focused `operation.test.ts` cases for public source syntax,
  direct child-writer source transport, and source capture without outer
  whole-buffer readback passed, and full `operation.test.ts` passed.

- Latest pass: `Ampersand` outer source-capture readback split.
- Verdict: accepted as a bounded `Ampersand` serializer cut. Public ampersand
  source capture no longer wraps `writeSyntax(...)` in an outer whole-buffer
  `mark()/getSince()` readback window just to return the emitted selector
  text; it now recovers the local ampersand text from the active writer tail
  while preserving the existing append/collapse selector ownership. No speed
  claim.
- New traversal: one straight chunk join over the active writer tail in a new
  node-local helper inside `packages/core/src/tree/ampersand.ts`. This
  replaces the outer ampersand capture window; it does not add a new scan over
  unrelated selector-placement state.
- Review-flagged allocations: no production node allocations. Focused proof
  adds one `WholeBufferCountingWriter` in `ampersand.test.ts` to confirm the
  outer whole-buffer readback is gone.
- New node/materialization: none.
- Render path: ampersand render/collapse behavior is unchanged. The pass
  changes only public source capture and does not materialize selector wrappers
  or placement nodes to recover text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/ampersand.ts`. It replaces the outer
  `Ampersand.toTrimmedString(...)` readback wrapper; no public API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader.
- Routine error control: none added.
- Allocation changes: deletes the outer `mark()/getSince()` whole-buffer
  capture from `Ampersand.toTrimmedString(...)`.
- Evidence: focused `ampersand.test.ts` cases for bare stack-local
  serialization, direct source syntax, and source capture without outer
  whole-buffer readback passed, and full `ampersand.test.ts` passed.

- Latest pass: `Call` outer source-capture readback split.
- Verdict: accepted as a bounded `Call` serializer cut. Public call source
  capture no longer wraps `writeSyntax(...)` in an outer whole-call
  `mark()/getSince()` readback window once the exact-text fast path falls
  cold; it now recovers the local call text from the active writer tail while
  preserving the existing direct child-writer contract. No speed claim.
- New traversal: one straight chunk join over the active writer tail in the
  existing node-local helper `getWriterTextSincePosition(...)` inside
  `packages/core/src/tree/call.ts`. This replaces the outer whole-call capture
  window; it does not add a new scan over unrelated call state.
- Review-flagged allocations: no production node allocations. Focused proof
  adds one `WholeBufferCountingWriter` in `call.test.ts` to confirm the outer
  whole-call readback is gone.
- New node/materialization: none.
- Render path: call render behavior is unchanged. The pass changes only public
  source capture and does not materialize fallback `Call` nodes, arg lists, or
  content nodes to recover text.
- Helper/API surface: no new helper surface. The pass reuses the existing
  node-local active-writer tail reader already present in
  `packages/core/src/tree/call.ts`.
- Metadata mutations: no new metadata mutation. The existing boxed
  `Reflect.get(writer, 'chunks')` stays where it already was; this pass does
  not add a new generic writer probe.
- Routine error control: none added.
- Allocation changes: deletes the outer whole-call `mark()/getSince()`
  capture from `Call.toTrimmedString(...)`.
- Evidence: focused `call.test.ts` cases for direct child-writer source
  syntax and custom call source syntax without outer whole-call readback both
  passed, and full `call.test.ts` passed.

- Latest pass: `Rules` outer source-capture readback split.
- Verdict: accepted as a bounded `Rules` serializer cut. Public `Rules`
  source capture no longer wraps `writeSyntax(...)` in an outer
  `mark()/getSince()` whole-buffer readback window just to return the emitted
  rules text; it now recovers the local rules text from the active writer tail
  while preserving the still-live inner rules serializer capture points. No
  speed claim.
- New traversal: one straight chunk join over the active writer tail in a new
  node-local helper inside `packages/core/src/tree/rules.ts`. This replaces
  the outer rules capture window; it does not add a new scan over unrelated
  rule/body state.
- Review-flagged allocations: no production node allocations. Focused proof
  adds one `WholeBufferCountingWriter` in `rules.test.ts` to confirm the outer
  whole-buffer readback is gone.
- New node/materialization: none.
- Render path: rules render behavior is unchanged. The pass changes only
  public source capture and does not materialize wrapper roots, rulesets, or
  declarations to recover text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/rules.ts`. It replaces the outer
  `Rules.toTrimmedString(...)` readback wrapper; no public API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader.
- Routine error control: none added.
- Allocation changes: deletes the outer `mark()/getSince()` whole-buffer
  capture from `Rules.toTrimmedString(...)`.
- Evidence: focused `rules.test.ts` cases for source syntax through
  `writeSyntax(...)` ownership and source capture without outer readback both
  passed.

- Latest pass: `Ruleset` outer source-capture readback split.
- Verdict: accepted as a bounded `Ruleset` serializer cut. Public ruleset
  source capture no longer wraps `writeSyntax(...)` in an outer
  `mark()/getSince()` readback window just to return the emitted ruleset text;
  it now recovers the local ruleset text from the active writer tail while
  preserving the still-live inner header/body serializer capture points. No
  speed claim.
- New traversal: one straight chunk join over the active writer tail in a new
  node-local helper inside `packages/core/src/tree/ruleset.ts`. This replaces
  the outer ruleset capture window; it does not add a new scan over unrelated
  selector/body state.
- Review-flagged allocations: no production node allocations.
- New node/materialization: none.
- Render path: ruleset render behavior is unchanged. The pass changes only
  public source capture and does not materialize selectors, rules, or wrapper
  rulesets to recover text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/ruleset.ts`. It replaces the outer
  `Ruleset.toTrimmedString(...)` readback wrapper; no public API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader.
- Routine error control: none added.
- Allocation changes: deletes the outer `mark()/getSince()` capture from
  `Ruleset.toTrimmedString(...)`. The remaining single readback on the covered
  simple path belongs to the still-live inner ruleset serializer boundaries.
- Evidence: focused `ruleset.test.ts` cases for source syntax through
  `writeSyntax(...)` ownership and source capture without the outer ruleset
  readback both passed.

- Latest pass: `Declaration` outer source-capture readback split.
- Verdict: accepted as a bounded `Declaration` serializer cut. Public
  declaration source capture no longer wraps `writeDeclarationValueSyntax(...)`
  in a second declaration-level `mark()/getSince()` readback window just to
  return the text it already emitted; it now recovers the local declaration
  text from the active writer tail while preserving the still-needed inner
  value-formatting replacement window. No speed claim.
- New traversal: one straight chunk join over the active writer tail in a new
  node-local helper inside `packages/core/src/tree/declaration.ts`. This
  replaces the outer declaration capture window; it does not add a new scan
  over unrelated declaration state.
- Review-flagged allocations: none added on the production path.
- New node/materialization: none.
- Render path: declaration render still stringifies directly through the owned
  declaration writer. The pass changes only public source capture and does not
  materialize temporary declarations, nodes, or arrays to recover text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/declaration.ts`. It replaces the outer
  `declValueTrimmedString(...)` readback wrapper; no public API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader.
- Routine error control: none added.
- Allocation changes: deletes the outer declaration-level `mark()/getSince()`
  capture from `declValueTrimmedString(...)`. The remaining single readback on
  the covered simple path belongs to the still-live non-custom value
  formatting `replaceSince(...)` window.
- Evidence: focused `declaration.test.ts` cases for non-custom declaration
  syntax without outer string readback and declaration source capture without
  the outer declaration readback both passed.

- Latest pass: `Block` child public-string transport split.
- Verdict: accepted as a bounded `Block` serializer cut. Block source/render
  syntax no longer routes child output through public `toString(...)` before
  capturing the surrounding delimiters; it now writes child syntax directly,
  emits boundary trivia explicitly, and recovers the local block text from the
  active writer tail. No speed claim.
- New traversal: one straight chunk join over the active writer tail in a new
  node-local helper inside `packages/core/src/tree/block.ts`. This replaces
  whole-block mark/readback plus child public string transport; it does not add
  a new scan over unrelated block state.
- Review-flagged allocations: no production node allocations. Focused test
  proof adds one `WriteOnlyNode`, one `CountingWriter`, and a thrown assertion
  only inside `block.test.ts` to prove child public string transport stays
  dead.
- New node/materialization: none.
- Render path: block render still stringifies block syntax directly around the
  source/evaluated child node. The pass does not materialize replacement nodes
  or arrays just to capture block text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/block.ts`. It replaces block-local mark/readback and
  child public string transport; no public API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader.
- Routine error control: none added on the production path. The only new
  thrown error is the focused test assertion in `block.test.ts`.
- Allocation changes: deletes the child `toString(...)` transport and outer
  `mark()/getSince()` capture from `renderBlockSyntax(...)`.
- Evidence: focused `block.test.ts` cases for source block syntax through
  `toTrimmedString()`, child syntax without child public string transport, and
  source trivia before the closing delimiter all passed.

- Latest pass: `Condition` child public-string transport split.
- Verdict: accepted as a bounded `Condition` serializer cut. Public
  `Condition.toTrimmedString(...)` no longer rebuilds syntax through child
  `toTrimmedString()` calls after already writing direct condition syntax; it
  now recovers the emitted local condition text from the active writer tail so
  custom child `writeSyntax(...)` stays authoritative. No speed claim.
- New traversal: one straight chunk join over the active writer tail in a new
  node-local helper inside `packages/core/src/tree/condition.ts`. This
  replaces child public string transport during condition string capture; it
  does not add a new scan over unrelated condition state.
- Review-flagged allocations: no production node allocations. Focused test
  proof adds one `WriteOnlyNode`, one `CountingWriter`, and a thrown assertion
  only inside `condition.test.ts` to prove child public string transport stays
  dead.
- New node/materialization: none.
- Render path: condition rendering still evaluates to boolean text directly.
  The pass changes only public syntax capture and does not resolve condition
  children into nodes or arrays just to stringify.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/condition.ts`. It replaces duplicate child
  public-string rebuilding inside `Condition.toTrimmedString(...)`; no public
  API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, is boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader.
- Routine error control: none added on the production path. The only new
  thrown error is the focused test assertion in `condition.test.ts`.
- Allocation changes: deletes the child `toTrimmedString()` rebuilding path
  from `Condition.toTrimmedString(...)`.
- Evidence: focused `condition.test.ts` cases for boolean-only syntax without
  writer readback, boolean comparison syntax without writer readback, negated
  boolean comparison syntax without writer readback, and custom child syntax
  without child public string transport all passed.

- Latest pass: `QueryCondition` static-async writer-tail recovery split.
- Verdict: accepted as a bounded `QueryCondition` serializer cut. Static async
  custom query children that write different text than they return no longer
  recover that local text through `hasContentSince(before)` plus
  `getSince(before)`; the static child branch now uses plain writer-position
  checks and active-writer tail recovery while preserving the same
  custom-versus-direct child contract. No speed claim.
- New traversal: none beyond the already-prosecuted straight chunk join in the
  existing `getWriterTextSincePosition(...)` helper.
- Review-flagged allocations: none added on the production path.
- New node/materialization: none.
- Render path: query-condition render still stringifies directly. The pass
  deletes the remaining static-async custom child readback boundary; it does
  not materialize intermediate nodes, arrays, or wrapper queries to recover
  text.
- Helper/API surface: none added. The pass reuses the existing
  `getWriterTextSincePosition(...)` helper inside
  `packages/core/src/tree/query-condition.ts`.
- Metadata mutations: none added beyond the previously-prosecuted localized
  `Reflect.get(writer, 'chunks')` read already boxed inside that helper.
- Routine error control: none added.
- Allocation changes: deletes the static-async custom child
  `hasContentSince(before)` plus `getSince(before)` recovery in
  `renderQueryConditionChild(...)`.
- Evidence: focused `query-condition.test.ts` cases for custom dynamic
  return-only recovery, custom dynamic differing-text recovery, prefixed-writer
  dynamic recovery, async static custom differing-text recovery, and
  prefixed-writer async static recovery all passed.

- Latest pass: `QueryCondition` localized dynamic writer-tail recovery split.
- Verdict: accepted as a bounded `QueryCondition` serializer cut. Dynamic
  custom query children that write different text than they return no longer
  recover that local text through `getSince(before)`; the localized ownership
  branch now reads the active writer tail directly while preserving the same
  custom-versus-trusted child contract. No speed claim.
- New traversal: one straight chunk join over the active writer tail in the
  existing `getWriterTextSincePosition(...)` helper. This replaces the
  previous localized `getSince(before)` recovery in custom dynamic child
  branches and does not add a new scan over unrelated query state.
- Review-flagged allocations: none added on the production path.
- New node/materialization: none.
- Render path: query-condition render still stringifies directly. The pass
  deletes the localized dynamic-child readback boundary for custom children
  that write different text than they return; it does not materialize
  intermediate nodes, arrays, or wrapper queries to recover text.
- Helper/API surface: none added. The pass reuses the existing
  `getWriterTextSincePosition(...)` helper inside
  `packages/core/src/tree/query-condition.ts`.
- Metadata mutations: no new metadata mutations. The previously-prosecuted
  localized `Reflect.get(writer, 'chunks')` read remains boxed inside the
  existing helper for lack of a cold/internal tail-text reader on
  `OutputWriter`.
- Routine error control: none added.
- Allocation changes: deletes the localized `getSince(before)` recovery from
  the sync and async custom dynamic child branches in
  `renderQueryConditionChild(...)`.
- Evidence: focused `query-condition.test.ts` cases for custom operation,
  custom condition, custom paren, prefixed-writer static compatibility-lane
  recovery,
  custom dynamic children that return-only, custom dynamic children that write
  different text than they return, and prefixed-writer dynamic recovery all
  passed.

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

- Latest pass: `QueryCondition` whole-query static compatibility-lane recovery split.
- Verdict: accepted as a bounded `QueryCondition` serializer cut. Static
  compatibility-lane queries with custom/subclass source children no longer open a
  whole-query `mark()/getSince()` boundary just to recover the text already
  written into the active writer; they now read the active writer tail
  directly after emission while preserving the existing localized child
  compatibility-lane ownership checks. No speed claim.
- New traversal: one straight chunk join over the active writer tail in
  `getWriterTextSincePosition(...)`. This replaces the previous whole-query
  `mark()/getSince()` recovery boundary for static compatibility-lane queries and does
  not add a new scan over unrelated query state.
- Review-flagged allocations: none added on the production path.
- New node/materialization: none.
- Render path: query-condition render still stringifies directly. The pass
  deletes the whole-query recovery boundary for static compatibility-lane queries; it
  does not materialize intermediate nodes, arrays, or wrapper queries to
  recover text.
- Helper/API surface: one node-local helper,
  `getWriterTextSincePosition(...)`, was added in
  `packages/core/src/tree/query-condition.ts`. It replaces repeated
  whole-query `mark()/getSince()` recovery in static compatibility-lane source/render
  paths; no public API changed.
- Metadata mutations: one localized generic read,
  `Reflect.get(writer, 'chunks')`, stays boxed inside the node-local helper
  because `OutputWriter` still exposes `position()` but not a cold/internal
  tail-text reader. This pass rejected reopening whole-query marks or public
  string wrappers just to recover already-emitted compatibility-lane text.
- Routine error control: none added.
- Allocation changes: deletes the whole-query static compatibility-lane
  `mark()/getSince()` recovery boundary from `QueryCondition.toTrimmedString`
  and static `render(...)` when direct known text is unavailable.
- Evidence: focused `query-condition.test.ts` cases for custom operation,
  custom condition, custom paren, prefixed-writer static compatibility-lane recovery,
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
- Latest pass: `QueryCondition` static compatibility-lane position probe split.
- Verdict: accepted as a bounded serializer cut inside the active
  `QueryCondition` row. Custom/subclass static children that stay on
  `writeStaticChild(...)` no longer pay an inner child `mark()/getSince()`
  readback just to detect whether `writeSyntax(...)` emitted anything; that
  compatibility lane now snapshots plain writer position and only drops to
  `toTrimmedString(...)` when the child wrote nothing. The outer public
  query-condition wrapper still owns its normal whole-query mark/readback
  boundary. No speed claim.
- New traversal: none.
- Review-flagged allocations: none added on the static query compatibility lane.
- Review-flagged diff tokens: the focused test still contributes cold
  `new CountingWriter()` construction and assertion arrays, but this pass adds
  no new production nodes, helper arrays, or compatibility wrappers.
- New node/materialization: none.
- Render path: static custom `Operation`/`Condition`/`Paren` overrides still
  stay correct on the localized compatibility lane, but they now rely on a writer
  position ownership check instead of child readback when the override already
  emitted its final syntax. The remaining readback on those tests is the outer
  public query-condition wrapper boundary, not a second inner child probe.
- Helper/API surface: none added.
- Metadata mutations: none added.
- Routine error control: none added.
- Allocation changes: deleted the inner child `mark()/getSince()` compatibility probe in
  `QueryCondition.writeStaticChild(...)` and replaced it with
  `writer.position()` ownership detection.
- Evidence: focused red-to-green proof came from
  `query-condition.test.ts` case
  `keeps custom operation syntax overrides on the static compatibility lane`.
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
- Architecture surface: this closeout is now amended by the scanner-first
  branch audit of `Rules` cumulative lookup/index ownership. The review surface
  is the architecture process plus `Rules` as a canonical child container that
  has accumulated lookup, eval, render, registration, and merge responsibilities.
- Separation/duplication: `BINDING-LOOKUP-REMAINING.md` item 87 records that
  lookup utilities did not by themselves establish ownership separation.
  Future work must distinguish state/cache ownership from helper location and
  must address near-duplicate callable traversal methods before adding more
  narrow lookup cases.
- Cumulative node weight: `Rules` currently carries persistent maps/caches for
  functions, variables, callables, direct declarations, direct declaration
  matches, and per-name versions while `ScopeFrame` carries overlapping binding
  and callable/declaration bucket state. This cumulative shape is not accepted
  as complete architecture; it is reopened as a binding audit item.
- New traversal: none.
- Review-flagged allocations: none in this docs-only pass.
- New node/materialization: none in this docs-only pass.
- Render path: no render/stringification path changed.
- Helper/API surface: none in this docs-only pass.
- Metadata mutations: none in this docs-only pass.
- Review-flagged diff tokens: docs and verifier edits add required
  self-prosecution labels and tracker prose for the `Rules` cumulative
  ownership audit. The broader scanner-first branch diff also includes
  runtime danger categories that must not be hand-waved:
  [loop/traversal] selector splitting/classification and progressive selector
  iteration loops; [array helper] cold selector value mapping and source-slice
  checks; [node construction] raw declaration construction and cold semantic
  selector materialization/invariant test assertions; [inherit/adopt/frozen]
  selector ownership transfer at semantic boundaries; [parent/source mutation]
  tree-context reads for selector materialization; [generic defensive read]
  the documented existing `Rules` render helper `Reflect.get(...)` smell;
  [side map/set] selector duplicate tracking and the `Rules` audit map/set
  evidence; [routine error control] invariant-only test/runtime guards; and
  [materialized array/object] raw declaration input shapes, selector part
  arrays, and helper arrays used by scanner-first structural proofs. These are
  not accepted as final architecture by default; scanner-first proof code must
  either remove them, keep them cold/public, or document the ownership boundary
  before commit.
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
