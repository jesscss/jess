import type { Selector } from '../tree/selector'
import { PseudoSelector } from '../tree/selector-pseudo'
import { SimpleSelector } from '../tree/selector-simple'
import { SelectorList } from '../tree/selector-list'
import { CompoundSelector } from '../tree/selector-compound'
import { ComplexSelector } from '../tree/selector-complex'

const { isArray } = Array

/** Extend scope, gets attached to the Root node */
export class ExtendScope {
  /**
   * Exact (normalized) extend match
   *   e.g.
   *     .five:extend(:is(.one, .two) > .three.four)
   *       Map {
   *         '[.one,.two]>.four.three' => [el('.five)]
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

    /**
     * Should end up with:
     * Map {
     *   '.b' => { complete: [], partial: [], continue: ['.c'] }
     *   '.b.c' => { complete: [], partial: [el('.a')], continue: [] }
     * }
     */
  }

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
    input.walkNodes((node) => {
      if (
        node instanceof ComplexSelector
        || node instanceof CompoundSelector
        || (node instanceof PseudoSelector && node.name === ':is')
      ) {
        parentQueue.unshift(node)
      } else if (node instanceof SimpleSelector) {
        const possibleMatch = complete.get(node.valueOf())
        if (possibleMatch) {

        }
        current = node
      }
    })
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