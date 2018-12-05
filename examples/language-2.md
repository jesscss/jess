
```less
// component.jess
@{
  import {Colors} from 'variables'
  import {shade} from 'jess/func/colors'
}

$$isSmall: false;  // externally bound variable

.box {
  height: ${isSmall ? '30px' : '100px'};
  color: ${shade(Colors.brand, 0.5)};
}

```
Above transpiles to:
```js
import {CSS} from 'jess'

// TODO - can we tree-shake Colors and shade out if they're not dynamic? 
import {Colors} from 'variables'
import {shade} from 'jess/func/colors'

// Memoized on isSmall
const def = new CSS(({ isSmall: false }) => {
  return {
    css: [
      // static <style> for fewer style tree changes
      `.box {
        height: var(--box-1, 30px);  // evaluated values
        color: var(--box-2, #45F328);
        }`,
      // dynamic <style> - attach to individual classes also attached to element,
      // See: https://lisilinhart.info/posts/css-variables-performance/
      // How to handle this (where to put it?) for custom elements? 
      ['--box-1', () => isSmall ? '30px' : '100px'],
      [`--box-2`, () => shade(Colors.brand, 0.5)]
    ],
    box: 'box'
   }
});

export default def;
```

```js
import styles from './component.jess'

const component = ({isSmall}) => {
  <div className={styles({isSmall}).box} />
}
```
static
```html
<!-- static -->
<style>
.box {
  height: var(--box-1, 30px);
  color: var(--box-2, #45F328);
}
</style>

<!--
  Dynamic, generated per memoized variant.
  This is so the style tree doesn't have to be recalculated if several instances use the same values.
-->
<style>
.box-1A { --box-1: 30px; }
.box-1B { --box-2: #45F328; }
</style>

<div class="box box-1A box-1B" />
```
