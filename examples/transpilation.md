```scss
@import "variables.scss";

$blah: #555;

@mixin some-mixin($val) {
  bar: $val;
}

.box {
  color: $blah;
  @include some-mixin('bar');
  .sub {
    foo: bar;
  }
}
```

```js
import {
  $,
  addRules,
  addRule,
  addFunction,
  callFunction
} from 'jess';

import * as _Variables from './variables.scss';

const $ = {}

$['blah'] = '#555';

addFunction('some-mixin', (args) => {
  let $ = {...$, ...args}
  addRule('bar', e($, ($) => $['val']))
})

// Send root vars to imports
const Variables = _Variables.styles({$blah})

addRules('.box', () => {
  addRule('color', e($, ($) => $['blah']))
  callFunction('some-mixin', {['val']: 'bar'})
  addRules('.sub', () => {
    addRule('foo', 'bar') 
  })
})
```
