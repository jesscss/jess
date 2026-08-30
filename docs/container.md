
*container.jess*
```less
@import {if} from 'jess/helpers';

@let contain: 640;

.box {
  width: $if(contain < 640, 100, 200)px;
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
    t += if(containerWidth < 640, { value: 100, unit: 'px' }, { value: 200, unit: 'px' })
    t += ';}'
    return t
  }});
}

export default def
```
*component.jsx*
```jsx
import React from 'react'
import css from './container.jess'

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
  
  render = () => {
    const styles = css({ contain: this.state.containerWidth })
    return <div ref={this.container} className={styles.box} />
  }
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
