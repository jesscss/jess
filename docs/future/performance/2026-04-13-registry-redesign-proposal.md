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
- [pre-eval-elimination.md](/Users/matthew/git/oss/jess/docs/future/pre-eval-elimination.md) — later architecture slice; the render model here is the prerequisite

---

## The Problem In Plain English

Compiling Less is supposed to be simple: read a stylesheet, resolve variable
references, compose selectors, produce CSS. Instead the current runtime does
something much more complicated, and it is slow because of that complexity.

The benchmark shows the most time is spent in variable lookup for a handful of
names (`base-hue`, `cols`, `i`, `n`) that are referenced thousands of times.
Each lookup creates temporary objects, indexes pending items, converts sets to
arrays, sorts, and recurses through child nodes. None of that work is necessary.

The root cause is not a missing optimization. It is a fundamentally wrong
architecture. This document describes what that wrong architecture is, what the
right one looks like, and how to get there.

---

## The Root Cause: Nodes Do Too Many Jobs

Every node in the current system plays three roles simultaneously:

1. **Template** — it describes the structure of the source stylesheet
2. **Lookup engine** — during evaluation, `Rules.find(...)` traverses the node
   graph to resolve variable references
3. **Result container** — after evaluation, the node holds its own evaluated
   output, which `toTrimmedString()` later reads to produce CSS

These three roles fight each other.

**The result-container role causes cloning.** When a mixin is called from two
different places, the mixin body node needs to produce two different outputs.
Because the output is stored on the node, two calls need two separate nodes.
So the runtime deep-clones the mixin body for every call site.

**The lookup-engine role causes the fork system.** After cloning a mixin body,
the clone's parent pointers point to the wrong place — the definition site, not
the call site. The call site might have variables that the mixin body needs to
see. So the runtime uses a `renderKey` system to rewrite the clone's apparent
parent chain, making variable lookup traverse the call-site scope instead. This
is the "fork" system.

**The generic registry is what makes lookup expensive.** Because any `Rules`
node can be a lookup target, and because lookup must traverse parent chains, the
registry system is a general-purpose graph search engine. It allocates `Set`s,
flushes pending items, converts to arrays, sorts, and recurses — for every
single variable reference.

All of this complexity exists to patch around nodes doing too many jobs. The fix
is to separate the roles.

---

## The Key Insight: Serialization IS Evaluation

The current system has two separate passes:

```
pass 1 — eval:    walk the (cloned) node tree, resolve references,
                  store results back onto the cloned nodes

pass 2 — serialize: walk the (cloned) node tree again, read stored
                    results, build the CSS output string
```

This is why nodes need to be result containers. If you separate eval from
serialization, you need somewhere to put the results between passes. Nodes are
convenient, so results go on nodes. But then you need clones so two invocations
do not overwrite each other.

**The fix: collapse both passes into one.**

```
one pass — render:  walk the node tree (as a read-only template),
                  resolve references on the fly against a binding frame,
                  write output directly to an output buffer
```

Nothing is stored on the node. The node is just a description of what to render.
Two invocations of the same mixin body walk the same template with different
binding frames and write to different positions in the output buffer. No
intermediate storage. No clone needed.

```
render(node, ctx) → void   // writes directly to ctx.outputBuffer
resolve(node, ctx) → Node  // value-returning: resolves without writing
```

Where `ctx` carries:
- the active **binding frame** (where variable values live)
- the current **selector context** (what selector prefix this output belongs to)
- the **output buffer** (where CSS output goes)

### Selector Bitset Guardrail

`attachSelectorBitLibrary(...)` is a transitional helper, not target
architecture.

If selector bitsets are designed correctly, selector nodes should usually pick
up their `keySetLibrary` automatically from parent/source/tree context as they
are adopted into the canonical tree or evaluated in context. Needing to
manually reattach selector bit libraries after `copy()` / `create()` is a sign
that some selector fragments are still being used in a detached state before
normal context inheritance has re-established itself.

Do not treat `attachSelectorBitLibrary(...)` as a pattern to expand. It is
acceptable as a temporary bridge in existing selector/extend utilities, but the
long-term goal is to reduce or eliminate these manual reattachment points as
selector construction becomes more contextual and less detached.

### Important Guardrail: No Whole Evaluated Tree

The target is **not** "skip evaluated nodes entirely and print strings straight
from source nodes." There is still a useful semantic boundary between:

1. evaluating a source node in context
2. producing the immediate evaluated/derived node for that one step
3. allowing a visitor or rewrite hook to replace that node
4. serializing the result immediately into the output buffer

What goes away is the **retained full evaluated tree**.

The runtime should not:

- evaluate the whole stylesheet into a second AST
- store per-placement eval results back onto shared source nodes
- keep evaluated nodes alive longer than the local render step requires, unless
  a deferred structure truly needs them

So the long-term shape is:

```ts
source node -> evaluated/derived node -> optional visitor/replace -> serialize now
```

not:

```ts
source tree -> full evaluated tree -> serialize later
```

This distinction matters because Track 5 should preserve a real node boundary
for future visitors/transforms while still eliminating the architectural cost of
building and retaining a second tree.

---

## How Scope Works: Frame Chain vs Node Parent Chain

The current system resolves variable references by walking the **node parent
chain**. When `@color` is referenced inside a mixin body, the runtime walks
from the reference node up through its parents until it finds a `Rules` node
that has `@color` registered.

This is why clones need their parent chains rewritten (the fork system) — the
clone's natural parent chain points to the definition site, not the call site.

**The fix: resolve references by walking the frame chain instead.**

A `ScopeFrame` is a small runtime object associated with the currently active
scope. It holds the variable bindings that are live right now. Frames form a
chain: each frame has a `parent` pointing to the enclosing scope's frame.

When a mixin is invoked from a call site:

1. A new frame is created for the invocation, with the param values in it
2. Its `parent` is set to the **call site's frame** — not the mixin's
   definition site's node parent
3. The mixin body template is walked with this frame as `evalCtx.frame`
4. Variable lookup walks the frame chain: check current frame, then
   `frame.parent`, then `frame.parent.parent`, and so on

```
.a {
  @color: blue;
  .mixin();         ← call site
}

evalCtx.frame for the .mixin() invocation:
  liveSlots: {}     ← no params
  parent: .a's frame {
    decls: { 'color': blue }
    parent: root frame {
      decls: { 'color': red }   ← @color: red at the top level
    }
  }
```

`@color` lookup inside the mixin body:
- check invocation frame → miss
- check `.a`'s frame → found: `blue` ✓

The mixin body node's `.parent` pointer is never consulted. It is document
structure, not runtime scope. Those are different things.

### One Lookup Algorithm, Multiple Surfaces

The redesign is about **storage** and **lookup surfaces**, not about inventing
separate lookup algorithms per reference type.

A `Reference` should follow one shared search shape:

1. resolve `target` and `key`
2. choose the resolution mode (`contextual` or `live`)
3. walk the active lookup surfaces in the correct order
4. ask the type-specific surface adapter whether a match exists
5. return the matched binding/node and continue normal evaluation

What varies by reference type is only:

- which surface is queried (`declarationBucketsByName`, `liveSlotsByName`,
  callable mixin surface, function surface, etc.)
