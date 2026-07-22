---
id: mixins
title: Mixins
audiences:
  - jess
origin: jess
---
Mixins are Jess definitions that inject a set of _rules_ at the call site.
```css
myMixin() {
  width: 30px;
  height: 40px;
}
.box {
  $ > myMixin();
}
```
Mixins can also have parameters and default values.
```css
myMixin($width, $height: 40px) {
  width: $width;
  height: $height;
}

.box-1 {
  $ > myMixin(10px);
}
.box-2 {
  $ > myMixin(20px, 20px);
}
```
The above will produce:
```css
.box-1 {
  width: 10px;
  height: 40px;
}
.box-2 {
  width: 20px;
  height: 20px;
}
```
