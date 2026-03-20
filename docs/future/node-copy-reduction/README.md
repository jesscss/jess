# Node Copy Reduction Plan

## Document Map

This document is the architecture and strategy overview.

Use it together with:

- [migration.md](./migration.md) for the staged refactor sequence
- [subsystems.md](./subsystems.md) for subsystem responsibilities, APIs, and invariants
- [dependency-graph.md](./dependency-graph.md) for the dependency graph, session-local
  registries, and Live Patch API — Stages 17–21

Recommended reading order:

1. this file
2. `migration.md`
3. `subsystems.md`
4. `dependency-graph.md` (Stages 17–21 and reactive eval model)

## Status Snapshot

Current branch status on `jess-dev`:

- Stages 0–19 are materially landed.
- Stage 20 has landed as an important infrastructure slice, but it did not finish the
  underlying immutability/session architecture.
- The current active work is a **fundamentals-completion gate** between Stage 20 and Stage 21.
- Stage 21 has not started and must not start until the branch actually satisfies the
  pre-Stage-21 threshold in `PROGRESS.md` / `HANDOFF.md`:
  clone removal in scope, sessionized eval-time writes/replacements, baseline validation,
  and credible merge readiness.

For current implementation state, prefer:

- [PROGRESS.md](./PROGRESS.md) for what is done vs remaining
- [HANDOFF.md](./HANDOFF.md) for the immediate next-task summary

## Goal

Reduce `clone()` / `copy()` usage across the tree without changing behavior, especially in
these cases:

1. Referencing a value but suppressing its source comments.
2. Reusing an imported tree multiple times when evaluation may diverge.
3. Extending with selectors that should not carry authored comments into generated output.
4. Evaluating by replacing or rewriting nodes while still retaining access to original state.

The main objective is to stop paying for deep clones when we only need one of:

- Different render behavior
- Mutation isolation

Those are different problems and should not share one expensive mechanism. "Original-state
tracking" is not a third problem — with session-based eval, canonical nodes are never
mutated, so the original state is inherently preserved.

## Design Philosophy: Persistent Trees, Not Flat Tables

An alternative that was explored early is Struct-of-Arrays (SoA) layout, where each node field
lives in its own typed array and a "node" is just an integer index. This is a poor fit for an
AST like Jess's: nodes are heterogeneous (31+ types with different shapes), hot paths are tree
walks not field scans, and node counts are modest (low thousands for large stylesheets). SoA
was rejected.

The right model is **persistent data structures**: a node is conceptually immutable once
authored, and "modifying" it produces a new logical identity that shares all unchanged fields.
Only the spine from root to the changed node gets new containers. This maps directly onto the
`EvalSession` / `NodePatch` design below.

## Unified Instance-Field Node Model

### The problem with `.data`

Today every node stores its content in a `.data` property (a separate object or array), with
typed getters delegating through it:

```ts
// Current: Dimension stores { number, unit } in a separate object
get number() { return this.data.number; }
set number(val: number) { this.setData('number', val); }
```

This means:
- Every node allocates an intermediate data object in its constructor.
- Every property read chains through a getter → `.data` → property lookup.
- `clone()` must reconstruct the data object (shallow-copy arrays, spread plain objects).
- `getEntriesFromNode()` iterates the data object to find child nodes for adoption and
  deep clone.
- The less-compat plugin wraps every node in a Proxy just to rename properties.

### The proposal: fields on the instance, everywhere

Move all typed fields directly onto node instances. Not just value nodes — **all** nodes.

```ts
// Proposed: fields live on the instance
class Dimension extends Node {
  number: number;
  unit: string | undefined;
}

class Operation extends Node {
  left: Node;
  op: Operator;
  right: Node;
}

class Declaration extends Node {
  name: NameValue;
  value: Node;
  important: Node | undefined;
}

class Ruleset extends Node {
  selector: Selector | Nil;
  rules: Rules;
  guard: Condition | Nil | undefined;
}
```

### Child node enumeration

The current architecture relies on `getEntriesFromNode()` to generically discover child nodes
by iterating `.data`. With instance fields, child enumeration is explicit:

```ts
class Node {
  /** Static list of field names that hold child nodes. Null = leaf node. */
  static childKeys: string[] | null = null;
}

class Dimension extends Node {
  static childKeys = null; // leaf — no children
}

class Operation extends Node {
  static childKeys = ['left', 'right']; // 'op' is a string, not a child
}

class Declaration extends Node {
  static childKeys = ['name', 'value', 'important'];
}

class Ruleset extends Node {
  static childKeys = ['selector', 'rules', 'guard'];
}

class Rules extends Node {
  static childKeys = ['value'];
  value: Node[];
}
```

Note: `childNodeKeys` already exists on `Node` but is never populated by subclasses. This
proposal makes it load-bearing.

### `childKeys` conventions

- `null` → leaf node. No child nodes to iterate, adopt, clone, or visit.
- `string[]` → names of instance fields that hold child `Node` instances or `Node[]` arrays.
  Non-node fields (`op`, `quote`, `negate`, etc.) are never listed.
- **Use `value` for the primary content field** on every node, including array containers.
  `rules.value`, `selectorList.value`, `quoted.value`, `any.value` — one name, one concept.
  The only exception is nodes with multiple semantic fields where none is "the content"
  (e.g., Dimension has `number` and `unit`, Operation has `left` and `right`).

### Adoption and mutation

For container nodes, `setData()` today does two things: assigns the value and calls
`_adoptChildren()`. With instance fields, property assignment uses setters that adopt:

```ts
class Declaration extends Node {
  static childKeys = ['name', 'value', 'important'];

  #value!: Node;
  get value() { return this.#value; }
  set value(v: Node) {
    this.#value = v;
    this.adopt(v);
    this._invalidate();
  }
}
```

For leaf/value nodes, no setter overhead is needed — plain public fields:

```ts
class Dimension extends Node {
  number: number;  // plain field, no adoption needed
  unit: string | undefined;
}
```

### Clone without data reconstruction

Today `clone()` creates a temporary `{ data: ... }` wrapper, spreads or copies the data
object, then passes it to the constructor. With instance fields:

```ts
clone(deep?: boolean): this {
  const Class = this.constructor as Class<this>;
  const keys = Class.childKeys;
  // Allocate empty, then copy fields
  const node = Object.create(Class.prototype);
  Object.assign(node, this); // shallow-copy all instance fields
  if (deep && keys) {
    for (const key of keys) {
      const child = (node as any)[key];
      if (child instanceof Node) {
        (node as any)[key] = child.clone(true);
      } else if (Array.isArray(child)) {
        (node as any)[key] = child.map(c => c instanceof Node ? c.clone(true) : c);
      }
    }
  }
  node.inherit(this);
  return node;
}
```

No intermediate data object. No `getEntriesFromNode()`. No `Object.fromEntries()`.

### Impact on constructor API

Constructors still accept a plain object for ergonomics:

```ts
// Constructor still works the same way from the caller's perspective
new Dimension({ number: 10, unit: 'px' });
new Operation({ left: a, op: '+', right: b });
new Declaration({ name: 'color', value: colorNode });
```

Internally, the constructor destructures onto instance fields:

```ts
class Dimension extends Node {
  number: number;
  unit: string | undefined;

  constructor(value: DimensionValue, options?, location?, treeContext?) {
    super(options, location, treeContext);
    this.number = value.number;
    this.unit = value.unit;
  }
}
```

The base `Node` constructor no longer stores `.data` or calls `_adoptChildren()`.
Each subclass constructor assigns its own fields, and container-node setters handle
adoption.

## Alignment with Less.js Node Shapes

Less.js stores all fields directly on instances. Aligning Jess field names with Less where
semantically sound simplifies the less-compat layer and makes the ecosystem more approachable
for developers coming from Less.

### Field name comparison and recommendations

