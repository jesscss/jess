import { Node } from './node'
import { type tuple } from '@bloomberg/record-tuple-polyfill'

/** Will be bound in ./util/compare.ts */
export interface Selector<T = any> extends Node<T> {
  compare(other: Node): 0 | 1 | -1 | undefined
}

export abstract class Selector<T = any> extends Node<T> {
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
   *             [0, [0, 1]],
   *           ]
   *         0, 1, [2, 3]]
   *
   * {
   *   // We can use this with extend sets to determine a disjoint
   *   keys: Set { .one, .two, .three, .four },
   *   map: Map { [0, 0], [1, 1], 2, 3] }
   * }
   *
   */
  toNormalPrimitive(): string | tuple {
    return this.toTrimmedString()
  }
}