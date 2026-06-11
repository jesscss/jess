# Binding Index Implementation Spec

This is the implementation spec for a coherent reference lookup, binding, and
cache model. Early sections still record prototype hypotheses and measurements,
but the direction is no longer "maybe add another helper beside the old
systems." The end state is one binding system with hot simple paths that do not
fall through a ladder of adjacent lookup mechanisms.

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

## End-State Rule

Transitional bridges are allowed only to land behavior safely. They are not
architecture.

Every bridge to the old lookup shape must have:

- a named scope, such as dynamic names, complex callable namespace lookup,
  import/reference visibility, or unmodeled public materialization;
- a deletion condition that says which binding-frame capability replaces it;
- focused tests proving the covered simple path no longer enters the bridge;
- a benchmark/profile note when the bridge is still on a measured hot path.

By the end of this binding-index lane, ordinary static-key reads and writes
must not execute fallback ladders. The desired hot path is:

```ts
const slot = frame.lookupVariableSlot(plan);
if (slot >= 0) return frame.readSlot(slot);
```

Not:

```ts
lookup frame
  ?? lookup live slots
  ?? scan declaration buckets
  ?? search Rules.find
  ?? search registry
  ?? materialize source declaration
```

Fallback is acceptable only for cases the binding frame has not modeled yet.
Once a case is modeled, the fallback branch for that case is deleted, not left
as a "safe" second chance.

## Goals

- Make ordinary Less variable/property/callable lookup as close as possible to:
  `binding = frame.lookup(plan)`.
- Preserve both supported semantics:
  - Less contextual lookup: source-order aware, last matching declaration wins.
  - Jess/Sass-style live binding: ordinary reads see the current binding cell,
    including later same-rules declarations and assignment writes, while
    explicit snapshot/contextual reads keep source-order behavior.
- Cache lookup identity before caching evaluated values.
- Treat evaluated-value caching as a narrow optimization gated by effect and
  dependency facts.
- Keep one canonical source tree. Do not solve lookup speed by copying nodes.
- Avoid new hot-path objects, `Set`s, array conversions, sorts, closures,
  recursive rediscovery, and generic registries for ordinary static-key reads.
- Remove transitional fallback branches from every simple path once its
  binding-frame replacement lands.

## Non-Goals

- Do not implement a broad public materialization cache.
- Do not cache mixin/rules output merely because lookup found the same callable.
- Do not hide existing import, visibility, or placement semantics behind a
  generic side map.
- Do not pick `Map` vs null-prototype object by taste. That is a measured
  storage decision after the semantic model is correct.
- Do not keep dual lookup systems permanently in the name of compatibility.
  Compatibility bridges must shrink as the binding frame gains coverage.

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

During migration, a frame lookup may return `UNCOVERED` for a cold/complex
case. That sentinel may route to an old registry path temporarily. A covered
simple miss must return `MISS` and stop. It must not try broad fallback search
just in case.

## Binding Concepts

The interfaces below are the semantic contract. They are not permission to put
one object per binding or one object per lookup on the hot path.

The hot implementation target is `frame + slot`, where the slot is an integer
index into compact tables. A `BindingRecord` object may be materialized for
debugging, compatibility, tests, or cold fallback paths, but ordinary
registration and reference lookup should not require it.

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
- `B_CONTEXTUAL_READ`: lookup must use source-order occurrence position instead
  of the key's current cell pointer.
- `B_ASSIGNMENT_TARGET`: write mutates an existing scoped binding instead of
  appending a shadow declaration.
- `B_LESS_CONTEXTUAL`: source-order/start boundary matters.
- `B_EFFECTS_SCOPE`: evaluating may emit rules/declarations/mixins/functions.
- `B_EFFECTS_VALUE`: evaluating may depend on live/dynamic values.
- `B_CACHE_LOOKUP_SAFE`: binding identity can be cached for the plan.
- `B_CACHE_VALUE_SAFE`: evaluated value can be reused under a version key.

Hot storage should treat this as a virtual record:

```ts
record.kind      -> frame.slotKind[slot]
record.key       -> key table entry
record.source    -> frame.slotSource[slot]
record.order     -> frame.slotOrder[slot]
record.flags     -> frame.slotFlags[slot]
record.cell      -> frame slot value/version arrays
```

The fast lookup result is not `{ record }`; it is a slot id or sentinel.

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

Important correction: "live" is not only for loop vars, mixin params, or
`@arguments`. Jess also supports same-rules live reads:

```scss
$x: red;
a: $x;  // blue
b: $!x; // red
$x: blue;
```

That requires binding identity to be separate from declaration occurrence:

- `$x` is a current-cell read. It resolves to the key's current binding cell in
  the active frame chain.
- `$!x` is a contextual/snapshot read. It resolves by declaration occurrence and
  source position, so later same-frame writes/declarations do not change it.
- `:` appends a declaration occurrence. In the same frame, it also updates the
  key's current-cell pointer for ordinary live reads in that frame.
- `:=` does not append a shadow occurrence. It resolves the current scoped
  binding target and mutates that target cell.

So a frame needs two cheap views of the same slots:

- ordered occurrence slots for source-order/contextual lookup;
- current-cell slot per key for live/current lookup and assignment target
  resolution.

Static immutable declarations do not need full cell objects if split arrays are
faster. Live bindings need mutable value/version storage; static declarations
can use direct `slotValue`, `slotSource`, `slotFlags`, and `slotVersion`
entries.

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

## Hot Layout Hypotheses

The prototype should refine these hypotheses with numbers. The spec requires
the constraints; the harness decides which representation V8 actually likes.

### H1: Slot Tables Beat Record Objects

Expected fastest shape:

```ts
type BindingSlot = number;

interface BindingFrameHot {
  parent: BindingFrameHot | undefined;
  fallbackFrame?: BindingFrameHot | undefined;
  lookupVersion: number;
  slotCount: number;

  variableSlots: BindingNameTable;
  callableSlots: BindingNameTable;
  functionSlots: BindingNameTable;

  slotKind: number[];
  slotFlags: number[];
  slotOrder: number[];
  slotVersion: number[];
  slotValue: unknown[];
  slotSource: unknown[];

  liveValue: unknown[];
  livePrepare: unknown[];
  liveVersion: number[];
}
```

The covered hot read should be:

```ts
const slot = lookupVariableSlot(frame, key, startOrder);
if (slot >= 0) return frame.slotValue[slot];
```

No `{ frame, slot }`, `{ result }`, `BindingRecord`, or `BindingCell` object is
allocated for a normal read.

### H2: Writes Are Append-Only Slot Writes

Static registration should do only:

1. normalize kind/key once;
2. allocate `slot = slotCount++`;
3. write parallel slot arrays;
4. append the slot id to the key table;
5. update the key's current-cell pointer when the declaration participates in
   live/current reads for that frame;
6. increment `lookupVersion` only when lookup identity changes.

Live value updates should increment the slot/cell version, not the whole frame
lookup version, unless the binding appears, disappears, or changes precedence.
This keeps lookup caches valid across ordinary live value writes while still
invalidating evaluated-value caches.

Assignment writes (`:=`) are value updates to an existing resolved cell. They
increment that cell's value version, but not the frame lookup version unless the
write also changes binding identity. Shadow declarations (`:`) append an
occurrence and can change the frame/key current pointer, so they invalidate the
frame/key lookup identity for current reads.

### H3: Explicit Scope Loops Beat Prototype Scope Magic

Parent and fallback lookup should be simple loops over frames:

```ts
let f: BindingFrameHot | undefined = startFrame;
let start = startOrder;
while (f) {
  const slot = lookupLocalVariableSlot(f, key, start);
  if (slot >= 0) return readSlotValue(f, slot);
  start = NO_START_LIMIT;
  f = f.parent;
}
```

Prototype-chain storage may be tested later, but explicit frame walking is the
first hypothesis because it keeps Less source-order boundaries, import
visibility, fallback frames, and live binding invalidation legible.

### H4: Name Tables Must Be Measured

The prototype should compare:

1. `Map<string, number | number[]>`;
2. `Object.create(null)` string tables;
3. numeric key ids into arrays;
4. hybrid numeric ids for parser-known static keys plus object tables for cold
   dynamic keys.

The likely winner may differ by scope size. The implementation may use one
layout for small frames and another for broad benchmark/global frames, but only
if the branch to choose layout does not become its own hot-path tax.

### H5: Encoded Cache Results Beat Cache Entry Objects

Lookup cache entries should try to encode hit/miss state as integers:

```ts
const MISS = -1;
const UNCACHEABLE = -2;
const encoded = (frameId << SLOT_BITS) | slot;
```

Use object cache entries only for cold complex callable arrays or debug paths.

### Shape Rules

Prototype and implementation should avoid:

- adding optional properties after frame construction;
- mixing numbers and objects in the same hot array;
- returning different shapes from the same lookup function;
- allocating closures in lookup/read/write loops;
- `try/catch` for expected misses;
- `Set`, spread, `filter`, `sort`, or array materialization for ordinary reads.

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

Live binding means an ordinary reference resolves to a current cell, not a
copied value or source-order snapshot. If the current cell changes, reads that
point at that cell see the new value.

Rules:

- Live/current reads (`$x`) use the current-cell pointer for the key in the
  active frame chain.
- Contextual/snapshot reads (`$!x`) use source-order occurrence lookup and
  ignore later same-frame current-cell changes.
- Same-frame `:` declarations append an occurrence and update the frame/key
  current-cell pointer for ordinary live reads.
- Nested `:` declarations shadow in the child frame only.
- `:=` resolves the current scoped binding target and mutates that target cell;
  it does not create a child-frame shadow.
- Live slots shadow static records according to frame topology because they are
  current-cell records, not a separate lookup path.
- A cached lookup hit may stay valid if it points at the same live cell and the
  frame lookup version has not changed.
- Cached evaluated values must include the cell version or be rejected.
- Loop vars, mixin params, and `@arguments` are normal binding records with
  live cells.

This avoids treating Sass-style behavior as an exception layered on top of Less
lookup.

Example:

```scss
$x: red;
$y: black;
& {
  $x := blue; // mutate currently scoped $x
  $y: white; // shadow only inside this nested frame
}
a: $x; // blue
b: $y; // black
```

The binding frame must therefore support three operations without branching
through unrelated registries:

1. `lookupCurrent(key, kind)`: read the current cell for `$x`.
2. `lookupOccurrence(key, kind, start)`: read the source-order occurrence for
   `$!x` and Less contextual lookup.
3. `lookupAssignmentTarget(key, kind)`: find the cell that `:=` mutates.

The prototype must define the miss behavior for `:=` explicitly from Jess/Sass
semantics instead of inventing it in `Reference`.

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

- static variable key in stable frame when the read mode is part of the key;
- parent-frame hit for an ordinary variable;
- static function key;
- static mixin key with no pending dynamic namespace ambiguity;
- stable miss when frame lookup version proves no relevant binding changed.

Bad cache candidates:

- unresolved dynamic names for the same kind;
- lookup that depends on child-surface visibility not represented in the key;
- lookup that depends on source-order `start` but has no stable start bucket;
- current-cell lookup whose frame/key current pointer can change without an
  encoded version;
- recursive lookup currently inside the same source node.

### Evaluated Value Cache

This is deliberately narrower.

Safe candidates:

- static scalar/list/sequence value whose dependency graph is static;
- live cell value after `prepareValue` has settled and cell version is part of
  the cache key;
- current-cell reads where both binding identity version and cell value version
  are represented in the cache key;
- snapshot/contextual reads where the occurrence slot and source-order start
  bucket are represented in the cache key;
- declaration value proven not to emit declarations/rules/mixins/functions.

Unsafe candidates:

- mixin or callable output;
- rules/ruleset values that can emit or register nodes;
- declaration values with same-key dependencies;
- live/current reads after same-frame `:` changes unless the current-pointer
  version is part of the key;
- dynamic JS functions or plugin visitors with side effects;
- values requiring parent/source metadata for public materialization.

Evaluated-value cache should be a property of `BindingCell`, not `Reference`.
The reference asks the binding for a value; the binding decides whether a
cached evaluated value is legal.

## How This Replaces Current Layers

### Current `varsByName`

Becomes static variable records in `BindingFrame.records`.

Deletion condition: once variable records carry occurrence order, current-cell
identity, source-position reads, and assignment targets, `Reference` must stop
returning source `VarDeclaration` nodes for covered static variable reads.
`varsByName` may remain as construction input only if it is not queried by hot
reference lookup.

### Current `mixinsByName`

Becomes callable records in the same frame. Fast callable keys and namespace
paths use the same lookup-cache mechanism.

Deletion condition: once simple callable records are modeled, static simple
mixin/function lookup must not fall through `MixinRegistry`/`Rules.find(...)`.
Namespace, guards, and callable ambiguity may stay behind an explicit
`UNCOVERED` bridge until modeled.

Current implementation note:

- Static callable hit prototype is in production for already-built frames:
  `ScopeFrame` carries `callableBucketsByName`, pointing at the already-built
  `Rules.mixinsByName` arrays. Covered static `Mixin` and simple
  `Ruleset`-as-mixin hits skip `Rules.findMixinsFast(...)` when lookup already
  has a frame chain to ask.
