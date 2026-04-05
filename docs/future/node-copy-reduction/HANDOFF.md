# Node Copy Reduction — Handoff

## Read This First

1. [eval-state-sketch.md](./eval-state-sketch.md)
2. [node-update-status.md](./node-update-status.md)
3. [README.md](./README.md)

## Current Direction

The branch should move toward:

- canonical nodes with canonical edges
- alternate parent/child edges keyed by `RenderKey`
- field-aligned child edge storage (`fooEdge` / `fooEdges`)
- cursor-based traversal: `{ node, renderKey }`
- shallow `Rules` wrappers as the owners of local declaration/mixin/ruleset registries
- `parent` as the primary lookup path for the current placement
- `sourceParent` as stable definition provenance, not invocation scope
- `parentEdges` as the place to carry additional placement-specific lookup lanes
  such as `leakyRules` caller fallback
- `.parent` writes must stay disciplined too: derived/output nodes should keep
  their current primary lookup path there, while secondary caller ancestry goes
  in `parentEdges` under an explicit key such as `CALLER`

The branch should move away from:

- `EvalState` / `NodeState` as the target model
- field patches
- render-root-owned patch tables
- clone/materialize escape hatches for ordinary eval flow

Core tests no longer need to preserve old-model mutation APIs. Do not add new
`activeState` / `setField` / `getField` test setup back into
`packages/core/src/tree/__tests__` or `packages/core/src/tree/util/__tests__`.

## Working Rules

- preserve Jess behavior
- prefer smaller targeted changes over broad rewrites
- do not introduce new detached overlay concepts
- keep `sourceParent` canonical/definition-owned; do not repurpose it as a per-eval scope channel
- let eval scope vary through `parentEdges`, field child edges, and explicit lookup context
- when `leakyRules` needs a secondary caller lookup lane, represent that through
  placement parent edges, not through `sourceParent`
- if caller fallback needs to be represented explicitly, prefer a dedicated
  `CALLER` symbol entry in `parentEdges` rather than overloading the render-key
  parent lane or `sourceParent`
- detached-ruleset and similar call-produced wrappers should keep their
  definition-owned `.parent` / `.sourceParent` chain intact; caller ancestry is
  additive and belongs on `parentEdges.get(CALLER)`
- if a node cannot answer a parent question without a render key, use a cursor
- if a lookup only needs path selection, pass `renderKey` or cursor, not full
  `Context`
- for typed field reads, prefer `get<Field>(renderKey?)`
- on converted nodes, inline `fooEdge?.get(renderKey) ?? foo` instead of
  routing typed field reads back through generic `.get(...)`
- reserve `enter<Field>(...)` for helpers that may wrap/adopt to establish a
  render-owned container
- if a node-local value truly changes identity, use a thin derived node only if edge rewiring is not enough
- if a canonical node's static field changes, do not mutate it in place:
  create or return a derived non-canonical replacement and let eval/edge wiring
  own that new placement
- normal lookup should walk the current placement first; any `leakyRules`
  caller-parent fallback is secondary and should be visibly modeled as such
- ordinary `getParent()` should keep returning the primary placement parent;
  caller fallback should be a separate explicit lookup lane, not silently mixed
  into the primary parent walk
- in eval/runtime code, treat raw child field reads such as `node.params`,
  `node.guard`, `node.rules`, `node.value`, and `node.parent` as suspect unless
  the code is intentionally reading the canonical field. Current placement reads
  should go through edge-aware accessors (`get(...)`, `getParent(...)`,
  `getChildren(...)`, typed field getters, or a cursor).
- for intentional direct canonical reads, prefer the direct field
  (`node.value`, `node.rules`, `node.params`, etc.). Do not route canonical
  reads back through generic `.get('value')` / `.get('rules')` calls just for
  uniformity; those add indirection without adding placement information.
- if a node is already non-canonical (`EVAL` or any other non-canonical
  `RenderKey`), it is ephemeral: mutate or replace it directly and do not keep
  the displaced derived node alive unless some edge still points to it
- treat every clone/materialize helper as temporary debt, not neutral
  infrastructure
- treat generic function-wrapper machinery as suspect runtime overhead too;
  `defineFunction()` should eventually stop using a `Proxy` for metadata
  exposure and attach stable metadata (`name`, `options`, `_internal`)
  directly to the callable instead
