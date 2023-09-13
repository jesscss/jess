# Jess - Less parser

Translates a Less string to a Jess AST.

## Ideas

### Converting Less 1.x-5.x to Less 6

1. Auto-wrap parens around division to dis-ambiguate.
2. Convert `@import` to `@use` and `@include` syntax.
3. Throw errors on `@plugin` and ask to refactor with `@from`
4. Convert function references to `@from '#less' ([func])`
5. Add parentheses after mixin calls e.g. `.ns > .mixin;` to `.ns.mixin();`
6. Convert local imports from `@import 'local'` to `@include './local.less'`
7. Convert `@import (less) './file.css';` to `@include './file.css' as less;`
8. Convert `@import (inline) './file.css';` to `@include './file.css' as text;`
9. Convert `@import (reference) './file.less';` to `@use './file.less';`
10. Files that consume variables, mixins, or rules (like with extend) should have a `@use` added.
11. Don't allow `.class` as a value in a declaration. Convert to `\.class`
12. In a custom property value, convert `@variable` to `@{variable}`.


### Converting Less 1.x-4.x to Jess

1. Auto-wrap expressions (like math) with `$()`
2. Convert mixin definitions `.my-mixin()` to `@mixin my-mixin()`
3. Convert mixin calls to function calls: `#ns > .mixin()` to `$ns.mixin()`
4. Throw errors on mixed case mixins: `.my-mixin()` and `.myMixin()`
5. Throw errors on mixed hash and class mixins: `#my-mixin()` and `.my-mixin()`
5. Convert variable declarations `@my-var` with `$my-var`
6. Convert interpolated vars `@{my-var}` to `$(my-var)`
7. Convert property references `$prop` to `$[prop]`
8. Convert color names in expressions to hex values (or wrapped in `color()`?) (because Jess doesn't support color keywords in expressions). Alternatively, should Jess allow `keyword` to denote keywords?
9. Convert `@rest...` to `...rest`
10. Convert `.rules()` to `@include .rules` if `.rules` is a selector. What if it's a selector and mixin? Maybe something like `@include .rules, $rules();`? This might change the execution order from Less though.
