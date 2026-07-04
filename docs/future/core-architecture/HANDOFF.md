> ⚠️ **The active cleanup queue is now [`CORE-CLEANUP.md`](./CORE-CLEANUP.md).** The
> per-focus trackers this doc references (SINGLE_FRAME_PLAN, NODE-REWRITE-TRACKER,
> PERFORMANCE-HANDOFF, BINDING-LOOKUP-REMAINING) were consolidated there; their history
> lives in `docs/archive/`. This doc is kept for its routing/guardrail context.

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

- Latest pass: `defineType` Reflect.construct removal (ponytail B5 slice).
- Verdict: accepted as an indirection cut on the factory construction path.
  `Reflect.construct(Clazz, args)` with default newTarget is semantically
  identical to direct `new`; the Reflect form existed only to satisfy the
  `AbstractClass<Node>` compile-time constraint, now handled by one typed cast
  at factory-definition time. No construction semantics changed (invariant 7
  untouched). Full construction-path unification and `Node.create` deletion
  are recorded as deferred in the audit checklist: raw-new-shares vs
  factory-parents is load-bearing for eval-time sharing.
- Architecture surface: none changed — one factory helper's construction call.
- Separation/duplication: none added; one Reflect indirection deleted.
- Cumulative node weight: unchanged (same constructions, one fewer builtin call
  per factory construction).
- New traversal: none.
- New node/materialization: none.
- Render path: unchanged.
- Helper/API surface: unchanged; the factory signature is identical.
- Metadata mutations: none.
- Review-flagged diff tokens: [node construction] — the direct `new` replacing
  `Reflect.construct` in `defineType`; same semantics, prosecuted here.
  [generic defensive read]: the one typed cast to a concrete constructor at
  factory-definition time replaces the runtime Reflect indirection; it is a
  compile-time-only assertion, not a runtime defensive read.
- Evidence: zero `Reflect.construct` remains in core src; core build; suite
  failure set identical to post-E2 state. No speed claim (parse-path change;
  benchmark harness still unbuildable in this worktree).

- Latest pass: `_createMinimalNil` deletion (ponytail E2) + B4 patch verdict.
- Verdict: accepted as shape-hazard deletion. The fallback mutated
  type/shortType/nodeType/value onto a raw abstract `Node` instance (instant
  hidden-class divergence); every runtime path loads `node.js` before
  constructing nodes, so `this.nil()` is always patched. Comment→Nil placement
  paths in node-base and cloning.ts now call it directly. B4 investigation
  verdict recorded: both prototype patch sites are load-order-necessary (module
  graph proof in the audit doc), so they stay as documented seams.
- New traversal / node / render / metadata / error control / allocations: none.
- Evidence: core build; suite failure set identical to post-B2 state.

- Latest pass: legacy `childKeys === undefined` regime deletion (ponytail B2).
- Verdict: accepted as machinery deletion. Inventory proved every node class
  resolves a `childKeys` (Collection/RawRules/Stylesheet inherit `Rules`'s;
  SimpleSelector/AttributeSelector inherit the selector base's `['value']`, the
  latter documented as a deliberate record-value exception). The base default is
  now `null` (typed `readonly string[] | null`) and `parentChildren` lost its
  legacy `.value`-introspection arm. The plain-object recursion in the leaf/
  entry walkers stays: it serves object-shaped childKey fields, not the legacy
  regime. External `childKeys` readers all use `?? []` (verified) and no
  package outside core subclasses `Node`.
- New traversal / node / render / metadata / error control / allocations: none.
- Evidence: core build; core suite failure set identical to the post-C2/C5
  state; repo-wide grep for `extends Node` and `childKeys` outside core.

- Latest pass: certain-dead deletions (ponytail audit C2/C5 slice).
- Verdict: accepted as pure machinery deletion, grep-proven zero consumers per
  item. Deleted: `use-webpack-resolver.ts` and `debug-log.ts` (whole files, no
  importers); `IS_PROXY` symbol, `NodeMapArray`, `GeneratedNodeValue`,
  `Mutable` types, the commented `collectRoots`/`toModule` blocks
  (node-base.ts); the `_exports`/`exports` Set, `parentScope` option, and
  `isRuntime` comment (context.ts); `clamp`, `lengthToPx`, `timeToMs`,
  `frequencyToHz`, `angleToRadians` conversion plugins (test-only consumers —
  tests deleted with them). Kept after grep proved live: `ABORT`, `REMOVE`,
  `Node.create`, `Primitive`/`PrimitiveOrFunc` (referenced by the legacy value
  regime until the childKeys migration completes).
- New traversal / node / render / metadata / error control / allocations:
  none — deletions only.
- Evidence: per-identifier repo-wide grep (excluding build output), core
  build, core suite failure set vs saved baseline, `git diff --check`.

- Latest pass: explicit `@jesscss/core` export surface (ponytail audit A1/A2).
- Verdict: accepted as an API-surface cut. `src/index.ts` no longer wildcard
  re-exports internal util modules; `compare`, `cast`,
  `find-extendable-locations`, and `collections` are fully internal (a
  repo-wide import census found zero external consumers), and
  context/logger/is-node/calculate/should-operate/print/trivia/list-like/
  serialize-types/conversions are narrowed to the names the census proved
  consumed. The tree barrel, plugin, jess-error, deprecation, define-function,
  types, and visitor modules keep their module-level exports for now.
- New traversal / node / render / metadata / error control: none — export
  statements only.
- Helper/API surface: shrunk. Names cut from the public barrel remain
  importable only relatively inside core.
- Evidence: census script over all consumer packages (145 unique imported
  names); core build; consumer builds green for css/less/scss/jess-parser,
  fns, style-resolver, patch-css, plugin-less, plugin-scss,
  plugin-node-modules, plugin-less-compat; runtime export presence check for
  every census name (only misses: `RuntimeFunction`, a type, still exported;
  `getValues`, which does not exist in core at all — pre-existing
  language-service breakage, flagged separately); `verify:package-exports`
  passed; `verify:public-packages` fails only on packages whose builds are
  already broken by the rolldown-plugin-dts/typescript-rc toolchain issue
  (jess, plugin-js, rollup-plugin-jess, config); full core suite failure set
  identical to the saved baseline.

- Latest pass: denormalized `spanStart`/`spanEnd` offset fields on `Node`.
- Verdict: accepted as a hot-read/object-avoidance slice under the ponytail core
  audit (`docs/future/ponytail-core-audit.md` E6), not a measured performance
  pass. `_location` is now a prototype accessor whose setter syncs two plain
  number fields; all hot core location reads (`location[0]`/`location[3]` in
  trivia/serialize/list/sequence/call/selector paths, `canReuseAsLeaf`,
  `canReuseLeaf`, the Parséman `span` getter, base `toString`) read the fields
  directly. Generated nodes no longer lazily allocate an empty `[]` tuple via
  the `location` getter on serialization reads. The tuple is retained because
  parser packages assign and mutate it post-construction; the parser-side pass
  (spans in, tuple deleted) is queued in the audit doc.
- New traversal: none.
- Review-flagged allocations: none added. One baseline-failing test that
  asserts inherit does not allocate empty location arrays now passes.
- New node/materialization: none.
- Render path: unchanged behavior; identical core test failure set vs the
  pre-change baseline plus the one fixed test
  (`cloning.test.ts` source-free inherit).
- Helper/API surface: two public readonly-in-practice fields (`spanStart`,
  `spanEnd`) on `Node`; no exports added.
- Metadata mutations: `inherit` copies `_location`/span fields directly instead
  of materializing the source's empty tuple through the `location` getter.
- Routine error control: none added.
- Allocation changes: deleted lazy `[]` materialization on hot reads; +2 inline
  number fields per node until the parser-side tuple deletion lands.
