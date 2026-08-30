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
```scss
@import multiply from '@jesscss/functions/multiply';
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
```less
@import multiply from '@jesscss/functions/multiply';

@mixin mixin(size) {
  width: multiply($size, 1px);
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

```less
@import each from '@jesscss/functions/each';

@mixin size(size) {
  .icon-$(size) {
    font-size: $size;
    height: $size;
    width: $size;
  }
}
@include each($sizes, $size);
```