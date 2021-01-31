---
id: migrating
title: Migrating to Jess
---

Here are some examples of features in Less / Sass and their equivalent syntax in Jess.

### Variable Declaration

**Less**
```less
@color: red;
```
**Sass**
```scss
$color: red;
```
**Jess**

Variables are declared using the `@let` at-rule. `color` must be a valid JavaScript identifier.
```less
@let color: red;
```

### Variable Reference

**Less**
```less
color: @color;
```
**Sass**
```scss
color: $color;
```
**Jess**

Jess can evaluate any continuous JavaScript expression starting with `$`. Referencing ends up looking a little like Sass.
```scss
color: $color;
```

### Math

**Less**
```less
width: (@width * 2);
```
**Sass**
```scss
width: ($width * 2);
```
**Jess**

Depending on the type of value, and if you want to preserve units, you can use Jess helper functions. Otherwise, you can just perform your math in JavaScript.

```scss
width: $(width * 2);
```
or, to preserve units in a dimension:
```scss
@import { op } from '@jesscss/fns';
width: op($width * 2);
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

Jess mimics Sass mixin syntax, but the transpiled mixin is just a JavaScript function.

```scss
@import { op } from '@jesscss/fns';

@mixin mixin(size) {
  width: op($size * 2px);
}
.box {
  @include mixin(50);
}
```


### Each

**Sass**
```scss
$sizes: 24px, 32px, 40px;

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
@sizes: 24px, 32px, 40px;

each(@sizes, #(@size) {
  .icon-@{size} {
    font-size: @size;
    height: @size;
    width: @size;
  }
})
```

**Jess**

The `@jesscss/fns` module has an `each` helper to achieve the same pattern.

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