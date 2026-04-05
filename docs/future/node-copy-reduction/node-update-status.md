# Node Update Status

This file tracks only edge + cursor migration work.

If an item does not directly move the runtime toward:

- field-aligned edges
- `RenderKey`-selected reads
- cursor-based parent/child traversal

it does not belong here.

## Target

The target runtime shape is:

- every node instance starts with `renderKey = CANONICAL`
- eval only assigns `EVAL` when evaluation returns a different node object
- canonical child fields stay the canonical value
- `parent` is the primary lookup path for the current placement
- `sourceParent` is canonical definition provenance
- canonical static-field mutation must return or install a derived
  non-canonical node instead of mutating the canonical node in place
- alternate child links are field-aligned edges:
  - singular child: `fooEdge?: NodeEdge<T>`
  - list child: `fooEdges?: Array<NodeEdge<T> | undefined>`
- alternate parent links live in `parentEdges?: NodeEdge<Node>`
- canonical runtime state stays direct on the node:
  - `state: number`
  - `preEvaluated: boolean`
  - `evaluated: boolean`
- non-canonical runtime state only exists when it diverges:
  - `stateEdges?: Map<RenderKey, number>`
- non-canonical nodes are ephemeral placements:
  replacing one non-canonical node with another does not require retaining the
  displaced derived node unless an edge still references it
- path selection uses `RenderKey`
- traversal uses a cursor: `{ node, renderKey }`

The target model is not:

- `sourceParent` varying by eval placement
- `sourceParentEdge` acting as a hidden invocation-scope channel
- raw child field reads in eval code bypassing render-key-aware state

Discipline rule:

- if code needs the current placement, read through `get(...)`, typed field
  getters, `getParent(...)`, `getChildren(...)`, or a cursor
- if code intentionally needs the canonical field, make that explicit
- when the read is intentionally canonical, prefer the direct field
  (`node.value`, `node.rules`, `node.params`, etc.) over `.get('value')` or
  other generic getters
- do not read `node.params`, `node.guard`, `node.rules`, `node.value`, or
  similar fields directly in converted/hybrid eval paths just because it is
  convenient
- `leakyRules` caller fallback should be modeled as an extra parent-edge lookup
  lane, not by changing the meaning of `sourceParent`
- if that caller fallback needs its own edge identity, prefer an explicit
  `CALLER` symbol key in `parentEdges` instead of pretending it is the primary
  render-key parent edge
- write-side discipline matters as much as read-side discipline:
  `.parent` should always be the current primary lookup path for that node's
  placement, while caller fallback is additive and belongs on
  `parentEdges.get(CALLER)`
- do not rewrite `sourceParent` during call/invocation output shaping just to
  smuggle caller ancestry into lookup

This file does not track:

- registry redesign by itself
- mixin/control semantics by themselves
- broad Context cleanup by itself
- test triage on hybrid nodes

Those only matter here when they directly block edge/cursor conversion.

## Current Reset

The core test suite no longer carries direct `activeState` / `EvalState` /
`setField` / `getField` usage in `packages/core/src/tree/__tests__` or
`packages/core/src/tree/util/__tests__`.

That cleanup matters here only because it removes old-model poison from the
working surface. From this point, remaining reds in focused files should be
treated as production runtime issues, not test-shim compatibility issues.

## Verification Rule

Only use tests as hard gates for surfaces that are already edge/cursor-based.

If a node is still hybrid, failures are migration signals only.

Do not add old-model compatibility logic here just to satisfy tests on nodes that
are not yet converted.

For performance or migration work, “green” is not enough by itself.

Every gate also requires architectural compliance:

- prefer direct canonical fields on already-resolved canonical paths
- prefer sparse state or a thin derived node at true divergence points
- keep edge wiring only where it solves a concrete placement problem
- treat generic `.get(...)`, `clone(...)`, `copy(...)`, `inherit(...)`, and
  `adopt(...)` on hot paths as suspect legacy machinery
- if a change passes tests but preserves the wrong runtime shape, it has not
  passed the gate

## Edge/ Cursor Surfaces

### 1. Render-Key Read Surface

Status: `active`

Goal:

- child reads that only need path selection should use `renderKey`
- do not pass full `Context` for edge selection alone

Primary files:

- `packages/core/src/tree/node-base.ts`
- `packages/core/src/tree/util/cursor.ts`

### 2. Field-Aligned Edge Storage

Status: `active`

Goal:

- remove generic child-edge storage as a target shape
- keep only field-aligned edge surfaces:
  - `fooEdge`
  - `fooEdges`
  - `parentEdges`

Primary files:

- `packages/core/src/tree/node-base.ts`
- `packages/core/src/tree/util/cursor.ts`

### 3. Cursor Parent/Child Traversal

Status: `active`

Goal:

- parent traversal must depend on `{ node, renderKey }`
- child traversal must resolve field-aligned edges through `renderKey` or cursor

Primary files:

- `packages/core/src/tree/util/cursor.ts`
- `packages/core/src/tree/util/field-helpers.ts`
- `packages/core/src/tree/util/serialize-helper.ts`

### 4. No-Context Render Walks

Status: `active`

Goal:

- render-owned nodes must be readable through direct field + edge state without
  requiring hidden `Context.activeState` rescue
- no-context serialization should be able to follow the current render-owned
  path when the node itself already owns that path

Primary files:

- `packages/core/src/tree/rules.ts`
- `packages/core/src/tree/ruleset.ts`
- `packages/core/src/tree/at-rule.ts`
- `packages/core/src/tree/util/serialize-helper.ts`

Current warning:

- `Rules` / `Ruleset` serialization still has too much shape recovery through
  rendered-text inspection.
- Checks based on string prefixes, start characters, or already-serialized
  selector text should be treated as temporary migration debt.
- The target cleanup is node-shape-driven serialization scheduling, not more
  text comparisons in `serialize-helper.ts`.

## Node Conversion Status

This section tracks only edge/cursor conversion status.


