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

Design proposals that are not yet active implementation plans:

- `BINDING-INDEX-PROPOSAL.md`: binding-index implementation spec for
  reference lookup, Less contextual semantics, Jess/Sass-style live bindings,
  and removal of transitional fallback bridges.

## How To Work

1. Read this handoff first.
2. Read `AGGRESSIVE-CUTTING-REVIEW.md` before changing AST, eval/render,
   lookup, traversal, copying, inheritance, output writer, source/root metadata,
   or this handoff.
3. Read `PERFORMANCE-HANDOFF.md` before making or accepting any speed claim, or
   before touching a measured hot path.
4. Start each non-correctness pass from the benchmark leash below.
5. State one hypothesis before editing.
6. Make the smallest behavior-preserving cut that removes measured work or
   clearly wrong machinery.
7. Run focused tests first, then the required gates.
8. Keep, reshape, or revert based on the benchmark evidence and the aggressive
   cutting self-prosecution.
9. Commit and push the completed pass.

## Focus Spec

Active mode: **benchmark-leashed aggressive cutting**.

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

Work shape: go node by node and method by method. For each target, prove the
current output with focused tests, rewrite the method toward structural facts
and straight-line boring JavaScript, then rerun the same output tests. Reject
text inspection, callback-array helpers, nested hot closures, defensive generic
probes, and helper wrappers unless the method cannot preserve behavior without
them. Track each completed node in `NODE-REWRITE-TRACKER.md`.

## Active Work

Correctness queue: no active correctness blockers. If a `.less` fixture fails
to parse/evaluate, add a focused repro before changing expected output. If CSS
differs, review semantics manually before changing tests.

Performance leash:

1. Record a post-selector/callable-cut stable hot-path snapshot.
2. Profile broad `benchmark.less`.
3. Choose the next deep cut from measured evidence, not smell alone.
4. Rerun the same benchmark/profile after the patch.
5. Keep the patch only if it improves real runtime cost, removes measured
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
- Next binding step, when selected: delete the remaining `UNCOVERED` bridges
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

11. [ ] Callable records prototype.
   Move only simple static callable lookup into binding records. Namespace,
   guard matching, candidate evaluation, import visibility, and callable output
   stay out of the facade until separately proven.

   Completion gate:
   - focused mixin/callable guard and import-reference tests pass
   - callable output is not cached
   - no body copy is introduced to satisfy parent/source metadata
   - benchmark/profile evidence shows whether this attacks the measured
     `Reference.evalNode`/callable lookup bucket

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
   - A focused reference test proves the mixin array-path lookup receives the
     original static key array instance.
   - No cache, evaluated-value reuse, side map, materialized node, output
     wrapper, or render-path change was added.

Next deep-cut queue:

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
14. [ ] Continue `Reference` before moving to the next node. Audit and cut the
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
15. [ ] Sweep `Ampersand` template placement next. Replace
   `toTrimmedString().includes(',')` and string splitting with selector-list
   structure and placement state; only final CSS output may stringify.
16. [ ] Sweep selector matching/extend equality. Replace hot `valueOf()` equality
   predicates with structural/keyset checks where possible, keeping
   `valueOf()` only as a measured, cached fast-path when it wins.
17. [ ] Split `Node.evalStatic(...)` into immediate eval/render and cold public
   materialization so routine eval replacement does not imply `.inherit(...)`.
18. [ ] Replace `StyleImport` first-use placement copies with placement state
   that points at canonical source children and preserves import visibility.
19. [ ] Collapse `StyleImport.deriveRulesSurface(...)` wrappers whose only job
   is source/visibility/placement bookkeeping.
20. [ ] Replace remaining `Rules` merge output copies with direct merge
   placement/render state or a narrow owned-item copier proven by merge tests.
21. [ ] Convert registration-prep expected misses away from routine `try/catch`
   only after adding tests for unresolved declaration/identity behavior.
22. [ ] Continue selector/extend factory cuts separately; do not hide selector
   placement copies inside another generic copy helper.
23. [ ] Replace callable binding copies for static containers with explicit
   binding/placement state. Static containers should not be copied merely
   because they contain child nodes; `F_HAS_NODE_CHILD` is only a cheap current
   ownership boundary, not a final architecture.
24. [ ] Attack the measured copy stack next: `copyChild`,
   `copyWithReusableLeaves`, `copyCallableRulesValue`, `constructCopy`, and
   `.inherit(...)`. CPU evidence says these are mostly registration derivation,
   selector header rendering, JS function argument ownership, reference value
   eval, and binding clone debt; do not justify them as render output copying.
25. [ ] Audit repeated callable/mixin evaluation from the profile before making
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

1. Update the queue item status.
2. Update the self-prosecution block below with exact files/functions and a
   clear verdict.
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

- Reference declaration-finalization helper pass: accepted as helper/API
  surface deletion, not as a speed claim and not as completion of the Reference
  materialization audit. `packages/core/src/tree/reference.ts` deleted four
  single-use wrappers around declaration references:
  `withReferenceSearchScope(...)`, `finalizeEvaluatedDeclarationReference(...)`,
  `hasImportantDeclarationValue(...)`, and `isMergedAssignDeclaration(...)`.
  Search-scope cleanup now lives directly in
  `finalizeDeclarationReferenceResult(...)`, and important/merged classification
  is computed once beside the declaration value it controls. New traversal:
  none. New node/materialization: none; no `Node`, copy,
  `copyWithReusableLeaves(...)`, `.inherit(...)`, `.adopt(...)`, wrapper
  `Rules`, side map, cache, materialized array, frozen/source/parent mutation,
  or render-path materialization was added. Existing materialization: the
  non-render declaration-reference `copyWithReusableLeaves(...)` plus
  `.inherit(reference)` boundary remains in place and remains queued; this pass
  did not justify or expand it. Render path: unchanged; render-only non-merged
  declaration references still return evaluated nodes directly. Helper/API
  surface: four private helpers removed; no helper or public API added.
  Metadata mutations: no new mutation; the existing `context.searchScope`
  add/delete and `context.popReference()` behavior moved from the helper into
  the caller with the same sync/async/error cleanup shape. Evidence: focused
  `reference.test.ts` passed (`112` tests), focused eslint passed, static
  node-creation audit dropped `reference.ts` from `21` to `20` and global
  `with-surface` from `34` to `33` while `new-node` stayed `321`,
  `copy-leaves` stayed `31`, and `derive` stayed `30`. Clean
  `benchmark-v39.less` profiler status after the patch was `Reference.evalNode`
  `482` calls / `5.32ms`, `Rules.find` `68` calls / `0.38ms`; status only, not
  speed proof. Verdict: keep the deletion; continue attacking the remaining
  Reference copy/materialization boundary with tests before leaving item 14.
