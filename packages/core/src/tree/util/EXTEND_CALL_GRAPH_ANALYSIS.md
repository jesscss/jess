# Extend.ts Call Graph Analysis

## Analysis Method
Tracing all function calls from exported entry points through the entire call graph.

## Entry Points (Exported Functions)

1. `tryExtendSelector` (line 700)
2. `extendSelector` (line 731)
3. `findChainedExtends` (line 2090)
4. `applyExtensionAtLocation` (line 2152)

## Complete Call Graph

### From `tryExtendSelector`
- `extendSelector()` ✅
- `createSuccessResult()` ✅
- `createErrorResult()` ✅

### From `extendSelector`
- `findExtendableLocations()` ✅ (external)
- `checkAmpersandCrossingDuringExtension()` ✅
- `handleAmpersandBoundaryCrossing()` ✅
- `detectAndHandleBoundaryCrossing()` ✅
- `extendSelectorList()` ✅
- `selectBestLocation()` ✅
- `handlePartialModeExtension()` ✅
- `handleFullExtend()` ✅
- `applyExtensionAtLocation()` ✅
- `createExtendedSelectorList()` ✅

### From `extendSelectorList`
- `findExtendableLocations()` ✅ (external)
- `extendSelector()` ✅ (recursive)
- `createExtendedSelectorList()` ✅

### From `selectBestLocation`
- None (pure function)

### From `handlePartialModeExtension`
- `createValidatedIsWrapperWithErrors()` ✅
- `createValidatedCompoundSelectorWithErrors()` ✅
- `createIsWrapper()` ✅
- `ComplexSelector.create()` ✅
- `applyExtensionAtLocation()` ✅

### From `handleFullExtend`
- `createExtendedSelectorList()` ✅
- `SelectorList.create()` ✅
- `PseudoSelector.create()` ✅

### From `handleCompoundFullExtend`
- `detectAndHandleBoundaryCrossing()` ✅
- `getIsSelectorArg()` ✅
- `findExtendableLocations()` ✅ (external)
- `extendWithinIsArg()` ✅
- `createIsWrapper()` ✅
- `createValidatedCompoundSelectorWithErrors()` ✅
- `createExtendedSelectorList()` ✅

**BUT**: `handleCompoundFullExtend` itself is **NEVER CALLED** ❌

### From `createIsWrapper`
- `deduplicateSelectors()` ✅
- `SelectorList.create()` ✅
- `PseudoSelector.create()` ✅

### From `createValidatedIsWrapper`
- `createValidatedIsWrapperWithErrors()` ✅

**BUT**: `createValidatedIsWrapper` itself is **NEVER CALLED** ❌

### From `createValidatedIsWrapperWithErrors`
- `validateIsWrapper()` ✅
- `createIsWrapper()` ✅

### From `validateIsWrapper`
- None (pure validation)

### From `checkAmpersandCrossingDuringExtension`
- `findAmpersandsInSelector()` ✅
- `replaceAmpersandWithItsValue()` ✅
- `replaceAmpersandWithEmpty()` ✅
- `findExtendableLocations()` ✅ (external)

### From `findAmpersandsInSelector`
- `selector.nodes()` ✅ (method)

### From `replaceAmpersandWithItsValue`
- `selector.copy()` ✅ (method)
- `ampersand.getResolvedSelector()?.copy()` ✅ (method)
- `selectorCopy.nodes()` ✅ (method)
- `findParentOfNode()` ✅
- `replaceNodeInParent()` ✅

### From `replaceAmpersandWithEmpty`
- `selector.copy()` ✅ (method)
- `selectorCopy.nodes()` ✅ (method)
- `findParentOfNode()` ✅

### From `handleAmpersandBoundaryCrossing`
- `replaceAmpersandWithItsValue()` ✅
- `extendSelector()` ✅ (recursive)
- `markSelectorForHoisting()` ✅

### From `findParentOfNode`
- `root.nodes()` ✅ (method)

### From `replaceNodeInParent`
- None (direct mutation)

### From `markSelectorForHoisting`
- `selector.copy()` ✅ (method)

### From `detectAndHandleBoundaryCrossing`
- `findExtendableLocations()` ✅ (external)
- `createFlattenedBoundaryCrossingResult()` ✅

### From `createFlattenedBoundaryCrossingResult`
- `CompoundSelector.create()` ✅
- `createExtendedSelectorList()` ✅

### From `getIsSelectorArg`
- None (pure check)

**BUT**: Only called from `handleCompoundFullExtend` which is unused ❌

