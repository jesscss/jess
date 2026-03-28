# State-Aware Node Access: DX Proposal

## The Real Question

Can `node.value` return the eval'd value without cloning the node?

Today, EvalState stores field patches in an untyped `Map<string, unknown>`.
Reading them requires `getField(node, 'value', ctx)` — which loses typing,
requires context everywhere, and leaks internal plumbing into tests and
external consumers. The test code `expect(getField(node, 'value', ctx))`
is a code smell.

The goal: **zero-clone DX** where `node.value` on an "evaluated node"
returns the eval'd value with full TypeScript types, but the canonical
tree is still recoverable.

---

## How Node Data Actually Works

Every node has typed `readonly` instance fields set in the constructor:

```ts
class Declaration extends Node<DeclarationValue> {
  static childKeys = ['name', 'value', 'important'] as const;

  readonly name!: NameValue;       // typed instance field
  readonly value!: Node;           // typed instance field
  readonly important: Any | undefined;

  constructor(data: DeclarationValue, ...) {
    this.name = data.name;
    this.value = data.value;
    this.important = data.important;
  }
}

class Url extends Node<Quoted | Any> {
  static childKeys = ['value'] as const;
  readonly value!: Quoted | Any;   // typed instance field

  constructor(value: Quoted | Any, ...) {
    this.value = value;
  }
}
```

`childKeys` declares which instance fields hold child nodes. This drives
cloning, adoption, serialization, and the `setData` API.

Leaf nodes (`childKeys = null`) like Dimension and Color are immutable —
they're created with their final value and never patched. They're always
handled via whole-node **replacement** in EvalState, never field patches.

