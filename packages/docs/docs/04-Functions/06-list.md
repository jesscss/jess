---
id: list
title: List Functions
sidebar_label: List
---

### each(_collection_, _mixin_)

```css
@-from '@jesscss/fns' import (each);
@let list: 1, 2, 3;

@mixin iterate (value, key) {
  .icon-$(value) {
    width: $value;
    height: $key;
  }
}
@include $each(list, iterate);
```

:::info

Unlike Less, keys in lists align with JavaScript, and are therefore *0-based* instead of *1-based*. _NOTE: Is that ideal?_

:::

This outputs:
```css
.icon-1 {
  width: 1;
  height: 0;
}
.icon-2 {
  width: 2;
  height: 1;
}
.icon-3 {
  width: 3;
  height: 2;
}
```