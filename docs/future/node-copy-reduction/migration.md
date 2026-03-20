# Node Copy Reduction Migration

## Purpose

This document turns the copy-reduction architecture into a staged refactor that can be
executed over time without leaving the tree in a broken or half-migrated state.

Use with:

- [README.md](./README.md)
- [subsystems.md](./subsystems.md)

## Status Snapshot

Current branch status on `jess-dev`:

- Stages 0–19 are complete.
- Stage 20 is in progress.
- Stage 21 has not started.

For exact implementation state, use:

- [PROGRESS.md](./PROGRESS.md) for the committed done-vs-remaining checklist
- [HANDOFF.md](./HANDOFF.md) for the current next-task summary
- [dependency-graph.md](./dependency-graph.md) for the Stage 17–21 design details

## Core Refactor Rule

Do not do a flag-day rewrite.

Every stage must preserve a compatibility path where:

- Existing code still works when no session is active.
- Old mutation-based eval remains valid outside the migrated slice.
- The new path is introduced one vertical slice at a time.

The migration pattern is:

1. Add compatibility layer.
2. Route one subsystem through it.
3. Prove parity.
4. Expand.

## Migration Strategy

There are five workstreams that can progress mostly independently:

1. Instance-field node model with `childKeys`.
2. Less-aligned field renames.
3. `RenderMask` for comment/output-only copies.
4. Declarative adapter layer for less-compat.
5. `EvalSession` for mutation isolation and repeated evaluation.

Selector path-copy helpers are a sixth workstream but should not block the others.

## Stage 0: Measure and Freeze Assumptions

### Goal

Capture the current clone/copy and eval behavior before migration starts.

### Work

Add instrumentation behind a test/bench-only flag for:

- `clone()` call count
- `copy()` call count
- Deep-clone count
- Approximate nodes allocated by clone/copy
- Import eval count per stylesheet
- Repeated-import benchmark on large source trees

Record current behavior for:

- Repeated imports with different `with` / `set` values
- Dynamic declaration names
- Dynamic mixin names
- Scope lookup vs linear lookup
- Call-time lookup

### Compatibility Rule

No behavior changes in this stage.

### Exit Criteria

- Baseline numbers are recorded.
- High-cost clone sites are known.
- Target tests for repeated imports and dynamic names exist.

## Stage 1: Instance Fields and childKeys — Leaf Nodes

### Goal

Move all data from `.data` to instance fields for leaf/value nodes. Prove the pattern,
establish the `childKeys` infrastructure, update `clone()`.

### Target nodes

Start with the simplest, highest-frequency nodes:

- `Dimension` — `number: number`, `unit: string | undefined`
- `Num` — `number: number` (extends Dimension, no unit)
- `Bool` — `value: boolean`
- `Any` — `value: string`, `role: AnyRole`
- `Keyword` — subclass of Any with `role = 'keyword'`
- `Comment` — `value: string`, `lineComment: boolean`

These have `static childKeys = null` (no child nodes).

### Work

For each target node type:

1. Add instance fields. Remove typed getters that just delegate to `.data`.
2. Set `static childKeys = null`.
3. Update constructor to destructure input onto fields.
4. Move any option-level fields that are really identity (e.g., `lineComment` on Comment,
   `role` on Any) onto the instance.

Update `Node` base class:

1. Make `childKeys` load-bearing in `clone()`, `_adoptChildren()`, and child iteration.
2. When `childKeys` is `null`: node is a leaf, skip child iteration entirely.
3. When `childKeys` is a string array: iterate only named fields.
4. Provide a `.data` compatibility getter during migration that synthesizes the old shape
   from instance fields. Remove it in a later stage.

### Example: Dimension

```ts
class Dimension extends Node {
  static childKeys = null;

  number: number;
  unit: string | undefined;

  constructor(value: DimensionValue, options?, location?, treeContext?) {
    super(options, location, treeContext);
    this.number = value.number;
    this.unit = value.unit;
  }

  override valueOf() {
    return this.unit ? `${this.number}${this.unit}` : this.number;
  }
}
```

### Example: Any

```ts
class Any extends Node {
  static childKeys = null;

  value: string;
  role: AnyRole;

  constructor(value: string, options?: AnyOptions, location?, treeContext?) {
    super(options, location, treeContext);
    this.value = value;
    this.role = options?.role ?? 'any';
  }
}
```

### Updated clone() for leaf nodes

