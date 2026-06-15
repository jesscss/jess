# Core Architecture Handoff

This is the active runbook for Jess core architecture work. Keep it short and
operational.

Use the four-doc split:

1. `HANDOFF.md`: how to perform the next pass, the active work, gates, focus
   spec, and completion steps.
2. `AGGRESSIVE-CUTTING-REVIEW.md`: hardline patch-shape rules.
3. `PERFORMANCE-HANDOFF.md`: benchmark/profile protocol, evidence history,
   target queues, and rejected experiments.
4. `NODE-REWRITE-TRACKER.md`: node-by-node rewrite table and completion
   status.

Active implementation specs:

- `BINDING-INDEX-PROPOSAL.md`: binding-index implementation spec for
  reference lookup, Less contextual semantics, Jess/Sass-style live bindings,
  and removal of transitional fallback bridges. It is active while the
  `Active Binding Implementation Lane` below has unchecked items.

## How To Work

1. Read this handoff first.
2. Read `AGGRESSIVE-CUTTING-REVIEW.md` before changing AST, eval/render,
   lookup, traversal, copying, inheritance, output writer, source/root metadata,
   or this handoff.
3. Read `PERFORMANCE-HANDOFF.md` before making or accepting any speed claim, or
   before touching a measured hot path.
4. Choose work from the highest-priority active lane below. An unchecked active
   implementation lane outranks benchmark cutting, node cleanup, and smell
   sweeps unless this handoff explicitly marks that lane paused.
5. Start each non-correctness pass from the benchmark leash below when the
   selected lane touches measured hot paths.
6. State one hypothesis before editing.
7. Make the smallest behavior-preserving cut that removes measured work or
   clearly wrong machinery.
8. Run focused tests first, then the required gates.
9. Keep, reshape, or revert based on the benchmark evidence and the aggressive
   cutting self-prosecution.
10. Commit and push the completed pass.

Temporary push rule: use `git push --no-verify` after focused tests, build,
benchmark leash, and `verify:aggressive-cutting-review` pass. The current
pre-push `verify:baseline` path can hang silently and should not be used again
until that hook is patched.

## Focus Spec

Active mode: **node `writeSyntax` render/stringification rewrite**.

Temporary lane switch: the binding-index lane is paused by explicit
user-direction until the `writeSyntax` node queue in
`NODE-REWRITE-TRACKER.md` is complete or this handoff explicitly switches back.
Do not let binding cleanup, generic smell sweeps, or unrelated performance
experiments overrule the `writeSyntax` queue while this mode is active.

Focus lock: Jess core work has one active focus at a time. The current focus is
the repo-wide node serialization rewrite, spanning all remaining node families.
No secondary queue may compete for the front of the line. Do not start
selector/equality cleanup, binding-index work, lookup redesign,
copy/materialization cleanup, benchmark tuning, or general smell sweeps as
separate work while this focus is active. If one of those areas is touched, it
must be only because the currently selected node-family serialization task
cannot be completed without that exact local edit, and the self-prosecution
must name the selected node row it serves.

The goal is the fastest credible path from parsed Less to CSS output:

- one canonical source tree;
- live lookup/binding/placement state instead of routine copied eval trees;
- direct eval/render-to-string for normal output;
- cold materialization only for public APIs or real semantic ownership
  boundaries;
- fewer hot-path objects, arrays, traversals, helper calls, branch ladders,
  promise/generator states, and metadata mutations.

Less is the optimizing path. Preserve SCSS-enabling seams only when they are
concrete and cheap or isolated behind cold extension boundaries.

Work shape while `writeSyntax` is active: run full queue batches, not one-node
dribbles. A full pass must choose from the unfinished node/family rows in
`NODE-REWRITE-TRACKER.md` and should leave one or more whole families complete
or materially closer to complete against that tracker. The pass is invalid if
its primary result is selector/equality cleanup, benchmark-chasing, lookup
cleanup, copy cleanup, or generic helper polish instead of node serialization
completion.

