import type {
  AtRule,
  Call,
  Color,
  Comment,
  Condition,
  Declaration,
  Dimension,
  Extend,
  Expression,
  List,
  Mixin,
  Negative,
  Node,
  Operation,
  Paren,
  Quoted,
  Reference,
  Ruleset,
  Sequence,
  StyleImport,
  Url,
  VarDeclaration
} from '@jesscss/core';
import type { LessAdapterBase } from './transform/less-adapter.js';

export interface LessAdapterNode<TJess extends Node = Node> extends LessAdapterBase<TJess> {
  type: string;
  typeIndex: number | undefined;
  accept(visitor: unknown): TJess | unknown;
}

export interface LessRuleset extends LessAdapterNode<Ruleset> {
  type: 'Ruleset';
  selectors: LessNode[];
  rules: LessNode[];
}

export interface LessSelector extends LessAdapterNode<Node> {
  type: 'Selector';
  elements: LessElement[];
  length: number;
}

export interface RawLessSelector {
  type: 'Selector';
  typeIndex: number | undefined;
  elements: LessNode[];
  length: number;
  accept(visitor: unknown): unknown;
}

export interface LessElement extends LessAdapterNode<Node> {
  type: 'Element';
  combinator: LessCombinator | RawLessCombinator;
  value: unknown;
  isVariable: boolean;
}

export interface RawLessElement {
  type: 'Element';
  typeIndex: number | undefined;
  combinator: LessCombinator | RawLessCombinator;
  value: unknown;
  isVariable: boolean;
  accept(visitor: unknown): unknown;
}

export interface LessCombinator extends LessAdapterNode<Node> {
  type: 'Combinator';
  value: string;
  emptyOrWhitespace: boolean;
}

export interface RawLessCombinator {
  type: 'Combinator';
  typeIndex: number | undefined;
  value: string;
  emptyOrWhitespace: boolean;
  accept(visitor: unknown): unknown;
}

export interface LessDeclaration extends LessAdapterNode<Declaration> {
  type: 'Declaration';
  name: unknown;
  value: LessNode | unknown;
  important: unknown;
  variable: boolean;
  merge: boolean;
}

export interface LessVariable extends LessAdapterNode<Reference | VarDeclaration> {
  type: 'Variable';
  name: string;
}

export interface LessProperty extends LessAdapterNode<Reference> {
  type: 'Property';
  name: string;
}

export interface LessVariableCall extends LessAdapterNode<Reference> {
  type: 'VariableCall';
  name: string;
  value?: unknown;
}

export interface LessMixinDefinition extends LessAdapterNode<Mixin> {
  type: 'Mixin';
  name?: unknown;
  params?: unknown;
  rules: LessNode[];
  condition?: unknown;
}

export interface LessMixinCall extends LessAdapterNode<Call> {
  type: 'Call';
  name: unknown;
  args: LessNode[];
  index?: number;
}

export interface LessDimension extends LessAdapterNode<Dimension> {
  type: 'Dimension' | 'Num';
  value: number;
  unit?: string;
}

export interface LessColor extends LessAdapterNode<Color> {
  type: 'Color';
}

export interface LessOperation extends LessAdapterNode<Operation> {
  type: 'Operation';
  op: string;
  operands: LessNode[];
}

export interface LessExpression extends LessAdapterNode<Expression | Sequence | List> {
  type: 'Expression' | 'Value';
  value: LessNode[];
  length?: number;
}

export interface LessQuoted extends LessAdapterNode<Quoted> {
  type: 'Quoted';
  value: string;
  quote: string;
  escaped: boolean;
}

export interface LessURL extends LessAdapterNode<Url> {
  type: 'Url';
  value: LessNode | unknown;
}

export interface LessComment extends LessAdapterNode<Comment> {
  type: 'Comment';
}

export interface LessAtRule extends LessAdapterNode<AtRule> {
  type: 'AtRule' | 'Directive';
  name: unknown;
  value?: LessNode | unknown;
  rules: LessNode[];
}

export interface LessImport extends LessAdapterNode<StyleImport> {
  type: 'Import';
  path: LessNode | unknown;
  options: Record<string, unknown>;
  currentFileInfo: unknown;
  index?: number;
}

export interface LessExtend extends LessAdapterNode<Extend> {
  type: 'Extend';
  selector: LessSelector | unknown;
  option: 'exact' | 'all';
  index?: number;
  currentFileInfo: unknown;
}

export interface LessCondition extends LessAdapterNode<Condition> {
  type: 'Condition';
  op: string;
  lvalue: LessNode | unknown;
  rvalue: LessNode | unknown;
  negate: boolean;
}

export interface LessParen extends LessAdapterNode<Paren> {
  type: 'Paren';
  value: LessNode | unknown;
}

export interface LessNegative extends LessAdapterNode<Negative> {
  type: 'Negative';
  value: LessNode | unknown;
}

export type LessValue = LessExpression;
export type LessAssignment = LessDeclaration;

export type LessNode =
  | LessRuleset
  | LessSelector
  | RawLessSelector
  | LessElement
  | RawLessElement
  | LessCombinator
  | RawLessCombinator
  | LessDeclaration
  | LessVariable
  | LessProperty
  | LessVariableCall
  | LessMixinDefinition
  | LessMixinCall
  | LessDimension
  | LessColor
  | LessOperation
  | LessExpression
  | LessQuoted
  | LessURL
  | LessComment
  | LessAtRule
  | LessImport
  | LessExtend
  | LessCondition
  | LessParen
  | LessNegative
  | LessAdapterNode;

/**
 * @deprecated Less.js Visitor API - This is a compatibility type for Less.js visitors.
 * Use Jess's native Visitor interface instead when possible.
 */
export type LessVisitor = any;
