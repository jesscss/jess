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
  and removal of transitional fallback bridges. The first implementation lane
  below is checked off as facade/callable/handle prototype proof, not as the
  complete binding-index migration.

## How To Work

1. Read this handoff first.
2. Read `AGGRESSIVE-CUTTING-REVIEW.md` before changing AST, eval/render,
   lookup, traversal, copying, inheritance, output writer, source/root metadata,
   or this handoff.
3. Read `PERFORMANCE-HANDOFF.md` before making or accepting any speed claim, or
   before touching a measured hot path.
4. While the Focus Spec says registryless lookup/binding is active, choose work
   only from the `Brought-Forward Binding/Lookup Queue` or from a newly found
   binding/lookup bridge that belongs in that queue. Unchecked or unexhausted
   binding/lookup work blocks benchmark cutting, node cleanup, selector cleanup,
   and smell sweeps. Do not seed the active queue from secondary cutting or
   performance items.
5. Treat "full queue pass" as a full binding/lookup swath: complete as many
   related binding/lookup items as can be safely proven before a commit. Only
   after the binding/lookup queue is fully complete and exhausted may this
   worktree return to cutting/performance work, unless the user explicitly
   redirects the lane.
6. Start each non-correctness binding/lookup pass from the benchmark leash below
   when the selected lane touches measured hot paths.
7. State one hypothesis before editing.
8. Make the smallest behavior-preserving cut that removes measured work or
   clearly wrong machinery.
9. Run focused tests first, then the required gates.
10. Keep, reshape, or revert based on the benchmark evidence and the aggressive
   cutting self-prosecution.
11. Before committing, update the completed items and seed the next explicit
    binding/lookup queue from live remaining code smells. Commit and push only
    after that full swath is complete and the next queue is visible.

## Focus Spec

Active mode: **registryless lookup slimming/performance**.

Temporary branch-local lane switch: this worktree is explicitly focused on
registryless lookup architecture, deleting registry plumbing, and improving the
runtime around `Rules.find(...)`, callable lookup, and binding/frame lookup.
The `writeSyntax` serialization lane merged from `origin/dev` is not the
active direction for this branch. Do not choose serialization, selector
stringification, or `OutputWriter` work from `NODE-REWRITE-TRACKER.md` here
unless the user explicitly redirects this worktree to that lane.

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

Work shape while registryless lookup is active: take the next registry or
fallback bridge that is covered by direct/frame lookup, delete or narrow it,
prove covered behavior with focused lookup tests, and benchmark the usual
lookup fixtures before making any speed claim. Prefer deletion of stale
env-gated experiments, registry-side caches, recursive `_rulesSet` walks, and
generic fallback ladders over adding new cache layers or helper surfaces.
Do not preserve an unreleased or self-invented `Rules`/lookup method merely
because it is public-looking today; if repo usage does not require it and the
user has not approved it as API, delete it instead of keeping a compatibility
shim.

Active queue discipline: the active queue for this worktree is seeded only with
binding/lookup work. A task belongs in the active queue only if it deletes,
replaces, or proves a bridge around registry lookup, `Rules.find*`, scope
frames, binding handles, callable/declaration/function/property lookup, import
or child-surface lookup facts, or the fallback paths around those systems.
General eval/render, selector, ampersand, node-copy, materialization, and
performance cutting items are parked until binding/lookup work is fully
complete and exhausted, or until the user explicitly redirects this worktree.

## Active Work

Correctness queue: no active lookup correctness blockers. If a `.less` fixture
fails to parse/evaluate in the lookup lane, add a focused repro before changing
expected output. If CSS differs, review semantics manually before changing
tests. The merged selector `writeSyntax` lane is out of scope for this
registryless worktree unless the user explicitly redirects us to serialization;
this branch keeps `Ruleset.getHeaderString(...)` on the older selector string
fallback so lookup tests can run while registryless work continues.

Performance leash:

1. Keep registryless callable lookup as the default path and delete remaining
   registry fallbacks only when focused tests prove direct/frame parity.
2. Use `mixins-guards.less` and `scope-lookup-stress.less` as the immediate
   paired sanity fixtures for callable lookup changes; include
   `import-reference.less` or broader hot-path runs when import/reference
   visibility changes.
3. Treat cache on/off comparisons as regression sanity unless the patch itself
   changes cache behavior. Do not claim speed without a clean before/after
   benchmark for the changed path.
4. Keep a patch only if it removes registry plumbing or measured lookup work
   without broad-fixture regression, improves real runtime cost, or fixes a
   lookup correctness issue.

Immediate benchmark commands are defined in `PERFORMANCE-HANDOFF.md`.
Performance evidence/history stays parked there; this handoff owns the active
binding/lookup work lane and the gates for proving each slice complete. Do not
choose a performance-only pass while any binding/lookup queue item, bridge, or
fallback deletion condition remains.

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
  covered static variable references and static `:=` writes. Registryless
  mixin/callable lookup is now the default for covered string and namespace
  paths, with the former `JESS_LEGACY_MIXIN_LOOKUP` and
  `JESS_DIRECT_CALLABLE_LOOKUP` runtime opt-outs removed. This is not the full
  binding index yet; non-callable registries and explicitly uncovered lookup
  shapes still need separate deletion gates.
- Fallback bridges are temporary debt. Covered simple paths must return hit or
  miss from the binding frame and stop. Only unmodeled cold/complex cases may
  route to old registry/search/materialization paths, and every such bridge
  needs a deletion condition in `BINDING-INDEX-PROPOSAL.md` or this handoff.
- Next binding step: continue the brought-forward binding/index queue below.
  The old manual-frame and fallback-frame bridge targets were completed, but
  the larger original agenda remains: one binding system, production binding
  handles, live/static slot unification, and deletion of declaration/function
  registry bridges as each mode becomes modeled.

## Active Binding Implementation Lane

This lane was the first integration path for `BINDING-INDEX-PROPOSAL.md`.
Its checked state means the first facade/callable/handle-prototype sequence is
complete. It does not mean all lookup/binding work from the proposal is done.

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
   - Completion audit: subsequent registryless callable passes made this
     prototype permanent for covered simple string and namespace paths, deleted
     the legacy callable registry branches, deleted the `MixinRegistry` shim,
     and deleted the generic `Rules.find('mixin', ...)` wrapper. Callable
     output remains uncached, candidate evaluation remains semantic, and
     focused mixin/reference/import tests now exercise the typed
     `findMixin(...)` path directly.

12. [x] Binding handle reuse model.
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
   - `scripts/prototype-binding-handle-reuse.mjs` now models the coherent
     handle contract without production wiring or a separate cache layer: the
     handle carries scope version, original path identity, target scope,
     declaration name, and the binding cell. It explicitly marks evaluated
     value/text reuse as unavailable until static/effect facts exist.
   - Prototype proof: `pnpm run prototype:binding-handle-reuse` passed semantic
     assertions and showed repeated `.a .b .c[color-1]` rediscovery dropping
     from `1,500,000` path segment lookups and `500,000` declaration lookups to
     `3` path segment lookups and `1` declaration lookup for `500,000`
     references. Median time was `12.149ms` for rediscovery vs `3.521ms` for
     handle reuse (`28.99%` ratio). A smaller `50,000` reference run kept the
     signal: `150,000`/`50,000` lookups to `3`/`1`, median `1.145ms` vs
     `0.354ms` (`30.88%` ratio).
   - This completes the handoff queue item as a design/prototype proof only.
     Production expansion still requires a separate implementation lane that
     wires handles into real `Reference`/`Rules` surfaces without output,
     evaluated-value, or public materialization caching.

## Brought-Forward Binding/Lookup Queue

This queue recovers the original binding-index direction after the
registryless callable cleanup stream. Registryless lookup was useful because it
deleted `MixinRegistry`, the `Rules.find('mixin', ...)` dispatch layer, and
several callable fallback/crawl branches. It was not the final architecture.
The target remains one binding system whose covered hot paths return binding
identity or miss without falling through adjacent lookup systems.

This is the sole selectable implementation queue while the Focus Spec is
registryless lookup/binding. Choose the next item from this queue, and if this
queue appears empty, first audit `BINDING-INDEX-PROPOSAL.md` and the remaining
`Rules.find*`/registry/fallback code for binding/lookup bridge work to append
here. The queue is exhausted only when there are no remaining binding/lookup
bridges, registry fallbacks, handle gaps, or modeled lookup deletion conditions
left for this branch.

1. [x] Wire production binding handles into `Reference`/`Rules`.
   Use the prototype contract from `scripts/prototype-binding-handle-reuse.mjs`
   as the proof target: handles carry frame/surface version, original path/key
   identity, target scope, declaration/callable/property identity, and binding
   cell. Do not cache evaluated values, rendered text, mixin output, or public
   materialized nodes. The first production slice should prove repeated
   compound references stop rediscovering the same namespace path and terminal
   declaration/callable identity.

   Completion gate:
   - focused repeated compound-reference fixture proves lookup/path counters or
     monkey-patched probes drop for the covered path
   - invalidation covers scope/frame version changes and dynamic-name promotion
   - no output/value/materialization cache is introduced
   - `pnpm run prototype:binding-handle-reuse` still passes as the model check
   - focused lookup tests and `pnpm run verify:aggressive-cutting-review` pass

   Status:
   - First production slice is wired for static, non-targeted callable
     `Reference` lookups only (`type: mixin` / `mixin-ruleset`) when the key is
     a string or preserved string array, no custom filter is present,
     `leakyRules` is off, and `context.searchScope` is empty.
   - `Reference` now owns a narrow lookup handle carrying target `Rules`,
     target `lookupVersion`, original key identity, lookup type, call-state
     bits, and the resolved lookup result identity. This is not an evaluated
     value cache, rendered-text cache, mixin output cache, or public
     materialization cache.
   - `Rules.lookupVersion` is bumped from `registerNode(...)`, the same edge
     that already invalidates callable/declaration lookup caches. A changed
     target rules surface invalidates the handle and forces rediscovery.
   - Focused proof: a static array-path `mixin-ruleset` reference calls
     `Rules.findMixin(...)` once, reuses the handle on the second eval of the
     same `Reference`, then calls `findMixin(...)` again after the target
     `Rules` is mutated and `lookupVersion` changes.
   - Static function references now reuse the same `Reference` lookup handle
     for covered non-targeted, unfiltered string-key function lookups. A
     focused test proves the second eval skips `Rules.findFunction(...)`, and a
     later target `Rules.lookupVersion` change invalidates the handle.
   - Static declaration/property references now reuse the same `Reference`
     lookup handle for covered non-targeted, unfiltered string-key lookups. The
     handle carries the contextual lookup shape (`start`, `local`, and
     `ignoreParentScopeStart`) so source-order-sensitive references do not
     reuse a result across a different lookup boundary.
   - Remaining handle work: semantic filtered property merge-chain lookup,
     complex declaration modes, and callable namespace/import/child-surface
     facts still need to move into frame/handle state.

2. [x] Collapse live-slot and static-declaration lookup into one slot/record
   path.
   `ScopeFrame.currentBindingsByName` is now the ordinary current-read surface
   for both live cells and the latest static declaration entry. Source-order
   `$!`/snapshot reads still use `declarationBucketsByName` because they need
   ordered history, but plain current reads no longer branch through
   `liveSlotsByName` first and static buckets second. Live-slot creation and
   declaration registration/promotion publish the current entry at the same
   edge that creates the binding.

   Completion gate:
   - Done: current reads, `$!`/source-order reads, mixin params, `@arguments`,
     loop vars, `:` shadowing, and `:=` assignment pass the focused
     `scope-frame`, `reference`, `mixin`, `control`, and `import-style` tests.
   - Done for covered ordinary reads: covered current hits are returned from
     `lookupScopeFrameVariable(...)` through `currentBindingsByName` without a
     post-miss `lookupRuntimeVarBinding(...)` live-slot bridge.
   - Done: ordinary current reads do not allocate a per-read declaration entry;
     static current entries reuse the existing bucket `BindingEntry`, and live
     entries are published when the live cell is created.
   - Done: benchmark/profile leash is recorded as status only; no speed claim
     is made for this pass.

3. [x] Delete or narrow `lookupRuntimeVarBinding(...)`.
   Deleted. The bespoke live-slot/fallback walker is gone from
   `Reference`; target/interpolated/index shapes that still need a live-only
   fallback now call the same `lookupScopeFrameVariable(...)` facade with
   `includeDeclarations: false`, so live cells are read through
   `ScopeFrame.currentBindingsByName` instead of a separate
   `liveSlotsByName` chain crawl.

   Completion gate:
   - Done: no `lookupRuntimeVarBinding(...)` call sites remain. The remaining
     live-only facade adapter is limited to non-snapshot target/interpolated
     variable fallback and unquoted index fallback before declaration/property
     lookup.
   - Done: covered static variable reads still return through
     `lookupScopeFrameVariableBinding(...)`; live-only fallback is reached only
     after the covered facade path declines the shape.
   - Done: fallback-frame behavior remains covered by focused
     mixin/default-param/detached-ruleset/import tests.

4. [x] Replace declaration/property registry bridges by mode.
   First selected mode complete: `Rules.findDeclaration(...,
   'VarDeclaration', ...)` now uses the selected variable declaration operation
   by default, falling back to
   `DeclarationRegistry` only when the direct path returns explicit
   `UNCOVERED` for unsupported option shapes. The old env-gated
   declaration-direct experiment is deleted; `Rules.findVariable(...)` is a
   typed variable lane rather than a wrapper over
   `findDeclaration(..., 'VarDeclaration')`. Unsupported
   declaration/property modes remain explicit `UNCOVERED` bridges instead of a
   global switch.

   Completion gate:
   - Done: selected mode is `VarDeclaration`; focused hit/miss/import/reference
     and source-order tests pass, plus declaration merge tests prove property
     modes were not accidentally switched.
   - Done: covered `findDeclaration(..., 'VarDeclaration', ...)` hits avoid
     opening `DeclarationRegistry`; existing reference/import/mixin tests
     continue to prove hot variable lookups avoid registry fallback.
   - Done: no new traversal is added; the pass removes the env-only condition
     for an existing direct lookup path and keeps unsupported modes gated.
   - Done: the bridge ledger in `BINDING-INDEX-PROPOSAL.md` is updated for the
     selected mode and the remaining declaration/property modes.

4a. [x] Replace remaining unfiltered declaration/property registry bridges.
   Unfiltered exact `Declaration`/property lookup now uses
   the selected property declaration operation by default, so `findProperty(...)`
   and normal property `Reference` covered hits/misses no longer open
   `DeclarationRegistry`. Lookup options distinguish default context/search
   filters from semantic filters, so assignment merge filters still return
   explicit `UNCOVERED` from the direct helper and remain registry-owned.

   Completion gate:
   - Done: unfiltered exact property hits, misses, and normal property
     references avoid opening `DeclarationRegistry`.
   - Done: declaration/reference/import focused tests pass with the direct
     property path enabled by default.
   - Done: the old `JESS_DIRECT_DECLARATION_LOOKUP` switch has since been
     deleted; semantic filtered merge-chain lookups still decline the direct
     path instead of duplicating merge-chain inputs.

4b. [x] Model filtered declaration/property merge-chain lookups.
   Assignment-normalization filters (`+:`, `+,:`, `+_:`) still need
   pre-normalization declaration occurrence/source-order facts before they can
   leave `DeclarationRegistry`. This pass explicitly keeps semantic filtered
   property lookups on the uncovered path instead of forcing them through the
   ordinary direct declaration bucket, because that bucket scans the current
   `Rules.value` surface after assignment normalization/coalescing.

   Completion gate:
   - Done: a direct-registration bucket prototype was rejected. Populating
     `directDeclarationsByName` from `register('declaration', ...)` polluted
     evaluated/wrapper scopes where that map means "current value array has
     been scanned"; forced direct semantic lookup then dropped/duplicated
     merge-chain inputs and produced property reference misses.
   - Done: focused declaration/reference tests prove the safe boundary remains:
     unfiltered property lookup is direct, while semantic merge filters return
     explicit `UNCOVERED`.
   - Done: deletion condition recorded in `BINDING-INDEX-PROPOSAL.md`: filtered
     property merges can leave `DeclarationRegistry` only after the binding
     frame owns property declaration occurrence slots/merge-anchor facts, not
     through another name-index side map.

5. [x] Bring function lookup into the same binding model.
   Simple exact-name function lookup now uses `Rules.functionsByName` binding
   records. `Rules.register('function', ...)`, stylesheet `Func` indexing, and
   Less-compat plugin registration all publish into that map.
   `Rules.findFunction(...)` returns direct hits/misses for all current option
   shapes without opening any registry lookup.

   Completion gate:
   - Done: function hits, misses, option-shaped lookups, and cloned function
     maps do not open `Rules.getRegistry(...)`; focused tests monkeypatch the
     registry entry and count zero calls.
   - Done: no callable output/evaluated value cache is added; the binding map
     stores source `JsFunction`/`Func` nodes only.
   - Done: parent/import-boundary traversal follows the old registry walk
     while reading `functionsByName` directly. The core `FunctionRegistry`
     class and `Rules.getRegistry('function')` overload are deleted; Less-style
     `functionRegistry` APIs live only in the Less-compat mock adapter and
     bridge to `Rules.setFunctionBinding(...)` / `Rules.findFunction(...)`.

5a. [x] Delete remaining core function registry compatibility surface.
   Deleted. Core no longer exports or allocates `FunctionRegistry`, no longer
   has a `Rules.functionRegistry` field, and no longer accepts
   `getRegistry('function')`. Less-compat still presents a Less-shaped mock
   registry to Less plugins, but both global and scoped plugin registration
   write/read `Rules` function bindings directly.

5b. [x] Reuse binding handles for static function references.
   Covered static, non-targeted, unfiltered string-key function references now
   use the existing `Reference` lookup handle. The handle stores function
   lookup identity only: target `Rules`, `lookupVersion`, key identity,
   lookup type, call-state bits, and returned source function/declaration
   identity. It does not cache evaluated values, rendered text, function
   output, or public materialized nodes.

   Completion gate:
   - Done: repeated static function `Reference` eval calls
     `Rules.findFunction(...)` once, reuses the handle on the second eval, then
     calls `findFunction(...)` again after the target `Rules.lookupVersion`
     changes.
   - Done: the cut widens the existing handle only for non-contextual function
     lookup; declaration/property handles remain queued until contextual-start
     facts are part of the handle key.

5c. [x] Reuse binding handles for covered static declaration/property
    references.
   Covered static, non-targeted, unfiltered string-key `declaration` and
   `property` references now use the existing `Reference` lookup handle. Unlike
   callable/function handles, this handle records the contextual lookup shape:
   `start`, `local`, and `ignoreParentScopeStart`. It still stores lookup
   identity only; it does not cache evaluated values, rendered text,
   declaration output, merge-chain output, or public materialized nodes.

   Completion gate:
   - Done: repeated static property `Reference` eval calls
     `Rules.findProperty(...)` once, reuses the handle on the second eval, then
     calls `findProperty(...)` again after the target `Rules.lookupVersion`
     changes.
   - Done: repeated static declaration `Reference` eval calls
     `Rules.findDeclaration(...)` once, reuses the handle on the second eval,
     then calls `findDeclaration(...)` again after the target
     `Rules.lookupVersion` changes.
   - Done: semantic filtered property merge-chain lookup remains excluded
     through the existing `semanticFilter` guard; complex declaration modes
     stay on the bridge ledger until modeled by frame occurrence slots.

6. [x] Model remaining callable namespace/import/child-surface facts as
   frame/handle facts.
   Covered simple callable lookup is registryless, and child-surface facts now
   distinguish exact callable surfaces from mixin-capable child surfaces.
   Terminal mixin-only lookup no longer keeps the child-surface bridge alive for
   ruleset-only child surfaces, and exact ruleset terminal scans are skipped
   after namespace resolution when args require a mixin terminal.

   Completion gate:
   - Done: simple exact names do not crawl child surfaces unless the carried
     frame/Rules fact says a child/import surface can contain callable hits.
   - Done: terminal parameterized mixin-ruleset calls search only
     callable-compatible terminal records after namespace resolution.
   - Done: focused guard, import-reference, namespace, and stress-oriented
     callable fixtures pass.

6a. [x] Narrow no-frame direct callable child-surface bridge for mixin-only
    misses.
   `findMixinsFast(...)` now uses the carried mixin-only child-surface fact
   when `includeRulesets` is false. Direct mixin-only lookup without a
   prebuilt scope frame skips child surfaces whose descendants can only contain
   ruleset terminals, instead of using the broader exact-callable surface fact
   and recursing anyway.

   Completion gate:
   - Done: focused no-frame test proves a terminal mixin-only miss does not
     enter the child bridge for a ruleset-only child surface.
   - Done: existing frame-based terminal mixin-only miss tests still pass.
   - Done: namespace and parameterized mixin-ruleset tests still pass, proving
     rulesets remain valid namespace containers where required.
   - Done: broader callable/reference/import/call suite passes after rerun
     without a concurrent build cleaning package artifacts.

6b. [x] Narrow ruleset-path child-surface recursion for ruleset-capable
    children only.
   Exact and prefix ruleset-path lookup now use a carried
   `hasExactRulesetChildSurface` fact instead of the broader exact-callable
   child-surface fact. A child scope that can only contain mixin terminals no
   longer keeps ruleset-path child recursion alive or forces child-entry
   collection on a ruleset-path miss.

   Completion gate:
   - Done: focused no-frame test proves a ruleset-path miss does not read a
     mixin-only child `Rules.value` surface.
   - Done: existing frame terminal-mixin-only, namespace, and parameterized
     mixin-ruleset tests still pass.
   - Done: this is a traversal/work deletion claim only; no speed claim is made
     without a clean before/after benchmark.

7. [x] Refresh the binding proposal after each bridge deletion.
   `BINDING-INDEX-PROPOSAL.md` is the contract for which fallback bridges are
   still tolerated. Every production bridge left behind must name its allowed
   scope and deletion condition there or in this handoff.

7a. [x] Delete generic declaration/function `Rules.find(...)` dispatch.
    The cold string-dispatch wrapper for declaration/function lookup is gone.
    Internal callers and tests use typed methods/direct helpers:
    `findDeclaration(...)`, `findProperty(...)`, `findFunction(...)`, and
    direct declaration lookup where the mode is already covered. `Rules.findVariable(...)`
    is accepted only as the typed variable lane described in `7i`, not as a
    wrapper over string-discriminator declaration lookup. The remaining
    declaration/function bridge debt is now the registry fallback inside typed
    methods, not an extra public-ish dispatch layer above them.

    Completion gate:
    - Done: no production or test caller uses `find('declaration', ...)` or
      `find('function', ...)`.
    - Done: the remaining child-registry bridge uses typed
      `findMixin(...)`/`findDeclaration(...)` dispatch for the already-selected
      lookup family.
    - Done: focused lookup/reference/call/import tests and touched-file eslint
      pass before the full gate run.

7b. [x] Stop declaration lookup from reading `liveSlotsByName` as a parallel
    lookup surface.
    Direct declaration lookup and the old declaration-registry fallback now
    read live declaration-shaped cells through
    `ScopeFrame.currentBindingsByName`. `liveSlotsByName` remains runtime
    storage/construction input for live cells, but declaration lookup no longer
    treats it as a second lookup map beside the unified current binding layer.

    Completion gate:
    - Done: direct variable declaration lookup and `DeclarationRegistry.find(...)`
      read `currentBindingsByName.get(key)` for live `VarDeclaration` cells.
    - Done: focused tests make `liveSlotsByName.get` throw and prove both
      direct `findDeclaration(..., 'VarDeclaration', ...)` and registry
      fallback lookup still resolve via current bindings.
    - Done: focused `scope-frame`, `reference`, `import-style`, and `mixin`
      lookup suites pass.

7c. [x] Carry declaration child-surface entries on `Rules` instead of
    rediscovering them inside direct lookup.
   Direct declaration lookup no longer owns a private child-rules scan. `Rules`
   now carries declaration child entries alongside callable child entries during
   registration, including mixin body rules that declaration lookup can enter
   through the existing mixin-output visibility gate. Typed direct declaration
   lookup reads that carried surface or asks `Rules` to populate it once.

   Completion gate:
   - Done: deleted the direct declaration walker's local child-rules scanner
     and default visibility clone.
   - Done: focused test proves a warmed, fully indexed parent can resolve a
     nested property through carried child entries without reading the parent's
     `value` array again.
   - Done: focused declaration/property/import/mixin/scope suites pass.

7d. [x] Stop registry recursion bookkeeping from forcing covered declaration
    lookup back to `DeclarationRegistry`.
   Typed direct declaration lookup now treats `searchedRules` as old registry loop
   bookkeeping, not an unsupported lookup mode. The direct walker already owns
   a per-call visited set, so covered exact variable/property hits and misses
   can remain on the direct path even when a caller carries `searchedRules`.

   Completion gate:
   - Done: focused variable and property tests pass `searchedRules` while
     proving `Rules.getRegistry('declaration')` is not opened.
   - Done: direct lookup caching remains disabled for `searchedRules` shapes;
     this pass only deletes the registry fallback, not loop-state caching.

7e. [x] Keep empty registry candidate bookkeeping on the direct declaration
    path.
   Typed direct declaration lookup still treats non-empty `candidates` or
   `optionalCandidates` as old registry comparison state and returns
   `UNCOVERED`, but empty candidate sets no longer force covered exact
   variable/property lookup into `DeclarationRegistry`.

   Completion gate:
   - Done: focused variable and property tests pass empty candidate sets while
     proving `Rules.getRegistry('declaration')` is not opened.
   - Done: non-empty candidate sets remain excluded from the direct path.

7f. [x] Delete stale direct-declaration env experiment.
   The runtime no longer checks `JESS_DIRECT_DECLARATION_LOOKUP` inside
   `Rules.findDeclaration(...)`. Covered `VarDeclaration` and unfiltered
   `Declaration`/property lookup are production defaults; semantic filtered
   declaration/property lookup remains registry-owned until merge-chain
   occurrence facts are modeled. The obsolete prototype script that only
   compared the env switch was removed.

   Completion gate:
   - Done: no runtime code reads `JESS_DIRECT_DECLARATION_LOOKUP`.
   - Done: focused tests prove covered direct variable/property modes still
     avoid `DeclarationRegistry`.
   - Done: focused test sets the stale env var and proves semantic filtered
     property lookup still enters the registry-owned bridge.
   - Done: no semantic filtered declaration/property lookup was forced direct.

7g. [x] Move `Reference` variable fallback off `_rulesSet`.
   The remaining `Reference` variable fallback (`findVarDeclarationFast(...)`)
   no longer reads registry-shaped `_rulesSet` child storage. It uses the same
   carried `Rules.directDeclarationChildEntries` / `collectDirectDeclarationChildEntries()`
   layer as direct declaration lookup. `_rulesSet` remains only in old
   declaration-registry utility code and `Rules` registration internals.

   Completion gate:
   - Done: no `Reference` production code reads `_rulesSet` or `rulesSet`.
   - Done: focused explicit-target variable reference proves the fallback can
     resolve a child-surface variable after `_rulesSet` is poisoned.
   - Done: direct index/target, fallback-frame, property direct, semantic
     filtered bridge, and nested static variable focused tests still pass.

7h. [x] Route covered `Reference` declaration/property reads directly.
   Static `Reference` declaration, property, index-declaration, direct-rules
   target, and function-fallback declaration lookups now call
   the selected direct declaration operation before falling back to
   `Rules.findDeclaration(...)`.
   Covered reference reads skip the typed `Rules.findProperty(...)` /
   `Rules.findDeclaration(...)` method layer entirely; semantic filtered and
   otherwise unsupported shapes still return `UNCOVERED` and use the existing
   declaration bridge.

   Completion gate:
   - Done: focused static property/declaration reference tests prove covered
     reads do not call `Rules.findProperty(...)` or `Rules.findDeclaration(...)`
     before or after handle invalidation.
   - Done: semantic filtered property lookup remains registry-owned.
   - Done: focused variable/property/direct fallback tests still pass.

