# Dependency Graph, Session-Local Registries, and Live Patch API

## Reality Check

Stages 17–20 in this document describe the intended architecture and the major slices
that have landed on `jess-dev`. They do not mean the branch already satisfies the full
immutable-node plus session-layer contract.

Current branch reality:

- Dependency tracking exists.
- Registry deltas exist.
- Import-path clone reduction has gone a long way.
- Session-aware field reads now exist on lower-order nodes, and selector ancestry reads on active `Ruleset` / extend paths are session-aware.
- Returned import trees now materialize clone-only parent links after session teardown; ephemeral mixin guard wrapper scopes materialize their local param bindings directly.
- The branch is still in a fundamentals-completion gate before Stage 21.

That gate is only cleared when canonical nodes actually behave immutably, eval-time
replacements/value writes are session-layer operations, tests match baseline with those
properties true, and merge-to-`dev` is behavior-safe.

## Overview

This document covers three tightly coupled architectural advances that build on the
COW / EvalSession foundation from Stages 7–15:

1. **Dependency graph** — tracking which top-level `VarDeclaration`s flow into each
   output node during eval, enabling incremental re-eval and patch eligibility.
2. **Session-local (detached) registries** — decoupling registry indices from `Rules`
   instance identity so shallow clones share an index, sessions carry only deltas,
   and mixin bodies no longer need deep cloning.
3. **Live Patch API** — emitting `var(--id, fallback)` CSS and a `patch.js` bundle
   using `@jesscss/fns` functions, powered by the same dependency graph.

These three consumers share a single underlying data structure. Build it once; use it
three ways.

---

## Part 1: Dependency Graph

### What it is

During eval, every output node carries a `dependsOn` annotation — the set of top-level
`VarDeclaration` nodes whose runtime values influenced this output:

```ts
// On any evaluated output node (stored session-locally, not on the canonical node)
interface EvalDependency {
  dependsOn: Set<VarDeclaration> | null; // null = static (no top-level vars)
  sourceExpr?: Node;                     // canonical pre-eval expression (for patch.js)
}
```

`dependsOn: null` means the value was fully constant at compile time — no re-eval is
ever needed, no `var()` wrapper is emitted.

### How it is built (eval-time propagation)

**Seed point**: `Reference.evalNode()`, when the resolved target is a top-level
`VarDeclaration` (root `Rules` scope, not a mixin param or block-local binding):

```
Reference(@primary)
  → resolves to VarDeclaration(@primary) at root scope
  → output node tagged: dependsOn = { VarDeclaration(@primary) }
                         sourceExpr = canonical Reference node
```

**Propagation upward**:

| Node type | Rule |
|-----------|------|
| `Reference` to root `VarDeclaration` | seed `{varDecl}` |
| `Reference` to local/mixin variable | inherit `dependsOn` from resolved value |
| `Operation`, `Call`, `Expression` | union of all children's `dependsOn` sets |
| `Declaration` value | propagate from its value node |
| Static literals (`Dimension`, `Color`, `Any`, etc.) | `null` |

**Mixin parameter boundary**:

When a mixin is called, each parameter `@x: expr` resolves `expr` in the caller's scope.
If `expr` carries `dependsOn = {VarDeclaration(@primary)}`, then any use of `@x` inside
the mixin body inherits that dependency. If `expr` is static, `@x` is static inside the
mixin — its uses do not propagate outward.

This means dependency chains cross mixin call boundaries correctly: the dependency on
`@primary` survives through `darken(@primary, 10%)` called as a mixin argument, but a
mixin that takes a literal `10%` absorbs that input as static.

### Where `dependsOn` lives

The annotation is **session-local** — stored in `EvalSession.dependencyMap`:

```ts
interface EvalSession {
  // ... existing fields ...
  dependencyMap: WeakMap<Node, EvalDependency>;
}
```

This means:
- Canonical nodes are never annotated (they stay pristine).
- Different sessions (different callers with different variable values) can have
  different dependency annotations for the same canonical expression.
- When the session is discarded, the annotations are garbage-collected with it.

### Read surface

```ts
// Get the dependency annotation for a node in the current session
function sessionGetDependency(node: Node, ctx: Context): EvalDependency | null

// Set the dependency annotation
function sessionSetDependency(node: Node, dep: EvalDependency, ctx: Context): void

// Quick check: does this node depend on any top-level variable?
function sessionIsStatic(node: Node, ctx: Context): boolean
```

