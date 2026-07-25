# Function Registry Alignment Analysis

## Executive Summary

This analysis examines whether aligning Jess's `FunctionRegistry` structure with Less.js's `functionRegistry` API would improve compatibility with Less.js plugins. **Conclusion: Partial alignment would help, but a Proxy wrapper is still necessary for edge cases.**

## Current State

### Less.js Function Registry API

```javascript
{
  _data: {},                    // Internal storage (object)
  add(name, func),              // Add single function
  addMultiple(functions),       // Add multiple functions at once
  get(name),                    // Get function (with inheritance)
  getLocalFunctions(),          // Get local _data object
  inherit(),                    // Create child registry with inheritance
  create(base)                  // Factory method
}
```

**Key characteristics:**
- Object-based storage (`_data` object with function names as keys)
- Prototype-based inheritance (child registries inherit from parent via `base` parameter)
- Case-insensitive function names (converted to lowercase)
- Simple `get()` method that checks local first, then base

### Jess FunctionRegistry API

```typescript
class FunctionRegistry extends Registry<JsFunction, JsFunction> {
  index: Map<string, JsFunction>;  // Map-based storage
  add(item: JsFunction),          // Add to pending items
  indexPendingItems(),             // Index pending items by name
  find(name, filterType?, options?) // Find with parent search
}
```

**Key characteristics:**
- Map-based storage (`Map<string, JsFunction>`)
- Parent chain traversal (searches up Rules parent chain)
- No `addMultiple()` method
- No `get()` method (uses `find()` instead)
- No `inherit()` method
- No `getLocalFunctions()` method
- Case-sensitive (preserves original case)

## Compatibility Issues

### 1. **API Mismatch**
Less.js plugins expect:
- `functionRegistry.add(name, func)` - ❌ Jess has `add(item)` (different signature)
- `functionRegistry.addMultiple(functions)` - ❌ Not available
- `functionRegistry.get(name)` - ❌ Jess has `find(name, ...)` (different return type)
- `functionRegistry.inherit()` - ❌ Not available
- `functionRegistry.getLocalFunctions()` - ❌ Not available

### 2. **Storage Structure**
- Less.js: Object with function names as keys
- Jess: Map with function names as keys
- **Impact**: Low - both are key-value stores, but object access patterns differ

### 3. **Inheritance Model**
- Less.js: Prototype-based (child registry inherits from parent via `base` parameter)
- Jess: Parent chain traversal (searches up Rules parent chain)
- **Impact**: Medium - different lookup semantics, but both achieve similar goals

### 4. **Case Sensitivity**
- Less.js: Converts names to lowercase
- Jess: Preserves original case
- **Impact**: Low - can be handled in wrapper

## Alignment Opportunities

### Option 1: Add Less.js-Compatible Methods (Recommended)

Add wrapper methods to `FunctionRegistry` that match Less.js API while keeping existing Jess API:

```typescript
class FunctionRegistry extends Registry<JsFunction, JsFunction> {
  // Existing Jess API
  add(item: JsFunction): void { ... }
  find(name: string, ...): JsFunction | undefined { ... }
  
  // New Less.js-compatible API
  add(name: string, func: JsFunction): void {
    // Convert to JsFunction if needed, then call existing add()
  }
  
  addMultiple(functions: Record<string, JsFunction>): void {
    // Iterate and call add() for each
  }
  
  get(name: string): JsFunction | undefined {
    // Wrapper around find() that handles case-insensitivity
    return this.find(name.toLowerCase());
  }
  
  getLocalFunctions(): Record<string, JsFunction> {
    // Convert Map to object
    this.indexPendingItems();
    const result: Record<string, JsFunction> = {};
    for (const [name, func] of this.index.entries()) {
      result[name] = func;
    }
    return result;
  }
  
  inherit(): FunctionRegistry {
    // Create new registry that searches this one as parent
    // This is tricky - would need to modify find() to check parent registry
  }
}
```

**Pros:**
- ✅ Maintains backward compatibility with existing Jess code
- ✅ Allows direct use of Jess FunctionRegistry in mock (reduces Proxy complexity)
- ✅ Better type safety than Proxy
- ✅ Can leverage existing `find()` logic for `get()` and `inherit()`

