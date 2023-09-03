## Changes for 2.0


- We align names of AST nodes with CST nodes, where possible
- We assume all value sequences are space separated. Any Node that has pre-whitespace with a single space is therefore ommitted.


Target module
```js
import { seq as $$seq } from 'jess';

export let mixin
```
```js
import { mixin } from './something.jess'

mixin()
```
