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

- `BINDING-INDEX-PROPOSAL.md`: coherent lookup/binding/cache model for
  reference lookup, Less contextual semantics, and Jess/Sass-style live
  bindings.

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
- Next binding step, when selected: prototype a production `BindingFrame`
  facade for ordinary static variable references and run it against focused
  reference tests before touching broader callable lookup.

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
   - A failed first attempt proved that applying the facade to contextual
     control-loop lookups changes stateful output (`tick: 1, 1, 2` became
     `tick: 1, 2, 3`), so source-order/current hardening remains step 3.

3. [ ] Facade source-order/current-read hardening.
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
     operation, but is not yet wired into production declaration eval.
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
   - Next production step is not cache work. It is to carry a cheap read-mode
     fact into `Reference` lookup (`current` vs `$!` source-position) and only
     allow facade `start` routing for the explicit `$!` mode.
     Do not infer this mode by crawling parents or probing node shapes.
   - Do not start step 4 lookup caching until production contextual-start
     routing is either safely widened or explicitly split into a later
     production milestone.

4. [ ] Lookup cache prototype.
   Add a frame-local lookup-identity cache only after the facade behavior is
   proven. Cache binding identity, not evaluated values.

   Completion gate:
   - cache key includes read mode, key, lookup mode, start bucket, and frame
     lookup/current-pointer version
   - dynamic-name promotion and live-slot/current-pointer changes invalidate
     correctly
   - no evaluated-node reuse
   - focused behavior tests plus benchmark before/after

5. [ ] Callable records prototype.
   Move only simple static callable lookup into binding records. Namespace,
   guard matching, candidate evaluation, import visibility, and callable output
   stay out of the facade until separately proven.

   Completion gate:
   - focused mixin/callable guard and import-reference tests pass
   - callable output is not cached
   - no body copy is introduced to satisfy parent/source metadata
   - benchmark/profile evidence shows whether this attacks the measured
     `Reference.evalNode`/callable lookup bucket

6. [ ] Evaluated-value cache.
   Only after lookup identity is correct, consider effect-gated evaluated-value
   caching on binding cells.

   Completion gate:
   - dependency/effect facts are explicit
   - no rules/mixin output caching
   - no public materialization cache on the hot render path
   - benchmark before/after proves value

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
8. [ ] Continue `Reference` before moving to the next node. Audit and cut the
   remaining copy/materialization pressure: `createRulesLikeReferenceSurface`,
   `evaluateReferenceValueNode(...)`, declaration finalization, merged assign
   normalization, and the remaining `.inherit(...)`/`copyWithReusableLeaves(...)`
   ownership boundaries.
9. [ ] Sweep `Ampersand` template placement next. Replace
   `toTrimmedString().includes(',')` and string splitting with selector-list
   structure and placement state; only final CSS output may stringify.
10. [ ] Sweep selector matching/extend equality. Replace hot `valueOf()` equality
   predicates with structural/keyset checks where possible, keeping
   `valueOf()` only as a measured, cached fast-path when it wins.
11. [ ] Split `Node.evalStatic(...)` into immediate eval/render and cold public
   materialization so routine eval replacement does not imply `.inherit(...)`.
12. [ ] Replace `StyleImport` first-use placement copies with placement state
   that points at canonical source children and preserves import visibility.
13. [ ] Collapse `StyleImport.deriveRulesSurface(...)` wrappers whose only job
   is source/visibility/placement bookkeeping.
14. [ ] Replace remaining `Rules` merge output copies with direct merge
   placement/render state or a narrow owned-item copier proven by merge tests.
15. [ ] Convert registration-prep expected misses away from routine `try/catch`
   only after adding tests for unresolved declaration/identity behavior.
16. [ ] Continue selector/extend factory cuts separately; do not hide selector
   placement copies inside another generic copy helper.
17. [ ] Replace callable binding copies for static containers with explicit
   binding/placement state. Static containers should not be copied merely
   because they contain child nodes; `F_HAS_NODE_CHILD` is only a cheap current
   ownership boundary, not a final architecture.
18. [ ] Attack the measured copy stack next: `copyChild`,
   `copyWithReusableLeaves`, `copyCallableRulesValue`, `constructCopy`, and
   `.inherit(...)`. CPU evidence says these are mostly registration derivation,
   selector header rendering, JS function argument ownership, reference value
   eval, and binding clone debt; do not justify them as render output copying.
19. [ ] Audit repeated callable/mixin evaluation from the profile before making
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
