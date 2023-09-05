## Changes to make for 2.0 release

- Jess is a common runtime for CSS pre-processors
- Should execute in an isolated VM? https://www.npmjs.com/package/isolated-vm
- In addition, function calls to Jess functions should receive plain arguments with primitive values, but when called internally, should bind to a `this` object that has AST arguments. Each function, therefore should call something like `getArguments(this, args)` and either parse primitives or get the passed arguments.
- For interoperability with JavaScript, Jess mixins should return serialized plain objects, but have a non-enumerable property with an AST return UNLESS they were passed a `this` object with AST args, in which case they should return AST nodes

## TypeScript / JavaScript calls


## Some syntax changes
```less
/**
 * Maps to JS/TS import syntax
 * Mirrors @use syntax.
 *
 * This will be ported to Less 5 to replace `@plugin`.
 *
 * @note `import` should not be needed, but provides intuitive symmetery with JS
 */
@from './foo.js' import (myFunction); // also allow `@from './foo.js' import { myFunction } ?
@from '#less' import * as less;

@include './file.css' (type: 'less');

// declaring vars
@let count; // a Node of `Nil`

// setting vars - note, this avoids the need for !global in Sass
@set count +: 1;

// `$` is a referencer, to reduce ambiguity
@set count: $count + 1;

// allow destructuring
@let list: one, two;

// This avoids the need for extract() in Less
@let (one, two): $list;

// Mixin calls and functions don't need `@include` (but you can use it)
$myFunction();

// #() to wrap expressions, to avoid repeating `$`
.bar {
  foo: #($count + 1);
}

// !() for "live" expressions (only allowed in values)
.bar {
  foo: !($count + 1); // outputs something like var(--a1sdf, 2);
}

// You can write this in two ways:
$myFunction($sass-var);
#($myFunction($sass-var));

// Parenthesized expressions
.selector#(expr) {
  prop: #($value + 1);
}
$myFunction()
```

## Features
- Mixin guards (like Less)
- `@if` / `@else` (like Sass)
- All Less / Sass functions available
- Extend?
- Jess should not flatten selectors by default. See: https://www.w3.org/TR/css-nesting-1/
  - In flattening mode, Jess should follow CSS nesting convention in `.jess` files, and SCSS/Less convention in respective files.
- Conversion of Less/Scss to Jess (restrict some things from converting? like `@import`s?)

### Sass+
Sass is an overly-complex stylesheet language. Jess aims to be:
- 100% compatible with Less
- Compatible with a common subset of Sass called Sass+ (to be defined)

### `@use [file|object|map] [namespace|'(' imports ')']? ('with' reference|declarationList)?`

Will import the scope (mixins, variables, and selector references) of the object. Can be a stylesheet or other scope object.

Can be at the root or nested.

```scss
@use 'colors.less';
// or override variables
@use 'colors.less' with {
  // should throw an error if primary-color is not defined
  @set primary-color: #333;
}
// or
@use 'colors.less' colors;

//or
@use 'colors.less' (primary-color);

// or ultimate customization
@use 'bootstrap.scss' with {
  // Transitively apply a different use
  @use 'variables.scss' with variables;
  @use 'some-classes.scss' with {
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
  @use 'colors.less';
  color: $primary-color;
}

//
```

### `@use` without `@forward`

In Jess, variables defined or imported with `@use` will be re-exported. This means you do not have to use the Sass `@forward` rule. Just `@use` them.

Q: what happens if a two files use `@use` on the same file with different params?

They would be subject to evaluation order.
```scss
// use1.jess
@use './file.jess' with {
  @set foo: one;
}

// use2.jess
@use './file.jess' with {
  @set foo: two;
}

// final.jess
@use './use1.jess';
@use './use2.jess';

.rule {
  value: $foo; // two
}
```

Q: What if you don't want to forward a use?

You can use the `@private` at-rule:

```scss
// This is a private `@use`
@private @use './somefile.jess';
// can also be used with variables
@private $-private: var;
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
@private @use './file1.jess';
@let not-private: var;
@private @let -private: var;
@use './file2.jess';

```



## `@include [file|object|selector] ('with' reference|declarationList)?`

Will import the rules (but not pollute the variable scope).

Can be at the root or nested.

```scss
// main.jess
@use 'colors.jess' colors;
@include 'rules.jess' colors;

// rules.jess
// Doesn't have access to vars in main.jess w/o:
@use 'main.jess';
// this would include the vars in colors.jess
```
Using an `@include` that's the _result_ of a `@use`:
```scss
@use 'theme.jess' theme with {
  @assign colors {
    primary: #3a3a3a;
  }
}
$theme();
```

## Limiting types for a design system (Experimental)
```scss
@type Size: 1rem, 1.2rem, 1.4rem;
@type Props:
  <Size> size,
  <color> color;

@mixin set-size(<Size> size) {
  font-size: $size;
}

// How do we get this to just return class names and var() injections?
@mixin my-component(<Props> (size, color)) {

}
```
