# Node Copy Reduction — Implementation Progress

## Document Role

This file is the source of truth for:

- stage/gate status
- major completed slices
- major blockers and merge-safety notes

This file is not the source of truth for the per-node queue or per-node status matrix.
Those live in [node-session-status.md](./node-session-status.md).

## Test Baselines

Recorded 2026-03-16 after merging dev into jess-dev and completing Stage 6.
Build fix: TypeScript errors from dev merge resolved (type narrowing casts in
selector-utils.ts, extend-core.ts, registry-utils.ts, reference.ts, rules.ts,
ruleset.ts, url.ts, node-base.ts, selector-match-core.ts).

### Core (`packages/core`) — post-Stage 6
- **Test Files**: 10 failed | 57 passed | 2 skipped (69 total)
- **Tests**: 34 failed | 885 passed | 17 skipped (936 total)
- Failing files: ampersand, at-rule, at-rule-basic, import-style (with values),
  mixin, nesting-collapse, process-leading-is, fast-reject,
  flags-static-optimization, extend-eval-integration
- These are pre-existing or from the dev merge (not regressions from this work)

### Fns (`packages/fns`)
- **Test Files**: 1 failed | 64 passed (65 total)
- **Tests**: 1 failed | 480 passed (481 total)
- Single failure: `iif.test.ts > iif (false) without elseValue` (pre-existing)

### Jess (`packages/jess`)
- **Test Files**: 28 failed | 7 passed | 1 skipped (36 total)
- **Tests**: 189 failed | 75 passed | 4 skipped (268 total)
- **Root cause**: `ERR_PACKAGE_PATH_NOT_EXPORTED` for `@jesscss/plugin-js` — Node.js
  v24 CJS resolution requires a `require` condition in exports map. Most failures
  cascade from this single issue, not from code regressions.

---

## Stage 0: Measure and Freeze Assumptions

- [ ] Add clone/copy call count instrumentation behind test/bench flag
- [ ] Record deep-clone count per benchmark run
- [ ] Record approximate nodes allocated by clone/copy
- [ ] Record import eval count per stylesheet
- [ ] Add repeated-import benchmark on large source trees
- [ ] Document high-cost clone sites
- [ ] Add target tests for: repeated imports with different `with`/`set` values
- [ ] Add target tests for: dynamic declaration/mixin names
- [ ] Add target tests for: scope lookup vs linear lookup

---

## Stage 1: Instance Fields and childKeys — Leaf Nodes

Goal: Move `.data` to instance fields for leaf/value nodes. Establish `childKeys`.

### Infrastructure (Node base class)
- [x] Make `childKeys` load-bearing in `clone()` — leaf fast path (`childKeys === null`)
- [x] Make `childKeys` load-bearing in `_adoptChildren()`
- [x] Make `childKeys` load-bearing in child iteration helpers
- [x] Add `.data` compatibility getter that synthesizes from instance fields

### Leaf Node Conversions
Each checkbox = one node class converted + tests green.

- [x] `Dimension` — `number: number`, `unit: string | undefined`
- [x] `Num` — extends Dimension (inherits childKeys)
- [x] `Bool` — `value: boolean`
- [x] `Any` — `value: string` (role stays in options)
- [x] `Keyword` — subclass of Any (inherits childKeys)
- [x] `Comment` — `value: string` (lineComment stays in options)
- [x] `BasicSelector` — `value: string`
- [x] `Combinator` — `value: Combinators`
- [x] `Ampersand` — `appendValue: string | undefined`
- [x] `Color` — `_rgbChannels`, `_hslChannels`, `_alphaValue`, `_nodeValue`
- [x] `Nil` — (sentinel, data always '')

### Stage 1 Exit Criteria
- [x] All leaf node types use instance fields
- [x] `childKeys = null` on all leaf types
- [x] `clone()` uses fast path for leaf nodes
- [x] All core tests pass (same baseline: 31 failed | 866 passed)
- [x] `.data` compatibility getter works for consumers still reading it

---

## Stage 2: Instance Fields — Container Nodes

Goal: Move all container/parent nodes to instance fields with `childKeys`.

### Container Node Conversions
Each checkbox = one node class converted + tests green.

**Simple containers (1-2 child fields):**
- [x] `Url` — `value: Quoted | Any`; childKeys=['value']
- [x] `Expression` — `value: Node`; childKeys=['value']
- [x] `Paren` — `value: Node | undefined`; childKeys=['value']
- [x] `Negative` — `value: Node`; childKeys=['value']
- [x] `Quoted` — `value: string | Any | Interpolated`; childKeys=['value']

**Multi-child containers:**
- [x] `Operation` — `left`, `operator`, `right`; childKeys=['left','right']
- [x] `Condition` — `left`, `operator`, `right`; childKeys=['left','right']
- [x] `Declaration` — `name`, `value`, `important`; childKeys=['name','value','important']
- [x] `Call` — `name`, `args`, `contentNode`; childKeys=['name','args','contentNode']
- [x] `Reference` — `target`, `key`; childKeys=['target','key']

**Complex containers:**
- [x] `Ruleset` — `selector`, `rules`, `guard`, `selectorBeforeExtend`; childKeys=['selector','rules','guard','selectorBeforeExtend']
- [x] `AtRule` — `name`, `prelude`, `rules`; childKeys=['name','prelude','rules']
- [x] `Mixin` — `name`, `rules`, `params`, `guard`; childKeys=['name','rules','params','guard']
- [x] `StyleImport` — `path`, `withNode`; childKeys=['path','withNode']
- [x] `Rules` — `value: Node[]`; childKeys=['value']

**Selector containers:**
- [x] `SelectorList` — `value: Selector[]`; childKeys=['value']
- [x] `ComplexSelector` — `value: ComplexSelectorComponent[]`; childKeys=['value']
- [x] `CompoundSelector` — `value: SimpleSelector[]`; childKeys=['value']
- [x] `PseudoSelector` — `name`, `arg`; childKeys=['name','arg']
- [x] `SelectorAttr` — `name`, `value`; childKeys=['name','value']
- [x] `SelectorInterpolated` — `value`; childKeys=['value']

**Other nodes:**
- [x] `List` — `value: T[]`; childKeys=['value']
- [x] `Collection` — inherits Rules childKeys=['value']
- [x] `Interpolated` — `source`, `replacements`; childKeys=['source','replacements']
- [x] `Rest` — `value`; childKeys=['value']
- [x] `Range` — `start`, `end`, `step`; childKeys=['start','end','step']
- [x] `Sequence` — `value: Node[]`; childKeys=['value']
- [x] `Block` — `value`; childKeys=['value']
- [x] `Extend` — `selector`, `target`; childKeys=['selector','target']
- [x] `ExtendList` — `value: Extend[]`; childKeys=['value']
- [x] `Control` (If, For, Each, While) — converted with per-type childKeys
- [x] `Log` — `level`, `message`; childKeys=['level','message']
- [x] `DefaultGuard` — leaf; childKeys=null
- [x] `JsExpr` — leaf; childKeys=null
- [x] `JsArray` — leaf; childKeys=null
- [x] `JsObject` — leaf; childKeys=null
- [x] `JsFunction` — leaf; childKeys=null
- [x] `JsImport` — `path`; childKeys=['path']
- [x] `Func` — `name`, `params`, `body`; childKeys=['name','params','body']
- [x] `SelectorCapture` — `value`; childKeys=['value']
- [x] `VarDeclaration` — inherits Declaration childKeys
- [x] `DeclarationCustom` — N/A (class does not exist in codebase)
- [x] `RulesRaw` — N/A (class does not exist in codebase)
- [x] `Tree` — N/A (class does not exist in codebase)

### Stage 2 Exit Criteria
- [x] All node types use instance fields
- [x] `childKeys` populated on every class
- [x] `getEntriesFromNode()` replaced by `childKeys` iteration
- [x] `clone()` uses `childKeys` for all types
- [x] All tests pass (same baseline or better)

---

## Stage 3: Less-Aligned Field Renames

- [x] Any: `.data` → `value` (done in Stage 1)
- [x] Bool: `.data` → `value` (done in Stage 1)
- [x] Comment: `.data` → `value` (Stage 1), options.lineComment → `lineComment`
- [x] Quoted: `.data` → `value` (Stage 2), options.quote → `quote`, options.escaped → `escaped`
- [x] Condition: options.negate → `negate`
- [x] Any: options.role → `role`
- [x] Operation: keep `operator` (consistent with Condition.operator)

---

## Stage 4: RenderMask and `render()` Function