Container/composite nodes (Declaration, Url, Ruleset, etc.) are where
field patches happen: the node keeps its identity but a child changes
(e.g., Url's `value` evaluates to a different Quoted).

---

## What Gets Field-Patched vs Replaced

| Category | Examples | Eval Strategy | DX Impact |
|---|---|---|---|
| Immutable leaves | Dimension, Color, Keyword | **Replacement** (new node) | None — consumer sees replacement |
| Expressions | Operation, Sequence | **Replacement** (computed result) | None |
| Containers w/ eval'd children | Url, Declaration, Quoted | **Field patch** on canonical | **Broken** — `node.value` is stale |
| Tree structure | Rules (children), Ruleset (selector) | **Field patch** | **Broken** |
| Metadata | parent, index, options | **Field patch** | Internal-only, doesn't matter |

The DX problem is specifically containers with eval'd children — maybe
15 node classes total. And even within those, only the `childKeys` fields
need the eval'd view. Metadata fields (parent, index) are internal.

---

## Approach: Lightweight Eval'd Node (Object.create + field overlay)

When eval patches fields on a node, instead of (or in addition to) writing
to the untyped `NodeState._fields` Map, produce a **lightweight eval'd
node** that shares the canonical node's prototype and most properties but
has the patched fields as real, typed instance properties.

```ts
// Inside Url.evalNode:
evalNode(context: Context): MaybePromise<Url> {
  const value = this.value;
  const finish = (nextValue: Quoted | Any): Url => {
    if (nextValue === value) return this;
    // Create lightweight eval'd node — shares prototype, overrides value
    return this.withChildUpdates({ value: nextValue }, context);
  };
  return pipe(value.eval(context), finish);
}
```

`withChildUpdates` creates a node that:
1. Shares the canonical node's prototype (same methods, same type)
2. Has the updated fields as real typed instance properties
3. Links back to the canonical node (for recovery)
4. Costs one `Object.create` + property assignments (no constructor call)

```ts
// On Node base class:
withChildUpdates<T extends Node>(
  this: T,
  updates: Partial<Record<string, Node | Node[]>>,
  context?: Context
): T {
  const ck = (this.constructor as typeof Node).childKeys;
  if (!ck) return this; // leaf node — shouldn't happen

  // Create new object with same prototype (inherits all methods + type)
  const evalNode = Object.create(Object.getPrototypeOf(this)) as T;

  // Copy ALL own properties from canonical (state, flags, location, etc.)
  // This is cheap — instance fields are few and flat.
  const keys = Object.keys(this);
  for (const key of keys) {
    (evalNode as any)[key] = (this as any)[key];
  }

  // Override with eval'd children (typed — updates matches the fields)
  for (const [key, value] of Object.entries(updates)) {
    (evalNode as any)[key] = value;
  }

  // Link back to canonical
  evalNode._canonical = this;

  // Adopt new children
  if (context) {
    for (const value of Object.values(updates)) {
      if (value instanceof Node) {
        value.parent = evalNode;  // or via setParent
      }
    }
  }

  return evalNode;
}
```

### What this gives us

```ts
const urlNode = url(quoted('a.png'));        // canonical
const evald = await urlNode.eval(ctx);       // lightweight eval'd node

evald.value           // quoted('b.png') — TYPED, real property
urlNode.value         // quoted('a.png') — canonical untouched
evald._canonical      // urlNode — can recover canonical

evald instanceof Url  // true (shares prototype)
evald.type            // 'Url' (from prototype)
evald.toTrimmedString // same method (from prototype)
```

Tests become:
```ts
const evald = await node.eval(ctx);
expect(evald.value).toBe(replacement);  // typed, natural
expect(node.value).toBe(original);      // canonical preserved
```

External consumers (visitors, functions) receive `evald` — a real typed
node with real typed properties. No `getField`, no context required.

### Cost analysis

**Per field-patched eval:**
- One `Object.create` (allocates empty object with prototype link)
- One property copy loop (typically 5-10 own properties)
- One or two property overrides (the changed fields)

**Compare to:**
- Full clone (`node.clone(true)`): constructor call + deep copy of all
  children + adoption + parent wiring = much heavier
- Field patch (`setField`): zero allocation, but loses typing and
  requires context for every read

**In a Bootstrap compile:**
- ~hundreds of Declarations, Urls, Rulesets get field-patched
- Each gets one lightweight eval'd node
- Total: hundreds of `Object.create` calls — trivial vs. the old model
  which deep-cloned entire subtrees

---

## How This Interacts with EvalState

### Option 1: Replace NodeState._fields entirely

Eval'd nodes replace the field patch mechanism. Instead of:
```ts
setField(this, 'value', nextValue, context);
return this; // same canonical node
```

Do:
```ts
const evald = this.withChildUpdates({ value: nextValue });
ctx.activeState.get(this).replacement = evald;
return evald; // new lightweight node
```

**Every field-patched eval becomes a replacement.** The EvalState only
stores replacements and metadata flags, never untyped field patches for
child nodes.

`NodeState._fields` still exists for internal metadata (parent, index,
registry deltas) — these are never read by external consumers, so the
untyped Map is fine for them.

**Pros:**
- `getField` for childKeys data disappears from production code
- All `_getField(context?)` private getters become unnecessary
- Tests and external consumers just use typed properties
- EvalState becomes simpler — mostly replacement + metadata

**Cons:**
- More objects than pure field patching
- The eval'd node needs to participate in parent chains, registry, etc.
- Need to decide: does `eval()` return the eval'd node or canonical?

### Option 2: Eval'd nodes as the "serialization view"

Keep `setField` during eval (internal hot path). At the **serialization
boundary**, create eval'd nodes from the state overlay:

```ts
function evalView<T extends Node>(node: T, ctx: Context): T {
  const ns = ctx.activeState.peek(node);
  if (!ns?._fields?.size) return node;

  const ck = (node.constructor as typeof Node).childKeys;
  if (!ck) return node;

  // Build updates from patched childKeys only
  const updates: Record<string, unknown> = {};
  for (const key of ck) {
    const patched = ns._fields.get(key!);
    if (patched !== undefined) {
      updates[key!] = patched;
    }
  }
  if (Object.keys(updates).length === 0) return node;

  return node.withChildUpdates(updates);
}
```

The visitor system, serializer, and test helpers call `evalView` to get
a typed node. Internal eval code keeps using `setField`/`getField`.

**Pros:**
- No change to eval hot path
- Eval'd nodes only created when needed (serialization, visitor dispatch)
- Internal code unchanged

**Cons:**
- Two representations exist: field-patched canonical (during eval) and
  eval'd node (at boundaries). Must keep them in sync.
- `evalView` allocates at the boundary — not free, but only where needed

### Option 3: Eval'd nodes co-mingled in the canonical tree

The eval'd node IS the child of the parent in the evaluated tree. The
canonical node is still reachable via `_canonical`. The tree is a mix
of canonical nodes (where nothing changed) and eval'd nodes (where
children were updated).

