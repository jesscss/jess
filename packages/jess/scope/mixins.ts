import { noMatch, isMixin, mixinArgs } from './symbols'
import { Scope } from '.'
import type { ScopeObj } from './types'

interface ParamType {
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
  func: (...params: any[]) => ScopeObj,
  definitionScope: ScopeObj,
  paramTypes: ParamType[] = Array(func.length),
  argTests: ArgTest[] = []
) => {
  const scope = Scope(definitionScope)
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
  type Mixin = ((this: ScopeObj, ...functionArgs: any[]) => ScopeObj | typeof noMatch) & {
    [isMixin]?: true
  }
  const mixin: Mixin = function(this: ScopeObj, ...functionArgs: any[]) {
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
    if (this?.[mixinArgs]) {
      const entries = Object.entries(this[mixinArgs])
      for (const entry of entries) {
        const key = entry[0]
        const index: number = parseInt(key)
        if (!isNaN(index)) {
          /** It's a positional arg */
          newArgs[index].value = entry[1]
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
      newArgs.find(val => val === undefined) ??
      /** One of the guards does not succeed */
      argTests.find(test => !test(newArgs))
    ) {
      /** One of the mixin's values is not defined, so it's not a match. */
      return noMatch
    }

    for (const arg of newArgs) {
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