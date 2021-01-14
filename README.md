# Jess
_NOTE: Everything here is a WIP. Don't consume it yet, but ask about contributing!_

### JavaScript Enhanced Style Sheets 

This is the monorepo for Jess, a new, modern CSS pre-processor from the people who brought you Less. [See the explainer](docs/README.md)

```less
@import { width } from './values.js'

@let myWidth: $(width)px;

.box {
  width: $myWidth;
}
```

To set up, run:
```
yarn install
```

