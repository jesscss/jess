# `packages/fns` dialect classification audit

**Branch base:** `origin/dev` @ `ad1bbd1bf05f6030e276a8b13cabab48ea07cf2f` (the brief cited
`3202ff246`; that is the SHA of the main checkout at `~/git/oss/jess`, which had moved
ahead by the time this audit ran — see §9.3).
**Status:** read-only audit. No source file in `packages/fns/` was modified.

## 0. The rule being applied

- `shared/` = functions whose behaviour is **identical** in Less and Sass.
- `less/index.ts` exports = `less/` **plus** `shared/`.
- `sass/index.ts` exports = `sass/` **plus** `shared/`.

Identical behaviour is the only criterion. Same name is not identical. Same purpose is not
identical. If Less and Sass disagree on the result for any input in the domain — return
type, unit, rounding, coercion, arity, error case, list handling, output format — it is
DIVERGENT and needs two implementations.

## 1. How evidence was obtained

Every DIVERGENT and every IDENTICAL verdict below is backed by an executed comparison, not
an assertion. Three engines were run:

| engine | binary | role |
|---|---|---|
| dart-sass 1.101.0 | `packages/jess/node_modules/.bin/sass` | Sass reference |
| lessc 4.8.0 | `~/git/worktrees/less.js/less-4x/packages/less/bin/lessc` (read-only worktree) | Less reference |
| jess @ `3202ff246` | `~/git/oss/jess/packages/jess/bin/cli.mjs` | current shipped behaviour |

Method: each expression compiled as `a{b:<expr>}` and the declaration value read back.
Less v5 alpha (`~/git/worktrees/less.js/alpha-bench`, 5.0.0-alpha.2) could **not** be run
standalone — its `lib/index.js` imports the package `jess`, which is not resolvable in that
worktree (`ERR_MODULE_NOT_FOUND: Cannot find package 'jess'`). Where the v5 target may
differ from 4.8.0, this is called out explicitly rather than guessed (§8.1).

Note on the engines: an unresolved `<name>(...)` is emitted verbatim as plain CSS by both
compilers. In the tables below a verbatim echo (e.g. `L: spin(#800, 45deg)` under Sass)
means **the function does not exist in that dialect**, not that it returned a string.

## 2. Architecture as it actually is (verified, not inherited)

This matters because it determines which moves can change output.

There is exactly **one** registry. `packages/fns/src/builtins/index.ts` exports
`builtinLessFns` (83 entries); `builtins/registry.ts` turns it into an `FnRegistry`;
`packages/jess/src/index.ts:34,39` does:

```ts
import { makeBuiltinRegistry } from '@jesscss/fns/builtins';
const astValueEvaluator = buildEvaluator(makeBuiltinRegistry());
```

That single evaluator serves **every** dialect. `packages/jess-plugin-scss/src/index.ts`
contributes no function registry at all. Consequence, confirmed by running jess on a `.scss`
file:

```
$ cat k.scss
a{b:unit(10px);c:length(a,b,c);d:hue(#f00);e:percentage(50px)}
$ jess k.scss k.css && cat k.css
a { b: 10; c: 1; d: 0; e: 5000%; }
```

dart-sass on the same input: `b: "px"`, `d: 0deg`, `e:` **error** (`Expected 50px to have
no units`), and `c:` **error** (`length()` takes 1 argument). So SCSS is served Less's
`unit`, `length`, `hue`, and `percentage` today — the reported bug reproduces, and is
broader than the two functions named in the brief.

Second load-bearing fact: **`less/index.ts` and `sass/index.ts` are not the registration
path.** They are a JavaScript-callable barrel (`src/index.ts` re-exports `./less/index.js`
for documented `@-from '@jesscss/fns' import (...)` consumers). Nothing in the compiler
enumerates them. This is why most of the migration is Class A (§9.1) — it cannot move
output because the code is not reachable from the evaluator.

Third: several Less constructs never reach the registry at all. `isdefined`, `isruleset`,
and the logical family are special-formed inside core:

- `packages/core/src/ast/serialize.ts:3174` — `if (node.name === 'isdefined')`
- `packages/core/src/ast/serialize.ts:3182` — `if (node.name === 'isruleset')`
- `packages/core/src/ast/serialize.ts:3293` — `LOGICAL_FNS = new Set(['if','boolean','not','and','or'])`

So `less/isdefined.ts`, `less/isruleset.ts`, `less/logical.ts`, `less/iif.ts`, and
`less/each.ts` are dead relative to compiled output.

## 3. Domain split

Two incompatible `defineFunction` signatures coexist:

- **value domain** — `defineFunction(name, { params, body })` from
  `@jesscss/core/value` (`packages/core/src/ast/value-dispatch.ts:181`). Produces `Fn`.
  This is what `FnRegistry.registerAll` accepts.
- **legacy tree-node** — `defineFunction(name, fn, { params })` from `@jesscss/core`
  (`packages/core/src/define-function.ts:295`). Operates on `Color`/`Dimension`/`Quoted`/
  `Node`/`Collection` instances. Pre-dates the ast-v2 cutover. **Not** an `Fn`; cannot be
  registered.

