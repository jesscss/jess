import { isNode } from '.'
import { cast } from './cast'
import { Selector } from '../selector'
import { Tuple, type tuple } from '@bloomberg/record-tuple-polyfill'
import { type Combinator } from '../combinator'
import { type Node } from '../node'
import isSupersetOf from 'set.prototype.issupersetof'

export function compare(a: any, b: any) {
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) {
      return 0
    }
    return a > b ? 1 : -1
  }
  let aNode = isNode(a) ? a : cast(a)
  let bNode = isNode(b) ? b : cast(b)
  return aNode.compare(bNode)
}

export function compareNodeArray(a: any[], b: any[]): 0 | 1 | -1 | undefined {
  let output: 0 | 1 | -1 | undefined

  if (a.length !== b.length) {
    return undefined
  }

  /**
   * All values must be equal, or less than, or greater than.
   * Anything else is undefined.
   */
  for (let i = 0; i < a.length; i++) {
    let result = compare(a[i]!, b[i]!)
    if (result === undefined) {
      return undefined
    }
    if (output === undefined) {
      output = result
    } else if (result !== output) {
      return undefined
    }
  }
  return output
}

/**
 * Given:
 * A. a b, a c {}
 * B. a :is(b, c) {}
 *
 * Test for exhaustiveness of combinations. i.e.
 *   1. First, we test if element 'a' from A is within B. If not, exit.
 *      (During eval, should we build a map of all simple selectors?)
 *   2. We collect all complex selectors from each selector list,
 *      including within :is() (but not :where(), which is matched on its own)
 *      Note, we don't want to create a new list of cloned selectors,
 *      but instead a "linked list" (or tuple?) of all complex selector combinations.
 *   3. Starting with A, test each complex selector (linked list) against each
 *      complex selector (linked list) in B. If a match is found, remove it from
 *      the list of linked lists.
 *   4. If all linked lists are exhausted, the selectors are equal.
 */
export function compareSelectors(a: Selector, b: Selector): 0 | 1 | -1 | undefined {
  const complexSelector: Array<Selector | Combinator> = []
  const normalizedSelectorMap = new Map<Selector, tuple<Selector | Combinator>>()

  const AlinkedLists = new Set<tuple<Selector | Combinator>>(getLinkedLists(a))
  const BlinkedLists = new Set<tuple<Selector | Combinator>>(getLinkedLists(b))

  if (AlinkedLists.size === BlinkedLists.size && isSupersetOf(AlinkedLists, BlinkedLists)) {
    return 0
  }

  return undefined
}

function getLinkedLists(selector: Selector) {

}

Selector.prototype.compare = function(other: Node) {
  if (other instanceof Selector) {
    return compareSelectors(this, other)
  }
  return undefined
}