- Evidence: `pnpm --filter @jesscss/core build`, full core suite failure-set
  diff vs saved baseline (identical minus one fixed test), `git diff --check`,
  and `verify:aggressive-cutting-review` passed. No speed claim: the jess
  benchmark harness does not currently build in this worktree (pre-existing
  rolldown-plugin-dts/typescript-rc failure); run the ref-compare A/B when the
  harness is repaired.

- Latest pass: merge `feature/less-v5-alpha-readiness` into
  `feature/scanner-first-parser-docs`.
- Verdict: accepted as branch repair and history integration, not a measured
  performance pass. The scanner-first experimental branch now carries the latest
  alpha release/API scaffolding, parser proof files, binding/lookup commits,
  and direct-field parser experiments instead of leaving completed work stranded
  in the main checkout branch.
- Architecture surface: the merge intentionally imports broad parser/core/API
  surface so the branch is not split. This does not bless every surface as the
  target architecture. Known follow-up surfaces include direct-field node value
  cleanup, scanner-first AST shape cleanup, parser package shape review, and
  binding/lookup consolidation.
- Separation/duplication: the merge may temporarily preserve duplicate parser
  proof paths and old/new node-field paths because losing completed commits was
  worse than carrying them forward. Follow-up cleanup must delete duplicate
  helpers, raw/progressive naming debt, and compatibility-style paths once tests
  prove the smaller shape.
- Cumulative node weight: not improved by this merge. It imports existing node
  construction and materialization work so it can be reviewed in one branch.
  The next parser/core slices must cut object creation instead of adding wrapper
  objects or side maps.
- New traversal: merge-carried traversal only. Review-flagged loops belong to
  imported parser proof tests, binding lookup invalidation, selector/extend
  matching, and existing node child iteration. No speed claim is made.
- New node/materialization: merge-carried node construction only. The imported
  parser proofs create existing AST nodes plus some known debt surfaces that
  must be reshaped toward semantic fields and `childKeys`.
- Render path: no new render strategy was chosen in conflict resolution. The
  merge carries alpha render/eval changes forward for verification.
- Helper/API surface: release/API scaffolding from alpha is kept. Parser and
  core helper surfaces still need review against `packages/parser/docs`.
- Metadata mutations: merge-carried source/location/adoption behavior only.
  Offset-first scanner work remains the target for new parser paths.
- Review-flagged diff tokens: [loop/traversal], [array helper], [generator],
  [node construction], [copy helper], [inherit/adopt/frozen],
  [parent/source mutation], [generic defensive read], [side map/set],
  [routine error control], and [materialized array/object] are all present in
  the merge diff because this is a whole-branch integration, not a focused
  cutting pass. Treat them as imported debt unless a subsequent focused slice
  proves and cuts them.
- Evidence: conflict markers were removed and `git diff --check` passed after
  merge resolution. No performance claim is made.

- Latest pass: scanner-first Less function-arg tightening and pattern params.
- Verdict: accepted as a parse-coverage correction after review, not a
  measured performance pass. Root function-call arguments no longer store
  already-recognized variables, quoted strings, numbers, mixed comma/semicolon
  groups, or escaped parens as inert `Any` strings. Cheap mixin definition
  pattern params such as `.m(1)`, `.mixout('left')`, and
  `.border-side(left, @width)` now parse into existing core `Num`, `Quoted`,
  `Any`, and `VarDeclaration(paramVar)` shapes.
- New traversal: no tree traversal. The existing statement/mixin header
  scanners parse already-sliced argument/parameter arms only.
- New node/materialization: no new node family. Accepted function args create
  existing `Reference(type=variable)`, `Quoted`, `Num`, nested `List`, `Paren`,
  and atom `Any` nodes. Function args with block bodies, sequences, or nested
  function expressions remain unsupported so structured values are not smuggled
  through `Any`.
- Render path: parse-only slice. No function evaluation, mixin matching,
  fallback rendering, callable lookup, or output work was added.
- Helper/API surface: private Less AST helpers only; no public parser API,
  plugin registry, or shared profile surface was added.
- Metadata mutations: none beyond normal core-node construction/adoption.
- Evidence: focused Less AST proof and corpus tests passed after updating the
  corpus gate. The Less AST corpus moved from 1344 parsed top-level rules /
  154 warnings to 1352 parsed top-level rules / 121 warnings with zero
  errors/thrown failures. Remaining warning counts are 97 unsupported block
  headers, 23 unsupported statements, and 1 empty declaration name. No speed
  claim is made.

- Latest pass: scanner-first Less root function-call statements.
- Verdict: accepted as a parse-coverage slice, not a measured performance
  pass. Root statements such as `test-collapse()`, `store(@var)`,
  `test-atrule("@charset"; '"utf-8"')`, and `e('...')` now become existing
  `Call` nodes with `Reference(type=function, fallbackValue=true)` names and
  `silentFail` call options, matching the current Less function-call AST
  contract.
- New traversal: no tree traversal. The statement parser checks the already
  sliced statement text only after at-rule and mixin-call statement parsing
  miss.
- New node/materialization: no new node family. Accepted root function
  statements create existing `Call`, `Reference`, and optional `List`/`Any`
  argument nodes. Block-valued arguments are explicitly rejected in this slice
  so `each(..., { ... })` and `if(..., { ... })` do not sneak structured code
  through an `Any` string.
- Render path: parse-only slice. No function evaluation, fallback rendering,
  callable lookup, or output work was added.
- Helper/API surface: private Less AST helpers only; no public parser API,
  plugin registry, or shared profile surface was added.
- Metadata mutations: none. String names and cheap argument text have no
  source/parent metadata beyond normal core-node construction.
- Evidence: focused Less AST proof and corpus tests passed after updating the
  corpus gate. The Less AST corpus moved from 1341 parsed top-level rules /
  161 warnings to 1344 parsed top-level rules / 154 warnings with zero
  errors/thrown failures. Remaining warning counts are 130 unsupported block
  headers, 23 unsupported statements, and 1 empty declaration name. No speed
  claim is made.

- Latest pass: scanner-first Less spread mixin call arguments.
- Verdict: accepted as a parse-coverage slice, not a measured performance
  pass. Mixin call arguments `@name...` and bare `...` now become existing
  `Rest` nodes in the scanner-first call path. Invalid trailing ellipsis text
  such as `foo...` remains unsupported.
- New traversal: no tree traversal. The existing call-argument loop adds one
  suffix check for the already-sliced argument arm.
- New node/materialization: no new node family. Accepted `@name...` creates
  the existing `Rest(Reference(type=variable))` shape used by the current
  Less parser; bare `...` creates the existing nameless `Rest`.
- Render path: parse-only slice. No evaluation, callable matching, or render
  path work was added.
- Helper/API surface: one private Less AST helper only; no public parser API,
  plugin registry, or shared profile surface was added.
- Metadata mutations: none. The new nodes have no source/parent metadata beyond
  normal construction/adoption through the existing `List`.
- Evidence: focused Less AST proof and corpus tests passed after updating the
  corpus gate. The Less AST corpus stayed at 1341 parsed top-level rules and
  moved from 183 warnings to 161 warnings with zero errors/thrown failures.
  Remaining warning counts are 130 unsupported block headers, 30 unsupported
  statements, and 1 empty declaration name. No speed claim is made.

- Latest pass: scanner-first Less namespace-combinator mixin calls.
- Verdict: accepted as a parse-coverage slice, not a measured performance
  pass. Less mixin call statements such as `#theme > .mixin()` and
  `#namespace .borders()` now normalize to the existing `Call` plus
  `Reference(type=mixin-ruleset, role=name)` key-array shape. Deprecated
  no-paren namespace calls remain unsupported.
- New traversal: no tree traversal. The existing mixin-reference scanner now
  skips trivia and optional `>` separators between already-cheap `.` / `#`
  name segments.
- New node/materialization: no new node family, selector node, combinator node,
  or namespace wrapper. Accepted statements create the same `Call`,
  `Reference`, and optional argument `List` nodes as earlier contiguous
  namespace calls.
