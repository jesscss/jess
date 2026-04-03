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
- recent guard debugging narrowed one live Less seam:
  `tests-unit/mixins-guards/mixins-guards.less` is no longer blocked on the old
  lock-closure / recursive-mixin failures. The live failure is now
  `ReferenceError: 'space-list' is not defined`, and the reduced repro only
  fails when the earlier `.variouse-types-comparison` guarded-mixin calls run
  before `.list-comparison`. Treat that as runtime state leakage / reuse across
  repeated guarded mixin evaluation until proven otherwise; do not go back to
  broad parser-shape or mixin-output rewrites first.
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

## Current Narrow Frontier

- `tests-unit/import/import-reference.less` is fixed. Keep the reference-owned
  activation model simple: print suppression defaults off under reference
  boundaries, and only explicit activation paths opt specific descendants back
  in.
- `tests-unit/property-accessors/property-accessors.less` is fixed.
  The useful permanent proof is now the focused core repro in
  `packages/core/src/tree/__tests__/declaration.test.ts`; keep debugging on the
  core proof first when property-merge behavior regresses again.
- Two narrow guarded-mixin proofs are green again:
  - `tests-unit/mixins-closure/mixins-closure.less`
  - `tests-unit/mixins/mixins-advanced.less`
- The remaining real runtime red that now has the best focused repro is
  `tests-unit/mixins-interpolated/mixins-interpolated.less`.
  Current parser-accurate core repro lives in
  `packages/core/src/tree/__tests__/mixin.test.ts` and fails with
  `ReferenceError: 'gender_' is not defined` for the
  `.Person(person, "Male"); .person.sayGender();` case.
  Treat that as the active closure/invocation-scope seam:
  emitted interpolated nested rulesets are reachable, but outer param scope is
  still being lost while the outer mixin body is evaluated.
  The working model to preserve while debugging it is:
  - `.parent` is the current primary lookup path for the placement
  - `sourceParent` remains the canonical definition owner
  - caller fallback stays additive on `parentEdges.get(CALLER)`
  - direct canonical reads should use direct fields, while current-placement
    reads must stay on edge-aware accessors
- Minimal production-shaped repros for nested lock capture and recursive mixins
  are green. The remaining live Less blocker in that family is still
  `tests-unit/mixins-guards/mixins-guards.less`.
- The current reduced repro for that fixture is:
  - shared `.generic(...)` guarded overloads
  - `.variouse-types-comparison { ... }`
  - `.list-comparison { ... }`
  with the failure only appearing when the earlier guarded calls run first.
  The hard `ReferenceError: 'space-list' is not defined` has now been removed by
  normalizing invocation source-parent selection away from reference/call
  pseudo-owners and by anchoring call-site container arg values. The remaining
  issue in that same fixture is smaller but still real: repeated guarded calls
  are leaving output/closure regressions (missing spaces in emitted `content:`
  values and a dropped `.call-lock-mixin .call-inner-lock-mixin` block).
  Current narrowing: the emitted nested `.inner-locked-mixin(@x: @a)` definition
  survives, but its later sibling call still collapses to `Nil`. The live seam
  is closure ancestry for emitted nested mixin definitions: current lookup
  should come from placement edges, while `sourceParent` should remain the
  canonical definition owner.

## Current Jess Red Set

After the latest rebuild and runtime fixes, `packages/jess/test/less/all-less.test.ts`
is down to 12 reds.

Likely exact-output / fixture-drift cases:

- `tests-unit/css-3/css-3.less`
- `tests-unit/css-grid/css-grid.less`
- `tests-unit/extend-nest/extend-nest.less`
- `tests-unit/rulesets/rulesets.less`
- `tests-unit/whitespace/whitespace.less`

Still-real runtime / semantic cases:

- `tests-unit/extend-selector/extend-selector.less`
- `tests-unit/extend/extend.less`
- `tests-unit/mixins-guards/mixins-guards.less`
- `tests-unit/mixins-interpolated/mixins-interpolated.less`
- `tests-unit/starting-style/starting-style.less`
- `tests-unit/urls/urls.less`

Borderline / mixed:

- `tests-unit/import/import-reference.less`
  now mostly reflects selector-shape / ordering differences again rather than
  the earlier activation failure, so treat it carefully before spending more
  runtime effort there.

## What To Delete Over Time

- `_carriedState`
- `subtreeMap`
- old detached wrapper/materialize helpers
- any new code that assumes `EvalState` is the final architecture
