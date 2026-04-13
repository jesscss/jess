# Registry Redesign Proposal

Date: `2026-04-13`
Branch: `dev`
Status: Proposal

Related docs:

- [AGENTS.md](/Users/matthew/git/oss/jess/AGENTS.md)
- [2026-04-13-registry-architecture-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-registry-architecture-audit.md)
- [2026-04-13-less-benchmark-audit.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-audit.md)
- [2026-04-13-less-benchmark-investigation-tickets.md](/Users/matthew/git/oss/jess/docs/future/performance/2026-04-13-less-benchmark-investigation-tickets.md)
- [node-copy-reduction/README.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/README.md)
- [node-copy-reduction/HANDOFF.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/HANDOFF.md)

## Goal

Replace the current generic registry/search architecture with a runtime lookup
model that is:

- aligned with the dominant lookup patterns in Jess and Less
- compatible with the canonical node graph
- substantially cheaper under V8
- explicit about binding semantics

This proposal is specifically motivated by the measured benchmark regression in
modern Less cases and by the current hotspot profile showing excessive work in:

- declaration lookup
- generic registry traversal
- lookup-time indexing
- temporary container creation
- lookup-related control flow

## Repo Constraints This Design Must Obey

This proposal is not free to invent a new runtime in isolation. It must obey
the permanent repo constraints in [AGENTS.md](/Users/matthew/git/oss/jess/AGENTS.md)
and the active canonical-tree direction in
[node-copy-reduction/README.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/README.md).

The most relevant constraints are:

- preserve Jess behavior unless a behavior change is explicitly intended
- keep one canonical source tree
- optimize for lazy per-placement runtime state
- reduce object creation during eval
- do not use cloning as routine eval isolation
- do not use materialization as a normal internal strategy
- maintain valid parent/child relationships at all times
- prefer small, verifiable migration steps over broad rewrites

That means any new search mechanism must be judged on two axes, not one:

- is it semantically correct and maintainable?
- does it move the runtime closer to the canonical-tree model instead of away
  from it?

This is why the proposal keeps:

- one canonical `Rules.value` array
- narrow runtime overlays
- direct references back to canonical nodes or binding cells

and rejects:

- duplicated node-list containers as primary runtime structures
- synthetic declaration nodes just to make param lookup work
- generic registry machinery in hot lexical paths

## Problem Statement

The current registry system in [packages/core/src/tree/util/registry-utils.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts)
is too generic for the dominant runtime lookup types.

For ordinary declaration lookup, the runtime currently does far more than it
should:

- create or fetch a generic registry object from `Rules`
- lazily index pending items during lookup
- collect candidates in `Set`s
- convert `Set`s to arrays
- filter and sort candidates at query time
- carry around generic options bags
- support parent and descendant search logic in the same path
- mix visibility, readonly, import, and lookup-order semantics into one search

This is the wrong shape for hot lexical lookup.

The benchmark data suggests that the runtime is repeatedly rediscovering a small
set of lexical names through this machinery rather than treating them like cheap
bindings.

## Design Principles

1. Keep the canonical node graph.
2. Do not introduce cloning/materialization to make lookup work.
3. Separate lookup classes instead of using one generic search path.
4. Keep one canonical ordered child list per `Rules`.
5. Move hot-path work out of query time and into incremental setup.
6. Make lexical lookup look lexical in code and at runtime.
7. Share traversal primitives only where traversal is actually needed.
8. Optimize for V8-friendly shapes:
   - stable object layouts
   - direct field access
   - fewer temporary arrays/sets/maps
   - minimal polymorphism in the hot path

## Proposed Runtime Model

### 1. Scope Frames Over the Node Graph

Keep the AST/node graph as the source of truth, but do not use it as the direct
lookup engine.

Introduce a lightweight runtime `ScopeFrame` associated with each active `Rules`
scope.

Suggested shape:

```ts
type ScopeFrame = {
  parent: ScopeFrame | undefined;

  declarationBucketsByName: Map<string, BindingEntry[]>;
  propertyBucketsByName: Map<string, BindingEntry[]>;
  functionBucketsByName: Map<string, FuncEntry[]>;
  mixinBucketsByStartKey: Map<string, CallableEntry[]>;

  liveSlotsByName: Map<string, BindingCell>;
  contextualSlotsByName: Map<string, BindingCell>;

  readonly: boolean;
  importMode: ImportMode;
  visibilityMode: VisibilityMode;

  rulesNode: Rules;
};
```

This frame is derived from the node graph, but optimized for query.

### 2. Separate Binding Modes

Remove `linear` search and replace the semantics split with two explicit binding
modes:

- `live binding`
- `contextual binding`

#### Live binding

Question:

- "what binding cell does this reference point to, and what is its value now?"

Model:

- reference resolves to a `BindingCell`
- later reads use the same cell
- loop/mixin params and most lexical vars should behave this way

#### Contextual binding

Question:

- "what binding is visible in this active contextual scope?"

Model:

- lookup starts at the active `ScopeFrame`
- checks local contextual bucket
- climbs parent frames
- no generic descendant search

This cleanly separates two different semantics that the current registry path
tries to unify.

### 3. Slot-Based Params

Recursive mixin and loop params should not go through declaration-registry
lookup.

Examples:

- `@i`
- `@n`
- `@cols`

These should be direct frame slots or direct binding cells.

More importantly, they should not need to exist as synthetic declaration nodes
inside `Rules` at all.

If a value is semantically "a runtime parameter binding for this invocation,"
the runtime should represent it directly as:

- a frame slot
- a binding cell
- or a tiny invocation-local binding entry

not as:

- a declaration node
- inserted into a `Rules` body
- then indexed into declaration registries
- then rediscovered through normal declaration lookup

That current shape is backwards for both architecture and performance.

Parameters are bindings first. They only need AST nodes if the language
semantics specifically require node identity for some external consumer, and
that should be treated as an opt-in compatibility surface, not the default
runtime model.

That means no generic search for the hottest generated values in the benchmark.

### 4. Query-Ready Buckets

For declarations and properties, store values in the form the runtime actually
needs to query:

- `Map<string, BindingEntry[]>`
- arrays already ordered by source order or shadow precedence

That means:

- no `Set -> Array`
- no repeated sort
- no repeated `comparePosition` on the hot path

Choosing the nearest visible declaration should be a simple reverse scan or
binary search inside one local bucket, then a parent-frame hop if needed.

### 5. Specialized Callable Indices

Mixin/ruleset lookup is different enough that it still benefits from a
specialized index.

Use a callable-specific structure for:

- start-key lookup
- nested callable descent
- selector remainder matching

But do not make mixin lookup depend on broad declaration-registry search in the
ordinary case.

Interpolated callable starts should resolve through cached binding metadata or
pre-lowered callable entries, not through generic declaration lookup on every
query.

### 6. Shared Traversal Substrate, Not Duplicated Registry Search Code

One problem with the current registry system is that it duplicates too much
search orchestration across registry classes even though only a few policy
details differ:

- whether to stop on first match or collect all matches
- how local entries are stored
- how matched entries are normalized before return

The replacement should not repeat full search implementations for declarations,
mixins, rulesets, and functions.

Instead, the runtime should have:

- one narrow traversal substrate for the uncommon cases that truly need
  traversal
- one lexical-frame lookup path for hot declaration/function access
- one callable-specific lookup path for mixins/rulesets
- tiny per-lookup policy hooks instead of whole duplicated search bodies

This is important both architecturally and for V8:

- less duplicated branching
- fewer options-bag variations
- more stable hot call shapes
- easier inlining of the dominant path

### 7. Explicit Descendant/Export Visibility

If the language needs descendant-visible or exported-visible bindings, model
that explicitly:

- exported-descendant tables
- visibility frontiers
- descendant-only lookup API

Do not mix descendant search into ordinary lexical declaration lookup.

### 8. Incremental Maintenance

Lookup should not be responsible for completing indexing.

As nodes enter/evaluate into a scope:

- update the current frame incrementally
- maintain query-ready buckets
- populate slots/cells immediately

That removes lookup-time `indexPendingItems()` work from the hot path.

## What This Does Differently

Compared to the current architecture, the new design changes runtime behavior
in these ways.

### Current behavior

`Rules` acts as both:

- the canonical source-ordered node list
- the owner of multiple lazy side registries and side lists

Those overlays are not just indices. They also contain duplicated search logic,
pending-item staging, and query-time repair/index work.

### Proposed behavior

`Rules.value` remains the one canonical ordered child array.

Everything else becomes a narrow overlay over that array:

- scope-frame binding buckets
- scope-frame slots/cells
- callable start-key tables
- explicit descendant/export visibility tables where needed

Those overlays store references to canonical nodes or binding cells. They do
not become alternate primary containers for rules.

### Current behavior

Ordinary variable/property lookup:

1. hits `Reference.evalNode()`
2. calls `Rules.find('declaration', ...)`
3. fetches/creates a generic registry
4. may index pending rules during lookup
5. may allocate candidate sets
6. may convert sets to arrays
7. may sort
8. may run descendant-search-related logic
9. chooses a winner

### Proposed behavior

Ordinary variable/property lookup:

1. determine binding mode: `live` or `contextual`
2. hit current frame slot/bucket
3. choose winner locally
4. if miss, climb `parent`
5. return

This is a much smaller runtime surface.

### Current behavior

Each registry class owns too much of its own search procedure, even when the
real differences are minor.

### Proposed behavior

Search behavior is split into:

- no traversal at all for hot lexical bindings
- callable-specific traversal for callable lookup
- explicit descendant/export traversal only for semantics that actually need it

The runtime no longer pays for "generic registry search" as a default mode.

### Current behavior

Recursive mixin params and generator vars are just "declarations" from the
lookup engine’s point of view.

### Proposed behavior

Recursive mixin params and generator vars are frame slots / binding cells and do
not enter declaration search at all.

They also do not need synthetic declaration nodes added to `Rules` just to make
lookup work.

### Current behavior

Mixin lookup uses specialized indexing but still folds in:

- generic search options
- descendant search
- declaration lookup for interpolated starts

### Proposed behavior

Mixin lookup becomes:

- callable start-key lookup
- explicit remainder match
- explicit nested callable descent
- cached interpolation resolution where needed

### Current behavior

Descendant/export visibility is mixed into ordinary lookup paths.

### Proposed behavior

Descendant/export visibility is a separate mechanism that hot lexical lookup
does not pay for.

## Why This Should Be Faster Under V8

This section is about runtime shape, not just semantic neatness.

### 1. Fewer temporary allocations

Current hot lookup allocates:

- `Set`s
- arrays from `Set`s
- filtered arrays
- sorted arrays
- spread-created options objects

The proposed model avoids most of that:

- direct bucket lookup
- direct slot lookup
- preordered local arrays
- parent pointer traversal only

That reduces GC pressure and keeps the hot path smaller.

### 2. More stable object shapes

Current path pushes a lot of ad hoc option objects and container variations
through the same methods.

The proposed model uses:

- a stable `ScopeFrame` shape
- stable `BindingEntry[]` buckets
- direct fields like `parent`, `declarationBucketsByName`, `liveSlotsByName`

That is better for inline caches and hidden-class stability.

### 3. Simpler control flow

Current declaration lookup tries to unify:

- lexical lookup
- contextual lookup
- descendant lookup
- visibility logic
- readonly logic
- import boundaries
- ordering logic

The proposed model splits those semantics into separate paths and makes the hot
path mostly:

- local bucket
- parent hop
- local bucket

That is much easier for V8 to optimize than branchy generic search code.

### 4. Better data locality

Current lookup repeatedly jumps through:

- `Rules`
- generic `Registry`
- `pendingItems`
- `index`
- candidate containers
- recursive child/parent paths

The proposed model keeps the hot binding data in the current frame:

- slots and buckets are immediately local
- parent frame is one hop away

That gives much better locality for repeated lexical names.

### 5. Preserves arrays where arrays are good, and stops abusing them where they are not

`Rules.value` should stay an array.

Why:

- source order is semantically meaningful
- ordered iteration is common
- arrays are V8's best general-purpose ordered collection here

The performance mistake is not that `Rules.value` is an array.

The performance mistake is that the runtime repeatedly builds and searches
generic side containers instead of maintaining narrow query-ready overlays on
top of that array.

This proposal therefore keeps the array and changes the overlay model.

### 6. Removes lookup-time indexing from the hot path

Query-time maintenance is poison for hot lookup.

Incremental frame maintenance means lookup reads a ready structure instead of
asking whether the structure is ready.

### 7. Better specialization by lookup class

The proposed model lets V8 see different hot paths for:

- declarations/vars
- functions
- mixins/rulesets

Instead of one polymorphic registry system trying to handle all of them.

### 8. Reduces duplicated search code in optimized code paths

The current registry design duplicates too much search logic across registry
classes. That increases maintenance cost and widens the optimized code surface.

The proposed design keeps only:

- one fast lexical frame path
- one callable index path
- one explicit visibility/traversal path when needed

That is a better fit for V8 than four variants of partially duplicated
registry-search control flow.

## Are Registries Worth Keeping?

Not in the same form for every lookup class.

### Declaration / variable lookup

The current generic registry shape is not worth keeping for the hot lexical
path.

It is likely worse than it needs to be, and probably worse than a purpose-built
frame model by a wide margin.

For declarations and vars:

- replace generic registry search with frame slots/buckets

This does not mean "remove all indexing."

It means:

- stop using a generic registry object as the abstraction boundary
- keep only the narrow binding buckets that serve hot lexical lookup directly

### Function lookup

A simple function map per frame is still worth having.

This is already close to a good shape.

### Mixin / callable lookup

A specialized callable index is still worth having.

The alternative, raw tree crawling, would be too broad and too expensive for
callable selector lookups.

But it must be callable-specific, not generic-registry-shaped.

### Descendant/export visibility

This should not be a generic registry concern.

Use explicit exported or descendant-visible tables if semantics require them.

## Should `Rules` Use a Different Primary Container?

Probably not.

The strongest current evidence does **not** point to `Rules.value` being the
wrong canonical storage. The stronger evidence points to the wrong overlay
architecture on top of it.

