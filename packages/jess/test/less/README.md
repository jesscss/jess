# Less Tests

This directory contains tests for Less functionality, organized with clear separation of concerns.

## Test Organization

### 1. Custom Tests (Our Own Tests)
Located in individual `.test.ts` files, these are our own test cases for specific Less features:

- **`variables.test.ts`** - Variable declarations and usage
- **`mixins.test.ts`** - Mixins and mixin patterns  
- **`nesting.test.ts`** - Nesting and parent selectors
- **`operations.test.ts`** - Math and color operations
- **`colors.test.ts`** - Color functions and formats
- **`functions.test.ts`** - Built-in functions and utilities
- **`selectors.test.ts`** - Selectors and property interpolation
- **`import-url.test.ts`** - Import functionality
- **`token-debug.test.ts`** - Debug and token testing
- **`all-less.test.ts`** - Main test runner for test-data files
- **`suite.test.ts`** - Test suite configuration

### 2. Test-Data Tests (Comprehensive Less Test Suite)
The `@less/test-data` package contains 70+ comprehensive test directories covering all Less features.

## Usage

### Run Custom Tests by Feature
```bash
# Run all custom tests
pnpm test:less:custom

# Run specific test files
pnpm test packages/jess/test/less/variables.test.ts
pnpm test packages/jess/test/less/mixins.test.ts
pnpm test packages/jess/test/less/nesting.test.ts
pnpm test packages/jess/test/less/operations.test.ts
pnpm test packages/jess/test/less/colors.test.ts
pnpm test packages/jess/test/less/functions.test.ts
pnpm test packages/jess/test/less/property-accessors.test.ts
pnpm test packages/jess/test/less/import-url.test.ts
pnpm test packages/jess/test/less/token-debug.test.ts

# Run specific test files by feature
pnpm test packages/jess/test/less/variables.test.ts
pnpm test packages/jess/test/less/mixins.test.ts
pnpm test packages/jess/test/less/operations.test.ts
pnpm test packages/jess/test/less/functions.test.ts
pnpm test packages/jess/test/less/property-accessors.test.ts
```

### Run Test-Data Tests
```bash
# Run all test-data tests
pnpm test:less:test-data

# Run specific test-data files
pnpm test packages/jess/test/less/all-less.test.ts -- --test-file="node_modules/@less/test-data/tests-unit/variables/variables.less"
pnpm test packages/jess/test/less/all-less.test.ts -- --test-file="node_modules/@less/test-data/tests-unit/mixins/mixins.less"

# Run test-data with specific patterns
pnpm test packages/jess/test/less/all-less.test.ts -- --test-pattern="variables"
pnpm test packages/jess/test/less/all-less.test.ts -- --test-pattern="mixins"
```

### Direct Vitest Commands
```bash
# Run specific test file
pnpm test packages/jess/test/less/variables.test.ts

# Run all custom tests
pnpm test packages/jess/test/less/*.test.ts

# Run test-data files
pnpm test packages/jess/test/less/all-less.test.ts

# Run with Vitest options
pnpm test packages/jess/test/less --reporter=verbose
pnpm test packages/jess/test/less --run
```

## Feature Categories

### Custom Tests
- **variables**: Variable declarations, interpolation, scope
- **mixins**: Mixins, parameters, patterns, guards
- **nesting**: Nesting, parent selector (`&`)
- **operations**: Math operations, color operations
- **colors**: Color functions, formats
- **functions**: Built-in functions, utilities
- **selectors**: Selectors, property interpolation
- **imports**: Import functionality
- **debug**: Debug and token testing

### Test-Data Tests
- **variables**: Variable declarations, interpolation, scope (2 dirs)
- **mixins**: Mixins, parameters, patterns, guards (10 dirs)
- **nesting**: Nesting, parent selector, scope (2 dirs)
- **operations**: Math operations, color operations (2 dirs)
- **colors**: Color functions, formats, operations (1 dir)
- **functions**: Built-in functions, each, extract/length (3 dirs)
- **extend**: Extend, extend all, chaining (7 dirs)
- **imports**: Import types, reference imports, remote imports (9 dirs)
- **selectors**: Selectors, property interpolation, CSS features (11 dirs)
- **strings**: String operations, whitespace (2 dirs)
- **advanced**: Advanced features (detached rulesets, lazy eval, merge, media) (8 dirs)
- **edge-cases**: Edge cases and error handling (5 dirs)

## Benefits

1. **Clear Separation**: Custom tests vs comprehensive test-data tests
2. **Feature-Focused**: Test specific features in isolation
3. **No Duplication**: Each test file has a specific purpose
4. **Flexible**: Run custom tests, test-data, or both
5. **Maintainable**: Easy to add new tests to appropriate files
6. **Comprehensive**: Includes both our tests and the extensive test-data suite

## Workflow

1. **Development**: Use custom tests for quick feedback
2. **Feature Testing**: Use test-data tests for comprehensive coverage
3. **CI/CD**: Run both custom and test-data tests
4. **Debugging**: Run specific feature categories to isolate issues
