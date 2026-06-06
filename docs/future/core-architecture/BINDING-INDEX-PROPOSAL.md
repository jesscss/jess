# Binding Index Proposal

This is a proposal for a coherent reference lookup, binding, and cache model.
It is design-only until a focused prototype proves the shape against reference
tests and real Less benchmarks.

## Problem

Jess currently has useful pieces, but they are not one system:

- `Rules.varsByName` and `Rules.mixinsByName` are registration indexes.
- `ScopeFrame.declarationBucketsByName` and `liveSlotsByName` are runtime
  lookup state.
- `DeclarationRegistry` and `MixinRegistry` remain broad fallback search
  mechanisms.
- `Reference` coordinates all of this with type-specific branches, fallback
  paths, copy/materialization finalization, and no general lookup-result cache.

That means a hot reference lookup still pays repeated classification, frame
walking, child-surface checks, registry fallback, and result finalization even
when the semantic answer is stable for the same key/type in the same runtime
frame.

The target is one coherent binding system, not three adjacent systems glued
together.

## Goals

- Make ordinary Less variable/property/callable lookup as close as possible to:
  `binding = frame.lookup(plan)`.
- Preserve both supported semantics:
  - Less contextual lookup: source-order aware, last matching declaration wins.
  - Jess/Sass-style live binding: reads see the current cell value, not a copied
    declaration snapshot.
- Cache lookup identity before caching evaluated values.
- Treat evaluated-value caching as a narrow optimization gated by effect and
  dependency facts.
- Keep one canonical source tree. Do not solve lookup speed by copying nodes.
- Avoid new hot-path objects, `Set`s, array conversions, sorts, closures,
  recursive rediscovery, and generic registries for ordinary static-key reads.

## Non-Goals

- Do not implement a broad public materialization cache.
- Do not cache mixin/rules output merely because lookup found the same callable.
- Do not hide existing import, visibility, or placement semantics behind a
  generic side map.
- Do not pick `Map` vs null-prototype object by taste. That is a measured
  storage decision after the semantic model is correct.

## Core Hypothesis

The fastest durable model is a `BindingFrame` with integrated registration,
live cells, lookup-cache slots, and narrow evaluated-value cache metadata.

`Reference` should not ask separate systems:

1. Is there a live binding?
2. Is there a static declaration?
3. Should I ask the registry?
4. Can I cache the result?

It should ask one system:

```ts
const hit = frame.lookup(referencePlan, context);
```

The frame returns a binding hit, miss, or uncacheable result. Evaluation/render
then operates on that binding.

## Binding Concepts

### BindingRecord

One registered binding. Static declarations, live params, loop vars, mixins,
rulesets-as-mixins, functions, imported bindings, and dynamic-name declarations
should all become records with one common shape.

Candidate fields:

```ts
interface BindingRecord {
  kind: BindingKind;
  key: string;
  sourceNode: Node | undefined;
  ownerFrame: BindingFrame;
  order: number;
  visibility: BindingVisibility;
  flags: number;
  cell: BindingCell;
}
```

Important flags:

- `B_STATIC_KEY`: key is stable and can be indexed directly.
- `B_DYNAMIC_KEY_PENDING`: key cannot be indexed yet.
- `B_LIVE`: value is read from a live cell.
- `B_LESS_CONTEXTUAL`: source-order/start boundary matters.
- `B_EFFECTS_SCOPE`: evaluating may emit rules/declarations/mixins/functions.
- `B_EFFECTS_VALUE`: evaluating may depend on live/dynamic values.
- `B_CACHE_LOOKUP_SAFE`: binding identity can be cached for the plan.
- `B_CACHE_VALUE_SAFE`: evaluated value can be reused under a version key.

### BindingCell

The cell is the value carrier. A Less declaration and a live Sass-style binding
can share the same access shape even though their invalidation rules differ.

```ts
interface BindingCell {
  value: Node | undefined;
  prepareValue?: (value: Node | undefined) => Node;
  sourceNode?: Node;
  version: number;
  effects: number;
  cachedValue?: Node;
  cachedValueVersion?: number;
}
```

Live binding is not a separate lookup mode. It is a binding record whose cell
can change. Reads always go through the cell.

### BindingFrame

One runtime scope boundary. It owns registered records and lookup caches.

```ts
interface BindingFrame {
  parent: BindingFrame | undefined;
  fallbackFrame?: BindingFrame | undefined;
  version: number;
  lookupVersion: number;
  records: BindingStorage;
  lookupCache: BindingLookupCache;
}
```

