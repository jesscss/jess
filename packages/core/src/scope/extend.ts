import { ComplexSelector, type ComplexSelectorComponent } from '../tree/selector-complex'
import { CompoundSelector } from '../tree/selector-compound'
import { SimpleSelector } from '../tree/selector-simple'
import { PseudoSelector } from '../tree/selector-pseudo'
import type { Selector } from '../tree/selector'
import { SelectorList } from '../tree/selector-list'

const { isArray } = Array

/** Extend scope, gets attached to the Root node */
export class ExtendScope {
  /**
   * Exact (normalized) extend match
   *   e.g.
   *     .five:extend(:is(.one, .two) > .three.four)
   *       Map {
   *         '.one' => [el('.five)]
   *       }
   */
  _completeMap: Map<string, Selector[]> | undefined

  get completeMap() {
    let value = this._completeMap
    if (!value) {
      value = new Map<string, Selector[]>()
      Object.defineProperty(this, '_completeMap', { value })
    }
    return value
  }

  /**
   * This is a way to render faster, by doing all simple selector swaps during searches
   *
   * e.g.
   *     .a { color: blue; }
   *     .b:extend(.a all) {}
   *     .c:extend(.b all) {}
   *   Map {
   *     .a -> [el('.b')]
   *     .b -> [el('.c')]
   *   }
   *   when rendering '.a', get value, then lookup map, then continue with simple extends
   */
  _partialSimpleMap: Map<string, Selector[]> | undefined

  get partialSimpleMap() {
    let value = this._partialSimpleMap
    if (!value) {
      value = new Map<string, Selector[]>()
      Object.defineProperty(this, '_partialSimpleMap', { value })
    }
    return value
  }

  /**
   * Partial extend match. The key is the starting key
   * for matches.
   *   e.g.
   *     .five:extend(:is(.one, .two) > .three.four !all)
   *       Map {
   *         '.one' => [[sel(':is(.one, .two) > .three.four'), el('.five)]]
   *         '.two' => pointer to same array -> [[sel(':is(.one, .two) > .three.four'), el('.five)]]
   *       }
   */
  _partialMap: Map<string, Array<[Selector, Selector]>> | undefined

  get partialMap() {
    let value = this._partialMap
    if (!value) {
      value = new Map<string, Array<[Selector, Selector]>>()
      Object.defineProperty(this, '_partialMap', { value })
    }
    return value
  }

  /**
   * We store a set (copy) of the starting match of all
   * extended selectors so that we can quickly do
   * Set.prototype.isDisjointFrom for selectors to see if they can be extended.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set/isDisjointFrom
   */
  _selectorSet: Set<string> | undefined

  get selectorSet() {
    let value = this._selectorSet
    if (!value) {
      value = new Set<string>()
      Object.defineProperty(this, '_selectorSet', { value })
    }
    return value
  }

  /**
   *
   */
  register(
    /** Given .a:extend(.b.c) {} */
    target: Selector /* .b.c */,
    extendWith: Selector /* .a */,
    all?: boolean
  ) {
    const [first] = target.keyList
    if (!all) {
      const { completeMap, selectorSet } = this
      const value = target.valueOf()
      const existing = completeMap.get(value)
      if (existing) {
        existing.push(extendWith)
        return
      }
      completeMap.set(value, [extendWith])
      if (isArray(first)) {
        first.forEach(key => selectorSet.add(key))
      } else {
        selectorSet.add(first)
      }
      return
    }

    const registration: [Selector, Selector] = [target, extendWith]

    const register = (key: string) => {
      const existing = this.partialMap.get(key)
      if (existing) {
        existing.push(registration)
        return
      }
      this.partialMap.set(key, [registration])
      this.selectorSet.add(key)
    }

    if (isArray(first)) {
      first.forEach(register)
    } else {
      register(first)
    }
    // let targetKeyList = target.keyList

    // const iterateContinue = (next: string | SelectorList, continueArr: string[]): void => {
    //   if (next instanceof SelectorList) {
    //     return next.keyList.forEach(n => iterateContinue(n, continueArr))
    //   }
    //   continueArr.push(next)
    // }

    // const iteratePosition = (list: KeyList, pos: number, compositeKey: string, current?: KeyList[number]): void => {
    //   current ??= list[pos]!
    //   if (current instanceof SelectorList) {
    //     return current.value.forEach(n => iterateList(n, compositeKey))
    //   }
    //   compositeKey += current
    //   let mapEntry = this._extendMap.get(current)
    //   let map: ExtendMap = mapEntry ?? new Map()
    //   const next = list[++pos]!
    //   if (list === targetKeyList && !next) {
    //     if (all) {
    //       let partial = map.get('partial')
    //       if (partial) {
    //         partial.push(extendWith)
    //       } else {
    //         map.set('partial', [extendWith])
    //       }
    //     } else {
    //       let complete = map.get('complete')
    //       if (complete) {
    //         complete.push(extendWith)
    //       } else {
    //         map.set('complete', [extendWith])
    //       }
    //     }
    //     if (!mapEntry) {
    //       this._extendMap.set(compositeKey, map)
    //       this._extendSet.add(compositeKey)
    //     }
    //   } else {
    //     let continueArr = map.get('continue')
    //     if (!continueArr) {
    //       continueArr = []
    //       map.set('continue', continueArr)
    //     }
    //     if (next) {
    //       iterateContinue(next, continueArr)
    //     }
    //     if (!mapEntry) {
    //       this._extendMap.set(compositeKey, map)
    //     }
    //     if (next) {
    //       iteratePosition(list, pos, compositeKey, next)
    //     }
    //   }
    // }

    // const iterateList = (sel: Selector, compositeKey: string = '') => {
    //   iteratePosition(sel.keyList, 0, compositeKey)
    // }

    // iterateList(target)
  }

