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

## What the map contains

- **One mapping per emitted node.** Each selector, declaration, value and at-rule starts a mapping that points at the place it was written. Less 4.x writes one mapping per output chunk instead, so the two maps differ in size but point each token at the same place. A selector list split over several lines is mapped once, at its first line, to the rule that owns it.
- **Injected text is not mapped.** A `banner` was never written in any source file, so it has no mapping. Text added ahead of your file (`banner`, `globalVars`) does not shift the mappings after it: they still point at the line and column you wrote.
- **`sources` and `sourcesContent` list only files the map points into.** A file that produces no output — an import that only defines variables or mixins, say — is not listed. With `outputSourceFiles`, each listed file's content is embedded.
- **`sourceMapBasepath` is removed from the `sourceMappingURL` annotation**, as from every source path, the way Less 4.x does.
