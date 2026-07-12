# Jess Visitor Pattern Analysis

## Overview

This document analyzes the Jess visitor pattern, compares it to common visitor patterns (including Less.js), and identifies any non-standard aspects or potential improvements.

## Jess Visitor Pattern

### Structure

1. **Interface-Based**: Uses a TypeScript interface with optional methods
   ```typescript
   export interface Visitor {
     enter?(n?: tree.Node): void | typeof ABORT;
     exit?(val?: NodeVisitReturn): NodeVisitReturn;
     ruleset?(n: tree.Ruleset, ctx?: VisitorContext): VisitorReturn;
     rulesetExit?(n: tree.Ruleset, ctx?: VisitorContext): void;
     // ... one method per node type
   }
   ```

2. **Method Naming**: Uses camelCase matching node type names
   - `ruleset()` for `Ruleset` nodes
   - `atRule()` for `AtRule` nodes
   - `selectorList()` for `SelectorList` nodes

3. **Abstract Base Class**: Provides method lookup and traversal logic
   ```typescript
   export abstract class Visitor {
     visit(n: Node): Node {
       // Calls enter(), then type-specific method, then exit()
     }
   }
   ```

4. **TreeVisitor**: Auto-traverses tree, handles child visitation
   ```typescript
   export abstract class TreeVisitor extends Visitor {
     visitChildren: 'before' | 'after' = 'after';
     // Automatically visits children
   }
   ```

### Key Features

- **Enter/Exit Hooks**: `enter()` and `exit()` for global hooks
- **Type-Specific Methods**: Optional methods per node type
- **Exit Methods**: `*Exit()` methods called after visiting a node
- **Context Object**: Optional `VisitorContext` with `visitDeeper` flag
- **Return Values**: Can return `Node`, `ABORT`, `REMOVE`, `SKIP` symbols
- **Method Lookup**: Uses lowercase-first conversion (`Ruleset` → `ruleset`)

## Comparison to Common Patterns

### 1. Classic Visitor Pattern (Gang of Four)

**Standard Pattern:**
```typescript
interface Visitor {
  visitConcreteElementA(element: ConcreteElementA): void;
  visitConcreteElementB(element: ConcreteElementB): void;
}

interface Element {
  accept(visitor: Visitor): void;
}
```

**Jess Approach:**
- ✅ Similar structure (visitor has methods per type)
- ❌ No `accept()` method on nodes (visitor calls nodes directly)
- ✅ Type-safe with TypeScript interfaces
- ✅ More flexible (optional methods)

**Verdict**: **Good** - More flexible than classic pattern, but less explicit

### 2. Less.js Visitor Pattern

**Less.js Approach:**
```javascript
class Visitor {
  visit(node) {
    const fnName = `visit${node.type}`;
    const func = impl[fnName] || _noop;
    // ...
  }
}

// Usage:
{
  visitRuleset(node, visitArgs) { ... },
  visitRulesetOut(node) { ... }
}
```

**Differences:**
- Less: `visit${Type}` naming (e.g., `visitRuleset`)
- Jess: `type()` naming (e.g., `ruleset`)
- Less: Uses `accept()` method on nodes (double dispatch)
- Jess: Visitor directly calls nodes
- Less: `visitArgs.visitDeeper` controls traversal
- Jess: `ctx.visitDeeper` controls traversal
- Less: `isReplacing` flag for replacement mode
- Jess: Return new node to replace

**Verdict**: **Different but equivalent** - Both work, Jess is more TypeScript-friendly

### 3. PostCSS Visitor Pattern

**PostCSS Approach:**
```javascript
root.walk((node) => {
  if (node.type === 'rule') {
    // handle rule
  }
});
```

**Differences:**
- PostCSS: Callback-based, single method
- Jess: Method-per-type, more structured
- PostCSS: Manual type checking
- Jess: Automatic method dispatch

**Verdict**: **Jess is better** - More type-safe and structured

### 4. Babel Visitor Pattern

**Babel Approach:**
```javascript
const visitor = {
  Identifier(path) { ... },
  enter(path) { ... },
  exit(path) { ... }
};
```

**Similarities:**
- ✅ Both use `enter`/`exit` hooks
- ✅ Both use method-per-type
- ✅ Both support optional methods

**Differences:**
- Babel: Uses `Path` objects (wrapper around nodes)
- Jess: Uses nodes directly
- Babel: Method names match AST node types exactly
- Jess: Uses lowercase-first conversion

**Verdict**: **Similar** - Both are good patterns

## Potential Issues / Non-Standard Aspects

### 1. **Method Name Conversion (lowercase-first)**

**Issue**: Method lookup uses `lowerFirst(node.type)`, so `Ruleset` → `ruleset`

**Pros:**
- Consistent camelCase naming
- TypeScript-friendly (camelCase is standard)

**Cons:**
- Less explicit than `visit${Type}` pattern
- Requires knowing the conversion rule
- Could be confusing if node type doesn't follow convention

**Recommendation**: ✅ **Keep it** - It's intuitive and TypeScript-friendly

### 2. **No `accept()` Method on Nodes**

**Issue**: Nodes don't have `accept(visitor)` method. Visitor directly calls nodes.

**Standard Pattern:**
```typescript
node.accept(visitor); // Double dispatch
```

**Jess Pattern:**
```typescript
visitor.visit(node); // Single dispatch
```

