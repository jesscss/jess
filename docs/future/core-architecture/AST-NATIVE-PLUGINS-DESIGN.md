# AST-native `@plugin` subsystem — design spec

> DESIGN-ONLY. No implementation lands from this doc. It specifies the native
> `ast/`-engine plugin capability that will retire the
> `jess-plugin-less-compat` bridge and the legacy `tree/` eval machinery.
>
> Base: `origin/dev`, branch `design/ast-native-plugins`.
> Supersedes the mechanics (not the principles) of
> `spec/R6-plugins-compat-modules.md`, which was written against the older
> `tree2-cleanroom` snapshot (`bridgeToTree2` / `ValueService` / async
> record-replay). Those layers no longer exist on `dev`: the public route is
> each dialect's `parse()` reduction directly to `Stylesheet`, followed by the
> retained Context/plugin dispatch and canonical evaluation/render. This spec
> re-expresses R6's Part A/B/C for that public shape and adds the piece R6
> hand-waved: a **scope-frame-aware function registry**.

> **Architecture correction (2026-07-22).** Any `parseToAst` or “direct build
> host” wording that remains below is historical shorthand and is not an API or
> an implementation stage. Plugin design consumes the public `Stylesheet` from
> a dialect parser; it does not create, preserve, or replace a parser host,
> bridge, or second source-loading path. Context remains the sole plugin/import
> dispatcher.

## HARD constraints (non-negotiable)

- **NO dependency on `@jesscss/plugin-less-compat`.** The subsystem lives in
  `ast/` (engine value/serialize domain) plus one new sibling package for the
  Less-branded shim. It never imports the compat package. (Adversarial check at
  the end confirms this.)
- **NO legacy `tree/` eval.** No `../tree` `Node`, no `arg.eval(this)`, no
  `toLessNode`/`fromLessNode` whole-tree bridge, no `Rules.setFunctionBinding`.
  Everything speaks `ast/` plain-data nodes (`ast/nodes.ts`) and `ValueObj`
  (`ast/value-eval.ts`).
- **Zero cost when idle.** A document with no `@plugin` and no configured
  plugins must render byte-for-byte identically at today's cost. Every new seam
  is gated on real work (a `@plugin` directive present, or a plugin registered).

---

## Executive summary

Real Less plugins are small JS modules that do exactly four things:

1. `functions.add(name, fn)` / `functions.addMultiple({…})` — register custom
   functions (the overwhelming majority: `plugin-global`, `-local`, `-simple`,
   `-scope1/2`, `-collection`, `-transitive`, `-tree-nodes`).
2. `install({ tree, visitors }, manager)` + `manager.addVisitor(v)` with
   `isPreEvalVisitor` / `isReplacing` — a **pre-eval** node rewrite
   (`plugin-preeval`).
3. `manager.addPostProcessor(p)` — rewrite the final CSS string
   (`clean-css` in `plugin-module`).
4. `registerPlugin({ install, setOptions, use })` + node factories
   (`less.dimension`, `new tree.Anonymous`, `less.value`, …) to build return
   values.

The native subsystem is therefore **four small seams**, in dependency order:

- **Lane 1 — scope-frame function registry.** Function resolution becomes
  per-`Frame` with parent-chain fallback, so a `@plugin` inside `.local{}`
  registers functions visible only in that subtree. This is a native,
  cutover-aligned refactor of the flat global `FnRegistry` — it is worth
  building *regardless of plugins* because it is the correct home for `@use`
  module functions and scoped `.jess` functions too. It is the load-bearing
  seam and everything else layers on it.
- **Lane 2 — a minimal native `less`/`tree` shim** (new package
  `@jesscss/plugin-less`, distinct from the retiring `-less-compat`): the
  smallest node-factory surface an existing Less-authored plugin needs, with
  conversion to/from `ValueObj` **at the call boundary only**. Re-homes the
  genuinely-reusable *mechanics* (`LessTreeConstructors` factories, the
  return-value reducer, the `new Function(...)` loader) as fresh, tree-free code.
- **Lane 3 — a gated pre-eval pre-walk** over `ast/` plain-data nodes, run in
  the driver before `serialize`, feeding the `(node) => Node | void` contract.