### 3.1 The "42 of 60" claim — VERIFIED

`sass/index.ts` has exactly 60 exports. 18 are value-domain, 42 are legacy tree-node.

**Value domain (18):** `abs`, `ceil`, `floor`, `round` (shared/math), `red`, `green`,
`blue`, `alpha` (shared/color), `ieHexStr` (→ `less/argb.ts` → `builtins/argb.ts`), and the
nine list fns `length`, `nth`, `index`, `isBracketed`, `listSeparator`, `setNth`, `join`,
`append`, `zip`.

**Legacy tree-node (42):** `max`, `min` (`shared/math/max.ts`, `shared/math/min.ts` —
note these two are legacy even though they live in `shared/`), `unitless`, `compatible`,
`percentage`, `unit`, `random`, `mix`, `rgb`, `rgba`, `hsl`, `hsla`, `lighten`, `darken`,
`saturate`, `desaturate`, `grayscale`, `adjustHue`, `opacify`, `fadeIn`, `transparentize`,
`fadeOut`, `complement`, `invert`, `hue`, `saturation`, `lightness`, `opacity`, `unquote`,
`quote`, `toUpperCase`, `toLowerCase`, `uniqueId`, `strInsert`, `strIndex`, `strSlice`,
`mapGet`, `mapMerge`, `mapRemove`, `mapKeys`, `mapValues`, `mapHasKey`.

18 + 42 = 60. ✅ The count in the brief is correct.

Also worth flagging while in there: `sass/invert.ts` uses `: any` twice (return type and a
local), and `sass/map/keys.ts` uses `any[]` / `as any`. Those violate the project's absolute
rule and will need fixing when those files are rewritten in the value domain.

## 4. Classification: `shared/` (the burden-of-proof cases)

Ten functions currently claim IDENTICAL. **Six of the ten are wrong.**

| name | current | correct | verdict | domain | sass module | evidence |
|---|---|---|---|---|---|---|
| `abs` | shared/math | **shared** | IDENTICAL | value | `sass:math` | `abs(-10px)`→`10px`, `abs(-10%)`→`10%`, `abs(-10)`→`10`, `abs(-45deg)`→`45deg` in both. `abs(red)` errors in both. Only delta is arity tolerance (§4.1). |
| `ceil` | shared/math | **shared** | IDENTICAL | value | `sass:math` | `ceil(2.4px)`→`3px`, `ceil(-2.5)`→`-2` in both. Arity caveat §4.1. |
| `floor` | shared/math | **shared** | IDENTICAL | value | `sass:math` | `floor(2.6px)`→`2px`, `floor(-2.5)`→`-3` in both. Arity caveat §4.1. |
| `round` | shared/math | **both-separately** | **DIVERGENT** | value | `sass:math` | Second argument means opposite things. `round(1.234, 2)` → Less `1.23` (decimal precision); dart-sass `2` (CSS `round()` — round to nearest multiple of 2). Single-arg agrees (`round(2.5)`→`3`, `round(-2.5)`→`-3`). The current shared impl implements Less precision and passes it to SCSS. |
| `max` | shared/math | **both-separately** | **DIVERGENT** | **legacy** | `sass:math` | `max(1px, 2em)` → Less: `ArgumentError: incompatible types`; Sass: emits plain CSS `max(1px, 2em)`. `min(1px, var(--x))` → Less `1px` (!); Sass `min(1px, var(--x))`. Also dormant: the registry uses `less/max.ts`, not this file. |
| `min` | shared/math | **both-separately** | **DIVERGENT** | **legacy** | `sass:math` | as `max`. Dormant likewise. |
| `red` | shared/color | **both-separately** | **DIVERGENT** | value | `sass:color` | `red(rgb(1.6,2,3))` → Less 4.8 `1.6`; Sass `2`. Less does not round fractional legacy channels; Sass does. Same for `blue(hsl(120,50%,50%))`: Less `63.75`, Sass `64`. |
| `green` | shared/color | **both-separately** | **DIVERGENT** | value | `sass:color` | as `red`. |
| `blue` | shared/color | **both-separately** | **DIVERGENT** | value | `sass:color` | as `red`. |
| `alpha` | shared/color | **shared** *(with caveat)* | IDENTICAL | value | `sass:color` | `alpha(rgba(0,0,0,0.4))`→`0.4`, `alpha(#f00)`→`1`, `alpha(rgba(0,0,0,0))`→`0` in both. Caveat: Less additionally supports the IE `alpha(opacity=N)` filter passthrough, which the current value-domain impl does not implement in either dialect — so it is not currently a divergence, but it is a Less gap. |

### 4.1 The arity caveat on `abs`/`ceil`/`floor`

