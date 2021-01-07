### CSS Modules compose
```css
.serif-font {
  font-family: Georgia, serif;
}

.display {
  composes: serif-font;
  font-size: 30px;
  line-height: 35px;
}
```
```js
import type from "./type.css";

element.innerHTML = 
  `<h1 class="${type.display}">
    This is a heading
  </h1>`;
```
Outputs:
```
<h1 class="_type__display_0980340 _type__serif_404840">
  Heading title
</h1>
```

#### Jess version
```less
@mixin serifFont() {
  font-family: Georgia, serif;
}
.serif-font {
  @include serifFont();
}

.display {
  @include serifFont();
  font-size: 30px;
  line-height: 35px;
}
```

```css
.serif-font, .display {
  font-family: Georgia, serif;
}

.display {
  font-size: 30px;
  line-height: 35px;
}
```


### Sass conversion

Here's a Sass block for Bootstrap

```less
$gutter: 30px;
$breakpoints: 
  sm 600px,
  md 800px,
  lg 1000px;

%grid-column {
  position: relative;
  width: 100%;
  padding-right: ($gutter / 2);
  padding-left: ($gutter / 2);
}

@each $breakpoint in map-keys($breakpoints) {
  $infix: breakpoint-infix($breakpoint, $breakpoints);

  // Allow columns to stretch full width below their breakpoints
  @for $i from 1 through $columns {
    .col#{$infix}-#{$i} {
      @extend %grid-column;
    }
  }
  .col#{$infix},
  .col#{$infix}-auto {
    @extend %grid-column;
  }
}
```

Jess's pattern encourages you to organize your exports/imports, and to separate complex functions / patterns from your styles.
```less
// variables.jess
@let gutter: 30;
@let breakpoints {
  sm: 600,
  md: 800,
  lg: 1000
}
```

```js
// functions.js

import {$} from 'jess'
import {extend, for, each, detached} from 'jess/helpers'
import {breakPoints} from './variables.jess'

export function makeColumns(i, infix) {
  return extend(`.col${infix}-${i}`, '.grid-column')
}

export function eachBreakpoint(breakpoint) {
  const infix = breakpointInfix(breakpoint, breakpoints);
  
  return `
    ${for(1, columns, i => { makeColumns(i, infix) })}
  
    ${extend(`.col${infix}`, '.grid-column')},
    ${extend(`.col${infix}-auto`, '.grid-column')} { }
   `
}
```

```less
@import {eachBreakpoint} from 'functions.js';

.grid-column, $[breakpoints] {
  position: relative;
  width: 100%;
  padding-right: ${gutter / 2}px;
  padding-left: ${gutter / 2}px;
}

${each(mapKeys(breakpoints), eachBreakpoint}

```
