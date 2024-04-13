import { Node } from './node'
import { compare } from './util/compare'

/** Will be bound in ./util/compare.ts */
export interface Selector<T = any> extends Node<T> {
  compare(other: Node): 0 | 1 | -1 | undefined
}

export abstract class Selector<T = any> extends Node<T> {
  protected _keys: Set<string> | string | undefined
  protected _keySet: Set<string>

  get keys(): Set<string> | string {
    let keys = this._keys
    if (!keys) {
      this._keys = keys = this.valueOf()
    }
    return keys
  }

  /** @todo - Assign while parsing simple selectors */
  set keys(v: Set<string> | string) {
    this._keys = v
  }

  /**
   * A Set representing all simple selectors.
   * This is calculated once and allows for quick
   * lookup for extend.
   */
  get keySet(): Set<string> {
    let keySet = this._keySet
    if (!keySet) {
      let keys = this.keys
      keySet = this._keySet = keys instanceof Set ? keys : new Set([keys])
    }
    return keySet
  }

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