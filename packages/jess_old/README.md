<div align="center">
  <img width="144" height="144" src="https://raw.githubusercontent.com/jesscss/jess/master/packages/docs/static/img/android-chrome-192x192.png">
</div>

_Note: This project is in alpha. Expect (and report) bugs!_
# Jess
JavaScript Evaluated Style Sheets, from the people who brought you Less.

## Why Jess?

* Jess does what Sass and Less do, only faster (and does some things they can't).
* Jess does what CSS-in-JS does, only it keeps your CSS in stylesheets.
* Jess does what CSS Modules does, but more dynamically.
* Jess does whatever JavaScript can do, because it transpiles to JavaScript under-the-hood.

You can think of Jess as a middle-ground between Less/Sass and CSS-in-JS. It keeps your styles in stylesheets, but it's equally dynamic. Jess is CSS-in-JS for people who don't like CSS in their JS.

For more information, see [the docs](https://jesscss.github.io/docs/).

### P.S. Why is the logo inspired by a hawk?

_A "jess" is defined as "a short leather strap that is fastened around each leg of a hawk..."_.

## Usage
```
yarn install jess
npm install jess
```
To compile a `.jess` file into CSS:
```
jess file.jess
```

## Features

### Variables
```less
@let myWidth: 3px;

.box {
  width: $myWidth;
}
```
### Import from JS
```less
@import { constants } from './constants.js';

.box {
  width: $(constants.WIDTH + 10)px;
}
```

### Import from Jess
```less
@import { myWidth } from './stylesheet.jess';

.box {
  width: $myWidth;
}
```

### Include other stylesheets
```less
@import styles from './stylesheet.jess';
@include styles();
```

### Mixins
```less
@mixin square(size) {
  width: $size;
  height: $size;
}

.box {
  @include square(50px);
}
```

### Exporting from Jess
_In progress, requires the (unfinished) Rollup or Webpack plugin._
```jsx
import styles, { square } from './component.m.jess'

export const myComponent = props => {
  return <div className={styles.box} style={square(props.size)}>Component</div>
}
```


## Contributing
As this is a WIP, file issues with your ideas/concerns/wants!
