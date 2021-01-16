# Jess
_NOTE: Everything here is a WIP. Star this repo for later updates!_

[Ask questions in the Jess Gitter community!](https://gitter.im/jesscss/community)

### The New CSS Pre-Processing Hotness

This is the monorepo for Jess, a new, modern CSS pre-processor from the people who brought you Less. [See the explainer.](docs/README.md)

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

To contribute, check [the Todos](https://github.com/jesscss/jess/issues?q=is%3Aissue+is%3Aopen+label%3Atodo). Then go find Matthew Dean and ask him questions.
