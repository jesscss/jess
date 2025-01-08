## Changes to make for 2.0 release

- Jess is a common runtime for CSS pre-processors
- Should execute in an isolated VM? https://www.npmjs.com/package/isolated-vm
- In addition, function calls to Jess functions should receive plain arguments with primitive values, but when called internally, should bind to a `this` object that has AST arguments. Each function, therefore should call something like `getArguments(this, args)` and either parse primitives or get the passed arguments.
- For interoperability with JavaScript, Jess mixins should return serialized plain objects, but have a non-enumerable property with an AST return UNLESS they were passed a `this` object with AST args, in which case they should return AST nodes
- Jess function / mixin args should always have semi-colon separators

## TypeScript / JavaScript calls


## Some syntax changes
```less
/**
 * Maps to JS/TS import syntax
 * Mirrors @use syntax.
 *
 * This will be ported to Less 6 to replace `@plugin`.
 *
 * @note `import` should not be needed, but provides intuitive symmetery with JS
 */
@--from './foo.js' import (myFunction); // also allow `$from './foo.js' import { myFunction } ?
@--from '#less' import * as less;

@--include './file.css' (type: 'less');

// declaring vars
$count; // a Node of `Nil`

// setting vars - note, this avoids the need for !global in Sass
// Note also that this will throw an error in Jess without `$let count`
$count: 1;

// to import a var into this scope rather than shadow it
// equivalent to Sass !global (sort of)
.rule {
  @--use count;
  $count: 2;
}

.something {
  
}

// `$` is a referencer, to reduce ambiguity
// note: keywords treated as vars -- if you really need to, you can write `red` as a keyword
$count: $(count + 1); // expression 

// allow destructuring
$list: one, two;

// This avoids the need for extract() in Less
// $(one, two): $list;

$ -> mixin();

// $() to wrap expressions
.bar {
  foo: $(count + 1);
}

// var expressions will be re-output as "live" expression functions
// i.e. changing the value of `count` will update `--live`
.bar {
  foo: var(--live, $(count + 1));
}

// Function calls can use $
.bar {
  // You can write this in two ways:
  value: $myFunction($sass-var); 
  value: $(myFunction(sass-var)); // inside expressions, sass-var is a variable reference, not a keyword
}