- which node kinds are accepted
- how the resolved match is turned back into a value

What should **not** vary radically by type:

- scope-walk order
- caller/source fallback behavior
- retry ownership
- whether lookup itself becomes a scheduler

This means the long-term shape is:

- one shared lookup walk in `Reference`
- small type-specific adapters for variable/property/declaration/function/callable lookup
- runtime bindings treated as a general lookup surface, not a variable-only special case

Today `liveSlotsByName` carries mixin params / loop vars as value bindings.
Future callable runtime bindings, if they are needed, should participate
through the same runtime-surface idea rather than by adding more ad hoc
lookup branches to `Reference`.

### `&` Is A Live Selector Binding

`&` should be thought of as a **live contextual binding**, not as cached
selector state on the node.

It is analogous to a live variable reference:

- ordinary live variable binding source: `frame.liveSlotsByName`
- `&` binding source: the current live selector context / parent ruleset selector

That selector binding is special only in *what* it reads, not in *how* it
should be modeled. The important consequences are:

- the canonical `Ampersand` node should keep only the authored shape
- the current parent selector should come from live context, not be written
  onto the canonical source node
- `&` must resolve against the **current** selector view, because extends can
  change the effective parent selector later
- any evaluated/derived node used for an `&` expansion should be short-lived
  and local to the current eval/render step

So if the runtime needs to remember "what selector does `&` currently mean?",
that belongs in captured live context or a local derived node, not in persistent
AST node state.

---

## Why Forks Disappear

Forks exist because the runtime needs to make the same node "see" different
parent chains in different invocation contexts. Once lookup uses the frame chain
instead of the node parent chain, there is nothing left to fork.

The same mixin body template is walked with different `evalCtx` values:

```
.a { .mixin(blue); }   → evalCtx.frame has @color=blue, parent=.a's frame
.b { .mixin(green); }  → evalCtx.frame has @color=green, parent=.b's frame
```

Both walks read from the same template nodes. Both write output to the same
`outputBuffer` (in sequence). No clone. No fork. No renderKey machinery.

The `renderKey` / fork system becomes unnecessary entirely.

---

## The Runtime Model

### EvalContext

Passed through every `render` call. Carries everything the current invocation
needs.

```ts
type EvalContext = {
  frame: ScopeFrame;           // active binding frame — where variables live
  selectorContext: Selector[];  // selector prefix stack from outermost rule inward
  outputBuffer: OutputBuffer;   // where CSS output is written
  leaky: boolean;               // whether this invocation exports bindings to caller
};
```

### ScopeFrame

One per active scope. Forms a chain representing the lexical scope at the
current call site.

```ts
type BindingCell = {
  value: Node;          // current value — updated in place for live bindings
  sourceNode?: Node;    // back-pointer to canonical AST node (for recursion guard)
  readonly?: boolean;
};

type BindingEntry = {
  cell: BindingCell;
  sourceNode: Node;     // the VarDeclaration or Declaration in Rules.value
};

type ScopeFrame = {
  parent: ScopeFrame | undefined;

  // Live binding cells — mixin params, loop counters
  // Direct slot read: liveSlotsByName.get(name)
  liveSlotsByName: Map<string, BindingCell>;

  // Contextual variable/declaration lookup — Less @var, Jess $var
  // Last entry in the array wins (Less "last definition wins" semantics)
  declarationBucketsByName: Map<string, BindingEntry[]>;

  // CSS property lookup
  propertyBucketsByName: Map<string, BindingEntry[]>;

  // Function lookup
  functionBucketsByName: Map<string, FuncEntry[]>;

  // Mixin / ruleset callable lookup
  mixinBucketsByStartKey: Map<string, CallableEntry[]>;

  readonly: boolean;
  importMode: ImportMode;
  visibilityMode: VisibilityMode;

  rulesNode: Rules;     // back-pointer to canonical node
};
```

### OutputBuffer

#### The zero-extend fast path

In practice, most stylesheets have few or zero extends and no `@import
(reference)`. Allocating typed segment objects for every ruleset would add
overhead on exactly the workloads where it buys nothing.

The solution: **flag-gated buffer mode**. During `_indexRules` — which already
walks every node — set flags on the root `Rules`:

```ts
_hasExtends: boolean        // any Extend node found during indexing
_hasReferenceImports: boolean  // any @import (reference) resolved into this root
```

At render startup, choose the buffer mode once:

```ts
type RenderBuffer =
  | { kind: 'flat';      parts: string[] }      // common case — no extends, no reference imports
  | { kind: 'segmented'; segments: Segment[] }  // has extends or reference imports
```

In **flat mode** the ruleset render takes a direct branch: compose selector,
append `selector {`, render body inline, append `}`. No `RulesetBlock`
allocation, no post-step. This is the hot path for the overwhelming majority of
real-world stylesheets.

In **segmented mode** the ruleset render pushes a `RulesetBlock` as described
below. The post-step runs after the walk.

The flag check is a single branch at render startup. `_indexRules` already pays
the traversal cost; the flag is free.

#### Segment types (segmented mode only)

```ts
type Segment = string | RulesetBlock | MergeSlot | HoistBlock

interface RulesetBlock {
  selector: SelectorSet   // live reference — not yet stringified
  body: Segment[]         // recursively nested body segments
  isReference: boolean    // from @import (reference) — suppress unless activated by extend
  extendRoot: ExtendRoot  // which root this ruleset is reachable from (baked in at push time)
}

interface HoistBlock {
  // @media bubbling: at-rule content that must appear at the root level,
  // wrapping the call-site selector context captured at render time.
  atRule: string          // e.g. '@media (max-width: 768px)'
  selectorContext: SelectorSet | undefined
  body: Segment[]
}

interface MergeSlot {
  property: string        // +: and +_: — collects all same-property decls in scope
  segments: Segment[]
}
```

#### Extend side table (segmented mode only)

Collected in parallel during the render pass — not a separate pre-pass:

```ts
interface ExtendRecord {
  targetSelector: SelectorSet   // what is being targeted
  extendRoot: ExtendRoot        // which root the :extend() lives in
  sourceBlock: RulesetBlock     // the block whose selector gets augmented
}
```

#### Post-step (pure function, no AST access)

`(Segment[], ExtendRecord[]) → string`

For each `RulesetBlock`:

1. **Selector match** — walk-and-consume / `selector-match-core` against
   `ExtendRecord.targetSelector`. Same algorithm as today, but operating on
   already-resolved `SelectorSet` objects rather than live AST nodes.
2. **Root visibility** — `record.extendRoot` can reach `block.extendRoot`.
   Same predicate as `extend-roots.ts`, but purely over two `ExtendRoot` values
   baked in at push time — no AST traversal at match time.
3. **Reference visibility** — `block.isReference` suppresses output unless
   matched by steps 1+2.

For each `HoistBlock`: emit at root level with `selectorContext` wrapped around
the body — the same output as the current parent-chain traversal during
`toTrimmedString`, but with the context captured at render time rather than
reconstructed at serialization time.

For each `MergeSlot`: combine accumulated same-property declarations.

This design handles all constraints uniformly:
- Regular extends (selector augmentation)
- `@import (reference)` visibility (only surface if extended)
- Extend roots (only match across compatible roots)
- `@media` bubbling (hoist to root level with call-site context)

