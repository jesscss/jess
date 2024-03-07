<div align="center">
  <img width="144" height="144" src="https://raw.githubusercontent.com/jesscss/jess/master/packages/docs/static/img/android-chrome-192x192.png">


  _Jess is now in Alpha! Star this repo for later updates!_
</div>

# Jess
### The New CSS Pre-Processing Hotness

This is the monorepo for Jess, a new, modern CSS pre-processor from the people who brought you Less. [See the docs.](https://jesscss.github.io)

Jess is a language-agnostic, CSS pre-processor replacement for:
- Less
- Sass (SCSS)
- CSS Modules
- CSS-in-JS

```less
$from './values.ts' import (width);
$from '#less' import (unit);

$use './variables.less' my-vars;
$include './bootstrap.scss' with my-vars;

$use './mixins.jess' (my-mixin);
$use './mixins.less' (.less-mixin);

$let icon-width: $unit($width, px);

$mixin overloaded() {
  color: black;
}
$mixin overloaded() {
  background-color: green;
}

// non-overloadable (but replaceable) anonymous mixin
$let square: _(unit: 24px) {
  width: $unit;
  height: $unit;
};

$let color: cornflowerblue;

.icon {
  $ -> my-mixin();
  $ -> .less-mixin();
  $ -> square($icon-width);
  $ -> overloaded();

  color: $color;
}
```

**Seriously, you're going to want to star this repo.**

To set up, run:
```
yarn install
```

This project is openly seeking contributors and collaborators. To contribute:

1. Read the [Code of Conduct](./CODE_OF_CONDUCT.md).
2. See the [contributing guide](./CONTRIBUTING.md).
3. Check [the Todos](https://github.com/jesscss/jess/issues?q=is%3Aissue+is%3Aopen+label%3Atodo), and see what interests you.
4. Find a core contributor (I mean, it's just Matthew Dean so far, but you can change that) and ask them about getting started.
5. Have the todo assigned to you in Github.
6. Submit your PR!