Queue items must be **entire tasks**, not micro-items. A queue item is a
meaningful node-family or runtime-path objective with its own proof surface,
for example "finish the `Call` render/stringification cleanup" or "remove
`AtRule` leaf/body render string transport where semantics allow it." It may
contain several sub-tasks, helper deletions, rejected cuts, and tests, but those
sub-tasks are not themselves queue items. Do not mark a queue item complete
because a one-line helper moved, a single closure was lifted, one regex was
replaced, or one narrow fast path was added while the larger stated task remains
open.

A valid queue pass should complete one or more whole queue items, or explicitly
record that the current whole item is blocked by a semantic decision,
benchmark-first tradeoff, or unsafe behavior boundary. If the work is only a
small partial cut inside a larger task, record it as partial status under that
task and keep the checkbox open. Do not create new numbered queue entries just
to memorialize every tiny cut.

Sweep the unchecked node/family list in `NODE-REWRITE-TRACKER.md`, land every
bounded deletion that shares the same proof surface, and stop only when the
remaining candidates require a larger semantic design, a behavior decision, or
benchmark-first tradeoff work. For each touched node, split direct emission
from public string capture, make render call the direct writer path after value
selection, and prove output with focused tests. Run the aggressive cutting
gate, record any benchmark/profile status if a touched node is hot, then commit
and push the whole coherent batch. Reject changes that make `render(...)` call
public `toString(...)`/`toTrimmedString(...)` as transport, or that add helper
objects/arrays only to describe syntax.

Serialization contract for this lane:

- `writeSyntax(...)`: direct syntax/source emission to the provided writer,
  with no returned string and no public string API as transport.
- `render(...)`: select/evaluate the runtime value, then write directly to the
  writer or render buffer. Render must not capture a public string just to
  write it back out.
- public `toString(...)` / `toTrimmedString(...)`: cold capture wrappers only.
  They may use `mark/getSince`; render-only paths may not.
- no render-only `mark/getSince`, `capture`, `preview`, writer readback,
  helper object, temporary syntax array, or detached writer allocation remains;
  if one cannot be removed in this focus, the node row must document the cold
  public materialization boundary or semantic blocker before moving on.

## Active Work

Correctness queue: no active correctness blockers. If a `.less` fixture fails
to parse/evaluate, add a focused repro before changing expected output. If CSS
differs, review semantics manually before changing tests.

Performance leash:

1. Start from the current selector `writeSyntax` baseline:
   broad `benchmark.less` profiler status had `OutputWriter.mark` `54534` and
   `OutputWriter.getSince` `49502`.
2. Choose the next node/family task from `NODE-REWRITE-TRACKER.md`; use
   caller-stack evidence for priority when several unchecked serialization rows
   are available.
3. Rerun focused tests and, for hot nodes, broad `benchmark.less` profiler
   status after the patch.
4. Keep the patch only if it completes or materially advances the selected
   serialization row and does not violate the benchmark leash. Performance is
   a gate here, not the active queue, and a benchmark result does not justify
   switching focus.

Immediate benchmark commands are defined in `PERFORMANCE-HANDOFF.md`.
Performance evidence/history stays parked there; this handoff owns the active
work lane and the gates for proving each slice complete.

Binding status: paused while `writeSyntax` is active. The compact binding lane
below records completed production facts and the one open binding-handle task.

## Active Binding Implementation Lane

This lane tracks `BINDING-INDEX-PROPOSAL.md`. It is currently paused by the
Focus Spec, but these facts matter when work returns here.

Completed:

- [x] Harness semantic proof for current reads, `$!` occurrence reads, `:=`
  parent-cell mutation, and child `:` shadowing.
- [x] Static-variable `ScopeFrame` lookup facade.
- [x] Source-order/current-read hardening, including explicit `$!` syntax.
- [x] Declaration-bucket binding identity for covered static variable reads.
- [x] Explicit covered `MISS` vs `UNCOVERED` fallback.
- [x] Parent-frame coverage for nested static variable lookup.
- [x] Already-static pending declaration-name promotion before facade lookup.
- [x] Frame-owned declaration coverage for manual/prebuilt frames.
- [x] Fallback-frame lookup ownership for covered static variable reads.
- [x] Standalone lookup-cache attempt rejected; do not bolt on a separate
  cache layer.
- [x] Callable-record prototype for simple static callable hit/miss cases.

Current facts:

- Covered static variable hits/misses should stop in the binding facade.
- `UNCOVERED` is only for explicitly unmodeled/cold cases: explicit targets,
  interpolated keys, non-snapshot contextual `start`, still-dynamic or async
  deferred declaration names, and frames whose declaration surface is not
  covered.
- Ordinary current reads and explicit `$!` source-position reads are distinct;
  do not revive `$^` or `$~`.
- No evaluated-value cache exists. Repeated lookup reuse should come from a
  coherent binding-handle system, not a side cache.

12. [ ] Binding handle reuse model.
   Design and prototype one coherent binding/index system for repeated
   references. Do not add a separate "lookup cache" layer. A reference should
   ask for a binding handle that already carries scope/version, reference
   shape, resolved declaration/callable/property identity, static/dynamic/live
   facts, and whether evaluated value or rendered scalar text can be reused.
   Example target: repeated `.a.b.c[@color-1]` in the same evaluated scope
   should not rediscover the `.a.b.c` callable/ruleset path and declaration
   binding twice.

   Completion gate:
   - no separate cache layer beside binding/index state
   - binding handles carry identity from existing reference/path/scope state,
     not rebuilt string joins or arrays on every lookup
   - repeated compound-reference fixture proves the same binding facts are not
     rediscovered
   - no rules/mixin output caching
   - no public materialization cache on the hot render path
   - evaluated value/text reuse requires explicit static/effect facts on the
     binding handle
   - benchmark before/after proves value

   Current status:
   - Static compound reference key arrays now keep their original array
     identity when they already contain strings. This is a binding-handle
     adjacent cut, not the finished handle system: it stops rebuilding a path
     fact the reference already owns.
   - Callable namespace lookup now walks static path arrays by offset instead
     of allocating `[segment, ...rest]` at every namespace hop.
   - Runtime variable binding lookup no longer allocates a defensive
     `Set<ScopeFrame>` on every lookup, and scope-frame variable lookup no
     longer allocates a per-call `blockedSource` closure just to test
     `context.searchScope.has(...)`. Check-only recursion probes read the
     existing `_searchScope` field directly so misses do not lazily create the
     set.
   - `findVarDeclarationFast(...)` now reuses one `Set<Rules>` for its
     independent scope-surface walks instead of allocating a new visited set
     for every parent/fallback surface search, and `buildReferenceFilter(...)`
     no longer allocates a noop pass-through filter or calls a one-line
     search-scope helper on every filter hit.
   - Ordinary variable lookup no longer builds the Reference filter callback
     before trying binding-frame and fast declaration lookup. It carries the
     original caller filter, `_searchScope`, and param-var rules context as
     fields and only synthesizes a registry callback for non-variable
     `Rules.find(...)` paths.
   - `Rules` callable/ruleset namespace helpers now reuse one `Set<Rules>` per
     helper invocation for their independent surface searches instead of
     allocating a fresh visited set for each parent scope.
   - A focused reference test proves the mixin array-path lookup receives the
     original static key array instance.
   - No cache, evaluated-value reuse, side map, materialized node, output
     wrapper, or render-path change was added.
   - Current completion boundary: this item is only the callable-record
     prototype. `Binding handle reuse model` remains open because repeated
     reference reuse is not implemented as one coherent binding-handle system.

Secondary deep-cut queue:

Do not add micro-items here. Completed pass history belongs in git and
`PERFORMANCE-HANDOFF.md`; this queue should tell the next agent what remains.

Completed highlights:

- [x] Callable `default()` guard classification moved out of hot candidate
  prep.
- [x] Static non-rules-like reference values can return directly without
  routine copy.
- [x] `PseudoSelector` and `Ampersand` have structural render/placement cuts.
- [x] `Reference` passes 1-10 removed wrapper closures, duplicate copy/eval
  branches, option-object plumbing, render-only post-eval copy/inherit, and
  several hot lookup helper allocations.
- [x] Sync immediate eval/render split landed for the covered nodes; routine
  render replacement should not imply public materialization or `.inherit(...)`.

Open tasks:

14. [ ] Finish the node `writeSyntax` render/stringification rewrite across the
   remaining node families in `NODE-REWRITE-TRACKER.md`.

   Done enough to know: many node families have direct writers, sync-loop cuts,
   and public-string transport reductions. Control family is complete for this
   lane.

   Still open: remaining families need either direct render/stringification
   separation, documented cold public materialization boundaries, or explicit
   semantic/benchmark blockers. Known blockers include `Call` output selection,
   `evalArgNodes(...)` copy pressure, whole-call mark/readback, `AtRule`
   body-state staging, `Ruleset.getHeaderString(...)` capture/comparison,
   duplicate declaration pre-render/materialization, custom-property raw
   source, merge-state boundaries, `Operation.withOperands` ownership, and
   `QueryCondition` shared-flat-buffer return contract.

   Current partial status: `serialize-helper.ts` now removes callback-array
   scans and temporary arrays from Ruleset render flattening and hoisted-frame
   setup. Transparent bare-ampersand flattening uses one pass with rollback
   instead of `filter(...)` + `some(...)` + a third leaf pass; hoisted parent
   lookup and renderable-child checks use indexed loops; hoisted frame reset
   compacts the existing frame array instead of allocating `atRulesOnly`; and
   source-chain scan no longer uses `queue.shift()`. This does not complete
   `Ruleset`, because header comparison still needs string keys and duplicate
   declaration handling still pre-renders same-property declarations.

   Additional partial status: duplicate declaration handling now does a cheap
   declaration-property pre-scan and only opens detached declaration writers for
   properties that repeat in the visible render list. Unique declaration
   properties render once at the normal leaf emission boundary instead of being
   pre-rendered into `declarationOutputCache` first.

   Additional partial status: `QueryCondition` async-capable render no longer
   forces static base-render siblings through dynamic child mark/probe fallback,
   and the remaining custom/instance-render fallback uses
   `hasContentSince(mark)` instead of a second `mark()` check.

   Additional partial status: `AtRule` dynamic leaf render and scalar header
   assembly now return scalar `Any` name/prelude text directly when no trivia is
   active, avoiding child mark/getSince/restore readback for common resolved
   leaf at-rules and scalar frame headers. `getHeaderString(...)` also skips the
   post-prelude writer probe when no trivia map exists. `AtRule.valueOf()` reads
   the name value key directly instead of routing the name through public
   `toString(...)`.

   Additional partial status: `SelectorList.writeSyntax(...)` now emits
   top-level `:is(...)` selector-list expansions directly instead of first
   building a temporary flattened selector array. Reference-mode filtering now
   does the old extended-target pre-scan only when reference filtering is active
   and then writes matching candidates directly. `SimpleSelector` base-class
   deletion was audited and rejected: its `resolve(context)` override calls
   `evalNode(context)` directly, while inherited `Node.resolve(...)` would enter
   the public eval ownership path.

   Additional partial status: `Url` scalar `Any` render/context normalization
   now writes the final `url(...)` text directly and avoids writer
   mark/getSince/replace scaffolding for the common scalar path; trivia-backed
   or non-scalar values keep the localized fallback. `Rest.name` no longer uses
   public `toString(...)` transport for node-valued names. `StyleImport` sync
   render no longer allocates a local finalizer closure; first-use placement
   copies and derived `Rules` surfaces were audited and kept as semantic
   placement state because focused tests require owned placement children plus
   source-child mapping, not because copying is acceptable as convenience.

   Additional partial status: `Call` render now uses the known empty
   string-name call text directly for direct and buffer render, so `button()`
   style output does not open whole-call mark/getSince scaffolding. Empty
   `List` and `Sequence` source/render paths now return the known empty output
   before preparing writer state or buffer mark/readback. Broader dynamic
   `Call` output selection and `List`/`Sequence` buffer string capture remain
   open.

   Additional partial status: `Call.serializeRenderedArgs(...)` now writes
   rendered args as a completion-only side effect instead of returning a
   discarded inner args string. Non-empty CSS-call arg render no longer opens
   an extra args-level `mark/getSince` readback; focused tests prove the whole
   call still reads back once for the current call syntax boundary.

   Additional partial status: `VarDeclaration` bare parameter syntax no longer
   uses public `String(name)` transport in `writeSyntax(...)`. `Any` names read
   the owned scalar value directly, and non-`Any` names write through
   `writeSyntax(...)` with writer trim.

   Additional partial status: `Block`, `Paren`, `Quoted`, and
   `AttributeSelector` render now use known wrapper text directly for safe
   scalar/empty forms: nil blocks, empty/nil parens, literal non-escaped quoted
   strings, and bare string-name attributes. These paths write or buffer the
   final string without opening writer mark/getSince scaffolding; trivia-backed
   or dynamic child paths stay on existing render boundaries.

   Additional partial status: `ExtendList` render now runs child extend effects
   directly instead of calling each child's public `render(...)` path through
   generic `serialForEach(...)` callback iteration. `Extend.runEffect(...)` is
   the semantic side-effect boundary; focused tests prove list render does not
   call public list eval or child render.

   Evidence pointer: use `NODE-REWRITE-TRACKER.md` for per-node status and
   `PERFORMANCE-HANDOFF.md` for benchmark/profile history. Do not add queue
   entries for one-line cuts inside this item.