---

## How Each Node Type Renders

The `render(node, ctx)` function dispatches by node type. Each case reads from
`ctx.frame` and writes to `ctx.outputBuffer`. The source node is never mutated.

`node.eval(ctx)` is the existing entry point — in the new model it will call
`render(node, ctx)` internally. The current two-phase behavior (eval → mutate
node, then serialize) is replaced by this single render pass. `node.toString()`
/ `node.toTrimmedString()` remain for literal nodes that need no frame context.

### Literal nodes (Any, Color, Dimension, keyword, etc.)

```
render(node, ctx):
  ctx.outputBuffer.append(node.toTrimmedString())
```

The value is already in the node. No frame lookup needed. This is the vast
majority of nodes in a real stylesheet — most values are literals.

### Reference nodes (@color, $var)

```
render(ref, ctx):
  cell = resolveCell(ref.name, ctx.frame)
  ctx.outputBuffer.append(cell.value.toTrimmedString())
```

`resolveCell` is described in detail below. For a mixin param it is a direct
`Map.get` — one operation. For a contextual variable it walks the frame chain.
Either way: no registry, no Set, no sort.

### Expression nodes (function calls, operations)

```
render(expr, ctx):
  args = expr.args.map(arg => resolve(arg, ctx))
  result = applyFunction(expr.fn, args)   // returns a Node
  ctx.outputBuffer.append(result.toTrimmedString())
  // result is discarded — not stored anywhere
```

`resolve(node, ctx)` is the value-returning sibling of `render`. It resolves
a node against the current frame and returns its evaluated Node form — it does
not write to the buffer. Used wherever a computed value is needed before the
buffer write (function arguments, guard conditions, key resolution in dynamic
declarations). The caller decides what to do with the result; any intermediate
nodes are then garbage-collected — never stored on any AST node.

---

### Materialization Boundaries

Most of the render pass is a streaming write — nodes resolve references and
append strings to the output buffer without producing intermediate values.
But some evaluation sites need a **materialized node** (a concrete typed value
like `Color`, `Dimension`, or `Quoted`) rather than just a buffer write. These
are called **materialization boundaries**, and they all go through `resolve`.

#### Function call arguments

The most common materialization boundary. CSS built-in functions (`darken`,
`mix`, `lighten`, arithmetic operators) are implemented as code that receives
typed Node instances and computes a result:

```
// Less source: darken(@color, 10%)
render(expr[darken(@color, 10%)], ctx):
  args = [
    resolve(Reference('color'), ctx),  // → Color(blue)   — must be a Color, not a Reference
    resolve(Dimension(10, '%'), ctx)    // → Dimension(10, '%')
  ]
  result = builtins.darken(args[0], args[1])  // → Color(darker-blue)
  ctx.outputBuffer.append(result.toTrimmedString())
```

A built-in cannot receive a `Reference` node — it needs the actual `Color`.
`resolve` materializes the reference before crossing the function boundary.

User-defined Less functions (defined with `.fn()` or Jess `@function`) go
through the same path: args are materialized before the function body runs.

#### Guard evaluation

Mixin guards (`when (@size > 10px)`) need comparable materialized values:

```
// evaluating whether to include a candidate mixin
guardPasses = evaluate(guard, ctx):
  lhs = resolve(Reference('size'), ctx)   // → Dimension(12, 'px')
  rhs = resolve(Dimension(10, 'px'), ctx) // → Dimension(10, 'px')
  return lhs.value > rhs.value            // true
```

The comparison is between concrete values. A Reference in the guard
expression must be resolved before the comparison can happen.

#### Selector interpolation

Interpolated identifiers inside selectors (`@{prefix}-item`) need the
prefix resolved to a string before the selector can be assembled:

```
render(InterpolatedIdent[@{prefix}-item], ctx):
  prefix = resolve(Reference('prefix'), ctx)  // → Any('nav')
  ctx.outputBuffer.append(prefix.valueOf() + '-item')
  // → 'nav-item'
```

The composed selector cannot be formed without materializing `@prefix` first.

#### Dynamic declaration key resolution

As described in the binding modes section: when a declaration name is an
interpolation (`@{prefix}-color: red`) or variable variable (`@@varName: blue`),
the key must be resolved before the entry can be placed in a bucket.

```
resolvedKey = resolve(decl.name, ctx)  // → string: 'nav-color'
insertIntoBucket(frame, resolvedKey, decl)
```

#### Operator expressions

Arithmetic and string operations (`@a + @b`, `@base * 2`) resolve their
operands before computing:

```
render(expr[@a + @b], ctx):
  lhs = resolve(Reference('a'), ctx)  // → Dimension(10, 'px')
  rhs = resolve(Reference('b'), ctx)  // → Dimension(5, 'px')
  result = lhs.operate(rhs, '+')      // → Dimension(15, 'px')
  ctx.outputBuffer.append(result.toTrimmedString())
```

#### What stays a stream write (no materialization)

The vast majority of nodes do **not** require materialization:

- A `Reference` directly in a declaration value (`color: @brand`) → `render`
  resolves the cell and appends the string in one step
- A nested ruleset (`.inner { ... }`) → `render` composes the selector and
  recurses, never building an intermediate value
- A plain literal anywhere → `node.toTrimmedString()` appended directly

The rule: **if only the string representation is needed, stream-write via
`render`. If the code needs to inspect, compare, compute with, or pass the
value to an external function, materialize via `resolve`.**

---

### Declaration nodes (background: @color)

```
render(decl, ctx):
  render(decl.name, ctx)    // writes name to buffer
  ctx.outputBuffer.append(': ')
  render(decl.value, ctx)   // writes value to buffer
  ctx.outputBuffer.append(';')
```

The declaration node delegates to `render` for its name and value. If the value
is a reference, `render` resolves it from the frame. If it is a literal, `render`
appends it directly. The declaration node itself stores nothing.

### Ruleset nodes (.inner { ... } inside a mixin body)

```
render(ruleset, ctx):
  composedSelector = compose(ctx.selectorContext, ruleset.selector)
  block = RulesetBlock {
    selector: composedSelector,
    body: [],
    isReference: ctx.isReference,
    extendRoot: ctx.extendRoot
  }
  ctx.outputBuffer.push(block)
  childCtx = ctx.withSelector(composedSelector).withBodyBuffer(block.body)
  for child in ruleset.rules.value:
    render(child, childCtx)
  // block.body is now fully populated; will be finalized in the post-step
```

The composed selector is computed from `ctx.selectorContext` (the call-site
selector prefix) combined with the ruleset's own selector. Rather than
immediately stringifying it, it is stored in a `RulesetBlock` segment so the
post-step can apply extend augmentation, test reference visibility, and check
root compatibility before producing the final string.

Any `:extend()` declarations encountered while rendering the ruleset body are
collected into `ctx.extendSideTable` alongside their `extendRoot` — no separate
pre-pass is needed.

A second invocation from a different call site pushes a fresh `RulesetBlock`
with a different composed selector and a fresh body buffer — the ruleset
template node is never mutated.

---

## How Variable Lookup Works (resolveCell)

