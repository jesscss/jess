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

### Tree walks: serialization (top-down) and references (bottom-up)

The hard question: when walking the tree, how do you know which EvalState
to look in for a given node?

#### The setup

```
Root EvalState (S0):
  Call → { replacement: mixinBody, subtree: S1 }

Subtree EvalState (S1):
  body → { fields: { parent: outerScope } }
  paramVarDecl → { fields: { value: blue } }

Canonical tree:
  Root Rules
    ├── Mixin .m(@color) { color: @color; }
    │        └── body Rules ← this is the canonical body
    │              └── Decl color: @color
    └── Ruleset .test
         └── Call .m(blue) ← replaced by body in S0
```

#### Serialization (top-down walk)

Walk canonical children. At each node, check the CURRENT active state
for a replacement or subtree.

```
1. Start at Root Rules. Active state = S0.
2. Walk children: Mixin (skip, not visible), Ruleset .test.
3. Enter Ruleset .test. Walk its Rules children.
4. Hit Call. S0 has: replacement=body, subtree=S1.
5. PUSH S1 onto stack. Render body instead of Call.
6.   Inside body (active state = S1):
7.   Walk children: Decl color: @color.
8.   Render Decl. Value is a Reference. Reference was evaluated
     during eval — its replacement (Keyword "blue") is in S1.
9.   Output: color: blue;
10. POP S1.
11. Continue with remaining children of .test.
```

Key insight: the subtree push/pop is driven by the PARENT state's entry
for the node. You check S0 for Call, find the subtree, push it, then
everything inside renders under S1.

#### References (bottom-up walk)

A Reference walks up the parent chain to find the scope that has the
variable. This walk crosses subtree boundaries.

```
1. Reference @color is inside Decl, inside body Rules.
2. getParent(Decl) → body Rules (canonical parent, or from S1)
3. Search body's registry for @color. Not found.
4. getParent(body) → outerScope (from S1: body → outerScope)
5. Search outerScope's registry for @color. FOUND. Read its value.
6. The value "blue" was bound during matchMixinCandidates (canonical
   mutation on the ephemeral scope's VarDeclaration). No state lookup
   needed — the VarDeclaration's canonical value IS blue.
```

Where does getParent look? Always in the CURRENT active state. During
eval, the per-call state is active (it was pushed). The body's parent
was set in that same state. The outerScope's parent was ALSO set in
that state (or should be — it's part of the call setup).

PROBLEM: the outerScope's parent was set in the CALLER's state (S0),
not in the per-call state (S1). The call setup happens before S1 is
pushed.

FIX OPTIONS:

A) Set outerScope's parent in S1 (after push), not S0.
   → Simple. prepareMixinCandidateInvocation must happen AFTER
     the per-call state push, not before.

B) Make getParent walk the state chain (S1 → S0).
   → Works but violates the "one state per node" principle.

C) Copy outerScope's parent entry from S0 into S1 at push time.
   → Explicit but fragile.

D) Have a single flat "global" state for all non-subtree fields,
   with subtrees only for replacement-internal fields.
   → Cleanest but biggest change.

Option A is simplest. The outerScope is ephemeral (created per call).
Its parent should be set in the per-call state alongside the body's
parent. Move the setup into evaluateCandidateOutput, after pushState.

#### Nested calls

When .wrapper-mixin calls .base-mixin inside its body:

```
S0 (root):
  Call.wrapper → { replacement: wrapperBody, subtree: S1 }

S1 (wrapper call):
  wrapperBody → { fields: { parent: wrapperOuterScope } }
  Call.base → { replacement: baseBody, subtree: S2 }

S2 (base call):
  baseBody → { fields: { parent: baseOuterScope } }
```

Serialization:
1. S0 active. Hit Call.wrapper → push S1, render wrapperBody.
2. S1 active. Hit Call.base → push S2, render baseBody.
3. S2 active. Reference @color resolves through baseOuterScope.
4. Pop S2. Pop S1.

Each subtree is self-contained. No cross-state field scatter.

#### The rule

Each per-call EvalState (subtree) must contain ALL field patches for
ALL nodes that are evaluated within that call. The parent chain for the
body, the outerScope, and any inner nodes — all set in S1, not S0.

If you need to read a field and it's not in the active state, either:
- It's canonical (fall through to node property) — correct.
- It was set in a different state — BUG. Fix the write site.

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