Keeping the canonical ordered array is likely still the right choice because:

- order-sensitive semantics are common
- direct iteration is common
- append/build costs stay simple
- V8 handles packed arrays well

What should be eliminated is not the canonical array, but:

- duplicated registry search code
- lazy query-time indexing
- repeated container conversion around the same node set
- secondary structures that act like partial copies rather than narrow indices

So the recommended model is:

- keep `Rules.value` as the source-ordered truth
- replace generic registries with scope frames and callable tables
- ensure all overlays reference canonical nodes/binding cells directly
- never make alternate primary node-list containers just to support lookup

## Transition Plan

This should be migrated in stages, not rewritten all at once.

### Stage 1: Add runtime frames without changing semantics

Introduce `ScopeFrame` and populate it alongside the current registry system.

For now:

- keep old lookup behavior
- build frames incrementally
- add assertions comparing frame state with current registry contents
- add assertions that new overlays reference canonical nodes rather than copied
  node lists

### Stage 2: Route ordinary declaration lookup through frames

Target:

- ordinary var/property/contextual declaration lookup in
  [packages/core/src/tree/reference.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts)

Keep a guarded fallback to the current registry path during development.

### Stage 3: Convert params to slots

Move recursive mixin/loop params and similar values into direct frame slots.

Delete the need to materialize them as declaration nodes in `Rules` for normal
evaluation.

This should remove a large fraction of hot declaration lookups immediately.

### Stage 4: Remove `linear` and split bindings cleanly

Implement explicit:

- `live`
- `contextual`

binding modes, and delete the old `linear` lookup machinery from hot paths.

### Stage 5: Rebuild callable lookup

Replace the current mixin registry internals with callable-specific tables and
cached interpolation handling.

### Stage 6: Remove descendant search from ordinary declaration lookup

Any descendant/export semantics should move to explicit mechanisms.

### Stage 7: Delete the generic hot-path registry plumbing

Once correctness is proven:

- remove lookup-time indexing from hot paths
- remove generic declaration-registry search from ordinary lexical lookup

## Correctness Strategy During Transition

The migration must prove semantic parity while the architecture changes.

### 1. Differential lookup tests

For the same input tree and active scope:

- old lookup result
- new frame lookup result

Compare:

- node identity or equivalent binding identity
- node type
- value
- readonly behavior
- visibility behavior
- whether the result came from the same canonical node entry

This should be done before deleting the old path.

### 2. Scope-frame invariant tests

Add focused tests for frame behavior:

- local shadowing
- parent shadowing
- import boundary stopping
- readonly propagation
- contextual binding visibility
- live binding cell updates
- param slot binding
- overlay entries remain stable references into canonical `Rules.value`
- no duplicate node-list containers are required for hot lexical lookup
- param bindings do not require synthetic declaration nodes for normal
  evaluation semantics

### 3. Existing integration baselines

Keep the current suites green while routing more behavior through frames:

- `@jesscss/core` tests
- Less compatibility suite in `packages/jess/test/less`
- import/reference-specific tests
- detached ruleset tests
- recursive mixin tests
- extend-heavy tests

### 4. Targeted benchmark semantic tests

Add focused correctness tests around the exact benchmark constructs that are hot:

- `.color-gen(@i)` / `@base-hue`
- `.generate-icons(@n, @i: 1)` / `@base-url` / `@icon-prefix`
- `.gen-grid(@cols, @i: 1)` / `@cols` / `@i`

These should assert the same output before and after the redesign.

### 5. Perf guardrails

Use the instrumentation harness:

- [scripts/profile-less-benchmark.mjs](/Users/matthew/git/oss/jess/scripts/profile-less-benchmark.mjs)

Track reductions in:

- declaration lookup counts
- lookup-time indexing counts
- reference eval cost
- overall render time on `benchmark.less`

Success should mean both:

- semantic parity
- materially lower lookup volume and runtime cost

## Proposed Deliverables

1. `ScopeFrame` runtime model
2. frame-based declaration/contextual lookup
3. slot-based param bindings
4. `live` vs `contextual` binding split
5. callable-specific index redesign
6. explicit descendant/export visibility mechanism
7. differential lookup tests
8. benchmark perf guardrails

## Bottom Line

The current registry system is too general for the hottest lookup classes.

The redesign should:

- stop treating lexical lookup as generic graph search
- stop paying query-time indexing and sorting costs
- stop routing loop/mixin params through declaration registries
- stop mixing descendant visibility into ordinary lookup
- keep the node graph canonical
- use specialized runtime structures where they actually pay off

From both a semantic and V8 perspective, the best design is:

- canonical AST
- runtime scope frames
- slot/cell bindings
- query-ready local buckets
- specialized callable indices
- explicit `live` vs `contextual` semantics
