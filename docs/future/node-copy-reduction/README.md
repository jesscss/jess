# Node Copy Reduction Plan

## Document Map

This document is the architecture and strategy overview.

Use it together with:

- [migration.md](./migration.md) for the staged refactor sequence
- [subsystems.md](./subsystems.md) for subsystem responsibilities, APIs, and invariants

Recommended reading order:

1. this file
2. `migration.md`
3. `subsystems.md`

## Goal

Reduce `clone()` / `copy()` usage across the tree without changing behavior, especially in these cases:

1. Referencing a value but suppressing its source comments.
2. Reusing an imported tree multiple times when evaluation may diverge.
3. Extending with selectors that should not carry authored comments into generated output.
4. Evaluating by replacing or rewriting nodes while still retaining access to original state.

The main objective is to stop paying for deep clones when we only need one of:

- Different render behavior
- Mutation isolation
- Original-state tracking

Those are different problems and should not share one expensive mechanism.

## Current Constraints

The current node model is intentionally mutable. A node carries runtime state such as:

- `parent`
- `sourceParent`
- `sourceNode`
- `index`
- `preEvaluated`
- `evaluated`
- `state` flags
- `pre` / `post`
- mutable `data` via `setData()`, `push()`, `splice()`, `unshift()`

This matters because a generic "diff patch over a shared immutable tree" does **not** drop cleanly into the current architecture. The main blockers are:

1. `adopt()` mutates parent relationships and propagates flags upward.
2. many eval paths expect in-place mutation through `setData()` and array mutators.
3. lookup and ordering depend on runtime state like `index` and `sourceParent`.
4. the same node cannot safely belong to multiple live parents unless parentage is externalized.

Because of that, a full immutable AST plus generic patch overlay would be a large rewrite. It is possible, but it is not the cheapest path to material performance gains.

## Recommendation

Do **not** start with a single universal diff/patch layer.

Instead, split the work into three narrower mechanisms:

1. `RenderMask`: zero-copy comment and whitespace suppression at render time.
2. `EvalOverlay`: copy-on-write mutation isolation for imports and eval.
3. `Structural sharing builders`: allocate only rewritten selector/container paths, not full deep copies.

Then add a small `ChangeJournal` only where original-state inspection is actually needed.

That gets most of the benefit with much less risk.

## Proposed Architecture

### 1. RenderMask for comment suppression

This replaces the cases where `copy(true)` exists only to remove comments.

Examples:

- referenced variable values that should render without source comments
- `extendWith` selectors that should not emit comments from authored source
- generated selector wrappers that should suppress inherited `pre` / `post`

#### Design

Add render-time policy to serialization instead of materializing comment-stripped nodes.

Possible shape:

```ts
interface RenderMask {
  suppressComments?: boolean;
  suppressPrePost?: boolean;
  suppressCommentsForSourceNode?: WeakSet<Node>;
}
```

This mask is passed through render helpers. When serializing:

- skip `Comment` children if `suppressComments` is enabled
- skip comment entries in `pre` / `post`
- optionally suppress comments only for specific source subtrees

#### Why this helps

Today `copy()` does real object creation just to replace comments with `Nil`. That is the most obvious avoidable allocation class.

For use cases 1 and 3, a render mask should eliminate most cloning entirely.

#### Scope

Start only with:

- `Reference` output copies
- selector extend output
- any generated wrappers that currently call `copy(true)` only to sanitize output

Do not thread this through every render path on day one.

### 2. EvalOverlay for imports and divergent evaluation

This addresses the expensive case where the same imported tree may evaluate differently depending on configuration or scope.

#### Core idea

Keep one canonical source tree. For each import/eval session, create an overlay frame:

```ts
interface EvalOverlay {
  nodePatches: WeakMap<Node, NodePatch>;
  runtimeState: WeakMap<Node, RuntimePatch>;
}

interface NodePatch {
  data?: unknown;
  keyedWrites?: Map<string | number, unknown>;
  splices?: Array<...>;
  options?: Record<string, unknown>;
  pre?: Node["pre"];
  post?: Node["post"];
  flags?: { add?: number; remove?: number };
}

interface RuntimePatch {
  parent?: Node;
  sourceParent?: Node;
  index?: number;
  preEvaluated?: boolean;
  evaluated?: boolean;
}
```

