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

## What Changed (and What's Bullshit)

### Legitimate EvalState needs:
1. **Parent walks should use `getParent(rules, context)`** instead of `rules.parent`
   to see state-patched parents (e.g. mixin body → outerRules → caller)
2. **Children may be state-overlaid** — `_getChildren(context)` instead of `rules.value`
   for nodes pushed through state (e.g. mixin param scope, with/set injection)
3. **Registry find options need `context`** — already handled via `FindOptions.context`

### What was added (mostly unnecessary):
- `globalRegistryCache` / `RegistryData` — moved index storage off nodes into WeakMap
  keyed by value array identity. **Unnecessary**: registries can stay on nodes.
- `syncRegistryCache` — re-indexes canonical children on every `getRegistry` call.
  **Unnecessary**: children are indexed during construction/registerNode.
- `registerCanonicalNode` / `registerSessionNode` — split registration into canonical
  vs state paths. **Unnecessary**: registration should just work like dev, with
  state-overlaid children handled by the same `add()` path.
- `RegistryDelta` / `ensureSessionRegistryIndex` — state-level registry overlay.
  **Unnecessary**: if we eval the Rules properly, its registry has the right entries.
- `peekRegistryData` / `ensureRegistryData` — accessors for the global cache.
  **Unnecessary** if we go back to instance properties.

### The actual bug the machinery was trying to solve:
When a canonical Rules node is shared (e.g. cached import, mixin body), its
instance registry contains entries from one eval context. A second eval context
would see stale entries. The solution was the global cache + delta system.

**But the real fix is simpler**: eval the Rules in context (which populates the
registry correctly), and if a Rules is shared, give each eval context its own
registry instance (via the existing clone/wrapper mechanism).

## Proposed Plan

### Phase 1: Restore instance registries on Rules

Revert `getRegistry` to return/create instance properties instead of going through
`syncRegistryCache` + `new RegistryClass()` every call. Keep `functionRegistry`
as-is (it already works this way).

```ts
getRegistry(type, context?) {
  let registry = this[`${type}Registry`];
  if (!registry) {
    registry = new RegistryClass(this, context);
    this[`${type}Registry`] = registry;
  }
  return registry;
}
```

### Phase 2: Make parent walks state-aware

The Registry base class `find` methods already use `getParent(rules, this.context)`
for parent walks. Verify ALL parent walks pass context. This is the legitimate
state-awareness need.

### Phase 3: Handle state-overlaid children

When children are pushed through state (mixin params, with/set injection), the
registry needs to see them. Options:
- **Option A**: Build ephemeral scope nodes canonically (like we already do for
  mixin params and with/set). Then the instance registry indexes them normally.
- **Option B**: On `getRegistry`, check for state-overlaid children and register
  any new ones before returning.

Option A is preferred — we already moved to this pattern.

### Phase 4: Remove the bullshit

Delete:
- `globalRegistryCache`, `RegistryData`, `peekRegistryData`, `ensureRegistryData`
- `syncRegistryCache`
- `registerCanonicalNode`, `registerSessionNode`
- `RegistryDelta`, `ensureSessionRegistryIndex`, `getRegistryIndex`
- `isRegistryIndexing`, `indexingRegistryValues`

### Phase 5: Audit find methods

Ensure all Registry `find` methods:
- Accept and thread `context` for parent walks
- Use `_getChildren(context)` where needed (or canonical children for canonical registries)
- Don't have workarounds for missing entries

## Key Principle

**If the Rules was properly eval'd, its registry has the right entries.**

Eval auto-registers children to the correct registry. If a lookup fails and the
target Rules clearly has the node in its `value` (or state-overlaid value), the
problem is almost certainly a skipped eval step — not a registry bug. The fix is
to ensure the Rules is eval'd before the lookup, not to add re-indexing machinery.

The bug that started this whole mess was that target Rules weren't being eval'd
before lookup. The fix is to eval them, not to add 200 lines of caching machinery.

## Files Affected

- `packages/core/src/tree/util/registry-utils.ts` — remove ~200 lines of functions
- `packages/core/src/tree/rules.ts` — restore instance registry pattern in `getRegistry`,
  `register`, and constructor
- Tests that reference removed APIs