7i. [x] Reshape declaration lookup lanes away from string branching.
   `Rules.findVariable(...)` is restored as a real typed variable lookup lane,
   not a wrapper over `findDeclaration(..., 'VarDeclaration')`.
   `Rules.findProperty(...)`, `Rules.findDeclaration(...)`, `Reference`, and
   selector-attribute interpolation now assign the direct lookup operation for
   the path and call it, while the direct declaration walker receives a
   preselected strategy object instead of a string discriminator.

   Completion gate:
   - Done: `findVariable(...)` focused test proves it does not call
     `findDeclaration(..., 'VarDeclaration')`.
   - Done: focused selector-attribute test proves covered raw `@{attr-data}`
     interpolation does not call the `findVariable(...)` fallback lane.
   - Done: direct `VarDeclaration` tests now cover
     `findDeclaration(..., 'VarDeclaration')` and `findVariable(...)`.

7j. [x] Delete the leftover `findDeclarationDirect(...)` string adapter.
   After `7i`, the direct declaration utility only exposes typed direct
   operations: variable, property, and any-declaration. The unused
   `findDeclarationDirect(...)` adapter that switched on `'VarDeclaration'` /
   `'Declaration'` was deleted, so the string discriminator remains only at the
   cold `Rules.findDeclaration(...)` API boundary.

   Completion gate:
   - Done: `rg` finds no production `findDeclarationDirect(...)` call sites.
   - Done: focused and expanded binding/selector tests pass.

7k. [x] Split `Reference` declaration fallback by selected typed lane.
   `Reference` no longer routes property, index, declaration, direct-rules
   target, or function-fallback declaration lookup through one helper carrying
   `'VarDeclaration'` / `'Declaration'` / `undefined`. Each path now calls the
   selected direct declaration operation first, then the typed fallback method
   for that lane: `findVariable(...)`, `findProperty(...)`, or the remaining
   cold `findDeclaration(..., undefined, ...)` boundary for any-declaration
   lookup.

   Completion gate:
   - Done: production `Reference` has no
     `lookupDeclarationDirectOrFind(...)`, `getIndexReferenceFilterType(...)`,
     or `getDirectRulesIndexFilterType(...)` helpers.
   - Done: focused tests prove plain index references and direct `Rules` index
     targets do not call generic `Rules.findDeclaration(...)` for already
     selected variable/property keys.

7l. [x] Route `setDefined` assignment lookup through typed declaration lanes.
   `Rules.evalNode(...)` no longer normalizes `node.type` back into a
   declaration-filter string before assignment. `VarDeclaration` assignments
   call `findVariable(...)`; property declarations call `findProperty(...)`.

   Completion gate:
   - Done: no production caller uses
     `findDeclaration(key, normalizeDeclarationFilter(node.type), opts)`.
   - Done: focused `setDefined`/scope tests still pass.

7m. [x] Stop child-registry declaration recursion from string-dispatching
    selected declaration modes.
   The remaining declaration-registry child-recursion bridge now calls
   `findVariable(...)` or `findProperty(...)` when
   `actualChildFilterType` has already selected that mode. The generic
   `findDeclaration(..., undefined, ...)` fallback remains only for the
   unfiltered any-declaration bridge.

   Completion gate:
   - Done: production `registry-utils` no longer calls
     `findDeclaration(...)` with `actualChildFilterType`.
   - Done: focused import/reference/rules/detached-ruleset lookup tests pass.

Seeded next binding/lookup queue:

7n. [x] Audit remaining production `Rules.findDeclaration(...)` callers and
    classify each as cold any-declaration boundary, semantic-filter bridge, or
    removable typed-lane caller.
   Remaining production callers after this pass:
   - `Reference.lookupAnyDeclarationOrFind(...)` uses
     `findDeclaration(..., undefined, ...)` for the explicit any-declaration
     reference lane.
   - `Registry._searchRulesChildren(...)` uses
     `findDeclaration(..., undefined, ...)` only when child recursion is also
     any-declaration/unfiltered.
   - `Rules.findDeclaration(...)` itself is now the typed cold boundary for
     `VarDeclaration`, `Declaration`, or any-declaration lookup.
   No production caller still asks for variable/property lookup through a
   generic string-dispatch helper.

7o. [x] Move helper/test call sites that still express variable/property
    lookup through `findDeclaration(..., 'VarDeclaration'|'Declaration')` onto
    typed lanes where the test is not explicitly exercising the cold boundary.
   Rules/import/detached-ruleset helper lookups now call `findVariable(...)` or
   `findProperty(...)`. Reference tests that were asserting variable direct
   option behavior now call `findVariable(...)`. The remaining literal
   `findDeclaration(..., 'VarDeclaration')` test is intentionally named
   boundary coverage for `Rules.findDeclaration(...)` itself; the remaining
   `findDeclaration(..., undefined)` test covers source-order any-declaration
   behavior.

7p. [x] Narrow or delete the remaining `normalizeDeclarationFilter(...)`
    boundary if no production caller needs arbitrary string filters after
    `7n`.
   Deleted. `Rules.findDeclaration(...)` now accepts only
   `'VarDeclaration' | 'Declaration' | undefined` and no longer normalizes
   arbitrary strings at runtime.

7q. [x] Audit `findVarDeclarationFast(...)` against the direct variable
    declaration walker and either merge the duplicate walk or document the
    concrete remaining reason it differs.
   Do not merge it blindly. `findVarDeclarationFast(...)` still covers
   `Reference`'s variable fallback after the scope-frame facade declines:
   explicit targets, interpolated variables, non-snapshot start constraints,
   fallback-frame chains, custom reference filters, import-boundary handling,
   and child-surface visibility. The direct declaration walker shares several
   facts but does not yet own fallback-frame traversal or the exact
   `Reference` fallback semantics. Next implementation should move those facts
   into the direct variable declaration walker, then delete
   `findVarDeclarationFast(...)` instead of keeping two recursive walkers.

7r. [x] Audit declaration lookup options that still force `UNCOVERED`
    (`filter`, non-empty candidate sets, semantic filters) and split them into
    frame-owned occurrence facts versus truly cold registry compatibility.
   Direct declaration lookup handles filters but disables recursive caching when
   a filter is present. Empty `candidates` / `optionalCandidates` are covered;
   non-empty sets still represent registry comparison/accumulation state and
   force `UNCOVERED`. `semanticFilter` remains uncovered for property and
   any-declaration lookup because merge-chain semantics need
   pre-normalization/source-order occurrence facts.

7s. [x] Model property merge-chain occurrence slots enough to remove the
    semantic filtered property bridge, or record the exact source-order fact
    still missing before implementation.
   Not implemented in this pass. Required fact is now explicit:
   property merge-chain lookup needs frame-owned declaration occurrence slots
   that preserve pre-normalization assignment entries, merge anchors, optional
   visibility, readonly propagation, and source-order comparison. Without that
   fact, semantic filtered property lookup must stay on the registry bridge.

7t. [x] Audit remaining `_rulesSet` reads/writes and separate unavoidable
    legacy registry construction from lookup-time recursion debt.
   Production `Reference` no longer reads `_rulesSet`. Remaining production
   uses are old registry construction/reset in `Rules` and old registry child
   recursion in `Registry._searchRulesChildren(...)`. That is lookup-time
   recursion debt, but it is isolated to the legacy registry bridge and should
   be deleted by replacing the bridge with carried `directDeclarationChildEntries`
   / frame occurrence facts, not by adding another side registry.

7u. [x] Re-run the binding-focused grep suite after each pass and reseed this
    queue before commit; do not continue into parked cutting/performance work
    while any item above remains unchecked.

Seeded next binding/lookup queue:

7v. [x] Move fallback-frame traversal and explicit-target/reference-filter
    semantics into the direct variable declaration walker, then delete
    `findVarDeclarationFast(...)`.
   The old `Reference`-local `findVarDeclarationFast(...)`,
   `selectVarBucketCandidate(...)`, and `laterVarMatch(...)` helpers are gone.
   Variable references now use `findVariableDeclaration(...)` directly with the
   reference filter, explicit-target bit, current-scope Less start relaxation,
   parent-scope start relaxation, fallback-frame traversal, and scope-frame
   live binding semantics modeled in `direct-rules-lookup.ts`. The direct
   walker keeps separate local-declaration and child-surface start boundaries
   so later same-scope Less variables remain visible while later child surfaces
   do not leak backward. Live variable lookup no longer uses the recursive
   declaration cache. Configured import variable frames preserve existing
   fallback frames during live-slot rebuilds. Generic any-declaration lookup is
   not on the live-binding lane; use `findVariable(...)` for live variables.

7w. [x] Replace `Registry._searchRulesChildren(...)` declaration recursion with
    carried `directDeclarationChildEntries`/frame facts so declaration lookup no
    longer reads `_rulesSet` during search.
   Declaration-family child recursion in the remaining
   `DeclarationRegistry.find(...)` bridge now iterates
   `collectDirectDeclarationChildEntries()` instead of `Rules.rulesSet`.
   Focused coverage poisons `_rulesSet` while resolving a semantic-filtered
   child property and still resolves through carried direct child entries.
   `_rulesSet` remains for mixin lookup and the `Rules.rulesSet` public-ish
   child surface until `7z`.
7x. [x] Model non-empty declaration candidate/optional-candidate accumulation
    as direct lookup match state, then remove that `UNCOVERED` gate.
   Direct declaration lookup now seeds public/optional matches from provided
   candidate sets and appends direct local/child matches back into the caller's
   candidate sets. Non-empty declaration candidate sets no longer force the
   direct walker into `UNCOVERED`. `findAll` remains an explicit uncovered
   shape because the direct result model returns one winner, not all matches;
   live production grep still shows `findAll` only in callable test coverage,
   not production declaration lookup.
7y. [x] Add property occurrence slots for pre-normalized merge-chain
    declarations and remove the semantic-filtered property registry bridge.
   The property lane now treats semantic filters as covered by the same direct
   declaration walker; merge-chain filters are ordinary predicates over direct
   candidates. Focused declaration/reference merge tests and Less property
   merge coverage pass, so `Rules.findProperty(...)`,
   `Rules.findDeclaration(..., 'Declaration', ...)`, and property references
   no longer route semantic-filtered property lookup through
   `DeclarationRegistry.find(...)`.
7z. [x] Delete or quarantine `Rules.rulesSet` / `_rulesSet` once child
    declaration and callable registry bridges no longer require it.
   Production `Rules.rulesSet` / `_rulesSet` storage is deleted. Child callable
   recursion in the remaining registry bridge now reads
   `collectDirectChildRulesEntries()`, declaration-family recursion reads
   `collectDirectDeclarationChildEntries()`, and `registerNode(...)` writes only
   those carried child-entry surfaces. Readonly import shadow checks no longer
   force declaration registries open; they scan the carried readonly child
   entries and direct current/imported variable declarations.

7aa. [x] Audit `DeclarationRegistry.find(...)` remaining callers after `7v-7z`
    and collapse it to a test-only or deleted path if no production lookup uses
    it.
   Audit complete, deletion blocked by real production any-declaration/order
   bridges. `Reference.lookupAnyDeclarationOrFind(...)` still calls
   `Rules.findDeclaration(key, undefined, opts)` after direct any-declaration
   lookup declines. `Registry._searchRulesChildren(...)` still uses the
   remaining any-declaration `findDeclaration(..., undefined, ...)` child lane.
   `Rules.findDeclaration(...)` still owns the final
   `DeclarationRegistry.find(...)` fallback for uncovered any-declaration and
   `findAll` shapes. Typed `findVariable(...)` and `findProperty(...)` no
   longer fall back to `DeclarationRegistry.find(...)` when their direct lanes
   decline.

Seeded next binding/lookup queue:

7ab. [x] Model direct any-declaration ordering well enough to delete
    `Reference.lookupAnyDeclarationOrFind(...)` fallback to
    `Rules.findDeclaration(..., undefined, ...)`.
   Direct any-declaration lookup now covers semantic-filtered declaration
   references and the `Reference` helper returns the direct result/miss without
   bouncing into `Rules.findDeclaration(...)`. The ordering fix was not a side
   registry: contextual property/declaration reads preserve parent source
   boundaries, and the direct parent step no longer erases an existing start
   boundary when generated mixin/call output lacks its own containing index.

7ac. [x] Replace any-declaration child recursion in
    `Registry._searchRulesChildren(...)` with a direct typed result path or
    delete the any-declaration child lane if no production caller needs it.
   Deleted with `DeclarationRegistry`: any-declaration child lookup is now the
   direct declaration walker over carried child-entry surfaces. There is no
   `Registry._searchRulesChildren(...)` declaration lane left to recurse into
   children and then back into parents.

7ad. [x] Decide whether declaration `findAll` is production semantics or
    test-only/callable-only residue; then either model direct all-results or
    remove it from declaration lookup options before deleting
    `DeclarationRegistry.find(...)`.
   Production grep shows declaration lookup has no `findAll: true` caller; the
   remaining `findAll` option is shared option surface used by callable tests.
   Direct declaration lookup still declines `findAll`, and with no declaration
   registry fallback that cold shape returns miss instead of preserving dead
   declaration all-results behavior.

7ae. [x] After `7ab-7ad`, delete `declarationRegistry`,
    `_ensureDeclarationRegistry()`, `getRegistry('declaration')`, declaration
    `register(...)`, and `DeclarationRegistry` if production grep shows no
    lookup caller remains.
   Deleted. `Rules` keeps only function binding registration, production grep
   finds no `declarationRegistry`, `_ensureDeclarationRegistry`,
   `getRegistry(...)`, `register('declaration', ...)`, `DeclarationRegistry`,
   generic `Registry`, or `JESS_TRACE_DIRECT_DECL` debug hook in core source.

Seeded next binding/lookup queue:

7af. [x] Audit stale declaration-registry wording and test names that now refer
    to old registry concepts after the production deletion. This is docs/test
    cleanup only unless it reveals a live bridge.
   Done. Current lookup tests no longer describe declaration-registry fallback
   or registry bookkeeping as active behavior, and the dead `getRegistry`
   monkeypatch tripwires were deleted from function lookup tests. Historical
   completed handoff entries still mention the deleted registry machinery as
   history.

7ag. [x] Revisit `DeclarationFindOptions.findAll`: split callable-only option
    shape from declaration lookup if TypeScript/API clarity is worth the churn,
    but do not reintroduce all-results declaration storage.
   Done. `findAll` now lives on callable/general `FindOptions`, not
   `DeclarationFindOptions`, and direct declaration lookup no longer branches
   on it. The stale `searchedRules` option field was also deleted after grep
   proved no source reads or writes it.

7ah. [x] Audit remaining `registrylessLastMixinLookup*` one-entry cache and
    callable cache naming/shape after declaration registry deletion; keep only
    if measured or code-path evidence says it removes more work than it adds.
   Done. The cache remains a single-entry callable lookup memo only for
   cacheable un-targeted, non-local, non-current-context lookups; it is
   invalidated on clone/reset and node registration. The prototype-era
   `registrylessLastMixinLookup*` names are now `lastCallableLookup*`, with
   matching callable cache key helpers and constants.

Seeded next binding/lookup queue:

7ai. [x] Rename or split `registry-utils.ts` now that it contains lookup
    traversal helpers and option types, not registries. Keep the cut import-only
    unless code inspection shows dead helper surface.
   Done. The file is now `lookup-utils.ts`; all source/test imports were
   updated, and the stale `FindOptions` alias was deleted.

7aj. [x] Audit `FindOptions` versus `DeclarationFindOptions` after the
    `findAll` split; move callable-only fields out of declaration-facing
    callsites where TypeScript can enforce it without adding wrapper helpers.
   Done. Lookup options are now split into `DeclarationFindOptions`,
   `CallableFindOptions`, and `ReferenceFindOptions`. Declaration-only helpers
   and tests use declaration options; callable methods use callable options;
   `Reference` uses the explicit mixed shape because it passes one object
   through both lanes.

7ak. [x] Audit direct function binding names/comments (`register('function')`,
    `setFunctionBinding`, function compat wording) and delete any stale registry
    compatibility scaffolding that is not required for Less plugin behavior.
   Done. Function clone comments and `register('function')` errors now describe
   function bindings, not registries. The single-type `register('function')`
   implementation no longer has a switch/registry branch; Less plugin
   function binding behavior remains.

7al. [x] Inspect `Rules.findDeclaration(...)` string-dispatch shape after typed
    `findVariable(...)` / `findProperty(...)` / any-declaration helpers; delete
    or narrow generic branches if production callers no longer need them.
   Done. Production grep finds no generic `findDeclaration(...)` caller outside
   focused tests. The implementation now narrows directly to the three declared
   lanes without assigning a dynamic lookup function.

7am. [x] Audit callable lookup cache invalidation against live binding updates
    and scope-frame callable buckets; keep the one-entry cache only if it cannot
    return stale results across mixin-param/live-binding mutation paths.
   Done. Live binding updates mutate `liveSlotsByName` /
   `currentBindingsByName`, not callable buckets. Callable buckets are derived
   from static mixin/ruleset entries and are invalidated on `registerNode(...)`
   with `callableLookupCache`, `ScopeFrame.callableBucketsByName`, and
   `lastCallableLookup*`; no extra invalidation layer was added.

7an. [x] Audit direct declaration lookup cache keys now that variable lookup
    skips the recursive cache; remove cache key dimensions or helper surface
    that no longer correspond to reachable declaration lookup modes.
   Done. No cache-key dimension was removed: `strategy.cacheTag` still
   separates property/any-declaration semantics, `local` changes child-scope
   admission, and `hasTarget` changes visibility/admission. Variable lookup is
   still excluded by `strategy.includeLiveBindings`.

7ao. [x] Audit remaining public-looking `register('function')` callsites in
    tests/helpers; where a test is not specifically about plugin-style function
    registration, switch to `setFunctionBinding(...)` or a narrower helper.
   Done. The direct function-binding tests now use `setFunctionBinding(...)`,
   and production `registerNode(Func)` writes the function binding directly.
   Remaining `register('function')` callsites are plugin/function-library
   fixture setup or external package plugin adapters, not core lookup fallback
   paths.

7ap. [x] Audit `Rules.findDeclaration(...)` as a test-supported legacy helper:
    either add explicit overload tests for any-declaration semantics or delete
    the generic test-only caller if typed finders cover the behavior.
   Done. The only `findDeclaration(key, undefined, ...)` caller is the
   `rules.test.ts` any-declaration helper, and the existing test
   `find(declaration, key, undefined) picks VarDeclaration or Declaration by
   source order` explicitly covers that boundary. No production fallback caller
   remains.

7aq. [x] Inspect `ReferenceFindOptions` callsites for mutation (`opts.start`,
    `opts.local`, `opts.context`) and split construction so declaration and
    callable lanes do not carry irrelevant fields when avoidable without
    wrappers.
   Done. Production reference option construction now computes local/start bits
   as locals and returns one object without mutating `opts`. The remaining
   test helpers that mutated lookup option arguments in `rules.test.ts` and
   `import-style.test.ts` now pass merged option literals instead.

7ar. [x] Audit `directDeclarationsByName` / `directDeclarationLookupCache`
    invalidation against dynamic declaration-name promotion and `setDefined`
    writes; delete cache usage if the next focused tests can prove it is too
    broad or redundant.
   Done. `registerNode(...)` already clears direct declaration buckets/cache
   for `setDefined` writes. Dynamic declaration-name promotion now clears
   `directDeclarationsByName`, `directDeclarationLookupCache`, and increments
   `lookupVersion`; a focused reference test warms a stale direct declaration
   cache before promotion and proves promotion clears that cache while the
   scope frame carries the promoted `x` binding.

7as. [x] Audit callable cache key construction for array path keys; avoid
    rebuilding a compound path string when an existing normalized key can be
    carried from reference/call preparation.
   Done as an audit. No existing normalized array path key is carried from
   reference/call preparation today; the array path cache key is joined once at
   the `findMixin(string[])` boundary, while string lookups stay string-only.
   The next queue carries the real cut forward as explicit key propagation
   rather than hiding a new helper layer in this pass.

Seeded next binding/lookup queue:

7at. [ ] Replace external package plugin adapters that still call
    `register('function', ...)` with `setFunctionBinding(...)` so function
    registration no longer looks registry-shaped outside core tests.

7au. [ ] Split the remaining `rules.test.ts` any-declaration helper into a
    named `findAnyDeclaration`-style local helper or production method, then
    decide whether `findDeclaration(key, undefined, ...)` should be deleted or
    kept as the single cold boundary.

7av. [ ] Split `ReferenceFindOptions` at the final dispatch point so
    declaration lookup receives only declaration fields and callable lookup
    receives only callable fields; reject the cut if it adds wrapper churn on
    the hot path.

7aw. [ ] Carry a normalized callable path key beside `string[]` namespace
    lookups where preparation already computed it, and use it for
    `lastCallableLookup*` without joining inside recursive `findMixin(...)`
    paths.

7ax. [ ] Audit `findFunctionDirect(...)` naming and call path; either fold the
    direct function binding walk into `findFunction(...)` or rename/remove the
    extra method if it is just old-architecture residue.

7ay. [ ] Audit `functionsByName` clone preservation versus plugin binding
    writes; keep only the clone state needed for explicit plugin function
    bindings and remove any registry-era commentary or shape.

7az. [ ] Audit `directDeclarationsByName` memory shape after promotion
    invalidation: prove the multi-entry map still beats a one-entry
    declaration memo for real lookup tests, or narrow it.

7ba. [ ] Inspect `lookupVersion` increments around declaration/function
    binding writes and pending-name promotion; remove redundant increments only
    where binding-handle invalidation remains provably correct.

Parked secondary deep-cut queue:

Do not select this queue while the Focus Spec is registryless lookup/binding.
Do not seed the active queue from this list. These items are parked backlog,
not current work, until the `Brought-Forward Binding/Lookup Queue` is fully
complete and exhausted or the user explicitly redirects this worktree to
cutting/performance work. The presence of checked or unchecked items here is
not permission to leave binding/lookup work.

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
   Sixth partial status: shared list/sequence child-array eval now lazily
   allocates the evaluated child array only after the first child identity
   changes. Dynamic-but-unchanged public `List`/`Sequence` eval returns the
   original child array and source node instead of allocating a parallel array
   and then proving identity afterward. Focused tests pin that unchanged
   dynamic list/sequence eval does not call `withResolvedValue(...)` or
   `withValue(...)`. The owned surfaces still remain for real child changes,
   Nil filtering, and public materialization semantics.
   Seventh partial status: `Reference` target materialization no longer calls
   `rules.inherit(sourceRules)` after `sourceRules.eval(context)` for direct
   mixin/ruleset targets. `Node.evalStatic(...)` already applies the necessary
   inheritance when eval produces a replacement rules surface, and static
   source rules need no re-inherit. Focused coverage pins target-mixin
   materialization to one inherit from eval replacement rather than a second
   materialization inherit.
   Eighth partial status: merged declaration reference finalization no longer
   carries a dead `textOnly` private mode or an `isMergedAssign` parameter on
   `normalizeMergedAssignReferenceResult(...)`. That normalizer is called only
   from the already-merged branch, so the maybe-merged API and duplicate
   non-merged return branch were deleted. The real merged public
   normalization/inherit boundary remains and is still queued for the larger
   placement/materialization rethink.
   Ninth partial status: direct/fallback/runtime reference finalization no
   longer carries private mode arguments or branches that returned the same
   value as the fallthrough. `evaluateFallbackValue(...)` no longer receives an
   unused `Reference`; direct-node finalization no longer accepts `textOnly`;
   runtime-binding finalization no longer has a redundant text-only return
   branch. `textOnly` remains only where it changes behavior: fallback
   container/JS-expression handling and runtime-binding evaluation flags.
   Tenth partial status: runtime-binding evaluation no longer carries a
   render-text reuse flag. Runtime binding always enables source-free reuse, and
   the deleted render-text bit only OR'd into the same static-value branch.
   `finalizeRuntimeVarBindingResult(...)` therefore no longer accepts
   `textOnly`, and its static-value return branch was folded into the common
   return path.
   Eleventh partial status: raw reference render now reuses the existing
   `canReturnReferenceValue(...)` predicate instead of repeating static plus
   non-rules-like checks in the direct raw render finalizer and both async/sync
   raw-render branches.
   Twelfth partial status: raw-reference async target lookup no longer carries
   duplicate success/error cleanup continuations in each staged branch.
   `resolveRawReferenceLookupTarget(...)` now finalizes the raw lookup value
   directly and restores the reference stack with promise `finally(...)`.
   The sync path stays unchanged; this deletes repeated closure plumbing only
   for actual async raw lookups and does not add a helper/API surface.
   Thirteenth partial status: fallback evaluation now restores the reference
   stack with promise `finally(...)` for both async `JsExpression.resolve(...)`
   and generic async fallback `eval(...)`. The generic fallback rejection path
   previously left `Context.referenceStack` incremented; a focused regression
   test now covers that rejection while the change also deletes the duplicate
   JsExpression success/error cleanup continuations.
   Fourteenth partial status: runtime-binding and declaration-reference async
   value evaluation now restore the reference stack on rejection. Runtime
   binding cleanup also restores `rulesContext`/`searchScope` through the same
   promise `finally(...)` boundary instead of duplicated success/error
   continuations. Declaration-reference cleanup keeps search-scope restoration
   on one boundary and uses a guarded reference pop so success, rejection, and
   thrown normalization paths do not leak the active reference frame. Focused
   regressions prove both paths leaked before the batch and are now covered.
   Fifteenth partial status: important declaration references now restore the
   contextual important frame when async declaration value evaluation rejects,
   while successful important propagation still remains available to the
   enclosing declaration finalizer. The async declaration branch also uses one
   finalizer-level rejection cleanup boundary, so errors thrown after async
   value evaluation resolves, including merged public materialization failures,
   restore the reference stack, search scope, and contextual important state.
   Focused regressions prove both leaks before the fix.
   Sixteenth partial status: merged declaration reference normalization now
   returns the already-owned evaluated `List` unchanged when it is already a
   flat, non-empty-placeholder list. The normalizer lazily allocates the
   `mergedItems` array only after it sees a nested list or empty placeholder,
   so the common clean merged-reference path no longer creates a second
   `List` only to inherit from the `Reference`. Focused coverage first failed
   because the finalizer list differed from the copied eval list, and now
   proves the finalizer reuses that owned list while still preserving nested
   merged property lookup behavior.
15. [x] Sweep `Ampersand` template placement next. Replace
   `toTrimmedString().includes(',')` and string splitting with selector-list
   structure and placement state; only final CSS output may stringify.

   Status:
   - Corrected: `Ampersand` template replacement discovery now prefers actual
     `SelectorList` structure and generated `:is(SelectorList)` placement
     state, but it cannot delete every string split. Less escaped/interpolated
     selector text can enter as one raw `SimpleSelector` containing top-level
     commas, so that cold compatibility branch still splits only that raw
     simple selector text and inherits placement onto the resulting
     `BasicSelector` items.
   - Done: focused ampersand distribution tests now construct real
     `SelectorList` inputs for comma-separated parent selectors instead of a
     raw selector string that preserved the old split fallback.
   - Done: a Less distribution fixture covering escaped/interpolated selector
     list text is now active in `packages/jess/test/less/eval-errors.test.ts`;
     it proved the earlier full split deletion was too broad.
   - Done: generated `:is(...)` placement metadata now keeps required-key
     facts aligned with the omitted-wrapper render path for a single
     selector-list item; it uses the lone child selector's required keys
     instead of the selector-list aggregate, which is intentionally empty for
     alternatives.
   - Boundary: template joining still stringifies the individual replacement
     selector when building the merged selector text. This pass deletes broad
     comma-discovery/reparse string work for structured selectors, but keeps a
     narrow raw simple-selector split for Less escaped interpolation. A later
     structural template-builder pass would be a separate selector construction
     change.