16. [ ] Continue `Reference` before moving to the next node. Audit and cut the
   remaining copy/materialization pressure: `createRulesLikeReferenceSurface`,
   public `evaluateReferenceValueNode(...)` materialization, merged assign
   normalization, and remaining non-render `.inherit(...)` /
   `copyWithReusableLeaves(...)` ownership boundaries.

   Done enough to know: Reference passes removed wrapper closures, option
   objects, redundant post-eval copies on render-only paths, fallback pre-copy,
   several lookup helper allocations, and calc slash-list finalizer closure
   overhead.

   Still open: public resolve/materialization boundaries, merged declaration
   normalization, rules-like public surfaces, shared `List`/`Sequence` public
   materialization, and any remaining copy/inherit ownership that is not a cold
   public boundary.
17. [x] Sweep `Ampersand` template placement. Structured selector-list and
   generated `:is(...)` parents now stay structural instead of being copied into
   temporary replacement arrays, and raw comma text no longer pays
   `toTrimmedString().includes(',')` followed by a second split scan. The
   remaining raw-text fallback performs one top-level comma scan only after
   serialization is unavoidable because the parent selector is a scalar
   `BasicSelector` string containing commas.
18. [ ] Locked out while `writeSyntax` queue is active: sweep selector
   matching/extend equality. Replace hot `valueOf()` equality
   predicates with structural/keyset checks where possible, keeping
   `valueOf()` only as a measured, cached fast-path when it wins.
   Partial status: `Any.compare(...)`, `List.compare(...)`, and
   `Sequence.compare(...)` no longer allocate per-call local normalization
   closures for `Any` coercion. They share the internal compare normalizers in
   `tree/util/compare.ts`. This does not complete selector matching/extend
   equality or remove value/string serialization as a decision mechanism.
   Additional partial status: compare-time `Any` scalar coercion now reads the
   owned `Any.value` directly in `Any.compare(...)`, `List.compare(...)`, and
   `Sequence.compare(...)` instead of routing that already-owned scalar through
   public `toString(...)` transport. Container left-hand serialization remains
   because structural equality keys for list/sequence values are not finished.
   Additional partial status: selector extend recursive search now carries one
   mutable path stack through `searchWithinSelector*` instead of allocating
   child path arrays with `forEach(...)` and `[...currentPath, segment]` before
   a match exists. Stored match locations still copy the path at the ownership
   boundary.
   Additional partial status: selector equality predicates now use straight
   loops for `determineExtensionType(...)`, `componentsMatch(...)`,
   `areSelectorArgumentsEquivalent(...)`, and
   `areCompoundSelectorsEquivalent(...)`, removing callback closures and one
   temporary `numericSegments` array from common selector matching checks.
19. [x] Split sync immediate eval/render from cold public materialization so
   routine sync render replacement does not imply `.inherit(...)`. `evalSync`
   remains the public sync value API and still uses the public materialization
   finalizer; `evalImmediateSync(...)` is the render-only sync boundary that
   evaluates through the base `evalNode(...)` path, marks the immediate result
   evaluated, and skips `.inherit(...)`. The tree has zero non-test
   `.evalSync(...)` call sites; `Block`, `Url`, `Negative`, `Expression`,
   `Call`, and `Paren` now use `evalImmediateSync(...)` for their non-async
   immediate render/value paths. The helper keeps a cold instance-override
   fallback because focused `Call` tests prove API-mutated nodes may override
   `eval(...)`; the first attempted direct `evalNode(...)` helper rendered
   source placeholders instead of evaluated values.
