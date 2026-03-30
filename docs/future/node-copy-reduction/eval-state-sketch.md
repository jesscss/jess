# Render-Key Cursor Sketch

## Target

This is the target model.

The older `EvalState` / `NodeState` design is deprecated.

## Core Idea

- keep one canonical tree
- canonical nodes own canonical edges
- canonical nodes may also own alternate edges keyed by render key
- `RenderKey` is only the path-selection key
- traversal carries a cursor: `{ node, key }`

## Constraint

The important constraint is not "never mutate a node."

The important constraint is:

- do not mutate canonical node data in a way that changes which structure or
  serialized output it represents across render paths

So harmless runtime flags can live directly on nodes if they do not alter
structural or serialization identity.

That also means:

- one node has one local value
- if local node data changes, that is a new node
- per-render variation lives in edges, not field patches
- direct node fields stay direct fields

## Minimal Types

```ts
type RenderKey = object | symbol;

type NodeEdge<T> = Map<RenderKey, T>;

type Node = {
  /**
   * Canonical/default parent edge.
   */
  parent?: Node;

  /**
   * Alternate parent edges keyed by render key.
   */
  parentEdges?: NodeEdge<Node>;

  /**
   * Alternate child edges keyed by child-field name.
   *
   * For singular child fields:
   *   Map<RenderKey, Node>
   *
   * For list-shaped child fields:
   *   Array<Map<RenderKey, Node> | undefined>
   */
  childEdges?: Map<
    string,
    NodeEdge<Node> | Array<NodeEdge<Node> | undefined>
  >;
};

type Cursor = {
  node: Node;
  key: RenderKey;
};
```

## Why `RenderKey` Exists

If one canonical node is reused in multiple live placements, upward traversal
becomes ambiguous.

Example:

- canonical node `X` is reached from call site A
- the same canonical node `X` is also reached from call site B
- `X.parent` cannot mean both parents at once

So we need a key for:

- which live placement/path are we on?

That key is `RenderKey`.

Examples of render keys:

- canonical token
- eval token
- mixin instance key
- loop instance key
- stylesheet instance key

`RenderKey` is not a patch owner. It is only the selector for which alternate
edge to follow.

`NodeEdge` uses `Map`, not `WeakMap`, because these keyed edges live on the
nodes themselves and the whole tree can be discarded after serialization/eval.

## Why `Cursor` Exists

A naked `Node` is not enough for traversal of shared nodes.

It tells you where you are in the canonical graph, but not which render path
you are on.

So traversal needs both:

- current node
- current render key

That pair is the cursor.

## Traversal

- downward traversal returns a new `Cursor`
- upward traversal accepts a `Cursor`
- serialization keeps track of the current cursor as it walks
- eval may temporarily carry the current cursor in context, but the cursor is
  the real source of truth

### Edge Helpers

```ts
function lookupEdge<T>(
  edges: Map<RenderKey, T> | undefined,
  key: RenderKey
): T | undefined {
  return edges?.get(key);
}

function getParentEdge(cursor: Cursor): Cursor | undefined {
  const overridden = lookupEdge(cursor.node.parentEdges, cursor.key);
  if (overridden !== undefined) {
    return overridden ? { node: overridden, key: cursor.key } : undefined;
  }

  return cursor.node.parent
    ? { node: cursor.node.parent, key: cursor.key }
    : undefined;
}

function getEdge(cursor: Cursor, key: string): Cursor | undefined {
  const entry = cursor.node.childEdges?.get(key);
  if (entry instanceof Map) {
    const overridden = lookupEdge(entry, cursor.key);
    if (overridden !== undefined) {
      return overridden ? { node: overridden, key: cursor.key } : undefined;
    }
  }

  const canonicalChild = (cursor.node as Record<string, unknown>)[key] as Node | undefined;
  return canonicalChild ? { node: canonicalChild, key: cursor.key } : undefined;
}

function getEdgeAt(cursor: Cursor, key: string, index: number): Cursor | undefined {
  const entry = cursor.node.childEdges?.get(key);
  if (Array.isArray(entry)) {
    const overridden = lookupEdge(entry[index], cursor.key);
    if (overridden !== undefined) {
      return overridden ? { node: overridden, key: cursor.key } : undefined;
    }
  }

  const canonicalList = (cursor.node as Record<string, unknown>)[key] as Node[] | undefined;
  const canonicalChild = canonicalList?.[index];
  return canonicalChild ? { node: canonicalChild, key: cursor.key } : undefined;
}
```

## What Carries The Cursor

Whatever is actively walking the graph.

Usually:

- serializer traversal stack
- eval traversal stack
- visitor/search traversal

Operationally:

1. save current cursor
2. move to a new cursor
3. walk there
4. restore previous cursor

So yes: this is a cursor stack model.

## Fit With Current `core`

`core` nodes already expose named child fields through `childKeys`.

Examples:

- `Ruleset` fundamentally has `selector`, `rules`, `guard`
- `Call` has `name`, `args`, `contentNode`
- `Rules` has `value`

So the traversal model is not:

- one global homogeneous `children` bag

It is:

- named child fields
- some singular
- some list-shaped

That is why canonical access should stay direct:

```ts
ruleset.selector
ruleset.rules
call.args
expression.value
```

Only edge traversal should need helpers:

```ts
getEdge(cursor, 'rules');
getEdge(cursor, 'selector');
getEdgeAt(cursor, 'value', 3);
```

## `Ruleset` Example

```ts
class Ruleset extends Node {
  static override childKeys = [
    'selector',
    'rules',
    'guard'
  ] as const;

  readonly selector!: Selector | Nil;
  readonly rules!: Rules;
  readonly guard!: Condition | Nil | undefined;
}
```

Notes:

- the current runtime still has `selectorBeforeExtend`
- that should be treated as transitional baggage, not part of the minimal target
  model
- if a pre-extend selector snapshot is still needed later, it should be
  represented explicitly at that point rather than promoted into this core shape

## What Is Not In The Main Model

These are intentionally not part of the default shape:

- `.get()` / `.set()` as the target access model
- field patches
- render-root-owned patch tables
- replacement links like `replacedBy`
- `/** @internal */` field markers on ordinary child fields

If one of those later proves unavoidable for a specific case, it should be
added as an explicit future extension, not baked into the main model now.

## Why This Is Simpler

- one node has one local value
- direct fields are just direct fields
- only edge traversal needs the render key
- no detached patch-table architecture
- no `_carriedState` / `subtreeMap` style rescue path for serialization
- no pretending a naked node can answer render-aware parent questions
- no routine deep cloning just to isolate placements

Instead:

- canonical nodes keep canonical structure
- alternate edges live with the node they belong to
- render key selects the path
- cursor carries `node + key`

## Future Considerations Only If Proven Necessary

These are not part of the target model, but could be added later if profiling
or runtime constraints prove they are needed:

- a more specialized physical layout for indexed child edges
- caching/flattening for render-root parent fallback
- a special root-entry replacement mechanism if edge rewiring is truly not enough
