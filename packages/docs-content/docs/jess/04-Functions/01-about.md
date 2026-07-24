---
id: about
title: Introduction
audiences:
  - jess
origin: jess
---
You can optionally install the `@jesscss/fns` package to add a number of helper functions to your stylesheets.

Most of these functions (especially color functions) are imported and converted from Less.js.

To use, import them like:
```css
@-from '@jesscss/fns' import (mix);

.box {
  color: mix(#ff0000, #0000ff, 50%);
}
```

:::info

Unlike Less, functions are meant to be imported explicitly. This keeps the Jess
runtime small and fast, and it lets you rename a helper so it never collides with
a CSS function of the same name.

:::

```css
@-from '@jesscss/fns' import (rgb as jessRgb);

.color {
  color: jessRgb(1, 2, 3);
  background-color: rgb(255 255 255 / 0.8);
}
```
This is intended to produce:
```css
.color {
  color: rgb(1, 2, 3);
  background-color: rgb(255 255 255 / 0.8);
}
```

:::caution Import resolution is not wired yet

In the 2.x alpha the `@-from` line parses and round-trips, but no module is
resolved. Two consequences today:

- **Import aliasing does not work.** `jessRgb(1, 2, 3)` above is passed through
  verbatim — it is not evaluated as `rgb()`.
- **Built-in helpers resolve by name whether or not you import them.** The `mix`
  example above produces `#800080` even with the `@-from` line removed. Keep
  writing the import — it is the intended contract — but don't rely on the
  import being what makes it work.

:::