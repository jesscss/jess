## Changes to make for 2.0 release

- Jess is a common runtime for CSS pre-processors
- Should execute in an isolated VM? https://www.npmjs.com/package/isolated-vm - (No, use Deno)
- In addition, function calls to Jess functions should receive plain arguments with primitive values, but when called internally, should bind to a `this` object that has AST arguments. Each function, therefore should call something like `getArguments(this, args)` and either parse primitives or get the passed arguments.
- For interoperability with JavaScript, Jess mixins should return serialized plain objects, but have a non-enumerable property with an AST return UNLESS they were passed a `this` object with AST args, in which case they should return AST nodes
- Jess mixin definitions & calls always require semi-colon separators. External functions can have commas or semis per call. (Wrap comma-separated values with `~()`)

## TypeScript / JavaScript calls


## Some syntax changes
```less

/** Declaring variables ` */
~my-var: foo;

/** Referencing variables $ */
.box {
  value: $my-var;
}

/** Declaring mixins
  Pattern matching mixins (not often-used in Less) like this
*/
.mixin(red; @width: 20px; @height: 10px) {
  padding: $width $height;
}
.mixin(blue; @width: 10px; @height: 5px) {
  padding: $width $height;
}
/** Get translated into this in Jess */
.mixin(_p0; width: 20px; height: 10px) when ($_p0 = red) {
  padding: $width $height;
}
.mixin(_p0; width: 10px; height: 5px) when ($_p0 = blue) {
  padding: $width $height;
}

.mixin(value-guard; height: 10px; width: 20px) {}
$ > .mixin();

/** or */
mixin() {}
$ > mixin();


/**
 * Maps to JS/TS import syntax
 * Mirrors @use syntax.
 *
 * This will be ported to Less 5 to replace `@plugin`.
 *
 */
@-use './foo.js' as js;
@-use '#less/math'; // implicit "as math"

/*
- can put in other options in parens
- This doesn't expose vars or mixins, and doesn't allow extending.
- It also imports the CSS file with the 'less' plugin. (Whatever is the first keyword after '?' is interpreted as the name to pass through.)
*/
@-compose private './file.css?less';

// declaring vars
~count; // (or ~count:;) a Node of `Nil`

// setting vars
~count: 1;

// equivalent to Sass !global, will throw an error if not defined
// `^` essentially searches (linearly upwards) and sets the value
.rule {
  ^count: 2;
  // If the variable exists globally, set it to 2
  // If not, declare a local variable equal to 2
  ^count?: 2;
}

// variable variables
~$var: foo;

// variable mixins
$(var)() {}

.something {
  
}


// #() is an expression
~count: $(count + 1); // expression 

// allow destructuring
// $list: one, two;
// This avoids the need for extract() in Less
// $(one, two): $list;

// Mixin definition / call
// $ > is like `@include`?
.mixin(blah; bar) {};
$ > .mixin(blah; bar: $foo);

// mixin a ruleset
// should allow any selector?
$ > .rule;

// mixin a ruleset or mixin
$ > .rule/(); // (Less style)

// #() to wrap expressions
.bar {
  foo: $(count + 1);
  deeper: $>.mixin().my-var;
}

// var expressions will be re-output as "live" expression functions
// i.e. changing the value of `count` will update `--live`
.bar {
  foo: var(--live, $(count + 1));
}

