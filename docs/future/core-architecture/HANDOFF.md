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
dribbles.

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

## Active Work

Correctness queue: no active correctness blockers. If a `.less` fixture fails
to parse/evaluate, add a focused repro before changing expected output. If CSS
differs, review semantics manually before changing tests.

Performance leash:

1. Start from the current selector `writeSyntax` baseline:
   broad `benchmark.less` profiler status had `OutputWriter.mark` `54534` and
   `OutputWriter.getSince` `49502`.
2. Choose the next node from `NODE-REWRITE-TRACKER.md`; use caller-stack
   evidence for priority when several unchecked nodes are available.
3. Rerun focused tests and, for hot nodes, broad `benchmark.less` profiler
   status after the patch.
4. Keep the patch only if it improves real runtime cost, removes measured
   object/memory pressure without slowing runtime, or fixes correctness.

Immediate benchmark commands are defined in `PERFORMANCE-HANDOFF.md`.
Performance evidence/history stays parked there; this handoff owns the active
work lane and the gates for proving each slice complete.

Binding prototype status:

- `scripts/prototype-binding-frame-layout.mjs` now proves the semantic split
  required by `BINDING-INDEX-PROPOSAL.md` before timing any layout variant:
  same-frame current reads, `$!`/occurrence reads, `:=` parent-cell mutation,
  and child `:` shadowing.
- Current harness evidence still favors `Map` slot arrays for the first
  string-key production facade. Planned numeric ids are promising only when the
  reference already carries the id; string-to-id conversion on each read remains
  rejected.
- Production integration status: the first `ScopeFrame` variable facade,
  source-order/current-read hardening, declaration-bucket binding identity,
  explicit miss/uncovered states, on-demand parent-frame coverage, and
  already-static pending declaration-name promotion are in production for
  covered static variable references and static `:=` writes. This is not the
  full binding index yet; callable lookup still uses the existing registry
  path.
- Fallback bridges are temporary debt. Covered simple paths must return hit or
  miss from the binding frame and stop. Only unmodeled cold/complex cases may
  route to old registry/search/materialization paths, and every such bridge
  needs a deletion condition in `BINDING-INDEX-PROPOSAL.md` or this handoff.
- Next binding step: delete the remaining `UNCOVERED` bridges
  one by one by carrying the missing facts at construction/adoption time:
  manual-frame indexing state and fallback-frame lookup ownership. Do not start
  lookup caching until those bridge boundaries are narrower.

## Active Binding Implementation Lane

This lane is the current integration path for `BINDING-INDEX-PROPOSAL.md`.
Do not jump ahead: each step must prove behavior and patch shape before the
next step starts.

1. [x] Harness semantic proof.
   `scripts/prototype-binding-frame-layout.mjs` proves same-frame current
   reads, `$!`/occurrence reads, `:=` parent-cell mutation, and child `:`
   shadowing before timing layout variants.

   Completion gate:
   - `pnpm run prototype:binding-frame-layout`
   - small-frame and large-frame harness runs recorded in
     `BINDING-INDEX-PROPOSAL.md`
   - no production eval/render code changed

2. [x] Production facade, static variable only.
   Add one `ScopeFrame`/BindingFrame facade method for ordinary static variable
   lookup. It may unify live-slot lookup and declaration-bucket lookup, but it
   must leave existing registry/`Rules.find(...)` fallback in place.

   Scope:
   - `Reference` option `type: variable`
   - static string key only
   - no explicit target
   - no dynamic key/interpolation
   - no callable/mixin lookup
   - no evaluated-value cache
   - no node copy/materialization
   - no source-position/contextual `start` boundary yet; those stay on the
     existing lookup until step 3

   Completion gate:
   - focused reference variable tests pass
   - focused mixin live-slot tests pass
   - focused control/loop live-slot tests pass
   - import/reference tests that cover caller-scope and guard behavior pass
   - covered hot cases do not call `DeclarationRegistry.find(...)`
   - `pnpm run verify:aggressive-cutting-review`
   - `git diff --check`
   - one hot-path benchmark sanity run is recorded as status, not as a speed
     claim unless there is a clean before/after pair

   Status:
   - `lookupScopeFrameVariable(...)` now lives in `scope-frame.ts` and returns
     either a live cell or declaration entry from the frame chain.
   - `Reference` uses it only for static string variable keys with no explicit
     target, no interpolation, and no contextual `start` boundary.
   - Pending dynamic declaration names bail to the existing lookup path.
   - Bridge cleanup rule: when a static-key case is covered by the facade, a
     facade miss must mean miss for that case, not "try every old lookup just
     in case." The old fallback remains only for unmodeled cases explicitly
     outside this step.
   - A failed first attempt proved that applying the facade to contextual
     control-loop lookups changes stateful output (`tick: 1, 1, 2` became
     `tick: 1, 2, 3`), so source-order/current hardening remains step 3.