Internally, `records` may be:

- `Map<string, BindingRecord[]>`;
- null-prototype string tables;
- split hot tables by kind;
- prototype-chain storage only if measurement proves it and semantics stay
  clear.

Externally, it is one lookup system.

## ReferencePlan

Each `Reference` should precompute as much as possible:

```ts
interface ReferencePlan {
  kind: BindingKind;
  key: string | undefined;
  keyMode: 'static' | 'dynamic' | 'array' | 'direct-index';
  targetMode: 'current-frame' | 'explicit-target' | 'direct-container';
  searchMode: 'current' | 'parent-chain' | 'fallback-chain' | 'import-surface';
  flags: number;
}
```

Static references should not normalize the same key repeatedly. Dynamic keys
produce a plan that becomes cacheable only after the key evaluates to a stable
string/array path.

## Lookup Semantics

### Less Contextual Lookup

Less semantics require source-order aware lookup. The same key can resolve to a
different declaration depending on where the reference sits.

Rules:

- Same scope uses source order and start boundary.
- Last visible matching declaration before the reference wins.
- Parent scope search ignores the child start boundary.
- Optional visibility participates only when no public match wins.
- Private/public/import visibility is a lookup-mode fact, not a post-filter.

This means a lookup cache key needs enough shape to be correct:

```ts
frameIdentity + frame.lookupVersion + kind + key + lookupMode + startBucket
```

The important optimization is that `start` should not require sorting or
scanning arbitrary nodes. A frame can store declaration records in source order
and use reverse scans or precomputed bucket positions. Later prototypes can
replace reverse scans with per-key order cursors or binary search if the
profile justifies it.

### Jess/Sass-Style Live Binding

Live binding means a reference resolves to a cell, not a copied value. If the
cell changes, later reads see the new value.

Rules:

- Live slots shadow static records according to frame topology.
- A cached lookup hit may stay valid if it points at the same live cell and the
  frame lookup version has not changed.
- Cached evaluated values must include the cell version or be rejected.
- Loop vars, mixin params, and `@arguments` are normal binding records with
  live cells.

This avoids treating Sass-style behavior as an exception layered on top of Less
lookup.

### Dynamic Names

Dynamic declaration or mixin names start as pending records. Once a dynamic name
becomes static, registration promotes it into the same binding storage.

Rules:

- Pending names make lookups for affected kind/key conservative.
- A dynamic-name promotion increments the frame lookup version.
- Ordinary static-key lookups should not repeatedly crawl pending records that
  have not changed.

### Callable Lookup

Mixin and ruleset-as-mixin lookup should use the same binding frame, but the
hit is a callable record, not an evaluated value.

Rules:

- Lookup can be cached for static callable keys and stable namespace paths.
- Candidate matching, guard evaluation, and output emission are not lookup.
- Do not cache callable output unless a later effect analysis proves it cannot
  emit scope-visible nodes and cannot depend on live state.

## Cache Layers

### Lookup Cache

Cache binding identity, not evaluated output.

```ts
type LookupCacheKey = number | string; // implementation detail

interface LookupCacheEntry {
  frameVersion: number;
  result: BindingRecord | BindingRecord[] | typeof MISS;
  flags: number;
}
```

Good cache candidates:

- static variable key in stable frame;
- parent-frame hit for an ordinary variable;
- static function key;
- static mixin key with no pending dynamic namespace ambiguity;
- stable miss when frame lookup version proves no relevant binding changed.

Bad cache candidates:

- unresolved dynamic names for the same kind;
- lookup that depends on child-surface visibility not represented in the key;
- lookup that depends on source-order `start` but has no stable start bucket;
- recursive lookup currently inside the same source node.

### Evaluated Value Cache

This is deliberately narrower.

Safe candidates:

- static scalar/list/sequence value whose dependency graph is static;
- live cell value after `prepareValue` has settled and cell version is part of
  the cache key;
- declaration value proven not to emit declarations/rules/mixins/functions.

Unsafe candidates:

- mixin or callable output;
- rules/ruleset values that can emit or register nodes;
- declaration values with same-key dependencies;
- dynamic JS functions or plugin visitors with side effects;
- values requiring parent/source metadata for public materialization.

Evaluated-value cache should be a property of `BindingCell`, not `Reference`.
The reference asks the binding for a value; the binding decides whether a
cached evaluated value is legal.

## How This Replaces Current Layers

