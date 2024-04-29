/* eslint-disable @typescript-eslint/no-invalid-void-type */
import {
  Node,
  type NodeOptions,
  type NodeVisitFunction,
  type NodeVisitReturn,
  ABORT,
  REMOVE
} from '../tree/node'
// import { type isNode } from '../tree/util'
import type * as tree from '../tree'

// const { isArray } = Array

// type GuardedType<T> = typeof isNode extends (value: any, type: T) => value is infer U ? U : never

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
export { ABORT, REMOVE }
export const SKIP: unique symbol = Symbol('SKIP')

type VisitorReturn = NodeVisitReturn | typeof SKIP

/**
 * Define all the optional methods one can define on a visitor that can be visited
 *
 * @todo - Write type tests for methods
 */
export interface Visitor {

  /** Optional methods called before entering / exiting the visitor */
  enter?(n?: tree.Node): void | typeof ABORT
  /**
   * `exit()` gets passed the top-most visitor result,
   * in case we want to transform it on the way out.
   */
  exit?(val?: NodeVisitReturn): NodeVisitReturn

  /** Visitor methods */
  atRule?(n: tree.AtRule): VisitorReturn
  block?(n: tree.Block): VisitorReturn
  bool?(n: tree.Bool): VisitorReturn
  ampersand?(n: tree.Ampersand): VisitorReturn
  anonymous?(n: tree.Anonymous): VisitorReturn
  general?(n: tree.General<string>): VisitorReturn
  call?(n: tree.Call<tree.CallValue>): VisitorReturn
  collection?(n: tree.Collection): VisitorReturn
  color?(n: tree.Color): VisitorReturn
  comment?(n: tree.Comment): VisitorReturn
  combinator?(n: tree.Combinator): VisitorReturn
  condition?(n: tree.Condition): VisitorReturn
  customDeclaration?(n: tree.CustomDeclaration): VisitorReturn
  declaration?(n: tree.Declaration<tree.DeclarationOptions, tree.Name>): VisitorReturn
  dimension?(n: tree.Dimension): VisitorReturn
  expression?(n: tree.Expression): VisitorReturn
  extend?(n: tree.Extend): VisitorReturn
  extendList?(n: tree.ExtendList): VisitorReturn
  include?(n: tree.Include): VisitorReturn
  list?(n: tree.List<Node>): VisitorReturn
  mixin?(n: tree.Mixin): VisitorReturn
  negative?(n: tree.Negative): VisitorReturn
  func?(n: tree.Func): VisitorReturn
  functionValue?(n: tree.FunctionValue): VisitorReturn
  nil?(n: tree.Nil): VisitorReturn
  operation?(n: tree.Operation): VisitorReturn
  paren?(n: tree.Paren): VisitorReturn
  queryCondition?(n: tree.QueryCondition): VisitorReturn
  quoted?(n: tree.Quoted): VisitorReturn
  ruleset?(n: tree.Ruleset): VisitorReturn
  rules?(n: tree.Rules): VisitorReturn
  root?(n: tree.Root): VisitorReturn
  attributeSelector?(n: tree.AttributeSelector): VisitorReturn
  basicSelector?(n: tree.BasicSelector): VisitorReturn
  selectorList?(n: tree.SelectorList<tree.Selector<tree.SelectorValue>>): VisitorReturn
  pseudoSelector?(n: tree.PseudoSelector<tree.PseudoSelectorValue>): VisitorReturn
  compoundSelector?(n: tree.CompoundSelector): VisitorReturn
  complexSelector?(n: tree.ComplexSelector): VisitorReturn
  sequence?(n: tree.Sequence<Node>): VisitorReturn
  spaced?(n: tree.Spaced): VisitorReturn
  token?(n: tree.Token): VisitorReturn
  varDeclaration?(n: tree.VarDeclaration<tree.Name>): VisitorReturn
  reference?(n: tree.Reference): VisitorReturn
  lookup?(n: tree.Lookup): VisitorReturn
  import?(n: tree.Import): VisitorReturn
  interpolated?(n: tree.Interpolated<NodeOptions>): VisitorReturn
  defaultGuard?(n: tree.DefaultGuard): VisitorReturn
  jsExpression?(n: tree.JsExpression): VisitorReturn
  rest?(n: tree.Rest): VisitorReturn
}

export abstract class Visitor {
  private readonly _methodMap = new Map<string, NodeVisitFunction | false>()
  /** Temporary state, set on first visit and later un-set when exiting */
  protected startNode: Node | undefined

  getMethod(s: string) {
    let lower = this._methodMap.get(s)
    /**
     * if we previously looked for the method and it doesn't exist,
     * then explicitly set the map record to false.
     */
    if (!lower && lower !== false) {
      // @ts-expect-error - Its ok if it doesn't exist
      lower = this[lowerFirst(s)]
      this._methodMap.set(s, lower ?? false)
    }
    return lower
  }

  protected _visit(n: Node): VisitorReturn {
    let fn = this.getMethod(n.type)
    if (fn) {
      let returnVal = fn.call(this, n)
      /**
       * If we don't explicitly abort or remove,
       * preserve the node.
       */
      if (returnVal !== ABORT && returnVal !== REMOVE) {
        return n
      }
      return returnVal
    }
    return n
  }

  /**
   * Visit will always return a Node
   */
  visit(n: Node): Node {
    this.startNode = n
    const originalVisit = this.visit
    /**
     * Bind to inner _visit, so that all inner calls will not call this current method again
     */
    this.visit = this._visit.bind(this) as typeof this.visit
    let possibleAbort = this.enter?.(n)
    if (possibleAbort === ABORT) {
      return n
    }
    let returnVal = this._visit(n)
    this.visit = originalVisit.bind(this)
    /** Apply any final transformations / decisions */
    returnVal = this.exit?.(returnVal) ?? returnVal
    this.startNode = undefined
    if (returnVal instanceof Node) {
      return returnVal
    }
    return n
  }
}

/**
 * This is a specific visitor type that auto-walks the tree,
 * and optionally mutates children nodes.
 *
 * @note If you are extending this class, you DO NOT HAVE TO
 * manually visit children nodes. This class will do it for you.
 */
export abstract class TreeVisitor extends Visitor {
  visitChildren: 'pre' | 'post' = 'post'

  _visit(n: Node) {
    if (this.visitChildren === 'pre') {
      n.walkNodes(node => this._visit(node), true)
      return super._visit(n)
    }
    let returnVal = super._visit(n)
    if (!returnVal || typeof returnVal === 'symbol') {
      return returnVal
    }

    returnVal.walkNodes(node => this._visit(node), true)
    return returnVal
  }
}
