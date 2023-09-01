# Jess - Less parser

As Jess started as a re-write of Less, this package represents a portion of that work, and is therefore a fully-functional Less CST parser.

## Ideas

### Converting Less 1.x-4.x to Less 5

1. Auto-wrap parens around division to dis-ambiguate.
2. Convert `@import` to `@use` and `@include` syntax.
3. Throw errors on `@plugin` and ask to refactor with `@from`
4. Convert function references to `@from '#less' ([func])`
5. Add parentheses after mixin calls e.g. `.ns > .mixin;` to `.ns.mixin();`
6. Convert local imports from `@import 'local'` to `@include './local.less'`
7. Convert `@import (less) './file.css';` to `@include './file.css' as less;`
8. Convert `@import (inline) './file.css';` to `@include './file.css' as text;`
9. Convert `@import (reference) './file.less';` to `@use './file.less';`


### Converting Less 1.x-4.x to Jess

1. Auto-wrap expressions (like math) with `$()`
2. Convert mixin definitions `.my-mixin()` to `@mixin my-mixin()`
3. Convert mixin calls to function calls: `#ns > .mixin()` to `$ns.mixin()`
4. Throw errors on mixed case mixins: `.my-mixin()` and `.myMixin()`
5. Throw errors on mixed hash and class mixins: `#my-mixin()` and `.my-mixin()`
5. Convert variable declarations `@my-var` with `$my-var`
6. Convert interpolated vars `@{my-var}` to `$(my-var)`
7. Convert property references `$prop` to `$[prop]`
8. Convert color names in expressions to hex values.
