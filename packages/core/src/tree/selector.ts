import { Node } from './node'
import { compare } from './util/compare'

/** Will be bound in ./util/compare.ts */
export interface Selector<T = any> extends Node<T> {
  compare(other: Node): 0 | 1 | -1 | undefined
}

// export type KeyList = Array<string | SelectorList>
// export type Keys = string | SelectorList | KeyList

const { isArray } = Array

export abstract class Selector<T = any> extends Node<T> {
  protected _value: string
  protected _keys: string | string[]
  protected _keyList: Set<string>

  get keys(): string | string[] {
    let keys = this._keys
    if (!keys) {
      this._keys = keys = this.valueOf()
    }
    return keys
  }

  /**
   * All simple (normalized) selectors.
   */
  set keys(v: string | string[]) {
    this._keys = v
  }

  /** Always a Set, for normalization */
  get keyList(): Set<string> {
    let keyList = this._keyList
    if (!keyList) {
      let keys = this.keys
      keyList = this._keyList = new Set(isArray(keys) ? keys : [keys])
    }
    return keyList
  }

  // get keySet(): Set<string> {
  //   let flatKeys = this._flatKeys
  //   if (!flatKeys) {
  //     let keys = this.keys
  //     flatKeys = this._flatKeys = Array.isArray(keys) ? keys : [keys]
  //   }
  // }

  /**
   * A Set representing all simple selectors.
   * This is calculated once and allows for quick
   * lookup for extend.
   */
  // get keySet(): Set<string> {
  //   let keySet = this._keySet
  //   if (!keySet) {
  //     let keys = this.keys
  //     let flatKeys = isArray(keys) ? (keys.flat() as string[]) : [keys]
  //     keySet = this._keySet = new Set(flatKeys)
  //   }
  //   return keySet
  // }

  /**
   * Normalize for comparison
   *
   * ...Okay, maybe what this structure should be is:
   * 1. A list (Set) of all simple selectors
   * 2. A map of those sets to positions
   *   e.g. ['.foo', '#bar', 'a'] => [1, 2, 0]
   *
   * An :is() within is just a list of lists like
   *   e.g. .one.two:is(.three, .four)
   *        compound([
   *          el('.one'),
   *          el('.two'),
   *          pseudo({
   *            name: 'is',
   *            value: sellist([
   *              el('.three'),
   *              el('.four')
   *            ])
   *          })
   *        ])
   *        -> ['.one', '.two', '.three', '.four'] (flat list)
   *        -> [
   *             [<Compound>, ['.one', '.two']],
   *           ]
   *         0, 1, [2, 3]]
   *
   * {
   *   // We can use this with extend sets to determine a disjoint
   *   keys: Set { .one, .two, .three, .four },
   *   selector: Selector
   * }
   *
   */
  /** The normalized value */
  valueOf(): string {
    return this.toTrimmedString()
  }

  compare(other: Node) {
    const thisValue = this.valueOf()
    const otherValue = other.valueOf()
    return compare(thisValue, otherValue)
  }
}