import { isNode } from '.'
import { cast } from './cast'

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