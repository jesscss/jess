# Less API bridge design

## Purpose

This package is the Jess-side home for Less compatibility bridges that need to
participate in Jess parsing, evaluation, or value conversion. The Less.js
wrapper may expose Less-shaped public API names, but Jess should own the
semantics of how those APIs become compiler behavior.

The immediate design question is where a future Less 4 compatibility surface
for `less.functions`, `less.tree`, and plugin-returned Less values should live.
The answer is:

- Less.js owns the user-facing wrapper and release surface.
- Jess owns the bridge semantics.
- Less.js may re-export or wire Jess-provided facades once this package provides
  a real bridge.

Do not add ad hoc Less tree constructors to the Less.js wrapper unless they are
part of a documented protocol implemented and tested here.

## Current state

Today `@jesscss/plugin-less-compat` supports native AST-v2 function
contribution and Less-style function-registration plugins:

- callers pass typed `Fn` values from `@jesscss/core`;
- Less-style plugins can register functions through
  `install(less, manager, functions)`;
- function bodies receive Jess typed values and `FnCtx` capabilities;
- the package does not support Less 4 visitor plugins, process-global
  `functionRegistry` callbacks, a broad Less `tree` node facade,
  post-processors, file-manager plugins, or arbitrary Less `@plugin` script
  runtime behavior.

`@jesscss/plugin-less` currently owns the Less language adapter work needed by
the compiler route: Less parsing, Less-style plugin installs passed through
compiler config, contextual `@plugin` module loading, and conversion between
Less-plugin return values and Jess values for that path.

That split is acceptable only while this package remains the narrow native
function contribution package. If this package grows into the public Less
compatibility package, it needs to own the compatibility protocol explicitly.

## Boundary

### Less.js monorepo should own

- The public `less` package facade: `render`, `renderFile`, `lessc`, version,
  package metadata, and release gates.
- Mapping Less render options to Jess compiler config.
- Mapping Jess render results, diagnostics, imports, and warnings back to
  Less-style result objects.
- Tests that prove Less users see the intended public API and error/result
  shapes.
- Documentation that a compatibility API is present, absent, or intentionally
  limited for a given alpha.

### Jess monorepo should own

- Any value that must be interpreted by the Jess evaluator.
- Conversion between Less-shaped values and Jess AST-v2/value nodes.
- Lazy materialization of compatibility structures so Less-shaped wrappers,
  child nodes, and converted values are built only when plugin code actually
  asks for them.
- Function registration semantics, including lower-casing, lookup, install-time
  registration, and render-time availability.
- Less plugin install/runtime adapters.
- Less `tree` constructor facades when those constructors are accepted as plugin
  return values.
- Visitor, file-manager, pre/post-processor, and `@plugin` script compatibility
  if those routes are supported.
- The test matrix proving Less-shaped values round-trip through Jess semantics.

## Bridge responsibilities

A real Less API bridge needs to do the following.

### 0. Stay lazy by default

The bridge should materialize as little as possible:

- Do not eagerly convert a full Jess tree into Less-shaped nodes.
- Do not eagerly build child arrays, selector parts, declaration values, or
  function arguments unless plugin code reads them.
- Do not convert a Less-shaped return value back into Jess form until the
  evaluator needs to consume it.
- Cache lazy wrappers/conversions with identity-preserving maps where possible,
  preferably `WeakMap`, so repeated access is stable without pinning memory.
- Keep cheap metadata available, but defer expensive traversal, normalization,
  stringification, and child construction.

The compatibility layer is a boundary adapter, not a second AST. Its default
mode should be lazy facade + lazy conversion + precise materialization points.

### 1. Define Less-shaped public values

Provide or recognize Less-compatible constructor facades for at least:

- `Dimension`
- `Color`
- `Quoted`
- `Anonymous`
- `Expression` / value-list shapes
- `Keyword`-like anonymous values
- eventually detached rulesets and other plugin-visible nodes, if supported

These values must be plain enough for Less plugin authors to use in familiar
ways, but their meaning is defined by Jess conversion code, not by duplicate
Less-side evaluator logic.

Constructor facades should avoid building nested child structures up front. For
composite values, store the minimum raw payload and expose children through lazy
accessors or cached adapters.

### 2. Convert Less values into Jess values

When a Less plugin or function returns a Less-shaped value, convert it at the
Jess boundary into a typed Jess value:

- numbers and dimensions become Jess dimensions with correct number/unit data;
- colors become Jess colors with correct RGB/alpha/serialization behavior;
- quoted and anonymous values preserve escape/quote/raw byte intent;
- lists/expressions preserve separator and grouping where Less exposes it;
- unknown objects fail with a useful diagnostic or degrade only where Less
  compatibility explicitly allows that behavior.