Less silently ignores extra arguments (`abs(1px, 2)`→`1px`, `ceil(1.5px, 2)`→`2px`); Sass
raises `Only 1 argument allowed, but 2 were passed`. Strictly read, "error cases" makes this
a divergence. It is graded IDENTICAL because the difference lives in the arity checker, not
in the function body — the `params` spec is `[value]` in both cases and the fix belongs in
the dispatcher, not in a second copy of `Math.abs`. If the follow-up decides arity strictness
is per-dialect, these three become `both-separately` with no body change.

### 4.2 What the corrected `shared/` should contain

Only `abs`, `ceil`, `floor`, `alpha`. Everything else currently in `shared/` moves out into
two implementations. That is a 60% error rate in the existing hand-collation, which is
consistent with the criterion never having been applied.

## 5. Classification: `builtins/` — the live Less registry (83 fns)

All 83 are value-domain `Fn`. Unless noted, correct location is `less` (no Sass equivalent
of that name and behaviour), and there is no Sass module because the function is Less-only.

### 5.1 Registered, Less-only — no Sass counterpart at all

Verified by running the name through dart-sass and getting a verbatim echo (function does
not exist):

`sqrt`, `pow`, `mod`, `pi`, `get-unit`, `convert`, `sin`, `cos`, `tan`, `asin`, `acos`,
`atan`, `range`, `extract`, `fade`, `tint`, `shade`, `luma` (`luma(#f00)`→Less `21.26%`,
Sass echo), `luminance`, `hsvhue`, `hsvsaturation`, `hsvvalue`, `hsv`, `hsva`, `contrast`
(`contrast(#fff)`→Less `#000000`, Sass echo), `multiply`, `screen`, `overlay`, `softlight`,
`hardlight`, `difference`, `exclusion`, `average`, `negation`, `color`, `replace`,
`string-format`, `%`, `escape` (`escape("a b")`→Less `a%20b`, Sass echo), `e`
(`e("foo")`→Less `foo`, Sass echo), `iscolor`, `isnumber`, `isstring`, `iskeyword`,
`isunit`, `ispixel`, `ispercentage`, `isem`, `svg-gradient`, `data-uri`, `image-size`,
`image-width`, `image-height`.

Verdict for every one: **LESS-ONLY**, correct location `less`, stays exactly where it is
functionally. (Filing note: many currently sit in `builtins/` rather than `less/` — see §9.1
Class A-2 for the pure relocation.)

### 5.2 Registered, name collides with Sass, DIVERGENT

| name | verdict | sass module | evidence (Less → / Sass →) |
|---|---|---|---|
| `round` | DIVERGENT | `sass:math` | `round(1.234, 2)` → `1.23` / `2` |
| `min`, `max` | DIVERGENT | `sass:math` | `max(1px, 2em)` → error / `max(1px, 2em)` plain CSS |
| `percentage` | DIVERGENT | `sass:math` | `percentage(50px)` → `5000%` / error `Expected 50px to have no units`. `percentage(0.5)` agrees (`50%`). |
| `unit` | DIVERGENT | `sass:math` | `unit(10px)` → `10` (strips unit, returns number) / `"px"` (returns unit as a quoted string). Different return **type**. `unit(10px, em)` → Less `10em` / Sass arity error. |
| `length` | DIVERGENT | `sass:list` | `length(a, b, c)` → Less `1` (comma group ⇒ counts the first element; see `less/length.ts` body `groupSeparator(list) === ',' ? args[0] : list`) / Sass arity error. `length((a, b, c))` → Sass `3`. `length(a b c)` → both `3`. |
| `red`, `green`, `blue` | DIVERGENT | `sass:color` | §4 |
| `hue` | DIVERGENT | `sass:color` | `hue(#f00)` → `0` (unitless) / `0deg`. `hue(hsl(120,50%,50%))` → `120` / `120deg`. |
| `saturation` | IDENTICAL-so-far | `sass:color` | `saturation(hsl(120,50%,50%))` → `50%` in both. But Sass's is `color.saturation` with a `$space` parameter Less lacks; grade **both-separately** on the safe side. |
| `lightness` | IDENTICAL-so-far | `sass:color` | `lightness(hsl(120,50%,50%))` → `50%` in both. Same `$space` caveat ⇒ **both-separately**. |
| `lighten` | DIVERGENT | `sass:color` | Two-arg agrees exactly (`lighten(#800,10%)`→`#bb0000` both; `lighten(#800,10)` unitless→`#bb0000` both; `lighten(hsl(0,0%,90%),20%)`→`hsl(0,0%,100%)` both). Diverges on Less's third `method` argument: `lighten(#800, 10%, relative)` → Less `#960000` / Sass `Only 2 arguments allowed`. |
| `darken` | DIVERGENT | `sass:color` | Same third-arg divergence. Also output format: `darken(#800, 100%)` → Less `#000000` / Sass `black`. |
| `saturate` | DIVERGENT | `sass:color` | `saturate(#800, 10%, relative)` → Less `#880000` / Sass arity error. Sass additionally has the CSS-filter overload `saturate(50%)`, which Less passes through unresolved (both echo `saturate(50%)`, so no live delta — but Sass's is a defined identity, Less's is an unknown function). |
| `desaturate` | DIVERGENT | `sass:color` | Same third-arg divergence. Two-arg agrees (`desaturate(#888,10%)`→`#888888` both). |
| `mix` | DIVERGENT | `sass:color` | `mix(#f00,#00f)` → Less `#800080` / Sass `rgb(127.5, 0, 127.5)`. **Less rounds channels, Sass does not.** `mix(#f00,#00f,25%)` → Less `#4000bf` / Sass `rgb(63.75, 0, 191.25)`. Sass also has a 4th `$method` colour-space argument: `mix(#f00,#00f,50%,oklch)` → Sass `hsl(298.062…, 159.493…%, 29.291…%)`; Less ignores it and returns `#800080`. |
| `rgb`, `rgba`, `hsl`, `hsla` | needs separate impls | `sass:color` | Values agree on the cases tested (`rgb(1,2,3)`→`#010203` both; `hsl(120,50%,50%)`→`hsl(120,50%,50%)` both). But Sass's constructors accept `$channels` slash-alpha syntax, `hsl(120deg 50% 50% / 0.5)`, and out-of-gamut clamping rules Less does not have; the Less ones carry `ColorFormat`/modern-syntax context (`builtins/color-ctor-helper.ts`). Grade **both-separately**: the argument grammars are not the same domain. |
| `greyscale` / `grayscale` | see §6 | `sass:color` | Body identical, name differs. |
| `spin` / `adjust-hue` | see §6 | `sass:color` | Body identical, name differs. |
| `fadein` / `fade-in` | **DIVERGENT** | `sass:color` | Not an alias. See §6.1 — different amount scale. |
| `fadeout` / `fade-out` | **DIVERGENT** | `sass:color` | Same. |
| `argb` / `ie-hex-str` | **DIVERGENT** | `sass:color` | See §6.2 — output case differs. |
| `alpha` | IDENTICAL | `sass:color` | §4 |
| `abs`, `ceil`, `floor` | IDENTICAL | `sass:math` | §4 |