- Render path: parse-only slice. No evaluation, callable lookup, or render path
  work was added.
- Helper/API surface: private Less AST helper behavior only; no public parser
  API, plugin registry, or shared profile surface was added.
- Metadata mutations: none. String reference keys have no parent/source
  metadata.
- Evidence: focused Less AST proof and corpus tests passed after updating the
  corpus gate. The Less AST corpus moved from 1338 parsed top-level rules /
  200 warnings to 1341 parsed top-level rules / 183 warnings with zero
  errors/thrown failures. Remaining warning counts are 130 unsupported block
  headers, 52 unsupported statements, and 1 empty declaration name. No speed
  claim is made.

- Latest pass: scanner-first Less keyframe selector headers.
- Verdict: accepted as a parse-coverage slice, not a measured performance
  pass. `from`, `to`, numeric percentages, and comma-lists of numeric
  percentages now become string-backed keyframe `Ruleset.selector` fields, but
  only while parsing the immediate body of `@keyframes` / vendor-prefixed
  keyframes at-rules. The same `0% { ... }` shape outside a keyframes body
  still stays unsupported.
- New traversal: no tree traversal. The parser carries a single recursive
  parse-context flag for keyframes bodies and scans only the sliced block
  header for keyword or percentage arms.
- New node/materialization: no new node family and no selector leaf
  materialization. Single keyframe selectors are strings; comma-list keyframe
  selectors reuse existing `SelectorList` with string entries.
- Render path: parse-only slice. No evaluation, extend, or selector hydration
  work was added.
- Helper/API surface: private Less AST helpers only; no public parser API,
  plugin registry, or shared profile surface was added.
- Metadata mutations: none. String selector arms have no parent/source
  metadata.
- Evidence: focused Less AST proof and corpus tests passed after updating the
  corpus gate. The Less AST corpus stayed at 1338 parsed top-level rules and
  moved from 210 warnings to 200 warnings with zero errors/thrown failures.
  Remaining warning counts are 130 unsupported block headers, 69 unsupported
  statements, and 1 empty declaration name. No speed claim is made.

- Latest pass: scanner-first Less ampersand suffix selectors.
- Verdict: accepted as a parse-coverage slice, not a measured performance
  pass. Less block headers such as `&1`, `&:focus`, and `&-item` now become
  string-backed `Ruleset.selector` fields after exact `& { ... }` scope blocks
  have already been handled. Parenthesized ampersand pseudo-functions still
  wait for a later selector-hydration slice.
- New traversal: no tree traversal. The existing Less-local deferred-text scan
  validates the already-sliced ampersand header for balanced text; this does
  not walk parent/source chains, side maps, or Chevrotain productions.
- New node/materialization: no new node family and no selector leaf
  materialization. Accepted headers reuse existing `Ruleset` nodes and store
  `selector` as a string.
- Render path: parse-only slice. String selectors render through existing
  string-backed ruleset header output and are not evaluated or hydrated here.
- Helper/API surface: private Less AST helper only; no public parser API,
  plugin registry, or shared profile surface was added.
- Metadata mutations: none. Deferred selector strings have no parent/source
  metadata.
- Evidence: focused Less AST proof and corpus tests passed after updating the
  corpus gate. The Less AST corpus stayed at 1338 parsed top-level rules and
  moved from 282 warnings to 210 warnings with zero errors/thrown failures.
  Remaining warning counts are 140 unsupported block headers, 69 unsupported
  statements, and 1 empty declaration name. The statement count rose because
  newly parsed ampersand-suffix blocks expose unsupported inner statements that
  were previously hidden behind a skipped outer block. No speed claim is made.

- Latest pass: scanner-first Less interpolated selector headers.
- Verdict: accepted as a parse-coverage slice, not a measured performance
  pass. Less block headers containing `@{...}` interpolation now become
  string-backed `Ruleset.selector` fields after balanced deferred-text
  validation. This prevents `@{selector} { ... }` from being misclassified as
  a malformed at-rule while still leaving full selector hydration for later.
- New traversal: no tree traversal. The existing Less-local deferred-text scan
  now serves both at-rule preludes and interpolation-bearing selector headers;
  selector use requires at least one `@{...}` interpolation. It scans only the
  already-sliced block header for strings, comments, line comments, escapes,
  `()`, `[]`, and interpolation braces.
- New node/materialization: no new node family and no selector leaf
  materialization. Accepted headers reuse existing `Ruleset` nodes and store
  `selector` as a string.
- Render path: parse-only slice. String selectors render through existing
  string-backed ruleset header output and are not evaluated or hydrated here.
- Helper/API surface: private Less AST helper only; no public parser API,
  plugin registry, or shared profile surface was added.
- Metadata mutations: none. Deferred selector strings have no parent/source
  metadata.
- Evidence: focused Less AST proof and corpus tests passed after updating the
  corpus gate. The Less AST corpus moved from 1323 parsed top-level rules / 304
  warnings to 1338 parsed top-level rules / 282 warnings with zero
  errors/thrown failures. Remaining warning counts are 234 unsupported block
  headers, 47 unsupported statements, and 1 empty declaration name; the
  unsupported at-rule bucket is now gone. No speed claim is made.

- Latest pass: scanner-first Less deferred at-rule preludes.
- Verdict: accepted as a parse-coverage slice, not a measured performance
  pass. Less block at-rules now keep balanced structured preludes as string
  fields when the shared cheap prelude tokenizer cannot materialize a useful
  core `QueryCondition` or `List`. This is Less-local and does not widen the
  shared CSS prelude scanner.
- New traversal: one bounded character scan over an already-sliced at-rule
  prelude to validate balanced `()`, `[]`, strings, comments, line comments,
  escapes, and Less `@{...}` interpolation. It does not walk AST nodes,
  parent/source chains, side maps, or Chevrotain productions.
- New node/materialization: no new node family. Successfully deferred Less
  preludes reuse the existing `AtRule` node and store `prelude` as a string;
  the existing cheap query/list path still materializes core nodes first when
  it can.
- Render path: parse-only slice. String preludes render through existing
  string-backed `AtRule` header output and are not evaluated or hydrated here.
- Helper/API surface: private Less AST helper only; no public parser API,
  plugin registry, or shared profile surface was added.
- Metadata mutations: none. Deferred prelude strings have no parent/source
  metadata.
- Evidence: focused Less AST proof and corpus tests passed after updating the
  corpus gate. The Less AST corpus moved from 1295 parsed top-level rules / 372
  warnings to 1323 parsed top-level rules / 304 warnings with zero
  errors/thrown failures. Remaining warning counts are 243 unsupported block
  headers, 13 unsupported at-rules, 47 unsupported statements, and 1 empty
  declaration name. No speed claim is made.

- Latest pass: Ruleset selector-bit traversal stops using generic `node.value`.
- Verdict: accepted as a direct-field cleanup slice, not a measured performance
  pass. `Ruleset.attachSelectorBitsToNode(...)` now follows `node.children()`,
  which is backed by each node's declared `childKeys`, instead of recursing
  through legacy generic payload objects.
- New traversal: no new traversal family. The existing selector-bit walk still
  descends through selector children; it now uses the canonical child surface
  instead of rediscovering shape through `.value`, arrays, and plain-object
  recursion.
- New node/materialization: none.
- Render path: no render or eval behavior was added. This only affects
  selector-bit metadata attachment while composing/preparing selectors.
- Helper/API surface: deleted the private `attachSelectorBitsToValue(...)`
  helper and its private `isRecord(...)` helper from `ruleset.ts`; added no new
  public API.
- Metadata mutations: unchanged. The pass only changes how existing selector
  children are found before setting `keySetLibrary`.
- Evidence: focused core `ruleset`, selector-container, and mixin tests passed.
  No speed claim is made.

