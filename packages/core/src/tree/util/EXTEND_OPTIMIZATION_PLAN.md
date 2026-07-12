# Extend Optimization and Test Fix Plan

## Current Issues

### 1. Failing Tests Analysis

#### Test: `should extend with :is() selector - extract selectors from :is()`
- **Expected**: `.foo,.ext3,.ext4`
- **Received**: `.foo,:is(.ext3,.ext4)`
- **Issue**: When `extendWith` is a `:is()` selector, we should extract selectors from the `:is()` argument instead of nesting it
- **Location**: `createExtendedSelectorList` and places where we add `extendWith` to selector lists

#### Test: `should extend with :is() selector in partial mode`
- **Expected**: `.foo :is(.bar,.ext3,.ext4)`
- **Received**: `.foo :is(.bar,:is(.ext3,.ext4))`
- **Issue**: Same as above - nested `:is()` should be flattened

#### Test: `should extend complex partial match with compound boundaries - example 6`
- **Expected**: `.a>.b.c>.d.e,.a>.f`
- **Received**: `.a>.b.c.d.e,.a>.f`
- **Issue**: Missing `>` combinator between `.c` and `.d` - compound boundary not preserved correctly

#### Test: `should ignore self-referencing extends: .w:extend(.w)`
- **Error**: `TypeError: Cannot read properties of undefined (reading 'clone')`
- **Issue**: Self-referencing extend should be detected earlier and skipped, not cause errors

### 2. Traversal Optimization Opportunities

#### Current Multiple Passes

1. **`findExtendableLocations`** - Full recursive search for matches
2. **`checkAmpersandCrossingDuringExtension`**:
   - Calls `findAmpersandsInSelector` - another full traversal
   - For each ampersand, calls `findExtendableLocations` on resolved/empty versions - more traversals
3. **`createProcessedSelector`** - Another full traversal for normalization

#### Optimization: Unified Selector Analysis

Create a single function that traverses the selector tree once and gathers:
- **Extendable locations** (from `findExtendableLocations`)
- **Ampersand nodes** (from `findAmpersandsInSelector`)
- **Boundary information** (for compound selectors with `:is()`)
- **Any other metadata** needed

This would reduce:
- Multiple full tree traversals
- Redundant searches for the same selectors
- Memory allocations from repeated node iteration

## Implementation Plan

### Phase 1: Fix Failing Tests

1. **Fix `:is()` extraction in `extendWith`**
   - Create helper `extractSelectorsFromIs(selector: Selector): Selector[]`
   - When `extendWith` is a `:is()` selector, extract its argument selectors
   - Update `createExtendedSelectorList` to handle this
   - Update all places where we add `extendWith` to lists

2. **Fix compound boundary combinator preservation**
   - Review `handlePartialModeExtension` and compound selector handling
   - Ensure combinators between compound selectors are preserved
   - Test case: `.a>.b.c>.d.e` should maintain `>` between `.c` and `.d`

3. **Fix self-referencing extend**
   - Add early check in `extendSelector` or `tryExtendSelector`
   - Compare `target` and `find` for equality
   - Return original selector unchanged if they match

### Phase 2: Unified Traversal Optimization

1. **Create `analyzeSelectorForExtension` function**
   ```typescript
   interface SelectorAnalysis {
     extendableLocations: ExtendSearchResult;
     ampersandNodes: Array<{ ampersand: Ampersand }>;
     hasBoundaryCrossing: boolean;
     // ... other metadata
   }
   
   function analyzeSelectorForExtension(
     selector: Selector,
     find: Selector
   ): SelectorAnalysis {
     // Single traversal that gathers all needed information
   }
   ```

2. **Refactor `extendSelector` to use unified analysis**
   - Replace multiple separate calls with single `analyzeSelectorForExtension` call
   - Use cached results instead of re-searching

3. **Update ampersand checking**
   - Use ampersand nodes from unified analysis
   - Only do additional searches if boundary crossing is detected

## Benefits

1. **Fewer test failures** - Fixes 3-4 failing tests
2. **Better performance** - Single traversal instead of 3-5 traversals
3. **Cleaner code** - Centralized analysis logic
4. **Easier to maintain** - All selector analysis in one place

## Risks

1. **Breaking changes** - Need to ensure all edge cases still work
2. **Complexity** - Unified analysis function might be complex
3. **Testing** - Need comprehensive test coverage

## Next Steps

1. Start with Phase 1 (test fixes) - lower risk, immediate value
2. Then Phase 2 (optimization) - higher value but needs careful testing
3. Run full test suite after each change
