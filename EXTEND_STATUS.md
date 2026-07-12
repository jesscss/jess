# Extend Implementation Status

## Current State

### 1. Where We Are

The extend functionality is largely implemented in `/packages/core/src/tree/util/extend.ts` with comprehensive test coverage in multiple test files:

- **Main implementation**: `extend.ts` (~1857 lines)
- **Test files**:
  - `extend-selector-algorithm.test.ts` - Core selector extension algorithm tests
  - `extend-rules.test.ts` - Ruleset-level extend tests
  - `extend-roots.test.ts` - Root-level extend tests
  - `extend-ampersand.test.ts` - Ampersand (&) handling
  - `extend-duplicate-validation.test.ts` - Validation for duplicate selectors
  - `extend-comment-handling.test.ts` - Comment preservation
  - `extend-where-selector.test.ts` - `:where()` pseudo-selector handling
  - `extend-simplified-cases.test.ts` - Simplified test cases
  - `extend-combinator-handling.test.ts` - Combinator handling

### 2. What We're Working On / Tests in Process of Fixing

#### A. Partial Match Tests (partial: false)

**Issue**: Several tests were expecting `.toThrow()` errors when `partial: false` and a partial match is found, but the implementation correctly returns the original selector unchanged.

**Status**: ✅ **FIXED** - Updated 4 tests in `extend-selector-algorithm.test.ts`:
- Line ~483: "should replicate the exact extend scenario from extend.less" - Test 1
- Line ~505: "should reject partial matches when partial: false"
- Line ~533: "should reject matching inside :is() when there are components before it with partial: false"
- Line ~547: "should reject matching complex selector inside :is() when there are components before it with partial: false"

**Remaining Work**: 
- Need to review ALL `partial: false` tests across ALL extend test files to ensure they don't expect transforms for partial matches
- User feedback: "Tons of your test expectations look wrong. I asked you to verify each one with me, and you did not, nor did you mark which ones i verified. That's on you. Mostly, you fucked up "exact" extends. In many cases, they should extend nothing, because they don't match a whole selector or a whole item in a selector list."

#### B. Unnecessary `sel()` Wrappers

**Issue**: Tests are using `sel([...])` (complex selector constructor) when there are no combinators, which should use `compound([...])` instead.

**Status**: 🔄 **IN PROGRESS** - Need to review all test cases

**User feedback**: "You have tons and tons of unnecessary wrappers. For instance, you seem to be wrapping almost every selector in a sel() even though that SPECIFICALLY is only meant to be used when there are combinators between selectors. (It's a complex selector function.)"

**Examples of incorrect usage**:
- `sel([el('.a')])` should be `el('.a')` (single element)
- `sel([el('.a'), el('.b')])` should be `compound([el('.a'), el('.b')])` (compound selector, no combinators)
- `sel([el('.a'), co(' '), el('.b')])` is CORRECT (has combinator)

#### C. Type Errors in Tests

**Status**: 🔄 **IN PROGRESS** - Currently fixing lint errors:
- Lines 202-203: PseudoSelector type checking
- Lines 375, 383, 386: SelectorList type assignments

### 3. Known Outstanding Issues

#### A. Test Expectation Verification

**Critical**: Many test expectations were LLM-generated and may be incorrect. The user explicitly requested:
- Mark verified test expectations with a special JSDOC comment
- Mark unverified tests as such
- This was NOT completed

**Files needing review**:
- `extend-rules.test.ts` - User mentioned some expectations may be wrong
- `extend-selector-algorithm.test.ts` - Many expectations need verification

#### B. Partial Match Logic

**Current Implementation** (lines 905-907 in `extend.ts`):
```typescript
// When partial: false, reject ALL partial matches - unified check before any special-casing
if (!partial && location.isPartialMatch) {
  return target;
}
```

**Key Principle**: When `partial: false` (exact match mode), partial matches should return the original selector unchanged, NOT throw an error.

**User Clarification**: 
- "whether .i.j is in a selector list, like .g, .i.j {} or the ONLY selector like .i.j {} does NOT FUCKING MATTER, in terms of whether or not we're partially matching or not... partial matches have to do with each ITEM in a selector list... the other items in the list are irrelevant."
- "if we're doing an exact match, and we only match .i within .i.j, IT IS REJECTED"