// Imported JS calls are scoped to their namespace
.bar {
  // You can write this in two ways:
  // A new parens context requires $ to start a new expression
  // otherwise keywords would just be keywords
  value: $js.myFunction($sass-var);
  value: $(js.myFunction($sass-var));
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

### Control Flow

Control flow statements do not create new scope, so they are merged with parent rules.

```scss
.box {
  $if (a = 1) {
    ~foo: one;
  } $else {
    ~foo: two;
  }
  // or
  ~foo: $if (a = 1) { one } $else { two };
}
```
-for 
Selectors parsed wrapped in `*()`
```scss
~sel2: *(.foo);
~items: *(.box) 1 / *(.sel2) 2;
$for ((item, i) of $items) {
  $(item[0]) {
    number: $item[1]
  }
}
```
A range is done like
```scss
$for (i of 1 to 3) {
  .box-$(i) {
    value: $i;
  }
}
```


- All Less / Sass functions available
- Extend

```css
.foo {
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

### `@-compose ('(' as ')')? [file|object|map] ('as' [namespace])? ('with'|'set' reference|declarationList)?`

Non-leaky replacement for `@import`. Will import the scope (mixins, variables, and selector references) of the object, and render rules. By default, like Sass's `@use`, the namespace is taken from the last identifier (file name or module).

Namespaced imports are referenced with plain identifiers. e.g.

```scss
@-compose 'colors.jess' as colors;

.box {
  color: $colors.primary;
}
```

### `@-compose reference`

This is the same as basic `@-compose` except rules will not be rendered unless extended.

This is somewhat like Less's `@import (reference)`, although with Less's `@import (reference)`, the referenced file can see the parent's variables, but with `@-compose reference`, the scope is isolated.

_To reduce confusion when migrating from Less, you can write `@-compose (reference)` or `@-import reference` with or without parentheses._

```scss
@-compose reference 'colors.less';
// or override variables
@-compose reference 'colors.less' with {
  // should throw an error if primary-color is not defined
  // overrides the outer declaration statement e.g. $primary-color: #333;
  // TODO - should these be implicitly typed and throw an error when a mis-matched type?
  // No, not unless it is <color> primary-color: #333;
  ~primary-color: #333;
}

//or
@-compose reference 'colors.less';
```

Using `set` instead of `with` on a stylesheet import will alter that import within the compilation scope. (In Sass, this is how `with` works.) Using `with` will alter the import just for this module.

Note that `set` may not be used more than once with the same module (resolved to the same file path), and if you first import the module without using `set` and then try to use it after, this also throws an error. `set` must be used the first time a file is imported or not at all.

```less

// or ultimate customization
@-compose reference 'bootstrap/variables.scss' set $variables;
@-compose reference 'bootstrap/tables.scss' set {
  .tbl {
    border-color: blue;
  }
}

@-compose 'bootstrap.scss' as bs;

.foo {
  color: $bs.primary-color;
}
// or
.foo {
  @-compose 'colors.less';
  color: $colors.primary-color;
}

//
```

### JavaScript / TypeScript imports -- `@-use`

We can directly import JS/TS modules with `@-use` e.g.

```scss
@-use './my-module.js' as js;

.box {
  value: $js.myFunc();
}
```

### `@-compose private`

Rules will be rendered, but variables and mixins are not available to this stylesheet.

```scss
// main.jess
@-compose 'colors.jess' as *;
@-compose 'rules.jess' with $colors;

// rules.jess
// Doesn't have access to vars in main.jess w/o:
@-compose 'main.jess' as *;
// this would include the vars in colors.jess
```
Using an `compose` that's the _result_ of another `compose`:
```scss
@-compose 'theme.jess' with {
  // Using +: with a collection will merge values
  ~colors +: {
    primary: #3a3a3a;
  }
}
```
You could also do the above like:
```scss
~custom-color: #3a3a3a;
@-compose 'theme.jess' with {
  ~colors +: {
    // Here, it will reference the outer $custom-color
    // TODO - remove?
    primary: $custom-color;
  }
}
```

### `@-compose export`

In Jess, variables defined or imported with `@-compose export` will be re-exported and made available to a stylesheet downstream.

### `@-compose readonly`

Rules cannot be extended.

### Simulating Sass's `@forward`

To simulate Sass's forward, you can write:
 - `@-compose reference export readonly 'stylesheet.jess';

This would do the following:
 - `reference` - Import variables and mixins but do not render stylesheets.
 - `export` - variables and mixins are forwarded to a downstream stylesheet
 - `readonly` - Rules cannot be extended

However, for convenience, these three flags can be set with:
 - `@-compose forward 'stylesheet.jess';

### Questions 

Q: what happens if a two files use `@-compose` on the same file with different `with` params?

They would be subject to evaluation order.
```scss
// use1.jess
@-compose './file.jess' as * with {
  ~foo: one;
}

// use2.jess
@-compose './file.jess' as * with {
  ~foo: two;
}

// final.jess
@-compose './use1.jess' as *;
@-compose './use2.jess' as *;

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
@-compose './file1.jess' as *;
|not-private: var;
|_private: var;
@-compose './file2.jess' as *;
```

## `@-compose readonly`

Will import the rules (but not pollute the variable scope). It does not allow extending of the rules in the included file.

Can be at the root or nested.

### Include for mixins / inter-operability
```scss
@-compose 'mixins.less' as *;

// This will include ALL mixins named `.root-mixin` AND all selectors labeled `.root-mixin`
// Note: this is how converted Less would look
$>.root-mixin/();

// this will ONLY call mixins and ignore selectors
// Note: this is how converted Sass would look (except without the `.`)
$ > .root-mixin();

// This will only mixin selectors
$ > .root-mixin;
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




