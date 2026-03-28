# EvalState Architecture Sketch

## Current Architecture

Three overlapping layers, all doing field-level patching with no concept separation:

```
Context
  ├── session: EvalSession          // "everything bag" — WeakMaps for patches, runtime,
  │     ├── patches: WeakMap<Node, Record<string, unknown>>    scopes, deps, registry deltas,
  │     ├── runtime: WeakMap<Node, RuntimeState>               children, materialized, changedVars
  │     ├── scopes, dependencies, registryDeltas, ...
  │     └── instanceRoots: SessionInstanceRoot[]
  │           └── overrides: WeakMap<Node, ShadowEntry>   // per-placement shadows
  │               └── { patches, runtime, children }
  │
  ├── instanceRoot: SessionInstanceRoot   // currently active instance root
  │
  └── _position: EvalPosition       // "clean" field patches, lazy-created
        └── patches: Map<Node, Record<string, unknown>>
```

### Problems

1. **No node-level patching.** To "replace" a Call with its mixin body, you patch the
   parent's `children` field with a new array. Two patches minimum (parent + replacement
   node's fields) instead of one (the replacement itself).

2. **No concept separation.** Node replacements, field overrides, eval flags, parent
   pointers — all stored as `Record<string, unknown>` in the same bag.

3. **Three redundant layers.** EvalPosition, SessionInstanceRoot, and EvalSession all
   have `setField`/`getField` with a complex fallback chain:
   `position → carried._evalPosition → instanceRoot → session → canonical`

4. **"Session" naming.** The concept was supposed to be killed. EvalSession is still the
   primary state container.

5. **Flat patch maps can't handle mixin reuse.** Same canonical mixin body returned from
   two calls needs different patches per call. Currently handled by creating
   SessionInstanceRoot per placement — but that's a separate concept bolted on.

---

## Proposed Architecture

One class: `EvalState`. Lives on `Context`. Two distinct patch types. Recursive for
subtree reuse.

```ts
/**
 * Sparse overlay on the canonical AST for one evaluation pass.
 *
 * Two kinds of patches:
 *   - Node patches:  canonical node → replacement node (tree structure)
 *   - Field patches: any node → property overrides (metadata)
 *
 * Recursive: a node patch can carry its own EvalState for the replacement's
 * subtree, enabling the same canonical subtree (mixin body, import) to be
 * reused with different bindings at different call sites.
 */
class EvalState extends Map<Node, NodeState> {
  /** Always returns a NodeState — creates one if missing */
  override get(node: Node): NodeState {
    let s = super.get(node);
    if (!s) { s = new NodeState(); super.set(node, s); }
    return s;
  }

  /** Read-only lookup — returns undefined if no state exists (no allocation) */
  peek(node: Node): NodeState | undefined {
    return super.get(node);
  }
}

class NodeState {
  replacement: Node | undefined = undefined;
  evaluated = false;
  preEvaluated = false;
  _fields: Map<string, unknown> | undefined; 
  get fields(): Map<string, unknown> {
    return (this._fields ??= new Map());
  }
  declare _subtree: EvalState | undefined;
  /** Rare — stays off instance until assigned */
  get subtree(): EvalState {
    return (this._subtree ??= new EvalState());
  }
}
```

Usage — cache the NodeState when touching multiple fields:
```ts
// Write
const s = state.get(node);
s.replacement = mixinBody;
s.evaluated = true;
s.fields.set('parent', parentNode);

// Read
const s = state.get(node);
s.replacement   // Node | undefined
s.evaluated     // boolean
s.fields.get('parent')

```

### Context integration

```ts
class Context {
  /** The root eval state for this evaluation pass */
  private _evalState?: EvalState;

  get evalState(): EvalState {
    return (this._evalState ??= new EvalState());
  }

  /**
   * Stack of active subtree states.
   * Pushed when entering a replacement's subtree, popped on exit.
   * Lookups walk the stack top-down.
   */
  /** Stack of active subtree states. Push when entering a replacement's
   *  subtree, pop on exit. Top of stack is the active state for lookups. */
  evalStateStack: EvalState[] = [];
}
```

### Use cases

#### 1. Simple eval (expression, operation, block)

Node evaluates to a different node. One node patch, no subtree needed.

```less
// Block wrapping an expression
{ 1 + 2 }
```