- Reference finalizer options-object pass: accepted as private object-plumbing
  deletion, not as a speed claim and not as a semantic materialization change.
  `packages/core/src/tree/reference.ts` now passes the render-only `textOnly`
  state as a boolean through `evaluateFallbackValue(...)`,
  `finalizeDirectReferenceResult(...)`,
  `finalizeDirectNodeReferenceResult(...)`,
  `finalizeRuntimeVarBindingResult(...)`,
  `finalizeDeclarationReferenceResult(...)`,
  `finalizeReferenceLookupResult(...)`, and
  `finalizeFallbackReferenceResult(...)`. `evaluateReferenceNode(...)`
  normalizes `textOnly === true` once and no longer builds five
  `finalizeReferenceLookupResult({ ... })` objects. New traversal: none. New
  node/materialization: none; no `Node`, copy, `.inherit(...)`, `.adopt(...)`,
  wrapper `Rules`, side map, cache, materialized array, frozen/source/parent
  mutation, or render-path materialization was added. Existing materialization:
  unchanged; the same fallback/runtime/declaration/direct/callable branches
  still own the same copy/materialization decisions as before this pass. Render
  path: unchanged except for boolean plumbing; render-only references still set
  the same reuse flags and return the same nodes. Helper/API surface: no public
  API added; private finalizer signatures got smaller and the args object
  wrappers were removed. Metadata mutations: none. Evidence:
  `reference.test.ts` and `call.test.ts` passed (`188` tests), focused eslint
  passed, `rg` found no remaining `{ textOnly }`/options-object patterns in
  `reference.ts`, static node-creation audit stayed `reference.ts` `20`,
  `new-node` `321`, `with-surface` `33`, `copy-leaves` `31`, `derive` `30`.
  Clean `benchmark-v39.less` profiler status after the patch was
  `Reference.evalNode` `482` calls / `5.65ms`, `Rules.find` `68` calls /
  `0.37ms`; status only, not speed proof. Verdict: keep the deletion; continue
  item 14 toward actual copy/materialization removal.
- Reference public-resolve post-eval ownership copy pass: accepted as actual
  copy/materialization deletion. `packages/core/src/tree/reference.ts` no
  longer copies and `.inherit(reference)` stamps evaluated runtime-binding
  values after `evaluateReferenceValueNode(...)`; it returns the evaluated node
  directly. Non-merged declaration references now do the same. Merged
  declaration references still flow through
  `normalizeMergedAssignReferenceResult(...)` and retain the existing
  `.inherit(reference)` boundary because that path can create a public merged
  result. New traversal: none. New node/materialization: none; two
  `copyWithReusableLeaves(...)` calls and their reference `.inherit(...)`
  stamps were removed from public resolve finalization. Render path: unchanged;
  render-only paths already skipped these post-eval stamps and now public
  resolve matches that ownership model for runtime bindings and non-merged
  declarations. Helper/API surface: no helper or public API added. Metadata
  mutations: removed reference ownership stamps from those evaluated output
  nodes; no parent/source restoration or new metadata mutation was added.
  Test-only materialization/control: the new focused tests allocate a tiny
  runtime scope, `Map`, `AsyncNativeRenderAny`, and `try/finally` monkey patch
  solely to prove the removed runtime path no longer calls
  `List.inherit(refNode)`; none of that exists in runtime code. Evidence: added
  focused public-resolve tests for dynamic runtime-binding and dynamic
  declaration containers proving `List.inherit(refNode)` is not called while
  canonical source parents remain intact. `reference.test.ts` passed
  (`114` tests), focused eslint passed, static node-creation audit dropped
  `reference.ts` from `20` to `18` and global `copy-leaves` from `31` to `29`
  while `new-node` stayed `321`, `with-surface` stayed `33`, and `derive`
  stayed `30`. Clean `benchmark-v39.less` profiler status after the patch was
  `Reference.evalNode` `482` calls / `5.27ms`, `Rules.find` `68` calls /
  `0.35ms`; status only, not speed proof. Verdict: keep the deletion; continue
  item 14 on remaining fallback/evaluateReferenceValueNode/merged/callable
  materialization boundaries.
- Static compound reference path identity pass: accepted as path-fact
  preservation, not as a speed claim. `packages/core/src/tree/reference.ts`
  now returns the original static string-array lookup key when the evaluated
  reference key is already `string[]`, instead of allocating a normalized copy.
  `packages/core/src/tree/rules.ts` now walks callable namespace paths with an
  offset into the original path array instead of recursively allocating
  `[segment, ...rest]` arrays. New traversal: one tiny string-array type guard
  loop over an already-existing key array; it replaces the old allocation and
  full normalization loop for the all-string case. New recursion: no new
  recursive search was added; the existing namespace recursion now carries an
  offset instead of allocating rest arrays. New node/materialization: none; no
  `Node`, copy, `.inherit(...)`, `.adopt(...)`, wrapper `Rules`, frozen/source/
  parent metadata mutation, render-time array materialization, side map, or
  cache was added. New test-only materialization/control: one `path` array is
  the deliberate identity token under test, one `boolean[]` records whether
  intercepted `Rules.find(...)` calls preserve that identity, and `try/finally`
  restores the monkey-patched prototype; none of these exist in runtime code.
  Render path: unchanged; this pass does not resolve into arrays/nodes to
  stringify and does not cache callable output. Helper/API surface: one private
  type guard was added solely to avoid cloning already string-only path arrays;
  no public API or method was added. Metadata mutations: none. Evidence:
  focused `reference/mixin/call/import-style` tests passed (`397` passed,
  `1` skipped); focused eslint passed; static node-creation audit stayed
  `reference.ts` `21`, global `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`. Clean
  `benchmark-v39.less` profiler status was `Reference.evalNode` `482` calls /
  `5.11ms`, `Rules.find` `68` calls / `0.37ms`, with `Rules.find` still only
  function lookups. Verdict: keep cutting toward binding handles; this pass
  preserves path identity and deletes per-hop/per-eval array rebuilding, but it
  does not prove evaluated-value reuse or finish the binding/index system.
