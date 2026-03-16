# Node Copy Reduction Subsystems

## Purpose

This document defines the runtime model, subsystem boundaries, and compatibility
rules for moving from clone-before-mutate toward sessionized eval.

Use with:

- [README.md](./README.md)
- [migration.md](./migration.md)

This is the "what lives where" document.

## Design Boundary

The long-term target is:

- canonical AST nodes remain authored/source state
- eval-time state moves into an `EvalSession`
- structural rewrites become session-local first, materialized later

That means every piece of mutable state must be classified as one of:

1. canonical authored state
2. session runtime state
3. session structural patch state
4. derived lookup/index state
5. materialized output state

## Canonical AST Responsibilities

Canonical nodes should continue to own:

- authored `data`
- authored `options`
- authored `pre` / `post`
- `sourceNode`
- parse-time child order
- parse-time node identity

Canonical nodes must not become the storage location for session-specific:

- `parent`
- `sourceParent`
- `index`
- `preEvaluated`
- `evaluated`
- temporary rewrites applied during import/mixin/detached-ruleset eval

## EvalSession Responsibilities

`EvalSession` should own all mutable state that differs per evaluation branch.

Suggested shape:

```ts
interface EvalSession {
  runtimeState: WeakMap<Node, RuntimeState>;
  nodePatches: WeakMap<Node, NodePatch>;
  scopeSnapshots: WeakMap<Rules, ScopeSnapshot>;
  materializedNodes: WeakMap<Node, Node>;
  version: number;
}

interface RuntimeState {
  parent?: Node;
  sourceParent?: Node;
  index?: number;
  preEvaluated?: boolean;
  evaluated?: boolean;
  optionsOverride?: Partial<NodeOptions>;
  flagsAdd?: number;
  flagsRemove?: number;
}

interface NodePatch {
  replaceSelf?: Node;
  keyedWrites?: Map<string | number, unknown>;
  prependedChildren?: Node[];
  appendedChildren?: Node[];
  splices?: Array<ChildSplice>;
  removedChildren?: Set<Node>;
}

interface ScopeSnapshot {
  resolvedNodes: Node[];
  declarationIndex: DeclarationIndex;
  mixinIndex: MixinIndex;
  rulesetIndex?: RulesetIndex;
  hasDynamicNames: boolean;
  builtFromVersion: number;
}
```

The exact shapes can change. The key constraint is separation:

- `RuntimeState` is bookkeeping
- `NodePatch` is logical structure/data change
- `ScopeSnapshot` is derived cache only

## Session-Aware Read Surface

Any code running in a sessionized path should stop directly reading runtime fields
from nodes.

Introduce explicit helpers such as:

- `getParent(node, session)`
- `getSourceParent(node, session)`
- `getIndex(node, session)`
- `isPreEvaluated(node, session)`
- `isEvaluated(node, session)`
- `getNodeOptions(node, session)`
- `getRulesChildren(rules, session)`
- `getLogicalNode(node, session)` when replacement/self-shadowing is in play

Rules:

- helpers must fall back to node-local fields when no session exists
- helpers must be behavior-preserving in compatibility mode
- newly migrated code must use helpers instead of ad hoc direct field reads

## Session-Aware Write Surface

Mutations in sessionized paths should go through explicit session APIs.

Suggested write helpers:

- `setRuntimeState(node, session, patch)`
- `setData(node, session, key, value)`
- `replaceNode(node, session, replacement)`
- `prependChildren(rules, session, nodes)`
- `appendChildren(rules, session, nodes)`
- `spliceChildren(rules, session, start, deleteCount, nodes)`
- `removeChild(rules, session, child)`
- `markScopeDirty(rules, session)`

Rules:

- direct node mutation remains allowed on non-sessionized paths during migration
- sessionized paths must not mutate canonical `data` or ancestry directly
- write helpers are responsible for invalidating scope snapshots conservatively

## Scope Snapshot Responsibilities

Lookup indexes should be derived from the session view of a scope, not from live
mutable `Rules` internals.

Each `ScopeSnapshot` should:

- be scoped to one `Rules` instance and one `EvalSession`
- be built lazily on first lookup
- rebuild when the scope is marked dirty
- index only names resolved by `preEval`
- exclude unresolved dynamic-name nodes until they resolve

The snapshot builder should iterate the logical child list:

- untouched canonical child
- replacement child from the session
- prepended/appended children from the session
- removed children omitted

The snapshot must not require whole-tree cloning.

## Registry and Lookup Split