## 6. Name and alias mismatches

The registry keys on `fn.name` (`createFnRegistry`, `value-dispatch.ts:257–260`, lower-cased).
There is no aliasing mechanism, and per the owner's instruction none will be added: a function
registered for Sass **is** its Sass name.

| Sass global | Sass module member | jess `fn.name` today | file | same behaviour? |
|---|---|---|---|---|
| `grayscale` | `color.grayscale` | `greyscale` | `sass/grayscale.ts` → `less/greyscale.ts` | **yes** — `greyscale(#800)` (Less) and `grayscale(#800)` (Sass) both `#444444`. Pure rename. |
| `adjust-hue` | `color.adjust-hue` | `spin` | `sass/adjust-hue.ts` → `less/spin.ts` | **yes** — `spin(#800,45)` (Less) and `adjust-hue(#800,45)` (Sass) both `#886600`; `adjust-hue(#800,45deg)` also `#886600`. Pure rename. |
| `ie-hex-str` | `color.ie-hex-str` | `argb` | `sass/ie-hex-str.ts` → `less/argb.ts` → `builtins/argb.ts` | **no** — see §6.2 |
| `fade-in` / `opacify` | `color.opacify` | `fadein` | `sass/fade-in.ts`, `sass/opacify.ts` → `less/fadein.ts` | **no** — see §6.1 |
| `fade-out` / `transparentize` | `color.transparentize` | `fadeout` | `sass/fade-out.ts`, `sass/transparentize.ts` → `less/fadeout.ts` | **no** — see §6.1 |
| `list-separator` | `list.separator` | `separator` | `sass/list/separator.ts` | n/a (Less has neither). Global name is wrong today; module name is right. |
| `comparable` | `math.compatible` | `compatible` | `sass/compatible.ts` | n/a. The global `comparable` name does not exist anywhere — `sass/index.ts:22` is a TODO comment, not an implementation. |
| `str-length` | `string.length` | `length` | `sass/string/length.ts` | n/a. Collides with `sass/list/length.ts`, also named `length`. Registering both in one flat table is impossible — one silently overwrites the other. |
| `index` | `list.index` | `index` | `sass/list/list-index.ts` | correct name, filename deliberately avoids clashing with the barrel `index.ts`. |
| `map-get`/`map-merge`/… | `map.get`/`map.merge`/… | `get`, `set`, `merge`, `remove`, `keys`, `values`, `has-key` | `sass/map/*.ts` | Bare module names. As globals these must be `map-get`, `map-merge`, `map-remove`, `map-keys`, `map-values`, `map-has-key`. `map-set` has **no** Sass global (module-only) — correct as-is. |

### 6.1 `fade-in` is not `fadein` — the alias doc is wrong

`sass/NAME_ALIASES.md` asserts these are "functionally identical". They are not. The
amount is on a different scale:

```
fadein(rgba(255,0,0,0.5), 10%)   Less → rgba(255, 0, 0, 0.6)
fade-in(rgba(255,0,0,0.5), 10%)  Sass → Error: $amount: Expected 10% to be within 0 and 1
fade-in(rgba(255,0,0,0.5), 0.1)  Sass → rgba(255, 0, 0, 0.6)
opacify(rgba(255,0,0,0.5), 0.1)  Sass → rgba(255, 0, 0, 0.6)
transparentize(rgba(255,0,0,0.5), 0.1) Sass → rgba(255, 0, 0, 0.4)
fadeout(rgba(255,0,0,0.5), 10%)  Less → rgba(255, 0, 0, 0.4)
```

Less takes a percentage (`10%` = +0.1 alpha). Sass takes a 0–1 fraction and **rejects**
a percentage outright. Re-exporting the Less body under the Sass name produces a function
that errors on every correct Sass call site and silently mis-scales any percentage that
slips through. `sass/fade-in.ts`, `sass/fade-out.ts`, `sass/opacify.ts`,
`sass/transparentize.ts` all need real Sass implementations, and the corresponding claims in
`NAME_ALIASES.md` need deleting.

### 6.2 `ie-hex-str` is not `argb` — a rename alone moves output

```
argb(rgba(255,0,0,0.5))        Less → #80ff0000   (lower case)
ie-hex-str(rgba(255,0,0,0.5))  Sass → #80FF0000   (UPPER case)
jess (Less path) @3202ff246    → #80ff0000
```

Same `#AARRGGBB` layout, different case. Registering `builtins/argb.ts` under the name
`ie-hex-str` gives SCSS the wrong case. This one needs a separate Sass body.

## 7. Missing implementations

| name | reported | actual | notes |
|---|---|---|---|
| `type-of` | missing | **CONFIRMED MISSING** | zero occurrences of `type-of` or `typeOf` anywhere in `packages/fns/src`. Sass: `type-of(10px)` → `number`. Belongs to `sass:meta`. |
| `str-length` | missing | **CONFIRMED MISSING under that name** | `sass/string/length.ts` implements the body but registers as `length`. The string `str-length("abc")` → Sass `3`. Needs the global name; also collides with `list.length` (§6). |
| `comparable` | missing | **CONFIRMED MISSING under that name** | `sass/compatible.ts` implements `math.compatible`. `comparable(1px, 2em)` → Sass `false`. `sass/index.ts:22` is a TODO comment. |

Additionally missing outright (searched, zero hits in `packages/fns/src`): `inspect`,
`keywords`, `call`, `get-function`, `module-functions`, `module-variables` (all `sass:meta`);
the entire `sass:selector` module; `math.div`, `math.clamp`, `math.hypot`, `math.log`,
`math.sqrt`, `math.pow`, and the `sass:math` trig family; `string.split`; `list.slash`;
`map.deep-merge`, `map.deep-remove`; `color.adjust`, `color.scale`, `color.change`,
`color.channel`, `color.space`, `color.to-space`, `color.whiteness`, `color.blackness`,
`color.same`, `color.is-legacy`, `color.is-in-gamut`; and the constructors `hwb`, `lab`,
`lch`, `oklab`, `oklch`.

Two exist but **throw**: `sass/complement.ts` and `sass/invert.ts` both
`throw new Error('… not yet implemented')`. dart-sass: `complement(#f00)` → `aqua`,
`invert(#f00)` → `aqua`. Treat as MISSING with a placeholder file.

## 8. Drift — files on disk that no registration reaches

These are the dangerous ones. Each is an implementation of a **registered name** that the
registry does **not** currently use. Wiring one in moves output.

### 8.1 Dormant `builtins/` files that would corrupt Less if registered

`builtins/index.ts` imports `round`, `ceil`, `floor` from `../shared/math/` and `abs` from
`../less/abs.js` (which re-exports `shared/math/abs.ts`). That leaves three files unreferenced:

| file | what it would do if wired in | delta |
|---|---|---|
| `builtins/abs.ts` | `defineFunction('abs', unaryMath(Math.abs, undefined))` | **breaks angles.** `unaryMath` routes through `applyMath`, which maps every argument through `normalizeAngle` (`builtins/math-helper.ts`) unless `outUnit === null`. With `outUnit: undefined`, `abs(-45deg)` becomes `Math.abs(-45 × π/180)` re-labelled `deg` ⇒ `0.7853981633974483deg`. Registered `shared/math/abs.ts` gives `45deg`, matching Less 4.8 and dart-sass. |
| `builtins/ceil.ts` | `unaryMath(Math.ceil, undefined)` | same angle-normalisation bug: `ceil(2.4deg)` → `1deg` instead of `3deg`. |
| `builtins/floor.ts` | `unaryMath(Math.floor, undefined)` | same. |

**Delete these three.** They are strictly worse than the registered versions. (`builtins/tan.ts`
uses `unaryMath(Math.tan, '')` — `outUnit` is `''`, angle normalisation is *wanted* there, and it
*is* registered. It is correct; do not lump it in.)

