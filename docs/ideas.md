## Changes to make for 2.0 release

- Jess is a common runtime for CSS pre-processors
- Should execute in an isolated VM? https://www.npmjs.com/package/isolated-vm - (No, use Deno)
- In addition, function calls to Jess functions should receive plain arguments with primitive values, but when called internally, should bind to a `this` object that has AST arguments. Each function, therefore should call something like `getArguments(this, args)` and either parse primitives or get the passed arguments.
- For interoperability with JavaScript, Jess mixins should return serialized plain objects, but have a non-enumerable property with an AST return UNLESS they were passed a `this` object with AST args, in which case they should return AST nodes
- Jess mixin definitions & calls always require semi-colon separators. External functions can have commas or semis per call. (Wrap comma-separated values with `~()`)

## TypeScript / JavaScript calls


## Some syntax changes
```less
/**
 * Maps to JS/TS import syntax
 * Mirrors @use syntax.
 *
 * This will be ported to Less 5 to replace `@plugin`.
 *
 */
@-module './foo.js' as js;
@-module '#less/math' as math;

@-include (as: less /* other options */) './file.css' as *;

// declaring vars
$count; // (or $count:;) a Node of `Nil`

// setting vars
$count: 1;

// equivalent to Sass !global, will throw an error if not defined
// `$$` essentially searches (linearly) and sets the value
.rule {
  $$count: 2;
  // If the variable exists globally, set it to 2
  // If not, declare a local variable equal to 2
  $$count?: 2;
}

// variable variables
$#($var): foo;

// variable mixins
#($var)() {}

.something {
  
}


// #() is an expression
$count: #($count + 1); // expression 

// allow destructuring
// $list: one, two;
// This avoids the need for extract() in Less
// $(one, two): $list;

// Mixin definition / call
.mixin() {};
$ > .mixin();

// mixin a ruleset
// should allow any selector?
$ > .rule;

// mixin a ruleset or mixin
$ > .rule/(); // (Less style)

// #() to wrap expressions
.bar {
  foo: #($count + 1);
  deeper: #($ > mixin().$my-var)
}

// var expressions will be re-output as "live" expression functions
// i.e. changing the value of `count` will update `--live`
.bar {
  foo: var(--live, #($count + 1));
}

// Function calls can use $
.bar {
  // You can write this in two ways:
  value: $myFunction($sass-var); 
  value: #($myFunction($sass-var));
}

// you can also do:
.bar {
  value: $something.prop.func(#FFF).value;
}

// Parenthesized expressions
.selector#($expr) {
  prop: #($value + 1);
}
```

## Features

### Control Flow

Control flow statements do not create new scope, so they are merged with parent rules.

```scss
.box {
  $if ($a = 1) {
    $foo: one;
  } $else {
    $foo: two;
  }
  // or
  $foo: $if ($a = 1) { one } $else { two };
}
```
-for 
Selectors parsed prefixed with ^ in value (and optionally wrapped in parens), except in Less where we do looser values
```scss
$sel2: ^.foo;
$items: ^(.box) 1 / $sel2 2;
$for (($item, $i) of $items) {
  #($item[0]) {
    number: $item[1]
  }
}
```
A range is done like
```scss
$for ($i of 1 to 3) {
  .box-#($i) {
    value: $i;
  }
}
```


- All Less / Sass functions available
- Extend

```css
.foo {
  // Glob expression to limit extend
  // '~' is compilation root
  // @todo - remove? limit to @-use?
  :-extend(.bar); // partial by default (vs. Less's !exact as default)
  :-extend(.bar !exact);
}
```

- Jess should not flatten selectors by default. See: https://www.w3.org/TR/css-nesting-1/
  - In flattening mode, Jess should follow CSS nesting convention in `.jess` files, and SCSS/Less convention in respective files.

### Sass+
Sass is an overly-complex stylesheet language. Jess aims to be:
- 100% compatible with Less
- Compatible with a common subset of Sass called Sass+ (to be defined)

### `@-use ('(' as ')')? [file|object|map] 'as' [namespace] ('with'|'set' reference|declarationList)?`

Non-leaky replacement for `@import`. Will import the scope (mixins, variables, and selector references) of the object. If a namespace is specified, will wrap rules in a mixin name. If it's imported `as *` (the default), will render rules.

