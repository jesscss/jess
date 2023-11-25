import { isNode } from '.'
import { cast } from './cast'
import type { Node } from '../node'

export function compare(a: any, b: any) {
  let aNode = isNode(a) ? a : cast(a)
  let bNode = isNode(b) ? b : cast(b)
  return aNode.compare(bNode)
}

export function compareNodeArray(a: Node[], b: Node[]): 0 | 1 | -1 | undefined {
  let output: 0 | 1 | -1 | undefined

  if (a.length !== b.length) {
    return undefined
  }

  /**
   * All values must be equal, or less than, or greater than.
   * Anything else is undefined.
   */
  for (let i = 0; i < a.length; i++) {
    let result = a[i]!.compare(b[i]!)
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