- [x] Define `RenderMask` interface (`suppressComments` on PrintOptions)
- [x] Implement `render(node, options?)` standalone function
- [x] Update base-class `toTrimmedString()` fallback to iterate `childKeys`
- [x] Keep `.toString()` as convenience (render delegates to toString)
- [x] Comment suppression via `suppressComments` option in `toString()`
- [x] Convert Ruleset/AtRule `getHeaderString` to use `suppressComments` (no `copy(true)`)
- [x] Audit: all remaining `copy(true)` calls are structural (selector assembly,
  AST mutation, snapshotting) — no comment-suppression-only copies remain

---

## Stage 5: Declarative Adapter Layer

- [x] Define `NodeAdapter<T>` interface in `packages/jess-plugin-less-compat/src/transform/adapter.ts`
  - `lessType`, `fields`, `dynamicField`, `accept` properties
  - Accept helpers: `selfVisitAccept()`, `childrenAccept()`, `singleChildAccept()`
- [x] Implement `createFromAdapter<T>()` factory that generates a `NodeTransformer` from an adapter
  - Auto-maps `type` and `typeIndex` properties
  - Wraps accept functions with proper visitor binding
- [x] Convert all 26 transformer files to declarative adapter definitions
  - Leaf nodes (combinator, dimension, color): field mappings only
  - Self-visit nodes (keyword, comment, quoted, paren, negative, url, operation, expression, condition, extend, import, mixin, attribute-selector): `selfVisitAccept()`
  - Children-accept nodes (declaration, var-declaration, at-rule, call): custom accept or `childrenAccept()`/`singleChildAccept()`
  - Complex nodes (ruleset, list, selector, sequence): custom accept functions
  - Selector: preserves `flattenSelectorToElements()` and `createElementProxy()` with cache-write-through for Element proxy dispatch
- [x] Verify less-compat test suite passes (54/54)

---

## Stage 6: Remove `.data` Compatibility Layer

- [x] Grep for all `.data` usage across codebase
- [x] Convert all `.data` reads in ~24 test files to instance field access
- [x] Convert `.data` reads in tree utility files (process-leading-is.ts, serialize-types.ts)
- [x] Remove `Object.defineProperty(..., 'data', ...)` compat getters from all 48 node classes
- [x] Remove `declare readonly data:` type declarations from all node classes
- [x] Add `clone()` overrides for nodes with non-childKey constructor fields:
  - Condition (tuple constructor: `[left, op, right]`)
  - Operation (tuple constructor: `[left, op, right]`)
  - AttributeSelector (drops `op`, `mod` without override)
  - Extend (drops `namespace`, `flag` without override)
  - StyleImport (drops `withType` without override)
- [x] Fix `setData()` for multi-key containers (iterate childKeys, not assign `.data`)
- [x] Convert merge-conflict files from dev branch (9 files: `.data` → instance fields)
- [x] Fix TypeScript build errors from dev merge (`{ data: ... }` type annotations → `{ value: ... }`)
- [x] Remove `getEntries()` from core selector eval paths (selector-list, selector-complex, selector-compound)
  - Replaced with direct indexed iteration over `value` arrays
  - `getEntries()` and `getValues()` kept in collections.ts — `getValues()` still used by language-service
- [~] `setData()` — kept as mutation API (does adoption + valueOf invalidation)
  - Removing requires adopting setters (private fields + get/set) on all container nodes
  - Deferred to future stage; not blocking for Stage 6 completion

---

## Stage 7: Introduce EvalSession as Optional Layer

Goal: Define the EvalSession data structure and session-aware helpers as a container-only
layer. No production eval paths are modified — this stage is purely additive.

- [x] Define `EvalSession` class (`packages/core/src/eval-session.ts`)
  - `NodePatch` (per-node field overrides via `WeakMap<Node, Record<string, unknown>>`)
  - `RuntimeState` (parent, index, evaluated, preEvaluated, sourceNode via `WeakMap`)
  - `ScopeSnapshot` (variables/mixins maps for re-evaluation)
  - Materialization tracking (`WeakSet<Node>`)
  - Patch/read API: `patchField`, `getField`, `hasField`, `hasPatches`
  - Runtime API: `getRuntime`, `hasRuntime`
  - Scope API: `setScope`, `getScope`
- [x] Define session-aware helpers (`packages/core/src/tree/util/session-helpers.ts`)
  - `sessionGetField` / `sessionPatchField` — fall through to direct field access when no session
  - `sessionGetParent` / `sessionSetParent` — session runtime overlay for parent
  - `sessionIsEvaluated` / `sessionSetEvaluated` — session runtime overlay for evaluated flag
- [x] Add `session` field to `Context` with `createSession()` factory
- [x] Export from core index (`eval-session.js`, `session-helpers.js`)
- [x] Unit tests (27 passing): isolation, patch/read, no-session parity, scope snapshots, materialization
- [x] Integration test skeletons (7 skipped): import-type with ambient vars, with/set injection,
  ambient+with interaction, compose re-imports, no-session compatibility

### Cloning scenarios EvalSession will replace (Stages 8-13)
1. `import`-type fresh eval — each import pulls in ambient variables, needs isolated session
2. `with`/`set` injection — override specific variables in the import's scope
3. Compose re-imports — re-eval cached tree with different context
4. `multiple`/`_dedupe` — separate output from same source

---

## Stage 8: Session-Aware Read and Write Helpers

Goal: Complete the helper inventory and wire `evaluated`/`preEvaluated` lifecycle
tracking into the base eval path in `node-base.ts`.

- [x] Add `sourceParent` field to `RuntimeState` in `eval-session.ts`
- [x] Add missing read helpers to `session-helpers.ts`:
  - `sessionIsPreEvaluated` / `sessionSetPreEvaluated`
  - `sessionGetIndex` / `sessionSetIndex`
  - `sessionGetSourceParent` / `sessionSetSourceParent`
  - `sessionGetChildren` (returns `rules.value`; session-local children in Stage 9)
- [x] Add write helpers to `session-helpers.ts`:
  - `sessionSetRuntimeState` — bulk-set multiple runtime fields
  - `sessionAppendChildren` / `sessionPrependChildren` / `sessionRemoveChild` (direct
    mutation for now; session overlay in Stage 9)
  - `sessionReplaceNode` — replaces a node in its parent (session overlay in Stage 9)
  - `sessionMarkScopeDirty` — no-op stub (session-local registry in Stage 9)
- [x] Wire `evaluated`/`preEvaluated` into `Node.preEval`, `Node.evalStatic`,
  `Node._evalStaticSync` via private helpers `_isPreEvaluated`, `_setPreEvaluated`,
  `_isEvaluated`, `_setEvaluated` on the `Node` class
  - Private helpers defined on `Node` directly (not imported from session-helpers.ts)
    to avoid the circular import: session-helpers.ts already imports Node from node-base.ts
  - Session is absent in all current code paths → behavior unchanged today
  - When a session is active (Stage 9+): `evaluated`/`preEvaluated` go into the session
    overlay, not onto the canonical node — enabling shared-node re-evaluation
- [x] Unit tests: 16 new tests covering preEvaluated, index, sourceParent,
  setRuntimeState helpers (no-session parity + session isolation)

### Note on children helpers
`sessionGetChildren`, `sessionAppendChildren`, `sessionPrependChildren`,
`sessionRemoveChild`, `sessionReplaceNode`, and `sessionMarkScopeDirty` are introduced
in Stage 8 but are **not yet session-aware** — they call through to direct mutation
(`rules.push()`, `rules.splice()`, etc.). Session-local children arrays are introduced
in Stage 9, at which point these helpers will route through the session overlay.

---

## Stage 9: Session-Based `with`/`set` Variable Injection

Goal: Replace `rules.clone(true)` (O(N) deep clone) in `StyleImport.evalNode()` when
processing `with`/`set` variable injection with a linear scan + session-based approach.

- [x] Remove `rules.clone(true)` from the `withValues` branch in `import-style.ts`
- [x] Build `topLevelVarIndex` (name → position map) via linear scan of imported rules
- [x] Build `replacementAt` (position → injected node) for vars that are overridden
- [x] Build `newVariables` list for injected vars with no counterpart in the library
- [x] Construct `finalRules = Rules.create([])` with injected-first ordering:
  - New variables (no library counterpart) first
  - Then canonical nodes with replacements applied
- [x] Wrap the `preEval` + `eval` call in a session (`context.createSession()`)
  - Session is created only when `withValues` is set
  - `context.session` is restored in a `finally` block
- [x] Fix `import-style.test.ts` `with values` block: use correct `withNode`/`withType`
  fields on `StyleImportValue` (not `with: { node, type }`)
- [x] Remove active debug logging from `node-base.ts` `adopt()` and `registry-utils.ts`
  `DeclarationRegistry.find()`