20. [ ] Replace `StyleImport` first-use placement copies with placement state
   that points at canonical source children and preserves import visibility.
   Partial status: first-use placement state no longer stores a redundant
   `sourceByPlacement` `Map` or unused preservation flag, and nested
   source-child lookup no longer allocates a defensive `Set` per recursive
   search. The actual first-use placement child copies remain. A direct
   `getImportPlacementChildSegments(...)` return was tried and rejected by the
   focused import test because evaluated placement children can replace the
   initial segment output; the public segment read must report the current
   placement child until placement state is redesigned around canonical source
   children.
21. [ ] Collapse `StyleImport.deriveRulesSurface(...)` wrappers whose only job
   is source/visibility/placement bookkeeping.
22. [ ] Replace remaining `Rules` merge output copies with direct merge
   placement/render state or a narrow owned-item copier proven by merge tests.
23. [ ] Convert registration-prep expected misses away from routine `try/catch`
   only after adding tests for unresolved declaration/identity behavior.
   Adjacent partial status: `Rules._scanRegistrationNodes(...)` no longer
   calls lazy `options`/`location` getters for charset/import bookkeeping or
   canonical declaration reuse checks. It reads `_options`/`_location` directly
   while preserving the existing registration-prep control flow. Focused
   rules/import coverage proves charset output-order handling still skips child
   registration prep and does not allocate an empty charset `_location`. This
   does not remove the pending-registration `try/catch` miss path.
24. [ ] Locked out while `writeSyntax` queue is active: continue selector/extend
   factory cuts separately; do not hide selector placement copies inside
   another generic copy helper.
   Partial status: `selector-match-core.ts` recursive search walkers now use
   indexed loops plus push/pop path-stack state for selector-list, compound,
   complex, and pseudo-selector descent. This removes per-child callback
   closures and speculative path-array allocation from the full-search walk
   while keeping location-path copies only at stored-match boundaries.
   Additional partial status: selector comparison predicates now avoid
   `some(...)`, `every(...)`, and `filter(...)` in the extension-type,
   compound-vs-simple, selector-list argument, and compound equivalence
   checks. Remainder factory paths still allocate and remain open.
   Rejected local cut: rewriting `trySmallCompoundExtendMatch(...)` subset and
   remainder factory callbacks into manual loops was tested and reverted. The
   third bounded benchmark showed usable regressions on `extend-chaining` and
   `media`; do not retry this exact shape without a stronger structural change
   or stable profile evidence. The false assumption was that fewer callback
   closures and one fewer temporary array would be a local win; benchmark
   evidence showed the manual loop shape was worse, likely because the real
   cost is repeated selector matching/branching rather than the callback
   wrappers themselves.
25. [ ] Replace callable binding copies for static containers with explicit
   binding/placement state. Static containers should not be copied merely
   because they contain child nodes; `F_HAS_NODE_CHILD` is only a cheap current
   ownership boundary, not a final architecture.
26. [ ] Attack the measured copy stack next: `copyChild`,
   `copyWithReusableLeaves`, `copyCallableRulesValue`, `constructCopy`, and
   `.inherit(...)`. CPU evidence says these are mostly registration derivation,
   selector header rendering, JS function argument ownership, reference value
   eval, and binding clone debt; do not justify them as render output copying.

   Done enough to know: reusable-leaf checks and callable reuse/copy predicates
   now read `_location`/`_options` directly, `constructCopy(...)` no longer uses
   descriptor probes, and callable copy single-use wrapper helpers are gone.

   Still open: the actual copied callable surface boundary,
   `copyCallableRulesValue(...)` recursion, generic `copyChild(...)`,
   `copyWithReusableLeaves(...)`, `constructCopy(...)`, and routine
   `.inherit(...)` ownership pressure. Rejected local cut: deleting
   `Operation.withOperands(...)` child copies mutates canonical source parents
   unless a no-adopt/cold materialization boundary is designed.
