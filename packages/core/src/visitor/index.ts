import {
  type Node,
  type NodeVisitReturn,
  ABORT,
  REMOVE
} from '../tree/node.js';
// import { type isNode } from '../tree/util'
import type * as tree from '../tree/index.js';

// const { isArray } = Array

// type GuardedType<T> = typeof isNode extends (value: any, type: T) => value is infer U ? U : never

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
  any?(n: tree.Any, ctx?: VisitorContext): VisitorReturn;
  anyExit?(n: tree.Any, ctx?: VisitorContext): void;
  anonymous?(n: tree.Anonymous, ctx?: VisitorContext): VisitorReturn;
  anonymousExit?(n: tree.Anonymous, ctx?: VisitorContext): void;
  call?(n: tree.Call, ctx?: VisitorContext): VisitorReturn;
  callExit?(n: tree.Call, ctx?: VisitorContext): void;
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
  declaration?(n: tree.Declaration): VisitorReturn;
  declarationExit?(n: tree.Declaration, ctx?: VisitorContext): void;
  dimension?(n: tree.Dimension, ctx?: VisitorContext): VisitorReturn;
  dimensionExit?(n: tree.Dimension, ctx?: VisitorContext): void;
  expression?(n: tree.Expression, ctx?: VisitorContext): VisitorReturn;
  expressionExit?(n: tree.Expression, ctx?: VisitorContext): void;
  extend?(n: tree.Extend, ctx?: VisitorContext): VisitorReturn;
  extendExit?(n: tree.Extend, ctx?: VisitorContext): void;
  list?(n: tree.List<Node>, ctx?: VisitorContext): VisitorReturn;
  listExit?(n: tree.List<Node>, ctx?: VisitorContext): void;
  mixin?(n: tree.Mixin, ctx?: VisitorContext): VisitorReturn;
  mixinExit?(n: tree.Mixin, ctx?: VisitorContext): void;
  negative?(n: tree.Negative, ctx?: VisitorContext): VisitorReturn;
  negativeExit?(n: tree.Negative, ctx?: VisitorContext): void;
  func?(n: tree.Func, ctx?: VisitorContext): VisitorReturn;
  funcExit?(n: tree.Func, ctx?: VisitorContext): void;
  jsFunction?(n: tree.JsFunction): VisitorReturn;
  jsFunctionExit?(n: tree.JsFunction, ctx?: VisitorContext): void;
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
  sequence?(n: tree.Sequence, ctx?: VisitorContext): VisitorReturn;
  sequenceExit?(n: tree.Sequence, ctx?: VisitorContext): void;
  varDeclaration?(n: tree.VarDeclaration, ctx?: VisitorContext): VisitorReturn;
  varDeclarationExit?(n: tree.VarDeclaration, ctx?: VisitorContext): void;
  reference?(n: tree.Reference, ctx?: VisitorContext): VisitorReturn;
  referenceExit?(n: tree.Reference, ctx?: VisitorContext): void;
  styleImport?(n: tree.StyleImport, ctx?: VisitorContext): VisitorReturn;
  styleImportExit?(n: tree.StyleImport, ctx?: VisitorContext): void;
  interpolated?(n: tree.Interpolated, ctx?: VisitorContext): VisitorReturn;
  interpolatedExit?(n: tree.Interpolated, ctx?: VisitorContext): void;
  defaultGuard?(n: tree.DefaultGuard, ctx?: VisitorContext): VisitorReturn;
  defaultGuardExit?(n: tree.DefaultGuard, ctx?: VisitorContext): void;
  rest?(n: tree.Rest, ctx?: VisitorContext): VisitorReturn;
  restExit?(n: tree.Rest, ctx?: VisitorContext): void;
}