- This is intentionally not a new wrapper-record allocation. The bucket entry
  is the record surface for this slice.
- Static callable misses are not complete. They still route to
  `Rules.findMixinsFast(...)` because child-surface and import/reference
  visibility are not yet represented in frame state. The next callable binding
  pass must carry those surface facts on the frame or an attached placement
  surface so a modeled miss can return `MISS` and stop.
- Do not call `getScopeFrame(...)` inside callable lookup just to try this
  shortcut. That creates declaration bucket state for a speculative callable
  lookup. The next step is construction/adoption-time callable surface coverage,
  not lazy allocation in `Rules.find(...)`.
- Do not add a lookup cache to paper over that bridge. Delete the reason for
  rediscovery by making the frame know which callable surfaces it covers.

### Former current-read split: `ScopeFrame.liveSlotsByName` plus buckets

Production status: ordinary current reads now use
`ScopeFrame.currentBindingsByName`, with one current entry shape for live cells
and latest static declaration entries. Static current entries point at the
existing declaration bucket `BindingEntry`; live entries are published when
mixin params, `@arguments`, loop vars, or direct loop mutation cells are
created. `$!` and other source-order reads still use
`declarationBucketsByName` because they need ordered declaration history.

Production follow-up: `lookupRuntimeVarBinding(...)` has been deleted.
Target/interpolated variable fallback and unquoted index fallback now use the
same `lookupScopeFrameVariable(...)` facade with `includeDeclarations: false`
when they need live-only cells.

Remaining deletion condition: `liveSlotsByName` can stop being a lookup-facing
surface once direct declaration/property bridge code also reads live
declaration-shaped cells through the binding facade or is deleted with the
registry bridge.

### Current `DeclarationRegistry`

Becomes a cold compatibility/fallback surface. Ordinary variable/property
lookup should not call it. Its remaining responsibilities should be narrowed to
complex search modes that the binding frame does not yet model.

Deletion condition: every time a complex declaration lookup mode is represented
in `BindingFrame`, delete the corresponding registry fallback branch from
`Reference`/`Rules.find(...)` for that mode. Do not keep both paths active for
covered inputs.

### Former `MixinRegistry`

The callable registry bridge has been deleted for mixins. The remaining
callable debt is not "fall through to `MixinRegistry`"; it is direct-crawl
bridge logic for namespace/import/child-surface/candidate cases that the
binding frame does not yet model.

Deletion condition for the remaining bridge logic: modeled callable paths
return hit/miss from binding frame or binding handle state. Only unmodeled
callable namespace, import visibility, guard/candidate, or child-surface facts
may return `UNCOVERED` and reach direct crawl/candidate code.

June 2026 status: the simple callable-record path is now production-owned for
covered registryless callable lookup. The legacy callable registry branches,
`MixinRegistry` shim, and generic `Rules.find('mixin', ...)` wrapper are gone.
New callable work should model facts on frames/handles instead of restoring
stringly registry dispatch.

## Transitional Bridge Ledger

The bridge ledger is part of the implementation contract. Any production
fallback must appear here or in `HANDOFF.md` before it is accepted.

| Bridge | Allowed Scope | Deletion Condition |
| --- | --- | --- |
| `Reference.lookupVariableReference(...)` facade miss to `findVarDeclarationFast(...)` | explicit targets, interpolated keys, still-dynamic names, and other declaration modes not yet represented by binding handles/slots | delete per covered mode once static declaration records cover the mode and tests prove hits/misses do not enter the helper ladder |
| `Rules.find('declaration', ...)` / `DeclarationRegistry` | declaration/property modes, dynamic names, import/reference visibility, complex source-order modes not yet encoded in frame lookup | delete per mode as soon as frame lookup encodes that mode and tests prove covered hits/misses do not enter registry search |
| `Rules.find('function', ...)` / `FunctionRegistry` | function lookup modes not yet encoded as callable/binding records | delete simple static function fallback once function records cover exact static keys and focused tests prove hits/misses do not enter `FunctionRegistry.find(...)` |
| Callable direct-crawl bridge after registryless mixin deletion | callable namespace, guard/candidate matching, import visibility, and child-surface facts not yet encoded in frame/handle state | delete per modeled path once binding state can return callable hit/miss or explicit `UNCOVERED`; do not restore `MixinRegistry` or stringly `Rules.find('mixin', ...)` |
| Public materialization from source declaration nodes | cold public `eval/resolve` API compatibility and unmodeled ownership boundaries | delete from render/eval hot paths once binding values can render directly and public materialization is isolated |

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
- Jess same-rules current read:
  `$x: red; a: $x; b: $!x; $x: blue;` renders `a` from blue and `b` from red.