```
resolveCell(name, frame):
  // 1. Check live slots first — O(1), mixin params live here
  cell = frame.liveSlotsByName.get(name)
  if cell: return cell

  // 2. Check contextual declarations — last entry wins
  entries = frame.declarationBucketsByName.get(name)
  if entries && entries.length > 0:
    return entries[entries.length - 1].cell

  // 3. Walk up the frame chain
  if frame.parent:
    return resolveCell(name, frame.parent)

  // 4. Not found
  return undefined
```

Step 1 is a `Map.get` — a single hash lookup. Mixin params always live here.
This is the hot path for the benchmark's loop variables (`@i`, `@n`, `@cols`).

Step 2 is another `Map.get` plus an array tail read. Contextual variables from
outer scopes (`@base-hue`, `@base-url`) live here.

Step 3 is a recursive call up the frame chain. The frame chain is shallow — in
practice one to three hops for typical Less code.

No `Set`. No array conversion. No sort. No `indexPendingItems`. No
`comparePosition`. No generic registry object.

### Contrast with the current registry lookup

Current path for a single variable lookup:

1. call `Rules.find('declaration', name, 'VarDeclaration', opts)`
2. fetch or create `DeclarationRegistry` on the Rules node
3. call `indexPendingItems()` — flush pending items into the index
4. call `_findByKey(candidates, key)` — walks the Set/Map
5. convert candidates to an array
6. filter by type
7. sort by position
8. call `_searchRulesChildren(key, ...)` — recurse into nested Rules children
9. repeat for parent Rules nodes up the chain

Steps 2–9 happen for every lookup. For `@base-hue` called 93,810 times per
benchmark render, that is 93,810 × (Set allocation + array conversion + sort +
recursive child search).

With frames: 93,810 × (one `Map.get`).

---

## Binding Modes

### Live bindings — mixin params, loop counters

Live binding cells live in `frame.liveSlotsByName`. They are set once at call
time and read N times during the invocation. When the invocation ends, the
frame is discarded (or the cells are reset for the next iteration of a
recursive mixin).

**Update in place, no copy.** When a loop counter increments, you do:

```ts
cell.value = newValue;
```

No new node. No fork. No registry update. Just a field assignment.

This is also why recursive mixins work cleanly: each recursive call pushes a
new frame with the updated values. The base case returns. The frames unwind.

### Contextual bindings — Less @var, ordinary variable declarations

Contextual bindings live in `frame.declarationBucketsByName`. Less's "last
definition wins" semantics include definitions that appear *after* the reference
in source order — a forward reference must be visible:

```less
.mixin() {
  color: @brand;    // references @brand — defined BELOW in this scope
}
@brand: blue;       // this wins even though it comes after .mixin
```

#### Static keys — the fast path

Most declaration names are plain literals (`@color`, `@base-hue`, `@i`).
For these, the bucket **can** be pre-populated from the AST when the scope
frame is created — a single O(n) scan over `Rules.value`, inserting
`VarDeclaration` nodes in source order into the Map. By the time the render
pass starts, every statically-named declaration is already in its bucket.
Every lookup for the lifetime of the frame is then a direct `Map.get` +
array tail read.

This covers the hot path: the benchmark variables (`@base-hue`, `@cols`, `@i`,
`@n`) are all statically named.

#### Dynamic keys — the slow path

Less allows declaration names and lookup targets to be computed at runtime.
This goes beyond interpolation — the entire key can be indirected through
another variable:

```less
// Interpolated declaration name
@prefix: my;
@{prefix}-color: red;        // stored under 'my-color' — key not known until runtime

// Variable variable (double-indirect)
@varName: color;
@@varName: blue;              // equivalent to @color: blue — key requires resolving @varName first

// Variable mixin (callable target is a runtime value)
@mixinName: .generate-grid;
@{mixinName}(@cols);          // the mixin to call is determined at runtime
```

For these, the bucket key cannot be determined at frame-creation time. They
cannot be pre-populated into `declarationBucketsByName`.

These declarations are kept in a separate list on the frame:

```ts
pendingDynamicDecls: Node[];   // VarDeclarations with non-literal name expressions
```

At lookup time, if the static bucket misses, the caller scans
`pendingDynamicDecls`: evaluates each declaration's name expression against the
current frame, and checks whether it matches the lookup key. Matches are
inserted into the static bucket (now that the key is known) and returned.

This is slower than the static path but only applies to dynamic-key
declarations, which are uncommon. The hot-path variables never hit this branch.

The important invariant: `pendingDynamicDecls` is ordered by source position.
When a dynamic declaration's key is resolved and inserted into the bucket, it
is inserted at the correct position relative to any static entries already in
the bucket, preserving "last definition wins" across static and dynamic
declarations with the same name.

**Last definition wins** — for a scope with:

```less
@color: red;
@color: blue;
```

Two entries in the bucket for `'color'`, in source order: `[red, blue]`.
`resolveCell` reads `entries[entries.length - 1]` → `blue`. No sort. No
position comparison. The order is already correct because the bucket was
populated in source order.

### Live bindings — mixin params, loop counters

Live bindings live in `frame.liveSlotsByName`. They are **not** pre-populated
— they are set at call time:

```
invoking .mixin(blue):
  frame.liveSlotsByName.set('color', BindingCell { value: Color(blue) })
```

For a recursive mixin where `@i` increments each call:

```
frame.liveSlotsByName.get('i').value = nextValue   // in-place update, no copy
```

`resolveCell` checks `liveSlotsByName` first before falling through to the
contextual buckets. This means live bindings always shadow contextual bindings
with the same name — correct: a mixin param `@color` should shadow an outer
`@color` declaration.

### Resolution order

```
resolveCell(name, frame):
  // 1. Live slots — set at call time, O(1) Map.get
  cell = frame.liveSlotsByName.get(name)
  if cell: return cell

  // 2. Static contextual bucket — pre-populated from AST, O(1) Map.get + tail
  entries = frame.declarationBucketsByName.get(name)
  if entries?.length: return entries[entries.length - 1].cell

  // 3. Dynamic declarations — scan and resolve keys, uncommon
  for decl in frame.pendingDynamicDecls (reverse source order):
    resolvedKey = resolve(decl.name, ctx)   // value-returning: returns string key
    if resolvedKey === name:
      entry = insertIntoBucket(frame, resolvedKey, decl)  // cache for next time
      return entry.cell

  // 4. Walk parent frame
  if frame.parent: return resolveCell(name, frame.parent)

  return undefined
```

- **Mixin param / loop counter**: step 1. One `Map.get`.
- **Static contextual var from current scope**: step 2. One `Map.get` + tail.
- **Static contextual var from enclosing scope**: step 2 misses, step 4 hops
  to parent, repeat.
- **Forward reference** (definition after reference in source): visible because
  the bucket was pre-populated from the full AST before the render pass started
  — for static keys. Dynamic forward references resolved at first access.
- **Interpolated / variable-variable declaration**: step 3. Slow path, but rare.

### No `resolution: 'linear'`

The `resolution: 'linear'` code path in the current `reference.ts` was a
mis-named attempt to implement live contextual lookup. It compensated for
the fact that the registry system did not correctly model which scope should be
visible at evaluation time. With explicit frame chains built at evaluation time, this
concept disappears. There is no "linear" mode — there are live bindings and
contextual bindings, and the frame chain wires them up correctly.

