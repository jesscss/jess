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

Unlike Less, all functions must be imported! This keeps the Jess runtime small and fast.

:::