3. [x] Facade source-order/current-read hardening.
   Prove the production facade preserves Less contextual lookup and Jess current
   read semantics in the same real runtime path.

   Required behavior cases:
   - Less-style source-order variable lookup still resolves by reference start
   - `$!`/snapshot or contextual reads do not see later same-frame changes
   - ordinary Jess current reads can see later same-frame bindings where the
     language requires it
   - child `:` shadowing does not mutate a parent binding
   - `:=` mutates the resolved scoped binding cell

   Completion gate:
   - add or identify focused tests for each required behavior case
   - no fallback broad registry search on covered static-key reads
   - no new traversal beyond the existing frame-chain walk
   - no side-map/cache added yet

   Status:
   - Facade-level semantics are now covered by
     `packages/core/src/tree/__tests__/scope-frame.test.ts`: current reads are
     separate from source-order occurrence reads; snapshot/occurrence reads can
     ignore live cells; child `:` shadowing leaves parent cells unchanged; and
     assignment writes mutate the resolved scoped binding cell.
   - `lookupScopeFrameVariable(...)` now has `includeLive: false` for snapshot
     reads.
   - `assignScopeFrameVariable(...)` exists as the narrow binding-cell write
     operation. Static `VarDeclaration` `:=`/`setDefined` is now wired through
     production `Rules.registerNode(...)`: it updates the resolved declaration
     value plus the matching frame cell and skips `deriveWithOptions`, adopt,
     array splice/unshift, and re-registration. The write path now evaluates
     the assigned RHS when registration has the active `Context`; this is
     required for values sourced from transient mixin params and `$for` live
     slots. Non-variable `setDefined` declaration placement still uses the old
     path and remains queued.
   - Cross-structure binding evidence now covers the same semantics in real
     mixin and `$for` paths, not only in the facade unit tests: current reads
     see live/current cells, `$!`/snapshot reads ignore live cells and honor
     source-position declarations, `:=` mutates the resolved outer binding, and
     `:=` RHS values can come from live mixin parameter or `$for` iteration
     cells.
   - Completed production hardening: `$!` source-position reads can route
     through the facade with `start` and `includeLive: false`, while ordinary
     `$name` current reads remain off contextual-start facade routing so
     `$while`/loop live cells still behave correctly.
   - Remaining production debt: declaration-bucket `Reference` hits still
     return source declaration nodes. That is why the static `:=` cut still
     updates the resolved declaration value as well as the frame cell. The
     target model is for declaration-bucket hits to return binding/value
     identity directly, so assignment can be a pure binding-cell mutation.
   - `$!name` is now the current syntax for explicit source-position reads in
     the live-binding model. Do not revive historical `$^` or `$~` lookup
     syntax. Parser work should carry this as a cheap `Reference` fact, not
     infer it later from parent shape.
   - Production `Reference` still does not route contextual `start` lookups
     through the facade. The earlier control-loop failure remains the evidence:
     widening that path without placement/eval hardening changed stateful loop
     output from `tick: 1, 1, 2` to `tick: 1, 2, 3`.
   - A second production widening attempt proved the mode split more sharply:
     routing every `opts.start` read through
     `lookupScopeFrameVariable(..., { includeLive: false })` preserves one
     source-order shape but breaks `$while` current reads; the loop condition no
     longer sees the live `i` cell and hits the iteration guard. Ordinary
     Jess/Less contextual refs are current/lazy (`seen` after a later same-name
     binding is `blue`, not `red`), while snapshot/occurrence reads must be
     explicit.
   - Do not start lookup caching until declaration-bucket hits return binding
     identity cleanly enough that the cache can cache binding identity instead
     of source declaration nodes.

4. [x] Declaration-bucket binding identity.
   Make covered static variable declaration hits return binding/value identity
   directly from the `ScopeFrame` facade instead of returning source
   `VarDeclaration` nodes.

   Scope:
   - static string `type: variable` reads only
   - no explicit target
   - no interpolation/dynamic key
   - preserve `$!` source-position reads and ordinary current reads
   - keep registry/`findVarDeclarationFast(...)` fallback for unmodeled cases
   - no evaluated-value cache

   Completion gate:
   - reference render/eval tests prove source declarations remain canonical
   - `:=`/`setDefined` writes mutate only the resolved binding cell where safe
   - covered static variable hits and misses do not fall through the old
     live-slot/`findVarDeclarationFast(...)`/registry ladder
   - any remaining fallback branch is labeled as `UNCOVERED`/unmodeled cold
     scope, with a deletion condition
   - no new node creation, copying, `.inherit(...)`, or source-parent mutation
   - no new traversal beyond the existing frame-chain/bucket scan
   - focused reference, scope-frame, mixin, control, declaration tests pass
   - benchmark leash recorded as status unless a clean before/after is run

   Status:
   - `Reference.lookupScopeFrameVariableBinding(...)` now converts both live
     hits and declaration-bucket hits into the same `RuntimeVarBinding` result
     shape. Covered static variable declaration reads no longer bounce through
     source `VarDeclaration` nodes before finalization.
   - The public rules-like preserve boundary remains intentionally cold:
     non-param rules-like declaration references still return the shallow
     owned surface required by existing public-reference tests. That is
     materialization for public ownership, not render-only copying.
   - Focused tests now prove a covered static variable hit does not call
     `Rules.find(...)`, matching the existing miss/snapshot coverage.
   - Completed bridge debt: the facade now returns explicit `miss` and
     `uncovered` states, and covered static variable misses stop before the old
     live-slot/`findVarDeclarationFast(...)`/registry ladder.