Reads first consult overlay state. The first write to a shared node creates a patch record. Untouched nodes remain shared.

#### Important detail

This should be implemented as **copy-on-write path materialization**, not as a pure logical overlay forever.

When a path must become a real emitted/evaluated tree:

1. materialize only the rewritten path
2. shallow-copy each ancestor on that path
3. reuse untouched child subtrees where safe

That gives persistent-tree behavior without rewriting the entire engine around immutable reads.

#### Why this helps

Deep-cloning an entire imported rules tree is worst-case work paid up front. In practice, many imports only mutate a small portion:

- injected `with` variables
- visibility/reference flags
- local registry state
- a few evaluated branches

Copy-on-write means allocations scale with touched paths, not full tree size.

#### Where to use it first

Start in `import-style.ts`, because that is where the "same tree imported multiple times" cost is most explicit.

Recommended initial rule:

- cache one canonical pre-eval tree per resolved import
- each import invocation gets an `EvalOverlay`
- materialize only if the overlay performs writes

#### Non-goal

Do not try to make every node method overlay-aware immediately. Start with import evaluation entry points and the small set of mutators they call.

### 3. Structural sharing builders for selector rewrites

This addresses extend and selector normalization.

#### Core idea

Most selector transforms do not need a deep copy of every descendant. They only need:

- a new container array
- a few rewritten members
- the rest reused structurally

Examples:

- append one alternative to a `SelectorList`
- wrap a matched segment in `:is(...)`
- splice in a parent replacement for ampersand materialization
- strip redundant compound members

#### Design rules

1. Treat selectors as path-copy structures.
2. Reuse untouched child nodes.
3. Allocate new nodes only for containers on the rewritten path.
4. Let render masking handle comment suppression instead of copying children just to sanitize them.

#### What has to change

Current selector helpers frequently do `node.copy(true)` before any rewrite. Replace those with helper builders such as:

```ts
appendSelectorAlternative(target, added, policy)
rewriteCompound(node, mapper, policy)
rewriteSelectorPath(root, path, replacement, policy)
```

Each builder should:

- create a new container only when one of its children changes
- preserve `sourceNode`
- explicitly set generated flags on new wrappers
- avoid cloning unchanged descendants

#### Parent-pointer caveat

Reused selector child nodes cannot be adopted into multiple live parents if they are still mutable and parent-owned.

For this phase, use structural sharing only when one of these is true:

1. the reused subtree is frozen/read-only for the remainder of the operation
2. the subtree is carried by source identity and only materialized at final output
3. parent lookup is not required on the shared descendants

That means selector sharing should start in localized generated-output paths, not globally.

## Original-State Tracking

If the requirement is "it would be nice to keep a record of the original state", use a `ChangeJournal`, not deep cloning.

Possible shape:

```ts
interface ChangeJournalEntry {
  node: Node;
  op: "setData" | "push" | "splice" | "setOption" | "setPre" | "setPost" | "flags";
  before: unknown;
  after: unknown;
  context: string;
}
```

Use it only in debugging, diagnostics, or guarded experiments.

This is cheaper than cloning because:

- unchanged nodes produce no entries
- entries are flat records, not full object graphs
- journaling can be disabled in production if needed

This fits use case 4 much better than "clone everything so we can maybe compare later."

## Mapping the Four Use Cases

### Use case 1: variable value copied only to suppress source comments

Preferred solution:

- stop copying
- render through `RenderMask { suppressComments: true }`

Expected result:

- near-zero additional object creation
- no loss of source identity

### Use case 2: style import cloned in case evaluation diverges

Preferred solution:

- canonical cached import tree
- per-import `EvalOverlay`
- path materialization only for touched branches

Expected result:

- no full deep clone for untouched imports
- repeated imports pay only for actual mutations

### Use case 3: extend clones `extendWith` selector because comments may be present

Preferred solution:

- selectors rewritten with structural sharing builders
- generated output rendered with comment suppression

Expected result:

- allocate only new wrapper/list/compound nodes
- do not clone unchanged descendants just to strip comments

### Use case 4: eval replaces nodes but we want original state retained

