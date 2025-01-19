import { Visitor } from '.'
import { type CompoundSelector } from '../tree'
import { SimpleSelector } from '../tree/selector-simple'
import { NodeList, Node } from '../tree/node'
import { type Selector } from '../tree/selector'
import { Stack } from 'data-structure-typed'
import { isNode } from '../tree/util'

export class SelectorMatchVisitor extends Visitor {
  private _compoundParent: Stack<CompoundSelector> | undefined
  get compoundParent(): Stack<CompoundSelector> {
    return (this._compoundParent ??= new Stack())
  }

  private _iterator!: Generator<Node>

  visit(n: Node) {
    let fn = this.getMethod(n.type)
    if (fn) {
      let result = fn.call(this, n)
      if (result instanceof Node) {
        return result
      }
    }
    return n
  }

  start(n: Selector) {
    if (!n.isSelector) {
      return false
    }
    this._iterator = n.nodes(true)
    return true
  }

  /** Matchable components */
  * components() {
    let result: IteratorResult<Node>
    while (!((result = this._iterator.next())?.done)) {
      let node = this.visit(result.value)
      if (node instanceof SimpleSelector || isNode(node, 'Combinator')) {
        yield node
      }
    }
  }

  compoundSelector(n: CompoundSelector) {
    this.compoundParent.push(n)
  }

  compoundSelectorExit(n: CompoundSelector): void {
    this.compoundParent.pop()
  }
}

let needleVisitor: SelectorMatchVisitor
let haystackVisitor: SelectorMatchVisitor

// export function findNeedleInHaystack(needle: Selector, haystack: Selector, partial = false): Selector[] | undefined {
//   needleVisitor ??= new SelectorMatchVisitor()
//   haystackVisitor ??= new SelectorMatchVisitor()

//   let matchList = new NodeList(undefined, { disableTracking: true })
//   let haystackResult = haystackIterator.next()
//   let needleResult = needleIterator.next()
//   while ()
//   return haystack.visit(needleVisitor, needle)
// }