5. [x] Split covered `MISS` from `UNCOVERED` fallback.
   Replace ambiguous `undefined` facade results with an explicit covered-miss
   or uncovered result so `Reference` can stop trying old live-slot,
   `findVarDeclarationFast(...)`, and registry/search ladders for paths the
   binding frame already owns.

   Scope:
   - static string `type: variable` reads only
   - no explicit target
   - no interpolation/dynamic key
   - preserve `$!` source-position reads and ordinary current reads
   - no evaluated-value cache

   Completion gate:
   - covered static variable hits return binding identity
   - covered static variable misses return miss and stop
   - only explicitly unmodeled cases return uncovered and may fallback
   - focused hit, miss, snapshot, dynamic-name, mixin, and loop tests pass
   - no new traversal, node creation, copy, `.inherit(...)`, or metadata
     mutation
   - benchmark/profile leash recorded

   Status:
   - `lookupScopeFrameVariable(...)` now returns `live`, `declaration`,
     `miss`, or `uncovered`. `assignScopeFrameVariable(...)` preserves its old
     public shape by converting `miss`/`uncovered` back to `undefined`.
   - `Reference.lookupScopeFrameVariableBinding(...)` turns a covered `miss`
     into a local sentinel and `lookupVariableReference(...)` stops immediately
     instead of trying `lookupRuntimeVarBinding(...)`,
     `findVarDeclarationFast(...)`, or registry/search fallback.
   - `uncovered` remains the only bridge back to old lookup for this lane:
     explicit targets, interpolated variable keys, non-snapshot contextual
     `start`, pending dynamic declaration names, prebuilt/manual unindexed
     frames, frames with fallback chains, and scopes whose AST parent rules
     chain is not represented in the current frame parent.
   - Rejected too-broad cut: treating every facade miss as terminal broke
     detached ruleset variable calls (`content` was not found) because the
     root parent frame had not been built yet. Treating every manually built
     unindexed frame as uncovered also broke `$for` snapshot reads by letting
     the old path see loop live slots. The kept boundary is narrower:
     generated loop live slots can still hit/continue, but unrepresented
     parent/fallback/manual-indexing cases remain explicit `uncovered`.
   - Next bridge-deletion target: make `Rules.getScopeFrame(...)` or
     adoption/callable wiring carry represented-parent and manual-indexing
     facts so more `uncovered` cases become covered hit/miss without old
     lookup.

6. [x] Parent-frame coverage for nested static variable lookup.
   Build/attach the nearest ancestor `Rules` scope frame on demand instead of
   treating a child frame with an unbuilt parent as `UNCOVERED`.

   Scope:
   - static string `type: variable` reads only
   - no explicit target
   - no interpolation/dynamic key
   - preserve `$!` source-position reads and ordinary current reads
   - no evaluated-value cache

   Completion gate:
   - nested child rules can resolve static parent variables when the parent
     frame was not prebuilt
   - covered nested hits do not call `Rules.find(...)`
   - detached ruleset and mixin fallback behavior remains covered
   - no new child traversal, node creation, copy, `.inherit(...)`, or metadata
     mutation
   - benchmark/profile leash recorded

   Status:
   - `Rules.getScopeFrame(...)` now builds/returns the nearest ancestor
     `Rules` frame when wiring a frame parent, instead of only reusing an
     already-built ancestor frame.
   - `Reference.lookupScopeFrameVariableBinding(...)` no longer has to mark
     `frame.parent === undefined && rulesParent !== undefined` as uncovered.
     The frame chain now represents the parent in the covered nested case.
   - Focused reference coverage proves a nested static variable hit builds the
     parent frame and avoids declaration `Rules.find(...)` fallback.
   - Remaining uncovered bridges: explicit targets, interpolated variable keys,
     non-snapshot contextual `start`, pending dynamic declaration names,
     prebuilt/manual unindexed frames, and fallback-frame lookup ownership.