```ts
// In Node base:
clone(deep?: boolean): this {
  const Class = this.constructor as Class<this>;
  const childKeys = (Class as typeof Node).childKeys;

  if (childKeys === null) {
    // Leaf node: simple Object.create + assign, no child iteration
    const node = Object.create(Class.prototype);
    // Copy all own enumerable properties (number, unit, value, etc.)
    Object.assign(node, this);
    node.inherit(this);
    return node;
  }
  // ... container path (Stage 2)
}
```

### Exit Criteria

- All leaf node types use instance fields.
- `childKeys = null` on all leaf types.
- `clone()` uses the fast path for leaf nodes.
- All tests pass.
- `.data` compatibility getter works for any code still reading it.

## Stage 2: Instance Fields — Container Nodes

### Goal

Move all container/parent nodes to instance fields with `childKeys`.

### Target nodes

- `Operation` — `left: Node`, `op: Operator`, `right: Node`
  - `static childKeys = ['left', 'right']`
- `Condition` — `left: Node`, `op: ConditionOperator | undefined`, `right: Node | undefined`,
  `negate: boolean`
  - `static childKeys = ['left', 'right']`
- `Declaration` — `name: NameValue`, `value: Node`, `important: Node | undefined`
  - `static childKeys = ['name', 'value', 'important']`
  - `name` is `NameValue` which may be string or Node; `childKeys` iteration checks
    `instanceof Node`
- `Call` — `name: string | Node`, `args: List<Node> | undefined`, `contentNode: Node | undefined`
  - `static childKeys = ['name', 'args', 'contentNode']`
- `Quoted` — `value: string | Any | Interpolated`, `quote: string`, `escaped: boolean`
  - `static childKeys = ['value']` (value may be Node for interpolated strings)
- `Url` — `value: Quoted | Any`
  - `static childKeys = ['value']`
- `Ruleset` — `selector: Selector | Nil`, `rules: Rules`, `guard: Condition | Nil | undefined`
  - `static childKeys = ['selector', 'rules', 'guard']`
- `AtRule` — `name: Any | Interpolated`, `prelude: Node | undefined`, `rules: Rules | undefined`
  - `static childKeys = ['name', 'prelude', 'rules']`
- `Mixin` — `name: Any | Interpolated | undefined`, `rules: Rules`, `params: List<Node> | undefined`,
  `guard: Condition | undefined`
  - `static childKeys = ['name', 'rules', 'params', 'guard']`
- `StyleImport` — `path: Quoted | Url`, `withConfig: { node: Node, type: string } | undefined`
  - `static childKeys = ['path']` (withConfig.node needs special handling)
- `Reference` — `target: Reference | Call | undefined`, `key: Node | string | number`
  - `static childKeys = ['target', 'key']` (key may be Node)
- `Expression` — `value: Node`
  - `static childKeys = ['value']`

### Selector nodes

- `SelectorList` — `value: Selector[]`
  - `static childKeys = ['value']` (array field)
- `ComplexSelector` — `value: ComplexSelectorComponent[]`
  - `static childKeys = ['value']`
- `CompoundSelector` — `value: SimpleSelector[]`
  - `static childKeys = ['value']`
- `BasicSelector` — `value: string`
  - `static childKeys = null` (leaf)

### Array-valued child fields

For nodes whose children are arrays (Rules, SelectorList, ComplexSelector, CompoundSelector),
the `childKeys` iteration must handle arrays:

```ts
// In clone():
for (const key of childKeys) {
  const field = (node as any)[key];
  if (field instanceof Node) {
    (node as any)[key] = deep ? field.clone(true) : field;
    if (deep) this.adopt((node as any)[key]);
  } else if (Array.isArray(field)) {
    const arr = [...field];
    if (deep) {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] instanceof Node) {
          arr[i] = arr[i].clone(true);
        }
      }
    }
    (node as any)[key] = arr;
  }
}
```

### Rules container

`Rules` holds an array of child nodes as its primary content, plus registry infrastructure:

```ts
class Rules extends Node {
  static childKeys = ['value'];
  value: Node[];
  // ... registry, visibility, etc.
}
```

`push()`, `splice()`, `unshift()` operate on `value` directly.

### Container node adoption via setters

For container fields that are child nodes, use private fields with adopting setters:

```ts
class Declaration extends Node {
  static childKeys = ['name', 'value', 'important'];

  name: NameValue;    // may be string — no adoption needed for strings
  #value!: Node;
  #important: Node | undefined;

  get value() { return this.#value; }
  set value(v: Node) {
    this.#value = v;
    this.adopt(v);
    this._invalidate();
  }

  get important() { return this.#important; }
  set important(v: Node | undefined) {
    this.#important = v;
    if (v) this.adopt(v);
    this._invalidate();
  }
}
```