- Latest pass: string-backed `SelectorList` items for scanner-first Less selector lists.
- Verdict: accepted as a parser-shape/object-reduction slice, not a measured
  performance pass. The Less scanner-first AST path now parses cheap comma
  selector headers into the existing core `SelectorList` node while keeping
  cheap selector atoms as strings instead of allocating `BasicSelector` leaves.
- New traversal: the Less AST builder adds a top-level comma scan over an
  already-sliced block header. Core `SelectorList` keeps its existing item
  loops for render, keyset computation, eval/resolve, and flattening, with
  string-item branches added where those loops previously assumed node items.
  New selector-list consumer loops are limited to already-list-local paths:
  implicit-ampersand materialization, selector composition flattening,
  selector-list extraction from `:is()` during extend normalization, placement
  copying, batched list extension, root extend-target expansion, ampersand
  template/appended-selector expansion, and existing selector-list
  search/compare loops. The compare path intentionally uses direct nested
  loops over the two list values instead of allocating a temporary hash
  collection plus mapped arrays. No tree-wide traversal, side-map lookup,
  generator, or Chevrotain fallback was added.
- New node/materialization: one existing `SelectorList` node is created when a
  header is positively recognized as a comma selector list. Cheap atom members
  remain strings; compound/complex members reuse existing selector containers
  with string components. A string list item is materialized as an existing
  `ComplexSelector([item])` only at node-only semantic boundaries:
  extend-record implicit-ampersand materialization, nested
  selector composition, extend matching/search/comparison, batched extend
  application, extend-path application, root extend-target expansion, and
  implicit-ampersand materialization. Ampersand append materializes string atoms
  as `BasicSelector` because append semantics require a simple selector, not a
  complex wrapper. Those boundaries require a real `Selector` because they
  compare, compose, copy/place, append, or return extend locations over selector
  nodes. No structural/progressive/raw/island node was added.
- Render/eval path: string selector-list items write directly to the active
  writer and pass through eval/resolve unchanged. Node-only extend/trivia paths
  either skip string items when node metadata is impossible, or materialize only
  inside cold selector semantics when extend/ampersand logic requires node
  methods.
- Helper/API surface: no public helper or export was added. Three private
  string-to-selector adapters plus one extend-record adapter keep raw strings
  out of node-only ruleset, ampersand, root-extend, extend-record, and
  extend-search paths. The existing `SelectorList` value type was widened in
  place to `Selector | string` items.
- Metadata mutations: none. String selector-list items have no parent/source
  metadata.
- Evidence: focused core selector/ruleset/extend/ampersand tests and focused
  Less AST/corpus tests passed. A post-fix reviewer found five remaining
  string-backed selector-list consumer leaks; this pass added regression tests
  for those paths and guarded them. The Less AST corpus gate moved from 1250
  parsed top-level rules / 415 warnings to 1267 parsed top-level rules / 400
  warnings. No speed claim is made.

- Latest pass: scanner-first cheap selector atom expansion.
- Verdict: accepted as a parser coverage and object-avoidance slice, not a
  measured performance pass. The shared selector scanner now recognizes
  pseudo-no-parens, attribute selector atoms, and pragmatic non-ASCII names as
  cheap string atoms. CSS/Less parsers reuse those atoms inside existing
  `CompoundSelector` / `ComplexSelector` / `SelectorList` containers and do not
  allocate `BasicSelector`, `PseudoSelector`, attribute selector, or combinator
  leaves for this cheap path.
- New traversal: bounded character scans inside a single selector atom for
  quoted attribute text and pseudo names. The scanner still runs only on an
  already-sliced selector header; it does not walk AST nodes, source parents,
  side maps, or Chevrotain productions. Pseudo functions and unclosed
  attributes remain rejected instead of broadening raw structured support.
- New node/materialization: no new node family was added. Newly accepted
  selector pieces are strings; existing selector containers are materialized
  only when a selector has compound, complex, or list structure that needs an
  owning AST boundary.
- Render/eval path: parse-only slice. String selector atoms render through the
  existing string-backed selector-container paths and pass through eval/resolve
  unchanged.
- Helper/API surface: private scanner helpers only; no public export or
  language-profile surface was added.
- Metadata mutations: none. String selector atoms have no parent/source
  metadata.
- Evidence: focused parser selector-scanner tests, CSS AST/corpus tests, and
  Less AST/corpus tests passed after rebuilding `@jesscss/parser` before
  dependent package tests. The Less AST corpus gate moved from 1281 parsed
  top-level rules / 388 warnings to 1295 parsed top-level rules / 372 warnings
  with zero errors/thrown failures. No speed claim is made.

- Latest pass: scanner-first Less mixin rest/default-comma parameters.
- Verdict: accepted as a parser coverage slice, not a measured performance
  pass. Cheap Less mixin definitions now parse `...` and `@name...` parameters
  into existing core `Rest` nodes inside the existing params `List`, and
  comma-separated definitions keep top-level comma runs inside a default value
  when the next comma arm is not another parameter. No progressive/raw/island
  node was added.
- New traversal: one file-local top-level comma splitter over an already-sliced
  mixin parameter string. It uses the existing source-scanner delimiter helper
  and a boolean-only param-text classifier to inspect the next arm without
  allocating throwaway params; it does not walk AST nodes, parent chains, side
  maps, or Chevrotain productions. The parser rejects empty comma arms and
  non-final rest parameters instead of widening the cheap path past Less
  syntax.
- New node/materialization: named and anonymous rest params allocate existing
  `Rest` nodes because current core callable matching already represents
  definition rest parameters that way. Default values remain source-backed
  strings on `VarDeclaration.value`; comma-heavy defaults do not allocate value
  nodes.
- Render/eval path: parse-only slice. It does not add evaluation, lookup, or
  render materialization paths. Existing `Rest` string serialization remains
  core debt shared with the Chevrotain parser and is not claimed as Less source
  round-tripping in this pass.
- Helper/API surface: private parser helpers only; no public export or registry
  surface was added.
- Metadata mutations: none. Parsed params are adopted through the existing
  `List`/`Mixin` constructors.
- Evidence: focused Less AST proof tests passed, and the Less AST corpus gate
  moved from 1267 parsed top-level rules / 400 warnings to 1281 parsed top-level
  rules / 388 warnings with zero errors/thrown failures. No speed claim is made.

- Latest pass: scanner-first string-backed Less guards.
- Verdict: accepted as a parser coverage and object-reduction slice, not a
  measured performance pass. Cheap guarded Less block headers with
  parenthesized conditions now attach a string `guard` field to existing
  `Ruleset`/`Mixin` nodes instead of allocating `Condition(Any(...))` wrappers
  during the structural parse.
- New traversal: one file-local linear header scan finds a top-level `when`
  suffix while respecting quotes, comments, and balanced brackets. It runs only
  on a block header already sliced by the source scanner. No tree traversal,
  parent walk, side-map lookup, or Chevrotain fallback was added.
- New node/materialization: no new node family or structural facade was added.
  Guarded rulesets and mixins reuse existing core nodes. `& when (...) { ... }`
  becomes an existing nil-selector `Ruleset` so the guard has an owning node
  without creating a fake ampersand selector.
- Render/eval path: mixin syntax can write string guards directly. Ruleset
  evaluation and callable mixin guard lookup throw hydration-required
  `TypeError`s if a string guard reaches eval; those are exceptional
  unsupported execution boundaries for the parse-only proof, not routine
  miss/control flow. Guard evaluation hydration remains a later parser/eval
  integration slice.
- Helper/API surface: no public parser API was added. Core `MixinValue` and
  `RulesetValue` were widened in place so existing AST nodes own the deferred
  field instead of introducing `Progressive*` or island objects.
- Metadata mutations: none beyond normal constructor adoption for existing
  node fields. String guards have no parent/source metadata.
