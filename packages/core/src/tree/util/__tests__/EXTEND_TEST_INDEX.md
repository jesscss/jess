# Extend test index (core)

This doc exists to make **extend-related tests** easy to find (especially for LLM-assisted debugging).

**Before changing extend logic:** See `../EXTEND_RULES.md` for the single set of rules and the header comments in `../extend.ts` for implementation context. Keep operational “what to run / where to look” guidance in Cursor-native files (e.g. `.cursor/rules/subtrees/core__extend.mdc`).\n+\n+Historical deep-dive audits and refactoring notes were archived/removed from this directory to reduce noise; use git history if you need them.

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
  - **Partial match wrap rule (EXTEND_RULES.md §3a):** "Partial match wrap rule" describe block — within-one-compound (wrap only matched part) vs spans-combinator (wrap full segment). Expectations document intended behavior.

- `find-extendable-locations.test.ts`
  - Direct unit coverage for `findExtendableLocations()` (the core matching/search API).

- `extend-ampersand.test.ts`
  - Ampersand-related extend behavior (non-boundary and basic cases).

- `extend-ampersand-boundary.test.ts`
  - Ampersand boundary-crossing scenarios (nested selector vs parent prefix).

- **Invisible (implicit) ampersand extend coverage** (in `extend-selector-algorithm.test.ts`, describe “Invisible ampersand extend coverage (partial, full, just outside)”):
  - **Partial:** Target has invisible &; find matches only the “own” part → extend without flattening & (within boundary).
  - **Full:** Target is SelectorList with invisible & on each item; find fully matches one item’s own part → intended: append extendWith with same & (three items).
  - **Just outside:** Find matches only own part (within boundary, & not flattened) vs find matches resolved form (boundary crossing).
  - **partial: false:** Invisible-ampersand target with find matching only own part → no extend (exact match required).

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