- Jess assignment versus shadow:
  `$x: red; $y: black; & { $x := blue; $y: white; } a: $x; b: $y;` renders
  outer `a` from blue and outer `b` from black.
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

## Implementation Plan

### Step 1: Variable Binding Facade

Before touching production lookup, run the standalone hot-layout harness:

```sh
pnpm run prototype:binding-frame-layout
```

The harness compares:

- slot arrays behind `Map<string, slot | slot[]>`;
- slot arrays behind `Object.create(null)`;
- slot arrays behind numeric key ids;
- record objects behind `Map<string, record | record[]>`.

It simulates:

- append-only static registration writes;
- live slot registration and live value updates;
- same-frame current-cell pointer updates;
- contextual/snapshot occurrence reads;
- assignment-target writes that mutate an existing scoped cell;
- same-key Less source-order lookup;
- explicit parent-frame scope walks;
- repeated reads across a leaf frame.

Step 1 for production creates a `BindingFrame` facade over existing
`ScopeFrame` for ordinary static variable lookup only, using the winning
hot-layout direction from the harness as the target shape.

Scope:

- static string key;
- `type: variable`;
- no explicit target;
- no dynamic key;
- no callable lookup;
- preserve Less start/source-order semantics;
- preserve same-frame current-cell reads;
- preserve `$!` snapshot/contextual reads;
- preserve `:=` assignment target mutation versus `:` shadowing.

Keep:

- existing tests as the behavior oracle;
- existing registries as temporary bridges for unmodeled cases only;
- no evaluated-value cache.

Success:

- ordinary static variable reference can call one lookup method;
- no `DeclarationRegistry.find(...)` on covered hot cases;
- covered simple misses stop at the binding frame instead of falling through
  broad fallback search;
- no new node creation or traversal beyond what it deletes;
- focused reference/mixin/control/import tests pass;
- hot-path benchmark does not regress.

### Step 2: Declaration-Bucket Binding Identity

Make declaration-bucket variable hits return binding/value identity directly.
This removes the current bridge where `Reference` receives a source
`VarDeclaration` node and then re-enters declaration finalization.

Success:

- covered static variable hits return binding identity, not source declaration
  nodes;
- `:=` writes mutate the resolved binding cell without also mutating the source
  declaration except where a cold compatibility API explicitly requires it;
- render/eval of covered variable reads does not call declaration registry or
  declaration-node finalization;
- source declarations remain canonical and un-reparented;
- old fallback branches are deleted for the covered path in the same pass.

### Step 3: Lookup Cache

Rejected as a standalone layer for now. The failed prototype cached binding
identity after the lookup had already reached a cheap binding facade, so it
added branch/object work without removing the real rediscovery problem.

The next cache-like work must be part of binding handles, not a second
`Reference` or `ScopeFrame` side cache. A repeated reference should carry or
recover a binding handle that already knows frame/version, reference shape, key
kind, and resolved identity.

Success:

- repeated same-key/path lookups do not rediscover binding facts;
- dynamic-name promotion and live-slot registration invalidate correctly;
- no evaluated node reuse until effect flags prove it is safe.

Prototype status: `scripts/prototype-binding-handle-reuse.mjs` models the
non-cache version of that reuse. A handle carries scope version, original path
array identity, target scope, declaration name, and the binding cell. It does
not cache evaluated values, rendered text, mixin output, or public
materialized nodes.

Evidence: the default run (`pnpm run prototype:binding-handle-reuse`) reduced
`500,000` repeated `.a .b .c[color-1]` references from `1,500,000` path
segment lookups and `500,000` declaration lookups to `3` path segment lookups
and `1` declaration lookup; median time moved from `12.149ms` to `3.521ms`
(`28.99%` ratio). A smaller `50,000` reference run kept the signal at
`1.145ms` to `0.354ms` (`30.88%` ratio).

Production status: the first narrow callable handle is wired on `Reference`
for static, non-targeted `mixin` / `mixin-ruleset` lookups with string or
preserved string-array keys. It carries the target `Rules`, target
`lookupVersion`, original key identity, lookup type, call-state bits, and the
resolved lookup result identity. It intentionally does not cache evaluated
values, rendered text, mixin output, or public materialized nodes. A focused
reference test proves the second evaluation of the same static array-path
callable reference skips `Rules.findMixin(...)`, and a later target
`Rules.registerNode(...)` bump invalidates the handle.

