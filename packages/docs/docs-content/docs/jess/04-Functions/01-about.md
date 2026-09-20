---
id: about
title: Introduction
audiences:
  - jess
origin: jess
---
Jess has no ambient function namespace. Import the helpers you use so the
stylesheet stays explicit and CSS function names remain available to the
browser.

The compiler provides trusted Less and Sass function modules:

```css
@-from "#less" import (mix);

.box {
  color: mix(#ff0000, #0000ff, 50%);
}
```

You can rename an imported helper:

```css
@-from "#less" import (rgb as jessRgb);

.color {
  color: jessRgb(1, 2, 3);
  background-color: rgb(255 255 255 / 0.8);
}
```

The first call uses the imported compiler function. The second remains a native
CSS function because no import claims the name `rgb`.

Use `@-use "#less" as less;` when a namespace reads better, then call helpers
as `$less.mix(...)`. Built-in compiler modules do not require a script runtime.
Local or package JavaScript and TypeScript modules require
`@jesscss/plugin-js`. See
[Modules & imports](/docs/language/modules-and-imports) for the shared Jess and
Less 5 module contract.
