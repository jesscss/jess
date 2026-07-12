# Registry Architecture Audit

Date: `2026-04-13`
Branch: `dev`

## Purpose

This document audits the current registry / lookup architecture in `packages/core`
and proposes an ideal replacement shape for the hot runtime lookup paths.

This is not just a hot-function list. It is an architecture review focused on:

- whether the current registry model matches the dominant lookup types
- which parts of the current design are structurally too general
- how the design could be simplified while keeping the canonical node graph
- how the future binding split should simplify the system

## Key Measured Facts

From the `benchmark.less` one-render instrumentation:

- `Rules.find`: `301,333`
- `DeclarationRegistry.find`: `260,728`
- `MixinRegistry.find`: `37,314`
- `DeclarationRegistry.indexPendingItems`: `279,848`
- `Reference.evalNode`: `12,037`

Hot declaration keys:

- `base-hue`: `93,810`
- `icon-prefix`: `28,920`
- `i`: `28,853`
- `base-url`: `27,580`
- `white`: `17,444`
- `cols`: `11,745`

Interpretation:

- the catastrophic main benchmark is dominated by lookup architecture
- the hot declaration keys are mostly lexical globals and recursive mixin/loop vars
- the runtime is doing far more declaration-registry work than the number of
  authored reference evaluations alone would justify

## Current Registry Architecture

Main file:

- [packages/core/src/tree/util/registry-utils.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts)

Key entrypoints:

- [packages/core/src/tree/rules.ts:212](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:212) `getRegistry()`
- [packages/core/src/tree/rules.ts:239](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts:239) `find()`
- [packages/core/src/tree/reference.ts:475](/Users/matthew/git/oss/jess/packages/core/src/tree/reference.ts:475) variable/property lookup

### Base Registry

Core shape:

- [registry-utils.ts:118](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:118) `Registry`
- [registry-utils.ts:147](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:147) `_searchRulesChildren()`

Behavior:

- entries are added to `pendingItems`
- actual indexing is deferred to `indexPendingItems()`
- generic `find()` can return:
  - one node
  - a `Set`
  - an `Array`
  - array-backed index entries with extra metadata
- `_searchRulesChildren()` recursively searches nested `Rules` entries using
  generic options bags

Architectural problem:

- the base abstraction is too generic for the hot cases
- lookup is modeled as a search problem over generic containers, not as a
  direct scope-frame query
- the abstraction encourages:
  - `Set -> Array` conversion
  - option spreading
  - generic recursion
  - lookup-time indexing

### Ruleset Registry

Key section:

- [registry-utils.ts:402](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:402)

Behavior:

- indexes rulesets by selector keys
- uses key membership to narrow candidate rulesets

Assessment:

- this is the least offensive registry shape
- it is closer to a query-ready index than the others
- but it still relies on generic parent/registry plumbing from `Rules`

### Mixin Registry

Key sections:

- [registry-utils.ts:501](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:501)
- [registry-utils.ts:764](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:764)

Behavior:

- indexes by selector start key
- carries `match` remainder arrays
- resolves interpolated start keys by doing declaration lookups
- recursively searches nested mixins/rulesets
- always searches children after local work

Architectural problems:

- too much compound-selector logic lives in one registry path
- interpolated selector support forces declaration-registry lookups inside mixin
  lookup
- recursive nested search is mixed into the ordinary lookup path
- candidates are accumulated generically instead of via a purpose-built callable
  lookup model

### Function Registry

Key sections:

- [registry-utils.ts:1067](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:1067)
- [registry-utils.ts:1093](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:1093)

Behavior:

- local map by lowercase name
- parent-chain lookup
- no descendant search

Assessment:

- function lookup is much closer to the ideal shape
- it shows what a simple lexical/callable registry path can look like
- it is still coupled to `Rules` / registry creation / pending indexing
- but architecturally it is far healthier than declaration or mixin lookup

### Declaration Registry

Key sections:

- [registry-utils.ts:1271](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:1271)
- [registry-utils.ts:1297](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:1297)

Behavior:

For each declaration lookup, the current path may do:

1. parent-chain walk over `Rules`
2. `getRegistry('declaration')`
3. `indexPendingItems()`
4. `index.get(key)`
5. `Set -> Array`
6. optional filter
7. optional sort
8. `_findClosestByStart(...)`
9. visibility classification
10. build `searchedRules`
11. build `searchChildrenOptions`
12. call `_searchRulesChildren(...)`
13. maybe `Array.from(declCandidate)`
14. maybe sort again
15. return best result or continue upward

Architectural problems:

- ordinary lexical declaration lookup is paying for a giant general-purpose
  search framework