Only fields that hold child `Node` instances need adopting setters. Primitive fields
(`op`, `quote`, `negate`, etc.) are plain fields.

### Exit Criteria

- All node types use instance fields.
- `childKeys` populated on every class.
- `getEntriesFromNode()` usage eliminated or replaced by `childKeys` iteration.
- `clone()` uses `childKeys` for all types.
- `.data` compatibility getter works. Can be removed after all consumers migrate.
- All tests pass.

## Stage 3: Less-Aligned Field Renames

### Goal

Rename fields to align with Less.js where semantically sound.

### Renames

| Node      | Current field       | New field          | Reason                                |
|-----------|--------------------|--------------------|---------------------------------------|
| Any       | `.data` (string)   | `value`            | Matches Less Keyword/Anonymous        |
| Bool      | `.data` (boolean)  | `value`            | Matches Less Keyword.True/False       |
| Comment   | `.data` (string)   | `value`            | Matches Less Comment.value            |
| Quoted    | `.data` (mixed)    | `value`            | Matches Less Quoted.value (content)   |
| Quoted    | `options.quote`    | `quote`            | Matches Less; moves to instance field |
| Quoted    | `options.escaped`  | `escaped`          | Matches Less; moves to instance field |
| Comment   | `options.lineComment` | `lineComment`   | Matches Less `isLineComment`          |
| Condition | `options.negate`   | `negate`           | Moves to instance field               |
| Any       | `options.role`     | `role`             | Moves to instance field               |
| Operation | `operator`         | `op`               | Matches Less; shorter                 |

### Non-renames (intentional divergence)

| Node      | Less field    | Jess field   | Why keep Jess's name                         |
|-----------|--------------|--------------|----------------------------------------------|
| Dimension | `value`      | `number`     | `dim.value` is ambiguous; `dim.number` is not |
| Condition | `lvalue`/`rvalue` | `left`/`right` | More conventional                       |
| Ruleset   | `selectors[]` | `selector`  | Jess has SelectorList; singular is correct    |
| Ruleset   | `rules[]`    | `rules`      | Jess has Rules container; same name           |

### Work

For each rename:

1. Update the node class.
2. Update all internal consumers (grep for old name).
3. Update fns package if affected.
4. Update less-compat adapters.
5. Update parsers that construct nodes.

This is a mechanical refactor, best done with find-and-replace. If it's too large to do in
one pass, prioritize the leaf nodes first (Any, Bool, Comment, Quoted) since those are the
ones most used in functions and most visible in less-compat adapters.

### Exit Criteria

- All renames complete.
- All tests pass.
- Less-compat adapters simplified to reflect fewer renames needed.

## Stage 4: RenderMask and `render()` Function

### Goal

Eliminate copies that exist only to strip comments from output. Introduce `render()` as
the primary serialization API.

### Why this matters

/**
 * In the current architecture, the most common reason for calling `copy(true)` is
 * **comment suppression** — not structural mutation. When a variable value, mixin
 * return, or extend selector is rendered, the engine deep-clones the entire subtree
 * just to replace `Comment` nodes with `Nil` and clear `pre`/`post` whitespace arrays.
 * This is pure waste: the underlying data is unchanged, only the output policy differs.
 *
 * A `RenderMask` makes this a serialization-time decision rather than a materialization
 * decision. The canonical node stays unmodified; the mask tells the serializer "skip
 * comments in this subtree." Zero allocation, same output.
 *
 * This is the single highest-ROI optimization in the copy-reduction plan because it
 * addresses the most frequent clone site (Reference output) without touching eval
 * semantics, lookup ordering, or parent/child relationships.
 *
 * The `render()` function is the delivery mechanism: unlike `.toString()` (which takes
 * no parameters per `Object.prototype`), `render(node, options)` can accept a session
 * and a mask. `.toString()` becomes shorthand for `render(this)` — zero-config for
 * canonical output, explicit options when needed.
 */

### Work

1. Define `RenderMask` interface.
2. Implement `render(node, options?)` as a standalone function that accepts `RenderOptions`
   (extends `PrintOptions` with `session?` and `mask?`).
3. Update base-class `toTrimmedString()` fallback to iterate `childKeys` instead of
   `getValues(this.data)`.
4. Keep `.toString()` as a zero-config convenience that calls `render(this)`.
5. When mask says `suppressComments`, skip `Comment` children and comment entries in
   `pre`/`post`.