Remaining production work: declaration/property terminal binding handles,
function records, live/static slot unification, and callable
namespace/import/child-surface facts are still separate queue items.

### Step 4: Callable Records

Move simple static `mixinsByName` lookup into binding records. Keep namespace
and complex callable lookup behind fallback until a separate prototype proves
those paths.

Success:

- simple direct static callable hits return from the current binding frame when
  that frame already exists;
- simple direct static callable misses stop only when the current frame can
  prove it has no child callable surfaces and no reference-import callable
  surfaces;
- targeted, namespace, local/import-visibility, child-surface, and guard
  ambiguity paths return `UNCOVERED` until those facts are represented in
  binding state;
- the shortcut must not call `getScopeFrame(...)`, allocate empty bucket
  sentinels, allocate wrapper callable records, cache callable output, or walk
  ancestor nodes just to attempt a hit/miss.

### Step 1A: Current Hot Layout Harness Result

The harness now asserts the semantic split before timing any layout variant:

- current-cell read sees the latest same-frame declaration;
- occurrence/snapshot read sees the source-order prior declaration;
- assignment write mutates the currently scoped parent cell;
- child `:` declaration shadows locally without mutating the parent cell.

Current harness results on Node `v24.11.1` / Darwin arm64:

Default shape:

```text
frames=6 keys=192 declarations/frame=768 reads=1000000 writes=100000
map-slot-arrays          read median=11.04ms write+read median=1.77ms
null-proto-slot-arrays   read median=16.49ms write+read median=2.74ms
numeric-key-from-string  read median=32.09ms write+read median=5.81ms
numeric-key-planned-id   read median=13.58ms write+read median=2.34ms
record-objects-map       read median=14.97ms write+read median=2.17ms
```

Small-frame shape:

```text
frames=3 keys=48 declarations/frame=192 reads=1000000 writes=100000
map-slot-arrays          read median=13.13ms write+read median=1.76ms
null-proto-slot-arrays   read median=17.74ms write+read median=2.85ms
numeric-key-from-string  read median=32.82ms write+read median=5.54ms
numeric-key-planned-id   read median=17.21ms write+read median=2.47ms
record-objects-map       read median=15.56ms write+read median=1.90ms
```

Large-frame shape:

```text
frames=10 keys=512 declarations/frame=2048 reads=1000000 writes=100000
map-slot-arrays          read median=16.77ms write+read median=2.49ms
null-proto-slot-arrays   read median=17.21ms write+read median=3.39ms
numeric-key-from-string  read median=34.60ms write+read median=7.15ms
numeric-key-planned-id   read median=12.87ms write+read median=2.47ms
record-objects-map       read median=17.41ms write+read median=2.65ms
```

Initial conclusions:

- slot arrays beat record objects in all measured shapes;
- null-prototype tables did not win this harness;
- numeric ids are only viable if the reference already carries the id;
  converting string keys on every read is catastrophic;
- `Map` slot arrays are the safest first production prototype target for
  string-key references;
- planned numeric ids win the large-frame read shape only when the reference
  already carries the numeric id;
- converting string keys to numeric ids on every read remains catastrophic;
- planned numeric ids are worth a later parser/registration prototype, but not
  as a prerequisite for the first binding facade.
- the harness now proves the core current/occurrence/assignment split, but it
  is still not production Jess behavior proof until a facade runs against real
  reference tests.

These are prototype numbers, not production Jess speed claims.

Prototype self-prosecution:

- New traversal: the harness uses explicit loops to model candidate scope walks
  and slot scans. Assignment lookup adds the same parent-frame loop shape as
  current reads. It does not add traversal to production eval/render.
- New maps/arrays/objects: the harness intentionally compares `Map`,
  null-prototype objects, numeric key arrays, slot arrays, and record objects.
  It now adds one current-slot pointer table per frame so live/current lookup
  does not scan occurrence arrays. These are measured candidates, not accepted
  runtime machinery.
- Render path: untouched. The prototype does not evaluate or stringify nodes.
- Metadata mutations: none in production. Live writes in the harness mutate
  numeric/value slots only to model Jess/Sass-style live binding and `:=`
  assignment.
- Evidence boundary: harness numbers only rank prototype storage shapes. They
  do not claim Jess benchmark improvement.

### Step 5: Evaluated Value Cache

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
