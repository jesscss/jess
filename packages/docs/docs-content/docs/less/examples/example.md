---
title: "Example"
slug: "/examples/example"
audiences:
  - less
origin: less
---
Write some Less:

```less
@base: #f938ab;

.elevation(@blur, @alpha: 22%) when (isnumber(@alpha)) {
  box-shadow: 0 8px @blur rgb(15 23 42 / @alpha);
}

.box {
  @layer components {
    border-radius: 0.75rem;
  }
  color: saturate(@base, 5%);
  border-color: lighten(@base, 30%);
  div {
    .elevation(24px, 26%)
  }
}
```
