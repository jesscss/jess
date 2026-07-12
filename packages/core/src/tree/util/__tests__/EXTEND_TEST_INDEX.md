# Extend test index (core)

This doc exists to make **extend-related tests** easy to find (especially for LLM-assisted debugging).

**Before changing extend logic:** See `../EXTEND_RULES.md` for the single set of rules and the header comments in `../extend.ts` for implementation context. Keep operational “what to run / where to look” guidance in Cursor-native files (e.g. `.cursor/rules/subtrees/core__extend.mdc`).

Historical deep-dive audits and refactoring notes were archived/removed from this directory to reduce noise; use git history if you need them.

## “Where are the extend tests?”

There are two main clusters:

### 1) Extend **integration** tests (eval → toString)
- `src/tree/__tests__/extend-eval-integration.test.ts`
  - High-level behavior checks across eval + serialization.
  - Includes the rule: **Exact extend matches a single OR-branch** (does not require all `:is(...)` branches).

### 2) Extend **utility / algorithm** tests
Located in `src/tree/util/__tests__/`:

- `extend-core-unit.test.ts`
  - Main focused unit suite for the rebuilt `tryExtendSelector()` path in `extend-core.ts`.
  - This is the current source of truth for exact vs partial rewriting, ampersand crossing/hoisting, and seam-aware rewrite behavior.

- `selector-match-unit.test.ts`
  - Main focused unit suite for `selectorMatch()` in `selector-match-core.ts`.
  - This is the current source of truth for selector comparison/matching semantics, alternates, pseudo boundaries, and ampersand crossing detection.

- `extend-comment-handling.test.ts`
  - Legacy-but-still-distinct coverage for comment preservation/duplication behavior.

- `extend-ampersand-boundary.test.ts`
  - Legacy boundary-oriented tests that still exercise nested/ruleset-level ampersand behavior.

- `process-extends.test.ts`
  - Tests orchestration / application ordering for registered extends.

- `extend-pipeline-bench.test.ts`
  - Bench coverage, not a primary behavior suite.

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
- `src/tree/util/__tests__/selector-match-unit.test.ts` (if it’s primarily a matcher problem)
- `src/tree/util/__tests__/extend-core-unit.test.ts` (if it’s primarily a rewrite problem)
- `src/tree/util/__tests__/extend-ampersand-boundary.test.ts` (if it’s specifically about implicit `&` / parent prefix crossings)