16. [ ] Sweep selector matching/extend equality. Replace hot `valueOf()` equality
   predicates with structural/keyset checks where possible, keeping
   `valueOf()` only as a measured, cached fast-path when it wins.

   Status:
   - Rejected attempt: moving keyset impossibility checks ahead of the
     `valueOf()` equality path in `findExtendableLocations(...)` was not kept.
     The smaller selector/extend slice stayed green, but the filtered
     `extend-selector-algorithm.test.ts` partial-boundary case hung and the
     experiment did not produce a safe signal. Revisit this only with a
     reliable non-hanging focused gate or a smaller exact repro.
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

Pass size and commit discipline:

- A full queue pass means finishing a coherent swath of adjacent work in the
  active lane before committing, not stopping after one safe cleanup. This is
  true for binding/scope architecture work and for broader performance/cutting
  work.
- Prefer the active binding/scope queue when it has unchecked work. If that lane
  is active, cleanup-only `Reference` or render/materialization edits are
  secondary unless they directly simplify, unblock, or prove binding lookup
  behavior.
- Within a pass, keep going until the lane is drained for that swath, the next
  task has materially different semantics, the next task needs user/product
  judgment, evidence rejects the approach, or a failing test/debugging thread
  needs isolated investigation.
- Run focused tests as each slice lands. Save expensive full gates, benchmark
  sanity, staging, commit, and push for the batch boundary.
- Update the queue and self-prosecution block as a batch summary. Do not use
  handoff updates as a reason to stop after each tiny deletion.

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

- Binding option/cache audit pass: accepted as lookup surface cleanup and a
  stale-cache correctness fix, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts`, `packages/core/src/tree/rules.ts`,
  focused lookup tests, and this handoff.
  - New traversal: none. Production `Reference` option construction now uses
    locals instead of mutating an options object. `registerNode(Func)` writes
    directly to the existing function-binding map. Dynamic declaration-name
    promotion clears existing declaration caches instead of adding a new cache,
    scan, side map, or fallback walk. The callable path-key item was audited
    only; no helper or traversal was added for it.
  - New node/materialization: none. No production node, wrapper `Rules`,
    copied node, `.inherit(...)`, `.adopt(...)`, materialized output array, or
    frozen/source/parent metadata mutation was added. The changed tests build
    the same fixture nodes and warm an existing lookup cache to prove
    invalidation. The `new JsFunction(...)` additions are test-fixture
    construction moved from `register('function', ...)` to
    `setFunctionBinding(...)`; they do not add runtime node creation.
  - Render path: unchanged. The pass does not resolve arrays/nodes to
    stringify; rendered output still uses the same evaluated declaration and
    callable values.
  - Helper/API surface: net cleanup. No public compatibility shim was kept for
    its own sake. Direct function-binding tests now use
    `setFunctionBinding(...)`; production `registerNode(Func)` no longer calls
    `register('function')`. The remaining `register('function')` callsites are
    plugin/function-library fixture setup or external plugin adapters and are
    queued for the next binding pass. No new lookup helper was introduced.
  - Metadata mutations: one deliberate invalidation. When the dynamic-name
    promotion routine mutates queued dynamic declaration names into real
    declaration identities, it now clears
    `directDeclarationsByName`, clears `directDeclarationLookupCache`, and
    increments `lookupVersion`. `registerNode(...)` already does the same for
    `setDefined`/ordinary writes.
  - Danger-token prosecution: `string[]` appears only in queue/audit text for
    array-path callable lookup. This pass added no materialized array path in
    production; carrying a normalized key remains queued because the current
    pass found no existing normalized key to reuse safely.
  - Evidence: focused lookup suite passed (`240` passed, `132` skipped);
    touched-file ESLint passed; `git diff --check` passed; `@jesscss/core`
    build passed with the pre-existing direct-`eval` warning in `js-expr.ts`;
    `audit:node-creation` passed; aggressive review passed; `jess` build
    passed with the existing unused `linecraft` bundle note; one-iteration
    hotpath smoke passed for `mixins-guards.less` (`19.36ms`) and
    `scope-lookup-stress.less` (`68.30ms`). No speed claim is made from this
    pass.

- Lookup option split and utility rename pass: accepted as binding/lookup
  surface slimming and stale registry residue deletion, not as a speed claim.
  Files: `packages/core/src/tree/util/lookup-utils.ts`,
  `packages/core/src/tree/util/direct-rules-lookup.ts`,
  `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/rules.ts`, focused lookup tests, and this handoff.
  - New traversal: none. The utility file was renamed from
    `registry-utils.ts` to `lookup-utils.ts`; import sites were updated.
    `ReferenceFindOptions` names the existing mixed reference lookup object
    rather than adding a wrapper walk. The callable/declaration cache audits
    added no loop, recursion, parent/source walk, sort, or extra scan. Snapshot
    variable references now pass `includeLiveBindings: false` into the existing
    direct declaration walker so the already-modeled source-position path can
    run instead of stopping at a live-slot miss.
  - New node/materialization: none. No production node, wrapper `Rules`,
    copied node, `.inherit(...)`, `.adopt(...)`, frozen/source metadata
    mutation, helper output array, cache, side map, or render materialization
    was added. Existing `Map` caches and `MixinEntry[]` result arrays were not
    widened. The default `{}` objects in changed test helper signatures are
    existing test option defaults with narrower type names, not new production
    allocation paths.
  - Render path: unchanged. The pass changes type surfaces, imports, comments,
    and direct lookup dispatch; rendered output still consumes the same resolved
    declaration/callable values.
  - Helper/API surface: net deletion/cleanup. Deleted the stale `FindOptions`
    alias, split option shapes into `DeclarationFindOptions`,
    `CallableFindOptions`, and `ReferenceFindOptions`, renamed the utility file,
    simplified the single-type `register('function')` implementation, narrowed
    `findDeclaration(...)` so it no longer assigns a dynamic lookup function,
    and added one declaration option bit (`includeLiveBindings`) to select the
    existing snapshot/source-position lane without live slots. No compatibility
    shim was kept for registry names. The changed `TypeError` text in
    `register('function')` remains an exceptional invalid-node guard, not
    routine lookup miss control flow.
  - Metadata mutations: none. Callable cache invalidation remains tied to
    clone/reset and `registerNode(...)`, which clears `callableLookupCache`,
    `ScopeFrame.callableBucketsByName`, coverage flags, and
    `lastCallableLookup*`. Live binding updates mutate variable binding maps,
    not callable buckets. Direct declaration cache keys were audited and kept:
    `strategy.cacheTag`, `local`, and `hasTarget` still correspond to reachable
    lookup semantics, while variable lookup remains excluded from the recursive
    cache by `strategy.includeLiveBindings`; disabling live bindings for
    snapshot reads also keeps that path out of the recursive cache.
  - Evidence: touched-file ESLint passed; `@jesscss/core` build passed with
    only the pre-existing direct-`eval` warning in `js-expr.ts`;
    `git diff --check` passed; focused snapshot-read control test passed;
    broader focused lookup suite passed (`434` passed, `206` skipped);
    aggressive review passed with danger tokens prosecuted in this block;
    `audit:node-creation` passed; `jess` build passed; one-iteration hotpath
    smoke passed for `mixins-guards.less` (`24.76ms`) and
    `scope-lookup-stress.less` (`80.61ms`). No speed claim is made.

- Lookup registry residue cleanup pass: accepted as binding/lookup surface
  deletion and naming cleanup, not as a speed claim. Files:
  `packages/core/src/tree/util/registry-utils.ts`,
  `packages/core/src/tree/util/direct-rules-lookup.ts`,
  `packages/core/src/tree/rules.ts`, focused lookup tests, and this handoff.
  - New traversal: none. The `isArray(keys) ? keys.join(...) : keys` danger
    token is an existing callable cache-key path that was renamed from
    `getRegistrylessMixinCacheKey(...)` to `getCallableLookupCacheKey(...)`;
    this pass did not add a new array walk or recursive search.
  - New node/materialization: none. No production node, wrapper `Rules`,
    copied node, `.inherit(...)`, `.adopt(...)`, frozen/source metadata
    mutation, helper output array, or render materialization was added. The
    `MixinEntry[]` danger tokens are existing one-entry cache value types
    renamed from `registrylessLastMixinLookupValue` to
    `lastCallableLookupValue`; the cache still stores the result array already
    produced by lookup. The `new Set()` danger tokens are existing focused test
    candidate option sets that remained in a changed hunk; no production lookup
    side map/set was added.
  - Render path: unchanged. The pass changes lookup option typing, test
    scaffolding, and callable cache names; rendered output still consumes the
    same resolved declaration/callable values.
  - Helper/API surface: net deletion/cleanup. `findAll` moved off
    `DeclarationFindOptions` onto callable/general `FindOptions`; direct
    declaration lookup no longer checks `findAll`; the dead `searchedRules`
    option field was deleted; stale `Rules.prototype.getRegistry` monkeypatch
    scaffolding was removed from function lookup tests. The remaining cache
    helpers were renamed, not multiplied.
  - Metadata mutations: none. Cache invalidation remains the same clone/reset
    and node-registration invalidation points, now under `lastCallableLookup*`
    names.
  - Evidence: touched-file ESLint passed; `@jesscss/core` build passed with
    only the pre-existing direct-`eval` warning in `js-expr.ts`; `jess` build
    passed; `git diff --check` passed; focused
    `reference`/`mixin`/`call`/`rules` lookup pattern tests passed
    (`271` passed, `159` skipped); `audit:node-creation` passed. Aggressive
    review passed with the danger tokens prosecuted in this block. One-iteration
    hotpath smoke passed for `mixins-guards.less` (`22.73ms`) and
    `scope-lookup-stress.less` (`77.22ms`); this is regression smoke, not a
    speed claim.

- Direct variable declaration walker completion pass: accepted as registry
  bridge deletion plus binding-frame correctness hardening, not as a speed
  claim. Files: `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/util/direct-rules-lookup.ts`,
  `packages/core/src/tree/import-style.ts`, and this handoff.
  - New traversal: the direct variable strategy now owns fallback-frame
    traversal after normal parent search, and `findWithinScopeSurface(...)`
    carries both local-declaration start and child-surface start so later
    same-scope Less variables can be read without letting later child surfaces
    leak backward. Variable lookup can recurse through the scope-frame parent
    chain to reach configured/imported live bindings; the per-surface
    `new Set<Rules>()` already used by the direct recursive walk prevents
    loops. The new `while (fallbackRules)` loop replaces the deleted
    `findVarDeclarationFast(...)` fallback-frame loop instead of adding a
    second fallback search. Generic any-declaration lookup was removed from
    the live-binding lane after focused compound-prefix tests proved live
    frame climbing is wrong for that path.
  - New node/materialization: none. No production node, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, frozen/source metadata mutation, helper
    output array, or render materialization was added.
  - Render path: unchanged. The pass changes lookup ownership before the same
    reference/render paths run.
  - Helper/API surface: deleted the old `Reference`-local
    `findVarDeclarationFast(...)`, `selectVarBucketCandidate(...)`, and
    `laterVarMatch(...)` helpers. No compatibility shim was kept. The direct
    declaration utility remains typed by operation (`findVariableDeclaration`,
    `findPropertyDeclaration`, `findAnyDeclaration`) instead of reintroducing a
    string-dispatch helper.
  - Metadata mutations: configured import live-slot rebuilds now preserve an
    existing `fallbackFrame`; this keeps replacement `set` configs visible to
    imported guarded mixins and detached ruleset closures. Variable lookup no
    longer reads/writes the recursive direct declaration cache because
    `currentBindingsByName` live entries can change without a lookup-version
    bump. Property lookup can still use that cache.
  - Routine error/control: no new hot-path exception for ordinary misses. The
    new `Circular fallback frame chain detected in direct declaration lookup`
    error mirrors the existing circular parent-chain guard and is only for
    structurally invalid frame cycles, not a miss/control-flow result.
  - Evidence: touched-file ESLint passed. Focused import replacement and
    variable/reference cases passed. Full focused lookup suite passed:
    `reference`, `rules`, `import-style`, and `detached-rulesets` with
    `269` passing and `30` skipped. The first full focused run exposed a real
    regression where generic any-declaration lookup climbed live binding frames
    and broke compound-prefix precedence (`red` became `cyan`); narrowing
    `ANY_DECLARATION_LOOKUP` off live bindings fixed it. `@jesscss/core` build,
    `git diff --check`, aggressive cutting review, and node-creation audit
    passed. One-iteration hotpath smoke passed with usable signals:
    `mixins-guards.less` median `27.74ms`; `scope-lookup-stress.less` median
    `82.49ms`. This pass makes no speed claim from that one-iteration smoke.
- `findDeclarationDirect(...)` adapter deletion pass: accepted as leftover
  string-discriminator surface deletion, not as a speed claim. Files:
  `packages/core/src/tree/util/direct-rules-lookup.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: none. The pass deletes the unused adapter that branched on
    `'VarDeclaration'` / `'Declaration'`; callers already use the typed direct
    operations from the previous pass.
  - New node/materialization: none.
  - Render path: unchanged.
  - Helper/API surface: one internal helper export is deleted. The remaining
    direct declaration utility exports only typed operations for variable,
    property, and any-declaration lookup.
  - Metadata mutations: none.
  - Routine error/control: no new throw/catch/Error path. The existing circular
    parent-chain error message was renamed to avoid pointing at the deleted
    adapter name.
  - Evidence: touched-file ESLint passed; `rg` found no source
    `findDeclarationDirect(...)` call sites; focused lookup tests passed
    (`15` passed, `329` skipped); expanded binding/selector sweep passed
    (`18` files, `720` passed, `9` skipped). `@jesscss/core` and `jess` builds
    passed. Node-creation audit stayed at `new-node 310`, `with-surface 39`,
    `derive 30`, `copy-leaves 28`. Hotpath sanity ran but all fixtures were
    unstable/noisy, so this pass makes no speed claim.
    `verify:aggressive-cutting-review` and `git diff --check` passed.
- Declaration lookup lane reshaping pass: accepted as string-discriminator
  reduction and typed lane restoration, not as a speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/selector-attr.ts`,
  `packages/core/src/tree/util/direct-rules-lookup.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `packages/core/src/tree/__tests__/selector-attr.test.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: none. `Rules.findVariable(...)` now calls the selected
    variable declaration operation directly instead of delegating through
    `findDeclaration(..., 'VarDeclaration')`. `Rules.findProperty(...)`,
    `Rules.findDeclaration(...)`, `Reference`, and selector-attribute
    interpolation assign the direct lookup operation for their path once and
    call it. The direct walker receives a preselected strategy object instead
    of re-branching on a string mode through the traversal.
  - New node/materialization: none. No node, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, source metadata, parent mutation, output
    array, or materialized render artifact was added.
  - Render path: unchanged. The same variable declaration value resolves/evals
    before attribute selector string output.
  - Helper/API surface: the `Rules.findVariable(...)` method is restored as a
    typed lane. One module-local selector helper keeps direct-first fallback
    semantics local to raw attribute interpolation. The old
    `findDeclarationDirect(...)` string adapter remains only as a compatibility
    edge around typed direct operations.
  - Metadata mutations: none. The static declaration lookup strategy objects
    and shared empty-options sentinel are module-level constants, not
    per-lookup state graphs or node metadata.
  - Routine error/control: no production throw/catch/Error path added. The new
    selector test uses `try/finally` only to restore a monkey-patched typed
    method sentinel.
  - Evidence: touched-file ESLint passed; focused selector/reference coverage
    passed (`8` tests, `140` skipped), including `findVariable(...)` proving it
    does not call `findDeclaration(..., 'VarDeclaration')` and raw interpolated
    attribute lookup proving it skips the `findVariable(...)` fallback.
    Expanded binding/selector sweep passed (`18` files, `720` passed,
    `9` skipped). `@jesscss/core` and `jess` builds passed. Node-creation audit
    stayed at `new-node 310`, `with-surface 39`, `derive 30`, `copy-leaves 28`.
    Hotpath sanity ran with mixed usable/unstable/noisy signals, so this pass
    makes no speed claim. `verify:aggressive-cutting-review` and
    `git diff --check` passed.
- Reference direct declaration bridge pass: accepted as a typed lookup method
  bridge deletion, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: none. The pass routes covered `Reference` declaration,
    property, index-declaration, direct-rules-target, and function-fallback
    declaration reads into the existing `findDeclarationDirect(...)` walker
    before the typed `Rules.findDeclaration(...)`/`Rules.findProperty(...)`
    method layer. Unsupported shapes still fall back through the existing
    `UNCOVERED` branch.
  - New node/materialization: none. No node, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, source metadata, parent mutation, output
    array, or materialized render artifact was added.
  - Render path: unchanged. The same declaration node or runtime binding is
    returned before normal value eval/render.
  - Helper/API surface: one module-local helper was added in `Reference` to
    centralize "direct first, typed fallback" lookup and delete repeated typed
    method calls from covered reference adapters. No public API was added.
  - Metadata mutations: none.
  - Routine error/control: no production throw/catch/Error path added. Focused
    tests still use monkey-patched typed methods only to prove they are not
    called for covered reference reads.
  - Evidence: touched-file ESLint passed; focused `reference.test.ts` passed
    (`8` passed, `130` skipped), covering static property/declaration reference
    direct lookup, explicit-target variable fallback, direct variable/property
    lookup, unfiltered property references, and semantic filtered property
    registry fallback. Broader binding sweep passed (`14` files, `685` passed,
    `9` skipped). `@jesscss/core` and `jess` builds passed. Node-creation audit
    stayed at `new-node 310`, `with-surface 39`, `derive 30`, `copy-leaves 28`.
    `measure:less:hotpath` ran as sanity only with mixed noisy/unstable/usable
    signals, so this pass makes no speed claim. `verify:aggressive-cutting-review`
    and `git diff --check` passed.
- Reference variable fallback child-entry pass: accepted as registry-shaped
  lookup storage deletion, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: none. `findVarDeclarationFast(...)` keeps its existing child
    loop but now reads child entries from carried declaration child-surface
    state instead of `_rulesSet`.
  - New node/materialization: none. No node, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, source metadata, parent mutation, output
    array, or materialized render artifact was added.
  - Render path: unchanged. This only changes where variable fallback lookup
    reads child-surface entries before returning the same source declaration.
  - Helper/API surface: no helper or public method added. The pass reuses
    existing `Rules.collectDirectDeclarationChildEntries()`.
  - Metadata mutations: none.
  - Routine error/control: no production throw/catch/Error path added. The new
    focused test uses a temporary throwing `_rulesSet` getter and `try/finally`
    restore to prove lookup does not read the old registry-shaped storage.
  - Evidence: touched-file ESLint passed; focused reference tests passed
    (`7` passed, `131` skipped), covering explicit-target variable fallback,
    direct index/target semantics, semantic filtered property bridge,
    unfiltered property direct lookup, nested static variable lookup, and
    fallback-frame declarations. Broader binding sweep passed (`14` files,
    `685` passed, `9` skipped). `@jesscss/core` and `jess` builds passed.
    Node-creation audit stayed at `new-node 310`, `with-surface 39`,
    `derive 30`, `copy-leaves 28`. `measure:less:hotpath` ran as sanity only
    with mixed usable/noisy signals, so this pass makes no speed claim.
    `verify:aggressive-cutting-review` and `git diff --check` passed.
- Direct-declaration env deletion pass: accepted as transitional lookup
  experiment deletion, not as a speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `scripts/prototype-direct-declaration-lookup.mjs`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: none. The runtime branch that checked
    `process.env.JESS_DIRECT_DECLARATION_LOOKUP` was deleted; no lookup loop,
    parent walk, child walk, or cache probe was added.
  - New node/materialization: none. No node, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, source metadata, parent mutation, output
    array, or materialized render artifact was added.
  - Render path: unchanged. This only removes a declaration lookup selection
    switch and a stale prototype script for that switch.
  - Helper/API surface: deleted one runtime env branch and the obsolete
    `scripts/prototype-direct-declaration-lookup.mjs` comparator. No helper or
    public method was added.
  - Metadata mutations: none.
  - Routine error/control: no production throw/catch/Error path added. The new
    focused test uses `try/finally` to restore the temporary env var and
    monkey-patched `Rules.getRegistry(...)`.
  - Evidence: touched-file ESLint passed; focused reference lookup tests
    passed (`8` passed, `129` skipped), proving covered direct declaration
    modes remain direct and stale-env semantic filtered property lookup remains
    registry-owned. Broader binding sweep passed: `reference`, `scope-frame`,
    `import-style`, `mixin`, `rules`, `detached-rulesets`, `call`, `control`,
    and `declaration` plus matched utility suites (`684` passed, `9` skipped).
    `@jesscss/core` and `jess` builds passed; node-creation audit reported
    `new-node` `310`, `with-surface` `39`, `derive` `30`, `copy-leaves` `28`;
    hotpath sanity was status only: usable `functions` `15.39ms`,
    `import-reference` `20.55ms`, `extend-chaining` `5.88ms`, and `media`
    `6.36ms`; unstable `mixins-guards` `19.44ms`. `verify:aggressive-cutting-review`
    and `git diff --check` passed; the verifier flagged the expected test-only
    `try` and `registryHits: string[]` tripwires plus literal
    `.inherit(...)`/`.adopt(...)` text prosecuted above.
- Ruleset child-surface callable pass: accepted as callable direct-crawl work
  reduction, not as a speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/__tests__/mixin.test.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: one private predicate,
    `rulesMayContainExactRulesetSurface(...)`, mirrors the existing
    mixin-capable surface predicate and runs from the registration/lazy
    child-entry edge that already classifies callable child surfaces. Lookup
    then uses the carried `hasExactRulesetChildSurface` fact to avoid broader
    child recursion; it does not add a second lookup-time crawl.
  - New node/materialization: none. No node, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, source metadata, parent mutation, output
    array, or materialized render artifact was added.
  - Render path: unchanged. The pass only decides whether ruleset-path lookup
    may enter a child scope.
  - Helper/API surface: one private helper and one existing-`Rules` boolean
    derived-state field were added. They narrow two private ruleset-path
    walkers and do not expose a public compatibility method.
  - Metadata mutations: no parent/source/frozen metadata mutation. Existing
    derived-state reset/indexing now clears and repopulates the additional
    boolean beside the existing callable/mixin child-surface booleans.
  - Routine error/control: no production throw/catch/Error path added. The
    focused test uses a temporary throwing `value` getter only as a tripwire and
    restores the monkey-patch with `try/finally`.
  - Evidence: touched-file ESLint passed; focused callable tests passed,
    including ruleset-path misses, terminal mixin-only, namespace fast path,
    parameterized mixin-ruleset terminal behavior, and ScopeFrame callable
    buckets (`17` passed, `126` skipped). Broader binding sweep passed:
    `reference`, `scope-frame`, `import-style`, `mixin`, `rules`,
    `detached-rulesets`, `call`, and `control` plus matched utility suites
    (`618` passed, `9` skipped). `@jesscss/core` and `jess` builds passed;
    node-creation audit reported `new-node` `310`, `with-surface` `39`,
    `derive` `30`, `copy-leaves` `28`; hotpath sanity was status only:
    usable `functions` `15.30ms`, `import-reference` `20.19ms`,
    `mixins-guards` `19.57ms`, `extend-chaining` `5.85ms`, and unstable
    `media` `5.95ms`. `verify:aggressive-cutting-review` and
    `git diff --check` passed; the verifier flagged the expected helper loop
    and test-only `try`/`throw`/`return []` tripwires prosecuted above.
- Declaration registry-bookkeeping bridge pass: accepted as a narrow
  declaration registry fallback deletion, not as a speed claim. Files:
  `packages/core/src/tree/util/direct-rules-lookup.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: none. `findDeclarationDirect(...)` already creates and
    owns its direct-walk visited set. This pass only stops treating an incoming
    registry `searchedRules` marker or empty registry candidate sets as
    unsupported option shapes.
  - New node/materialization: none. No node, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, source metadata, parent mutation, map/set,
    helper array, or materialized output was added in production. The only new
    `Set` allocation is in focused tests to simulate the old registry
    bookkeeping options.
  - Render path: unchanged. This only changes whether covered exact declaration
    lookup can stay on the direct lookup path.
  - Helper/API surface: no helper or public method added. The tests carry
    `searchedRules` and empty candidate sets through existing options object
    shapes to mirror registry bookkeeping rather than broadening the intended
    lookup API.
  - Metadata mutations: none.
  - Routine error/control: no production throw/catch/Error path added. Test-only
    `try/finally` restores monkey-patched `Rules.getRegistry(...)`, and
    `registryHits: string[]` records the tripwire count.
  - Evidence: touched-file ESLint passed; focused `reference.test.ts` lookup
    tests passed (`14` passed, `122` skipped), including direct variable and
    property lookup with `searchedRules` and empty candidate sets present, with
    `Rules.getRegistry('declaration')` monkey-patched as the tripwire. The
    broader binding sweep passed (`478` passed, `9` skipped). Non-empty
    candidate sets still return `UNCOVERED`.
- Declaration child-entry carry pass: accepted as binding/direct-lookup
  rediscovery deletion, not as a speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/util/direct-rules-lookup.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: no new lookup-time traversal. This deletes the direct
    declaration walker's private child-rules scan and reuses child-surface
    state carried by `Rules` registration. The lazy population path is the same
    one-time child surface walk that the deleted helper performed, now owned by
    `Rules` so later direct declaration lookups read cached entries instead of
    scanning `Rules.value` again. The remaining `for` loop in
    `Rules.collectDirectDeclarationChildEntries()` is that moved one-time
    population path.
  - New node/materialization: none. No node, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, source metadata, parent mutation, or
    materialized output was added in production. One small
    `directDeclarationChildEntries` array is carried on existing `Rules`
    derived state; it replaces repeated child-entry arrays previously allocated
    inside direct lookup. The new `rulesVisibility` objects are the same
    per-entry visibility payload the deleted lookup helper already created, now
    cached with the carried child entry.
  - Render path: unchanged. This only changes how declaration lookup obtains
    child scope entries before resolving the same declarations.
  - Helper/API surface: one internal `Rules.collectDirectDeclarationChildEntries()`
    method and two private `Rules` helpers were added to move ownership out of
    `direct-rules-lookup.ts`; the old local child scanner and default visibility
    clone were deleted from the lookup utility.
  - Metadata mutations: no parent/source/frozen metadata mutation. Existing
    derived-state invalidation on `registerNode(...)` now clears the declaration
    child-entry cache beside the direct declaration lookup caches.
  - Routine error/control: no production throw/catch/Error path added. The
    focused test installs a temporary throwing `value` getter only to prove the
    warmed parent lookup does not rescan the parent `value` array, and uses
    `map(...)` only to assert the carried entry identity.
  - Evidence: touched-file ESLint passed after cleanup; focused direct
    property/reference tests passed; broader `reference`, `scope-frame`,
    `import-style`, `mixin`, `rules`, and `detached-rulesets` suites passed
    (`474` passed, `9` skipped). `pnpm run verify:baseline -- --changed`
    escalated to full baseline because the upstream tracking ref was not found,
    then showed unrelated selector/keyset failures and stalled with Vitest
    workers pegged; it was stopped and treated as inconclusive, not passed.
    The isolated failing selector tests reproduced outside the touched lookup
    path.
