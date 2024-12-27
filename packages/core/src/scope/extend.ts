import * as tree from '../tree'

import { SelectorList } from '../tree/selector-list'
import { Selector } from '../tree/selector'
import { TreeVisitor } from '../visitor'
import { PseudoSelector } from '../tree/selector-pseudo'

const { isArray } = Array

/**
 * Visits inputs, and only extends simple selectors
 */
class ExtendSimpleVisitor extends TreeVisitor {
  private readonly _lists: Array<{
    selectors: tree.Selector[]
    parent: tree.Node | undefined
  }> = []

  selectorMap = new Map<string, Container>()

  get _list() {
    return this._lists[0]!.selectors
  }

  get listParent() {
    return this._lists[0]!.parent
  }

  enter(startNode: tree.Selector | tree.SelectorList) {
    this._lists.unshift({
      selectors: startNode instanceof SelectorList ? startNode.value : [startNode],
      parent: undefined
    })
  }

  exit() {
    if (this.startNode instanceof SelectorList) {
      this._lists.length = 0
      /** We're good, this was modified in place */
      return
    }
    if (this._list.length) {
      const list = this._list
      this._lists.length = 0
      /**
       * We started out with a single selector, but now we have a list, so
       * let's return a selector list.
       */
      return new SelectorList(list).inherit(this.startNode!)
    }
  }

  private _getSimpleSelectors(sel: tree.SimpleSelector): tree.SimpleSelector | tree.SimpleSelector[] {
    const { selectorMap } = this
    const match = selectorMap.get(sel.valueOf())
    if (match?.containers.length) {
      return match.containers.flatMap(c => c.toSelectors())
    }
    return sel
  }

  private _simpleSelector(n: tree.SimpleSelector) {
    const selectors = this._getSimpleSelectors(n)
    if (isArray(selectors)) {
      if (!this.listParent || this.listParent === n) {
        /**
         * This simple selector consumes the entire selector
         * in part of a selector list, OR was the entire
         * selector to begin with, so we can add to
         * the outer list.
         */
        this._list.push(...selectors)
      } else {
        return new PseudoSelector([
          ['value', ':is'],
          ['arg', new SelectorList(selectors)]
        ])
      }
    }
  }

  selectorList(n: tree.SelectorList) {
    this._lists.unshift({
      selectors: n.value,
      parent: n
    })
  }

  selectorListExit() {
    this._lists.shift()
  }

  // complexSelector(n: tree.ComplexSelector) {
  //   this.listParent = n
  // }

  // compoundSelector(n: tree.CompoundSelector) {
  //   this.listParent = n
  // }

  basicSelector(n: tree.BasicSelector) {
    return this._simpleSelector(n)
  }

  attributeSelector(n: tree.AttributeSelector) {
    return this._simpleSelector(n)
  }

  pseudoSelector(n: tree.PseudoSelector) {
    if (n.arg && n.arg instanceof Selector) {
      this._lists.unshift({
        selectors: [],
        parent: n.arg
      })
      let returnVal = this.visit(n.arg)
      this._lists.shift()
      if (returnVal) {
        n.arg = returnVal
        return n
      }
    }
    return this._simpleSelector(n)
  }
}

/** An object class for tracking extended selectors */
export class Container {
  /** Tracks references to prevent recursion */
  static referencedContainers: Container[] = []

  constructor(
    public selector: tree.SimpleSelector,
    public containers: Container[] = []
  ) {}

  /**
   * @param input - Should already match the selector in value
   */
  toSelectors(): tree.SimpleSelector | tree.SimpleSelector[] {
    const { containers } = this
    const { referencedContainers } = Container

    const newContainers = containers.length && containers.filter(c => !referencedContainers.includes(c))
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    if (!newContainers || !newContainers.length) {
      if (referencedContainers.length) {
        Container.referencedContainers = []
      }
      return this.selector
    }
    referencedContainers.push(this)
    return [this.selector, ...containers.flatMap(c => c.toSelectors())]
  }
}

/** Extend scope, gets attached to the Root node */
export class ExtendScope {
  /**
   * Exact (normalized) extend match
   *   e.g.
   *     .five:extend(:is(.one, .two) > .three.four)
   *       Map {
   *         '.one' => [el('.five)]
   *       }
   * @todo - This needs to be re-done, because we need to
   * first extend partial selectors to determine complete
   * selectors.
   */
  _completeMap: Map<string, tree.Selector[]> | undefined