- Lookup cache rejection pass: rejected as unproven machinery. A frame-local
  static-variable lookup cache was implemented and removed in the same pass.
  First attempt used a frame `Map` keyed by lookup identity; static audit rose
  from `new-node` `321` to `322`, so the cache container was guilty. Second
  attempt used single-entry primitive fields on `ScopeFrame` to avoid the
  cache `Map` and key string allocation; behavior tests passed, but clean
  `benchmark-v39.less` profile still reported `Reference.evalNode` `482` calls
  / `5.59ms`, worse than the pass baseline `482` / `5.43ms`. Stable hotpath
  sanity was mixed, not a win. New traversal in final code: none. New
  node/materialization in final code: none. Render path in final code:
  unchanged. Helper/API surface in final code: none. Metadata mutations in
  final code: none. Evidence: focused scope-frame/reference/mixin/control/call/
  import-style tests passed after the cache was removed; object audit returned
  to `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.
  Verdict: do not add standalone lookup caches. Continue toward one
  binding/index system where repeated references reuse binding handles and
  static/effect facts instead of rediscovering the same binding facts.
- Fallback-frame lookup ownership pass: accepted as binding-bridge deletion,
  not as a speed claim. `packages/core/src/tree/scope-frame.ts` now searches the
  primary frame chain and then the fallback frame chain inside
  `lookupScopeFrameVariable(...)`, so fallback live-slot hits, fallback
  declaration hits, and covered fallback misses are owned by the frame facade
  instead of returning `uncovered` solely because a fallback frame exists.
  `packages/core/src/tree/reference.ts` does not need a new branch: covered
  fallback hits return the existing `RuntimeVarBinding` shape, and covered
  fallback misses still stop through the existing local miss sentinel before
  `lookupRuntimeVarBinding(...)`, `findVarDeclarationFast(...)`, or registry
  fallback. New traversal: one fallback-frame walk was added inside the facade,
  but it replaces the old covered static-variable fallback traversal through
  `lookupRuntimeVarBinding(...)`/`findVarDeclarationFast(...)`; no child scan,
  source walk, generator, side map, `map/filter/sort`, or recursive AST walk was
  added. New node/materialization: none; no `Node`, copy, `.inherit(...)`,
  `.adopt(...)`, wrapper `Rules`, frozen/source/parent metadata mutation, or
  render-time array materialization was added. Render path: unchanged; render
  still stringifies evaluated values and this pass only changes lookup
  ownership. Helper/API surface: no helper or public API added. Metadata
  mutations: none. Evidence: focused `scope-frame/reference/mixin/call/import`
  tests passed (`406` passed, `1` skipped), including new direct facade tests
  for fallback live hits, fallback declaration hits, covered fallback misses,
  and a production reference test proving fallback declaration reads avoid
  `Rules.find(...)`. Post-patch profiler status on `benchmark-v39.less`:
  `Reference.evalNode` `482` calls / `5.07ms`, `Rules.find` `68` calls /
  `0.34ms`, still only function keys for that fixture. Static node-creation
  audit stayed `reference.ts` `21`, global `new-node` `321`, `with-surface`
  `34`, `copy-leaves` `31`, `derive` `30`. Stable hot-path sanity was usable
  for all five tracked fixtures: `functions` `12.33ms`, `import-reference`
  `20.09ms`, `mixins-guards` `17.44ms`, `extend-chaining` `5.51ms`, and
  `media` `6.66ms`.
- Manual-frame declaration coverage pass: accepted as binding-bridge deletion,
  not as a speed claim. `packages/core/src/tree/scope-frame.ts` now carries
  `declarationsCovered`, and `lookupScopeFrameVariable(...)` returns
  `uncovered` before walking parent declarations when a runtime frame has not
  proven its own declaration buckets represent the owned `Rules` surface.
  `packages/core/src/tree/reference.ts` deleted the per-static-variable
  `targetRules.scopeFrame`/`varsByName`/`rulesIndexed`/`value.length` guard, so
  coverage ownership lives on the frame instead of every reference lookup.
  New traversal: no new lookup-time traversal; `Rules.registerNode(...)` now
  updates an existing frame's declaration buckets/deferred list on the indexing
  edge that already visits each node, and `Rules._indexRules()` flips the
  coverage bit when indexing reaches the current value length. `buildScopeFrame(...)`
  replaced one `decls.map(...)` callback with a simple indexed loop while
  constructing declaration entries. No child scan, source walk, generator, side
  map, or recursive AST walk was added to render/eval lookup. New
  node/materialization: none; no `Node`, copy, `.inherit(...)`, `.adopt(...)`,
  wrapper `Rules`, frozen/source/parent metadata mutation, or render-time array
  materialization was added. Render path: unchanged; render still stringifies
  evaluated values. Helper/API surface: no helper or public API added; one
  frame field was added to delete the hotter reference-side branch. Metadata
  mutations: `declarationsCovered`, declaration buckets, and deferred-name list
  are binding index state, not parent/source metadata. Rejected/fixed variant:
  leaving snapshot reads on the old live-slot fallback after an uncovered frame
  made `$for` `$!value` read the current loop value; `lookupVariableReference(...)`
  now skips `lookupRuntimeVarBinding(...)` for `readMode: 'snapshot'`. Evidence:
  focused `scope-frame/reference/declaration/mixin/control` tests passed (`360`
  tests), including a new uncovered-child-frame test and the `$for` snapshot/live
  split; eslint for touched files passed; `@jesscss/core` build passed. Post-patch
  profiler status on `benchmark-v39.less`: `Reference.evalNode` `482` calls /
  `5.93ms`, `Rules.find` `68` calls / `0.36ms`, still only function keys for
  that fixture. Static node-creation audit status: `reference.ts` `21`, global
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.
  Stable hot-path sanity was usable for all five tracked fixtures: `functions`
  `12.85ms`, `import-reference` `20.19ms`, `mixins-guards` `17.86ms`,
  `extend-chaining` `5.47ms`, and `media` `6.33ms`.
- Deferred declaration-name promotion pass: accepted as an `UNCOVERED` bridge
  deletion, not as a speed claim. `packages/core/src/tree/reference.ts` now
  runs the existing `promoteResolvedPendingVarDecls(...)` before
  `lookupScopeFrameVariable(...)`, so already-static deferred declaration
  names become covered binding-frame hits instead of routing through the old
  `findVarDeclarationFast(...)` fallback first. New traversal: no new traversal
  shape; this reuses the existing deferred-name promotion loop that already
  ran in the fallback path and moves it earlier for the facade path. No child
  scan, source walk, `map/filter/sort`, generator, side map, or recursive AST
  walk was added. New node/materialization: none; no `Node`, copy,
  `.inherit(...)`, `.adopt(...)`, wrapper `Rules`, frozen/source/parent
  metadata mutation, or array materialization was added. Render path:
  unchanged. Helper/API surface: no new helper or public API added. Metadata
  mutations: the existing promotion mutates `pendingDeclarationNames` and
  `declarationBucketsByName` as binding index state; this pass does not add a
  new metadata mutation shape. Evidence: focused
  `scope-frame/reference/declaration/mixin/control` tests passed (`359`
  tests), including still-dynamic and async deferred-name cases; eslint for
  touched files passed; `@jesscss/core` build passed. Post-patch profiler
  status on `benchmark-v39.less`: `Reference.evalNode` `482` calls / `5.77ms`,
  `Rules.find` `68` calls / `0.37ms`, still only function keys for that
  fixture. Static node-creation audit remained `reference.ts` `21`, global
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.
  Stable hot-path sanity was usable for all five tracked fixtures:
  `functions` `12.67ms`, `import-reference` `18.16ms`, `mixins-guards`
  `16.43ms`, `extend-chaining` `5.11ms`, and `media` `6.30ms`. Danger-token
  prosecution: the `.inherit(...)`/`.adopt(...)` text appears only in the
  forbidden-machinery checklist; this pass adds no such calls. The
  `sourceNode` assertion added in `reference.test.ts` is test-only identity
  proof that the promoted binding entry points at the canonical declaration; it
  does not mutate parent/source metadata.
- Parent-frame coverage pass: accepted as an `UNCOVERED` bridge deletion, not
  as a speed claim. `packages/core/src/tree/rules.ts` now wires a frame parent
  by building/returning the nearest ancestor `Rules` frame on demand, and
  `packages/core/src/tree/reference.ts` deletes the guard that marked child
  frames with an unbuilt parent as uncovered. New traversal: no new traversal
  shape; this reuses the existing parent walk in `Rules.getScopeFrame(...)`
  and replaces "only use already-built parent frame" with "build the first
  ancestor frame." It adds no child scan, source walk, `map/filter/sort`,
  generator, side map, or recursive AST walk. New node/materialization: none;
  no `Node`, copy, `.inherit(...)`, `.adopt(...)`, wrapper `Rules`,
  frozen/source/parent metadata mutation, or array materialization was added.
  Render path: unchanged; render still stringifies evaluated values. Helper/API
  surface: no new helper or public API added. Metadata mutations: one existing
  `scopeFrame` cache can now be created on an ancestor earlier, which is the
  intended binding state rather than parent/source metadata mutation. Evidence:
  focused `scope-frame/reference/declaration/mixin/control` tests passed
  (`359` tests), including a new nested static variable test proving parent
  frame construction avoids declaration `Rules.find(...)`; eslint for touched
  files passed; `@jesscss/core` build passed. Post-patch profiler status on
  `benchmark-v39.less`: `Reference.evalNode` `482` calls / `5.61ms`,
  `Rules.find` `68` calls / `0.38ms`, still only function keys for that
  fixture. Static node-creation audit remained `reference.ts` `21`, global
  `new-node` `321`, `with-surface` `34`, `copy-leaves` `31`, `derive` `30`.
  Stable hot-path sanity was usable for all five tracked fixtures:
  `functions` `12.35ms`, `import-reference` `18.18ms`, `mixins-guards`
  `16.53ms`, `extend-chaining` `5.10ms`, and `media` `6.25ms`.
  Danger-token prosecution: the `.inherit(...)`/`.adopt(...)` text appears
  only in the forbidden-machinery checklist; this pass adds no such calls. The
  `frame.parent` text describes a deleted read-only guard and does not mutate
  parent/source metadata. The added `try/finally` is test-only cleanup for a
  temporary `Rules.find(...)` monkey patch, not production expected-miss or
  branch control.
- Covered miss vs uncovered pass: accepted as binding-bridge deletion, not as
  a speed claim. `packages/core/src/tree/scope-frame.ts` now returns explicit
  `miss` and `uncovered` states from `lookupScopeFrameVariable(...)`;
  `packages/core/src/tree/reference.ts` treats covered static variable misses
  as terminal through a module-level sentinel, so those misses no longer call
  `lookupRuntimeVarBinding(...)`, `findVarDeclarationFast(...)`, or registry
  fallback. New traversal: none beyond the existing frame-chain walk; no child
  scan, source walk, `map/filter/sort`, generator, side map, or recursive AST
  walk was added. New node/materialization: none; no `Node`, copy,
  `.inherit(...)`, `.adopt(...)`, wrapper `Rules`, frozen/source/parent
  metadata mutation, or array materialization was added. Render path:
  unchanged; render still stringifies the evaluated value and this pass only
  changes miss routing. Helper/API surface: one existing facade return type
  became discriminated and one module-level sentinel was added to keep the
  local adapter boundary explicit without allocating per miss. Metadata
  mutations: none. Rejected variants: terminal miss for every facade miss broke
  detached ruleset calls because an unbuilt ancestor frame still had to be
  discovered by old lookup; treating every prebuilt unindexed frame as
  uncovered broke `$for` snapshot reads by letting old lookup see loop live
  slots. Evidence: focused `scope-frame/reference/declaration/mixin/control`
  tests passed (`358` tests); eslint for touched files passed; `@jesscss/core`
  build passed. Post-patch profiler status on `benchmark-v39.less`:
  `Reference.evalNode` `482` calls / `5.57ms`, `Rules.find` `68` calls /
  `0.40ms`, still only function keys for that fixture. Static node-creation
  audit remained `reference.ts` `21`, global `new-node` `321`, `with-surface`
  `34`, `copy-leaves` `31`, `derive` `30`. Stable hot-path sanity was usable
  for all five tracked fixtures: `functions` `12.39ms`, `import-reference`
  `18.77ms`, `mixins-guards` `16.94ms`, `extend-chaining` `5.09ms`, and
  `media` `6.35ms`. Danger-token prosecution: the added `new Context()` and
  `rules([])` calls are focused test fixture setup only, not production
  eval/render node creation. The `frame.parent` check is a read-only coverage
  guard that prevents terminal misses when the AST parent rules chain is not
  represented in the frame chain; it does not mutate parent/source metadata.
  The `.inherit(...)`/`.adopt(...)` text appears only in this prosecution as
  forbidden machinery; this pass adds no such calls.
- Declaration-bucket binding identity pass: accepted as binding-bridge
  deletion, not as a speed claim. `packages/core/src/tree/reference.ts` now
  returns the existing `RuntimeVarBinding` shape for declaration-bucket hits
  from `lookupScopeFrameVariableBinding(...)`, so covered static variable
  reads finalize from binding cell/value identity instead of first returning a
  source `VarDeclaration`. New traversal: none; it reuses the existing
  frame-chain/bucket lookup and adds no loop, recursion, parent/source walk,
  side map, generator, `map/filter/sort`, or child scan. New
  node/materialization: no new `Node`, copy, `.inherit(...)`, `.adopt(...)`,
  wrapper `Rules`, frozen/source/parent metadata, or array materialization was
  added. The existing public `preserveRulesLike` shallow surface remains only
  for non-param rules-like declaration references that tests prove require
  owned public materialization; render-only paths are not routed through it as
  a new copy tax. Render path: unchanged except covered static variable hits
  avoid `Rules.find(...)` and source-declaration finalization. Helper/API
  surface: no new helper or public API added. Metadata mutations: none.
  Evidence: focused `reference/scope-frame/declaration/mixin/control` tests
  passed (`356` tests); eslint for `reference.ts` and `reference.test.ts`
  passed; `@jesscss/core` build passed. Post-patch profiler status on
  `benchmark-v39.less`: `Reference.evalNode` `482` calls / `5.62ms`,
  `Rules.find` `68` calls / `0.37ms`, with `Rules.find` now only function keys
  (`hsl`, `percentage`, `range`) for that fixture. Static node-creation audit
  remained `reference.ts` `21`, global `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`. Stable hot-path sanity was usable for
  all five tracked fixtures: `functions` `12.69ms`, `import-reference`
  `20.95ms`, `mixins-guards` `17.33ms`, `extend-chaining` `5.74ms`, and
  `media` `6.46ms`.
  Danger-token prosecution: the `sourceNode` reads in `reference.ts` only carry
  existing binding source identity into the existing result shape; they do not
  mutate parent/source metadata. The `evald.sourceNode` check is a public
  rules-like surface guard that avoids creating a second surface when one
  already exists. The added `try/finally` is test-only monkey-patch cleanup for
  restoring `Rules.find(...)`, not runtime expected-miss or branch control.
  The `.inherit(...)`/`.adopt(...)` text is only in this prosecution/doc
  checklist as forbidden machinery; this pass adds no such calls.
- Binding bridge cleanup doctrine: accepted as documentation/spec tightening
  only. It turns fallback bridges into named temporary debt and requires
  deletion conditions before any covered static-key path may keep old
  registry/search/materialization branches. New traversal: none. New
  node/materialization: none. Render path: unchanged. Helper/API surface: none.
  Metadata mutations: none. Evidence: spec and handoff now require covered
  binding-frame paths to return hit/miss directly, with old fallback allowed
  only for explicitly unmodeled cold/complex cases.
- Binding lane status correction: accepted as documentation-only. It marks the
  already-landed source-order/current-read facade hardening complete and adds
  the next production binding step: declaration-bucket hits must return
  binding identity before lookup caching. New traversal: none. New
  node/materialization: none; no `Node`, copy, `.inherit(...)`, wrapper Rules,
  array/object materialization, source/parent mutation, or frozen state was
  added. Render path: unchanged. Helper/API surface: none. Metadata
  mutations: none. Evidence: focused `scope-frame/reference/mixin/control/
  declaration` tests passed (`355` tests), plus
  `pnpm run verify:aggressive-cutting-review` and `git diff --check`.
- Current binding prototype pass: accepted as design/harness work only, not
  production eval/render machinery. The script adds one current-slot pointer
  table per prototype frame so current reads and `:=` assignment do not scan
  occurrence arrays. It adds no AST nodes, copies, `.inherit(...)`, production
  traversal, parent/source metadata mutation, or render materialization. The
  explicit parent-frame loops are prototype lookup semantics and are not wired
  into production. Evidence: `pnpm run prototype:binding-frame-layout`,
  small-frame `node scripts/prototype-binding-frame-layout.mjs --frames 3
  --keys 48 --declarations 192 --reads 1000000 --writes 100000`, large-frame
  `node scripts/prototype-binding-frame-layout.mjs --frames 10 --keys 512
  --declarations 2048 --reads 1000000 --writes 100000`, plus
  `pnpm run verify:aggressive-cutting-review` and `git diff --check`.
  Performance remains prototype-layout evidence, not Jess runtime evidence.
- Current binding prototype danger-token prosecution: the added `for` loop only
  runs variant semantic assertions before timing starts; the added `while (f)`
  loops model the exact parent-frame lookup shape required for current reads
  and `:=` assignment, and are not production traversal. The added `Map`, array,
  and record-object allocations are measured harness variants, not accepted
  runtime machinery. The added `throw new Error(...)` is assertion failure for
  invalid prototype semantics, not expected-miss runtime control flow. The
  `.inherit(...)` text appears only in this prosecution sentence as a forbidden
  production mechanism; this pass adds none.
- Production binding facade pass: accepted for step 2 only. Added
  `lookupScopeFrameVariable(...)` in
  `packages/core/src/tree/scope-frame.ts` and a narrow
  `lookupScopeFrameVariableBinding(...)` call site in
  `packages/core/src/tree/reference.ts`. New traversal is the existing
  frame-chain walk moved behind a facade; no AST walk, child-surface walk, map
  conversion, sort, generator, or side-cache was added. New materialization:
  none; the returned runtime binding object already existed as the
  `Reference` live-binding result shape, and no `Node`, copy, wrapper `Rules`,
  `.inherit(...)`, `.adopt(...)`, or metadata mutation was added. Render path:
  unchanged except covered static variable lookup can return through the facade
  before the old live/static lookup fallback. Helper/API surface: one exported
  facade and one local adapter were added to retire scattered lookup logic in
  future steps; this pass does not claim deletion yet. Metadata mutations:
  none. Evidence: focused reference/mixin/control/import-style tests passed
  (`366` passed, `1` skipped), `pnpm --filter @jesscss/core build` passed,
  `pnpm --filter @jesscss/core exec eslint src/tree/reference.ts
  src/tree/scope-frame.ts` passed, and hot-path benchmark sanity completed with
  usable signals except unstable `functions`. This is behavior-gated facade
  progress, not a speed claim.
- Binding facade semantics pass: accepted as step-3 facade hardening, not as a
  production contextual-start widening. Added focused tests in
  `packages/core/src/tree/__tests__/scope-frame.test.ts`, an `includeLive:
  false` snapshot option, and `assignScopeFrameVariable(...)`. New traversal:
  no additional traversal shape beyond the existing frame-chain lookup reused by
  assignment. New node/materialization: none; assignment mutates the resolved
  `BindingCell.value` and does not create nodes, copy nodes, or alter parent or
  source metadata. Render path: unchanged. Helper/API surface: one narrow
  assignment API was added because `:=` needs an explicit cell-write operation
  instead of being modeled as copy/replacement. Metadata mutations: no parent,
  source, `frozen`, inherited-location, lazy context/options, or generic
  defensive-read mutation was added. Evidence: `pnpm --filter @jesscss/core
  exec vitest src/tree/__tests__/scope-frame.test.ts` passed,
  then the focused reference/mixin/control/import-style set plus scope-frame
  passed (`370` passed, `1` skipped) after rebuilding. A parallel build/test
  attempt failed while `@jesscss/core/lib` was being cleaned, so it was a
  build-race artifact; the sequential rerun passed.
- Production start-route attempt: rejected and reverted. The attempted route
  reused `lookupScopeFrameVariable(...)` with `start` and `includeLive: false`
  under narrow no-target/no-interpolation/no-local/no-child-surface guards, but
  focused control evidence showed that this still breaks `$while` current reads
  by hiding the live loop binding from the condition. A separate attempted
  source-order render assertion was also rejected because ordinary contextual
  refs are current/lazy and correctly see later same-frame bindings. New
  traversal/materialization after revert: none. New helper/API surface after
  revert: none. Metadata mutations: none. Evidence: reference focused test
  passed before the revert only for the unsafe route; control focused test
  failed with `$while exceeded 10000 iterations`; after revert the focused
  control guard passed again. Verdict: step 3 needs an explicit carried
  read-mode fact before production `start` facade routing.
- `$!` source-position route: accepted as the narrow production widening for
  step 3. `ReferenceOptions` now carries `readMode: 'snapshot'` only for
  explicit `$!` reads; ordinary `$x` current reads and loop/live reads keep the
  existing path. The Jess parser emits that flag from `$!name`, and
  `Reference` serializes it back as `$!name`. The scope-frame facade receives
  `start` and `includeLive: false` only for this explicit mode, so it avoids
  broad declaration-registry lookup for covered same-frame source-order reads
  without hiding live loop cells from ordinary current reads. New traversal:
  none beyond the existing frame-chain lookup. New node/materialization: none.
  Helper/API surface: no helper added; one existing options object gained a
  narrow carried fact. Metadata mutations: none. Evidence: focused core
  reference/control tests passed; parser `$!` baseline passed after rebuilding
  `@jesscss/core`. The full parser baseline still has the pre-existing
  collection parent mismatch and is not claimed as passed by this slice.
  `pnpm run measure:less:hotpath -- --stable` was run as a leash sanity check:
  `functions` usable median `12.72ms`, `import-reference` usable median
  `17.15ms`, `mixins-guards` usable median `16.32ms`, `extend-chaining` usable
  median `4.62ms`, and `media` unstable median `5.74ms`. This is status only,
  not a before/after speed claim.
- Static `:=` VarDeclaration production route: accepted as a node-creation cut,
  not as completion of the pure live-binding model. New traversal: none beyond
  the existing `Rules.find(...)` lookup and the existing scope-frame lookup
  inside `assignScopeFrameVariable(...)`; no AST walk, parent/source walk,
  child scan, side-map lookup, `map`, `filter`, `sort`, or generator was added.
  New node/materialization: none. This deletes the static variable path through
  `deriveWithOptions`, `.adopt(...)`, `Rules.value.splice(...)`/`unshift(...)`,
  and `registerNode(...)` re-entry instead of wrapping it in another copy
  helper. Render path: unchanged; the evaluated tree is still stringified
  normally and no array/node is produced just to render. Helper/API surface: no
  helper added; this reuses existing `assignScopeFrameVariable(...)`. Metadata
  mutations: no parent restoration, `frozen`, inherited source/location, lazy
  context/options allocation, `Reflect.*`, or `Object.hasOwn(...)` was added.
  The pass deliberately still mutates the resolved declaration value because
  current declaration-bucket `Reference` hits return source declaration nodes;
  that source-node return is named remaining debt, not defended as the final
  model. Evidence: focused `Rules` `setDefined`/readonly tests pass, including
  a new assertion that static `setDefined` does not call
  `deriveWithOptions(...)`.
- Cross-structure binding proof pass: accepted as behavior hardening plus one
  narrow production fix. New traversal: none. The pass uses the already
  available registration `Context` only when the target `Rules` surface already
  carries live slots, then evaluates the assigned RHS once at the `setDefined`
  write boundary. This fixes the proven failure where `$for` assigned a raw
  `Reference` to an outer binding and later tried to evaluate it after the
  iteration live slot was gone. A broader attempt to pass context through all
  registration prep was rejected because it broke dynamic declaration-name
  reference tests; the kept path is gated by `scopeFrame.liveSlotsByName.size`.
  New node/materialization: none; no `Node`, copy, wrapper `Rules`,
  `.inherit(...)`, `.adopt(...)`, parent/source rewrite, or array
  materialization was added to production. The added `new Context()` and
  `new Any(...)` calls are test fixture construction only. Render path:
  unchanged; tests render final CSS directly. Helper/API surface: no helper or
  public API added. Metadata mutations: no new parent/source/frozen/lazy
  context/options or generic defensive reads. Evidence: focused mixin/control
  tests now cover current vs `$!` snapshot reads, static `:=`, and live-slot
  RHS `:=` in both mixin and `$for` structures. The `$for` live-slot RHS test
  failed before the write-boundary eval fix with `'value' is not defined` and
  passed after it; `reference.test.ts` also passes after rejecting the broader
  context route.
- Reference pass 5 static declaration public-resolve cut: accepted as a narrow
  copy/materialization deletion. New traversal: none; no loop, recursion,
  parent/source walk, side map, generator, sort/filter/map, or child scan was
  added. New node/materialization: none; the pass deletes the public
  declaration-reference path that copied, froze, and inherited a static
  non-important, non-merged container. Render path: unchanged; the existing
  text-only direct static path is widened to public resolve/eval only when the
  source value is already `F_STATIC`, not rules-like, and not inside a calc
  frame. Helper/API surface: no helper or public API added; no options-object
  spread was kept in the hot finalizer. Metadata mutations: no
  parent/source/frozen/lazy context/options, `Reflect.*`, or
  `Object.hasOwn(...)` added. Important declarations, merged assignments, and
  calc slash-list normalization stay on the existing evaluated/materialized
  paths. Evidence: a focused `reference.test.ts` assertion failed before the
  patch because resolve returned a copied/frozen `List`; it now asserts
  identity plus zero `copy(...)`/`.inherit(...)`. The broader
  `operation.test.ts` calc cases failed when the direct return was too broad,
  then passed with the explicit `context.calcFrames === 0` boundary; the full
  focused reference/declaration/list/sequence/condition/operation family
  passes.
- Reference pass 6 lookup helper hoist: accepted as hot lookup function-call
  and closure-allocation deletion. Pre-pass evidence on `benchmark-v39.less`
  showed `Reference.evalNode` still as the main non-parse bucket
  (`482` calls / `5.69ms`) while `Rules.find` was only `68` calls / `0.38ms`;
  top keys were repeated loop/current variable reads (`value`, `val`, `size`,
  `hue`, `idx`). New traversal: none; the existing bucket scan,
  candidate-order comparison, and deferred dynamic-name promotion loops were
  moved out of `findVarDeclarationFast(...)` but not expanded; the `sourceNode`
  reads are the same existing bucket identity/source-order checks, now at
  module scope instead of inside per-call closures. The existing `try` remains
  the same source-position comparison fallback and is not expected-miss control
  flow. New
  node/materialization: none; no copy, clone, `.inherit(...)`, wrapper Rules,
  source/parent mutation, or array materialization was added. Render path:
  unchanged; this is lookup-only and does not resolve into nodes to stringify.
  Helper/API surface: three module-local helpers were added only to delete
  three per-call nested helper allocations from the hot variable lookup path;
  no public API or generic wrapper was added. Metadata mutations: unchanged;
  the existing deferred dynamic-name bucket update remains the same mutation at
  the same semantic point. Rejected cut: `createRulesLikeReferenceSurface(...)`
  was audited but not removed because current tests assert a shallow owned
  public rules-like surface while keeping source children canonical and avoiding
  clone/inherit. Evidence: focused
  `reference/declaration/mixin/ruleset` tests passed (`330` tests).
- Reference pass 7 reference-value evaluator object cut: accepted as narrow
  evaluator setup deletion. Pre-pass evidence on `benchmark-v39.less` stayed
  centered on `Reference.evalNode` (`482` calls / `5.70ms`) with repeated
  variable reads dominating, and the node-creation audit still listed
  `reference.ts` with `23` creation/copy surfaces. New traversal: none; no
  loop, recursion, parent walk, source walk, side map, array helper, or object
  scan was added. New node/materialization: none; no `Node`, copy,
  `.inherit(...)`, wrapper Rules, materialized array, source/parent mutation,
  or frozen state was added. Render path: unchanged; the same
  rules-like/static/calc checks run and no render path resolves into nodes just
  to stringify. Helper/API surface: three module-local numeric flags were added
  only to delete the per-call evaluator options object, and the
  `evaluateDeclarationReferenceValue(...)` wrapper plus its argument object were
  deleted. Metadata mutations: unchanged; contextual important state is pushed
  at the same declaration-reference point as before. Evidence: focused
  `reference/declaration/mixin/ruleset/operation` tests passed (`341` tests),
  including the calc slash-list cases that guard the earlier direct-return
  boundary.
- Reference pass 8 runtime-binding sync closure cut: accepted as a narrow
  sync-path closure deletion. Pre-pass evidence on `benchmark-v39.less` showed
  `Reference.evalNode` still as the main non-parse bucket (`482` calls /
  `6.34ms`) with repeated variable reads dominating; `Rules.find` remained
  small (`68` calls / `0.41ms`), and the static node-creation audit still
  listed `reference.ts` with `23` creation/copy surfaces. New traversal: none;
  no loop, recursion, parent/source walk, side map, array helper, or object
  scan was added. New node/materialization: none; no `Node`, copy,
  `.inherit(...)`, wrapper Rules, materialized array, or frozen state was
  added. Render path: unchanged; this only changes runtime-binding value eval
  setup before the same evaluated node render path. Helper/API surface: one
  module-local helper was added to delete the per-binding
  `evaluateBinding`/`evaluateInRulesContext` closure pair and the
  `withRulesContext(...)` closure call from the common sync path. Metadata
  mutations: no new semantic mutation; the existing rules-context and
  search-scope save/restore are now explicit in the helper. Async promise
  cleanup continuations remain because actual thenables still need rejection
  cleanup. Evidence: focused `reference/declaration/mixin/ruleset/operation`
  tests passed (`341` tests), including async binding and calc coverage.
- Reference pass 9 rules-lookup executor closure cut: accepted as a narrow
  lookup setup deletion. Current profile status after the patch still shows
  `Reference.evalNode` as the main non-parse bucket (`482` calls / `9.57ms`)
  and `Rules.find` small (`68` calls / `0.47ms`); the static audit dropped
  `reference.ts` from `23` to `21` creation/copy surfaces and global
  `with-surface` from `36` to `34`. Process note: this CPU/counter refresh was
  run after the edit, so it is status evidence rather than a before/after speed
  proof. New traversal: none; no loop, recursion, parent/source walk, side map,
  array helper, or object scan was added. New node/materialization: none; no
  `Node`, copy, `.inherit(...)`, wrapper Rules, materialized array, source or
  parent mutation, or frozen state was added. Render path: unchanged; this only
  changes how rules lookup state is carried before the same adapter lookup.
  Helper/API surface: one module-local lookup function and one typed state
  alias replace `createRulesReferenceLookupExecutor(...)` plus its returned
  per-lookup closure. Metadata mutations: none. Evidence: focused
  `reference/declaration/mixin/ruleset/operation` tests passed (`341` tests).
- Reference pass 10 render-only finalization cut: accepted as a direct
  render-path ownership deletion. Pre-edit profile status showed
  `Reference.evalNode` at `482` calls / `5.27ms`, `Rules.find` at `68` calls /
  `0.37ms`, with repeated variable reads dominating; post-edit status showed
  `Reference.evalNode` at `482` calls / `6.36ms`, `Rules.find` at `68` calls /
  `0.48ms`. This is profiler status, not speed proof. Static audit remained
  unchanged (`reference.ts` `21`; global `new-node` `321`, `with-surface` `34`,
  `copy-leaves` `31`, `derive` `30`) because this pass deletes conditional
  runtime calls, not static source lines. New traversal: none. New
  node/materialization: none added; render-only dynamic declaration/runtime
  binding values now skip an existing post-eval `copyWithReusableLeaves(...)`
  and `.inherit(reference)` when no merged assign normalization is required.
  Render path: narrower; already evaluated values stringify directly instead
  of becoming public result surfaces. Helper/API surface: none added. Metadata
  mutations: deleted render-only reference metadata stamping for this branch.
  Test-only danger tokens: `new AsyncNativeRenderAny`, `new Map`, `sourceNode`,
  and `try/finally` appear only in focused assertions that restore monkey
  patches and construct runtime-binding fixtures; they add no production
  traversal, node creation, side map, or metadata mutation. Evidence: focused
  `reference.test.ts` passed (`108` tests), and the
  `reference/declaration/mixin/ruleset/operation` set passed (`343` tests).
- New traversal: none added. Pass 4 kept the existing lookup sequence but
  removed eagerly allocated lookup/finalizer closures from
  `evaluateReferenceNode(...)`. No parent/source walk, side-map lookup,
  recursive scan, `map`, `filter`, `sort`, generator, or new object/array scan
  was added.
- New node/materialization: none. No new `Node`, copy, wrapper `Rules`,
  `.inherit(...)`, `.adopt(...)`, `copyWithReusableLeaves(...)`, `frozen`, or
  parent/source metadata mutation was added. Remaining existing
  `.inherit(...)`, `copyWithReusableLeaves(...)`, `new Any`, `new Nil`,
  `new List`, `new Reference`, `new MixinCollection`, and shallow rules-like
  surface construction paths are not solved by this pass and stay queued as
  ownership/materialization debt. The `new MixinCollection(callableItems)` line
  appears in the diff only because an intermediate local variable was deleted;
  this pass did not add a collection materialization boundary.
- Render path: pass 4 preserves the direct raw static-reference render path and
  the native evaluated-node render path. It removes setup work before the main
  direct lookup and does not resolve into arrays/nodes just to stringify.
- Helper/API surface: no public API or helper was added. Pass 4 deleted the
  local `finishLookup`, `runLookup`, `resolveTargetValue`, and `evaluateKey`
  closures from `evaluateReferenceNode(...)`, plus duplicate static-return
  branches in `finalizeRuntimeVarBindingResult(...)` and
  `evaluateReferenceValueNode(...)`. The previous deleted helper list remains
  deleted:
  `ReferenceLookupResultKind`, `classifyReferenceLookupResult(...)`,
  `copyReferenceResultNode(...)`, `canRenderFallbackContainerDirectly(...)`,
  `canUseDynamicFallbackScalarDirectly(...)`, `canReuseFallbackValue(...)`,
  `createRulesLookupAdapter(...)`, `createCallableLookupAdapter(...)`,
  `materializeMixinCollectionTarget(...)`,
  `materializeJsFunctionTarget(...)`, and `materializeRulesLikeTarget(...)`.
- Metadata mutations: none. No parent restoration, `frozen`, inherited
  location/source metadata, lazy options/context creation, `Reflect.*`, or
  `Object.hasOwn(...)` was added. Existing rules-like surface parent/index and
  `sourceNode` mutation remain existing public materialization debt, not solved
  here. The async `.catch(...)` blocks in `resolveRawReferenceLookupTarget(...)`
  restore the existing pushed reference stack on exceptional async rejection;
  they are not expected-miss lookup control flow. They remain worth collapsing
  only if the async path can be simplified without reintroducing sync-path
  closure allocation.
- Evidence: focused Reference-family output tests passed after pass 4:
  `pnpm --filter @jesscss/core exec vitest
  src/tree/__tests__/reference.test.ts src/tree/__tests__/mixin.test.ts
  src/tree/__tests__/declaration.test.ts src/tree/__tests__/ruleset.test.ts
  src/tree/__tests__/list.test.ts src/tree/__tests__/sequence.test.ts
  src/tree/__tests__/condition.test.ts src/tree/__tests__/operation.test.ts
  --run` (`410` tests). `pnpm --filter @jesscss/core build` and
  `pnpm exec eslint packages/core/src/tree/reference.ts` also passed. This is
  accepted as method-level machinery deletion, not as a speed claim. The same
  one-shot Reference/mixin test failure during parallel build was a build/test
  race while `@jesscss/core/lib` was being cleaned and recreated; rerunning
  after build passed.
  `pnpm run measure:less:hotpath -- --stable` was run as a leash sanity check:
  `functions` median `13.70ms`, `import-reference` median `20.68ms`,
  `mixins-guards` median `17.58ms`, `extend-chaining` median `5.69ms`, and
  `media` median `6.68ms`; all five signals were usable. Because this pass did
  not capture a clean before/after pair, this benchmark is status only.
- Verdict: accepted as `Reference` pass 4 only. Do not mark `Reference`
  complete until the remaining lookup/finalization/copy helpers are audited and
  either cut or explicitly isolated as cold/public materialization.
