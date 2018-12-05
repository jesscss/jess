```less
@{
  import {addMedia} from 'jess'
}
.box {
  display: block;
  $addMedia('min-width: 300px', {
    display: flex;
  })
}
```
