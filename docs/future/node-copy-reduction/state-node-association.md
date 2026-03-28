# State–Node Association: The Subtree Linkage Problem

## Problem Statement

The EvalState system separates mutable evaluation state from the immutable
canonical AST. During eval, `pushState`/`popState` on Context tracks which
EvalState is active — all field reads/writes route through `activeState`.
This works cleanly during eval because the call stack mirrors the state stack.

After eval, the stack is unwound. The output tree is a mix of:

- **Canonical nodes** (no state patches)
- **Lightweight output nodes** (from mixin calls, `@for` loops, imports)
- **Canonical nodes with patches** spread across many EvalState instances

The problem: **how does the serializer (or any post-eval walk) know which
EvalState to activate for a given subtree?**

Currently `_carriedState` on the output node bridges this gap. But it
mutates the node instance, which:

1. Creates a new V8 hidden class per node that carries state (perf hit)
2. Violates the "canonical nodes are immutable" principle (the output node
   is fresh, but it's still a mutation pattern that ideally wouldn't exist)

### Two directions where the problem surfaces

**Top-down (serialization):** Walk from root, rendering children. When you
encounter an output node from a mixin call, you need to push its call-site
EvalState so child field reads resolve correctly (e.g., `@color` → `red`
inside mixin body).

**Bottom-up (parent walks / registry lookups):** Walk from a deep node
upward through parents. When you cross a subtree boundary (child state →
parent state), `activeState` must switch. Otherwise `getField`/`getParent`
reads see the wrong patches — or no patches at all.

---

## The Many-States Reality

This isn't a 2–3 state problem. A Bootstrap 4 compile creates **hundreds**
of EvalState instances — one per mixin call, one per loop iteration, one
per import evaluation. After eval:

```
S0 (root)
├── S1 (mixin call .a)
│   ├── S1a (nested mixin inside .a's body)
│   └── S1b (loop inside .a's body)
├── S2 (mixin call .b)
├── S3 (mixin call .c)
│   └── S3a (nested call)
│       └── S3a1 (deeply nested)
├── S4 ... S200
```

Each state's `.parent` points to whatever was `activeState` when it was
pushed. This forms a **tree** (not a chain) — multiple states share the
same parent. The parent links persist after eval, but the stack is gone.

During eval, the parent chain enables `getField`/`getParent` to walk up
and find patches from ancestor states. During serialization, the parent
chain is still there — but you need to know **which state to start from**
for each subtree. That's the association problem.

### Children lists add complexity

When `finalizeMixinInvocationOutput` creates an output node, it copies the
canonical children into a new lightweight Rules node:

```ts
const children = [...rules._getChildren(context)];
const output = Rules.create(children, { ...rules.options });
```

This output node is then spliced into the parent's children (via
`outputRules.push(newRules)` → eventually into the parent Rules' child
array). The output node IS the child — the original Call node is not in the
children list anymore.

This means any subtree link stored on the **Call node's** NodeState is
unreachable during serialization — the serializer sees the output node, not
the Call. The link must be on the output node or discoverable from it.

### State pointers change constantly

During eval, `activeState` changes on every `pushState`/`popState`. Fields
written at different moments go to different states. The parent wiring
(`setParent(rules, callerParent, context)`) goes into the call's state.
The output node's post-pop setup (`setParent(newRules, ...)`) goes into the
*parent's* state (because popState already restored it).

During serialization, `activeState` must be swapped at every subtree
boundary. `flatRules` passes `activeSubtree` down manually. `serialize-helper`
pushes/pops from a `positionMap`. `toTrimmedString` checks `_carriedState`.
Three different mechanisms for the same problem.

---

## How _carriedState Works Today