```ts
// Operation eval: replace canonical Operation with result Dimension
ctx.activeState.get(operationNode).replacement = new Dimension([3, 'px']);

// Block eval: replace canonical child expression with evaluated one
ctx.activeState.get(exprNode).replacement = evaluatedExpr;

// Canonical nodes untouched — read with:
ctx.activeState.get(operationNode).replacement  // Dimension(3px)
operationNode.left   // still the canonical Dimension(1px)
```

#### 2. Variable resolution (Reference → value)

```less
@color: red;
.a { color: @color; }
```

```ts
// Reference resolves to its value
ctx.activeState.get(refNode).replacement = keywordRed;
```

#### 3. Mixin call (subtree reuse with different bindings)

```less
.mixin(@color) { color: @color; }
.a { .mixin(red); }
.b { .mixin(blue); }
```

```ts
// Call1 → canonical mixin body M
ctx.activeState.get(Call1).replacement = M;
const sub1 = ctx.activeState.get(Call1).subtree;
ctx.pushSubtree(sub1);
  // Inside M, @color reference resolves to red
  ctx.activeState.get(refNode).replacement = keywordRed;
ctx.popSubtree();

// Call2 → same canonical body M, different subtree
ctx.activeState.get(Call2).replacement = M;
const sub2 = ctx.activeState.get(Call2).subtree;
ctx.pushSubtree(sub2);
  // Inside M, @color reference resolves to blue
  ctx.activeState.get(refNode).replacement = keywordBlue;
ctx.popSubtree();
```

Both calls share `M`. `refNode` resolves differently because each subtree
has its own replacement for it.

#### 4. Mixin param binding (canonical defaults preserved)

```less
.mixin(@color: red) { ... }
.test { .mixin(blue); }
```

```ts
// The VarDeclaration's default value stays canonical ("red").
// The call-site binding is a node replacement in the subtree:
const sub = ctx.activeState.get(callNode).subtree!;
sub.get(paramVarDecl).replacement = keywordBlue;

// Read: paramVarDecl.value is still "red" canonically
// But inside the subtree: sub.get(paramVarDecl)?.replacement → blue
```

#### 5. Field patch (metadata, not structure)

```ts
// Mark a node as evaluated — direct property, no Map overhead
ctx.activeState.get(node).evaluated = true;

// Read
ctx.activeState.get(node).evaluated  // true
// Canonical node has no evaluated property — it's pure parse tree

// Less common fields go through the Map
const s = ctx.activeState.get(node);
(s.fields ??= new Map()).set('index', 3);
```

#### 6. Import reuse

Same pattern as mixin. An imported file's canonical tree is shared across
all `@import` sites. Each import gets its own subtree EvalState for any
bindings or overrides specific to that import context.

#### 7. Serialization

```ts
function serialize(node: Node, ctx: Context): string {
  const s = ctx.activeState.peek(node);
  const actual = s?.replacement ?? node;

  // If this node has a subtree (mixin/import), push it
  if (s?._subtree) ctx.evalStateStack.push(s._subtree);

  const result = actual.render(ctx);  // renders using activeState for field reads

  if (s?._subtree) ctx.evalStateStack.pop();
  return result;
}
```

### Lookup

```ts
// Read-only lookups use native Map.get (returns undefined, no allocation)
function getNodeAt(node: Node, ctx: Context): Node {
  for (let i = ctx.evalStateStack.length - 1; i >= 0; i--) {
    const r = ctx.evalStateStack[i].peek(node)?.replacement;
    if (r !== undefined) return r;
  }
  return ctx.evalState.peek(node)?.replacement ?? node;
}

function getFieldAt(node: Node, field: string, ctx: Context): unknown {
  for (let i = ctx.evalStateStack.length - 1; i >= 0; i--) {
    const val = ctx.evalStateStack[i].peek(node)?._fields?.get(field);
    if (val !== undefined) return val;
  }
  return ctx.evalState.peek(node)?._fields?.get(field) ?? (node as any)[field];
}
```

### Tree walks

The evaluated tree is the canonical tree with replacements grafted in.
Some branches are canonical, some are replacements with their own subtrees.
Both serialization (top-down) and reference lookup (bottom-up) walk this
mixed tree.

#### The evaluated tree

```
Canonical:                    Evaluated (canonical + state):
  Root Rules                    Root Rules
    Mixin .m(@color)              Mixin .m (skip, not visible)
      body Rules                  Ruleset .test
        Decl color: @color          [Call .m(blue) → body Rules]  ← replacement
    Ruleset .test                     Decl color: blue            ← resolved
      Call .m(blue)
```

