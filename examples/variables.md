
*variables.jess*
```less
$$colorTheme = 'red';
```
Interpreted as:
```js
import {CSS} from 'jess'
export let colorTheme = 'red'

const def = config => {    
  for (let p of config) {
    switch(p) {
      case 'colorTheme':
        colorTheme = String(config[p])
        break;
    }
  }
  return CSS({t: ''});
}

export default def
```


*main.jess*
```less
@{
  import {colorTheme} from './variables.jess'
}

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

export default def
```
static export:
```css
.box {
  color: red;
}
```
