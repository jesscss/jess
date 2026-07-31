# Less built-in functions

The Less dialect's function set, on the **value domain** (no legacy `../tree`
node, no re-parse, no `render()` walk).

## Layout

- **`<fn>.ts`** — one module per fn, each exporting a self-describing callable
  `Fn` via `defineFunction(name, spec)`. One module per fn so a browser bundle
  tree-shakes: a stylesheet that never calls `pow` must not ship `pow`.
- **`index.ts`** — the Less dialect index: this folder's fns PLUS the `shared/`
  entries Less actually has. **This index is the registration unit.** There is
  no separate assembly array; `less/registry.ts` derives `lessFns` from the
  index's exports.
- **`registry.ts`** — `makeLessRegistry()`. Lives here, not in the package root,
  so a Less-only consumer never pulls the Sass index into its bundle.
- **`math-helper.ts`** — the shared math kernel (`applyMath` + the `unaryMath`
  spec builder) most number/unit math fns reduce to a one-liner over.
- **`color-helper.ts` / `color-ctor-helper.ts`** — the shared color kernels
  (`mixColors`, `colorBlend`, `getLuma`, `toHsv`, channel clamping) the mixers,
  blend modes, readers and constructors reduce to. Each Photoshop-style blend fn
  (`multiply`/`screen`/`overlay`/…) is a one-liner over `colorBlend` plus its
  per-channel `mode` (overlay reuses multiply+screen, hardlight reuses overlay).
  The HSL adjusters reduce to a `[h,s,l]` tweak → `makeColorHsl(...)`.
- **Core list capability** — structural group access (`groupItems`,
  `groupSeparator`, `listValueAt`) belongs to `@jesscss/core`; `min-max.ts`
  owns only Less's unit-grouping policy. A variadic callable receives one typed
  `ValueGroup`: raw arrays are the default spaced form, while explicit `List`
  values carry only comma/slash boundaries.
- **`shared/` vs here** — `shared/` is only for fns whose behaviour is IDENTICAL
  in Less and Sass. Anything that differs stays in the dialect folder, which is
  why `min`/`max` are Less-owned even though `shared/math` also has a pair.

## Adding a function

1. Create `<fn>.ts` exporting `defineFunction('<fn>', { … })`.
2. Export it from `index.ts`.

That registers it. There is no third place to update.

## Handled by core, not by a fn module

`if`/`boolean`/`not`/`and`/`or`, `isdefined`, `isruleset` and `each` are
special-formed during serialization, in `core/src/ast/serialize.ts` — the
`isdefined` / `isruleset` branches live in `evalIntrospection`, and the
`if`/`boolean`/`not`/`and`/`or` set is the `LOGICAL_FNS` constant. Locate them
with:

```bash
grep -n "function evalIntrospection\|^const LOGICAL_FNS" packages/core/src/ast/serialize.ts
```

(Do not cite line numbers here — `serialize.ts` is ~13.6k lines and hard-coded
line refs in this file have rotted twice.) Fn modules for them were dead in the compiled path and
have been deleted — do not re-add one.

Validate output against real Less 4.x / v5-alpha semantics; if an expected
output looks stale, flag it — don't match it.