6. Convert `Reference` output paths to use render mask instead of `copy(true)`.
7. Convert extend output helpers to use render mask instead of comment-stripping copies.

### Exit Criteria

- `render()` function exists and works with optional mask.
- `copy(true)` is no longer called for comment-suppression-only cases.
- Render output is identical with and without the mask for non-comment content.
- `.toString()` still works as before for canonical nodes.

## Stage 5: Declarative Adapter Layer

### Goal

Replace 30+ per-node Proxy transformer files in less-compat with declarative definitions.

### Work

1. Define `NodeAdapter<T>` interface:

```ts
interface NodeAdapter<T extends Node> {
  lessType: string;
  fields?: Record<string, (node: T) => unknown>;
  children?: (node: T) => Node[];
}
```

2. Implement `createAdapter(node, def, cache)`:
   - Nodes where all Less field names match Jess field names → return node directly
     (zero wrapping cost).
   - Nodes needing renames → plain object with mapped fields (no Proxy).
   - Nodes needing method interception or lazy child conversion → minimal Proxy.

3. Convert existing transformer files to adapter definitions.

### Adapter examples with aligned names

```ts
// Quoted: .value, .quote, .escaped all match Less — no adapter needed
// Just return the node

// Dimension: Less expects .value for the number
const dimensionAdapter = {
  lessType: 'Dimension',
  fields: { value: (d: Dimension) => d.number },
};

// Color: rgb/alpha match, Less also wants .value as string
const colorAdapter = {
  lessType: 'Color',
  fields: { value: (c: Color) => c.toCSS() },
};

// Declaration: .name, .value, .important all match — no adapter needed

// Operation: Less expects .op and .operands[]
const operationAdapter = {
  lessType: 'Operation',
  fields: {
    operands: (o: Operation) => [o.left, o.right],
  },
  // .op already matches
};
```

### Exit Criteria

- All transformer files replaced with adapter definitions.
- Less-compat test suite passes.
- Proxy usage eliminated for leaf nodes.
- Total less-compat code volume reduced by >60%.

## Stage 6: Remove `.data` Compatibility Layer

### Goal

Remove the `.data` getter and all remaining code that reads `.data`.

### Work

1. Grep for all `.data` usage across the codebase.
2. Convert each to use instance fields directly.
3. Remove `.data` getter from base class.
4. Remove `setData()` from base class.
5. Remove `getEntriesFromNode()` and related collection utilities.

### Exit Criteria

- No `.data` references remain.
- `setData()` removed.
- `getEntriesFromNode()` removed.
- All iteration uses `childKeys`.

## Stage 7: Introduce `EvalSession` as an Optional Layer

### Goal

Add the session object without changing default eval behavior.

### Why this matters

/**
 * Today, when the same stylesheet is `@import`-ed multiple times with different
 * `with`/`set` configurations, the engine deep-clones the *entire* parsed AST for
 * each import. This is the second-largest allocation cost (after comment-driven copies)
 * and scales linearly with file size × import count.
 *
 * The fundamental insight: most of the tree is identical across imports. Only the
 * nodes that are *actually mutated* by evaluation (variable values, mixin bodies,
 * resolved references) differ. Everything else — the structural skeleton, the selector
 * shapes, the static declarations — is shared.
 *
 * `EvalSession` implements this insight as a **persistent-tree overlay**. One canonical
 * AST exists in memory. Each import/eval context gets a lightweight session object that
 * stores only the *deltas* — field overrides, child mutations, runtime bookkeeping
 * (parent, evaluated, index). Untouched nodes remain shared with zero per-session cost.
 *
 * This is the same principle behind persistent data structures (Clojure's maps, Git's
 * object store): the "new version" is `canonical + patch`, not a full copy. The first
 * write to a shared node creates a patch record; subsequent reads in that session see
 * the patched value; other sessions see the canonical value.
 *
 * Stage 7 introduces the *container* (`EvalSession` on `Context`) without migrating
 * any subsystem to use it. This is the compatibility bridge: when no session exists,
 * all code paths behave exactly as they do today, reading and writing node-local fields.
 * Later stages (8-13) incrementally move subsystems behind the session abstraction.
 */

### Work

Introduce an `EvalSession` object that can hold:

- Runtime state
- Structural patches
- Scope snapshots
- Materialized nodes

Add it to `Context` as an optional field. Do not make it mandatory.

### Compatibility Rule

When no `EvalSession` exists:

- All current node fields remain the source of truth.
- All current mutation-based behavior remains unchanged.

### Exit Criteria

- Code can ask for the current session.
- Default behavior is unchanged when session is absent.

## Stage 8: Session-Aware Read and Write Helpers

### Goal

Stop reading/writing runtime eval state directly from/to nodes in migrated code.

### Why this matters

/**
 * The session overlay is only useful if code actually reads and writes through it.
 * Today, eval code directly mutates node fields: `node.parent = newParent`,
 * `node.evaluated = true`, `rules.value.push(newDecl)`. These mutations are the
 * reason we clone — once you mutate a shared node, every context that references it
 * sees the mutation.
 *
 * Session-aware helpers solve this by intercepting reads and writes:
 *
 * - **Reads** check the session overlay first, fall back to the canonical node field.
 *   `getParent(node, session)` returns the session-local parent if one was patched,
 *   otherwise `node.parent`. Zero allocation — just a WeakMap lookup + fallback.
 *
 * - **Writes** go into the session overlay, never touching the canonical node.
 *   `patchField(node, session, 'parent', newParent)` creates a `RuntimeState` entry
 *   for that node in that session. Other sessions (or no-session code) still see
 *   `node.parent` unchanged.
 *
 * The critical design constraint: **when no session exists, the helpers must have
 * zero overhead.** This is why they are plain functions, not Proxies. A function call
 * with an early `if (!session) return node.field` compiles to a single branch — far
 * cheaper than Proxy traps (already measured at ~1.2% CPU overhead for the less-compat
 * Proxy layer).
 *
 * Stage 8 introduces the helpers and wires them into one subsystem (likely import
 * evaluation). The rest of the codebase continues using direct field access until
 * later stages migrate them.
 */

### Work

Introduce read helpers:

- `getParent(node, session)`
- `getSourceParent(node, session)`
- `getIndex(node, session)`
- `isPreEvaluated(node, session)`
- `isEvaluated(node, session)`
- `getChildren(rules, session)`

Introduce write helpers:

- `setRuntimeState(node, session, patch)`
- `replaceNode(node, session, replacement)`
- `prependChildren(rules, session, nodes)`
- `appendChildren(rules, session, nodes)`
- `removeChild(rules, session, child)`
- `markScopeDirty(rules, session)`

All helpers fall back to node-local fields when no session exists.

### Exit Criteria

- Helpers exist and are used by at least one subsystem.

## Stage 9: Move Import Lookup and Configuration to Session Scope

### Goal

Stop cloning imported trees for lookup/configuration.

### Why this matters

/**
 * This is where the session model pays off concretely. Today, `@import "theme.less"
 * with (@primary: red)` deep-clones the entire theme AST, injects a `@primary: red`
 * VarDeclaration at the top, and re-evaluates the whole tree. A second import with
 * `(@primary: blue)` clones again. For a 2,000-node theme file imported 5 times with
 * different configs, that is 10,000 new node objects — most of which are identical.
 *
 * With sessions, each import gets its own `EvalSession` backed by the same canonical
 * theme AST. The `with (@primary: red)` becomes a session-local field override on the
 * `@primary` VarDeclaration node — one `NodePatch` entry, not 2,000 cloned nodes.
 * Evaluation reads through the overlay, so `@primary`'s value resolves to `red` in
 * session A and `blue` in session B, all from the same canonical tree.
 *
 * The lookup infrastructure (declaration index, mixin index) also becomes session-scoped
 * via `ScopeSnapshot`. Each session builds its own index lazily on first lookup, then
 * caches it. Index invalidation is session-local — re-evaluating one import's config
 * doesn't dirty another session's cached index.
 *
 * The key invariant: **the canonical AST is never mutated.** All mutations go into
 * session patches. This means the canonical AST can be shared across any number of
 * concurrent sessions without synchronization.
 */

### Work

Use the session to represent:

- Prepended injected declarations
- Same-name replacements
- Per-import lookup snapshots

### Exit Criteria

- Configured imports do not need eager clone+rewrite for lookup.
- Repeated configured imports do not leak names across sessions.

## Stage 10: Externalize Runtime State to Session

### Goal

Stop using canonical nodes as storage for eval bookkeeping (`preEvaluated`, `evaluated`,
`index`, `parent`, `sourceParent`).

### Why this matters