The conversion must be centralized. Less.js should not independently guess this
protocol.

Conversion should be demand-driven. If a plugin returns a compound Less-shaped
value, convert only the parts required by the receiving Jess operation, then
cache the result at the boundary where identity matters.

### 3. Convert Jess values into Less plugin arguments

Less plugin callbacks expect Less-style objects:

- dimensions expose `value`, `unit`, and numeric coercion behavior;
- colors expose Less-compatible fields;
- quoted/anonymous values expose `value`, quote/escape metadata, and useful
  string coercion;
- lists/expressions expose the shape Less plugins expect.

This is the inverse of the return-value bridge. Argument conversion and return
conversion must be tested together.

Argument conversion should wrap Jess values lazily. A plugin receiving a Less
value object should not force conversion of every nested child unless it reads
those children.

### 4. Bridge function registration

Support the relevant Less function registration surfaces deliberately:

- install-time plugin registry passed to `plugin.install(less, manager,
  functions)`;
- optional process-global `less.functions.functionRegistry`, if Less.js chooses
  to expose it for compatibility;
- `add`, `addMultiple`, and `get` behavior;
- case-insensitive names matching Less expectations;
- cache invalidation or compiler-cache key behavior when global registrations
  change.

If global function registration is supported, this package should expose a
facade or adapter for Less.js to wire, rather than Less.js owning the registry
semantics itself.

### 5. Decide the `less.tree` facade contract

`less.tree` can be exposed from Less.js only once this package answers:

- Which constructors exist in the alpha?
- Are constructors exported directly from this package, returned by a helper,
  or passed only to plugin install callbacks?
- Are the objects nominal classes, structural objects, or both?
- Which fields and coercion methods are compatibility contract?
- How does Jess distinguish supported Less-shaped values from accidental plain
  objects?

Until then, Less.js should leave `less.tree` absent rather than expose throwing
stubs or wrapper-local constructors.

### 6. Preserve compiler ownership

The bridge must not rebuild a second Less evaluator inside Less.js. All
evaluation, coercion, serialization, warnings, and diagnostics must remain
owned by Jess/core/plugin code.

The Less wrapper may construct a compiler config. It should not implement:

- unit math;
- color conversion;
- AST mutation semantics;
- selector behavior;
- function binding during evaluation;
- warning/error generation for Less value coercion.

### 7. Provide conformance tests

Add tests here first for the Jess-side bridge:

- Less plugin install receives `less.tree` constructors and a function registry.
- Registered functions receive Less-shaped arguments.
- Returned Less-shaped values render as expected CSS.
- Lazy conversion does not build unused child nodes or value wrappers.
- Repeated reads of the same child/value preserve identity where Less plugins
  reasonably rely on object identity.
- Returned invalid values produce stable diagnostics.
- Compiler cache behavior remains correct when function registrations change.
- The same bridge works through the public `jess` compiler route used by
  Less.js.

Then add Less.js wrapper tests proving the public facade is wired to this
package, not reimplemented there.

## Non-goals

- Reintroducing the archived legacy visitor proxy design as-is.
- Duplicating Less evaluator internals in the Less.js wrapper.
- Eagerly mirroring the full Jess AST as a Less AST before plugin code asks for
  it.
- Adding public `less.functions` or `less.tree` stubs that exist only for
  feature detection.
- Treating arbitrary Less plugin internals as supported before there is a test
  contract.

## Open decisions

- Should this package remain the native-function contribution package while
  `@jesscss/plugin-less` owns Less plugin/tree compatibility, or should this
  package become the public compatibility package for all Less bridges?
- If this package owns the bridge, should `@jesscss/plugin-less` depend on it,
  or should both share a lower-level adapter module?
- Should Less.js expose process-global `less.functions.functionRegistry` in v5,
  or only support plugin-scoped function registration through render/compiler
  options?
- What is the minimum `less.tree` constructor set required for the next alpha?

## Proposed next step

Keep Less.js alpha narrow for now: expose structured warnings and document the
compatibility gap, but do not expose `less.functions` or `less.tree`.

In Jess, choose the package ownership model, then implement the first bridge
slice here with tests:

1. A small Less value facade contract (`Dimension`, `Color`, `Quoted`,
   `Anonymous`).
2. Bidirectional conversion tests for function arguments and return values.
3. Lazy-wrapper tests proving unused children are not materialized.
4. A function-registry adapter used by Less plugin installs.
5. A public export or helper that Less.js can wire without owning conversion
   semantics.
