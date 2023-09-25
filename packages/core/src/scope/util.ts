import type { MixinEntry } from '.'
import isPlainObject from 'lodash-es/isPlainObject'
import { isNode } from '../tree/util'
import { cast } from '../tree/util/cast'
import type { MixinBody } from '../tree/mixin-body'

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
     *
     * Possibly use pattern matcher?
     * @see https://github.com/shuckster/match-iz/wiki/Core-Pattern-helpers#combinators
     */
    for (let i = 0; i < mixinLength; i++) {
      let mixin = mixinArr[i]
      let isPlainRule = isNode(mixin, 'Ruleset')
      let paramLength = isPlainRule ? 0 : (mixin as MixinBody).params?.size ?? 0
      if (!paramLength) {
        /** Exit early if args were passed in, but no args are possible */
        if (args.length) {
          continue
        }
        mixinCandidates.push(mixin)
      } else {
        /** The mixin has parameters, so let's check args to see if there's a match */
        let params = (mixin as MixinBody).params!
        let paramEntries = Array.from(params)
        let skipPos: number[] = []
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
          for (let i = 0; i < paramEntries.length; i++) {
            let [key] = paramEntries[i]
            if (typeof key === 'string') {
              let namedValue = namedMap.get(key)
              /** Replace our param value with the passed in named value */
              if (namedValue) {
                paramEntries[i] = [key, cast(namedValue)]
                /**
                     * Because we've assigned a named value, any
                     * positional arguments will be shifted.
                     */
                skipPos.push(i)
                namedMap.delete(key)
              }
            }
          }
          if (namedMap.size) {
            /** This mixin is not a match */
            continue
          }
        }
        /** Now we can go through positional matches */
        for (let i = 0; i < paramEntries.length; i++) {
          if (skipPos.includes(i)) {
            continue
          }
          paramEntries[i][1] = cast(args[argPos])
          argPos++
        }
      }
    }
  }
}