# State-Aware Node Access: DX Proposal

## The Fundamental Constraint

One object can't have two values for the same property at the same time.

A canonical Declaration `color: @color` is shared across `.mixin(red)` and
`.mixin(blue)`. For `decl.value` to return `Keyword(red)` in one call and
`Keyword(blue)` in another, you must either:

1. **Create separate objects** — that's cloning, regardless of mechanism
2. **Use indirection** — one shared object, context-dependent lookup
3. **Ambient context** — make property getters implicitly context-aware

There is no option 4. This is why the EvalState system exists — it chose
option 2 (indirection via state overlay). The DX cost: field reads require
context and lose TypeScript typing.

---

## Audit: What Gets Field-Patched

**119 `setField` calls** in production code:

### childKey patches (user-visible data): ~95 calls

These are the DX problem. External consumers reading these typed fields
get stale canonical values without context.

| Field | Calls | Node Types |
|-------|-------|------------|
| `value` | ~70 | Declaration (13), List (7), Sequence (5), Url (1), Quoted (1), Paren (1), Block (1), SelectorList (3), SelectorCapture (1), CompoundSelector (3), ComplexSelector (2), Interpolated (2), Control (1), VarDeclaration (1), Rules (via setChildren ~8) |
| `name` | ~7 | Declaration (2), Mixin (2), AtRule (2), Call (1) |
| `rules` | ~9 | Ruleset (5), AtRule (3), Mixin (1) |
| `selector` | ~3 | Ruleset (3) |
| `prelude` | ~5 | AtRule (5) |
| `left`/`right` | ~6 | Operation (6) |
| `guard` | ~2 | Ruleset (2) |
| `args` | ~2 | Call (2) |
| `arg` | ~1 | PseudoSelector (1) |
| `important` | ~3 | Declaration (3) |
| `selectorBeforeExtend` | ~1 | Ruleset (1) |
| `path` | ~1 | JsImport (1) |
| `replacements` | ~2 | Interpolated (2) |

### Internal metadata patches: ~24 calls + ~26 direct .fields.set()

These are fine as untyped state. External consumers don't read them.

| Field | Notes |
|-------|-------|
| `parent` | ~8 sites |
| `index` | ~2 sites |
| `options` | ~4 sites |
| `hoistToRoot` | ~4 sites |
| `frames` | ~2 sites |
| `_extendedSelector` | ~1 site |
| `_registryDelta` | ~2 sites |
| `sourceNode`, `sourceParent` | ~4 sites |
| `flagsAdd`/`flagsRemove` | ~4 sites |

### Finding

**~95 of 119 setField calls patch childKey data.** The untyped field
access problem is the dominant use case, not an edge case.

---

## Why "Lightweight Wrappers" / "Structural Sharing" Don't Work

The mixin reuse case:

```less
.mixin(@color) { color: @color; }
.a { .mixin(red); }
.b { .mixin(blue); }
```

Canonical body: `Declaration(name=color, value=Reference(@color))`.

During `.mixin(red)`, Reference(@color) resolves to Keyword(red). The
Declaration's `value` is patched to Keyword(red) in call state S1.

During `.mixin(blue)`, same canonical Declaration, patched to Keyword(blue)
in call state S2.

For `decl.value` to return Keyword(red) without context, the decl object
must BE different from the canonical. That's a clone. "Lightweight wrapper"
is just a clone by another name.

Object count with wrappers:
- N mixin calls × M field-patched nodes per body = N×M new objects
- Each needs parent wiring, adoption, etc.
- Savings over deep clone: only when some nodes DON'T change

For mixin bodies where most nodes have parameters: N×M ≈ deep clone count.
**No savings.** The whole point of EvalState was to avoid this.

---

## What Actually Works

### Approach A: Typed Public Accessors (recommended)

Promote the existing `private _getField(ctx?)` pattern to public API.
Every node class that gets field-patched already has the private version.
Just make it public and typed.

```ts
class Declaration extends Node {
  readonly name!: NameValue;       // canonical, typed
  readonly value!: Node;           // canonical, typed

  /** Eval-aware: returns patched value if context provided */
  getName(ctx?: Context): NameValue {
    return ctx ? getField<NameValue>(this, 'name', ctx) : this.name;
  }

  getValue(ctx?: Context): Node {
    return ctx ? getField<Node>(this, 'value', ctx) : this.value;
  }
}

class Url extends Node {
  readonly value!: Quoted | Any;

  getValue(ctx?: Context): Quoted | Any {
    return ctx ? getField<Quoted | Any>(this, 'value', ctx) : this.value;
  }
}
```

#### Convention

| Access | Returns | When to use |
|---|---|---|
| `node.value` | Canonical (parse-time) | Parsing, static analysis, no eval context |
| `node.getValue(ctx)` | Eval'd (state-patched) | During eval, serialization, visitors |
| `node.getValue()` | Same as `node.value` | Convenience, no context available |

#### Properties

