# Registry State-Awareness Plan

## Problem Statement

The registry system was rewritten during the EvalState migration with excessive
indirection (`globalRegistryCache`, `syncRegistryCache`, `registerCanonicalNode`,
`registerSessionNode`, `RegistryDelta`, etc.) that creates bugs and is impossible
to reason about. The actual issue — making registries work with EvalState — is
simpler than this machinery suggests.

## How Registries Work on `dev` (the baseline)

On `dev`, registries are **instance properties** on Rules nodes:

```
Rules {
  rulesetRegistry: RulesetRegistry | undefined
  mixinRegistry: MixinRegistry | undefined
  declarationRegistry: DeclarationRegistry | undefined
  functionRegistry: FunctionRegistry | undefined
}
```

Registration flow:
1. `Rules` constructor iterates `value` children → `registerNode(node)` for each
2. `registerNode` calls `register(type, node)` which lazily creates the registry
3. `register` → `registry.add(node)` → adds to `registry.pendingItems`
4. `getRegistry(type)` returns the instance property (creating if needed)
5. `registry.find(...)` calls `indexPendingItems()` then searches the index + parent walk

Parent walks use `rules.parent` (canonical) to traverse up the scope chain.

### Why this doesn't work with EvalState as-is:
- Parent walks need `getParent(rules, context)` for state-patched scope chains
- A shared canonical Rules (cached import, mixin body) gets eval'd multiple times
  with different state — its instance registry would contain stale entries from
  a previous eval

## What Changed (and What's Bullshit)

### Legitimate EvalState needs:
1. **Parent walks must use `getParent(rules, context)`** instead of `rules.parent`
   to see state-patched parents (e.g. mixin body → outerRules → caller)
2. **Children may be state-overlaid** — `_getChildren(context)` instead of `rules.value`
   for nodes pushed through state (e.g. mixin param scope, with/set injection)
3. **Registry find options need `context`** — already handled via `FindOptions.context`
4. **Shared canonical nodes need per-eval registries** — two mixin calls to the same
   mixin body should each see their own param scope

### What was added (mostly unnecessary):
- `globalRegistryCache` / `RegistryData` — moved index storage off nodes into WeakMap
  keyed by value array identity.
- `syncRegistryCache` — re-indexes canonical children on every `getRegistry` call.
- `registerCanonicalNode` / `registerSessionNode` — split registration into canonical
  vs state paths.
- `RegistryDelta` / `ensureSessionRegistryIndex` — state-level registry overlay.
- `peekRegistryData` / `ensureRegistryData` — accessors for the global cache.
- `isRegistryIndexing` / `indexingRegistryValues` — re-entrancy guard.

None of these solve the actual problem. They paper over the symptom (missing
registry entries) instead of fixing the cause (unevaluated Rules).

## Design: Registries as Derived State

Registries are **derived data** — an index over a Rules node's children. Like
EvalState itself, they should follow the canonical + overlay pattern. The design
should feel native to EvalState, not bolted on to either the old or new model.

### Principle: a registry is a view of children in context

```
registry(rules, context) = index( rules._getChildren(context) )
```

A registry for a Rules node is determined by:
1. Which children are visible (canonical + state overlays)
2. Which eval context is active (for parent walks during `find`)

That's it. No global caches, no deltas, no sync.

### Where do registries live?

**On the NodeState.** Just like `parent`, `selector`, `rules` — a registry is
per-(node, state) data. EvalState already stores per-node fields. A registry
is one more field.

```ts
// NodeState already has:
//   replacement, evaluated, preEvaluated, fields (Map)
//
// Registry is just another field:
//   state.get(rules).fields.get('_registry')  →  RegistrySet

class RegistrySet {
  ruleset: RulesetRegistry;
  mixin: MixinRegistry;
  declaration: DeclarationRegistry;
  function?: FunctionRegistry;
}
```

