import { Visitor } from '.'
import { type Node, ABORT } from '../tree/node'

export class SelectorMatchVisitor extends Visitor {
  enter(n: Node) {
    if (!n.isSelector) {
      return ABORT
    }
  }

  find(n: Node) {
    if (!n.isSelector) {
      return ABORT
    }
  }
}