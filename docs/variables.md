# Variable evaluation

## Comparisons

### Less

Evaluates per scope, like CSS variables.
```scss
.box {
  @padding-var: 1px;
  padding: @padding-var;
  @padding-var: 2px;
  padding: @padding-var;
}
```
Output:
```css
.box {
  padding: 2px;
  padding: 2px;
}
```

### Sass

Evaluates linearly (like PHP).

```scss
.box {
  $padding-var: 1px;
  padding: $padding-var;
  $padding-var: 2px;
  padding: $padding-var;
}
```
Output:
```css
.box {
  padding: 1px;
  padding: 2px;
}
```

### Jess

Evaluates per scope unless referenced with `$$`, which is a linear lookup (Sass-style).

```scss
.box {
  $padding-var: 1px;
  padding: $padding-var $$padding-var;
  $padding-var: 2px;
  padding: $padding-var $$padding-var;
}
```
Output:
```css
.box {
  padding: 2px 1px;
  padding: 2px 2px;
}
```

Props are evaluated the same way.

```scss
.box {
  padding: 1px;
  margin: $.padding $$.padding;
  padding: 2px;
  margin: $.padding $$.padding;
}
```
Output:
```css
.box {
  padding: 1px;
  margin: 2px 1px;
  padding: 2px;
  margin: 2px 2px;
}
```

## Namespaces

Like JavaScript, namespaces / objects are done by dot lookup

```less
.box {
  color: red;
  border: $.color;  // property access
}

// From an IDE perspective, the difference between a map and an anonymous mixin
// is how to interpret "properties". In a map, properties can be arbitrary.
$map: {
  key: value;
  subvalue: {
    foo: bar;
  }
  $somevar: red;

  @@ my-mixin {
    //
  }
}

.box-2 {
  look-1: $map.key;
  look-2: $map.subvalue.foo;
  look-3: $map.$somevar;
  $dynamic: subvalue;
  look-4: $map[$dynamic].foo;

  $map > my-mixin();

  // you can also do by list index or negative list index
  look-5: $map[0]; // value is `value`
  $map[-1](); // get the mixin at 1 from bottom and call it
  $map[](); // get the last item (the mixin) and call it
}
```

Maps and objects can be looked up by dot chains


