---
title: "Third Party Compilers"
slug: "/tools/third-party-compilers"
audiences:
  - less
origin: less
---
## Node.js Tools

* **[grunt-contrib-less](https://github.com/gruntjs/grunt-contrib-less)**
* **[gulp-less](https://github.com/plus3network/gulp-less)**: Please note that this plugin discards `source-map` options, opting to instead using the [gulp-sourcemaps](https://github.com/floridoo/gulp-sourcemaps) library.
* **[svelte-preprocess](https://raw.githubusercontent.com/sveltejs/svelte-preprocess/main/docs/preprocessing.md)**: Converts Less to CSS before passing it to the Svelte compiler.
* **[Connect Middleware for Less](https://github.com/emberfeather/less.js-middleware)**: Connect Middleware for Less compiling


## Build Pipeline Integrations

* **[webpack less-loader](https://webpack.js.org/loaders/less-loader/)**: First-party webpack integration for Less files.
* **[Vite CSS preprocessor options](https://vite.dev/config/shared-options.html#css-preprocessoroptions)**: Configure Less through Vite.
* **[Angular component styling](https://angular.dev/guide/components/styling)**: Angular supports Less component and global styles.

**Also see:** 

* [Ports of Less](./ports)
