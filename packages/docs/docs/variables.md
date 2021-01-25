---
id: variables
title: Variables
---

In Jess, you can declare variables using the `@let` at-rule.

```scss
@let myColor: #ABC;
```
_Note: variables at the root of the document are automatically exported (with `export let`)._

Variables are referenced using the `$` symbol.
```scss
.box {
  color: $myColor;  // or $(myColor)
}
```