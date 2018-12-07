
*container.jess*
```less
@import {if} from 'jess/helpers';

@var { containerWidth: 9999 }

.box {
  width: ${if(containerWidth < 1200, if(containerWidth < 600, '50px', '100px'), '200px')};
}
```
Interpreted as:
```js
import {CSS} from 'jess'

export let state = 'block'

const def = config => {  
  // config setup
  return CSS({t: () => {
    let t = ''
    t += '.box { width: '
    t += if(containerWidth < 1200, if(containerWidth < 600, '50px', '100px'), '200px')
    t += ';}'
    return t
  }});
}

export default def
```
*component.jsx*
```jsx
import React from 'react'
import styles from './container.jess'

class component extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      containerWidth: 9999
    }
    this.container = React.createRef()
  }
  
  componentDidMount() {
    this.observer = new ResizeObserver()
    this.observer.observe(this.container.current, sizes => {
      this.setState({containerWidth: sizes[0].width})
    })
  }
  
  componentWillUnMount() {
    this.observer.disconnect()
  }
  
  render = () => (
    <div ref={this.container} className={styles({this.state.containerWidth}).box} />
  )
}
```
static
```html
<style>
.box {
  width: var(--box-1, 50px);
}
.box-var1 {
  --box-1: 50px;
}
.box-var2 {
  --box-1: 100px;
}
.box-var3 {
  --box-1: 200px;
}
</style>

<div class="box box-var1"></div>
```