When no session is active, `sessionIsStatic` returns `true` for all nodes (legacy
behavior: everything is treated as static, same as today).

---

## Part 2: Session-Local (Detached) Registries

### The problem with current registries

Every `Rules` instance owns four registry fields (`rulesetRegistry`, `mixinRegistry`,
`declarationRegistry`, `functionRegistry`). These are rebuild from scratch whenever:

1. A `Rules` node is cloned (`rulesIndexed = 0`).
2. A session needs isolated scope for mixin body eval.
3. An import is re-evaluated with different variables.

The registry is coupled to the instance wrapper, not to the content. Two `Rules` instances
with identical `value[]` arrays build two identical indices. A COW shallow clone forces a
full re-index even though nothing changed.

### The key insight: index the content, not the wrapper

The index is a function of `value[]` — the array of child nodes. Not of the `Rules` wrapper.
A module-level `WeakMap` keyed by array reference gives structural sharing automatically:

```ts
// module-level singleton (or per-stylesheet root)
const globalRegistryCache = new WeakMap<Node[], RegistryData>();

interface RegistryData {
  rulesetIndex:     Map<string, Set<Ruleset>>   | undefined;
  mixinIndex:       Map<string, Set<Mixin>>     | undefined;
  declarationIndex: Map<string, Set<Declaration>> | undefined;
  indexedLength: number; // how far into the array we've indexed
}
```

`rules.getRegistry(type)` becomes:

```ts
getRegistry(type) {
  const key = this.value; // the array reference
  let data = globalRegistryCache.get(key) ?? { indexedLength: 0 };
  if (data.indexedLength < key.length) {
    // append-only incremental indexing
    for (let i = data.indexedLength; i < key.length; i++) {
      registerNodeInData(data, key[i], type);
    }
    data.indexedLength = key.length;
    globalRegistryCache.set(key, data);
  }
  return buildRegistryView(data, type);
}
```

**COW shallow clone shares the index automatically**: `clone(false)` produces a new
`Rules` wrapper but `clone.value === original.value`. Same array → same `WeakMap` key →
same index. No re-indexing. Zero cost.

**Array mutation creates a new index slot automatically**: when a session mutates
`rules.value` (inserting a node from mixin expansion), it first COW-copies the array:
`session.valueOverride = [...rules.value]`. The new array reference gets its own
`WeakMap` entry. The canonical index is never touched.

**`functionRegistry` stays instance-owned** — plugins inject functions into it without
creating AST nodes, so it can't be derived from `value[]` content. Keep it as a direct
field on `Rules`.

### Session-local registry delta

When a session adds nodes (mixin expansion, `$for` loop iteration vars), those nodes
are not in the canonical `value[]`. They live in a per-session delta:

```ts
interface EvalSession {
  // ... existing fields ...
  registryDeltas: WeakMap<Rules, SessionRegistryDelta>;
  dependencyMap: WeakMap<Node, EvalDependency>;
}

interface SessionRegistryDelta {
  rulesetIndex?:     Map<string, Set<Ruleset>>;
  mixinIndex?:       Map<string, Array<{ value: Mixin | Ruleset; match: string[] }>>;
  declarationIndex?: Map<string, Set<Declaration>>;
}
```

Lookup order:
1. Check `session.registryDeltas.get(rules)` first (session-added nodes).
2. Fall through to `globalRegistryCache.get(rules.value)` (canonical index).

This means mixin expansion nodes are visible within the session but don't pollute the
canonical index. When the session ends, the delta is garbage-collected.

### Dependency-aware partial re-eval

Registry entries carry their `dependsOn` annotation (from the dependency graph):

```ts
interface DeclarationEntry {
  node: Declaration;
  dependsOn: Set<VarDeclaration> | null; // inherited from eval-time dependency
}
```

When a session changes variable `@primary`:

```
changedVars = { VarDeclaration(@primary) }

for each entry in declarationIndex:
  if entry.dependsOn ∩ changedVars ≠ ∅:
    → needs re-eval in this session
  else:
    → use canonical resolved value directly
```