```
Canonical tree:              Evaluated tree:
  Root Rules                   Root Rules (same object)
    Decl name=@x value=1        Decl' name=@x value=2    ← eval'd node
    Url value="@{v}.png"        Url' value="b.png"        ← eval'd node
    Ruleset .a                   Ruleset .a (same object)
      Rules                        Rules (same, children patched)
        Decl color=@c                Decl' color=red       ← eval'd node
```

Nodes without changes are shared. Nodes with changed children are
lightweight eval'd copies. The evaluated tree is a new tree that
**shares most of its nodes** with the canonical tree.

**Recovery:** Walk the tree. For each node, check `_canonical`. If present,
it's an eval'd overlay — the canonical is `node._canonical`. If absent,
it IS the canonical.

**This is essentially structural sharing** — the same idea as immutable
data structures (Immer, Immutable.js), but applied to the AST. Only the
spine from the changed node to the root gets new objects. Unchanged
subtrees are shared.

---

## The Structural Sharing Model (Option 3, detailed)

### During eval

When a node's child changes, `evalNode` returns a lightweight copy:

```ts
// Url.evalNode
evalNode(context: Context): MaybePromise<Url> {
  const value = this.value;
  return pipe(value.eval(context), (nextValue: Quoted | Any) => {
    if (nextValue === value) return this;  // no change — return canonical
    return this.withChildUpdates({ value: nextValue }, context);
  });
}
```

The parent (e.g., a Declaration containing this Url) sees that its child
eval'd to a different node. It creates its own lightweight copy:

```ts
// Declaration.evalNode (simplified)
evalNode(context: Context): MaybePromise<Declaration> {
  return pipe(
    this.value.eval(context),
    (evalValue) => {
      if (evalValue === this.value) return this;
      return this.withChildUpdates({ value: evalValue }, context);
    }
  );
}
```

This bubbles up. Only the path from changed leaf to root gets new objects.
Everything else is shared.

### EvalState's role simplifies

EvalState stops storing field patches for childKeys. It stores:
- **Replacements**: Call → mixin body output (structural, not child update)
- **Subtrees**: per-call bindings for shared canonical bodies
- **Internal metadata**: parent overrides, index, flags, registry deltas