  get completeMap() {
    let value = this._completeMap
    if (!value) {
      value = new Map<string, tree.Selector[]>()
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
   *     .a -> { selector: el('.a'), continue: [[['>', '.q'], sel(['.x'])]], containers: [{ .b }] }
   *     .b -> { selector: el('.b'), containers: [{ .c }] }
   *     .c -> { selector: el('.c'), containers: [] }
   *   }
   *   Map {
   *     .a -> { selector: el('.a'), containers: [{ .b }] }
   *     .b -> { selector: el('.b'), containers: [{ .c }] }
   *     .c -> { selector: el('.c'), containers: [] }
   *   }
   *   when rendering '.a', render
   */
  _partialSimpleMap: Map<string, Container> | undefined
  extendSimpleVisitor: ExtendSimpleVisitor

  get partialSimpleMap() {
    let value = this._partialSimpleMap
    if (!value) {
      this.extendSimpleVisitor = new ExtendSimpleVisitor()
      value = this.extendSimpleVisitor.selectorMap
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
  _partialMap: Map<string, Array<[tree.Selector, tree.Selector]>> | undefined

  get partialMap() {
    let value = this._partialMap
    if (!value) {
      value = new Map<string, Array<[tree.Selector, tree.Selector]>>()
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
    target: tree.Selector /* .b.c */,
    extendWith: tree.Selector /* .a */,
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

    const registration: [tree.Selector, tree.Selector] = [target, extendWith]

    const register = (key: string) => {
      let get = this.partialSimpleMap.get(key) as Container
      if (!get) {
        get = new Container(target)
        // @ts-expect-error Fix later
        get.selector = target
        this.partialSimpleMap.set(key, get)
      }
      let extender = extendWith.valueOf()
      let extenderRecord = this.partialSimpleMap.get(extender)
      if (!extenderRecord) {
        extenderRecord = new Container()
        // @ts-expect-error Fix later
        extenderRecord.selector = extendWith
        this.partialSimpleMap.set(extender, extenderRecord)
      }
      if (!get.containers.includes(extenderRecord)) {
        get.containers.push(extenderRecord)
      }
      this.selectorSet.add(key)
    }

    // Partial maps
    // const register = (key: string) => {
    //   const existing = this.partialMap.get(key)
    //   if (existing) {
    //     existing.push(registration)
    //     return
    //   }
    //   this.partialMap.set(key, [registration])
    //   this.selectorSet.add(key)
    // }

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
  private _applyComplete(input: tree.Selector): tree.Selector | tree.Selector[] {
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
  private _applyPartial(input: tree.Selector): tree.Selector | tree.Selector[] {
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
    const longMatchGroups: Array<[tree.Selector, tree.Selector]> = []
    const shortMatchGroups: tree.Selector[] = []

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
    if (longMatchGroups.length) {
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
      for (const [target, extendWith] of longMatchGroups) {
        /**
         * Now let's iterate through the input and find and extend matches.
         * As we traverse the input, we dynamically build a cloned selector
         * in preparation for extending.
         */
        if (input instanceof tree.SimpleSelector) {
          // this is easy
          if (input.valueOf() === target.valueOf()) {
            return extendWith
          }
        }
      }
    }
    return input
  }

  private _applySimple(input: tree.Selector | SelectorList) {
    return this.extendSimpleVisitor.visit(input)
    // const list = input instanceof SelectorList ? input.value : [input]

    // for (const sel of list) {
    //   if (sel instanceof tree.SimpleSelector) {
    //     const selectors = this._getSimpleSelectors(sel)
    //     if (isArray(selectors)) {
    //       list.push(...selectors)
    //     }
    //   }
    //   let parent: tree.Node[] = [sel]
    //   sel.accept()
    //   sel.walkNodes(node => {
    //     if (node instanceof tree.SimpleSelector) {
    //       const selectors = this._getSimpleSelectors(node)
    //       if (isArray(selectors)) {
    //         list.push(...selectors)
    //       }
    //     } else {
    //       parent.unshift(node)
    //     }
    //   })
    // }
    // if (input instanceof SelectorList) {
    //   return input
    // }
  }

  /**
   * Get a selector, considering the extend map. When we render a selector,
   * we need to do the following:
   *   1. First, extend simple selectors, including nested selectors within
   *      pseudo selectors.
   *   2. Then, extend partial selector sequences, using the results from #1.
   *   3. Finally, extend complete selector sequences, using the results from #2.
   */
  getExtendedSelector(input: tree.Selector | SelectorList): tree.Selector | SelectorList {
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
    /** Extend simple selectors */
    input = this._applySimple(input)

    /** We should do partials first */
    // input = this._applyPartial(input)

    /** Then do completes */
    if (this._completeMap && this._completeMap.size !== 0) {
      return input
    }

    if (input instanceof SelectorList) {
      const outerList = input.value
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