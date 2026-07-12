# Parser AST Gap Baseline

## Purpose

This document captures the parser-only AST baselines we should use while restoring the CSS and Less parsers.

It is meant to answer one specific question:

- "Did the parser stop constructing the AST shape we historically expected?"

It is not meant to track:

- runtime/session evaluation bugs
- serializer-only formatting changes
- `.data` to instance-field API migration cleanup

Those are real issues, but they are not parser-shape regressions by themselves.

Historical parser output is also not assumed to be exhaustive.

If the historical parser missed a semantically important AST distinction, we should improve the current parser and update the contract accordingly. In practice:

- treat the historical AST as the minimum shape contract
- preserve stable historical semantics where they are correct
- allow the current parser to become more explicit when that produces a better AST
- document those intentional AST upgrades instead of hiding them inside test churn

## Historical Baselines

Two historical baselines currently agree:

1. Pre-`no-allstar`, pre-`@jesscss/parser` rename
   - worktree: `/private/tmp/jess-pre-no-allstar-parser`
   - commit: `59fae8e8`
   - message: `fix: correct @arguments construction for mixin calls`
2. `no-allstar`
   - worktree: `/Users/matthew/git/worktrees/jess/no-allstar`
   - commit: `05728d7b`
   - message: `Node mutation fixes`

Important result:

- The historical CSS AST serialize baseline is identical between these two worktrees.
- The historical Less AST serialize baseline is also identical between these two worktrees.

That makes the overlapping test expectations the best stable AST contract we currently have.

## Source Files To Treat As Baseline

### CSS

- `/private/tmp/jess-pre-no-allstar-parser/packages/css-parser/test/ast-serialize.test.ts`
- `/Users/matthew/git/worktrees/jess/no-allstar/packages/css-parser/test/ast-serialize.test.ts`

### Less

- `/private/tmp/jess-pre-no-allstar-parser/packages/less-parser/test/ast-serialize.test.ts`
- `/Users/matthew/git/worktrees/jess/no-allstar/packages/less-parser/test/ast-serialize.test.ts`
- `/private/tmp/jess-pre-no-allstar-parser/packages/less-parser/test/selectors.test.ts`
- `/private/tmp/jess-pre-no-allstar-parser/packages/less-parser/test/guards.test.ts`
- `/private/tmp/jess-pre-no-allstar-parser/packages/less-parser/test/functions.test.ts`

## What Counts As A Parser AST Gap

These are parser gaps:

- a node kind changes
- a node role changes
- a nested target/call/reference shape changes
- a prelude/query/selector subtree changes meaningfully
- a Less construct starts parsing into a different semantic node family

These are not parser gaps by themselves:

- direct field access replacing `.value` / `.data`
- serializer output order changes
- `Nil ''` vs `Nil`
- operation serialization changing from positional list output to named `left` / `right` / `operator`
- tests updated to read `atRule.prelude` instead of the old AtRule payload prelude
- tests updated to read `call.name` / `call.args` instead of `call.value.name` / `call.value.args`

## Stable AST Contracts We Should Preserve

### CSS

The historical CSS AST serialize baseline did not drift. That suggests the CSS parser contract is mostly stable, and the main task is to avoid reintroducing ambiguity while preserving existing shapes.

High-value CSS contracts:

- `@container` and `@media` comparison forms build `QueryCondition` inside `Paren`
- colon feature syntax inside media/container remains `Declaration`, not `QueryCondition`
- query keywords like `not` / `and` remain keyword nodes with correct role tagging
- call-style container query functions keep `Call -> args` structure

### Less

High-value Less contracts from the historical AST baseline:

- nested namespaced reference shape is preserved
  - example: `@ref: #ns.breakpoint(.valToGet[])[@max];`
  - expected shape: `Reference(target: Call(name: Reference[role=name], args: List(...)), key: 'max')`
- mixin definitions preserve parameter-as-`VarDeclaration` shape
  - example: `.mixin(@color) { color: @color; }`
- `default()` guard semantics preserve `hasDefault`
- rest parameters and rest arguments preserve `Rest` node usage
- property/index lookups remain `Reference` shapes, not ad hoc strings
- selector/extend parsing preserves `Extend` node placement inside rulesets

## Current Findings

### 1. CSS AST Contract Drift

No parser-shape drift has been identified yet from the historical CSS AST serialize baseline.

