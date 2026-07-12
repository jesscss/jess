# Development Plan

## Current Status

### Recently Completed
- ✅ Fixed extend processing logic in `rules.ts` - corrected the order of parameters in `tryExtendSelector` call
- ✅ Created comprehensive `rules-extend.test.ts` with tests for:
  - Basic extend within same file
  - Multiple extends
  - Partial extend (all flag)
  - Complex selectors (compound, pseudo-classes)
- ✅ Fixed cloning/registration issue in `import-style.ts` - now clones before evaluation so registries are populated correctly
- ✅ Fixed `_hasStaticName` for Ruleset nodes to check selector static status after preEval
- ✅ Fixed `context.treeRoot` restoration to preserve it when `saved.treeRoot` is undefined
- ✅ Fixed recursion protection for mixin calls using `context.searchScope`
- ✅ Fixed mixin parameter handling - parameters now get negative indices and are properly registered
- ✅ Added rest parameter support for mixins with auto-generated names
- ✅ Fixed `_indexSelectorStart` bug where `keySet` (a Set) was being incorrectly destructured

### In Progress
- 🔄 Debugging mixin lookup failures in `tests-unit/mixins/mixins.less`
  - **Issue**: `ReferenceError: ".mixin" is not defined` - mixin lookups failing from within mixin call results
  - **Root cause identified**: Rules returned from mixin calls need parent set to original mixin definition context (not caller context) for lookups to traverse correctly
  - **Current state**: 
    - Parent IS being set correctly in `getFunctionFromMixins` (confirmed via debug logs: `rulesIndex=0`)
    - We skip `adopt()` for mixin results to preserve parent chain
    - Some lookups still show `rulesIndex=undefined` with no parent - parent chain broken in some cases
  - **Next steps**:
    1. Investigate why some Rules instances lose their parent during evaluation
    2. Check if `rules.eval()` preserves parent or creates new instances
    3. Verify parent is preserved when Rules are returned from mixin function and integrated into parent Rules
    4. Consider if we need to set parent at a different point in the evaluation chain

### Next Steps
1. **Fix mixin lookup parent chain issue** - ensure all Rules returned from mixin calls have correct parent set
2. Verify `tests-unit/mixins/mixins.less` test passes
3. Remove debug logging from production code (currently extensive logging in `MixinRegistry.find`, `Reference.evalNode`, `getFunctionFromMixins`)
4. Clean up temporary `_originalParent` flag mechanism
5. Review and test mixin lookup scope behavior (definition context vs caller context) - may need to support both

### Known Issues
- Some Rules instances from mixin calls don't have parent set, breaking lookup traversal
- Parent chain works in some cases (`rulesIndex=70` → `rulesIndex=0`) but not others (`rulesIndex=undefined`)
- Need to understand when/why parent is lost during Rules evaluation or integration