7. [x] Promote already-static pending declaration names before facade lookup.
   Move the existing pending-name promotion step before
   `lookupScopeFrameVariable(...)` so a dynamic declaration name that has
   already become static is covered by the binding frame rather than old
   fallback lookup.

   Scope:
   - static string `type: variable` reads only
   - no explicit target
   - no interpolation/dynamic key
   - no evaluation of still-dynamic names during lookup
   - no evaluated-value cache

   Completion gate:
   - already-static pending dynamic names are promoted before the facade
     lookup
   - still-dynamic and async pending names remain `uncovered`
   - focused pending-name, reference, mixin, control, and declaration tests pass
   - no new traversal beyond the existing pending-name promotion loop
   - benchmark/profile leash recorded

   Status:
   - `Reference.lookupScopeFrameVariableBinding(...)` now calls the existing
     `promoteResolvedPendingVarDecls(...)` before
     `lookupScopeFrameVariable(...)`.
   - The existing promotion routine remains the only pending-name scan; this
     pass moves it earlier for the covered facade path instead of adding a new
     scan or cache.
   - Focused reference coverage now asserts that the promoted declaration is
     visible through `lookupScopeFrameVariable(...)` after lookup.
   - Remaining uncovered bridges: explicit targets, interpolated variable keys,
     non-snapshot contextual `start`, still-dynamic or async pending
     declaration names, manual frames before declaration coverage is known, and
     fallback-frame lookup ownership.

8. [x] Carry manual-frame declaration coverage on the binding frame.
   Delete the `Reference`-level `varsByName/rulesIndexed/value.length` guard
   by making declaration coverage an explicit `ScopeFrame` fact. Runtime frames
   whose declaration buckets do not yet represent the owned `Rules` surface
   return `uncovered` from the frame facade instead of making each reference
   rediscover indexing state.

   Scope:
   - static string `type: variable` reads only
   - no explicit target
   - no interpolation/dynamic key
   - preserve `$!` source-position reads and ordinary current/live reads
   - no evaluated-value cache

   Completion gate:
   - manual/prebuilt frames do not walk to parent declarations when their own
     declaration surface is uncovered
   - `Rules` indexing updates any existing frame buckets/pending list and marks
     declaration coverage when indexing reaches the current value length
   - snapshot reads never fall through to runtime live-slot lookup after an
     uncovered facade result
   - focused scope-frame, reference, declaration, mixin, and control tests pass
   - no new node creation, copying, `.inherit(...)`, `.adopt(...)`, or
     render-time materialization
   - benchmark/profile/node-creation leash recorded

   Status:
   - `ScopeFrame` now carries `declarationsCovered`. The frame lookup owns the
     covered vs uncovered decision, so `Reference.lookupScopeFrameVariableBinding(...)`
     no longer checks `targetRules.scopeFrame`, `varsByName`, `rulesIndexed`, or
     `value.length` on every static variable lookup.
   - `Rules._indexRules()` and `Rules.registerNode(...)` now keep an existing
     frame's declaration buckets and pending dynamic-name list aligned while
     indexing, then mark the frame covered. This reuses the registration edge
     that already sees each node; no lookup-time node traversal was added.
   - `buildScopeFrame(...)` now uses a simple indexed loop instead of
     `decls.map(...)` when creating declaration entries.
   - Snapshot (`$!`) variable fallback now skips `lookupRuntimeVarBinding(...)`
     entirely, preserving the live/current vs source-position split proven by
     the `$for` binding test.
   - Remaining uncovered bridges: explicit targets, interpolated variable keys,
     non-snapshot contextual `start`, still-dynamic or async deferred
     declaration names, and manual frames before declaration coverage is known.

9. [x] Fallback-frame lookup ownership.
   Move fallback-frame variable lookup into the binding facade only if it
   deletes the equivalent old live-slot/`findVarDeclarationFast(...)` fallback
   walk for covered static variable reads. Do not add a second fallback chain
   traversal beside the existing one.

   Completion gate:
   - leaky mixin/default-param/detached-ruleset behavior remains proven
   - fallback live-slot hits and fallback declaration hits have one owner
   - covered fallback misses stop without registry/search fallback
   - no new traversal unless the old traversal is deleted for that path
   - benchmark/profile leash recorded

   Status:
   - `lookupScopeFrameVariable(...)` now searches the direct frame chain and
     then the fallback frame chain before returning `miss`. A fallback frame no
     longer forces `uncovered` by itself.
   - Fallback live-slot hits, fallback declaration hits, and fallback covered
     misses are now owned by the same frame facade for covered static variable
     reads.
   - `Reference.lookupVariableReference(...)` therefore stops before
     `lookupRuntimeVarBinding(...)`, `findVarDeclarationFast(...)`, and
     registry/search fallback for covered fallback hit/miss cases.
   - Remaining uncovered bridges: explicit targets, interpolated variable keys,
     non-snapshot contextual `start`, still-dynamic or async deferred
     declaration names, manual frames before declaration coverage is known, and
     fallback frames whose declaration surface is not covered.