| Node                   | Status          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Expression`           | `converted`     | Direct canonical field kept; render-key child selection characterized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Block`                | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Negative`             | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Paren`                | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Quoted`               | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SelectorCapture`      | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SelectorInterpolated` | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Url`                  | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `List`                 | `converted`     | Canonical container stays in place for same-length render-path child replacement; `valueEdges` now carry indexed alternates and local shape changes return a different node.                                                                                                                                                                                                                                                                                                                                                                      |
| `Rest`                 | `converted`     | Simple child surface converted to direct field + render-key read path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Sequence`             | `converted`     | Canonical container stays in place for same-length render-path child replacement; `valueEdges` carry indexed alternates and only shape changes return a different node.                                                                                                                                                                                                                                                                                                                                                                           |
| `Rules`                | `in_progress`   | Major render-key entry/exit owner. Wrapper registry seeding indexes direct render-visible children, render-visible reads no longer clone container nodes on read, and render-key child mutation updates/removes `parentEdges` directly on wrapper-owned paths. Main blocker now is scope ownership still leaking through `renderParent` instead of a pure parent-edge / cursor model.                                                                                                                                                             |
| `Ruleset`              | `in_progress`   | Direct field getters are field-aligned (`getSelector(renderKey?)`, `getRules(renderKey?)`, `getGuard(renderKey?)`, etc.), and `.maybeClone(...)` is gone in favor of explicit `.clone()`. Import-style is green again after placement-owned top-level import wrappers and render-key-aware `enterRules()` body ownership fixes, and `Reference` no longer re-identifies resolved definition-like nodes through generic eval inheritance. The parser-generated `tests-unit/import/import-reference.less` activation / ancestry seam is now fixed too: multi-candidate mixin output assembly rebinds candidate wrapper ancestry onto the caller-owned path without flattening away candidate wrappers or rebasing their state lanes. The formerly-live parser-backed `extend.less` seam is also fixed again: exact local-child extend can now fall back to the live own-selector surface after earlier local `all` extension, but only under a single-parent-selector parent and only when the active parent selector does not already contain the extender. Remaining blockers are now mostly selector/output-shape parity seams. |
| `AtRule`               | `in_progress`   | Major helper cleanup landed: no `AtRule` `activeState` writes, no generic `get('name', context)` / `get('selector', context)` hot-path reads, and hoisted wrapper selector composition now uses explicit cloned child `Ruleset`s. The remaining live issue is not raw `AtRule` field access; it is the parser-generated reference-import activation / ancestry path that still fails in real Less integration.                                                            |
| `Reference`            | `in_progress`   | Lookup-parent walk still depends on `context.rulesContext` and `Rules.renderParent` as side channels, but `Reference` no longer re-identifies resolved definition-like nodes through generic eval inheritance. That guard now protects mixin/ruleset/function lookups from being re-registered as bogus `EVAL` definitions. Remaining work is to make reference-import activation and ruleset-as-mixin ancestry use the render-owned path directly instead of the side channels.                                                                                                                                       |
| `Call`                 | `in_progress`   | Direct dispatch and render-key-owned result shaping are in place. The remaining production seam is narrower: function/mixin call-time result processing still has a few ownership-sensitive branches, but the old “not converted” wrapper model is gone.                                                                                                                                                                                                                                                                                                                                          |
| `Mixin`                | `in_progress`   | Direct mixin invocation primitives and render-key scopes are in place. A real child-edge bug was fixed here: `Mixin.preEval()` now reattaches `rules` / `params` / `guard` children on the active render-key path, and guarded dispatch now reads the current guard surface instead of a canonical `candidate.get('guard')` read. That removed the old emitted-nested-mixin closure failure in `mixins-guards.less`. Multi-candidate output assembly is also narrower now: `assembleMixinInvocationOutput(...)` no longer canonically nests caller-owned candidate wrappers for reference-import activation, and parser-backed `import-reference.less` is green again. `mixins-guards-default-func.less` is green again too; the remaining mixin-related reds are selector-shape or formatting parity, not output assembly/runtime lookup failures. |
| `Control`              | `in_progress`   | Runtime-generated numeric render keys landed for loop placements, and narrow loop proofs now exist. The remaining work is final production conversion of loop/output ownership, not more test-side patching.                                                                                                                                                                                                                                                                                                                                      |


Only the `converted` rows are valid hard-gate targets for focused edge/cursor tests.

## Immediate Next Work

1. Stay on narrow production surfaces only: pick one component, convert one owner/path seam, and verify it with a focused proof test.
2. For runtime-performance work, follow the benchmark / focused-vitest / keep-or-revert protocol in [HANDOFF.md](./HANDOFF.md#performance-execution-protocol). Do not restate or improvise that plan in chat.
3. Keep the remaining frontier grounded in the actual failing fixture output. The current Jess Less fixture sweep is green again after the accepted fixture updates for `extend-nest.less` and `rulesets.less`.
4. Continue deleting remaining clone/materialize seams only where they directly block edge/cursor conversion.
5. When a live bug turns out to be “wrong field was read directly,” fix the read surface first before adding more wrapper/source-parent repair logic.

## Recent Perf Evidence

- Extend / selector performance work now has an explicit contract in
  `docs/future/node-copy-reduction/extends-performance-contract.md`.
- Test-facing work counters now exist for:
  - extend orchestration
  - selector planning
  - selector composition
  - node create/clone/copy/inherit/valueOf churn
- New gate suites now pin “non-work” behavior in:
  - `packages/core/src/tree/util/__tests__/extend-work-contract.test.ts`
  - `packages/core/src/tree/util/__tests__/selector-composition-work.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-pipeline-budget.test.ts`
- Current contract tests prove:
  - no-extend stays at zero planner/rewrite work
  - disjoint extend fixtures still avoid rewrites, but they do **not** yet avoid
    route-plan work; that ceiling is now pinned explicitly instead of being
    hand-waved away
  - chained micro fixtures have bounded passes
  - parent-aware composition is now counter-gated on nested disjoint fixtures

- Current kept benchmark band on `benchmark.less` is now roughly `2.66s` to
  `2.69s`, with the current best sample at roughly `2661ms`.
- Fresh CPU profile still says GC is the biggest single cost. After that, the loudest self-time hotspots are:
  - `buildGroupRequirements`
  - `cloneFn`
  - `getRulesetExtendTarget`
  - `processExtends`
  - `buildRouteMatchPlan`
  - `getEffectiveSelector`
  - `composeSelectorRouteWithParent`
  - `clone`
  - `inherit`
- Newly rejected experiments:
  - parentless eval-context selector-match plan caching in
    `packages/core/src/tree/util/selector-match-core.ts`
  - `Reference.preEval()` fast path for primitive target/key references
  - extra direct-field cleanup inside `Reference`
  - canonical direct-field cleanup in `mixin-instance-primitives`
  - `adopt()` / `inherit()` bitmask shortcut using `node.state`
  - `rules.ts` direct canonical `name` / `selector` reads in registration and mixin-direct dispatch
  - direct selector-structure reads in `selector-match-core` plan building
  - direct count-merge rewrite in `selector-match-core.mergeRequirements(...)`
- Rejection rule was not just time. Several of those selector/extend-path cuts also changed real output shape in `extend-less-fixtures.test.ts` (`[data="test3"]` became `[data= "test3"]`), so they are architecturally unsafe as written.
- Updated ranking:
  1. clone/materialize churn in extend-match planning
  2. selector-route composition / parent recomposition
  3. `getRulesetExtendTarget` / `processExtends`
  4. only after that, broader clone/inherit seams in `node-base`

## New Kept Perf Evidence

- `Node.copy()` no longer strips comments via a recursive comment-replacement
  clone callback. It is now a structural clone path with the existing
  serialization/comment gates left to enforce output behavior.
- Two duplicate `inherit(this)` calls were removed after `clone()` in:
  - `packages/core/src/tree/selector-pseudo.ts`
  - `packages/core/src/tree/call.ts`
- Exact keep gates that stayed green after that change:
  - `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`
  - `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
  - `packages/core/src/tree/__tests__/reference.test.ts`
