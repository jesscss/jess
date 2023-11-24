/**
 * @note
 * These nodes are actually taking the role of two ASTs,
 * because there are nodes that will be used to produce a module,
 * and that module will create AST nodes to create CSS.
 *
 * @todo - rewrite the above, this is no longer true
 */

/** Base classes - keep these on top */
import { type LocationInfo } from './node'
import { Node } from './node'
import { type Operator } from './util/calculate'
import { Anonymous } from './anonymous'
import { TreeContext } from '../context'
// import { Context } from '../context'
// import { OutputCollector } from '../output'
/**
 * We bind these here to avoid circular dependencies
 * between Context and Node
 */
Node.prototype.operate = function(b: Node, op: Operator) {
  let aVal = this.toString()
  let bVal = b.toString()
  if (op === '+') {
    return new Anonymous(aVal + bVal).inherit(this)
  }
  throw new Error(`Cannot operate on ${this.type}`)
}

Object.defineProperty(Node.prototype, 'treeContext', {
  get() {
    let context = this._treeContext
    if (!context) {
      context = this._treeContext = new TreeContext()
    }
    return context
  }
})

export { Node, TreeContext, type LocationInfo }

export * from './at-rule'
export * from './block'
export * from './bool'
export * from './ampersand'
export * from './anonymous'
export * from './general'
export * from './call'
export * from './collection'
export * from './color'
export * from './comment'
export * from './combinator'
export * from './condition'
export * from './custom-declaration'
export * from './base-declaration'
export * from './declaration'
export * from './dimension'
export * from './expression'
export * from './extend'
export * from './extend-list'
export * from './general'
export * from './include'
export * from './list'
export * from './mixin'
export * from './negative'
export * from './function'
export * from './function-value'
export * from './nil'
export * from './operation'
export * from './paren'
export * from './query-condition'
export * from './quoted'
export * from './ruleset'
export * from './rules'
export * from './root'
export * from './selector-attr'
export * from './selector-basic'
export * from './selector-list'
export * from './selector-pseudo'
export * from './selector-sequence'
export * from './selector-simple'
export * from './sequence'
export * from './spaced'
export * from './token'
export * from './comment'
export * from './var-declaration'
export * from './reference'
export * from './lookup'
export * from './import'
export * from './interpolated'
export * from './default-guard'
export * from './js-expr'
export * from './rest'