10. [x] Standalone bare-variable cache rejected.
   A frame-local lookup-identity cache was implemented two ways and then cut:
   first with a `Map` cache, then with single-entry primitive fields on
   `ScopeFrame`. Both cached binding identity only and never evaluated values,
   but neither survived the benchmark leash. This is a local rejection of a
   bolt-on cache, not a rejection of binding reuse.

   Completion gate:
   - no cache code remains in the runtime
   - no evaluated-node reuse was introduced
   - object audit returns to the prior `new-node` count
   - performance handoff records the failed measurements

   Status:
   - The `Map` version increased static node/object audit count from
     `new-node` `321` to `322`, so it was rejected immediately.
   - The single-entry field version avoided new cache containers but still did
     not improve the clean `benchmark-v39.less` profile: `Reference.evalNode`
     was `482` calls / `5.59ms` after the field-key cache vs `482` calls /
     `5.43ms` at the start of the pass.
   - Stable hotpath sanity was mixed and not a win: `functions` `12.79ms`,
     `import-reference` `20.41ms`, `mixins-guards` `17.44ms`,
     `extend-chaining` `5.29ms`, `media` `6.74ms`.
   - Verdict: do not bolt a separate cache onto
     `lookupScopeFrameVariable(...)`. The right target is a coherent binding
     handle system where references stop rediscovering binding facts. Repeated
     lookup reuse should fall out of binding handles, frame/surface versions,
     path identity, and static/effect facts, not from ad hoc function-level
     caches.

11. [x] Callable records prototype.
   Move only simple static callable lookup into binding records. Namespace,
   guard matching, candidate evaluation, import visibility, and callable output
   stay out of the facade until separately proven.

   Completion gate:
   - focused mixin/callable guard and import-reference tests pass
   - callable output is not cached
   - no body copy is introduced to satisfy parent/source metadata
   - benchmark/profile evidence shows whether this attacks the measured
     `Reference.evalNode`/callable lookup bucket

   Status:
   - Static callable **hits** with an already-built frame now enter `ScopeFrame` before
     `Rules.findMixinsFast(...)`: `ScopeFrame.callableBucketsByName` points at
     the existing `Rules.mixinsByName` bucket arrays, so this slice adds no
     per-callable wrapper record, no node copy, no output cache, and no new
     child traversal.
   - Focused tests prove direct `Rules.find(...)` for both static `Mixin` and
     simple `Ruleset`-as-mixin hits skips `Rules.findMixinsFast(...)` when a
     frame already exists.
   - Static callable **misses** now stop at the frame only for direct,
     non-targeted lookup when the current frame has no child callable surfaces
     and no reference-import callable surfaces. Targeted/namespace/import
     visibility stays on the old bridge.
   - Pre-pass leash: clean `benchmark-v39.less` profile showed
     `Reference.evalNode` `482` calls / `5.27ms`; `Rules.find` was only
     function lookup (`68` calls / `0.42ms`). This proves the slice is not
     expected to move `benchmark-v39.less`; use callable/mixin fixtures for
     behavior proof and broad profiles only as status.
   - Post-pass status: clean `benchmark-v39.less` profile showed
     `Reference.evalNode` `482` calls / `4.80ms`; `Rules.find` remained only
     function lookup (`68` calls / `0.34ms`). Quick hotpath leash was status
     only: `functions` `12.91ms` usable, `import-reference` `17.56ms` usable,
     `mixins-guards` `15.43ms` usable, `extend-chaining` `5.07ms` unstable,
     `media` `5.34ms` usable. Static node-creation audit returned to
     `new-node` `321`, `with-surface` `33`, `copy-leaves` `28`, `derive` `30`.

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

Do not select this queue while `Active Binding Implementation Lane` has
unchecked items, unless the binding lane is explicitly paused in the Focus Spec
above. These items are still valid targets, but they are secondary to finishing
the binding index/scope lookup refactor.

0. [x] Move callable `default()` guard classification out of
   `prepareCallableEvalCandidates(...)`. Parsed Less now passes explicit
   `hasDefault: true | false` for guarded mixins/rulesets, and the hot
   candidate loop trusts carried metadata instead of recursively scanning
   guards.
1. [x] Return static non-rules-like reference values directly. `Reference`
   no longer copies static source-backed lists/sequences merely because they
   have children, and the old source-free container child scans are gone.
2. [x] Replace generated `PseudoSelector.renderPseudoSyntax(...)` comma
   inspection with a structural selector-list item-count decision. Output is
   still rendered, but render text no longer decides whether to unwrap.
3. [x] Complete the first node rewrite pass: `PseudoSelector`. Removed the
   generated render-state helper/object allocation, removed the render-text
   comma predicate, skipped wrapper capture when structurally unwrapping, and
   deleted a dead commented keys experiment.