### 8.2 Dormant `less/` files that shadow registered builtins

`less/index.ts` exports these; the registry uses the `builtins/` version instead. A consumer
doing `import { unit } from '@jesscss/fns'` gets a **different function** than the compiler runs.

| file | registered rival | behavioural delta |
|---|---|---|
| `less/unit.ts` | `builtins/unit.ts` | equivalent. Pure duplication. |
| `less/get-unit.ts` | `builtins/get-unit.ts` | `makeKeyword(value.unit)` vs `makeKeyword(value.unit ?? '')`. Differs only if `unit` is `undefined`. |
| `less/convert.ts` | `builtins/convert.ts` | **has a NaN bug.** For two unknown units, `groupOf(a) !== groupOf(b)` is `undefined !== undefined` ⇒ false, so it falls through to `unitFactor(unknown)!` (undefined) and multiplies ⇒ `NaN`. The registered version guards with `g !== undefined`. |
| `less/asin.ts` | `builtins/asin.ts` | inline `Math.asin(value.number)` with no angle normalisation vs `unaryMath(Math.asin,'rad')` which normalises. `asin(0.5rad)` differs. |
| `less/atan.ts` | `builtins/atan.ts` | same. |
| `less/tan.ts` | `builtins/tan.ts` | equivalent (both normalise deg/grad/turn). |
| `less/range.ts` | `builtins/range.ts` | equivalent. |
| `shared/color/red.ts`, `green.ts`, `blue.ts`, `alpha.ts` | `builtins/red.ts` etc. | equivalent bodies; the `builtins/` copies just add `requireColor()` and named params. |
| `shared/math/min.ts`, `max.ts` | `less/min.ts`, `less/max.ts` | **entirely different implementations.** The `shared/` pair is legacy tree-node `Node.compare()` sorting; the registered pair delegates to `less/min-max.ts`, which does full unit unification and honours `modes.unitMode === 'strict'`. Only the `less/` pair is live. |

### 8.3 `less/index.ts` gaps

- **`export { default as format } from './format.js'` (`less/index.ts:31`) exports the wrong
  function.** `less/format.ts:73` is `export default formatPercent` — the `%` fn — while
  `string-format` is only a named export (`less/format.ts:60`). So
  `import { format } from '@jesscss/fns'` hands the caller `%`, not `string-format`, and
  `string-format` has no barrel export at all. Registry-only path is unaffected
  (`builtins/index.ts:105` imports both by name), so this is an API bug, not an output bug.
- Exports `iif`, `boolean`, `not`, `and`, `or`, `isdefined`, `isruleset`, `each` — all
  unregistered and all special-formed in core (§2). Dead code in the compiled path.

### 8.4 Open question for the owner (not resolved here)

jess @ `3202ff246` returns `red(rgb(1.6,2,3))` → `2`, i.e. it **rounds**, matching dart-sass
and diverging from Less 4.8's `1.6`. This audit does not have Less v5-alpha behaviour
(§1), so it cannot say whether that is an intentional v5 change or a live Less regression.
Flagging it because the follow-up will be moving exactly this code; it should not silently
change the rounding either way.

## 9. Module granularity — folder = module = export subpath

Target: `#sass/color`, `#sass/list`, `#sass/map`, `#sass/math`, `#sass/string`, and
(when implemented) `#sass/meta`, `#sass/selector`. Less has no module system — `less/` is
one flat module.

### 9.1 Current layout vs the module a function actually belongs to

**Correctly placed** (folder already matches module):

- `sass/list/` → `sass:list`: `append`, `is-bracketed`, `join`, `length`, `list-index`
  (= `list.index`), `nth`, `separator`, `set-nth`, `zip`. All nine correct. Only the
  *global* alias for `separator` is wrong (§6).
- `sass/map/` → `sass:map`: `get`, `set`, `merge`, `remove`, `keys`, `values`, `has-key`.
  All seven correct as module members.
- `sass/string/length.ts` → `sass:string`. Correct module, wrong global name.
- `sass/color/red.ts` → `sass:color`. Correct.
- `sass/math/abs.ts` → `sass:math`. Correct.

**Misplaced — sitting at `sass/` root, belong in a module subfolder:**

| file | belongs in |
|---|---|
| `sass/unit.ts`, `sass/unitless.ts`, `sass/compatible.ts`, `sass/percentage.ts`, `sass/random.ts` | `sass/math/` (`sass:math`) |
| `sass/hue.ts`, `sass/saturation.ts`, `sass/lightness.ts`, `sass/opacity.ts`, `sass/grayscale.ts`, `sass/invert.ts`, `sass/complement.ts`, `sass/ie-hex-str.ts`, `sass/adjust-hue.ts`, `sass/opacify.ts`, `sass/transparentize.ts`, `sass/fade-in.ts`, `sass/fade-out.ts` | `sass/color/` (`sass:color`) |
| `sass/quote.ts`, `sass/unquote.ts`, `sass/to-upper-case.ts`, `sass/to-lower-case.ts`, `sass/unique-id.ts`, `sass/str-index.ts`, `sass/str-insert.ts`, `sass/str-slice.ts` | `sass/string/` (`sass:string`) — and rename to their module names: `index`, `insert`, `slice` |