State structure:
```
S0 (root):  Call → { replacement: body, subtree: S1 }
S1 (call):  @color VarDecl → { fields: { value: Keyword(blue) } }
```

#### One rule for both directions

Every node lives in exactly one state. When you encounter a node:

1. Check the **active state** for that node's patches/replacement.
2. If there's a **subtree**, push it before descending into the replacement.
3. If there's no entry, the node is **canonical** — use its properties directly.

```ts
function renderNode(node: Node, ctx: Context): string {
  const ns = ctx.activeState.peek(node);
  const actual = ns?.replacement ?? node;
  if (ns?._subtree) ctx.pushState(ns._subtree);
  const result = actual.toCSS(ctx);
  if (ns?._subtree) ctx.popState();
  return result;
}
```

That's it. Serialization calls this recursively. Each child checks the
currently active state. Inside a subtree, that state is the subtree.
Outside, it's the parent state. The push/pop handles the boundary.

#### Reference lookup (bottom-up)

References walk up the parent chain. The parent chain is a mix of
canonical parents and state-patched parents. The rule is the same:
check the active state first, fall through to canonical.

```ts
function getParent(node: Node, ctx: Context): Node | undefined {
  return ctx.activeState.peek(node)?._fields?.get('parent')
    ?? node.parent;
}
```

During eval, the per-call state IS the active state (it was pushed).
ALL nodes touched during that call have their fields set in that state.
The parent chain for body → outerScope → caller is fully within the
per-call state.

```
Reference @color inside body:
  1. getParent(Decl) → body       (canonical parent)
  2. Search body registry → not found
  3. getParent(body) → outerScope (set in S1 during call setup)
  4. Search outerScope registry → found @color, value = blue
```

No state boundary crossing needed. Everything the reference needs is
either in the active state or canonical.

**Key constraint**: all field patches for a call MUST be written to that
call's state. If outerScope's parent was set in the caller's state
instead of the call's state, the reference walk breaks. The fix is to
move all call setup (parent wiring, param binding) to AFTER pushState.

#### Nested calls

```
S0: Call.wrapper → { replacement: wrapperBody, subtree: S1 }
S1: Call.base   → { replacement: baseBody,    subtree: S2 }
S2: @color      → { fields: { value: blue } }
```

Serialization: push S1, enter wrapperBody, push S2, enter baseBody,
render @color=blue, pop S2, pop S1.

Reference inside baseBody: walks up within S2. Everything it needs is
in S2 or canonical. No cross-state lookups.

#### During eval vs during serialization

During **eval**, the subtree IS the activeState (it was pushed onto
the stack). Writes go to it. Reads check it first, fall through to
canonical. The eval pipeline naturally pushes/pops states as it enters
and exits calls.

During **serialization**, the subtrees are stored on NodeState entries
(via `_subtree`). The serializer pushes/pops them as it descends into
replacements. Same push/pop pattern, but driven by the tree structure
instead of the eval pipeline.

Both use the same `getField`/`getParent` — one implementation, works
for both directions, no special cases.

### What gets killed

| Current                        | Proposed                   |
|--------------------------------|----------------------------|
| `EvalSession`                  | **Deleted**                |
| `SessionInstanceRoot`          | **Deleted** (subtree EvalState replaces it) |
| `EvalPosition`                 | **Deleted** (merged into EvalState) |
| `RuntimeState` interface       | **Deleted** (fields are just field patches) |
| `ShadowEntry` interface        | **Deleted**                |
| `NodePatch` type (untyped bag) | **Deleted** (replaced by typed NodeState) |
| `resetEvalState` flag          | **Deleted** (no canonical fallback) |
| `field-helpers.ts` fallback chain | **Simplified** to stack walk |
| `ctx.session`                  | `ctx.evalState`            |
| `ctx.instanceRoot`             | subtree stack              |
| `ctx.position`                 | `ctx.activeState`          |

### Evaluation-wide state (not per-placement)

Some EvalSession responsibilities are per-evaluation-pass, not per-placement.
These live on Context directly — they're orthogonal to the node/field patch
system and don't need the recursive subtree model.

- **Scope snapshots** (`Map<string, ScopeSnapshot>`) — per import path
- **Registry deltas** (`WeakMap<Rules, SessionRegistryDelta>`) — mixin/var registration
- **Changed vars** (`Set<VarDeclaration>`) — dirty tracking
- **Dependency tracking** (`WeakMap<Node, EvalDependency>`) — static analysis