```
evaluateCandidateOutput():
  1. callState = new EvalState()
  2. context.pushState(callState)         // activeState = callState
  3. setParent(body, caller, context)     // writes to callState
  4. body.eval(context)                   // patches accumulate in callState
  5. output = finalizeMixinInvocationOutput(body, context)
  6. context.popState()                   // activeState = parent state
  7. output._carriedState = callState     // THE BRIDGE
  8. setParent(output, caller, context)   // writes to parent state

toTrimmedString():
  1. subtree = this._carriedState ?? ctx.activeState.peek(this)?._subtree
  2. if subtree: ctx.pushState(subtree)
  3. this._emitRulesBody(options)         // children resolve via pushed state
  4. if subtree: ctx.popState()

flatRules():
  1. subtree = rules._carriedState ?? ctx.activeState.peek(rules)?._subtree ?? passedSubtree
  2. for each child:
     - if Rules: recurse with subtree
     - else: positionMap.set(child, subtree)
```

The `_carriedState` property makes the association simple: the output node
*carries* its state. Any code that encounters the node can find the state.
But it's a node mutation.

---

## Why _subtree on NodeState Failed Previously

The attempt was to store the subtree on the **output node's** NodeState
instead of directly on the node:

```ts
// After popState, activeState is the parent state
ctx.activeState.get(outputNode)._subtree = callState;
```

The reported failure: "the state where the subtree was stored (intermediate
during eval) wasn't the state active during serialization (root state)."

Probable root causes:

1. **Wrong state used as anchor.** If the subtree was stored on the *Call
   node's* NodeState (in the call state) rather than the *output node's*
   NodeState (in the consuming state), the link is unreachable — serialization
   doesn't see the Call, and even if it did, the Call's NodeState is in the
   call state which is the thing we're trying to find.

2. **Nested output escaping its immediate consumer.** If a nested mixin
   output travels through intermediate Rules (flattening, projection), the
   output node might end up in a Rules whose active state during serialization
   is different from the state where the subtree was stored.

3. **flatRules flattening.** `flatRules` removes intermediate Rules
   wrappers. An output node at depth 3 gets promoted to depth 1 in the flat
   list. The `positionMap` records its state, but `toTrimmedString` (which
   is called for Ruleset bodies, not flat lists) doesn't consult
   `positionMap` — it only checks `_carriedState` and
   `activeState.peek(this)?._subtree`.

The fundamental tension: **the output node is created in one state context
but consumed in another.** The consuming state may be N levels up from the
creating state. Any approach must bridge that gap.

---

## Approach 1: Store _subtree in the consuming state (fix the previous attempt)

The previous attempt stored the subtree in the wrong place. The fix:

```ts
// AFTER popState — activeState is now the consuming state
const consumingState = ctx.activeState;
consumingState.get(outputNode)._subtree = callState;
```

During serialization, when the consuming state is active and we encounter
the output node:

```ts
const ns = ctx.activeState.peek(outputNode);
if (ns?._subtree) {
  ctx.pushState(ns._subtree);
  outputNode.render(ctx);
  ctx.popState();
}
```

### Why this might work now

The output node is a **fresh, unique** node (created by
`finalizeMixinInvocationOutput`). It's used as a child in exactly one place.
Keying on it in the consuming state is unambiguous.

For nested calls: output O_inner is created during eval of O_outer's body,
when S_outer is active. So `S_outer.get(O_inner)._subtree = S_inner`. During
serialization inside S_outer (pushed for O_outer), we find O_inner and its
subtree link → push S_inner.

### Where it gets tricky

**flatRules flattening.** When `flatRules` iterates, it strips intermediate
Rules wrappers. An output Rules node might be flattened away — its children
are promoted into the parent list. But the subtree is on the output Rules
node, not on the individual children. After flattening, the children are
bare nodes with no subtree link.

`flatRules` handles this today with the `activeSubtree` parameter and
`positionMap` — it propagates the subtree downward. But this means the
subtree link needs to be discoverable in **two** ways:

1. When walking the tree hierarchically (toTrimmedString) → from NodeState._subtree
2. When walking a flat list (serialize-helper) → from positionMap