4. [x] Start the `Reference` node rewrite pass with the class render/eval
   surface. Deleted two alias predicate wrappers, removed the useless Promise
   identity wrapper in `evalNode(...)`, and flattened `render(...)` so the
   synchronous direct static-reference path no longer allocates local render
   closures before doing the raw lookup. Also deleted the option-fragment spread
   helpers and the scope-array recursive walker from rules lookup.
5. [x] Continue `Reference` pass 2. Deleted lookup/result classification
   wrappers, fallback predicate wrappers, materialization dispatch wrappers, the
   `resolveInitialReferenceTarget(...)` runtime-key IIFE, and small
   `findVarDeclarationFast(...)` result/IIFE object allocations.
6. [x] Continue `Reference` pass 3. Deleted redundant fallback/static and
   declaration-important checks, removed the duplicate
   `copyWithReusableLeaves(...).eval(...)` branch, removed runtime rechecks
   after rules-like callable validation, and flattened
   `resolveRawReferenceLookupTarget(...)` so the sync raw lookup path no longer
   allocates lookup/finalizer closures or an IIFE before a direct lookup.
7. [x] Continue `Reference` pass 4. Flattened `evaluateReferenceNode(...)` so
   the main eval/render lookup path no longer allocates `finishLookup`,
   `runLookup`, `resolveTargetValue`, or `evaluateKey` closures before ordinary
   synchronous reference lookup. Also removed duplicate static-return branches
   in runtime binding finalization and reference value evaluation.
8. [x] Continue `Reference` pass 5. Public declaration references now return
   static, non-important, non-merged source values directly instead of copying,
   freezing, and inheriting a declaration container that is already safe to
   reuse. Focused test now asserts identity plus no `copy(...)`/`.inherit(...)`
   for source-free static declaration containers.
9. [x] Continue `Reference` pass 6. Hoisted the per-call
   `findVarDeclarationFast(...)` bucket selection, candidate ordering, and
   deferred dynamic-name promotion closures to module scope. The lookup still
   performs the same scans, but ordinary variable reads no longer allocate
   those helper functions on every hot lookup. `createRulesLikeReferenceSurface(...)` was
   audited and left in place because existing tests prove it is still a public
   shallow-owned rules-like materialization boundary.
10. [x] Continue `Reference` pass 7. Replaced the
   `evaluateReferenceValueNode(...)` options object with local bit flags and
   deleted the declaration-reference wrapper that only unpacked an argument
   object before calling the same evaluator. This preserves the same
   rules-like/static/calc branches while removing hot evaluator object/wrapper
   setup.
11. [x] Continue `Reference` pass 8. Removed the runtime-binding
   `evaluateBinding`/`evaluateInRulesContext` closure pair and the
   `withRulesContext(...)` closure call from the common sync binding read path.
   Runtime binding eval now performs the same rules-context/search-scope
   save/restore directly; async cleanup continuations remain only for actual
   thenables.
12. [x] Continue `Reference` pass 9. Removed
   `createRulesReferenceLookupExecutor(...)` and its returned per-lookup
   `performRulesLookup(scope)` closure. Leaky rules lookup now carries the same
   lookup data as state and calls a module-local lookup function directly.
13. [x] Continue `Reference` pass 10. Render-only declaration and runtime
   binding finalization now returns the evaluated node directly for non-merged
   values instead of applying a post-eval `copyWithReusableLeaves(...)` plus
   `.inherit(reference)`. Focused tests prove dynamic container renders do not
   stamp reference ownership after eval.
14. [ ] Finish the node `writeSyntax` render/stringification rewrite across the
   remaining node families in `NODE-REWRITE-TRACKER.md`. This is a whole-task
   queue item: it is not complete until remaining open families have either
   direct render/stringification separation, documented cold public
   materialization boundaries, or an explicit semantic/benchmark blocker.
   Partial status:
   - `Mixin`, `Interpolated`, `InterpolatedSelector`, and `QueryCondition` have
     bounded direct-writer and sync-loop cuts, but remaining cold replacement,
     dynamic child render, and materialization boundaries keep the task open.
   - `List` and `Sequence` have async-capable render scaffolding cuts, direct
     writer hooks, and generator/callback deletions, but trivia-backed child
     emission and dynamic render capture remain open.
   - `Call`, `AtRule`, and `Ruleset` have several local closure, direct syntax,
     empty-arg, header, and selector-array cuts. These are partial progress
     only; callable output selection, `evalArgNodes(...)` copy pressure,
     whole-call mark/readback, `AtRule` body-state staging, and
     `Ruleset.getHeaderString(...)` capture/comparison boundaries remain open.
   - `Declaration` formatting and custom interpolated replacement evaluation
     have regex/iterator cuts, but custom-property raw source, duplicate
     comparison/materialization, and merge-state boundaries remain open.
   - `Operation` render/eval operand evaluation no longer allocates local
     `finalize`/`handleLeft`/`renderOperands`/`finish`/`combine` closures on
     each call, and non-preserve arithmetic no longer pays useless
     `try/catch { throw error }` wrappers. Preserve-mode dimension arithmetic
     still catches `TypeError` because that is the existing semantic boundary
     that produces `calc(...)`; broader `withOperands(...)` copy/materialization
     remains open.
   - Control-family complete for this node rewrite lane: `If`, `For`, and
     `While` have direct source writers and direct render paths. `If`, `For`,
     and `While` eval no longer allocate local `run` async closures, and
     `While` eval/render no longer allocate the generic
     `runWithRulesContext(...)` callback wrapper just to save/restore
     `context.rulesContext`. The remaining `For`/`While` owned iteration
     `Rules` surfaces are documented as semantic placement/eval state, not
     render/string transport; focused tests prove no `Rules.clone`, scalar leaf
     reuse, canonical body parenting, live/stateful bindings, render/eval
     alignment, and rules-context restoration on throw.
   - Rejected local cut: `QueryCondition` static shared-flat-buffer render
     still needs the returned full string while keeping split buffer parts, so
     deleting that `getSince(...)` requires a render-buffer return-contract task
     rather than a local cleanup.
   Evidence for these partials is in `NODE-REWRITE-TRACKER.md` and
   `PERFORMANCE-HANDOFF.md`; do not create new queue entries for additional
   one-line cuts inside this item.
