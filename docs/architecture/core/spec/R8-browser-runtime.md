# R8 — Browser runtime: exposed variables → `var()` + a tree-shaken JS module

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
| R8-1 | An exposed variable nothing reads is a no-op, not an error. The error is for a read a `var()` cannot replace. | *"Never used is a no-op, why does it matter? i don't see any need for an error"* |
| R8-2 | A calculation CSS can express natively is written as CSS with no JS (`calc(var(--w, 10px) * 2)`, `var(--brand, red)`). | *"Yes, absolutely, if we can express a calculation CSS-natively without bundling JS, this is idea[l]."* |
| R8-3 | `@expose` is a modern-mode trigger (P36), as `@use` and `@compose` are. | *"yes, any 'modern' at-rules should turn off functions from being callable ambiently"*, *"i mean modern Less at-rules"* |
| R8-4 | Jess 1.x module syntax is a source of ideas, not a compatibility target. | *"not sure any? you can source it for good ideas if they exist but the 2.x syntax has changed drastically"* |
| R8-5 | Values derived from an exposed variable re-evaluate at runtime: dependency tracking through functions, not passthrough-only. | the goal statement above |

## Owner rulings, 2026-11-02 (ledger A20)

| # | Ruling | Verbatim |
| --- | --- | --- |
| R8-6 | "Top level" means not inside a selector or other sub-frame: an `@expose` at the top level of an `@import`ed or `@compose`d file exposes. | *"By “root” I meant “not defined in a selector” or other sub frame. My feeling is that if it’s an import or compose, it can be exported. But I’m willing to be persuaded if you think it should be explicit somehow?"* |
| R8-7 | The entry can expose a variable an imported file declares (`@import "tokens.less"; @expose brand;`). | *"Yes, export it"* |
| R8-8 | The statement is `@expose` (`@-expose`). Less has no `@export`; `.jess` `@-export` stays the `@forward`-style re-export (A4). | *"Yeah I think expose is the most no-brainer"* |
| R8-9 | `@expose @brand: red;` is an error whose fix shows the name-list form. | *"It’s an error, although you can hint what it should be. It’s not “old syntax”"* |
| R8-10 | An `@expose` in a `(reference)`-imported file does nothing, with no message. | owner picked the option “Ignore it silently” (2026-11-02) |
| R8-11 | The runtime keys an exposed variable by its name with dash-case turned to camelCase, letter case otherwise kept; two names with one key, or two bindings exposed under one name, are an error naming both sites. | *"exports, like our CSS module’s implementation, should turn dash-case into lowerCamelCase… so that should flag conflicts"*, then *"we don't force lowerCamelCase --- i was just talking about dash-case conversion"*; owner picked the option “Error naming both” (2026-11-02) |
| R8-12 | Two `@compose`d libraries that expose one name, and two files that each declare and expose one name (two `@import`ed files, or an importer and a file it imports), are an error naming both sites. | asked of each case, 2026-11-02: *"error"* |

Split off on 2026-11-01 as its own task: built-in functions that have a CSS
counterpart are represented internally as that counterpart (`darken()` as
relative color syntax), resolved when inputs are known and written as CSS when
not. The runtime uses that task's per-function classification (CSS-expressible
or needs JS) to decide what ships in the bundle.

## Slices

1. **`@expose` → `var()` for reads in CSS values (Less).** Built; contract below.
2. **Dependency tracking.** Built; contract below. A value an imported function
   computes from an exposed variable writes a generated custom property, and the compile
   returns how the runtime computes it. Mixin arguments carry an exposed variable.
3. **Runtime module.** Built; contract below. `@jesscss/fns/runtime`:
   `vars()`/`set()` over the recipes slice 2 returns, calling the functions
   they name. It recomputes values and never re-serializes CSS, so it does not
   need the R7.4 per-kind emit split (rulings below).
4. **Bundler output.** Built; contract below. `rollup-plugin-jess` / Vite
   emit the `.css` plus the `.js` module when a file has an `@expose`.
5. **Class-name scoping (R7.3).** Not built in Jess (R7 O-CSSM-1): a `.module.*`
   stylesheet uses the bundler's CSS Modules (slice 4 contract).

## Slice 1 contract (as built)

