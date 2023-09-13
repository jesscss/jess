import { selectorMap } from './symbols'
import type { ScopeObj } from './types'

/**

Extend map can be like:
@example 1
.foo {}
.bar:extend(.foo);

'.foo': ['.bar']

.one:extend(.bar)

'.foo': ['.bar'],
'.bar': ['.one']

When rendering .foo, we look up the extend map and find .bar,
now we have ":is(.foo, .bar)"

We look up .bar, and find .one, now we have ":is(.foo, .bar, .one)"

We look up .one and it doesn't exist, so we're done.

 @example 2
.one.two.three {}

.foo:extend(.one);
.bar:extend(.two.three);
.four:extend(.two);
.five:extend(.one.two.three !all);

extendPartialMap
'.one': ['.foo'],
'.two': ['.four'],
'.two.three': ['.bar']

continueMap
'.two': ['.two.three'],

1. When rendering '.one', we look up '.one' and find '.foo'.
   Now we have ':is(.one, .foo).two.three'
2. When rendering '.two', we look up '.two' and find '.four'.
   Now we have ':is(.one, .foo):is(.two, .four).three'; However, we also
   have '.two.three' in the continueMap, so we compare '.two.three'
   to our current selector and find it, so we look up '.two.three'
   in the partial map.
   Now we have ':is(.one, .foo):is(:is(.two, .four).three, .bar)'
*/

/**
 * Creates a selector lookup map like:
 * {
 *   [map]: {
 *     '#foo': {
 *       '>': {
 *         '.bar': true
 *       }
 *     }
 *     '.bar': true
 *   }
 * }
 * This is used for :extend and language services
 */
export function registerSelectors(
  this: ScopeObj,
  selector: string[]
) {
  const ext = this[selectorMap]
  /** @todo - fix type */
  let path: any = ext
  for (let i = 0; i < selector.length; i++) {
    const sel = selector[i]
    if (path === ext && path[sel] === true) {
      path[sel] = {}
    }
    if (!path[sel]) {
      if (/[>|+~\s]/.test(sel[0])) {
        path[sel] = {}
      } else {
        path[sel] = i === selector.length - 1 ? true : {}
        if (!ext[sel]) {
          ext[sel] = true
        }
      }
    }
    path = path[sel]
  }
}

export function registry(
  this: ScopeObj,
  selector: string[],
  extendSelector?: string[],
  matchAll?: boolean
) {
  registerSelectors.call(this, selector)
  if (extendSelector) {
    registerSelectors.call(this, extendSelector)
  }
}