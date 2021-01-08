### Variable Declaration

**Less**
```less
@color: red;
```
**Sass**
```sass
$color: red;
```
**Jess**
```less
@let color: red;
```

### Variable Reference

**Less**
```less
color: @color;
```
**Sass**
```sass
color: $color;
```
**Jess**
```less
color: $color;
```

### Math

**Less**
```less
width: (@width * 2);
```
**Sass**
```sass
width: ($width * 2);
```
**Jess**
```less
width: $width.multiply(2);
```

### Mixins

**Less**
```less
.mixin(@size) {
  width: @size * 1px;
}
.box {
  .mixin(50);
}
```
**Sass**
```sass
@mixin mixin($size) {
  width: $size * 1px;
}

.box {
  @include mixin(50);
}
```
**Jess**
```less
@mixin mixin(size) {
  @let px: 1px;
  width: $size.multiply(px);
}
.box {
  @include mixin(50);
}
```