The "field patch" concept splits into:
1. **Child updates** → handled by structural sharing (eval'd nodes)
2. **Metadata patches** → stays in EvalState._fields (internal, untyped OK)

### Mixin bodies: still need EvalState

Mixin bodies are canonical subtrees reused across calls with different
bindings. Structural sharing doesn't help here — the same canonical body
needs to render differently depending on which call is active. This is
still the subtree EvalState's job.

But the **output** of a mixin call can be a structurally-shared tree.
The References inside the body resolve to different values per call
(via subtree state), and when the body evaluates, it returns eval'd nodes
with the resolved values as real properties. Those eval'd nodes are
different per call — structural sharing naturally gives each call its own
output tree.

```
Call .mixin(red):
  canonical body: Decl color=@color
  eval'd output:  Decl' color=Keyword(red)   ← eval'd node, red

Call .mixin(blue):
  canonical body: Decl color=@color (same)
  eval'd output:  Decl'' color=Keyword(blue)  ← different eval'd node, blue
```

No subtree state needed for field resolution during serialization — the
eval'd nodes have the resolved values as real properties. Subtree state
is still needed during eval (for variable resolution, parent chains) but
not during serialization.

### Does this eliminate _carriedState?

If the eval'd output tree has real property values, serialization doesn't
need to push a subtree state to resolve fields. `toTrimmedString()` just
reads `this.value`, `this.name`, etc — they're real typed properties on
the eval'd nodes.

**_carriedState is only needed when the canonical node is being
serialized and needs state patches to render correctly.** With structural
sharing, the eval'd node IS what gets serialized — it has the right values.

Subtree state is still needed for:
- Variable resolution during eval (before the eval'd nodes exist)
- Parent chain wiring during eval
- Any lazy evaluation during serialization (which we should minimize)

But for **field access during serialization** — eliminated. The eval'd
node's `.value` is the eval'd value. Period.

### Cost: how many extra objects?

**Not many.** The structural sharing model creates one lightweight node per
changed node in the tree. In a typical compile:

- Declarations with resolved variables: one eval'd Decl per resolved var
- Urls with evaluated paths: one eval'd Url per dynamic URL
- Rulesets with evaluated selectors: one eval'd Ruleset per dynamic selector
- Rules with changed children: one eval'd Rules per mixin body

But NOT:
- Leaf nodes (Dimension, Color, Keyword) — already replaced, no change
- Unchanged nodes — shared with canonical tree
- Deep copies of children — shared with canonical tree

**Compare to the old clone model:**
- Old: deep-clone every mixin body per call (O(n) objects per call)
- Structural sharing: one eval'd node per changed node (O(changed) objects)
- Pure EvalState: zero objects, but untyped field access

Structural sharing is strictly between the other two in allocation cost,
but gets the DX of the clone model and the sharing of the EvalState model.

### The `_canonical` link

```ts
class Node {
  /** Link to the canonical (parse-time) node, if this is an eval'd overlay */
  _canonical?: Node;

  /** Is this the canonical (source) node? */
  get isCanonical(): boolean {
    return !this._canonical;
  }

  /** Get the canonical node (returns self if already canonical) */
  get canonical(): this {
    return (this._canonical ?? this) as this;
  }
}
```

Pre-declare `_canonical` as undefined in the base constructor so the V8
hidden class is stable (no new shape when it's set later).

### What about tests?

```ts
// Natural, typed, no getField:
const evald = await node.eval(ctx);
expect(evald.value).toBe(replacement);    // typed ✓
expect(evald).not.toBe(node);             // different object
expect(evald._canonical).toBe(node);      // linked back
expect(node.value).toBe(original);        // canonical untouched

// Serialization just works:
expect(evald.toTrimmedString()).toBe('url("b.png")');  // no context needed!
expect(node.toTrimmedString()).toBe('url("a.png")');
```

Note: `toTrimmedString()` on an eval'd node doesn't need context for field
access — the fields are real properties. It might still need context for
deeper subtree resolution (mixin bodies), but for simple cases it just
works.

### What about visitors?

```ts
visitDeclaration(node: Declaration) {
  node.name   // typed ✓, eval'd value (it's an eval'd node)
  node.value  // typed ✓, eval'd value
}
```

The visitor receives eval'd nodes where they exist, canonical where not.
No special handling needed.

### What about custom functions?

```ts
function darken(args: Node[]) {
  const color = args[0] as Color;       // already a replacement node (leaf)
  const amount = args[1] as Dimension;  // already a replacement node (leaf)
  return color.darken(amount.number);   // typed, works
}
```

Function args are already resolved before the function is called. They're
either replacement nodes (leaves) or eval'd nodes (containers). Either way,
typed properties work.

---

## Remaining Questions

### 1. Does eval return the eval'd node or canonical + state?

**Recommendation: eval returns the eval'd node.** This is the natural
contract — `eval()` returns the evaluated result. If nothing changed,
it returns `this` (the canonical). If children changed, it returns a
lightweight eval'd copy.

This matches the current contract where eval sometimes returns `this`
and sometimes returns a different node.

### 2. How does structural sharing interact with Rules children?

Rules is special — its children are an array that gets spliced, reordered,
etc. Creating an eval'd Rules per children change could be expensive if
children change frequently during eval (e.g., `_resolveDynamicNodes`
rewrites children multiple times).

**Option:** Rules keeps using field patches for children during eval
(internal, high-frequency mutation). At the eval→serialization boundary,
materialize the final children array onto a structural-shared Rules node.
Or: accept the object cost, since `withChildUpdates` is just one
`Object.create` per Rules regardless of children array size.

### 3. How does this interact with the parent chain?

Eval'd nodes need parents. If `Decl'` is an eval'd node inside a Rules,
its parent should be that Rules (or the eval'd Rules', if the Rules
changed too).

During eval, parent wiring happens via `setParent`/`getParent` through
EvalState. With structural sharing, the eval'd node IS a child of its
parent — the parent relationship is structural, not patched.

But for mixin bodies (shared canonical subtrees), the parent chain still
needs state patching — the canonical body's parent is the mixin definition,
but during a call, it should resolve to the caller's scope. This is a
subtree-level concern, not a field-level concern.

### 4. What about re-evaluation / caching?

If the same canonical node is evaluated multiple times (SSR, watch mode),
each eval produces its own set of eval'd nodes. The canonical tree is
untouched — it's the shared base. Previous eval'd nodes are GC'd when
no longer referenced.

`_canonical` links enable this: given any eval'd tree, you can walk it
and recover the canonical tree by following `_canonical` links.

### 5. withChildUpdates vs Object.create perf

`Object.create` with manual property copying is well-optimized in V8.
But there's a subtlety: the eval'd object has a different hidden class
from the canonical node (it was created via `Object.create`, not `new`).
V8 may not optimize property access as well as on constructor-created
instances.

**Mitigation:** Instead of `Object.create`, use a **clone constructor**:

```ts
// Pre-compiled per node class
static createEvalView(canonical: Declaration, updates: Partial<DeclarationValue>): Declaration {
  const e = new Declaration(
    {
      name: updates.name ?? canonical.name,
      value: updates.value ?? canonical.value,
      important: updates.important ?? canonical.important,
    },
    canonical.options,
    canonical.location,
    canonical.treeContext
  );
  e._canonical = canonical;
  e.inherit(canonical);
  return e;
}
```

This uses the real constructor → stable hidden class → optimized property
access. Cost: one constructor call with adoption. More expensive than
`Object.create` but much cheaper than deep clone, and V8-friendly.

Whether to use `Object.create` or clone constructor depends on profiling.
Start with `Object.create` (simpler), optimize to clone constructor if
the hidden class deopt shows up in profiles.

---

## Summary

| Model | DX | Allocation | Typing | Context needed? |
|---|---|---|---|---|
| Deep clone (old) | `node.value` ✓ | Heavy | Full | No |
| Pure EvalState | `getField(node,'value',ctx)` ✗ | Zero | Lost | Always |
| **Structural sharing** | `evald.value` ✓ | Light | Full | No (for reads) |

Structural sharing gives the DX of the clone model and the efficiency
gains of the EvalState model. The key trade: one lightweight object per
changed node (instead of zero for pure state, or deep copies for cloning).

The canonical tree is always recoverable via `_canonical` links. EvalState
simplifies to replacements + metadata + subtree bindings. Field patches
for childKeys data go away.
