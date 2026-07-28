---
title: "Sourcemaps"
slug: "/usage/sourcemaps"
audiences:
  - less
origin: less
---
Use Less source maps to map generated CSS lines back to `.less` source files.

## CLI

Generate source maps with:

```bash
lessc --source-map styles.less styles.css
```

## Node API

```js
const less = require('less');

less.render(input, {
  sourceMap: {}
}).then(output => {
  // output.css
  // output.map
});
```

For detailed options, see [Less.js Options](./less-options).
