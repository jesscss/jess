/**
 * Object symbols
 */
export const original = Symbol('original')
export const map = Symbol('map')
export const mixinMap = Symbol('mixinMap')
export const match = Symbol('match')
export const matchAll = Symbol('matchAll')
export const register = Symbol('register')
/** Rules and declarations */
export const rules = Symbol('rules')
/** Can be 'less' | 'scss' | 'jess'  */
export const context = Symbol('context')
export const props = Symbol('props')
export const noMatch = Symbol('noMatch')
export const isMixin = Symbol('isMixin')

const proxyHandler: ProxyHandler<object> = {
  get(target, p) {
    if (p in target) {
      return target[p]
    }
  },
  set(target, p, value) {
    if (typeof p === 'string') {
      /** Variables */
      if (p.startsWith('$')) {
        /** Mixin behavior */
        if (value[isMixin]) {
          const ctx = target[context]
          if (ctx === 'less' || ctx === 'jess') {
            if (!(mixinMap in target)) {
              target[mixinMap] = {}
            }
            if (!target[mixinMap][p]) {
              target[mixinMap][p] = []
            }
            target[p] = function(...args: any[]) {
              
            }
          } else {
            target[p] = value
          }
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
    } else {
      target[p] = value
    }
    return true
  }
}

type GenericObject = Record<string | symbol, any>

/** Create a new scope object (for root or mixins or declaration lists) */
export const Scope = (obj: GenericObject, ctx: 'less' | 'scss' | 'jess' = 'jess'): GenericObject => {
  if (obj[original]) {
    obj = Object.create(obj[original])
  } else {
    obj[original] = obj
    const ext = obj[map] = {}

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
    const registerSelectors = (
      selector: string[]
    ) => {
      let path = ext
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

    /** Register selector paths in the global registry */
    obj[register] = (
      selector: string[],
      extendSelector?: string[],
      matchAll?: boolean
    ) => {
      registerSelectors(selector)
      if (extendSelector) {
        registerSelectors(extendSelector)
      }
    }
  }
  
  obj[rules] = []
  obj[context] = ctx
  return new Proxy(obj, proxyHandler)
}

type PropType = {
  type: 'color' | 'dimension'
  name: string
}

type ArgTest = (args: any[]) => boolean
/**
 * Mixin definition like:
 * 
 * .mixin(@color: #FFF, @width: 2px) {}
 * 
 *   e.g. 
createMixin(
  function(color, width) { },
  [
    {
      name: 'color',
      type: 'color'
    }
  ],
  $,
  [
    props => props.length === 2
  ]
)
*/
export const createMixin = (
  func: (...args: any[]) => GenericObject,
  ctx: GenericObject,
  propTypes: PropType[] = [],
  argTests: ArgTest[] = []
) => {
  const scope = Scope(ctx)
  const newFunction = function(...args: any[]) {
    const fail = argTests.find(test => !test(args))
    if (fail) {
      return noMatch
    }
    scope[props] = args.map((arg, i) => ({
      type: propTypes[i],
      value: arg
    }))
    return func.apply(scope, args)
  }
  /** Make the function length match the original */
  Object.defineProperty(newFunction, 'length', {
    value: func.length
  })
  newFunction[isMixin] = true
  return newFunction
}