### From `extendWithinIsArg`
- `extendSelector()` ✅ (recursive)

**BUT**: Only called from `handleCompoundFullExtend` which is unused ❌

### From `flattenGeneratedIs`
- `flattenGeneratedIsInSelector()` ✅

### From `flattenGeneratedIsInSelector`
- `optimizeUnnecessaryIsWrapper()` ✅
- `flattenGeneratedIs()` ✅ (recursive)
- `SelectorList.create()` ✅
- `CompoundSelector.create()` ✅
- `ComplexSelector.create()` ✅
- `PseudoSelector` constructor ✅

### From `optimizeUnnecessaryIsWrapper`
- None (pure optimization)

### From `createProcessedSelector`
- `createProcessedSelector()` ✅ (recursive)
- `SelectorList.create()` ✅
- `CompoundSelector.create()` ✅
- `ComplexSelector.create()` ✅

### From `createExtendedSelectorList`
- `createProcessedSelector()` ✅
- `SelectorList.create()` ✅

### From `deduplicateSelectors`
- None (pure function)

### From `createValidatedCompoundSelector`
- `createValidatedCompoundSelectorWithErrors()` ✅

**BUT**: `createValidatedCompoundSelector` itself is **NEVER CALLED** ❌

### From `createValidatedCompoundSelectorWithErrors`
- `validateCompoundSelector()` ✅
- `CompoundSelector.create()` ✅

### From `validateCompoundSelector`
- `validateCompoundSelector()` ✅ (recursive)

### From `isValidCompoundSelector`
- `isValidCompoundSelector()` ✅ (recursive)

**Note**: `isValidCompoundSelector` is called from `validateCompoundSelector`... wait, let me check line 1955 again.

Actually, looking at the code:
- Line 1955: `isValidCompoundSelector` calls itself recursively
- But `validateCompoundSelector` does NOT call `isValidCompoundSelector`
- So `isValidCompoundSelector` is **UNUSED** ❌

### From `applyExtensionAtLocation`
- `applyExtensionAtPath()` ✅

### From `applyExtensionAtPath`
- `applyExtension()` ✅
- `SelectorList.create()` ✅
- `CompoundSelector.create()` ✅
- `ComplexSelector.create()` ✅
- `PseudoSelector.create()` ✅

### From `applyExtension`
- `SelectorList.create()` ✅
- `PseudoSelector.create()` ✅

## Unused Functions Summary

### Confirmed Unused (Never Called)

1. **`handleCompoundFullExtend`** (lines 1396-1477)
   - Never called from anywhere
   - Comment says it's for "special cases" but those cases are handled inline in `extendSelector`
   - **Recommendation**: REMOVE

2. **`createValidatedIsWrapper`** (lines 1517-1533)
   - Never called - only `createValidatedIsWrapperWithErrors` is used
   - **Recommendation**: REMOVE

3. **`createValidatedCompoundSelector`** (lines 1972-1989)
   - Never called - only `createValidatedCompoundSelectorWithErrors` is used
   - **Recommendation**: REMOVE

4. **`isValidCompoundSelector`** (lines 1936-1962)
   - Never called - `validateCompoundSelector` has its own implementation
   - **Recommendation**: REMOVE

### Functions Only Used by Unused Functions

5. **`getIsSelectorArg`** (lines 459-468)
   - Only called from `handleCompoundFullExtend` (unused)
   - **Recommendation**: REMOVE (unless needed elsewhere - check if it's a useful utility)

6. **`extendWithinIsArg`** (lines 479-486)
   - Only called from `handleCompoundFullExtend` (unused)
   - **Recommendation**: REMOVE (it's just a thin wrapper around `extendSelector`)

## Functions That ARE Used

- All other functions are part of the active call graph
- `validateCompoundSelector` is used (not `isValidCompoundSelector`)
- `createValidatedIsWrapperWithErrors` is used (not `createValidatedIsWrapper`)
- `createValidatedCompoundSelectorWithErrors` is used (not `createValidatedCompoundSelector`)

## Recommendation

Remove the following unused functions:
1. `handleCompoundFullExtend` (~82 lines)
2. `createValidatedIsWrapper` (~17 lines)
3. `createValidatedCompoundSelector` (~18 lines)
4. `isValidCompoundSelector` (~27 lines)
5. `getIsSelectorArg` (~10 lines) - unless it's a useful utility
6. `extendWithinIsArg` (~8 lines)

**Total lines to remove**: ~162 lines
