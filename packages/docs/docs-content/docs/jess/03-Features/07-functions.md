---
id: functions
title: Functions
audiences:
  - jess
origin: jess
---

:::info

Imported functions are lexical. `@-from` binds selected names and aliases;
`@-use` binds them through a namespace. Jess has no ambient Less or Sass
function namespace. See
[Modules & imports](/docs/language/modules-and-imports) for the canonical
contract.

:::

Import a function, then call its explicit `$` binding:

```less
@-from './functions.js' import (double);

.box {
  width: $double(10px);
}
```

The function receives and returns typed values. A dimension keeps its unit, so
the example emits:

```css
.box {
  width: 20px;
}
```

:::note

Bare `double(10px)` is always a CSS-shaped call and remains available to the
browser. An import never changes its meaning. Both imported functions and
[stylesheet-defined functions](/docs/Language/functions) use explicit `$name(…)`
calls; their definitions come from different places.

:::
