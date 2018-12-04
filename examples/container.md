
*container.jess*
```less
$$containerWidth = 9999

.box {
  $if (containerWidth < 600) {
    width: 50px;
  } else if (containerWidth < 900) {
    width: 100px;
  } else if (containerWidth < 1200) {
    width: 200px;
  }
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
    t += '.box {'
    if (containerWidth < 600) {
      t += 'width: 50px;'
    } else if (containerWidth < 900) {
      t += 'width: 100px;'
    } else if (containerWidth < 1200) {
      t += 'width: 200px;'
    }
    t += '}'
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
  width: var(--box-1);
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
