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

- **One mapping per emitted node.** Each selector, declaration and at-rule starts a mapping that points at the place it was written. A value computed from a variable, an operation or a function call gets a mapping of its own; a value written as-is is covered by its declaration's mapping.
- **A selector is mapped as a whole, to the rule that owns it.** A selector list split over several lines is mapped once, at its first line. When nested rules are joined into one selector (`.container .header`), the whole selector points at the innermost rule (`.header`). Less 4.x maps each part to the rule that wrote it, so the two maps are not interchangeable mapping for mapping.
- **Injected text is not mapped.** A `banner` was never written in any source file, so it has no mapping. Text added around your file (`banner` and `globalVars` ahead of it, `modifyVars` after it) does not shift the mappings: they still point at the line and column you wrote, and `outputSourceFiles` embeds the file as you wrote it.
- **`sources` and `sourcesContent` list only files the map points into.** A file that produces no output — an import that only defines variables or mixins, say — is not listed. With `outputSourceFiles`, each listed file's content is embedded.
- **`sourceMapBasepath` is removed from the `sourceMappingURL` annotation**, as from every source path, the way Less 4.x does.
