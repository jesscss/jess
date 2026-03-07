# Visitor Pattern Recommendations for Less.js Compatibility

## Summary

After analyzing the Jess visitor pattern and comparing it to Less.js, here are the key recommendations before implementing the Less compatibility plugin:

## ✅ Already Implemented

1. **Enhanced `accept()` method** - Now visits self first, then children recursively, matching Less.js pattern
2. **Visitor pattern is solid** - The current Jess visitor pattern is well-designed and TypeScript-friendly

## ⚠️ Considerations for Less.js Compatibility

### 1. **visitDeeper Flag Handling**

**Issue**: Less.js uses a shared `visitArgs` object with `visitDeeper` flag that persists across the visitor call. Jess uses a per-visit `ctx.visitDeeper` that's optional.

**Less.js Pattern:**
```javascript
const visitArgs = { visitDeeper: true }; // Shared object
visitRuleset(node, visitArgs) {
  visitArgs.visitDeeper = false; // Stops traversal
}
```

**Jess Pattern:**
```typescript
ruleset(node, ctx?: VisitorContext) {
  ctx.visitDeeper = false; // Stops traversal (if ctx provided)
}
```

**Recommendation**: 
- ✅ **Current approach is fine** - When converting Less nodes to Jess, we can create a `VisitorContext` and map `visitArgs.visitDeeper` to `ctx.visitDeeper`
- The Less visitor will set `visitArgs.visitDeeper = false` on the Less node, and we can detect this in our proxy
- Since we're using `enter()` hook, we don't need to worry about this too much - the Less visitor handles traversal via `accept()`

### 2. **isReplacing Mode**

**Issue**: Less.js has an `isReplacing` flag that changes behavior:
- `isReplacing: true` - Visitor return values replace nodes
- `isReplacing: false` - Visitor return values are ignored (visitor just visits)

**Current Plugin Approach:**
```typescript
enter: (node) => {
  const lessNode = toLessNode(node);
  const result = lessVisitor.visit(lessNode);
  if (result !== lessNode) {
    return fromLessNode(result); // Always replace if different
  }
  return node;
}
```

**Recommendation**: 
- ⚠️ **Consider detecting `isReplacing`** - We should check if the Less visitor has `isReplacing: false` and handle accordingly
- For now, the current approach (always replace if different) should work for most cases
- Can be enhanced later if we encounter plugins that rely on `isReplacing: false`

### 3. **visitArray() Method**

**Issue**: Less.js has a `visitArray()` method for visiting arrays of nodes. Some Less plugins might call this directly.

**Less.js Pattern:**
```javascript
visitor.visitArray(selectors, nonReplacing);
```

**Recommendation**: 
- ✅ **Handle in proxy** - When creating Less node proxies, we should intercept `visitArray` calls
- The proxy can convert the array, call the Less visitor's `visitArray`, and convert back
- This is important for plugins that manipulate selector lists, rule arrays, etc.

**Implementation:**
```typescript
// In proxy creation
if (prop === 'visitArray') {
  return function(nodes: any[], nonReplacing?: boolean) {
    // Convert array to Less format
    const lessNodes = nodes.map(n => toLessNode(n, options));
    // Call Less visitor's visitArray
    const result = lessVisitor.visitArray(lessNodes, nonReplacing);
    // Convert back if changed
    if (result !== lessNodes) {
      return result.map(n => fromLessNode(n, options));
    }
    return nodes;
  };
}
```

### 4. **Exit Methods Naming**

**Issue**: Less.js uses `visit${Type}Out` (e.g., `visitRulesetOut`), while Jess uses `${type}Exit` (e.g., `rulesetExit`).

**Recommendation**: 
- ✅ **Not a problem** - Since we're using `enter()` hook, we don't need to map exit methods
- The Less visitor's exit methods will be called automatically by Less's visitor system
- Our `enter()` hook handles the conversion, and Less handles the exit methods

### 5. **Node Replacement Edge Cases**

**Issue**: When a Less visitor returns a new node, we need to ensure:
1. The new node is properly converted back to Jess format
2. The parent-child relationships are maintained
3. The tree structure remains valid

**Recommendation**: 
- ✅ **Current approach handles this** - `fromLessNode()` should handle conversion
- ⚠️ **Test thoroughly** - Make sure parent references, source maps, and other metadata are preserved
- Consider adding validation to ensure converted nodes are valid Jess nodes

### 6. **Context Object Creation**

**Issue**: Less.js passes `visitArgs` to visitor methods, but Jess passes optional `VisitorContext`.

**Recommendation**: 
- ✅ **Handle in proxy** - When Less visitor methods are called, we can create a `visitArgs`-like object
- The Less visitor will modify `visitArgs.visitDeeper`, and we can track this
- Since we're using `accept()` pattern now, the Less visitor controls traversal via `accept()`, so `visitDeeper` is less critical

### 7. **Type-Specific Visitor Methods**

**Current Approach**: Using `enter()` hook for all nodes (simpler, works for all types)

**Alternative**: Implement type-specific methods (more explicit, better type safety)

**Recommendation**: 
- ✅ **Start with `enter()` hook** - Simpler, works for all node types
- ⚠️ **Consider type-specific methods later** - If we encounter issues with `enter()` approach, we can add type-specific mappings
- The `enter()` approach should work fine since Less visitors use `accept()` pattern

## 🎯 Final Recommendations

### Must-Have Before Implementation:

1. ✅ **Enhanced `accept()` method** - Already done!
2. ⚠️ **Handle `visitArray()` in proxies** - Important for plugins that manipulate arrays
3. ✅ **Node replacement handling** - Current approach should work

### Nice-to-Have (Can Add Later):

1. **Detect `isReplacing` mode** - Only needed if we encounter plugins that rely on it
2. **Type-specific visitor methods** - Only if `enter()` approach has issues
3. **Better `visitDeeper` tracking** - Less critical since we use `accept()` pattern

### Testing Priorities:

1. Test with plugins that use `visitArray()` (e.g., selector manipulation)
2. Test with plugins that replace nodes (e.g., autoprefixer, clean-css)
3. Test with plugins that set `visitDeeper = false` (e.g., import visitors)
4. Test node replacement edge cases (parent references, source maps)

## Conclusion

The visitor pattern is solid. The main considerations are:
1. **Handle `visitArray()`** - This is important for array-manipulating plugins
2. **Test thoroughly** - Node replacement and conversion need careful testing
3. **Start simple** - The `enter()` hook approach should work for most cases

The current implementation plan is good. The main enhancement would be to add `visitArray()` support in the proxy layer.

