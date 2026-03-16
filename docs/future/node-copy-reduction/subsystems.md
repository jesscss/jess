# Node Copy Reduction Subsystems

## Purpose

This document defines the target node model, subsystem boundaries, and compatibility
rules for the instance-field migration and sessionized eval.

Use with:

- [README.md](./README.md)
- [migration.md](./migration.md)

This is the "what lives where" document.

## Target Node Model

### Every node uses instance fields

No `.data` indirection. Every node class declares its fields directly:

```
┌──────────────────────────────────────────────────────────────┐
│ Node instance                                                │
│                                                              │
│  Leaf (childKeys = null):       Container (childKeys = []):  │
│  ┌─────────────────────┐       ┌────────────────────────┐   │
│  │ number: 10           │       │ left: Node ←(adopted)  │   │
│  │ unit: 'px'           │       │ op: '+'                │   │
│  │ (plain fields, no    │       │ right: Node ←(adopted) │   │
│  │  adoption overhead)  │       │ (setters adopt child   │   │
│  └─────────────────────┘       │  nodes on assignment)  │   │
│                                 └────────────────────────┘   │
│  Common:                                                     │
│  parent, sourceNode, flags, pre, post, location, options     │
└──────────────────────────────────────────────────────────────┘
```

### `childKeys` as the structural contract

Every node class sets a static `childKeys`:

- `null` → leaf node, no children to iterate.
- `string[]` → names of instance fields that hold child `Node` instances or `Node[]` arrays.

This replaces `getEntriesFromNode()` and the generic `.data` iteration for:

- Constructor adoption (`_adoptChildren`)
- `clone()` / `copy()`
- Visitor traversal
- Session-aware child enumeration

### Complete node field reference

#### Leaf nodes (childKeys = null)

```ts
class Dimension extends Node {
  static childKeys = null;
  number: number;
  unit: string | undefined;
}

class Num extends Dimension {
  // Inherits number, forces unit = undefined
}

class Any extends Node {
  static childKeys = null;
  value: string;       // the text content
  role: AnyRole;       // 'ident' | 'keyword' | 'property' | 'flag' | ...
}

class Keyword extends Any {
  // role fixed to 'keyword'
}

class Bool extends Node {
  static childKeys = null;
  value: boolean;
}

class Comment extends Node {
  static childKeys = null;
  value: string;           // comment text
  lineComment: boolean;    // true for // comments
}

class BasicSelector extends Node {
  static childKeys = null;
  value: string;           // '.class', '#id', 'div', etc.
}

class Combinator extends Node {
  static childKeys = null;
  value: string;           // '+', '>', ' ', '~', ''
}

class Ampersand extends Node {
  static childKeys = null;
}
```

#### Single-child container nodes

```ts
class Url extends Node {
  static childKeys = ['value'];
  value: Quoted | Any;        // inner content
}

class Expression extends Node {
  static childKeys = ['value'];
  value: Node;                // wrapped expression
}

class Quoted extends Node {
  static childKeys = ['value'];
  value: string | Any | Interpolated;  // may be plain string (leaf-like) or Node
  quote: string;                       // ' or "
  escaped: boolean;
}
```

#### Multi-child container nodes

```ts
class Operation extends Node {
  static childKeys = ['left', 'right'];
  left: Node;
  op: Operator;         // '+' | '-' | '*' | '/' | '%' — not a child
  right: Node;
}

class Condition extends Node {
  static childKeys = ['left', 'right'];
  left: Node;
  op: ConditionOperator | undefined;
  right: Node | undefined;
  negate: boolean;
}

class Declaration extends Node {
  static childKeys = ['name', 'value', 'important'];
  name: NameValue;              // string or Node
  value: Node;
  important: Node | undefined;
}

class Call extends Node {
  static childKeys = ['name', 'args', 'contentNode'];
  name: string | Node;
  args: List<Node> | undefined;
  contentNode: Node | undefined;
}

class Ruleset extends Node {
  static childKeys = ['selector', 'rules', 'guard'];
  selector: Selector | Nil;
  rules: Rules;
  guard: Condition | Nil | undefined;
}

class AtRule extends Node {
  static childKeys = ['name', 'prelude', 'rules'];
  name: Any | Interpolated;
  prelude: Node | undefined;
  rules: Rules | undefined;
}

class Mixin extends Node {
  static childKeys = ['name', 'rules', 'params', 'guard'];
  name: Any | Interpolated | undefined;
  rules: Rules;
  params: List<Node> | undefined;
  guard: Condition | undefined;
}

class StyleImport extends Node {
  static childKeys = ['path'];
  path: Quoted | Url;
  withConfig: { node: Node; type: 'with' | 'set' } | undefined;
  // Note: withConfig.node needs explicit handling in clone/adopt
}

class Reference extends Node {
  static childKeys = ['target', 'key'];
  target: Reference | Call | undefined;
  key: string | number | Node;  // may be Node (selector, interpolated, etc.)
}
```

#### Array-container nodes