/**
 * Even after field overrides (Stage 9) and child mutations are session-scoped, the
 * *runtime bookkeeping* fields are still written directly onto canonical nodes:
 *
 * - `node.parent` — set during adoption, used for scope walks
 * - `node.sourceParent` — the "original" parent for provenance
 * - `node.index` — position in parent's child array
 * - `node.preEvaluated` — flag preventing double preEval
 * - `node.evaluated` — flag preventing double eval
 *
 * These are the sneakiest sharing violation. If two sessions share a canonical node
 * and both set `node.parent`, the second write clobbers the first. This is why
 * today's import evaluation must clone: not just for data isolation, but for
 * **runtime state isolation**.
 *
 * Moving these into `RuntimeState` (a per-node, per-session record in the session's
 * `WeakMap<Node, RuntimeState>`) gives each session its own independent view of
 * ancestry and eval status. The canonical node's `parent`/`evaluated`/etc. become
 * the "default" values — used when no session is active.
 *
 * This is the most delicate stage because **lookup semantics depend on ancestry**.
 * `getParent()` is called during scope walks, mixin resolution, and extend
 * reachability checks. Every one of these call sites must be migrated to use
 * `getParent(node, session)` instead of `node.parent`. Miss one, and lookups
 * silently read stale ancestry from the wrong session (or the canonical default).
 *
 * Strategy: migrate one lookup type at a time (declarations first, then mixins,
 * then rulesets), with parity tests verifying that lookup results match the
 * clone-based baseline. Only after all lookup types are verified do we remove
 * the direct field writes.
 */

### Work

Move these fields into session runtime state for migrated paths. This is the most delicate
stage because lookup semantics depend on ancestry.

### Exit Criteria

- Repeated imports of the same canonical AST have independent runtime chains.
- All lookup types still pass.

## Stage 11: Copy-On-Write Materialization

### Goal

Create concrete node trees only for touched paths.

### Why this matters

/**
 * Sessions store deltas, but some consumers need concrete node objects:
 *
 * - **Import results** returned to the caller's scope must be real nodes that can
 *   be adopted, registered, and serialized without a session reference.
 * - **Mixin return values** are injected into the caller's Rules array.
 * - **Detached ruleset values** that escape the eval branch where they were created.
 * - **Plugin/user-facing APIs** (less-compat visitors, function return values) that
 *   expect concrete node instances.
 *
 * Materialization is the process of turning `canonical + session patches` into a
 * concrete node tree. The critical optimization: **only the rewritten path needs
 * new nodes.** If a session patched `@primary`'s value deep inside a theme file,
 * materialization creates new nodes for: the VarDeclaration, the Rules that contains
 * it, and the Ruleset that contains those Rules — the "spine" from root to the
 * changed node. Everything else (all sibling declarations, all other rulesets, the
 * selector trees) is reused by reference.
 *
 * This is path-copy materialization, the same strategy used by persistent data
 * structures and virtual DOM diffing. For a 2,000-node theme with 5 patched nodes,
 * materialization creates ~15-20 new nodes (the spines), not 2,000.
 *
 * Implementation: walk from the patched node toward the root. At each level, if the
 * node or any descendant has a session patch, shallow-copy the node and update the
 * child reference to point to the materialized child. If no descendant is patched,
 * reuse the canonical node as-is.
 *
 * Materialization is always the *last* step. Sessions accumulate patches during eval;
 * materialization happens once at the session boundary (import return, mixin return,
 * etc.). This keeps the number of materializations minimal.
 */

### Work

When a migrated path needs a concrete node:

1. Materialize the touched node.
2. Materialize ancestors on the rewritten path.
3. Preserve untouched descendants.

### Exit Criteria

- Touched paths materialize correctly.
- Untouched branches do not deep-clone.

## Stage 12: Remove `preserveOriginalNodes`

### Goal

Delete `preserveOriginalNodes` entirely. With sessionized eval, canonical nodes are never
mutated — they are inherently preserved. The flag has no remaining job.

### Why this matters

/**
 * `preserveOriginalNodes` is a flag that triggers clone-before-mutate behavior during
 * evaluation. It exists because eval mutates nodes in place (replacing values,
 * updating parents, marking as evaluated), and some callers need the pre-eval state
 * (source maps, error reporting, re-evaluation).
 *
 * With sessions, eval mutations go into the session overlay, not into the canonical
 * node. The canonical AST is inherently preserved — it was never mutated. The flag's
 * job (protect the original) is now the session model's job (isolate mutations).
 *
 * Removing this flag eliminates:
 * - The clone-before-mutate code paths in `preEval` and `eval`
 * - The `sourceNode` tracking that was needed to link mutated clones back to originals
 *   (canonical nodes ARE the originals — no linking needed)
 * - The cognitive overhead of "which copy am I looking at?"
 *
 * This is a cleanup stage, not a behavior change. By this point, all eval paths should
 * be session-aware, and the flag should be unreachable. If any code path still depends
 * on it, that is a signal that the session migration in Stages 8-11 is incomplete.
 */

