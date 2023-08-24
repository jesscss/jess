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
$color: red;
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
width: ~($width * 2);
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
@mixin mixin(size) {
  width: ~($size * 1px);
}
.box {
  $mixin(50);
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
// import each from '@jesscss/fns/each';

@for $size of $sizes {
  .icon-~($size) {
    font-size: $size;
    height: $size;
    width: $size;
  }
}
```