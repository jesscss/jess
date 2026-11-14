# vite-plugin-jess

A Vite plugin for [Jess](https://jesscss.github.io/): `.jess` and `.less`
imports, compiled by the `jess` compiler.

It is [`rollup-plugin-jess`](../rollup-plugin-jess) under Vite's name and
types. Under Vite the stylesheet's module imports its CSS, so Vite injects it
in dev and bundles it in a build.

## Install

```console
npm install vite-plugin-jess --save-dev
```

## Usage

```js
// vite.config.js
import jess from 'vite-plugin-jess';

export default {
  plugins: [jess()]
};
```

```js
import css from './theme.less';
```

The module's default export is the CSS. `./theme.less?inline` is that CSS as a
string, with nothing injected. Import a stylesheet from JavaScript: a `<link>`
to a `.less` or `.jess` file is not served in dev.

## CSS Modules

A `.module.less` (or `.module.jess`) stylesheet goes through Vite's CSS
Modules, as a `.module.css` file does: Jess evaluates it, then Vite scopes its
class names. The default export is the class map, and Vite's `css.modules`
options apply.

A stylesheet that also exposes variables has named exports `vars` and `set`, so
a class named `.vars` or `.set` is read from the default export.

```less
// card.module.less
.card { &__title { font-weight: bold; } }
```

```js
import styles from './card.module.less';

styles.card;         // '_card_1u2kc_1'
styles.card__title;  // '_card__title_1u2kc_2'
```

## Exposed variables

A stylesheet that exposes a variable writes each value that reads it as a
custom property, and its module exports `vars` and `set`:

```less
// theme.less
@use "#less";
@expose brand;
@brand: #c00;

.button { border-color: @less.darken(@brand, 10%); }
// .button { border-color: var(--brand-darken, #990000); }
```

```js
import { vars, set } from './theme.less';

set({ brand: '#08f' });            // on :root
set({ brand: '#08f' }, element);   // on one element
vars({ brand: '#08f' });           // { '--brand': '#08f', '--brand-darken': '#006dcc' }, e.g. as a React style
```

Each value is keyed by the variable's name with dash-case turned to camelCase:
`@brand-color` is `brandColor`.

A value that a computed value reads as a colour, or that holds a colour (`@list: #f00 #00f` read through `extract()`), is a hex colour (`#08f`). A
colour name (`red`) throws a `TypeError`, unless the stylesheet itself writes a
name the runtime reads (the variable's own value) or the plugin option
`colorNames: true` is set; this keeps the colour-name table out of the bundle
(R8 runtime spec, colour names). A name a computed call's own argument writes
as a colour, as in `lightness(multiply(@brand, gray))`, is read when the
stylesheet compiles and brings no table.

## Options

The same as `rollup-plugin-jess`:
- `config`: passed to the `jess` compiler (see `jess`'s `ConfigOptions`).
- `colorNames`: accept a colour name from `vars()` and `set()` for a variable a
  computed value reads as a colour. Default `false`.

## License

[MIT](../../LICENSE)