- **Lane 4 — a post-process-CSS reducer** over the serialized string, run in the
  driver after `serialize`.

Module resolution for `@plugin "specifier"` (local path + `node_modules`) is
native to the driver (`createRequire` + a candidate-extension probe), re-homed
from the compat package's directive handler.

**v5 narrows the plugin API.** Per owner memory (`backtick-JS-removed`,
`import-atrule-semantics-less-vs-jess`, `namespace-access-use-compose-model`),
`@plugin` is **deprecated → `@use`**, and inline backtick JS is gone. So the
adapter is a **compatibility surface for existing `.less` plugins only**, not a
growth API. That caps its size: it must service the four call shapes above and
nothing more — no new node types, no whole-tree visitors, no `ctx`/`frame`
exposure. `@use` (the successor) does not need the `less.tree` shim at all; it
loads an ES module whose exports register through the *same* Lane 1 registry
seam. So investment in the shim is bounded and terminal.

---

## Lane 1 — Scope-frame-aware function registry (the load-bearing seam)

### Today

`serialize` threads ONE flat evaluator: `Emit.ev: ValueEvaluator | null`.
`evalCall` (`serialize.ts:1317`) calls `ev.call(name, list, modes)`, which
consults a single global `FnRegistry` map (`value-dispatch.ts`) built once by
`makeBuiltinRegistry()`. The `Frame` chain (`serialize.ts:173`) carries
`mixins` / `vars` / `rulesets` per scope but **function resolution ignores the
frame entirely.** There is no way for a function to be visible in one subtree
and not another — which the `plugin` fixture requires for byte-identity.

### Target data structure

Add ONE nullable field to `Frame`:

```ts
export interface Frame {
  parent: Frame | null;
  mixins: Map<string, MixinDef[]> | null;
  vars: Map<string, Binding[]> | null;
  // … existing fields …
  // [plugin] functions registered by a `@plugin` (or, later, `@use`) directive
  // textually inside THIS frame's block. null unless this exact block loaded a
  // plugin. Keyed lower-case, like the global registry. Values are native
  // `Fn` specs (ast/functions/types.ts) — a plugin-supplied fn is adapted to a
  // native Fn at load time (Lane 2), so the dispatch path is uniform.
  fns?: Map<string, import('./functions/types.js').Fn> | null;
}
```

`fns` is a plain `Map`, not a chained `FnRegistry`, because the *chain* is the
`Frame.parent` chain that already exists. No parallel scope structure.

### Lookup path

A named call resolves in this order (nearest-first, then global built-ins):

```
evalCall(node, frame, e):
  1. for (f = frame; f; f = f.parent)
       if (f.fns && f.fns.has(lname)) return dispatchNative(f.fns.get(lname), args, ctx)
  2. return e.ev.call(name, list, modes)   // built-ins + unknown-verbatim, unchanged
```

The frame walk is the ONLY addition to the call path. To keep the seam clean,
express it as a resolver closed over the frame rather than reaching into
`Frame` from the evaluator:

- Extend `ValueEvaluator.call` to `call(name, args, modes, scope?)` where
  `scope?: FnScope` is `{ lookup(name): Fn | undefined } | null`.
- `evalCall` (which HAS the frame) builds `scope` = a thin object that walks
  `frame.fns` up the parent chain; passes it to `ev.call`.
- Inside `buildEvaluator`'s `call`, consult `scope?.lookup(name)` FIRST; on a
  hit, dispatch it through the same `dispatch`/`stringify`/`modes` machinery as
  a built-in (a plugin `Fn` is a normal `Fn` spec by the time it is here); on a
  miss, fall through to the existing `registry.has(name)` global path unchanged.

### Where built-ins live (the perf answer)

Built-ins stay in the evaluator's **global** `FnRegistry` map, exactly as today.
They are NOT copied into the root `Frame.fns`. Rationale:

- The common case — no `@plugin` anywhere — leaves `frame.fns === null` at every
  frame, so `scope` is `null`, so the frame walk never runs and `ev.call` takes
  the identical global-map path it takes now. **No regression on the hot path**
  (one extra `scope == null` branch that the JIT folds; measured levers in
  memory are parse/build/extend, not fn dispatch).
