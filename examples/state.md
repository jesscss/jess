
*state.jess*
```less
@let state: block;

.box {
  display: $state;
}
```
Interpreted as:
```js
// TODO update with above example
import {CSS} from 'jess'

export let state = 'block'

const def = config => {  
  // config setup
  return CSS({t: () => {
    let t = ''
    if (state === 'block') {
      t += `display: block;\n`
    } else {
      t += `display: inline;\n`
    }
    return t
  }});
}

export default def
```
*component.jsx*
```jsx
import styles from './state.jess'

const component = props => {
  <div className={styles({props.state}).box} />
  // outputs <div class="box box-block" />
}
```
static
```css
.box {
  display: var(--box-1, block);
}
.box-block {
  --box-1: block;
}
.box-inline {
  --box-1: inline;
}
```
