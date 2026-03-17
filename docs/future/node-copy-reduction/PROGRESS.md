# Node Copy Reduction — Implementation Progress

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

## Stage 8-13: EvalSession Wiring (Future)

- [ ] Stage 8: Session-aware read/write helpers wired into eval
- [ ] Stage 9: Move import lookup to session scope
- [ ] Stage 10: Externalize runtime state to session
- [ ] Stage 11: Copy-on-write materialization
- [ ] Stage 12: Remove preserveOriginalNodes
- [ ] Stage 13: Expand beyond imports, clean up

---

## Stage 14: Explore Collapsing preEval / eval (Future)

- [ ] Instrument preEval pass timing
- [ ] Prototype registration-during-walk for simple case
- [ ] Decision: merge or keep separate

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

## Notes

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