### Work

1. Remove the flag and all code paths that check it.
2. Remove any clone-before-mutate logic that was gated on this flag.
3. Verify that no eval path mutates canonical nodes outside a session.

### Exit Criteria

- `preserveOriginalNodes` does not exist in the codebase.
- No clone-for-protection code remains in sessionized paths.

## Stage 13: Expand Beyond Imports and Clean Up

### Goal

Apply sessionized eval to detached rulesets, mixin calls, broader eval paths.
Delete obsolete clone-backed code.

### Why this matters

/**
 * Stages 7-12 focus on the import path because it is the most expensive and most
 * isolated clone site. But imports are not the only place where deep clones happen:
 *
 * - **Mixin calls**: Each `.mixin()` call clones the mixin body before evaluation.
 *   With sessions, mixin bodies can be evaluated in a child session, and only the
 *   return value (the resolved declarations/rules) needs materialization.
 *
 * - **Detached rulesets**: `@dr: { ... }; .use { @dr(); }` currently clones the
 *   ruleset block. With sessions, the block is evaluated in a session scoped to the
 *   call site.
 *
 * - **Each/For loops**: Loop bodies are cloned per iteration. With sessions, each
 *   iteration gets a child session with the loop variable patched.
 *
 * - **Guard evaluation**: Mixin guards clone to test without side effects. With
 *   sessions, guard evaluation runs in a throw-away session.
 *
 * This stage is intentionally broad and incremental. Each clone site is migrated
 * independently, verified independently, and committed independently. The goal is
 * not to eliminate every last clone (some clones are structurally necessary), but to
 * eliminate the ones where the only reason for cloning was mutation isolation.
 *
 * By the end of this stage, `clone()` should only be called for genuinely structural
 * reasons: creating new nodes during selector assembly, building extend output,
 * user-facing copy APIs. The "clone to protect" pattern should be gone.
 */

### Exit Criteria

- Clone-heavy eval paths shrink over time.
- Instrumentation confirms meaningful allocation reduction.

## Stage 14: Explore Collapsing preEval / eval into a Single Pass

### Goal

Investigate whether the current two-pass tree traversal (preEval then eval) can be
collapsed into a single pass to avoid traversing the tree twice.

### Why this might matter

/**
 * With session-based eval, preEval's primary job — cloning nodes for mutation safety —
 * is gone. What remains is **name registration**: walking the tree to discover
 * declarations, mixins, and rulesets, building the scope indexes that eval depends on.
 *
 * If name registration can happen inline during a single walk (register on first
 * encounter, then evaluate in priority order from the queue), we eliminate one full
 * traversal of the AST. For a 2,000-node tree, that is 2,000 fewer function calls,
 * 2,000 fewer `instanceof` checks, and 2,000 fewer stack frames.
 *
 * The question is whether this savings is meaningful. If preEval is <10% of total eval
 * time (likely for small-to-medium stylesheets), collapsing the passes saves very
 * little. If preEval is >25% (possible for deeply nested mixin-heavy code where preEval
 * triggers cascading dynamic name resolution), the savings could be significant.
 *
 * This stage is explicitly exploratory. It starts with instrumentation, prototypes a
 * simple case, and only proceeds to full implementation if the data justifies it.
 * The exit criterion is a *decision* (merge or keep separate), not a shipped feature.
 */

### Background

Today the two passes serve distinct purposes:

1. **preEval pass**: clones nodes, registers names/selectors into scope, evaluates
   interpolated names (making them static), and runs the dynamic name resolution loop.
2. **eval pass**: builds a priority-based eval queue from registered names, evaluates
   node values in priority order (imports → calls → declarations → rulesets → rest),
   and processes extends at the root.

The hard ordering constraint: preEval of ALL siblings must complete before any sibling
evals, because eval depends on the registries that preEval populates. For example,
`@foo: bar; @var: @foo;` needs `@foo` registered before `@var`'s value is evaluated.

### Why this becomes viable after earlier stages

With sessionized eval (Stages 7-12), preEval's primary job — cloning nodes for mutation
safety — disappears. The session overlay provides mutation isolation without cloning.
What remains is:

- **Name registration**: can happen on first encounter during a single traversal.
- **Dynamic name resolution**: the retry loop for interpolated names. This is the hardest
  part — it currently requires multiple sub-passes within `_resolveDynamicNodes`.
- **Selector registration for extend**: must happen before extend processing, but extend
  already runs as a post-eval pass.

### Possible single-pass design

Instead of preEval-then-eval, a single traversal with **deferred evaluation**:

1. Walk the tree once. For each node:
   - Register its name into scope immediately (what preEval does now).
   - Queue its evaluation (what the eval queue does now).
2. After the walk, evaluate the queue in priority order (same as today).
3. For dynamic/interpolated names: register a placeholder, resolve when dependencies
   are available, re-register under the resolved name.

This eliminates one full tree traversal while preserving the ordering guarantees that
eval depends on. The priority queue already handles evaluation ordering — the question
is whether registration can happen inline during a single walk.

### Risks

- Dynamic name resolution currently uses retry loops that assume all static names are
  already registered. A single-pass model would need to handle out-of-order registration.
- Mixin bodies are currently NOT preEval'd until the mixin is called. A single-pass
  walk would need to preserve this lazy behavior.
- StyleImport.preEval currently defers everything to eval. This would need to remain
  lazy in a single-pass model.

### Work

1. Instrument the current preEval pass to measure how much time it takes relative to
   eval. If preEval is <10% of total eval time, this optimization has limited payoff.
2. Prototype a registration-during-walk approach for a simple case (flat Rules with
   only static names — no interpolation, no imports).
3. If the prototype shows measurable improvement, design the dynamic name resolution
   strategy for the single-pass model.
4. If not, document the finding and close this stage.

### Exit Criteria

- Decision documented: merge or keep separate, with measured justification.
- If merged: all lookup ordering tests pass, benchmark shows improvement.
- If kept separate: document why, with data.

## Guardrails

### Pacing and verification

Every stage in this migration is a refactor that touches foundational infrastructure.
Move slowly and verify continuously:

1. **One node type at a time.** When converting to instance fields (Stages 1-2), convert
   a single node class, run the full test suite, and confirm green before moving to the
   next. Do not batch multiple node conversions without testing between them.

2. **Run tests after every meaningful change.** A "meaningful change" is anything that
   alters a constructor, a field name, a getter/setter, a clone path, or a visitor
   traversal. If in doubt, run the tests.

3. **Test commands by package:**
   - Core tree tests: `cd packages/core && pnpm test`
   - Fns tests: `cd packages/fns && pnpm test`
   - Jess integration tests: `cd packages/jess && pnpm test`
   - Less-compat tests: `cd packages/jess-plugin-less-compat && pnpm test`
   - Full suite: `pnpm test` from root

4. **If a test fails, stop and fix before continuing.** Do not proceed to the next node
   type or the next stage with failing tests. The failure is likely a downstream consumer
   of the field you just changed.

5. **Commit after each successful node conversion.** Small, reviewable commits are
   better than large batches. Each commit should have a green test suite.

6. **When renaming fields (Stage 3), grep before renaming.** Use `grep -r 'oldFieldName'`
   across all packages to find every consumer. Update all consumers in the same commit
   as the rename.

7. **When removing `.data` (Stage 6), do a final grep.** Any remaining `.data` reference
   after removal is a bug. The compatibility getter should have caught these during
   earlier stages, but verify anyway.

### Structural guardrails

1. Never migrate read and write semantics in the same broad sweep.
2. Always introduce read helpers before redirecting writes.
3. Keep materialization explicit; never let it become an accidental side effect.
4. Do not make extend refactors a prerequisite for sessionized import eval.
5. Any stage that changes lookup semantics must add parity tests first.

## Validation Gates Per Stage

Every stage must pass:

- Full test suite (core, fns, less-compat, jess)
- Benchmark regression check

When the stage touches node shapes (Stages 1-3, 6):

- Verify every constructor call site
- Verify every field access pattern
- Verify clone/copy behavior
- **Convert one node class → run tests → confirm green → repeat**

When the stage touches lookup ancestry or ordering (Stages 9-10, 14):

- Declaration scope lookup tests
- Linear lookup tests
- Call-time lookup tests
- Detached ruleset lookup tests

When the stage touches materialization (Stage 11):

- Render parity tests
- Source provenance assertions using `sourceNode`

When the stage touches render/serialization (Stage 4):

- Output parity tests (render with no mask/session must match current `.toString()`)
- Comment suppression tests (render with mask vs current `copy(true)` output)