27. [ ] Audit repeated callable/mixin evaluation from the profile before making
   more local helper cuts. If a mixin candidate or output body is evaluated
   more than the semantic call count requires, carry placement/binding state or
   cache the cold public materialization boundary instead of copying/evaluating
   again.

## Gates

Before editing:

- Build or inspect the relevant code path.
- Capture or identify the benchmark/profile target when touching hot paths.
- State the hypothesis in this handoff or in the working notes for the pass.

Required before commit:

```sh
pnpm run verify:aggressive-cutting-review
git diff --check
```

Also run the smallest focused tests for touched behavior.

For performance work, use the exact before/after benchmark/profile lane from
`PERFORMANCE-HANDOFF.md`. Do not report profiler elapsed time as app runtime;
label evidence as real benchmark, instrumented profiler, or CPU profile.

Use `pnpm run verify:baseline -- --changed` when the touched area needs the
broader gate. If Vitest workers stall, report it as inconclusive; do not mark
the gate passed.

## When Done

1. Update queue status only at the whole-task level. Mark a queue checkbox done
   only when the stated task objective is complete against its proof surface.
   Otherwise record the change as partial status under the still-open item and
   keep the checkbox open.
2. Replace the self-prosecution block below with exact files/functions and a
   clear verdict for the current pass. Do not append pass history.
3. If the pass produced benchmark/profile evidence, add the evidence summary to
   `PERFORMANCE-HANDOFF.md`.
4. If the pass changes the cutting doctrine, update
   `AGGRESSIVE-CUTTING-REVIEW.md`.
5. Run gates.
6. Stage only related files.
7. Commit and push.
8. Report:
   - commit hash;
   - machinery deleted, rejected, or deferred;
   - focused tests and gates;
   - benchmark/profile result or why it was inconclusive;
   - intentionally dirty unrelated files.

## Aggressive Cutting Self-Prosecution

This section is deliberately current-pass only. Replace it on each pass; do not
append pass history here. Durable status belongs in the active queue/tracker,
performance evidence belongs in `PERFORMANCE-HANDOFF.md`, and old prose stays
recoverable from git history.

Current pass: scalar leaf render-buffer mark cut.

- New traversal: none. No loop, recursion, parent/source walk, side-map lookup,
  or object/array scan was added.
- New node/materialization: no runtime nodes, copies, wrappers, arrays, side
  maps, or materialized render values added. The review script flags test-only
  `Context`, `CountingWriter`, and scalar `Color` allocations used to prove
  writer mark/readback counts and scalar color output; they are not production
  node creation or render materialization. Runtime strings are the existing
  scalar return values required by `render(...)` and public
  `toTrimmedString(...)`.
- Render path: selected rows are `Any`/`Keyword`/`Anonymous`, `Bool`,
  `Combinator`, `Dimension`, and scalar `Color`. These nodes already had
  direct source/public scalar writers, but flat-buffer render still inherited
  the base render mark window. Each touched scalar leaf now writes direct
  string/buffer output in `render(...)`; node-backed `Color` stays on the
  existing fallback boundary.
- Helper/API surface: no helper, public method, or utility added. The pass uses
  concrete node `render(...)` overrides rather than a generic helper ladder, so
  hot leaf output stays one direct branch and one writer call.
- Metadata mutations: none. No parent/source/frozen/context metadata mutation,
  lazy options/context creation, reflection call, generic own-property helper,
  or structural probe added.
- Error/control flow: no new routine error objects or throw/catch control flow.
- Evidence: package-scoped `any.test.ts`, `bool.test.ts`,
  `combinator.test.ts`, `dimension.test.ts`, `color.test.ts`, and
  `node-render-buffer.test.ts` passed. Tests prove direct writer and
  flat-buffer render avoid writer marks/readbacks for the touched scalar leaves
  while preserving existing render/buffer alignment. Final hotpath/profile
  status belongs in `PERFORMANCE-HANDOFF.md`; no speed claim.
- Verdict: accept as a scalar leaf render-buffer completion batch. `Range`,
  `List`, `Sequence`, and other composite nodes remain on their own rows
  because they need child-boundary/trivia/materialization decisions.
