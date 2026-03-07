# Jess Test Suite

This directory contains a comprehensive test suite for the Jess compiler, organized by language and feature.

## Test Organization

### Language-Specific Test Directories

- **`less/`** - All Less-specific tests and compatibility tests
  - See [Less Test Suite Documentation](./less/README.md) for detailed information

### Future Language Directories

- **`jess/`** - Jess language-specific tests (when implemented)
- **`scss/`** - SCSS/Sass tests (when implemented)
- **`stylus/`** - Stylus tests (when implemented)

### Core Test Files

- **`index.ts`** - Main test entry point
- **`files/`** - Test data files and fixtures

## Test Structure

Each language directory follows a consistent structure:

```
language/
├── README.md                    # Language-specific documentation
├── variables.test.ts           # Variable system tests
├── mixins.test.ts             # Mixin system tests
├── operations.test.ts         # Mathematical operations tests
├── functions.test.ts          # Built-in function tests
├── suite.test.ts              # Comprehensive test suite
└── compatibility.test.ts      # Compatibility with original language
```

## Running Tests

### Run All Tests
```bash
pnpm test
```

### Run Language-Specific Tests
```bash
# Run all Less tests
pnpm test less/

# Run specific Less test categories
pnpm test less/variables.test.ts
pnpm test less/mixins.test.ts
pnpm test less/operations.test.ts
pnpm test less/functions.test.ts
pnpm test less/suite.test.ts
```

### Run Tests with Coverage
```bash
pnpm test --coverage
```

## Test Categories

### 1. Variables
- Basic variable declaration and usage
- Variable hoisting (using variables before declaration)
- Variable scoping (global vs local variables)
- Variable shadowing
- Variable interpolation
- Variable arithmetic and concatenation
- AST verification for variable nodes

### 2. Mixins
- Basic mixin definition and usage
- Mixins without parentheses
- Multiple mixin calls
- Mixin parameters (single, multiple, default values)
- Named parameters
- Mixin guards and pattern matching
- Nested mixins
- AST verification for mixin nodes

### 3. Operations
- Basic arithmetic (addition, subtraction, multiplication, division)
- Operations with variables
- Complex operations with parentheses
- Color arithmetic
- Unit operations
- Mixed unit handling
- `calc()` function support
- Edge cases (zero, negative values)
- AST verification for operation nodes

### 4. Functions
- Color functions
- Math functions
- String functions
- List functions
- Type functions
- Misc functions
- Functions with variables
- AST verification for function calls

### 5. Comprehensive Suite
- Core language features
- Variable system
- Mixin system
- Operations
- Functions
- AST verification for complex code
- Error handling
- Performance testing

## AST Verification

Many tests include AST verification using `serializeTypes()` to ensure that:
- Correct node types are created
- Node relationships are properly established
- Variable references are correctly resolved
- Mixin calls generate appropriate AST structures

## Error Handling

Tests include error scenarios to ensure the compiler:
- Handles undefined variables gracefully
- Provides meaningful error messages
- Doesn't crash on invalid syntax
- Maintains consistency in error reporting

## Performance Considerations

The test suite includes performance tests to ensure:
- Large files are processed efficiently
- Memory usage remains reasonable
- Compilation time scales appropriately
- No memory leaks occur during processing

## Language-Specific Features

### Less
- Variable interpolation in selectors, property names, and URLs
- Property accessors (`@variable[property]`)
- Mixin guards (`when` conditions)
- Color arithmetic
- Nested rulesets

### Jess (Future)
- Jess-specific syntax and features
- Custom functions and operations
- Advanced type system
- Performance optimizations

## Contributing

When adding new tests:

1. **Organize by language** - Add tests to the appropriate language directory
2. **Organize by feature** - Add tests to the appropriate feature file
3. **Include AST verification** - Test both functionality and AST structure
4. **Add edge cases** - Test error conditions and boundary cases
5. **Update documentation** - Document new test categories or patterns
6. **Follow naming conventions** - Use descriptive test names that explain the scenario

## Test Data Sources

- **Official Language Test Data** - Used for compatibility testing
- **Custom Test Cases** - Created specifically for Jess features and edge cases
- **Real-world Scenarios** - Tests based on common usage patterns

## Debugging Tests

To debug failing tests:

1. **Check AST output** - Use `serializeTypes()` to inspect the generated AST
2. **Enable debug logging** - Add console.log statements to trace execution
3. **Compare with original** - Verify expected behavior against the original language compiler
4. **Isolate the issue** - Create minimal test cases to reproduce the problem

## Future Enhancements

Planned test improvements:

- **Integration tests** - Test Jess with real projects
- **Performance benchmarks** - Compare Jess performance with other compilers
- **Compatibility matrix** - Test against different language versions
- **Plugin testing** - Test Jess with various language plugins
- **Error recovery** - Test compiler recovery from various error conditions
- **Cross-language tests** - Test interoperability between different language features