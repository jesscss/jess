---
id: math
title: Math Functions
sidebar_label: Math
---

### op([_Expression_])

A math operation. Parses math expressions and returns results, preserving node types. This is done in an external function (vs. a language feature) to keep the Jess runtime small and speedy. (You may not need to import it, if you perform all your operations in JavaScript, and don't care about preserving units.)

#### Example
```scss
@import { op } from '@jesscss/fns';
.box {
  one: op(2px * (2 + 1));
  two: op(2px * 3 * 2);
  color: op(#333 * 2);
}
```
Output:
```css
.box {
  one: 6px;
  two: 12px;
  color: #666666;
}
```
:::note

Dimension nodes in Jess have a `valueOf()` method that JavaScript uses when performing math, so in the case of a `myDimension` variable set to `2px`, you can just do `$(myDimension * 3)`. This would return a value of `6`.

Color math, however, gets more complicated, so you may want to use color functions or `op()` in that case.

:::

:::tip

If you're performing a lot of operations using `op`, one way to give it a small footprint in your syntax is to alias it to `_` like the example below.

:::

```scss
@import { op as _ } from '@jesscss/fns';
.box {
  one: _(2px * (2 + 1));
  two: _(2px * 3 * 2);
  color: _(#333 * 2);
}
```