16. [ ] Continue `Reference` before moving to the next node. Audit and cut the
   remaining copy/materialization pressure: `createRulesLikeReferenceSurface`,
   public `evaluateReferenceValueNode(...)` materialization, merged assign
   normalization, and remaining non-render `.inherit(...)`/
   `copyWithReusableLeaves(...)` ownership boundaries.
   Partial status: declaration-reference finalization no longer pays the
   single-use `withReferenceSearchScope(...)`,
   `finalizeEvaluatedDeclarationReference(...)`,
   `hasImportantDeclarationValue(...)`, or `isMergedAssignDeclaration(...)`
   helper/predicate layer. Search-scope cleanup and important/merged semantics
   stayed in the caller. This is a function-hop/API-surface cut only; the
   remaining public copy/inherit boundary for non-render declaration references
   is still real debt and remains queued.
   Second partial status: finalization no longer builds private `{ textOnly }`
   option objects or `finalizeReferenceLookupResult(...)`/fallback args
   objects. The render-only boolean is normalized once in
   `evaluateReferenceNode(...)` and passed positionally through private
   finalizers. This removes object plumbing only; it does not alter fallback,
   runtime binding, declaration, direct-node, or callable materialization
   semantics.
   Third partial status: dynamic runtime-binding and non-merged dynamic
   declaration public resolve no longer apply a second
   `copyWithReusableLeaves(evaluated).inherit(reference)` after
   `evaluateReferenceValueNode(...)` already produced the evaluated owned
   result. Merged declaration references still keep their explicit
   normalization/inherit boundary.
   Fourth partial status: fallback public resolve no longer pre-copies the
   fallback source container before eval. Dynamic container fallback still may
   materialize an owned public `List`/`Sequence` result inside the container's
   own `eval(...)` path, so this is a deletion of Reference's extra
   pre-copy only, not completion of fallback ownership. The exposed next cut is
   shared `List.eval(...)`/`Sequence.eval(...)` public materialization: render
   already stringifies directly, but public value materialization still creates
   owned containers via `withResolvedValue(...)`/`withValue(...)` when children
   change.
   Fifth partial status: `List.evalNode(...)` and `Sequence.evalNode(...)`
   no longer pay the private `evaluateItems(...)`/`evaluateValues(...)` wrapper
   calls, and `List.evalNode(...)` no longer uses `Array.every(...)` callbacks
   to decide whether evaluated items changed. This is only function-call and
   callback deletion around the existing public materialization boundary; the
   owned `withResolvedValue(...)`/`withValue(...)` surfaces still exist and
   remain queued.
   Sixth partial status: `findVarDeclarationFast(...)` no longer allocates the
   recursive `findVarWithinScopeSurface(...)` helper per lookup, and
   `lookupRuntimeVarBinding(...)` no longer allocates a local `searchChain(...)`
   helper per runtime binding lookup. Both helpers are module-scope functions
   that receive the same lookup state explicitly. This is closure/API-surface
   deletion only; traversal, fallback, and lookup semantics are unchanged.
   Seventh partial status: runtime binding and declaration reference
   finalization no longer allocate local `finalizeRuntimeBinding(...)` and
   `finalize(...)` closures on the common synchronous lookup path. The same
   reference-stack cleanup, search-scope cleanup, rules-like preservation, and
   merged-assign normalization still run; the async branch keeps only the
   continuation needed for actual thenables.
   Eighth partial status: key normalization, direct-index raw-target
   finalization, mixin/ruleset materialization finalization, and merged-assign
   item collection no longer allocate local helper closures on the synchronous
   Reference path. The same array key normalization, direct-index fallback
   behavior, rules-output `.inherit(sourceRules)`, and merged-list flattening
   semantics remain.
   Ninth partial status: the calc slash list evaluator no longer allocates its
   local arithmetic finalizer closure on the synchronous Reference value-eval
   path. The same dimension-only division, `.inherit(declValue)` result
   metadata, and fallback-to-source-value behavior remain.