- **Zero allocation.** No new objects, no proxies, no wrappers.
- **Fully typed.** `decl.getValue(ctx)` returns `Node`, not `unknown`.
- **Explicit.** Makes it clear you're reading eval'd state.
- **Progressive.** Works with or without context.
- **Already 80% implemented.** Every affected node already has a private
  `_getField(ctx?)` that just needs to be made public.

#### Which nodes need public accessors?

Only nodes that get field-patched on childKey data (~17 classes):

| Node | Accessors Needed |
|---|---|
| Declaration | getName, getValue, getImportant |
| Ruleset | getSelector, getRules, getGuard |
| AtRule | getName, getPrelude, getRules |
| Call | getName, getArgs |
| Mixin | getName, getRules |
| Operation | getLeft, getRight |
| Url | getValue |
| Quoted | getValue |
| List | getValue |
| Sequence | getValue |
| Paren | getValue |
| Block | getValue |
| SelectorList | getValue |
| CompoundSelector | getValue |
| ComplexSelector | getValue |
| PseudoSelector | getArg |
| Interpolated | getReplacements |

~30-40 total accessors across 17 classes. Mechanical change — each is
3 lines.

#### What tests look like

```ts
// Before (untyped, leaks internals):
expect(getField(node, 'value', ctx)).toBe(replacement);

// After (typed, clean):
expect(node.getValue(ctx)).toBe(replacement);

// Canonical access unchanged:
expect(node.value).toBe(original);
```

#### What visitors/functions look like

```ts
// Visitor receives node + context
visitDeclaration(node: Declaration, ctx: Context) {
  const name = node.getName(ctx);   // typed: NameValue
  const value = node.getValue(ctx); // typed: Node
}

// Custom function — args are already resolved (replacements, not patches)
function darken(args: Node[]) {
  const color = args[0] as Color;      // replacement node, typed
  const amount = args[1] as Dimension;  // replacement node, typed
  return color.darken(amount.number);
}
```

For function args: leaf nodes (Color, Dimension, Keyword) are **replaced**
(new node), not field-patched. So function args are already real typed
nodes — no accessor needed.

#### What serialization looks like

Already works this way internally. `toTrimmedString` already calls
`this._getValue(options.context)`. Making the accessor public doesn't
change the serialization path at all.

---

### Approach B: Materialization at the Output Boundary Only

Keep EvalState + typed accessors for the entire eval/serialization pipeline.
At the very final boundary — when external code needs a standalone tree
(e.g., AST export, source map, plugin output) — materialize once.

`materializeEvaluatedCopy(ctx)` already exists. It walks the canonical
tree, reads each field through the state overlay, and produces a real
cloned tree with eval'd values as instance properties.

This is the nuclear option for consumers that truly can't accept context.
Cost: one full clone at the end. But it happens once, not per mixin call.

---

### What About the `getField` String Keys?

The remaining DX annoyance: typed accessors wrap `getField(this, 'value',
ctx)` internally, which uses a string key. A typo in the string silently
reads the wrong field.

Option: use the `childKeys` array to validate at development time:

```ts
// Type-safe helper (development only):
function getChildField<T extends Node, K extends string>(
  node: T,
  key: K & (typeof (T & { constructor: { childKeys: readonly string[] } })
    ['constructor']['childKeys'][number]),
  ctx: Context
): unknown {
  return getField(node, key, ctx);
}
```

Or simpler: the typed public accessor IS the type safety. Internal code
uses `getField` (with string keys) inside the accessor. External code
uses the typed accessor. The string key is encapsulated.

---

## What Doesn't Work (and Why)

### ~~Structural sharing / lightweight wrappers~~

Creates clones for every field-patched node per call. For shared mixin
bodies, this is the same object count as deep cloning. Defeats the purpose
of EvalState.

### ~~Proxy-based eval view~~

Proxy intercepts property access on the canonical node, routing through
state. Preserves `node.value` syntax.

Problems:
- ~1.2% CPU overhead already from existing Proxy use
- Proxy breaks `===` identity
- V8 deoptimizes Proxy property access
- Must be created per-node-per-context (can't share across calls)
- If created once: which call's state does it use?

### ~~Ambient context on nodes~~

Set `node[CTX] = context` before eval, clear after. Getters check ambient.

Problems:
- Mutates canonical nodes (new hidden class or pre-declare on every node)
- Single-context assumption (breaks if same node is in two call contexts)
- Lifetime management (leaked ctx refs prevent GC)
- Fundamentally: one object, one property, one value at a time

---

## Recommendation

**Typed public accessors (Approach A)** are the answer.

- Zero allocation overhead
- Full TypeScript typing
- Explicit about canonical vs eval'd access
- Already 80% implemented (just promote private → public)
- ~30-40 accessor methods across 17 node classes (mechanical)
- No architectural change to EvalState

The DX cost is `node.getValue(ctx)` instead of `node.value`. This is a
real cost — context must be threaded. But it's the honest reflection of
reality: one canonical object, multiple evaluation contexts, requires
disambiguation.

The gain: the EvalState system works as designed — zero cloning for shared
mixin bodies, full tree reuse, minimal allocation. The typed accessors
give it a clean external API without compromising the performance model.
