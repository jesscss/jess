---
title: "Node.js Build Workflows"
slug: "/usage/using-less"
audiences:
  - less
origin: less
---
:::info
In the 5.x track, Less is a Node.js build workflow first. Browser integration is handled through an update-script model (in development), not a full in-page compiler runtime.
:::

## Installation

For one-off compile runs, use install-on-demand commands:

```bash
$ npx --yes --package less lessc styles.less styles.css
$ pnpm --package=less dlx lessc styles.less styles.css
```

For repeat local usage in a project, prefer a dev dependency plus package-manager exec:

```bash
$ pnpm add -D less
$ pnpm exec lessc styles.less styles.css
```

## Command-line Usage

Compile from the command line:

```bash
$ lessc styles.less
```

This will output the compiled CSS to `stdout`. To save the CSS result to a file of your choice use:

```bash
$ lessc styles.less styles.css
```

To output minified CSS you can use the [`clean-css` plugin](https://github.com/less/less-plugin-clean-css). When the plugin is installed, a minified CSS output is specified with `--clean-css` option: 

```bash
$ lessc --clean-css styles.less styles.min.css
```

To see all command-line options, run `lessc` without parameters or see [Less.js Options](./less-options).

## Browser update-script integration (development)

In 5.x, browser usage is modeled as a build output integration:

1. Build Less in Node.js.
2. Include the generated update script in browser environments where dynamic style attachment is needed.

This workflow is still evolving. Track caveats in [Migrating to v5](./migrating-to-v5) and [Browser Usage](./using-less-in-the-browser).

## Usage in Code

You can invoke the compiler from Node directly:

```js
var less = require('less');

less.render('.class { width: (1 + 1) }', function (e, output) {
  console.log(output.css);
});
```

which will output

```css
.class {
  width: 2;
}
```

## Configuration

You may pass some options to the compiler:

```js
var less = require('less');

less.render('.class { width: (1 + 1) }',
    {
      paths: ['.', './lib'],  // Specify search paths for @import directives
      filename: 'style.less', // Specify a filename, for better error messages
      compress: true          // Minify CSS output
    },
    function (e, output) {
       console.log(output.css);
    });
```

See [Less.js Options](./less-options) for more information.

## Third Party Tools

See the [Tools](../tools/editors-and-plugins) section for details of other tools.