- Benchmark result after rebuilding `@jesscss/core` and `jess`:
  - `benchmark.less`: `2660.62ms` min, `2694.34ms` max, `2677.48ms` avg
- Interpretation:
  - comment stripping in `copy()` was paying real hot-path cost without being
    required by the current comment/serialization contract
  - duplicate post-clone `inherit()` calls were pure legacy overhead
- Follow-up proof:
  - the temporary clone-flag regression was a bad test import, not a runtime
    bug
  - `packages/core/src/tree/__tests__/node-flags.test.ts` now imports
    `F_AMPERSAND` and `F_IMPLICIT_AMPERSAND` from `packages/core/src/tree/node.ts`,
    not the `index.ts` barrel that does not export those flags
  - exact keep gate after that fix:
    - `packages/core/src/tree/__tests__/node-flags.test.ts`
    - `packages/core/src/tree/__tests__/ampersand.test.ts`
    - `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
    - `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`
    - `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
    - `packages/core/src/tree/__tests__/reference.test.ts`
  - benchmark recheck after rebuilding `@jesscss/core` and `jess`:
    - first run: `2725.09ms` avg
    - verification rerun: `2684.91ms` avg
  - keep result:
    - neutral-to-safe inside the accepted benchmark band; no revert

- New keep:
  `packages/core/src/tree/extend.ts`
  `materializeImplicitAmpersands(...)` no longer deep-copies the children of a
  freshly materialized `ComplexSelector` a second time before pushing them into
  the rebuilt selector.
- Exact keep gates for that cut:
  - `packages/core/src/tree/__tests__/ampersand.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`
  - `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
  - `packages/core/src/tree/__tests__/reference.test.ts`
- Benchmark result after rebuilding `@jesscss/core` and `jess`:
  - `benchmark.less`: `2673.38ms` min, `2683.89ms` max, `2678.64ms` avg
- Interpretation:
  - the extra `map(x => x.copy(true))` was real duplicate work
  - removing it held correctness and preserved the current best benchmark band

- New keep:
  `packages/core/src/tree/util/extend-core.ts`
  `materializeAmpersandsForHoist(...)` no longer pre-copies recursive
  selector/list/compound children before recursing into a function that already
  rebuilds or copies on exit.
- Exact keep gates for that cut:
  - `packages/core/src/tree/__tests__/ampersand.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`
  - `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
  - `packages/core/src/tree/__tests__/reference.test.ts`
- Benchmark result after rebuilding `@jesscss/core` and `jess`:
  - first run: `2695.99ms` avg
  - verification rerun: `2664.27ms` avg
- Interpretation:
  - this is not a clean standalone speed win yet
  - it stayed inside the accepted benchmark band across repeated real runs
  - keep as neutral architectural cleanup until a later profile shows whether
    the recursive pre-copy removal compounds with adjacent cuts

- New keep:
  `packages/core/src/tree/util/extend-core.ts`
  `wrapResolvedOrderedSpan(...)` no longer pre-copies
  `targetSelector.value[i]` before handing it to
  `materializeAmpersandsForHoist(...)`.
- Exact keep gates for that cut:
  - `packages/core/src/tree/__tests__/ampersand.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`
  - `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
  - `packages/core/src/tree/__tests__/reference.test.ts`
- Benchmark result after rebuilding `@jesscss/core` and `jess`:
  - `benchmark.less`: `2631.95ms` min, `2647.01ms` max, `2639.48ms` avg
- Interpretation:
  - this is a real follow-on win in the same extend-materialization family
  - the previous neutral pre-copy cleanup appears to compound once this adjacent
    caller stops deep-copying the same selector segment first
  - current accepted benchmark band is now roughly `2.63s` to `2.68s`

- New keep:
  `packages/core/src/tree/util/extend-core.ts`
  derived-selector helper writes now use direct property assignment instead of
  `Reflect.set(...)` in:
  - `finalizeDerivedSelector(...)` for restoring reused child parents
  - `setSelectorContainerValue(...)` for assigning the rebuilt selector array
- Exact keep gates for that cut:
  - `packages/core/src/tree/__tests__/ampersand.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`
  - `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
  - `packages/core/src/tree/__tests__/reference.test.ts`
- Benchmark results after rebuilding `@jesscss/core` and `jess`:
  - run 1: `2649.31ms` avg
  - run 2: `2669.99ms` avg
  - run 3: `2651.16ms` avg
- Interpretation:
  - this is not a huge standalone speedup, but it consistently lands back in
    the lower accepted band after rebuild-backed runs
  - direct property writes are the correct runtime shape here anyway; the
    generic `Reflect.set(...)` path was pure helper overhead
  - current accepted benchmark band remains roughly `2.64s` to `2.67s`

- New weak keep:
  `packages/core/src/tree/util/selector-utils.ts`
  `getSelectorListArgNode(...)` now reads `target.arg` directly instead of
  `Reflect.get(target, 'arg')`.
- Exact keep gates for that cut:
  - `packages/core/src/tree/__tests__/ampersand.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`
  - `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
  - `packages/core/src/tree/__tests__/reference.test.ts`
- Benchmark results after rebuilding `@jesscss/core` and `jess`:
  - run 1: `2660.50ms` avg
  - run 2: `2664.92ms` avg
- Interpretation:
  - this is a small helper-overhead cleanup, not a major standalone win
  - the rebuilt benchmark stayed in the lower accepted band
  - direct field access is the correct canonical shape here, so this stays
    unless a later stacked result proves it harmful

- New keep:
  `packages/core/src/tree/util/extend-core.ts`
  `finalizeDerivedSelector(...)` no longer uses `flatMap(...)` to collect
  reused child parents before restoring parent edges.
- Exact keep gates for that cut:
  - `packages/core/src/tree/__tests__/ampersand.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`
  - `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
  - `packages/core/src/tree/__tests__/reference.test.ts`
