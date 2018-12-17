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
import {$} from 'jess';

import * as _Variables from './variables.scss';

$.set('blah', '#555');

$.addFunction('some-mixin', ($, args) => {
  $.addRule('bar', $.e($ => $.get('val')))
})

// Send root vars to imports
const Variables = _Variables.styles({$blah})

$.addRules('.box', $ => {
  $.addRule('color', $.e($ => $.get('blah'))
  $.callFunction('some-mixin', {['val']: 'bar'})
  $.addRules('.sub', $ => {
    $.addRule('foo', 'bar') 
  })
})
```