17. [x] Sweep `Ampersand` template placement. Structured selector-list and
   generated `:is(...)` parents now stay structural instead of being copied into
   temporary replacement arrays, and raw comma text no longer pays
   `toTrimmedString().includes(',')` followed by a second split scan. The
   remaining raw-text fallback performs one top-level comma scan only after
   serialization is unavoidable because the parent selector is a scalar
   `BasicSelector` string containing commas.
18. [ ] Sweep selector matching/extend equality. Replace hot `valueOf()` equality
   predicates with structural/keyset checks where possible, keeping
   `valueOf()` only as a measured, cached fast-path when it wins.
   Partial status: `Any.compare(...)`, `List.compare(...)`, and
   `Sequence.compare(...)` no longer allocate per-call local normalization
   closures for `Any` coercion. They share the internal compare normalizers in
   `tree/util/compare.ts`. This does not complete selector matching/extend
   equality or remove value/string serialization as a decision mechanism.
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
24. [ ] Continue selector/extend factory cuts separately; do not hide selector
   placement copies inside another generic copy helper.
25. [ ] Replace callable binding copies for static containers with explicit
   binding/placement state. Static containers should not be copied merely
   because they contain child nodes; `F_HAS_NODE_CHILD` is only a cheap current
   ownership boundary, not a final architecture.
26. [ ] Attack the measured copy stack next: `copyChild`,
   `copyWithReusableLeaves`, `copyCallableRulesValue`, `constructCopy`, and
   `.inherit(...)`. CPU evidence says these are mostly registration derivation,
   selector header rendering, JS function argument ownership, reference value
   eval, and binding clone debt; do not justify them as render output copying.
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

Current pass: `Operation` node closure/catch scaffold cut under queue item 14.

- New traversal: none. The pass adds no loop, recursion, source walk, parent
  walk, side-map lookup, object scan, or array scan.
- New node/materialization: no new materialization boundary. The existing
  `Operation.withOperands(...)`, `Operation.createCalcFallback(...)`,
  `Call('calc', ...)`, `copyWithReusableLeaves(...)`, and `.inherit(...)`
  behavior remains. No new node creation, copied node, wrapper `Rules`, frozen
  mutation, parent restoration, source metadata mutation, or materialized array
  was added.
- Render path: accepted. `Operation.render(...)` still evaluates operands
  directly and writes the resolved output; unresolved operand rendering still
  streams `{ left, right }` without materializing a replacement `Operation`.
  Focused tests continue to prove render does not call public `resolve(...)`
  and does not call `withOperands(...)` for streamed unresolved output.
- Helper/API surface: private prototype methods were added to move
  `evaluateRenderOperands(...)`, `renderEvaluatedOutput(...)`, and
  `evaluateOperands(...)` off per-call local closure factories. This is
  accepted because it deletes the per-call `finalize`, `handleLeft`,
  `renderOperands`, `finish`, and `combine` closures from the sync path while
  keeping async continuations only where real thenables appear. No public API
  was added.
- Metadata mutations: no new metadata mutations. Existing `.inherit(...)`
  calls on arithmetic results and calc fallback results remain; they are
  documented as continuing `Operation` debt rather than hidden completion.
  No lazy options/context allocation, `Reflect.*`, `Object.hasOwn`,
  structural probe, parent restoration, or source-parent mutation was added.
- Error/control flow: removed useless non-preserve `try/catch { throw error }`
  wrappers around `operate(...)`. Preserve-mode dimension arithmetic still
  catches `TypeError` to produce the existing `calc(...)` fallback; non-TypeError
  failures still propagate.
- Evidence: focused tests passed with
  `pnpm --filter @jesscss/core test -- src/tree/__tests__/operation.test.ts src/tree/__tests__/node-render-buffer.test.ts`.
  Pre-pass hotpath leash at `c92f5dfd`: `functions` `15.36ms` unstable,
  `import-reference` `23.46ms` usable, `mixins-guards` `18.96ms` usable,
  `extend-chaining` `5.91ms` usable, `media` `5.93ms` usable. Dirty
  post-pass leash reported `functions` `16.09ms` usable, `import-reference`
  `22.55ms` unstable, `mixins-guards` `18.43ms` usable, `extend-chaining`
  `5.95ms` unstable, and `media` `6.01ms` unstable. This is status only, not
  a speed claim.
- Verdict: accept as partial item 14 progress. `Operation` still has real
  copy/materialization debt around `withOperands(...)` and calc fallback
  ownership, so the whole node rewrite item remains open.
