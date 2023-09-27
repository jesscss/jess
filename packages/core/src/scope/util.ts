import type { MixinEntry } from '.'
import isPlainObject from 'lodash-es/isPlainObject'
import { isNode } from '../tree/util'
import { cast } from '../tree/util/cast'
import type { Mixin } from '../tree/mixin'

/** Returns a plain JS function for calling a set of mixins */
export function getFunctionFromMixins(mixins: MixinEntry | MixinEntry[]) {
  let mixinArr = Array.isArray(mixins) ? mixins : [mixins]
  /** This will be called by a mixin call or by JavaScript */
  return function(...args: any[]) {
    const mixinLength = mixinArr.length
    let mixinCandidates: MixinEntry[] = []
    /**
     * Check named and positional arguments
     * against mixins, to see which ones match.
     * (Any mixin with a mis-match of
     * arguments fails.)
     */
    for (let i = 0; i < mixinLength; i++) {
      let mixin = mixinArr[i]
      let isPlainRule = isNode(mixin, 'Ruleset')
      let paramLength = isPlainRule ? 0 : (mixin as Mixin).params?.length ?? 0
      if (!paramLength) {
        /** Exit early if args were passed in, but no args are possible */
        if (args.length) {
          continue
        }
        mixinCandidates.push(mixin)
      } else {
        /** The mixin has parameters, so let's check args to see if there's a match */
        let params = (mixin as Mixin).params.clone()
        let positions = new Set(params.value.map((_, i) => i))
        /**
         * First argument can be a plain object with named params
         * e.g. { a: 1, b: 2 }
         */
        let argPos = 0
        if (isPlainObject(args[0])) {
          argPos = 1
          let namedMap = new Map(Object.entries(args[0]))
          /**
           * We iterate through params instead of args,
           * because we need to track the position
           * of each parameter.
           */
          for (let [i, param] of params) {
            if (isNode(param, 'VarDeclaration')) {
              let key = param.name as string
              let namedValue = namedMap.get(key)
              /** Replace our param value with the passed in named value */
              if (namedValue) {
                params.value[i] = cast(namedValue)
                /**
                 * Because we've assigned a named value, any
                 * positional arguments will be shifted.
                 */
                positions.delete(i)
                namedMap.delete(key)
              } else {
                /** This mixin is not a match */
                break
              }
            }
          }
          if (namedMap.size) {
            /** This mixin is not a match */
            continue
          }
        }
        /**
         * Now we can check remaining positional matches
         * against the remaining parameters.
         */
        if (args.length - argPos !== positions.size) {
          /** This mixin is not a match */
          continue
        }
        mixinCandidates.push(mixin)
        for (let i of positions) {
          params.value[i] = cast(args[argPos])
          argPos++
        }
      }
    }
  }
}