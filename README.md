# Jess
_NOTE: Everything here is a WIP. Star this repo for later updates!_

[Ask questions in the Jess Gitter community!](https://gitter.im/jesscss/community)

### JavaScript Enhanced Style Sheets 

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

To set up, run:
```
yarn install
```

