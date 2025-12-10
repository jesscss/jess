# Daily Changes & Improvements

This file is updated daily with the most recent changes and improvements made to the codebase.

**Note**: Most recent changes are always at the top. Add new entries with the current date (e.g., `## 2025-Dec-9`) at the top of this file. Make sure we query a live date service to get current date.


## 2025-Dec-9

### New extend syntax

- Resolved to use `@-extend ns|.selector`. ChatGPT convinced me. Default value is all. We can do Less's default behavior (exact) with something like `@-extend-match`
- `@-compose` is protected from extends by default, unless we add `(mutable)`
- Add `@-export` instead of `@forward`, to export / include everything but not make the API / vars locally available.


### Extend Processing Fixes
- **Fixed extend processing logic in `rules.ts`**: Corrected the order of parameters when calling `tryExtendSelector`. The extend was finding the wrong ruleset - it should find rulesets matching the selector that has the extend (e.g., `.child`), not the target (e.g., `.base`).
- **Created `rules-extend.test.ts`**: Comprehensive test suite for extend functionality within a single file, covering:
  - Basic extend
  - Multiple extends
  - Partial extend (all flag)
  - Complex selectors (compound, pseudo-classes)
- **Fixed cloning/registration issue**: Modified `import-style.ts` to clone Rules before evaluation instead of after, ensuring registries are populated on the cloned Rules. This fixes extend lookup issues when using cached evaluated Rules.

### Ruleset Registration Improvements
- **Fixed `_hasStaticName` for Ruleset nodes**: Now correctly identifies ruleset selectors as static after `preEval`, even if the ruleset node itself is dynamic.
- **Fixed `context.treeRoot` restoration**: Preserves `context.treeRoot` when `saved.treeRoot` is `undefined`, preventing extends from being lost during context restoration.

### Ongoing Work
- Debugging extend across import boundaries - specifically the "sibling import" test case where extends need to find rulesets from imported files.

