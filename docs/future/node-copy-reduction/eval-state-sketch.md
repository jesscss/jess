# Render-Root Cursor Sketch

## Target

This is the target model.

The older `EvalState` / `NodeState` design is deprecated.

## Core Idea

- keep one canonical tree
- canonical nodes own canonical edges
- canonical nodes may also own alternate edges keyed by render root
- `RenderRoot` is only the path-selection key
- traversal carries a cursor: `{ node, root }`

## Constraint

The important constraint is not "never mutate a node."

The important constraint is:

- do not mutate canonical node data in a way that changes which structure or
  serialized output it represents across render paths

So harmless runtime flags can live directly on nodes if they do not alter
structural or serialization identity.

## Minimal Types

```ts
type RenderRoot = {
  parent?: RenderRoot;
};

type RenderEdge<T> = WeakMap<RenderRoot, T>;

type IndexedChildEdges = Map<number, RenderEdge<Node | null>>;

type ChildEdgeValue =
  | RenderEdge<Node | null>
  | IndexedChildEdges;

type Node = {
  /**
   * Canonical/default parent edge.
   */
  parent?: Node;

  /**
   * Alternate parent edges keyed by render root.
   */
  parentEdges?: RenderEdge<Node | null>;

  /**
   * Alternate child edges keyed by child-field name.
   *
   * For singular child fields:
   *   WeakMap<RenderRoot, Node | null>
   *
   * For list-shaped child fields:
   *   Map<number, WeakMap<RenderRoot, Node | null>>
   */
  childEdges?: Map<string, ChildEdgeValue>;
};

type Cursor = {
  node: Node;
  root: RenderRoot;
};
```

## Why `RenderRoot` Exists

If one canonical node is reused in multiple live placements, upward traversal
becomes ambiguous.

Example:

- canonical node `X` is reached from call site A
- the same canonical node `X` is also reached from call site B
- `X.parent` cannot mean both parents at once

So we need a key for:

- which live placement/path are we on?

That key is `RenderRoot`.

`RenderRoot` is not a patch owner. It is only the selector for which alternate
edge to follow.

## Why `Cursor` Exists

A naked `Node` is not enough for traversal of shared nodes.

It tells you where you are in the canonical graph, but not which render path
you are on.

So traversal needs both:

- current node
- current render root

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
  edges: WeakMap<RenderRoot, T> | undefined,
  root: RenderRoot
): T | undefined {
  let current: RenderRoot | undefined = root;
  while (current) {
    const hit = edges?.get(current);
    if (hit !== undefined) {
      return hit;
    }
    current = current.parent;
  }
  return undefined;
}

function getParent(cursor: Cursor): Cursor | undefined {
  const overridden = lookupEdge(cursor.node.parentEdges, cursor.root);
  if (overridden !== undefined) {
    return overridden ? { node: overridden, root: cursor.root } : undefined;
  }

  return cursor.node.parent
    ? { node: cursor.node.parent, root: cursor.root }
    : undefined;
}

function getChild(cursor: Cursor, key: string): Cursor | undefined {
  const entry = cursor.node.childEdges?.get(key);
  if (entry instanceof WeakMap) {
    const overridden = lookupEdge(entry, cursor.root);
    if (overridden !== undefined) {
      return overridden ? { node: overridden, root: cursor.root } : undefined;
    }
  }

  const canonicalChild = (cursor.node as Record<string, unknown>)[key] as Node | undefined;
  return canonicalChild ? { node: canonicalChild, root: cursor.root } : undefined;
}

function getChildAt(cursor: Cursor, key: string, index: number): Cursor | undefined {
  const entry = cursor.node.childEdges?.get(key);
  if (entry instanceof Map) {
    const overridden = lookupEdge(entry.get(index), cursor.root);
    if (overridden !== undefined) {
      return overridden ? { node: overridden, root: cursor.root } : undefined;
    }
  }

  const canonicalList = (cursor.node as Record<string, unknown>)[key] as Node[] | undefined;
  const canonicalChild = canonicalList?.[index];
  return canonicalChild ? { node: canonicalChild, root: cursor.root } : undefined;
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

That is why the runtime API should feel like:

```ts
getChild(cursor, 'rules');
getChild(cursor, 'selector');
getChildAt(cursor, 'value', 3);
```

## `Ruleset` Example

```ts
class Ruleset extends Node {
  static override childKeys = [
    'selector',
    'rules',
    'guard'
  ] as const;

  selector!: Selector | Nil;
  rules!: Rules;
  guard!: Condition | Nil | undefined;
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

- field patches
- render-root-owned patch tables
- replacement links like `replacedBy`

If one of those later proves unavoidable for a specific case, it should be
added as an explicit future extension, not baked into the main model now.

## Why This Is Simpler

- no detached patch-table architecture
- no `_carriedState` / `subtreeMap` style rescue path for serialization
- no pretending a naked node can answer render-aware parent questions
- no routine deep cloning just to isolate placements

Instead:

- canonical nodes keep canonical structure
- alternate edges live with the node they belong to
- render root selects the path
- cursor carries `node + root`

## Future Considerations Only If Proven Necessary

These are not part of the target model, but could be added later if profiling
or runtime constraints prove they are needed:

- a more specialized physical layout for indexed child edges
- caching/flattening for render-root parent fallback
- a special root-entry replacement mechanism if edge rewiring is truly not enough