### Current `varsByName`

Becomes static variable records in `BindingFrame.records`.

### Current `mixinsByName`

Becomes callable records in the same frame. Fast callable keys and namespace
paths use the same lookup-cache mechanism.

### Current `ScopeFrame.liveSlotsByName`

Becomes live binding records in the same frame. The cell is mutable; the lookup
path is not special.

### Current `DeclarationRegistry`

Becomes a cold compatibility/fallback surface. Ordinary variable/property
lookup should not call it. Its remaining responsibilities should be narrowed to
complex search modes that the binding frame does not yet model.

### Current `MixinRegistry`

Same direction: keep it only for complex callable searches until the binding
frame handles them. Do not let ordinary static callable lookup fall through.

## Mental Test Matrix

The design must pass these before prototype expansion:

- Same-scope Less last-wins:
  `@x: red; a: @x; @x: blue; b: @x;`
- Parent lookup:
  child reads nearest visible parent declaration.
- Same-name shadowing:
  inner `@x` hides outer `@x` for reads inside the inner frame.
- Live binding:
  loop/mixin param reads use current cell value, not the value at registration.
- Less contextual plus live binding:
  a live param named `x` shadows static `@x`, but static same-scope declarations
  still obey source order where no live slot exists.
- Dynamic declaration names:
  pending names do not cause repeated hot crawling; promotion invalidates the
  relevant frame version.
- Recursive references:
  same-source recursion detection still rejects loops.
- Import/reference visibility:
  public/optional/private/import-boundary rules are encoded in lookup mode and
  cache key.
- Detached rulesets:
  lexical parent and fallback frame remain distinct.
- Callable namespace lookup:
  static simple mixins are fast; namespace/ruleset ambiguity is represented as
  uncacheable until modeled.
- Mixin output:
  lookup may cache callable identity; output is not cached unless effect-safe.

## Prototype Plan

### Prototype 1: Variable Binding Facade

Create a `BindingFrame` facade over existing `ScopeFrame` for ordinary static
variable lookup only.

Scope:

- static string key;
- `type: variable`;
- no explicit target;
- no dynamic key;
- no callable lookup;
- preserve Less start/source-order semantics;
- preserve live cell shadowing.

Keep:

- existing tests as the behavior oracle;
- existing registries as fallback;
- no evaluated-value cache.

Success:

- ordinary static variable reference can call one lookup method;
- no `DeclarationRegistry.find(...)` on covered hot cases;
- no new node creation or traversal beyond what it deletes;
- focused reference/mixin/control/import tests pass;
- hot-path benchmark does not regress.

### Prototype 2: Lookup Cache

Add a frame-local lookup cache for covered static variable lookups.

Cache only binding hits/misses. Include frame version, key, kind, lookup mode,
and start bucket.

Success:

- repeated same-key lookups hit cache;
- dynamic-name promotion and live-slot registration invalidate correctly;
- no evaluated node reuse yet.

### Prototype 3: Callable Records

Move simple static `mixinsByName` lookup into binding records. Keep namespace
and complex callable lookup behind fallback until a separate prototype proves
those paths.

### Prototype 4: Evaluated Value Cache

Only after lookup caching is correct, add effect-gated evaluated-value caching
on `BindingCell` for static values.

## Rejection Criteria

Reject or reshape the design if:

- it adds side maps or record objects that show up as net runtime overhead;
- it makes live binding a special branch outside the binding model;
- it requires copying source nodes for lookup correctness;
- it caches evaluated rules/mixin output without effect proof;
- it hides Less source-order behavior behind a generic "latest value" cache;
- it makes import/reference visibility harder to reason about than today.

## Open Implementation Questions

- Use `Map`, null-prototype objects, split arrays, or generated numeric key ids
  for hot storage?
- Can static references receive a numeric `planId` during parse/registration?
- What is the cheapest correct `startBucket` for Less source-order lookup?
- Can dynamic-name pending records track affected keys precisely enough to
  avoid broad invalidation?
- Which effect flags can be computed at parse/adoption time, and which require
  lazy evaluation?

## Recommendation

Prototype the `BindingFrame` facade for ordinary static variable lookup first.
It attacks the hottest safe surface without committing to a large rewrite. If
that passes behavior and benchmark gates, expand the same system outward to
lookup caching, simple callable records, and finally effect-gated evaluated
value caching.

Do not add a separate `Reference` cache. The cache belongs to the binding
system, because the binding system owns the semantic facts needed to invalidate
it.
