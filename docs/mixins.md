## Supports Less and Sass mixin patterns

Named mixins start with an `@` followed by a space followed by the name.

Mixins can have comma-separated or semi-colon-separated parameters (and can have optional final separators).

```scss
// Plain mixin
@ my-mixin($width; $height;) {
  width: $width;
  height: $height;
}

// Mixins can have dot-names or hash-names like Less
@ .my-mixin($width; $height) {
  // ...
}
@ #my-mixin($width; $height) {
  // ...
}

// Mixins can have default values
@ my-mixin($width; $height: 1rem) {
  // ...
}

// Mixins, like Less, can be overloaded and dis-ambiguated by parameters
@ my-mixin($width) {
  // ...
}
@ my-mixin($width; $height) {
  // ...
}

// Mixins can have disambiguation by value
@ my-mixin(red) {
  // ...
}
@ my-mixin(blue) {
  // ...
}
// called like `$ -> my-mixin(red);`

// Like Less, mixins can have guards
@ my-mixin($width; $height) when ($height > 1rem) {
  // ...
}

// called like
$>my-mixin(20px; 40px);
```

Single values in parameter default values / arguments must be wrapped in `(` `)` with optional preceding `~`
```scss
$ > my-mixin($fonts: ('Times New Roman', serif));
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
@ my-mixin($content) {
  $content();
}

// Mixin call
$ > my-mixin(@{
  color: red;
}); 
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