- Evidence: focused Less AST/corpus tests, focused core ruleset/mixin/condition
  tests, including explicit mixin string-guard failure, core build,
  less-parser build, package export verification, and the
  aggressive-cutting review gate passed after this prosecution. The Less corpus
  gate moved from 1161 parsed top-level rules / 523 warnings to 1250 parsed
  top-level rules / 425 warnings. No speed claim is made.

- Latest pass: implicit `.value` child fallback cut.
- Verdict: accepted as an AST ownership cleanup and parser-shape prerequisite,
  not a measured performance pass. Base `Node` no longer treats every node with
  a `.value` property as though `value` were its child surface. Nodes that own
  semantic children must declare them through `static childKeys`.
- New traversal: no new traversal was added. Existing base traversal,
  visitation, and deep trivia detach still read `static childKeys`; the hidden
  fallback to `['value']` was removed. Host wrappers with `childKeys = null`
  keep their JS payload for lookup/indexing but no longer expose it as CSS
  output or traversal.
- New node/materialization: no new node or wrapper was added. The verifier's
  materialized array/object matches are existing test fixture literals updated
  with `expectedParts: []` for host/lookup transport wrappers that render no
  stylesheet text.
- Render/eval path: no render-only materialization was added. Existing selector
  subclasses that genuinely use `.value` as their semantic surface now inherit
  an explicit selector-base `childKeys = ['value']` contract; leaf selectors
  that render themselves still override with `childKeys = null`.
- Helper/API surface: no helper or public export was added.
- Metadata mutations: none.
- Evidence: `pnpm --filter @jesscss/core test -- --run
  src/tree/__tests__/node-render-buffer.test.ts
  src/tree/__tests__/list.test.ts src/tree/__tests__/js-host.test.ts
  src/tree/__tests__/selector.test.ts src/tree/__tests__/selector-basic.test.ts`,
  `pnpm --filter @jesscss/core build`, and `pnpm --filter
  @jesscss/less-parser test -- --run test/ast-proof.test.ts` passed. No speed
  claim is made.

- Latest pass: string-token selector containers for scanner-first AST proofs.
- Verdict: accepted as a parser object-reduction slice, not a measured
  performance pass. CSS/Less scanner-first AST construction now keeps cheap
  compound/complex selector pieces as strings inside existing `CompoundSelector`
  and `ComplexSelector` nodes instead of allocating `BasicSelector` and
  `Combinator` leaves for each token.
- New traversal: no new tree traversal was added. Existing selector eval and
  render loops now skip string components directly instead of calling node
  methods on them. Existing ruleset selector-visibility recursion returns
  immediately for string selector pieces.
- New node/materialization: no new node family was added. The slice removes
  eager selector leaf materialization in the CSS/Less AST builders for the cheap
  selector subset. It retains the existing selector container nodes because they
  are the actual AST shape for compound and complex selectors.
- Render/eval path: string selector components write directly to the active
  writer and survive selector-container eval/resolve unchanged. Ruleset
  composition now treats string selector pieces as selector components when
  composing parent/child complex selectors, and string selector tokens
  contribute to selector keysets. There is no Chevrotain deferred-field parsing
  in this path.
- Helper/API surface: `scanCheapSelectorComponents(...)` moved to
  `@jesscss/parser` so CSS and Less share the string-token scanner without
  Less importing CSS parser internals. The helper returns plain string tokens;
  language AST builders decide whether to keep a whole selector string, build a
  selector container with string components, or reject the header for a later
  slice.
- Metadata mutations: no new parent/source metadata mutation was added. String
  selector pieces have no parent/source/visibility flags; visibility helpers
  skip them.
- Flagged materialized arrays/objects: the verifier flags widened array types
  and evaluation arrays in existing selector methods plus widened ruleset
  composition arrays. Those arrays already existed for selector eval/resolve and
  parent/child selector composition; this pass changes their element type so
  they can carry strings and avoid allocating leaf nodes in parser output.
- Evidence: CSS and Less AST proof tests failed first on eager
  `BasicSelector`/`Combinator` leaves, then passed after the change. A reviewer
  found partial string-awareness in selector keysets and ruleset composition;
  focused core tests now cover string-backed compound/complex keysets and
  string-backed complex selector composition. Parser scanner tests,
  CSS AST/corpus/local fixture tests, Less AST proof, Less source-scanner
  corpus, and parser/core/css-parser/less-parser builds passed. No speed claim
  is made without benchmark/profile evidence.

- Latest pass: `Rules.value` payload deletion.
- Verdict: accepted as an AST ownership correction and hot-path source-of-truth
  cleanup, not a measured performance pass. `Rules` now owns only `.rules`;
  real value nodes keep `.value`.
- New traversal: `Rules.clone(...)` uses one direct indexed loop over
  `this.rules` when cloning children. Generic descendant checks in import and
  serialization helpers now walk `static childKeys` instead of assuming every
  node has a `.value` payload. The at-rule layer check keeps its existing
  frame-child scan but reads `frame.rules.rules` directly.
- New node/materialization: no new node family was added. `Rules` calls
  `super(NO_VALUE, ...)` and processes its constructor body directly into
  `.rules`, removing the duplicate base payload. `Rules.clone(...)` still
  creates a cloned body only for explicit clone callers.
- Render/eval path: no render-only materialization was added. Scope-frame prep
  now carries the already-read rules array through declaration and assignment
  indexing so it does not reread the child surface just to prepare binding
  state.
- Helper/API surface: no compatibility alias was added. Test traps moved from
  `.value` to `.rules` to keep proving that prepared lookup paths do not
  rediscover child bodies. The flagged `throw new Error(...)` lines are those
  test traps, not production miss control flow. The flagged `hasOwnProperty`
  read is the constructor contract assertion proving `Rules` no longer owns a
  `.value` payload.
- Metadata mutations: no new parent/source mutation path was added. The
  source-node comparisons flagged in the diff are the existing at-rule layer
  placement identity check after changing the body read from `.value` to
  `.rules`.
- Flagged array helpers: the `.map(...)` calls are test expectations over
  output/source placement arrays. The production `Array.some(...)` in
  `containsNodeType(...)` is a cold serialization merge check over an already
  provided child array; it replaces an invalid generic `.value` descent rather
  than adding a new render/eval walk.
- Evidence: `@jesscss/css-parser` build, `@jesscss/core` build, focused
  reference/declaration tests, and the touched core test slice passed. The
  touched slice covered `10` files, `957` passing tests, and `6` skipped. No
  speed claim is made without benchmark/profile evidence.

- Latest pass: shared cheap at-rule prelude helper and CSS block at-rules.
- Verdict: accepted as a CSS/Less parser-shape DRY pass, not a measured
  performance pass. The cheap prelude tokenizer now lives in `@jesscss/css-parser`
  and is reused by Less; CSS can parse cheap block at-rules into real `AtRule`
  nodes instead of warning on every block at-rule.
- New traversal: CSS parser root/body walking now uses one recursive
  `parseCssNodes(...)` helper, so block at-rule bodies reuse the same statement,
  qualified-rule, and diagnostic flow as the root. This adds recursion only when
  a positively parsed at-rule block owns a body. The prelude helper keeps the
  same bounded linear scan over the sliced prelude text.
- New node/materialization: no new node families were added. CSS block at-rules
  create existing `AtRule` nodes; bare preludes remain strings; simple balanced
  preludes create existing `Paren(Any(...))` or `QueryCondition` nodes. Less
  deletes its duplicate prelude-tokenizer implementation and imports the shared
  helper.
- Render/eval path: no render/eval path was changed. Parsed CSS/Less nodes use
  existing core serialization.
- Helper/API surface: `parseCheapAtRulePrelude(...)` is now exported from
  `@jesscss/css-parser` because Less already depends on css-parser's cheap
  selector helper and both languages share this CSS-family prelude subset. The
  helper remains intentionally narrow and returns `undefined` for commas,
  interpolation, nested conditions, or general-enclosed syntax.
