---
id: imports
title: Imports
audiences:
  - jess
origin: jess
---
Jess imports are intentionally practical: bring in stylesheet APIs, pull values from JS/TS, and keep source boundaries explicit.

```css
// JavaScript example
@import { WIDTH } from './constants.js';

.box {
  width: $(WIDTH)px;
}
```
```css
// Jess example
@import { myMixin } from './mixins.jess';

.box {
  @include myMixin();
}
```

### Ignoring imports

Imports that do not use the ESM-style pattern are treated as passthrough and emitted as-is. So this stays exactly what you wrote:
```css
@import url("fonts.css");
```

### Importing stylesheets

You can import / mixin entire stylesheets using the default export.

```css
@import nav from './nav.jess';
@include nav();
```

## Importing into JS Components

:::caution

Historically this section described an older runtime/module shape. The current `rollup-plugin-jess` behavior is intentionally minimal.

:::

### Using with React

Given the following Jess stylesheet `component.jess`...
```css
// component.jess
@mixin myMixin(something) {
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
