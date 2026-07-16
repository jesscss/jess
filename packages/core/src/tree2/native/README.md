# tree2 native functions

Boundary-clean Tier-A functions rewritten on the **tree2 value domain** (no legacy
`../tree` node, no re-parse, no `render()` walk). They replace `@jesscss/fns`'s
`instanceof`-coercion path for the values they cover, and are gated byte-identical
against that adapter (the oracle) in
`tree2-frontend/__tests__/native-value-differential.test.ts`.

## Layout

- **`<fn>.ts`** — one module per fn, each exporting a self-describing
  `NativeFn` (`{ name, params, body }`). One module per fn so a browser bundle
  tree-shakes: a stylesheet that never calls `pow` must not ship `pow`.
- **`math-helper.ts`** — the shared `mathHelper` kernel (`applyMath` + the
  `unaryMath` spec builder) most number/unit math fns reduce to a one-liner over.
- **`types.ts`** — the `NativeFn` / `FnSpec` / `ParamSpec` contract.
- **`index.ts`** — the single assembly point (`NATIVE_FN_LIST`). `value-dispatch.ts`
  turns it into the dispatch Map.

## Adding a function (the 3-line recipe)

1. Create `native/<fn>.ts` exporting `export const <fn>: NativeFn = { … }`.
2. `import { <fn> } from './<fn>.js';` in `index.ts`.
3. Add `<fn>` to `NATIVE_FN_LIST`.

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