- **Syntax.** `.less`: `@expose brand;` and `@-expose brand, gap;`
  (case-insensitive): bare names, comma-separated, of variables declared as
  usual (`@brand: #c00;`). The `@` starts a read, so it is not part of the
  name (owner 2026-11-02: *"the at is less part of the variable and more like
  an expression start. So I think @export brand or @export brand, gap; is what
  I would want"*). It parses in any body (P45); the AST is a `VariableExpose`
  statement holding the names (`nodes.ts`).
- **`.jess`.** The `.jess` spelling is `@-expose`; the `.jess` grammar does not
  parse it yet, so `.less → .jess` reports a gap for an `@expose`.
- **Top level, of any file (R8-6).** An `@expose` exposes when it is
  activated in a frame with no parent: the rendered document's root, which a
  top-level `@import` splices into, or a
  `@compose`d module's own frame. One in a frame with a parent (a ruleset,
  at-rule, mixin, detached-ruleset or loop body, or a file imported into one)
  raises `eval/expose-not-top-level`.
- **Which binding is the exposed variable (R8-7).** Each name is the binding a read in
  that frame resolves to: declared there, by a file imported there (the last
  declaration wins, so the importer's override of an imported exposed
  variable is the one exposed) or by a mixin called there. A name nothing there declares raises
  `eval/expose-not-declared`, located at the name. A binding is its value in the
  frame it was bound in, so a nested shadow, or another call of the mixin, is not
  the exposed variable. A composed module's exposed variable is read as its member (`@tokens.brand`).
- **When it binds.** The names resolve once the frame is complete: at the first
  read of one of them, or at the end of the render (`export-reads.ts`
  `declareExpose`, `settle`). The render activates the root's `@expose`s before
  it starts and the import planner a top-level file's, so a read written before
  the `@expose` or the `@import` is an exposed variable read too.
- **`(reference)` imports** (owner 2026-11-02): an `@expose` in a
  `(reference)`-imported file does nothing, with no message. The importer can
  still expose that file's variables by naming them in its own `@expose`.
- **Value reads.** A read while a declaration value is written evaluates the
  call `var(--name, <compile-time value bytes>)`, the same `FunctionCall` an
  author writes, in both evaluators (`export-reads.ts` `exportChecked`, called
  from `serialize.ts` `resolveVarRef`). So it is kept in `calc()`,
  `color-mix()`, `rgb(from …)` and any call written as-is, and math on it
  outside a calculation is the existing `eval/invalid-operand`. A lone
  `@{name}` is such a read.
- **Computed-function inputs.** A function Jess computes (`@less.length(@l)`)
  reads the exposed variable's value, not the `var()` call (`exportInput`); slice 2 says
  what it writes.