- No-frame mixin-only child-surface bridge pass: accepted as callable
  direct-crawl work reduction, not as a speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/__tests__/mixin.test.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: no new tree traversal. The direct `findMixinsFast(...)`
    bridge already walked child callable surfaces; this pass changes the
    existing bridge condition from the broad exact-callable child fact to
    `hasDirectLookupChildSurface(includeRulesets)` and skips entries that fail
    the already-existing `rulesMayContainExactMixinSurface(...)` predicate when
    ruleset terminals are excluded.
  - New node/materialization: none. No node, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, map/set, source metadata, parent mutation,
    or materialized output was added in production.
  - Render path: unchanged. This only avoids an unnecessary callable lookup
    child-surface crawl for covered mixin-only misses.
  - Helper/API surface: no helper or public method added. The existing private
    `hasDirectLookupChildSurface(...)` and `rulesMayContainExactMixinSurface(...)`
    facts are reused.
  - Metadata mutations: none. Existing child-surface booleans are read, not
    mutated differently.
  - Routine error/control: no throw/catch/Error path added. Test-only
    `try/finally` monkeypatch restoration and `rules([])`/`new Set`-like
    fixtures are isolated to focused tests.
  - Evidence: touched-file ESLint passed; focused callable child-surface tests
    passed (`11` passed, `131` skipped); serial broader callable/reference/import/call
    suite passed (`460` passed, `1` skipped). An earlier broad run failed
    while `@jesscss/core build` was cleaning `lib` in parallel; the serial rerun
    after the build finished passed.
- Core function registry deletion pass: accepted as binding/lookup registry
  plumbing deletion, not as a speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/util/registry-utils.ts`,
  `packages/core/src/tree/control.ts`,
  `packages/core/src/tree/util/callable-surface.ts`,
  `packages/core/src/tree/__tests__/call.test.ts`,
  `packages/core/src/tree/__tests__/control.test.ts`,
  `packages/jess-plugin-less-compat/src/plugin.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: none. `Rules.findFunction(...)` keeps the existing
    parent/import-boundary loop from the prior direct-binding pass and no
    longer opens any registry lookup or deferred function-indexing store. The
    diff-visible `sourceRules.value.map(deriveIterationChild)` is pre-existing
    iteration-body copy work; this pass only removed its old
    preserve-function-registry options argument.
  - New node/materialization: no AST node construction, wrapper `Rules`,
    `.inherit(...)`, `.adopt(...)`, frozen/source metadata, or parent mutation
    was added. Runtime function registrations write `functionsByName`
    directly. The only production allocation added by this pass is
    `new Map(sourceRules.functionsByName)` on runtime `$for` iteration surfaces,
    replacing the previous `FunctionRegistry.cloneForRules(...)` preservation
    so existing function visibility remains available during iteration.
  - Render path: unchanged. Function calls still evaluate the same
    `JsFunction`/`Func` source nodes.
  - Helper/API surface: net deletion. Removed core `FunctionRegistry`,
    `Rules.functionRegistry`, `Rules.getRegistry('function')`,
    `_ensureFunctionRegistry(...)`, `FunctionRegistry.cloneForRules(...)`, and
    stale preserve-function-registry clone hooks. Less-compat keeps a
    Less-shaped mock `functionRegistry` only inside the plugin adapter and
    bridges it to `Rules.setFunctionBinding(...)` / `Rules.findFunction(...)`.
  - Metadata mutations: none. No parent/source/frozen metadata, scope-frame
    construction, or registration-prep semantics changed.
  - Routine error/control: no new runtime throw/catch/Error path; the existing
    Less-compat plugin-load catch remains unchanged. Diff-visible
    `getRegistry(...)` text is the now declaration-only method signature plus
    test monkeypatching; it is not expected-miss error control.
  - Test-only danger tokens: focused tests still use `new JsFunction(...)`,
    `new Set(...)`, `rules([])`, and `try/finally` monkeypatch restoration to
    prove function lookups do not open registries.
  - Evidence: touched-file ESLint passed; focused core function call tests
    passed (`24` passed, `56` skipped); focused control function-binding tests
    passed (`3` passed, `56` skipped); lookup-adjacent core suite passed
    (`518` passed, `1` skipped); `@jesscss/core` build passed with the existing
    `src/tree/js-expr.ts` direct-eval warning; `@jesscss/plugin-less-compat`
    build passed with the existing mixed-exports warning; Less-compat
    plugin-manager/at-plugin/directive compatibility tests passed (`25`
    tests). Performance remains leashed/status only; no speed claim without a
    measured before/after run.
- Binding current-read lookup surface pass: accepted as a binding/lookup bridge
  deletion, not as a speed claim. Files:
  `packages/core/src/tree/util/direct-rules-lookup.ts`,
  `packages/core/src/tree/util/registry-utils.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`, and this handoff.
  - Hypothesis: declaration lookup should not keep `liveSlotsByName` as a
    parallel read map after `ScopeFrame.currentBindingsByName` became the
    unified current binding layer for live cells and static declaration
    entries.
  - New traversal: none. Existing declaration lookup loops are unchanged; the
    live-cell read inside them now reads `currentBindingsByName.get(key)`
    instead of `liveSlotsByName.get(key)`.
  - New node/materialization: none. No nodes, wrappers, copied declarations, or
    materialized arrays were added.
  - Render path: unchanged. This pass only changes declaration lookup identity
    reads before reference evaluation/render finalization.
  - Helper/API surface: no helper, public method, registry, cache, or wrapper
    was added.
  - Metadata mutations: none. The pass does not change parent/source/frozen
    metadata, scope-frame construction, or live cell publication. The
    `sourceNode` references in the diff are existing binding identity reads and
    focused test fixture setup, not metadata writes.
  - Error control: no production errors were added. The new `throw new Error`
    calls are test sentinels that prove the old `liveSlotsByName.get` path is
    not used.
  - Evidence: focused regression tests make `liveSlotsByName.get` throw and
    prove both direct `findVariable(...)` and `DeclarationRegistry.find(...)`
    resolve live declaration-shaped cells through current bindings. The focused
    current-bindings reference slice passed (`2` tests selected), and the
    adjacent `scope-frame`, `reference`, `import-style`, and `mixin` lookup
    suites passed (`392` passed, `1` skipped). Touched TypeScript eslint
    passed. `git diff --check`, `pnpm run verify:aggressive-cutting-review`,
    `pnpm run prototype:binding-handle-reuse`, `pnpm run audit:node-creation`,
    `pnpm --filter @jesscss/core build`, and `pnpm --filter jess build`
    passed. Direct stress render of `scope-lookup-stress.less` produced length
    `8822`. `measure:less:hotpath` completed as sanity only with usable
    `functions` `14.99ms`, usable `import-reference` `20.01ms`, noisy
    `mixins-guards` `25.73ms`, noisy `extend-chaining` `7.41ms`, and unstable
    `media` `6.18ms`, so this pass makes no speed claim.
  - Verdict: keep. This closes the live-slot lookup-surface bridge for
    declaration lookup while leaving live-slot storage/construction intact.
- Ampersand escaped selector correction and selector equality audit: accepted
  as a correctness repair plus a rejected selector-match experiment, not as a
  speed claim. Files:
  `packages/core/src/tree/ampersand.ts`,
  `packages/jess/test/less/eval-errors.test.ts`, and this handoff.
  - Hypothesis: selector-list distribution should be decided by selector
    structure and generated placement state, not by rendering a selector,
    scanning all selector text for commas, splitting it, and manufacturing new
    basic selectors from the pieces. The correction is that Less escaped or
    interpolated selector text can legitimately reach ampersand template merge
    as one raw `SimpleSelector` with top-level commas, so that one cold raw-text
    path must remain.
  - New traversal: the restored `splitTopLevelCommas(...)` loop scans only raw
    `SimpleSelector` text after a cheap comma check. There is no parent walk,
    child crawl, sort, side map, recursive search, or broad helper surface.
    The selector equality experiment added no retained traversal because it was
    reverted.
  - New node/materialization: the restored cold raw-simple-selector branch may
    create `new BasicSelector(item).inherit(baseSelector)` for each escaped
    top-level comma item. This is semantic placement materialization for Less
    escaped/interpolated selector-list compatibility, not render-only
    materialization. Structured `SelectorList` and generated `:is(SelectorList)`
    replacements still reuse existing selector nodes. The selector equality
    experiment added no retained nodes.
  - Render path: final CSS rendering is unchanged. Template merge still
    stringifies the individual replacement selector to build the merged
    selector text. It does not create an additional render-only node path.
  - Helper/API surface: the private comma splitter was restored only for the
    raw `SimpleSelector` escaped-interpolation branch. No public-looking
    compatibility method, registry, cache, or generic helper was added.
  - Metadata mutations: split raw selector items inherit placement/source
    metadata from the raw `SimpleSelector`, restoring the existing semantic
    placement behavior for escaped/interpolated selector lists. No parent
    restoration, frozen mutation, side map, or generic defensive probe was
    added.
  - Evidence: activating the Less escaped/interpolated distribution fixture
    first proved the previous full split deletion was too broad. After the
    narrow raw `SimpleSelector` split restore, the Less fixture passed with one
    active test; the separate invalid-template error case remains recorded as
    deferred coverage. The focused ampersand/interpolation/pseudo/nesting core
    slice passed (`85` tests), and the selector/extend sanity slice passed
    after the reverted experiment (`132` tests). Touched TypeScript eslint
    passed. `git diff --check`, `pnpm run verify:aggressive-cutting-review`,
    `pnpm run audit:node-creation`, `pnpm run prototype:binding-handle-reuse`,
    `pnpm --filter @jesscss/core build`, and `pnpm --filter jess build`
    passed. Direct stress render of `scope-lookup-stress.less` produced length
    `8822`. `measure:less:hotpath` completed as sanity only with unstable
    `functions` `15.79ms`, usable `import-reference` `22.09ms`, usable
    `mixins-guards` `18.76ms`, unstable `extend-chaining` `5.66ms`, and noisy
    `media` `10.81ms`, so this pass makes no speed claim. A selector
    equality/keyset reorder was tried and reverted: the smaller selector/extend
    slice passed, but the filtered partial-boundary extend test hung and there
    was no reliable safe signal.
  - Verdict: keep the ampersand correctness repair; leave selector equality
    item 16 open. No speed claim.
  - Danger-token prosecution: retained `new BasicSelector(...)` and `.inherit`
    in this pass are confined to the cold raw escaped/interpolated
    `SimpleSelector` split path and the existing template merge output path.
    They are not a restored broad selector stringification fallback.
- Reference flat merged-normalization cleanup pass: accepted as a direct
  public-materialization cut in `Reference` merged declaration finalization,
  not as a speed claim. Files: `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`, and this handoff.
  - New traversal: none beyond the existing merged-list scan. The normalizer
    still inspects the same list children, but it stops allocating the output
    array and replacement `List` unless the scan actually finds a nested list
    or empty placeholder that requires normalization.
  - New node/materialization: production net deletion on the clean merged-list
    path. The previous code always built `mergedItems` and returned
    `new List(mergedItems)` for flat multi-item lists; the new code returns the
    already-owned evaluated `List` directly. The remaining `new Nil()` and
    `new List(mergedItems)` branches are still required for all-placeholder
    and genuinely normalized nested/filtered outputs. Test-only instrumentation
    monkey-patches `List.prototype.inherit` to prove object identity.
  - Render path: unchanged. This is public declaration-reference
    materialization, not render stringification; render still writes through the
    existing node render paths.
  - Helper/API surface: no public API or generic helper was added. The local
    normalizer kept the existing local `collect(...)` recursion for the
    genuinely nested case and added only local lazy state to avoid allocating
    on the flat case.
  - Metadata mutations: no new metadata mutation. The final `.inherit(...)`
    still happens at the existing merged-reference public boundary, but it now
    targets the evaluated owned list directly when no normalization is needed.
  - Evidence: the focused regression failed before the fix because
    `finalizedList !== latestCopiedList`; after the fix, the targeted merged
    reference pair passed, the focused `reference`, `declaration`, `call`, and
    `mixin` family passed (`414` tests), and the broader
    lookup/materialization set passed (`698` passed, `9` skipped). Touched
    TypeScript eslint passed; the handoff is ignored by eslint config.
    `git diff --check`, `pnpm run verify:aggressive-cutting-review`,
    `pnpm run audit:node-creation`, `pnpm run
    prototype:binding-handle-reuse`, `pnpm --filter @jesscss/core build`,
    and `pnpm --filter jess build` passed. Direct stress render of
    `scope-lookup-stress.less` produced length `8822`.
    `measure:less:hotpath` completed as sanity only with unstable `functions`
    `17.35ms`, usable `import-reference` `23.24ms`, unstable
    `mixins-guards` `20.73ms`, noisy `extend-chaining` `7.27ms`, and noisy
    `media` `24.96ms`, so this pass makes no speed claim.
  - Verdict: keep. This removes one replacement `List` and one always-built
    normalization array from the clean merged-reference path while leaving
    nested/placeholder normalization semantics intact.
  - Danger-token prosecution: production `new List(mergedItems)` and
    `new Nil()` are pre-existing, now colder normalization outputs for paths
    that actually changed shape; production `.inherit(...)` is the existing
    merged-reference public placement boundary. Test-only
    `List.prototype.inherit` monkey-patching and `try`/`finally` restore the
    spy around the identity assertion.
- Reference async important/finalizer cleanup pass: accepted as a correctness
  fix in `Reference` declaration finalization, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`, and this handoff.
  - New traversal: none. No loop, recursion, parent/source walk, child crawl,
    sort, side map, or array/object scan was added.
  - New node/materialization: production none. The implementation adds no node
    construction, copying, wrapper surface, inheritance, or source/parent
    mutation. Test-only coverage reuses existing source builders plus
    `AsyncNativeRenderAny`/`RejectingAsyncAny`; one test monkey-patches
    `List.prototype.inherit` only to force the existing merged public
    materialization boundary to throw.
  - Render path: unchanged. Declaration references still evaluate the same
    declaration value and render through existing node render paths. This pass
    only restores cleanup when async declaration evaluation rejects or when the
    async merged finalizer throws after value evaluation resolves.
  - Helper/API surface: no public API or generic helper was added. The async
    declaration path now uses one `.then(finalize).catch(cleanup).finally(...)`
    boundary instead of a two-argument `.then(success, evalReject)` that missed
    finalizer-thrown errors. The new `importantPushed` boolean is local cleanup
    state so rejected/throwing paths can undo the contextual important frame
    while successful declaration references still propagate `!important` to the
    enclosing declaration finalizer.
  - Metadata mutations: no new metadata kind. Existing `Context`
    `referenceStack`, `searchScope`, and contextual important stack mutations
    are now restored on the covered exceptional paths. Successful important
    propagation is intentionally unchanged.
  - Evidence: the new important-declaration regression failed before the fix
    with `context.hasImportantSource === true` after rejected async value eval.
    The new async merged-finalizer regression failed before the second cleanup
    cut with `context.hasImportantSource === true` after the finalizer-thrown
    rejection. After the fix, both targeted regressions passed, the focused
    `reference`, `declaration`, `call`, and `mixin` family passed (`414`
    tests), and the broader lookup/materialization set passed (`698` passed,
    `9` skipped). Touched TypeScript eslint passed; the handoff is ignored by
    eslint config. `git diff --check`, `pnpm run
    verify:aggressive-cutting-review`, `pnpm run audit:node-creation`,
    `pnpm run prototype:binding-handle-reuse`,
    `pnpm --filter @jesscss/core build`, and `pnpm --filter jess build`
    passed. Direct stress render of `scope-lookup-stress.less` produced length
    `8822`. `measure:less:hotpath` completed as sanity only with usable
    `functions` `15.27ms`, usable `import-reference` `20.67ms`, unstable
    `mixins-guards` `19.32ms`, usable `extend-chaining` `5.47ms`, and usable
    `media` `5.95ms`, so this pass makes no speed claim.
  - Verdict: keep. This fixes two proven async declaration cleanup leaks and
    tightens the finalizer rejection boundary without advancing any performance
    claim.
  - Danger-token prosecution: test-only `new RejectingAsyncAny(...)`,
    `new AsyncNativeRenderAny(...)`, `rules([declaration])`, and
    `List.prototype.inherit` monkey-patching are targeted exceptional-path
    fixtures; test-only `throw new Error('merged finalization failed')` forces
    the existing merged-finalization boundary to prove cleanup. Test-only
    `try` restores the monkey-patched prototype. Production
    `try`/`.catch(...)` remains an exceptional cleanup boundary, not routine
    lookup miss control. Production
    `.inherit(referenceNode)` is still the pre-existing merged-assignment
    public materialization boundary and remains queued under item 14/24.
- Reference async binding/declaration cleanup batch: accepted as a
  correctness fix plus helper/API-surface cut in `Reference` runtime-binding
  and declaration-reference finalization, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`, and this handoff.
  - New traversal: none. No loop, recursion, parent/source walk, child crawl,
    sort, side map, or array/object scan was added.
  - New node/materialization: production none. The implementation changes
    cleanup/finalization boundaries only; it does not add node construction,
    copying, wrapper surfaces, inheritance, or metadata mutation. Test-only
    coverage reuses the existing `RejectingAsyncAny` fixture and constructs two
    focused rejecting values plus source `rules([])`/`Map` binding fixtures to
    prove the rejected async binding/declaration paths. The diff still shows
    `normalized.inherit(referenceNode)` because the existing merged-assignment
    public materialization boundary moved inside the reshaped finalizer; this
    batch does not add that inherit or expand its scope.
  - Render path: unchanged. Runtime binding and declaration references still
    evaluate the same resolved values and render through the existing native
    node render path. The batch only guarantees cleanup when async value eval
    rejects.
  - Helper/API surface: net deletion on async paths. Runtime-binding value eval
    now restores `searchScope`/`rulesContext` with one promise `finally(...)`
    instead of duplicated success/error continuations, and runtime-binding
    result finalization pops the reference frame from one sync/async boundary
    instead of inside each success return branch. Declaration-reference
    finalization uses one search-scope cleanup boundary and a guarded local
    reference pop for success, rejection, and thrown normalization paths. No
    public method or generic helper was added; sync cleanup duplication was left
    in place rather than adding hot-path helper closures just for tidiness.
  - Metadata mutations: no new metadata mutation. Existing `Context`
    `referenceStack`, `rulesContext`, and `searchScope` restoration is now
    guaranteed for the covered rejected async paths. The test-only
    `sourceNode: paramDecl` binding fixture is the existing runtime binding
    shape needed to route through the live-slot path.
  - Evidence: the new runtime-binding regression failed before the fix with
    `Context.referenceStack === 1`; the declaration-reference regression also
    failed before the fix by rejecting through the async declaration value path.
    After the fix, `reference.test.ts` passed (`127` tests), the focused
    `reference`, `declaration`, `call`, and `mixin` family passed (`412`
    tests), and the broader lookup/materialization set passed (`696` passed,
    `9` skipped); touched TypeScript eslint passed; `git diff --check`,
    `pnpm run verify:aggressive-cutting-review` (with the documented
    test-fixture and existing merged-inherit danger tokens), `pnpm run
    audit:node-creation`, `pnpm run prototype:binding-handle-reuse`,
    `pnpm --filter @jesscss/core build`, and `pnpm --filter jess build`
    passed. Direct stress render of `scope-lookup-stress.less` produced length
    `8822`. `measure:less:hotpath` completed as sanity only with unstable
    `functions` `17.79ms`, usable `import-reference` `24.67ms`,
    noisy `mixins-guards` `34.01ms`, usable `extend-chaining` `6.12ms`, and
    unstable `media` `6.81ms`, so this pass makes no speed claim.
  - Verdict: keep. This batch fixes two proven rejected-async cleanup leaks and
    removes duplicated async cleanup continuations while preserving the
    remaining materialization boundaries in item 14.
  - Danger-token prosecution: test-only `new RejectingAsyncAny(...)`,
    `new Map(...)`, `rules([])`, and `sourceNode: paramDecl` construct the
    minimal live binding fixture; production `try` remains the existing
    exceptional cleanup boundary for thrown evaluation/finalization failures,
    not ordinary miss control; production `.inherit(referenceNode)` is the
    pre-existing merged-assignment public materialization boundary and remains
    queued for the larger item-14 placement rethink.
- Reference async fallback cleanup pass: accepted as a narrow correctness fix
  plus helper/API-surface cut in fallback reference evaluation, not as a speed
  claim. Files: `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`, and this handoff.
  - New traversal: none. No loop, recursion, parent/source walk, child crawl,
    sort, side map, or array/object scan was added.
  - New node/materialization: production none. The implementation changes
    async cleanup continuations only; it does not add node construction,
    copying, wrapper surfaces, inheritance, or metadata mutation. Test-only
    construction adds one `RejectingAsyncAny` fixture instance to prove the
    rejection cleanup hole.
  - Render path: fallback render still resolves the same fallback node and
    renders through the resolved node's native render path. The change only
    ensures async fallback rejection restores `Context.referenceStack` instead
    of leaking the active reference frame.
  - Helper/API surface: net deletion. Async `JsExpression` fallback evaluation
    no longer carries duplicated success/error cleanup callbacks, and generic
    async fallback evaluation no longer carries a success-only cleanup callback.
    Both use promise `finally(...)` cleanup; no helper or public method was
    added. The test-only `Promise.reject(new Error(...))` is deliberate
    exceptional failure coverage, not routine hot-path error control.
  - Metadata mutations: no new mutations. Existing reference-stack restoration
    is now guaranteed on async fallback success or rejection.
  - Evidence: the new regression
    `restores reference stack when async fallback render rejects` failed before
    the fix with `Context.referenceStack === 1` after rejection. After the fix,
    `reference.test.ts` passed (`125` tests), the focused `reference`,
    `declaration`, `call`, and `mixin` family passed (`410` tests), and the
    broader lookup/materialization set passed (`694` passed, `9` skipped);
    touched TypeScript eslint passed; `git diff --check`, `pnpm run
    verify:aggressive-cutting-review` (with the documented test-only rejection
    fixture danger tokens), `pnpm run audit:node-creation`, `pnpm run
    prototype:binding-handle-reuse`, `pnpm --filter @jesscss/core build`, and
    `pnpm --filter jess build` passed. Direct stress render of
    `scope-lookup-stress.less` produced length `8822`.
    `measure:less:hotpath` completed as sanity only with unstable `functions`
    `16.47ms`, usable `import-reference` `22.74ms`, noisy `mixins-guards`
    `28.59ms`, noisy `extend-chaining` `13.33ms`, and usable `media`
    `6.44ms`, so this pass makes no speed claim.
  - Verdict: keep. This fixes a proven async cleanup leak and removes repeated
    fallback continuation plumbing without moving lookup/materialization
    boundaries.
- Raw reference async cleanup continuation pass: accepted as a narrow
  helper/API-surface cut in `Reference` raw lookup, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts` and this handoff.
  - New traversal: none. No loop, recursion, parent/source walk, child crawl,
    sort, side map, or array/object scan was added.
  - New node/materialization: none. The pass only changes async cleanup
    continuation shape; it does not add node construction, copying, wrapper
    surfaces, inheritance, or metadata mutation.
  - Render path: raw variable render still uses the same direct raw lookup
    sentinel and falls back to `evaluateReferenceNode(...)` on misses. Async
    branches now finalize the raw target value directly and restore
    `context.popReference()` through promise `finally(...)`; the sync branch is
    unchanged.
  - Helper/API surface: net deletion. Four duplicated success/error cleanup
    continuation pairs in `resolveRawReferenceLookupTarget(...)` were replaced
    with direct raw-finalization continuations plus `finally(...)` cleanup. No
    helper or public method was added.
  - Metadata mutations: no new mutations. Existing reference-stack restoration
    remains required and is now expressed once per async branch.
  - Evidence: focused `reference`, `declaration`, `call`, and `mixin` tests
    passed (`409` tests); the broader lookup/materialization set passed (`693`
    passed, `9` skipped); touched TypeScript eslint passed; `git diff --check`,
    `pnpm run verify:aggressive-cutting-review`, `pnpm run
    audit:node-creation`, `pnpm run prototype:binding-handle-reuse`,
    `pnpm --filter @jesscss/core build`, and `pnpm --filter jess build`
    passed. Direct stress render of `scope-lookup-stress.less` produced length
    `8822`. `measure:less:hotpath` completed as sanity only with usable
    `functions` `14.69ms`, usable `import-reference` `20.62ms`,
    usable `mixins-guards` `19.13ms`, usable `extend-chaining` `5.53ms`,
    and usable `media` `6.83ms`, so this pass makes no speed claim.
  - Verdict: keep. This removes repeated async raw-lookup continuation
    plumbing while preserving the existing lookup and fallback boundaries.
- Raw reference render predicate dedupe pass: accepted as a narrow hot-path
  predicate cut in `Reference.render(...)`, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts` and this handoff.
  - New traversal: none. No loop, recursion, parent/source walk, child crawl,
    sort, side map, or array/object scan was added.
  - New node/materialization: none. The pass only deletes duplicate
    static/rules-like predicates; it does not add node construction, copying,
    wrapper surfaces, inheritance, or metadata mutation.
  - Render path: unchanged. Direct raw variable rendering still accepts only
    static, non-rules-like nodes; that fact is now checked through
    `canReturnReferenceValue(...)`.
  - Helper/API surface: net deletion. No helper was added; existing predicate
    ownership replaces repeated condition fragments.
  - Metadata mutations: none added or moved.
  - Evidence: focused `reference`, `declaration`, `call`, and `mixin` tests
    passed (`409` tests); the broader lookup/materialization set passed (`693`
    passed, `9` skipped); touched TypeScript eslint passed; `git diff --check`,
    `pnpm run verify:aggressive-cutting-review`, `pnpm run
    audit:node-creation`, `pnpm run prototype:binding-handle-reuse`,
    `pnpm --filter @jesscss/core build`, and `pnpm --filter jess build`
    passed. Direct stress render of `scope-lookup-stress.less` produced length
    `8822`. `measure:less:hotpath` completed as sanity only with unstable
    `functions` `16.12ms`, noisy `import-reference` `22.88ms`,
    `mixins-guards` `20.36ms`, `extend-chaining` `5.56ms`, and unstable
    `media` `6.39ms`, so this pass makes no speed claim.
  - Verdict: keep. This removes repeated hot-path condition checks while
    preserving the same raw-render boundary.
- Runtime-binding render-text flag deletion pass: accepted as a narrow
  helper/API-surface cut in `Reference` runtime binding finalization, not as a
  speed claim. Files: `packages/core/src/tree/reference.ts` and this handoff.
  - New traversal: none. No loop, recursion, parent/source walk, child crawl,
    sort, side map, or array/object scan was added.
  - New node/materialization: none. The pass deletes a flag and branches; it
    does not add node construction, copying, wrapper surfaces, inheritance, or
    metadata mutation.
  - Render path: unchanged. Runtime binding evaluation already always set
    `REF_EVAL_REUSE_SOURCE_FREE`, and the removed render-text flag only fed the
    same static-value reuse branch. Fallback text rendering still keeps its
    semantic `textOnly` handling.
  - Helper/API surface: net deletion. Removed `REF_EVAL_REUSE_RENDER_TEXT`,
    removed the `textOnly` parameter from
    `finalizeRuntimeVarBindingResult(...)`, and collapsed a redundant
    static-value return branch into the common return.
  - Metadata mutations: none added or moved.
  - Evidence: focused `reference`, `declaration`, `call`, and `mixin` tests
    passed (`409` tests); the broader lookup/materialization set passed (`693`
    passed, `9` skipped); touched TypeScript eslint passed; `git diff --check`,
    `pnpm run verify:aggressive-cutting-review`, `pnpm run
    audit:node-creation`, `pnpm run prototype:binding-handle-reuse`,
    `pnpm --filter @jesscss/core build`, and `pnpm --filter jess build`
    passed. Direct stress render of `scope-lookup-stress.less` produced length
    `8822`. `measure:less:hotpath` completed as sanity only with noisy
    `functions` `18.85ms`, noisy `import-reference` `21.85ms`,
    `mixins-guards` `19.40ms`, unstable `extend-chaining` `5.66ms`, and
    unstable `media` `6.26ms`, so this pass makes no speed claim.
  - Verdict: keep. This leaves `textOnly` only at fallback/direct render
    boundaries where it still changes behavior.
