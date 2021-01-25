---
id: migrating
title: Migrating to Jess
---

### Variable Declaration

Variables are declared using the `@let` at-rule.

**Less**
```less
@color: red;
```
**Sass**
```scss
$color: red;
```
**Jess**
```less
@let color: red;
```

### Variable Reference

Jess can evaluate any continuous JavaScript expression starting with `$`.

**Less**
```less
color: @color;
```
**Sass**
```scss
color: $color;
```
**Jess**
```scss
color: $color;
```

### Math

Depending on the type of value, and if you want to preserve units, you can use Jess helper functions (coming soon). Otherwise, you can just perform your math in JavaScript.

**Less**
```less
width: (@width * 2);
```
**Sass**
```scss
width: ($width * 2);
```
**Jess**
```scss
// Note: this will only work for primitive values.
// This is just a plain JS expression!
width: $(width * 2);
```
or _(not available in alpha yet)_
```scss
@import { multiply } from '@jesscss/fns';
width: $multiply(width, 2);
```


### Mixins

**Less**
```less
.mixin(@size) {
  width: @size * 2px;
}
.box {
  .mixin(50);
}
```
**Sass**
```scss
@mixin mixin($size) {
  width: $size * 2px;
}

.box {
  @include mixin(50);
}
```
**Jess**
```scss
@import { multiply } from '@jesscss/fns';

@mixin mixin(size) {
  width: multiply($size, 2px);
}
.box {
  @include mixin(50);
}
```


### Each

**Sass**
```scss
@each $size in $sizes {
  .icon-#{$size} {
    font-size: $size;
    height: $size;
    width: $size;
  }
}
```

**Less**
```less
each(@sizes, #(@size) {
  .icon-@{size} {
    font-size: @size;
    height: @size;
    width: @size;
  }
})
```

**Jess**

_Note: not available yet in alpha, but will work like the following:_

```less
@import { each } from '@jesscss/fns';

@let sizes: 24px, 32px, 40px;

@mixin size(size) {
  .icon-$(size) {
    font-size: $size;
    height: $size;
    width: $size;
  }
}
@include each($sizes, $size);
```