# Archived (2026-02-09)

Original path: `EXTEND_TEST_FIX_PLAN.md`

---

# Extend Test Fix Plan

## Issues Identified

### 1. Partial vs Exact Matching (`partial: false`)

**Rule**: When `partial: false`, we should ONLY transform if:
- The target matches the ENTIRE selector (e.g., `.a` matches `.a`)
- The target matches an ENTIRE item in a SelectorList (e.g., `.a` matches `.a` in `.a, .b`)
- The target matches an ENTIRE item in an `:is()` argument (e.g., `.a` matches `.a` in `:is(.a, .b)`)

**We should NOT transform if**:
- The target only matches PART of a compound selector (e.g., `.info` in `a.info`)
- The target only matches PART of a complex selector (e.g., `.aa` in `.aa .dd`)
- The target only matches PART of a compound within a complex selector (e.g., `.i` in `.i.j`)

### 2. Unnecessary `sel()` Wrappers

**Rule**: `sel()` is ONLY for complex selectors (with combinators). Use `compound()` for compound selectors (no combinators).

**Examples**:
- `sel([el('.a'), co('>'), el('.b')])` ✅ CORRECT (has combinator `>`)
- `sel([el('.a'), el('.b')])` ❌ WRONG (no combinator, should be `compound([el('.a'), el('.b')])`)

## Test Files to Review

1. `extend-selector-algorithm.test.ts` - Main test file
2. `extend-ampersand.test.ts`
3. `extend-combinator-handling.test.ts`
4. `extend-comment-handling.test.ts`
5. `extend-duplicate-validation.test.ts`
6. `extend-simplified-cases.test.ts`
7. `extend-where-selector.test.ts`
8. `find-extendable-locations.test.ts`

## Specific Issues Found

### `extend-selector-algorithm.test.ts`

#### Line 34-44: `should allow extending when there are no conflicts`
- **Selector**: `a.info` (compound selector)
- **Target**: `.info`
- **Partial**: `false`
- **Issue**: `.info` is only PART of `a.info`, so with `partial: false` this should NOT transform
- **Current expectation**: `a:is(.info,.foo)` ❌ WRONG
- **Should be**: Either throw error OR return original `a.info` unchanged

#### Line 46-57: `should prevent extending in :is() selectors with element conflicts`
- **Selector**: `:is(a).info` (compound selector)
- **Target**: `.info`
- **Partial**: `false`
- **Issue**: `.info` is only PART of `:is(a).info`, so with `partial: false` this should NOT transform
- **Current expectation**: `:is(a):is(.info,div.foo)` ❌ WRONG
- **Should be**: Either throw error OR return original `:is(a).info` unchanged

#### Line 193-209: `should extend .i in root-level SelectorList (.g, .i.j) the same as in :is(.g, .i.j)`
- **Selector**: `.g, .i.j` (SelectorList)
- **Target**: `.i`
- **Partial**: `false`
- **Issue**: `.i` is only PART of `.i.j`, so with `partial: false` this should NOT transform
- **Current expectation**: `.g,.i.j` ✅ CORRECT (no transform)
- **Status**: Test expectation is correct, but implementation is wrong (currently transforming)

## Action Plan

1. **Review ALL `partial: false` tests** across all 8 test files
2. **For each test**, determine if the target matches:
   - Entire selector/item → Should transform
   - Partial match → Should NOT transform (throw error or return unchanged)
3. **Fix incorrect expectations** in tests
4. **Fix unnecessary `sel()` wrappers** (replace with `compound()` when no combinators)
5. **Verify implementation** handles partial matches correctly with `partial: false`
6. **Run all tests** and verify fixes

## Next Steps

1. Systematically go through each test file
2. Document each problematic test
3. Fix all issues
4. Verify with test runs