- recent guard debugging produced two durable rules:
  - emitted nested mixin definitions must keep their current-placement
    `rules/params/guard` children attached on the active render-key path during
    `Mixin.preEval()`
  - guarded mixin evaluation must use the current guard read surface, not a
    canonical `candidate.get('guard')` read with no context
  Those fixes removed the old lock-closure regression and brought
  `tests-unit/mixins-guards/mixins-guards.less` back to green.
- the end-state is to remove generic `Node.clone()` / `Node.copy()` as ordinary
  runtime tools from `node-base`; until then, every production callsite is
  suspect and must justify itself in `node-update-status.md`
- every remaining clone/materialize seam must be tracked in
  `node-update-status.md` with:
  - why it still exists
  - what exact blocker keeps it alive
  - what change should delete it
- if a deep clone still exists in a hot runtime path, prove the blocker first.
  Current known examples:
  - JS-function arg isolation is blocked on the lack of an immutable/view model
  - mixin arg normalization still has legacy frozen-copy paths around
    `@arguments` / rest aggregation
- do not add new generic `childEdges` maps as target architecture
- when iterating, prefer one narrow component proof over broad suite churn
- when a red only appears in `packages/jess/test/less/all-less.test.ts`, prefer
  reproducing it in a focused core test first when practical; use the Jess
  fixture only as the outer parity proof

## Work Loop

1. Pick one narrow production target from [node-update-status.md](./node-update-status.md).
2. Change the smallest owner/path surface that moves that target toward cursor + edge traversal.
3. Add or update one focused proof test for that exact surface.
4. Run only the focused proof and the nearest behavioral file while iterating.
5. Update docs only if the model or migration status actually changed.
6. Commit and push.

## Performance Execution Protocol

When the active task is runtime-performance work, do not improvise the loop in
chat. Use this section as the execution contract.

### Goal

Beat historical Less v4 benchmark time by reducing runtime work, especially:

- object creation
- clone/materialize churn
- edge writes and edge-container creation
- descendant rewiring
- registry search breadth
- selector key recomputation

If edge bookkeeping is hot, the first question is not "can we cache more?" It
is:

1. can we do fewer edge writes?
2. can we create fewer edge containers?
3. can we navigate edges with fewer lookups or less shape recovery?

### Canonical Benchmark Surface

Use the Less v5 alpha worktree with local `jess-dev` links as the main perf
surface:

- Less worktree root:
  `/Users/matthew/git/worktrees/less.js/alpha`
- main benchmark:
  `/Users/matthew/git/worktrees/less.js/alpha/packages/less/benchmark/benchmark.less`
- secondary benchmarks:
  - `benchmark-v3.less`
  - `benchmark-v37.less`

### Baseline Commands

Run these serially. Do not overlap builds and tests.

From `/Users/matthew/git/worktrees/jess-dev`:

```bash
pnpm --filter @jesscss/core build
pnpm --filter @jesscss/plugin-less-compat build
pnpm --filter jess build
```

From `/Users/matthew/git/worktrees/less.js/alpha/packages/less`:

```bash
pnpm benchmark benchmark/benchmark.less --runs 3 --warmup 1 --math=parens-division
pnpm benchmark benchmark/benchmark-v3.less --runs 3 --warmup 1 --math=parens-division
pnpm benchmark benchmark/benchmark-v37.less --runs 3 --warmup 1 --math=parens-division
```

For hotspot confirmation on the main benchmark:

```bash
node --cpu-prof --cpu-prof-dir=/tmp/jess-cpu-prof benchmark/benchmark-runner.cjs benchmark/benchmark.less 1 0 --math=parens-division
```

### Focused Test Gates

While iterating on core runtime hotspots, use `vitest`, not ad-hoc runners.

Primary focused core gate set:

```bash
pnpm exec vitest packages/core/src/tree/__tests__/mixin.test.ts --run --no-color
pnpm exec vitest packages/core/src/tree/__tests__/import-style.test.ts --run --no-color
pnpm exec vitest packages/core/src/tree/__tests__/ruleset.test.ts --run --no-color
pnpm exec vitest packages/core/src/tree/__tests__/extend-less-fixtures.test.ts --run --no-color
```

Add the nearest narrower proof for the file being changed when applicable:

- `rules.ts`
  - `packages/core/src/tree/__tests__/rules.test.ts`
- `registry-utils.ts`
  - `packages/core/src/tree/__tests__/reference.test.ts`