- Metadata mutations: none beyond normal constructor adoption for existing core
  nodes.
- Evidence: focused CSS AST/corpus tests, focused Less AST/source-scanner tests,
  ESLint, and package builds passed. No speed claim is made.

- Latest pass: scanner-first simple at-rule prelude tokenization.
- Verdict: accepted as a parser-shape correctness pass, not a measured
  performance pass. The Less AST proof now refuses to keep structured media
  prelude text as one raw string when it has balanced parenthesized structure.
- New traversal: `parseAtRulePrelude(...)` adds one bounded linear scan over the
  already-sliced prelude text. It is only reached after source scanning has
  positively identified an at-rule block; unsupported tokens return a warning
  instead of falling through to Chevrotain or a raw island.
- New node/materialization: bare atom preludes such as `screen` remain strings.
  A balanced parenthesized atom becomes existing `Paren(Any(...))`; a simple
  top-level sequence such as `screen and (min-width: 1px)` becomes existing
  `QueryCondition` with scalar children. No new node family or structural facade
  was added.
- Render/eval path: no render/eval path was changed. The created nodes are the
  existing core query surface and serialize through current AtRule rendering.
- Helper/API surface: the helper is file-local to `packages/less-parser/src/ast.ts`.
  It accepts only the narrow grammar proven by tests: bare atoms, balanced
  top-level paren atoms, and whitespace-separated top-level sequences. Commas,
  nested conditions, interpolation, and general-enclosed syntax remain
  unsupported for now.
- Metadata mutations: none beyond normal constructor adoption for the existing
  core nodes.
- Evidence: focused `@jesscss/less-parser` AST/source-scanner tests and ESLint
  passed. No speed claim is made.

- Latest pass: scanner-first string-backed block `AtRule` headers.
- Verdict: accepted as a parser-shape reduction, not a measured performance
  pass. The scanner-first Less proof can now construct real `AtRule` nodes with
  string `name`/`prelude` fields for cheap block at-rules such as
  `@media screen { ... }`, avoiding `Any` wrapper nodes for header text.
- New traversal: no new tree traversal was added. The Less parser reuses the
  existing recursive `parseLessNodes(...)` body path when a block header is
  positively classified as an at-rule.
- New node/materialization: one existing core node shape was widened. No new
  node family, structural facade, or Chevrotain fallback was added. Parser
  object creation maps directly to existing `AtRule` plus recursive `Rules`.
- Render/eval path: string at-rule headers stringify directly and stay static
  during eval. Node-backed headers still use the previous trivia-aware render
  and lifted-context eval paths. The verifier flags an `OutputWriter`
  allocation because the old Node-header render capture was moved behind the
  widened file-local helper; the new string-header path returns before that
  allocation.
- Helper/API surface: one file-local render helper was widened to accept string
  fields; `AtRule.clone(...)` now validates name/prelude/rules fields
  explicitly instead of using a generic cast helper. The clone `TypeError`
  guards are cold-path validation for caller-provided `cloneFn` output; they are
  not lookup/render/eval miss control flow.
- Metadata mutations: existing `inherit(...)` and `adopt(...)` calls remain.
  `adopt(...)` is now guarded so string preludes are not treated as child nodes;
  `inherit(...)` remains the existing AtRule clone/derive metadata path, not a
  new parser-owned wrapper.
- Test-only helpers: the string-array `join('\n')` flagged by the verifier is
  fixture formatting in the AtRule unit test, not production allocation.
- Evidence: focused `@jesscss/core` `at-rule.test.ts`, `@jesscss/core` build,
  focused `@jesscss/less-parser` AST/source-scanner tests, `@jesscss/less-parser`
  build, package export/public package checks, and
  `verify:aggressive-cutting-review` completed with the above danger-token
  prosecution. No speed claim is made.

- Latest pass: base `Node.value` contract cut for direct-field nodes.
- Verdict: accepted as an AST ownership correction and prerequisite cleanup for
  parser AST-shape work, not a measured performance pass. Base `Node` no longer
  declares `.value` as a universal field; direct-field containers such as
  `Ruleset`, `AtRule`, and `Mixin` do not get a duplicate payload field.
- New traversal: base `children()`, `_visitEntries`, `_visitValues`, and
  `detachTrivia(true)` now read `static childKeys` and direct fields instead of
  assuming every node has a constructor payload. This keeps old generator
  surfaces working for visitor/extend callsites, but generators remain an audit
  target rather than the model for new parser work.
- New node/materialization: no new node family was added. Comment stripping in
  placement cloning now strips `Comment` before reusable-leaf sharing, and
  selector header visibility uses scoped flag restoration instead of cloning a
  source-free basic selector.
- Render/eval path: no render-only node construction was added. Explicit
  callable reference fallbacks now return callable signature text instead of
  resolving to a `MixinCollection` that renders empty in declaration value
  position.
- Helper/API surface: no parser-facing helper was added. Temporary constructor
  sentinel use for migrated direct-field nodes is debt, not target
  architecture; parser docs now say node fields plus `childKeys` are the
  source of truth.
- Metadata mutations: the selector visibility restoration list is scoped to the
  header render try/finally and restores flags before returning. This is a
  smaller render-local mutation than cloning selector leaves for visibility.
- Evidence: `pnpm --filter @jesscss/core build` passed. Focused
  `ruleset.test.ts`, `at-rule.test.ts`, and `import-style.test.ts` passed:
  `3` files, `229` tests, `1` skipped. No speed claim is made without
  benchmark/profile evidence.

- Latest pass: node-owned clone/copy source-of-truth cut.
- Verdict: accepted as a machinery deletion and AST ownership correction, not a
  measured performance pass. External constructor-reconstruction helpers are not
  the target model. A node with direct semantic fields owns its own `clone()`;
  `cloneForPlacement(...)` is only a small placement-policy wrapper around
  node-owned cloning.
- New traversal: no production tree walk was added for this pass. The retained
  import-placement descendant source lookup already existed; the new source-free
  leaf branch exits before that projection when placement/source identity is the
  same object.
- Review-flagged allocations: `packages/core/src/tree/util/cloning.ts`,
  `Node.copy()`, and the exported reusable-leaf copy helper surface were
  removed. The follow-up review flagged `Ruleset`, `Mixin`, and `AtRule` as
  still relying on inherited constructor-payload cloning despite direct fields;
  those nodes now override `clone()` directly.
- New node/materialization: no new wrapper node family was added. Placement
  cloning still creates semantic placement state where an import/callable output
  surface must own parents/source metadata; source-free scalar leaves are reused
  directly instead of cloned.
- Render path: no render-only node creation was added. The focused tests assert
  several render/eval paths avoid `Rules.clone()` or source-backed child copies.
- Helper/API surface: the broad copy helper module is gone. Remaining copy-like
  names are node methods (`clone`, `cloneForPlacement`) or narrow semantic
  helpers such as callable/import placement policy. Any object/direct-field node
  added later must override `clone()` rather than teaching an external helper
  how to reconstruct it.
- Metadata mutations: the pass removed `Reflect.construct` reconstruction from
  ordinary clone/derive paths and removed pointless runtime `instanceof` checks
  after constructors whose result type is already known. `defineType(...)` still
  uses `Reflect.construct` as a factory boundary and should be audited
  separately before changing that public helper.
- Evidence: focused core clone/declaration/rules/import/reference tests passed:
  `5` files, `466` tests, `6` skipped. Sub-agent review found the remaining
  direct-field clone overrides and stale docs; this block records the corrected
  rule. No speed claim is made without a benchmark/profile pair.

- Latest pass: composed selector ownership and source-trivia separator cleanup.
- Verdict: accepted as a correctness fix found while proving the direct-field
  cleanup against CSS parser serialization, not a measured performance pass.
  Generated collapsed selectors must not adopt live-owned selector leaves from
  source rulesets; they now build from placement-owned selector components.
