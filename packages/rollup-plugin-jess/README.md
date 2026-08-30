[npm]: https://img.shields.io/npm/v/rollup-plugin-jess
[npm-url]: https://www.npmjs.com/package/rollup-plugin-jess
[size]: https://packagephobia.now.sh/badge?p=rollup-plugin-jess
[size-url]: https://packagephobia.now.sh/result?p=rollup-plugin-jess

[![npm][npm]][npm-url]
[![size][size]][size-url]
[![libera manifesto](https://img.shields.io/badge/libera-manifesto-lightgrey.svg)](https://liberamanifesto.com)

# rollup-plugin-jess

🍣 A Rollup plugin for [Jess](https://jesscss.github.io/)

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

Create a `rollup.config.js` [configuration file](https://www.rollupjs.org/guide/en/#configuration-files) and import the plugin to convert Jess files to runtime modules:

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

## Options

See: https://jesscss.github.io/docs/intro/config#options


## License

[MIT](../../LICENSE)