- Frame-local `fns` maps are allocated ONLY for blocks that actually loaded a
  plugin (or, later, `@use`). In the `plugin` fixture that is a handful of
  frames out of the document; everywhere else `fns` is `null`.
- The frame walk is O(depth-to-nearest-`fns`) and short-circuits at the first
  frame that has ANY `fns` map. Blocks with no plugin ancestor never enter the
  loop body (their `scope.lookup` immediately hits the global fallback). To make
  even the "has some plugin somewhere" case cheap, gate `scope` construction on
  a document-level flag: `e.anyPluginFns` (set true only if `collectPluginFns`
  ran non-empty anywhere); when false, `evalCall` passes `scope = null` and the
  walk is skipped entirely.

### How a `@plugin` registers into the right frame

Frames are already built by pre-scanning a block's `statements`
(`collectMixins` / `collectVars` at `serialize.ts:211,233`). Add a **peer
pre-scan** `collectPluginFns(statements, loadCtx)`:

- Runs when a frame is constructed, BUT gated: skip unless the statement list
  contains a `@plugin` directive (a cheap `type === 'AtRuleStatement' &&
  name === 'plugin'` scan; most blocks have none, so this is one linear check
  that usually short-circuits on the first non-match — or, better, precompute a
  per-block boolean at build time so the scan is O(1) at frame construction).
- For each `@plugin`, resolves + loads the module (module resolution below),
  drives its `functions.add`/`addMultiple` and `registerPlugin` through the
  Lane 2 shim, and collects the resulting native `Fn`s into this frame's `fns`
  map.
- Because this runs at frame construction — *before* any leaf in the block is
  emitted — the registered functions are visible to every declaration in the
  block regardless of source order, matching Less (which processes `@plugin` in
  a pre-eval pass). This mirrors how `collectVars` builds the whole scope's
  stacks up front so forward references resolve.
- The `@plugin` directive node itself is marked non-emitting: treat `@plugin`
  like `MixinDef`/`VarDeclaration` in the emit switch (`serialize.ts:1711`) — a
  statement that contributes scope but no bytes.

