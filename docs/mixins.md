## Supports Less and Sass mixin patterns

Mixins must have semi-colon-separated parameters (and can have optional final semi-colons)

```scss
// Plain mixin
@@ my-mixin($width; $height;) {
  width: $width;
  height: $height;
}

// Mixins can have dot-names or hash-names like Less
@@ .my-mixin($width; $height) {
  // ...
}
@@ #my-mixin($width; $height) {
  // ...
}

// Mixins can have default values
@@ my-mixin($width; $height: 1rem) {
  // ...
}

// Mixins, like Less, can be overloaded and dis-ambiguated by parameters
@@ my-mixin($width) {
  // ...
}
@@ my-mixin($width; $height) {
  // ...
}

// Mixins can have disambiguation by value
@@ my-mixin(red) {
  // ...
}
@@ my-mixin(blue) {
  // ...
}
// called like `$ -> my-mixin(red);`

// Like Less, mixins can have guards
@@ my-mixin($width; $height) when ($height > 1rem) {
  // ...
}

// called like
$>my-mixin(20px; 40px);

// mixins can be anonymous
$my-mixin: @@($width; $height) {
  // ...
}
// called like:
$my-mixin(20px; 40px);
```

## Functions

~Functions are just anonymous mixins with the value assigned to `@@`.~
TODO - this won't work, because they get returned in different places.

```less
@-fn foo ($width; $height) {
  @ > $width;
}
.box {
  value: $foo(10px, 20px);
}
```