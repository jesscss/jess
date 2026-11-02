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

1. **`@export` → `var()` for reads in CSS values (Less).** Built; contract below.
2. **Dependency tracking.** Built; contract below. A value an imported function
   computes from an export writes a generated custom property, and the compile
   returns how the runtime computes it. Mixin arguments carry an export.
3. **Runtime module.** `@jesscss/fns/runtime`: `vars()`/`set()` over the
   recipes slice 2 returns, calling the functions they name. It recomputes
   values and never re-serializes CSS, so it does not need the R7.4 per-kind
   emit split (rulings below).
4. **Bundler output.** `rollup-plugin-jess` / Vite emit the `.css` plus the
   `.js` module when a file has an `@export`.
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
- **Computed-function inputs.** A function Jess computes (`@less.length(@l)`)
  reads the export's value, not the `var()` call (`exportInput`); slice 2 says
  what it writes.
- **Other reads.** Any other read that resolves to the export raises
  `eval/export-not-a-value`: selectors, at-rule preludes (`@media`,
  `@supports`), guards and conditions, strings, urls, text spliced around the
  read (`@{n}px`, read as a string's splice is) and loop iterables. The guard
  sits in `resolveVarRef`, which every variable read goes through, so a new
  read path is rejected by default; a probe that reads no value opts out with
  `READS_EXPORT`.
  `isdefined()` in a value is not a read. In a guard, `isdefined()` evaluates
  its argument (so `isdefined(@missing)` there already raises "Name not
  found"), which makes it a read and an error for an export.
- **Error location.** A read reached with no reader node, and a ref inside an
  interpolation (which the parser gives no span), reports line 1 column 1.
- **Cost.** A document with no export pays one `undefined` check per variable
  lookup.

## Slice 2 contract (as built)

- **Mixin arguments.** An argument that reads an export binds the `var()`: the
  parameter's snapshot is `var(--brand, #c00)`, so a CSS value in the mixin
  writes it, alone or in a list (`.m(@w 2px)` → `margin: var(--w, 8px) 2px`),
  and a default (`.m(@c: @brand)`) does the same. The snapshot is kept as the
  export (`export-reads.ts` `exportArgument`, carried to the snapshot by
  `keepArgumentSyntax`), so a guard, selector or other non-value read of the
  parameter raises `eval/export-not-a-value` as a direct read does. The probes
  that classify an argument before binding it (`substituteClosureVarArgs`,
  `classifyMixinValuePart`, `resolveDefault`, `lookupBinding`) read the
  binding, not the value (`READS_EXPORT`).
- **Computed functions (ladder rung 4).** A call of an imported function
  (`@less.lightness(@brand)`) whose argument is an export (directly, through
  an alias, through a mixin argument, or as a nested computed call) computes on
  the compile-time value and writes `var(--<export>-<function>, <result>)`:
  `var(--brand-lightness, 40%)`. The fallback is the value the call has with no
  export. The recipe is recorded (`exportCall`): an export, an argument's
  compile-time CSS, or `{ fn: { module, name }, args }` naming the module the
  stylesheet imports and the export it calls. One name per recipe; a different
  recipe that would take the name is numbered (`--brand-lightness-2`). The
  generated `var()` keeps working in `calc()` and in a call written as-is.
- **What cannot be followed** raises `eval/export-not-a-value`: an argument
  that holds the export inside a larger value (`@a: @w 2; length(@a)`, or a
  mixin argument `@w 2` a function reads), a function that has no import to name
  (a plugin's, a user function), and a computed result read outside a CSS value
  (a guard).
- **Every computed function takes rung 4 today**, also one with a CSS-native
  form. When the CSS-native-built-ins task builds a function's form
  (`docs/design/CSS-NATIVE-BUILTINS.md` §3.4a, rungs 2–3), an export input
  takes that form instead; the one seam is `exportCall`.
- **Math outside a calculation** on an export stays `eval/invalid-operand`
  until that task writes operators on an unknown operand as `calc()` (its slice 5).
- **Runtime data.** `SerializeResult.runtime` and `RenderResult.runtime` (absent
  when nothing is exported): `exports` (every exported name), `defaults` (the
  compile-time CSS of each export a recipe reads) and `derived` (each generated
  property's recipe). JSON, so it crosses the sandbox route.
- **Cost.** A document with no export pays one `undefined` check per variable
  read, per computed call and per mixin argument bound.

## Orchestrator rulings for slices 3–5 (2026-11-01, owner delegated: *"You do not have to wait for my permission for slices. Get all slices done"*)

- **The runtime recomputes values; it never re-serializes CSS.** The CSS is
  static with `var()` reads, so the runtime sets custom properties and the
  R7.4 per-kind emit split (O-JSM-1/2/4) is not on this path. R7.4 stays the
  plan for a runtime that patches CSS structure, which nothing here needs.
- **The functions ship as `@jesscss/fns`' own** (one definition), imported by
  name from the module the stylesheet imported. Measured 2026-11-01 with
  esbuild: `@jesscss/core/value` alone is 7.3 KB gzip; importing three Less
  functions is 26.5 KB gzip, because `@jesscss/fns` builds each dialect as one
  chunk and `@jesscss/core` has no `sideEffects: false`. Making that tree-shake
  per function is a size task of its own.
- **Module shape:** `export const vars`, `export const set`, and a default
  export of the scoped class map once slice 5 exists (R8 API direction below).

## Open — needs the owner

- **Exports in an imported document.** Slice 1 counts only the rendered
  document's root. An `@export` in a `@compose`d module is a plain declaration;
  one in an `@import`ed document (which folds into a child frame) raises
  `eval/export-not-top-level`.
- **`.jess` `@-export $name:`.** The `.jess` grammar reads `@-export "path"`
  as the `@forward`-style re-export (A4 keeps the two features distinct), so the
  variable form needs a dispatch on the token after the keyword. `.less → .jess`
  reports a gap for an exported declaration until then.
- **Generated names.** An export writes `--name` and a derived value
  `--<export>-<function>`; a collision with an authored custom property of the
  same name is not detected.
- **Custom-property values.** `--x: @{brand}` raises: a custom property's
  value is not written as a checked CSS value, though a `var()` is valid there.
  (`--x: @brand` is written verbatim, as today.) Should the lone splice be the
  `var()`?

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
