# Session Instance Architecture

## Purpose

This is the target architecture doc. Everything else should align to this.

## Performance Motivation

JIT engines are most slowed by **object creation** — allocation pressure, GC pauses, cache misses. Deep cloning creates thousands of short-lived objects per mixin call. Every design decision should reduce object creation during eval.

## The Model

### Two trees

1. **Canonical tree** — the parsed AST. Immutable after construction. One per file.
2. **Evaluated tree** — one per evaluation session. Mostly pointers back to canonical nodes. Sparse replacements where eval produced different values.

### Virtual nodes

A **virtual node** is a position in the evaluated tree. It is either:

- A **pass-through**: points directly to a canonical node (no change during eval)
- A **replacement**: a new node produced by eval, placed at a specific position

Most positions are pass-throughs. Only nodes that actually change during eval get replacements.

### Reused canonical subtrees

When a mixin body is called 3 times, the canonical body nodes appear at 3 different positions in the ONE evaluated tree. Each position may have different replacements (because mixin params differ), but they all reference the same canonical source.

```
Canonical tree:          Evaluated tree:

  .theme(@fg) {           call-site-1:
    color: @fg;             color: red;      ← replacement
    border: solid;          border: solid;   ← pass-through to canonical
  }                       call-site-2:
                            color: blue;     ← different replacement
                            border: solid;   ← same pass-through
                          call-site-3:
                            color: green;    ← different replacement
                            border: solid;   ← same pass-through
```

Three positions in the evaluated tree. One canonical `border: solid`. Three different `color` replacements.

### No cloning

There is no deep clone. There is no shallow clone of the body. The evaluated tree IS the result — it's a sparse structure that says "at this position, use this replacement instead of canonical."

The only new objects created during eval are:
- The replacement nodes themselves (which would be created anyway — `evalNode` returns new nodes when values change)
- The position entries in the result map (one Map entry per replacement)

### What replaces clone(true)

Today: `clone(true)` creates a full copy of the mixin body tree per call. Each copy is mutated during eval.

Target: Each call creates a **position context** (lightweight — just a Map). The canonical body is walked. Each node evaluates. If the result differs from canonical, it's stored in the position's result map. The position context IS the "clone" — but it's O(R) where R = number of replacements, not O(N) where N = total nodes.

## Data Structures

### EvalSession

One per top-level evaluation. Owns the evaluated tree.

```ts
class EvalSession {
  /** The result map: canonical node → evaluated replacement at a position */
  results: Map<PositionKey, Node>;

  /** Session-wide caches (scopes, registries, etc.) */
  // ...
}
```

### EvalPosition

One per reused placement (mixin call, repeated import).

```ts
class EvalPosition {
  readonly session: EvalSession;
  readonly sourceRoot: Node;  // the canonical subtree being reused

  /** Sparse result map: canonical child → evaluated replacement */
  results: Map<Node, Node>;

  /** Binding deltas (mixin params, import overrides) */
  bindings?: Map<string, Node>;
}
```

When iterating children of a canonical Rules during eval under a EvalPosition:
- For each canonical child, check `positionContext.results.get(child)`
- If found: use the replacement
- If not found: the child is unchanged — use it directly (pass-through)

### How eval works with this model

```
evalMixin(canonicalBody, params, context):
  position = new EvalPosition(session, canonicalBody)
  position.bindings = params

  for each child in canonicalBody.children:
    result = child.eval(context)  // context carries position
    if result !== child:
      position.results.set(child, result)
    // if result === child: no entry needed (pass-through)

  return position  // this IS the evaluated mixin body
```

### How serialization works

When serializing the evaluated tree, walk positions:

```
serialize(node, context):
  position = context.position
  if position && position.results.has(node):
    return serialize(position.results.get(node), context)
  return node.toTrimmedString(context)
```

### What this replaces

| Old | New |
|-----|-----|
| `clone(true)` per mixin call | `new EvalPosition()` per call |
| `clone(false)` + session adoption | Direct canonical traversal + result map |
| `maybeClone()` in preEval | Not needed — canonical is never mutated |
| `ShadowEntry` with field patches + runtime | `results: Map<Node, Node>` |
| Children overlays | Not needed — walk canonical children, check result map |
| IR-aware mutators | Not needed — eval returns new nodes, stored in result map |

## What evalNode must do

`evalNode` returns either:

- `this` (canonical) — the node is unchanged by eval (pass-through)
- A **replacement node** — the evaluated result (e.g., `@color` → `red`)

The replacement is the **virtual node** — it's the natural output of evaluation, not a clone. It gets stored in the position's result map.

`evalNode` must NOT mutate `this` (the canonical node). Most `evalNode` implementations already work this way — they return `this` or construct a new result.

## What preEval must do

`preEval` resolves dynamic names, sets up registries, etc. With this model:

- `preEval` should NOT clone (`maybeClone` is eliminated)
- `preEval` can read canonical fields (immutable)
- `preEval` returns `this` (unchanged) or a replacement node
- Replacements go into the position's result map

## Registry with this model

Registries index the canonical children for O(1) lookup. That doesn't change. When a position has binding deltas (mixin params), the registry lookup checks:

1. Position bindings first (mixin params override)
2. Canonical registry (the pre-built index)

No per-position registry needed for most cases. The canonical registry + binding deltas covers it.

## What stays from current implementation

- `EvalSession` concept ✓ (renamed/simplified)
- Session-aware field access helpers ✓ (simplified — just check result map)
- `node._instanceRoot` concept → becomes `node._position` (which EvalPosition this node belongs to)
- Registry infrastructure ✓ (indexes canonical, checks bindings)

## What gets removed

- `ShadowEntry` (field patches, runtime state) → replaced by simple result map
- Children overlays → not needed
- IR-aware `_setChildAt`, `_setChildren`, `push`, `splice`, `unshift` → not needed for this model
- `maybeClone` → eliminated
- `clone(true)` in mixin body path → eliminated
- Per-node eval state tracking in IR → eval state is implicit (has result = evaluated)

## Migration from current to target

### Phase 1: Introduce EvalPosition alongside existing infrastructure
- Create `EvalPosition` class
- Use it in `evalMixinDirect` instead of `SessionInstanceRoot`
- The result map starts empty; eval populates it

### Phase 2: Make eval pipeline position-aware
- When position is active, `evalNode` returns go to `position.results`
- When reading children, check `position.results` before canonical
- `maybeClone` returns `this` when position active

### Phase 3: Remove cloning from mixin path
- `clone(true)` → walk canonical with position
- `clone(false)` → not needed
- Remove children overlays, ShadowEntry, IR-aware mutators

### Phase 4: Clean up
- Remove `SessionInstanceRoot` (replaced by `EvalPosition`)
- Simplify session helpers (just check position result map)
- Remove `maybeClone` entirely
