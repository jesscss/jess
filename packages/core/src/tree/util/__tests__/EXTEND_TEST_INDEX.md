# Extend test index (core)

This doc exists to make **extend-related tests** easy to find (especially for LLM-assisted debugging).

## “Where are the extend tests?”

There are two main clusters:

### 1) Extend **integration** tests (eval → toString)
- `src/tree/__tests__/extend-eval-integration.test.ts`
  - High-level behavior checks across eval + serialization.
  - Includes the rule: **Exact extend matches a single OR-branch** (does not require all `:is(...)` branches).

### 2) Extend **utility / algorithm** tests
Located in `src/tree/util/__tests__/`:

- `extend-selector-algorithm.test.ts`
  - Core selector matching / replacement algorithm expectations.

- `find-extendable-locations.test.ts`
  - Direct unit coverage for `findExtendableLocations()` (the core matching/search API).

- `extend-ampersand.test.ts`
  - Ampersand-related extend behavior (non-boundary and basic cases).

- `extend-ampersand-boundary.test.ts`
  - Ampersand boundary-crossing scenarios (nested selector vs parent prefix).

- `extend-combinator-handling.test.ts`
  - Matching + extension behavior with combinators (` `, `>`, `+`, `~`, etc.).

- `extend-duplicate-validation.test.ts`
  - Ensures we don’t produce duplicate selector-list entries / validates dedupe rules.

- `extend-comment-handling.test.ts`
  - Ensures comments don’t break extension or comparison logic.

- `extend-simplified-cases.test.ts`
  - “Small, focused” cases to debug regressions quickly.

- `extend-where-selector.test.ts`
  - Specific matching/extension cases tied to “where selector” behavior.

- `process-extends.test.ts`
  - Tests orchestration / application ordering for registered extends.

## Extend evaluation / ruleset plumbing (non-util tests)

- `src/tree/__tests__/extend-rules.test.ts`
  - Extend behavior inside rulesets; includes chaining-related expectations.

- `src/tree/__tests__/extend-roots.test.ts`
  - Extend root registry / hoisting behavior.

- `src/tree/__tests__/extend-import-style.test.ts`
  - Extend interaction with import-style logic.

## What’s missing / where to add new coverage

If you are fixing a fixture like `tests-unit/extend-exact/extend-exact.less`, the most “direct” core place to add a reproduction is:

- `src/tree/__tests__/extend-eval-integration.test.ts` (if it’s an eval/print behavior)
- `src/tree/util/__tests__/find-extendable-locations.test.ts` (if it’s primarily a matcher problem)
- `src/tree/util/__tests__/extend-ampersand-boundary.test.ts` (if it’s specifically about implicit `&` / parent prefix crossings)

