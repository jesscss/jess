<div align="center">
  <img width="144" height="144" src="https://raw.githubusercontent.com/jesscss/jess/master/packages/docs/static/img/android-chrome-192x192.png">


  _Jess is now in Alpha! Star this repo for later updates!_

  [![Ask questions in the Jess Gitter community!](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/jesscss/community)
</div>

# Jess
### The New CSS Pre-Processing Hotness

This is the monorepo for Jess, a new, modern CSS pre-processor from the people who brought you Less. [See the docs.](https://jesscss.github.io)

```less
@import { width } from './values.ts';
@import { myMixin } from './mixins.jess';

@let iconWidth: $(width)px;

@mixin square(unit: 24px) {
  width: $unit;
  height: $unit;
}

.icon {
  @include myMixin();
  @include square($iconWidth);

  color: cornflowerblue;
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

