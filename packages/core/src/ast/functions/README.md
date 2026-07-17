# tree2 built-in functions

Boundary-clean Tier-A functions rewritten on the **tree2 value domain** (no legacy
`../tree` node, no re-parse, no `render()` walk). They replace `@jesscss/fns`'s
`instanceof`-coercion path for the values they cover, and are gated byte-identical
against that adapter (the oracle) in
`tree2-frontend/__tests__/native-value-differential.test.ts`.

## Layout

- **`<fn>.ts`** — one module per fn, each exporting a self-describing
  `Fn` (`{ name, params, body }`). One module per fn so a browser bundle
  tree-shakes: a stylesheet that never calls `pow` must not ship `pow`.
- **`math-helper.ts`** — the shared `mathHelper` kernel (`applyMath` + the
  `unaryMath` spec builder) most number/unit math fns reduce to a one-liner over.
- **`list-helper.ts`** — the shared LIST / VARIADIC kernel: `coerceListItems`
  (recovers list structure from a flattened `Word`'s bytes so `length`/`extract`/
  `min`/`max` see the real elements), `verbatimCall`, and the Less-4.x `minMax`
  reducer. A fn marked `variadic: true` (in its `FnSpec`) receives the whole arg
  `List` (items + separator) instead of positionally-bound params.
- **`color-helper.ts`** — the shared color kernels (`mixColors`, `colorBlend`,
  `getLuma`, `toHsv`) the color mixers/blend-modes/readers reduce to. Each
  Photoshop-style blend fn (`multiply`/`screen`/`overlay`/…) is a one-liner over
  `colorBlend` + its per-channel `mode` (overlay reuses multiply+screen, hardlight
  reuses overlay). The hsl adjusters instead reduce to
  a `[h,s,l]` tweak → `makeColorHsl(...)` one-liner over the value-factory. A named
  color reaches these fns as a materialized `Color` via `tree2/color-names.ts`.
- **`types.ts`** — the `Fn` / `FnSpec` / `ParamSpec` contract.
- **`index.ts`** — the single assembly point (`FN_LIST`). `value-dispatch.ts`
  turns it into the dispatch Map.

## Adding a function (the 3-line recipe)

1. Create `functions/<fn>.ts` exporting `export const <fn>: Fn = { … }`.
2. `import { <fn> } from './<fn>.js';` in `index.ts`.
3. Add `<fn>` to `FN_LIST`.

Then add a case per fn to the differential test (adapter = oracle). Validate the
output against real Less 4.x semantics; if a golden looks stale, flag it — don't
match it.

## The ponytail ladder

Before writing bespoke code, walk: (1) does the fn need to exist / can the
evaluator already do it? (2) reuse a value primitive/helper (`numOf`, `applyMath`,
the serializer's `round`)? (3) stdlib (`Math.*`)? (4) a native language feature?
(5) an existing dep? (6) one line? (7) only THEN a minimal implementation. Most
math fns are a `Math.*` one-liner — write them that way. The non-negotiable floor
("lazy not negligent"): byte-identity, the module boundary, and correct edge-cases
(unit handling, NaN/Infinity, angle normalization) are never cut for brevity.
