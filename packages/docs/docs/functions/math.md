---
id: math
title: Math Functions
sidebar_label: Math
---

### op([_Expression_])

Parses math expressions and returns results, preserving node types.

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