`sass/math/index.ts` and `sass/color/index.ts` already reach up with `'../unitless.js'`,
`'../hue.js'` etc., which is exactly the symptom of the files being one level too high.

**Asymmetric subfolders:** `sass/color/` has a file only for `red` (green/blue/alpha are
re-exported from `shared/`); `sass/math/` has a file only for `abs`. Once §4 splits
`red`/`green`/`blue` out of `shared/`, `sass/color/` needs `green.ts`, `blue.ts`,
`alpha.ts` too; `sass/math/` needs `ceil.ts`, `floor.ts`, `round.ts`, `max.ts`, `min.ts`.

**Naming conflict to resolve up front:** `sass/list/index.ts` is the barrel while
`list.index` is a real function, and `sass/string/index.ts` is the barrel while
`string.index` is a real function. `sass/list/list-index.ts` already sidesteps this; the
string module will need the same treatment (`str-index.ts` → e.g. `sass/string/string-index.ts`).

## 10. Ordered migration plan

Ground rules taken from the owner: **no compat shims, no deprecated aliases, no old path
kept alive**. Every step is a clean cutover with its call sites updated in the same commit.
Internal import paths and assembly lists may break freely. Compiled **Less** CSS may not.

### 10.1 Class A — cannot change output

Nothing here is reachable from `makeBuiltinRegistry()`. Verify with
`grep -n "from './<name>.js'" packages/fns/src/builtins/index.ts` before each move.

**A-1. Delete the three corrupting dormant files.** `builtins/abs.ts`, `builtins/ceil.ts`,
`builtins/floor.ts` (§8.1). No importer exists. This removes the single largest footgun in
the package before anything else is moved.

**A-2. Delete the seven dormant `less/` shadows** and point `less/index.ts` at the
registered `builtins/` versions: `less/unit.ts`, `less/get-unit.ts`, `less/convert.ts`,
`less/asin.ts`, `less/atan.ts`, `less/tan.ts`, `less/range.ts` (§8.2). Also delete
`shared/math/min.ts` and `shared/math/max.ts` and re-point `sass/index.ts` (they are legacy
and dead; `less/min.ts`/`less/max.ts` are the live pair). Also delete `shared/color/red.ts`,
`green.ts`, `blue.ts`, `alpha.ts` in favour of the registered `builtins/` bodies —
equivalent bodies, one survivor.

**A-3. Collapse the `less/*.ts` pure re-export shims.** 25 files re-export from `builtins/`
plus a handful from `shared/`
(`less/argb.ts`, `less/cos.ts`, `less/e.ts`, `less/hue.ts`, `less/mod.ts`, …) are one-line
`export { x as default } from '../builtins/x.js'`. Fold `builtins/` into `less/` so that
"folder = module" holds for Less too, and let `builtins/index.ts` import from `less/`.
Mechanical; no body changes.

**A-4. Delete the dead special-formed Less files.** `less/isdefined.ts`,
`less/isruleset.ts`, `less/logical.ts`, `less/iif.ts`, `less/each.ts` — core handles all
five in `serialize.ts` (§2). Confirm with a Less byte-identity run; expected delta zero.

**A-5. Relocate the misplaced Sass files into their module folders** (§9.1) and rename to
module member names. All of `sass/` is unregistered, so this is inert.

**A-6. Correct `shared/` membership.** Move `round`, `min`, `max`, `red`, `green`, `blue`
out of `shared/`. Because the registry imports `round` from `../shared/math/round.js`
today, this step **must** re-point `builtins/index.ts` at the new Less location in the same
commit, byte-for-byte the same body. If the body is untouched, output is unchanged — but
this is the one Class A step where a slip becomes Class C, so gate it on a Less
byte-identity run rather than on inspection.

After A, `shared/` contains exactly `abs`, `ceil`, `floor`, `alpha`.

### 10.2 Class B — changes SCSS output only

SCSS is far from a stable baseline (`packages/jess/test/scss/bootstrap-corpus.test.ts:201–202`,
`PARSE_PASS_FLOOR = 29`, `EVAL_PASS_FLOOR = 0` — verified), so these are cheap. They are
also the whole point of the exercise.

**B-1. Introduce a second registry.** `makeSassRegistry()` alongside `makeBuiltinRegistry()`,
and have the dialect selection in `packages/jess/src/index.ts:39` pick per input dialect
rather than building one evaluator for everything. Until this lands, no `sass/` classification
can take effect. This is the enabling step; on its own (empty Sass registry) it turns the
currently-wrong SCSS answers into `no fn:` errors, which is a truthful regression.

