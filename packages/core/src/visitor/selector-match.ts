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

  /** Position is the order of */
  position = 0

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

export function findNeedleInHaystack(needle: Selector, haystack: Selector, partial = false) {
  /** No overlapping elements */
  if (needle.keySet.isDisjointFrom(haystack.keySet)) {
    return false
  }
  needleVisitor ??= new SelectorMatchVisitor()
  haystackVisitor ??= new SelectorMatchVisitor()

  haystackVisitor.start(haystack)
  needleVisitor.start(needle)
  let haystackComponents = haystackVisitor.components()
  let needleComponents = needleVisitor.components()

  let matchList = new NodeList(undefined, { disableTracking: true })
  let haystackPosition = haystackComponents.next()
  let needleNextSearch = needleComponents.next()
  let searching = true
  while (searching) {
    if (needleNextSearch.done || haystackPosition.done) {
      searching = false
      break
    }
    let needleComponent = needleNextSearch.value
    let haystackComponent = haystackPosition.value

    if (isNode(needleComponent, 'CompoundSelector')) {
      needleComponent
    }

    if (needleComponent.valueOf() === haystackComponent.valueOf()) {
      matchList.push(needleComponent)
      needleNextSearch = needleComponents.next()
    }
    haystackPosition = haystackComponents.next()
  }
  return matchList
}