The positionMap is populated by flatRules, which reads _subtree (or currently
_carriedState). So as long as flatRules can find the subtree, both paths work.

**Parent walks (bottom-up).** Starting deep inside S_inner, walking up:

1. Get parent of child → patched in S_inner → returns some Rules node R
2. R might be the output node O_inner. O_inner has a _subtree in S_outer.
   But we're currently in S_inner. How do we know to switch to S_outer?
3. R might be canonical. Its parent is patched in S_outer (one level up).
   `getParent(R, ctx)` walks activeState (S_inner) → S_inner.parent (S_outer).
   Found in S_outer → returns the parent.
4. But now we're looking at a node owned by S_outer, while activeState is
   still S_inner. Field reads for this node will walk S_inner first (wrong),
   then S_inner.parent = S_outer (right). It happens to work because
   `getField` walks the chain — but only if S_inner doesn't have a spurious
   entry for the same node.

The parent walk works **by accident** of the chain walking, not by design.
If two states in the chain have patches for the same canonical node (which
happens when the same mixin body is reused), the wrong one could shadow.

### Verdict

Viable as a direct replacement for `_carriedState`. Eliminates node mutation.
But doesn't solve the deeper architectural issue of state-tracking during
walks — it just moves the bridge from node property to state map entry.

---

## Approach 2: Thread state through PrintOptions / serialization context

Instead of storing the association on nodes or in state maps, **thread it
through the serialization API**. The serializer always knows which state is
current — make that explicit in the call chain.

### Variant A: State field on PrintOptions

```ts
interface PrintOptions {
  context?: Context;
  /** The EvalState to activate for this node's subtree */
  activeSubtree?: EvalState;
  // ... existing fields
}
```

When serializing a Ruleset's body:

```ts
_emitRulesBody(options: PrintOptions) {
  for (const child of this._getChildren(options.context)) {
    const childSubtree = resolveSubtree(child, options);
    const childOptions = childSubtree !== options.activeSubtree
      ? { ...options, activeSubtree: childSubtree }
      : options;
    child.toTrimmedString(childOptions);
  }
}
```

Where `resolveSubtree` checks:

```ts
function resolveSubtree(node: Node, options: PrintOptions): EvalState | undefined {
  const ctx = options.context;
  if (!ctx) return undefined;
  return ctx.activeState.peek(node)?._subtree
    ?? options.activeSubtree;
}
```

### Variant B: Dedicated state cursor on Context (save/restore, no push/pop)

Keep `activeState` as the single cursor but formalize the save/restore
pattern already used in registry walks:

```ts
// In toTrimmedString:
const ctx = options.context;
const subtree = ctx?.activeState.peek(this)?._subtree;
const saved = ctx?.activeState;
if (ctx && subtree) {
  ctx.activeState = subtree;  // direct set, no push/pop
}
this._emitRulesBody(options);
if (ctx && subtree) {
  ctx.activeState = saved!;   // restore
}
```

This eliminates the need for the subtree to "remember" its parent chain for
serialization purposes — the save/restore handles it. The parent chain on
EvalState is only needed during eval.

### Tradeoffs

**Pros:**
- No node mutation
- State flows explicitly through the call chain — no hidden coupling
- PrintOptions threading is already the pattern for `context`, `writer`, `depth`
- Variant B requires zero new structures

**Cons — Variant A:**
- PrintOptions is passed by value (spread copies). Adding a field to it
  means every spread creates a new object. High-frequency path.
- But: only spreads when the subtree **changes**, which is relatively rare
  (one spread per mixin output in the tree, not per node)

**Cons — Variant B:**
- `activeState` is shared mutable state on Context. If any callee reads
  activeState for a purpose other than serialization (e.g., registry delta
  lookup during render), the swapped pointer could cause surprises.
- But: this is exactly what `pushState`/`popState` already does. The
  save/restore is just a lighter-weight version.

**Cons — both:**
- Only solves top-down (serialization). Parent walks (bottom-up) still need
  their own solution — PrintOptions don't exist during registry lookups.

