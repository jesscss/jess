# Extend Success State

Track extend regressions/progress over time. Keep entries short and factual.

## Matrix to track

- `pnpm --filter @jesscss/core exec vitest run src/tree/__tests__/extend-less-fixtures.test.ts`
- `cd packages/core && pnpm test -- --run src/tree/util/__tests__/extend src/tree/__tests__/extend`

## Entry template

```
Date:
Commit:
Hypothesis:
Focused test:
Files changed:
Less fixtures (fail/pass/skip):
Core extend matrix (fail/pass/skip):
Delta vs previous:
Result: IMPROVED | REGRESSED | NEUTRAL
Notes:
Next step:
```

## Entries

Date: 2026-02-09
Commit: working tree
Hypothesis: preserve order in :is(...):after narrow wrap handling; stabilize exact complex selection
Focused test: `1b. extend-clearfix without nesting`
Files changed: `packages/core/src/tree/util/extend.ts`, `packages/core/src/tree/__tests__/extend-less-fixtures.test.ts`
Less fixtures (fail/pass/skip): 3 / 4 / 1
Core extend matrix (fail/pass/skip): not rerun in this snapshot
Delta vs previous: from 5 failing less fixtures to 3 failing less fixtures
Result: IMPROVED (fixture set), matrix status pending
Notes: Remaining fixture failures are `2`, `4`, `5`.
Next step: isolate `4`, verify nesting/extendWith scope interactions, then rerun full matrix.

Date: 2026-02-09
Commit: working tree
Hypothesis: preserve matcher `replace` in partial mode for component paths
Focused test: `4. extend-selector.less`, `5. extend.less`
Files changed: `packages/core/src/tree/util/extend.ts`
Less fixtures (fail/pass/skip): 5 / 2 / 1
Core extend matrix (fail/pass/skip): 31 / 91 / 1 (focused matrix subset)
Delta vs previous: regression spike after change
Result: REGRESSED
Notes: Reverted immediately; hypothesis rejected by runtime evidence.
Next step: keep partial wrapping logic, investigate assignment/hoist and relative extender projection.

Date: 2026-02-09
Commit: working tree
Hypothesis: skip no-op selector assignments in `processExtends` to prevent accidental hoist/flatten
Focused test: `4. extend-selector.less`
Files changed: `packages/core/src/tree/util/extend-roots.ts`
Less fixtures (fail/pass/skip): 3 / 4 / 1
Core extend matrix (fail/pass/skip): 5 / 61 / 0 (extend-selector-algorithm only)
Delta vs previous: fixture 4 shape improved (nested block preserved), but `.attribute-test` still missing
Result: IMPROVED (partial)
Notes: no-op assignment guard retained; remaining failures unchanged at `2/4/5`.
Next step: diagnose why extender `.attributes .attribute-test` is not emitted for `[data="test3"]` replacement path.
