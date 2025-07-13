## Supports Less and Sass mixin patterns

What if... like Less, mixins can have compound selectors or like Sass, can have simple names. Maybe the difference is in how they're called?

Maybe what we do is register any selector list item that is a compound selector (of only types, classes, and ids) that is followed by parens?

Maybe can be preceded by an `@` plus a space to be explicit?

Mixins allow commas OR semi-colons as separators. Unlike Less, Jess won't parse to the end of the block to see if a comma-separated value is a single argument. If you want to have commas in your value, it must be wrapped in `~()` to make the intention clear. You can't mix commas and semi-colons in the same definition / call.

```scss
// Plain mixin
my-mixin($width; $height;) {
  width: $width;
  height: $height;
}

// Mixins can have compound selectors like Less
.my-mixin($width; $height) {
  // ...
}
#my-mixin.more($width; $height) {
  // ...
}

// Mixins can have default values
my-mixin($width; $height: 1rem) {
  // ...
}

// Mixins, like Less, can be overloaded and dis-ambiguated by parameters
my-mixin($width) {
  // ...
}
my-mixin($width; $height) {
  // ...
}

// Mixins can have disambiguation by value
my-mixin(red) {
  // ...
}
my-mixin(blue) {
  // ...
}
// called like `$ -> my-mixin(red);`

// Like Less, mixins can have guards
my-mixin($width; $height) when ($height > 1rem) {
  // ...
}

// called like
$ > my-mixin(20px; 40px);
```
Mixins are disambiguated when called, not named. For example, Sass may have a mixin and a selector with the same name.
```scss
// Selector
div {

}
@mixin div {

}
```
In Jess, this would be written:
```scss
div {

}
!div() {

}
```
However, when called, we can disambiguate:
```scss
.foo {
  $ > div(); // include a mixin
  $ > div/(); // include a mixin or selector that matches
  $ > div; // for balance? call a selector that matches?
}
```

Sass's placeholders that can be extended are just mixins that can be extended in Jess.
```scss
// sass
%selector {

}
.foo {
  @extend %selector;
}

// Jess
selector() {

}
.foo {
  :extend selector();
}
```

Single values in parameter default values / arguments must be wrapped in `(` `)` with optional preceding `~`
```scss
$ > my-mixin($fonts: ~('Times New Roman', serif));
```

Anonymous mixins are started with `@(` or `@{` e.g.

```scss
$my-mixin: @($width; $height) {
  // ...
}
// called like:
$my-mixin(20px; 40px);

// or

$my-mixin: @{
  // ...
}
```

To pass a ruleset to a mixin when called, just pass in an anonymous mixin.

```scss
// Mixin definition
my-mixin($content) {
  $content();
}

// Mixin call
$ > my-mixin(@{
  color: red;
}); 
```
Or do Sass-style.
```scss
// Mixin definition
my-mixin() {
  @-content(); // optional, will not throw an error if not present
}

// Mixin call -- with :?
$ > my-mixin(): @{
  color: red;
}
```
In Sass, you can do this:
```scss
@mixin media($types...) {
  @each $type in $types {
    @media #{$type} {
      @content($type);
    }
  }
}

@include media(screen, print) using ($type1) {
  h1 {
    font-size: 40px;
    @if $type1 == print {
      font-family: Calluna;
    }
  }
}
```

Jess equivalent is:
```scss
media($types...) {
  @-for($type in $types) {
    @media #{$type} {
      @-content($type);
    }
  }
}

$ > media(screen, print): @($type1) {
  h1 {
    font-size: 40px;
    @-if($type1 = print) {
      font-family: Calluna;
    }
  }
}
```


## Functions

Functions use the return symbol `>` to designate a mixin as returning a single value (assigned to `return`).

```scss
$foo: @($width; $height) > {
  return: $width;
}
.box {
  value: $foo(10px, 20px);
}
```

Note, functions do not have "early" returns. For example:
```scss
$foo: @($var) > {
  $if($var = 0) {
    return: red;
  }
  return: blue;
}

.a {
  color: $foo(0); // returns `blue`
}
```

Functions can have simple returns
```scss
$double: @($unit) > #($unit * 2);
```

## Collections

Collections (also called "maps") are defined like this:

```scss
$my-collection: {
  foo: bar;
}
```

Collections look a lot like anonymous mixins on purpose. The first difference is for syntax highlighting and language services. That is, collections can contain any arbitrary keys, whereas mixin "keys" should be legitimate CSS properties. The second difference is that collections cannot contain nested mixins.

To look up a value, you can use the dot (`.`) syntax.

```scss
.a {
  property: $my-collection.foo;
}
```

### Collections and properties

When assigned to properties, collection keys get merged:

```scss
.a {
  border-bottom: {
    color: red;
    width: 1px;
  }
}

// outputs
.a {
  border-bottom-color: red;
  border-bottom-width: 1px;
}

```