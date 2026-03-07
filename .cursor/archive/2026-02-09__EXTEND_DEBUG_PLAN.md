# Archived (2026-02-09)

Original path: `.cursor/EXTEND_DEBUG_PLAN.md`

---

# Extend Debug Plan (all-less → core)

Iterative process to fix extend failures surfaced by `pnpm run test:less:test-data` (all-less).

## 1. Run the suite

From repo root:

```bash
pnpm run test:less:test-data
```

**Current extend-related failures (16 total failures, 6 extend fixtures):**

- `tests-unit/extend-chaining/extend-chaining.less`
- `tests-unit/extend-clearfix/extend-clearfix.less`
- `tests-unit/extend-exact/extend-exact.less`
- `tests-unit/extend-media/extend-media.less`
- `tests-unit/extend-nest/extend-nest.less`
- `tests-unit/extend-selector/extend-selector.less`

Other failures: at-rules, color-functions, container, css-3, css-escapes, css-guards, detached-rulesets (not necessarily extend).

## 2. Core extend tests – map and run

Extend tests live in:

- **Utility:** `packages/core/src/tree/util/__tests__/`  
  - extend-selector-algorithm, extend-ampersand, extend-ampersand-boundary, extend-combinator-handling, extend-duplicate-validation, extend-comment-handling, extend-simplified-cases, extend-where-selector, find-extendable-locations, process-extends
- **Integration:** `packages/core/src/tree/__tests__/`  
  - extend-eval-integration, extend-rules, extend-roots, extend-import-style

Run from **packages/core**:

```bash
cd packages/core && pnpm test -- --run src/tree/util/__tests__/extend src/tree/__tests__/extend
```

**Current core extend baseline:** 9 files passed, 3 failed → 4 failing tests:

| Test file | Failing case | Symptom |
|-----------|--------------|---------|
| extend-eval-integration.test.ts | "nested & extend all" | Expected `.header .header-nav, .footer .footer-nav` (flat); got nested `.header { .header-nav { ... } }` (same as extend-selector.less) |
| extend-rules.test.ts | "extend chaining > circular .x→.y→.z→.x" | Order wrong: expected `.z, .x, .y`; got `.x, .z, .y` |
| extend-selector-algorithm.test.ts | "deeply nested :is() should not create duplicate extensions" | Expected 1 occurrence of `.ext`; got 0 |

## 3. Narrow to one case (.only)

- In the relevant core test file, use `it.only()` or `describe.only()` for the failing (or added) case that matches the all-less fixture.
- Optionally run a single all-less file:  
  `pnpm test packages/jess/test/less/all-less.test.ts -- --test-file=".../extend-selector.less"`  
  (see packages/jess/test/less/README.md for exact path).

## 4. Log, diagnose, fix

- Use `syncLog()` only (no `console.log`), and no `JSON.stringify` on nodes (see project rules).
- Trace: extend root registration → `extendSelector` / `extendSelectorList` → matching and replacement.
- Fix in `packages/core/src/tree/util/extend.ts` (and related: extend-roots, extend-helpers, find-extendable-locations) until the focused test passes.

## 5. Remove .only and check regressions

- Remove all `.only`.
- Run full extend suite again:  
  `cd packages/core && pnpm test -- --run src/tree/util/__tests__/extend src/tree/__tests__/extend`
- If anything regresses: either revert the solution and try a different fix, or fix the regression and re-run until green.

## 6. Build core

```bash
pnpm --filter @jesscss/core build
```

## 7. Loop

- From repo root: `pnpm run test:less:test-data`.
- If new extend failure appears, go back to step 2 (map to core tests), then 3–6 for that case.
- Repeat until extend-related all-less tests pass (or we explicitly defer a fixture).

---

## Order of attack (suggested)

1. **extend-eval-integration "nested & extend all"** (and extend-selector.less `.footer .footer-nav` extend all) – same behavior: nested selector extending a parent’s full selector should produce flat comma list.
2. **extend-selector-algorithm "deeply nested :is()"** – duplicate/extension count.
3. **extend-rules "circular chaining"** – ordering of extended selectors.
4. Then re-run all-less and tackle remaining extend fixtures (extend-nest, extend-exact, extend-media, extend-clearfix, extend-chaining) one by one with the same flow.

