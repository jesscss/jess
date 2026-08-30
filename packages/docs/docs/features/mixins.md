---
id: mixins
title: Mixins
---

Mixins are JavaScript functions that return a set of _rules_.
```scss
@mixin myMixin {
  width: 30px;
  height: 40px;
}
.box {
  @include myMixin();
}
```
Mixins can also have parameters and default values.
```scss
@mixin myMixin(width, height: 40px) {
  width: $width;
  height: $height;
}

.box-1 {
  @include myMixin(10px);
}
.box-2 {
  @include myMixin(20px, 20px);
}
```
The above will produce:
```scss
.box-1 {
  width: 10px;
  height: 40px;
}
.box-2 {
  width: 20px;
  height: 20px;
}
```