Only the affected entries get a session-local overlay. Everything static resolves to
the canonical WeakMap index at zero marginal cost.

### What this replaces

| Current mechanism | Replaced by |
|-------------------|-------------|
| `rules.clone(true)` for mixin body | Session with canonical canonical body; session delta for injected vars |
| `clone(false)` + `rulesIndexed = 0` | Shared WeakMap index (no reset needed) |
| `_dedupe` / `multiple` re-eval clone | Session per output instance; canonical index shared |
| Compose cached re-eval `clone(true)` | Session isolation; no clone |
| `sessionMarkScopeDirty` (stub) | Invalidate session delta for changed `value[]` key |

### Changes to `Rules` class

```
REMOVE from Rules:
  - rulesetRegistry: RulesetRegistry | undefined
  - mixinRegistry: MixinRegistry | undefined
  - declarationRegistry: DeclarationRegistry | undefined
  - rulesIndexed: number
  - _indexing: boolean
  - _indexRules()

KEEP on Rules (still instance-owned):
  - functionRegistry: FunctionRegistry | undefined

CHANGE Rules.getRegistry():
  - Key off this.value (array reference) into globalRegistryCache
  - Check session delta first when ctx?.session is active
  - Return a view combining delta + canonical index

CHANGE Rules.register(type, node, ctx?):
  - When ctx?.session active: write to session.registryDeltas
  - When no session: write to globalRegistryCache entry for this.value

CHANGE Rules.clone():
  - Remove rulesIndexed/rulesIndexed/indexing reset — index is keyed by array, not by Rules
  - Shallow clone still gets the same index as canonical (same value[] reference)
  - functionRegistry: keep existing cloneForRules() behavior
```

---

## Part 3: Live Patch API

### Goal

Emit two outputs from a single Jess compilation:

1. **CSS with custom property fallbacks** — every `Declaration` value that is dynamic
   and traces to at least one top-level `VarDeclaration` is emitted as:
   ```css
   color: var(--jess-primary, #4477aa);
   ```
   Static values are emitted as today (`color: #4477aa`).

2. **`patch.js`** — a tree-shakeable ES module that re-expresses each top-level
   variable's downstream transformations using `@jesscss/fns`. Consumers call:
   ```js
   import { patch } from './patch.js';
   patch(document, { primary: 'red' });
   ```
   Only the `@jesscss/fns` functions actually used are imported (full tree-shaking).

### Eligibility rule

A `Declaration` value is patchable if:
- `F_NON_STATIC` is set on the value node (not collapsed at compile time), **AND**
- `session.dependencyMap.get(valueNode).dependsOn` is non-null and non-empty

Values that are `F_NON_STATIC` but only depend on mixin-local parameters (not top-level
vars) are emitted statically — those knobs can't be turned from outside.

### Why the canonical tree is required

The pre-eval expression (`lighten(@primary, 10%)`) on the canonical tree IS the `patch.js`
expression — same `@jesscss/fns` function, same argument structure. The evaluated value
(`#4477aa`) is the CSS fallback. Both must be simultaneously available.

COW / EvalSession (Stages 7–15) preserves the canonical tree unmutated alongside the
session-evaluated output. This is the prerequisite.

### Implementation sketch

**Step 1: `_sourceVariable` tagging** (in `Reference.evalNode()`)

When a `Reference` resolves to a top-level `VarDeclaration`:
```ts
// Store on the output node (session-local)
sessionSetDependency(resolved, {
  dependsOn: new Set([varDecl]),
  sourceExpr: this // canonical Reference node
}, ctx);
```

**Step 2: dependency propagation** (in `Operation.evalNode()`, `Call.evalNode()`, etc.)

```ts
// Merge child dependencies into output
const childDeps = children.map(c => sessionGetDependency(c, ctx)?.dependsOn ?? null);
const merged = mergeDependencies(childDeps); // null if all null, else union
if (merged) {
  sessionSetDependency(result, {
    dependsOn: merged,
    sourceExpr: this // canonical Call/Operation node
  }, ctx);
}
```

**Step 3: Declaration serialization**

```ts
// In Declaration.toTrimmedString() or the serialize path
const dep = ctx?.session && sessionGetDependency(valueNode, ctx);
if (dep && dep.dependsOn?.size > 0) {
  const id = ctx.patchSideTable.register(dep);
  // emit: var(--jess-<id>, <fallback>)
} else {
  // emit as today
}
```