- Benchmark results after rebuilding `@jesscss/core` and `jess`:
  - run 1: `2625.36ms` avg
  - run 2: `2611.58ms` avg
- Interpretation:
  - this is a real helper-allocation win in a hot derived-selector path
  - the change is architecture-correct as well: less array churn for the same
    parent-edge restoration behavior
  - current accepted benchmark band is now roughly `2.61s` to `2.66s`

- New strong keep:
  `packages/core/src/tree/util/extend-core.ts`
  `normalize(...)` now uses direct loops instead of `map(...).filter(...)` in
  the compound-selector and selector-list branches.
- Exact keep gates for that cut:
  - `packages/core/src/tree/__tests__/ampersand.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-comment-handling.test.ts`
  - `packages/core/src/tree/util/__tests__/extend-core-unit.test.ts`
  - `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
  - `packages/core/src/tree/__tests__/reference.test.ts`
- Benchmark results after rebuilding `@jesscss/core` and `jess`:
  - run 1: `2560.20ms` avg
  - run 2: `2614.91ms` avg
- Interpretation:
  - this is the strongest helper-overhead win in the current pass
  - the hot path was paying for avoidable intermediate arrays during selector
    normalization
  - current accepted benchmark band is now roughly `2.56s` to `2.62s`

## Current Perf Evidence

- Big benchmark:
  `/Users/matthew/git/worktrees/less.js/alpha/packages/less/benchmark/benchmark.less`
  with linked local `jess-dev` packages is currently in the `~2.56s` to
  `~2.62s` band on repeated rebuild-backed `3` run / `1` warmup samples, with
  the current best accepted sample at roughly `2560ms`.
- The last two extend-path micro-optimizations were both losers and were
  reverted:
  - count-collapsing in
    `packages/core/src/tree/util/selector-match-core.ts`
  - selector string caching in
    `packages/core/src/tree/util/extend-roots.ts`
- New rejected experiments:
  - `packages/core/src/tree/ruleset.ts`
    cached `parentRenderKey` / `parentDirectSelector` /
    `parentSelectorBeforeExtend` inside `getEffectiveSelector(...)`
    - hostile gate stayed green
    - pre-build local run looked better (`2639.64ms`)
    - protocol-correct rebuild + reruns regressed to `2678.99ms` and
      `2702.79ms`
    - rejected as noise-then-loss
  - `packages/core/src/tree/extend.ts`
    removed the resolved-selector pre-copy inside
    `materializeImplicitAmpersands(...)`
    - hostile gate stayed green
    - protocol-correct rebuild benchmark regressed to `2720.04ms`
    - rejected
  - `packages/core/src/tree/util/extend-core.ts`
    removed pseudo pre-copies before `setPseudoArg(...)`
    in `normalize(...)` and `materializeAmpersandsForHoist(...)`
    - hostile gate stayed green
    - protocol-correct rebuild benchmark regressed to `2709.49ms`
    - rejected
  - `packages/core/src/tree/util/extend-core.ts`
    selector-list branch in `materializeAmpersandsForHoist(...)`
    switched from `.map(...)` to a manual loop
    - hostile gate stayed green
    - protocol-correct rebuild benchmark regressed to `2665.53ms`
    - rejected
  - `packages/core/src/tree/util/extend-core.ts`
    `replaceDirectSelectorChild(...)` collapsed two `findIndex(...)` scans
    into one loop
    - hostile gate stayed green
    - protocol-correct rebuild benchmark regressed to `2661.53ms`
    - rejected
  - `packages/core/src/tree/util/extend-core.ts`
    `buildMatchedCompoundSelector(...)` replaced its index-array plus `map(...)`
    path with a manual loop
    - hostile gate stayed green
    - protocol-correct rebuild benchmark regressed to `2731.28ms`
    - rejected
  - `packages/core/src/tree/util/extend-roots.ts`
    `processExtends(...)` cached `visibleInstructions` per root across the
    fixed-point loop
    - widened extend gate stayed green, including
      `packages/core/src/tree/util/__tests__/process-extends.test.ts`
    - protocol-correct rebuild benchmark landed at `2645.26ms` and
      `2656.76ms`
    - rejected
  - `packages/core/src/tree/util/extend-roots.ts`
    `getRulesetExtendTarget(...)` short-circuited same-identity selector and
    parent comparisons before calling `valueOf()`
    - widened extend gate stayed green, including
      `packages/core/src/tree/util/__tests__/process-extends.test.ts`
    - protocol-correct rebuild benchmark landed at `2642.69ms`
    - rejected
  - `packages/core/src/tree/util/selector-match-core.ts`
    `buildGroupRequirements(...)` / `buildRouteMatchPlan(...)` replaced
    generic `.get('value'|'name')` calls with direct field access on the
    planner hot path
    - widened selector/extend gate stayed green, including
      `packages/core/src/tree/util/__tests__/selector-match-unit.test.ts`,
      `packages/core/src/tree/util/__tests__/fast-reject.test.ts`, and
      `packages/core/src/tree/util/__tests__/process-extends.test.ts`
    - protocol-correct rebuild benchmark regressed to `2795.85ms`
    - rejected
  - `packages/core/src/tree/util/selector-match-core.ts`
    `collectGroupMatchLocations(...)` memoized `matchCompoundWindow(...)`
    results per requirement/span to avoid the repeated minimality rescans
    - widened selector/extend gate stayed green, including
      `packages/core/src/tree/util/__tests__/selector-match-unit.test.ts`,
      `packages/core/src/tree/util/__tests__/fast-reject.test.ts`, and
      `packages/core/src/tree/util/__tests__/process-extends.test.ts`
    - protocol-correct rebuild benchmark regressed to `2681.55ms`
    - rejected
  - `packages/core/src/tree/util/selector-match-core.ts`
    `mergeRequirements(...)` returned left/right directly when the other side
    was an empty requirement
    - widened selector/extend gate stayed green, including
      `packages/core/src/tree/util/__tests__/selector-match-unit.test.ts`,
      `packages/core/src/tree/util/__tests__/fast-reject.test.ts`, and
      `packages/core/src/tree/util/__tests__/process-extends.test.ts`
    - protocol-correct rebuild benchmark regressed to `2827.92ms`
    - rejected
  - `packages/core/src/tree/node-base.ts`
    `Node.create(...)` replaced `Reflect.construct(...)` with direct
    constructor dispatch
    - widened selector/extend gate stayed green
    - protocol-correct rebuild benchmark regressed to `2811.17ms`
    - rejected
- Fresh CPU profiling shows the main debt is broad node/selector lifecycle
  machinery, not parser cost and not small extend-path string work.

Current ranked suspects:

1. `packages/core/src/tree/node-base.ts`
  - `clone(...)`
  - `inherit(...)`
  - `copy(...)`
  - `setNodeField(...)`
  - `setNodeKeySetLibrary(...)`
2. `packages/core/src/tree/util/selector-utils.ts`
  - remaining selector copy pressure after direct field-read cleanup
3. `packages/core/src/tree/util/selector-match-core.ts`
  - `buildGroupRequirements(...)`
   Only revisit after clone/copy pressure is reduced.
4. selector-side no-context generic getters in canonical paths
  - `packages/core/src/tree/selector-list.ts`
  - `packages/core/src/tree/ruleset.ts`
  - `packages/core/src/tree/selector-compound.ts`
  - `packages/core/src/tree/util/extend-core.ts`
  - `packages/core/src/tree/util/extend-roots.ts`
   Keep pushing direct field reads only where the selector/container for the
   active path is already resolved and canonical.

Current blocked seams:

- broad removal of clone-time `options` spreading is not safe as a blind perf
  cut.
  Existing tests assert that cloned/imported nodes must not share the same
  `options` object identity on some paths, so any reduction there needs a more
  selective copy-on-write strategy rather than deleting the spread outright.

Working interpretation:

- treat generalized clone/inherit/adopt behavior as legacy compatibility debt
- assume broad selector copying is suspect until proven necessary
- prefer deleting copy/state propagation over adding local caches

Recent accepted evidence:

- kept: `packages/core/src/tree/node-base.ts`
  no longer inherits `keySetLibrary` inside `inherit(...)`
- kept: `packages/core/src/tree/selector.ts`
  selector key-set library now falls back lazily from:
  - current context
  - current selector
  - source selector
  - tree context
- result:
  selector/fast-reject/extend/mixin/import focused gates stayed green, and the
  main Less benchmark stayed near the good end of the current band at roughly
  `3779ms`
- kept: `packages/core/src/tree/ampersand.ts`
  `Ampersand` now retains the stored selector's `keySetLibrary` on the node
  itself (and on clones), which fixes the explicit ampersand no-context
  selector-match path without widening propagation further
- kept: `packages/core/src/tree/node-base.ts`
  hot generic field/edge helpers now use direct property access instead of
  `Reflect.get` / `Reflect.set`
- result:
  the broader selector/extend/mixin/import/ruleset gate stayed green, and the
  main Less benchmark remained in the current stable band at roughly `3822ms`
  on a `3` run / `1` warmup sample, so this is safe but not a breakthrough
- kept: `packages/core/src/tree/node-base.ts`
  `adopt(...)` now skips render-key parent-edge writes when the edge already
  points at the right parent
- result:
  the broader selector/extend/mixin/import/ruleset gate stayed green, and the
  main Less benchmark moved from the `~3.82s` band down to the `~2.84s` band
  across repeated `3` run / `1` warmup samples (`2843ms`, `2839ms`)
- interpretation:
  edge bookkeeping was materially more expensive than it looked, and redundant
  parent-edge writes are a first-class hot-path culprit, not noise
- kept: `packages/core/src/tree/util/cursor.ts`
  `addEdge(...)`, `addEdgeAt(...)`, and `addParentEdge(...)` now all skip
  redundant map writes when the active render-key mapping is already correct
- result:
  the same broader gate stayed green, and the main Less benchmark improved a
  bit again to roughly `2834ms`
- kept: `packages/core/src/tree/util/selector-utils.ts`
  removed hot no-context generic `.get('field')` selector reads from the main
  selector composition helpers in favor of direct canonical field access
- result:
  the same broader gate stayed green, and the main Less benchmark improved
  again to roughly `2790ms`
- kept: `packages/core/src/tree/ampersand.ts`
  removed additional no-context generic selector reads from template merge /
  append paths in favor of direct canonical field access
- result:
  the same broader gate stayed green, and repeated big-benchmark samples came
  in at `2862ms` and then `2770ms`; keep this as part of the current good band,
  not as an isolated breakthrough
- kept: `packages/core/src/tree/selector-list.ts`
  flattened generated top-level `:is(...)` items using direct canonical
  `name` / `arg` / `value` field reads after resolving the active list once
- result:
  selector-list + broader selector/extend/mixin/import/ruleset gates stayed
  green, and the big benchmark held at roughly `2789ms`
- kept: `packages/core/src/tree/ruleset.ts`
  selector visibility / implicit-ampersand materialization / selector-list
  filtering helpers now use direct canonical selector fields instead of generic
  `.get(...)` calls
- result:
  the same gate stayed green, and the big benchmark improved again to roughly
  `2752ms`
- kept: `packages/core/src/tree/selector-compound.ts`
  canonical `valueOf()` now unwraps generated `:is(...)` children through
  direct `name` / `arg` / `value` reads
- result:
  the same gate stayed green, and the next benchmark sample was `2779ms` with
  higher variance; treat this as neutral-to-slightly-positive and keep it until
  a larger regression proves otherwise
- kept: `packages/core/src/tree/util/extend-core.ts`
  canonical selector helper paths no longer use generic
  `.get('value'|'name'|'arg')` reads; generated `:is(...)` expansion,
  selector-list normalization, compound/context stripping, ampersand
  materialization, ordered tail selection, and exact-alternative append paths
  all now use direct field reads on already-resolved selector objects
- result:
  the broad selector/extend/mixin/import/ruleset gate stayed green across each
  incremental pass, and the big benchmark moved through `2718ms`, `2757ms`,
  and then `2714ms`
- kept: `packages/core/src/tree/util/extend-roots.ts`
  generated `:is(...)` normalization and top-level selector-list scans now use
  direct canonical selector fields instead of generic getters
- result:
  the same gate stayed green, and the big benchmark held at roughly `2714ms`

Recent rejected evidence:

- rejected: deleting descendant `keySetLibrary` restamping in
  `packages/core/src/tree/ampersand.ts::cloneStoredSelector(...)`
- reason:
  explicit ampersand selector matching still depends on descendant selector
  clones having a usable library in no-context paths
- implication:
  do not keep deleting selector-library propagation blindly; first provide a
  demand-driven descendant fallback model that survives stored-selector clone
  matching

## Transitional Baggage To Remove

Only listed here when it directly blocks edge/cursor work:

- generic child-edge scaffolding
- hidden no-context fallbacks that still depend on old state overlay
- clone/materialize behavior used in place of edge/cursor ownership
- `packages/core/src/tree/util/field-helpers.ts` as the activeState compatibility sewer
- `packages/core/src/tree/util/legacy-node-ops.ts` as quarantined returned-result shaping
- `Rules.renderParent` as an undocumented scope-parent side channel

## Future Runtime Overhead

These are not edge/cursor blockers by themselves, but they should be tracked as
follow-on runtime cleanup once the active correctness bugs are stable.

- `packages/core/src/define-function.ts` still exposes function metadata through
  a `Proxy`.
  Desired end-state: attach stable metadata (`name`, `options`, `_internal`)
  directly to the callable with `defineProperty`/`defineProperties` instead of a
  per-access trap wrapper.

## Active Less Fixture Seams

- Workflow rule for Jess parity:
  when a red shows up only in `packages/jess/test/less/all-less.test.ts`,
  prefer adding a parser-accurate focused core repro first when practical.
  Use the core repro as the fast debugging loop and keep the Jess fixture as the
  outer parity confirmation.

Recent proof milestone:

- `packages/core/src/tree/__tests__/node-graph.test.ts` now provides direct
  graph-level coverage for canonical parent walks, render-key wrapper parent
  walks, detached unlock wrappers, `CALLER` as a secondary lane, and the
  core child-edge helper behavior. Treat that suite as the baseline proof that
  parent/cursor primitives themselves are working before debugging higher-level
  mixin/import behavior.

- `tests-unit/property-accessors/property-accessors.less`
  Fixed.
  A focused core repro now exists in
  `packages/core/src/tree/__tests__/declaration.test.ts` proving that merged
  property declarations must remain visible both to later nested property
  lookups and to the parent declaration chain itself.
  The actual fix was in post-eval declaration coalescing:
  `Rules._coalesceMergedDeclarations()` now appends `+:` anchor values instead
  of replacing the earlier anchor with the later scalar.

- `tests-unit/mixins-interpolated/mixins-interpolated.less`
  Fixed.
  The remaining start-of-selector `:is(...)` differences now live only in
  fixture-parity cases where Jess groups selector-list parents and Less expands
  them into repeated selectors.

- `tests-unit/extend/extend.less`
  Fixed.
  The parser-backed failure was not serializer ordering; it was target
  resolution after a prior local `all` extend widened the child own-selector
  list. The durable fix is in `packages/core/src/tree/util/extend-roots.ts`:
  `applyInstructionToRuleset(...)` can fall back to the live own-selector
  surface for exact local-child extend, but only under a single-parent-selector
  parent and only when the active parent selector does not already contain the
  extender.

- `packages/jess/test/less/all-less.test.ts`
  Current focused Less fixture state:
  - `tests-unit/extend-nest/extend-nest.less`
    accepted fixture update in the Less worktree
  - `tests-unit/rulesets/rulesets.less`
    still a live regression
  Future follow-up for `extend-nest.less` only if it stays narrow:
  detect a generated grouped selector like `:is(.button, .submit):hover` as a
  no-value extend target when adding the redundant `.submit:hover` alternate,
  without introducing broad selector-subsumption logic.
  Current `rulesets.less` diagnosis:
  Jess is spreading the current selector list `#fourth, #five, #six` into
  full-path alternatives after parent composition, where the canonical model
  should preserve that current selector as a grouped fragment under the
  already-composed parent before child routes are applied.
  Formatting parity is restored for:
  - `tests-unit/css-3/css-3.less`
  - `tests-unit/css-grid/css-grid.less`
  - `tests-unit/whitespace/whitespace.less`
  with the durable fixes living in:
  - `packages/core/src/tree/list.ts`
  - `packages/core/src/tree/declaration.ts`
  Core baseline is green again after:
  - `packages/core/src/tree/rules.ts`
    narrowed `Rules.flatRules(...)` ordering so late mixin-produced `Rules`
    wrappers do not jump ahead of earlier pending descendants unless the parent
    declaration block has already started
  - `packages/core/src/tree/util/selector-utils.ts`
    restoring type-selector ordering for authored compound ampersand collapse
  - `packages/core/src/tree/__tests__/extend-import-style.test.ts`
    refreshing collapse-mode snapshots to the simpler semantically-equivalent
    descendant selector shapes now emitted by Jess
  Current narrowing:
  a parser-accurate core repro now exists in
  `packages/core/src/tree/__tests__/mixin.test.ts` for the final
  `.Person(person, "Male"); .person.sayGender();` case.
  The repro fails with the same real runtime error:
  `ReferenceError: 'gender_' is not defined`.
  Important findings from this pass:
  - the Less parser shape matters here:
    - `.@{name}` parses as `InterpolatedSelector(Interpolated source: '.%%')`
    - `.person.sayGender()` parses as a single compound `mixin-ruleset`
      reference path, not as nested target/key references
  - selector/mixin registry reads now use context-aware selector access in
    `registry-utils.ts`; that did not fix the closure failure by itself
  - caller-scope lookup in `reference.ts` now treats a `CALLER` edge that
    already points at `Rules` as the rules scope directly; that also was not
    sufficient by itself
  - keep the lookup model disciplined while debugging this:
    - `.parent` is the current primary lookup path
    - `sourceParent` is stable definition provenance only
    - caller fallback is additive on `parentEdges.get(CALLER)`
    - canonical reads should use direct fields, while placement-sensitive reads
      must stay on edge-aware accessors
  The live seam is narrower now:
  invocation-time scope/parent propagation inside
  `util/mixin-instance-primitives.ts` is still letting the emitted nested
  `.person` subtree lose access to the outer mixin param scope while the outer
  mixin body is being evaluated.

