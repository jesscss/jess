import type { Node } from '../tree'

export class Visitor {
  visit<T extends Node = Node>(n: T): T {
    const func = this[n.type]
    if (func) {
      return func.call(this, n)
    }
    return n
  }
}