**Step 4: patch.js emitter** (new emitter module)

Walk `ctx.patchSideTable` after serialization. For each entry `(varDecl, sourceExpr, cssId)`:
- Resolve the `@jesscss/fns` functions referenced in `sourceExpr`
- Emit an update function:
  ```js
  import { lighten } from '@jesscss/fns/color';
  export function updatePrimary(doc, value) {
    doc.documentElement.style.setProperty('--jess-1', lighten(value, 10));
  }
  ```
- Aggregate into a top-level `patch(doc, overrides)` function

**What is NOT patchable** (structural — CSS shape changes, not just value changes):
- Selector interpolation: `.icon-@{name}` — changes which selector exists
- Conditional mixin application: `@if @flag { .mixin() }` — changes structure
- `@for` / `@each` with variable-length loops — changes how many rules exist

---

## Unified Architecture Diagram

```
CANONICAL TREE (immutable after parse)
  │
  ├─ Rules.value[] ─────────────────────────────────────────────┐
  │    ├─ VarDeclaration(@primary: red)                          │
  │    ├─ Ruleset(.btn)                                          │
  │    │    └─ Declaration(color: lighten(@primary, 10%)) ◄──────┼── sourceExpr preserved here
  │    └─ Mixin(.darken-mixin, params[@color, @amount])          │
  │                                                              │
  └─ globalRegistryCache: WeakMap<Node[], RegistryData>  ◄───────┘
       └─ RegistryData { declarationIndex, mixinIndex, rulesetIndex, indexedLength }
            (built once, shared across all shallow COW clones)

EVAL SESSION (one per import / mixin invocation / patch context)
  │
  ├─ runtimeState: WeakMap<Node, RuntimeState>
  │    └─ { parent, index, evaluated, preEvaluated }
  │
  ├─ dependencyMap: WeakMap<Node, EvalDependency>
  │    └─ { dependsOn: Set<VarDeclaration>, sourceExpr: Node }
  │         (populated by Reference.eval, propagated by Operation/Call/Expression.eval)
  │
  └─ registryDeltas: WeakMap<Rules, SessionRegistryDelta>
       └─ { declarationIndex, mixinIndex, rulesetIndex }
            (session-added nodes only; canonical index from globalRegistryCache)

LOOKUP FLOW (Declaration find):
  1. session.registryDeltas.get(rules)?         → session-added nodes first
  2. globalRegistryCache.get(rules.value)?       → canonical index (built once)
  3. parent chain walk (unchanged)

SERIALIZATION FLOW:
  For each Declaration value node:
    if session.dependencyMap has entry AND dependsOn.size > 0:
      emit var(--jess-<id>, <fallback>)
      register (varDecl, sourceExpr, id) in patchSideTable
    else:
      emit as today

PATCH.JS EMIT (post-serialization):
  Walk patchSideTable → emit @jesscss/fns call graph per varDecl
```

---

## Complete Checklist

### Stage 17: Immutable Selectors

This is the prerequisite for eliminating the remaining ~50 `copy(true)` calls in
`extend-core.ts` and `selector-utils.ts`. Currently extend writes to both `_extendedSelector`
AND `selector` on `Ruleset`. Stopping the `selector` mutation makes selector nodes safe to share.

- [ ] `extend-roots.ts` `applyInstructionToRuleset`: stop `setData('selector', ...)` — only write `_extendedSelector`
- [ ] `extend-roots.ts`: remove `selectorBeforeExtend` save/restore (`copy(true)` at line 515) — no longer needed when `selector` is immutable
- [ ] `Ruleset.getEffectiveSelector()`: already uses `_extendedSelector ?? selector` — verify all callers use this, not `.selector` directly
- [ ] `selector-utils.ts` `hasExtendedSelector`: verify it reads `_extendedSelector` (for `renderEnabled` in serialize-helper.ts)
- [ ] `extend-core.ts`: audit all `copy(true)` — classify: (a) copying for extend output mutation, (b) copying for selector assembly
  - [ ] Type (a) calls: replace with `clone(false)` path-copy builder (new container, reuse unchanged items)
  - [ ] Type (b) calls: should now be unnecessary if downstream code reads `getEffectiveSelector()`
