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

You import functions and call them like any other function:

```less
@-from './functions.js' import (double);

.box {
  width: double(10px);
}
```

Like Less, Jess will attempt to evaluate a CSS-shaped function call as a JS
function call when that name was imported in scope. The reason you might want
that is to have the function receive and return typed values — for example a
dimension, so units are preserved:

```css
.box {
  width: 20px;
}
```

:::note

The `$myFunction()` spelling is a **different** thing: it calls a function that was
defined in a stylesheet and bound to a variable, which is a value, not an imported
name. See [stylesheet-defined functions](/docs/Language/functions). Call *imported*
functions by their bare name, as above.

:::
