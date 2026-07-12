import {
  Node,
  type NodeVisitReturn,
  ABORT,
  REMOVE
} from '../tree/node';
// import { type isNode } from '../tree/util'
import type * as tree from '../tree';

// const { isArray } = Array

// type GuardedType<T> = typeof isNode extends (value: any, type: T) => value is infer U ? U : never

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export { ABORT, REMOVE };
export const SKIP: unique symbol = Symbol('SKIP');

type VisitorReturn = NodeVisitReturn | typeof SKIP;
export type VisitorContext = {
  visitDeeper?: boolean;
};

/**
 * Define all the optional methods one can define on a visitor that can be visited
 *
 * @todo - Write type tests for methods
 */
export interface Visitor {

  /** Optional methods called before entering / exiting the visitor */
  enter?(n?: tree.Node): void | typeof ABORT;
  /**
   * `exit()` gets passed the top-most visitor result,
   * in case we want to transform it on the way out.
   */
  exit?(val?: NodeVisitReturn): NodeVisitReturn;

  /** Visitor methods */
  atRule?(n: tree.AtRule, ctx?: VisitorContext): VisitorReturn;
  atRuleExit?(n: tree.AtRule, ctx?: VisitorContext): void;
  block?(n: tree.Block, ctx?: VisitorContext): VisitorReturn;
  blockExit?(n: tree.Block, ctx?: VisitorContext): void;
  bool?(n: tree.Bool, ctx?: VisitorContext): VisitorReturn;
  boolExit?(n: tree.Bool, ctx?: VisitorContext): void;
  ampersand?(n: tree.Ampersand, ctx?: VisitorContext): VisitorReturn;
  ampersandExit?(n: tree.Ampersand, ctx?: VisitorContext): void;
  anonymous?(n: tree.Anonymous, ctx?: VisitorContext): VisitorReturn;
  anonymousExit?(n: tree.Anonymous, ctx?: VisitorContext): void;
  general?(n: tree.General<string>, ctx?: VisitorContext): VisitorReturn;
  generalExit?(n: tree.General<string>, ctx?: VisitorContext): void;
  call?(n: tree.Call<tree.CallValue>, ctx?: VisitorContext): VisitorReturn;
  callExit?(n: tree.Call<tree.CallValue>, ctx?: VisitorContext): void;
  collection?(n: tree.Collection, ctx?: VisitorContext): VisitorReturn;
  collectionExit?(n: tree.Collection, ctx?: VisitorContext): void;
  color?(n: tree.Color, ctx?: VisitorContext): VisitorReturn;
  colorExit?(n: tree.Color, ctx?: VisitorContext): void;
  comment?(n: tree.Comment, ctx?: VisitorContext): VisitorReturn;
  commentExit?(n: tree.Comment, ctx?: VisitorContext): void;
  combinator?(n: tree.Combinator, ctx?: VisitorContext): VisitorReturn;
  combinatorExit?(n: tree.Combinator, ctx?: VisitorContext): void;
  condition?(n: tree.Condition, ctx?: VisitorContext): VisitorReturn;
  conditionExit?(n: tree.Condition, ctx?: VisitorContext): void;
  customDeclaration?(n: tree.CustomDeclaration, ctx?: VisitorContext): VisitorReturn;
  customDeclarationExit?(n: tree.CustomDeclaration, ctx?: VisitorContext): void;
  declaration?(n: tree.Declaration<tree.DeclarationOptions, tree.Name>): VisitorReturn;
  declarationExit?(n: tree.Declaration<tree.DeclarationOptions, tree.Name>, ctx?: VisitorContext): void;
  dimension?(n: tree.Dimension, ctx?: VisitorContext): VisitorReturn;
  dimensionExit?(n: tree.Dimension, ctx?: VisitorContext): void;
  expression?(n: tree.Expression, ctx?: VisitorContext): VisitorReturn;
  expressionExit?(n: tree.Expression, ctx?: VisitorContext): void;
  extend?(n: tree.Extend, ctx?: VisitorContext): VisitorReturn;
  extendExit?(n: tree.Extend, ctx?: VisitorContext): void;
  extendList?(n: tree.ExtendList, ctx?: VisitorContext): VisitorReturn;
  extendListExit?(n: tree.ExtendList, ctx?: VisitorContext): void;
  include?(n: tree.Include, ctx?: VisitorContext): VisitorReturn;
  includeExit?(n: tree.Include, ctx?: VisitorContext): void;
  list?(n: tree.List<Node>, ctx?: VisitorContext): VisitorReturn;
  listExit?(n: tree.List<Node>, ctx?: VisitorContext): void;
  mixin?(n: tree.Mixin, ctx?: VisitorContext): VisitorReturn;
  mixinExit?(n: tree.Mixin, ctx?: VisitorContext): void;
  negative?(n: tree.Negative, ctx?: VisitorContext): VisitorReturn;
  negativeExit?(n: tree.Negative, ctx?: VisitorContext): void;
  func?(n: tree.Func, ctx?: VisitorContext): VisitorReturn;
  funcExit?(n: tree.Func, ctx?: VisitorContext): void;
  functionValue?(n: tree.FunctionValue): VisitorReturn;
  functionValueExit?(n: tree.FunctionValue, ctx?: VisitorContext): void;
  nil?(n: tree.Nil, ctx?: VisitorContext): VisitorReturn;
  nilExit?(n: tree.Nil, ctx?: VisitorContext): void;
  operation?(n: tree.Operation, ctx?: VisitorContext): VisitorReturn;
  operationExit?(n: tree.Operation, ctx?: VisitorContext): void;
  paren?(n: tree.Paren, ctx?: VisitorContext): VisitorReturn;
  parenExit?(n: tree.Paren, ctx?: VisitorContext): void;
  queryCondition?(n: tree.QueryCondition, ctx?: VisitorContext): VisitorReturn;
  queryConditionExit?(n: tree.QueryCondition, ctx?: VisitorContext): void;
  quoted?(n: tree.Quoted, ctx?: VisitorContext): VisitorReturn;
  quotedExit?(n: tree.Quoted, ctx?: VisitorContext): void;
  ruleset?(n: tree.Ruleset, ctx?: VisitorContext): VisitorReturn;
  rulesetExit?(n: tree.Ruleset, ctx?: VisitorContext): void;
  rules?(n: tree.Rules, ctx?: VisitorContext): VisitorReturn;
  rulesExit?(n: tree.Rules, ctx?: VisitorContext): void;
  root?(n: tree.Root, ctx?: VisitorContext): VisitorReturn;
  rootExit?(n: tree.Root, ctx?: VisitorContext): void;
  attributeSelector?(n: tree.AttributeSelector, ctx?: VisitorContext): VisitorReturn;
  attributeSelectorExit?(n: tree.AttributeSelector, ctx?: VisitorContext): void;
  basicSelector?(n: tree.BasicSelector, ctx?: VisitorContext): VisitorReturn;
  basicSelectorExit?(n: tree.BasicSelector, ctx?: VisitorContext): void;
  selectorList?(n: tree.SelectorList, ctx?: VisitorContext): VisitorReturn;
  selectorListExit?(n: tree.SelectorList, ctx?: VisitorContext): void;
  pseudoSelector?(n: tree.PseudoSelector, ctx?: VisitorContext): VisitorReturn;
  pseudoSelectorExit?(n: tree.PseudoSelector, ctx?: VisitorContext): void;
  compoundSelector?(n: tree.CompoundSelector, ctx?: VisitorContext): VisitorReturn;
  compoundSelectorExit?(n: tree.CompoundSelector, ctx?: VisitorContext): void;
  complexSelector?(n: tree.ComplexSelector, ctx?: VisitorContext): VisitorReturn;
  complexSelectorExit?(n: tree.ComplexSelector, ctx?: VisitorContext): void;
  sequence?(n: tree.Sequence<Node>, ctx?: VisitorContext): VisitorReturn;
  sequenceExit?(n: tree.Sequence<Node>, ctx?: VisitorContext): void;
  spaced?(n: tree.Spaced, ctx?: VisitorContext): VisitorReturn;
  spacedExit?(n: tree.Spaced, ctx?: VisitorContext): void;
  token?(n: tree.Token, ctx?: VisitorContext): VisitorReturn;
  tokenExit?(n: tree.Token, ctx?: VisitorContext): void;
  varDeclaration?(n: tree.VarDeclaration<tree.Name>, ctx?: VisitorContext): VisitorReturn;
  varDeclarationExit?(n: tree.VarDeclaration<tree.Name>, ctx?: VisitorContext): void;
  reference?(n: tree.Reference, ctx?: VisitorContext): VisitorReturn;
  referenceExit?(n: tree.Reference, ctx?: VisitorContext): void;
  lookup?(n: tree.Lookup, ctx?: VisitorContext): VisitorReturn;
  lookupExit?(n: tree.Lookup, ctx?: VisitorContext): void;
  import?(n: tree.Import, ctx?: VisitorContext): VisitorReturn;
  importExit?(n: tree.Import, ctx?: VisitorContext): void;
  interpolated?(n: tree.Interpolated, ctx?: VisitorContext): VisitorReturn;
  interpolatedExit?(n: tree.Interpolated, ctx?: VisitorContext): void;
  defaultGuard?(n: tree.DefaultGuard, ctx?: VisitorContext): VisitorReturn;
  defaultGuardExit?(n: tree.DefaultGuard, ctx?: VisitorContext): void;
  jsExpression?(n: tree.JsExpression, ctx?: VisitorContext): VisitorReturn;
  jsExpressionExit?(n: tree.JsExpression, ctx?: VisitorContext): void;
  rest?(n: tree.Rest, ctx?: VisitorContext): VisitorReturn;
  restExit?(n: tree.Rest, ctx?: VisitorContext): void;
}

