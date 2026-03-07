# Less.js Compatibility Plugin - Implementation Plan

## Overview

This package (`@jesscss/plugin-less-compat`) provides bidirectional transformation between Jess AST nodes and Less.js AST nodes, enabling Less.js plugins and visitors to work seamlessly with Jess-compiled stylesheets.

## Package Structure

```
packages/jess-plugin-less-compat/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── README.md
├── src/
│   ├── index.ts                    # Main plugin export
│   ├── transform/
│   │   ├── index.ts                # Public transformation API
│   │   ├── to-less.ts              # Jess → Less conversion
│   │   ├── from-less.ts            # Less → Jess conversion
│   │   ├── proxy.ts                # Proxy-based lazy conversion
│   │   └── type-map.ts             # Type mapping utilities
│   ├── nodes/
│   │   ├── ruleset.ts              # Ruleset transformation
│   │   ├── selector.ts             # Selector transformation
│   │   ├── declaration.ts          # Declaration transformation
│   │   ├── reference.ts            # Reference → Variable/Property/VariableCall
│   │   ├── mixin.ts                # Mixin transformation
│   │   ├── dimension.ts            # Dimension transformation
│   │   ├── color.ts                # Color transformation
│   │   ├── operation.ts            # Operation transformation
│   │   ├── expression.ts           # Expression transformation
│   │   ├── quoted.ts               # Quoted transformation
│   │   ├── url.ts                  # URL transformation
│   │   ├── comment.ts              # Comment transformation
│   │   ├── at-rule.ts              # AtRule transformation
│   │   ├── import.ts                # Import transformation
│   │   ├── extend.ts               # Extend transformation
│   │   ├── condition.ts            # Condition transformation
│   │   └── index.ts                # Node transformer registry
│   ├── visitor/
│   │   ├── less-visitor-adapter.ts # Adapter to run Less visitors on Jess tree
│   │   └── jess-visitor-wrapper.ts # Wrapper to run Jess visitors on Less tree
│   ├── plugin.ts                   # Main plugin implementation
│   └── types.ts                    # TypeScript type definitions
├── test/
│   ├── integration/
│   │   ├── less-plugin-dls.test.ts
│   │   ├── less-plugin-clean-css.test.ts
│   │   └── less-plugin-autoprefix.test.ts
│   ├── unit/
│   │   ├── transform/
│   │   │   ├── to-less.test.ts
│   │   │   ├── from-less.test.ts
│   │   │   └── proxy.test.ts
│   │   └── nodes/
│   │       ├── ruleset.test.ts
│   │       ├── selector.test.ts
│   │       ├── declaration.test.ts
│   │       ├── reference.test.ts
│   │       ├── mixin.test.ts
│   │       └── ... (all node types)
│   └── fixtures/
│       ├── simple.less
│       ├── complex.less
│       └── ...
└── lib/                             # Compiled output
```

## Core Components

### 1. Transformation Layer (`src/transform/`)

#### `to-less.ts` - Jess → Less Conversion

```typescript
import type { Node } from '@jesscss/core';
import type { LessNode } from 'less';

export interface ToLessOptions {
  /** Cache conversions to avoid repeated work */
  cache?: WeakMap<Node, any>;
  /** Preserve original Jess node reference */
  preserveOriginal?: boolean;
}

/**
 * Convert a Jess node to a Less-compatible proxy
 */
export function toLessNode(
  jessNode: Node,
  options?: ToLessOptions
): LessNode;

/**
 * Convert an entire Jess Rules tree to Less-compatible format
 */
export function toLessTree(jessRules: Rules): LessNode;
```

**Key Features:**
- Lazy conversion using proxies
- Property name mapping (e.g., `value.selector` → `selectors`)
- Type mapping (e.g., `Reference` → `Variable`/`Property`/`VariableCall`)
- Child node conversion on-demand
- Caching to prevent duplicate conversions

#### `from-less.ts` - Less → Jess Conversion

```typescript
import type { Node } from '@jesscss/core';
import type { LessNode } from 'less';

export interface FromLessOptions {
  /** Cache conversions to avoid repeated work */
  cache?: WeakMap<any, Node>;
}

/**
 * Convert a Less node back to a Jess node
 */
export function fromLessNode(
  lessNode: LessNode,
  options?: FromLessOptions
): Node;

/**
 * Convert an entire Less tree back to Jess Rules
 */
export function fromLessTree(lessTree: LessNode): Rules;
```

**Key Features:**
- Reverse property mapping
- Type reconstruction
- Preserve structure and relationships
- Handle visitor-returned nodes

