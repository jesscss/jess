# Session Instance Architecture

## Purpose

This is the target architecture doc.

Use it to reason about:

- how the final runtime should work
- what data structures are acceptable
- how repeated imports/mixins/functions should reuse one immutable source tree
- how sparse shadow state should work across broad trees

This doc is about the destination, not the bridge helpers.

## Performance Motivation

The guiding star for this entire architecture is **performance**. Specifically:

JIT engines (V8, JSC, SpiderMonkey) are most slowed down by **object creation** — allocation pressure, GC pauses, and cache misses from scattered heap objects. Deep cloning an AST subtree per mixin call or import creates thousands of short-lived objects that the GC must collect.

The instance-root model eliminates this by keeping one canonical tree and overlaying sparse shadow state per placement. Instead of N cloned trees, there is 1 canonical tree + N thin shadow maps. The objects that DO get created (shadow entries) are small, flat, and few — only for nodes that actually diverge.

This is why:

- **Deep cloning is the primary target** — it creates the most objects
- **Shallow cloning is secondary** — fewer objects but still unnecessary
- **Materialization is only at the output boundary** — one-time cost, not per-eval
- **Instance roots are Maps, not trees** — flat structure, cache-friendly

Every design decision should be evaluated against: "does this reduce object creation during eval?"

## Core Model

Jess should evaluate against:

- one immutable canonical/source tree
- many lazy session-local instances over that tree
- sparse shadow state only where behavior diverges

That means:

- no deep clone as the default eval mechanism
- no one-overlay-per-canonical-node model
- no public API growth just to thread instance identity around

## The Runtime Objects

### Canonical source node

The authored node.

- immutable during eval
- stable identity
- shared by every import/call/reuse that originates from it

### EvalSession

One evaluation run.

It owns:

- the active instance roots
- dependency tracking for that run
- session-wide caches that are actually session-wide

It is not “the overlay for a node.”

### SessionInstanceRoot

One distinct evaluated placement of a canonical subtree.

Examples:

- import #2 of a stylesheet
- mixin call #3
- stylesheet-function result for one call site
- one reused `Rules` subtree appearing under a different parent chain

This root owns sparse state for that placement only.

Minimal shape:

```ts
type SessionInstanceRoot = {
  session: EvalSession;
  sourceRoot: Node;
  bindings?: BindingDelta;
  overrides: Map<Node, ShadowEntry>;
  runtime?: Map<Node, RuntimeEntry>;
  dependencyReach?: DependencyReach;
};
```

The exact fields can change. The important rule is:

- sparse state belongs to the instance root
- not to one global `WeakMap<canonicalNode, overlay>`

### Lazy node view

A node-shaped runtime object backed by:

- one canonical source node
- one instance root

It should behave like a normal node:

- `node.value`
- `node.parent`
- `node.eval(context)`

It should not require:

- explicit instance parameters
- a second public API for ordinary node work

This is “proxy-like without requiring JS `Proxy`.”

## Sparse Shadow State

Most source nodes should have no local state at all.

Only touched or dependency-affected nodes should have an entry.

Illustrative shape:

```ts
type ShadowEntry = {
  fieldPatches?: Record<string, unknown>;
  runtime?: {
    parent?: Node;
    sourceParent?: Node;
    index?: number;
    pre?: number;
    post?: number;
    evaluated?: boolean;
    preEvaluated?: boolean;
  };
  childOverrides?: {
    replacedChildren?: readonly Node[];
  };
};
```

The exact encoding is not the point.

The point is:

- sparse
- lazy
- attached to one instance root

## Read Model

When runtime code reads from a node view:

1. resolve the view’s instance root
2. check for a local shadow entry for that source node
3. return the patched field if present
4. otherwise fall back to the canonical source node
5. for child nodes/arrays:
   - return child views in the same instance root
   - unless a child override already exists

This gives:

- no broad object creation for untouched subtrees
- normal-looking node access
- source fallback by default

## Write Model

On first divergence for one source node inside one instance root:

1. allocate a local shadow entry
2. record only the changed field/runtime/child override
3. leave the rest of the subtree source-backed

If there is no divergence:

- no shadow entry
- no broad clone

That is the actual “clone without the deep clone” model.

## Lazy Creation Rule

Node views should be created lazily.

Creating one instance root must not imply creating a whole object graph.

The runtime should only pay for:

- a root object for the placement
- local shadow entries for real divergence
- local node views for paths that are actually touched

If one param change affects one declaration path, only that slit of the tree should become local.

## Dependency Graph

The dependency graph is part of the runtime architecture, not a later optimization.

It should answer:

- what inputs changed at this instance root
- which downstream paths actually depend on those inputs
- which nodes therefore need local shadow state

That is how a broad source tree can still have a very thin session shadow.

## Basic Example: Import The Same File 3 Times

Canonical source:

```jess
// tokens.jess
@color: red;
.button { color: @color; }
```

Use:

```jess
@import (multiple) "tokens";
@import (multiple) "tokens" with (@color: blue);
@import (multiple) "tokens" with (@color: green);
```

Desired runtime:

- one canonical parsed tree for `tokens.jess`
- three instance roots:
  - `import#1`
  - `import#2`
  - `import#3`

Desired sparsity:

- `import#1`: maybe no shadow entry at all
- `import#2`: one binding delta and only the declaration path affected by `@color`
- `import#3`: same pattern with a different binding value

What must not happen:

- a cloned tree per import
- a shadow entry for every node in the file

## Basic Example: Mixin Called 3 Times

Canonical source:

```jess
.theme(@fg, @bg) {
  color: @fg;
  border: 1px solid black;
  background: @bg;
}
```

Use:

```jess
.a { .theme(red, white); }
.b { .theme(red, white); }
.c { .theme(red, blue); }
```

Desired runtime:

- one canonical mixin body
- three instance roots:
  - `call#a`
  - `call#b`
  - `call#c`

Desired sparsity:

- `call#a` and `call#b` differ mainly in placement/provenance
- `call#c` needs a changed path for `background`
- `border` stays source-backed in all three

What must not happen:

- a cloned mixin body per call
- one overlay object per declaration just because the mixin ran

## Multiple Sessions vs Multiple Instances

These are different.

### Multiple sessions

Different top-level evaluations may each have their own `EvalSession`.

That is normal.

### Multiple instances in one session

This is the key requirement.

Inside one session, the same canonical subtree may need:

- multiple parents
- multiple sourceParent chains
- multiple binding deltas
- multiple dependency reaches

That is why one node-keyed overlay is not enough.

## Minimal Implementation Sketch

The simplest acceptable direction is:

1. keep canonical nodes as the authored immutable objects
2. add instance roots for reused placements
3. add lazy node views backed by `source node + instance root`
4. move runtime/provenance state onto the instance root shadow entries
5. use dependency reach to keep shadow entries narrow

Do not start by generating a second full tree.

## Sunset List

The following are bridge code, not destination concepts:

- growing families of `sessionGet*` / `sessionSet*`
- growing wrapper-helper taxonomies
- treating `WeakMap<canonicalNode, runtime>` as the main runtime identity model
- internal materialization used to rescue eval paths

Any bridge helper that survives should map to one of:

- instance root creation
- lazy node view creation
- sparse shadow entry mutation

## Short Version

The final model is:

- immutable source tree
- many lazy session-local instances
- sparse dependency-guided shadow state
- unchanged node API

Everything still left on this branch should move toward that model directly.
