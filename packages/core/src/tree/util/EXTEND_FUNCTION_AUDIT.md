# Extend Function Audit - Comprehensive Analysis

## Analysis Date
2025-01-XX

## Purpose
Deep analysis of all functions in `extend.ts` and `find-extendable-locations.ts` to:
1. Document each function's concerns and responsibilities
2. Identify overlapping concerns and duplicate code
3. Find opportunities to reduce passes and consolidate operations
4. Identify potential bug locations (especially `.foo.foo` partial match bug)
5. Identify unused functions through call graph analysis
6. Create recommendations for code improvements

## Unused Functions Identified and Removed

The following functions were identified as unused through call graph analysis and have been removed:

1. **`handleCompoundFullExtend`** - Never called, logic handled inline in `extendSelector`
2. **`createValidatedIsWrapper`** - Never called, only `createValidatedIsWrapperWithErrors` is used
3. **`createValidatedCompoundSelector`** - Never called, only `createValidatedCompoundSelectorWithErrors` is used
4. **`isValidCompoundSelector`** - Never called, `validateCompoundSelector` has its own implementation
5. **`getIsSelectorArg`** - Only called from unused `handleCompoundFullExtend`
6. **`extendWithinIsArg`** - Only called from unused `handleCompoundFullExtend`

**Total removed**: ~162 lines of unused code

---

## File: extend.ts

### Core Entry Points

#### `tryExtendSelector` (lines 694-711)
**Responsibilities:**
- Error handling wrapper around `extendSelector`
- Returns `ExtendResult` with optional error instead of throwing
- Catches `ExtendError` and wraps in result

**Calls:**
- `extendSelector()` - main extend logic
- `createSuccessResult()` - helper
- `createErrorResult()` - helper

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (delegates)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Pure wrapper function, no logic duplication.

---

#### `extendSelector` (lines 725-1151)
**Responsibilities:**
- Main extend orchestration function
- Handles both partial and full matching modes
- Routes to specialized handlers based on context
- Manages SelectorList targets (iterates and extends each)
- Handles ampersand boundary crossing
- Rejects partial matches in full mode
- Detects boundary-crossing matches in compound selectors
- Routes to `handlePartialModeExtension` or `handleFullExtend`

**Calls:**
- `findExtendableLocations()` - search for matches
- `checkAmpersandCrossingDuringExtension()` - ampersand boundary check
- `handleAmpersandBoundaryCrossing()` - ampersand handling
- `detectAndHandleBoundaryCrossing()` - compound boundary crossing
- `handlePartialModeExtension()` - partial mode logic
- `handleFullExtend()` - full mode logic
- `applyExtensionAtLocation()` - apply extension
- `createExtendedSelectorList()` - create result

**Concerns:**
- Finding: ✅ Yes (delegates to findExtendableLocations)
- Searching: ✅ Yes (delegates)
- Extending: ✅ Yes (orchestrates)
- Normalizing: ❌ No (delegates to createExtendedSelectorList)
- Selector Type: All types

**Potential Issues:**
- **`.foo.foo` BUG LOCATION**: When processing SelectorList targets (lines 770-827), it only processes the first match per selector. If `.foo.foo` has two `.foo` matches, only the first one gets extended.
- **Multiple passes**: Calls `findExtendableLocations` once, then potentially calls `extendSelector` recursively for each selector in a SelectorList
- **Location selection logic** (lines 833-903): Complex logic to pick the "best" location from multiple matches - may miss some matches

**Notes:** This is the main orchestrator. Very complex with many responsibilities. Could benefit from splitting into smaller functions.

---

### Normalization Functions

#### `deduplicateSelectors` (lines 182-195)
**Responsibilities:**
- Removes duplicate selectors from array using `valueOf()` comparison
- Uses Set for O(n) deduplication

**Calls:**
- None (pure function)

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ✅ Yes (deduplication)
- Selector Type: All types

**Notes:** Simple utility, no issues. Used in multiple places.

---

#### `createProcessedSelector` (lines 203-283)
**Responsibilities:**
- Single-pass normalization combining:
  1. Flattening generated `:is()` wrappers
  2. Deduplicating selectors
  3. Resolving/discarding ampersands
- Recursively processes nested structures
- Handles PseudoSelector, SelectorList, CompoundSelector, ComplexSelector, Ampersand

**Calls:**
- `createProcessedSelector()` - recursive calls
- `SelectorList.create()` - create selector lists
- `CompoundSelector.create()` - create compounds
- `ComplexSelector.create()` - create complex selectors

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ✅ Yes (comprehensive normalization)
- Selector Type: All types

**Notes:** This was recently consolidated from multiple separate passes. Good consolidation. However, it still makes recursive passes through the tree structure.

**Potential Issues:**
- Creates copies at line 219 (`el = el.copy()`) - may create multiple copies of the same node if called multiple times
- Recursive structure means multiple passes through nested selectors

---

#### `createExtendedSelectorList` (lines 293-296)
**Responsibilities:**
- Creates SelectorList with normalization applied
- Applies deduplication and flattening via `createProcessedSelector`
- Handles inheritance

