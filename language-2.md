
```less
// component.jess
${
  import {Colors} from 'variables';
  import {shade} from 'jess/func/colors';
}

@var (isSmall: false);

.box {
  height: ${isSmall ? '30px' : '100px'};
  color: ${shade(Colors.brand, 0.5)};
}

```
Above transpiles to:
```js
import {CSS} from 'jess';
import {Colors} from 'variables';
import {shade} from 'jess/func/colors';

const def = new CSS((isSmall = false) => {
  return memo(isSmall, () => {
    return { 
      // Class name + hash of transpiled styles
      css: `.box-237235 {
        height: var(--box-237235-1);
        color: #45F328;
        }`,
      vars: [
        // Will be injected at :root for quick updates
        ['--box-237235-1', isSmall ? '30px' : '100px']
      ]
     }
  })
});

def.box = 'box-237235';

export default def;
```

```js
import styles from './component.jess'

const component = ({isSmall}) => {
  <div className={styles(isSmall).box}
}
```