### Test results — post Stage 9
- **Core**: 9 failed | 59 passed | 3 skipped (71 total); 27 failed | 932 passed | 24 skipped
  - Down from 10 failed files / 34 failed tests at Stage 6 baseline
  - `import-style` with-values tests all pass (previously 7 failing)
  - All remaining failures are pre-existing (same set as Stage 6/7/8 baseline)
- **Less-compat**: 9 passed | 54/54 tests pass (no regression)

---

## Stage 10: Externalize Runtime State — Parent Write Protection for Canonical Nodes

Goal: Prevent `with`/`set` variable injection from permanently mutating the `parent`
field on canonical library nodes. Routes parent writes through the session overlay for
nodes passed directly into `finalRules`.

- [x] Make `Node.adopt()` session-aware: when `ctx?.session` is active, write
  `parent` into `session.getRuntime(node).parent` instead of directly onto the node
- [x] Add optional `ctx?: Context` param to `Node.adopt()` (no-op without session)
- [x] Promote session helpers `_isPreEvaluated`, `_setPreEvaluated`, `_isEvaluated`,
  `_setEvaluated` from `private` to `protected` (needed by `Rules.preEval`)
- [x] Wire `Rules.preEval()` to use `_isPreEvaluated` / `_setPreEvaluated` guards
- [x] Add context-threaded `Rules.push(ctx, ...nodes)` overload so `adopt()` inside
  the push loop can route parent writes through the session
- [x] Move `context.createSession()` to BEFORE `finalRules` construction in
  `import-style.ts` `withValues` block
- [x] Pass `context` to all `finalRules.push(context, node)` calls
- [x] Fix `prevSession` capture ordering: capture BEFORE `createSession()` call so
  an outer session (nested imports) is properly restored in the finally block
- [x] Save/restore canonical node parent pointers around the eval:
  - `Rules.constructor` calls `adopt()` unconditionally for initial children, bypassing
    session routing during the `clone()` triggered by `preEval` + `preserveOriginalNodes`
  - Before eval: save `node.parent` for all non-replaced canonical nodes in `rules.value`
  - In finally: restore saved parents so canonical nodes point back to their original container
- [x] Parity test: `'two sequential "with" imports do not corrupt canonical node parent pointers'`
  - Uses a 2-var library (baseColor replaced, anotherColor canonical + included in finalRules)
  - Asserts `anotherColorVar.parent === sourceRules` before and after each with-import

### Test results — post Stage 10
- **Core**: 9 failed | 59 passed | 3 skipped (71 total); 27 failed | 934 passed | 24 skipped
  - Same baseline as Stage 9 (no regression)
  - New parity test `'two sequential "with" imports do not corrupt canonical node parent pointers'` passes
- **Less-compat**: 9 passed | 54/54 tests pass (no regression)
- **TypeScript build**: 3 pre-existing errors in `session-helpers.ts` (unchanged from Stage 9)

---

## Stage 11: Thread `ctx` Through `clone()` to Replace Save/Restore Hack

Goal: Remove the `canonicalNodeParents` save/restore workaround from `import-style.ts`
(added in Stage 10) by properly threading `ctx?: Context` through `Node.clone()` and
`Node.maybeClone()`. This allows `clone()` itself to save/restore child parent pointers
around the constructor call, instead of doing it at the import-style call site.

Also fix `Node.push()` to be session-aware (accept optional `Context` as first arg) so
that `finalRules.push(context, node)` routes parent adoption through the session overlay
rather than mutating `node.parent` directly.

- [x] Thread `ctx?: Context` into `Node.clone(deep?, cloneFn?, ctx?)` (3rd param)
- [x] Thread `ctx` into `Node.maybeClone(context, deep?, cloneFn?)` → `this.clone(deep, cloneFn, ctx)`
- [x] Add session-aware save/restore of child parent pointers inside `Node.clone()`:
  - Before `new Class(cloneData, ...)`: collect `[child, child.parent]` pairs for all child
    nodes when `!deep && ctx?.session`
  - After construction: `session.getRuntime(child).parent = newNode`; `child.parent = priorParent`
- [x] Update `Rules.clone()` override to accept and forward `ctx` to `super.clone()`
- [x] Make `Node.push()` context-aware: add `push(ctx: Context, ...items)` overload that
  routes `adopt(item, ctx)` through the session overlay, preventing direct `node.parent`
  mutation when pushing canonical nodes into `finalRules`
- [x] Remove `canonicalNodeParents` save/restore hack from `import-style.ts` `finally` block
  (no longer needed — `push` + `clone` both route through session overlay now)
- [x] Fix `push` regression: `push(context, node)` was pushing `context` as a non-Node item
  into the value array; new overload detects Context first-arg and excludes it from the array

### Root causes resolved
1. **`finalRules.push(context, node)` was silently broken**: context object was pushed into
   `finalRules.value`, AND adoption was done without ctx (direct mutation). Now `push` with
   a Context first arg routes adoption through session and excludes context from the array.
2. **`Rules.clone()` override dropped `ctx`**: `Rules.clone(deep?, cloneFn?)` only accepted
   2 args — the 3rd `ctx` arg passed from `maybeClone` was silently discarded. Fixed by
   updating the override signature to `clone(deep?, cloneFn?, ctx?)`.

### Test results — post Stage 11
- **Core**: 9 failed | 59 passed | 3 skipped (71 total); 27 failed | 934 passed | 24 skipped
  - Same baseline as Stage 10 (no regression)
  - Parity test `'two sequential "with" imports do not corrupt canonical node parent pointers'` continues to pass
- **Less-compat**: 9 passed | 54/54 tests pass (no regression)

---

## Stage 12: Remove `preserveOriginalNodes`

Goal: Delete the `preserveOriginalNodes` flag from `Context` entirely. With sessions
active for all import eval paths, `maybeClone` can gate on `!!context.session` instead.

### Changes
- [x] `rules.ts`: Replace 4 direct `n.index = i` mutations with `sessionSetIndex(n, i, context)` —
  protects canonical node `index` fields when a session is active
- [x] `import-style.ts`: For `!withValues` branches of the fresh-eval block (`!evaldRules`,
  `type === 'import'`), create a new `EvalSession` before eval and restore in `finally` —
  same isolation guarantee `preserveOriginalNodes` provided, but via session
- [x] `import-style.ts`: Remove `preserveOriginalNodes` save/set/restore from compose-cached
  path (lines 567-572) — already does `clone(true)` (deep clone), so canonical nodes are
  never mutated there regardless
- [x] `node-base.ts`: `maybeClone` now gates on `!!context.session` (was `context.preserveOriginalNodes`)
- [x] `node-base.ts`: `clonedEval` now creates a temporary `EvalSession` instead of setting
  `preserveOriginalNodes = true` — mixin arg eval (rules.ts line 1862) is now session-isolated
- [x] `context.ts`: Remove `preserveOriginalNodes: boolean | undefined` field

### Design notes
- `withValues` path: session was already created at `context.createSession()` (Stage 10/11);
  the `finally` now always restores `context.session = prevSession` (not just `if (withValues)`)
- Non-`withValues` paths: `prevSession = context.session; context.session = new EvalSession()`
  before eval; restored in `finally` — identical save/restore contract
- `clonedEval` wraps `eval()` with a temporary session only when no session is already active
  (avoids creating a nested session when one already exists)

### Test results — post Stage 12
- **Core**: 9 failed | 59 passed | 3 skipped (71 total); 27 failed | 934 passed | 24 skipped
  - Same baseline as Stage 11 (no regression)
- **Less-compat**: 9 passed | 54/54 tests pass (no regression)

---

## Stage 13: Expand Beyond Imports, Clean Up

### Stage 13a: Session-Isolate Mixin Guard Evaluation

Goal: Eliminate `guard.copy(true)` calls in the mixin resolution loop in `rules.ts`.

- [x] Replace 3 `guard.copy(true) + adopt(guard) + guard.eval()` patterns with a session-based
  evaluation block that evaluates the canonical guard node directly
- [x] `prevGuardSession` save/restore pattern ensures session is always restored in `finally`
- [x] Each `evalWithDefault` probe gets its own inner session for fresh evaluated/preEvaluated state
- [x] Canonical guard nodes always have `evaluated = false` because they were only ever evaluated
  as copies — session isolation is safe with no `resetEvalStateDeep` needed

### Stage 13b: Fix `PseudoSelector.valueOf()` and `CompoundSelector.valueOf()` bugs

Pre-existing test failures (3 in process-leading-is, 1 snapshot in extend-eval-integration)
were caused by incorrect normalization added to these two `valueOf()` methods.