- `tests-unit/mixins-guards/mixins-guards.less`
  Current narrowing:
  the old lock-closure and recursive-mixin failures are fixed in reduced repros
  and in the nearby Less fixtures (`mixins-closure.less`,
  `mixins-advanced.less`). The earlier
  `ReferenceError: 'space-list' is not defined` is now removed.
  Reduced repro:
  shared `.generic(...)` guarded overloads plus
  `.variouse-types-comparison { ... }` followed by
  `.list-comparison { ... }`.
  The same `.list-comparison` block passes in isolation and only fails after the
  earlier guarded calls run, which still points at render-key / pre-eval state
  reuse leakage across repeated guarded mixin evaluation rather than parser
  output shape or serializer behavior.
  The live remainder is now output-shaped:
  repeated guarded calls produce missing spaces in emitted `content:` values and
  drop the later `.call-lock-mixin .call-inner-lock-mixin` block inside the full
  fixture, even though `mixins-closure.less` still passes in isolation.
  Current narrower repro finding:
  the emitted nested `.inner-locked-mixin(@x: @a)` definition survives, but its
  sibling call still reevaluates to `Nil`. The eval mixin wrapper already carries
  the outer param scope on its current placement, but some downstream reads still
  bypass that placement state and observe canonical child fields instead.
  Next step:
  remove direct child-field reads in the guarded mixin path before adding more
  source-parent repair logic.