- New traversal: no new tree walk was added. The selector composition helper
  maps the already-known parent/child selector component arrays once when a
  generated composed selector is required.
- Review-flagged allocations: the new placement copies replace an invalid
  live-node adoption that could create parent/source ownership cycles and hang
  collapsed rendering. They are semantic placement state for a generated
  selector, not render-only materialization for string output.
- Render path: `Sequence` no longer synthesizes an extra default space after it
  already emitted authored comment trivia between adjacent source nodes. The
  emitted trivia run owns the separator exactly as parsed.
- Helper/API surface: one private selector-component ownership helper was added
  inside `Ruleset`; no public API or parser-facing helper was added.
- Metadata mutations: `Rules._emitRulesBody(...)` now reads `this.rules`
  instead of the legacy constructor payload. Generated composed selectors own
  their cloned components instead of stealing parent pointers from canonical
  source selectors.
- Evidence: DebugMCP was attempted for the hanging CSS parser test, then a
  tiny built-runtime reproduction isolated `Ruleset._prependParent(a, b)` as
  the hang. After the fix, the reproduction returned `a b` and collapsed CSS
  output. Focused `@jesscss/core` ruleset/list/sequence and wider
  ruleset/at-rule/import/call/list tests passed; `@jesscss/css-parser`
  `ast-proof.test.ts` and `ast-serialize.test.ts` passed after rebuilding
  `@jesscss/parser` and `@jesscss/core`.

- Latest pass: string-backed CSS AST proof path.
- Verdict: accepted as a narrow parser-shape proof, not a runtime hydration or
  performance pass. Existing `Declaration` and `Ruleset` nodes now accept string
  fields where strings serialize correctly, and `@jesscss/css-parser` exposes a
  deliberately narrow `parseFlatCssDeclarationStylesheet(...)` proof that
  returns a core `Stylesheet` directly. The slice adds no `Progressive*`,
  `Structural*`, `RawIsland*`, Chevrotain, side-map, or provider-plan machinery.
- New traversal: the proof parser adds straight source scans for flat qualified
  rules and declaration statements. These are parser-local scans, not eval/render
  walks, and they replace a heavier structural/island proof vehicle for this
  tiny subset.
- Review-flagged allocations: the per-declaration intermediate value object was
  cut after review. The remaining production node construction is the actual
  AST output: `Stylesheet`, `Ruleset`, `Rules`, and `Declaration` nodes. The
  `decl(...)` factory now returns `new Declaration(...)` directly instead of
  first converting string names into `Any` nodes.
- New node/materialization: only named AST ownership boundaries are created.
  String-backed selector/declaration fields are not materialized into selector,
  value, or flag nodes during the proof parse.
- Render path: syntax serialization can write string-backed fields directly.
  Eval/render paths that would need typed selector/value semantics now throw a
  local hydration-required `TypeError` instead of crashing later or silently
  pretending strings are evaluated nodes.
- Helper/API surface: one narrow exported proof function,
  `parseFlatCssDeclarationStylesheet(...)`, is added. It is intentionally not a
  full `parseCssStylesheet(...)` replacement and the docs were updated to avoid
  overstating its scope.
- Metadata mutations: no parent/source/frozen/location/line-column/span metadata
  was added for string fields. Existing node adoption ignores primitive field
  values.
- Evidence: sub-agent review flagged eval/render safety, over-broad selector
  metadata widening, parser naming scope, and a small allocation. The slice was
  revised to fence string-backed eval, cut metadata widening, rename the proof,
  and remove the intermediate object. Focused `stylesheet.test.ts`,
  `css-parser` `ast-proof.test.ts`, `@jesscss/core` build,
  `@jesscss/css-parser` build, `verify:package-exports`,
  `verify:public-packages`, `git diff --check`, and
  `verify:aggressive-cutting-review` passed.

- Latest pass: slim `Stylesheet extends Rules` root.
- Verdict: accepted as an AST-shape prerequisite for scanner-first compiler
  parse results, not a performance pass. The node adds no document services,
  side tables, diagnostics, source storage, or island/probe machinery; it is
  only a distinct root type over the existing `Rules` body contract.
- New traversal: no new walk is added. The existing `rulesParent` ancestor climb
  keeps its original loop shape and now stops when it reaches any rules-like
  node, so `Stylesheet` is treated as a valid `Rules` ancestor instead of being
  skipped by a literal `type === 'Rules'` check.
- Review-flagged allocations: none added.
- New node/materialization: one public `Stylesheet` node exists only when a
  parser intentionally constructs a stylesheet root; nested containers remain
  ordinary `Rules` / `Ruleset` / `AtRule` surfaces.
- Render path: unchanged. `Stylesheet` inherits direct `Rules` serialization and
  the focused test proves it renders the existing body shape.
- Helper/API surface: one `stylesheet(...)` factory/export is added so parser
  packages can return the documented core root node. No `N.Stylesheet` bit or
  parallel `StructuralDocument` API is added.
- Metadata mutations: no provenance, parent, frozen, location, line/column, or
  packed-span metadata is added. Parent/source-root behavior only recognizes the
  rules-like subclass already in the tree.
- Evidence: focused `stylesheet.test.ts`, full `rules.test.ts` /
  `node-mutation.test.ts` slice, `@jesscss/core` build,
  `verify:package-exports`, `verify:public-packages`, `git diff --check`, and
  `verify:aggressive-cutting-review` passed after sub-agent review flagged the
  missing `rulesParent` contract and the test was extended.

- Latest pass: collapsed render frame rollback after reference-import lookup cuts.
- Verdict: accepted as a correctness fix for the binding/lookup branch fallout,
  not a performance pass. The seven binding/lookup commits are already on
  `feature/less-v5-alpha-readiness`; focused proof exposed that
  `1e840ab9e` left a render regression where a reference-import `Rules`
  wrapper could open or replace a collapsed frame, emit no visible CSS, and
  leave the replacement frame behind for the next declaration. The serializer
  now restores the existing frame/header arrays from snapshots when a child
  container or child `Rules` wrapper emits nothing, instead of restoring only
  array length. No speed claim.
- New traversal: none. The pass does not add a node walk or lookup path.
- Review-flagged allocations: two rollback snapshots use the existing
  `saveArrayState(...)` helper only around paths that may roll back after
  `ensureRenderedFrames(...)`; they replace incorrect length-only rollback
  state, not normal successful emission.
- New node/materialization: none.
- Render path: successful rendering still writes strings directly. The added
  snapshots are used only on no-output rollback paths after a child render
  touched frame state.
- Helper/API surface: none added. A parent-aware composed-selector cache detour
  was rejected and removed because the failure reproduced without it.
- Metadata mutations: frame/header array restoration is the intended render
  state rollback for hidden/reference children that emit no CSS. No source,
  parent, frozen, or node ownership metadata changed.
- Evidence: `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/import-style.test.ts -t "repeated reference/multiple imports keep import-site-local parent chains"`,
  full `import-style.test.ts`, `nesting-collapse.test.ts`,
  `ruleset.test.ts -t "collapse|composed|selector"`, the targeted
  `reference.test.ts` lookup slice, full `mixin.test.ts`, `@jesscss/core`
  build, `git diff --check`, and `pnpm run verify:aggressive-cutting-review`
  passed. The first full mixin attempt failed because `@jesscss/core build`
  was run concurrently and removed `lib` while Vitest imported through
  `css-parser/lib`; rerunning after the build passed `199/199`.

- Latest pass: policy-gated namespace-start broad fallback deletion.
- Verdict: accepted as a narrow second-producer cut. `local: true` and
  `hasTarget: true` no longer disable frame-owned callable namespace-start
  lookup. The narrow uncovered child helper already applies local and
  target-restricted child-surface gates, and policy-skipped children now count
  as modeled misses so a covered empty namespace start does not reopen the
  broad ruleset/mixin crawl. The broad start fallback remains only for
  no-frame callers. No speed claim.