- [x] `PseudoSelector.valueOf()`: Remove the `:is(BasicSelector|CompoundSelector)` normalization
  that stripped the `:is(...)` wrapper from the value string. Non-generated `:is(.x)` should
  preserve `:is(.x)` in `valueOf()`; inner generated `:is(.inner)` returned from
  `processLeadingIs` should also preserve its form.
- [x] `CompoundSelector.valueOf()`: Constrain the `:is()` component flattening to only apply when
  the arg is a CompoundSelector (recurse into its components). Non-CompoundSelector args (e.g.
  SelectorList) now fall through to `component.valueOf()` directly.
- [x] Update stale `extend-eval-integration` snapshot (outdated from dev merge)

### Stage 13c: Fix `findNodeByType` test helper infinite recursion

- [x] `packages/core/test/flags-static-optimization.test.ts`: Replace `Object.values(node.value)`
  traversal with `childKeys`-based traversal. Stage 1-3 changed `declaration.value` from a plain
  object to a Node child, causing infinite recursion when the old helper called
  `Object.values(node.value)` on a Declaration node.

### Test results — post Stage 13

- **Core**: 6 failed | 62 passed | 3 skipped (71 total); 19 failed | 942 passed | 24 skipped
  - Down from 9 failed files / 27 failed tests at Stage 12 baseline
  - Remaining 6 failed files are all pre-existing from dev merge:
    - `ampersand` — selector ordering during collapsing (7 tests)
    - `at-rule` / `at-rule-basic` — parent selector prepended incorrectly inside @media (6 tests)
    - `mixin` — mixin scope / parent context issues (2 tests)
    - `fast-reject` — `:is(SelectorList)` full-match in selectorMatch (2 tests)
- **Less-compat**: 9 passed | 54/54 tests pass (no regression)

### Test results — post `617056ee` (Ampersand.clone() fix)

- **Core**: 5 failed | 63 passed | 3 skipped (71 total); 14 failed | 951 passed | 24 skipped
  - Ampersand.clone() regression fixed: `appendValue` and `_selectorContainer` now preserved
    across shallow clone; 5 ampersand tests and others restored to passing

### What's blocked for further Stage 13 work

The remaining large clone sites cannot be safely replaced with `clone(false)` without sessions.

**Root cause: `clone(false)` without a session mutates canonical children's parents.**
`node-base.ts clone()` (lines 986-1028) has a session-aware save/restore mechanism for
canonical parent pointers, but it only activates when `ctx?.session` is truthy. Without a
session, the constructor's `adopt()` calls permanently overwrite canonical children's `.parent`
fields. Concretely: `outerRules.push(...rules.value)` (Site 3) followed by
`outerRules.clone(false)` causes double-adopt of canonical declarations, corrupting the scope
lookup chain across multiple mixin calls. `resetEvalStateDeep` was masking this by resetting
state, but the underlying issue is the parent mutation.

**Consequence:** `clone(false)` is only safe at these sites once `EvalSession` is active during
mixin evaluation — at which point `clone(false, undefined, ctx)` routes parent writes through
the session overlay and restores canonical pointers.

1. **Mixin body eval** (`rules.ts:2313, 2336, 2348`) — Blocked on:
   - `resetEvalStateDeep` resets Ruleset `selector` field (pre-composition recovery) and
     Ampersand `_selectorContainer`/`_storedSelector` caches. These are structural mutations
     during re-evaluation in a new context that require session-local field storage.
   - Generic `sessionPatchField`/`sessionGetField` exists, but `Ruleset.preEval` and
     `Ampersand.eval` would need to read from session instead of canonical fields.
   - Replacing `clone(true)` with `clone(false)` here requires sessions to be active so
     canonical parent pointers are protected via the session overlay.

2. **`$for` loop** (`control.ts:244`) — Blocked on:
   - `loopRules.unshift(varDecl)` injects a per-iteration loop variable into the cloned array.
   - Session-local children arrays (`sessionGetChildren` returning a per-session copy of
     `rules.value`) would be needed to support `unshift` without mutating canonical array.
   - `Rules.preEval`/`evalStatic` would need to use `sessionGetChildren` instead of `this.value`.

3. **Compose cached re-eval** (`import-style.ts:566`) — Blocked on session-local registries.
   The comment says "clone BEFORE evaluation so registries are populated on the clone" — without
   session-local registry state, canonical `evaldTrees` entry would get registration side effects.

---

## Stage 14: Eliminate resetEvalStateDeep

Goal: Remove the O(N) `resetEvalStateDeep` traversal that resets eval state on mixin body
deep clones, by fixing the root causes that made it necessary.

### Root cause analysis

`resetEvalStateDeep` did four things on every deep-cloned mixin body:
1. `node.preEvaluated = false` — **already a no-op** (`_metaFlags = 0` on new clone instances)
2. `node.evaluated = false` — **already a no-op** (same reason)
3. Reset Ruleset selectors from `ownSelector` / `sourceNode` — **needed**: canonical
   `Ruleset.preEval` mutates `data.selector` to the composed form during root eval;
   `clone(true)` copies this stale composed selector, causing double-composition on re-eval.
4. Clear Ampersand `_selectorContainer` / `_storedSelector` — **needed**: `Ampersand.clone`
   copied the definition-site container; `evalNode` skipped rebinding when container was set.

### Fixes

- [x] `Ruleset.preEval`: use existing `ownSelector` (pre-composition) as starting selector
  when re-evaluating, instead of `this.selector` (which may already be composed)
- [x] `Ampersand.clone`: don't copy `_selectorContainer` — clones must rebind to the
  current eval context frame (call-site, not definition-site)
- [x] Remove `resetEvalStateDeep` function and its 3 call sites from `rules.ts`

### Test results — post Stage 14

- **Core**: 5 failed | 63 passed | 3 skipped (71 total); 13 failed | 952 passed | 24 skipped
  - Same-or-better than 617056ee baseline (was 14 failed | 951 passed)
  - Mixin-recursion test confirmed passing

### What's unblocked

Blocker 1 from Stage 13 ("resetEvalStateDeep resets Ruleset selector / Ampersand container")
is resolved.

### Stage 14b: Session infrastructure + clone(false) at Site 1

Built the infrastructure required for `clone(false)`:
- [x] `EvalSession.getRuntime` initializes `{ preEvaluated: false, evaluated: false }`
  so canonical eval flags don't leak into sessions
- [x] All `preEval` overrides migrated to `_isPreEvaluated`/`_setPreEvaluated`:
  control.ts, any.ts, mixin.ts, collection.ts, at-rule.ts, declaration.ts, ruleset.ts, rules.ts
- [x] `Rules._multiPassPreEval` adopts preEvald results after `setData` so clones
  from `maybeClone` get proper parent pointers for scope lookups
- [x] Session created before mixin eval loop in `getFunctionFromMixins`
- [x] **Site 1** (Ruleset candidate, rules.ts:2267): `clone(true)` → `clone(false, undefined, ctx)`

### Stage 14c: clone(false) at Site 3 (named mixin with params)

- [x] **Site 3** (named mixin with params/guard, rules.ts:2300):
  `clone(true)` → `clone(false, undefined, ctx)`
- [x] Fix `outerRules.push(...rules.value)`: shallow-clone each child before pushing
  so canonical parents aren't corrupted. Clones get `parent = outerRules` from push's adopt.

### Test results — post Stage 14c

- **Core**: 5 failed | 63 passed | 3 skipped (71 total); 13 failed | 952 passed | 24 skipped
  - Same baseline — no regressions from clone(false) at Sites 1 and 3

### Stage 14d: clone(false) for $for loop body (control.ts:243)

- [x] Session created before loop, shallow clone per iteration
- [x] `unshift` of per-iteration bindings operates on array copy, not canonical
- [x] Each iteration sees fresh canonical preEval state (only clones get preEvaluated=true)

### Stage 14e: clone(false) for compose cached re-eval (import-style.ts:566)

- [x] Session created if none exists, shallow clone + eval
- [x] Registries populated on clone's preEvald children, not canonical cache

### Remaining clone(true) sites (low priority)

- `rules.ts:2293` — detached ruleset unlock, no eval follows, needs independent copy
- `import-style.ts:251` — `_dedupe`/`multiple`, markReferenceMode mutates node flags
- `control.ts:52` — small vars clone for block expression (cheap)
- `ampersand.ts:228` / `ruleset.ts:544` — selector clones during eval (small, targeted)

### Test results — post Stage 14e

- **Core**: 5 failed | 63 passed | 3 skipped (71 total); 13 failed | 952 passed | 24 skipped
  - Same baseline throughout all Stage 14 substages — zero regressions

---

## Stage 15: copy(true) elimination + processLeadingIs removal

### copy(true) → clone(false) in selector rendering