Observed changes in current CSS tests are node API access changes, not parser AST drift:

- old AtRule payload prelude access -> `atRule.prelude`
- `call.value.name` / `call.value.args` -> `call.name` / `call.args`

That means the CSS parser should be treated as structurally stable unless a specific parse shape is proven otherwise.

### 2. Less AST Contract Drift

The current Less AST test file has some drift from the historical baseline, but the first-pass review suggests most of it is not parser debt.

Examples of non-parser drift:

- mixin serialization order differences (`rules` appearing before `params`)
- `Nil ''` vs `Nil`
- operation serialization as `left/right/operator`
- stringified property accessor normalization changes

These should not be treated as evidence that the Less parser itself regressed.

### 3. Intentional AST Upgrades Beyond The Historical Baseline

The historical parser baseline is missing some modern CSS query/container forms that we now parse explicitly.

These should be treated as parser improvements, not regressions:

- explicit `QueryCondition` coverage for modern `@container` and `@media` comparison syntax
- explicit `Keyword` role coverage for `not` / `and` / `or` in query conditions
- explicit `Call -> List -> QueryCondition` coverage for container query functions like `scroll-state(...)`

Current reference tests:

- `/Users/matthew/git/oss/jess/packages/css-parser/test/container.test.ts`

### 4. Real Parser-Sensitive Less Areas To Re-Verify

These are the areas that should stay under active AST scrutiny while parser restoration continues:

- nested namespaced references
  - `#ns.breakpoint(.valToGet[])[@max]`
- guard/comparison construction
  - especially `default()` and negated/default guard forms
- mixin name vs lookup/call boundaries
- selector capture and extend target construction
- media-query entry forms that are Less-specific
  - `@media @breakpoint, print { }`
  - `@media #ns.breakpoint(.valToGet[])[@max] { }`

## Important Non-Parser Finding

The current import/reference failure path is not pointing at a parser AST gap.

Current evidence shows:

- imported Less trees parse into the expected top-level AST shape
- the corruption appears later, during eval-time registration setup when an
  `EvalSession` is active
- without a session, the imported AST shape remains correct

So import/reference runtime failures should not be used as parser-shape evidence
unless the raw parsed tree is already wrong before eval-time registration setup.

## Recommended Workflow

When changing CSS or Less parser productions:

1. Check the historical baseline tests first.
2. Add or preserve a `serializeTypes(...)` assertion in the current parser test suite.
3. If the current AST differs, classify the difference:
   - parser contract drift
   - node API migration
   - serializer-only drift
   - runtime/eval/session corruption after parse
4. Only treat the first category as parser restoration work.

## Immediate Next Steps

- Keep the historical AST baseline frozen at `59fae8e8` and `05728d7b`.
- Port or preserve the highest-value historical AST expectations in the current parser test suites.
- For Less, prioritize AST checks around:
  - references
  - guards
  - mixin call/lookup shapes
  - media query entry shapes
- For CSS, keep the existing AST serialize coverage stable and use it as the shared base for Less overrides.

## Progress

- [x] Less references
  - current explicit coverage already exists in `packages/less-parser/test/ast-serialize.test.ts`
  - examples: nested namespaced reference, property accessor, chained mixin-reference shapes
- [x] Less guards
  - added explicit current parser assertions in `packages/less-parser/test/guards.test.ts`
  - covers `default()`, negated `default()`, and nested `and` comparison shape
- [x] Less mixin lookup/call shapes
  - added explicit current parser assertions in `packages/less-parser/test/mixins.test.ts`
  - covers bracket lookup, namespaced lookup, and mixin call shape
- [x] Less media query entry forms
  - added explicit current parser assertions in `packages/less-parser/test/at-rules.test.ts`
  - covers `@media @breakpoint, print` and `@media #ns.breakpoint(.valToGet[])[@max]`
- [x] CSS parser AST gap review beyond current stable baseline
  - current evidence still points to node API/test cleanup, not parser-shape drift
  - added explicit current parser assertions in `packages/css-parser/test/container.test.ts`
  - covers query prelude shape for `not`, simple media comparison shape, and container query function-call shape
- [x] Intentional AST upgrades not present in the historical parser
  - documented modern CSS query/container AST coverage as parser improvements
  - current reference coverage lives in `packages/css-parser/test/container.test.ts`
