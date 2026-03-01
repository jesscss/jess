---
id: imports
title: Imports
audiences:
  - jess
origin: jess
---
Jess can import from other Jess stylesheets and JavaScript, and you can use [Rollup](https://rollupjs.org/) plugins to extend the types of imports.

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

Imports that are not using the ES module pattern are ignored / output as-is. The output for the following will be the same as input.
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

This requires the Rollup or Webpack plugin, which are not ready yet! So this part of the API is currently the least stable and needs the most input!

:::

### Using with React

Given the following Jess stylesheet `component.m.jess`...
```css
// component.m.jess
@mixin myMixin(something) {
  width: $something;
  color: white;
}
.box {
  display: flex;
  align-items: center;
}
```
...the Rollup / Webpack plugin will allow you to import like this into a React component:
```jsx
import styles, { myMixin } from 'component.m.jess'

export const myComponent = props => {
  return (
    <div
      style={myMixin(props.something).obj()}
      className={styles.box}
    >
      foo
    </div>
  )
}
```
