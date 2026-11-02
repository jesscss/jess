[npm]: https://img.shields.io/npm/v/rollup-plugin-jess
[npm-url]: https://www.npmjs.com/package/rollup-plugin-jess
[size]: https://packagephobia.now.sh/badge?p=rollup-plugin-jess
[size-url]: https://packagephobia.now.sh/result?p=rollup-plugin-jess

[![npm][npm]][npm-url]
[![size][size]][size-url]
[![libera manifesto](https://img.shields.io/badge/libera-manifesto-lightgrey.svg)](https://liberamanifesto.com)

# rollup-plugin-jess

🍣 A Rollup plugin for [Jess](https://jesscss.github.io/)

## Status

This package has been **refreshed to be a minimal bridge to the modern `jess` compiler**.
Historically, it relied on a legacy “runtime module” architecture; today it compiles `.jess`
files using `jess`’s `Compiler` and **emits CSS as an asset**.

## Install

Using npm:

```console
npm install rollup-plugin-jess --save-dev
```

Using yarn:

```console
yarn add rollup-plugin-jess -D
```

## Usage

Create a `rollup.config.js` [configuration file](https://www.rollupjs.org/guide/en/#configuration-files) and import the plugin to compile `.jess` files:

```js
import jess from 'rollup-plugin-jess'

export default {
  entry: 'src/entry.js',
  // ...
  plugins: [
    jess()
  ]
};
```

Then call `rollup` either via the [CLI](https://www.rollupjs.org/guide/en/#command-line-reference) or the [API](https://www.rollupjs.org/guide/en/#javascript-api).

It compiles `.jess` and `.less` imports. The module's default export is the
CSS. Under Rollup the CSS is also emitted as an asset (`<name>.css`); under
Vite (the same plugin, in `plugins`) the module imports its CSS, so Vite
injects it in dev and bundles it in a build.

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

Values are CSS literals (`#08f`, `8px`, `red`). The runtime recomputes each
derived value with the same function the compile ran.

## Options

The plugin forwards options to the `jess` compiler. See `jess`’s `ConfigOptions`.


## License

[MIT](../../LICENSE)