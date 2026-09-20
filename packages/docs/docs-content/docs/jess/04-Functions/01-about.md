---
id: about
title: Introduction
audiences:
  - jess
origin: jess
---
You can optionally install the `@jesscss/fns` package to add a number of helper functions to your stylesheets.

Most of these functions (especially color functions) are imported and converted from Less.js.

The future explicit import form is:
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

:::caution Script imports do not bind yet

In the 2.x alpha the `@-from` line parses and round-trips, but the evaluator
does not bind its exports. Two consequences today:

- **Import aliasing does not work.** `jessRgb(1, 2, 3)` above is passed through
  verbatim — it is not evaluated as `rgb()`.
- **Built-in helpers resolve by name without an import today.** The `mix`
  example above produces `#800080` with the `@-from` line removed.

See [Modules & imports](/docs/language/modules-and-imports) for the canonical
module status.

:::
