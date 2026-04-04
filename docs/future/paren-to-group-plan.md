# Paren To Group Plan

## Goal

Defer a future rename of `Paren` to a more general grouping node, likely `Group`,
without destabilizing the current parser/eval/serializer stack.

Near-term work is intentionally smaller:

- keep the `Paren` node name
- add delimiter metadata (`paren` or `square`)
- use that metadata for SCSS bracketed list parsing

This document captures the likely impact surface for a later rename.

## Why Rename Later

`Paren` is now doing more than one job:

- ordinary parenthesized grouping
- escaped Less `~(...)`
- SCSS/Jess-compatible grouped list/value forms
- SCSS bracketed list semantics via delimiter metadata

That makes a more general name reasonable, but the existing `Paren` contract is
deeply wired into parsers, visitors, serializers, and tests.

## Primary Surfaces To Touch

### Core Node Identity

- `packages/core/src/tree/paren.ts`
- `packages/core/src/tree/node-type.ts`
- `packages/core/src/tree/tree.ts`
- `packages/core/src/index.ts`

Expected changes:

- rename exported class/type from `Paren` to `Group`
- decide whether to preserve `Paren` as a compatibility alias
- update node-type enum/table wiring

### Visitor API

- `packages/core/src/visitor/index.ts`

Expected changes:

- `paren` / `parenExit` callbacks would need renaming or aliasing
- any downstream visitors relying on those hook names would need updating

### Core Eval / Serialization

- `packages/core/src/tree/paren.ts`
- `packages/core/src/tree/call.ts`

Expected changes:

- preserve existing paren-frame semantics for arithmetic / expression grouping
- preserve Less escaped-paren behavior
- ensure square-delimited grouping is not accidentally flattened during eval

### CSS Parser

- `packages/css-parser/src/productions/values.ts`
- `packages/css-parser/src/productions/atRules.ts`
- `packages/css-parser/src/productions/misc.ts`
- `packages/css-parser/test/container.test.ts`

Expected changes:

- media/container query grouping currently emits `Paren`
- CSS calc/math grouping currently emits `Paren`
- serializer snapshots and AST shape assertions would need updates

### Less Parser

- `packages/less-parser/src/productions/values.ts`
- `packages/less-parser/src/productions/guards.ts`
- `packages/less-parser/src/productions/root.ts`
- tests under `packages/less-parser/test`

Expected changes:

- guard conditions and query conditions rely on `Paren`
- escaped paren values are a distinct behavior that must remain intact

### SCSS Parser

- `packages/scss-parser/src/productions/conditions.ts`
- `packages/scss-parser/src/productions/values.ts`
- `packages/scss-parser/src/productions/atRules.ts`
- tests under `packages/scss-parser/test`

Expected changes:

- SCSS condition grouping currently emits `Paren`
- new bracketed-list support depends on delimiter metadata

### Jess Parser

- `packages/jess-parser/src/productions.ts`
- `packages/jess-parser/src/productions/values.ts`
- tests under `packages/jess-parser/test`

Expected changes:

- interpolation/expression grouping currently emits `Paren`

## Compatibility Strategy

Recommended migration order:

1. Keep `Paren` as the runtime class and add delimiter metadata first.
2. Update all serializer/eval logic to be delimiter-aware.
3. Add a compatibility alias export if/when `Group` is introduced.
4. Migrate parser code and tests from `Paren` to `Group`.
5. Only then consider deprecating the `Paren` name.

This avoids a large all-at-once churn across parsers and core tests.

## Things To Verify After Renaming

- CSS media/container AST shape tests still pass.
- Less guard and escaped-paren behavior is unchanged.
- SCSS condition AST shape is unchanged.
- SCSS bracketed-list metadata still survives parse and eval.
- Jess interpolation / `$(...)` grouping behavior is unchanged.
- `serializeTypes()` output remains stable or is intentionally updated.
- visitor hooks still fire for grouping nodes.

## Suggested Safety Net

Before attempting the rename:

- add focused core tests for delimiter-aware grouping behavior
- add parser tests that assert square-delimited grouping survives SCSS parse
- keep a temporary alias layer (`Paren` -> `Group`) until all packages are updated