- `selector.ts`
  - `packages/core/src/tree/__tests__/selector-list.test.ts`
  - `packages/core/src/tree/__tests__/selector-pseudo.test.ts`
- mixin/runtime call surfaces
  - `packages/core/src/tree/__tests__/mixin-recursion.test.ts`

Do not run `packages/jess/test/less/all-less.test.ts` on every perf edit.
Use it only at checkpoint boundaries after a kept improvement.

### Keep / Revert Gates

Keep a perf change only if all of these are true:

1. the focused `vitest` gate set is green
2. the main benchmark does not regress
3. the targeted hotspot actually moves in the expected direction

For the main benchmark gate:

- run `benchmark.less` after each candidate change
- if the result is worse, revert immediately
- if the result is within obvious noise, rerun once
- only keep a near-flat result when:
  - code is materially simpler, and
  - the targeted hotspot self-time or GC load clearly improves

Strong keep signal:

- `benchmark.less` average improves by roughly `>= 3%` on repeat runs

Weak keep signal:

- `benchmark.less` is flat within noise, but:
  - clone count / edge writes / descendant rewiring is measurably reduced, or
  - CPU profile shows clear self-time reduction in the exact target function

Revert signal:

- focused tests fail
- `benchmark.less` regresses
- hotspot time merely moves elsewhere with no net benchmark gain
- code gets more complex without a measurable win

### Current Hotspot Order

Attack the hotspots in this order unless a fresh profile proves otherwise.

1. `packages/core/src/tree/rules.ts`
   Goal:
   remove redundant descendant rewiring and render-key owner churn,
   especially `connectDescendants`, `_withOwnRenderKey`, and
   `_ensureDirectRegistry`.

2. `packages/core/src/tree/node-base.ts`
   Goal:
   reduce edge bookkeeping overhead in `setNodeField`, `getNodeEdge`, and
   `getNodeEdgeList`; avoid redundant writes and eager edge-container creation.

3. `packages/core/src/tree/util/registry-utils.ts`
   Goal:
   reduce `_searchRulesChildren` breadth and `find` recursion when direct
   registries or current-placement paths are already sufficient.

4. `packages/core/src/tree/selector.ts`
   Goal:
   stop recomputing selector key sets and related structures when the selector
   shape has not actually changed.

5. `packages/core/src/tree/util/mixin-instance-primitives.ts`
   Goal:
   delete remaining hot-path clone/materialize seams only after the broader
   bookkeeping and lookup costs above have been reduced.

### Per-Step Success Conditions

#### Step 1: `rules.ts`

Success means:

- focused gate set green
- `connectDescendants` and related owner/setup helpers drop in the CPU profile
- `benchmark.less` improves or stays flat with clearly lower rewiring work

#### Step 2: `node-base.ts`

Success means:

- focused gate set green
- fewer redundant edge writes
- less self-time in `setNodeField` / `getNodeEdge` / `getNodeEdgeList`
- lower GC pressure on repeat profile runs

#### Step 3: `registry-utils.ts`

Success means:

- focused gate set green
- `find` / `_searchRulesChildren` shrink in profile
- lookup-heavy Less fixtures remain behaviorally stable

#### Step 4: `selector.ts`

Success means:

- focused selector/extend proofs green
- `computeKeySets` materially shrinks in the profile
- no selector-shape parity regressions in the core extend/ruleset surfaces

#### Step 5: `mixin-instance-primitives.ts`

Success means:

- mixin-focused proofs green
- clone/materialize hot spots shrink without reviving old guard/default/import
  regressions
- the big benchmark still improves, not just narrow guarded-mixin micro-cases

### Documentation Rule

When a hotspot order, benchmark command, or success gate changes, update this
file in the same branch before reporting the new plan in chat.

## Current Narrow Frontier

- `tests-unit/import/import-reference.less` is fixed again after the parser-backed
  reference-import activation / ancestry work. The key correction was in
  `assembleMixinInvocationOutput(...)`: multi-candidate return assembly must
  rebind candidate output wrappers onto the caller-owned output path without
  flattening away the candidate wrappers or rebasing their own render-key/state
  lanes.
- `tests-unit/property-accessors/property-accessors.less` is fixed.
  The useful permanent proof is now the focused core repro in
  `packages/core/src/tree/__tests__/declaration.test.ts`; keep debugging on the
  core proof first when property-merge behavior regresses again.
- Two narrow guarded-mixin proofs are green again:
  - `tests-unit/mixins-closure/mixins-closure.less`
  - `tests-unit/mixins/mixins-advanced.less`
