# State-Aware Node Access: DX Proposal

## The Fundamental Constraint

Two virtual nodes can share one canonical node. Therefore virtual
information cannot live on the canonical node.

One object can't have two values for the same property at the same time.
A canonical `Declaration(color: @color)` shared across `.mixin(red)` and
`.mixin(blue)` can't return Keyword(red) from `.value` in one context and
Keyword(blue) in another — unless there's indirection at read time.

The EvalState system chose indirection: patches live in a side structure
(`Map<Node, NodeState>`), keyed by canonical node + eval context. The DX
cost: `getField(node, 'value', ctx)` — untyped, leaks internals,
requires context everywhere.

---

## Chosen Approach: Type-Safe `get()` with Private ChildKey Fields

One method on the base class. TypeScript infers the return type from the
node's generic parameter. Private fields force all external access through
`get()`.

### Base class

```ts
class Node<
  ChildData extends Record<string, unknown> = Record<string, unknown>,
  O extends NodeOptions = NodeOptions
> {
  /**
   * Type-safe access to child data fields.
   * Without context: returns canonical (parse-time) value.
   * With context: returns eval-state-patched value if one exists.
   */
  get<K extends keyof ChildData & string>(key: K, ctx?: Context): ChildData[K] {
    if (ctx) {
      const v = ctx.activeState.peek(this)?._fields?.get(key);
      if (v !== undefined) return v as ChildData[K];
    }
    return (this as any)[key] as ChildData[K];
  }
}
```

### Node declarations

Each node declares its child data shape as a generic parameter. ChildKey
fields are **private** — only accessible within the class. External code
must use `get()`.

```ts
// Single-child node
class Url extends Node<{ value: Quoted | Any }> {
  static childKeys = ['value'] as const;
  private value!: Quoted | Any;

  constructor(value: Quoted | Any, ...) {
    super(value as any, ...);
    this.value = value;
  }
}

// Multi-child node (all fields in ChildData, including non-patched ones)
class Operation extends Node<
  OperationValue, NodeOptions,
  { left: Node; operator: Operator; right: Node }
> {
  static childKeys = ['left', 'right'] as const;
  private left!: Node;
  private operator!: Operator;  // never patched, but still in ChildData
  private right!: Node;
}

class Declaration extends Node<
  DeclarationValue, DeclarationOptions,
  { name: NameValue; value: Node; important: Any<'flag'> | undefined }
> {
  static childKeys = ['name', 'value', 'important'] as const;
  private name!: NameValue;
  private value!: Node;
  private important: Any<'flag'> | undefined;
}

// Leaf node (immutable, no child data)
class Dimension extends Node<Record<string, never>> {
  static childKeys = null as null;
  readonly number!: number;
  readonly unit: string | undefined;
  // No get() needed — properties are public readonly.
  // Dimension is always replaced, never field-patched.
}
```

### Usage

```ts
// External code — type-safe, key-constrained, context-optional
url.get('value')            // Quoted | Any   (canonical)
url.get('value', ctx)       // Quoted | Any   (eval-aware)
url.get('name')             // TS ERROR: 'name' not in keyof { value: ... }
url.value                   // TS ERROR: 'value' is private

decl.get('name')            // NameValue
decl.get('value', ctx)      // Node
decl.get('important')       // Any<'flag'> | undefined
decl.get('selector')        // TS ERROR: 'selector' not in keyof { name, value, important }

// ALL fields in ChildData — including non-patched ones
op.get('operator')          // Operator (never patched, but consistent API)
op.get('left', ctx)         // Node     (may be patched)
op.operator                 // TS ERROR: 'operator' is private

// Internal code (within the class) — direct access for canonical
class Url extends Node<{ value: Quoted | Any }> {
  override evalNode(context: Context): MaybePromise<Url> {
    const value = this.value;  // direct private access — canonical
    return pipe(value.eval(context), (nextValue) => {
      if (nextValue !== value) {
        setField(this, 'value', nextValue, context);
      }
      return this;
    });
  }

  override toTrimmedString(options?: PrintOptions) {
    const value = this.get('value', options?.context);  // eval-aware
    // ... render
  }
}
```