- current-scope success does not immediately end all extra work
- child-search concerns are mixed into ordinary declaration lookup
- result ordering is recomputed repeatedly instead of stored in query-ready form
- loop/mixin vars still use the same machinery as more exotic cases

## What Is Structurally Non-Ideal

### 1. Lookup is modeled as generic search, not as scope-frame query

The current architecture treats many lookups as:

- ask the `Rules` node for a registry
- index if necessary
- search current scope
- maybe search children
- maybe search parents
- accumulate candidates
- sort and choose

That is the wrong model for the dominant hot lookups.

The dominant hot lookups in the benchmark are:

- lexical globals like `@base-hue`, `@base-url`, `@icon-prefix`
- recursive mixin/loop vars like `@i`, `@cols`, `@n`

Those should not feel like graph search.

### 2. Too much control flow is shared across unrelated lookup semantics

The same declaration path is trying to handle:

- lexical lookup
- declaration-order-sensitive lookup
- optional/private/public visibility
- descendant-visible cases
- import boundary rules
- readonly propagation

That creates too much branching and too many temporary data structures in the
hot path.

### 3. Hot lexical vars are not treated like bindings

Measured hot keys suggest the runtime is repeatedly rediscovering values that
should behave more like bound names than search targets.

Examples from the benchmark:

- `@i`
- `@cols`
- `@n`
- `@base-hue`
- `@base-url`
- `@icon-prefix`

These should be direct frame-slot or frame-map reads, not registry searches.

### 4. Query-time ordering is too expensive

The current declaration path often computes result ordering at query time via:

- array creation
- `comparePosition`
- sorting
- `_findClosestByStart()`

That is backwards for a hot registry.

### 5. Lookup-time indexing is too expensive

`Rules.getRegistry()` can trigger `_indexRules()` and then registry-specific
`indexPendingItems()` on demand.

That means hot lookup is still paying indexing maintenance costs instead of
querying a fully prepared structure.

### 6. Mixin lookup is over-coupled to declaration lookup

Interpolated selector starts in the mixin registry call back into declaration
lookup:

- [registry-utils.ts:834](/Users/matthew/git/oss/jess/packages/core/src/tree/util/registry-utils.ts:834)

That means one callable lookup can turn into additional declaration searches
before it even begins real callable matching.

### 7. Registry search code is duplicated in the wrong dimension

Across registries, the search logic varies far less than the amount of code
duplication suggests.

What is actually different between most registry lookups is mostly:

- whether the caller wants first result or all results
- what local bucket shape is stored for that lookup class
- how matches are normalized before returning

What is currently duplicated anyway:

- parent-chain traversal
- child-scope recursion
- pending-item indexing
- options-bag plumbing
- candidate accumulation
- result post-processing

That is a bad split of responsibilities.

The system currently duplicates search orchestration per registry class, even
though the search policy differences are relatively small compared to the
shared machinery cost.

This creates two problems:

- too much code and branching to maintain for each lookup type
- too much polymorphic control flow for V8 in the hot path

The better split is:

- one narrow traversal substrate for explicit cases that truly need traversal
- separate query overlays for each lookup class
- tiny result-policy adapters instead of whole custom search implementations

In other words: the current design duplicates the expensive part and abstracts
the cheap part.

### 8. `Rules` is doing two jobs at once

The current `Rules` shape in
[packages/core/src/tree/rules.ts](/Users/matthew/git/oss/jess/packages/core/src/tree/rules.ts)
holds:

- the canonical ordered node list in `value`
- lazy side registries for declarations, mixins, functions, and rulesets
- lazy `_rulesSet` data for nested rules traversal

That means the runtime currently maintains:

- one structure for source-truth order
- additional structures for lookup
- additional state for whether those structures are indexed yet

This is not necessarily wrong, but it is too expensive in its current form
because the overlays are:

- generic
- lazily completed during lookup
- partly duplicative in search behavior
- not shaped around the dominant queries

The key question is not "should `Rules.value` stop being an array?"

The better question is:

- "what is the cheapest canonical storage for ordered child nodes, and what
  minimal query overlays should hang off of it?"

From a V8 and architecture perspective, the answer is probably:

- keep `Rules.value` as the canonical ordered array
- do not create alternate primary containers for the same nodes
- build narrow, query-ready overlays that store references into that array or
  directly into nodes, not duplicated node lists

So the non-ideal part is not primarily "array bad."

The non-ideal part is:

- generic registry objects
- generic pending indexing
- repeated per-registry traversal logic
- overlays that are not query-ready for the actual hot lookups

### 9. The current overlays duplicate list shapes unnecessarily

Several current structures duplicate collection shapes around the same `Rules`
contents:

- `value: Node[]`
- registry `index` maps
- `pendingItems`
- `_rulesSet: RulesEntry[]`