#### `proxy.ts` - Proxy-Based Lazy Conversion

```typescript
import type { Node } from '@jesscss/core';

/**
 * Create a Less-compatible proxy wrapper around a Jess node
 */
export function createLessProxy(
  jessNode: Node,
  cache?: WeakMap<Node, any>
): any;

/**
 * Check if an object is a Less proxy wrapper
 */
export function isLessProxy(obj: any): boolean;

/**
 * Get the underlying Jess node from a Less proxy
 */
export function getJessNodeFromProxy(proxy: any): Node | undefined;
```

**Proxy Handler Implementation:**
- Intercept property access (`get` trap)
- Map property names (e.g., `selectors` → `value.selector`)
- Convert child nodes lazily
- Handle method calls (`accept`, `genCSS`, `eval`, etc.)
- Cache conversions

#### `type-map.ts` - Type Mapping

```typescript
/**
 * Map Jess node types to Less node types
 */
export function mapJessTypeToLessType(jessType: string): string;

/**
 * Map Less node types to Jess node types
 */
export function mapLessTypeToJessType(lessType: string): string;

/**
 * Get Less typeIndex for a Jess node type
 */
export function getLessTypeIndex(jessType: string): number | undefined;
```

### 2. Node Transformers (`src/nodes/`)

Each node type has a dedicated transformer module:

#### Example: `ruleset.ts`

```typescript
import type { Ruleset } from '@jesscss/core';
import type { LessRuleset } from 'less';

export function transformRulesetToLess(
  jessRuleset: Ruleset,
  cache?: WeakMap<any, any>
): LessRuleset {
  return createLessProxy(jessRuleset, {
    // Property mappings
    selectors: () => {
      const selector = jessRuleset.value.selector;
      if (selector instanceof Nil) {
        return [];
      }
      if (selector instanceof SelectorList) {
        return selector.value.map(s => toLessNode(s, { cache }));
      }
      return [toLessNode(selector, { cache })];
    },
    rules: () => {
      return jessRuleset.value.rules.value.map(r => toLessNode(r, { cache }));
    },
    // Method handlers
    accept: (visitor) => {
      const lessRuleset = toLessNode(jessRuleset, { cache });
      const result = visitor.visit(lessRuleset);
      // Convert back if visitor returned a new node
      if (result !== lessRuleset) {
        return fromLessNode(result, { cache });
      }
      return jessRuleset;
    },
    genCSS: (context, output) => {
      // Forward to Jess's serialization
      // Or provide Less-compatible genCSS
    }
  });
}
```

**Transformer Pattern:**
1. Create proxy with property mappings
2. Handle child node conversion
3. Intercept method calls
4. Cache results

### 3. Visitor Adapter (`src/visitor/`)

#### `less-visitor-adapter.ts`

```typescript
import type { Visitor } from '@jesscss/core';
import type { LessVisitor } from 'less';

/**
 * Adapt a Less visitor to work with Jess nodes
 */
export class LessVisitorAdapter {
  constructor(
    private lessVisitor: LessVisitor,
    private options?: { cache?: WeakMap<any, any> }
  ) {}

  /**
   * Convert to Jess visitor interface
   */
  toJessVisitor(): Visitor {
    return {
      enter: (node) => {
        const lessNode = toLessNode(node, this.options);
        const result = this.lessVisitor.visit(lessNode);
        // Handle visitor return
        if (result !== lessNode) {
          return fromLessNode(result, this.options);
        }
        return node;
      },
      // ... map all visitor methods
    };
  }
}
```

### 4. Plugin Implementation (`src/plugin.ts`)

```typescript
import { AbstractPlugin, type PluginInterface } from '@jesscss/core';
import type { LessVisitor } from 'less';

export interface LessCompatPluginOptions {
  /** Less visitors to apply */
  visitors?: LessVisitor[];
  /** Enable caching (default: true) */
  cache?: boolean;
}

export class LessCompatPlugin extends AbstractPlugin {
  name = 'less-compat';
  
  constructor(public opts: LessCompatPluginOptions = {}) {
    super();
  }

  /**
   * Return a visitor that wraps Less visitors
   */
  get visitor(): Visitor {
    if (!this.opts.visitors?.length) {
      return undefined;
    }

    return {
      enter: (node) => {
        // Convert Jess node to Less format
        const lessNode = toLessNode(node);
        
        // Run all Less visitors
        let result = lessNode;
        for (const lessVisitor of this.opts.visitors!) {
          result = lessVisitor.visit(result);
        }
        
        // Convert back to Jess if changed
        if (result !== lessNode) {
          return fromLessNode(result);
        }
        return node;
      }
    };
  }
}

export default function lessCompatPlugin(
  opts?: LessCompatPluginOptions
): PluginInterface {
  return new LessCompatPlugin(opts);
}
```