- Direct/fallback/runtime reference private-mode deletion pass: accepted as a
  narrow helper/API-surface cut in `Reference` finalization, not as a speed
  claim. Files: `packages/core/src/tree/reference.ts` and this handoff.
  - New traversal: none. No loop, recursion, parent/source walk, child crawl,
    sort, side map, or array/object scan was added.
  - New node/materialization: none. The pass does not add node construction,
    copying, wrapper surfaces, inheritance, or metadata mutation.
  - Render path: unchanged. Text-only render still reaches the same resolved
    node; `textOnly` remains only where it avoids fallback container/JS
    expression materialization or sets runtime-binding eval flags.
  - Helper/API surface: net deletion. `evaluateFallbackValue(...)` drops an
    unused `Reference` parameter; direct reference/node finalization drops an
    unused `textOnly` parameter; runtime-binding finalization drops a redundant
    branch that returned the same evaluated node as fallthrough.
  - Metadata mutations: none added or moved.
  - Evidence: focused `reference`, `declaration`, `call`, and `mixin` tests
    passed (`409` tests); the broader lookup/materialization set passed (`693`
    passed, `9` skipped); touched TypeScript eslint passed; `git diff --check`,
    `pnpm run verify:aggressive-cutting-review`, `pnpm run
    audit:node-creation`, `pnpm run prototype:binding-handle-reuse`,
    `pnpm --filter @jesscss/core build`, and `pnpm --filter jess build`
    passed. Direct stress render of `scope-lookup-stress.less` produced length
    `8822`. `measure:less:hotpath` completed as sanity only with `functions`
    `15.23ms`, unstable `import-reference` `22.05ms`, `mixins-guards`
    `20.02ms`, `extend-chaining` `5.71ms`, and unstable `media` `6.22ms`, so
    this pass makes no speed claim.
  - Verdict: keep. This deletes misleading private-mode plumbing while leaving
    the still-semantic `textOnly` behavior explicit at the remaining call
    sites.
- Merged declaration reference private-mode deletion pass: accepted as a
  narrow helper/API-surface cut in `Reference` declaration finalization, not as
  a speed claim. Files: `packages/core/src/tree/reference.ts` and this handoff.
  - New traversal: none. No loop, recursion, parent/source walk, child crawl,
    sort, side map, or array/object scan was added.
  - New node/materialization: none. The pass does not add `new Node`,
    `copyWithReusableLeaves(...)`, `.inherit(...)`, wrapper rules, or metadata
    mutation. The existing merged-declaration `normalized.inherit(referenceNode)`
    boundary remains unchanged.
  - Render path: unchanged. Render-only declaration references still return the
    evaluated value directly for non-merged declarations; merged references keep
    the existing public normalization path.
  - Helper/API surface: net deletion. The private
    `finalizeDeclarationReferenceResult(...)` no longer accepts an unused
    `textOnly` parameter, and `normalizeMergedAssignReferenceResult(...)` no
    longer accepts a boolean that was always true at its only call site.
  - Metadata mutations: unchanged except for removing dead branches before the
    existing merged inherit boundary.
  - Evidence: focused `reference`/`declaration` tests passed (`189` tests);
    the broader lookup/materialization set passed (`693` passed, `9` skipped);
    touched TypeScript eslint passed; `git diff --check`, `pnpm run
    verify:aggressive-cutting-review`, `pnpm run audit:node-creation`,
    `pnpm run prototype:binding-handle-reuse`, `pnpm --filter @jesscss/core
    build`, and `pnpm --filter jess build` passed. Direct stress render of
    `scope-lookup-stress.less` produced length `8822`. `measure:less:hotpath`
    completed as sanity only with `functions` `15.21ms`, `import-reference`
    `21.37ms`, `mixins-guards` `19.28ms`, `extend-chaining` `5.66ms`, and
    noisy `media` `6.54ms`, so this pass makes no speed claim. The danger
    tokens are prosecuted here: they are handoff prose documenting no new copy
    or inherit plus the unchanged existing merged inherit boundary.
  - Verdict: keep. This removes misleading private-mode plumbing while leaving
    the still-real merged public materialization boundary visible for the next
    cut.
- Mixin/ruleset target materialization inherit deletion pass: accepted as a
  narrow duplicate-metadata mutation cut in `Reference` target lookup, not as a
  speed claim. Files: `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`, and this handoff.
  - New traversal: none. No loop, parent/source walk, child crawl, sort,
    generator, side-map lookup, or object/array scan was added.
  - New node/materialization: none. The pass deletes one
    `rules.inherit(sourceRules)` call after `sourceRules.eval(context)`.
    `Node.evalStatic(...)` remains the owner of the one required inheritance
    when eval returns a replacement rules surface.
  - Render path: unchanged. The target rules still evaluate before lookup and
    render receives the same resolved property value.
  - Helper/API surface: net deletion. No helper, public API, or compatibility
    shim was added.
  - Metadata mutations: reduced. Target materialization no longer re-stamps
    parent/source/location metadata after eval has already done so. The
    remaining inherit observed by the focused test is the eval-owned replacement
    inherit, not duplicate materialization work.
  - Evidence: focused `reference`, `mixin`, `declaration`, and `call` tests
    passed (`409` tests); the broader lookup/materialization set passed (`693`
    passed, `9` skipped); touched TypeScript eslint passed; `git diff --check`,
    `pnpm run verify:aggressive-cutting-review`, `pnpm run
    audit:node-creation`, `pnpm run prototype:binding-handle-reuse`,
    `pnpm --filter @jesscss/core build`, and `pnpm --filter jess build`
    passed. New coverage stores a `Mixin` in a variable, indexes through that
    target, renders `out: green`, and proves the target rules inherit from
    source rules exactly once. Direct stress render of
    `scope-lookup-stress.less` produced length `8822`; `measure:less:hotpath`
    completed as sanity only with noisy/unstable cases, so this pass makes no
    speed claim. The danger tokens are prosecuted here: the runtime diff deletes
    an `inherit`, and the test-only `try` restores a monkeypatched prototype.
  - Verdict: keep. This removes duplicate metadata stamping for direct
    mixin/ruleset reference targets while preserving eval-owned replacement
    ownership.
- Lazy unchanged list/sequence eval array pass: accepted as a narrow public
  materialization shrink for `Reference`-adjacent `List`/`Sequence` values, not
  as a speed claim. Files:
  `packages/core/src/tree/util/evaluate-node-array.ts`,
  `packages/core/src/tree/list.ts`,
  `packages/core/src/tree/__tests__/list.test.ts`,
  `packages/core/src/tree/__tests__/sequence.test.ts`, and this handoff.
  - New traversal: one prefix-copy loop runs only after the first evaluated
    child differs from the source child. It replaces the previous unconditional
    full-array allocation plus caller-side full identity scan for unchanged
    `List` eval. `Sequence` still performs its existing finalize scan because
    Nil filtering and single-item collapse are semantic public materialization
    behavior.
  - New node/materialization: none. The pass deletes unchanged-case evaluated
    array allocation; it does not add `Node`, wrapper `Rules`, copied node,
    `.inherit(...)`, `.adopt(...)`, `copyWithReusableLeaves(...)`, frozen/source
    metadata, or public result materialization.
  - Render path: unchanged. Render already stringifies directly and does not
    route through this public eval materialization path.
  - Helper/API surface: no new helper or public API. The existing shared
    `evaluateNodeArraySync(...)`/`evaluateNodeArrayMaybe(...)` utility now
    returns the original child array when evaluation is identity-preserving.
  - Metadata mutations: none. No parent/source restoration, lazy context
    creation, structural probe, side map, or defensive metadata read was added.
  - Evidence: focused `list`, `sequence`, `reference`, `declaration`, and
    `call` tests passed (`351` tests), and touched-file eslint passed. New
    tests prove dynamic-but-unchanged list and sequence public resolve return
    the source surface without calling replacement-surface constructors.
    Broader materialization/lookup suite passed (`list`, `sequence`,
    `reference`, `declaration`, `call`, `import-style`, `mixin`,
    `scope-frame`, `rules`, and `detached-rulesets`: `692` passed, `9`
    skipped). `pnpm run verify:aggressive-cutting-review` passed with danger
    tokens prosecuted here; `pnpm run audit:node-creation` passed;
    `git diff --check` passed; `pnpm run prototype:binding-handle-reuse`
    passed; `pnpm --filter @jesscss/core build` and `pnpm --filter jess build`
    passed; direct stress render returned `8822`;
    `pnpm run measure:less:hotpath` passed as sanity only with usable medians
    for `functions` `12.80ms`, `import-reference` `16.49ms`,
    `mixins-guards` `16.63ms`, and `extend-chaining` `4.87ms`; `media` was
    unstable. Danger-token prosecution: the runtime prefix-copy loops execute
    only after a changed child proves a replacement array is needed; the new
    `Error`/`try` sites are test-only monkeypatch restoration; the runtime diff
    adds no copy/inherit/adopt/frozen machinery.
  - Verdict: keep. This removes allocation and identity-scan work from the
    unchanged public eval case while leaving real changed-child ownership and
    sequence finalization semantics intact.
- Generic declaration/function `Rules.find(...)` deletion pass: accepted as
  deleting one string-dispatch wrapper and replacing the one internal bridge
  caller with typed lookup methods. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/util/registry-utils.ts`,
  focused tests/prototype callers, `docs/future/core-architecture/HANDOFF.md`,
  and `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: none. The existing `_searchRulesChildren(...)` recursion
    remains the only child-surface traversal; this pass changes its dispatch
    from `r.node.find(type, ...)` to the typed `findMixin(...)` or
    `findDeclaration(...)` method for the lookup family it had already
    selected.
  - New node/materialization: none. No `Node`, wrapper `Rules`, copy,
    `.inherit(...)`, `.adopt(...)`, source/root metadata, array
    materialization, or public materialized result was added.
  - Render path: unchanged. The cut touches lookup dispatch and test/prototype
    callers only; render still receives the same resolved nodes.
  - Helper/API surface: net deletion. Removed the generic declaration/function
    `Rules.find(...)` overload/method and added no helper or public
    compatibility shim.
  - Metadata mutations: none. No parent restoration, `frozen`, source
    inheritance, lazy context creation, structural probe, or side-map state was
    added.
  - Evidence: focused core lookup suite passed (`rules`,
    `detached-rulesets`, `import-style`, `reference`, and `call`: `389`
    passed, `9` skipped) after the child bridge was switched to typed methods.
    Broader lookup suite passed (`reference`, `declaration`, `call`,
    `import-style`, `mixin`, `scope-frame`, `rules`, and
    `detached-rulesets`: `608` passed, `9` skipped). The touched SCSS parser
    case passed directly; the full SCSS baseline has an unrelated existing
    `@at-root` AST parent mismatch and was not folded into this lookup pass.
    Touched-file eslint passed after indentation cleanup.
    `pnpm run prototype:binding-handle-reuse` passed; `pnpm run
    verify:aggressive-cutting-review` passed with the one danger token coming
    from this self-prosecution text; `pnpm run audit:node-creation` passed;
    `git diff --check` passed; `pnpm --filter @jesscss/core build` and
    `pnpm --filter jess build` passed; direct stress render returned `8822`;
    `pnpm run measure:less:hotpath` passed as sanity only with usable
    `mixins-guards` `20.43ms` and `extend-chaining` `5.88ms`, while
    `functions`, `import-reference`, and `media` were unstable. Danger-token
    prosecution: no runtime danger tokens were introduced by this deletion.
  - Verdict: keep. The remaining declaration/function work is now the actual
    typed-method registry fallback, not a self-invented stringly public-looking
    wrapper.
- Static declaration/property reference handle pass: accepted as widening the
  existing `Reference` lookup-handle identity path for already-covered
  unfiltered declaration/property lookups, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`.
  - New traversal: none. The pass reuses the existing handle read/write checks
    and existing `buildReferenceLookupOptions(...)` logic to carry lookup
    shape. It adds no parent/source walk, child crawl, sort, generator,
    side-map lookup, or collection scan.
  - New node/materialization: none in production. The added test nodes are
    focused fixture setup only. No `Node`, wrapper `Rules`, declaration output,
    merge-chain output, public materialization, copy, ownership inheritance,
    adoption, or frozen/source metadata was added to runtime code.
  - Render path: unchanged. The handle stores lookup result identity only;
    existing finalization/render still owns value evaluation and output.
  - Helper/API surface: one module-local helper,
    `getRulesLookupHandleShape(...)`, was added so contextual declaration and
    property handles reuse only when `start`, `local`, and
    `ignoreParentScopeStart` match. No public API was added.
  - Metadata mutations: none. No parent/source restoration, lazy context/options
    creation beyond the existing lookup-options builder, generic defensive
    read, or structural probe was added.
  - Evidence: focused `reference.test.ts` passed (`123` tests), and broader
    lookup-adjacent tests passed (`reference`, `declaration`, `call`,
    `import-style`, `mixin`, and `scope-frame`: `528` passed, `1` skipped).
    New tests prove repeated static property references call
    `Rules.findProperty(...)` once, repeated static declaration references call
    `Rules.findDeclaration(...)` once, and both rediscover after
    `Rules.lookupVersion` changes. `pnpm run prototype:binding-handle-reuse`
    passed; touched-file eslint passed; `pnpm run verify:aggressive-cutting-review`
    passed with danger tokens prosecuted here; `pnpm run audit:node-creation`
    passed; `git diff --check` passed; `pnpm --filter @jesscss/core build`
    passed; direct stress render returned `8822`; `pnpm --filter jess build`
    repaired the local package build edge for the benchmark; `pnpm run
    measure:less:hotpath` passed as sanity only with usable medians for
    `import-reference` `20.12ms`, `mixins-guards` `19.05ms`, and
    `extend-chaining` `5.60ms`; `functions` and `media` were unstable.
    Danger-token prosecution: the two added `try/finally` blocks are test-only
    monkeypatch restoration, and `RulesLookupHandleShape` is a type-only lookup
    identity shape plus one short-lived runtime object carrying existing
    lookup-option facts, not a side registry or value cache.
  - Verdict: keep. This removes repeated terminal binding rediscovery for
    covered declaration/property reference handles without touching semantic
    filtered merge-chain lookup or adding a registry-shaped side map.
- Static function reference handle pass: accepted as widening the existing
  `Reference` lookup-handle identity path, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`. New traversal:
  none. The pass reuses the existing handle read/write checks and adds no
  parent/source walk, child crawl, sort, generator, side-map lookup, or object
  scan. New node/materialization: none; no `Node`, wrapper `Rules`, function
  output, public materialization, copy, `.inherit(...)`, `.adopt(...)`, or
  frozen/source metadata was added. Render path: unchanged; the handle stores
  lookup result identity only and finalization/render remain on the existing
  path. Helper/API surface: no new helper or public API; the existing
  `ReferenceRulesLookupHandle` union now admits `function` for covered static
  string-key function references. Metadata mutations: no parent/source
  restoration, lazy context/options creation, `Reflect.*`, `Object.hasOwn(...)`,
  or structural probe added. Evidence: focused `reference.test.ts` passed
  (`121` tests), including a new proof that repeated static function
  references call `Rules.findFunction(...)` once, reuse the handle on the
  second eval, and rediscover after `Rules.lookupVersion` changes; focused
  `reference.test.ts call.test.ts` passed (`200` tests);
  `pnpm run prototype:binding-handle-reuse` passed; touched-file eslint
  passed; `pnpm run verify:aggressive-cutting-review` passed with danger tokens
  prosecuted here; `pnpm run audit:node-creation` passed; `git diff --check`
  passed; `pnpm --filter @jesscss/core build` passed; direct stress render
  returned `8822`; `pnpm run measure:less:hotpath` passed as sanity only with
  usable medians for `functions` `15.20ms`, `import-reference` `21.36ms`, and
  `mixins-guards` `20.53ms`; `extend-chaining` and `media` were noisy. No
  performance claim until a measured before/after run targets this path.
  Danger-token prosecution: the added `new JsFunction(...)`, `rules([])`, and
  `try/finally` are test-only setup/restoration in the focused reference proof;
  the `.inherit(...)`, `.adopt(...)`, `Reflect.*`, and `Object.hasOwn(...)`
  matches are literal text in this prosecution paragraph, not production code.
