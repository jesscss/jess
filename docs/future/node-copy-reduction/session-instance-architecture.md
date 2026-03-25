# Session Instance Architecture

## The Model

Two operations. That's it.

1. **Replace a node** at a position in the tree
2. **Replace a field** on a node

Both are map lookups from the `EvalPosition`. The node doesn't know or care whether it's canonical or virtual — the position holds the patches.

## Data Structure

```ts
class EvalPosition {
  patches: Map<Node, NodePatch>   // sparse field overrides
}

type NodePatch = Record<string, unknown>
```

### Replace a node

A node replacement is a field patch on the **parent**. If a Rules has children `[decl1, import2, decl3]` and `import2` evaluates to `rules2`, that's:

```ts
position.patchField(parentRules, 'value', [decl1, rules2, decl3])
```

### Replace a field

A field replacement is a patch on the **node itself**. If a Declaration's value changes from `@color` to `red`:

```ts
position.patchField(decl, 'value', redKeyword)
```

### Reading

```ts
position.getField(node, 'value') ?? node.value
```

Check the position first. Fall back to canonical. That's the virtual evaluated tree.

## Performance

- **One canonical tree** — parsed once, immutable, shared
- **One EvalPosition per placement** — sparse, O(R) where R = replacements
- **No cloning** — no deep copy, no shallow copy, no `maybeClone`
- **No object creation** for pass-through nodes — only nodes that change get entries
- **WeakMap-friendly** — nodes are keys, GC handles cleanup

JIT engines are most slowed by object creation. This model creates the minimum: one Map per placement, one entry per changed node. Everything else is a pointer to canonical.

## What This Replaces

| Old | New |
|-----|-----|
| `clone(true)` per mixin call | `new EvalPosition(sourceRoot)` |
| `clone(false)` + session adoption | Not needed |
| `maybeClone()` in preEval | Not needed |
| `ShadowEntry` with field patches + runtime | `NodePatch = Record<string, unknown>` |
| `SessionInstanceRoot` | `EvalPosition` |
| Children overlays | Field patch on parent's `value` |
| IR-aware `_setChildAt` / `push` / `splice` | Field patch on parent's `value` |

## How eval works

```
1. Walk canonical tree top-down
2. For each node:
   a. position.getField(node, field) ?? node.field  // read
   b. evalNode(context) → result
   c. if result !== node:
      position.patchField(parent, 'value', updatedChildren)  // replace node
   d. if field changed:
      position.patchField(node, 'field', newValue)           // replace field
3. The position IS the evaluated tree
```

## Hard Rules

- Canonical nodes are NEVER mutated during eval
- `EvalPosition.patchField` is the ONLY write path
- `position.getField(node, field) ?? node.field` is the ONLY read path
- No special cases for children, names, values, preludes — they're all fields
- No clone, no copy, no maybeClone in the eval path
- The node doesn't know about the position — the position knows about the node

## Context

`context.position` carries the active `EvalPosition`. It's a stack — mixin calls push a new position, restore on exit.

```ts
// Mixin call:
const prevPosition = context.position;
context.position = new EvalPosition(mixinBody);
// ... eval body ...
context.position = prevPosition;
```

Lazy via `context.ensurePosition()` — zero cost if eval doesn't need one.
