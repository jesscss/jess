
```less
// component.jess
@{
  import {Colors} from 'variables';
  import {shade} from 'jess/func/colors';
}

$$isSmall: false;  // externally bound variable

.box {
  height: ${isSmall ? '30px' : '100px'};
  color: ${shade(Colors.brand, 0.5)};
}

```
Above transpiles to:
```js
import {CSS} from 'jess';

// Memoized on isSmall
const def = new CSS(({ isSmall: false }) => {
  return { 
    // Class name + hash of transpiled styles
    css: `.box-237235 {
      height: var(--box-237235-1);
      color: #45F328;
      }`,
    vars: [
      // Will be injected at :root for quick updates
      ['--box-237235-1', isSmall ? '30px' : '100px']
    ],
    box: 'box-237235'
   }
});

export default def;
```

```js
import styles from './component.jess'

const component = ({isSmall}) => {
  <div className={styles({isSmall}).box}
}
```
