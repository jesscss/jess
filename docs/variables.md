# Variable evaluation

## Comparisons

### Less

Evaluates per scope.
```scss
.box {
  @color: red;
  background-color: @color;
  @color: blue;
}
```
Output:
```css
.box {
  background-color: blue;
}
```

### Sass

Evaluates linearly.

```scss
.box {
  @color: red;
  background-color: @color;
  @color: blue;
}
```
Output:
```css
.box {
  background-color: red;
}
```

### Jess

Evaluates linearly and per scope

```scss
.box {
  background-color: $color; // loops to bottom of scope for final value
  $color: red;
  background-color: $color; // starts traversing upwards and finds last set value
  $color: blue;
}
```
Output:
```css
.box {
  background-color: blue;
  background-color: red;
}
```

In the case of props, they are accessed like Less's, because CSS props follow "last one wins".

```scss
.box {
  color: red;
  background-color: $.color;
  color: blue;
}
```
Output:
```css
.box {
  color: red;
  background-color: blue;
  color: blue;
}
```

## Namespaces

Like JavaScript, namespaces / objects are done by dot lookup

```less
.box {
  color: red;
  border: $.color;  // property access
}

$map: {
  key: value;
  subvalue: {
    foo: bar;
  }
  $somevar: red;

  @--mixin my-mixin {
    //
  }
}

.box-2 {
  look-1: $map.key;
  look-2: $map.subvalue.foo;
  look-3: $map.$somevar;
  $dynamic: subvalue;
  look-4: $map[$dynamic].foo;

  $map -> my-mixin();

  // you can also do by list index or negative list index
  look-5: $map[0]; // value is `value`
  $map -> [-1](); // get the mixin at 1 from bottom and call it
}
```

Maps and objects can be looked up by dot chains