This means:
- Canonical Rules (no context) → registries stored as instance properties
  (same as `dev` baseline — works for setup, tests, pre-eval lookups)
- Eval'd Rules (with context) → registries stored in NodeState fields
  (scoped to the eval state, automatically isolated per mixin call / import)

### Registration flow:

```ts
// During eval, registerNode writes to the context-scoped registry:
rules.register('mixin', node, context)
  → rules.getRegistry('mixin', context).add(node)

// getRegistry resolves the registry from state or instance:
rules.getRegistry(type, context?) {
  if (context) {
    // State-scoped: check NodeState first
    let set = context.activeState.peek(this)?._fields?.get('_registry');
    if (!set) {
      set = new RegistrySet(this);
      context.activeState.get(this).fields.set('_registry', set);
    }
    return set[type];
  }
  // No context: instance property (canonical)
  return this._getOrCreateInstanceRegistry(type);
}
```

### Why this is clean:

- **No global WeakMap**: registries live in NodeState, same as all other state
- **No sync**: registries are populated during eval, not re-indexed on read
- **No canonical/session split**: one `add()` path — state-scoped when context
  exists, instance when it doesn't
- **No delta overlay**: each eval context gets its own RegistrySet in its own state
- **Shared canonical isolation for free**: two mixin calls push different states,
  so their NodeState entries (and registries) are automatically separate
- **Parent walks are state-aware**: `find` uses `getParent(rules, context)` which
  walks `EvalState.parent` chain — same mechanism as all other state reads

### Shared canonical body problem (solved by design):

When the same mixin body is called twice:
- Call 1: per-call state is pushed. `rules.getRegistry('mixin', context)` creates
  a RegistrySet in this state's NodeState. Body eval registers children here.
- Call 2: different per-call state. `rules.getRegistry('mixin', context)` creates
  a SEPARATE RegistrySet in the new state. No collision.

No wrappers or clones needed just for registry isolation.

### Fallback for unevaluated Rules:

Some lookups happen before eval (e.g. `context.root.find(...)` during setup).
These use `getRegistry(type)` without context → instance property fallback.
The Rules constructor registers children into instance registries, same as `dev`.

## Phase Plan

### Phase 1: Add `_registry` to NodeState fields
- `getRegistry(type, context)` checks `activeState.peek(this)?._fields?.get('_registry')`
- Falls back to instance property when no context or no state entry
- `register(type, node, context)` writes to state-scoped registry when context exists

### Phase 2: Remove the machinery
Delete from registry-utils.ts:
- `globalRegistryCache`, `RegistryData`, `peekRegistryData`, `ensureRegistryData`
- `syncRegistryCache`
- `registerCanonicalNode`, `registerSessionNode`
- `RegistryDelta`, `ensureSessionRegistryIndex`, `getRegistryIndex`
- `isRegistryIndexing`, `indexingRegistryValues`

### Phase 3: Verify parent walks
Audit all `find` methods in all 4 Registry classes — ensure parent walks use
`getParent(rules, this.context)`.

### Phase 4: Verify eval-before-lookup
Audit all call sites where `find` is called on a Rules that might not be eval'd.
The fix is always: eval the Rules first, not add re-indexing.

## Key Principle

**If the Rules was properly eval'd, its registry has the right entries.**

Eval auto-registers children to the correct registry. If a lookup fails and the
target Rules clearly has the node in its `value` (or state-overlaid value), the
problem is almost certainly a skipped eval step — not a registry bug. The fix is
to ensure the Rules is eval'd before the lookup, not to add re-indexing machinery.

## Files Affected

- `packages/core/src/tree/util/registry-utils.ts` — remove ~200 lines of functions,
  add `RegistryStore` and `RegistrySet`
- `packages/core/src/tree/rules.ts` — wire `getRegistry`/`register` through store
- `packages/core/src/context.ts` — add `registries: RegistryStore`
- Tests that reference removed APIs