**Scope boundary semantics (the fixture's core requirement).** The frame that a
`@plugin` registers into is the frame of its **lexically enclosing block**:

- Stylesheet-level `@plugin` (including one reached transitively through an
  `@import`ed file that is spliced at root — `plugin-transitive`) registers into
  the **root frame** → global visibility. The import splice puts the imported
  `@plugin` statement into the root children before frame construction, so
  `collectPluginFns(root.children)` picks it up as root-global for free.
- `@plugin` inside `.class .local{}` registers into that Rule's frame → visible
  to `.local`'s leaves and its descendants, NOT to the ancestor `.class`
  (whose own `test-local()` stays an unknown call → emitted verbatim, exactly
  what `plugin.css` shows: `local: test-local();`). `test-shadow` resolves
  nearest-first → `local` inside `.local`, `global` in `.class`.
- `@plugin` inside a **mixin body** (`.mixin()`) or **detached ruleset**
  (`@ruleset`) registers into that body's definition frame. When the body is
  expanded into a call site, the body's own frame (carrying its `fns`) is the
  one walked, so `mixin-local`/`ruleset-local` resolve to `local`; but the
  plugin does NOT leak into the call-site's `.class` frame (`class-local:
  test-local()` stays verbatim). This falls out of the design: `fns` lives on
  the definition/body frame, and mixin expansion walks the shared body under a
  frame chained to the definition scope, never grafting `fns` onto the caller.
- `@plugin` inside an at-rule block (`@media screen { @plugin …; result:
  test-local() }`) registers into the media block's frame → local visibility
  there. `@media`/`@font-face` bodies that only *use* a root-global function
  (`result: test-global()`) resolve it through the parent chain up to root.

This is pure lexical scoping over the existing `Frame.parent` chain — no new
scoping concept, no subtree marking.

### Unit test shape (proves scoped resolution with ZERO plugin loading)

The seam is testable without any `@plugin` JS by registering native `Fn`s
directly onto frames. In `ast/parse-host/__tests__/`:

```ts
// scoped-fn-registry.test.ts — Lane 1 in isolation, no module loading.
it('resolves a function only within the frame that registers it', () => {
  // A native Fn that returns keyword "scoped".
  const scopedFn: Fn = { name: 'scoped', params: [], variadic: true,
    body: () => makeKeyword('scoped') };
  // Inject via a test hook that seeds a named block's Frame.fns
  // (e.g. an options.seedFrameFns: Record<selectorKey, Fn[]> on renderAstDoc,
  //  test-only, OR a direct serialize() call with a hand-built Stylesheet+Frame).
  const src = `
    .outer { a: scoped(); }
    .inner { .mid { a: scoped(); } }
  `;
  const css = renderScopedTest(src, { seedInto: '.inner .mid', fns: [scopedFn] });
  // .inner .mid sees "scoped"; .outer does NOT → emits verbatim "scoped()".
  expect(css).toContain('.inner .mid {\n  a: scoped;');
  expect(css).toContain('.outer {\n  a: scoped();'); // unknown → verbatim
});

it('nearest frame shadows an ancestor registration (test-shadow semantics)', () => {
  // root registers globalFn('shadow') → "g"; .local registers localFn('shadow') → "l"
  // assert .local emits "l", sibling emits "g" — pure parent-chain nearest-first.
});

it('idle path is untouched: no seeded fns ⇒ byte-identical to a plain render', () => {
  // same source rendered with and without the Lane-1 field present ⇒ identical bytes,
  // and (guarded) the frame walk never runs (e.anyPluginFns === false).
});
```

These pin scoping (visibility + shadowing) and the zero-cost idle guarantee
before any Lane 2 mechanics exist.

---

## Lane 2 — Plugin-facing API boundary (minimal native shim)

### The real API surface (from the fixtures)

Enumerated from the actual plugin sources under `test-data/plugin/`:

| Call in plugin JS | Used by | Native mapping |
|---|---|---|
| `functions.add(name, fn)` | most | wrap `fn` as a native `Fn`, add to the loading frame's `fns` |
| `functions.addMultiple({…})` | `-global`, `-tree-nodes` | loop `add` |
| `registerPlugin({ install, setOptions, use })` | `-local`, `-set-options`, `-preeval` | drive lifecycle; `install(less, mgr, functions)` |
| `manager.addVisitor(v)` | `-preeval` | Lane 3 pre-eval registry |
| `manager.addPostProcessor(p)` | `clean-css` | Lane 4 reducer |
| `new tree.Anonymous(str)` | `-global`, `-local`, `-transitive` | → `makeKeyword(str)` |
| `less.dimension(n[,unit])` | `-simple`, `-tree-nodes` | → `makeDimension(n, unit)` |
| `less.value([…])` | `-collection`, `-tree-nodes` | → `makeList(items, ',')` |
| `less.color([r,g,b])` | `-tree-nodes` | → `makeColorRgb(...)` |
| `less.quoted(q, str)` | `-tree-nodes` | → `makeQuoted(str, q, false)` |
| `less.keyword(str)` | `-tree-nodes` | → `makeKeyword(str)` |
| `less.atrule(name, value)` | `-tree-nodes` | → statement-context `AtRuleStatement` node |
| `less.combinator(' ')` | `-tree-nodes` | → statement no-op / keyword |
| raw `number` return | `-simple` (`pi-anon`) | → `makeDimension(n)` (matches `3.141592653589793`) |
| raw `string` return | `-scope1/2` (`'foo'`) | → `makeKeyword(str)` |
| `true`/`false` return | `-collection` (`store`), `-tree-nodes` (`test-collapse`) | statement context → drop (no output) |

### The smallest adapter

**Two functions at the call boundary — NOT a whole-tree bridge:**

1. **`fromValueObjArgs(list: ValueList) → less.tree-view args`** — when a
   plugin fn is invoked, convert each `ValueObj` argument to the field shape the
   Less fn reads (`.value`, `.unit`, `.rgb`, `.type`). This is a *shallow*,
   per-arg projection built from the `LessTreeConstructors` plain-object
   factories (re-homed, see below). No subtree materialization: args are leaf
   values (`Dimension`/`Color`/`Quoted`/`Keyword`/`List`), so the projection is
   a flat field copy. Most fixture fns ignore args or read `.value` off one arg
   (`store(@var)`, `test-atrule(a; b)`).

2. **`toValueObjReturn(ret, { statementContext }) → ValueObj | undefined`** —
   convert the plugin's return into a native `ValueObj`, per the table above.
   This is the native re-home of `fromLessPluginReturnValue`
   (`transform/from-less.ts:152`): same branch logic (number → dimension,
   boolean+statementContext → drop, `{type}` object → node, `toCSS()` →
   keyword-of-bytes, fallback → keyword-of-String), but it produces `ValueObj`
   via `value-factory` instead of legacy `Any`/`tree` `Node`.

A plugin fn is wrapped ONCE at load into a native `Fn`:

```ts
// pseudo — lives in @jesscss/plugin-less, imports only ast public value API.
function wrapLessFn(name: string, fn: LessFn): Fn {
  return {
    name,
    params: [],
    variadic: true,               // receives the whole arg List; plugin reads what it wants
    body: (list, ctx) => {
      const lessArgs = fromValueObjArgs(list);       // shallow leaf projection
      const ret = fn.apply(pluginThis(ctx), lessArgs);
      return toValueObjReturn(ret, { statementContext: isStatementCtx(ctx) })
        ?? NIL;                    // dropped (false in statement ctx) ⇒ emits nothing
    },
  };
}
```

Note the async record/replay and `arg.eval(this)` dance from the compat layer
(`plugin.ts:56-79`) is GONE: `ast/` args arrive already materialized as typed
`ValueObj` (the serialize walk evaluated them), so there is no unevaluated node
to `eval`. This is a direct consequence of the single-pass engine and is the
main simplification over the bridge.

### Re-homed vs written fresh

**Re-homed mechanics** (copied as tree-free code into `@jesscss/plugin-less`, no
import of `-less-compat`):

- The `LessTreeConstructors` plain-object node factories
  (`less-compat-structures.ts`) — they already do NOT subclass `../tree`; they
  build `{ type, …fields, accept, toCSS }` plain objects. Re-home the subset the
  fixtures touch (`Anonymous`, `Dimension`, `Color`, `Quoted`, `Keyword`,
  `Value`, `Call`, `DetachedRuleset`, `AtRule`). These back the `less.*` /
  `tree.*` surface the plugin sees.
- The `createLessMock(functionRegistry)` shape — the `less` object with
  `less.dimension`/`less.value`/`less.color`/… helpers and `less.tree`.
- The `new Function('module','require','registerPlugin','functions','tree',
  'less','fileInfo', src)` CJS loader (`plugin.ts:615-645`) — the sandbox that
  runs a user-chosen plugin file. Re-home verbatim; it has no tree dependency.
- The return-value reducer logic (`fromLessPluginReturnValue`) — re-expressed
  against `value-factory`.
- `setOptions`/`install`/`use` lifecycle ordering (`plugin-manager.js` +
  `plugin.ts:1049-1063`): `setOptions(opts)` before AND after registration,
  `install(less, mgr, functions)`, `use()`.

**Written fresh:**

- `fromValueObjArgs` / `toValueObjReturn` (the `ValueObj` ⇄ less-view boundary)
  — the compat `to-less`/`from-less` transforms are whole-tree, legacy-`Node`
  coupled; the native versions are shallow, leaf-only, `ValueObj`-based.
- The frame-local registration sink (`functions.add` → `Frame.fns`) instead of
  `Rules.setFunctionBinding`.
- The `PluginManager`-lite (visitor + postProcessor collectors) — a ~40-line
  object, not the compat class, since the native manager only needs
  `addVisitor` (Lane 3) + `addPostProcessor` (Lane 4) + `installedPlugins`.

### Package placement

New package **`@jesscss/plugin-less`** (already reserved in the workspace per
`packages/jess-plugin-less/`; confirm it is the right home or create a focused
`@jesscss/less-plugin-runtime`). It depends on `@jesscss/core` (for the public
`value-factory` + `Fn` types + node factories) and `@jesscss/plugin-node-modules`
(resolution), NOT on `@jesscss/plugin-less-compat`. The core `ast/` engine
depends on NEITHER — it exposes the `FnScope` seam and the pre-eval/post-process
hook edges; the `plugin-less` package is a downstream consumer that plugs into
them. Direction is always `plugin-less → core`, never `core → plugin-less`.

---

## Lane 3 — Pre-eval visitor phase

### The case

`plugin-preeval` registers a pre-eval **replacing** visitor
(`isPreEvalVisitor = true`, `isReplacing = true`) whose `visitVariable` rewrites
`@replace` → `Quoted("'", 'bar', true)`. It must run BEFORE the value walk, so
that when `--foo: @replace !important` is later evaluated the variable is already
the literal `bar`. `ast/` has no eval phase distinct from serialize, so this
cannot fold into the single pass (the pass never materializes an un-evaluated
whole tree mid-walk — same constraint R6 §A.3 identified).

### The seam: a gated pre-walk in the driver

Between parse+import-resolution and `serialize`, the driver runs an optional
structural pre-walk over the `ast/` plain-data node tree:

```
stylesheet = parse(src)                               // dialect public entry
resolved = stylesheet                                 // Context dispatches imports/plugins
if (preEvalVisitors.length)                            // HARD gate: empty ⇒ skip
  resolved = preWalk(resolved, preEvalVisitors)        // structural rewrite
css = serialize(resolved, { evaluator, … })            // the single pass
```

- `preWalk` feeds the settled `(node) => Node | void` contract at each node
  (enter, post-shape-pre-children); a returned node REPLACES, `void` leaves it.
  A per-type dispatch (`visitVariable`, `visitDeclaration`, …) is the CONSUMER's
  switch inside its `enter`, exactly as the Less `visitors.Visitor` wrapper does
  — core fires one generic edge.
- **Discovery of pre-eval visitors.** A `@plugin` that registers a pre-eval
  visitor via `install`/`addVisitor` must be discovered before the pre-walk. For
  document-level `@plugin` (the `plugin-preeval` case, at root), a cheap
  pre-scan of the root children for `@plugin` directives loads them (through the
  Lane 2 loader) and collects any `isPreEvalVisitor` visitors into
  `preEvalVisitors` before the pre-walk. The SAME load populates Lane 1 `fns`
  and Lane 4 postProcessors, so a plugin is loaded once and its three kinds of
  contribution are routed to their three sinks.
- **Leanness gate:** `preWalk` runs only when ≥1 pre-eval visitor exists.
  Pre-eval visitors are rare; the common document never walks pre-eval.
- **Scope of pre-eval registration.** Document-level (root) pre-eval visitors are
  fully supported. Scope-LOCAL pre-eval visitors (a `@plugin` inside a nested
  block registering a pre-eval visitor that should only rewrite that subtree) are
  an accepted edge — no published plugin needs it and the fixture is root-level.
  If ever needed, the pre-walk becomes subtree-scoped by the same frame boundary
  Lane 1 uses. Deferred, documented.
- The pre-walk operates on plain-data `ast/` nodes and lives in the driver /
  `plugin-less` package, NOT inside `serialize.ts`. The single pass and its emit
  edges are untouched.

### `Quoted` construction

The visitor builds `new Quoted("'", 'bar', true)`. Through the Lane 2 shim,
`tree.Quoted` maps to constructing an `ast/` `Quoted` *node* (`nodes.ts`), not a
`ValueObj` — because a pre-eval replacement is a NODE substitution in the tree,
which then evaluates normally (`'bar'` escaped → inner text `bar`). The shim's
node factory for the pre-eval path returns `ast/` structural nodes; the
value-call path (Lane 2) returns `ValueObj`. Two small factory tables, same
plain-object style.

---

## Lane 4 — Post-process-CSS seam

### The case

`plugin-module` does `@plugin "clean-css"`, which installs a **post-processor**
that minifies the final CSS string (`a { background: none }` →
`a{background:0 0}`). This runs on serialized output, after the whole walk.

### The seam: a reducer in the driver

```
css = serialize(...).css
if (postProcessors.length)                             // HARD gate
  css = postProcessors.reduce((cur, p) => p.process(cur, extra) ?? cur, css)
```

This is the native re-home of `runPostProcessors` (`plugin.ts:227-236`): iterate
the manager's collected post-processors, call `p.process(css, extra)`, keep the
string result. Post-processors are collected during the same document-level
`@plugin` load pass that feeds Lanes 1 and 3.

### Dependency flag (blocking for `plugin-module`)

**`clean-css` / `less-plugin-clean-css` are NOT installed.** `plugin-module`
cannot pass until the devDependency is added. Action for the phase that lands
`plugin-module`: add `clean-css` (and the `less-plugin-clean-css` wrapper the
`@plugin "clean-css"` name resolves to, via the `less-plugin-` prefix probe) to
the test workspace devDependencies. Until then `plugin-module` is
**blocked-on-dep**, not failing-on-design. Flagged here so the phase owner adds
it deliberately rather than discovering it as a mystery resolution failure.

---

## Module resolution for `@plugin "specifier"`

Native to the driver (re-homed from `plugin.ts:884-1032`), NO compat dependency:

1. **Normalize** the specifier (strip quotes/whitespace).
2. **Local path** — starts with `.`, `/`, or contains a path separator, OR
   resolves as a file relative to the importing file's directory. Probe
   candidates `[spec, spec.js, spec.cjs, spec.mjs]` against `dirname(filePath)`;
   first existing wins. Less also treats a *bare* name as a local file first
   (needed for `plugin-transitive`), so try the relative probe before npm.
3. **node_modules** — via `@jesscss/plugin-node-modules`'s `resolvePackage`,
   trying `[spec, 'less-plugin-' + spec]` (the Less prefix convention;
   `clean-css` → `less-plugin-clean-css`). Fall back to `createRequire(filePath)`
   `.resolve` when the node-modules plugin is absent.
4. **Load** the resolved file through the Lane 2 CJS sandbox
   (`new Function(...)`), passing the frame-scoped `functions` sink, the `tree`
   constructors, the `less` mock, `registerPlugin`, and `fileInfo`.
5. **Multi-load is allowed** — Less permits the same `@plugin` in different
   scopes; do NOT globally dedupe by path (breaks scoping; `plugin.ts:931`).

Resolution is invoked from `collectPluginFns` (scoped `@plugin`, Lane 1) and from
the document-level pre-scan (root `@plugin`, Lanes 3/4). The base directory is
the importing file's dir, threaded through the driver's existing `filePath`
(the `whole-doc-driver` already carries it for imports).

---

## Phasing + gating

Build order is Lane 1 first (everything depends on it), then the seams, then the
fixtures in ascending dependency.

| Phase | Deliverable | Fixture gate | Byte-identity note |
|---|---|---|---|
| **P1** | Lane 1: `Frame.fns` + `FnScope` on `evaluator.call` + nearest-first walk + `e.anyPluginFns` idle gate. | `scoped-fn-registry.test.ts` (native `Fn`s seeded onto frames, NO module loading). | Idle path must be byte-identical to pre-P1 render on the full alpha corpus (the `anyPluginFns === false` guard proves it). |
| **P2** | Lane 2 shim package `@jesscss/plugin-less`: `LessTreeConstructors` re-home, `less` mock, CJS loader, `wrapLessFn`, `fromValueObjArgs`/`toValueObjReturn`. + module resolution in driver. + `collectPluginFns` wiring `@plugin` → `Frame.fns`. | A focused `plugin-simple`/`plugin-scope*` micro-fixture first (pure `functions.add`, single scope). | `test-rule-simple` (`value: 3.141592653589793; value: 6.28318531`), `test-rule-conflicts` (foo/bar/foo across re-loaded scopes) byte-identical. |
| **P3** | Lane 3: gated pre-eval pre-walk + document-level `@plugin` pre-scan + `tree.Quoted` node factory. | **`plugin-preeval`** (`:root.two .one { --foo: bar !important; }`). | Full fixture byte-identity. |
| **P4** | Full **`plugin`** fixture: scoped registration across Rule / mixin-body / detached-ruleset / `@media` / namespace frames; global-vs-local shadowing; unknown-fn verbatim (`test-local()` in `.class`). | **`plugin`** (`collapseNesting: true` per its `styles.config.ts`). | The whole `plugin.css` is the gate — scoping correctness IS byte-identity here. Highest-value proof of Lane 1. |
| **P5** | Lane 4: post-process reducer + **add `clean-css` devDep**. | **`plugin-module`** (`a{background:0 0}`). | Blocked until the devDep lands; then byte-identical. |
| **P6 (deferred)** | `import/import` fixture. | `import/import`. | **Deferred to the serialize/prelude owner** — it is an `@import` structuring case, not a plugin case; it only shares this bucket because the prior fork grouped it. Track separately under the import/prelude thread. |

### Gating rules

- Each phase lands behind its fixture gate + the idle-path byte-identity check on
  the alpha corpus (Lane 1's guard makes "plugins present but this doc uses none"
  free).
- Lanes 3 and 4 are HARD-gated on registration: empty visitor / post-processor
  lists ⇒ the pre-walk / reducer never runs.
- `@plugin` emits a deprecation warning (→ `@use`) on `result.warnings`, per
  owner memory, re-homed from `warnForPluginDirective` (`plugin.ts:292`). This is
  orthogonal to byte-identity (warnings are out-of-band).

---

## Adversarial self-review

**Does it ever import `jess-plugin-less-compat`?** NO. The subsystem is
`ast/` (core: `Frame.fns`, `FnScope`, hook edges) + a new `@jesscss/plugin-less`
package that re-homes the reusable *mechanics* as fresh tree-free code and
depends only on `@jesscss/core` + `@jesscss/plugin-node-modules`. Core depends on
neither. No `../tree`, no `toLessNode`/`fromLessNode`, no `Rules.setFunctionBinding`,
no compat `less-compat-structures` import. The compat package can be deleted
after cutover with zero references from this design.

**Does the scope-frame registry regress the flat-registry perf?** NO,
by construction: built-ins stay in the global `FnRegistry` map (unchanged hot
path); `Frame.fns` is `null` on every frame unless a block loaded a plugin; the
`e.anyPluginFns` document-level flag makes `evalCall` pass `scope = null` and
skip the frame walk entirely for any document without plugins — which is every
document in the perf corpus (`benchmark.less` has no `@plugin`). The only added
cost on the hot path is one `scope == null` branch per named call, foldable by
the JIT and dwarfed by the parse/build/extend levers memory identifies as the
real ~70%. When plugins ARE present, the walk short-circuits at the nearest
`fns`-bearing frame (typically 0-2 hops).

**Is byte-identity on `plugin`'s scoping achievable?** YES. The fixture's every
scoping expectation reduces to nearest-first lookup over the existing
`Frame.parent` chain plus "unknown call → emit verbatim" (which the `ast/`
evaluator ALREADY does — `evaluator.ts:63`, and `plugin.css` literally expects
`local: test-local();` verbatim in `.class`). Global-vs-local shadowing,
non-leaking mixin/detached-ruleset plugin scope, media/namespace propagation, and
transitive-import global registration all fall out of lexical frame scoping with
no subtree marking. The one build requirement is that `collectPluginFns` runs at
frame construction (before the block's leaves emit), which parallels the existing
`collectVars`/`collectMixins` up-front scope build.

**Alignment with committed architecture.** Lane 1 is the object-reduction/cutover
spine: it is the correct home for `@use` module functions and scoped `.jess`
functions, so it is worth building independent of Less-plugin compat — it is not
scaffolding for a dying feature. The Less shim (Lane 2) is a bounded, terminal
compatibility surface for the *deprecated* `@plugin` API (v5 narrows `@plugin` →
`@use`, removes backtick JS), so it will never grow; `@use` reuses the same Lane 1
registry seam without any `less.tree` shim. Lanes 3/4 are gated, idle-free hook
edges consistent with the single-pass, least-weight serialize design.