Some duplication is unavoidable if lookup is to be fast. But the duplication
should be narrow and intentional:

- stable arrays of binding entries
- stable arrays of callable entries
- direct references back to canonical nodes

What we have now is broader than that:

- multiple mutable staging containers
- different container types per phase
- repeated conversion between them during lookup

That is both a runtime cost and a design smell.

## The Binding Split Simplifies This

User-stated future direction:

- remove `linear` search
- split semantics into:
  - `live bindings`
  - `contextual bindings`

This is a major simplification opportunity.

### Contextual bindings

This is the Less-like question:

- "what binding is visible contextually at this evaluation point?"
- declaration may be later in the same contextual scope

This should be resolved against the active contextual scope frame, not via a
generic registry search.

### Live bindings

This is the other question:

- "what binding cell does this reference point to, and what is its value now?"

This should work like a captured binding cell or frame slot.

### Why this helps

Once `linear` search is removed, the registry no longer has to pretend one path
can satisfy both:

- declaration-order-sensitive lookup
- contextual scope lookup

That means much of this machinery can disappear from the hot path:

- `start`
- `ignoreCurrentScopeStart`
- `ignoreParentScopeStart`
- `preserveLinearStart`
- much of `_findClosestByStart()` usage in hot variable lookup

The new architecture can instead be explicit about which of the two binding
models is being used.

## V8 Perspective

This section is about what is ideal for runtime performance and V8 specifically,
not just what is conceptually clean.

### What V8 wants from hot lookup paths

For the dominant hot lookup cases, V8 wants:

- stable object shapes
- predictable control flow
- consistent return types
- very few temporary allocations
- direct property or slot access where possible
- very little generic recursion

The current registry architecture violates many of those:

- generic option bags with spread
- `Set -> Array -> sort`
- mixed return shapes
- recursive search helpers
- query-time indexing
- generic descendant-search plumbing in ordinary lookup

### The best hot-path shape

For V8, the ideal hot lookup path is closer to:

- `frame.varSlots[id]`
- `frame.localDeclsByName[name]`
- `frame.parent`

than to:

- `rules.getRegistry(type)`
- `indexPendingItems()`
- `find(...)`
- `collect candidates`
- `sort`
- `search children`

That means the best runtime model is:

- canonical node graph
- separate lightweight runtime frames
- monomorphic frame fields
- query-ready local buckets
- direct parent-scope climbing only when needed

### What should happen to the `Rules` data structure?

Based on the current code and measurements, `Rules.value` should remain the
canonical ordered child list.

Why:

- source order matters semantically
- append/iteration are common operations
- arrays are the best general-purpose ordered storage V8 gives us here
- replacing the array with a linked structure, tree, or custom container would
  likely hurt the common path more than it helps

What should change is not the primary container, but the overlay model.

The runtime should stop treating lookup overlays as mini secondary copies of the
rules list and instead treat them as purpose-built indices over the canonical
array.

That means:

- `Rules.value` stays the source-ordered truth
- scope-frame buckets point directly at node/binding entries
- callable tables point directly at callable entries
- any descendant/export table stores references, not duplicate node lists

The architecture should be:

- one canonical ordered container
- multiple very small query overlays
- no generic registry layer trying to make every overlay behave the same way

### Are registries even worth it?

Not all registries are worth keeping in the same form.

#### Declaration / variable lookup

For hot lexical declarations and vars, a generic registry is likely **worse**
than the right frame-based lookup structure, and may even be worse than a simple
tree climb in some cases.

Why:

- current registry lookup does lots of generic work per query
- hot vars are lexical and repetitive
- the best representation is frame-local slots or buckets, not search

So for declarations/vars:

- **current generic registry:** bad
- **raw tree crawl:** simple but still too much repeated work
- **frame slots / frame-local buckets:** ideal

#### Function lookup

The current function registry is close to worth keeping because it already looks
like:

- local name map
- parent-chain walk

A simple callable map per frame is a good V8-friendly structure.

So for functions:

- **specialized registry or frame-local map:** good

#### Mixin / callable selector lookup

This is the one place where a real specialized index probably is worth it.

Why:

- selector-start and callable matching are more expensive than lexical var lookup
- raw tree crawl would be too broad here

But it still needs to be specialized and query-ready, not generic:

- direct callable-start tables
- explicit nested callable descent
- no declaration-registry fan-out for ordinary cases

So for mixins/rulesets:

- **specialized callable index:** worth keeping
- **current generic-ish recursive registry model:** too expensive

#### Descendant/export visibility

This should not live in ordinary registries at all.

If the language needs descendant-visible bindings, use:

- exported-descendant tables
- or explicit visibility frontiers

That is much better than generic child search from hot lexical lookups.