- Filtered property merge-chain modeling pass: accepted as a documented
  no-op/rejection boundary, not as a runtime speed claim. Files:
  `docs/future/core-architecture/HANDOFF.md` and
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`. New traversal:
  none kept. A rejected prototype briefly populated `directDeclarationsByName`
  during declaration registration, but it was removed because it conflated
  registration-time declaration occurrence facts with the existing lazy
  current-`Rules.value` scan cache and broke merge/property lookup semantics.
  New node/materialization: none. Render path: unchanged. Helper/API surface:
  none added. Metadata mutations: none. Routine error/control: no new
  thrown/caught errors, sentinel paths, or expected-miss objects were added.
  Evidence: forced direct declaration focused tests passed with
  `JESS_DIRECT_DECLARATION_LOOKUP=1 pnpm --filter @jesscss/core test --
  declaration.test.ts reference.test.ts` (`185` passed);
  `pnpm run verify:aggressive-cutting-review` passed with no scoped-diff
  danger tokens; `pnpm run audit:node-creation` passed; `git diff --check`
  passed; `pnpm --filter @jesscss/core build` passed; direct stress render
  returned `8822`; `pnpm run measure:less:hotpath` passed as sanity only with
  usable medians for `functions` `14.73ms`, `import-reference` `20.04ms`,
  `mixins-guards` `19.00ms`, and `extend-chaining` `5.73ms`; `media` was
  unstable at `6.18ms`. Rejected broader cut: semantic filtered property merge
  lookups cannot leave `DeclarationRegistry` until property declaration
  occurrence/merge-anchor facts are represented in the binding frame; adding
  another name-index side map would recreate the registry shape this lane is
  deleting.
- Production callable binding-handle pass: accepted as the first production
  slice of the brought-forward binding/index queue, not as completion of the
  whole handle system. Files: `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/rules.ts`, and
  `packages/core/src/tree/__tests__/reference.test.ts`. New traversal: none in
  production lookup. The pass adds handle read/write guard helpers, but those
  only compare already-carried scalar facts and original key identity before
  the existing lookup. No parent/source walk, child crawl, recursive scan,
  sort, generator, or new collection scan was added. New state: one
  `Reference`-owned `_rulesLookupHandle` and one `Rules.lookupVersion`.
  `lookupVersion` is bumped at the existing `registerNode(...)` invalidation
  edge that already clears callable/declaration caches; it is semantic lookup
  identity, not a value cache. New node/materialization: none; no `Node`,
  wrapper `Rules`, `MixinCollection`, copy, `.inherit(...)`, `.adopt(...)`,
  frozen state, source/parent metadata mutation, evaluated value cache,
  rendered-text cache, mixin output cache, or public materialization cache was
  added. Render path: unchanged; the handle stores lookup result identity only,
  and existing finalization/render still owns materialization/stringification.
  Helper/API surface: three module-local helpers and one internal handle type
  were added to avoid rediscovering callable identity on repeated static
  references; no public API was added. Metadata mutations: no parent/source
  restoration, lazy context/options creation, `Reflect.*`, or
  `Object.hasOwn(...)` added. Evidence: focused `reference.test.ts` passed
  (`116` tests); callable/import-adjacent suites passed (`252` passed, `1`
  skipped); targeted eslint on touched files passed; `@jesscss/core` build
  passed; `pnpm run prototype:binding-handle-reuse` passed with semantic
  assertions and counters dropping from `1,500,000` path / `500,000`
  declaration rediscoveries to `3` path / `1` declaration lookup in the model;
  `audit:node-creation` reported `reference.ts` at `17` creation/copy
  surfaces. Hotpath leash was status only, not a speed claim: `functions`
  median `15.75ms` usable, `mixins-guards` `18.44ms` usable,
  `import-reference` `19.32ms` unstable, `extend-chaining` `5.40ms` unstable,
  and `media` `5.35ms` unstable. Full package lint still has unrelated
  pre-existing failures outside this patch; touched-file lint passed. The
  remaining diff `try/finally` is test-only monkeypatch restoration for
  `Rules.findMixin(...)`, not production lookup miss/error control.
- Active binding lane completion: accepted as completing the remaining lookup
  architecture queue through documentation and a standalone binding-handle
  prototype, not as a production runtime speed claim. Files:
  `scripts/prototype-binding-handle-reuse.mjs`, `package.json`,
  `docs/future/core-architecture/HANDOFF.md`,
  `docs/future/core-architecture/BINDING-INDEX-PROPOSAL.md`, and
  `docs/future/core-architecture/PERFORMANCE-HANDOFF.md`. New traversal: none
  in production. The prototype has explicit path/declaration lookup loops to
  compare rediscovery against handle reuse; those loops are isolated in
  `scripts/` and are the measured model, not runtime code. New
  node/materialization: none in production; the prototype uses plain JS
  objects/maps for model scopes, declarations, counters, and handles, with no
  AST `Node`, `Rules`, copy, `.inherit(...)`, `.adopt(...)`, output cache, or
  public materialization cache. Render path: unchanged. Helper/API surface:
  one package script and one standalone prototype script were added; no runtime
  helper/API surface was added. Metadata mutations: none in production; the
  prototype increments model scope versions to prove handle invalidation shape.
  Routine error/control: prototype assertions throw on impossible model
  failures only, not expected lookup misses in runtime. Evidence:
  `pnpm run prototype:binding-handle-reuse` passed semantic assertions and
  showed path/declaration rediscovery dropping from `1,500,000`/`500,000` to
  `3`/`1` for `500,000` references, with median `12.149ms` vs `3.521ms`. A
  smaller `50,000` reference run also passed and showed `150,000`/`50,000` to
  `3`/`1`, median `1.145ms` vs `0.354ms`. This completes the active binding
  lane as a design/prototype queue, while production handle wiring remains a
  future implementation lane.
- Generic mixin find wrapper deletion: accepted as deleting a stringly
  compatibility lookup surface, not a speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/__tests__/mixin.test.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `packages/core/src/tree/__tests__/import-style.test.ts`, and this handoff.
  New traversal: none. New node/materialization: no production node or array
  materialization added; the diff-added empty-array literal is the retained
  existing miss fixture, now routed through `findMixin(...)` instead of the
  deleted generic wrapper. Render path: unchanged. Helper/API surface: deleted
  the `Rules.find('mixin', ...)` overload and switch arm; tests and helpers now
  use the typed `Rules.findMixin(...)` entry directly. The remaining generic
  `Rules.find` switch is limited to declaration/function lookup and no longer
  presents a callable compatibility branch to preserve. Metadata mutations:
  none. Routine error/control: removed the mixin branch and did not add
  throw/catch/Error paths. Evidence: `rg` found no remaining `find('mixin',
  ...)` runtime/test call sites under `packages` or `scripts`; package-scoped focused
  lookup-adjacent tests passed (`471` passed, `9` skipped). No runtime speed
  claim without benchmark/profile proof.
- Legacy `MixinRegistry` shim deletion: accepted as compatibility-only lookup
  scaffolding removal, not a speed claim. Files:
  `packages/core/src/tree/util/registry-utils.ts`,
  `packages/core/src/tree/__tests__/mixin.test.ts`,
  `packages/core/src/tree/__tests__/reference.test.ts`,
  `packages/core/src/tree/__tests__/import-style.test.ts`, and this handoff.
  New traversal: none. New node/materialization: no production node or array
  materialization added; the diff-added `TreeContext` constructor calls are
  retained test setup exposed by removing the surrounding monkeypatch
  `try/finally`, and the empty-array literal is the retained miss fixture for
  empty mixin-array lookup. Render path: unchanged. Helper/API
  surface: deleted the internal `MixinRegistry` export outright instead of
  keeping a no-hit class solely so tests could monkeypatch
  `MixinRegistry.prototype.find`; the touched tests now assert the lookup
  behavior directly instead of preserving the old registry probe surface.
  Metadata mutations: none. Routine error/control: no throw/catch/Error path
  added. Evidence: package-scoped focused lookup-adjacent tests passed (`471`
  passed, `9` skipped). The first broad root-run command also executed the
  package project successfully but failed in the root project because those
  files were loaded without test globals/matchers; the package-scoped rerun is
  the relevant gate. No runtime speed claim without benchmark/profile proof.
- Unreleased mixin registry surface deletion: accepted as deleting
  self-invented registry/callable API surface, not a speed claim. Files:
  `AGENTS.md`, `docs/future/core-architecture/HANDOFF.md`,
  `packages/core/src/tree/rules.ts`, and
  `packages/core/src/tree/__tests__/mixin.test.ts`. New traversal: none. New
  node/materialization: none. Render path: unchanged. Helper/API surface:
  deleted `Rules.register('mixin', ...)`, `Rules.getRegistry('mixin')`, and
  `Rules.findMixinsDirect(...)`; these were unreleased/transitional
  public-looking methods, not approved stable API. The repo guidance now says
  to delete unreleased/self-invented public-looking lookup surfaces after usage
  checks instead of preserving no-op compatibility shims. Metadata mutations:
  deleted the last mixin-registry branch that could allocate a cold
  `MixinRegistry` object through `Rules.getRegistry('mixin')`. Routine
  error/control: no throw/catch/Error path added. Evidence: focused mixin
  tests passed (`138` tests), the expanded lookup-adjacent suite passed (`551`
  passed, `9` skipped), eslint passed for `rules.ts`/`mixin.test.ts`, docs
  eslint produced only ignored-file warnings, and `@jesscss/core` build passed
  with the existing `src/tree/js-expr.ts` direct-eval warning. The first
  expanded-suite attempt failed only because it ran concurrently with build
  cleaning `packages/core/lib`. No runtime speed claim without
  benchmark/profile proof.
- Callable namespace descendant result allocation cut: accepted as lazy miss-path
  allocation deletion, not a speed claim. File: `packages/core/src/tree/rules.ts`
  and this handoff. New traversal: none; `findCallableDescendantsWithinMixinNamespaces(...)`
  keeps the same namespace-mixin loop but creates the `resolved` array only
  after a nested lookup returns at least one descendant hit. Misses, non-mixin
  entries, and namespace mixins with required params now return `undefined`
  without allocating an empty result array. New node/materialization: no new
  materialization; the returned result array already existed, and this pass
  moves it from eager allocation to lazy allocation only for real descendant
  hits. Render path: unchanged. Helper/API surface: no helper added and no
  public API changed. Metadata mutations: none. Routine error/control: no
  throw/catch/Error path added. Evidence: focused mixin tests passed (`139`
  tests), the expanded lookup-adjacent suite passed (`552` passed, `9`
  skipped), eslint passed for `rules.ts`, and `@jesscss/core` build passed with
  the existing `src/tree/js-expr.ts` direct-eval warning. Review danger token:
  `resolved ??= []` is the kept return array allocated only after a hit,
  replacing the previous eager `const resolved = []` miss-path allocation. No
  runtime speed claim without benchmark/profile proof.
- ScopeFrame callable hit scan cut: accepted as duplicate bucket-scan deletion,
  not a speed claim. File: `packages/core/src/tree/scope-frame.ts` and this
  handoff. New traversal: none; `lookupScopeFrameCallable(...)` now uses one
  reverse bucket scan to prove that an exact callable hit exists under the
  requested ruleset filter, instead of scanning once for any exact hit and then
  scanning again for non-ruleset exact hits. The caller still owns result
  collection from the same bucket, so behavior and ordering remain unchanged.
  New node/materialization: none. Render path: unchanged. Helper/API surface:
  no helper added and no public API changed. Metadata mutations: none.
  Routine error/control: no throw/catch/Error path added. Evidence: focused
  callable/scope tests passed (`152` tests), the expanded lookup-adjacent
  suite passed (`552` passed, `9` skipped), eslint passed for
  `scope-frame.ts`, `@jesscss/core` build passed with the existing
  `src/tree/js-expr.ts` direct-eval warning, and the first expanded suite
  attempt failed only because it ran concurrently with build cleaning
  `packages/core/lib`. No runtime speed claim without benchmark/profile proof.
- Callable namespace singleton-sort guard: accepted as unnecessary sort-call
  deletion, not a speed claim. Files: `packages/core/src/tree/rules.ts` and
  this handoff. New traversal: none; the existing ruleset-prefix match arrays
  in `findRulesetNamespacePathFast(...)` and
  `findCompoundPrefixCallableRulesetPathFast(...)` now call `.sort(...)` only
  when more than one prefix candidate exists. Ordering semantics are unchanged:
  zero matches already returned before the sort, one match has no ordering work
  to perform, and multi-match paths keep the existing consumed-length sort.
  New node/materialization: none; no AST node, wrapper `Rules`, array, side
  map, result cache, or output object was added. Render path: unchanged.
  Helper/API surface: no helper or public API was added. Metadata mutations:
  none. Routine error/control: no throw/catch/Error path added. Evidence:
  focused `mixin.test.ts` and `reference.test.ts` passed (`253` tests);
  expanded lookup-adjacent suite passed (`551` tests, `9` skipped);
  `pnpm exec eslint packages/core/src/tree/rules.ts`, `git diff --check`,
  `pnpm --filter @jesscss/core build`, and
  `pnpm run verify:aggressive-cutting-review` passed. The aggressive review
  script flagged the guarded `.sort(...)` lines as array-helper danger tokens;
  they are prosecuted here as existing sort calls that now skip the singleton
  candidate case, not new ordering work. No runtime speed claim without
  benchmark/profile proof.
- Callable path splitter regex removal: accepted as hot string-lookup
  allocation deletion, not a speed claim. Files:
  `packages/core/src/tree/rules.ts` and this handoff. New traversal: one small
  manual scan replaces the previous `key.match(/[#.][^#.]+/g)` regex scan in
  `splitStaticCallablePathKey(...)`. The scan runs in the same string-key
  lookup branch that already probed for static namespace paths, but it now
  carries only first-segment offsets until a second valid selector segment is
  found, so ordinary one-segment callable names return without regex match
  allocation or result-array allocation. New node/materialization: none; no AST
  node, wrapper `Rules`, side map, result cache, or output object was added.
  The only array allocation remains the real multi-segment static path result
  that callers already consumed. Render path: unchanged. Helper/API surface: no
  helper or public API was added. Metadata mutations: none. Routine
  error/control: no throw/catch/Error path added. Evidence: focused
  `mixin.test.ts` and `reference.test.ts` passed (`253` tests);
  expanded lookup-adjacent suite passed (`551` tests, `9` skipped);
  `pnpm exec eslint packages/core/src/tree/rules.ts`, `git diff --check`,
  `pnpm --filter @jesscss/core build`, and
  `pnpm run verify:aggressive-cutting-review` passed. The aggressive review
  script flagged the scanner loop, `slice(...)` calls, `push(...)`, and lazy
  `out` array as danger tokens; they are prosecuted here as replacement work
  for the previous regex scan and regex-allocated match array, with the result
  array delayed until the caller has a real multi-segment static path. No
  runtime speed claim without benchmark/profile proof.
- Ruleset namespace child-option reuse pass: accepted as per-candidate object
  setup deletion, not a speed claim. Files:
  `packages/core/src/tree/rules.ts` and this handoff. New traversal: none; this
  pass keeps the existing ruleset-prefix loops and sort order, but the
  `findRulesetNamespacePathFast(...)` and
  `findCompoundPrefixCallableRulesetPathFast(...)` candidate loops now lazily
  create and reuse child lookup option objects instead of spreading
  `{ ...options, searchParents: false }` for every prefix candidate. The
  one-segment ruleset namespace branch also reuses one simple
  `findMixinsFast(...)` options object across eligible candidates. New
  node/materialization: none; no AST node, wrapper `Rules`, side map, result
  cache, or output object was added. The lazy option objects replace repeated
  per-candidate objects in the same existing lookup loops. Render path:
  unchanged. Helper/API surface: no helper or public API was added. Metadata
  mutations: none. Routine error/control: no throw/catch/Error path added.
  Evidence: focused mixin tests passed (`138` tests); expanded
  lookup-adjacent suite passed (`551` tests, `9` skipped);
  `pnpm exec eslint packages/core/src/tree/rules.ts`, `git diff --check`, and
  `pnpm --filter @jesscss/core build` passed. The aggressive review script
  flagged the lazy `simpleLookupOptions` and `nestedOptions` object literals as
  materialized-object danger tokens; they are prosecuted here as replacements
  for repeated per-candidate object spreads in existing lookup loops, not new
  lookup state or caches. No runtime speed claim without benchmark/profile
  proof.
- Callable namespace branch cleanup: accepted as lookup-path
  machinery deletion, not a speed claim. Files:
  `packages/core/src/tree/rules.ts` and this handoff. New traversal: none; this
  pass deleted a redundant `findMixinsDirect(...)` type assertion around the
  already typed `findMixin(...)` result and collapsed the compound-prefix
  ruleset namespace sort comparator to the consumed-length subtraction it
  already returned for every unequal case. Array-path mixin lookup now delays
  the first-segment exact ruleset namespace crawl until the namespace-mixin
  search proves there are no namespace mixins, and returns before the later
  namespace walk when both first-segment namespace starts and full-path exact
  ruleset matches are absent. Namespace-descendant lookup now creates the
  remainder path and child lookup options lazily, and reuses the options object
  across eligible namespace mixins instead of spreading per candidate. New
  node/materialization: none; no AST nodes, wrapper `Rules`, arrays, side maps,
  result caches, or output objects were added. Render path: unchanged.
  Helper/API surface: no helper or public API was added or widened; public
  compatibility methods remain in place. Metadata mutations: none. Routine
  error/control: no throw/catch/Error path added. Evidence: focused mixin tests
  passed (`138` tests); expanded lookup-adjacent suite passed (`551` tests,
  `9` skipped); `pnpm exec eslint packages/core/src/tree/rules.ts`,
  `git diff --check`, `pnpm --filter @jesscss/core build`, and
  `pnpm run verify:aggressive-cutting-review` passed. The aggressive review
  script flagged the simplified `.sort(...)`, lazy `remainder`, and lazy
  `nestedOptions` diff lines as danger tokens; they are prosecuted above as
  existing traversal/order work with less branch/object setup, not new lookup
  machinery. One parallel expanded-suite run failed while the concurrent build
  cleaned/rebuilt `packages/core/lib`, causing Vite to fail resolving
  `@jesscss/core`; the same suite passed when rerun after build completion.
  This pass intentionally avoids claiming runtime speed without
  benchmark/profile proof.
- Callable selector lookup preparation slimming pass: accepted as lookup-prep
  array/function-call deletion, not a speed claim. Files:
  `packages/core/src/tree/rules.ts` and this handoff. New traversal: none; the
  existing selector-key walk in `addDirectCallableSelectorEntries(...)` now
  loops the ordered keys once instead of allocating `candidateKeys` with
  `.filter(...)`, finding an index, and allocating another tail array with
  `.slice(...)`. Parent-prefix stripping now passes a start offset into the
  same helper instead of slicing the key array. `collectCallableEntriesForKeyFrom(...)`
  carries the first `getOrderedSelectorKeys(...)` result through to the caller
  instead of recomputing it solely after a length probe. Namespace continuation
  now calls `findMixin(...)` directly instead of routing through the generic
  `find('mixin', ...)` switch, and the one-segment continuation branch no
  longer allocates an inline IIFE closure. The two ruleset namespace child
  searches now use `directChildRuleEntries`/`collectDirectChildRulesEntries()`
  instead of raw `_rulesSet`, so scopes with no exact callable child surface can
  avoid the child-recursion path. Compound-prefix/namespace result merging now
  appends unique namespace hits into the fresh compound-prefix result array
  instead of allocating and copying into a second `combined` array. New
  node/materialization: none; deleted temporary arrays and a closure, and did
  not add AST nodes, wrapper `Rules`, side maps, result caches, or output
  objects. Render path: unchanged.
  Helper/API surface: no public API and no helper added; one existing private
  helper gained a start offset to remove array slicing at its call site.
  Metadata mutations: unchanged; reused the existing direct child-surface cache
  and visibility entries. Routine error/control: no throw/catch/Error path
  added. Evidence: focused mixin tests passed (`138` tests); expanded
  lookup-adjacent suite passed (`551` tests, `9` skipped); eslint passed.
  Performance was not measured, so no speed claim is made.
- Duplicate ruleset namespace retry deletion: accepted as redundant lookup
  deletion, not a speed claim. Files: `packages/core/src/tree/rules.ts` and
  this handoff. New traversal: none; deleted a second
  `findRulesetNamespacePathFast(keys, options)` call in array-path mixin lookup
  that used the same keys, options, and return condition as the earlier call in
  the same branch. New node/materialization: none; no AST node, wrapper
  `Rules`, side map, result cache, or output object was added. Render path:
  unchanged. Helper/API surface: no public API and no helper added. Metadata
  mutations: none. Routine error/control: no throw/catch/Error path added.
  Evidence: focused mixin tests passed (`138` tests); expanded
  lookup-adjacent suite passed (`551` tests, `9` skipped); eslint passed.
  Performance was not measured, so no speed claim is made.
- Ruleset namespace recursive accumulator pass: accepted as remaining
  namespace-bridge slimming, not a speed claim. Files:
  `packages/core/src/tree/rules.ts` and this handoff. New traversal: none; the
  existing reverse recursive child-surface walks in
  `findVisibleExactCallableRulesetPath(...)` and
  `findVisibleCallableRulesetPrefixMatches(...)` now append into one
  caller-owned result array instead of allocating one result array per
  recursive surface and copying nested results back up. The cycle guard `Set`
  is now allocated only after a surface actually has child entries to recurse
  into. New node/materialization: none; no AST node, wrapper `Rules`, side map,
  callable record, output cache, or miss bucket was added. Render path:
  unchanged. Helper/API surface: no public API and no new helper; the local
  recursive closures were reshaped in place. Metadata mutations: none. Routine
  error/control: no throw/catch/Error path added. Evidence: focused mixin tests
  passed (`138` tests); expanded lookup-adjacent suite passed (`551` tests,
  `9` skipped); eslint passed. Performance was not measured, so no speed claim
  is made.
- Registryless cache permanentization cleanup: accepted as hot-helper branch
  deletion and stale experiment-surface removal, not a speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `docs/future/core-architecture/HANDOFF.md`, and
  `docs/future/core-architecture/PERFORMANCE-HANDOFF.md`. New traversal: none.
  New node/materialization: none; no AST node, wrapper `Rules`, side registry,
  output cache, or materialized result array was added. Deleted the
  per-eligible-lookup `process.env.JESS_REGISTRYLESS_MIXIN_LAST_CACHE` read
  from `getRegistrylessMixinCacheKey(...)`, so the accepted one-entry scalar
  cache is now permanent runtime behavior instead of an env-gated experiment.
  Also deleted the unused private `getRegistrylessMixinCacheResult(...)`
  parameter left behind by the earlier Map-cache deletion. Render path:
  unchanged. Helper/API surface: no public API and no helper added; one private
  helper signature was narrowed. Metadata mutations: unchanged cache-field
  invalidation only. Routine error/control: no throw/catch/Error path added.
  Evidence: focused mixin tests passed (`138` tests); expanded
  lookup-adjacent suite passed (`551` tests, `9` skipped); eslint passed.
  Performance was not measured, so no speed claim is made.
- Mixin namespace descendant intermediate-array deletion: accepted as
  namespace lookup materialization removal, not a speed claim. Files:
  `packages/core/src/tree/rules.ts` and this handoff. New traversal: none; the
  existing forward loop over namespace mixin candidates now filters mixin nodes
  and required params inline instead of building `orderedNamespaceMixins` and
  looping it once. New node/materialization: none; one intermediate
  `Mixin[]` array was deleted. Render path: unchanged. Helper/API surface: no
  public API or helper added. Metadata mutations: none. Routine error/control:
  no throw/catch/Error path added. Evidence: focused mixin tests passed (`138`
  tests); expanded lookup-adjacent suite passed (`551` tests, `9` skipped);
  eslint passed. Performance was not measured, so no speed claim is made.
- Registryless mixin Map-cache experiment deletion: accepted as stale
  experiment removal, not a speed claim. Files:
  `packages/core/src/tree/rules.ts` and this handoff. New traversal: none.
  New node/materialization: none; deleted the `registrylessMixinLookupCache`
  `Map` field, its reset writes, and the `JESS_REGISTRYLESS_MIXIN_CACHE`
  branches in the cache helpers. The accepted one-entry scalar cache remains,
  and the later off-switch deletion pass removed its hot-path env read. Render
  path: unchanged. Helper/API surface: no public API
  or helper added; old private experiment surface was removed. Metadata
  mutations: fewer cache-field resets during clone/register invalidation.
  Routine error/control: no new throw/catch/Error path. Evidence: focused
  mixin tests passed (`138` tests); expanded lookup-adjacent suite passed
  (`551` tests, `9` skipped). Performance was not measured, so no speed claim
  is made.
- Callable fast lookup context-plumbing deletion: accepted as stale option
  removal, not a speed claim. File: `packages/core/src/tree/rules.ts` and
  this handoff. New traversal: none; `findMixinsFast(...)` already ignored
  `context`, so this pass deletes the unused option from the method shape and
  removes seven call-site forwards from string and namespace callable lookup.
  New node/materialization: none. Render path: unchanged. Helper/API surface:
  one private lookup option was deleted; no helper or public API was added.
  Metadata mutations: none. Routine error/control: no new throw/catch/Error
  path. Evidence: focused mixin tests passed (`138` tests); expanded
  lookup-adjacent suite passed (`551` tests, `9` skipped). Performance was not
  measured, so no speed claim is made.
- Callable child-bridge current-surface skip pass: accepted as duplicate-work
  removal inside a remaining bridge, not a speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/__tests__/mixin.test.ts`, and this handoff. New
  traversal: none; after `prepareCallableLookupFrame(...)` and
  `lookupScopeFrameCallable(...)` already probe the current frame's direct
  callable bucket, the `findMixinsFast(...)` bridge now enters with
  `skipCurrentSurface: true` and crawls only child surfaces for that first
  scope. Recursive child scopes still check their own direct callable surfaces
  in reverse order. New node/materialization: none in production; the updated
  test adds one boolean and reuses the existing spy hit array. No production
  node, wrapper, output cache, callable record, side map, or stored miss bucket
  was added. Render path: unchanged. Helper/API surface: no public API and no
  new helper; one private `findMixinsFast(...)` option narrows work at the two
  existing uncovered bridge call sites. Metadata mutations: none. Routine
  error/control: no new production throw/catch/Error path; existing test
  `try/finally` remains spy restoration. Evidence: focused mixin tests passed
  (`138` tests); expanded lookup-adjacent suite passed (`551` tests, `9`
  skipped). Performance was not measured, so no speed claim is made.
- Callable fallback-frame retry ownership pass: accepted as frame-ownership
  narrowing, not a speed claim. Files: `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/__tests__/mixin.test.ts`, and this handoff. New
  traversal: no new tree traversal; the existing retry loop now follows the
  parent frame chain first, then the current frame's fallback chain, matching
  the variable frame lookup shape instead of choosing `parent ?? fallback` and
  skipping the fallback whenever a parent exists. New node/materialization:
  none in production; the new test builds ordinary fixture `Rules`/`Mixin`
  nodes and a spy hit array only for proof. No production node, wrapper, output
  cache, callable record, side map, or stored miss bucket was added. Render
  path: unchanged. Helper/API surface: no new helper or public API. Metadata
  mutations: none; this only reads `fallbackFrame` already carried on
  `ScopeFrame`. Routine error/control: no production throw/catch/Error path;
  the new `try/finally` is test-only spy restoration. Evidence: new focused
  mixin fixture proves a parent miss reaches a fallback callable frame without
  calling `Rules.findMixinsFast(...)`; focused mixin tests passed (`138`
  tests); expanded lookup-adjacent suite passed (`551` tests, `9` skipped).
  Performance was not measured, so no speed claim is made.
- Callable child-surface bridge accumulator pass: accepted as remaining-bridge
  slimming, not a speed claim. File: `packages/core/src/tree/rules.ts` and
  this handoff. New traversal: none; the existing reverse recursive
  `findMixinsFast(...)` child-surface walk remains for still-unmodeled child
  lookup surfaces, but it now appends into one caller-owned result array
  instead of allocating a `MixinEntry[]` for each recursive scope and copying
  nested results back into the parent array. The cycle guard `Set` is now
  allocated only after the bridge actually sees child entries to recurse into,
  instead of once per top-level surface probe. New node/materialization: none;
  no production node, wrapper, side map, callable record, output cache, or miss
  bucket was added. Render path: unchanged. Helper/API surface: no public API
  and no new method; the local recursive closure was reshaped in place.
  Metadata mutations: none. Routine error/control: no new throw/catch/Error
  path. Evidence: focused mixin tests passed (`137` tests); expanded
  lookup-adjacent suite passed (`550` tests, `9` skipped). Performance was not
  measured, so no speed claim is made.
- Callable parent-frame lazy prep pass: accepted as lookup-state narrowing,
  not a speed claim. Files: `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/__tests__/mixin.test.ts`, and this handoff. New
  traversal: no new tree traversal; the existing parent/fallback frame retry
  loop now prepares only the frame it has reached and probes it with
  `searchParents: false`, instead of `prepareCallableLookupFrame(...)`
  eagerly preparing every parent for the requested key. Current-frame covered
  hits stop before touching parent callable buckets, proved by the new mixin
  fixture. New node/materialization: none; no production node, wrapper, output
  cache, callable record, side map, or stored miss bucket was added. Render
  path: unchanged. Helper/API surface: no new helper; private
  `prepareCallableLookupFrame(...)` lost its parent-walk/search option.
  Metadata mutations: fewer parent-frame callable bucket mutations for
  current-frame hits. The new `this.parent === undefined` read is not a parent
  mutation or ownership repair; it gates only the root covered-miss fast return
  so nested/body misses can keep the old `findMixinsFast(...)` bridge until
  direct frame parent ownership is complete. Routine error/control: no new
  throw/catch/Error path. Evidence: focused mixin tests passed (`137` tests);
  expanded lookup-adjacent suite passed (`550` tests, `9` skipped).
  Performance was not measured, so no speed claim is made.
- Callable exact-bucket helper deletion: accepted as intermediate array/helper
  removal, not a speed claim. Files: `packages/core/src/tree/rules.ts` and
  this handoff. New traversal: none; `findMixinsFast(...)` now filters exact
  callable entries directly from `getCallableEntriesForKey(...)` in the same
  reverse order, instead of calling `getDirectCallableExactBucket(...)` to
  allocate an intermediate `MixinEntry[]` and then looping it again. New
  node/materialization: no production node, wrapper, side map, output cache, or
  callable record was added; one intermediate array helper was deleted. Render
  path: unchanged. Helper/API surface: deleted private
  `getDirectCallableExactBucket(...)`. Metadata mutations: none. Routine
  error/control: no new throw/catch/Error path. Evidence: focused mixin tests
  passed (`136` tests).
- Callable empty-bucket sentinel cut: accepted as removal of miss-only cache
  storage, not a speed claim. Files: `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/__tests__/mixin.test.ts`, and this handoff. New
  traversal: none; `getCallableEntriesForKey(...)` still performs the existing
  direct callable scan when a frame shortcut prepares a key, but it no longer
  writes an empty `CallableLookupEntry[]` into `callableLookupCache` for a
  covered miss. Covered miss identity remains on `ScopeFrame.callableMissesCovered`.
  New node/materialization: no production node, wrapper, output cache, or
  callable record was added. The callable cache map write remains only for
  non-empty hit buckets; the prior empty miss bucket is no longer stored. One
  temporary bucket array still exists during the existing scan and is returned
  to the caller; this pass removes storage of empty miss buckets. Render path:
  unchanged. Helper/API surface: none. Metadata mutations: none. Routine error/control: no new
  throw/catch/Error path. Evidence: focused mixin tests passed (`136` tests).
- Callable frame shortcut allocation cut: accepted as removal of speculative
  frame construction, not a speed claim. Files:
  `packages/core/src/tree/rules.ts`, lookup helpers that check frame presence,
  `packages/core/src/tree/__tests__/mixin.test.ts`, and this handoff. New
  traversal: none; `Rules.findMixin(...)` now consults the callable
  `ScopeFrame` shortcut only when `this._scopeFrame` already exists instead of
  calling `getScopeFrame(...)` just to try the shortcut. Existing direct
  lookup remains the fallback for unframed callers. The public `scopeFrame`
  accessor is now the lazy creation surface backed by `_scopeFrame`; presence
  checks use `_scopeFrame` so optional reads do not allocate a frame. The
  touched dynamic-declaration list loop, live-slot map copies, and declaration
  bucket writes are pre-existing frame-maintenance work whose receiver changed
  from `scopeFrame` to `_scopeFrame`; this pass adds no new loop, side map, or
  materialized collection. New node/materialization: none in production; the
  new test builds ordinary mixin fixture nodes only. Render path: unchanged.
  Helper/API surface: no new helper; this replaces the field with the existing
  Jess getter-backed storage pattern. Metadata mutations: no new
  parent/source/frozen mutations; this removes lazy scope-frame assignment from
  speculative callable lookup. Routine error/control: no new throw/catch/Error
  path. Evidence: focused mixin tests passed (`136` tests); expanded
  scope/callable/control/reference/import focused suite passed (`549` tests,
  `9` skipped); `@jesscss/core` build passed.
- Mixin-ruleset arg-call terminal filter pass: accepted as terminal candidate
  narrowing, not a speed claim. Files: `packages/core/src/tree/call.ts`,
  `packages/core/src/tree/reference.ts`, `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/util/registry-utils.ts`, and
  `packages/core/src/tree/__tests__/mixin.test.ts`. New traversal: none; the
  existing direct crawl/cache paths run with a call-site hint that excludes
  rulesets only as the terminal callable when a mixin-ruleset call has
  arguments. Namespace containers still allow rulesets. New
  node/materialization: one production shallow owned `Reference` surface is
  created only when an evaluated mixin-ruleset call name has non-empty args and
  lacks the hint; this carries an already-known call fact to lookup and avoids
  mutating the canonical source reference. The `new Parser()` construction is
  test-only coverage for parsed namespace syntax. Render path: unchanged; no
  array/node result is built just to stringify. Helper/API surface: one private
  `Call` helper and one internal lookup option; the cache key includes the
  terminal-only bit so ordinary mixin-ruleset lookups do not share narrowed
  misses. The `terminalHints` array and `try/finally` monkeypatch restore are
  test-only instrumentation. The `[]` and `[ruleset]` returns stay inside the
  existing `MixinEntry[]` lookup contract and replace terminal ruleset hits
  with the existing miss shape when the terminal-only bit is set. Metadata
  mutations: none. Routine error/control: no new production
  throw/catch/Error path. Evidence: focused mixin, reference, import-style,
  rules, and call tests passed (`468` tests, `9` skipped).
- Legacy `MixinRegistry` body deletion: accepted as dead recursive registry
  search/indexing removal, not a speed claim. File:
  `packages/core/src/tree/util/registry-utils.ts`. New traversal: none; this
  deleted the old mixin registry selector indexing, recursive child/parent
  search, candidate filtering, subsequence matching, and compatibility helper
  loops. New node/materialization: none; no `Node`, copy, wrapper `Rules`,
  side map, output cache, or registry bucket population was added. Render path:
  unchanged. Helper/API surface: this earlier pass left a cold no-hit
  `MixinRegistry` shim for test monkeypatches; the current shim-deletion pass
  removes that symbol instead of treating test patchability as API. Metadata
  mutations: none. Routine error/control: no new throw/catch/Error path.
  Evidence: focused eslint passed; `@jesscss/core` build passed; focused
  mixin/reference/import-style/rules/call tests passed (`466` tests, `9`
  skipped).
- Rules-owned mixin registry storage cut: accepted as `Rules` instance
  storage/helper deletion, not a speed claim. File:
  `packages/core/src/tree/rules.ts`. New traversal: none. New
  node/materialization: none; no `Node`, copy, wrapper `Rules`, side map, or
  output cache was added. Render path: unchanged. Helper/API surface: deleted
  the `mixinRegistry` field and private `_ensureMixinRegistry()` helper from
  `Rules`; at that point `getRegistry('mixin')` remained as a cold request
  path, but the current unreleased surface-deletion pass removes it instead of
  preserving that compatibility shim. Metadata mutations: none. Routine
  error/control: no new throw/catch/Error path. Remaining debt: this pass left
  the internal legacy `MixinRegistry` class behind; the current shim-deletion
  pass removes that class outright. Evidence: focused eslint
  passed; focused mixin/reference/import-style/rules/call tests passed (`466`
  tests, `9` skipped); `@jesscss/core` build passed; `git diff --check`
  passed; `pnpm run verify:aggressive-cutting-review` passed.
- `Rules.register('mixin')` registry-population cut: accepted as cold
  side-effect deletion, not a speed claim. File:
  `packages/core/src/tree/rules.ts`. New traversal: none. New
  node/materialization: none; no `Node`, copy, wrapper `Rules`, side map, or
  output cache was added. Render path: unchanged; this only removes mixin
  registry population from explicit registration. Helper/API surface: this
  older pass preserved the overload shape, but the current unreleased
  surface-deletion pass removes `Rules.register('mixin', ...)` outright;
  production callable lookup remains on `Rules.findMixin(...)` direct
  crawl/cache/frame paths. Metadata mutations: none. Routine error/control: no
  new throw/catch/Error path. Evidence:
  focused mixin/reference/import-style/rules/call tests passed (`466` tests,
  `9` skipped); `@jesscss/core` build passed; `git diff --check` passed;
  `pnpm run verify:aggressive-cutting-review` passed.
- Typed `Rules.find*` production routing pass: accepted as hot-path branch
  deletion and clearer lookup surface, not a speed claim. Files:
  `packages/core/src/tree/rules.ts`, `packages/core/src/tree/reference.ts`,
  `packages/core/src/tree/selector-attr.ts`,
  `packages/core/src/tree/function.ts`,
  `packages/core/src/tree/util/registry-utils.ts`, and
  `packages/core/src/tree/__tests__/reference.test.ts`. New traversal: none;
  callable lookup code was moved from the stringly `Rules.find('mixin', ...)`
  branch into `Rules.findMixin(...)`, and production call sites now call
  `findMixin`, `findDeclaration`, `findVariable`, `findProperty`, or
  `findFunction` directly. New node/materialization: none. Render path:
  unchanged; this only changes lookup dispatch. Helper/API surface: public
  additive methods on exported `Rules`; no package export or ESM specifier
  changed, and the existing `Rules.find(...)` compatibility wrapper remains for
  public/test callers. This adds method names but removes the production
  string-type switch from the lookup sites. Metadata mutations: none. Routine
  error/control: no new throw/catch/Error path beyond the existing
  compatibility wrapper type checks. Evidence: `rg` found no remaining
  production `find('mixin'|'declaration'|'function')` calls under
  `packages/core/src/tree` outside tests; focused eslint passed; focused
  mixin/reference/import-style/rules/call tests passed (`466` tests, `9`
  skipped); `@jesscss/core` build passed. The first parallel test+build attempt
  failed because build cleaned `lib` while Vitest imported generated parser
  output; rerunning tests after build passed.
- Callable lookup cache de-registry pass: accepted as registry plumbing
  deletion and correctness tightening, not a standalone speed claim. Files:
  `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/scope-frame.ts`,
  `packages/core/src/tree/util/callable-entry.ts`, and
  `packages/core/src/tree/__tests__/mixin.test.ts`. New traversal: simple
  exact callable lookup now crawls the current `Rules.value` only for the
  requested start key and stores only that requested bucket/miss; it no longer
  builds a whole-scope `mixinsByName`/`directCallablesByName` index during
  `_indexRules()` or `registerNode(...)`. The new loops are: selector-list key
  path extraction for selector-list callable rulesets; per-selector-list branch
  checks in exact/path ruleset matching; a parent-frame walk that prepares only
  the requested key; and exact-entry filtering over a returned bucket. The
  loops replace broader pre-flight helper scans and eager whole-scope callable
  indexing. Runtime wrappers with no local hit may crawl their canonical source
  `Rules` for the same requested key. New node/materialization: no `Node`,
  copy, wrapper `Rules`, or output cache was added. New state/object surface:
  one per-`Rules` `Map` memo table remains, but it is no longer a populated
  registry; it only records identifiers that were actually requested, including
  empty buckets for repeated misses. The `candidateKeys.slice(...)` allocation
  carries the remaining selector path for prefix consumers; simple exact
  lookup ignores entries where that remaining path is non-empty. Helper/API
  surface: no public API; one shared callable lookup entry shape with `value`
  and `match` replaced separate exact and path callable bucket shapes.
  Metadata mutations: `registerNode(...)` now invalidates callable lookup
  cache/frame coverage but no longer calls `register('mixin', ...)` or appends
  callable nodes to a registry-side map. Routine error/control: no
  throw/catch/Error path was added; the review-script match on
  `CallableLookupEntry` is a token false positive. Filtering proof: simple
  string lookup now consumes only exact entries (`match.length === 0`), so a
  request for `#theme` cannot accidentally return the prefix ruleset
  `#theme.dark.navbar`; array/path lookup remains the path-prefix consumer.
  Evidence: focused eslint passed; the nested mixin-ruleset reference
  regression repro passed; focused mixin/reference/import-style/rules tests
  passed (`390` tests, `9` skipped); `@jesscss/core` build passed. Benchmark
  status: not measured yet after this cache-shape change, so make no speed
  claim until the usual lookup fixtures are compared.
- Registryless one-entry cache prototype: accepted as an opt-in prototype for
  repeated exact callable lookup, not enabled by default and not a broad speed
  claim. File: `packages/core/src/tree/rules.ts`. New traversal: none. New
  node/materialization: no `Node`, copy, `copyWithReusableLeaves(...)`,
  `.inherit(...)`, `.adopt(...)`, wrapper `Rules`, materialized AST, or
  evaluated output cache. New state/object surface: two scalar fields on
  `Rules`, `registrylessLastMixinLookupKey` and
  `registrylessLastMixinLookupValue`. The first env-gated prototype returned a
  cache-access wrapper object per eligible lookup; the follow-up deleted that
  wrapper and uses scalar private helpers for key creation, `has`, `get`, and
  `set`. Render path: unchanged. Helper/API surface: no public API; the
  existing private cache helper split into private scalar helpers. Historical
  note: the Map-cache experiment mentioned in this older entry has since been
  deleted; the one-entry scalar cache remains. Metadata mutations: no
  parent/source/frozen mutation; the new scalar cache fields are reset with the
  existing registryless lookup cache invalidation in `resetDerivedState(...)`
  and `registerNode(...)`. Routine error/control: no throw/catch/Error path was
  added. Evidence: focused eslint passed; all-flags focused behavior passed with
  `JESS_REGISTRYLESS_MIXIN_LAST_CACHE=1` (`304` tests, `8` skipped);
  `@jesscss/core` build passed. The existing Map cache had zero hits on
  `mixins-guards.less` and was slightly worse/noisy there, while it helped the
  recursive stress fixture. After wrapper removal, the one-entry cache was
  neutral on `mixins-guards.less` (`wins 32/60`, `t=-0.24`) and helped
  `scope-lookup-stress.less` (`wins 75/100`, `t=-3.70`) when compared against
  registryless without cache. Combined registryless plus one-entry cache versus
  old baseline stayed neutral on `mixins-guards.less` (`wins 32/60`, `t=-0.23`)
  and improved `scope-lookup-stress.less` (`wins 85/100`, `t=-5.97`).
- Registryless default one-entry cache pass: accepted as enabling the inlined
  one-entry cache inside the env-gated registryless prototype. File:
  `packages/core/src/tree/rules.ts`. New traversal: none. New
  node/materialization: none beyond the scalar cache fields from the prior
  pass; no AST node, wrapper `Rules`, side registry, or output cache was added.
  Helper/API surface: no public API; `JESS_REGISTRYLESS_MIXIN_LAST_CACHE=0`
  briefly disabled the last cache for measurement before the permanent-cache
  off-switch deletion pass removed that hot-path env read. Historical note:
  the older `JESS_REGISTRYLESS_MIXIN_CACHE=1` Map mode has since been deleted.
  Metadata mutations:
  unchanged; cache fields are reset with existing registryless invalidation.
  Evidence: focused eslint passed; all-flags focused behavior passed with
  default cache mode (`304` tests, `8` skipped); `@jesscss/core` build passed.
  Default registryless versus old baseline stayed neutral/favorable on
  `mixins-guards.less` (`wins 33/60`, `t=-1.48`) and improved
  `scope-lookup-stress.less` (`wins 92/100`, `t=-9.27`). Cache off/on under
  registryless showed stress still benefits (`wins 79/100`, `t=-5.57`) while
  `mixins-guards.less` remains neutral (`wins 29/60`, `t=0.04`). Extra default
  hot-path checks did not show a regression: `import-reference.less`
  (`wins 28/40`, `t=-1.94`), `media.less` (`wins 20/40`, `t=0.50`), and
  `extend-chaining.less` (`wins 22/40`, `t=-0.44`).
- Registryless cache-key construction cleanup: accepted as hot-helper
  allocation deletion, not a standalone speed claim. File:
  `packages/core/src/tree/rules.ts`. New traversal: none. New
  node/materialization: none. Helper/API surface: no public API; two private
  separator constants were added, and `getRegistrylessMixinCacheKey(...)` now
  builds the cache key by direct string concatenation instead of allocating an
  array solely to `.join(...)` the lookup key, filter type, and parent-search
  bit. Array/path lookup still joins path segments for the path component.
  Metadata mutations: none. Routine error/control: none. Evidence: pre-cleanup
  instrumentation showed `scope-lookup-stress.less` calls the key helper `1263`
  times in one render with `362` eligible cache checks; focused eslint passed;
  all-flags focused behavior passed (`304` tests, `8` skipped);
  `@jesscss/core` build passed. Post-cleanup paired default registryless runs
  preserved the established shape: `mixins-guards.less` stayed neutral
  (`wins 33/60`, `t=-0.88`), and `scope-lookup-stress.less` retained a win
  (`wins 87/100`, `t=-5.19`).
- Default registryless callable lookup pass: accepted as the first permanent
  registryless migration step. Files: `packages/core/src/tree/rules.ts` and
  `packages/core/src/tree/__tests__/mixin.test.ts`. New traversal: none beyond
  the registryless traversal already prosecuted in prior passes. New
  node/materialization: none. Helper/API surface: no public API; the old
  `JESS_REGISTRYLESS_MIXIN_LOOKUP=1` enable flag was replaced by a temporary
  `JESS_LEGACY_MIXIN_LOOKUP=1` opt-out for comparison and bisecting. Metadata
  mutations: unchanged. Routine error/control: none. Evidence: default-path
  focused eslint passed; focused behavior passed without any registryless env
  flag (`304` tests, `8` skipped); `@jesscss/core` build passed. Paired
  comparisons against `JESS_LEGACY_MIXIN_LOOKUP=1` showed the permanent default
  path stays neutral on `mixins-guards.less` (`wins 35/60`, `t=-1.20`), wins on
  `scope-lookup-stress.less` (`wins 85/100`, `t=-6.06`), leans favorable on
  `import-reference.less` (`wins 29/40`, `t=-1.47`), and remains neutral/noisy
  on `media.less` (`wins 19/40`, `t=0.41`). Verdict: keep and continue deleting
  legacy-only branches behind the temporary opt-out.
- String-key legacy branch deletion: accepted as architecture cleanup toward
  permanent registryless callable lookup, not a standalone speed claim. File:
  `packages/core/src/tree/rules.ts`. New traversal: none. New
  node/materialization: none. Helper/API surface: deleted the string-key-only
  legacy branch that combined `findMixinsFast(...)` with
  `findIndexedCallableStartMatches(...)`; string-key mixin lookup now always
  uses the registryless frame/direct-crawl path. The temporary
  `JESS_LEGACY_MIXIN_LOOKUP=1` opt-out remains only for the array/namespace
  branch at this point in the log; the following array/namespace deletion pass
  supersedes that temporary state. Metadata mutations: none. Routine
  error/control: none. Evidence:
  focused eslint passed; focused default-path behavior passed (`304` tests, `8`
  skipped); `@jesscss/core` build passed. The stress fixture remained a clean
  win (`wins 84/100`, `t=-8.89`). `mixins-guards.less` was mixed/noisy after
  this deletion (`wins 46/100`, `t=1.20`), so this is kept for branch deletion
  and migration direction, not as an incremental speed win.
- Array/namespace legacy branch deletion: accepted as completing the temporary
  callable legacy opt-out removal for covered mixin lookup paths, not as a
  standalone speed claim. Files: `packages/core/src/tree/rules.ts` and
  `packages/core/src/tree/__tests__/mixin.test.ts`. New traversal: none. New
  node/materialization: none; no `Node`, copy,
  `copyWithReusableLeaves(...)`, `.inherit(...)`, `.adopt(...)`, wrapper
  `Rules`, side registry, or evaluated output cache was added. Render path:
  unchanged. Helper/API surface: no public API; deleted runtime reads of
  `JESS_LEGACY_MIXIN_LOOKUP` and `JESS_DIRECT_CALLABLE_LOOKUP` from callable
  lookup, removed the legacy `_rulesSet` fallback branch inside
  `findMixinsFast(...)`, and removed the old direct-callable env toggle from a
  focused miss test. The older cache measurement flag and Map-cache experiment
  have since been deleted.
  Metadata mutations: none. Routine error/control: none. Evidence: focused
  eslint passed; focused default-path behavior passed (`304` tests, `8`
  skipped); `@jesscss/core` build passed. Post-delete benchmarks are regression
  sanity because the legacy comparator is gone: cache off/on stayed
  neutral/slightly worse on `mixins-guards.less` (`wins 29/60`, `t=0.80`) and
  preserved the recursive stress benefit on `scope-lookup-stress.less`
  (`wins 71/100`, `t=-3.09`).
- Dead indexed-callable registry helper deletion: accepted as dead registry
  plumbing removal after the permanent registryless callable lookup cuts. File:
  `packages/core/src/tree/rules.ts`. New traversal: none; deleted the unused
  private `findIndexedCallableStartMatches(...)` method, which previously
  indexed `MixinRegistry`, read registry `index` buckets, recursively walked
  `_rulesSet`, and then walked parents. New node/materialization: none. Render
  path: unchanged. Helper/API surface: one private helper deleted; no public API
  added. Metadata mutations: none. Routine error/control: none. Evidence:
  `rg` showed no remaining call sites; focused eslint passed; focused
  default-path behavior passed (`304` tests, `8` skipped);
  `@jesscss/core` build passed. No benchmark claim: this removes unreachable
  code and stale guidance only.
- One-segment array dispatch normalization: accepted as a narrow callable
  registry fallback cut for array key shapes that are equivalent to already
  covered string lookup. Files: `packages/core/src/tree/rules.ts` and
  `packages/core/src/tree/__tests__/mixin.test.ts`. New traversal: none;
  `Rules.find('mixin', [], ...)` now returns `undefined`, and
  `Rules.find('mixin', [key], ...)` delegates to the registryless string-key
  path. New node/materialization: none. Render path: unchanged. Helper/API
  surface: no new helper or public API; two focused tests added. Metadata
  mutations: none. Routine error/control: none. Evidence: focused tests prove
  empty and one-segment arrays skip `MixinRegistry.find(...)`; focused eslint
  passed; focused default-path behavior passed (`306` tests, `8` skipped);
  `@jesscss/core` build passed. Paired cache off/on checks stayed in the
  existing shape: `mixins-guards.less` neutral (`wins 31/60`, `t=-0.64`) and
  `scope-lookup-stress.less` positive (`wins 78/100`, `t=-6.09`). This is
  dispatch parity cleanup, not a standalone speed claim.
- Obsolete direct mixin env prototype deletion: accepted as removing an old
  duplicate callable lookup experiment now that registryless callable lookup is
  the default. Files: `packages/core/src/tree/reference.ts` and
  `packages/core/src/tree/rules.ts`. New traversal: none; deleted the
  `JESS_DIRECT_MIXIN_LOOKUP` branch from reference lookup, deleted
  `findMixinsDirectTree(...)`, deleted `directCallableLookupCache`, and deleted
  the old direct callable cache-key helper. New node/materialization: none.
  Render path: unchanged; callable references now go straight to the permanent
  `Rules.find('mixin', ...)` path. Helper/API surface: net deletion. This
  older pass kept `findMixinsDirect(...)` only because it looked public; the
  current unreleased surface-deletion pass removes it instead of preserving
  that wrapper. Metadata mutations: deleted the stale direct-callable cache
  invalidation in `resetDerivedState(...)` and `registerNode(...)`. Routine
  error/control: no new throw/catch/Error path.
  Evidence: `rg` found no runtime references to `JESS_DIRECT_MIXIN_LOOKUP`,
  `findMixinsDirectTree(...)`, `directCallableLookupCache`, or the deleted
  cache-key helper; focused eslint passed; focused default-path behavior passed
  (`306` tests, `8` skipped); `@jesscss/core` build passed. No benchmark claim:
  this removes inactive env-gated machinery while preserving the exported
  method shape.
- Generic mixin switch fallback deletion: accepted as deleting the last
  `Rules.find(..., type='mixin')` switch fallback to `MixinRegistry.find(...)`
  after all declared mixin key shapes are handled before the switch. File:
  `packages/core/src/tree/rules.ts`. New traversal: none. New
  node/materialization: none. Render path: unchanged. Helper/API surface: no
  new helper or public API. Metadata mutations: none. Routine error/control:
  none. Evidence: string keys, empty arrays, one-segment arrays, and
  multi-segment arrays are intercepted by the registryless branches before the
  switch; focused lookup tests prove those shapes skip `MixinRegistry.find(...)`.
  This is a branch deletion and unreachable fallback cleanup, not a standalone
  speed claim.
- Frame exact-callable miss coverage pass: accepted as a predicate-precision
  cleanup for registryless lookup, not as a standalone speed win. Files:
  `packages/core/src/tree/rules.ts` and
  `packages/core/src/tree/__tests__/mixin.test.ts`. New traversal: none beyond
  the existing exact child-surface helper introduced in the prior pass;
  `hasDirectLookupChildSurface()` now checks `_hasReferenceImports`,
  `hasExactCallableChildSurface`, and any not-yet-indexed child surfaces that
  can contain exact callable hits instead of treating any `_rulesSet` child as
  an uncovered simple exact-name miss. This narrows fallback to child surfaces
  that can actually affect the lookup. New node/materialization: none; no
  `Node`, copy, `copyWithReusableLeaves(...)`, `.inherit(...)`, `.adopt(...)`,
  wrapper `Rules`, side map, result object, or evaluated output cache was
  added. Render path: unchanged. Helper/API surface: no new production helper
  or public API; one focused test was added. Metadata mutations: no
  parent/source/frozen mutation; existing scope-frame coverage booleans are set
  with a narrower predicate. Routine error/control: no throw/catch/Error path
  was added. Evidence: focused eslint passed; all-flags focused behavior passed
  (`304` tests, `8` skipped); `@jesscss/core` build passed. One-render
  `mixins-guards.less` counters moved only slightly from the prior patch
  (`371` -> `370` exact-bucket probes; `46` -> `45` `findMixinsFast` calls),
  so this is not a standalone speed claim. Paired `mixins-guards.less`
  remained neutral (`pairs=60 batch=5`: wins `36/60`, `t=-0.94`), and paired
  `scope-lookup-stress.less` preserved the registryless win (`wins 76/100`,
  `t=-3.19`).
- Exact callable child-surface capability pass: accepted as a narrow
  registryless lookup cut with a measured stress-path win and broad-fixture
  neutral status, not as a broad Less speed claim. File:
  `packages/core/src/tree/rules.ts`. New traversal: one helper,
  `rulesMayContainExactCallableSurface(...)`, scans a child `Rules.value` at
  indexing/child-entry collection time to decide whether that child can contain
  direct exact callable hits. This replaces repeated recursive exact-bucket
  probes on child surfaces that cannot answer simple exact-name callable
  lookup. It does not walk parents, source nodes, registries, `_rulesSet`, or
  `rulesSet`; parent ascent stays in the outer lookup and child recursion stays
  parentless. New node/materialization: none; no `Node`, copy,
  `copyWithReusableLeaves(...)`, `.inherit(...)`, `.adopt(...)`, wrapper
  `Rules`, side map, result object, or evaluated output cache was added. Render
  path: unchanged; callable candidates still evaluate through the existing
  output path. Helper/API surface: one private helper plus one `Rules` boolean,
  `hasExactCallableChildSurface`; the boolean is reset with the existing
  derived-state/cache resets and updated when `addDirectChildRuleEntry(...)`
  already sees a child surface. Metadata mutations: no parent/source/frozen
  metadata mutation; the new boolean is lookup coverage state on the existing
  `Rules` runtime surface. Routine error/control: no throw/catch/Error path was
  added. Evidence: focused eslint passed; all-flags focused behavior passed
  (`303` tests, `8` skipped); `@jesscss/core` build passed. One-render
  `mixins-guards.less` counters under `JESS_REGISTRYLESS_MIXIN_LOOKUP=1`
  dropped exact-bucket probes from `3143` to `371` and child collector
  calls/builds from `107` to `28`. Paired broad `mixins-guards.less` runs were
  neutral/no decision-quality regression (`pairs=100 batch=1`: wins `48/100`,
  `t=0.42`; `pairs=60 batch=5`: wins `31/60`, `t=0.83`). Paired
  `scope-lookup-stress.less` render improved with a clean longer signal:
  baseline median `56.04ms`, candidate median `55.14ms`, wins `85/100`,
  `t=-4.46`.
- Parentless callable candidate benchmark fix: accepted as a correctness fix
  for broad `benchmark.less`, not a speed claim and not a new ownership model.
  Files: `packages/core/src/tree/util/callable-candidate-state.ts`,
  `packages/core/src/tree/util/callable-candidate-execution.ts`,
  `packages/core/src/tree/util/callable-special-case.ts`, and focused helper
  tests. New traversal: none; the fix uses `candidate.parent` or the already
  supplied `callSiteRules`, with no parent walk, child walk, registry lookup,
  side map, or array helper. New node/materialization: none. The diff still
  contains `candidateParent.adopt(...)`, but that replaces the previous
  `candidate.parent!.adopt(...)`; it does not add a second adoption or move
  canonical source children. The ownership boundary is the same callable-output
  placement rules surface that already existed. Helper/API surface: one field,
  `PreparedCallableCandidateState.candidateParent`, carries the placement
  parent once so downstream guard/output code no longer reaches back through a
  nullable candidate parent. Metadata mutations: no new parent restoration,
  source mutation, `inherit`, `frozen`, `Reflect`, `Object.hasOwn`, or lazy
  context/options creation. Routine error/control: the new `TypeError`s guard
  an impossible callable setup with neither definition parent nor call-site
  rules; they are not used for ordinary lookup miss/branch control. Test-only
  objects are the new helper fixtures only. Render path: unchanged; callable
  output still evaluates through the existing path and no evaluated output is
  cached. Evidence: `benchmark.less` previously failed through the Less facade
  with `Cannot read properties of undefined (reading 'adopt')`; debugger/stack
  evidence mapped it to
  `prepareCallableCandidateState(...)` calling `candidate.parent!.adopt(rules)`.
  Focused helper tests now cover parentless ordinary and special-case callable
  entries. After the fix, `node scripts/profile-less-benchmark.mjs
  --file=benchmark.less` completes through the Less-compatible path:
  elapsed `502.96ms`; `Reference.evalNode` `3619` calls / `59.40ms`;
  `Rules.find` `1013` calls / `22.31ms`; `OutputWriter.getSince` `149331`;
  `OutputWriter.mark` `154363`.
- ScopeFrame callable hit/miss prototype: accepted as a narrow binding-lane bridge
  reduction, not a speed claim and not completion of callable records. Files:
  `packages/core/src/tree/scope-frame.ts`,
  `packages/core/src/tree/rules.ts`, and
  `packages/core/src/tree/__tests__/mixin.test.ts`.
  New traversal: one frame-chain walk in `lookupScopeFrameCallable(...)` for
  direct, non-targeted `Rules.find('mixin', staticKey, ...)` when the current
  `Rules` already owns a `scopeFrame`; no child traversal, no parent/source
  node walk, no `Set`, no array helper, no side map, and no registry lookup was
  added. This does not call `getScopeFrame(...)`; it refuses to allocate
  declaration buckets just to try a callable hit or miss. The bucket
  reverse-scan is the minimum needed to ignore `Ruleset` entries for
  `type: mixin`; it replaces the broader `findMixinsFast(...)` surface walk for
  covered hits. The same callable bucket
  arrays already created by registration are reused as the frame record
  surface. New node/materialization: none; no new `Node`, copy,
  `.inherit(...)`, `.adopt(...)`, wrapper `Rules`, callable output cache,
  frozen/source/parent mutation, or public materialization. New arrays/objects:
  the only production result array is the `MixinEntry[]` required by the
  existing public `Rules.find(...)` return shape; previously the older fast
  path allocated an equivalent result after a broader recursive search.
  The first attempt used an empty callable `Map` sentinel and raised the static
  audit to `new-node` `322`; this pass deleted that sentinel and made
  `callableBucketsByName` optional, returning the audit to `321`. The diff
  still shows the existing live-slot clone
  `new Map(source.scopeFrame.liveSlotsByName)` because this call gained
  explicit callable coverage arguments; that clone already existed and is not a
  new callable-index object. Test-only objects are the two `TreeContext`
  fixtures and two `fastPathHits` arrays used to prove the old fast path is not
  entered; the tests explicitly prebuild the root frame to prove the shortcut
  without adding lazy frame allocation to `Rules.find(...)`. Render path:
  unchanged; callable output still evaluates/renders
  through the existing path and is not cached. Helper/API surface: one
  binding-lane function,
  `lookupScopeFrameCallable(...)`, added to move covered static callable hits
  into `ScopeFrame`; it does not add a parallel cache or callable wrapper
  object. Metadata mutations: `ScopeFrame.callablesCovered` is indexing state
  on the existing frame, and `ScopeFrame.callableMissesCovered` is explicit
  coverage state derived from existing `_rulesSet` and `_hasReferenceImports`
  registration facts; no node metadata mutation. Routine error/control: test
  `try/finally` blocks restore monkey-patched methods only; production lookup
  does not throw/catch for ordinary misses. Regression caught and fixed: a
  parent-frame discovery attempt caused `.mixin` misses in
  `import-reference: namespaced reference-imported rulesets remain callable as
  mixins`; the final code only uses `this.scopeFrame` and skips the shortcut for
  `hasTarget`/`local` lookup. Evidence: pre-edit
  `benchmark-v39.less` profile was `Reference.evalNode` `482` calls /
  `5.27ms`, `Rules.find` `68` calls / `0.42ms`, with `Rules.find` only for JS
  functions, so this slice is not expected to affect that fixture. Focused
  `mixin.test.ts` + `scope-frame.test.ts` passed (`137` tests), and the latest
  focused callable/import gate passed (`162` tests; `78` skipped by filter),
  proving direct `Rules.find(...)` static Mixin and simple Ruleset-as-mixin
  hits skip `Rules.findMixinsFast` when a frame already exists, covered
  non-targeted misses skip it when no child/reference-import surfaces exist,
  and child-surface misses stay on the bridge.
  `@jesscss/core` build passed; the parallel
  build/test attempt failed only because the build cleaned `packages/core/lib`
  while Vite was resolving `@jesscss/core`, and the same tests passed when run
  after the build. Post-edit `benchmark-v39.less` profile was
  `Reference.evalNode` `482` calls / `4.80ms`, `Rules.find` `68` calls /
  `0.34ms`; status only, not a speed claim. Quick hotpath leash was:
  `functions` `12.91ms` usable, `import-reference` `17.56ms` usable,
  `mixins-guards` `15.43ms` usable, `extend-chaining` `5.07ms` unstable, and
  `media` `5.34ms` usable. Static node-creation audit returned to
  `new-node` `321`, `with-surface` `33`, `copy-leaves` `28`, `derive` `30`.
  Remaining bridge: targeted lookup, namespace/import visibility, and frames
  with child callable surfaces still fall through to `findMixinsFast(...)`
  until those facts are represented in binding state.
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
- Reference fallback pre-copy pass: accepted as actual Reference-local
  `copyWithReusableLeaves(...)` deletion, not as completion of fallback public
  materialization. `packages/core/src/tree/reference.ts` now evaluates
  non-static fallback containers directly instead of first copying the fallback
  source node. New traversal: none. New node/materialization: none; one
  fallback `copyWithReusableLeaves(fallbackValue)` call was removed. Render
  path: unchanged; render fallback containers were already direct-text paths
  and the focused render test still proves no fallback copy or fallback
  `.inherit(...)` happens there. Public resolve path: now skips the Reference
  pre-copy, but dynamic container eval can still create an owned public
  `List`/`Sequence` result through `List.eval(...)`/`Sequence.eval(...)`;
  that shared ownership tax is exposed and remains queued, not hidden.
  Helper/API surface: no helper or public API added. Metadata mutations:
  removed the pre-copy ownership boundary; no parent restoration, frozen state,
  source-root mutation, side map, cache, or defensive probe was added.
  Test-only materialization/control: the new focused public-resolve fallback
  test uses a tiny root scope and monkey-patches `List.copy` in `try/finally`
  solely to prove the source fallback container is not copied; no runtime code
  gained instrumentation. Evidence: `reference.test.ts` passed (`115` tests),
  focused eslint passed, static node-creation audit dropped `reference.ts`
  from `18` to `17` and global `copy-leaves` from `29` to `28` while
  `new-node` stayed `321`, `with-surface` stayed `33`, and `derive` stayed
  `30`. Clean `benchmark-v39.less` profiler sanity after the patch was
  `Reference.evalNode` `482` calls / `6.00ms`, `Rules.find` `68` calls /
  `0.42ms`; status only, not speed proof. Verdict: keep the deletion; next
  target should be the shared `List.eval(...)`/`Sequence.eval(...)` owned
  container boundary if tests prove public materialization can be separated
  from render/eval-to-immediate-string.
- List/Sequence eval wrapper pass: accepted as function-call/callback deletion,
  not as node-materialization deletion. `packages/core/src/tree/list.ts` deleted
  private `evaluateItems(...)` and now calls `evaluateNodeArrayMaybe(...)` or
  `evaluateNodeArraySync(...)` directly from `evalNode(...)`; its unchanged
  check is a simple `for` loop instead of two `Array.every(...)` callback
  paths. `packages/core/src/tree/sequence.ts` deleted private
  `evaluateValues(...)` and calls `evaluateNodeArrayMaybe(...)` directly in the
  async-capable branch. New traversal: none; the same evaluated array is checked
  once, but the callback/function-wrapper layer is gone. New node/materialization:
  none added and none deleted; `List.withResolvedValue(...)` and
  `Sequence.withValue(...)` still create owned public containers when child
  evaluation changes the value. Render path: unchanged and still direct-string
  for dynamic render; this pass does not resolve into arrays/nodes to stringify.
  Helper/API surface: two private helpers removed; no helper or public API
  added. Metadata mutations: none; no parent/source restoration, frozen state,
  side map, cache, `Reflect.*`, or defensive structural probe was added.
  Evidence: `list.test.ts`, `sequence.test.ts`, `spaced.test.ts`, `call.test.ts`,
  and `reference.test.ts` passed (`247` tests), focused eslint passed, and `rg`
  found no remaining `evaluateItems`, `evaluateValues`, or `.every(...)` in
  `list.ts`/`sequence.ts`. Static node-creation audit stayed flat:
  `sequence.ts` `18`, `reference.ts` `17`, global `new-node` `321`,
  `with-surface` `33`, `copy-leaves` `28`, `derive` `30`, because the public
  owned-container boundary remains real. Clean `benchmark-v39.less` profiler
  sanity after the patch was `Reference.evalNode` `482` calls / `5.60ms`,
  `Rules.find` `68` calls / `0.41ms`; status only, not speed proof. Verdict:
  keep the helper/callback deletion; continue with the actual
  `List.withResolvedValue(...)`/`Sequence.withValue(...)` materialization
  boundary or return to the next measured Reference/Rules lookup target.
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
- Selector `writeSyntax` render-stringification cut: accepted as a focused
  user-directed detour from the binding lane because broad `benchmark.less`
  evidence showed illegal render-internal public string API traffic:
  pre-pass `OutputWriter.mark`/`getSince` were `154363`/`149331`, with
  selector/header stacks dominating (`BasicSelector`, `Ruleset.getHeaderString`,
  `CompoundSelector`, `ComplexSelector`, `SelectorList`, and `Any`). New
  traversal: one loop was added inside `OutputWriter.refreshPositions()` for
  the non-sourcemap writer branch. It recomputes scalar chunk lengths only when
  an already-mutating trim/replace path has changed chunks; it deletes the
  worse line/column/source-segment recomputation for non-sourcemap renders and
  is not a new node/source traversal. Existing selector child loops remain:
  `SelectorList` still uses its existing normalization/filter loop and this
  pass did not add a new parent/source walk, side map, recursive scan,
  generator, or array helper.
  New node/materialization: none; no `Node`, copy, `.inherit(...)`,
  `.adopt(...)`, wrapper `Rules`, frozen state, or source/parent metadata
  mutation was added. The `new OutputWriter(sourceMap === true)` diff is not a
  new construction site; it parameterizes the existing writer construction so
  render print state can skip source-map segment tracking unless source maps
  are requested. Render path: narrower; selector containers and ruleset header
  rendering now call `writeSyntax(options)` instead of child/public
  `toString(...)` as transport, so public string capture stays at the cold
  string boundary while render-ish parents write directly to the active writer.
  Helper/API surface: one shared `Selector.writeSyntax(...)` hook replaces the
  too-specific local `writeSelectorSyntax(...)` experiment; old
  `render*Syntax(...)` methods remain private string wrappers around the direct
  writer path. Metadata mutations: none; the `OutputWriter` source-map switch
  only disables source tracking for non-sourcemap render print state and keeps
  public/manual writer behavior tracking by default. The `sourceRoot` diff is
  source-map test fixture shape repair from the stale pre-source-root mock; it
  adds no production metadata mutation. Evidence: focused
  selector/ruleset/render-buffer/writer/source-map/print tests passed
  (`168` tests), `pnpm --filter @jesscss/core build` passed, and broad
  `benchmark.less` profiler status after the patch showed
  `OutputWriter.mark`/`getSince` down to `54534`/`49502`. This is strong
  machinery-deletion evidence, not a real speed claim: the same profiler run
  reported elapsed `540.89ms`, `Reference.evalNode` `3619` calls / `69.29ms`,
  and `Rules.find` `1013` calls / `25.68ms`. Remaining measured offenders:
  `Ruleset.getHeaderString` still captures header strings for frame
  comparison/emission (`21911` mark/getSince/restore), declaration duplicate
  pre-rendering still captures values (`4129` repeated marks plus
  `replaceSince`), and leaf/value families (`Any.toString`, `Dimension`,
  `Num`, `Color`, `PseudoSelector`, `Sequence`, `Quoted`) still need
  `writeSyntax` cuts or cold-path isolation.
- ScopeFrame current-binding pass: accepted as binding-lane consolidation, not
  as a speed claim. New traversal: one construction/update-time overlay loop in
  `buildScopeFrame(...)` walks supplied live slots to publish
  `currentBindingsByName`; this replaces repeated lookup-time live/static
  branching for ordinary current reads and runs only when a frame is built from
  existing live-slot state. Existing declaration loops remain the same
  `varsByName` bucket construction, and existing bucket scans remain only for
  source-order/filter cases. No new recursive crawl, parent/source walk, sort,
  generator, or child-surface scan was added. New node/materialization: none;
  no `Node`, copied node, wrapper `Rules`, `.inherit(...)`, `.adopt(...)`,
  frozen state, source metadata, or parent mutation was added. Render path:
  unchanged; the pass changes binding lookup state before the same value eval
  and render paths. Helper/API surface: two internal writers,
  `setScopeFrameLiveBinding(...)` and `setScopeFrameDeclarationBinding(...)`,
  were added to keep `currentBindingsByName` synchronized at the existing live
  cell and declaration-entry creation edges; they replace direct map writes at
  production mutation sites instead of adding a lookup-time helper ladder.
  Metadata mutations: none beyond publishing binding-frame state. Evidence:
  focused `scope-frame`, `reference`, `mixin`, `control`, and `import-style`
  tests passed (`433` tests, `1` skipped), and touched-file ESLint passed. The
  change avoids per-read declaration entry allocation by reusing the existing
  bucket `BindingEntry` for static current reads; live current entries are
  allocated when live cells are created. Performance remains leashed/status
  only until a measured before/after pass is run.
- Runtime live-binding bridge deletion: accepted as a direct lookup-walker
  deletion, not as a speed claim. New traversal: none; this pass deletes the
  bespoke `lookupRuntimeVarBinding(...)` `Set<ScopeFrame>`, nested
  `searchChain(...)` closure, direct frame loop, fallback-frame loop, and
  `liveSlotsByName.get(...)` lookup. The remaining live-only fallback delegates
  to existing `lookupScopeFrameVariable(...)` with `includeDeclarations: false`,
  so target/interpolated/index live cells use the same current-binding facade
  as ordinary reads. New node/materialization: none; no `Node`, copied node,
  wrapper `Rules`, `.inherit(...)`, `.adopt(...)`, frozen state, source
  metadata, or parent mutation was added. Render path: unchanged; the returned
  `RuntimeVarBinding` still feeds the same direct value eval/render path.
  Helper/API surface: one smaller module-local adapter,
  `lookupLiveScopeFrameVariableBinding(...)`, replaces the deleted frame walker
  because the surrounding lookup path still consumes `RuntimeVarBinding`
  records. Metadata mutations: none. Evidence: focused `scope-frame`,
  `reference`, `mixin`, `control`, and `import-style` tests passed (`433`
  tests, `1` skipped). Performance remains leashed/status only until a measured
  before/after pass is run.
- VarDeclaration direct-bridge pass: accepted as the first declaration bridge
  mode deletion, not as a speed claim. New traversal: none; this pass does not
  add a loop, recursion, parent/source walk, child scan, sort, generator,
  side-map lookup, or array helper. It makes the existing
  `findDeclarationDirect(...)` path production-default for normalized
  `VarDeclaration` lookups and keeps the existing explicit `UNCOVERED` fallback
  for unsupported option shapes. New node/materialization: none; no `Node`,
  copied node, wrapper `Rules`, `.inherit(...)`, `.adopt(...)`, frozen state,
  source metadata, or parent mutation was added. Render path: unchanged; this
  only changes how `Rules.findVariable(...)`/`findDeclaration(...,
  'VarDeclaration', ...)` find source declarations before the same eval/render
  paths. Helper/API surface: no helper or public method added. Metadata
  mutations: none. Rejected broader cut: forcing all declaration/property modes
  through direct lookup (`JESS_DIRECT_DECLARATION_LOOKUP=1`) failed declaration
  merge tests by duplicating merge-chain values, so property/general
  declaration modes remain registry-owned until merge/source-order facts are
  modeled. Evidence: focused `reference`, `import-style`, `mixin`,
  `declaration`, `control`, and `scope-frame` tests passed (`499` tests, `1`
  skipped), including a direct `findVariable(...)` proof that the declaration
  registry is not opened for covered `VarDeclaration` hits.
- Function binding pass: accepted as simple function registry lookup deletion,
  not as a speed claim. New traversal: `Rules.findFunctionDirect(...)` carries
  forward the existing parent/import-boundary walk from
  `FunctionRegistry.find(...)` so simple exact-name function hits and misses no
  longer call the registry method. The traversal climbs through non-`Rules`
  parents to the next enclosing `Rules` frame because Less function calls often
  start inside a `Ruleset`; a one-off trace on
  `if((iscolor(@some)), darken(@some, 10%), black)` proved an immediate-parent
  check missed the root function map. This is not a new child crawl, recursive
  surface scan, sort, generator, or broad source rediscovery; it reads
  `functionsByName` records published at registration/indexing edges. The only
  added scan is `FunctionRegistry.cloneForRules(...)` walking cloned registry
  `index` entries to publish already-materialized Less plugin functions into the
  direct map; this is clone/compat state, not normal source lookup. New
  node/materialization: no production `Node`, copied node, wrapper `Rules`,
  `.inherit(...)`, `.adopt(...)`, frozen state, source metadata, or parent
  mutation was added. The production allocation is the `functionsByName` `Map`,
  clone preservation with `new Map(source.functionsByName)`, and publishing
  cloned `FunctionRegistry.index` entries into the same binding map so remaining
  Less plugin-style registry injections stay visible to direct lookup. These are
  semantic binding state replacing registry lookup for simple exact names.
  Render path: unchanged; the same `JsFunction`/`Func` source nodes feed the
  existing call eval/render paths. Helper/API surface: one
  `Rules.setFunctionBinding(...)` writer and one private
  `findFunctionDirect(...)` replace simple `FunctionRegistry.find(...)` traffic;
  the compatibility registry remains only for plugin-style API surfaces not cut
  in this pass. Metadata mutations: none. Test-only danger tokens:
  `rules([])`, `new JsFunction(...)`, `root.clone(false)`, `throw new Error`,
  `try/finally`, and monkeypatched `registry.find` appear only in focused tests
  that prove simple hits/misses and registry-only clone preservation avoid the
  registry method. Evidence: focused `call`, `control`, `declaration`,
  `reference`, and `func` tests passed (`324` tests), touched-file ESLint passed,
  `@jesscss/core` build passed, and the previously failing
  `tests-unit/functions/functions.less` hotpath fixture rendered successfully as
  a semantic smoke check.
- Function registry compatibility deletion: accepted as API/helper deletion, not
  as a speed claim. Deleted core `FunctionRegistry.add(name, fn)`,
  `addMultiple(...)`, `get(...)`, `getLocalFunctions(...)`, and `inherit(...)`,
  including the `_parentRegistry` side channel and method override shim used only
  by that invented compatibility layer. New traversal: none. New
  node/materialization: no production node creation was added in core; the only
  new `JsFunction` in this pass is test code replacing the deleted
  `getRegistry('function').add(name, fn)` shortcut with normal
  `Rules.register('function', new JsFunction(...))`. Render path: unchanged.
  Helper/API surface: Less-compat now builds a tiny local bridge object in
  `setContext(...)` whose `add(...)` writes `Rules.setFunctionBinding(...)` and
  whose `get(...)` reads `Rules.findFunction(...)`; the Less-shaped
  `functionRegistry` API remains in the Less-compat mock where Less plugins
  expect it, not in core. Metadata mutations: none. Evidence: core `reference`,
  `call`, and `control` tests passed (`255` tests); Less `functions.test.ts`
  passed (`18` executed, `22` already-marked not-run cases); Less-compat plugin-manager/at-plugin integration
  tests passed (`17` tests); touched-file ESLint passed; `@jesscss/core` and
  `@jesscss/plugin-less-compat` builds passed.
- Callable child-surface shape pass: accepted as direct lookup work reduction,
  not as a speed claim. New traversal: `rulesMayContainExactMixinSurface(...)`
  recursively scans child callable surfaces at the same registration/indexing
  edge where `rulesMayContainExactCallableSurface(...)` already scanned for
  broad callable capability. That fact is carried as
  `Rules.hasExactMixinChildSurface`, so terminal mixin-only misses no longer
  call `findMixinsFast(...)` when child surfaces contain only ruleset terminals.
  Namespace terminal lookup also now skips `findVisibleExactCallableRulesetPath`
  when `terminalMixinOnly` is true and no namespace prefix matched, because an
  exact full-path ruleset cannot satisfy a parameterized mixin-ruleset call.
  New node/materialization: no production node, wrapper Rules, copied node,
  `.inherit(...)`, `.adopt(...)`, frozen state, source metadata, or parent
  mutation was added. The production parent read only distinguishes a root
  covered miss from a child-frame miss that must still climb parent/fallback
  frames. Test-only node construction uses existing fixture builders (`rules`,
  `ruleset`, `decl`, `any`) to prove the two miss shapes; the test-only spy
  array and `try/finally` restore a monkey-patched method and do not enter
  production lookup.
  Render path: unchanged; the same source callables render/eval after lookup.
  Helper/API surface: one private predicate and one boolean field were added;
  no public API was added. Metadata mutations: the new boolean is reset with
  existing derived lookup state and updated while registering child surfaces.
  Evidence: focused `mixin`, `reference`, `import-style`, and
  `extend-import-style` tests passed (`365` tests, `1` skipped), including
  guard, import-reference, namespace, and recursive callable lookup coverage;
  touched-file ESLint, `@jesscss/core` build, `git diff --check`, aggressive
  cutting review, node-creation audit, and one-iteration
  `tests-unit/mixins-guards/mixins-guards.less` hotpath sanity passed. Full
  `measure:less:hotpath` completed as a correctness/sanity run only; several
  fixtures were noisy or unstable, so no speed claim is made. Direct
  `scope-lookup-stress.less` render still produced `8822` bytes.
- Unfiltered property declaration direct lookup pass: accepted as a narrow
  registry bridge deletion, not as a speed claim. New traversal: none; the pass
  routes an already-existing `findDeclarationDirect(...)` path for unfiltered
  exact/default-filter `Declaration` lookup and adds an early `UNCOVERED`
  return for semantic filtered non-variable declaration lookups. New
  node/materialization: no production node, wrapper `Rules`, copied node,
  `.inherit(...)`, `.adopt(...)`, frozen state, source metadata, or parent
  mutation was added. Test-only arrays and monkeypatch `try/finally` blocks
  prove covered property hit/miss and property-reference cases do not open
  `DeclarationRegistry`. Render path: unchanged; assignment-normalized
  merge-chain references still fall back to the registry bridge rather than
  duplicating coalesced merge inputs. Helper/API surface: no public API added;
  one internal `FindOptions.semanticFilter` bit distinguishes default context
  filters from assignment/semantic filters, one existing condition in
  `Rules.findDeclaration(...)` was widened for default-filter `Declaration`,
  and one direct-helper guard returns explicit `UNCOVERED` for semantic filtered
  non-variable declaration lookups. Metadata mutations: none. Evidence:
  focused `declaration`, `reference`, `import-style`, and `extend-import-style`
  tests passed (`292` tests, `1` skipped);
  `JESS_DIRECT_DECLARATION_LOOKUP=1` focused `declaration` and `reference`
  tests passed (`185` tests), proving semantic filtered merge-chain lookups
  decline the direct path; touched-file ESLint, `@jesscss/core` build,
  `git diff --check`, aggressive cutting review, node-creation audit, full
  `measure:less:hotpath` sanity, and direct `scope-lookup-stress.less` render
  (`8822` bytes) passed. The hotpath run had mixed usable/unstable signals, so
  no speed claim is made.
- Typed declaration fallback split pass: accepted as binding/lookup machinery
  deletion, not as a speed claim. New traversal: none. `Reference` now selects
  variable/property/any-declaration operations at the call site and uses the
  typed fallback method for that lane; `setDefined` assignment lookup calls
  `findVariable(...)` or `findProperty(...)`; and the old declaration-registry
  child-recursion bridge calls typed child lookup when the child filter is
  already selected. New node/materialization: no production node, wrapper
  `Rules`, copied node, `.inherit(...)`, `.adopt(...)`, frozen state, source
  metadata, parent mutation, cache, side map, or helper array was added.
  Render path: unchanged; references still render the resolved source/value
  through existing render paths. Helper/API surface: deleted one generic
  `Reference` string-dispatch helper and two filter-type helpers; added three
  typed private fallback helpers that expose the already selected lane instead
  of hiding a discriminator. Metadata mutations: none. Evidence: production
  grep finds no `lookupDeclarationDirectOrFind(...)`,
  `getIndexReferenceFilterType(...)`, `getDirectRulesIndexFilterType(...)`,
  `findDeclaration(key, normalizeDeclarationFilter(node.type), opts)`, or
  `findDeclaration(...)` calls with `actualChildFilterType`; focused
  `reference`, `rules`, `import-style`, and `detached-rulesets` tests passed
  (`268` tests, `31` skipped), including new guards proving plain index and
  direct `Rules` index targets avoid generic `Rules.findDeclaration(...)` for
  selected variable/property keys; touched-file ESLint, `@jesscss/core` build,
  `git diff --check`, aggressive cutting review, and node-creation audit
  passed. Hotpath sanity ran for `mixins-guards.less` and
  `scope-lookup-stress.less` with one iteration only; it is regression smoke,
  not speed evidence. The first root-level vitest attempt was invalid for this
  workspace because it skipped package test setup, and the first hotpath
  attempt used a nonexistent `--files` option; the successful
  package-relative/tested commands are the behavioral evidence.
- Typed declaration boundary cleanup/audit pass: accepted as lookup surface
  narrowing plus bridge classification, not as a speed claim. New traversal:
  none. The pass deletes `normalizeDeclarationFilter(...)`, narrows
  `Rules.findDeclaration(...)` from arbitrary string filters to
  `'VarDeclaration' | 'Declaration' | undefined`, moves non-boundary helper and
  variable-option tests to `findVariable(...)` / `findProperty(...)`, and
  records the remaining bridge facts for `findVarDeclarationFast(...)`,
  non-empty registry candidate accumulation, semantic filtered property merge
  lookup, and `_rulesSet`. New node/materialization: no production node,
  wrapper `Rules`, copied node, `.inherit(...)`, `.adopt(...)`, frozen state,
  source metadata, parent mutation, cache, side map, helper array, or
  materialized output was added. Render path: unchanged; this changes lookup
  entry selection and docs only. Helper/API surface: one runtime helper was
  deleted, no replacement helper or compatibility shim was added, and the
  cold `findDeclaration(...)` boundary was narrowed instead of preserved for
  compatibility. Metadata mutations: none. Evidence: binding grep shows no
  production `normalizeDeclarationFilter(...)`, no production literal
  `findDeclaration(..., 'VarDeclaration'|'Declaration')` caller, and only two
  production `findDeclaration(..., undefined, ...)` any-declaration bridge
  callers (`Reference` any-declaration and registry child any-declaration).
  One remaining test-only `findDeclaration(..., 'VarDeclaration')` hit is the
  intentional cold-boundary coverage test. Focused `reference`, `rules`,
  `import-style`, and `detached-rulesets` tests passed (`268` tests, `31`
  skipped) after moving helper tests to typed lanes; touched-file ESLint,
  `@jesscss/core` build, `git diff --check`, aggressive cutting review, and
  node-creation audit passed. Hotpath sanity ran for `mixins-guards.less` and
  `scope-lookup-stress.less` with one iteration only; it is regression smoke,
  not speed evidence. Remaining implementation work is explicitly seeded as
  `7v-7aa`.
- Declaration child/candidate/property-filter direct lookup pass: accepted as
  registry bridge deletion, not as a speed claim. New traversal: direct lookup
  now scans provided `candidates` / `optionalCandidates` sets when callers pass
  non-empty candidate state; this replaces falling back to
  `DeclarationRegistry.find(...)` for candidate accumulation. The existing
  declaration child recursion inside `Registry._searchRulesChildren(...)` now
  iterates `collectDirectDeclarationChildEntries()` for declaration-family
  lookup instead of `_rulesSet`; mixin lookup still uses `Rules.rulesSet` and
  remains queued. Property semantic-filter lookup now uses the direct
  declaration walker, and property/variable `Reference` helpers plus attribute
  selector variable interpolation stop bouncing from direct lookup back into
  `Rules.findProperty(...)` / `Rules.findVariable(...)` for covered production
  shapes. New node/materialization: no production node, wrapper `Rules`, copied
  node, source metadata, parent mutation, or render materialization was added.
  New state/allocation: two module-local direct lookup helpers for candidate
  seeding/accumulation; they mutate only caller-provided candidate sets that
  already existed in the lookup contract and remove an `UNCOVERED` registry
  bridge. The new production loop is the direct candidate-set scan in
  `chooseCandidateMatch(...)`, which replaces the older registry candidate
  accumulation path. Test-only danger tokens are the candidate `Set`
  construction, `registryHits` arrays, and monkeypatch `try/finally` plus a
  throwing `_rulesSet` getter used as a tripwire. Render path: unchanged;
  the same resolved declarations feed existing eval/render paths. Helper/API
  surface: no public API added; one dead fallback import/path was deleted from
  `selector-attr.ts`, and `Reference` typed variable/property helpers no longer
  call the `Rules.find*` fallback on direct covered shapes. Metadata mutations:
  none. Rejected broader cut: `findAll` remains uncovered because direct
  declaration lookup returns one winner, not all matches; `Rules.rulesSet` /
  `_rulesSet` remains for mixin child lookup and import/export compatibility
  until `7z`. Evidence: touched-file ESLint passed; focused
  `reference`/`rules` semantic-filter/property/direct tests passed; wider
  `reference`, `rules`, `import-style`, `detached-rulesets`, and `declaration`
  lookup pattern suite passed (`322` tests, `38` skipped); focused core
  declaration/reference merge tests passed (`21` tests, `181` skipped); Less
  `functions.test.ts` property merge coverage passed (`2` executed in the
  selected pattern, with unrelated not-run cases preserved). No speed claim is
  made before the closing hotpath sanity/gates.
- Rules child-entry storage deletion pass: accepted as registry lookup plumbing
  deletion, not as a speed claim. New traversal: `_checkReadonlyImportShadows`
  now directly scans carried readonly child entries, imported child values, and
  current scope values; this replaces opening two declaration registries and
  walking registry index sets for the same readonly-import shadow check.
  `Registry._searchRulesChildren(...)` still uses its existing child-entry
  filter and reverse walk, but it now consumes carried
  `collectDirectChildRulesEntries()` / `collectDirectDeclarationChildEntries()`
  instead of `Rules.rulesSet`. New node/materialization: no production node,
  wrapper `Rules`, copied node, ownership-copy call, frozen state, source
  metadata, parent mutation, cache, side map, or render materialization was
  added. New state:
  existing direct child-entry records now carry the readonly bit that
  `rulesSet` previously carried; this is construction-time lookup state, not a
  second registry. Render path: unchanged; resolved declarations and callables
  feed the existing eval/render paths. Helper/API surface: deleted
  `Rules.rulesSet`, `_rulesSet`, and the duplicate local `RulesEntry`
  interface; widened the existing child-entry collector only because the
  remaining registry bridge still needs the carried child surface until the
  final declaration registry cut. Metadata mutations: none. Rejected broader
  cut: deleting `DeclarationRegistry.find(...)` in the same pass broke
  any-declaration merge/ordering semantics, so the audit records that bridge
  explicitly as `7ab-7ae` instead of preserving it for compatibility. Evidence:
  touched-file ESLint passed; focused declaration/reference/import tests passed
  (`259` tests, `28` skipped); expanded lookup-adjacent suite passed (`434`
  tests, `69` skipped); `@jesscss/core` build, `git diff --check`,
  aggressive-cutting review, and node-creation audit passed. Production grep
  finds no `_rulesSet`/`rulesSet` storage or lookup use. Exceptional errors:
  the readonly shadow error remains a real Less/Jess semantic failure, not miss
  control flow; the child-entry self-containment error remains a structural
  invariant check on a corrupt lookup graph. Hotpath smoke ran
  `mixins-guards.less` and `scope-lookup-stress.less` with one iteration only;
  this is regression smoke, not speed evidence. No speed claim is made by this
  pass.
- Declaration registry deletion pass: accepted as binding/lookup registry
  deletion, not as a speed claim. Files:
  `packages/core/src/tree/reference.ts`, `packages/core/src/tree/rules.ts`,
  `packages/core/src/tree/util/direct-rules-lookup.ts`,
  `packages/core/src/tree/util/registry-utils.ts`, focused lookup tests, and
  this handoff. New traversal: no new child-tree scan was added; direct
  any-declaration lookup now uses the existing direct declaration walker and
  carried child-entry surfaces for semantic-filtered declaration references.
  The parent-walk helper was corrected to preserve an existing start boundary
  when generated mixin/call output lacks a containing index, preventing child
  or call-output lookups from reopening later parent siblings. `Reference`
  contextual property/declaration lookup now preserves parent source-order
  boundaries; only variable/default lookup keeps the old parent-boundary
  relaxation. New node/materialization: no production node, wrapper `Rules`,
  copied node, `.inherit(...)`, `.adopt(...)`, frozen state, source metadata,
  parent mutation, render materialization, cache, side map, helper array, or
  registry-shaped declaration store was added. Render path: unchanged; the
  same resolved declaration values feed existing eval/render and merge
  coalescing paths. Helper/API surface: net deletion. Removed
  `Rules.declarationRegistry`, `_ensureDeclarationRegistry()`,
  `getRegistry('declaration')`, `register('declaration', ...)`, the generic
  `Registry` base, `DeclarationRegistry`, and the remaining
  `Reference.lookupAnyDeclarationOrFind(...)` fallback into
  `Rules.findDeclaration(...)`. `Rules.register(...)` now accepts only
  function bindings. Metadata mutations: none. Test-only danger tokens:
  `reference.test.ts` still allocates `Set` option shapes to prove old
  registry-loop/candidate bookkeeping is ignored by direct lookup, and one
  monkey-patched live-slot getter throws only as a tripwire if the wrong test
  path executes. Those objects/errors are not production lookup control flow.
  Rejected compatibility work:
  no shim was kept for old public-looking declaration registry methods; these
  were unreleased/self-invented lookup surfaces. `findAll` is treated as
  callable/test-only shared option residue for declaration lookup; no
  declaration all-results storage was rebuilt. Evidence so far: touched-file
  ESLint passed; production grep finds no declaration registry shape or
  temporary debug hook; focused declaration merge/coalescing tests passed
  (`19` passed), reference lookup suite passed (`143` passed), import-style
  lookup/import-reference pattern passed (`38` passed, `47` skipped), broader
  rules/mixin/detached lookup suite passed (`156` passed, `60` skipped), and
  call/function/findAll pattern passed (`27` passed, `53` skipped).
  Touched-file ESLint, `@jesscss/core` build, `jess` build,
  `git diff --check`, aggressive-cutting review, node-creation audit, and
  one-iteration hotpath smoke for `mixins-guards.less` and
  `scope-lookup-stress.less` passed. No speed claim is made.