**Cons:**
- ⚠️ `inherit()` is complex - Jess uses parent chain traversal, not prototype inheritance
- ⚠️ Need to handle case-insensitivity in `get()`
- ⚠️ `getLocalFunctions()` returns object, but Jess uses Map internally

### Option 2: Proxy Wrapper (Current Approach)

Keep current Proxy-based mock, but make it more complete:

```typescript
const functionRegistry = new Proxy({}, {
  get(target, prop) {
    if (prop === 'add') return (name, func) => { ... };
    if (prop === 'addMultiple') return (functions) => { ... };
    if (prop === 'get') return (name) => { ... };
    if (prop === 'inherit') return () => { ... };
    if (prop === 'getLocalFunctions') return () => { ... };
    // Handle 'Call' and other Less.js tree constructors
    if (prop === 'Call') return Less.tree.Call;
    return function() { return { value: null }; };
  }
});
```

**Pros:**
- ✅ No changes to core Jess FunctionRegistry
- ✅ Handles edge cases (like `Call` constructor access)
- ✅ Can intercept any property access

**Cons:**
- ⚠️ Less type-safe
- ⚠️ Runtime errors if plugin accesses unexpected properties
- ⚠️ Doesn't help if we want to use real Jess registry

### Option 3: Hybrid Approach (Best of Both)

Add Less.js-compatible methods to `FunctionRegistry`, but still use Proxy for edge cases:

```typescript
// In FunctionRegistry class
addLessCompatibleMethods() {
  // Add add(), addMultiple(), get(), inherit(), getLocalFunctions()
}

// In plugin.ts
const realRegistry = rules.functionRegistry;
const functionRegistry = new Proxy(realRegistry, {
  get(target, prop) {
    // Delegate to real registry methods first
    if (prop in target) return target[prop];
    // Handle Less.js-specific properties (Call, etc.)
    if (prop === 'Call') return Less.tree.Call;
    return function() { return { value: null }; };
  }
});
```

**Pros:**
- ✅ Best of both worlds - real registry with edge case handling
- ✅ Type-safe for common operations
- ✅ Handles unexpected property access gracefully

**Cons:**
- ⚠️ More complex implementation
- ⚠️ Still need Proxy for edge cases

## Recommendation

**Recommend Option 3 (Hybrid Approach)** with the following implementation plan:

1. **Add Less.js-compatible methods to `FunctionRegistry`:**
   - `add(name: string, func: JsFunction)` - wrapper around existing `add()`
   - `addMultiple(functions: Record<string, JsFunction>)` - batch add
   - `get(name: string)` - wrapper around `find()` with case-insensitivity
   - `getLocalFunctions()` - convert Map to object
   - `inherit()` - create new registry with parent reference (complex, may need design)

2. **Keep Proxy wrapper for edge cases:**
   - Handle Less.js tree constructors (`Call`, `Variable`, etc.)
   - Handle unexpected property access
   - Delegate to real registry methods when available

3. **Benefits:**
   - Real Jess function registry can be used (better integration)
   - Type-safe for common operations
   - Graceful handling of edge cases
   - Maintains backward compatibility

## Implementation Complexity

| Feature | Complexity | Notes |
|---------|-----------|-------|
| `add(name, func)` | Low | Simple wrapper |
| `addMultiple()` | Low | Iterate and call `add()` |
| `get(name)` | Medium | Need case-insensitivity, wrapper around `find()` |
| `getLocalFunctions()` | Low | Convert Map to object |
| `inherit()` | High | Requires redesigning inheritance model or creating adapter |

## Conclusion

**Yes, we should refine the registry-utils schema** to add Less.js-compatible methods. This would:
- Reduce Proxy complexity (only needed for edge cases)
- Enable use of real Jess registry in compatibility layer
- Improve type safety
- Maintain backward compatibility

However, **we still need a Proxy wrapper** for:
- Less.js tree constructors (`Call`, `Variable`, etc.) that plugins might access
- Unexpected property access that we can't anticipate

The `inherit()` method is the most complex addition and may require careful design to map Jess's parent chain traversal to Less.js's prototype inheritance model.
