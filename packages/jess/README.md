<p style="text-align: center"><img width="184" src="https://github.com/matthew-dean/jess/raw/master/simple-hawk-drawing-1.jpg"></p>

_Note: This project is in alpha. Expect (and report) bugs!_
# Jess
JavaScript Evaluated Style Sheets, from the people who brought you Less.

## Why Jess?

Jess looks / functions more like the languages you're used to — CSS and JavaScript — and integrates smoothly with both. Sass / Less are mini-programming languages, which have to manage things like variable scope. Jess is just JavaScript, and Jess variables and mixins are just JavaScript variables and functions, respectively. That means you can export Jess into JavaScript, and you can import JavaScript into Jess. (You can do a lot more than that, but that's the basic premise.)

### P.S. Why is the logo a hawk?

_A "jess" is defined as "a short leather strap that is fastened around each leg of a hawk"_.

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
import styles, { square } from './styles.jess'
const css = styles()

export const myComponent = props => {
  return <div className={css.box} style={square(props.size).obj()}>Component</div>
}
```


## Contributing
As this is a WIP, file issues with your ideas/concerns/wants!
