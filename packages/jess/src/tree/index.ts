/**
 * @note
 * These nodes are actually taking the role of two ASTs,
 * because there are nodes that will be used to produce a module,
 * and that module will create AST nodes to create CSS.
 */

/** Base classes - keep these on top */
import { Node, FileInfo, LocationInfo } from './node'
import { Context } from '../context'
import { OutputCollector } from '../output'
/**
 * We bind this here to avoid circular dependencies
 * between Context and Node
 */
Node.prototype.toString = function() {
  const out = new OutputCollector
  this.toCSS(new Context, out)
  return out.toString()
}
export { Node, FileInfo, LocationInfo }

export * from './js-node'

/** @todo - remove nodes from tree index that we don't need to bundle for runtime? */
export * from './at-rule'
export * from './ampersand'
export * from './anonymous'
export * from './call'
export * from './color'
export * from './combinator'
export * from './declaration'
export * from './dimension'
export * from './element'
export * from './expression'
export * from './include'
export * from './js-collection'
export * from './js-ident'
export * from './js-import'
export * from './js-key-value'
export * from './js-expr'
export * from './let'
export * from './list'
export * from './mixin'
export * from './nil'
export * from './paren'
export * from './rule'
export * from './ruleset'
export * from './root'
export * from './selector'
export * from './spaced'
export * from './square'
export * from './ws'