| Node       | Less field(s)              | Jess current              | Proposed                     | Notes                                        |
|------------|--------------------------|---------------------------|------------------------------|----------------------------------------------|
| Dimension  | `value` (num), `unit`    | `.data.number`, `.data.unit` | `number`, `unit`            | Keep `number` — more specific than Less's `value` |
| Color      | `rgb[]`, `alpha`, `value` (original form) | `.data.rgb`, `.data.hsl`, `.data.alpha` | `rgb`, `hsl`, `alpha`, `format` | Align `rgb`/`alpha`; drop ambiguous `value` |
| Quoted     | `value` (content), `quote`, `escaped` | `.data` (string\|Node), options: `quote`, `escaped` | `value`, `quote`, `escaped` | Align all three; move `quote`/`escaped` from options to fields |
| Any        | `value` (for Keyword/Anonymous) | `.data` (string)         | `value`                      | Align with Less's `value`; keep `role` as option or field |
| Bool       | (Keyword.True/False)     | `.data` (boolean)         | `value`                      | Align; Less uses Keywords, Jess has proper Bool |
| Comment    | `value`, `isLineComment` | `.data` (string), options: `lineComment` | `value`, `lineComment`     | Align both; move `lineComment` from options to field |
| Operation  | `op`, `operands[]`       | `.data` = `[left, op, right]` | `left`, `op`, `right`       | Better than both Less's array and Jess's tuple |
| Condition  | `op`, `lvalue`, `rvalue` | `.data` = `[left, op?, right?]` | `left`, `op`, `right`, `negate` | Align direction; move `negate` from options to field |
| Call       | `name`, `args[]`         | `.data.name`, `.data.args` | `name`, `args`              | Already aligned |
| Declaration| `name`, `value`, `important` | `.data.name`, `.data.value`, `.data.important` | `name`, `value`, `important` | Already aligned |
| Ruleset    | `selectors[]`, `rules[]` | `.data.selector`, `.data.rules`, `.data.guard` | `selector`, `rules`, `guard` | Keep Jess's singular `selector` (SelectorList), `rules` (Rules container) |
| Variable   | `name`                   | Reference with `.data.key` | `key` (on Reference)        | Jess's Reference is more general than Less's Variable |
| Import     | `path`, `features`, `options` | `.data.path`, `.data.with` | `path`, `withConfig`        | Jess has different import semantics |
| Selector   | `elements[]`             | `.data` = `SimpleSelector[]` (etc.) | `value: Selector[]` (etc.)  | Jess has richer selector hierarchy |
| Url        | `value` (inner node)     | `.data` (Quoted\|Any)     | `value`                      | Align |
| AtRule     | (name, prelude, rules)   | `.data.name`, `.data.prelude`, `.data.rules` | `name`, `prelude`, `rules` | Already aligned |
| Mixin      | (name, params, rules)    | `.data.name`, etc.        | `name`, `rules`, `params`, `guard` | Already aligned |

### Key alignment decisions

**Use `value` for "the main content" of single-content nodes.** This matches Less and is the
natural expectation for developers. Applies to: `Any`, `Bool`, `Quoted`, `Comment`, `Url`.

**Keep `number` for Dimension** rather than Less's `value`. `dim.number` is unambiguous;
`dim.value` could mean "the whole dimension" or "the numeric part." Clarity wins over
alignment here.

**Flatten Operation and Condition tuples.** Less uses `op` + `operands[]` (awkward array
indexing). Jess currently uses `[left, op, right]` tuples (readable in destructuring but still
array-indexed in `.data`). Proposed: `left`, `op`, `right` as direct fields. Cleanest of all
three options.

**Move options fields onto instances where they are semantic.** `quote` and `escaped` on
Quoted, `lineComment` on Comment, `negate` on Condition, and `role` on Any are not
configuration — they are part of the node's identity. They should be instance fields, not
buried in an options object.

### Impact on less-compat

With aligned field names and instance fields, many Less-compat adapters become trivial or
unnecessary:

```ts
// Dimension: Less expects .value, Jess has .number — one rename
const dimensionAdapter = { lessType: 'Dimension', fields: { value: d => d.number } };

// Color: field names already match — no adapter needed for rgb/alpha
// Quoted: .value, .quote, .escaped all match — no adapter needed
// Comment: .value, .isLineComment → .lineComment — one rename
// Call: .name, .args match — no adapter needed
// Declaration: .name, .value, .important match — no adapter needed
```

For roughly half the node types, the adapter becomes either empty (field names match) or a
single trivial rename.

## Proposed Architecture

### 1. RenderMask for comment suppression

This replaces the cases where `copy(true)` exists only to remove comments.

Examples:

- Referenced variable values that should render without source comments.
- `extendWith` selectors that should not emit comments from authored source.
- Generated selector wrappers that should suppress inherited `pre` / `post`.