- [x] 39 `copy(true)` → `clone(false)` in `process-leading-is.ts`
- [x] 5 `copy(true)` → `clone(false)` in define-function, control, declaration, interpolated
- Remaining ~65 in extend-core, selector-utils, extend.ts, ruleset.ts need structural
  copies for mutation safety (extend mutates selectors, Ampersand appends mutate BasicSelector)

### processLeadingIs removed from Ruleset render path

`processLeadingIs` ran on EVERY selector during serialization, doing expensive copy(true)
to unwrap generated `:is()` wrappers. Now dead code in production.

**Upstream fixes that made removal possible:**

- [x] **Ampersand eval**: skip `:is()` wrapping for collapseNesting SelectorList —
  resolve parent but don't wrap. Composition handles `:is()` where structurally needed.
- [x] **Ampersand eval**: skip `:is()` wrapping for empty appendValue (`!!appendValue`)
- [x] **extend-core `wrapSelectorInIs`**: flatten nested `:is()` using existing
  `expandGeneratedIsAlternatives` — prevents `:is(:is(.a, .b), .c)` nesting
- [x] **selector-utils `resolveAuthoredAmpersands`**: fuse complex parent's last part
  with compound suffix at top level (`&[e]` + parent `* b` → `* b[e]`)
- [x] **`wrapInGeneratedIs`** utility added to selector-utils.ts (flattens, deduplicates,
  skips single-item wraps)

### Selector bug fixes (pre-existing, fixed this session)

- [x] **Compound ordering**: type selectors sort before class/id after `&` merge
  (`h2.one.two` not `.one.twoh2`) — sort in `resolveAuthoredAmpersands`
- [x] **Append distribution**: unwrap generated `:is(SelectorList)` in `applyAppendValue`
  so `-1` appends to ALL items (`.one-1, .two-1` not `.one, .two-1`)

### Test results — post Stage 15

- **Core**: 5 failed | 63 passed | 3 skipped (71 total); 11 failed | 954 passed | 24 skipped
  - Down from 13 failed — 2 pre-existing selector bugs fixed

### Merged to dev

All work through `ce113f49` merged to `origin/dev` at `4d8ac5dd`.

---

## Stage 16: Explore Collapsing preEval / eval (Future)

- [ ] Instrument preEval pass timing
- [ ] Prototype registration-during-walk for simple case
- [ ] Decision: merge or keep separate

---

## Stage 17: Immutable Selectors

Goal: Stop `setData('selector', ...)` mutations in extend paths. All extend output goes
through `_extendedSelector` only. Makes selector nodes safe to share across clones, which
unblocks eliminating ~50 remaining `copy(true)` calls in extend-core and selector-utils.

