# jess-loader

_WIP: in alpha, doesn't work yet_

A Webpack loader for [Jess](https://jesscss.github.io/)

## Install

Using npm:

```console
npm install jess jess-loader --save-dev
```

Using yarn:

```console
yarn add jess jess-loader -D
```

Then add the loader to your `webpack` config. For example:

**webpack.config.js**

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.jess$/i,
        loader: "jess-loader", // compiles Jess to CSS/modules
      },
    ],
  },
}
```

And run `webpack` via your preferred method.