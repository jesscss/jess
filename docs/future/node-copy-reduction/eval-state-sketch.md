# Render-Key Cursor Sketch

## Target

This is the target model.

The older `EvalState` / `NodeState` design is deprecated.

## Core Idea

- keep one canonical tree
- canonical nodes own canonical edges
- canonical nodes may also own alternate edges keyed by render key
- `RenderKey` is only the path-selection key
- traversal carries a cursor: `{ node, renderKey }`

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

const CANONICAL: unique symbol = Symbol('CANONICAL');
const EVAL: unique symbol = Symbol('EVAL');

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
};

type Cursor = {
  node: Node;
  renderKey: RenderKey;
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

That path selector is `RenderKey`.

Examples of render keys:

- `CANONICAL`
- `EVAL`
- mixin instance key
- loop instance key
- stylesheet instance key

Important distinction:

- no explicit canonical key does **not** mean "force canonical"
- ordinary traversal should follow the current cursor key
- an explicit canonical key is what forces canonical edges

So:

- `Cursor.renderKey` = "which path am I currently walking?"
- `CANONICAL` = "ignore alternates and force canonical edges"

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

## Lookup Inputs

Path selection should depend on the smallest thing that actually decides the
path.

So:

- if the operation only needs alternate-edge selection, pass `renderKey`
- if the operation needs both location and path, pass a `Cursor`
- only pass full `Context` when the operation truly needs eval machinery beyond
  path selection

The goal is:

- fewer property lookups per call
- clearer semantics at the call site
- no accidental reintroduction of "pass context to everything" just to find the
  current edge

So the preferred split is:

- `node.get('rules', renderKey)` for edge/path selection
- `getEdge(cursor, 'rules')` / `getParentEdge(cursor)` for traversal
- `node.get('rules', context)` only while a surface still genuinely mixes
  render-path selection with old state-overlay reads

## Function Boundary Rule

Custom/user-function boundaries should not have to understand render keys.

So:

- internal engine traversal stays cursor-based
- function-call evaluation may use cursor/view semantics internally
- but values handed to custom functions should already be current-view nodes for
  that call

That means userland/custom-function code can stay node-centric:

- inspect direct fields on the handed-off node
- call ordinary node methods on that handed-off node
- avoid carrying cursor semantics through every external API

This is an allowed boundary where "current-view node" handoff is acceptable.
It is not a license to reintroduce generic internal materialization as the
default engine strategy.

### Field-Aligned Edge Shape

Canonical child fields stay as the actual canonical value.

Alternate edges mirror the node's real field shape instead of living in a
generic `childEdges` table.

For singular children:

```ts
class Ruleset extends Node {
  selector: Selector | Nil;
  selectorEdge?: NodeEdge<Selector | Nil>;

  rules: Rules;
  rulesEdge?: NodeEdge<Rules>;

  guard?: Condition | Nil;
  guardEdge?: NodeEdge<Condition | Nil | undefined>;
}
```

For list-shaped children:

```ts
class Rules extends Node {
  value: Node[];
  valueEdges?: Array<NodeEdge<Node> | undefined>;
}
```

So:

- canonical field = actual canonical child/children
- `fooEdge` = optional alternate singular child by render key
- `fooEdges` = optional alternate indexed children by render key

Generic `childEdges` maps are temporary migration scaffolding only, not the
target architecture.

### Local `Rules` Wrappers

Local scope registries should live on shallow `Rules` wrappers, not on the
canonical `Rules` node and not in detached EvalState registry tables.

That means:

- canonical `Rules` keeps the canonical `value`
- shallow wrapper `Rules` can own local declaration/mixin/ruleset registries
- the wrapper may still point at the same `value` and `valueEdges`
- the wrapper may store the `renderKey` it was created for
- only actual structural divergence should force a new child array

So a shallow wrapper is allowed to exist purely to own:

- scope-local registries
- scope-local options/visibility
- scope-local identity for lookup

without eagerly cloning the child array it is wrapping.

### Edge Helpers

```ts
function lookupEdge<T>(
  edges: Map<RenderKey, T> | undefined,
  renderKey: RenderKey
): T | undefined {
  return edges?.get(renderKey);
}

function getParentEdge(cursor: Cursor): Cursor | undefined {
  const overridden = lookupEdge(cursor.node.parentEdges, cursor.renderKey);
  if (overridden !== undefined) {
    return overridden ? { node: overridden, renderKey: cursor.renderKey } : undefined;
  }

  return cursor.node.parent
    ? { node: cursor.node.parent, renderKey: cursor.renderKey }
    : undefined;
}

function getEdge(cursor: Cursor, key: string): Cursor | undefined {
  const edgeKey = `${key}Edge` as keyof Node;
  const edge = (cursor.node as Record<string, unknown>)[edgeKey as string] as NodeEdge<Node> | undefined;
  const overridden = lookupEdge(edge, cursor.renderKey);
  if (overridden !== undefined) {
    return overridden ? { node: overridden, renderKey: cursor.renderKey } : undefined;
  }
  const canonicalChild = (cursor.node as Record<string, unknown>)[key] as Node | undefined;
  return canonicalChild ? { node: canonicalChild, renderKey: cursor.renderKey } : undefined;
}

function getEdgeAt(cursor: Cursor, key: string, index: number): Cursor | undefined {
  const edgesKey = `${key}Edges` as keyof Node;
  const edges = (cursor.node as Record<string, unknown>)[edgesKey as string] as Array<NodeEdge<Node> | undefined> | undefined;
  if (edges) {
    const overridden = lookupEdge(edges[index], cursor.renderKey);
    if (overridden !== undefined) {
      return overridden ? { node: overridden, renderKey: cursor.renderKey } : undefined;
    }
  }

  const canonicalList = (cursor.node as Record<string, unknown>)[key] as Node[] | undefined;
  const canonicalChild = canonicalList?.[index];
  return canonicalChild ? { node: canonicalChild, renderKey: cursor.renderKey } : undefined;
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