**Calls:**
- `createProcessedSelector()` - normalization
- `SelectorList.create()` - create list
- `inherit()` - inheritance

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ✅ Yes (delegates)
- Selector Type: SelectorList

**Notes:** Thin wrapper, good abstraction.

---

### Boundary Crossing Functions

#### `detectAndHandleBoundaryCrossing` (lines 313-414)
**Responsibilities:**
- Detects when a compound selector find matches across an `:is()` boundary
- Example: `:is(.a, .b).c` matching `.b.c` should flatten
- Checks if match consumes entire target (if so, doesn't flatten)
- Returns flattened SelectorList or null

**Calls:**
- `findExtendableLocations()` - search inside `:is()` and after
- `createFlattenedBoundaryCrossingResult()` - create flattened result

**Concerns:**
- Finding: ✅ Yes (delegates)
- Searching: ✅ Yes (delegates)
- Extending: ❌ No (detection only)
- Normalizing: ❌ No
- Selector Type: CompoundSelector

**Notes:** Specialized function for boundary crossing. Good separation of concerns.

---

#### `createFlattenedBoundaryCrossingResult` (lines 426-445)
**Responsibilities:**
- Creates flattened selectors for boundary-crossing matches
- Combines each `:is()` alternative with components after it
- Adds extendWith + components after

**Calls:**
- `CompoundSelector.create()` - create compounds
- `createExtendedSelectorList()` - create result

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No (construction only)
- Normalizing: ❌ No (delegates to createExtendedSelectorList)
- Selector Type: CompoundSelector, SelectorList

**Notes:** Construction helper, no issues.

---

### Extension Application Functions

#### `handlePartialModeExtension` (lines 1156-1220)
**Responsibilities:**
- Handles extension in partial matching mode
- Creates `:is()` wrappers for component-level matches
- Handles compound selector partial matching
- Handles compound selector match within complex selector
- Handles compound selector matches within complex selectors (nested)

**Calls:**
- `createValidatedIsWrapperWithErrors()` - create `:is()` wrapper
- `createValidatedCompoundSelectorWithErrors()` - create compound
- `createIsWrapper()` - create wrapper
- `ComplexSelector.create()` - create complex
- `applyExtensionAtLocation()` - default case

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (applies extensions)
- Normalizing: ❌ No
- Selector Type: CompoundSelector, ComplexSelector

**Potential Issues:**
- **`.foo.foo` BUG LOCATION**: Only handles the first match location passed in. If multiple components match (like `.foo.foo`), only the first one gets wrapped in `:is()`.

**Notes:** Handles partial mode logic. Could be clearer about handling multiple matches.

---

#### `handleFullExtend` (lines 1230-1298)
**Responsibilities:**
- Handles full match extension (when `partial: false`)
- Adds extension as new alternative in selector list
- Handles SelectorList targets (adds to list)
- Handles PseudoSelector with selector arguments (extends inside)
- Handles CompoundSelector (creates selector list)
- Performance optimization: mutates generated selectors in place

**Calls:**
- `createExtendedSelectorList()` - create result
- `SelectorList.create()` - create lists
- `PseudoSelector.create()` - create pseudo-selectors

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (applies extensions)
- Normalizing: ❌ No (delegates)
- Selector Type: All types

**Notes:** Consolidates full extend logic. Good performance optimization for generated selectors.

---

#### `handleCompoundFullExtend` (lines 1308-1374)
**Responsibilities:**
- Handles full extend for compound selectors containing `:is()` or pseudo-classes
- Checks for boundary-crossing matches
- Single loop to handle both `:is()` extension and regular component matching
- Replaces matched components with `:is()` wrappers

**Calls:**
- `detectAndHandleBoundaryCrossing()` - boundary check
- `getIsSelectorArg()` - get `:is()` argument
- `findExtendableLocations()` - search
- `extendWithinIsArg()` - extend inside `:is()`
- `createIsWrapper()` - create wrapper
- `createValidatedCompoundSelectorWithErrors()` - create compound
- `createExtendedSelectorList()` - create result

**Concerns:**
- Finding: ✅ Yes (delegates)
- Searching: ✅ Yes (delegates)
- Extending: ✅ Yes (applies extensions)
- Normalizing: ❌ No
- Selector Type: CompoundSelector

**Potential Issues:**
- **`.foo.foo` BUG LOCATION**: Single loop (line 1324) processes components one at a time. If `.foo.foo` has two `.foo` components, it will only extend the first one it encounters.

**Notes:** Handles compound-specific full extend logic. Good consolidation of boundary crossing and `:is()` handling.

---

#### `applyExtensionAtLocation` (lines 1130-1136)
**Responsibilities:**
- Applies extension at a specific location within selector tree
- Delegates to `applyExtensionAtPath`

**Calls:**
- `applyExtensionAtPath()` - recursive application

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (applies)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Thin wrapper.

---

#### `applyExtensionAtPath` (lines 1141-1236)
**Responsibilities:**
- Recursively applies extension at a specific path
- Navigates through SelectorList, CompoundSelector, ComplexSelector, PseudoSelector
- Handles different extension types: replace, append, wrap

**Calls:**
- `applyExtension()` - actual extension logic
- `SelectorList.create()` - create lists
- `CompoundSelector.create()` - create compounds
- `ComplexSelector.create()` - create complex
- `PseudoSelector.create()` - create pseudo-selectors

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (applies)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Recursive path navigation. Handles all selector types.

---

#### `applyExtension` (lines 1241-1276)
**Responsibilities:**
- Applies the actual extension based on extension type
- `replace`: returns extendWith
- `append`: adds to SelectorList or creates new list
- `wrap`: creates `:is()` wrapper

**Calls:**
- `SelectorList.create()` - create lists
- `PseudoSelector.create()` - create `:is()` wrapper

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (applies)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Core extension logic. Simple switch statement.

---

### :is() Wrapper Functions

#### `createIsWrapper` (lines 1380-1398)
**Responsibilities:**
- Creates `:is()` wrapper around given selectors
- Preserves comments on original selectors
- Strips comments from inheritance chain
- Deduplicates and flattens before creating wrapper

**Calls:**
- `deduplicateSelectors()` - deduplication
- `flattenGeneratedIs()` - flattening
- `SelectorList.create()` - create list
- `PseudoSelector.create()` - create wrapper

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No (construction only)
- Normalizing: ✅ Yes (deduplication, flattening)
- Selector Type: All types

**Notes:** Multiple normalization passes here: deduplicate → flatten → deduplicate again. Could be consolidated.

---

#### `createValidatedIsWrapper` (lines 1409-1425)
**Responsibilities:**
- Creates `:is()` wrapper with validation that returns fallback on conflicts
- Catches errors and returns fallback instead of throwing

**Calls:**
- `createValidatedIsWrapperWithErrors()` - actual creation
- Returns fallback on error

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: PseudoSelector

**Notes:** Error-handling wrapper. Currently unused (only `createValidatedIsWrapperWithErrors` is used).

---

#### `createValidatedIsWrapperWithErrors` (lines 1436-1456)
**Responsibilities:**
- Creates `:is()` wrapper with validation that throws errors on conflicts
- Validates before creating wrapper

**Calls:**
- `validateIsWrapper()` - validation
- `createIsWrapper()` - actual creation

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: PseudoSelector

**Notes:** Validation wrapper. Used throughout codebase.

---

#### `validateIsWrapper` (lines 1461-1582)
**Responsibilities:**
- Validates `:is()` wrapper contents for conflicts
- Checks for multiple different element types (ELEMENT_CONFLICT)
- Checks for multiple different ID selectors (ID_CONFLICT)
- Context-aware: checks if `:is()` would conflict with compound selector context

**Calls:**
- None (pure validation)

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: PseudoSelector, CompoundSelector

**Notes:** Comprehensive validation. Good separation of concerns.

---

### Flattening Functions

#### `flattenGeneratedIs` (lines 494-540)
**Responsibilities:**
- Recursively flattens nested `:is()` wrappers that were generated
- Unwraps generated `:is()` pseudo-selectors and splices contents into parent
- Early bailout if no flattening needed

**Calls:**
- `flattenGeneratedIsInSelector()` - recursive processing

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ✅ Yes (flattening)
- Selector Type: All types

**Notes:** Good performance optimization with early bailout. However, makes separate pass through selectors.

---

#### `flattenGeneratedIsInSelector` (lines 546-681)
**Responsibilities:**
- Recursively flattens generated `:is()` wrappers within a single selector
- Handles PseudoSelector, SelectorList, CompoundSelector, ComplexSelector
- Preserves `:is()` wrappers that are components of compound selectors (doesn't unwrap them)
- Optimizes unnecessary standalone `:is()` wrappers

**Calls:**
- `optimizeUnnecessaryIsWrapper()` - optimization
- `flattenGeneratedIs()` - recursive flattening
- `SelectorList.create()` - create lists
- `CompoundSelector.create()` - create compounds
- `ComplexSelector.create()` - create complex
- `PseudoSelector` constructor - create pseudo-selectors

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ✅ Yes (flattening, optimization)
- Selector Type: All types

**Notes:** Complex recursive function. Handles many edge cases. Makes multiple passes through nested structures.

---

#### `optimizeUnnecessaryIsWrapper` (lines 1793-1821)
**Responsibilities:**
- Optimizes unnecessary standalone `:is()` wrappers
- Removes `:is()` when it wraps only one selector and was generated
- Example: `:is(.a)` → `.a` (when generated)
- Does NOT optimize `:is()` in compound selectors

**Calls:**
- None (pure optimization)

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ✅ Yes (optimization)
- Selector Type: PseudoSelector

**Notes:** Good optimization. Used in flattening pipeline.

---

### Ampersand Functions

#### `checkAmpersandCrossingDuringExtension` (lines 1593-1626)
**Responsibilities:**
- Checks if extending target would cross an ampersand boundary
- Finds ampersands in selector
- Checks if target matches resolved form but not unresolved form

**Calls:**
- `findAmpersandsInSelector()` - find ampersands
- `replaceAmpersandWithItsValue()` - create resolved version
- `replaceAmpersandWithEmpty()` - create unresolved version
- `findExtendableLocations()` - check matches

**Concerns:**
- Finding: ✅ Yes (delegates)
- Searching: ✅ Yes (delegates)
- Extending: ❌ No (detection only)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Specialized boundary detection. Good separation.

---

#### `findAmpersandsInSelector` (lines 1633-1644)
**Responsibilities:**
- Finds all ampersand nodes in a selector
- Uses `nodes()` iterator to traverse recursively

**Calls:**
- `selector.nodes()` - node iterator

**Concerns:**
- Finding: ✅ Yes (finds ampersands)
- Searching: ✅ Yes (traverses)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Simple traversal function.

---

#### `replaceAmpersandWithItsValue` (lines 1652-1674)
**Responsibilities:**
- Creates version of selector with ampersand replaced by its resolved value
- Finds and replaces ampersand node using helper functions

**Calls:**
- `selector.copy()` - copy selector
- `ampersand.value.selector.copy()` - copy resolved selector
- `selectorCopy.nodes()` - traverse
- `findParentOfNode()` - find parent
- `replaceNodeInParent()` - replace node

**Concerns:**
- Finding: ✅ Yes (finds ampersand)
- Searching: ✅ Yes (traverses)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Creates copies. May create multiple copies if called multiple times.

---

#### `replaceAmpersandWithEmpty` (lines 1682-1701)
**Responsibilities:**
- Creates version of selector with ampersand removed
- For boundary analysis

**Calls:**
- `selector.copy()` - copy selector
- `selectorCopy.nodes()` - traverse
- `findParentOfNode()` - find parent

**Concerns:**
- Finding: ✅ Yes (finds ampersand)
- Searching: ✅ Yes (traverses)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Creates copies.

---

#### `handleAmpersandBoundaryCrossing` (lines 1712-1731)
**Responsibilities:**
- Handles extension when it crosses an ampersand boundary
- Replaces ampersand with resolved selector
- Extends the resolved selector
- Marks for hoisting to root

**Calls:**
- `replaceAmpersandWithItsValue()` - replace ampersand
- `extendSelector()` - extend resolved selector
- `markSelectorForHoisting()` - mark for hoisting

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (delegates)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Specialized handler for ampersand boundary crossing.

---

#### `findParentOfNode` (lines 1739-1752)
**Responsibilities:**
- Finds the parent container of a specific node
- Searches through CompoundSelector, ComplexSelector, SelectorList, PseudoSelector

**Calls:**
- `root.nodes()` - traverse nodes

**Concerns:**
- Finding: ✅ Yes (finds parent)
- Searching: ✅ Yes (traverses)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Utility function for tree navigation.

---

#### `replaceNodeInParent` (lines 1760-1771)
**Responsibilities:**
- Replaces a node within its parent container
- Handles CompoundSelector, ComplexSelector, SelectorList, PseudoSelector

**Calls:**
- None (direct mutation)

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Utility function for tree mutation.

---

#### `markSelectorForHoisting` (lines 1778-1783)
**Responsibilities:**
- Marks a selector for hoisting to root
- Clones selector and sets `hoistToRoot` option

**Calls:**
- `selector.copy()` - copy selector

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Simple marker function.

---

### Compound Selector Functions

#### `getIsSelectorArg` (lines 453-462)
**Responsibilities:**
- Checks if component is `:is()` pseudo-selector with selector argument
- Returns SelectorList argument if valid, null otherwise

**Calls:**
- None (pure check)

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: PseudoSelector

**Notes:** Simple utility function.

---

#### `extendWithinIsArg` (lines 473-480)
**Responsibilities:**
- Extends within an `:is()` pseudo-selector argument recursively
- Delegates to `extendSelector` with appropriate flags

**Calls:**
- `extendSelector()` - recursive extend

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (delegates)
- Normalizing: ❌ No
- Selector Type: PseudoSelector

**Notes:** Thin wrapper for recursive extend.

---

#### `isValidCompoundSelector` (lines 1828-1854)
**Responsibilities:**
- Validates that a compound selector doesn't have duplicate element or ID selectors
- Recursively checks nested compounds

**Calls:**
- `isValidCompoundSelector()` - recursive check

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: CompoundSelector

**Notes:** Validation function. Currently unused (replaced by `validateCompoundSelector`).

---

#### `createValidatedCompoundSelector` (lines 1864-1879)
**Responsibilities:**
- Creates compound selector with validation that returns fallback on conflicts
- Catches errors and returns fallback instead of throwing

**Calls:**
- `createValidatedCompoundSelectorWithErrors()` - actual creation
- Returns fallback on error

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: CompoundSelector

**Notes:** Error-handling wrapper. Currently unused (only `createValidatedCompoundSelectorWithErrors` is used).

---

#### `createValidatedCompoundSelectorWithErrors` (lines 1889-1909)
**Responsibilities:**
- Creates compound selector with validation that throws errors on conflicts
- Validates before creating compound

**Calls:**
- `validateCompoundSelector()` - validation
- `CompoundSelector.create()` - create compound

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: CompoundSelector

**Notes:** Validation wrapper. Used throughout codebase.

---

#### `validateCompoundSelector` (lines 1914-1961)
**Responsibilities:**
- Validates compound selector components for conflicts
- Checks for multiple different element types (ELEMENT_CONFLICT)
- Checks for multiple different ID selectors (ID_CONFLICT)
- Recursively checks nested compounds

**Calls:**
- `validateCompoundSelector()` - recursive check

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: CompoundSelector

**Notes:** Comprehensive validation. Good separation of concerns.

---

### Chaining Functions

#### `findChainedExtends` (lines 1982-2035)
**Responsibilities:**
- Finds extends that should be processed next on a newly transformed selector
- Part of iterative extend process
- Checks if any selector in result matches other extend targets
- Only checks selectors that were in the original ruleset (not newly added ones)

**Calls:**
- None (pure analysis)

**Concerns:**
- Finding: ✅ Yes (finds chained extends)
- Searching: ✅ Yes (searches for matches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: SelectorList

**Notes:** Chaining logic. Good separation of concerns.

---

## File: find-extendable-locations.ts

### Core Entry Points

#### `findExtendableLocations` (lines 71-141)
**Responsibilities:**
- Main entry point for finding extendable locations
- Enhanced selector matching with 7-layer optimization system
- Recursively searches selector tree to find all locations where target appears
- Performance optimizations: exact match cache, KeySet fast rejection, fast path matching

**Calls:**
- `tryFastPathExtendMatch()` - fast path optimization
- `searchWithinSelector()` - full recursive search

**Concerns:**
- Finding: ✅ Yes (finds all locations)
- Searching: ✅ Yes (searches recursively)
- Extending: ❌ No (finding only)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Main search function. Good performance optimizations. Returns all matching locations, not just the first one.

**Potential Issues:**
- Returns multiple locations, but `extendSelector` may only use the first one in some cases
- Fast path may skip some matches in edge cases

---

### Fast Path Functions

#### `tryFastPathExtendMatch` (lines 148-321)
**Responsibilities:**
- Fast path extend matching for common patterns
- Handles: exact match, simple-to-simple, compound containing simple, small compound-to-compound, SelectorList in find, small SelectorList in target, complex selector patterns
- Comprehensive enough to skip slow path for most common cases

**Calls:**
- `trySmallCompoundExtendMatch()` - small compound matching
- `tryPartialComplexMatch()` - partial complex matching
- `tryBacktrackingComplexMatch()` - backtracking match
- `trySequentialComplexMatch()` - sequential complex matching
- `tryFastPathExtendMatch()` - recursive calls for SelectorList

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: All types

**Potential Issues:**
- **`.foo.foo` BUG LOCATION**: Fast path 3 (lines 191-219) handles compound containing simple target. It loops through `target.value` and finds matches, but only returns locations for matches found. If `.foo.foo` has two `.foo` components, it should find both, but the caller may only process the first one.

**Notes:** Comprehensive fast path. Good performance optimization.

---

#### `trySmallCompoundExtendMatch` (lines 414-465)
**Responsibilities:**
- Optimized compound selector matching for small compounds (≤4 components)
- Checks for exact equivalence (order-independent)
- Checks for subset matching (find is subset of target)
- Calculates remainders for partial matches

**Calls:**
- `areCompoundSelectorsEquivalent()` - equivalence check
- `CompoundSelector.create()` - create remainder compounds

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: CompoundSelector

**Potential Issues:**
- **`.foo.foo` BUG LOCATION**: When checking for subset matching (lines 429-461), it uses `find.value.every()` to check if all find components match. For `.foo.foo` matching `.foo`, it will find that `.foo` is a subset, but it only returns ONE location (the compound itself), not locations for each matching component.

**Notes:** Fast path for small compounds. Good optimization.

---

#### `tryPartialComplexMatch` (lines 326-409)
**Responsibilities:**
- Tries to match partial complex selectors
- Finds find pattern within target at different positions
- Calculates remainders (before and after match)
- Handles compound-to-simple partial matches

**Calls:**
- `componentsMatch()` - component matching
- `ComplexSelector.create()` - create remainder complex selectors

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: ComplexSelector

**Notes:** Partial complex matching. Good for performance.

---

#### `trySequentialComplexMatch` (lines 776-882)
**Responsibilities:**
- Tries sequential complex matching with partial compound support
- Finds contiguous subsequence match that preserves combinator structure
- Calculates remainders (before, after, and within compounds)
- Handles compound-to-simple partial matches within complex selectors

**Calls:**
- `areSelectorArgumentsEquivalent()` - selector equivalence
- `ComplexSelector.create()` - create remainder complex selectors
- `CompoundSelector.create()` - create remainder compounds

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: ComplexSelector

**Notes:** Sequential complex matching. Handles partial compound matches.

---

#### `tryBacktrackingComplexMatch` (lines 884-990)
**Responsibilities:**
- Add backtracking support for complex `:is()` scenarios
- Handles cases like `:is(.a > .b).d > .c` matching `.a > .b > .c`
- Preserves combinator sequences for correct matching
- Handles compound matching for backtracking

**Calls:**
- `componentsMatch()` - component matching
- `ComplexSelector.create()` - create remainder complex selectors
- `CompoundSelector.create()` - create remainder compounds

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: ComplexSelector

**Notes:** Backtracking match for `:is()` scenarios. Complex logic.

---

### Recursive Search Functions

#### `searchWithinSelector` (lines 478-505)
**Responsibilities:**
- Enhanced recursive search with specialized handlers for each selector type
- Routes to type-specific search functions
- Checks for exact match first

**Calls:**
- `searchWithinSelectorList()` - search in SelectorList
- `searchWithinCompoundSelector()` - search in CompoundSelector
- `searchWithinComplexSelector()` - search in ComplexSelector
- `searchWithinPseudoSelector()` - search in PseudoSelector

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches recursively)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Main recursive search router. Good separation by selector type.

---

#### `searchWithinSelectorList` (lines 510-519)
**Responsibilities:**
- Searches within a selector list
- Iterates through each selector and searches recursively

**Calls:**
- `searchWithinSelector()` - recursive search

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: SelectorList

**Notes:** Simple iteration. No issues.

---

#### `searchWithinCompoundSelector` (lines 524-610)
**Responsibilities:**
- Enhanced compound selector search with partial matching support
- Handles PseudoSelector targets (checks for equivalent matches)
- Standard recursive search through each component
- Checks for partial matches within compound selectors (simple target)
- Checks for compound-to-compound partial matching

**Calls:**
- `arePseudoSelectorsEquivalent()` - pseudo-selector equivalence
- `searchWithinSelector()` - recursive search
- `CompoundSelector.create()` - create remainder compounds

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: CompoundSelector

**Potential Issues:**
- **`.foo.foo` BUG LOCATION**: Lines 551-572 handle simple selector partial matching. It loops through `compound.value` and finds matches using `valueOf()` comparison. If `.foo.foo` has two `.foo` components, it will find both and add locations for both. However, the location path is `[...currentPath]` (the compound itself), not `[...currentPath, i]` (the specific component). This means both matches have the same path, and the caller may only process one.

**Notes:** Comprehensive compound search. Handles partial matches well, but path construction may be an issue for duplicate components.

---

#### `searchWithinComplexSelector` (lines 615-665)
**Responsibilities:**
- Enhanced complex selector search with combinator-aware optimizations
- Iterates through components (skipping combinators)
- Post-processes matches at position 0 to mark as partial if there are remainders
- Handles complex selector pattern matching
- Tries backtracking match for `:is()` scenarios

**Calls:**
- `searchWithinSelector()` - recursive search
- `tryComplexSelectorPatternMatch()` - pattern matching
- `tryBacktrackingComplexMatch()` - backtracking match
- `ComplexSelector.create()` - create remainder complex selectors

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: ComplexSelector

**Notes:** Comprehensive complex search. Good post-processing for partial matches.

---

#### `tryComplexSelectorPatternMatch` (lines 671-769)
**Responsibilities:**
- Attempts to find pattern matches within complex selectors
- Handles common CSS combinator patterns with optimized matching
- Tries to match target pattern at different positions within complex selector
- Handles compound-to-simple partial matches
- Calculates remainders (before and after match)

**Calls:**
- `componentsMatch()` - component matching
- `ComplexSelector.create()` - create remainder complex selectors
- `CompoundSelector.create()` - create remainder compounds

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: ComplexSelector

**Notes:** Pattern matching for complex selectors. Good optimization.

---

#### `searchWithinPseudoSelector` (lines 1060-1121)
**Responsibilities:**
- Enhanced pseudo-selector search with `:is()` backtracking optimization
- Special handling for `:is()` pseudo-selectors
- Checks if target matches any alternative in `:is()` selector list
- Recursive search within each alternative
- Checks if target could be added as new alternative

**Calls:**
- `isStructurallyEqual()` - structural equality
- `searchWithinSelector()` - recursive search

**Concerns:**
- Finding: ✅ Yes (finds matches)
- Searching: ✅ Yes (searches)
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: PseudoSelector

**Notes:** Specialized `:is()` handling. Good optimization.

---

### Application Functions

#### `applyExtensionAtLocation` (lines 1130-1136)
**Responsibilities:**
- Applies an extension at a specific location within a selector tree
- Delegates to `applyExtensionAtPath`

**Calls:**
- `applyExtensionAtPath()` - recursive application

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (applies)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Thin wrapper. Same as in extend.ts (duplicate?).

---

#### `applyExtensionAtPath` (lines 1141-1236)
**Responsibilities:**
- Recursively applies an extension at a specific path
- Navigates through SelectorList, CompoundSelector, ComplexSelector, PseudoSelector
- Handles different extension types: replace, append, wrap

**Calls:**
- `applyExtension()` - actual extension logic
- `SelectorList.create()` - create lists
- `CompoundSelector.create()` - create compounds
- `ComplexSelector.create()` - create complex
- `PseudoSelector.create()` - create pseudo-selectors

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (applies)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Same as in extend.ts (duplicate?).

---

#### `applyExtension` (lines 1241-1276)
**Responsibilities:**
- Applies the actual extension based on extension type
- `replace`: returns extendWith
- `append`: adds to SelectorList or creates new list
- `wrap`: creates `:is()` wrapper

**Calls:**
- `SelectorList.create()` - create lists
- `PseudoSelector.create()` - create `:is()` wrapper

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ✅ Yes (applies)
- Normalizing: ❌ No
- Selector Type: All types

**Notes:** Same as in extend.ts (duplicate?).

---

### Legacy Functions

#### `normalizeSelector` (lines 1001-1055)
**Responsibilities:**
- Normalizes a selector to handle `:is()` equivalences
- Single source of truth for `:is()` expansion logic
- Expands standalone `:is()` to selector list
- Expands complex selector with `:is()` to selector list
- Normalizes each selector in a selector list

**Calls:**
- `expandComplexSelectorWithIs()` - expand complex with `:is()`
- `normalizeSelector()` - recursive normalization
- `SelectorList.create()` - create lists

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ✅ Yes (normalization)
- Selector Type: All types

**Notes:** Legacy normalization. Used by `matchSelectors`.

---

#### `matchSelectors` (lines 1302-1344)
**Responsibilities:**
- Legacy matchSelectors function for backward compatibility
- Maps to the new `findExtendableLocations` API
- Normalizes selectors first
- Converts `ExtendSearchResult` to `MatchResult`

**Calls:**
- `normalizeSelector()` - normalization
- `findExtendableLocations()` - search

**Concerns:**
- Finding: ✅ Yes (delegates)
- Searching: ✅ Yes (delegates)
- Extending: ❌ No
- Normalizing: ✅ Yes (delegates)
- Selector Type: All types

**Notes:** Legacy compatibility layer. Good abstraction.

---

#### `combineKeys` (lines 1349-1367)
**Responsibilities:**
- Legacy combineKeys function for backward compatibility
- Combines two key sets (Set or string)

**Calls:**
- None (pure function)

**Concerns:**
- Finding: ❌ No
- Searching: ❌ No
- Extending: ❌ No
- Normalizing: ❌ No
- Selector Type: N/A

**Notes:** Legacy utility. Simple function.

---

## Key Findings

### 1. Overlapping Concerns and Duplicate Code

#### Duplicate Functions
- **`applyExtensionAtLocation`**, **`applyExtensionAtPath`**, **`applyExtension`**: These functions exist in BOTH `extend.ts` and `find-extendable-locations.ts` with identical implementations. This is clear duplication that should be consolidated.

#### Multiple Normalization Passes
- **`createIsWrapper`** (lines 1380-1398): Makes THREE passes:
  1. `deduplicateSelectors()` 
  2. `flattenGeneratedIs()`
  3. `deduplicateSelectors()` again
  
  This could be consolidated into a single pass in `createProcessedSelector`.

#### Similar Search Logic
- **`searchWithinCompoundSelector`** and **`trySmallCompoundExtendMatch`**: Both handle compound selector matching with similar logic. The fast path version is optimized for small compounds, but the logic is duplicated.

#### Similar Extension Logic
- **`handlePartialModeExtension`** and **`handleCompoundFullExtend`**: Both handle compound selector extensions, but with different modes. Some logic could be shared.

---

### 2. Multiple Passes Through Selectors

#### Normalization Passes
1. **`createProcessedSelector`**: Makes recursive passes through entire selector tree
2. **`flattenGeneratedIs`**: Makes separate pass to flatten `:is()` wrappers
3. **`deduplicateSelectors`**: Called multiple times in different contexts
4. **`createIsWrapper`**: Makes multiple normalization passes

**Opportunity**: Consolidate all normalization into a single pass in `createProcessedSelector`.

#### Search Passes
1. **`findExtendableLocations`**: Makes full recursive search
2. **`extendSelector`**: May call `findExtendableLocations` multiple times (for SelectorList targets, for ampersand checking, for boundary crossing)
3. **`handleCompoundFullExtend`**: Makes additional searches for `:is()` arguments

**Opportunity**: Cache search results to avoid re-searching the same selectors.

#### Extension Passes
1. **`extendSelector`**: Processes SelectorList by iterating and extending each selector
2. **`handlePartialModeExtension`**: Processes multiple component matches in complex selectors
3. **`createProcessedSelector`**: Makes another pass for normalization

**Opportunity**: Combine extension and normalization into fewer passes.

---

### 3. Node Copying Issues

#### Multiple Copies
- **`createProcessedSelector`** (line 219): Creates copy of each selector: `el = el.copy()`
- **`replaceAmpersandWithItsValue`** (line 1658): Creates copy of selector
- **`replaceAmpersandWithEmpty`** (line 1684): Creates copy of selector
- **`extendSelector`** (lines 804, 808, 813): Creates clones to avoid object reference issues
- **`markSelectorForHoisting`** (line 1780): Creates copy

**Issue**: The same node may be copied multiple times in a single extend operation, especially when processing SelectorList targets.

**Opportunity**: Use a copy-on-write strategy or track which nodes have been copied to avoid duplicate copies.

---

### 4. `.foo.foo` Bug Analysis

#### Bug Description
When a selector like `.foo.foo` is extended with a partial match targeting `.foo`, only the first `.foo` gets replaced, not both.

#### Potential Bug Locations

1. **`extendSelector`** (lines 770-827): When processing SelectorList targets, it only processes the first match per selector. If `.foo.foo` has two `.foo` matches, only the first one gets extended.

2. **`handlePartialModeExtension`** (lines 1156-1220): Only handles the first match location passed in. If multiple components match (like `.foo.foo`), only the first one gets wrapped in `:is()`.

3. **`handleCompoundFullExtend`** (line 1324): Single loop processes components one at a time. If `.foo.foo` has two `.foo` components, it will only extend the first one it encounters.

4. **`searchWithinCompoundSelector`** (lines 551-572): Finds matches for both `.foo` components, but the location path is `[...currentPath]` (the compound itself), not `[...currentPath, i]` (the specific component). This means both matches have the same path, and the caller may only process one.

5. **`tryFastPathExtendMatch`** (lines 191-219): Fast path 3 finds matches for both `.foo` components, but the caller may only process the first one.

6. **`trySmallCompoundExtendMatch`** (lines 429-461): When checking for subset matching, it only returns ONE location (the compound itself), not locations for each matching component.

#### Root Cause
The search functions (`findExtendableLocations`, `searchWithinCompoundSelector`, etc.) correctly find ALL matching locations, including multiple matches for the same component in a compound selector. However, the extension functions (`extendSelector`, `handlePartialModeExtension`, etc.) only process the FIRST location or the first match per selector.

#### Solution
The extension functions need to process ALL matching locations, not just the first one. For compound selectors with duplicate components, each matching component should get its own location with a unique path (e.g., `[0]` for first `.foo`, `[1]` for second `.foo`).

---

### 5. Function Responsibility Issues

#### Too Many Responsibilities
- **`extendSelector`**: Handles routing, SelectorList iteration, ampersand checking, boundary crossing, partial/full mode, location selection, and delegation to handlers. This function is doing too much.

#### Unclear Separation
- **`handlePartialModeExtension`** vs **`handleFullExtend`**: Both handle extensions but with different modes. The separation is clear, but some logic could be shared.

#### Mixed Concerns
- **`createIsWrapper`**: Handles both construction AND normalization (deduplication, flattening). Normalization should be separate.

---

## Recommendations

### High Priority

1. **Fix `.foo.foo` Bug**: 
   - Ensure `searchWithinCompoundSelector` creates unique paths for each matching component (e.g., `[0]` vs `[1]`)
   - Update `extendSelector` and `handlePartialModeExtension` to process ALL matching locations, not just the first one
   - Test with `.foo.foo` extending `.foo` to ensure both components get extended

2. **Consolidate Duplicate Functions**:
   - Remove duplicate `applyExtensionAtLocation`, `applyExtensionAtPath`, and `applyExtension` from `find-extendable-locations.ts`
   - Import from `extend.ts` instead

3. **Consolidate Normalization Passes**:
   - Move all normalization logic from `createIsWrapper` into `createProcessedSelector`
   - Ensure `createProcessedSelector` handles deduplication, flattening, and ampersand resolution in a single pass
   - Remove redundant `deduplicateSelectors` calls

### Medium Priority

4. **Reduce Node Copying**:
   - Implement copy-on-write strategy
   - Track which nodes have been copied to avoid duplicate copies
   - Only copy nodes when they're actually modified

5. **Cache Search Results**:
   - Cache `findExtendableLocations` results to avoid re-searching the same selectors
   - Especially important for SelectorList targets and ampersand checking

6. **Split `extendSelector`**:
   - Extract SelectorList handling into separate function
   - Extract location selection logic into separate function
   - Extract ampersand checking into separate function (already exists, but integrate better)
   - Make `extendSelector` a cleaner orchestrator

### Low Priority

7. **Share Logic Between Partial and Full Modes**:
   - Extract common extension logic from `handlePartialModeExtension` and `handleFullExtend`
   - Create shared helper functions for common patterns

8. **Optimize Fast Path**:
   - Ensure fast path handles `.foo.foo` cases correctly
   - Add fast path for duplicate component matching

9. **Remove Unused Functions**:
   - Remove `isValidCompoundSelector` (replaced by `validateCompoundSelector`)
   - Remove `createValidatedIsWrapper` and `createValidatedCompoundSelector` if fallback behavior is not needed

---

## Test Baseline

Before making changes, run all extend tests to establish a baseline:

```bash
cd packages/core && pnpm test -- --run extend
```

This will help identify any regressions introduced by refactoring.

---

## Next Steps

1. Run test baseline
2. Fix `.foo.foo` bug (highest priority)
3. Consolidate duplicate functions
4. Consolidate normalization passes
5. Reduce node copying
6. Cache search results
7. Split `extendSelector` for better maintainability