**Pros:**
- Simpler API
- Less boilerplate on nodes
- Visitor controls traversal

**Cons:**
- Not classic visitor pattern
- Nodes can't control how they're visited
- Less flexible for node-specific visitation logic

**Recommendation**: ⚠️ **Consider adding `accept()`** - More standard, allows nodes to control visitation

### 3. **Abstract Visitor Class vs Interface**

**Issue**: Both `Visitor` interface and `Visitor` abstract class exist

**Current:**
- Interface: Defines method signatures
- Abstract class: Provides implementation

**Pros:**
- Can use interface for simple visitors (just object literals)
- Can extend class for complex visitors

**Cons:**
- Two ways to do the same thing (confusing?)
- Interface doesn't enforce method lookup logic

**Recommendation**: ✅ **Keep both** - Provides flexibility

### 4. **Return Value Handling**

**Jess Return Values:**
- `Node` - Replace node
- `ABORT` - Stop traversal
- `REMOVE` - Remove node
- `SKIP` - Skip this node
- `undefined` - No change

**Less.js Return Values:**
- `Node` - Replace node (if `isReplacing`)
- `undefined` - No change
- Uses `visitArgs.visitDeeper = false` to stop traversal

**Comparison:**
- ✅ Jess has more explicit control symbols
- ✅ Less uses context flags
- Both work, Jess is more explicit

**Recommendation**: ✅ **Keep current approach** - More explicit and powerful

### 5. **TreeVisitor Auto-Traversal**

**Issue**: `TreeVisitor` automatically visits children, but base `Visitor` doesn't

**Pros:**
- Convenient for most use cases
- Prevents forgetting to visit children
- Can control order (`visitChildren: 'before' | 'after'`)

**Cons:**
- Two different behaviors (base vs TreeVisitor)
- Might be confusing which to use
- Less explicit about what's happening

**Recommendation**: ✅ **Keep it** - Useful abstraction, well-documented

### 6. **Context Object**

**Jess Context:**
```typescript
type VisitorContext = {
  visitDeeper?: boolean;
};
```

**Less.js Context:**
```javascript
const visitArgs = { visitDeeper: true };
```

**Comparison:**
- ✅ Both use `visitDeeper` flag
- ✅ Both are optional
- ✅ Similar functionality

**Recommendation**: ✅ **Standard** - Matches common patterns

## Recommendations

### ✅ Keep As-Is (Good Patterns)

1. **Interface-based approach** - TypeScript-friendly, flexible
2. **Enter/Exit hooks** - Standard pattern
3. **Return value symbols** - More explicit than flags
4. **TreeVisitor abstraction** - Useful convenience
5. **Method-per-type** - Type-safe and clear

### ⚠️ Consider Improvements

1. **Add `accept()` method to nodes** (optional)
   ```typescript
   class Node {
     accept(visitor: Visitor): Node {
       return visitor.visit(this);
     }
   }
   ```
   - More standard pattern
   - Allows nodes to control visitation
   - Still works with current visitor.visit() approach

2. **Document method naming convention clearly**
   - Add JSDoc explaining `lowerFirst` conversion
   - Maybe add a helper: `getVisitorMethodName(nodeType: string)`

3. **Consider `visit${Type}` naming as alternative**
   - More explicit
   - Matches Less.js convention
   - Could support both for compatibility

### ❌ Not Recommended

1. **Don't remove interface** - Too useful for simple visitors
2. **Don't remove TreeVisitor** - Too convenient
3. **Don't change return value system** - Works well

## Compatibility with Less.js

### Current Approach (Using `enter` hook)

```typescript
{
  enter: (node) => {
    const lessNode = toLessNode(node);
    const result = lessVisitor.visit(lessNode);
    return fromLessNode(result);
  }
}
```

**Pros:**
- ✅ Simple
- ✅ Works for all node types
- ✅ No need to implement every method

**Cons:**
- ⚠️ Less visitors might expect `visit${Type}` methods
- ⚠️ Less visitors use `accept()` pattern
- ⚠️ Might not handle Less's `visitDeeper` flag correctly

### Alternative: Type-Specific Mapping

```typescript
{
  ruleset: (node) => {
    const lessNode = toLessNode(node);
    const result = lessVisitor.visit(lessNode);
    return fromLessNode(result);
  },
  // ... for each type
}
```

**Pros:**
- ✅ More explicit
- ✅ Better type safety
- ✅ Matches Less's method-per-type pattern

**Cons:**
- ❌ More boilerplate
- ❌ Need to implement for every type

## Conclusion

**Overall Assessment: ✅ The Jess visitor pattern is GOOD and STANDARD**

### Strengths:
1. TypeScript-friendly interface approach
2. Flexible (interface or class)
3. Powerful return value system
4. Convenient TreeVisitor abstraction
5. Standard enter/exit hooks

### Minor Issues:
1. Method name conversion could be more explicit
2. No `accept()` method (but not required)
3. Two ways to create visitors (but provides flexibility)

### Recommendation:
**The pattern is solid and intuitive.** The main consideration for Less.js compatibility is that Less uses `visit${Type}` naming and `accept()` pattern, but we can adapt via the `enter` hook or by mapping methods. The current approach should work well.

### For Less.js Compatibility:
- Using `enter` hook is simplest and works
- Could also map `ruleset` → `visitRuleset` if needed
- Proxy-based conversion handles the `accept()` pattern

