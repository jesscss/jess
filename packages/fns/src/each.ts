import { List, Sequence, Rules, type Mixin } from '@jesscss/core'
import forEach from 'lodash-es/forEach'

/**
 * @example
 * @-from '@jesscss/fns' import (each);
 * @-let list: 1, 2, 3;
 * @-mixin iterate (value, key) {
 *   .icon-#($value) {
 *     width: $value;
 *     height: $key;
 *   }
 * }
 * $each(list, iterate);
 *
 * @todo - Fix
 */

// export function each(list: List | Sequence | unknown, mixin: Mixin) {
//   let collection: any
//   const rules = new Rules([])
//   if (list instanceof List || list instanceof Sequence) {
//     collection = list.value
//   } else {
//     collection = list
//   }
//   forEach(collection, (value, key) => {
//     rules.value.push(mixin(value, key))
//   })

//   return rules
// }