## Clone / Materialize Debt

These seams are not acceptable end-state architecture. Each item should be
deleted, not normalized.

### Active Deep-Clone Seams


| Seam                                                                                                             | Why It Exists Today                                                                                              | Blocker To Delete                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/tree/util/mixin-instance-primitives.ts` `freezeChildren` / `copy(true, freezeChildren)` paths | Param binding and rest/arguments normalization still assume detached copied values in some mixin argument flows. | Finish converting arg binding/rest aggregation to wrapper + edge ownership and remove frozen-copy fallback.                                                         |
| `packages/core/src/tree/interpolated.ts` deep clone of replacements                                              | Deep clone support still exists in generic clone implementation for interpolated replacement trees.              | Once runtime callsites stop depending on deep clone semantics, collapse `Interpolated.clone(deep)` to shallow/container-only behavior or delete deep mode entirely. |


### Suspicious Shallow-Clone / Materialize Seams

These are smaller than deep clones, but still need explicit justification and
should be deleted when their blockers clear.


| Seam                                                                                        | Why It Exists Today                                                                                                                                                         | Blocker To Delete                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/tree/rules.ts` `createShallowBodyWrapper()` / `createPlacementWrapper()` | Thin wrapper owners currently carry placement-local registries and child-edge ownership.                                                                                    | Replace remaining wrapper-only registry/state behavior with direct cursor/edge traversal where container identity does not actually diverge.           |
| `packages/core/src/tree/import-style.ts` postlude wrapper path                              | Import postlude wrapping still detaches prelude/container nodes instead of reading the authored postlude shape directly through placement state.                            | Inline postlude shape decoding into the wrapper loop and attach only the new owning `AtRule` containers.                                               |
| `packages/core/src/tree/util/scoped-body-eval.ts` scoped body wrapper creation              | `$for`/scoped eval still allocates a wrapper owner for each placement. Deep clone is gone from this hot seam, but wrapper ownership is still broader than the target model. | Finish control conversion so loop bindings/placement can attach directly to canonical body structure without a scoped-body helper.                     |
| `packages/core/src/tree/ruleset.ts` / selector utilities `clone(false)` snapshots           | Selector recomposition still uses detached selector shells in a few ownership-sensitive paths.                                                                              | Convert selector composition to parent-edge/cursor-owned container replacement so selector snapshots are not needed as a safety rail.                  |
| `packages/core/src/tree/import-style.ts` top-level placement wrappers                       | Import evaluation still needs thin top-level wrappers to give each import site its own render-owned registry and parent edges before eval.                                  | Finish direct parent-edge/cursor traversal for import-owned registries so imported top-level children do not need a dedicated placement wrapper owner. |


