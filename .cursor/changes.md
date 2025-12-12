# Daily Changes & Improvements

This file is updated daily with the most recent changes and improvements made to the codebase.

**Note**: Most recent changes are always at the top. Add new entries with the current date (e.g., `## 2025-Dec-9`) at the top of this file. Make sure we query a live date service to get current date.


## 2025-Dec-11

- More mixin debugging. I think my plan now for handling recursion is this:

1. When a call node starts evaluation, add the call's sourceNode to call stack (in context).
2. When a reference starts / ends, add to reference stack (in context).
3. When a mixin match is found, evaluate it.
4. If the call with the same sourceNode is called (with same stringified params?), detect a recursion and throw an error.
5. Error is bubbled up to mixin rules evaluation, and that is removed as a candidate.
6. In the case of static rules / ruleset, mark the current frames. If the last frame of the candidate matches the current frame stack, remove as a candidate.

So that we don't error too early, we might need to parse differently, because the call has to know if rules are going to be just used for lookup,
or if rules are going to be a target for the next reference. Maybe we can do this with the call stack? Or maybe actually in the rules.ts. It's adding the rules as a child of another rules that's the only problem... but by then, its
too late, because the mixin will have returned multiple matches potentially...

So maybe all we can do is the error thrown at the call level.

## 2025-Dec-10

### Mixin Lookup Debugging

- **Fixed Set destructuring issue**: Discovered that Sets can be destructured directly in JavaScript (no need for `Array.from()`). Reverted unnecessary conversion in `_indexSelectorStart`.
- **Added debug logging**: Added extensive debug logging to trace mixin registration and lookup:
  - `MixinRegistry.find`: Logs what keys are being looked up, what's in the registry, and traversal through parent chain
  - `Reference.evalNode`: Logs mixin-ruleset lookups and results
  - `getFunctionFromMixins`: Logs when parent is set on Rules returned from mixin calls
- **Identified parent chain issue**: Discovered that Rules returned from mixin calls need to have their parent set to the original mixin definition context (not the calling context) for lookups to work correctly. In Less, mixins resolve lookups from the mixin definition context, not the caller context.
- **Fixed parent preservation**: Modified `getFunctionFromMixins` to:
  - Set `newRules.parent` to the original mixin's Rules parent (where the mixin was defined)
  - Store `_originalParent` flag to identify mixin results
  - Skip `adopt()` call for mixin results in `applyResult` to preserve the parent chain
  - Added fallback to use `candidate.rulesParent` if direct parent lookup fails
- **Created mixin lookup scope test**: Created `mixin-lookup-scope.test.ts` to test Less behavior for variable and mixin lookups from mixin definition vs caller context (for future reference).

### Current Issue

- **Parent chain not working in all cases**: Some lookups still show `rulesIndex=undefined` with no parent, preventing traversal to find mixins. The parent IS being set correctly in `getFunctionFromMixins` (confirmed via debug logs showing `rulesIndex=0`), but some Rules instances used for lookups don't have their parent set or it's being lost somewhere in the evaluation chain.
- **Next steps**: Need to investigate why some Rules instances lose their parent - possibly during `rules.eval()` or when Rules are returned from mixin function calls and integrated into the parent Rules.

## 2025-Dec-9

### New extend syntax

- Resolved to use `$extend ns|.selector`. ChatGPT convinced me. Default value is `all`. We can do Less's default behavior (exact) with something like `$extend .selector !exact`
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