---

## Concrete Mixin Invocation Example

```less
@base: red;

.mixin(@color) {
  background: @color;
  .inner { border: 1px solid @color; }
}

.a { .mixin(blue); }
.b { .mixin(green); }
```

**Invoking `.mixin(blue)` from `.a`:**

```
frame = ScopeFrame {
  liveSlotsByName: { 'color': BindingCell { value: Color(blue) } }
  parent: .a's frame {
    declarationBuckets: {}
    parent: root frame {
      declarationBuckets: { 'base': [BindingEntry(red)] }
    }
  }
}

ctx = EvalContext {
  frame,
  selectorContext: ['.a'],
  outputBuffer: buf
}

render(Rules[background: @color, .inner{...}], ctx):

  render(Declaration[background: @color], ctx):
    name  → 'background'
    value → Reference('color')
              → resolveCell('color', frame)
              → liveSlotsByName.get('color') → Color(blue)
              → 'blue'
    buf ← 'background: blue;'

  render(Ruleset[.inner { border: 1px solid @color }], ctx):
    composedSelector = '.a .inner'
    buf ← '.a .inner {'
    render(Declaration[border: 1px solid @color], ctx.withSelector('.a .inner')):
      value → 1px solid + Reference('color') → Color(blue)
      buf ← 'border: 1px solid blue;'
    buf ← '}'
```

**Invoking `.mixin(green)` from `.b`:**

Same template. New `EvalContext`:

```
frame = ScopeFrame {
  liveSlotsByName: { 'color': BindingCell { value: Color(green) } }
  parent: .b's frame { ... }
}
ctx.selectorContext = ['.b']
```

Writes `background: green;` and `.b .inner { border: 1px solid green; }`.

**The `.inner` ruleset node in the AST is untouched by both invocations.**

No clone. No fork. No renderKey. No parent pointer rewriting.

---

## The leakyRules Exception

Most mixins are self-contained — their body defines things for use inside the
mixin, and nothing escapes to the caller. This is the default case and the hot
path.

Some mixins use Less namespace-export semantics (`leakyRules`): variables or
mixins defined inside the body become visible in the caller's scope after the
call returns.