### Bottom line from a V8 perspective

For the hot path:

- declarations/vars should move away from the current registry model
- functions can keep a very simple registry/map shape
- mixins/rulesets deserve a specialized index
- descendant visibility should be an explicit separate mechanism

So the answer is:

- **no**, we are probably not saving enough by keeping the current generic
  registries for hot lexical declaration lookup
- **yes**, we are likely still saving work by having specialized callable
  indices for mixins/rulesets instead of crawling the tree
- the winning design is not “registries everywhere” or “crawl the tree
  everywhere”
- it is **specialized runtime structures per lookup class**

## Ideal Architecture

### 1. Keep the canonical node graph

The AST stays the source of truth.

Do not clone or materialize alternate trees to make lookup easier.

### 2. Build a runtime scope-frame graph over the node graph

Each active `Rules` scope should correspond to a lightweight runtime frame.

Suggested shape:

- `parentScope`
- `declarationSlotsByName`
- `propertySlotsByName`
- `mixinBucketsByKey`
- `functionBucketsByName`
- scope flags:
  - `readonly`
  - import/reference visibility
  - export/descendant visibility if needed

This frame should be cheap to traverse and purpose-built for query.

### 3. Separate lookup systems by lookup kind

Do not force one generic registry path to handle everything.

Use distinct fast paths for:

- contextual declaration/property lookup
- live binding lookup
- callable lookup (`mixin`, `function`, `ruleset`)
- explicit descendant/export lookup only where the language really needs it

### 4. Treat loop/mixin params as slots, not declarations

Recursive mixin and loop params should not be found through the declaration
registry.

They should be direct frame bindings:

- `frame.vars["i"]`
- `frame.vars["cols"]`
- `frame.vars["n"]`

That alone would remove a large amount of pointless declaration-registry work.

### 5. Make declaration buckets query-ready

For each frame, store declarations in the form the runtime actually needs.

Example:

- `Map<string, Declaration[]>`
- arrays already ordered by source position or shadow priority

Then hot lookup becomes:

1. get bucket by key
2. choose winner by simple reverse scan / binary search / cached pointer
3. if miss, go to parent scope

Not:

1. `Set -> Array`
2. filter
3. sort
4. maybe search children
5. maybe sort again

### 6. Descendant visibility must be explicit and separate

If some language features need "outside-looking-in" lookup into descendants,
that should be represented explicitly:

- exported-descendant table
- descendant-visible binding map
- or a special descendant lookup API

Ordinary lexical declaration lookup should never pay for that possibility.

### 7. Index maintenance should be incremental, not query-driven

When nodes enter a scope, update the scope frame incrementally.

Hot lookup should not ask:

- "is my registry up to date?"
- "should I index pending items now?"

That is setup work, not query work.

### 8. Mixin/callable lookup should use callable-specific data structures

Mixin lookup needs:

- local callable starts
- nested callable descent
- maybe compound selector matching

But it should not depend on broad declaration-registry search for the common
path. Interpolated selector starts should be lowered into callable metadata or
cached binding indirection, not resolved by repeated generic declaration lookup.

### 9. Cache hot reference bindings

For stable reference sites, cache binding resolution by:

- reference node
- active scope frame
- binding mode (`live` vs `contextual`)

Then repeated authored references stop rediscovering the same scope path.

## What Should Likely Go Away

For hot declaration lookup, the following patterns should be removed or moved
off the critical path:

- generic `Set` candidate accumulation
- query-time sorting
- child-search calls in ordinary declaration lookup
- options-object spreading per recursive step
- lookup-time indexing
- treating loop params as declaration-registry entries
- shared "one path handles every lookup semantics" control flow

## Migration Direction

### Phase 1

Measure and isolate current callers:

- direct reference lookup
- mixin-registry-induced declaration lookup
- special cases like `setDefined`

### Phase 2

Split declaration lookup modes:

- contextual declaration lookup
- live binding lookup

Remove `linear` lookup from the hot path entirely.

### Phase 3

Introduce runtime scope frames and slot-style param bindings.

### Phase 4

Move callable lookup onto its own simplified callable tables.

### Phase 5

Reduce or eliminate generic registry search from the dominant runtime path.

## Bottom Line

The current registry system is too general-purpose for the dominant hot lookup
patterns.

The node graph is not the problem.
The problem is using a generic search-heavy registry layer as the direct runtime
lookup model.

The best replacement architecture is:

- canonical node graph
- lightweight runtime scope frames
- explicit binding models (`live` vs `contextual`)
- slot-style loop/mixin params
- query-ready local buckets
- separate descendant/export machinery instead of generic child search

That is the shape most likely to recover the benchmark regression rather than
just trimming a few constants off the current registry code.
