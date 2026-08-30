---
id: about
title: Introduction
---

You can optionally install the `@jesscss/fns` package to add a number of helper functions to your stylesheets.

Most of these functions (especially color functions) are imported and converted from Less.js.

To use, import them like:
```scss
@import { mix } from '@jesscss/fns';

.box {
  color: mix(#ff0000, #0000ff, 50%);
}
```

:::note

Unlike Less, all functions must be imported! This keeps the Jess runtime small and fast. It also prevents conflicts with CSS function names, because you can do the following, using the power of module syntax!

:::

```scss
@import { rgb as jessRgb } from '@jesscss/fns';

.color {
  color: jessRgb(1, 2, 3);
  background-color: rgb(255 255 255 / 0.8);
}
```
This will produce:
```css
.color {
  color: rgb(1, 2, 3);
  background-color: rgb(255 255 255 / 0.8);
}
```