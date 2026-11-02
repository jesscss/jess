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

The module's default export is the CSS.

## Exported variables

A stylesheet that exports a variable writes each value that reads it as a
custom property, and its module exports `vars` and `set`:

```less
// theme.less
@use "#less";
@export @brand: #c00;

.button { border-color: @less.darken(@brand, 10%); }
// .button { border-color: var(--brand-darken, #990000); }
```

```js
import { vars, set } from './theme.less';

set({ brand: '#08f' });            // on :root
set({ brand: '#08f' }, element);   // on one element
vars({ brand: '#08f' });           // { '--brand': '#08f', '--brand-darken': '#006dcc' }, e.g. as a React style
```

## Options

The same as `rollup-plugin-jess`: `config` is passed to the `jess` compiler
(see `jess`'s `ConfigOptions`).

## License

[MIT](../../LICENSE)
