# Eval Forking: Eliminating Deep Cloning

## Problem

Currently, when a mixin is called or a `$for` loop iterates, we **deep-clone** the entire subtree of rules. This is expensive:
- Object creation for every node in the tree
- Recursive walks to clone children
- A `resetEvalStateDeep` function that walks the cloned tree AGAIN to clear `preEvaluated`/`evaluated` flags
- Special-case logic to recover definition-time selectors and clear stale Ampersand state

Deep cloning exists because evaluation is destructive — `evalNode` mutates the node's value in place, and `preEvaluated`/`evaluated` flags prevent re-evaluation. If a mixin body needs to be evaluated multiple times (multiple calls, or loop iterations), we clone to get a "fresh" copy.

## Solution: Copy-on-Write Value Forking

Instead of cloning entire subtrees, we use a **copy-on-write** system where nodes fork their values lazily on first write. The original (canonical) value is always preserved.

### Core Mechanism

Each node has:
- `value` — the currently active value (read via property access, fast path)
- `_renderKey` — which render context this node's `value` belongs to
- `_childForks` — `Map<RenderKey, NodeValue>` storing alternate value versions
- `_parentForks` — `Map<RenderKey, Node>` storing alternate parent relationships

**Two key principles:**

1. **Fork lazily.** Don't pre-fork values. Only create a fork entry when a node's value actually changes during evaluation. Past efforts forked eagerly, which was slow.

2. **Choose forks sparingly.** The hot path is: if the node's `_renderKey` matches the requested renderKey, OR the node is still canonical (`_renderKey` is undefined), read `.value` directly — zero overhead. The fork map is only consulted when a node has been forked AND the requested renderKey differs from the current one, which is rare in practice since most nodes are never mutated during eval.

**Reading a value:**
```
if (!node._renderKey || node._renderKey === myRenderKey)
  → read node.value directly (hot path, zero overhead)
else
  → look up in node._childForks (cold path, rare)
```

A canonical node (`_renderKey` undefined) is always valid for ANY render context — it means no evaluation pass ever replaced this node's value, so the original is universally correct. This is the common case: most nodes in a tree pass through evaluation unchanged.

**Writing a value (via `set()`):**
1. First write for a given renderKey: shallow-clone the current value, store the original under `CANONICAL` (or the current renderKey), store the new value under the new renderKey
2. Subsequent writes for the same renderKey: update in place
3. The `value` property always reflects the most recently active renderKey

**Parent tracking:**
When a node is adopted into a new parent under a different renderKey, `_parentForks` records the mapping. `getParent(renderKey)` retrieves the correct parent for a given context.

### Render Keys

```typescript
type RenderKey = number | typeof EVAL | typeof CANONICAL;
```

- `CANONICAL` — the original, pre-evaluation value. Always preserved.
- `EVAL` — the default evaluation context (single eval pass).
- Numeric keys — for multiple evaluation passes (e.g., loop iterations, multiple mixin calls). Each iteration gets a unique numeric renderKey.

### How It Replaces Deep Cloning

**Before (deep clone):**
```
for each iteration:
  rules = originalRules.clone(true)     // deep clone entire subtree
  resetEvalStateDeep(rules)             // walk tree again to clear flags
  rules = await rules.eval(context)     // evaluate the fresh copy
```

**After (forking):**
```
for each iteration:
  rules = shallowClone(originalRules)   // clone just the Rules container
  rules._renderKey = nextRenderKey++    // assign unique renderKey
  context.renderKeyStack.push(renderKey)
  rules = await rules.eval(context)     // evaluation forks values on write
  context.renderKeyStack.pop()
```

During evaluation, when a node's value needs to change (e.g., a Reference resolves to a value), `set()` is called with the current renderKey. This:
1. Preserves the canonical value in `_childForks`
2. Stores the new value under the current renderKey
3. Updates `_renderKey` so subsequent reads are fast

Nodes that DON'T change during evaluation (most of them) never fork — they just keep their canonical value. This is the key efficiency win: only nodes that actually differ between iterations pay the cost.

### Context Integration

The `Context` maintains a `renderKeyStack` that tracks the current evaluation context:
- Push a new renderKey when entering a mixin call or loop iteration
- Pop when exiting
- `context.renderKey` returns the top of the stack

`set()` defaults to `context.renderKey` (or `EVAL` if none). Registry lookups and `toTrimmedString()` use the same save/restore pattern as existing frame stacks (rulesContext, calcFrames, etc.).

### What Gets Eliminated

- `resetEvalStateDeep` — no longer needed; canonical nodes retain original eval state
- Deep cloning in mixin evaluation (`rules.clone(true)` in evalCall)
- Deep cloning in `$for` loop iterations
- The `preEvaluated`/`evaluated` flag dance on cloned nodes
- Special-case selector/Ampersand recovery in `resetEvalStateDeep`

### Registry Considerations

When climbing parent chains during registry lookups (`DeclarationRegistry.find`, etc.), we need to use `getParent(renderKey)` instead of `.parent` to follow the correct fork path. Similarly, when searching child Rules, we may need to check `getValue(renderKey)` to get the correct children.

If a forked Rules node needs new registry entries (e.g., a mixin call adds declarations to scope), we create a shallow clone of that specific Rules node — not the entire subtree. This should be rare.

### Implementation Order

1. ~~evalStatic needsReeval~~ — DONE: canonical nodes re-evaluate when renderKey active
2. ~~Registry parent walks~~ — DONE: use getParent(renderKey) in DeclarationRegistry, MixinRegistry, FunctionRegistry
3. ~~Reference.ts FindOptions~~ — DONE: pass context.renderKey into FindOptions
4. ~~Declaration.evalNode uses set()~~ — DONE: uses `set('value', ...)` and `set('important', ...)` with context.renderKey
5. ~~forEachNode renderKey-aware~~ — DONE: uses `set()` when renderKey active, preserves canonical
6. ~~$for loop~~ — DONE (with stopgap): uses wrapper Rules per iteration, eval forking works, but output nodes use `copy()` to snapshot fork state. The `copy()` needs to be replaced by renderKey-aware serialization.
7. **RenderKey-aware serialization** — The missing piece. `PrintOptions.renderKey` exists but isn't wired through. Nodes that read `this.value` during serialization need to use `this.getValue(options.renderKey)` instead. Key sites:
   - `Declaration.declTrimmedString` line 95: `const { name, value, important } = this.value` → `this.getValue(options.renderKey)`
   - `serialize-helper.ts`: need to trace how it iterates Rules children and passes options
   - Rules.toString: propagate `_renderKey` into `options.renderKey` so children inherit it
   - Base node `toTrimmedString` uses `_visitValues(this.value)` — needs to read from getValue
   - **Important**: don't mutate `this.value` during serialization — just use the return value of `getValue()`
8. **After serialization is renderKey-aware**: remove `copy()` from $for output collection
9. **Mixin calls** — same pattern as $for, more complex due to param binding
10. **Remove `resetEvalStateDeep`** — once all deep-clone sites are converted

### Performance Constraints

V8-specific performance is the #1 concern:
- Never add overhead to the common (non-forking) path
- The `evaluated` short-circuit must remain free for normal eval
- Avoid creating Maps/objects/closures unless a fork actually happens
- Prefer inline property checks over method calls on hot paths
