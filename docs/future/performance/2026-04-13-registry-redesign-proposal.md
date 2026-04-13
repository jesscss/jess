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

A flat accumulator. Could be a `string[]` joined at the end, or a rope-like
structure for large outputs.

```ts
type OutputBuffer = {
  append(s: string): void;
  toString(): string;
};
```

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
  ctx.outputBuffer.append(composedSelector.toTrimmedString() + ' {')
  childCtx = ctx.withSelector(composedSelector)
  for child in ruleset.rules.value:
    render(child, childCtx)
  ctx.outputBuffer.append('}')
```

The composed selector is computed from `ctx.selectorContext` (the call-site
selector prefix) combined with the ruleset's own selector. It is used for this
invocation's output and then discarded. The ruleset node does not get a
composed selector stored on it. A second invocation from a different call site
computes a different composition against the same ruleset template.

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
mis-named attempt to implement call-time contextual lookup. It compensated for
the fact that the registry system did not correctly model which scope should be
visible at call time. With explicit frame chains built at call time, this
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
| Generic `DeclarationRegistry` per Rules | `declarationBucketsByName` map per frame |
| `indexPendingItems()` at lookup time | Incremental population as scope is built |
| `Set` allocation per lookup | Direct `Map.get` |
| `Set → Array` conversion | Not needed |
| Sort by position per lookup | Not needed — bucket order = source order |
| `_searchRulesChildren` recursion | Frame chain hop |
| Synthetic `VarDeclaration` nodes for params | Live `BindingCell` in frame slot |
| `resolution: 'linear'` code path | Deleted — frame chain handles this |
| Two-pass eval + serialize | One-pass render |

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

## Relationship to Pre-Eval Elimination

[docs/future/pre-eval-elimination.md](/Users/matthew/git/oss/jess/docs/future/pre-eval-elimination.md)

Pre-eval elimination is a separate later slice. It proposes evaluating nodes in
source order rather than separating a pre-eval phase (priority ordering,
declaration collection) from a later eval phase.

The render model here is the prerequisite for that work:

- Once nodes are pure templates with no stored results, evaluation order becomes
  a question of "in what order do we call `render`?" rather than "in what order
  do we mutate the node tree?"
- Source-order render is natural — walk `Rules.value` in order, render each child
- The frame chain naturally builds up in source order as declarations are emitted

That work belongs to a later slice. This proposal does not require it.

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

**Next slices:**

- **Slice 6:** Introduce `ScopeFrame` alongside the current registry system.
  Populate it incrementally. Add assertions comparing frame state with registry
  state. No behavior change yet.

- **Slice 7:** Route ordinary variable lookup through the frame chain. Keep
  a guarded fallback to the current registry path for correctness during
  development.

- **Slice 8:** Route mixin invocation through the render model. Build the frame
  chain at call time. Stop cloning mixin bodies.

- **Slice 9:** Delete the fork/renderKey system. It has no remaining callers.

- **Slice 10:** Delete `resolution: 'linear'`. Delete the generic
  `DeclarationRegistry` hot path. Clean up.

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