In this case `ctx.leaky = true`. When the render pass encounters a
`VarDeclaration` or `Mixin` definition inside the body, it registers the
binding into `ctx.frame.parent` (the caller's frame) in addition to emitting
it. The registration is a `Map.set` into a `BindingCell` — still no synthetic
declaration node insertion, no registry churn.

This is an opt-in escape hatch. The hot path never touches it.

---

## What the Node Graph Is Still For

Removing result storage from nodes does not remove the node graph. It still
serves:

- **Source structure** — the canonical ordered representation of the stylesheet
- **Selector composition at compile time** — knowing where a ruleset sits for
  extend resolution, import ordering, and output ordering
- **Error reporting** — "this reference is at line X in file Y"
- **AST inspection** — language server, tooling, debugging

Node parent pointers remain valid and useful for these purposes. They are
just not the runtime scope chain. Scope is what the frame chain is for.

---

## What Goes Away

| Current system | Proposed system |
|---|---|
| Clone mixin body per call site | Walk template with different EvalContext |
| renderKey / fork system | Frame chain built at call time |
| Node parent traversal for variable lookup | Frame chain traversal |
| `DeclarationRegistry` per Rules | `declarationBucketsByName` map per ScopeFrame — retired entirely |
| `MixinRegistry` per Rules | `mixinsByName` fast map on Rules — retired entirely |
| `RulesetRegistry` per Rules | `rulesetsBySelector` fast map on Rules — retired entirely |
| `indexPendingItems()` at lookup time | Incremental population as scope is built |
| `Set` allocation per lookup | Direct `Map.get` |
| `Set → Array` conversion | Not needed |
| Sort by position per lookup | Not needed — bucket order = source order |
| `_searchRulesChildren` recursion | Frame chain hop |
| Synthetic `VarDeclaration` nodes for params | Live `BindingCell` in frame slot |
| `runtimeVarBindings` chain walk | Frame `liveSlotsByName` — retired once frame chain covers all param cases |
| `resolution: 'linear'` code path | Deleted — frame chain handles this |
| Two-pass eval + serialize | One-pass buffered render (flat mode for zero-extend case) |

`FunctionRegistry` is not in this list — it is a plugin API for registering JS
functions, not an evaluation lookup registry. It stays, but its current
per-`Rules` chain design can be made much cheaper:

**Current shape**: one `FunctionRegistry` per `Rules` node; looking up a
function walks an n-hop parent chain until it reaches the root.

**Target shape**: two levels — one global `FunctionRegistry` for built-ins and
plugin functions registered at startup; one per-stylesheet registry created on
demand when `registerFunction()` is called within a stylesheet. Lookup checks
the stylesheet registry first, then falls through to the global.

Import semantics determine visibility:
- `@compose` children see only the global — not the parent stylesheet registry
- `@import` children see the parent stylesheet registry (same graph reachability
  as extends and other cross-file lookups)

This is O(1) in the common case (no stylesheet-local functions) and O(depth of
stylesheet registries between call site and global) otherwise — in practice 1–2
hops, never the full depth of Rules nodes in the tree.

---

## Less-Compat Adapter Layer

The `jess-plugin-less-compat` package currently uses `Proxy` to wrap Jess nodes
and expose a Less.js-compatible API to Less plugins. The handler is almost
entirely transparent — `Reflect.get`, `Reflect.set`, `Reflect.has`, all
delegating straight through — with only `typeIndex` and a per-call `propertyMap`
callback as actual interception.

This design is wrong on two counts.

**First, transparency is a bug, not a feature.** The Proxy fallthrough means a
Less.js plugin can access any internal Jess property through the compat layer,
as long as the Jess node happens to have a field with the right name. That
gives plugins access to Jess internals they should never see. If a Less.js
plugin accesses an undocumented property, the correct result is `undefined`
or an error — not silent success because a Jess field happened to match.

**Second, Proxy is slow and V8 cannot optimize it.** Every property access on a
proxied object goes through the trap. V8's inline cache cannot specialize on
Proxy targets. For a compat layer that sits on the evaluation hot path (selector
proxies are created for every selector element during benchmark rendering), this
is measurable overhead.

### The correct shape: explicit adapter classes

Replace `createLessProxy` with concrete adapter classes, one per Less.js node
type, with explicit getters for every property in the documented Less.js node
shape:

```ts
class LessRuleset {
  constructor(private readonly _jess: Ruleset) {}

  get type() { return 'Ruleset' }
  get selectors() { return toLessSelectors(this._jess.value.selector) }
  get rules() { return toLessRules(this._jess.value.rules) }
  // ... every Less.js Ruleset property, explicitly
}
```

Unknown property access returns `undefined`. If a plugin relied on an
undocumented internal, that is the plugin's problem — the compat contract is
the documented Less.js node shape, not Jess internals.

Benefits:
- V8 can inline getters; it cannot inline Proxy traps
- No per-node Proxy allocation
- The Less.js API surface is explicit and auditable — you can see exactly what
  is supported
- Jess internals are not accidentally exposed
- `isLessProxy` / `getJessNodeFromProxy` can be replaced with `instanceof`
  checks on the adapter classes

The `propertyMap` callback pattern in the current proxy collapses into the
getters of the appropriate adapter class. `adapter.ts`, `to-less.ts`, and
`selector.ts` become typed adapter classes rather than ad-hoc Proxy construction
with callbacks.

This is a separate work item from the registry redesign but belongs in the same
performance push. The selector element proxies in particular are created on the
critical path during rendering.

## Node Shape: Direct Instance Fields

The current node base class wraps all data in a `value` object that is then
wrapped in a Proxy. The Proxy intercepts property assignments and calls
`adopt(child)` which sets `child.parent = this`. This exists so that writing
`this.value.name = x` automatically updates `x`'s parent pointer.

In the render model, parsed nodes are constructed once and never mutated during
evaluation. The Proxy is therefore pure overhead on the hot path — the benchmark
audit already shows it at ~1.2% of CPU.

### Direct fields are the right shape

```ts
// current
class Declaration extends Node {
  // this.value = Proxy({ name: Any, value: Node, important?: Any })
  // accessed as this.value.name, this.value.value, this.value.important
}

// proposed
class Declaration extends Node {
  name: Any
  value: Node          // note: name clash with base class 'value' needs resolving
  important?: Any
}
```

Benefits:
- No Proxy allocation per node
- No Proxy intercept cost on every field read
- Stable V8 hidden classes — all Declaration instances have the same shape
- Direct field access: `decl.name` instead of `decl.value.name`
- Better inline cache hit rates on the hot render path

The external API — passing an options object to the constructor — stays the
same. The constructor destructures and stores directly, calling `adopt()`
explicitly for each child field during construction.

```ts
constructor({ name, value, important }: DeclarationOptions) {
  super()
  this.name = name
  this.value = value
  this.important = important
  this.adopt(this.name)
  this.adopt(this.value)
  if (important) this.adopt(this.important)
}
```

### `.parent` in the render model

`adopt()` sets `child.parent = this`. In the render model, `.parent` is not
consulted during evaluation at all — scope resolution uses `evalCtx.frame`,
selector composition uses `evalCtx.selectorContext`. `.parent` becomes purely
**document structure**: where in the source tree was this node defined.

It is still needed for cold-path operations:

- **Extend resolution** — which rulesets are structurally related in the document
- **Error reporting** — where in the source file does this node live
- **Import boundary detection** — encoded in `frame.importMode` during render,
  but still needed for structural analysis outside of render

None of those are hot paths.

### Why the single-parent constraint does NOT force cloning

The single-parent constraint (`child.parent` is one pointer) would force cloning
if the same node needed to appear in multiple structural positions simultaneously.

In the render model this does not happen. A mixin body has **one structural
position** — where it is defined in the source. `.parent` at the definition
site is set once at parse time and is correct. The mixin body is then *invoked*
in many places, but those invocations produce output in the buffer by walking
the template with different `evalCtx` values — they do not place the template
node into new structural positions. The definition-site `.parent` is never
consulted during any of those invocations.

Cloning was only ever necessary because evaluation used `.parent` traversal for
scope resolution. Remove that dependency — scope goes to `evalCtx.frame`,
selectors go to `evalCtx.selectorContext` — and the single-parent constraint
becomes a non-issue. The template is one node, walked N times, `.parent`
untouched throughout.

**Cloning is eliminated by the render model. The single-parent constraint on
`.parent` is not the obstacle; the node-parent-as-scope-chain pattern was.**

Adoption still happens during parse and node construction — not during
evaluation. Direct instance fields + explicit `adopt()` calls in constructors
is the right shape: cheap construction, zero evaluation-time overhead.

## What Does Not Change

- `Rules.value` stays as the one canonical ordered child array
- Source order semantics are preserved (bucket order = insertion order = source order)
- Less "last definition wins" is preserved (last bucket entry wins)
- Mixin arity + guard matching semantics are preserved — the frame chain replaces
  the node graph as the collection source, but collect-all-then-filter semantics
  are unchanged
- Declaration merging (`+:` / `+_:`) semantics are preserved — all merge entries
  per scope are stored in the bucket array and combined during render
- The node graph is still the source of truth for structure
- Extend, import, and selector composition logic are separate concerns — this
  proposal does not change them

---

## Repo Constraints This Design Obeys

From [AGENTS.md](/Users/matthew/git/oss/jess/AGENTS.md) and
[node-copy-reduction/README.md](/Users/matthew/git/oss/jess/docs/future/node-copy-reduction/README.md):

- one canonical `Rules.value` array ✓ — untouched
- no cloning as a routine eval strategy ✓ — cloning eliminated from mixin invocation
- no materialization as a lookup strategy ✓ — frame cells, not synthetic nodes
- valid parent/child relationships at all times ✓ — node graph untouched
- reduce object creation during eval ✓ — frames replace Set/Array/registry churn
- lazy per-placement runtime state ✓ — frames created at invocation, not parse time

---

## Where "Nearest Match" Is Not Enough

Two real cases in Less do not fit the simple "walk the frame chain, return the
first hit" model. They need to be called out explicitly so the frame design
handles them correctly.

### Mixin resolution: collect ALL candidates, then filter

Ordinary variable lookup stops at the first match and returns it. Mixin lookup
cannot do that because multiple definitions of the same mixin name are all
potentially applicable, and the right one is chosen by arity and guard
conditions evaluated at call time.

```less
.mixin()          { color: red; }
.mixin(@a)        { color: @a; }
.mixin(@a) when (@a > 10) { color: blue; }
```

Calling `.mixin(5)` must:

1. Collect all three candidates from the frame chain
2. Filter to those where arity matches — `.mixin(@a)` and `.mixin(@a) when (@a > 10)`
3. Evaluate the guard `(@a > 10)` against the current frame — fails for `5`
4. Apply `.mixin(@a)` only

This is "collect all candidates, filter by arity, evaluate guards, apply
survivors." The frame chain is still where candidates come from, but the walk
cannot short-circuit on first hit — it must collect across the entire visible
frame chain.

**In the frame model:**

`mixinBucketsByStartKey` holds all `CallableEntry` values registered under a
given start key. Mixin resolution:

```
collectMixinCandidates(key, frame) → CallableEntry[]
  candidates = []
  cursor = frame
  while cursor:
    entries = cursor.mixinBucketsByStartKey.get(key) ?? []
    candidates.push(...entries)
    if importBoundary(cursor): break
    cursor = cursor.parent
  return candidates
// then: filter by arity, evaluate guards against ctx.frame, apply survivors
```

This is still cheaper than the current registry approach (no Set allocation,
no pending-item flush, no sort) — but it is a full-chain walk with accumulation,
not a single-hit lookup.

Guard evaluation happens against `ctx.frame` using the same `resolveCell` path
as ordinary variable resolution. No separate mechanism needed.

**Variable mixins** — where the callable target is a runtime value — follow the
same dynamic-key pattern as variable variables. The start key is resolved via
`resolveCell` first, then `collectMixinCandidates` is called with the resolved
key. This is the slow path; static mixin names use the direct bucket lookup.

### Declaration merging: collect all, combine

Less has two merge operators for CSS property declarations:

- `+:` — space-separated merge: multiple values combined with a space
- `+_:` — comma-separated merge: multiple values combined with a comma

```less
.a {
  transform+: translateX(10px);
  transform+: rotate(45deg);
  // output: transform: translateX(10px) rotate(45deg);
}
```

This is not "last definition wins." All merge-flagged declarations for the same
property within the same scope are combined into one output declaration.

**In the frame model:**

`propertyBucketsByName` (and `declarationBucketsByName` for variable merges)
holds all entries in source order. When rendering a scope's properties, the render
logic checks whether any entries for a given name carry merge flags:

- If no merge flags: last entry wins (same as ordinary contextual lookup)
- If merge flags present: collect all merge-flagged entries in source order,
  combine their values with the appropriate separator, render the merged result

Merging is a frame-local operation — it applies to entries within one
`ScopeFrame`'s bucket. Entries from parent frames are not merged with entries
from child frames (they are shadowed by the child, same as without merging).

```
emitPropertyBucket(name, entries, ctx):
  if any entry has mergeFlag:
    mergeEntries = entries.filter(e => e.mergeFlag)
    combined = join(mergeEntries.map(e => render(e.value, ctx)), separator)
    ctx.outputBuffer.append(name + ': ' + combined + ';')
  else:
    // last definition wins
    render(entries[entries.length - 1].value, ctx)
```

The key point: both cases (mixin candidates and merge declarations) store
**all** relevant entries in the frame's bucket arrays, in source order. The
difference from ordinary variable lookup is only in how the array is consumed:
- ordinary variable: `entries[entries.length - 1]` (last wins)
- mixin candidates: collect all, filter externally
- merged properties: collect merge-flagged, combine

The frame design already handles this — `declarationBucketsByName` and
`mixinBucketsByStartKey` store arrays, not single values, for exactly this
reason. The lookup strategy varies by call site, not by frame structure.

## Relationship to Whitespace Token Proposal

[docs/future/whitespace-token-proposal.md](/Users/matthew/git/oss/jess/docs/future/whitespace-token-proposal.md)

### Why declaration names are currently `Any` nodes

`VarDeclaration.value.name` (and `Declaration.value.name`) is typed as
`Any | Interpolated`, not a plain string. The reason is that `Any` carries
`pre` / `post` properties — so a comment or whitespace between the name and
the colon (`@color /* comment */: value`) can be stored on the name node
itself rather than being discarded at parse time.

This is the same root problem the whitespace-token-proposal solves: nodes
carry formatting because there is nowhere else to put it.

### What changes when pre/post is eliminated

Once `pre` / `post` are removed from nodes (replaced by the offset-keyed
`FormattingMap`), the comment between `@color` and `:` lives in the
`FormattingMap` at the appropriate source offset. The name node no longer needs
to carry it.

With that constraint lifted, declaration names that are plain identifiers can
become plain strings in the AST rather than `Any` nodes. `Interpolated` names
(interpolated like `@{prefix}-color`) still need a node type to represent the
template, but static names become `string`.

### Impact on the frame design

The `BindingCell` / `BindingEntry` / static-vs-dynamic detection in the
`ScopeFrame` becomes simpler:

```ts
// Today — static key detection requires calling .valueOf() and checking the
// node type, because even plain names are Any nodes
const name = decl.value.name.valueOf() as string;

// After whitespace elimination — static name is just a string literal
const isStatic = typeof decl.value.name === 'string';
const name = isStatic ? decl.value.name : resolveKey(decl.value.name, ctx);
```

This removes the current ambiguity where `Any.valueOf()` on an interpolated
name accidentally returns the raw template string instead of the resolved key.
Static vs dynamic becomes an `instanceof` / `typeof` check, not a heuristic.

### Sequencing

The whitespace proposal and the registry redesign are independent work streams
that reinforce each other:

- Registry redesign slices 5–10 proceed without waiting for whitespace
  elimination. The current `Any` name nodes work correctly with the
  `varsByName` and `ScopeFrame` fast paths.
- Whitespace elimination, when it lands, simplifies the frame population code
  (one `typeof` check instead of `.valueOf()` + node-type inspection) and
  removes a class of edge cases around interpolated names with static content.

The render model here (`render()` writing to `ctx.outputBuffer`) is fully
compatible with the whitespace proposal's `FormattingMap` — `emitFmt()` is
just called at the start and end of each `render()` call exactly where the
current `processPrePost()` sandwich is.

---

## Relationship to Pre-Eval Elimination

[docs/future/pre-eval-elimination.md](/Users/matthew/git/oss/jess/docs/future/pre-eval-elimination.md)

Pre-eval elimination collapses the current two-phase eval+serialize into a single
buffered render pass. The frame chain (Track 1) and direct instance fields (Track 2)
are prerequisites — once nodes are pure read-only templates and all lookup goes
through the frame chain, the render pass can be a straightforward source-order walk.

### Why a flat string buffer is not enough

Extends, `@import (reference)`, extend roots, and `@media` bubbling all require
knowledge that is not yet available when the node is first encountered in a
left-to-right render walk:

- **Extends / reference visibility**: a later `:extend()` can activate a ruleset
  encountered earlier, or expose a reference-imported ruleset that is otherwise
  suppressed.
- **Extend roots**: an extend can only target rulesets reachable from the same
  root — reachability must be checked against all extend declarations, not just
  those already seen.
- **`@media` bubbling**: a `@media` block encountered inside a mixin body must
  hoist to the top level and wrap the call-site selector context around its
  content. Currently the `@media` node captures frames during eval and walks up
  the parent chain during serialization — the same deferred-finalization pattern.

### The buffered render model

Instead of a flat `string[]`, the output buffer holds typed segments:

```
Segment = string | RulesetBlock | MergeSlot | HoistBlock
```

Most nodes push strings directly — literals, declarations, at-rules with no
bubbling. Selector-bearing nodes push a `RulesetBlock` whose body is a nested
`Segment[]`. `@media` and similar at-rules that need to bubble push a
`HoistBlock` which carries the call-site selector context baked in at push time
(rather than reaching back up the parent chain during serialization).

Extends and reference-import state are collected into a side table during the
render pass. No separate pre-pass is needed — the side table grows as the walk
proceeds left-to-right.

#### Zero-cost for the common case

Most stylesheets have few or zero extends. To avoid segment allocation overhead
in those cases, `_indexRules` sets `_hasExtends` and `_hasReferenceImports`
flags on the root `Rules` node. At render startup, the buffer mode is chosen
once: **flat mode** (direct string writes, no `RulesetBlock` allocation, no
post-step) when neither flag is set, **segmented mode** otherwise. See
`OutputBuffer` in the Runtime Model section for the full design.

#### When the flag can be set: `@compose` vs `@import`

The timing of when `_hasExtends` is reliably available differs by import
mechanism:

**`@compose` (Jess module system)**: children **cannot affect parents at all**.
Parents can affect children only by passing `mutable: true` bindings downward —
there is no upward channel. Extends in a composed file are completely local;
they cannot target selectors in the importing file. Therefore `_hasExtends` is
purely per-file, set at that file's own index time, and the flat/segmented
decision is made independently per file before any parent is rendered.

**`@import` (Less compatibility)**: children *can* affect parents. Extends in
an imported file can target selectors in the importing file. The extend graph is
global across the import tree. `_hasExtends` can only be set reliably after the
full import graph is resolved, and the flat/segmented decision applies to the
entire combined root.

This asymmetry makes `@compose` the natural foundation for incremental and
parallel rendering: each composed file is a closed rendering unit that can be
compiled independently, its output cached, and the final result assembled from
cached segments. A change to one file invalidates only that file's cache entry
and its ancestors' assembly step — not siblings, not descendants.

With `@import`, any file in the graph having an extend forces the entire merged
root into segmented mode, and any file change potentially invalidates the whole
combined render.

#### The limit of static analysis for `@import`

The one tractable optimization for `@import` is the transitive `_hasExtends`
flag: if a file and all its transitive imports have no extends and no reference
imports, flat mode is safe for that subtree regardless of import mechanism. This
is detectable at index time by propagating the flag up the import graph.

Beyond that, static analysis hits a hard wall. Proving that an imported file's
extends are "local" (cannot match selectors in the importing file) would require
knowing the parent's selectors at child parse time — which is unavailable — and
even then selector matching is undecidable in the general case due to variable
interpolation. Approaches that look promising (namespace-prefix conventions,
no-`&` heuristics, scoped-extend syntax) either cannot be enforced statically or
don't exist in Less.

The practical boundary: transitive `_hasExtends` is the optimization you get for
`@import`. Per-file independent rendering and caching require `@compose`. For
users who need incremental builds, migrating from `@import` to `@compose` is the
correct path — not attempting deeper static analysis of Less import semantics.

### Open question (exploratory): priority queue vs linear render with deferred misses

The shape above assumes the existing priority queue in `Rules.evalNode()`
continues to stage evaluation (imports → calls → declarations →
mixins/rulesets → extends → at-rules). That is one of two plausible shapes
for the render pass and should be chosen empirically before this track
hardens.

- **Shape A — Priority queue.** Classify children into buckets, evaluate in
  bucket order, requeue blocked nodes when dependencies resolve. Semantic
  staging is explicit; priority ordering is a second source of truth for
  evaluation order separate from source order.
- **Shape B — Linear render with deferred misses.** Walk `Rules.value` in
  source order, stream into the segmented buffer, and when a reference cannot
  resolve push a `PendingRefSlot` placeholder segment (same mechanism as
  `RulesetBlock` / `HoistBlock` / `MergeSlot`) and record the miss. At the
  end of the `Rules` walk, drain the miss list; anything unresolved after a
  fixed-point pass is a real error. The placeholder machinery is already
  required for extends / `@media` bubbling / reference imports, so this is a
  new segment type, not new machinery. With static buckets pre-populated from
  `_indexRules`, most forward references are expected to resolve on first
  touch, making the miss list small or empty in the common case.

A hybrid — Shape B as default, Shape A only where it provably costs less — is
likely the right final answer. See
[pre-eval-elimination.md](/Users/matthew/git/oss/jess/docs/future/pre-eval-elimination.md)
("Open Question: Priority Queue vs Linear Render With Deferred Misses") for
the full tradeoff and the measurements to take before committing.

### Post-step

After the render pass, a pure function `finalize(Segment[], ExtendRecord[]) →
string` resolves the segment tree:

1. For each `RulesetBlock`: test selector match, root visibility, and reference
   activation against the extend side table. Apply augmentation or suppress.
2. For each `HoistBlock`: emit at the correct level with the baked-in selector
   wrapper applied.
3. For each `MergeSlot`: combine accumulated same-property declarations.
4. Concatenate all resolved segments to the final string.

No AST access during the post-step — everything needed is in segment metadata
that was baked in at render time.

---

## Transition Plan

The current codebase cannot be rewritten all at once. The transition proceeds in
narrow verifiable slices, each one removing a specific wrong pattern.

**Slices completed:**

- Slices 1–4: mixin params moved from synthetic `VarDeclaration` nodes into
  `RuntimeVarBinding` cells on `Rules`. Params no longer go through the
  declaration registry.
- Slice 5: `varsByName` fast map on `Rules` for direct contextual variable
  lookup, bypassing the registry machinery for the hot path.
- Slice 6: `ScopeFrame` introduced alongside the registry. `buildScopeFrame` /
  `resolveFrameCell` in `scope-frame.ts`. Populated in parallel for verification.
- Slice 7: `mixinsByName` fast map on `Rules`. Static-named mixin lookup
  bypasses `MixinRegistry.find`.
- Slice 8: `ScopeFrame` parent chain wired at mixin call time. `liveSlotsByName`
  carries params. `resolveFrameCell` finds them via the call-site frame chain.
- Slice 9: `liveSlotsByName` frame-chain walk is the primary mixin param lookup
  path in `performLookup`. `runtimeVarBindings` kept as fallback. Only
  `liveSlotsByName` walked (not `declarationBucketsByName`) to preserve Less
  definition-site semantics for lexical vars.

**Next slices:**

- **Slice 10:** Remove `runtimeVarBindings` from `Rules` once confirmed all
  param lookups go through `liveSlotsByName`. Remove the fork/renderKey system.
  Delete `resolution: 'linear'`. Delete the generic `DeclarationRegistry` hot
  path. Clean up.

- **Track 2:** Node shape — direct instance fields on each node class, removing
  the `value = Proxy(...)` pattern.

- **Track 3:** Less-compat adapter layer — explicit adapter classes replacing
  the transparent `Proxy` shim.

- **Track 4:** Whitespace/trivia token proposal — `FormattingMap` replaces
  `pre`/`post` fields; static declaration names become plain `string`.

- **Track 5:** Buffered render pass — typed `Segment[]` buffer with post-step
  for extend finalization, reference visibility, and `@media` bubbling.
  See "Relationship to Pre-Eval Elimination" above.

Each slice keeps `pnpm --filter @jesscss/core test` green and keeps the focused
mixin proof test green.

---

## Correctness Strategy

### Differential tests

For each behavior change, add a test that proves:
- the old registry path and the new frame path return the same result for the
  same input
- the frame chain is built correctly for the call site

### Existing baselines stay green

- `@jesscss/core` tests
- Less compatibility suite in `packages/jess/test/less`
- Import / reference / detached ruleset tests
- Recursive mixin tests
- Extend-heavy tests

### Focused proof tests in core

One proof test per slice. Each proves that the hot path for that slice no longer
hits the registry. Currently: `src/tree/__tests__/mixin.test.ts`.

---

## Bottom Line

The current system is slow because it mixes three jobs into every node:
template, lookup engine, and result container. Those jobs fight each other and
force cloning, forking, and generic registry search.

The fix is to separate them:

- **Template**: the node graph, unchanged, read-only during evaluation
- **Lookup**: the frame chain, built at call time, walked by reference resolution
- **Output**: the output buffer, written directly during the render pass

With those separated:

- **No clones** — the template is shared across all invocations
- **No forks** — the frame chain is the scope chain; node parents are document
  structure only
- **No registry machinery** — lookup is a `Map.get` plus a frame chain walk
- **No two-pass eval + serialize** — the render pass is both at once

Serialization IS evaluation. Walk the template, resolve from the frame, write to
the buffer. Done.
