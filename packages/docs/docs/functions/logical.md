---
id: logical
title: Logical Functions
sidebar_label: Logical
---

### iif(_condition_, _ifValue_, _elseValue_)

```scss
@import { iif } from '@jesscss/fns';
.box {
  width: iif($(value > 10), 20px, 10px);
}
```

#### Advanced Example

:::note

This example demonstrates a pattern of using `iif` like Less's `when` guards, including a `default()` (fallback) mixin guard. It's verbose, but this is just to prove that with the power of JavaScript behind it, there's nothing you can do in Less or Sass that you can't do in Jess.

:::

```scss
@import { iif } from '@jesscss/fns';

@mixin one(value) {
  @mixin one_1 {
    width: 2px;
  }
  @let one_1_cond: $(value > 1);
  @mixin one_2 {
    height: 10px;
  }
  @let one_2_cond: $(value > 5);

  @mixin def {
    width: 4px;
  }
  
  @include $iif(one_1_cond, one_1());
  @include $iif(one_2_cond, one_2());
  @include $iif(!one_1_cond && !one_2_cond, def());
}

.box-0 {
  @include one($(0));
}
.box-2 {
  @include one($(2));
}
.box-10 {
  @include one($(10));
  color: iif($(true), #333, #555);
  background-color: iif($(false), #333, #555);
}
```

This would produce:
```scss
.box-0 {
  width: 4px;
}
.box-2 {
  width: 2px;
}
.box-10 {
  width: 2px;
  height: 10px;
  color: #333;
  background-color: #555;
}
```