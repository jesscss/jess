---
id: imports
title: Imports
---

Jess can import from other Jess stylesheets and JavaScript, and you can use [Rollup](https://rollupjs.org/) plugins to extend the types of imports.

```scss
// JavaScript example
@import { WIDTH } from './constants.js';

.box {
  width: $(WIDTH)px;
}
```
```scss
// Jess example
@import { myMixin } from './mixins.jess';

.box {
  @include myMixin();
}
```

### Ignoring imports

Imports that are not using the ES module pattern are ignored / output as-is. The output for the following will be the same as input.
```css
@import url("fonts.css");
```

### Importing stylesheets

You can import / mixin entire stylesheets using the default export.

```scss
@import nav from './nav.jess';
@include nav();
```