## Supports Less and Sass mixin patterns

Mixins must have semi-colon-separated parameters (and can have optional final semi-colons)

```scss
// Plain mixin
@--mixin my-mixin($width; $height;) {
  width: $width;
  height: $height;
}

// Mixins can have dot-names or hash-names like Less
@--mixin .my-mixin($width; $height) {
  // ...
}
@--mixin #my-mixin($width; $height) {
  // ...
}

// Mixins can have default values
@--mixin my-mixin($width; $height: 1rem) {
  // ...
}

// Mixins, like Less, can be overloaded and dis-ambiguated by parameters
@--mixin my-mixin($width) {
  // ...
}
@--mixin my-mixin($width; $height) {
  // ...
}

// Mixins can have disambiguation by value
@--mixin my-mixin(red) {
  // ...
}
@--mixin my-mixin(blue) {
  // ...
}
// called like `$ -> my-mixin(red);`

// Like Less, mixins can have guards
@--mixin my-mixin($width; $height) when ($height > 1rem) {
  // ...
}

// mixins can be anonymous
$my-mixin: @--mixin ($width; $height) {
  // ...
}
// called like:
$ -> $my-mixin();
```

## Functions

```less
@--function my-func ($width; $height) {
  @--return value;
}
```