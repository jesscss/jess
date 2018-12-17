```scss
@import "variables.scss";

$blah: #555;

@mixin some-mixin($val) {
  bar: $val;
}

.box {
  color: $blah;
  @include some-mixin(bar);
  .sub {
    foo: bar;
  }
}
```

```js
import * as Variables from './variables.scss';

// $ is a scope builder
export const styles = ({$}) => {
  // Send root vars to imports
  $ = Variables.styles({$})
  
  // variables are stripped of $ or @
  $.set('blah', '#555');

  $.function('some-mixin', $ => {
    $.addRule('bar', $.e($ => $.get('val')))
  })

  $.addRules('.box', $ => {
    $.addRule('color', $.e($ => $.get('blah'))
    $.call('some-mixin', {['$val']: 'bar'})
    $.addRules('.sub', $ => {
      $.addRule('foo', 'bar') 
    })
  })

  return $
}
```

```less
@import "variables.less";

@blah: #555;

.some-mixin(@val) {
  bar: @val;
}

.box {
  color: @blah;
  .some-mixin(bar);
  .sub {
    foo: bar;
  }
}
```

```js
import * as Variables from './variables.scss';

// $ is a scope builder
export const styles = ({$}) => {
  // variables are stripped of $ or @
  // $.set calls are hoisted to top of block for Less transpilation
  $.set('blah', '#555');
  
  // Send root vars to imports
  $ = Variables.styles({$})

  // will register as '.some-mixin` and 'some-mixin' as fallback
  $.function('.some-mixin', $ => {
    $.addRule('bar', $.e($ => $.get('val')))
  })

  // Rules will be added as function call for Less
  $.addRules('.box', $ => {
    $.addRule('color', $.e($ => $.get('blah'))
    $.call('.some-mixin', {['val']: 'bar'})
    $.addRules('.sub', $ => {
      $.addRule('foo', 'bar') 
    })
  })

  return $
}
```

```less
#ns {
  .mixin {
    foo: bar;
  }
}
val: #ns.mixin[foo];
```

```js
$.addRule('val', $.e($ => $.get(['#ns', '.mixin', 'foo'])))
```

```less
@dimension: 30px;
val: @dimension * 2;
```

```js
// value is Array [30] with prop unit = 'px'
$.set('dimension', [30, 'px'])
// evaluator will collect units and check for unit on return
$.addRule('val', $.e($ => $.get('dimension') * 2))
```