### Verdict

Variant B (save/restore on Context.activeState) is essentially what the
code already does via pushState/popState in toTrimmedString. The real change
would be: instead of `_carriedState` telling you *what* to push, store
that in the consuming state's NodeState._subtree. Then toTrimmedString does:

```ts
const subtree = ctx.activeState.peek(this)?._subtree;
```

...which is already the fallback path. Removing `_carriedState` means this
becomes the only path. This is really Approach 1 + the existing push/pop —
no new mechanism needed for serialization.

---

## Approach 3: Replacement indirection (keep Call in canonical children)

Don't splice output into children at all. The canonical children list keeps
the Call node. State says `Call → { replacement: outputBody, subtree: S1 }`.
Serialization encounters the Call, checks state, renders the replacement
with the subtree pushed.

### Why this is appealing

The Call→subtree link is never lost because the Call stays in the tree. No
bridge mechanism needed. The canonical tree is truly the skeleton;
everything else is overlay.

### Why this is harder than it looks with many states

**Which state has the Call's NodeState?** For a top-level call, it's S0.
For a call inside a mixin body, it's the parent mixin's state S_parent.
During serialization, when you encounter the Call, `activeState` must be
the state that has the Call's entry. If activeState is wrong (e.g., you're
in S0 but the Call's entry is in S_parent), you won't find the replacement.