Preferred solution:

- `sourceNode` remains the stable source identity
- optional `ChangeJournal` records actual rewrites
- overlay frame stores runtime mutation deltas

Expected result:

- original-state visibility without full tree duplication

## Migration Plan

The high-level phases below are intentionally compact.

For the implementation-safe version with entry criteria, exit criteria, compatibility rules,
test gates, and "what must not break while this phase is underway", use:

- [migration.md](./migration.md)

### Phase 0: measure first

Add instrumentation before changing behavior.

Track:

- count of `clone()` calls
- count of `copy()` calls
- number of deep clones
- approximate nodes allocated by clone/copy
- hottest call sites by file/function

This should be enabled in benchmark/test mode only.

### Phase 1: remove comment-driven copies

Target the easiest wins first.

Tasks:

1. add `RenderMask` support to serialization helpers
2. switch `Reference` output paths away from `copy(true)` where the only reason is comment suppression
3. switch extend output helpers away from comment-stripping copies

Expected risk:

- low to medium

Expected payoff:

- immediate reduction in object creation

### Phase 2: selector path-copy helpers

Tasks:

1. introduce selector rewrite builders
2. convert exact-extend and partial-extend helpers from deep-copy style to path-copy style
3. ensure generated wrappers own only newly allocated containers

Expected risk:

- medium

Expected payoff:

- large reduction in extend-time allocations

### Phase 3: import eval overlay

Tasks:

1. create `EvalOverlay` abstraction
2. route `import-style.ts` through overlay-aware evaluation
3. materialize only touched paths
4. validate repeated import, `with`, `once`, `multiple`, `reference`, and `compose` behavior

Expected risk:

- high

Expected payoff:

- largest improvement for large imported trees

### Phase 4: optional change journaling

Tasks:

1. add a lightweight journal for eval rewrites
2. enable only under debug/instrumentation
3. surface journal data in failure diagnostics if useful

Expected risk:

- low

Expected payoff:

- better introspection without clone cost

## Implementation Notes

### Avoid a false abstraction

A generic "patch any node in any way at any time" layer will become expensive and invasive quickly. Most of the value here comes from two very specific optimizations:

1. render policy should not require copying
2. mutation isolation should be copy-on-write, not eager deep-clone

Keep the APIs narrow around those goals.

### Parent and lookup semantics are the hardest part

Any sharing strategy must account for the fact that `parent`, `sourceParent`, and `index` are live runtime fields today.

If a node can be observed from two evaluation contexts at once, shared in-place parentage is unsafe.

That is why the import solution should be session-scoped, not global. Each import/eval session owns its runtime overlay.

### `sourceNode` should become the identity anchor

For debugging, compare, and "what did this come from?" questions, `sourceNode` is the right stable anchor.

The plan should lean harder on:

- `sourceNode` for provenance
- generated wrappers for output shape
- render masks for output policy

and less on physical duplication of source nodes.

## Risks

1. Render behavior may accidentally suppress comments too broadly.
2. Selector sharing can break parent-dependent logic if introduced outside carefully bounded paths.
3. Overlay evaluation can become hard to reason about if too many generic mutators are made overlay-aware at once.
4. Registries and caches may currently assume concrete node identity after cloning.

## Validation Strategy

Before and after each phase, validate:

- full test suite
- extend-heavy tests
- import/configuration tests
- reference/comment rendering tests
- repeated-import benchmarks on a large stylesheet

Add targeted assertions for:

- source comments suppressed without copies
- repeated imports do not leak mutations between invocations
- selector output remains normalized
- `sourceNode` provenance remains stable

## Suggested Order

If the goal is maximum return for minimum risk, the order should be:

1. `RenderMask`
2. selector path-copy builders
3. import `EvalOverlay`
4. optional `ChangeJournal`

## Bottom Line

Yes, there is a path that is much cheaper than deep cloning, but it should **not** start as a single global diff-patch system.

The practical approach is:

- use render-time masking when the problem is only output policy
- use copy-on-write overlays when the problem is mutation isolation
- use path-copy structural sharing when the problem is localized tree rewriting

That combination should remove a large percentage of current object creation while staying compatible with the existing mutable node architecture.