The current registry should be split conceptually into two parts.

### RegistryIndex

Per-scope indexes only:

- declaration key maps
- mixin key maps
- optional ruleset or selector indexes if still needed

### LookupWalker

Traversal and visibility logic:

- search current scope
- walk parent/source-parent chains
- child-search when required
- visibility/private/public checks
- `readonly`
- `hasTarget`
- `isMixinOutput`
- import boundary rules
- circular search protection

`LookupWalker` should consume a `ScopeSnapshot` or a snapshot-backed view, not a
mutable registry attached directly to `Rules`.

## Materialization Boundary

The session should not stay a pure patch graph forever. Some consumers will need
concrete nodes.

Materialization should be:

- lazy
- path-based
- copy-on-write

Rules:

- materialize only touched paths
- reuse untouched descendants where safe
- preserve `sourceNode`
- preserve lookup/render semantics

Likely materialization boundaries:

- final emitted/imported `Rules`
- mixin return values
- detached ruleset values that escape the current eval branch
- plugin/user-facing APIs that expect concrete node objects

## `preserveOriginalNodes` Transition

Today `preserveOriginalNodes` effectively means:

- clone before mutating

Target meaning:

- do not mutate canonical nodes
- route writes through the active session
- materialize only when a concrete node tree is required

This transition should happen late, after:

- session-aware reads exist
- session-aware writes exist
- ancestry/order runtime state is externalized

## Subsystem-by-Subsystem Scope

### 1. `Context`

Likely file:

- `/Users/matthew/git/oss/jess/packages/core/src/context.ts`

Responsibilities:

- hold the active `EvalSession`
- make session optional during migration
- pass session through eval/preEval/render entry points

### 2. `NodeBase` and shared node runtime helpers

Likely files:

- `/Users/matthew/git/oss/jess/packages/core/src/tree/node-base.ts`
- `/Users/matthew/git/oss/jess/packages/core/src/tree/node.ts`

Responsibilities:

- centralize session-aware read/write helpers
- stop newly migrated code from depending on node-local runtime fields

### 3. `Rules`

Likely file:

- `/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts`

Responsibilities:

- expose logical child iteration through the session view
- build/use scope snapshots
- preserve linear lookup ordering and scope lookup semantics
- route structural writes through session helpers on migrated paths

### 4. Import evaluation

Likely files:

- `/Users/matthew/git/oss/jess/packages/core/src/tree/import-style.ts`
- `/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts`

Responsibilities:

- create per-import sessions
- apply `with` / `set` as session-local patches
- prevent repeated imports of the same source AST from leaking mutations

### 5. Registry / lookup utilities

Likely files:

- `/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts`
- adjacent lookup helper files in `tree/util`

Responsibilities:

- separate index construction from traversal policy
- make indexes snapshot-backed rather than live-mutable

### 6. Render path

Likely files:

- serializer/render helpers under `packages/core/src/tree`

Responsibilities:

- use `RenderMask` where copies exist only to suppress comments or pre/post output

### 7. Selector rewrite helpers

Likely files:

- selector utilities under `packages/core/src/tree/util`

Responsibilities:

- move toward path-copy container builders
- avoid deep copy for local selector rewrites

Do not make this a dependency for sessionized import eval.

## Invalidation Rules

The default invalidation mode should be conservative.

Mark a scope dirty when a session change may affect:

- declaration name resolution
- mixin name resolution
- child ordering
- visibility/read-only/forward/local options
- parent/source-parent reachability
- prepended/appended/replaced registerable nodes

When in doubt:

- rebuild the snapshot

Do not attempt fine-grained dependency tracking in v1.

## Invariants

These must remain true throughout migration:

1. No semantic change when no `EvalSession` is active.
2. A canonical AST can participate in multiple sessions without cross-session mutation leakage.
3. Dynamic names are indexed only after normal `preEval` resolution.
4. Scope lookup, linear lookup, and call-time lookup preserve current behavior.
5. Materialization preserves `sourceNode` and render behavior.

## Non-Goals

These items are intentionally out of scope for the first pass:

- a fully generic immutable tree engine
- fine-grained dependency-tracked invalidation
- rewriting extend internals to fit the new session model
- changing lookup semantics while refactoring storage

## Recommended Reading Order During Implementation

1. overview in [README.md](./README.md)
2. staged rollout in [migration.md](./migration.md)
3. subsystem ownership and invariants in this file

When implementing a stage, update all three documents together if the design shifts.