  /**
   * @todo - Redo with only storing starting selector, then finding matches
   */
  private _applyComplete(input: Selector): Selector | Selector[] {
    /**
     * Map {
     *   .a => [el(.b)]
     *   .c => [el(.a)]
     * }
     */
    let match = this.completeMap.get(input.valueOf())

    if (match) {
      /**
       * Make sure that we've already extended selectors that
       * we'll be extending with.
       */
      for (const [i, item] of match.entries()) {
        if (!item.extended) {
          const newItem = item.copy()
          newItem.extended = true
          match[i] = this.getExtendedSelector(newItem)
        }
      }
      return [...match]
    }

    return input
  }

  /**
   * Okay, selector has a possible match
   * @see https://gist.github.com/matthew-dean/cb9173dcdd35ee88c4173bf9f2ca32da?fbclid=IwAR1RwYZs0PUdRaKEAoetsXGSTEHnX7sINhhkcnEPi0SuvHqVJq9OBsyodfo
   */
  private _applyPartial(input: Selector): Selector | Selector[] {
    const { _partialMap, _partialSimpleMap } = this
    const keySet = input.keySet

    /**
     * Given:
     *   1. input is .a.b.c.d
     *   2. partialMap has
     *      Map {
     *        .a => [[.a.b.c, .h]] -- h:extends(.a.b.c)
     *      }
     */
    const longMatchGroups: Array<[Selector, Selector]> = []
    const shortMatchGroups: Selector[] = []

    for (const key of keySet) {
      const longGroups = _partialMap?.get(key)
      const shortGroups = _partialSimpleMap?.get(key)

      /**
       * Get each set of groups by key (simple selector),
       * and assemble groups where the target has all the keys
       * of the input.
       */
      longGroups?.forEach(group => {
        if (!longMatchGroups.includes(group) && group[0].keySet.isSubsetOf(keySet)) {
          longMatchGroups.push(group)
        }
      })

      shortGroups?.forEach(group => {
        if (!shortMatchGroups.includes(group)) {
          shortMatchGroups.push(group)
        }
      })
    }
    /**
     * Starting selector (key) matches some part of
     * the input selector, so let's search the whole
     * input for matches.
     */
    if (matchGroups.length) {
      /**
       * Now, for each match group, we need to match the input
       * against targets. Input needs to have _all_ parts of the
       * target in order to be extended, except in the case where
       * a target is an :is() selector with a selector list inside,
       * as an selector list implies "OR", so the input only needs
       * to match one of the possible selector paths.
       *
       * We do this with each match group.
       */
      for (const [target, extendWith] of matchGroups) {
        /**
         * Now let's iterate through the input and find and extend matches.
         * As we traverse the input, we dynamically build a cloned selector
         * in preparation for extending.
         */
        if (input instanceof SimpleSelector) {
          // this is easy
          if (input.valueOf() === target.valueOf()) {
            return extendWith
          }
        }
      }
    }
    return input
  }

  /** Get a selector, considering the extend map */
  getExtendedSelector(input: Selector | SelectorList): Selector | SelectorList {
    const { selectorSet } = this

    if (selectorSet.size === 0 || input.keySet.isDisjointFrom(selectorSet)) {
      /**
       * Either:
       *   a) no extends were registered or
       *   b) the selector contains no simple selectors or starts of simple
       *      selectors that have been extended, so return as-is
       */
      return input
    }

    /** We should do partials first */

    /** Then do completes */
    if (this._completeMap && this._completeMap.size !== 0) {
      return input
    }

    if (input instanceof SelectorList) {
      const outerList = input.value as Selector[]
      const inputLength = outerList.length
      for (let i = 0; i < inputLength; i++) {
        let newList = this._applyComplete(outerList[i]!)
        /** An array indicates matches */
        if (isArray(newList)) {
          outerList.push(...newList)
        }
      }
      return input
    } else {
      let newList = this._applyComplete(input)
      if (!isArray(newList)) {
        return newList
      }
      return new SelectorList([input, ...newList]).inherit(input)
    }
  }
}