This means the serializer must already have the right state active before
it encounters the Call — which is the same chicken-and-egg problem. The
parent Rules pushed S_parent (because it's a mixin output), so by the time
we iterate its children and find the Call, S_parent is active. This works
for the common case.

**But what about calls that aren't inside mixin output?** A top-level mixin
call (in the root stylesheet) has its entry in S0. During serialization,
S0 is the root activeState. The serializer encounters the Call in S0, finds
the replacement and subtree. Works.

**Nested calls (the real test):**

```
S0:        Call.outer → { replacement: outerBody, subtree: S1 }
S1:        Call.inner → { replacement: innerBody, subtree: S2 }
S2:        @color VarDecl → { fields: { value: blue } }
```

Serialization:
1. In S0, encounter Call.outer → replacement=outerBody, subtree=S1
2. Push S1, render outerBody
3. In S1, encounter Call.inner → replacement=innerBody, subtree=S2
4. Push S2, render innerBody
5. In S2, render @color → resolves to blue ✓
6. Pop S2, pop S1

This works because each Call is encountered while its owning state is active.

**Where it breaks: the children list.**

Today, `_getChildren(context)` returns the patched children array (stored as
a field override). If we stop splicing output into children, `_getChildren`
returns the canonical children — which include the Call node. The serializer
must check each child for a replacement.

But `_getChildren` is used everywhere — preEval, eval, registration,
serialization. Making it state-aware means every consumer sees Calls instead
of their output. Some consumers (registration) need to see the Call to avoid
registering mixin output as declarations. Others (serialization) need to see
the output.

This is a **semantic fork**: the canonical children (with Calls) vs. the
evaluated children (with replacements). Today the fork is handled by
splicing — after eval, the children list has the output. With replacement
indirection, the fork must be handled at read time.

**Option:** `_getEvaluatedChildren(context)` that maps replacements:

```ts
_getEvaluatedChildren(ctx: Context): Node[] {
  return this._getChildren(ctx).map(child => {
    const ns = ctx.activeState.peek(child);
    return ns?.replacement ?? child;
  });
}
```

But this allocates an array per call. And it doesn't handle subtree
pushing — the caller still needs to know about subtrees.

### The parent walk problem (amplified)

With replacement indirection, parent walks get harder. A node deep inside
a replacement body walks up. Its parent (patched in the call state) points
to... the call site's Rules. But the call site's Rules lives in the parent
state. The walk must switch from call state to parent state.

With `_carriedState` or Approach 1, parent walks use the EvalState.parent
chain: `getParent` walks activeState → parent → parent → ... until it finds
a patch. The chain walking happens to cross boundaries correctly because
each state's parent IS the state that was active at the call site.

With replacement indirection, the same chain walking applies. The Call's
replacement body is rendered with the call's subtree as activeState. The
subtree's parent points to the consuming state. `getParent` walks
subtree → consuming state → ... and finds the parent.

**No difference from Approach 1 for parent walks.** The replacement
indirection changes how we *find* the subtree (from the Call's NodeState
instead of _carriedState), but once the subtree is pushed, the parent chain
is identical.

### Verdict

Conceptually clean but high-impact change. Every consumer of `_getChildren`
needs to handle the canonical-vs-evaluated fork. The payoff — eliminating
the need for a subtree bridge entirely — is real, but the cost is a
pervasive API change. Best suited as a long-term target, not an incremental
step.

---

## Approach 4: Callback-based walks with (node, state) pairs

Instead of storing the association, **compute it during the walk**. Every
walk function takes a callback that receives both the node and its state:

```ts
function forEachChild(
  rules: Rules,
  state: EvalState,
  callback: (node: Node, childState: EvalState) => void
): void {
  const children = getChildren(rules, state);
  for (const child of children) {
    const ns = state.peek(child);
    const actual = ns?.replacement ?? child;
    const childState = ns?._subtree ?? state;
    callback(actual, childState);
  }
}
```

And for parent walks:

```ts
function walkParents(
  node: Node,
  state: EvalState,
  callback: (parent: Node, parentState: EvalState) => boolean
): void {
  let current = node;
  let currentState = state;
  while (true) {
    const [parent, parentState] = getParentInState(current, currentState);
    if (!parent) break;
    if (callback(parent, parentState)) break;  // true = stop
    current = parent;
    currentState = parentState;
  }
}
```

### The `getParentInState` problem

```ts
function getParentInState(
  node: Node,
  state: EvalState
): [Node | undefined, EvalState] {
  // 1. Find the parent node
  let s: EvalState | undefined = state;
  let parent: Node | undefined;
  while (s) {
    parent = s.peek(node)?._fields?.get('parent') as Node | undefined;
    if (parent !== undefined) break;
    s = s.parent;
  }
  if (!parent) parent = node.parent;
  if (!parent) return [undefined, state];

  // 2. Find which state owns the parent
  // Walk from the CURRENT state upward. The first state that has an
  // entry for the parent likely "owns" it.
  s = state;
  while (s) {
    if (s.has(parent)) return [parent, s];
    s = s.parent;
  }
  // No state owns it — canonical. Stay in current state.
  return [parent, state];
}
```

**The ownership heuristic is fragile.** `s.has(parent)` means "this state
has *some* entry for this node" — but it might be an unrelated patch (e.g.,
`evaluated = true` set during a walk). The state that patched `parent.parent`
might be different from the state that patched `parent.children`.

With many states, a canonical node like the root Rules might have entries in
*multiple* states (S1 patched its children, S2 patched its registry delta).
The first match in the chain wins, which might be wrong.

**Stronger ownership signal:** Instead of `s.has(parent)`, check whether
the parent's **children** (in state s) include the current node. But that's
O(n) per step — too expensive for a walk.

**Alternative:** Track ownership explicitly. When a node's state is set
during eval, record it. But this is another mapping to maintain.

### Callback pattern avoids allocation

The callback pattern avoids allocating `{ node, state }` pair objects.
The two values are passed as arguments. This is zero-allocation.

For serialization:

```ts
forEachChild(rules, state, (child, childState) => {
  const saved = ctx.activeState;
  ctx.activeState = childState;
  child.toTrimmedString(options);
  ctx.activeState = saved;
});
```

For parent walks:

```ts
walkParents(startNode, startState, (parent, parentState) => {
  const saved = ctx.activeState;
  ctx.activeState = parentState;
  search(parent);
  ctx.activeState = saved;
  return false; // continue walking
});
```

### Verdict