#### Design

Add render-time policy to serialization instead of materializing comment-stripped nodes.

```ts
interface RenderMask {
  suppressComments?: boolean;
  suppressPrePost?: boolean;
  suppressCommentsForSourceNode?: WeakSet<Node>;
}
```

This mask is passed through render helpers. When serializing:

- Skip `Comment` children if `suppressComments` is enabled.
- Skip comment entries in `pre` / `post`.
- Optionally suppress comments only for specific source subtrees.

#### Why this helps

Today `copy()` does real object creation just to replace comments with `Nil`. That is the most
obvious avoidable allocation class. A render mask eliminates most cloning for use cases 1 and 3.

#### Scope

Start only with:

- `Reference` output copies.
- Selector extend output.
- Any generated wrappers that currently call `copy(true)` only to sanitize output.

### 2. EvalSession for imports and divergent evaluation

This addresses the expensive case where the same imported tree may evaluate differently
depending on configuration or scope.

#### Core idea: persistent-tree overlay

Keep one canonical source tree. For each import/eval session, create a session frame:

```ts
interface EvalSession {
  nodePatches: WeakMap<Node, NodePatch>;
  runtimeState: WeakMap<Node, RuntimeState>;
  scopeSnapshots: WeakMap<Rules, ScopeSnapshot>;
  materializedNodes: WeakMap<Node, Node>;
  version: number;
}

interface NodePatch {
  fieldOverrides?: Map<string, unknown>;
  replaceSelf?: Node;
  // ... child mutations (see subsystems.md for full definition)
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
```

Reads first consult session state. The first write to a shared node creates a patch record.
Untouched nodes remain shared. This is the same principle as persistent data structures: the
"new version" is `canonical + patch`, not a deep copy.

#### Read surface: functions, not Proxies

```ts
getParent(node, session)
getChildren(rules, session)
isEvaluated(node, session)
```

Zero-allocation reads. No Proxy overhead (already measured at ~1.2% of CPU). Functions that
process nodes accept `(node, session)` pairs. When no session is active, helpers fall back to
node-local fields with zero overhead.

#### Materialization

Implemented as **copy-on-write path materialization**:

1. Materialize only the rewritten path.
2. Shallow-copy each ancestor on that path.
3. Reuse untouched child subtrees where safe.

Materialization boundaries:

- Final import result returned to caller.
- Mixin return values.
- Detached ruleset values that escape the current eval branch.
- Plugin/user-facing APIs that expect concrete node objects.

#### Where to use it first

Start in `import-style.ts`, because that is where the "same tree imported multiple times" cost
is most explicit.

### 3. Structural sharing builders for selector rewrites

Most selector transforms only need:

- A new container array.
- A few rewritten members.
- The rest reused structurally.

Replace `node.copy(true)` in selector helpers with path-copy builders:

```ts
appendSelectorAlternative(target, added, policy)
rewriteCompound(node, mapper, policy)
rewriteSelectorPath(root, path, replacement, policy)
```

Each builder creates a new container only when one of its children changes. Unchanged
descendants are reused, not cloned.

### 4. Declarative adapter layer for less-compat

Replace 30+ per-node Proxy transformer files with declarative definitions:

```ts
interface NodeAdapter<T extends Node> {
  lessType: string;
  fields: Record<string, (node: T) => unknown>;
  children?: (node: T) => Node[];
}
```

A single `createAdapter(node, def, cache)` function handles all types:

- Leaf nodes with matching field names → return the node directly (zero wrapping).
- Leaf nodes needing renames → plain object (no Proxy).
- Container nodes with child traversal → minimal Proxy only if needed.

With instance fields and Less-aligned names, roughly half the adapters become trivial.

## Function DX

Function authors should see the simplest possible API. The instance-field model makes this
even cleaner than today:

```ts
// Direct field access — no .data indirection
function darken(color: Color, amount: Dimension) {
  const [h, s, l] = color.hsl;
  const adjustAmount = amount.number / 100;
  return new Color({
    hsl: [h, s, newLightness],
    alpha: color.alpha
  }, { format: color.format }).inherit(color);
}

function unit(dimension: Dimension, unit?: Any | Quoted) {
  return new Dimension({
    number: dimension.number,
    unit: unit?.valueOf()
  });
}
```