**Convention:** All node data fields go in `ChildData` and are private —
even fields that are never state-patched (like `operator`). External
consumers always use `get()`. Whether a field is patched or not is an
implementation detail. The API is consistent: `node.get('field')` for
canonical, `node.get('field', ctx)` for eval-aware.

Internal class code uses direct `this.field` for canonical reads (perf
path) and `this.get('field', ctx)` when eval-aware access is needed.

### Tests

```ts
// Before (untyped, leaks internals):
expect(getField(node, 'value', ctx)).toBe(replacement);

// After (typed, clean):
expect(node.get('value', ctx)).toBe(replacement);

// Canonical:
expect(node.get('value')).toBe(original);
```

### Visitors and custom functions

```ts
// Visitor — receives node + context
visitDeclaration(node: Declaration, ctx: Context) {
  const name = node.get('name', ctx);        // NameValue
  const value = node.get('value', ctx);      // Node
  const imp = node.get('important', ctx);    // Any | undefined
}

// Custom function — args are leaf nodes (Dimension, Color, Keyword)
// which are always REPLACED, never field-patched.
// They have public readonly properties — no get() needed.
function darken(args: Node[]) {
  const color = args[0] as Color;       // replacement node
  const amount = args[1] as Dimension;  // replacement node
  return color.darken(amount.number);   // typed, direct access
}
```

---

## What This Replaces

### Eliminated: 17+ private `_getField(ctx?)` methods

Every node class currently has private helpers like `_getValue(ctx?)`,
`_getName(ctx?)`, etc. These are ALL replaced by the single `get()` on
the base class.

| Before | After |
|---|---|
| `this._getValue(context)` | `this.get('value', context)` |
| `this._getName(context)` | `this.get('name', context)` |
| `this._getLeft(context)` | `this.get('left', context)` |
| `getField<Quoted>(this, 'value', ctx)` | `this.get('value', ctx)` |

### Eliminated: `getField` in external code

`getField` becomes a low-level internal helper used only by `Node.get()`
itself and by internal metadata access (parent, index, registryDelta —
things external consumers never read).

### Unchanged: `setField` in eval code

Writes still go through `setField(node, 'key', value, ctx)` during eval.
This could later get a type-safe `set()` method to match, but it's lower
priority since writes only happen in internal eval code, never in external
consumers.

### Unchanged: Internal metadata fields

`parent`, `index`, `options`, `hoistToRoot`, `_registryDelta`, `frames`,
`sourceNode`, `sourceParent`, `flagsAdd`/`flagsRemove` — all continue
using the untyped `NodeState._fields` Map. These are internal and never
read by external consumers. No DX concern.

---

## Required Refactoring

### 1. Standardize the `ChildData` generic

Currently, single-child nodes use the child type directly as the generic:
`Url extends Node<Quoted | Any>`. Multi-child nodes use an object type:
`Declaration extends Node<DeclarationValue>`.

Standardize to always use keyed object types:

| Before | After |
|---|---|
| `Node<Quoted \| Any>` | `Node<{ value: Quoted \| Any }>` |
| `Node<Node[]>` | `Node<{ value: Node[] }>` |
| `Node<DeclarationValue>` | `Node<DeclarationValue>` (already correct) |
| `Node<RulesetValue>` | `Node<RulesetValue>` (already correct) |

Affected single-child nodes (~15):
Url, Quoted, List, Sequence, Paren, Block, SelectorList, SelectorCapture,
CompoundSelector, ComplexSelector, ExtendList, Rest, SelectorInterpolated,
Range, Control variants.

Multi-child nodes (already use object types):
Declaration, Ruleset, AtRule, Call, Mixin, Operation, Reference,
PseudoSelector, AttributeSelector, JsImport, Log, Control variants.

### 2. Make childKey fields private

Change `readonly name!: NameValue` to `private name!: NameValue` on every
node that has patched childKeys. This forces external code through `get()`.

Leaf nodes (Dimension, Color, Keyword, etc.) keep public readonly fields —
they're immutable and never field-patched. There's no `get()` use case
for them.