- [ ] `selector-utils.ts`: same audit — replace mutation-safety copies with structural-sharing builders
- [ ] `ruleset.ts:544`: `selector.clone(true)` for sourceNode storage — replace with reference to canonical `selector` (no clone needed if immutable)
- [ ] `ampersand.ts:228`: `selector.clone(true)` during eval — evaluate whether still needed
- [ ] Structural sharing builder helpers (new `selector-builders.ts`):
  - [ ] `appendSelectorAlternative(target, added)` — new SelectorList container, reuse existing items
  - [ ] `rewriteCompound(compound, mapper)` — new CompoundSelector if any item changes
  - [ ] `rewriteSelectorPath(root, path, replacement)` — path-copy from root to changed item
- [ ] Tests green (target: 5 failed / 63 passed baseline maintained or better)
- [ ] `copy(true)` count in extend paths: target ≤ 5 remaining

### Stage 18: Dependency Graph Infrastructure

- [ ] Add `EvalDependency` type to `eval-session.ts`:
  ```ts
  interface EvalDependency {
    dependsOn: Set<VarDeclaration>;
    sourceExpr: Node; // canonical pre-eval expression node
  }
  ```
- [ ] Add `dependencyMap: WeakMap<Node, EvalDependency>` to `EvalSession`
- [ ] Add session helpers to `session-helpers.ts`:
  - [ ] `sessionGetDependency(node, ctx): EvalDependency | null`
  - [ ] `sessionSetDependency(node, dep, ctx): void`
  - [ ] `sessionIsStatic(node, ctx): boolean` — true if no session or dependsOn is null/empty
  - [ ] `sessionMergeDependencies(nodes, ctx): EvalDependency | null` — union of dependsOn sets
- [ ] `Reference.evalNode()`: when resolved target is a root-scope `VarDeclaration`, call `sessionSetDependency`
  - [ ] Helper: `isTopLevelVarDeclaration(node, ctx): boolean` — checks if the declaring `Rules` is the root scope
- [ ] `Operation.evalNode()`: after eval, call `sessionMergeDependencies` on operands; if non-null, set on result
- [ ] `Call.evalNode()`: same pattern on args
- [ ] `Expression.evalNode()`: same pattern on parts
- [ ] `Declaration.evalNode()`: propagate from value node to declaration output
- [ ] Unit tests for dependency propagation:
  - [ ] Static literal: `dependsOn = null`
  - [ ] Direct top-level var: `dependsOn = {varDecl}`
  - [ ] Operation on top-level var: `dependsOn` propagates
  - [ ] Mixin param that absorbs static input: `dependsOn = null`
  - [ ] Mixin param that passes through top-level var: `dependsOn = {varDecl}`
  - [ ] No-session parity: all helpers return null / no-op without session

### Stage 19: WeakMap-Keyed Shared Registries

- [ ] Add module-level `globalRegistryCache: WeakMap<Node[], RegistryData>` to `registry-utils.ts`
- [ ] Define `RegistryData` type:
  ```ts
  interface RegistryData {
    rulesetIndex?:     Map<string, Set<Ruleset>>;
    mixinIndex?:       Map<string, Set<Mixin>>;
    declarationIndex?: Map<string, Set<Declaration>>;
    indexedLength: number;
  }
  ```
- [ ] Refactor `Rules.getRegistry(type)`:
  - [ ] Key off `this.value` (array reference) into `globalRegistryCache`
  - [ ] Incremental indexing: walk `value[indexedLength..value.length]` to update
  - [ ] Return a view object that wraps the `RegistryData` entry (same API as current Registry class)
- [ ] Refactor `Rules.register(type, node)`:
  - [ ] Write into `globalRegistryCache.get(this.value)` entry (creating if absent)
  - [ ] When `ctx?.session` active: write into session delta instead (Stage 20)
- [ ] Remove from `Rules` class:
  - [ ] `rulesetRegistry: RulesetRegistry | undefined`
  - [ ] `mixinRegistry: MixinRegistry | undefined`
  - [ ] `declarationRegistry: DeclarationRegistry | undefined`
  - [ ] `rulesIndexed: number`
  - [ ] `_indexing: boolean`
  - [ ] `_indexRules()`
