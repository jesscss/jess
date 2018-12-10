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
.serif-font {
  font-family: Georgia, serif;
}

${extend('.display', '.serif-font'} {
  font-size: 30px;
  line-height: 35px;
}
```
`extend()` does a search/replace with a comma-delimited list
```css
.serif-font, .display {
  font-family: Georgia, serif;
}

.display {
  font-size: 30px;
  line-height: 35px;
}
```
`append()` changes the output class mapping a la CSS Modules. Normally it's 'display' === 'display'. Instead it would be 'display' === 'display serif-font' (or scoped equivalent)
```less
.serif-font {
  font-family: Georgia, serif;
}

${append('.display', '.serif-font'} {
  font-size: 30px;
  line-height: 35px;
}
```
CSS output is unchanged:
```css
.serif-font {
  font-family: Georgia, serif;
}

.display {
  font-size: 30px;
  line-height: 35px;
}
```
...but class output changes...
```js
import type from "./type.jess";

element.innerHTML = 
  `<h1 class="${type.display}">
    This is a heading
  </h1>`;
```
Outputs:
```
<h1 class="display serif-font">
  Heading title
</h1>
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

@const gutter = 30;
@const breakpoints = {
  sm: 600,
  md: 800,
  lg: 1000
};
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
  
  return `${
    for(1, columns, i => { makeColumns(i, infix) })}
  
    extend(`.col${infix}`, '.grid-column')},
    extend(`.col${infix}-auto`, '.grid-column')} { }
   }`
}
```

```less
@import {eachBreakpoint} from 'functions.js';

.grid-column
  position: relative;
  width: 100%;
  padding-right: ${gutter / 2}px;
  padding-left: ${gutter / 2}px;
}

${each(mapKeys(breakpoints), eachBreakpoint}

```