Functions should never know about sessions, overlays, or adapters. They create and return
concrete nodes. The eval engine handles session concerns; the adapter layer handles plugin
compatibility.

## Serialization

### The problem with `.toString()`

Today `.toString()` is the de facto serialization path — string coercion in tests, template
literals, and CSS output all go through it. But `.toString()` takes no parameters (it's
`Object.prototype.toString()`'s signature), so there's no way to pass a session or render mask.

The base `toTrimmedString()` currently iterates `getValues(this.data)` to concatenate child
output. With instance fields and no `.data`, that generic path disappears.

### The proposal: `render(node, options)` as the primary serialization API

```ts
interface RenderOptions extends PrintOptions {
  session?: EvalSession;
  mask?: RenderMask;
}

function render(node: Node, options?: RenderOptions): string {
  // 1. If session exists, read fields through overlay
  // 2. If mask exists, apply suppression rules
  // 3. Delegate to node.toTrimmedString() for node-specific formatting
  // 4. Handle pre/post with mask-aware filtering
}
```

This is a standalone function, not a method. It accepts the context that `.toString()` can't.

### What `.toString()` becomes

`.toString()` stays as a zero-config convenience that calls `render(this)` with no session
and no mask. It remains useful for:

- Test assertions: `expect(node + '').toBe('10px')`
- Quick debugging: `console.log(node)`
- Contexts where you have a canonical node and want canonical output

For session-aware output (the import/eval case), callers use `render()` explicitly.

### How `toTrimmedString()` adapts

Each node's `toTrimmedString()` already knows how to format itself. The change is that
the base class no longer provides a generic fallback that iterates `.data`. Instead:

- Leaf nodes: `toTrimmedString()` returns the field value directly (already the case for
  most leaf types today).
- Container nodes: `toTrimmedString()` references named fields — `this.left`, `this.right`,
  etc. — which is what the typed overrides already do.
- The base-class fallback iterates `childKeys` instead of `getValues(this.data)`:

```ts
// Base class fallback for nodes without a toTrimmedString override
toTrimmedString(options?: PrintOptions): string {
  const keys = (this.constructor as typeof Node).childKeys;
  if (!keys) return String(this.valueOf());
  options = getPrintOptions(options);
  const w = options.writer!;
  const mark = w.mark();
  for (const key of keys) {
    const child = (this as any)[key];
    if (child instanceof Node) {
      child.toString(options);
    } else if (Array.isArray(child)) {
      for (const item of child) {
        if (item instanceof Node) item.toString(options);
      }
    }
  }
  return w.getSince(mark);
}
```

### Session-aware rendering

When `render()` receives a session, it reads field values through the overlay before
delegating to `toTrimmedString()`. Two approaches:

1. **Materialization before render**: materialize the touched path into concrete nodes,
   then render normally. Simplest — no changes to `toTrimmedString()` signatures.

2. **Thread session through options**: extend `PrintOptions` with `session`, and
   `toTrimmedString()` reads fields through `getField(this, session, key)`.

Option 1 is preferred for v1 — it keeps `toTrimmedString()` simple and avoids threading
session through every recursive call. Materialization is already needed at session boundaries
anyway.

### RenderMask integration

The render mask is applied in `render()`, not in individual `toTrimmedString()` overrides:

```ts
function render(node: Node, options?: RenderOptions): string {
  const opts = getPrintOptions(options);
  if (options?.mask) {
    opts.mask = options.mask;
  }
  // processPrePost checks mask before emitting pre/post comments
  // Child iteration skips Comment nodes when mask.suppressComments is set
  return processPrePostWithMask(node, opts);
}
```

### Original vs transformed serialization

To serialize the original (canonical) form: `render(node)` — no session, reads instance
fields directly.

To serialize the session-transformed form: `render(node, { session })` — reads through
overlay, or renders a materialized copy.

Both produce valid CSS. The difference is which version of the data they read.

## Function Return Values and Visitors

### Functions: no change to DX

Functions create and return concrete node instances. This doesn't change:

```ts
function darken(color: Color, amount: Dimension): Color {
  const [h, s, l] = color.hsl;
  return new Color({
    hsl: [h, s, l - amount.number / 100],
    alpha: color.alpha,
  });
}
```

The eval engine is responsible for deciding what to do with the returned node — write it
into a session overlay, materialize it into a concrete tree, or assign it directly. The
function author never sees sessions, overlays, or adapters.

**Less/Sass plugin functions** receive adapted nodes (via the adapter layer) and return
Less-shaped nodes. The adapter layer converts return values back to Jess nodes. This is
already the pattern in less-compat today — the instance-field model doesn't change it.

### Visitors: `childKeys` replaces generic data iteration

Today visitor traversal uses `getEntriesFromNode()` (or similar) to discover children
by iterating `.data`. With `childKeys`, visitor traversal becomes explicit:

```ts
function visitChildren(node: Node, visitor: Visitor): void {
  const keys = (node.constructor as typeof Node).childKeys;
  if (!keys) return; // leaf node — nothing to visit

  for (const key of keys) {
    const child = (node as any)[key];
    if (child instanceof Node) {
      const result = visitor.visit(child);
      if (result !== child) {
        (node as any)[key] = result; // or session.patchField(node, key, result)
      }
    } else if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        if (child[i] instanceof Node) {
          const result = visitor.visit(child[i]);
          if (result !== child[i]) {
            child[i] = result;
          }
        }
      }
    }
  }
}
```

Benefits over the current approach:
- No dynamic property discovery. `childKeys` is a static array — the engine knows exactly
  which fields to visit.
- Leaf nodes short-circuit immediately (`childKeys === null`).
- The visitor sees named fields, not array indices or generic data entries.

### Session-aware visitors

When a visitor runs inside a session, child reads go through the overlay:

```ts
function visitChildrenInSession(node: Node, visitor: Visitor, session: EvalSession): void {
  const keys = (node.constructor as typeof Node).childKeys;
  if (!keys) return;

  for (const key of keys) {
    const child = getField(node, session, key);
    if (child instanceof Node) {
      const result = visitor.visit(child);
      if (result !== child) {
        patchField(node, session, key, result);
      }
    }
    // ... array handling similar
  }
}
```

Visitor writes go into the session overlay rather than mutating the canonical node. This
means the same canonical tree can be visited by multiple sessions concurrently without
interference.

### Less-compat visitors

Less plugins implement visitors with `visit<Type>(node)` methods. The less-compat layer:

1. Wraps the Jess visitor to call plugin `visit<LessType>()` methods with adapted nodes.
2. Converts plugin return values back to Jess nodes.
3. Uses `childKeys` for traversal internally (the plugin never sees `childKeys`).

The adapter layer handles type name mapping (`Ruleset` → `Ruleset`, `Declaration` → `Declaration`,
`Reference` → `Variable`, etc.) using the same declarative definitions from the adapter section.
No per-visitor Proxy wrapping needed.

## Mapping the Four Use Cases

### Use case 1: variable value copied only to suppress source comments

- Stop copying.
- Render through `RenderMask { suppressComments: true }`.

### Use case 2: style import cloned in case evaluation diverges

- Canonical cached import tree.
- Per-import `EvalSession`.
- Path materialization only for touched branches.

### Use case 3: extend clones `extendWith` selector because comments may be present

- Selectors rewritten with structural sharing builders.
- Generated output rendered with comment suppression.

### Use case 4: eval replaces nodes but we want original state retained

- `sourceNode` remains the stable source identity.
- Session overlay stores runtime mutation deltas — canonical nodes are never mutated.
- No separate tracking mechanism needed; the canonical tree IS the original state.

## Migration Phases

See [migration.md](./migration.md) for detailed stages, and [dependency-graph.md](./dependency-graph.md)
for Stages 17–21 (reactive eval, session-local registries, Live Patch API).

Summary order (maximum return for minimum risk):

1. **Instrumentation** — measure current state.
2. **Instance fields + childKeys** — all node types, unified model.
3. **Less-aligned field names** — rename pass.
4. **RenderMask + `render()` function** — eliminate comment-driven copies; session-aware serialization.
5. **Declarative adapter layer** — replace less-compat Proxies.
6. **Selector path-copy builders** — reduce extend allocations.
7. **Import EvalSession** — copy-on-write for repeated imports. (Stages 7–15, complete.)
8. **Immutable selectors** — stop mutating `selector` in extend; use `_extendedSelector` only. (Stage 17)
9. **Dependency graph** — track which top-level vars flow into each output. (Stage 18)
10. **WeakMap-keyed registries** — detach index from `Rules` instance; share across clones. (Stage 19)
11. **Session-local registry deltas + import clone reduction** — session carries only delta keyed by the logical `Rules` container; import finalization now avoids much of the old structural cloning, but this did not finish the immutability/session migration. (Stage 20)
12. **Fundamentals completion gate** — finish the real contract: canonical nodes immutable, eval-time field writes/replacements sessionized, and baseline parity proven before advancing. (Current work)
13. **Live Patch API** — emit `var(--id, fallback)` + `patch.js` from the same dependency graph only after the fundamentals gate is cleared. (Stage 21)

## Possible: Collapsing preEval / eval into One Pass

Today the tree is traversed twice: once by preEval (clone + register names) and once by
eval (evaluate in priority order). With sessionized eval, preEval's cloning job disappears.
What remains is name registration, which could potentially happen inline during a single
walk — register names on first encounter, then evaluate in priority order from the queue.

The main obstacle is dynamic/interpolated names, which currently need a retry loop after
all static names are registered. A single-pass model would need a deferred-registration
strategy for these cases. Mixin bodies and StyleImport also have lazy preEval behavior
that must be preserved.

This is worth exploring after the session infrastructure is in place (Stage 14 in the
migration plan), but only if instrumentation shows preEval is a meaningful fraction of
total eval time.

## Implementation Notes

### Avoid a false abstraction

A generic "patch any node in any way at any time" layer will become expensive and invasive.
Most of the value comes from two specific optimizations:

1. Render policy should not require copying.
2. Mutation isolation should be copy-on-write, not eager deep-clone.

### Parent and lookup semantics are the hardest part

`parent`, `sourceParent`, and `index` are live runtime fields. If a node can be observed from
two evaluation contexts at once, shared in-place parentage is unsafe. That is why the import
solution should be session-scoped, not global.

### `sourceNode` should become the identity anchor

For "what did this come from?" questions, `sourceNode` is the right stable anchor. Lean on:

- `sourceNode` for provenance.
- Generated wrappers for output shape.
- Render masks for output policy.

And less on physical duplication of source nodes.

## Risks

1. Render behavior may accidentally suppress comments too broadly.
2. Selector sharing can break parent-dependent logic if introduced outside carefully bounded
   paths.
3. Overlay evaluation can become hard to reason about if too many generic mutators are made
   overlay-aware at once.
4. The instance-field migration is a large refactor touching every node class.
5. Registries and caches may currently assume concrete node identity after cloning.
   (Addressed by WeakMap-keyed shared registries in Stage 19 — see `dependency-graph.md`.)

## Validation Strategy

Before and after each phase, validate:

- Full test suite.
- Extend-heavy tests.
- Import/configuration tests.
- Reference/comment rendering tests.
- Repeated-import benchmarks on a large stylesheet.
- Fns package tests.
- Less-compat integration tests.

## Bottom Line

The practical approach is:

- **All fields on the instance.** No `.data` indirection. `childKeys` replaces generic
  data-object iteration for adoption and cloning.
- **Align field names with Less.js** where semantically sound. Halves the adapter surface.
- **Render-time masking** when the problem is only output policy.
- **Copy-on-write overlays** when the problem is mutation isolation.
- **Path-copy structural sharing** when the problem is localized tree rewriting.
- **Declarative adapters** instead of per-node Proxy transformers.
- **`render(node, options)` as the serialization API** — session-aware, mask-aware; `.toString()` is the zero-config shorthand.
- **`childKeys`-driven visitor traversal** — explicit, static child enumeration; session-aware variant writes patches instead of mutating.
- **Function-based read surface** for sessions, not Proxies.
- **Functions remain simple** — create and return concrete nodes; sessions are invisible.

**Pacing**: one node class at a time, tests green after every change, commit before moving
on. See [migration.md](./migration.md) for the full pacing and verification protocol.

This removes a large percentage of current object creation, simplifies the less-compat layer
dramatically, and makes the node model faster and more direct.
