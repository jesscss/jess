# Variable declaration
```scss
$foo: bar; // infer <keyword>
<*> foo: bar; // equivalent
<keyword> foo: bar; // limit type
```


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
## Constants

Constants are vars / mixins preceded by `!`. They will throw an error if attempted
to be over-written.

```scss
!$foo: bar;
$foo: bar; // error

/** e.g. Sass mixins */
!my-mixin() {
  color: red;
}
my-mixin() {} // error
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

  @ my-mixin {
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


## Limiting types for a design system (WIP)
```scss
// @see https://developer.mozilla.org/en-US/docs/Web/CSS/@property/syntax
// @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Types
// @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Values_and_Units/CSS_data_types
// Built in types:
//   <string>                 "A string"
//   <integer>                1
//   <number>                 1.1
//   <number>#                comma-separated list of numbers
//   <number>+                space-separated list of values
//   <number>+2               space-separated list of exactly 2 numbers (Jess extension)
//   <number>#2               comma-separated list of exactly 2 numbers (Jess extension)
//   <number>+{2..4}          space-separated list of 2 to 4 numbers (Jess extension)
//   <dimension>              2px or 100ms
//   <percentage>             10%
//   <ratio>                  1 / 2
//   <fractional>             2fr
//   <length>                 3em
//   <url>                    url(./image.png)
//   <angle>                  90deg
//   <time>                   150ms
//   <frequency>              40kHz
//   <resolution>             300dpi
//   <length> | <percentage>  type that accepts length or percentage
//   <color>                  #FFF
//   <hue>                    100deg or 100 (<number> | <angle>)
//   <image>                  gradient or url to an image
//   <0..1> | <0%..100%>      Any number between 0 and 1 or percent betwen 0% and 100% (Jess extension)

// To create a tuple of numbers:
// Note: custom types must start with a capital letter
@-type Num2or4: <number>#2 | <number>#4;
  
// accepts one of these values
@-type Size: 1rem | 1.2rem | 1.4rem;

set-size(<Size> $size) {
  font-size: $size;
}

/** FUTURE / EXPERIMENTAL */
// design-system.jess
@-global {
  all: reset;
  // limit all dimension references to Size?
  @-type dimension: <Size>;
  /** In CSS, order doesn't matter */
  border: AtLeastOne(<line-width>, <line-style>, <color>) | <global>;
}

// my-file
@-use 'design-system.jess';

// How do we get this to just return class names and var() injections?
// 
// jan-2025 -- I think the above question is around how we can do tree shaking
//             to the minimum tree size... however, with proper @-ref imports, classes
//             should not be included unless they are used / extended
my-component(<Size> $size; <color> $color) {

}

// Note: vars default to assigned value, so for an `any` type, it must be preceded
// by a *
<*> $color: #FFF; 
```