export abstract class Visitor {
  private readonly _methodMap = new Map<string, ((n: Node, ctx?: VisitorContext) => VisitorReturn) | false>();
  /** Temporary state, set on first visit and later un-set when exiting */
  protected startNode: Node | undefined;

  getMethod(s: string) {
    let lower = this._methodMap.get(s);
    /**
     * if we previously looked for the method and it doesn't exist,
     * then explicitly set the map record to false.
     */
    if (!lower && lower !== false) {
      // @ts-expect-error - Its ok if it doesn't exist
      lower = this[lowerFirst(s)];
      this._methodMap.set(s, lower ?? false);
    }
    return lower;
  }

  protected _visit(n: Node, ctx?: VisitorContext): VisitorReturn {
    let fn = this.getMethod(n.type);
    if (fn) {
      return fn.call(this, n, ctx) ?? n;
    }
    return n;
  }

  visitExit(n: Node, ctx?: VisitorContext) {
    let fn = this.getMethod(`${n.type}Exit`);
    if (fn) {
      fn.call(this, n, ctx);
    }
  }

  /**
   * Visit will always return a Node
   */
  visit(n: Node): Node {
    this.startNode = n;
    const originalVisit = this.visit;
    /**
     * Bind to inner _visit, so that all inner calls will not call this current method again
     */
    this.visit = this._visit.bind(this) as typeof this.visit;
    let possibleAbort = this.enter?.(n);
    if (possibleAbort === ABORT) {
      return n;
    }
    let returnVal = this._visit(n);
    this.visit = originalVisit.bind(this);
    /** Apply any final transformations / decisions */
    returnVal = this.exit?.(returnVal) ?? returnVal;
    this.startNode = undefined;
    if (returnVal instanceof Node) {
      return returnVal;
    }
    return n;
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
  /** Visit children nodes before or after visiting the parent node */
  visitChildren: 'before' | 'after' = 'after';
  visitedNodes = new Set<Node>();

  constructor(
    public reverse?: boolean
  ) {
    super();
  }

  enter(n: tree.Node) {
    this.visitedNodes.clear();
  }

  _visit(n: Node, ctx: VisitorContext) {
    if (this.visitedNodes.has(n)) {
      return n;
    }
    this.visitedNodes.add(n);
    const { reverse } = this;
    if (this.visitChildren === 'before') {
      n.walkNodes(node => this._visit(node, ctx), true, reverse, true);
      const returnVal = super._visit(n, ctx);
      /** @node The exit function passes in the original node */
      this.visitExit(n, ctx);
      /** Don't visit new created nodes */
      if (returnVal instanceof Node) {
        this.visitedNodes.add(returnVal);
      }
      return returnVal;
    }
    let returnVal = super._visit(n, ctx);
    if (!returnVal || typeof returnVal === 'symbol') {
      return returnVal;
    }

    if (returnVal !== n) {
      /** Don't visit new created nodes */
      this.visitedNodes.add(returnVal);
    } else {
      n.walkNodes(node => this._visit(node, ctx), true, reverse, true);
    }

    this.visitExit(n, ctx);
    return returnVal;
  }
}