**B-2. Port the Sass value-domain set.** The 42 legacy tree-node exports (§3.1) must be
rewritten as `Fn` before they can be registered. Order by dependency: `sass:math`
(`unit`, `unitless`, `percentage`, `compatible`/`comparable`, `random`) → `sass:string`
(the eight files, plus the `str-length` name) → `sass:color` (the thirteen files) →
`sass:map` (the seven). `sass:list` is already value-domain and needs only the
`list-separator` global name.

**B-3. Land the DIVERGENT splits**, each with its own Sass body. Expected SCSS deltas,
all currently wrong and all becoming correct:

| function | SCSS today | SCSS after |
|---|---|---|
| `unit(10px)` | `10` | `"px"` |
| `length(a, b, c)` | `1` | arity error; `length((a,b,c))` → `3` |
| `hue(#f00)` | `0` | `0deg` |
| `percentage(50px)` | `5000%` | error |
| `round(1.234, 2)` | `1.23` | `2` |
| `red(rgb(1.6,2,3))` | `2` | `2` (Sass rounds — unchanged, but now for the right reason) |
| `mix(#f00,#00f)` | `#800080` | `rgb(127.5, 0, 127.5)` |
| `max(1px, 2em)` | error | plain CSS `max(1px, 2em)` |
| `ie-hex-str(rgba(255,0,0,.5))` | unresolved | `#80FF0000` |
| `fade-in(c, 0.1)` | unresolved | `rgba(…, +0.1)` |

**B-4. Fill the MISSING set** (§7): `type-of`, `str-length`, `comparable`, `complement`,
`invert`, then the wider `sass:meta` / `sass:math` / `color.*` backlog. Each is additive to
the Sass registry only.

**B-5. Delete `sass/NAME_ALIASES.md`'s false claims** — specifically the `fade-in`,
`fade-out`, `opacify`, `transparentize`, and `ie-hex-str` entries, which this audit
disproves (§6.1, §6.2). `grayscale`/`greyscale` and `adjust-hue`/`spin` entries are correct
and can stay as documentation of a pure rename.

### 10.3 Class C — would change LESS output. Individually gated.

Less byte-identity vs `origin/dev` is the hard gate. Each of these must be run and diffed on
its own, not batched.

**C-1 — `shared/` re-pointing (from A-6).** *Expected delta: none.* Bodies are moved, not
edited. Gate: full Less corpus byte-identity. If any byte moves, the move was not
body-preserving; fix forward, do not revert the split.

**C-2 — `builtins/index.ts` import churn (from A-2, A-3).** *Expected delta: none.* The
seven dormant `less/` shadows are not registered, so removing them changes no registration.
Risk is a typo swapping in the wrong `<name>.ts` — e.g. re-pointing `abs` at the deleted
`builtins/abs.ts` would turn `abs(-45deg)` into `0.7853981633974483deg`. Gate: assert the
registry's 83 names and their source modules before/after.

**C-3 — arity strictness, IF the follow-up adopts it.** *Expected delta on Less: none for
valid input; new errors for `abs(1px, 2)`, `ceil(1.5px, 2)`, `floor(2px, 1)`, which Less
currently accepts silently.* This is a **behaviour change to Less** and should not be bundled
into a relocation. Recommend deferring it and keeping `abs`/`ceil`/`floor` in `shared/`
(§4.1) until the owner rules on whether Less's arity tolerance is contract.

**C-4 — `red`/`green`/`blue` rounding (§8.4).** *Potential delta: `red(rgb(1.6,2,3))`
`2` → `1.6` if the Less copy is made to match Less 4.8.* Do **not** make this change as part
of the split. Split first with the current rounding body verbatim (delta zero), then raise
the rounding question separately once Less v5-alpha behaviour can be observed.

No step in this plan keeps an old export path alive alongside a new one; each rename or move
updates its importers in the same commit.

## 11. Summary of corrections to the brief's inherited claims

| claim | verdict |
|---|---|
| SCSS is served Less's `unit` and `length` | **confirmed, and understated** — also `hue`, `percentage`, and every other registered Less fn |
| `.scss unit(10px)` → `10`, Sass says `"px"` | confirmed by running jess and dart-sass |
| `.scss length(a,b,c)` → `1`, Sass says `3` | confirmed with a nuance: dart-sass **errors** on `length(a,b,c)` (arity); it returns `3` for `length((a,b,c))` |
| ~42 of 60 `sass/index.ts` exports are legacy | **exactly 42 of 60**; enumerated in §3.1 |
| `type-of`, `str-length`, `comparable` have no implementation | `type-of` truly absent; `str-length` and `comparable` have bodies under the *module* names `length` and `compatible` but no implementation under the global name |
| `separator`/`argb`/`greyscale`/`spin`/`fadein`/`fadeout`/`compatible` are name mismatches | confirmed — but `argb`/`ie-hex-str` and `fadein`/`fade-in` are **not** pure renames; they are behavioural divergences (§6.1, §6.2), so `NAME_ALIASES.md` is wrong about them |
| `shared/` was never validated | confirmed — 6 of its 10 members are DIVERGENT |
