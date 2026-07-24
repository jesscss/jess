---
id: imports
title: Imports
audiences:
  - jess
origin: jess
---

:::caution Syntax is current; resolution is not wired yet

The import **syntax** on this page is the current 2.x spelling and parses today.
Import **resolution** does not exist yet in the alpha: `@-compose` and `@-from`
are recognized, kept in the document, and serialized back out verbatim. The
compiler does not yet load, evaluate, or inline the referenced file, so the
behavior described below is the target, not today's output — and referencing a
name that would come from an import is currently a compile error
(`Name not found`).

:::

Jess imports are intentionally practical: bring in stylesheet APIs, pull values from JS/TS, and keep source boundaries explicit.

Every Jess compiler at-rule is dash-prefixed (`@-compose`, `@-from`, `@-use`), so
Jess never claims a bare CSS at-keyword. A bare `@import` in a `.jess` file is
always plain CSS.

```css
// JavaScript example
@-from './constants.js' import (WIDTH);

.box {
  width: $($WIDTH * 1px);
}
```
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

## Importing into JS Components

:::caution

Historically this section described an older runtime/module shape. The current `rollup-plugin-jess` behavior is intentionally minimal.

:::

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
