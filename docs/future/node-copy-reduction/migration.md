# Node Copy Reduction Migration

## Purpose

This document turns the copy-reduction architecture into a staged refactor that can be
executed over time without leaving the tree in a broken or half-migrated state.

Use with:

- [README.md](./README.md)
- [subsystems.md](./subsystems.md)

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

### Work

Move these fields into session runtime state for migrated paths. This is the most delicate
stage because lookup semantics depend on ancestry.

### Exit Criteria

- Repeated imports of the same canonical AST have independent runtime chains.
- All lookup types still pass.

## Stage 11: Copy-On-Write Materialization

### Goal

Create concrete node trees only for touched paths.

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

### Exit Criteria

- Clone-heavy eval paths shrink over time.
- Instrumentation confirms meaningful allocation reduction.

## Stage 14: Explore Collapsing preEval / eval into a Single Pass

### Goal

Investigate whether the current two-pass tree traversal (preEval then eval) can be
collapsed into a single pass to avoid traversing the tree twice.

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
