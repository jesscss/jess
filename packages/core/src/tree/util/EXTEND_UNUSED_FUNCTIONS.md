# Unused Functions Analysis - extend.ts

## Analysis Method
Tracing call graph from exported/public functions down through all internal calls.

## Unused Functions Found

### 1. `handleCompoundFullExtend` (lines 1396-1469)
**Status**: UNUSED - Never called

**Definition**: Handles full extend for compound selectors containing `:is()` or pseudo-classes

**Why it exists**: Comment says "only for special cases like extending within :is() pseudo-selectors" but it's never actually called.

**Current usage**: None - only mentioned in a comment at line 1376

**Recommendation**: REMOVE - The logic it contains was likely replaced by the inline handling in `extendSelector` and `handleFullExtend`

---

### 2. `createValidatedIsWrapper` (lines 1517-1533)
**Status**: UNUSED - Only `createValidatedIsWrapperWithErrors` is used

**Definition**: Creates `:is()` wrapper with validation that returns fallback on conflicts

**Current usage**: None - only `createValidatedIsWrapperWithErrors` (which throws) is used throughout the codebase

**Recommendation**: REMOVE - Fallback behavior is not needed, errors are thrown instead

---

### 3. `createValidatedCompoundSelector` (lines 1972-1989)
**Status**: UNUSED - Only `createValidatedCompoundSelectorWithErrors` is used

**Definition**: Creates compound selector with validation that returns fallback on conflicts

**Current usage**: None - only `createValidatedCompoundSelectorWithErrors` (which throws) is used throughout the codebase

**Recommendation**: REMOVE - Fallback behavior is not needed, errors are thrown instead

---

### 4. `isValidCompoundSelector` (lines 1936-1969)
**Status**: USED - Called once in `validateCompoundSelector` (line 1955)

**Definition**: Validates that a compound selector doesn't have duplicate element or ID selectors

**Current usage**: Called recursively in `validateCompoundSelector` for nested compounds

**Recommendation**: KEEP - Actually used, though could potentially be merged into `validateCompoundSelector`

---

## Call Graph Analysis

### Entry Points (Exported Functions)
1. `tryExtendSelector` - calls `extendSelector`
2. `extendSelector` - main orchestrator
3. `findChainedExtends` - standalone utility
4. `applyExtensionAtLocation` - used by extendSelector and tests

### Functions Called from `extendSelector`
- `findExtendableLocations` (from find-extendable-locations.ts)
- `checkAmpersandCrossingDuringExtension`
- `handleAmpersandBoundaryCrossing`
- `detectAndHandleBoundaryCrossing`
- `extendSelectorList` (extracted)
- `selectBestLocation` (extracted)
- `handlePartialModeExtension`
- `handleFullExtend`
- `applyExtensionAtLocation`
- `createExtendedSelectorList`

### Functions NOT Called from Anywhere
- `handleCompoundFullExtend` ❌
- `createValidatedIsWrapper` ❌
- `createValidatedCompoundSelector` ❌

### Functions Only Called Internally (Used)
- `createSuccessResult` - called by `tryExtendSelector`
- `createErrorResult` - called by `tryExtendSelector`
- `deduplicateSelectors` - called by `createIsWrapper`, `createProcessedSelector`
- `createProcessedSelector` - called by `createExtendedSelectorList`, `flattenGeneratedIsInSelector`
- `createExtendedSelectorList` - called by many functions
- `detectAndHandleBoundaryCrossing` - called by `extendSelector`
- `createFlattenedBoundaryCrossingResult` - called by `detectAndHandleBoundaryCrossing`
- `getIsSelectorArg` - called by `handleCompoundFullExtend` (but that's unused!)
- `extendWithinIsArg` - called by `handleCompoundFullExtend` (but that's unused!)
- `flattenGeneratedIs` - called by `createIsWrapper`
- `flattenGeneratedIsInSelector` - called by `flattenGeneratedIs`, `createProcessedSelector`
- `extendSelectorList` - called by `extendSelector`
- `selectBestLocation` - called by `extendSelector`
- `handlePartialModeExtension` - called by `extendSelector`
- `handleFullExtend` - called by `extendSelector`
- `createIsWrapper` - called by `handlePartialModeExtension`, `handleCompoundFullExtend` (unused), `createValidatedIsWrapperWithErrors`
- `createValidatedIsWrapperWithErrors` - called by `extendSelector`, `handlePartialModeExtension`
- `validateIsWrapper` - called by `createValidatedIsWrapperWithErrors`
- `checkAmpersandCrossingDuringExtension` - called by `extendSelector`
- `findAmpersandsInSelector` - called by `checkAmpersandCrossingDuringExtension`
- `replaceAmpersandWithItsValue` - called by `checkAmpersandCrossingDuringExtension`, `handleAmpersandBoundaryCrossing`
- `replaceAmpersandWithEmpty` - called by `checkAmpersandCrossingDuringExtension`
- `handleAmpersandBoundaryCrossing` - called by `extendSelector`
- `findParentOfNode` - called by `replaceAmpersandWithItsValue`, `replaceAmpersandWithEmpty`
- `replaceNodeInParent` - called by `replaceAmpersandWithItsValue`
- `markSelectorForHoisting` - called by `handleAmpersandBoundaryCrossing`
- `optimizeUnnecessaryIsWrapper` - called by `flattenGeneratedIsInSelector`
- `isValidCompoundSelector` - called by `validateCompoundSelector`
- `createValidatedCompoundSelectorWithErrors` - called by `extendSelector`, `handlePartialModeExtension`, `handleCompoundFullExtend` (unused)
- `validateCompoundSelector` - called by `createValidatedCompoundSelectorWithErrors`
- `applyExtensionAtPath` - called by `applyExtensionAtLocation`
- `applyExtension` - called by `applyExtensionAtPath`

### Functions That Are Only Called by Unused Functions
- `getIsSelectorArg` - only called by `handleCompoundFullExtend` (unused)
- `extendWithinIsArg` - only called by `handleCompoundFullExtend` (unused)

**Note**: However, `extendWithinIsArg` might be used elsewhere. Let me check...

Actually, `extendWithinIsArg` is called by `handleCompoundFullExtend`, but `handleCompoundFullExtend` is never called. However, `extendWithinIsArg` might be needed for other cases. Let me verify if the logic in `handleCompoundFullExtend` is actually needed or if it's handled elsewhere.

Looking at the code, `handleCompoundFullExtend` was meant to handle compound selectors with `:is()` in full mode, but this is now handled inline in `extendSelector` at lines 1160-1203. So `handleCompoundFullExtend` and its dependencies (`getIsSelectorArg`, `extendWithinIsArg`) might all be unused.

Wait, let me check if `extendWithinIsArg` is used elsewhere...

Actually, `extendWithinIsArg` just calls `extendSelector` recursively, so it's a thin wrapper. If `handleCompoundFullExtend` is unused, then `extendWithinIsArg` might also be unused, but `getIsSelectorArg` is a utility that might be useful elsewhere.

Let me check if `getIsSelectorArg` is used anywhere else...