```ts
class Rules extends Node {
  static childKeys = ['value'];
  value: Node[];
  // ... registry, visibility, etc.
}

class SelectorList extends Selector {
  static childKeys = ['value'];
  value: Selector[];
}

class ComplexSelector extends Selector {
  static childKeys = ['value'];
  value: ComplexSelectorComponent[];
}

class CompoundSelector extends Selector {
  static childKeys = ['value'];
  value: SimpleSelector[];
}
```

### Options vs fields

**Options** are for configuration that doesn't affect node identity or structure:

- `semi` (optional semicolons)
- `readonly`, `forward`, `local` (import visibility)
- `rulesVisibility` (import mode)
- `format` on Color (output format preference)
- `assign` on Declaration (`:`, `+:`, `?:`, etc.)

**Fields** are for data that IS the node:

- All data content (number, value, name, left, right, etc.)
- Structural properties (quote, escaped, lineComment, negate, role)
- Child node references

The principle: if two nodes with different values for a property represent different things,
it's a field. If they represent the same thing rendered differently, it's an option.

Exception: `format` on Color lives on the boundary. It affects rendering but not the color
value. Keep it as an option.

## Less.js Alignment Map

### Field names that already match (no adapter needed)

| Jess node   | Fields matching Less                    |
|-------------|----------------------------------------|
| Call        | `name`, `args`                          |
| Declaration | `name`, `value`, `important`            |
| Quoted      | `value`, `quote`, `escaped`             |
| Any         | `value` (maps to Less Keyword/Anonymous)|
| Bool        | `value`                                 |
| Comment     | `value`                                 |
| Color       | `rgb`, `alpha`                          |
| Url         | `value`                                 |

### Field names needing one rename in adapters

| Jess node   | Jess field  | Less field     | Adapter mapping         |
|-------------|-------------|----------------|-------------------------|
| Dimension   | `number`    | `value`        | `value: d => d.number`  |
| Comment     | `lineComment` | `isLineComment` | `isLineComment: c => c.lineComment` |
| Operation   | `left`/`right` | `operands`  | `operands: o => [o.left, o.right]` |

### Structural divergences (adapters handle the shape difference)

| Area       | Less shape                | Jess shape                   |
|------------|--------------------------|------------------------------|
| Selectors  | flat `Element[]`          | `SelectorList > ComplexSelector > CompoundSelector > BasicSelector` |
| Ruleset    | `selectors[]`, `rules[]`  | `selector` (SelectorList), `rules` (Rules container) |
| Variable   | `Variable { name }`       | `Reference { key }` (more general) |
| Mixin      | `MixinDefinition` extends Ruleset | `Mixin` is independent class |
| Import     | `Import { path, features }` | `StyleImport { path, withConfig }` |

These divergences are fundamental design differences. Adapters for these types will always
need structural translation, but the total count is ~8 (down from 30+).

## EvalSession Responsibilities

`EvalSession` owns all mutable state that differs per evaluation branch.

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
  fieldOverrides?: Map<string, unknown>;
  replaceSelf?: Node;
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

With instance fields, `NodePatch.fieldOverrides` maps field names directly:

```ts
// Patching a Dimension's number in a session:
session.nodePatches.get(dim)?.fieldOverrides?.get('number')  // → patched value
dim.number  // → canonical value
```

## Session-Aware Read Surface

Function-based, not Proxy-based:

- `getParent(node, session)`
- `getSourceParent(node, session)`
- `getIndex(node, session)`
- `isPreEvaluated(node, session)`
- `isEvaluated(node, session)`
- `getChildren(rules, session)`
- `getField(node, session, key)` — generic field read through overlay

Rules:

- Fall back to instance fields when no session exists.
- Zero allocation cost (function call + WeakMap lookup).
- No Proxy overhead.

## Session-Aware Write Surface

- `patchField(node, session, key, value)` — record field override
- `replaceNode(node, session, replacement)`
- `prependChildren(rules, session, nodes)`
- `appendChildren(rules, session, nodes)`
- `removeChild(rules, session, child)`
- `markScopeDirty(rules, session)`

## Adapter Architecture

### Node adapter interface

```ts
interface NodeAdapter<T extends Node> {
  lessType: string;
  fields?: Record<string, (node: T) => unknown>;
  children?: (node: T) => Node[];
}
```

### Adapter creation strategy

```ts
function createAdapter<T extends Node>(node: T, def: NodeAdapter<T>, cache: WeakMap) {
  if (cache.has(node)) return cache.get(node);

  if (!def.fields && !def.children) {
    // All field names match Less — return node directly
    cache.set(node, node);
    return node;
  }

  if (!def.children) {
    // Leaf with renames — plain object
    const adapter: any = { type: def.lessType };
    for (const [key, accessor] of Object.entries(def.fields!)) {
      adapter[key] = accessor(node);
    }
    // Copy through any fields not explicitly mapped
    for (const key of Object.keys(node)) {
      if (!(key in adapter)) adapter[key] = (node as any)[key];
    }
    cache.set(node, adapter);
    return adapter;
  }

  // Container needing child conversion — Proxy (rare)
  // ...
}
```

### Nodes needing no adapter

With aligned field names, these can be passed directly to Less plugins:

- `Quoted` (value, quote, escaped)
- `Call` (name, args)
- `Declaration` (name, value, important)
- `Any` → Keyword/Anonymous (value)
- `Bool` (value)
- `Url` (value)
- `Color` (rgb, alpha — partial)

### Nodes needing minimal adapters

- `Dimension` — synthesize `.value` from `.number`
- `Comment` — rename `lineComment` → `isLineComment`
- `Operation` — synthesize `operands` from `left`/`right`

### Nodes needing structural adapters (~8 total)

- Selector hierarchy → flat `Element[]`
- Ruleset → `selectors[]`/`rules[]`
- Mixin → `MixinDefinition`
- StyleImport → `Import`
- Reference → `Variable`
- Condition → Less `Condition` (rename `left`/`right` to `lvalue`/`rvalue`)
- Color → needs `.value` string synthesis
- Rules → Less root Ruleset

## Scope Snapshot Responsibilities

Each `ScopeSnapshot` should:

- Be scoped to one `Rules` instance and one `EvalSession`.
- Be built lazily on first lookup.
- Rebuild when the scope is marked dirty.
- Index only names resolved by `preEval`.
- Iterate the logical child list (canonical value ± session patches).

## Materialization Boundary

Materialization should be lazy, path-based, and copy-on-write.

Likely boundaries:

- Final emitted/imported `Rules`.
- Mixin return values.
- Detached ruleset values that escape the current eval branch.
- Adapter creation (adapters read from materialized or canonical state).

## Subsystem-by-Subsystem Scope

### 1. `Node` base class

Files: `node-base.ts`, `node.ts`

- `childKeys` infrastructure.
- Updated `clone()` using `childKeys`.
- Updated `_adoptChildren()` using `childKeys`.
- Session-aware read/write helpers.
- Remove `.data`, `setData()`, `getEntriesFromNode()` after migration.

### 2. All node classes (31+)

Files: every `*.ts` under `tree/`

- Declare instance fields.
- Set `static childKeys`.
- Update constructors to destructure input.
- Adopting setters for child-node fields on container types.

### 3. `Rules` container

File: `rules.ts`

- Use `value: Node[]` instead of array `.data`.
- Logical child iteration through session view.
- Scope snapshots.
- Lookup ordering preservation.

### 4. Import evaluation

Files: `import-style.ts`, `reference.ts`

- Per-import sessions.
- `with`/`set` as session-local patches.
- Cross-session isolation.

### 5. Registry / lookup

Files: `tree/util/registry-utils.ts` and adjacent

- Separate index construction from traversal policy.
- Snapshot-backed indexes.

### 6. Render / serialization path

Files: `tree/util/print.ts`, `node-base.ts` (toString, toTrimmedString, processPrePost)

- `render(node, options?)` as standalone entry point.
- `RenderOptions` extends `PrintOptions` with `session?` and `mask?`.
- Base-class `toTrimmedString()` fallback iterates `childKeys` (not `getValues(this.data)`).
- `.toString()` delegates to `render(this)` with no session/mask.
- `processPrePost` applies mask-aware comment filtering.
- Session-aware rendering materializes touched paths before delegating to `toTrimmedString()`.

### 7. Visitor traversal

Files: visitor infrastructure, `tree/util/collections.ts`

- `visitChildren(node, visitor)` uses `childKeys` for child enumeration.
- Leaf nodes (`childKeys === null`) short-circuit — no child iteration.
- `visitChildrenInSession(node, visitor, session)` reads children through overlay,
  writes replacements into session patches.
- Less-compat visitor wrapper maps `visit<LessType>()` methods using adapter definitions.

### 8. Selector rewrite helpers

- Path-copy container builders.

### 9. Less-compat adapter layer

Files: `jess-plugin-less-compat/src/`

- Replace per-node Proxy transformers with declarative adapter definitions.
- Direct node access where field names match.
- Plain objects where renames needed.
- Proxies only for structural translation (~8 types).

### 10. Fns package

Files: `packages/fns/src/`

- Update `.data.number` → `.number`, `.data.unit` → `.unit`, etc.
- No structural changes. Functions already use direct field access patterns.

## Invalidation Rules

Mark a scope dirty when a session change may affect:

- Declaration name resolution
- Mixin name resolution
- Child ordering
- Visibility/read-only/forward/local options
- Parent/source-parent reachability

When in doubt: rebuild the snapshot. No fine-grained dependency tracking in v1.

## Invariants

1. No semantic change when no `EvalSession` is active.
2. A canonical AST can participate in multiple sessions without cross-session leakage.
3. Dynamic names indexed only after `preEval` resolution.
4. All lookup types preserve current behavior.
5. Materialization preserves `sourceNode` and render behavior.
6. Function authors access fields directly — no `.data`, no session awareness.
7. Less plugins see adapted interfaces with correct Less field names.
8. `childKeys` is the single source of truth for child enumeration.

## Non-Goals

- A fully generic immutable tree engine.
- Fine-grained dependency-tracked invalidation.
- Rewriting extend internals to fit the session model.
- Changing lookup semantics while refactoring storage.
- Struct-of-Arrays layout (explored and rejected).
- Matching Less.js field names where they are semantically wrong for Jess.