#### C. Self-Referencing Extends

**Status**: ✅ **IMPLEMENTED** - Self-referencing extends (`.w:extend(.w)`) are correctly ignored using selector comparison.

#### D. Recursion Prevention

**Status**: ✅ **IMPLEMENTED** - Uses `visited` set to prevent infinite recursion during extend chaining.

### 4. Specific Guidance

#### A. Test Review Process

1. **For each `partial: false` test**:
   - Determine if the match is partial or full
   - If partial: expect NO transform (original selector returned)
   - If full: expect transform
   - Mark verified tests with JSDOC: `/** @verified */`
   - Mark unverified tests with JSDOC: `/** @unverified - LLM-generated, needs review */`

2. **For `sel()` usage**:
   - Only use `sel([...])` when there are combinators between selectors
   - Use `compound([...])` for compound selectors (no combinators)
   - Use `el('.class')` for single element selectors

#### B. Key Behavioral Rules

1. **Full Mode (`partial: false`)**:
   - Creates selector lists for root-level full matches
   - Creates `:is()` wrappers for component matches in compound selectors
   - **Rejects ALL partial matches** - returns original selector unchanged

2. **Partial Mode (`partial: true`)**:
   - Creates `:is()` wrappers for component matches
   - Allows matching within compound selectors

3. **Boundary Crossing**:
   - When extend crosses `:is()` boundary, may require flattening
   - Special handling for compound selectors that match across boundaries

4. **Selector Lists vs `:is()` Arguments**:
   - Behavior should be unified - extending `.g, .i.j` should behave the same as `:is(.g, .i.j)`
   - User: "inside a selector list shouldn't matter, the behavior would be the same whether it was fucking in a selector list or not... stop special casing extend behavior based on what it's 'in'"

#### C. Code Patterns to Avoid

1. **Don't special-case based on context**:
   - ❌ "especially when inside a SelectorList"
   - ❌ "when inside :is()"
   - ✅ Unified logic that works the same regardless of context

2. **Don't use `sel()` unnecessarily**:
   - ❌ `sel([el('.a')])` 
   - ✅ `el('.a')`
   - ❌ `sel([el('.a'), el('.b')])`
   - ✅ `compound([el('.a'), el('.b')])`

3. **Don't expect errors for partial matches**:
   - ❌ `expect(() => extendSelector(...)).toThrow()`
   - ✅ `expect(result.valueOf()).toBe(original.valueOf())`

#### D. Testing Strategy

1. Run tests systematically:
   ```bash
   cd packages/core
   pnpm test extend-selector-algorithm.test
   pnpm test extend-rules.test
   # etc.
   ```

2. Focus on one test file at a time
3. Fix type errors first, then review expectations
4. Mark tests as verified/unverified as you go

### 5. Next Steps

1. ✅ Fix type errors in `extend-selector-algorithm.test.ts`
2. 🔄 Review and fix all `partial: false` test expectations across all test files
3. 🔄 Review and fix unnecessary `sel()` wrappers
4. 🔄 Mark all tests as verified/unverified with JSDOC comments
5. 🔄 Run full test suite and verify all fixes

### 6. Important Files

- **Implementation**: `/packages/core/src/tree/util/extend.ts`
- **Core test file**: `/packages/core/src/tree/util/__tests__/extend-selector-algorithm.test.ts`
- **Rules test file**: `/packages/core/src/tree/__tests__/extend-rules.test.ts`
- **Helper**: `/packages/core/src/tree/util/find-extendable-locations.ts` - Unified ExtendLocation API

### 7. User Feedback Summary

Key quotes from user feedback:
- "Tons of your test expectations look wrong... Mostly, you fucked up 'exact' extends."
- "You have tons and tons of unnecessary wrappers."
- "stop special casing extend behavior based on what it's 'in'"
- "whether .i.j is in a selector list... does NOT FUCKING MATTER"
- "extendWith should throw an exception if no matches found.... tryExtendWith returns unchanged"

### 8. Code Quality Notes

- The implementation uses a unified `ExtendLocation` API for all selector matching
- Recursion prevention is in place via `visited` set
- Self-referencing extends are correctly ignored
- Partial match rejection is unified at the top of `extendSelector` function

---

**Last Updated**: Current session
**Status**: Active work in progress - fixing test expectations and type errors