// you can also do:
.bar {
  value: $something.prop.func(#FFF).value;
}

// Parenthesized expressions
.selector$(expr) {
  prop: $(value + 1);
}
```

## Features
- Mixin guards (like Less)
- `@--if` / `@--else` (like Sass)
- All Less / Sass functions available
- Extend

```css
.foo {
  // Glob expression to limit extend
  // '~' is compilation root
  // @todo - remove? limit to @-use?
  :extend(.bar '~/*');
}
```

- Jess should not flatten selectors by default. See: https://www.w3.org/TR/css-nesting-1/
  - In flattening mode, Jess should follow CSS nesting convention in `.jess` files, and SCSS/Less convention in respective files.

### Sass+
Sass is an overly-complex stylesheet language. Jess aims to be:
- 100% compatible with Less
- Compatible with a common subset of Sass called Sass+ (to be defined)

### `@--use ('(' type ')')? [file|object|map] [namespace|'(' imports ')']? ('with' reference|declarationList)?`

Non-leaky replacement for `@import`. Will import the scope (mixins, variables, and selector references) of the object, as well as render rules.

Can be at the root or nested.

### `@--ref ('(' type ')')? [file|object|map] [namespace|'(' imports ')']? ('with' reference|declarationList)?`

(In Less, this will be `@reference`)

```scss
@--ref 'colors.less';
// or override variables
@--ref 'colors.less' with {
  // should throw an error if primary-color is not defined
  // overrides the outer $let statement e.g. $let primary-color: #333;
  // TODO - should these be implicitly typed and throw an error when a mis-matched type?
  // No, not unless it is $let <color> primary-color: #333;
  $primary-color: #333;
}
// or
@--ref 'colors.less' colors;

//or
@--ref 'colors.less' (primary-color);
```


```less
// or ultimate customization
@--use 'bootstrap.scss' with {
  // Transitively apply a different use
  @--ref 'variables.scss' with $variables;
  @--use 'some-classes.scss' with {
    // Replace a class
    .class {
      color: blue;
    }
  }
}

.foo {
  color: $colors.primary-color;
}
// or
.foo {
  @--use 'colors.less';
  color: $primary-color;
}

//
```

### `@--use` without `@--forward`

In Jess, variables defined or imported with `@--use` will be re-exported. This means you do not have to use the Sass `@forward` rule. Just `@--use` them.

Q: what happens if a two files use `@--use` on the same file with different params?

They would be subject to evaluation order.
```scss
// use1.jess
@--use './file.jess' with {
  $foo: one;
}

// use2.jess
@--use './file.jess' with {
  $foo: two;
}

// final.jess
@--use './use1.jess';
@--use './use2.jess';

.rule {
  value: $foo; // two
}
```

Q: What if you don't want to forward variables / mixins?

You can use the `$private` keyword:

```scss
// This is a private `@use`
@--private @--ref './somefile.jess';
// can also be used with variables
@--private -private: var;
```


Therefore, a SCSS file like this:
```scss
@use './file1.scss' as *;
$not-private: var;
$-private: var;
@forward './file2.scss';
```
Would be converted to:
```scss
@--private @--use './file1.jess';
$not-private: var;
@--private -private: var;
@--use './file2.jess';
```



## `@--include [file|object|selector|mixin] ('(' vars ')')? ('with' reference|declarationList)?`

Will import the rules (but not pollute the variable scope) TODO -- will this also prevent extends?.

Can be at the root or nested.

```scss
// main.jess
@--ref 'colors.jess' (colors);
@--include 'rules.jess' with $colors;

// rules.jess
// Doesn't have access to vars in main.jess w/o:
@--use 'main.jess';
// this would include the vars in colors.jess
```
Using an `include` that's the _result_ of a `ref`:
```scss
@--ref 'theme.jess' (theme) with {
  // Using +: with a collection will merge values
  $colors +: {
    primary: #3a3a3a;
  }
}
@--include theme();
```
You could also do the above like:
```scss
$custom-color: #3a3a3a;
@--include 'theme.jess' with {
  $colors +: {
    primary: $custom-color;
  }
}
```
### Include for mixins / inter-operability
```scss
@--use 'mixins.less';

// This will include ALL mixins named `.root-mixin` AND all selectors labeled `.root-mixin`
// Note: this is how converted Less would look
@--include .root-mixin;

// this will ONLY call mixins and ignore selectors
// Note: this is how converted Sass would look
$ -> .root-mixin();
```

## Mixins are functions, and functions are called with a consistent signature
```scss
call: $my-func(one: $value; $two; $three);
```
JS representation:

Mixins assign named arguments, and then go through positional arguments.
```js
myFunc({ one: value }, two, three);

// defined with https://typia.io/docs/
/**
 * @see https://github.com/microsoft/TypeScript/issues/55736 - a solution!!
 */
function myFunc(one: Color, two?: any, three?: any) {}
```



## Limiting types for a design system (Experimental)
```scss
// @see https://developer.mozilla.org/en-US/docs/Web/CSS/@property/syntax
// @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Types
// Built in types:
//   <string>               "A string"
//   <integer>              1
//   <number>               1.1
//   <number>#              comma-separated list of numbers
//   <dimension>            2px or 100ms
//   <percentage>           10%
//   <ratio>                1 / 2
//   <fractional>           2fr
//   <length>               3em
//   <url>                  url(./image.png)
//   <angle>                90deg
//   <time>                 150ms
//   <frequency>            40kHz
//   <resolution>           300dpi
//   <length | percentage>  type that accepts length or percentage
//   <color>                #FFF
//   <hue>                  100deg or 100 (<number | angle>)
//   <image>                gradient or url to an image
//   <0..1 | 0%..100%>      Any number between 0 and 1 or percent betwen 0% and 100%

// To create a tuple of numbers:
// Note: custom types must start with a capital letter
@--type Num2or4: <number#2 | number#4>; // maybe?
// accepts one of these values
@--type Size: 1rem | 1.2rem | 1.4rem;

@--mixin set-size(<Size> size) {
  font-size: $size;
}


// design-system.jess
@--property-types {
  width: <Size>;
}

// my-file
@--use 'design-system.jess';

// How do we get this to just return class names and var() injections?
// 
// jan-2025 -- I think the above question is around how we can do tree shaking
//             to the minimum tree size
@--mixin my-component(<Size> $size; <color> $color) {

}

// Note: vars have a default "any" value
<*> $color: #FFF; 
```