## Detailed Node Transformations

### Ruleset

**Jess:** `{ value: { selector: Selector | Nil, rules: Rules, guard?: Condition } }`
**Less:** `{ selectors: Selector[], rules: Node[] }`

**Transformation:**
- `value.selector` (single) → `selectors` (array)
- `value.rules.value` → `rules`
- Handle `Nil` selector → empty array
- Handle `SelectorList` → array of selectors

### Selector

**Jess:** Hierarchical (`ComplexSelector` → `CompoundSelector` → `BasicSelector`)
**Less:** Flat array of `Element` nodes

**Transformation:**
- Flatten hierarchical structure
- Convert `BasicSelector` + `Combinator` → `Element`
- Handle `SelectorList` → multiple selectors

### Reference

**Jess:** Unified `Reference` with `options.type`
**Less:** Separate `Variable`, `Property`, `VariableCall`

**Transformation:**
- Check `options.type` to determine Less node type
- `Reference` with `type: 'variable'` → `Variable`
- `Reference` with `type: 'property'` → `Property`
- `Reference` with `type: 'call'` → `VariableCall`
- Map `value.target` and `value.key` appropriately

### Mixin

**Jess:** `Mixin` with `value.name`, `value.rules`, `value.params`, `value.guard`
**Less:** `MixinDefinition` with `name`, `params`, `rules`, `condition`

**Transformation:**
- Direct property mapping
- Convert `value.params` → `params`
- Convert `value.guard` → `condition`

### Declaration

**Jess:** `{ value: { name, value, important }, options: { assign } }`
**Less:** `{ name, value, important, merge, variable }`

**Transformation:**
- Map `value.name` → `name`
- Map `value.value` → `value`
- Map `value.important` → `important`
- Map `options.assign` → `variable` (boolean)

### Dimension

**Jess:** `{ value: { number, unit: string } }`
**Less:** `{ value: number, unit: Unit }`

**Transformation:**
- Map `value.number` → `value`
- Convert `value.unit` (string) → `Unit` node

### Color

**Jess:** `{ value: { rgb: number[], alpha: number, format, node } }`
**Less:** `{ rgb: number[], alpha: number, value: string }`

**Transformation:**
- Direct mapping for `rgb` and `alpha`
- Convert `value.format` + `value.node` → `value` string

### Operation

**Jess:** `{ value: [left, op, right] }`
**Less:** `{ op: string, operands: Node[] }`

**Transformation:**
- Extract `op` from tuple
- Convert `[left, right]` → `operands` array

### Expression

**Jess:** `{ value: Node, options: { parens } }`
**Less:** `{ value: Node[] }`

**Transformation:**
- Convert single `value` → array if needed
- Handle `options.parens` → Less's `Paren` wrapper

### Quoted

**Jess:** `{ value: string | Any | Interpolated, options: { quote, escaped } }`
**Less:** `{ value: string, quote: string, escaped: boolean }`

**Transformation:**
- Direct mapping
- Handle interpolated values

### URL

**Jess:** `{ value: Quoted | Any }`
**Less:** `{ value: Quoted | Anonymous }`

**Transformation:**
- Direct mapping

### Comment

**Jess:** `{ value: string, options: { lineComment } }`
**Less:** `{ value: string, isLineComment: boolean }`

**Transformation:**
- Map `options.lineComment` → `isLineComment`

### AtRule

**Jess:** `{ value: { name, prelude, rules } }`
**Less:** `{ name: string, value: Node, rules: Node[] }`

**Transformation:**
- Map `value.name` → `name`
- Map `value.prelude` → `value`
- Map `value.rules` → `rules`

### Import

**Jess:** `StyleImport` with `value.path`, `value.with`
**Less:** `Import` with `path`, `features`, `options`

**Transformation:**
- Map `value.path` → `path`
- Convert `value.with` → `features`/`options`

### Extend

**Jess:** `{ value: { selector, target, flag } }`
**Less:** `{ selector: Selector, option: string }`

**Transformation:**
- Map `value.selector` → `selector`
- Map `value.flag` → `option`

### Condition

**Jess:** `{ value: [left, op?, right], options: { negate } }`
**Less:** `{ op: string, lvalue: Node, rvalue: Node, negate: boolean }`

