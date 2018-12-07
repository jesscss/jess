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
@var {color: `red`}
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
color ${color};
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
width: ${width * 2};
```

### Mixins

**Less**
```less
.mixin(@size) {
  width: @size * 1px;
}
.mixin(50);
```
**Sass**
```sass
@mixin mixin($size) {
  width: $size * 1px;
}

@include mixin(50);
```
**Jess**
```js
function mixin(size) {
  return css`width: ${size}px;`
}
```
```less
${mixin(50)}
```