### Tracking Rule

When a clone/materialize seam is removed:

1. delete it from this section
2. note the focused proof file that now protects the replacement model
3. do not replace it with a differently named clone/materialize helper

Recent removal:

- `packages/core/src/tree/call.ts` fallback-call arg deep clone was deleted.
  Proof: `packages/core/src/tree/__tests__/call.test.ts`
- `packages/core/src/tree/call.ts` JS-function arg deep clone was deleted.
  Proof: `packages/core/src/tree/__tests__/call.test.ts`
- `packages/core/src/tree/function.ts` no longer routes stylesheet-defined
  functions through temporary mixins or `freezeChildren()`.
  Proof: `packages/core/src/tree/__tests__/func.test.ts`

### End-State

The desired destination is to remove generic `.clone()` / `.copy()` from
`packages/core/src/tree/node-base.ts` as normal runtime escape hatches.

That should happen in this order:

1. delete production deep-clone callsites
2. delete production shallow-clone/materialize callsites that only exist for
   eval isolation
3. replace any remaining legitimate uses with explicit derived-node/container
   constructors
4. only then remove generic clone/copy from `node-base`

No longer active baggage in core test files:

- direct `activeState` / `EvalState` test setup
- direct `setField` / `getField` test mutation APIs

## Recent Perf Evidence

- Rejected:
  `packages/core/src/tree/util/registry-utils.ts`
  `FunctionRegistry.cloneForRules(...)` conditional empty `Map` / `Set` cloning.
  Focused reference/import gates stayed green, but the real Less benchmark
  regressed to about `2770ms`. Keep the simpler unconditional clone until a
  larger registry-owner change replaces it.
- Kept:
  `packages/core/src/tree/reference.ts`
  no longer shallow-clones every resolved value by default.
  Materialization now happens only when source-parent attachment or dependency
  isolation is actually needed. This held under focused reference/import/mixin
  proofs and kept the big benchmark in the good band (`~2727ms` to `~2733ms`).
- Kept:
  `packages/core/src/tree/reference.ts`
  direct field reads for `target` / `key`.
  There are no render/eval edge overrides for those children anywhere in core,
  so `this.get('target'|'key', context)` was pure abstraction tax.
- Kept:
  `packages/core/src/tree/extend.ts`
  direct field reads for `selector` / `target` / `namespace` / `flag`.
  Same rationale: no edge-backed overrides exist for these child fields.
  The benchmark stayed in the good band (`~2727ms`).
- Kept:
  `packages/core/src/tree/selector-pseudo.ts`
  direct field reads for `name` / `arg`.
  This moved the real `benchmark.less` run down to about `2693ms`, the current
  best band.
- Rejected:
  `packages/core/src/tree/selector-attr.ts`
  direct field reads for `name` / `value` / `op` / `mod`.
  Focused selector/import/mixin gates stayed green, but the real benchmark
  regressed to about `2734ms`.
