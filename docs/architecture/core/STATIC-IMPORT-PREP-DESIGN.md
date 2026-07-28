# Static Import Preparation Design

Status: active design note for Less alpha performance work. The first slice has
landed: core exposes a reusable prepared-import plan, `serialize(...)` can
consume it, and `Compiler.compile()` returns it. Further work is still needed
before this becomes a one-shot render speedup.

## Problem

`Compiler.compile()` prepares the entry stylesheet and now returns a
prepared-import plan for static import facts it can resolve during compile. A
caller that passes that plan to `serialize(...)` avoids calling
`Context.loadImport(...)` again during that render. Later renders can also reuse
parsed `Context.sourceTrees`, and `Context.loadImport(...)` memoizes
already-loaded imports for the same authoring source.

This is not yet the full first-render target. The prepared plan still reuses the
serializer's existing import planner, so it moves import loading out of render
and removes loader calls during prepared renders, but it does not eliminate the
planner walk or all import-related render work.

That is acceptable for alpha.1, but it is not the target architecture. Compile
should own static graph preparation; render should consume prepared typed import
facts and fall back only for dynamic import targets that need render-time
bindings.

## Non-Goals

- Do not reparse source text or import spans.
- Do not add a compiler-side evaluator for import paths, options, media tails,
  variables, or Less-specific interpolation.
- Do not make import nodes carry mutable loaded-document state.
- Do not collapse Less import semantics into a path cache. `reference`,
  `multiple`, `less`, `inline`, CSS-terminal imports, and imported document
  source context remain semantic facts.

## Required Shape

The safe implementation should reuse the serializer's existing import request
machinery:

- `importSpecifier(...)` owns resolver-facing target extraction, including
  quoted targets, `url(...)`, and retryable unresolved interpolation.
- `evalBytesSync(...)` / `evalQueryPreludeSync(...)` own option and tail bytes.
- `planImportedExtends(...)` already handles source-order variable publication,
  deferred unresolved import paths, nested at-rule bodies, imported callable
  facts, `reference` hiding, and `multiple` de-duplication.

The preferred API is therefore a core-owned preparation step, not a compiler
duplicate:

```ts
const plan = await prepareStaticImports(document, {
  context,
  collapseNesting,
  pluginHost,
  io
});

const result = await serialize(document, {
  context,
  preparedImports: plan,
  collapseNesting,
  pluginHost,
  io
});
```

The exact names are open, but the ownership is not: core evaluates typed import
facts once, the driver supplies document loading, and render consumes the
prepared result without asking `Context.loadImport(...)` again for those import
nodes.

## Open Design Points

- The prepared plan probably needs to carry more than a
  `WeakMap<ImportAtRule, PlannedImportDocument>`. Extend planning also computes
  hidden reference subjects and overlay instructions. Reusing only loaded
  documents may still rerun expensive extend planning.
- A prepared plan must be scoped to one `Context` and one root document. It must
  not be global or reusable across independent compiler sessions.
- A prepared plan is reusable across renders for the same compiled document, so
  render must not mutate a caller-owned plan while consuming it.
- Dynamic imports that throw `ImportPathNotReady` during preparation must remain
  render-time requests. A prepared plan needs an explicit "not prepared" state,
  not a cached failure.
- Imported document context must remain correct for nested imports and deferred
  callable bodies. Prepared entries need the same `withinDocument` behavior that
  `importThroughContext(...)` returns today.
- Public `Compiler.render(file)` can eventually call the same preparation before
  render, but that mostly moves work from `renderAstStylesheet` into preparation
  unless it also prevents duplicate planning. The larger user-visible win is
  `compile()` followed by one or more renders of the compiled document.

## Proof

Add focused tests before claiming the lane:

- Compiling a static root import graph populates the plan for root and nested
  imports without emitting CSS.
- Rendering with a compile-prepared plan does not call `Context.loadImport(...)`
  / `Context.getTree(...)` for prepared static imports.
- A caller-owned prepared plan can be reused for another render of the same
  compiled document.
- A dynamic interpolated import target that is not ready during preparation
  remains a render-time request/error.
- `reference`, `multiple`, and `(less)` imports keep current output and lookup
  behavior.
- Nested imports resolve relative to the imported document that authored them.

Bootstrap evidence should be reported in two columns: total `Compiler.render()`
time and compiled-document `serialize()` time. Do not sell a one-shot speedup
unless the total render measurement improves.