- **Other reads.** Any other read that resolves to the exposed variable raises
  `eval/expose-not-a-value`: selectors, at-rule preludes (`@media`,
  `@supports`), guards and conditions, strings, urls, text spliced around the
  read (`@{n}px`, read as a string's splice is) and loop iterables. The guard
  sits in `resolveVarRef`, which every variable read goes through, so a new
  read path is rejected by default; a probe that reads no value opts out with
  `READS_EXPORT`.
  `isdefined()` in a value is not a read. In a guard, `isdefined()` evaluates
  its argument (so `isdefined(@missing)` there already raises "Name not
  found"), which makes it a read and an error for an exposed variable.
- **Error location.** A read reached with no reader node, and a ref inside an
  interpolation (which the parser gives no span), reports line 1 column 1.
- **Cost.** A document with no exposed variable pays one check (an `undefined`
  `runtime`) per variable lookup.

## Slice 2 contract (as built)

- **Mixin arguments.** An argument that reads an exposed variable binds the `var()`: the
  parameter's snapshot is `var(--brand, #c00)`, so a CSS value in the mixin
  writes it, alone or in a list (`.m(@w 2px)` → `margin: var(--w, 8px) 2px`),
  and a default (`.m(@c: @brand)`) does the same. The snapshot is kept as the
  exposed read (`export-reads.ts` `exportArgument`, carried to the snapshot by
  `keepArgumentSyntax`), so a guard, selector or other non-value read of the
  parameter raises `eval/expose-not-a-value` as a direct read does. The probes
  that classify an argument before binding it (`substituteClosureVarArgs`,
  `classifyMixinValuePart`, `resolveDefault`, `lookupBinding`) read the
  binding, not the value (`READS_EXPORT`).
- **Computed functions (ladder rung 4).** A call of an imported function
  (`@less.lightness(@brand)`) whose argument is an exposed variable (directly, through
  an alias, through a mixin argument, or as a nested computed call) computes on
  the compile-time value and writes `var(--<name>-<function>, <result>)`:
  `var(--brand-lightness, 40%)`. The fallback is the value the call has with nothing
  exposed. Bound as a mixin argument, the generated value is an exposed variable read like
  a direct one: a guard, selector or string reading the parameter raises, and
  a computed function reading it recomputes through the argument as written
  (`.m(@less.darken(@brand, 10%))` then `@less.iscolor(@c)` records both calls). The recipe is recorded (`exportCall`): an exposed variable, an argument's
  compile-time CSS, or `{ fn: { module, name }, args }` naming the module the
  stylesheet imports and the exposed variable it calls. One name per recipe; a different
  recipe or an exposed variable that would take the name is numbered
  (`--brand-lightness-2`). The
  generated `var()` keeps working in `calc()` and in a call written as-is.
- **What cannot be followed** raises `eval/expose-not-a-value`: an argument
  that holds the exposed variable inside a larger value (`@a: @w 2; length(@a)`, or a
  mixin argument `@w 2` a function reads), a function that has no import to name
  (a plugin's, a user function), and a computed result read outside a CSS value
  (a guard).
- **A function with a CSS form takes that form**
  (`docs/design/CSS-NATIVE-BUILTINS.md` §3.4a, rungs 2–3): an exposed variable
  in an argument the form takes prints the form over its `var()`,
  `hsl(from var(--brand, #c00) h s clamp(0, l - 10, 100))`, the browser
  recomputes it, and the function is in no recipe. Built for Less `lighten`
  `darken` `saturate` `desaturate` `spin` `greyscale` `fade` `fadein` `fadeout`,
  `mix` `tint` `shade` `average`, `contrast`, two-slot `rgb` `rgba`, and the hue of `hsv`
  `hsva`; the one seam is `exportCall`. A weight is a form's while its value is one
  `color-mix()` holds, and a call with no form over what only the browser knows
  (`@less.mix(@a, @b, 150%)`) takes rung 4.
  `rgb` and `rgba` with an exposed channel are valid CSS as written, and print so:
  `@less.rgb(@r, 0, 0)` is `rgb(var(--r, 10), 0, 0)`; one exposed colour,
  `@less.rgb(@brand)`, is `var(--brand, #c00)`. A wrong exposed value fails at the
  compile, as its slot rejects it. A
  stylesheet that prints only forms adds no function: with no exposed variable it
  adds no JS at all, and with one it adds the runtime that sets it, `createRuntime`
  with no derived value (measured 2026-11-05 with Vite 6: 34.7 KB minified, 10.6 KB gzip). Every other computed function takes rung 4, and so does one with
  an exposed variable in an argument its form does not take yet (`@less.darken(#c00, @a)`,
  that task's slice 5). An input of a function on rung 4 stays computed, as the
  runtime reads it: `@less.lightness(@less.darken(@brand, 10%))` is one recipe
  that runs both.
  A fixed argument the runtime cannot read, because it holds a call
  (`@less.fade(var(--x), @a)`, `@less.fade(rgb(1 2 3), @a)`), fails at the compile,
  at the call's span (`eval/expose-not-a-value`), not in the browser.
- **Math outside a calculation** on an exposed variable stays `eval/invalid-operand`
  until that task writes operators on an unknown operand as `calc()` (its slice 5).
- **Runtime data.** `SerializeResult.runtime` and `RenderResult.runtime` (absent
  when nothing is exposed): `exports` (every exposed name), `keys` (each exposed
  name by its JavaScript key, R8-11; the generated module reads it rather than
  re-deriving the key), `defaults` (the
  compile-time value of each exposed variable a recipe reads, as the runtime reads it:
  `emitValue`, not the output modes, so compressed CSS may spell it shorter) and
  `derived` (each generated property's recipe). JSON, so it crosses the sandbox
  route.
- **Cost.** A document with no exposed variable pays one check per variable read and per
  computed call, and two calls per mixin argument bound
  (`exportArgumentStart` / `exportArgumentEnd`, each one check).

## Slice 3 contract (as built)

- **`createRuntime({ keys, defaults, derived })`** (`packages/fns/src/runtime.ts`)
  returns `vars(values)` and `set(values, target?)`. Values are given by
  JavaScript key (`brandColor` for `@brand-color`); a key the stylesheet does
  not expose raises. A derived recipe is an
  export (`{ export }`), an argument's compile-time CSS (a string) or
  `[fn, args]` with the imported function itself, as the generated module
  writes it.
- **`vars(values)`** is pure: `--<name>` for each export given, and each
  derived property that reads one of them, computed with the function the
  compile ran on the given values and the compile-time value of every export
  not given. It is usable as a React or Vue `style` object.
- **`set(values, target)`** writes `vars(values)` on `target`'s inline style,
  `document.documentElement` by default. ponytail: no per-frame batching; a
  caller setting many values in one frame calls `set` once with all of them.
- **Values are CSS literals** (`#c00`, `8px`, `red`, lists of them); a value
  written as a function (`hsl(…)`, `calc(…)`) raises, since the runtime has no
  CSS parser. `<input type="color">` gives hex.
- **The runtime writes what a compile writes**: for a value `v`, a derived
  property equals the bytes a compile with `@brand: v` writes
  (`packages/jess/test/export-runtime.test.ts`).
- **Modules.** The compiler writes each recipe's module as the runtime module
  imports it: a plugin's private path through its new `packageModule` hook
  (`#less` → `@jesscss/fns/less`, `ProvidedModules.packageOf`); a package
  spelling as written. A relative module is refused with a message, since a
  `@use` in an imported file resolves against that file, which the recipe does
  not record (`packages/compiler/src/runtime-modules.ts`).

## Slice 4 contract (as built)

- **`rollup-plugin-jess`** compiles `.jess` and `.less` imports
  (`renderToResult`); one plugin serves Rollup and Vite (`enforce: 'pre'`).
  **`vite-plugin-jess`** is that plugin under Vite's name and `Plugin` type,
  so there is one implementation.
- **CSS Modules.** Under Vite, a `.module.*` stylesheet's CSS has the id
  `<file>.module.css`, so Vite's CSS Modules scope it after Jess
  has evaluated it (`&__el` is scoped as the name it builds). The module
  re-exports Vite's class map as its default export and each class as a named
  export, as `import styles from './x.module.css'` does; `vars`/`set` are
  unchanged, so a class named `.vars` or `.set` is read from the default
  export. Under plain Rollup the CSS is emitted unscoped.
  The stylesheet's module is the virtual id `\0jess:<file>.js`, so no CSS
  plugin claims it.
- **CSS.** Rollup: emitted as the asset `<name>.css` (`emitCss`,
  `cssFileName`). Vite: the module imports `<file>.css`, an id beside the
  stylesheet that no file backs, so Vite injects it in dev and bundles it in a
  build, and `url()`, `@import` and `composes` in it resolve from the
  stylesheet's directory. The plugin's `handleHotUpdate` adds that id to an
  edit of the stylesheet. `<file>?inline` is the same CSS as a string. A
  `<link>` to a `.less` or `.jess` file is not served in dev.
- **Resolving the runtime.** The module's `@jesscss/fns` imports resolve from
  the stylesheet, then from the plugin. Vite resolves bare imports itself; a
  Rollup build needs `@rollup/plugin-node-resolve`.
- **Module.** `export default` is the CSS. A stylesheet with runtime data also
  has `export const { vars, set } = createRuntime({ defaults, derived })`, each
  recipe function imported by name from its module (`@jesscss/fns/less`).
  Imports resolve from the stylesheet, then from the plugin, which depends on
  `@jesscss/fns`.
- **Diagnostics** go through Rollup once: errors as `this.error`, warnings as
  `this.warn`, each with its file, line and column.
- **Browser-safe functions.** `@jesscss/fns` imports the value barrel
  (`@jesscss/core/value`, which depends only on `big.js`) instead of the
  `@jesscss/core` root, whose `node:fs` imports break a browser build, and
  `util/mime.ts` no longer imports `node:path`. Measured 2026-11-01 with
  Vite 6: `darken` + runtime is 60 KB minified, 17.6 KB gzip.
  Measured again 2026-11-05 with Vite 6, after `darken` became a CSS form and left
  the recipes: a stylesheet whose runtime runs a function with no form
  (`lightness(@brand)`) is 76 KB minified, 21.2 KB gzip. One whose recipe runs a form
  (`lightness(spin(@brand, 30))`) is 498 KB minified, 131.3 KB gzip, because a form
  runs on the evaluator: the runtime then ships `@jesscss/core/form`, the serializer
  included. Whether a recipe should reach a form that way, at that size, is the
  owner's call and is not decided here.
  Measured again 2026-11-05 with Vite 6, after `fade` and `hsv` became forms:
  `lightness(@brand)` is 72.2 KB minified, 20.2 KB gzip; a page of `@less.rgb(@r, 0, 0)` or
  `@less.rgba(@brand, .5)` has no function in its runtime and is 34.7 KB minified, 10.6 KB gzip; a recipe
  that runs a form, `lightness(spin(@brand, 30))` or `alpha(fade(@brand, 50%))`,
  is 501 to 502 KB minified, 133.5 KB gzip. So is `lightness(rgb(@r, 0, 0))`: `rgb()` nested inside a function with
  no CSS form runs in the recipe, and its two-slot overload is a form, so it costs
  the evaluator (503 KB minified, 133.8 KB gzip).
  After `mix` `tint` `shade` `average` and `contrast` became forms: `lightness(@brand)` is
  71.8 KB minified, 19.8 KB gzip; a page of `@less.mix(@brand, red, 25%)` or
  `@less.contrast(@brand)` is 34.7 KB minified, 10.6 KB gzip; a recipe that runs one,
  `@less.mix(@a, @b, 150%)`, `lightness(mix(@brand, red))` or
  `@less.contrast(@brand, #111, #eee, 50%)`, is 506 KB minified, 134.4 KB gzip.
- ponytail: imports of a stylesheet are not watched (`loadedUrls` is empty);
  only the stylesheet itself is. Watch the render's loaded files when the
  compiler reports them.

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
  per function is a size task of its own. (2026-11-05: `@jesscss/core` now states
  its `sideEffects`, and with esbuild one function with no form, `lightness` or
  `percentage`, is 18.3 KB gzip; one form, `lighten` or `fade`, is 117 KB gzip.)
- **Generated names are the exposed variable's namespace.** `@expose brand` publishes
  `--brand` and reserves `--brand-*` for values derived from it; an exposed variable and a
  generated name never share a name (numbered). Two exposures of one name are one
  custom property, so they must resolve to one binding (an importer and the file
  it imports may both expose it); two bindings, such as a composed module's
  `@brand` and the importer's own, raise `eval/expose-conflict`, located at one
  name and naming the other's file, line and column. So do two files that each
  declare and expose the name, though an `@import` shares one top level and the
  last declaration wins (R8-12); a file that only redeclares an exposed variable,
  or only exposes one it imports, does not clash. The JavaScript runtime keys
  an exposed variable by its name with dash-case turned to camelCase, letter case
  otherwise kept (`export-reads.ts` `exportKey`: `Brand` stays `Brand`), so two
  names with one key (`brand-color`, `brandColor`) raise
  `eval/expose-key-conflict`, naming both. An exposed variable name
  is the author's, so it is never numbered. An authored custom property in
  that namespace (`--brand-lightness: 1%`) is the author's own write and is not
  detected, as two authored writes of one custom property are not.
- **Module shape:** `export const vars`, `export const set`, and a default
  export of the scoped class map once slice 5 exists (R8 API direction below).

## Open — needs the owner

- **Custom-property values.** `--x: @{brand}` raises: a custom property's
  value is not written as a checked CSS value, though a `var()` is valid there.
  (`--x: @brand` is written verbatim, as today.) Should the lone splice be the
  `var()`?

## API direction (proposal; slices 3–4 build `vars`/`set`)

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
