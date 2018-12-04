
*variables.jess*
```less
$$colorTheme = 'red';
```
```js
import CSS from 'jess'

class def extends CSS {
  constructor(config) {
    super(config)
    
    def.colorTheme = 'red'
    
    for (let p in config) {
      def[p] = config[p].toString()
    }
  }
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