**Transformation:**
- Extract from tuple
- Map `options.negate` → `negate`

## Testing Strategy

### Unit Tests

**Coverage Requirements:**
- All node type transformations (Jess → Less)
- All node type transformations (Less → Jess)
- Property mapping correctness
- Child node conversion
- Proxy behavior
- Caching behavior
- Edge cases (Nil, empty arrays, etc.)

**Test Structure:**
```typescript
describe('transformRulesetToLess', () => {
  it('converts single selector to array', () => {
    const jessRuleset = createRuleset({ selector: basicSelector('div') });
    const lessRuleset = transformRulesetToLess(jessRuleset);
    expect(lessRuleset.selectors).toHaveLength(1);
  });

  it('handles Nil selector as empty array', () => {
    const jessRuleset = createRuleset({ selector: Nil });
    const lessRuleset = transformRulesetToLess(jessRuleset);
    expect(lessRuleset.selectors).toEqual([]);
  });

  it('converts SelectorList to array', () => {
    // ...
  });
});
```

### Integration Tests

**Test with Real Less Plugins:**

1. **less-plugin-dls**
   ```typescript
   import dls from 'less-plugin-dls';
   
   describe('less-plugin-dls integration', () => {
     it('applies DLS transformations', async () => {
       const jessTree = parseJess(source);
       const lessTree = toLessTree(jessTree);
       
       const visitor = dls.install({}, {}, {});
       lessTree.accept(visitor);
       
       const result = fromLessTree(lessTree);
       expect(result).toMatchSnapshot();
     });
   });
   ```

2. **less-plugin-clean-css**
   ```typescript
   import CleanCSS from 'less-plugin-clean-css';
   
   describe('less-plugin-clean-css integration', () => {
     it('minifies CSS output', async () => {
       // Test minification
     });
   });
   ```

3. **less-plugin-autoprefix**
   ```typescript
   import autoprefix from 'less-plugin-autoprefix';
   
   describe('less-plugin-autoprefix integration', () => {
     it('adds vendor prefixes', async () => {
       // Test autoprefixing
     });
   });
   ```

### Test Fixtures

Create comprehensive test fixtures covering:
- Simple stylesheets
- Complex nested structures
- Mixins and variables
- Extend operations
- Media queries
- At-rules
- Edge cases

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Package setup and configuration
- [ ] Proxy-based conversion framework
- [ ] Type mapping utilities
- [ ] Basic caching mechanism

### Phase 2: Node Transformers (Priority Order)
- [ ] Ruleset
- [ ] Selector (complex)
- [ ] Declaration
- [ ] Reference (complex - Variable/Property/VariableCall)
- [ ] Dimension
- [ ] Color
- [ ] Operation
- [ ] Expression
- [ ] Quoted
- [ ] URL
- [ ] Comment
- [ ] Mixin
- [ ] AtRule
- [ ] Import
- [ ] Extend
- [ ] Condition

### Phase 3: Visitor Integration
- [ ] Less visitor adapter
- [ ] Plugin implementation
- [ ] Integration with Jess plugin system

### Phase 4: Testing
- [ ] Unit tests for all node types
- [ ] Integration tests with less-plugin-dls
- [ ] Integration tests with less-plugin-clean-css
- [ ] Integration tests with less-plugin-autoprefix
- [ ] Edge case testing
- [ ] Performance testing

### Phase 5: Documentation
- [ ] README with usage examples
- [ ] API documentation
- [ ] Migration guide
- [ ] Plugin development guide

## Usage Examples

### Basic Usage

```typescript
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

### Advanced Usage

```typescript
import { toLessTree, fromLessTree } from '@jesscss/plugin-less-compat';
import customLessVisitor from './custom-visitor';

const jessTree = parseJess(source);
const lessTree = toLessTree(jessTree);

// Apply custom Less visitor
lessTree.accept(customLessVisitor);

// Convert back
const modifiedJessTree = fromLessTree(lessTree);
```

## Performance Considerations

1. **Lazy Conversion**: Only convert nodes when accessed
2. **Caching**: Use WeakMap to cache conversions
3. **Proxy Overhead**: Minimize proxy traps, cache property lookups
4. **Memory**: Use WeakMap to allow garbage collection

## Error Handling

- Graceful degradation for unsupported node types
- Clear error messages for transformation failures
- Validation of Less node structure before conversion back

## Future Enhancements

1. Support for Less pre/post processors
2. Support for Less file managers
3. Bidirectional function registry conversion
4. Source map preservation
5. Performance optimizations
