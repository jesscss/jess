# Extend Tests Baseline

## Date
2025-01-XX (Before refactoring)

## Test Command
```bash
cd packages/core && pnpm test -- --run extend
```

## Baseline Results

### Summary
- **Test Files**: 7 failed | 5 passed (12 total)
- **Tests**: 10 failed | 148 passed (158 total)
- **Duration**: 659ms

### Failing Tests (10)

1. **src/tree/util/__tests__/process-extends.test.ts**
   - Entire test file failed

2. **src/tree/__tests__/extend-import-style.test.ts**
   - `compose type can be extended from parent when mutable`
   - `import with mutable: false cannot be extended - collects extendNotAccessible warning`

3. **src/tree/__tests__/extend-roots.test.ts**
   - `child compose root cannot extend parent (compose is a boundary) - extend throws error`
   - `children roots are accessible if mutable`

4. **src/tree/__tests__/extend-rules.test.ts**
   - `should ignore self-referencing extends: .w:extend(.w)`

5. **src/tree/util/__tests__/extend-duplicate-validation.test.ts**
   - `should allow duplicate same ID selectors for specificity (#foo#foo)`
   - `should allow extending #foo with #foo (same ID)`

6. **src/tree/util/__tests__/extend-selector-algorithm.test.ts**
   - `should extend complex partial match with compound boundaries - example 6`
   - Expected: `.a>.b.c>.d.e,.a>.f`
   - Received: Different output

7. **src/tree/util/__tests__/extend-simplified-cases.test.ts**
   - `should extend with :is() selector - extract selectors from :is()`
     - Expected: `.foo,.ext3,.ext4`
     - Received: `.foo,:is(.ext3,.ext4)`
   - `should extend with :is() selector in partial mode`
     - Expected: `.foo :is(.bar,.ext3,.ext4)`
     - Received: `.foo :is(.bar,:is(.ext3,.ext4))`

## Notes

- These failures appear to be pre-existing issues, not related to the refactoring
- The `.foo.foo` bug is not currently tested, so we need to add a test case for it
- Some failures are related to `:is()` flattening behavior
- Some failures are related to duplicate ID selector handling

## Next Steps

1. Document these baseline failures
2. Proceed with refactoring
3. Verify that refactoring doesn't introduce new failures
4. Fix the `.foo.foo` bug and add test case
5. Address any new failures introduced by refactoring
