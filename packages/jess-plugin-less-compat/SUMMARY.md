# Less.js Compatibility Plugin - Implementation Summary

## Overview

This package provides a **bidirectional transformation layer** between Jess AST nodes and Less.js AST nodes, enabling Less.js plugins and visitors to work seamlessly with Jess-compiled stylesheets.

## Key Design Decisions

### 1. Proxy-Based Lazy Conversion

Instead of eagerly converting entire trees, we use JavaScript Proxies to:
- **Lazily convert** nodes only when accessed
- **Cache conversions** to avoid repeated work
- **Intercept property access** to map between Jess and Less property names
- **Handle method calls** like `accept()` for visitor traversal

### 2. Bidirectional Transformation

- **Jess → Less**: Convert Jess nodes to Less-compatible proxies for visitor processing
- **Less → Jess**: Convert Less nodes back to Jess format when visitors return new nodes

### 3. Plugin Architecture

The plugin integrates with Jess's plugin system via the `visitor` property, allowing Less.js visitors to be applied during compilation.

## Implementation Status

### ✅ Completed
- [x] Package structure and configuration
- [x] Type definitions and interfaces
- [x] Type mapping utilities
- [x] Plugin skeleton
- [x] Test structure

### 🚧 In Progress
- [ ] Proxy implementation
- [ ] Node transformers (all types)
- [ ] Visitor adapter
- [ ] Integration tests

### 📋 Planned
- [ ] Performance optimization
- [ ] Comprehensive test coverage
- [ ] Documentation
- [ ] Example plugins

## Next Steps

### Phase 1: Core Proxy Implementation

1. **Implement `createLessProxy`** in `src/transform/proxy.ts`
   - Create Proxy handler with `get` trap
   - Map property names (e.g., `selectors` → `selector`)
   - Handle child node conversion
   - Cache results

2. **Implement `toLessNode`** in `src/transform/to-less.ts`
   - Use proxy for lazy conversion
   - Handle type mapping
   - Support caching

### Phase 2: Node Transformers

Start with high-priority nodes:
1. **Ruleset** - Most common, complex structure
2. **Selector** - Complex hierarchical flattening
3. **Declaration** - Simple property mapping
4. **Reference** - Complex (Variable/Property/VariableCall split)

Then implement remaining nodes in order of complexity.

### Phase 3: Reverse Conversion

1. **Implement `fromLessNode`** in `src/transform/from-less.ts`
   - Reverse property mapping
   - Reconstruct Jess structure
   - Handle visitor-returned nodes

### Phase 4: Testing

1. **Unit tests** for each node type
2. **Integration tests** with real Less plugins
3. **Edge case testing**
4. **Performance testing**

## Key Challenges

### 1. Structural Differences

**Problem**: Jess and Less have different AST structures
- Jess: `{ value: { selector, rules } }`
- Less: `{ selectors: [], rules: [] }`

**Solution**: Proxy intercepts property access and maps between structures

### 2. Type System Differences

**Problem**: Jess has unified `Reference`, Less has separate `Variable`/`Property`/`VariableCall`

**Solution**: Check `options.type` on `Reference` to determine Less node type

### 3. Selector Hierarchy

**Problem**: Jess has hierarchical selectors, Less has flat arrays

**Solution**: Flatten hierarchy during conversion, reconstruct during reverse conversion

### 4. Visitor Return Values

**Problem**: Less visitors can return new nodes that need conversion back to Jess

**Solution**: Detect when visitor returns different node, convert back using `fromLessNode`

## Testing Strategy

### Unit Tests
- Each node type transformation (Jess → Less)
- Each node type transformation (Less → Jess)
- Property mapping correctness
- Edge cases (Nil, empty arrays, etc.)

### Integration Tests
- `less-plugin-autoprefix` - Vendor prefixing
- `less-plugin-clean-css` - Minification
- `less-plugin-dls` - Design system support

### Test Coverage Goals
- 100% coverage for node transformers
- 90%+ coverage for transformation utilities
- Integration tests for all supported plugins

## Performance Considerations

1. **Lazy Conversion**: Only convert when accessed
2. **Caching**: Use WeakMap to cache conversions
3. **Proxy Overhead**: Minimize proxy traps, cache property lookups
4. **Memory**: Use WeakMap to allow garbage collection

## Usage Example

```typescript
import { Compiler } from '@jesscss/jess';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import autoprefix from 'less-plugin-autoprefix';

const compiler = new Compiler({
  plugins: [
    lessPlugin(),
    lessCompatPlugin({
      visitors: [autoprefix]
    })
  ]
});

const result = await compiler.compile('styles.less');
```

## Files Created

### Core Files
- `package.json` - Package configuration
- `tsconfig.json` - TypeScript configuration
- `README.md` - User-facing documentation
- `IMPLEMENTATION_PLAN.md` - Detailed implementation plan
- `SUMMARY.md` - This file

### Source Files
- `src/index.ts` - Main export
- `src/plugin.ts` - Plugin implementation
- `src/types.ts` - Type definitions
- `src/transform/index.ts` - Transformation API
- `src/transform/to-less.ts` - Jess → Less conversion
- `src/transform/from-less.ts` - Less → Jess conversion
- `src/transform/proxy.ts` - Proxy implementation
- `src/transform/type-map.ts` - Type mapping utilities

### Test Files
- `test/integration/less-plugin-autoprefix.test.ts`
- `test/integration/less-plugin-clean-css.test.ts`
- `test/unit/transform/to-less.test.ts`
- `test/unit/transform/proxy.test.ts`

## Dependencies

- `@jesscss/core` - Core Jess types and utilities
- `less` - Less.js for type definitions and runtime

### Dev Dependencies
- `less-plugin-dls` - For integration testing
- `less-plugin-clean-css` - For integration testing
- `less-plugin-autoprefix` - For integration testing

## Questions & Answers

**Q: Why use proxies instead of eager conversion?**
A: Proxies allow lazy conversion, which is more efficient. We only convert nodes when they're actually accessed by Less visitors.

**Q: How do we handle Less visitors that modify nodes?**
A: When a Less visitor returns a new node, we detect the change and convert it back to Jess format using `fromLessNode`.

**Q: What about performance?**
A: We use WeakMap caching to avoid repeated conversions. The proxy overhead is minimal compared to the benefits of lazy conversion.

**Q: Can this work with any Less plugin?**
A: In theory, yes. In practice, plugins that heavily rely on Less-specific internals may need additional support. We'll test with the most common plugins first.

## Resources

- [Less.js Plugin Documentation](http://lesscss.org/usage/#plugins)
- [Less.js Visitor Pattern](https://github.com/less/less.js/blob/master/packages/less/src/less/visitors/visitor.js)
- [JavaScript Proxies](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
- [Jess Plugin System](../core/src/plugin.ts)
