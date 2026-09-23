---
id: imports
title: Imports
audiences:
  - jess
origin: jess
---

:::info Script and data imports

`@-use` and `@-from` bind module exports at compile time. JSON modules need
no script runtime; JavaScript and TypeScript modules require
`@jesscss/plugin-js`. See
[Modules & imports](/docs/language/modules-and-imports) for the canonical
contract.

:::

Jess imports are intentionally practical: bring in stylesheet APIs, pull values from JS/TS, and keep source boundaries explicit.

Every Jess compiler at-rule is dash-prefixed (`@-compose`, `@-from`, `@-use`), so
Jess never claims a bare CSS at-keyword. A bare `@import` in a `.jess` file is
always plain CSS.

```css
// Jess example
@-compose './mixins.jess' as *;

.box {
  $ > myMixin();
}
```

### Ignoring imports

A bare `@import` is never a compiler import. It is treated as plain CSS and emitted as-is, so this stays exactly what you wrote:
```css
@import url("fonts.css");
```

### Importing stylesheets

You fold an entire stylesheet in with `@-compose`. Without `as`, the module's
namespace is inferred from the file name; `as *` composes it without a namespace.

```css
@-compose './nav.jess';
```

See [Modules & imports](/docs/language/modules-and-imports) for namespaces,
`with { … }` configuration, and the `(reference)` / `(mutable)` / `(export)` flags.

## Importing into JS components

### Using with React

Given the following Jess stylesheet `component.jess`...
```css
// component.jess
myMixin($something) {
  width: $something;
  color: white;
}
.box {
  display: flex;
  align-items: center;
}
```
...`rollup-plugin-jess` compiles it, emits a CSS asset, and returns the compiled CSS as the default JS export:
```jsx
import cssText from './component.jess';

console.log(cssText);
```

Today this is not a CSS Modules-style named export API. If you need that shape, layer it in at the bundler/runtime boundary.
