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
export const params = Symbol('params')
export const args = Symbol('args')
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
              target[mixinMap][p] = {
                mixins: [],
                default: []
              }
              /**
               * For Less/Jess mixins, we can register many matches.
               * The results will be combined into a new set of rules.
               */
              Object.defineProperty(target, p, {
                writable: true,
                value: function(...args: any[]) {
                  let results = target[mixinMap][p].mixins
                    .map((mixin: Function) => mixin(...args))
                    .filter((result: any) => result !== noMatch)

                  if (results.length === 0) {
                    results = target[mixinMap][p].default
                      .map((mixin: Function) => mixin(...args))
                      .filter((result: any) => result !== noMatch)
                  
                    if (results.length === 0) {
                      throw new Error('RuntimeError: No matching definition was found')
                    }
                    if (results.length > 1) {
                      throw new Error('RuntimeError: Ambiguous use of `default()`')
                    }
                  }
                  if (results.length === 1) {
                    return results[0]
                  }
                  return results
                }
              })
            }
            target[mixinMap][p].mixins.push(value)
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
    } else {
      target[p] = value
    }
    return true
  }
}

type GenericObject = Record<string | symbol, any>

/**
 * Create a new scope object (for root or mixins or declaration lists)
 *
 * @todo - Should this be a class so it can be properly typed?
 */
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

type ParamType = {
  type?: 'color' | 'dimension'
  name: string
  default?: any
  value?: any
}

type ArgTest = (args: any[]) => boolean
/**
 * Mixin definitions like:
 * 
 * .mixin(@color: #FFF, @width: 2px) {}
 * .mixin() when (default()) {}
 * .mixin(@color: black; @margin: 10px; @padding: 20px) {}
 *   -- called with
 *      .mixin(@margin: 20px; @color: #33acfe);
 *      .mixin(#efca44; @padding: 40px);
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
  func: (...params: any[]) => GenericObject,
  ctx: GenericObject,
  paramTypes: ParamType[] = Array(func.length),
  argTests: ArgTest[] = []
) => {
  const scope = Scope(ctx)
  if (func.length !== paramTypes.length) {
    throw new Error('Number of function parameters and parameter types must match.')
  }
  /** Construct a map of names */
  const paramMap: Record<string, any> = {}
  for (let i = 0; i < paramTypes.length; i++) {
    const param = paramTypes[i]
    if (param.name) {
      paramMap[param.name] = i
    }
  }
  const mixin = function(...functionArgs: any[]) {
    /** First, we assign default values established by the params array */
    const newArgs: ParamType[] = paramTypes.map(param => ({
      name: param.name,
      value: param.default
    }))
    /** Then, we assign incoming args */
    /**
     * @todo - Should we allow an object as the first
     *         (and only) argument for JavaScript
     *         interoperability?
     */
    for (let i = 0; i < functionArgs.length; i++) {
      const arg = functionArgs[i]
      if (arg !== undefined) {
        newArgs[i].value = arg
      }
    }
    /** 
     * Finally, for internal calls, args are assembled from an
     * object passed on `this`. The reason for this is that
     * assignment can be more complex, with named parameters
     * mixed with positional args.
     *   e.g. 
     *   {
     *      0: 'value',
     *      color: '#FFF'
     *   }
     */
    if (this?.[args]) {
      const entries = Object.entries(this[args])
      for (let entry of entries) {
        const key = entry[0]
        const index: number = parseInt(key)
        if (!isNaN(index)) {
          /** It's a positional arg */
          newArgs[key].value = entry[1]
        } else {
          /**
           * It's a named arg. To place it correctly,
           * we need to look it up in the params array.
           */
          const pos = paramMap[key]
          if (pos === undefined) {
            /** Passed parameter doesn't exist on this mixin */
            return noMatch
          }
          newArgs[pos].value = entry[1]
        }
      }
    }
    if (
      /** One of the mixin's values is not defined */
      newArgs.find(val => val === undefined)
      /** One of the guards does not succeed */
      || argTests.find(test => !test(newArgs))
    ) {
      /** One of the mixin's values is not defined, so it's not a match. */
      return noMatch
    }

    for (let arg of newArgs) {
      scope[`$${arg.name}`] = arg.value
    }

    return func.apply(scope, newArgs.map(arg => arg.value))
  }
  /** Make the function length match the original */
  Object.defineProperty(mixin, 'length', {
    value: func.length
  })
  mixin[isMixin] = true
  return mixin
}