- New traversal: none. The pass removes local/target frame bypasses and
  prevents covered empty namespace starts from entering the ruleset fallback.
- Review-flagged allocations: none added.
- New node/materialization: none.
- Render path: unchanged. This pass only changes callable namespace lookup
  routing.
- Helper/API surface: none added.
- Metadata mutations: none.
- Routine error control: production none. Tests add `try/finally` only to
  restore the temporary `findMixinsFast` spy.
- Allocation changes: no new production arrays or objects; tests add spy
  arrays only.
- Evidence: focused
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts -t "local namespace-start|restricted namespace-start|targeted namespace-start|selector-list prefix|static miss skips Rules.findMixinsFast"`
  passed, and full
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts`
  passed (`199/199`).

- Previous pass: frame-owned array-path mixin namespace broad-start fallback deletion.
- Verdict: accepted as a narrow second-producer cut. When `findMixin(array)`
  has a current `ScopeFrame`, namespace mixin starts no longer reopen
  `this.findMixinsFast(keys[0]!, ...)` as a broad start-key crawl after frame
  lookup and the narrow uncovered child/reference-import helpers fail to
  produce a modeled result. At the time of that pass, the broad fallback
  remained for no-frame, targeted, or local callers; the latest pass above
  removes the local branch. No speed claim.

- Latest pass: frame-owned exact ruleset namespace direct-bucket fallback deletion.
- Verdict: accepted as a narrow second-producer cut. `findRulesetNamespacePathFast(...)`
  no longer calls `scope.getCallableEntriesForKey(segment)` as an exact
  remainder fallback when a `ScopeFrame` exists. Frame-owned exact ruleset
  namespace matches now come from the prepared callable frame and visible frame
  collectors; the direct bucket fallback remains only for no-frame callers. No
  speed claim.
- New traversal: none. The pass deletes one direct cache/bucket read on modeled
  frame paths and leaves the no-frame fallback unchanged.
- Review-flagged allocations: none added.
- New node/materialization: none.
- Render path: unchanged. Focused render tests prove output still reaches
  imported ruleset namespace bodies without re-entering the direct bucket
  producer.
- Helper/API surface: none added.
- Metadata mutations: none.
- Routine error control: none added.
- Allocation changes: no new arrays or objects.
- Evidence: focused
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/import-style.test.ts -t "namespaced reference-imported ruleset array-path lookups"`
  passed with a spy proving direct bucket reads stay empty for the frame-owned
  `#Namespace` exact path. Focused
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/import-style.test.ts -t "namespaced reference-imported ruleset array-path|namespaced selector-list array-path|callable child-surface namespace misses"`
  and
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts -t "ruleset namespace path lookup|compound-prefix ruleset lookup|definite namespace misses avoid legacy remainder-array fallback|namespace fast path|reference-import compound prefix|reference-import selector-list prefix|mixin-ruleset calls with args"`
  passed. The full `import-style.test.ts` file still has an existing failure in
  `import-reference-issues: repeated reference/multiple imports keep import-site-local parent chains`;
  that failure reproduces without this slice and remains a separate binding /
  import placement blocker.

- Latest pass: array-path callable namespace union dedupe deletion.
- Verdict: accepted as a narrow post-result dedupe cut. `findMixin(array)` can
  legitimately union compound-prefix ruleset results with callable namespace
  results, but covered producers must be disjoint by construction. This pass
  removes the identity scan that treated duplicates as an expected runtime
  outcome. No speed claim.
- New traversal: removed the nested identity scan over the existing compound
  union. The remaining loop only appends already-produced callable namespace
  results when both producers are semantically active.
- Review-flagged allocations: no new allocation family. The existing copy-on-
  append remains when compound-prefix entries are borrowed; this preserves the
  borrowed array and is not a dedupe structure.
- New node/materialization: none.
- Render path: unchanged. The tests exercise parser/render behavior only to
  prove Less lookup semantics still render the same output.
- Helper/API surface: none added.
- Metadata mutations: none.
- Routine error control: none added.
- Allocation changes: deleted duplicate-check branching and one nested scan; no
  new arrays beyond the pre-existing copy-on-append path.
- Evidence: focused
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts -t "ruleset namespace path preserves callable namespace unions|real Less stable namespaces avoid direct-crawl|type=mixin ignores compound-prefix ruleset ambiguity|compound-prefix ruleset lookup uses callable buckets|ruleset namespace path lookup uses callable buckets|compound-prefix ruleset lookup reuses path offsets|mixin-ruleset calls with args"`
  passed. Full `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts`,
  `pnpm --filter @jesscss/core build`, `git diff --check`, and
  `pnpm run verify:aggressive-cutting-review` also passed before committing.

- Latest pass: callable ruleset namespace lookup fallback deletion.
- Verdict: accepted as a bounded registryless lookup cut, not a completion of
  the namespace lane. Namespaced mixin-ruleset calls with args still use
  rulesets as namespace containers, but terminal parameterized calls now dispatch
  through `findMixin(..., 'Mixin', ...)` and visible exact/prefix ruleset lookup
  no longer scans `scope.rules` after callable bucket / child-entry facts have
  the modeled surface. The generic callable-result dedupe helper was deleted;
  duplicate production must be prevented at the modeled source. No speed claim.
- New traversal: deleted the local visible `scope.rules` /
  `sourceRulesOf(scope)` scans from `findVisibleExactCallableRulesetPath(...)`
  and `findVisibleCallableRulesetPrefixMatches(...)`. Added exact ruleset
  frame/child-entry collectors so imported compound exact paths such as
  `#imported .dark .button` are represented by callable bucket facts instead
  of reopening the visible exact crawl. Prefix and exact namespace facts now
  come from frame buckets plus direct child entries for this path; remaining
  frame/fallback walks still need further binding-lane scrutiny.
- Review-flagged allocations: runtime result-dedupe array copying was removed;
  the implementation-coupled terminal-hop capture test was deleted in favor of
  adjacent behavior tests.
- New node/materialization: none. No new AST nodes, wrapper `Rules`, or copied
  callable arrays were introduced for runtime lookup.
- Render path: unchanged. This pass only changes callable lookup routing for
  arg-bearing namespace terminals and does not add a render-time boundary.
- Helper/API surface: private bucket/frame collectors remain for modeled
  ruleset prefix and exact namespace paths
  (`collectCallableBucketRulesetPrefixMatches(...)`,
  `collectCallableRulesetPrefixMatchesFromFrame(...)`,
  `collectCallableRulesetExactMatchesFromFrame(...)`, and their visible
  frame-chain/child-entry callers). They replace the deleted same-surface
  rules scans and prevent a duplicate producer for the covered path. The
  generic `dedupeCallableEntries(...)` / `sameCallableEntry(...)` helpers were
  removed.
- Metadata mutations: none.
- Routine error control: none added.
- Allocation changes: deleted runtime result dedupe array copying; no test-only
  capture array remains in this pass.
- Evidence: focused
  `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts -t "mixin-ruleset calls with args still use rulesets as namespace containers|mixin-ruleset calls with args keep only the recursive namespace terminal mixin-only|mixin-ruleset calls with args reject exact ruleset terminals after namespace resolution|mixin-ruleset calls with args keep imported ruleset namespaces but exclude imported terminal rulesets|mixin-ruleset calls with args reject imported exact ruleset terminals after namespace resolution"`
  passed, focused namespace/ruleset coverage passed after deleting exact/prefix
  visible scans, full `pnpm --filter @jesscss/core test -- --run src/tree/__tests__/mixin.test.ts`
  passed (`195/195`), `pnpm --filter @jesscss/core build` passed, and
  `pnpm run verify:aggressive-cutting-review` passed with the remaining
  danger-token loops/arrays prosecuted in this block.

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
