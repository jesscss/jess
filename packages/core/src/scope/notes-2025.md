# Improved Scope object

1. The scope object should be used to hold imported and declared variables, objects, ruleset
paths, and mixin declarations.

2. Depending on how we're searching, either in a mixin call or extend call, the matches will be
different. For example:
  a. in a mixin, lookup, a declaration of `.a { .b {} }` can be matched with a call of `.a.b()` or
     `.a .b()` or `.a > .b()`. Similarly, a declaration of `.a > .b {}` can be matched with all the
     above calls.
  b. BUT, in an extend call, the match must match the combinators e.g. `.c:extend(.a > .b)` will match
     `.a > .b {}` but not `.a .b {}`
  c. mixin / ruleset lookups only support classes, ids, and optional `>` combinators

3. Each file, ruleset, and mixin has its own scope. When it's called, the lookups are chained at that
time.

```less
// file-1.less

.a {
  .b() {
    color: red;
  }
}

.test {
  .a.b()
}

// outputs
.test {
  color: black;
}

// file-2.less
@use './file-1.less';

.a {
  .b() {
    color: black;
  }
}

.test {
  .a.b()
}

// outputs 
.test {
  color: red;
  color: black;
}
```

4. Less mixin names don't have to be normalized because Jess/Sass can call with escapes, e.g.

```less
// file.less
#ns {
  .class() {
    color: black;
  }
}
```
```scss
// file.scss
.test {
  @include \#ns\.class; // a lookup of `\#ns\.class` will be "auto-split" by `\.` and `\#`
}
```
```scss
// file.jess
.test {
  $ -> #ns.class();
}
```

5. Jess will allow mixins to be declared with `.` for `#` for migrating compatibility.
```scss
// file.jess
// ALL valid
$mixin #foo () {}
$mixin .foo () {}
$mixin foo () {}
```



  