Elegant for new code, but requires threading `state` through every call
site. The ownership heuristic in `getParentInState` is the weak link —
it works when each state's entries are disjoint (the common case), but
can break when a canonical node has entries in multiple states.

Best as a pattern for **specific walks** (registry lookups, serialization)
rather than a universal replacement for the current system.

---

## Approach 5: Output identity map (WeakMap on Context)

A single `WeakMap<Node, EvalState>` on Context that maps output nodes to
their call-site state:

```ts
class Context {
  /** Maps output nodes (mixin/import results) to their call-site EvalState */
  readonly subtreeMap: WeakMap<Node, EvalState> = new WeakMap();
}
```

Set at output creation (after popState):

```ts
context.subtreeMap.set(outputNode, callState);
```

Read during any walk:

```ts
const subtree = ctx.subtreeMap.get(node);
if (subtree) {
  ctx.pushState(subtree);
  node.render(ctx);
  ctx.popState();
}
```

### Key property: works from any direction

Unlike NodeState._subtree (which requires the right activeState to find),
this WeakMap is **global to the eval pass**. You can look up any output node
from anywhere — serialization, parent walks, debugging.

### Relationship to positionMap

`flatRules` already builds a `positionMap: WeakMap<Node, EvalState>` that
serves a similar purpose for the flat serialization path. `subtreeMap` would
be the *authoritative* source populated during eval, while `positionMap` is
a *derived* artifact for the flat path.

Could unify them: `flatRules` wouldn't need `positionMap` if `subtreeMap`
existed. But `positionMap` maps *leaf nodes* to their enclosing subtree,
while `subtreeMap` maps *output Rules nodes* to their state. Different
granularity.

### Parent walks

For parent walks, `subtreeMap` helps detect boundaries:

```ts
function getParentInState(node: Node, ctx: Context): [Node | undefined, EvalState | undefined] {
  const parent = getParent(node, ctx);
  if (!parent) return [undefined, undefined];
  // Check if the parent is an output node with a different subtree
  const parentSubtree = ctx.subtreeMap.get(parent);
  // If the parent has a subtree and it's not the current activeState,
  // we've crossed a boundary
  return [parent, parentSubtree];
}
```