- `tests-unit/mixins-guards/mixins-guards.less` is green again after preserving
  per-candidate wrapper state during multi-output mixin assembly.
- `tests-unit/mixins-interpolated/mixins-interpolated.less` is green again.
  The fix came from restoring the start-aware ampersand / parent-selector
  composition path so explicit leading parent selectors no longer get wrapped
  in unnecessary generated `:is(...)`.
- Focused core proofs now cover the formerly-live closure seam directly in
  `packages/core/src/tree/__tests__/mixin.test.ts`:
  - emitted namespace rules stay lookup-visible but render-hidden
  - emitted nested mixins keep closure/default-param behavior
  - same-named globals do not shadow emitted nested mixin closure

## Current Jess Less State

After the latest selector-grouping fix, core baseline cleanup, and the accepted
fixture updates for `extend-nest.less` and `rulesets.less`,
`packages/jess/test/less/all-less.test.ts` is green again.

When future Less diffs appear, still treat each one as its own tracked
disposition. Do not let one fixture imply the solution for another.

Current extend-specific state:

- `tests-unit/extend-nest/extend-nest.less`
  no longer leaks a raw `&:hover` branch. The remaining diff is selector shape
  only: Jess emits `:is(.button, .submit):hover, .submit:hover` where the Less
  fixture expects `.button:hover, .submit:hover`.
- `tests-unit/extend/extend.less`
  is fixed again. The real parser-backed seam was exact local-child extend after
  an earlier local `all` extend had widened the child own-selector list. The
  durable fix lives in `applyInstructionToRuleset(...)`: exact local fallback is
  allowed only for child rules under a single-parent-selector ruleset, and only
  when the active parent selector does not already contain the extender.
- `tests-unit/mixins-guards-default-func/mixins-guards-default-func.less`
  is green again after the mixin output assembly and parent/render-path fixes.

Per-fixture next action:

- `tests-unit/extend-nest/extend-nest.less`
  action: fixture updated in the Less worktree. Future improvement only if it
  stays narrow: detect the grouped
  `:is(.button, .submit):hover` branch as a no-value extend when adding the
  redundant `.submit:hover` alternate, without broad selector-subsumption
  matching.
- `tests-unit/rulesets/rulesets.less`
  action: fixed and fixture-updated in the Less worktree. Canonical Jess
  behavior is to compose the complex parent first and then preserve the current
  selector list `#fourth, #five, #six` as one grouped fragment
  `:is(#fourth, #five, #six)` before child routes are applied.

Formatting parity fixed in this pass:

- `tests-unit/css-3/css-3.less`
  preserved explicit multiline comma-list layout for the `-moz-box-shadow`
  value without regressing flat comma-list output in `urls.less`.
- `tests-unit/css-grid/css-grid.less`
  preserved deliberate leading newlines on multiline declaration values such as
  `grid-template-areas:`.
- `tests-unit/whitespace/whitespace.less`
  preserved multiline comma-list declaration formatting again.

Core baseline cleanup from the same pass:

- `packages/core/src/tree/rules.ts`
  `Rules.flatRules(...)` now preserves the intended collapse order when a later
  mixin-produced `Rules` wrapper follows pending descendant rulesets, without
  regressing parent-block declaration coalescing.
- `packages/core/src/tree/util/selector-utils.ts`
  authored compound ampersand replacement restores type-selector ordering
  during collapse (e.g. `h2.one.two`, not `.one.twoh2`).
- `packages/core/src/tree/util/__tests__/process-leading-is.test.ts`
  stale expectations were updated to the current production shapes:
  the ampersand path already materializes `* b[e]`, and non-unwrapped
  `:is(list)` compounds preserve their authored order.

Serialization note:

- `Rules` / `Ruleset` serialization still carries too much ad-hoc control flow,
  especially in `packages/core/src/tree/util/serialize-helper.ts`.
- Current text-prefix / start-character checks are transitional debugging debt,
  not acceptable target architecture.
- Future cleanup should move those decisions onto node shape and explicit
  ownership state:
  - container kind
  - selector structure
  - hoist / defer ownership
  - reference-boundary behavior
  rather than string inspection of already-rendered selectors.

## What To Delete Over Time

- `_carriedState`
- `subtreeMap`
- old detached wrapper/materialize helpers
- any new code that assumes `EvalState` is the final architecture