- [ ] Keep `functionRegistry` as instance field (unchanged)
- [ ] Update `Rules.clone()`: remove `rulesIndexed = 0` / `_indexing = false` / `_rulesSet = undefined` resets for the three detached registries
- [ ] Update `Registry` base class (or replace with `RegistryData` + standalone functions):
  - [ ] `RulesetRegistry`, `MixinRegistry`, `DeclarationRegistry` — refactor to operate on `RegistryData` entries rather than holding a `rules: Rules` reference
  - [ ] `_searchRulesChildren` — update to key off `rules.value` for cache lookups
- [ ] Tests: verify shallow clone of `Rules` shares registry index with original (no re-indexing cost)
- [ ] Tests: verify mutation of cloned `Rules.value` array creates a new index slot

### Stage 20: Session-local Registry Deltas + Eliminate Import Cloning

Status on branch `jess-dev`:
- the registry-delta and import-reduction slice is materially landed
- plain `@import` now reuses the evaluated root directly
- compose still keeps a shallow per-import wrapper where import-site metadata must differ
- this stage did not complete the deeper immutability/session contract for all eval-time writes

### Completed

- [x] Add `registryDeltas: WeakMap<Rules, SessionRegistryDelta>` to `EvalSession`
- [x] Define `SessionRegistryDelta`:
  ```ts
  interface SessionRegistryDelta {
    rulesetIndex?:     Map<string, Set<Ruleset>>;
    mixinIndex?:       Map<string, Array<{ value: Mixin | Ruleset; match: string[] }>>;
    declarationIndex?: Map<string, Set<Declaration>>;
  }
  ```
- [x] `sessionRegister(rules, type, node, ctx)` helper — writes to session delta when session active
- [x] Update `Rules.register()` to call `sessionRegister` when `ctx?.session` active
- [x] Update `Rules.getRegistry()` lookup order: session delta first, then canonical WeakMap
- [x] Activate `sessionMarkScopeDirty`:
  - [x] Invalidate session delta for the given `Rules` container when scope changes
- [x] Remove `rules.ts:2293` `clone(true)` for detached ruleset unlock:
  - [x] Detached ruleset unlock now uses session-isolated shallow clone semantics
- [x] `_dedupe`/`multiple` branch: remove the per-Ruleset selector deep-clone workaround from the `clone(false)` finalization path
- [x] Dependency-aware partial re-eval in lookup:
  - [x] `DeclarationRegistry.find()`: when session has `changedVars`, skip entries whose `dependsOn ∩ changedVars = ∅`
  - [x] Return canonical resolved value for static entries without re-eval
- [x] **Eliminate structural import cloning** (`import-style.ts getFinalRules`):
  - [x] plain `@import` branch: reuse the evaluated shallow root directly during finalization
  - [x] configured compose parent cleanup: canonical top-level nodes are restored after session teardown
  - [x] keep only shallow wrappers where import-site metadata must differ (`compose` visibility/reference surface and `_dedupe` extend isolation)
  - [x] canonical index remains shared across all of these output paths
- [x] Tests: repeated `_dedupe` imports share canonical registry (no index rebuild)
- [x] Tests: mixin expansion nodes appear in session delta, not canonical index
- [x] Tests: session registry delta survives shallow clone `value[]` replacement

### Stage 21: Live Patch API

Precondition: do not start this stage until the branch clears the pre-Stage-21 threshold:

- remaining clone/copy sites targeted by this refactor are removed
- remaining eval-time writes / mutations / node replacements in scope route through sessions
- tests pass to the accepted baseline with those conditions true
- merge back to `dev` is credible without behavior drift

- [ ] Add `PatchSideTable` to `Context`:
  ```ts
  interface PatchSideTable {
    entries: Array<{
      varDecl: VarDeclaration;
      sourceExpr: Node;         // canonical pre-eval node
      cssId: string;            // --jess-<id>
      fallback: string;         // compile-time computed value
    }>;
    register(dep: EvalDependency, fallback: string): string; // returns cssId
  }
  ```
- [ ] `Declaration.toTrimmedString()` (or serialize-helper.ts): after computing value string,
  check `sessionGetDependency(valueNode, ctx)` — if non-null, emit `var(--jess-<id>, <fallback>)`