But this only works if the parent is itself an output node. If the parent
is a canonical node (like a Ruleset's Rules block), it won't be in the
subtreeMap. The boundary detection must fall back to EvalState.parent chain
walking.

### Tradeoffs

**Pros:**
- No node mutation, no hidden class churn
- Global lookup — works from any context, any direction
- WeakMap is O(1) and GC-friendly
- Simple mental model: "output nodes know their state"

**Cons:**
- Another structure on Context to manage (alongside activeState)
- Only covers output nodes, not arbitrary state-bearing nodes
- Redundant with NodeState._subtree — two places to look

**Object cost:** One WeakMap on Context. One entry per mixin/loop/import
output node. No per-node allocation beyond the WeakMap entry (which is
internal to the WeakMap's hash table).

---

## Cross-Cutting: The Parent Walk Problem

All approaches share the same fundamental challenge for bottom-up walks:
**detecting subtree boundaries and switching state.**

During a parent walk, you're going "against the grain" of the subtree tree.
Subtrees are pushed for children (downward), but you're going up. At some
point, the node you're looking at belongs to a parent state — you've left
the current subtree.

### What makes boundaries hard to detect

1. **Canonical nodes have no state marker.** A canonical Rules node that was
   never patched has no entry in any state. Its children might have patches
   in various states. Walking up through it doesn't trigger any state switch.

2. **Parent patches bridge boundaries.** When a mixin call wires
   `setParent(body, caller, ctx)`, the parent patch lives in the call state.
   The parent node (caller's Rules) lives in the caller's state. Following
   the patched parent crosses the boundary, but there's no explicit marker
   that says "you just crossed."

3. **EvalState.parent chain is the only breadcrumb.** The chain
   `S_inner.parent → S_outer → S0` mirrors the call nesting. Walking the
   chain from S_inner eventually reaches S_outer, which has the caller
   node's patches. But the walk doesn't tell you *when* to switch — it
   just searches all levels.

### Current behavior (and why it mostly works)

`getField` and `getParent` walk the entire parent chain:

```ts
let state: EvalState | undefined = ctx.activeState;
while (state) {
  const val = state.peek(node)?._fields?.get(key);
  if (val !== undefined) return val;
  state = state.parent;
}
return node[key]; // canonical fallback
```

This means if you're in S_inner and ask for a field on a node that's
patched in S_outer, the chain walk finds it. **No explicit boundary
switching needed for reads.**

The problem is writes and registration — if a parent walk triggers a
write (e.g., updating a registry cache), it writes to `activeState`,
which might be the wrong state for the node being updated.

For read-only parent walks (which is what registry lookups mostly are),
the chain walking is sufficient. For mutating walks, you'd need to
switch `activeState` to the correct state before writing.

### Proposed pattern for mutating parent walks

```ts
let rules = startRules;
let savedState = ctx.activeState;
while (rules) {
  search(rules);                              // reads walk chain — OK
  const parent = getParent(rules, ctx);
  if (parent) {
    // Before processing parent, ensure activeState is correct for writes
    const ownerState = findOwnerState(parent, ctx.activeState);
    if (ownerState !== ctx.activeState) {
      ctx.activeState = ownerState;
    }
  }
  rules = parent;
}
ctx.activeState = savedState;                 // restore

function findOwnerState(node: Node, startState: EvalState): EvalState {
  let s: EvalState | undefined = startState;
  while (s) {
    if (s.has(node)) return s;
    s = s.parent;
  }
  return startState; // canonical — any state works for reads
}
```

This has the ownership heuristic problem (multiple states may have entries
for the same node). But for the specific case of parent walks in registry
lookups, the writes are limited to registry delta caching — and those writes
should go to the state that owns the Rules node's children, which is
typically the first state in the chain that has the Rules' `value` field
patched.

---

## Recommendation

### Chosen approach: _carriedState + subtreeMap (Approach 1+5)

**Status: IMPLEMENTED.**

Both mechanisms are in place:

1. `_carriedState` on output nodes carries the per-call EvalState.
   Set in `evaluateCandidateOutput`, `$for` loop, import eval.

2. `ctx.subtreeMap` WeakMap on Context maps output nodes → EvalState.
   Set alongside `_carriedState` in the same locations.

3. `toTrimmedString` checks `_carriedState` first, then `_subtree`,
   then `subtreeMap`. Pushes the subtree for serialization.

4. `flatRules` propagates via `activeSubtree` parameter from the
   same sources.

5. `getField`/`getParent` walk the `EvalState.parent` chain for
   cross-boundary reads (no activeState switching needed for reads).

**What was tried and rejected**: Switching `activeState` during registry
parent walks caused 46 new regressions. The save/restore conflicts with
nested searches. Chain walking handles reads correctly; the only gap is
`syncRegistryCache` which checks `activeState` directly for
state-overlaid children.

5. Remove `_carriedState` property from Node.

The `subtreeMap` WeakMap is the safety net for cases where the NodeState
approach fails (wrong activeState during lookup). Over time, as the
NodeState approach is proven reliable, the subtreeMap can potentially be
removed.

### Long-term target

**Approach 3 (replacement indirection)** remains the cleanest architecture.
The canonical tree stays immutable, state is purely overlay, and the
Call→subtree link is never lost. But it requires:

- `_getEvaluatedChildren` that resolves replacements (or making all child
  iteration state-aware)
- Audit of every `_getChildren` consumer for canonical-vs-evaluated semantics
- Potentially splitting the child iteration API

This is a worthwhile goal but should be driven by a concrete need (e.g.,
server-side rendering where the same canonical tree is evaluated multiple
times concurrently) rather than pursued speculatively.