### 3. Remove private `_getField` helpers

Delete `_getValue`, `_getName`, `_getLeft`, `_getRight`, `_getArg`,
`_getTarget`, `_getKey`, `_getValueNode`, `_getImportant`,
`_getSelector`, `_getGuard`, `_getRulesContainer`, `_getPrelude`,
`_getArgs`, `_getContentNode`, `_getOptions`, `_getConditions`,
`_getBodies`, `_getElseBranch`, etc.

Replace all internal call sites with `this.get('key', ctx)`.

### 4. Update `toTrimmedString` and `evalNode` methods

Replace `this._getValue(options.context)` with
`this.get('value', options.context)` etc.

---

## Properties

- **Zero allocation.** No wrappers, no proxies, no clones. Just a Map
  lookup when context is provided, direct field access when not.
- **Fully typed.** Return type inferred from `ChildData[K]`. Invalid
  keys are compile-time errors.
- **One method.** Single `get()` on base class replaces 30+ private
  accessors across 17+ node classes.
- **Private fields enforce the API.** External code can't bypass `get()`.
  Internal code retains direct `this.field` access for canonical reads.
- **Progressive.** `node.get('value')` returns canonical (no context
  needed). `node.get('value', ctx)` returns eval-aware. Same API, same
  types, optional context.
- **No architectural change.** EvalState, NodeState, field-helpers all
  stay the same. This is a DX layer on top of the existing system.

---

## What Doesn't Work (and Why)

### Structural sharing / lightweight wrappers

Creates clones for every field-patched node per call. For shared mixin
bodies where most leaves are parameterized, object count equals deep
cloning. Defeats the purpose of EvalState.

### Proxy-based transparent access

Proxy overhead on every read. Breaks identity. V8 deopt. Still needs
per-context dispatch (same fundamental constraint).

### Ambient context on property getters

Converting childKey fields to getters backed by `Context.current` makes
`node.value` transparently eval-aware. But:
- Getter access is slower than field access in V8
- Every read branches even during parsing (when no eval is active)
- Module-level mutable state (`Context.current`) is fragile

Could work as a future optimization if benchmarks show the getter cost
is acceptable. But `get()` with private fields is safer and simpler.

### Public `getValue(ctx?)` accessors per field

Works but requires 30-40 new methods across 17 classes. Each is 3 lines
of boilerplate. The single `get()` method achieves the same thing with
zero per-class boilerplate.

---

## Audit: What Gets Field-Patched

**119 `setField` calls** in production code.

### childKey patches (user-visible data): ~95 calls

These are the fields exposed through `get()`:

| Field | Calls | Node Types |
|-------|-------|------------|
| `value` | ~70 | Declaration, List, Sequence, Url, Quoted, Paren, Block, SelectorList, SelectorCapture, CompoundSelector, ComplexSelector, Interpolated, Control, VarDeclaration, Rules |
| `name` | ~7 | Declaration, Mixin, AtRule, Call |
| `rules` | ~9 | Ruleset, AtRule, Mixin |
| `selector` | ~3 | Ruleset |
| `prelude` | ~5 | AtRule |
| `left`/`right` | ~6 | Operation |
| `guard` | ~2 | Ruleset |
| `args` | ~2 | Call |
| `arg` | ~1 | PseudoSelector |
| `important` | ~3 | Declaration |
| Others | ~5 | Ruleset, JsImport, Interpolated |

### Internal metadata patches: ~50 calls

These stay as untyped `NodeState._fields` entries. Not exposed through
`get()`. External consumers never read them.

| Field | Notes |
|-------|-------|
| `parent` | ~8 sites |
| `index` | ~2 sites |
| `options` | ~4 sites |
| `hoistToRoot` | ~4 sites |
| `frames`, `_extendedSelector`, `_registryDelta` | ~5 sites |
| `sourceNode`, `sourceParent` | ~4 sites |
| `flagsAdd`/`flagsRemove` | ~4 sites |
| Various via `.fields.set()` | ~19 sites |
