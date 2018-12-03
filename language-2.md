
```less
// component.jess
${
  import {Colors} from 'variables.jess';
  import {shade} from 'jess/func/colors';
}

@var (isSmall: false);

.box {
  height: ${isSmall ? '30px' : '100px'};
}

```
Above transpiles to:
```js
import {CSS} from 'jess';
import {Colors} from 'variables.jess';
import {shade} from 'jess/func/colors';

const def = new CSS((isSmall = false) => {
  return memo(isSmall, () => {
    return { 
      css: `.box-237235 {
        height: var(--box-237235-isSmall);
        }`,
      vars: [['--box-237235-isSmall', isSmall ? '30px : '100px']]
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
