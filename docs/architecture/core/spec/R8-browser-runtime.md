# R8 — Browser runtime: exported variables → `var()` + a tree-shaken JS module

> DESIGN SPEC. Ledger row **A4** owns the rulings; this doc owns the plan and
> the slice contracts. The runtime-module output shares R7.4's per-kind emit
> refactor ([R7-dialects-endgame.md](R7-dialects-endgame.md) §R7.4) and R7.3's
> class-name scoping (§R7.3).

## Goal (owner, 2026-11-01, verbatim)

> *"root-level variables get marked with `@export` / `@-export`."*
> *"Every value that uses this variable or relies on it would instead get
> var(--generated-something, [value-at-compile]). So this would require
> dependency tracking of all the functions / transforms that happen."*
> *"all functions / transforms would be identified to be placed in a JS bundle,
> tree shaken."*
> *"Compiling in Vite / Rollup and whatnot would therefore produce .css and a
> .js tiny bundle module with an API."*

## Owner rulings, 2026-11-01

| # | Ruling | Verbatim |
| --- | --- | --- |
| R8-1 | An export nothing reads is a no-op, not an error. The error is for a read a `var()` cannot replace. | *"Never used is a no-op, why does it matter? i don't see any need for an error"* |
| R8-2 | A calculation CSS can express natively is written as CSS with no JS (`calc(var(--w, 10px) * 2)`, `var(--brand, red)`). | *"Yes, absolutely, if we can express a calculation CSS-natively without bundling JS, this is idea[l]."* |
| R8-3 | `@export` is a modern-mode trigger (P36), as `@use` and `@compose` are. | *"yes, any 'modern' at-rules should turn off functions from being callable ambiently"*, *"i mean modern Less at-rules"* |
| R8-4 | Jess 1.x module syntax is a source of ideas, not a compatibility target. | *"not sure any? you can source it for good ideas if they exist but the 2.x syntax has changed drastically"* |
| R8-5 | Values derived from an export re-evaluate at runtime: dependency tracking through functions, not passthrough-only. | the goal statement above |

Split off on 2026-11-01 as its own task: built-in functions that have a CSS
counterpart are represented internally as that counterpart (`darken()` as
relative color syntax), resolved when inputs are known and written as CSS when
not. The runtime uses that task's per-function classification (CSS-expressible
or needs JS) to decide what ships in the bundle.

## Slices

1. **`@export` → `var()` for reads in CSS values (Less).** Below. No JS.
2. **Dependency tracking.** A value computed from an export (math outside a
   calculation, a function Jess computes, a value passed through a mixin) writes
   a generated custom property, and the compiler records which exports each one
   reads. Unblocks the mixin-argument and operand cases slice 1 rejects.
3. **Runtime module.** The R7.4 per-kind emit split, then a generated
   `vars()`/`set()` module carrying only the functions slice 2 found.
4. **Bundler output.** `rollup-plugin-jess` / Vite emit the `.css` plus the
   `.js` module when a file has an `@export` (class scoping: `.module.*`).
5. **Class-name scoping (R7.3).** Its O-CSSM items stay open.

## Slice 1 contract (as built)

- **Syntax.** `.less`: `@export @name: value;` and `@-export @name: value;`
  (case-insensitive), the ordinary `VarDeclaration` after the keyword. It
  parses in any body (P45); the AST is a `VariableDeclaration` whose `write` is
  `{ mode: 'export' }` (`nodes.ts` `VariableWrite`), so the node's shape does
  not change.
- **Top level only.** An `@export` activated in a frame with a parent (a
  ruleset, at-rule, mixin, detached-ruleset or loop body) raises
  `eval/export-not-top-level`.
- **Which reads are the export.** The rendered document's root `@export`
  names, bound in its root frame (`EvalSession.exports`). A nested shadow of the
  name is not the export.
- **Value reads.** A read while a declaration value is written evaluates the
  call `var(--name, <compile-time value bytes>)`, the same `FunctionCall` an
  author writes, in both evaluators (`export-reads.ts` `exportChecked`, called
  from `serialize.ts` `resolveVarRef`). So it is kept in `calc()`,
  `color-mix()`, `rgb(from …)` and any call written as-is, and math on it
  outside a calculation is the existing `eval/invalid-operand`. A lone
  `@{name}` is such a read.
- **Computed-function inputs.** A function Jess computes (`@less.length(@l)`,
  `@less.isnumber(@w)`) would compute on the `var()` call, not the value, so an
  exported binding it takes as input, directly or through an alias, raises
  `eval/export-not-a-value` until slice 2 runs the function at runtime
  (`exportInput`).
- **Other reads.** Any other read that resolves to the export raises
  `eval/export-not-a-value`: selectors, at-rule preludes (`@media`,
  `@supports`), guards and conditions, strings, urls, text spliced around the
  read (`@{n}px`, read as a string's splice is), loop iterables, and (until
  slice 2) mixin arguments. The guard sits in `resolveVarRef`, which every
  variable read goes through, so a new read path is rejected by default.
  `isdefined()` in a value is not a read. In a guard, `isdefined()` evaluates
  its argument (so `isdefined(@missing)` there already raises "Name not
  found"), which makes it a read and an error for an export.
- **Error location.** A read reached with no reader node, and a ref inside an
  interpolation (which the parser gives no span), reports line 1 column 1.
- **Cost.** A document with no export pays one `undefined` check per variable
  lookup.

## Open — needs the owner

- **A1's last sentence** ("Less does not implement `@-export`/`@export`")
  contradicts R8 and A1 is hash-locked. Amending it needs the owner's approval
  to regenerate `owner-rulings.lock.json`.
- **Exports in an imported document.** Slice 1 counts only the rendered
  document's root. An `@export` in a `@compose`d module is a plain declaration;
  one in an `@import`ed document (which folds into a child frame) raises
  `eval/export-not-top-level`.
- **`.jess` `@-export $name:`.** The `.jess` grammar reads `@-export "path"`
  as the `@forward`-style re-export (A4 keeps the two features distinct), so the
  variable form needs a dispatch on the token after the keyword. `.less → .jess`
  reports a gap for an exported declaration until then.
- **Generated names.** Slice 1 writes the readable `--name`. Collisions with an
  authored custom property of the same name, and hashed names for derived
  values, are slice 2 questions.
- **Custom-property values.** `--x: @{brand}` raises: a custom property's
  value is not written as a checked CSS value, though a `var()` is valid there.
  (`--x: @brand` is written verbatim, as today.) Should the lone splice be the
  `var()`?
- **`@less.darken(@brand, 10%)`** raises as a computed-function input. Once the
  CSS-native-functions task lands, a function with a CSS form could write that
  form (`color-mix(…, var(--brand, …) …)`) instead of raising.

## API direction (proposal for slices 3–4, not built)

The base layer is a pure function from values to a style object. DOM writing is
a thin layer on top, so SSR, React `style`, Vue `:style` and `el.style` share
one primitive:

```js
import styles, { $brand, button } from './card.module.less'

button                            // scoped class (R7.3)
styles.vars({ brand: '#c00' })    // { '--brand': '#c00', … } — pure
styles.set({ brand: '#c00' })     // :root, batched per frame
styles.set({ brand: '#c00' }, el) // inline on el: subtree theming
$brand.value = '#c00'             // per-variable handle
```

From Jess 1.x: the default export is the class map, and named exports are
mixins returning style objects (the same shape as `vars()`).