See [dependency-graph.md](./dependency-graph.md#stage-17-immutable-selectors) for full checklist.

- [ ] `extend-roots.ts` `applyInstructionToRuleset`: stop `setData('selector', ...)` — write `_extendedSelector` only
- [x] `extend-roots.ts` `applyInstructionToRuleset`: stop `setData('selector', ...)` — write `_extendedSelector` only
- [x] `extend-roots.ts`: remove `selectorBeforeExtend` save/restore (`copy(true)` at line ~515)
- [x] Verify all callers use `getEffectiveSelector()` / `_extendedSelector ?? selector` not raw `.selector`
- [ ] Structural sharing builder helpers (`selector-builders.ts`): `appendSelectorAlternative`, `rewriteCompound`, `rewriteSelectorPath`
- [ ] `extend-core.ts`: replace mutation-safety `copy(true)` calls with path-copy builders
- [ ] `selector-utils.ts`: same — replace mutation-safety `copy(true)` calls
- [ ] `ruleset.ts:544`: `selector.clone(true)` for sourceNode — reference canonical instead
- [ ] `ampersand.ts:228`: evaluate necessity of `selector.clone(true)`
- [x] Tests green: target 5 failed / 63 passed baseline maintained or better
- [ ] `copy(true)` count in extend paths: target ≤ 5 remaining

---

## Stage 18: Dependency Graph Infrastructure

Goal: Track which top-level `VarDeclaration`s flow into each output node during eval.
Enables incremental re-eval (Stage 20) and Live Patch API (Stage 21). Built once, used
by both consumers.

See [dependency-graph.md](./dependency-graph.md#stage-18-dependency-graph-infrastructure) for full checklist.

- [x] Add `EvalDependency` interface to `eval-session.ts` (`dependsOn: Set<VarDeclaration>`, `sourceExpr: Node`)
- [x] Add `dependencyMap: WeakMap<Node, EvalDependency>` to `EvalSession`
- [x] Session helpers: `sessionGetDependency`, `sessionSetDependency`, `sessionIsStatic`, `sessionMergeDependencies`
- [x] `Reference.evalNode()`: seed `dependsOn` when target is root-scope `VarDeclaration`
- [x] `Operation.evalNode()`, `Call.evalNode()`, `Expression.evalNode()`: propagate (union) child dependencies
- [x] `Declaration.evalNode()`: propagate from value node
- [x] Helper: `isTopLevelVarDeclaration(node, ctx)` — checks declaring `Rules` is root scope
- [x] Unit tests: static literal → null; direct var → {varDecl}; mixin boundary absorption; no-session parity

### Stage 18 Notes

- Added focused dependency propagation tests in `eval-session.test.ts` and new `tree/__tests__/dependency-graph.test.ts`.
- `Reference.evalNode()` seeds dependencies for root-scope vars and preserves them across frozen copies used by lookup and param binding.
- `Rules.getFunctionFromMixins()` now carries dependency metadata onto bound param/rest values so mixin pass-through keeps top-level var provenance.
- Verification:
  - `cd packages/core && pnpm test src/__tests__/eval-session.test.ts src/tree/__tests__/dependency-graph.test.ts src/tree/__tests__/call.test.ts src/tree/__tests__/declaration.test.ts src/tree/__tests__/rules.test.ts src/__tests__/eval-session-integration.test.ts`
  - `cd packages/core && pnpm test extend`
- Wider characterization:
  - `src/tree/__tests__/mixin.test.ts > keeps param vars preferred over outer same-name vars in lazy nested mixin lookups` still fails, but it reproduces on pushed Stage 17 commit `0a62dd97`, so it is pre-existing and not a Stage 18 regression.

---

## Stage 19: WeakMap-Keyed Shared Registries

Goal: Detach registry indices from `Rules` instance identity. Key off `rules.value` (array
reference) into a module-level `WeakMap`. COW shallow clones share the index automatically.
Array mutation creates a new index slot automatically.

See [dependency-graph.md](./dependency-graph.md#stage-19-weakmap-keyed-shared-registries) for full checklist.

- [x] Add module-level `globalRegistryCache: WeakMap<Node[], RegistryData>` to `registry-utils.ts`
- [x] Refactor `Rules.getRegistry(type)` to key off `this.value`; incremental indexing against `indexedLength`
- [x] Refactor `Rules.register(type, node)` to write into `globalRegistryCache` entry
- [x] Remove from `Rules`: `rulesetRegistry`, `mixinRegistry`, `declarationRegistry`, `rulesIndexed`, `_indexing`, `_indexRules()`
- [x] Keep `functionRegistry` as instance field (plugin-injected, not content-derived)
- [x] Update `Rules.clone()`: remove registry/rulesIndexed reset lines
- [x] Update `Registry` base class / `_searchRulesChildren` to key off `rules.value` for lookups
- [x] Tests: shallow clone shares index (no re-indexing); value mutation creates new index slot

### Stage 19 Notes

- Canonical ruleset, mixin, and declaration registries now live in a module-level `WeakMap<Node[], RegistryData>` keyed by `Rules.value`, so shallow `Rules` clones share the same index automatically.
- `Rules.clone(false)` now preserves the `value` array reference, while mutating operations (`push()`, `splice()`, `unshift()`, `setData([...])`) create a fresh array slot before registration so canonical and session-local lookups stay isolated.
- `FunctionRegistry` remains instance-owned; plugin-injected functions are still cloned with `cloneForRules()` instead of being derived from `value[]` content.
- Added focused coverage in `src/tree/__tests__/rules.test.ts` for shared-cache shallow clones and cache invalidation when a clone moves to a new `value` array.
- Verification:
  - `cd packages/core && pnpm test src/tree/__tests__/rules.test.ts src/tree/__tests__/extend-import-style.test.ts src/__tests__/eval-session.test.ts src/tree/__tests__/dependency-graph.test.ts`
  - `cd packages/core && pnpm test extend`
- Wider characterization:
  - `src/tree/__tests__/mixin.test.ts > keeps param vars preferred over outer same-name vars in lazy nested mixin lookups` still fails, but it also fails on pushed Stage 17 commit `0a62dd97`, so it remains a pre-existing baseline failure.

---

## Stage 20: Session-local Registry Deltas + Eliminate Import Cloning

Goal: Session-added nodes (mixin expansion, injected vars) go into a per-session delta
registry rather than the canonical index. Import paths no longer need to clone `Rules`
structurally — the canonical index is shared, session carries isolated parent state, and
only a shallow per-import metadata wrapper remains where different import sites need
different visibility / reference semantics on the same cached module.

Important status note: this stage landed major groundwork, but it did not finish the
broader immutable-node / session-write architecture. The branch is still in a
fundamentals-completion gate before Stage 21.

See [dependency-graph.md](./dependency-graph.md#stage-20-session-local-registry-deltas--eliminate-import-cloning) for the design checklist.

### Completed in Current Branch

- [x] Add `registryDeltas: WeakMap<Rules, SessionRegistryDelta>` to `EvalSession`
- [x] `sessionRegister(rules, type, node, ctx)` helper — writes to session delta when session active
- [x] Update `Rules.register()` to route through session delta when `ctx?.session` active
- [x] Update `Rules.getRegistry()` lookup: session delta first, then canonical WeakMap
- [x] Activate `sessionMarkScopeDirty` stub in `session-helpers.ts`
- [x] Remove `rules.ts:2293` `clone(true)` for detached ruleset unlock — replace with session-isolated eval
- [x] Remove the Stage 16 selector deep-clone workaround from `import-style.ts`’s `_dedupe` / `multiple` finalization path
- [x] Dependency-aware partial re-eval in `DeclarationRegistry.find()`: when a session has `changedVars`, irrelevant overlays fall through to canonical declarations
- [x] Characterization: repeated `_dedupe` imports share the same canonical registry slot
- [x] Characterization: mixin expansion parameter vars stay in the active session delta and do not pollute the canonical cache
- [x] Plain `@import` finalization reuses the evaluated root directly; plain `multiple:true` imports reuse shared child `Ruleset`s
- [x] Compose/configured finalization keeps only a shallow per-import wrapper for metadata isolation; no deep/tree clone remains in the output path

### Stage 20 Notes

- `EvalSession` now carries session-local registry deltas keyed by the `Rules` container, so `Rules.register()`/`Rules.find()` can survive session-local child-array swaps without polluting the canonical WeakMap-backed caches.
- Added `rules.test.ts` coverage proving that session-only declaration entries are visible with a session context, invisible to canonical lookup, and cleared by `sessionMarkScopeDirty()`.
- Added `rules.test.ts` coverage proving that changed-var sessions keep only dependency-relevant overlays; static overlays fall through to canonical declarations.
- Added parent-isolation coverage for session-aware `Rules.unshift(ctx, ...)` / `Rules.splice(ctx, ...)`, so shared canonical children can be inserted into session-scoped `Rules` wrappers without overwriting their canonical `.parent` pointers.
- Added `src/tree/__tests__/registry-characterization.test.ts` coverage proving that cached compose imports reuse the same canonical WeakMap-backed registry slot and that session-only declaration registrations stay in `EvalSession.registryDeltas` instead of polluting the canonical cache.
- Added characterization proving that plain `@import` finalization now reuses the already-evaluated shallow root, that `_dedupe` detaches the shared child array before cloning per-import `Ruleset`s, that repeated `_dedupe` imports share the same canonical registry slot, and that mixin expansion registrations stay session-local.
- Reduced `import-style.ts` cloning further: `getFinalRules()` now keeps child `Ruleset` cloning only for implicit reference / `_dedupe` imports. Plain `multiple:true` imports reuse shared child `Ruleset`s under the shallow wrapper without regressing `extend-import-style`.
- Reduced `import-style.ts` again: plain `@import` finalization no longer adds a second shallow `Rules` wrapper. The remaining shallow wrapper is now confined to compose/configured import paths where distinct import sites legitimately need different visibility / reference metadata on the same cached module.
- Fixed configured `with` compose finalization so canonical top-level nodes have their original parents restored after session teardown, eliminating the last known `import-style` parent-pointer regression.
- Selector ancestry for nested `Ruleset`s now reads through `sessionGetParent()` on the active render/extend paths, so clone-session descendants no longer recompute against stale canonical parents during collapse / reference rendering.
- `StyleImport.getFinalRules()` now materializes raw `.parent` links only for cloned descendants in the returned import tree, so import output remains structurally coherent after eval session teardown without mutating canonical shared nodes.
- Mixin guard param wrappers (`outerRules`) now materialize their local param/`@arguments` bindings directly instead of depending on session-local registry deltas, so fresh guard-probe sessions still resolve bound param vars.
- Detached ruleset unlock now uses `clone(false, undefined, ctx)` instead of `clone(true)`, so it reuses canonical children while preserving session-isolated parent/runtime state.
- The `_dedupe` / compose finalization paths still use the minimum shallow wrappers needed for per-import metadata or extend isolation, but the Stage 16 selector deep-clone workaround is gone and no deep/tree clone remains in the Stage 20 import path.
- `src/tree/__tests__/import-style.test.ts` is now fully green on the working tree.
- `src/tree/__tests__/import-style.test.ts` also proves why the compose wrapper remains shallow-only: repeated compose imports can require different visibility behavior at different import sites.
- Verification:
  - `cd packages/core && pnpm test src/tree/__tests__/rules.test.ts src/__tests__/eval-session.test.ts src/tree/__tests__/dependency-graph.test.ts`
  - `cd packages/core && pnpm test src/tree/__tests__/registry-characterization.test.ts src/tree/__tests__/rules.test.ts src/__tests__/eval-session.test.ts src/tree/__tests__/dependency-graph.test.ts src/tree/__tests__/control.test.ts`
  - `cd packages/core && pnpm test src/tree/__tests__/extend-import-style.test.ts src/tree/__tests__/import-style.test.ts`

---

## Pre-Stage-21 Threshold

Stage 20 completion is not, by itself, the gate to Stage 21. Do not start Live Patch API work until all of these are true:

- [ ] All cloning targeted by this refactor is removed, not just reduced in one slice
- [ ] All eval-time writes, mutations, and node replacements in scope are routed through sessions
- [ ] Tests pass to the accepted baseline with the two conditions above true
- [ ] A merge back to `dev` is credible without behavioral regressions

Current branch status: this threshold is **not yet met**.

## Current Actual Stage: Fundamentals Completion Gate

This is the real active stage on `jess-dev` right now, regardless of the numbered
roadmap slices already landed.

Definition:

- Canonical nodes are immutable after construction.
- Eval-time field writes and node replacements are session-backed operations.
- Session layers replace clone-based divergence for the targeted eval/import/mixin paths.
- Baseline behavior is re-proven in that stricter state.

Strategy rules for this gate:

- Move strictly from simpler nodes upward into more compositional nodes.
- Do not use `Rules`, imports, or extend as the proving ground for a lower-order node migration if a smaller focused test can prove the same thing.
- Do not treat “reduced clone pressure” as equivalent to “fundamentals complete”.
- Do not advance to a more complex node while a lower-order node in its dependency chain is still only partially migrated unless that dependency is explicitly documented and unavoidable.

Per-slice done condition:

- Add or preserve a focused behavior test for the node’s real public path.
- Add a focused immutability/session-overlay test:
  - session-scoped read sees the patched/replaced value
  - non-session read still sees canonical value
  - canonical node field/child identity stays unchanged
- Route the node’s active reads/writes for that slice through session helpers.
- Re-run the narrow safety set for that node before widening scope.
- Commit at the slice boundary before moving upward.

What does not count as done:

- Only making serialization session-aware while eval-time writes still mutate canonically
- Only adding session helpers without production callers using them
- Only proving behavior through `Rules` / import composition when the node itself lacks a narrow proof
- Only reducing cloning in one path while other in-scope mutation paths still bypass sessions

Per-node test contract:

- Public behavior parity test:
  - location: the node's own vitest file in `packages/core/src/tree/__tests__/`
  - examples: `declaration.test.ts`, `ruleset.test.ts`, `call.test.ts`, `mixin.test.ts`
  - purpose: prove the node's normal public eval/render behavior is unchanged by the migration
- Session overlay / immutability test:
  - location: `packages/core/src/__tests__/eval-session.test.ts`
  - purpose: prove the effective session view is `session overlay + canonical fallback`
  - required assertions:
    - session-scoped read sees the patched/replaced value
    - non-session read still sees canonical value
    - canonical field or child identity remains unchanged
- Eval-write proof:
  - location: prefer the node's own test file; use `eval-session.test.ts` only when the helper semantics themselves are what is under test
  - purpose: for nodes that actively mutate during eval, prove the migrated eval path writes into the session instead of canonically mutating the node

Allowed test shapes:

- Field-backed node:
  - patch one field in-session
  - assert `{ context }` render/eval sees the patched value
  - assert no-context render/eval still sees canonical value
  - assert the canonical field still points at the original object/value
- Structural node:
  - replace/append/remove a child in-session
  - assert session-scoped render/eval sees the changed child sequence
  - assert canonical `value[]` remains unchanged
  - assert canonical parent/child identity remains unchanged
- Eval-time mutation node:
  - exercise the smallest real public path that causes the write
  - assert output/behavior matches pre-migration behavior
  - assert the canonical field/child was not overwritten

Not sufficient as primary proof:

- Only proving a low-order node through `rules.test.ts`
- Only proving a low-order node through `import-style.test.ts`
- Only proving a low-order node through extend integration tests

Those broader tests are still useful, but only as secondary confirmation after the node-level proof exists.

When a node may be marked `complete` in [node-session-status.md](./node-session-status.md):

- all active in-scope reads are session-aware
- all active in-scope eval-time writes/replacements are session-backed
- no remaining clone/copy behavior is still required for that node's targeted responsibility in this fundamentals pass
- the node has public behavior parity coverage in its own `src/tree/__tests__/` file
- the node has explicit overlay/immutability coverage in `src/__tests__/eval-session.test.ts`
- any broader dependent integration tests needed for confidence are green
- the slice has been committed and pushed as a stable boundary

If any of those are missing, the node remains `partial`.

Immediate next work before Stage 21:

- [ ] Inventory remaining `clone()` / `copy()` sites on the critical eval/import/extend paths
- [ ] Finish sessionizing remaining eval-time mutation / replacement paths, starting with lower-order nodes before `Rules` / import composition
- [ ] Re-run the baseline against that stricter state and confirm behavior is preserved
- [ ] Rewrite any misleading roadmap text whenever implementation reality changes
- [ ] Maintain the concrete node inventory in [node-session-status.md](./node-session-status.md) so every tree node has an explicit session/immutability status

Current atomic queue:

- [ ] Immediate next node slice: `AttributeSelector`
- [ ] After that, continue the ordered queue in [node-session-status.md](./node-session-status.md)
- [ ] Keep Stage 20.5 (`Direct mixin invocation path`) deferred until the lower-order node queue is sufficiently stable

Source of truth for ordering:

- Keep the live next-up queue and priority batches in [node-session-status.md](./node-session-status.md).
- `PROGRESS.md` should summarize the current slice, but the per-node guide owns the ordered execution queue.

Current blocker notes from live reduction attempts:

- Recent completed node slices: `RawRules`, `Block`, `Negative`, `Rest`.
  - Per-node status and proof details live in [node-session-status.md](./node-session-status.md).
- The internal mixin invocation path remains architecturally indirect:
  - `Reference.evalNode()` can turn mixin candidate arrays into a JS-callable adapter via `getFunctionFromMixins()`
  - `Call.evalNode()` then re-enters that adapter through the generic function path (`cast(...)`, `JsFunction`, `callWithContext(...)`)
  - `getFunctionFromMixins()` currently conflates candidate resolution, argument normalization, named/default/rest binding, guard/default() evaluation, recursion handling, session selection, and output materialization
  - this is now tracked as its own planned pre-Stage-21 stage in `dependency-graph.md`, not as part of lower-order node completion
- The `Rules.value` / session-registry identity blocker is now resolved. Session registry deltas are keyed by the `Rules` container, and characterization now proves they survive a shallow clone swapping to a new `value[]`.
- `Rules.value` is now typed readonly for consumers. Plugin / visitor code should treat direct array mutation as invalid and go through `setData()` or container helpers instead.
- Child-array isolation and generic session-local replacement are still coupled. The next safe reduction likely needs session-local child storage for `Rules` or equivalent helper-backed replacement semantics.
- Remaining high-signal clone/copy clusters are still concentrated in `rules.ts` (mixin arg binding / output shaping), `extend.ts`, `ruleset.ts`, and `ampersand.ts`.
- `sessionReplaceNode()` is still only a stub for true session-local replacement semantics; generic eval-time node replacement is not fully sessionized yet.
- A smaller cleanup slice is now in place: direct eval-lifecycle writes in `declaration.ts`, `ruleset.ts`, and preserve-mode fallback in `operation.ts` were moved off raw canonical `.evaluated` writes. `src/__tests__/eval-session.test.ts` now proves preserve-mode operation fallback does not mark canonical nodes evaluated when a session is active.
- The next safe order is bottom-up: finish `Declaration` and `Ruleset` session-backed field writes/read paths before attempting broader `Rules` or import-facing structural reduction again.
- New bottom-up slice now landed in the working tree: `Declaration` reads/writes use session-aware accessors in eval and serialization, `Ruleset` has matching selector/rules/guard accessors on its active eval/render paths, and `serialize-helper.ts` now reads a session-patched `rules` body when a `Context` is present.
- Follow-up on that slice is also now landed in the working tree: nested selector ancestry is session-aware on `Ruleset` / extend paths, returned import trees materialize clone-only parent links after session teardown, and mixin guard wrapper scopes no longer lose bound params when guard evaluation swaps to a fresh session.
- The current bottom-up render-read pass is now broader and still green on the focused safety set:
  - selector-side containers: `PseudoSelector`, `SelectorList`, `ComplexSelector`, `CompoundSelector`
  - wrapper/value nodes: `AtRule`, `Mixin`, `Call`, `Expression`, `Paren`, `Quoted`, `Url`, `SelectorCapture`
  - container/value nodes: `List`, `Sequence`, `QueryCondition`, `Condition`, `Func`, `Range`
  - reference/interpolation nodes: `Reference`, `Interpolated`, `JsImport`
- Verified together:
  - `cd packages/core && pnpm test src/__tests__/eval-session.test.ts src/tree/__tests__/extend-import-style.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/dependency-graph.test.ts src/tree/__tests__/mixin.test.ts src/tree/__tests__/control.test.ts src/tree/__tests__/declaration.test.ts src/tree/__tests__/call.test.ts src/tree/__tests__/condition.test.ts src/tree/__tests__/list.test.ts src/tree/__tests__/sequence.test.ts src/tree/__tests__/func.test.ts src/tree/__tests__/at-rule.test.ts`
  - Result: `230 passed, 9 skipped`
  - `cd packages/core && pnpm test src/__tests__/eval-session.test.ts src/tree/__tests__/reference.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/mixin.test.ts src/tree/__tests__/call.test.ts src/tree/__tests__/at-rule.test.ts`
  - Result: `173 passed, 1 skipped`
- New structural-foundation slice now landed in the working tree:
  - `EvalSession` has a session-local child-array overlay for `Rules`
  - `sessionGetChildren()`, `sessionAppendChildren()`, `sessionPrependChildren()`, `sessionRemoveChild()`, and `sessionReplaceNode()` now operate on that overlay under an active session
  - runtime overlay lookups now respect explicit `parent: undefined` / `sourceParent: undefined` clears in-session
  - verified with:
  - `cd packages/core && pnpm test src/__tests__/eval-session.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/mixin.test.ts`
  - Result: `173 passed, 9 skipped`
- First production consumer of that overlay now landed in the working tree:
  - `Rules._emitRulesBody()`, `Rules.flatRules()`, and `Rules.visibleRules()` now read the session-local child overlay when a `Context` is present
  - `src/__tests__/eval-session.test.ts` now proves `Rules.toTrimmedString({ context })` sees overlay replacement/append operations while canonical output stays unchanged
  - verified with:
  - `cd packages/core && pnpm test src/__tests__/eval-session.test.ts src/tree/__tests__/rules.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/mixin.test.ts`
  - Result: `174 passed, 9 skipped`
- This does **not** change the real blocker: generic session-local node replacement / `Rules.value[]` overlay semantics are still incomplete, so these slices only move lower-order field/render reads toward the intended immutable-node architecture.
- The next integration step is to route eval/preEval/indexing/registry `Rules` loops through these helpers instead of directly reading/writing `rules.value`.

---

## Stage 21: Live Patch API

Goal: Emit `var(--jess-id, fallback)` for patchable Declaration values, plus a `patch.js`
bundle that re-expresses downstream transformations using `@jesscss/fns`.

See [dependency-graph.md](./dependency-graph.md#stage-21-live-patch-api) for full checklist.

- [ ] Add `PatchSideTable` to `Context` — collects `(varDecl, sourceExpr, cssId, fallback)` during serialization
- [ ] Serialization: check `sessionGetDependency` on Declaration value node; emit `var(--jess-<id>, <fallback>)` when non-null
- [ ] `PatchSideTable.register()` deduplicates by `(varDecl, sourceExpr)` identity
- [ ] New `patch-emitter.ts` module: walk side table → resolve `@jesscss/fns` imports → emit update functions + `patch()` entry point
- [ ] CLI: `--patch` flag enables side table collection and `patch.js` emission
- [ ] Tests: static → no `var()`; direct var → `var()`; mixin absorption → static; selector interpolation → not patchable

---

## Future Exploration

### Pre/Post Serialization Simplification

**Current model**: Every node has `pre?: (string | Node)[]` and `post?: (string | Node)[]`.
The parser fills these with whitespace strings and Comment nodes to preserve exact source
formatting. This creates overhead: every `copy(true)` must deep-clone pre/post arrays and
replace Comment entries with Nil; `stripPrePost` exists solely for this cleanup.

**Problem**: Most output normalizes spacing anyway — indentation is recalculated from depth,
selectors get `.replace(/\s+/g, ' ')`, and declarations use fixed `: ` separators. The
pre/post arrays are faithfully preserved but rarely matter in the final output.

**Possible simpler models:**

1. **Flags-only model** — Replace pre/post arrays with bit flags on the node:
   - `HAS_LEADING_NEWLINE` — blank line before this node
   - `HAS_TRAILING_NEWLINE` — blank line after
   - `HAS_ATTACHED_COMMENT` — a comment is logically associated
   - Comments become siblings in the parent `Rules` array rather than pre/post attachments
   - Serializer uses flags + depth to reconstruct whitespace; comments serialize in order
   - **Pro**: Zero per-node allocation for whitespace. `copy(true)` no longer needs to touch
     pre/post at all. `stripPrePost` disappears.
   - **Con**: Loses exact column-level whitespace fidelity (rarely matters for CSS output).

2. **Enum spacing model** — Replace pre/post with a single `spacing: SpacingHint` field:
   - `SpacingHint = 'none' | 'space' | 'newline' | 'blank-line'`
   - Captures the meaningful intent without storing raw whitespace strings
   - Comments stored as children or in a separate `attachedComments` array
   - **Pro**: Simpler than flags, single field to copy. Clear semantic intent.
   - **Con**: Can't distinguish e.g. `\n` from `\n\n` without an extra bit.

3. **Comments-only pre/post** — Keep pre/post but only store Comment nodes, not whitespace:
   - Whitespace is always recalculated from context during serialization
   - `pre`/`post` become `Comment[] | undefined` instead of `(string | Node)[]`
   - `copy(true)` just needs to null out pre/post (or skip Comments via suppressComments)
   - **Pro**: Minimal change to parser; keeps comment attachment model intact.
   - **Con**: Still allocates arrays for comments; still needs stripPrePost for copy paths.

4. **processPrePost shortcodes** — Keep current model but add fast-path codes:
   - Already partially done: `0` = "no space", `1` = "single space", `undefined` = default
   - Extend to: `2` = "newline", `3` = "newline + indent"
   - Only use arrays when actual Comment nodes are present
   - **Pro**: Already partially in place (the `0`/`1` codes). Backward compatible.
   - **Con**: Still stores Comment nodes in arrays; doesn't eliminate copy overhead for those.

**Recommendation**: Option 1 (flags) or option 3 (comments-only) seem most practical.
Option 1 is the most aggressive simplification; option 3 is the least disruptive.
Either way, the key win is making whitespace reconstruction rule-based rather than stored,
which eliminates the bulk of pre/post array allocations and the `stripPrePost` machinery.

---

### Live Patch API (CSS Custom Property + JS Bundle Output)

**Goal**: Emit two outputs from a single Jess compilation:

1. **CSS** — every Declaration value that is dynamic and traces to a top-level
   `VarDeclaration` is emitted as `var(--generated-id, compile-time-value)` instead of
   a bare value. The compile-time value is the fallback for environments without JS.

2. **patch.js** — a tree-shakeable JS module that imports only the `@jesscss/fns`
   functions that were actually used, re-expressing each top-level variable's downstream
   transformations as a JS call graph. Consumers call a generated `patch(overrides)`
   function at runtime to update custom properties without re-running the compiler.

**Eligibility rule**: a Declaration value is patchable if:
- It is dynamic (`F_NON_STATIC`) — i.e., it wasn't collapsed at compile time, AND
- Its dependency chain includes at least one **top-level** `VarDeclaration` (root scope,
  not a mixin parameter or block-local variable)

Values that are dynamic but only depend on mixin params / local vars are emitted
statically (those knobs can't be turned from outside the compiled stylesheet).

**Why this depends on canonical tree preservation**: The pre-eval expression
`lighten(@primary, 10%)` in the canonical source tree IS the patch.js expression — it
uses the same `@jesscss/fns` function that ran at compile time. The evaluated value
`#4477aa` is the CSS fallback. Both must be simultaneously available, which requires
the canonical (unevaluated) tree to remain unmutated alongside the evaluated output.
The COW / EvalSession work (Stages 7–15) is the prerequisite.

**Implementation sketch (not yet started)**:
- `Reference.eval()`: when resolving a top-level `VarDeclaration`, tag the returned
  node with `_sourceVariable` (pointer back to the `VarDeclaration`)
- Tag propagation: `Operation` / `Call` nodes propagate `_sourceVariable` to their
  output if any input carries one (the output "depends on" that variable)
- Serialization: if a Declaration value node carries `_sourceVariable`, emit
  `var(--generated-id, compile-time-value)` and record `(varDecl, sourceExpr, id)` in
  a side table on the context
- patch.js emitter: walk the side table, import referenced fns, emit update functions

**Tier coverage**: all value-level variables are patchable — `darken`, `lighten`, `fade`,
arithmetic, etc. — because the same `@jesscss/fns` functions run at both compile time and
runtime. Genuinely unpatchable: selector interpolation (`.icon-@{name}`), variables that
gate mixin application, structural conditionals that change the AST shape.

---

## Notes

### Current fundamentals boundary

- `EvalSession` now has a session-local child-array overlay for `Rules`.
- `Rules` render-side reads plus explicit context-bearing read APIs now consume it:
  `_emitRulesBody()`, `flatRules()`, `visibleRules()`, root `toString()` leading-comment hoist,
  `at(index, context?)`, and `toObject(convertToPrimitives, context?)`.
- `Rules` now also has explicit structural child-replacement helpers on the session layer:
  `sessionSetChildAt()` / `sessionSetChildren()`, with the first production consumers in
  `preEval()`, `_multiPassPreEval()`, `_resolveDynamicNodes()`, and `_preEvalRemainingChildren()`.
- Focused regression coverage now proves `preEval()` can see a session-local child replacement
  in a non-reset eval session, assign runtime index there, and leave canonical children unchanged.
- The next semantic `Rules` phase is now partially sessionized on the non-reset path:
  `_buildEvalQueue()`, `_evaluateQueue()`, `_assignDocumentOrderDepthFirst()`,
  `_normalizeCallDeclarationRulesOrder()`, and `_coalesceMergedDeclarations()` now read the
  same session-local child layer when a non-reset eval session is active.
- Focused regression coverage now also proves `Rules.eval()` can consume a session-local child
  replacement from its queue without mutating the canonical child array.
- `_coalesceMergedDeclarations()` is also now session-safe on the non-reset path for the
  declaration-field mutations it performs: declaration `value` / `important` updates use
  `sessionPatchField()`, and visibility suppression uses `Node._removeFlag(...)`.
- Focused verification is green:
  `cd packages/core && pnpm test src/tree/__tests__/rules.test.ts src/__tests__/eval-session.test.ts src/tree/__tests__/import-style.test.ts src/tree/__tests__/mixin.test.ts`
  Result: `178 passed, 9 skipped`
- `Rules[Symbol.iterator]()` is still canonical on purpose because it has no explicit
  `Context` channel. Do not make it session-aware by introducing hidden ambient state.
- Reset-eval clone sessions still intentionally use the cloned working-tree path for queue/application
  writes so returned import trees are structurally materialized without depending on an active session.
- Next integration step is still the harder one: close the remaining split between reset-eval clone
  sessions and non-reset session overlays, or keep reducing clone pressure elsewhere once that tradeoff
  is better characterized.

### Working procedure
1. Convert ONE node class at a time
2. Run `cd packages/core && pnpm test` after each conversion
3. Confirm green (same baseline or better) before moving on
4. Commit after each successful conversion
5. When renaming fields (Stage 3): grep all packages first, update all consumers in same commit

### Test commands
- Core: `cd packages/core && pnpm test`
- Fns: `cd packages/fns && pnpm test`
- Jess: `cd packages/jess && pnpm test`
- Full: `pnpm test` from root (note: jess has pre-existing Node v24 resolution failures)
