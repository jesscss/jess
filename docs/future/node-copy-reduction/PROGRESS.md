# Node Copy Reduction — Implementation Progress

## Test Baselines

Recorded 2026-03-16 after merging dev (commit `7f47b49d`) into jess-dev.
Build fix: TypeScript errors from dev merge resolved (type narrowing casts in
selector-utils.ts, extend-core.ts, registry-utils.ts, reference.ts).

### Core (`packages/core`)
- **Test Files**: 8 failed | 59 passed | 2 skipped (69 total)
- **Tests**: 31 failed | 866 passed | 17 skipped (914 total)
- Failing files: ampersand, at-rule, import-style (with values), mixin-recursion,
  mixin, nesting-collapse, process-leading-is, at-rule-basic
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
- [ ] `Ruleset` — `selector`, `rules`, `guard`; childKeys=['selector','rules','guard']
- [ ] `AtRule` — `name`, `prelude`, `rules`; childKeys=['name','prelude','rules']
- [ ] `Mixin` — `name`, `rules`, `params`, `guard`; childKeys=['name','rules','params','guard']
- [ ] `StyleImport` — `path`, `withConfig`; childKeys=['path']
- [ ] `Rules` — `value: Node[]`; childKeys=['value']

**Selector containers:**
- [ ] `SelectorList` — `value: Selector[]`; childKeys=['value']
- [ ] `ComplexSelector` — `value: ComplexSelectorComponent[]`; childKeys=['value']
- [ ] `CompoundSelector` — `value: SimpleSelector[]`; childKeys=['value']
- [x] `PseudoSelector` — `name`, `arg`; childKeys=['name','arg']
- [x] `SelectorAttr` — `name`, `value`; childKeys=['name','value']
- [x] `SelectorInterpolated` — `value`; childKeys=['value']

**Other nodes:**
- [ ] `List` — TBD
- [ ] `Collection` — TBD
- [x] `Interpolated` — `source`, `replacements`; childKeys=['source','replacements']
- [x] `Rest` — `value`; childKeys=['value']
- [x] `Range` — `start`, `end`, `step`; childKeys=['start','end','step']
- [ ] `Sequence` — TBD
- [x] `Block` — `value`; childKeys=['value']
- [x] `Extend` — `selector`, `target`; childKeys=['selector','target']
- [ ] `ExtendList` — TBD
- [ ] `Control` (If, For, Each, While) — TBD
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
- [ ] `DeclarationCustom` — inherits Declaration childKeys (needs verification)
- [ ] `RulesRaw` — TBD
- [ ] `Tree` — TBD

### Stage 2 Exit Criteria
- [ ] All node types use instance fields
- [ ] `childKeys` populated on every class
- [ ] `getEntriesFromNode()` replaced by `childKeys` iteration
- [ ] `clone()` uses `childKeys` for all types
- [ ] All tests pass (same baseline or better)

---

## Stage 3: Less-Aligned Field Renames

- [ ] Any: `.data` → `value`
- [ ] Bool: `.data` → `value`
- [ ] Comment: `.data` → `value`, options.lineComment → `lineComment`
- [ ] Quoted: `.data` → `value`, options.quote → `quote`, options.escaped → `escaped`
- [ ] Condition: options.negate → `negate`
- [ ] Any: options.role → `role`
- [ ] Operation: `operator` → `op`

---

## Stage 4: RenderMask and `render()` Function

- [ ] Define `RenderMask` interface
- [ ] Implement `render(node, options?)` standalone function
- [ ] Update base-class `toTrimmedString()` fallback to iterate `childKeys`
- [ ] Keep `.toString()` as convenience delegating to `render(this)`
- [ ] Comment suppression via mask
- [ ] Convert Reference output paths to use render mask (not `copy(true)`)
- [ ] Convert extend output helpers to use render mask

---

## Stage 5: Declarative Adapter Layer

- [ ] Define `NodeAdapter<T>` interface
- [ ] Implement `createAdapter(node, def, cache)`
- [ ] Convert existing transformer files to adapter definitions
- [ ] Verify less-compat test suite passes

---

## Stage 6: Remove `.data` Compatibility Layer

- [ ] Grep for all `.data` usage
- [ ] Convert remaining consumers to instance fields
- [ ] Remove `.data` getter from base class
- [ ] Remove `setData()` from base class
- [ ] Remove `getEntriesFromNode()` and related utilities

---

## Stage 7-13: EvalSession (Future)

These stages are deferred until Stages 1-6 are complete. See migration.md for details.

- [ ] Stage 7: Introduce EvalSession as optional layer
- [ ] Stage 8: Session-aware read/write helpers
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
