
*variables.jess*
```less
@var {colorTheme: 'red'}
```
Interpreted as:
```js
// TODO update
import {CSS} from 'jess'

const def = config => {
  const {colorTheme = 'red'} = config
  return CSS({t: ''});
}

export default def
```


*main.jess*
```less
@import {colorTheme} from './variables.jess'

.box {
  color: ${colorTheme};
}
```
interpreted as:
```js
import {CSS} from 'jess'
import {colorTheme} from './variables.jess'

const def = () => {
  return CSS({t: `.box {\n  color: ${colorTheme};\n}`});
}

export default def
```
evaluated as: 
```js
import {CSS} from 'jess'

const def = () => {
  return CSS({t: `.box {\n  color: red;\n}`});
}
def.box = 'box'

export default def
```
static export:
```css
.box {
  color: red;
}
```
