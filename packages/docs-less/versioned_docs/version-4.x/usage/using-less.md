---
title: "Server-side Usage"
slug: "/usage/using-less"
audiences:
  - less
origin: less
---
Less can run in the CLI, in Node APIs, or through third-party build tools.

## Installation

For one-off compile runs, use install-on-demand commands:

```bash
npx --yes --package less lessc styles.less styles.css
pnpm --package=less dlx lessc styles.less styles.css
```

For repeat local usage in a project, prefer a dev dependency:

```bash
pnpm add -D less
pnpm exec lessc styles.less styles.css
```

## Command-line Usage

Compile from the command line:

```bash
lessc styles.less
```

Save output to a target file:

```bash
lessc styles.less styles.css
```

To output minified CSS, use the [`clean-css` plugin](https://github.com/less/less-plugin-clean-css):

```bash
lessc --clean-css styles.less styles.min.css
```

## Usage in Code

```js
var less = require('less');

less.render('.class { width: (1 + 1) }', function (e, output) {
  console.log(output.css);
});
```

## Configuration

```js
var less = require('less');

less.render('.class { width: (1 + 1) }',
    {
      paths: ['.', './lib'],
      filename: 'style.less',
      compress: true
    },
    function (e, output) {
       console.log(output.css);
    });
```

See [Less.js Options](./less-options) for more details.
