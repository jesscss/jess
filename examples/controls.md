
*loop.jess*
```less
@import {for} from 'jess/helpers';

${for(1, 6, (i) => `
  .col-${i} {
    width: ${10*i}px;
  }
`)}
```
Interpreted as:
```js
// TODO rewrite
import {CSS} from 'jess'

const def = () => {    
  return CSS({t: () => {
    let t = ''
    for (let i=1; i<6; i++) {
      t += `.col-${i} {
    width: ${10*i}px;
  }
`
    }
    return t
  }});
}

export default def
```
static
```css
.col-1 {
  width: 10px;
}
.col-2 {
  width: 20px;
}
.col-3 {
  width: 40px;
}
.col-5 {
  width: 50px;
}
.col-6 {
  width: 60px;
}
```
