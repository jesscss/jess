---
id: functions
title: Functions
audiences:
  - jess
origin: jess
---

:::danger Imported functions are not resolved yet

`@-from` parses and is preserved, but there is no module resolver in the 2.x
alpha, so an imported function is never loaded or called. A call like
`double(10px)` is passed through to the output verbatim. The syntax below is
current; the behavior is the target.

Jess's **built-in** functions (`mix`, `hsl`, `luma`, …) do work today — and they
resolve by name, without an import.

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