- Rejected:
  `packages/core/src/tree/call.ts`
  direct field reads for `name` / `args` / `contentNode`.
  Focused call/import/mixin/reference gates stayed green, but the real
  benchmark cratered to about `2786ms`.
- Kept:
  `packages/core/src/tree/mixin.ts`
  direct field reads for `name` / `rules` / `params` / `guard`.
  This improved the big benchmark again to about `2687ms`, the current best
  band.
- Rejected:
  `packages/core/src/tree/operation.ts`
  direct field reads for `left` / `right`.
  Expression/mixin/import/reference gates stayed green, but the real benchmark
  regressed to about `2725ms`.

## Current Culprit Order

1. Generic clone / inherit / adopt pressure in `packages/core/src/tree/node-base.ts`
2. No-edge generic field reads in hot structural nodes
   - proven keeps: `Reference`, `Extend`, `PseudoSelector`, `Mixin`
   - proven rejects: `SelectorAttr`, `Call`, `Operation`
   - next candidate only if profiling justifies it: `Condition`
3. Wrapper / registry-owner churn in `packages/core/src/tree/rules.ts`
   and `packages/core/src/tree/util/registry-utils.ts`
4. Ruleset selector/body materialization in `packages/core/src/tree/ruleset.ts`

Ranking rule:

- move a seam up when it produces a real `benchmark.less` win
- move it down immediately when it only looks clean architecturally but regresses
  the benchmark

## Ranked Allocation Sources

Fresh `benchmark.less` profile (`node --cpu-prof`) says the current runtime is
not dominated by one leak-like sink. It is dominated by allocation rate.
`(garbage collector)` was the single largest bucket, and the hottest JS frames
under it were all object/string creation sites.

### 1. Selector requirement planning

Primary frames:

- `packages/core/src/tree/util/selector-match-core.ts`
  `buildGroupRequirements(...)`
- `packages/core/src/tree/util/selector-match-core.ts`
  `buildRouteMatchPlan(...)`

Likely allocations:

- `MatchGroupRequirement` objects
- `Map<string, number>` for `basicSelectorIndex`
- `number[]` for `basicSelectorCounts`
- merged requirement clones from `cloneRequirement(...)` / `mergeRequirements(...)`
- transient route/group arrays

Why it matters:

- this is the top non-GC self-time frame in the fresh profile
- it runs repeatedly under extend matching
- current evidence says planner shape/allocation cost is more important than
  accessor trivia inside it

### 2. Generic node cloning and inheritance

Primary frames:

- `packages/core/src/tree/node-base.ts`
  `cloneFn`
- `packages/core/src/tree/node-base.ts`
  `clone(...)`
- `packages/core/src/tree/node-base.ts`
  `inherit(...)`

Likely allocations:

- reconstructed node instances via constructor/`Reflect.construct(...)`
- copied arrays and copied record bags during clone
- temporary parent-edge bookkeeping arrays like `priorChildParents`
- copied options/meta/location carrier objects

Why it matters:

- these frames are consistently near the top in every fresh profile
- they line up with the runtime model drifting toward materialize/rebuild work
  instead of sparse patching

### 3. Generated node construction during selector rewrites

Primary frames:

- `packages/core/src/tree/node-base.ts`
  `Node.create(...)`
- selector constructors reached through extend/ampersand helpers

Likely allocations:

- `ComplexSelector`, `CompoundSelector`, `SelectorList`, `PseudoSelector`
  instances
- fresh child arrays passed into those constructors
- follow-on adoption/parent bookkeeping work

Why it matters:

- extend rewrites currently rebuild selector structure aggressively
- profile shows constructor time adjacent to clone/inherit time, which implies
  rewrite-created nodes are a real share of churn

### 4. Global extend orchestration work

Primary frames:

- `packages/core/src/tree/util/extend-roots.ts`
  `processExtends(...)`
- `packages/core/src/tree/util/extend-roots.ts`
  `getRulesetExtendTarget(...)`

Likely allocations:

- visible-instruction arrays
- target-info cache entries
- selector signatures / normalized comparison strings
- transient per-ruleset/per-instruction bookkeeping

Why it matters:

- `benchmark.less` has real extend load, not fake incidental noise
- extend processing is a whole-program fixed-point pass, so even modest per-step
  churn amplifies across many rulesets/instructions

### 5. Selector composition and route rebuilding

Primary frames:

- `packages/core/src/tree/util/selector-utils.ts`
  `composeSelectorRouteWithParent(...)`
- `packages/core/src/tree/ruleset.ts`
  `getEffectiveSelector(...)`

Likely allocations:

- recomposed selector route arrays
- wrapper selectors / combinator sequences
- derived selector snapshots used to preserve ownership semantics

Why it matters:

- these functions sit on the hot path between canonical selector state and the
  effective selector that extend matching actually sees
- any rebuild here compounds the cloning/rewrite churn above

### 6. Normalized string churn

Primary frames:

- `packages/core/src/tree/node-base.ts`
  `valueOf(...)`

Likely allocations:

- temporary normalized selector strings
- temporary array-of-parts strings in container `valueOf(...)`
- signature strings used by extend-root bookkeeping

Why it matters:

- `valueOf(...)` showing up hot means matching/orchestration is still leaning
  too much on serialized structure instead of compact structural facts

## Allocation Interpretation

The current GC cost is best explained by this pipeline:

1. `processExtends(...)` drives repeated matching across many rulesets
2. selector matching builds requirement/planning objects
3. successful matches trigger selector composition/rewrite work
4. rewrites create new selector nodes and copy metadata through clone/inherit
5. matching/orchestration repeatedly normalizes selectors through `valueOf()`

So the GC problem is not “mystery GC.”
It is:

- planner object churn
- clone/materialization churn
- generated selector-node churn
- normalized string churn

## Current Rethink Direction

This profile changes the next-step strategy:

- stop assuming micro “obvious” fast paths will pay off
- prioritize changes that reduce search-space or object lifetime, not just line
  count inside a hot function
- treat the extend pipeline itself as suspect architecture:
  - whole-program fixed-point scans
  - repeated selector planning
  - repeated selector composition
  - repeated clone/materialize work

Near-term priority order from this evidence:

1. reduce planner object creation in `selector-match-core.ts` without changing
   result semantics
2. reduce clone/materialize work in `node-base.ts` and direct callers
3. reduce selector recomposition in `ruleset.ts` / `selector-utils.ts`
4. only after that, revisit orchestration-level caching in `extend-roots.ts`