- [ ] `patchSideTable.register()` deduplicates by `(varDecl, sourceExpr)` identity — same
  expression in multiple places gets the same custom property
- [ ] New `patch-emitter.ts` module:
  - [ ] Walk `patchSideTable.entries`
  - [ ] For each `varDecl`: collect all downstream expressions (grouped by top-level var)
  - [ ] Resolve `@jesscss/fns` imports from `Call.name` in `sourceExpr` subtrees
  - [ ] Emit per-variable update function + aggregate `patch(doc, overrides)` entry point
  - [ ] Output: valid ES module, tree-shakeable, no runtime other than `@jesscss/fns`
- [ ] CLI / plugin API:
  - [ ] `jess compile --patch` flag enables side table collection and patch.js emission
  - [ ] Jess plugin (`packages/jess-plugin`) emits `patch.js` alongside CSS output
- [ ] Tests:
  - [ ] Static declaration: no `var()` wrapper emitted
  - [ ] Direct top-level var reference: `var(--jess-1, value)` emitted
  - [ ] Derived value via `@jesscss/fns`: correct `var()` + patch.js call graph
  - [ ] Mixin that absorbs static param: treated as static
  - [ ] Mixin that passes through top-level var: patchable end-to-end
  - [ ] Selector interpolation: NOT patchable (structural)

---

## Dependencies Between Stages

```
Stage 17 (immutable selectors)
  └─ unblocks: eliminate copy(true) in extend-core / selector-utils
  └─ unblocks: remove selectorBeforeExtend copy(true) in extend-roots
  └─ simplifies: Stage 20 import cloning removal (selector deep-clone in getFinalRules was workaround)

Stage 18 (dependency graph)
  └─ required by: Stage 20 partial re-eval, Stage 21 Live Patch API

Stage 19 (WeakMap registries)
  └─ required by: Stage 20 session deltas
  └─ enables: Stage 20 import clone elimination (no re-indexing cost on shallow clone)

Stage 20 (session deltas + no import clone)
  └─ lands the registry-delta/import-reduction groundwork
  └─ does not by itself complete immutable canonical nodes + session-backed writes
  └─ requires a fundamentals-completion gate before Stage 21

Stage 21 (Live Patch API)
  └─ all prior stages required
  └─ blocked until the pre-Stage-21 threshold is satisfied
```

Stages 17 and 18 can proceed in parallel. Stage 19 depends on 17 (immutable selectors
simplify registry content; though technically 19 could start without 17, they are cleanest
together). Stage 20 requires 18 and 19. Stage 21 requires all.

---

## Interaction with `EvalSession` Schema

The `EvalSession` type gains two new `WeakMap` fields. Updated full schema:

```ts
interface EvalSession {
  // Stage 7 (original)
  nodePatches: WeakMap<Node, Record<string, unknown>>;    // field overrides
  runtimeState: WeakMap<Node, RuntimeState>;              // parent, index, eval flags
  materializedNodes: WeakSet<Node>;                       // boundary tracking

  // Stage 20 (new)
  registryDeltas: WeakMap<Rules, SessionRegistryDelta>;   // session-added registry entries

  // Stage 18 (new)
  dependencyMap: WeakMap<Node, EvalDependency>;           // eval-time dependency annotations
}
```

No existing fields change. Both new fields are `WeakMap`s — zero cost when empty, GC'd
automatically when session is discarded.

---

## Relationship to README.md Architecture

This document extends the [EvalSession design in README.md](./README.md#2-evalsession-for-imports-and-divergent-evaluation)
with two concrete additions:

1. **`dependencyMap`** — fills in "what did this eval depend on?" (README sketched this
   as `ScopeSnapshot` for re-eval; the dependency graph is the forward direction of
   the same information).

2. **Detached registries** — fulfills the README's observation that "Registries and
   caches may currently assume concrete node identity after cloning" (Risk #5). The
   WeakMap-keyed approach eliminates the assumed coupling between `Rules` identity and
   index state.

Together they describe the target reactive eval model: canonical tree (immutable) +
session state (eval output) + dependency graph (what to re-eval on change) + live
patch API (how to update CSS at runtime). The branch is not at that finish line yet;
the current work is to make the immutable/session contract true end-to-end before
Stage 21 begins.