Note: unlike Sass, `as` is required, for clarity.

Namespaced imports are referenced with plain identifiers. e.g.

```scss
@-use 'colors.jess' as colors;

.box {
  color: colors.$primary;
}
```

### `@-ref ('(' type ')')? [file|object|map] 'as' [namespace] ('with'|'set' reference|declarationList)?`

(In Less, this will be `@reference`) - This is the same as `@-use` except rules will not be rendered unless extended.

This is somewhat like Less's `@import (reference)`, although with Less's `@import (reference)`, the referenced file can see the parent's variables, but with `@reference`, the scope is isolated.

```scss
@-ref 'colors.less' as colors;
// or override variables
@-ref 'colors.less' as colors with {
  // should throw an error if primary-color is not defined
  // overrides the outer $let statement e.g. $let primary-color: #333;
  // TODO - should these be implicitly typed and throw an error when a mis-matched type?
  // No, not unless it is $let <color> primary-color: #333;
  $primary-color: #333;
}

//or
@-ref 'colors.less' as *;
```

Using `set` instead of `with` on a stylesheet import will alter that import within the compilation scope. (In Sass, this is how `with` works.) Using `with` will alter the import just for this module.

Note that `set` may not be used more than once with the same module (resolved to the same file path), and if you first import the module without using `set` and then try to use it after, this also throws an error. `set` must be used the first time a file is imported or not at all.

```less

// or ultimate customization
@-ref 'bootstrap/variables.scss' set $variables;
@-ref 'bootstrap/tables.scss' set {
  .tbl {
    border-color: blue;
  }
}

@-use 'bootstrap.scss' as bs;

.foo {
  color: bs.$primary-color;
}
// or
.foo {
  @-use 'colors.less' as colors;
  color: colors.$primary-color;
}

//
```

### JavaScript / TypeScript imports -- `@-load`

We can directly import JS/TS modules with `@-load` e.g.

```scss
@-load './my-module.js' as js;

.box {
  value: js.myFunc();
}
```

### `@-use` without `@-forward`

In Jess, variables defined or imported with `@-use export` or `@-export` will be re-exported. This is similar to Sass's `@-forward`.

Q: what happens if a two files use `@-use` on the same file with different params?

They would be subject to evaluation order.
```scss
// use1.jess
@-use './file.jess' as * with {
  $foo: one;
}

// use2.jess
@-use './file.jess' as * with {
  $foo: two;
}

// final.jess
@-use './use1.jess' as *;
@-use './use2.jess' as *;

.rule {
  value: $foo; // two
}
```

In summary, a SCSS file like this:
```scss
@use './file1.scss' as *;
$not-private: var;
$-private: var;
@forward './file2.scss';
```
Would be converted to:
```scss
@-use './file1.jess' as *;
$not-private: var;
$_private: var;
@-export './file2.jess' as *;
```

## `@-include [file] ('(' vars ')')? 'as' [namespace] ('with' reference|declarationList)?`

Will import the rules (but not pollute the variable scope). It does not allow extending of the rules in the included file.

Can be at the root or nested.

```scss
// main.jess
@-ref 'colors.jess' as *;
@-include 'rules.jess' with $colors;

// rules.jess
// Doesn't have access to vars in main.jess w/o:
@-use 'main.jess' as *;
// this would include the vars in colors.jess
```
Using an `include` that's the _result_ of a `ref`:
```scss
@-ref 'theme.jess' as theme with {
  // Using +: with a collection will merge values
  $colors +: {
    primary: #3a3a3a;
  }
}
@-include $theme;
```
You could also do the above like:
```scss
$custom-color: #3a3a3a;
@-include 'theme.jess' with {
  $colors +: {
    // Here, it will reference the outer $custom-color
    primary: $$custom-color;
  }
}
```
### Include for mixins / inter-operability
```scss
@-use 'mixins.less';

// This will include ALL mixins named `.root-mixin` AND all selectors labeled `.root-mixin`
// Note: this is how converted Less would look
$ > .root-mixin/();

// this will ONLY call mixins and ignore selectors
// Note: this is how converted Sass would look (except without the `.`)
$ > .root-mixin();

// This will only mixin selectors
$ > .root-mixin;
```

## Mixins are functions, and functions are called with a consistent signature
```scss
call: $my-func($one: $value; $two; $three);
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




