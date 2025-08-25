# Jess Less Test Suite

This directory contains all Less-specific tests for the Jess compiler.

## Test Files

### Core Feature Tests
- **`variables.test.ts`** - Variable declaration, usage, hoisting, scoping, and interpolation
- **`mixins.test.ts`** - Mixin definition, usage, parameters, guards, and pattern matching
- **`property-accessors.test.ts`** - Property accessor syntax (`@variable[property]`)
- **`operations.test.ts`** - Mathematical operations, arithmetic, and calculations
- **`functions.test.ts`** - Built-in Less functions (color, math, string, type functions)
- **`suite.test.ts`** - Comprehensive test suite covering all major Less features

### Legacy/Compatibility Tests
- **`less.ts`** - Tests against official Less test data for compatibility
- **`property-accessor.test.ts`** - Original property accessor test
- **`property-accessor-serialize.test.ts`** - AST serialization test for property accessors

## Running Less Tests

### Run All Less Tests
```bash
pnpm test less/
```

### Run Specific Less Test File
```bash
pnpm test less/variables.test.ts
pnpm test less/mixins.test.ts
pnpm test less/property-accessors.test.ts
pnpm test less/operations.test.ts
pnpm test less/functions.test.ts
pnpm test less/suite.test.ts
```

### Run Legacy Less Tests
```bash
pnpm test less/less.ts
```

## Test Categories

### 1. Variables (`variables.test.ts`)
- Basic variable declaration and usage
- Variable hoisting (using variables before declaration)
- Variable scoping (global vs local variables)
- Variable shadowing
- Variable interpolation in selectors, property names, and URLs
- Variable arithmetic and concatenation
- AST verification for variable nodes

### 2. Mixins (`mixins.test.ts`)
- Basic mixin definition and usage
- Mixins without parentheses
- Multiple mixin calls
- Mixin parameters (single, multiple, default values)
- Named parameters
- Mixin guards (`when` conditions)
- Pattern matching with guards
- Nested mixins
- `@arguments` variable
- AST verification for mixin nodes

### 3. Property Accessors (`property-accessors.test.ts`)
- Basic property accessor syntax
- Multiple properties
- Nested rulesets
- Variable keys
- Computed keys with interpolation
- Mixin return values
- Namespace access
- Edge cases and error handling
- AST verification for property accessor nodes

### 4. Operations (`operations.test.ts`)
- Basic arithmetic (addition, subtraction, multiplication, division)
- Operations with variables
- Complex operations with parentheses
- Color arithmetic
- Unit operations
- Mixed unit handling
- `calc()` function support
- Edge cases (zero, negative values)
- AST verification for operation nodes

### 5. Functions (`functions.test.ts`)
- Color functions (`lighten`, `darken`, `saturate`, `desaturate`, `fade`, `mix`)
- Math functions (`round`, `ceil`, `floor`, `percentage`)
- String functions (`escape`, `e`)
- List functions (`length`, `extract`)
- Type functions (`isnumber`, `isstring`, `iscolor`, `iskeyword`, `isurl`, `ispixel`, `isem`, `ispercentage`, `isunit`)
- Misc functions (`default`, `unit`, `getunit`)
- Functions with variables
- AST verification for function calls

### 6. Comprehensive Suite (`suite.test.ts`)
- Core language features (basic CSS, nested selectors, parent selector)
- Variable system (hoisting, scoping)
- Mixin system (basic, parameters)
- Property accessors
- Operations (arithmetic, variables)
- Functions (built-in)
- AST verification for complex code
- Error handling
- Performance testing

## Less-Specific Features

### Variable Interpolation
Less supports variable interpolation in selectors, property names, and URLs:
```less
@prefix: my;
.@{prefix}-class {
  @{property}: value;
  background: url('@{path}/image.jpg');
}
```

### Property Accessors
Less allows accessing properties from rulesets:
```less
.config() {
  primary: red;
  secondary: blue;
}
@theme: .config();
.test { color: @theme[primary]; }
```

### Mixin Guards
Less supports conditional mixin application:
```less
.mixin(@color) when (@color = red) {
  color: @color;
}
.mixin(@color) when (@color = blue) {
  color: @color;
}
```

### Color Operations
Less supports color arithmetic:
```less
@primary: #ff0000;
@secondary: #00ff00;
.test { color: @primary + @secondary; }
```

## Compatibility Testing

The `less.ts` file runs tests against the official Less test data to ensure Jess maintains compatibility with the standard Less language. This includes:

- Syntax compatibility
- Feature parity
- Edge case handling
- Error message consistency

## Debugging Less Tests

To debug failing Less tests:

1. **Check AST output** - Use `serializeTypes()` to inspect the generated AST
2. **Compare with Less** - Verify expected behavior against the official Less compiler
3. **Test isolation** - Create minimal test cases to reproduce issues
4. **Check variable hoisting** - Ensure variables are available when referenced
5. **Verify mixin resolution** - Check that mixins are found and applied correctly

## Future Enhancements

Planned Less test improvements:

- **Performance benchmarks** - Compare Jess performance with Less
- **Plugin compatibility** - Test Jess with Less plugins
- **Version compatibility** - Test against different Less versions
- **Real-world scenarios** - Test with actual Less projects
- **Error recovery** - Test compiler recovery from various error conditions
