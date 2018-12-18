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
export const styles = config => {
  let {$, ...rest} = config
  // variables are stripped of $ or @
  // $.set calls are hoisted to top of block for Less transpilation
  $.set('blah', '#555');
  
  // Send root vars to imports
  $ = Variables.styles({$})

  // will register as '.some-mixin` and 'some-mixin' as fallback
  $.function('.some-mixin', ['val'], $ => {
    $.declaration('bar', $.e($ => $.get('val')))
  })

  // Rules will be added as function call for Less
  $.rules('.box', $ => {
    $.declaration('color', $.e($ => $.get('blah'))
    $.call('.some-mixin', {['val']: 'bar'})
    $.rules('.sub', $ => {
      $.declaration('foo', 'bar') 
    })
  })

  return {$, ...rest}
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
$.config({
  rulesToMaps: true
})

$.rules('#ns', $ => {
  $.rules('.mixin', $ => {
    $.declaration('foo', 'bar')
  })
})

$.declaration('val', $.e($ => $.get(['#ns', '.mixin', 'foo'])))
```

```less
@dimension: 30px;
val: @dimension * 2;
```

```js
// last unit appended to string
$.config({lastUnit: true})
// value is object with valueOf 30
$.set('dimension', [30, 'px'])
// evaluator will collect units and check for unit on return
$.declaration('val', $.e($ => $.get('dimension') * 2))
```

```scss
@for $i from 1 through $grid-columns {
  .grid-#{$i} { @include grid-base($i); @extend .grid-block; }
}
@for $i from 1 to $grid-columns {
  .grid-prefix-#{$i} { @include grid-prefix($i); }
}
@for $i from 1 to $grid-columns {
  .grid-suffix-#{$i} { @include grid-suffix($i); }
}
@for $i from 1 to $grid-columns {
  .grid-push-#{$i} { @include grid-push($i); }
}
@for $i from 1 to $grid-columns {
  .grid-pull-#{$i} { @include grid-pull($i); }
}
```

```js
$.control($ => {
  $.set('i', 1)
  for(let _i = $.get('i'); i < $.get('grid-columns'); i++) {
    $.rules(`.grid-${_i}`, $ => {
      $.call('grid-base', {0: _i})
      $.extend('.grid-block')
    })
  }
})
```

```less
.mixin() when (@a = 1) {

}
.mixin() when (@a = 2) {

}
.mixin() when (default()) {

}
```

```js
$.config({functionOverloading: true})

$.function('.mixin', [], $ => {

}, $ => $.get('a') == 1)

$.function('.mixin', [], $ => {

}, $ => $.get('a') == 2)

$.function('.mixin', [], $ => {

}, $ => $.default())
```
```less
.mixin(@a) when (@a = 1) {
}
```
```js
// Test args, test guards, then execute
{
  ['.mixin']: [
    {
      args: {
        ['a']: undefined
      },
      guard($) {
        return $.get('a') == 1
      },
      function($) {
      },
    }
  ]
}
```
