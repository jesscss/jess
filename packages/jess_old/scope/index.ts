import {
  original,
  rules,
  selectorMap,
  register,
  mixinMap,
  context,
  mixinArgs,
  isMixin,
  noMatch
} from './symbols'
import { registry } from './registry'
import type { ScopeObj, GenericObject, Languages } from './types'

const proxyHandler: ProxyHandler<ScopeObj> = {
  // get(target, p) {
  //   if (p.constructor === String) {
  //     if (p.startsWith('$')) {
  //       if (p in target) {
  //         return target[p]
  //       }
  //     } else {

  //     }
  //   } else {
  //     if (p in target) {
  //       return target[p]
  //     }
  //   }
  // },
  set(target, p, value) {
    if (typeof p === 'string') {
      /** Variables and mixin references */
      if (p.startsWith('$')) {
        /** Mixin behavior */
        if (value[isMixin]) {
          const ctx = target[context]
          const isLess = ctx === 'less'
          if (isLess || ctx === 'jess') {
            if (!(mixinMap in target)) {
              target[mixinMap] = {}
            }
            if (!target[mixinMap]![p]) {
              target[mixinMap]![p] = {
                mixins: [],
                default: []
              }
              /**
               * For Less/Jess mixins, we can register many matches.
               * The results will be combined into a new set of rules.
               */
              Object.defineProperty(target, p, {
                writable: true,
                /**
                 *
                 * @param this Caller scope
                 */
                value: function(this: ScopeObj | undefined, ...args: any[]) {
                  /** Less mixins have access to the caller scope */
                  const localThis = this && isLess ? this : {}
                  const scope = Scope(localThis)
                  if (this && isLess) {
                    scope[mixinArgs] = this[mixinArgs]
                  }

                  let results = target[mixinMap]![p].mixins!
                    .map(mixin => mixin.call(scope, ...args))
                    .filter((result: any) => result !== noMatch)

                  if (results.length === 0) {
                    results = target[mixinMap]![p].default!
                      .map(mixin => mixin.call(scope, ...args))
                      .filter((result: any) => result !== noMatch)

                    if (results.length === 0) {
                      throw new Error('RuntimeError: No matching definition was found')
                    }
                    if (results.length > 1) {
                      throw new Error('RuntimeError: Ambiguous use of `default()`')
                    }
                  }

                  if (results.length === 1) {
                    scope[rules].concat(results[0])
                  } else {
                    scope[rules].concat(...results)
                  }
                  return scope
                }
              })
            }
            target[mixinMap]![p].mixins!.push(value)
          } else {
            target[p] = value
          }
          return true
        }
        if (!(p in target)) {
          Object.defineProperty(target, p, {
            value,
            writable: true
          })
        } else {
          target[p] = value
        }
        return true
      }
      /** Every set of a property */
      target[rules].push({ [p]: value })
      target[p] = value
    }
    return true
  }
}

/**
 * Create a new scope object (for root or mixins or declaration lists)
 */
export function Scope(obj: GenericObject, ctx: Languages = 'jess'): ScopeObj {
  if (obj[original]) {
    /** We make sure we extend the prototype of the non-proxied object */
    obj = Object.create(obj[original])
  } else {
    Object.defineProperties(obj, {
      [original]: {
        value: obj
      },
      [selectorMap]: {
        value: {}
      },
      [register]: {
        value: registry.bind(obj as ScopeObj)
      }
    })
  }

  Object.defineProperties(obj, {
    [rules]: {
      value: []
    },
    [context]: {
      value: ctx
    }
  })

  return new Proxy(obj as ScopeObj, proxyHandler)
}