/**
 * Canonical CSS AST grammar.
 *
 * Parseman reductions call core AST constructors directly. Once this grammar
 * reaches public CSS coverage, the package-stylesheet `parse()` API must run it and
 * return `Stylesheet`; explicit CST APIs remain for language-service use.
 */
import { balanced, choice, composeLeaf, expect, field, literal, many, noTrivia, node, not, oneOrMore, optional, parser, regex, rules, scanTo, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator, FieldMap } from 'parseman';
import { cssAstSyntax } from '@jesscss/internal-css-recognition/recognition';
import { opaqueAtRuleRecognition } from '@jesscss/internal-css-recognition/opaque-at-rule';
import { cssAstPseudoSyntax } from '@jesscss/internal-css-recognition/pseudo-consts';
import {
  any,
  atRuleBlock,
  atRuleStatement,
  color,
  comment,
  complexSelector,
  complexCanonical,
  compoundSelectorOf,
  decl,
  dimension,
  funcCall,
  generalEnclosed,
  interpolation,
  keyword,
  list,
  operation,
  opaqueAtRuleBlock,
  block,
  stylesheet,
  rule,
  selist,
  pseudoSelector,
  simpleSelector,
  spaced,
  url,
  quoted,
  withValueLayout
} from '@jesscss/core/ast';
import type {
  AtRuleBlock,
  AtRuleStatement,
  OpaqueAtRuleBlock,
  Color,
  Comment,
  ComplexSelector,
  CompoundSelector,
  Declaration,
  Dimension,
  FunctionCall,
  GeneralEnclosed,
  Interpolation,
  Keyword,
  Block,
  Quoted,
  Stylesheet,
  Rule,
  SelectorList,
  SimpleSelector,
  SimpleToken,
  Statement,
  ValueNode,
  ValueSlot
} from '@jesscss/core/ast';

/** Rules constructed in this local direct-AST reduction map. Shared syntax is fused separately. */
type CssAstLocalRules = {
  CssAstDocument: Combinator<Stylesheet>;
  CssAstComment: Combinator<Comment>;
  CssAstSelector: Combinator<SelectorList>;
  CssAstComplex: Combinator<ComplexSelector>;
  CssAstCompound: Combinator<CompoundSelector>;
  CssAstSimple: Combinator<SimpleSelector>;
  CssAstAttribute: Combinator<SimpleSelector>;
  CssAstPseudo: Combinator<SimpleToken>;
  CssAstPseudoArgument: Combinator<string>;
  CssAstOfTypePseudoArgument: Combinator<string>;
  CssAstLeadingDashPseudoArgument: Combinator<string>;
  CssAstTypedNthPseudoArgument: Combinator<string>;
  CssAstLeadingDashOfTypePseudoArgument: Combinator<string>;
  CssAstTypedOfTypePseudoArgument: Combinator<string>;
  CssAstLeadingDashRawPseudoArgument: Combinator<string>;
  CssAstNestingSelector: Combinator<SimpleSelector>;
  CssAstProperty: Combinator<string>;
  CssAstCustomProperty: Combinator<string>;
  CssAstCustomValue: Combinator<ValueNode>;
  CssAstKeyword: Combinator<Keyword>;
  CssAstColor: Combinator<Color>;
  CssAstDimension: Combinator<Dimension>;
  CssAstQuoted: Combinator<Quoted>;
  CssAstUrl: Combinator<ValueNode>;
  CssAstCall: Combinator<FunctionCall>;
  CssAstCalcCall: Combinator<FunctionCall>;
  CssAstCalcVarCall: Combinator<FunctionCall>;
  CssAstCalcVarFallbackPunctuation: Combinator<ValueNode>;
  CssAstCalcVarFallbackParen: Combinator<Block>;
  CssAstCalcVarFallbackBracket: Combinator<ValueNode>;
  CssAstCalcVarFallbackBrace: Combinator<ValueNode>;
  CssAstCalcVarFallbackCall: Combinator<FunctionCall>;
  CssAstCalcVarFallbackTerm: Combinator<ValueSlot>;
  CssAstCalcVarFallbackEmpty: Combinator<ValueNode>;
  CssAstCalcVarFallbackItem: Combinator<ValueSlot>;
  CssAstCalcVarFallback: Combinator<ValueSlot>;
  CssAstCalcParen: Combinator<Block>;
  CssAstDeclarationVarCall: Combinator<FunctionCall>;
  CssAstDeclarationCall: Combinator<FunctionCall>;
  CssAstDeclarationIdent: Combinator<ValueNode>;
  CssAstDeclarationParen: Combinator<Block>;
  CssAstDeclarationAny: Combinator<ValueNode>;
  CssAstDeclarationValueAtom: Combinator<ValueNode>;
  CssAstDeclarationValueTerm: Combinator<ValueSlot>;
  CssAstDeclarationExtendedValue: Combinator<ValueSlot>;
  CssAstDeclarationValue: Combinator<ValueSlot>;
  CssAstCalcValue: Combinator<ValueNode>;
  CssAstMathProduct: Combinator<ValueNode>;
  CssAstMathSum: Combinator<ValueNode>;
  CssAstValueAtom: Combinator<ValueNode>;
  CssAstValueTerm: Combinator<ValueSlot>;
  CssAstValue: Combinator<ValueSlot>;
  CssAstImportant: Combinator<boolean>;
  CssAstDeclaration: Combinator<Declaration>;
  CssAstImport: Combinator<AtRuleStatement>;
  CssAstImportUrl: Combinator<ValueNode>;
  CssAstImportUrlUnquoted: Combinator<ValueNode>;
  CssAstImportTailRaw: Combinator<ValueNode>;
  CssAstImportTailBody: Combinator<ValueNode>;
  CssAstImportTail: Combinator<ValueNode>;
  CssAstAtRuleStatement: Combinator<AtRuleStatement>;
  CssAstAtPrelude: Combinator<ValueNode | null>;
  CssAstStatementPrelude: Combinator<ValueNode | null>;
  CssAstOpaqueAtPrelude: Combinator<string | null>;
  CssAstOpaqueBody: Combinator<string>;
  CssAstOpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  CssAstQueryBareFeature: Combinator<ValueNode>;
  CssAstQueryRangeFeature: Combinator<ValueNode>;
  CssAstQueryFeature: Combinator<ValueNode>;
  CssAstQueryClause: Combinator<ValueNode>;
  CssAstQueryPrelude: Combinator<ValueNode>;
  /** Existing query-function payloads remain FunctionCall facts in media/container. */
  CssAstQueryFunction: Combinator<FunctionCall>;
  CssAstGeneralEnclosed: Combinator<GeneralEnclosed>;
  CssAstGeneralEnclosedContent: Combinator<Interpolation>;
  CssAstGeneralEnclosedGroup: Combinator<string>;
  CssAstGeneralEnclosedQuoted: Combinator<string>;
  CssAstSupportsInParens: Combinator<ValueNode>;
  CssAstSupportsCondition: Combinator<ValueNode>;
  CssAstSupportsPrelude: Combinator<ValueNode>;
  CssAstLayerBlock: Combinator<AtRuleBlock>;
  CssAstNestedLayerBlock: Combinator<AtRuleBlock>;
  CssAstConditionalBlock: Combinator<AtRuleBlock>;
  CssAstNestedConditionalBlock: Combinator<AtRuleBlock>;
  CssAstDescriptorBlock: Combinator<AtRuleBlock>;
  CssAstFontFeatureValueBlock: Combinator<AtRuleBlock>;
  CssAstFontFeatureValuesBlock: Combinator<AtRuleBlock>;
  CssAstScopeBlock: Combinator<AtRuleBlock>;
  CssAstStartingStyleBlock: Combinator<AtRuleBlock>;
  CssAstNestedStartingStyleBlock: Combinator<AtRuleBlock>;
  CssAstDocumentBlock: Combinator<AtRuleBlock>;
  CssAstMarginBox: Combinator<AtRuleBlock>;
  CssAstPageBlock: Combinator<AtRuleBlock>;
  CssAstKeyframeSelector: Combinator<SimpleSelector>;
  CssAstKeyframeBlock: Combinator<Rule>;
  CssAstKeyframes: Combinator<AtRuleBlock>;
  CssAstRuleset: Combinator<Rule>;
  whitespace: Combinator<unknown>;
};

function tokenText(child: unknown): string {
  if (typeof child === 'string') {
    return child;
  }
  if (typeof child === 'object' && child !== null && 'value' in child && typeof child.value === 'string') {
    return child.value;
  }
  throw new Error('CSS AST grammar lost a required token');
}

function authoredText(child: unknown): string {
  if (child === undefined || child === null) {
    return '';
  }
  return Array.isArray(child) ? child.map(authoredText).join('') : tokenText(child);
}

function authoredSeparators(fields: FieldMap | undefined): string[] {
  const capture = fields?.separator;
  if (capture === undefined) {
    return [];
  }
  const captures = Array.isArray(capture) ? capture : [capture];
  return captures.map(item => authoredText(item.value));
}

function withAuthoredSeparators<T extends object>(value: T, fields: FieldMap | undefined, expected: number): T {
  const separators = authoredSeparators(fields);
  return separators.length === expected ? withValueLayout(value, separators) : value;
}

function sourceText(child: unknown): string {
  if (typeof child === 'object' && child !== null && 'src' in child && typeof child.src === 'string') {
    return child.src;
  }
  return tokenText(child);
}

function isNodeType<T extends string>(value: unknown, type: T): value is { readonly type: T } {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === type;
}

function isSimple(value: unknown): value is SimpleSelector {
  return isNodeType(value, 'SimpleSelector');
}

function isSimpleToken(value: unknown): value is SimpleToken {
  return isNodeType(value, 'SimpleSelector') || isNodeType(value, 'PseudoSelector');
}

// Selector-function pseudos whose argument is retained as a structured
// `SelectorList` (P0). Gated on the pseudo NAME (lowercased, colon-stripped),
// never on colon count — `::slotted()` takes selector args but is absent here,
// so it stays opaque text. `crossable` (a narrower set) is decided in core.
const STRUCTURED_PSEUDOS = new Set(['is', 'where', 'not', 'has', 'matches']);

function isCompound(value: unknown): value is CompoundSelector {
  return isNodeType(value, 'CompoundSelector');
}

function isComplex(value: unknown): value is ComplexSelector {
  return isNodeType(value, 'ComplexSelector');
}

function isSelectorList(value: unknown): value is SelectorList {
  return isNodeType(value, 'SelectorList');
}

function isComment(value: unknown): value is Comment {
  return isNodeType(value, 'Comment');
}

function isKeyword(value: unknown): value is Keyword {
  return isNodeType(value, 'Keyword');
}

function isInterpolation(value: unknown): value is Interpolation {
  return isNodeType(value, 'Interpolation');
}

function isDeclaration(value: unknown): value is Declaration {
  return isNodeType(value, 'Declaration');
}

function isRule(value: unknown): value is Rule {
  return isNodeType(value, 'Rule');
}

function isAtRuleBlock(value: unknown): value is AtRuleBlock {
  return isNodeType(value, 'AtRuleBlock');
}

function isOpaqueAtRuleBlock(value: unknown): value is OpaqueAtRuleBlock {
  return isNodeType(value, 'OpaqueAtRuleBlock');
}

function isValue(value: unknown): value is ValueNode {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && (value.type === 'Keyword' || value.type === 'Color' || value.type === 'Dimension'
      || value.type === 'Quoted' || value.type === 'Url' || value.type === 'FunctionCall'
      || value.type === 'Block' || value.type === 'Operation' || value.type === 'SpacedValue'
      || value.type === 'List' || value.type === 'Any' || value.type === 'GeneralEnclosed');
}

function isValueSlotArray(value: unknown): value is readonly ValueSlot[] {
  return Array.isArray(value);
}

function valueSlot(value: ValueSlot): ValueSlot {
  if (isValueSlotArray(value)) {
    return value;
  }
  if (!isValue(value)) {
    return value;
  }
  if (value.type === 'SpacedValue') {
    return value.parts;
  }
  if (value.type === 'Block' && isValue(value.inner) && value.inner.type === 'SpacedValue') {
    return { ...value, inner: value.inner.parts };
  }
  return value;
}

function isValueSlotValue(value: unknown): value is ValueSlot {
  return isValueSlotArray(value) ? value.every(isValueSlotValue) : isValue(value);
}

function isTerminalText(value: unknown): value is string | { readonly value: string } {
  return typeof value === 'string'
    || (typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string');
}

function queryComparisonOperators(children: readonly unknown[]): string[] {
  return children
    .filter(isTerminalText)
    .map(tokenText)
    .filter(value => value === '<' || value === '<=' || value === '=' || value === '>=' || value === '>');
}

function chainedQueryComparison(left: ValueNode, children: readonly unknown[]): ValueNode {
  const operators = queryComparisonOperators(children);
  const values = valueChildren(children);
  if (operators.length === 0 || values.length === 0) {
    throw new Error('CSS AST query comparison requires an operator and value');
  }
  let result = operation(operators[0]!, left, values[0]!);
  for (let index = 1; index < operators.length; index++) {
    const right = values[index];
    if (right === undefined) {
      throw new Error('CSS AST query comparison lost its chained value');
    }
    result = operation(operators[index]!, result, right);
  }
  return result;
}

function isImportTarget(value: unknown): value is Quoted | { readonly type: 'Url'; readonly value: ValueNode } {
  return isNodeType(value, 'Quoted') || isNodeType(value, 'Url');
}

/** CSS `@import` is an ordinary statement at-rule. Its dedicated grammar only
 * validates the required target and retains its authored prelude; it does not
 * make import loading or resolution part of the AST. */
function importPrelude(target: Quoted | { readonly type: 'Url'; readonly value: ValueNode }, tail: ValueNode | null): ValueNode {
  const targetText = target.type === 'Url'
    ? `url(${sourceText(target.value)})`
    : target.src;
  const tailText = tail === null ? '' : sourceText(tail);
  return any(tailText === '' ? targetText : `${targetText} ${tailText}`);
}

function isRulesetStatement(value: unknown): value is Statement {
  return isDeclaration(value) || isDocumentStatement(value);
}

function isDocumentStatement(value: unknown): value is Statement {
  return isComment(value)
    || isRule(value)
    || isNodeType(value, 'AtRuleStatement')
    || isNodeType(value, 'AtRuleBlock')
    || isOpaqueAtRuleBlock(value);
}

function selectorComplexes(children: readonly unknown[]): ComplexSelector[] {
  const selectors = children.filter(isComplex);
  if (selectors.length === 0) {
    throw new Error('CssAstSelector requires a complex selector');
  }
  return selectors;
}

function selectorArgumentText(value: unknown): string {
  if (isSelectorList(value)) {
    return value.selectors.map(complexCanonical).join(',');
  }
  return tokenText(value);
}

function complexSegments(children: readonly unknown[]): Array<{ comb?: ' ' | '>' | '+' | '~' | '|' | '||'; compound: CompoundSelector }> {
  const segments: Array<{ comb?: ' ' | '>' | '+' | '~' | '|' | '||'; compound: CompoundSelector }> = [];
  let comb: ' ' | '>' | '+' | '~' | '|' | '||' = ' ';
  for (const child of children) {
    if (isCompound(child)) {
      segments.push(segments.length === 0 ? { compound: child } : { comb, compound: child });
      comb = ' ';
      continue;
    }
    const token = tokenText(child);
    if (token !== '>' && token !== '+' && token !== '~' && token !== '|' && token !== '||') {
      throw new Error('CssAstComplex has an invalid combinator');
    }
    comb = token;
  }
  if (segments.length === 0) {
    throw new Error('CssAstComplex requires a compound selector');
  }
  return segments;
}

function valueChildren(children: readonly unknown[]): ValueNode[] {
  const values = children.filter(isValue);
  if (values.length === 0) {
    throw new Error('CSS AST value grammar lost its value child');
  }
  return values;
}

/** First structured value child without allocating a filtered array. The
 * component-value reducers only need the leading value; the whole-array
 * `valueChildren` above stays for the math/query reducers that fold every
 * operand. */
function firstValue(children: readonly unknown[]): ValueNode {
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (isValue(child)) {
      return child;
    }
  }
  throw new Error('CSS AST value grammar lost its value child');
}

function optionalValue(value: unknown): ValueNode | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (isValue(value)) {
    return value;
  }
  throw new Error('CSS AST grammar produced an invalid optional value.');
}

/** Reduce authored declaration/value children without flattening recursive
 * ValueSlot arrays. Scalar grammar (calc/query operations) intentionally uses
 * valueChildren above; only component-value and call-argument productions use
 * this slot-aware reducer. */
function valueSlotChildren(children: readonly unknown[]): ValueSlot[] {
  const values = children.filter(isValueSlotValue);
  if (values.length === 0) {
    throw new Error('CSS AST value grammar lost its value child');
  }
  return values;
}

/** First slot-aware value child without allocating a filtered array. Mirrors
 * `firstValue` for the component-value/call-argument reducers that only need
 * the leading slot value. */
function firstValueSlot(children: readonly unknown[]): ValueSlot {
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (isValueSlotValue(child)) {
      return child;
    }
  }
  throw new Error('CSS AST value grammar lost its value child');
}

function foldOperation(children: readonly unknown[]): ValueNode {
  const first = children.find(isValue);
  if (first === undefined) {
    throw new Error('CSS AST math grammar requires an operand');
  }
  let result = first;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 2) {
    const operatorToken = children[index];
    const right = children[index + 1];
    if (operatorToken === undefined || !isValue(right)) {
      throw new Error('CSS AST math grammar lost an operator operand');
    }
    result = operation(tokenText(operatorToken).trim(), result, right);
  }
  return result;
}

function rulesetStatements(children: readonly unknown[]): Statement[] {
  return children.filter(isRulesetStatement);
}

function documentStatements(children: readonly unknown[]): Statement[] {
  const statements = children.filter(isDocumentStatement);
  if (statements.length !== children.length) {
    throw new Error('CssAstDocument has an unexpected child');
  }
  return statements;
}

function blockStatements(children: readonly unknown[]): Statement[] {
  return children.filter(isDocumentStatement);
}

function keyframeSelectorList(children: readonly unknown[]): SelectorList {
  const selectors = children.filter(isSimple).map(selector => complexSelector([{ compound: compoundSelectorOf([selector]) }]));
  if (selectors.length === 0) {
    throw new Error('CssAstKeyframeBlock requires a keyframe selector');
  }
  return selist(...selectors);
}

const whitespace = trivia(regex(/[ \t\n\r\f]+/));
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
// Value-slot boundaries are authored trivia, not semantic leaves. Capture the
// complete run so raw ValueSlot arrays can replay comments/newlines/indentation
// without growing a public `separators` field.
const cssValueTrivia = regex(/(?:[ \t\n\r\f]+|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);
// Public CSS treats block comments as interstitial trivia. Keep that context
// scoped to syntactic interiors: body/stylesheet entry still sees a standalone comment
// as a real Comment statement, and noTrivia lexical leaves still cannot glue
// `10/*x*/px` into one Dimension.
const interstitialTrivia = trivia(oneOrMore(choice(regex(/[ \t\n\r\f]+/), blockComment)));
const compoundTrivia = trivia(oneOrMore(blockComment));
const customPropertyName = regex(/--(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const calcWhitespace = regex(/[ \t\n\r\f]+/);
const calcProductOperator = regex(/[ \t\n\r\f]*[*/%][ \t\n\r\f]*/);
const calcSumOperator = regex(/[ \t\n\r\f]+[-+][ \t\n\r\f]+/);
const genericFunctionName = regex(/(?!(?:calc)(?=\())-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
// Only the Selectors An+B pseudo families give a leading numeric argument the
// special An+B meaning. Every other functional pseudo retains its raw argument.
// The two families diverge on the `of S` tail: `:nth-child`/`:nth-last-child`
// accept it (Selectors-4 §6.6.2), `:nth-of-type`/`:nth-last-of-type` do not.
// The `g`-free name recognitions live in the shared `cssAstPseudoSyntax`
// artifact and are referenced as `g.CssAstSyntaxNthChildName` /
// `g.CssAstSyntaxNthTypeName`.
// Public `anyValue` is intentionally permissive. The direct declaration
// extension needs only its punctuation-run branch: identifier-shaped values
// already lower through CssAstKeyword, and `#` stays reserved for the strict
// color production. Literal combinators keep this recognition macro-owned.
const declarationAnyCharacter = choice(
  literal('+'), literal('-'), literal('*'), literal('/'), literal('='),
  literal('<'), literal('>'), literal('|'), literal('~'), literal('^'),
  literal('?'), literal('$'), literal('@'), literal('%'), literal('&'),
  literal(':'), literal('.')
);
// declarationAnyCharacter minus `/`. Leading the punctuation-run arm with this
// (concrete 16-char first-set) instead of a `not('/*')` guard lets the compiler
// resolve CssAstDeclarationAny's first-set and first-char-gate it; the `/` cases
// keep their adjacent-comment guard in the dedicated slash arm.
const nonSlashDeclarationAnyCharacter = choice(
  literal('+'), literal('-'), literal('*'), literal('='),
  literal('<'), literal('>'), literal('|'), literal('~'), literal('^'),
  literal('?'), literal('$'), literal('@'), literal('%'), literal('&'),
  literal(':'), literal('.')
);
// `@import` is a CSS statement at-rule with a required target. Its dedicated
// grammar retains the prelude as grammar-owned bytes while it validates that
// target; loading and resolution are not parser or AST responsibilities.
const importAtKeyword = regex(/@import(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
// Grammar-local copy of CssAstSyntaxStatementAtRuleName. Leading the statement
// at-rule with this resolves the arm's `@` first-set so the compiler first-char
// gates it, instead of entering the statement node frame speculatively at every
// declaration and ruleset (the cross-composition reference reads as `any`).
const statementAtRuleName = regex(/@(?!(?:import)(?=[^-_a-zA-Z0-9\u0080-\uffff]|$))-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
// Grammar-local copies of the conditional at-keywords (identical to the shared
// CssAstSyntax*AtKeyword rules). Same first-set-resolution motive as above: a
// concrete `@media`/`@supports`/`@container` leading recognizer lets the compiler
// first-char-gate the conditional-block arms instead of entering them at every
// top-level statement and conditional-body item.
const supportsAtKeyword = regex(/@supports(?![-\w])/i);
const mediaAtKeyword = regex(/@media(?![-\w])/i);
const containerAtKeyword = regex(/@container(?![-\w])/i);
// Grammar-local copies of the remaining block at-keywords (identical to the
// shared CssAstSyntax* rules) so every at-rule block arm in the document/body
// choices leads with a concrete `@` first-set and the compiler first-char-gates
// the whole at-rule cluster. NOTE: these mirror packages/internal-css-recognition
// recognition.ts; genericAtRuleName's exclusion list in particular must stay in
// sync with the known at-rule names above.
const descriptorAtKeyword = regex(/@(?:font-face|counter-style|property|color-profile|font-palette-values|position-try|view-transition)(?![-\w])/i);
const scopeAtKeyword = regex(/@scope(?![-\w])/i);
const startingStyleAtKeyword = regex(/@starting-style(?![-\w])/i);
const layerAtKeyword = regex(/@layer(?![-\w])/i);
const pageAtKeyword = regex(/@page(?![-\w])/i);
const keyframesAtKeyword = regex(/@(?:-[a-z]+-)?keyframes(?![-\w])/i);
const documentAtKeyword = regex(/@(?:-moz-)?document(?![-\w])/i);
const fontFeatureValuesAtKeyword = regex(/@font-feature-values(?![-\w])/i);
const genericAtRuleName = regex(/@(?!(?:import|media|container|supports|starting-style|page|scope|font-face|counter-style|property|color-profile|font-palette-values|position-try|view-transition|-moz-document|document|font-feature-values|layer|(?:-[a-z]+-)?keyframes)(?=[^-\w]|$))-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
const urlName = regex(/url(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const importTailWhitespace = regex(/[ \t\n\r\f]+/);
const importTailText = regex(/[^()[\]"'\/; \t\n\r\f]+/);
const keyframePercent = regex(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)%/);
const keyframeEndpoint = regex(/(?:from|to)(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const combinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
// A relative selector (a `:has()` argument) may open with a combinator. Only the
// child/sibling combinators lead a relative selector; a leading `|`/`||` is
// namespace syntax, not a relative combinator.
const relativeSelectorCombinator = choice(literal('>'), literal('+'), literal('~'));
// A pseudo selector always opens with `:`/`::`. Spelling this leading colon as a
// grammar-local recognizer (identical to the shared CssAstSyntaxPseudoColon) lets
// the compiler resolve the pseudo arm's first-set to `:` and first-char-gate it in
// the compound-selector choice, instead of treating a cross-composition reference
// as an `any` first-set and speculatively entering the pseudo node at every simple
// selector.
const pseudoColon = regex(/::?/);
// Grammar-local copy of CssAstSyntaxSimple. As the fallback arm of the compound
// selector choice it must resolve a concrete first-set (`.`/`#`/`-`/letter/digit/
// `*`) so the compiler first-char-gates the whole compound choice; a cross-
// composition reference reads as `any`, entering the simple-selector node frame
// at every compound-selector boundary (`{`, `,`, whitespace).
const simpleSelectorToken = regex(/(?:[.#]?-?(?:[_a-zA-Z-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9-￿]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\d+(?:\.\d+)?%|\*)/);
// Grammar-local copies of the leading hex-color and number recognizers (identical
// to CssAstSyntaxHexColor / CssAstSyntaxNumber). Leading a component-value choice
// arm with a cross-composition `g.CssAstSyntax*` reference leaves that arm's
// first-set unresolved (`any`), so the compiler enters the Color / Dimension node
// frame speculatively at every value atom. A local leading recognizer resolves the
// arm's first-set (`#` / `[+-.0-9]`) so it is first-char-gated instead.
const hexColor = regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);
const numberValue = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
const customDoubleQuotedText = regex(/(?:[^"\\]|\\[\s\S])*/);
const customSingleQuotedText = regex(/(?:[^'\\]|\\[\s\S])*/);
const customEscape = regex(/\\[^\n\r\f]/);
const customDoubleQuoted = sequence(literal('"'), customDoubleQuotedText, literal('"'));
const customSingleQuoted = sequence(literal('\''), customSingleQuotedText, literal('\''));
// Balanced-group skips shared by the value, import-tail, calc var()-fallback,
// and at-prelude scanners. One combinator per delimiter, reused at every skip
// site instead of respelling the identical comment/escape/quote skip set.
const balancedParens = balanced('(', ')', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] });
const balancedBrackets = balanced('[', ']', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] });
const balancedBraces = balanced('{', '}', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] });
// A general-enclosed payload is grammar-owned arbitrary CSS component text. This
// raw-template chunk deliberately stops at every structural delimiter; quotes,
// comments, and balanced groups below own those bytes instead. It is a Parseman
// terminal, not a source scan or a post-parse text recovery step.
const generalEnclosedText = regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/'"()[\]{}]+)+/);
// A custom property is a CSS `<declaration-value>`: its opaque bytes must be
// captured as one value while its balanced groups, quoted strings, and comments
// cannot terminate the declaration. This is a Parseman grammar combinator, not
// a secondary scanner or a post-parse source slice.
const customValue = scanTo(choice(literal(';'), literal('}')), {
  skip: [
    blockComment,
    customEscape,
    customDoubleQuoted,
    customSingleQuoted,
    balancedParens,
    balancedBrackets,
    balancedBraces
  ]
});
const importTailGroup = sequence(
  literal('('),
  scanTo(literal(')'), {
    skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedParens]
  }),
  expect(literal(')'), ')')
);
const importTailSquareGroup = sequence(
  literal('['),
  scanTo(literal(']'), {
    skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedBrackets]
  }),
  expect(literal(']'), ']')
);
export const cssAstGrammar = composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, rules<CssAstLocalRules>({ trivia: whitespace }, (g) => {
  const pseudoRawDoubleQuoted = sequence(literal('"'), g.CssAstSyntaxDoubleQuotedText, literal('"'));
  const pseudoRawSingleQuoted = sequence(literal('\''), g.CssAstSyntaxSingleQuotedText, literal('\''));
  const pseudoRawArgument = scanTo(literal(')'), {
    skip: [
      balanced('(', ')', { skip: [pseudoRawDoubleQuoted, pseudoRawSingleQuoted] }),
      balanced('[', ']', { skip: [pseudoRawDoubleQuoted, pseudoRawSingleQuoted] }),
      pseudoRawDoubleQuoted,
      pseudoRawSingleQuoted,
      blockComment
    ]
  });
  const CssAstComment = node('CssAstComment', blockComment, children => comment(tokenText(children[0])));
  const CssAstSimple = node('CssAstSimple', simpleSelectorToken, children => simpleSelector(tokenText(children[0])));
  const CssAstAttribute = node<SimpleSelector>(
    'CssAstAttribute',
    sequence(
      literal('['), g.CssAstSyntaxKeyword,
      optional(sequence(g.CssAstSyntaxAttributeOperator, choice(g.CssAstQuoted, g.CssAstKeyword), optional(g.CssAstSyntaxAttributeModifier))),
      literal(']')
    ),
    children => simpleSelector(children.map(sourceText).join(''))
  );
  // A leading dash in a valid contiguous negative An+B argument must not be
  // greedily consumed as a selector token. The zero-width close check makes
  // this a complete argument recognition, so malformed `-n+` and generic raw
  // `-` arguments still reach the existing raw branch. Local whitespace-only
  // trivia keeps comments before `of` on that lossless raw branch.
  const CssAstLeadingDashPseudoArgument = node<string>(
    'CssAstLeadingDashPseudoArgument',
    parser({ trivia: whitespace }, sequence(
      noTrivia(sequence(literal('-'), g.CssAstSyntaxNth)),
      optional(sequence(optional(blockComment), g.CssAstSyntaxOfKeyword, g.CssAstSelector)),
      g.CssAstSyntaxPseudoCloseAhead
    )),
    (children) => {
      const nth = `-${tokenText(children[1])}`;
      const selector = children.find(isSelectorList);
      const comment = children.find(child => isTerminalText(child) && tokenText(child).startsWith('/*'));
      return selector === undefined ? nth : `${nth}${comment === undefined ? '' : tokenText(comment)} of ${selectorArgumentText(selector)}`;
    }
  );
  const CssAstLeadingDashRawPseudoArgument = node<string>(
    'CssAstLeadingDashRawPseudoArgument',
    // Preserve only dash-led raw forms that cannot begin a contiguous An+B
    // attempt. A `-` followed by `n`/digits belongs to the complete typed arm
    // above; if that arm cannot close, the public grammar rejects it rather
    // than accepting malformed An+B bytes as a generic pseudo argument.
    choice(
      sequence(literal('-'), regex(/(?=\))/)),
      noTrivia(sequence(literal('-'), regex(/[ \t\n\r\f]+/), pseudoRawArgument)),
      noTrivia(sequence(literal('-'), literal('-'), pseudoRawArgument))
    ),
    children => children.map(sourceText).join('')
  );
  // A non-dash-led An+B argument (`2n+1`, `n+3`, `n - 3`, `even`). Selectors-4
  // defines the `<An+B>` microsyntax with OPTIONAL whitespace around the `+`/`-`
  // sign — `2n + 1` and `n - 3` are as valid as `2n+1`
  // (https://www.w3.org/TR/selectors-4/#anb-microsyntax; the equivalent grammar
  // note is https://www.w3.org/TR/css-syntax-3/#the-anb-type). The shared `nth`
  // recognition already spans that whitespace; recognize the complete typed form
  // here so a bare-`n`-led argument (`n+3`) is not first claimed by the selector
  // arm below as a lone type selector `n` and then left unable to close. This
  // mirrors the negative `CssAstLeadingDashPseudoArgument` arm for the positive
  // and unsigned cases; the trailing `(?=\))` keeps malformed forms (`2n +`,
  // `2n+1x`) on their existing rejecting path.
  const CssAstTypedNthPseudoArgument = node<string>(
    'CssAstTypedNthPseudoArgument',
    parser({ trivia: whitespace }, sequence(
      g.CssAstSyntaxNth,
      optional(sequence(optional(blockComment), g.CssAstSyntaxOfKeyword, g.CssAstSelector)),
      g.CssAstSyntaxPseudoCloseAhead
    )),
    (children) => {
      const nth = tokenText(children[0]);
      const selector = children.find(isSelectorList);
      const comment = children.find(child => isTerminalText(child) && tokenText(child).startsWith('/*'));
      return selector === undefined ? nth : `${nth}${comment === undefined ? '' : tokenText(comment)} of ${selectorArgumentText(selector)}`;
    }
  );
  // `:nth-of-type`/`:nth-last-of-type` accept only a BARE `<An+B>` — Selectors-4
  // §6.6.2 does not define an `of S` tail for the type-index families. These arms
  // mirror the child arms above but omit the optional `of <selector>` clause, so
  // a `... of ...` argument no longer matches here and falls to the raw/reject
  // path (the CSS-aligned owner decision, §7.1).
  const CssAstLeadingDashOfTypePseudoArgument = node<string>(
    'CssAstLeadingDashOfTypePseudoArgument',
    parser({ trivia: whitespace }, sequence(
      noTrivia(sequence(literal('-'), g.CssAstSyntaxNth)),
      g.CssAstSyntaxPseudoCloseAhead
    )),
    children => `-${tokenText(children[1])}`
  );
  const CssAstTypedOfTypePseudoArgument = node<string>(
    'CssAstTypedOfTypePseudoArgument',
    parser({ trivia: whitespace }, sequence(
      g.CssAstSyntaxNth,
      g.CssAstSyntaxPseudoCloseAhead
    )),
    children => tokenText(children[0])
  );
  const CssAstPseudoArgument = node<string>(
    'CssAstPseudoArgument',
    choice(
      g.CssAstLeadingDashPseudoArgument,
      g.CssAstLeadingDashRawPseudoArgument,
      g.CssAstTypedNthPseudoArgument,
      parser({ trivia: interstitialTrivia }, g.CssAstSelector),
      sequence(not(g.CssAstSyntaxMalformedPseudoNumericArgument), pseudoRawArgument)
    ),
    children => selectorArgumentText(children[0])
  );
  // The `:nth-of-type` family's argument: identical to `CssAstPseudoArgument`
  // except the An+B arms are the bare (no-`of`) variants. The two bare An+B arms
  // reject an `of` tail via their close-ahead, but the selector and raw fallbacks
  // would otherwise re-capture `<An+B> of …` as opaque text (the selector arm as a
  // compound selector, the raw arm as a scanned span). A negative lookahead for an
  // `<An+B>` immediately followed by `of` closes both leaks so the whole of-type
  // branch fails — Selectors-4 §6.6.2 defines `of S` only for nth-child/last-child
  // (§7.1). The guard fires ONLY on an An+B-prefixed `of` tail, so every argument
  // that does not use one (a plain selector or opaque raw arg) stays byte-identical.
  const CssAstOfTypePseudoArgument = node<string>(
    'CssAstOfTypePseudoArgument',
    choice(
      g.CssAstLeadingDashOfTypePseudoArgument,
      g.CssAstLeadingDashRawPseudoArgument,
      g.CssAstTypedOfTypePseudoArgument,
      sequence(
        not(parser({ trivia: whitespace }, sequence(g.CssAstSyntaxNth, g.CssAstSyntaxOfKeyword))),
        choice(
          parser({ trivia: interstitialTrivia }, g.CssAstSelector),
          sequence(not(g.CssAstSyntaxMalformedPseudoNumericArgument), pseudoRawArgument)
        )
      )
    ),
    children => selectorArgumentText(children[0])
  );
  // Retain the parsed `SelectorList` rather than collapsing it to text: a
  // whitelisted selector-function pseudo (`:is`/`:not`/…) keeps it as structured
  // `args`. The raw arm still yields its scanned text. `CssAstPseudo` derives the
  // authored `text` from whichever it gets via `selectorArgumentText`, so the
  // SimpleSelector text is byte-identical to the pre-P0.2 collapse.
  const CssAstGenericPseudoArgument = node<SelectorList | string>(
    'CssAstGenericPseudoArgument',
    choice(
      parser({ trivia: interstitialTrivia }, g.CssAstSelector),
      pseudoRawArgument
    ),
    children => isSelectorList(children[0]) ? children[0] : selectorArgumentText(children[0])
  );
  // A `:has()` argument is a relative selector, so an individual complex may open
  // with a combinator (`:has(> .b)`). The outer selector grammar forbids a leading
  // combinator, so this pseudo-private complex admits an optional relative one and
  // rides it on the ComplexSelector's `leadingComb`. A leading `|` is namespace
  // syntax, not a relative combinator, so it is excluded (mirrors Less's
  // `relativeSelectorCombinator`).
  const CssAstRelativeComplex = node<ComplexSelector>(
    'CssAstRelativeComplex',
    sequence(optional(relativeSelectorCombinator), g.CssAstComplex),
    (children) => {
      const complex = children.find(isComplex);
      if (complex === undefined) {
        throw new Error('CssAstRelativeComplex requires a complex selector');
      }
      if (children.length === 1) {
        return complex;
      }
      const lead = tokenText(children[0]);
      if (lead !== '>' && lead !== '+' && lead !== '~') {
        throw new Error('CssAstRelativeComplex produced an invalid leading combinator');
      }
      return { ...complex, leadingComb: lead };
    }
  );
  // The selector-argument pseudos (`:is`/`:where`/`:not`/`:has`/`:matches`) take a
  // selector-ONLY argument: a (relative) selector list with no general-any text
  // fallback, so `:not(2n+1)` fails the selector and rejects the whole pseudo. The
  // non-relative shape reduces byte-identically to `CssAstSelector` (both assemble
  // `selist(...selectorComplexes(children))`); the retained `SelectorList` becomes
  // structured `PseudoSelector.args` in `CssAstPseudo`, never joined at parse.
  const CssAstSelectorOnlyPseudoArgument = node<SelectorList>(
    'CssAstSelectorOnlyPseudoArgument',
    parser({ trivia: interstitialTrivia }, sequence(CssAstRelativeComplex, many(sequence(literal(','), CssAstRelativeComplex)))),
    children => selist(...selectorComplexes(children))
  );
  // Both pseudo arms share the leading `:`/`::` colon. Left-factor it so that
  // sub-rule runs once per pseudo instead of once per arm; the An+B and generic
  // branches then differ only after the colon. Both original reducers already
  // collapse to the same "head, plus optional (arg) at child index 3" shape, so
  // the merged node keeps byte-identical SimpleSelector text.
  const CssAstPseudo = node<SimpleToken>(
    'CssAstPseudo',
    sequence(
      pseudoColon,
      choice(
        sequence(g.CssAstSyntaxNthChildName, literal('('), g.CssAstPseudoArgument, literal(')')),
        sequence(g.CssAstSyntaxNthTypeName, literal('('), g.CssAstOfTypePseudoArgument, literal(')')),
        sequence(g.CssAstSyntaxSelectorArgPseudoName, literal('('), CssAstSelectorOnlyPseudoArgument, literal(')')),
        sequence(not(g.CssAstSyntaxSelectorArgPseudoName), not(g.CssAstSyntaxNthName), g.CssAstSyntaxKeyword, optional(sequence(literal('('), CssAstGenericPseudoArgument, literal(')'))))
      )
    ),
    (children) => {
      const head = `${tokenText(children[0])}${tokenText(children[1])}`;
      if (children.length === 2) {
        return simpleSelector(head);
      }
      // Parser = STRUCTURE + trivia only. A whitelisted selector-function pseudo
      // keeps the parsed `args` (SelectorList) and does NOT join: core serialize
      // owns the inline `:is(a, b)` rule (`pseudoCanonical`). The opaque/nth/raw
      // path still collapses to SimpleSelector text via `selectorArgumentText`.
      const arg = children[3];
      if (isSelectorList(arg) && STRUCTURED_PSEUDOS.has(tokenText(children[1]).toLowerCase())) {
        return pseudoSelector(head, arg);
      }
      return simpleSelector(`${head}(${selectorArgumentText(arg)})`);
    }
  );
  // `&` is a semantic selector token, not a post-parse text substitution. The
  // core selector model represents it as the canonical SimpleSelector text expected by
  // nested-rule serialization.
  const CssAstNestingSelector = node('CssAstNestingSelector', literal('&'), () => simpleSelector('&'));
  const CssAstCompound = node('CssAstCompound', noTrivia(parser({ trivia: compoundTrivia }, oneOrMore(choice(
    g.CssAstNestingSelector,
    parser({ trivia: interstitialTrivia }, g.CssAstAttribute),
    parser({ trivia: interstitialTrivia }, g.CssAstPseudo),
    g.CssAstSimple
  )))), (children) => {
    const simples: SimpleToken[] = [];
    for (const child of children) {
      if (!isSimpleToken(child)) {
        throw new TypeError('CssAstCompound produced a non-simple selector child.');
      }
      simples.push(child);
    }
    return compoundSelectorOf(simples);
  });
  const CssAstComplex = node(
    'CssAstComplex',
    sequence(g.CssAstCompound, many(sequence(optional(combinator), g.CssAstCompound))),
    children => complexSelector(complexSegments(children))
  );
  const CssAstSelector = node(
    'CssAstSelector',
    sequence(g.CssAstComplex, many(sequence(literal(','), g.CssAstComplex))),
    children => selist(...selectorComplexes(children))
  );
  const CssAstProperty = node('CssAstProperty', g.CssAstSyntaxProperty, children => tokenText(children[0]));
  const CssAstCustomProperty = node('CssAstCustomProperty', customPropertyName, children => tokenText(children[0]));
  const CssAstCustomValue = node(
    'CssAstCustomValue',
    customValue,
    children => any(children.length === 0 ? '' : tokenText(children[0]))
  );
  const CssAstKeyword = node('CssAstKeyword', g.CssAstSyntaxKeyword, children => keyword(tokenText(children[0])));
  // Dashed identifiers are not ordinary CSS keywords, but they are valid
  // component values (most visibly as `var(--name)` arguments). Keep the
  // authored dashed identifier as a structured keyword leaf rather than
  // collapsing the whole function or its enclosing calc to raw bytes.
  const CssAstCustomPropertyValue = node(
    'CssAstCustomPropertyValue',
    customPropertyName,
    children => keyword(tokenText(children[0]))
  );
  const CssAstColor = node('CssAstColor', hexColor, children => color(tokenText(children[0])));
  const CssAstDimension = node(
    'CssAstDimension',
    noTrivia(sequence(numberValue, optional(g.CssAstSyntaxDimensionUnit))),
    (children) => {
      const numberText = tokenText(children[0]);
      const unit = children.length > 1 ? tokenText(children[1]) : '';
      return dimension(Number(numberText), unit, `${numberText}${unit}`);
    }
  );
  const CssAstQuoted = node(
    'CssAstQuoted',
    choice(
      noTrivia(sequence(literal('"'), g.CssAstSyntaxDoubleQuotedText, literal('"'))),
      noTrivia(sequence(literal('\''), g.CssAstSyntaxSingleQuotedText, literal('\''))),
      // The public CST already recognizes this static escaped-string spelling.
      // Reduce it to the existing `Quoted.escaped` fact, never an opaque value.
      noTrivia(sequence(literal('~"'), g.CssAstSyntaxDoubleQuotedText, literal('"'))),
      noTrivia(sequence(literal('~\''), g.CssAstSyntaxSingleQuotedText, literal('\'')))
    ),
    (children) => {
      const opener = tokenText(children[0]);
      const escaped = opener.startsWith('~');
      const quote = escaped ? opener[1]! : opener;
      const value = tokenText(children[1]);
      return quoted(`${escaped ? '~' : ''}${quote}${value}${quote}`, value, quote, escaped);
    }
  );
  const CssAstUrlUnquoted = node<ValueNode>(
    'CssAstUrlUnquoted',
    g.CssAstSyntaxUrlInner,
    children => any(tokenText(children[0]!))
  );
  const CssAstUrl = node(
    'CssAstUrl',
    sequence(
      urlName,
      // The public CST permits block-comment trivia between the `url` name and
      // its opening delimiter. Keep that trivia structural so the unquoted
      // payload leaf remains strict and `url(foo bar)` cannot fall through.
      many(blockComment),
      literal('('),
      optional(regex(/[ \t\n\r\f]+/)),
      many(blockComment),
      optional(choice(g.CssAstQuoted, CssAstUrlUnquoted)),
      optional(regex(/[ \t\n\r\f]+/)),
      many(blockComment),
      expect(literal(')'), ')')
    ),
    (children) => {
      const body = children.find(isValue);
      return url(body ?? any(''));
    }
  );
  const CssAstCall = node(
    'CssAstCall',
    sequence(genericFunctionName, literal('('), optional(cssValueTrivia), optional(sequence(g.CssAstValueTerm, many(sequence(field('separator', noTrivia(sequence(literal(','), optional(cssValueTrivia)))), g.CssAstValueTerm)))), optional(cssValueTrivia), literal(')')),
    (children, fields) => {
      const name = tokenText(children[0]);
      const args = children.slice(1).filter(isValueSlotValue);
      return funcCall(name, withAuthoredSeparators(args, fields, Math.max(0, args.length - 1)));
    }
  );
  // CSS arithmetic parentheses are structural only inside calc(), where they
  // preserve math precedence in the AST.
  const CssAstCalcParen = node(
    'CssAstCalcParen',
    noTrivia(sequence(literal('('), many(calcWhitespace), g.CssAstMathSum, many(calcWhitespace), literal(')'))),
    children => block(firstValue(children))
  );
  // `var()` is a component-value substitution boundary even inside a strict
  // calc expression. Its fallback is its own component-value sequence, while
  // the surrounding calc still supplies the arithmetic reduction. This keeps
  // `var(--x, 1px + 2px)` and non-math component fallbacks lossless without
  // turning the function or outer calc into opaque raw bytes.
  const CssAstCalcVarFallbackPunctuation = node(
    'CssAstCalcVarFallbackPunctuation',
    oneOrMore(declarationAnyCharacter),
    children => any(children.map(tokenText).join(''))
  );
  // The fallback's bracket/brace leaves retain their authored bytes, so their
  // bodies are captured with scanTo. These zero-width structural guards make
  // that lossless capture reject a closer reached before a nested, differently
  // shaped block has closed: `[a(b]` and `{a[b}` cannot be accepted merely
  // because the outer leaf sees its own closer first. The nested-group skips are
  // the shared `balancedBrackets`/`balancedBraces` combinators.
  const calcVarFallbackBracketCrossParen = sequence(
    literal('['),
    scanTo(literal('('), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedBrackets] }),
    literal('('),
    scanTo(choice(literal(')'), literal(']')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedBrackets] }),
    literal(']')
  );
  const calcVarFallbackBracketCrossBrace = sequence(
    literal('['),
    scanTo(literal('{'), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedBrackets] }),
    literal('{'),
    scanTo(choice(literal('}'), literal(']')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedBrackets] }),
    literal(']')
  );
  const calcVarFallbackBraceCrossParen = sequence(
    literal('{'),
    scanTo(literal('('), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedBraces] }),
    literal('('),
    scanTo(choice(literal(')'), literal('}')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedBraces] }),
    literal('}')
  );
  const calcVarFallbackBraceCrossBracket = sequence(
    literal('{'),
    scanTo(literal('['), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedBraces] }),
    literal('['),
    scanTo(choice(literal(']'), literal('}')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, balancedBraces] }),
    literal('}')
  );
  // A parenthesized fallback is structural, unlike the raw bracket/brace
  // leaves below. Give it the same ordered-delimiter guard: `([a])` and
  // `({a})` are valid adjacent nested groups, while `([a)]` and `({a)}` are
  // crossed closures rather than an opportunity to reassign a closer to an
  // enclosing var()/calc() production.
  const calcVarFallbackParenCrossBracket = sequence(
    literal('('),
    scanTo(literal('['), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
    literal('['),
    scanTo(choice(literal(']'), literal(')')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
    literal(')')
  );
  const calcVarFallbackParenCrossBrace = sequence(
    literal('('),
    scanTo(literal('{'), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
    literal('{'),
    scanTo(choice(literal('}'), literal(')')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
    literal(')')
  );
  const CssAstCalcVarFallbackParen = node(
    'CssAstCalcVarFallbackParen',
    sequence(
      not(choice(calcVarFallbackParenCrossBracket, calcVarFallbackParenCrossBrace)),
      literal('('),
      optional(g.CssAstCalcVarFallback),
      literal(')')
    ),
    children => block(valueSlotChildren(children)[0] ?? any(''))
  );
  // Core has no bracket value node. Keep a bracket component as its existing
  // lossless Any leaf, but let Parseman recognize its balanced structure so a
  // nested group or quoted/string content can never terminate the fallback
  // early or make the enclosing var call opaque.
  const CssAstCalcVarFallbackBracket = node(
    'CssAstCalcVarFallbackBracket',
    sequence(
      not(choice(calcVarFallbackBracketCrossParen, calcVarFallbackBracketCrossBrace)),
      literal('['),
      scanTo(literal(']'), {
        skip: [
          blockComment,
          customEscape,
          customDoubleQuoted,
          customSingleQuoted,
          balancedBrackets
        ]
      }),
      literal(']')
    ),
    children => any(children.map(tokenText).join(''))
  );
  const CssAstCalcVarFallbackBrace = node(
    'CssAstCalcVarFallbackBrace',
    sequence(
      not(choice(calcVarFallbackBraceCrossParen, calcVarFallbackBraceCrossBracket)),
      literal('{'),
      scanTo(literal('}'), {
        skip: [
          blockComment,
          customEscape,
          customDoubleQuoted,
          customSingleQuoted,
          balancedBraces
        ]
      }),
      literal('}')
    ),
    children => any(children.map(tokenText).join(''))
  );
  const CssAstCalcVarFallbackTerm = node(
    'CssAstCalcVarFallbackTerm',
    sequence(
      // A nested var() needs its own first separator and trailing fallback
      // commas preserved exactly as the outer var does. It must therefore win
      // before the generic function-call component arm.
      choice(g.CssAstCalcVarCall, g.CssAstCalcVarFallbackCall, g.CssAstValueAtom, g.CssAstCalcVarFallbackParen, g.CssAstCalcVarFallbackBracket, g.CssAstCalcVarFallbackBrace, g.CssAstCalcVarFallbackPunctuation),
      many(sequence(many(calcWhitespace), choice(g.CssAstCalcVarCall, g.CssAstCalcVarFallbackCall, g.CssAstValueAtom, g.CssAstCalcVarFallbackParen, g.CssAstCalcVarFallbackBracket, g.CssAstCalcVarFallbackBrace, g.CssAstCalcVarFallbackPunctuation)))
    ),
    (children) => {
      const values = valueSlotChildren(children);
      return values.length === 1 ? values[0]! : values;
    }
  );
  const CssAstCalcVarFallbackEmpty = node(
    'CssAstCalcVarFallbackEmpty',
    regex(/(?=[,)])/),
    () => any('')
  );
  const CssAstCalcVarFallbackItem = node(
    'CssAstCalcVarFallbackItem',
    choice(g.CssAstCalcVarFallbackTerm, g.CssAstCalcVarFallbackEmpty),
    children => firstValueSlot(children)
  );
  const CssAstCalcVarFallback = node(
    'CssAstCalcVarFallback',
    sequence(
      g.CssAstCalcVarFallbackItem,
      many(sequence(literal(','), many(calcWhitespace), g.CssAstCalcVarFallbackItem))
    ),
    (children) => {
      const values = valueSlotChildren(children);
      return values.length === 1 ? values[0]! : list(values, ',');
    }
  );
  const CssAstCalcVarFallbackCall = node(
    'CssAstCalcVarFallbackCall',
    sequence(
      genericFunctionName,
      literal('('),
      optional(sequence(not(regex(/(?=\))/)), g.CssAstCalcVarFallbackItem, many(sequence(literal(','), many(calcWhitespace), g.CssAstCalcVarFallbackItem)))),
      literal(')')
    ),
    children => funcCall(tokenText(children[0]), children.filter(isValueSlotValue))
  );
  const CssAstCalcVarCall = node(
    'CssAstCalcVarCall',
    sequence(
      regex(/var(?=\()/i),
      literal('('),
      CssAstCustomPropertyValue,
      optional(sequence(literal(','), many(calcWhitespace), choice(g.CssAstCalcVarFallback, g.CssAstCalcVarFallbackEmpty))),
      literal(')')
    ),
    children => funcCall(tokenText(children[0]), children.filter(isValueSlotValue))
  );
  const CssAstCalcValue = node(
    'CssAstCalcValue',
    choice(g.CssAstDimension, g.CssAstColor, g.CssAstUrl, g.CssAstCalcCall, g.CssAstCalcVarCall, parser({ trivia: whitespace }, g.CssAstCall), g.CssAstCalcParen, g.CssAstQuoted, CssAstCustomPropertyValue, g.CssAstKeyword),
    children => firstValue(children)
  );
  const CssAstMathProduct = node(
    'CssAstMathProduct',
    noTrivia(sequence(g.CssAstCalcValue, many(sequence(calcProductOperator, g.CssAstCalcValue)))),
    foldOperation
  );
  const CssAstMathSum = node(
    'CssAstMathSum',
    noTrivia(sequence(g.CssAstMathProduct, many(sequence(calcSumOperator, g.CssAstMathProduct)))),
    foldOperation
  );
  const CssAstCalcCall = node(
    'CssAstCalcCall',
    noTrivia(sequence(regex(/calc(?=\()/i), literal('('), many(calcWhitespace), g.CssAstMathSum, many(calcWhitespace), literal(')'))),
    children => funcCall(tokenText(children[0]), [firstValue(children)])
  );
  // Preserve the public declaration component-value language without letting
  // its permissive forms leak into query preludes or calc. `calc(...)` remains
  // exclusively owned by CssAstCalcCall; genericFunctionName excludes it.
  const CssAstDeclarationParen = node(
    'CssAstDeclarationParen',
    sequence(literal('('), optional(g.CssAstDeclarationValue), literal(')')),
    children => block(valueSlotChildren(children)[0] ?? any(''))
  );
  const CssAstDeclarationAny = node(
    'CssAstDeclarationAny',
    // Slash is a component boundary before a number or whitespace. Keep just
    // that slash as one structured punctuation component so `/ .5` does not
    // swallow the numeric leaf into opaque bytes; punctuation runs such as
    // `//` remain losslessly represented as one Any node.
    //
    // Both original arms led with not('/*'), collapsing this node's first-set to
    // 'any' so it (and the whole value atom it terminates) entered speculatively
    // at every value-term boundary. This value path runs under the enclosing
    // value-term noTrivia, so the '/*' guard is adjacent-only; split on the first
    // char instead: the '/' arm consumes '/', rejects an adjacent '*' (comment),
    // then keeps the single-slash-before-number/ws case or continues the run; the
    // non-slash arm leads with the 16 non-'/' punctuation literals. Every arm now
    // resolves a concrete first-set, so the compiler first-char-gates it.
    choice(
      noTrivia(sequence(literal('/'), not(literal('*')), choice(
        regex(/(?=[.0-9 \t\n\r\f])/),
        many(declarationAnyCharacter)
      ))),
      sequence(nonSlashDeclarationAnyCharacter, many(declarationAnyCharacter))
    ),
    children => any(children.map(tokenText).join(''))
  );
  const CssAstDeclarationCall = node(
    'CssAstDeclarationCall',
    sequence(not(g.CssAstSyntaxUrlOpen), genericFunctionName, literal('('), optional(cssValueTrivia), optional(sequence(g.CssAstDeclarationValueTerm, many(sequence(field('separator', noTrivia(sequence(literal(','), optional(cssValueTrivia)))), g.CssAstDeclarationValueTerm)))), optional(cssValueTrivia), literal(')')),
    (children, fields) => {
      const name = children.find((child): child is { value: string } => typeof child === 'object' && child !== null && 'value' in child);
      if (name === undefined) {
        throw new Error('CssAstDeclarationCall requires a function name');
      }
      const args = children.filter(isValueSlotValue);
      return funcCall(name.value, withAuthoredSeparators(args, fields, Math.max(0, args.length - 1)));
    }
  );
  // A generic-function call and a bare keyword share the same identifier
  // prefix. Rather than attempt the call (scan the identifier, require `(`,
  // fail, roll back) and then re-scan the identifier as a keyword, recognize
  // the identifier ONCE and branch on the optional `(` call tail. This is the
  // scannerless equivalent of the reference lexer's Function-vs-Value token
  // split: no shared-prefix re-scan on the hottest value token. url()/var()/
  // calc() keep their dedicated preceding arms; the retained not(urlOpen) guard
  // and the outer not(calc) guard preserve their exact error paths.
  const CssAstDeclarationIdent = node<ValueNode>(
    'CssAstDeclarationIdent',
    // Lead with genericFunctionName (a grammar-local regex) so this arm resolves a
    // concrete identifier first-set and the compiler first-char-gates it, instead
    // of entering it speculatively at every value-atom boundary. The former
    // not(urlOpen) guard is unreachable here: `url(` is always consumed (or
    // hard-errored) by the preceding CssAstUrl arm, so it never reaches this arm.
    sequence(
      genericFunctionName,
      optional(sequence(
        literal('('),
        optional(cssValueTrivia),
        optional(sequence(g.CssAstDeclarationValueTerm, many(sequence(field('separator', noTrivia(sequence(literal(','), optional(cssValueTrivia)))), g.CssAstDeclarationValueTerm)))),
        optional(cssValueTrivia),
        literal(')')
      ))
    ),
    (children, fields) => {
      const name = tokenText(children[0]);
      if (!children.some(child => isTerminalText(child) && tokenText(child) === '(')) {
        return keyword(name);
      }
      const args = children.filter(isValueSlotValue);
      return funcCall(name, withAuthoredSeparators(args, fields, Math.max(0, args.length - 1)));
    }
  );
  // `var()` has one required custom-property argument and one optional
  // declaration-value fallback. A comma inside that fallback is not a third
  // function argument, and an empty fallback is valid. Reuse the same
  // grammar-owned fallback reduction used inside calc rather than sending this
  // through the generic function-argument production.
  const CssAstDeclarationVarCall = node(
    'CssAstDeclarationVarCall',
    sequence(
      regex(/var(?=\()/i),
      literal('('),
      CssAstCustomPropertyValue,
      optional(sequence(literal(','), many(calcWhitespace), choice(g.CssAstCalcVarFallback, g.CssAstCalcVarFallbackEmpty))),
      literal(')')
    ),
    children => funcCall(tokenText(children[0]), children.filter(isValueSlotValue))
  );
  const CssAstDeclarationValueAtom = node(
    'CssAstDeclarationValueAtom',
    // `calc()` is a declaration component just like url()/var()/a generic
    // function, including after a prior component (`0 calc(...)`). It is selected
    // at its own opener by the leading CssAstCalcCall arm. The former
    // not(?=calc\() guard on the second arm was redundant AND poisoned this
    // node's first-set to 'any' (so it entered speculatively at every value-term
    // boundary): a malformed `calc(` cannot degrade into Keyword+paren here
    // because CssAstDeclarationIdent's genericFunctionName already excludes
    // `calc(`, so it fails and the atom is rejected exactly as before. Dropping
    // the guard flattens the choice so every arm leads with a concrete first-set
    // and the compiler first-char-gates the whole value atom.
    choice(
      g.CssAstCalcCall,
      g.CssAstDimension, g.CssAstColor, g.CssAstUrl, g.CssAstDeclarationVarCall, g.CssAstDeclarationIdent, g.CssAstDeclarationParen, g.CssAstQuoted, CssAstCustomPropertyValue, g.CssAstDeclarationAny
    ),
    children => firstValue(children)
  );
  const CssAstDeclarationValueTerm = node(
    'CssAstDeclarationValueTerm',
    noTrivia(sequence(
      many(blockComment),
      g.CssAstDeclarationValueAtom,
      many(choice(
        sequence(field('separator', cssValueTrivia), g.CssAstDeclarationValueAtom),
        g.CssAstDeclarationValueAtom
      )),
      many(blockComment)
    )),
    (children, fields) => {
      const values = valueSlotChildren(children);
      if (values.length === 1) {
        return values[0]!;
      }
      return withAuthoredSeparators(values, fields, values.length - 1);
    }
  );
  const CssAstDeclarationExtendedValue = node(
    'CssAstDeclarationExtendedValue',
    sequence(g.CssAstDeclarationValueTerm, many(sequence(field('separator', noTrivia(sequence(literal(','), optional(cssValueTrivia)))), g.CssAstDeclarationValueTerm))),
    (children, fields) => {
      const terms = valueSlotChildren(children);
      if (terms.length === 1) {
        return terms[0]!;
      }
      return withAuthoredSeparators(list(terms, ','), fields, terms.length - 1);
    }
  );
  const CssAstDeclarationValue = node(
    'CssAstDeclarationValue',
    choice(
      g.CssAstValue,
      g.CssAstDeclarationVarCall,
      g.CssAstDeclarationCall,
      sequence(not(sequence(g.CssAstSyntaxKeyword, literal('('))), g.CssAstDeclarationExtendedValue)
    ),
    children => firstValueSlot(children)
  );
  const CssAstValueAtom = node(
    'CssAstValueAtom',
    choice(g.CssAstDimension, g.CssAstColor, g.CssAstUrl, g.CssAstCalcCall, g.CssAstCall, g.CssAstQuoted, CssAstCustomPropertyValue, g.CssAstKeyword),
    children => firstValue(children)
  );
  const CssAstValueTerm = node('CssAstValueTerm', noTrivia(sequence(CssAstValueAtom, many(choice(
    sequence(field('separator', cssValueTrivia), CssAstValueAtom),
    CssAstValueAtom
  )))), (children, fields) => {
    const values = valueSlotChildren(children);
    if (values.length === 1) {
      return values[0]!;
    }
    return withAuthoredSeparators(values, fields, values.length - 1);
  });
  const CssAstValue = node(
    'CssAstValue',
    sequence(g.CssAstValueTerm, many(sequence(field('separator', noTrivia(sequence(literal(','), optional(cssValueTrivia)))), g.CssAstValueTerm))),
    (children, fields) => {
      const terms = valueSlotChildren(children);
      if (terms.length === 1) {
        return terms[0]!;
      }
      return withAuthoredSeparators(list(terms, ','), fields, terms.length - 1);
    }
  );
  // Comments are CSS component-value trivia around a priority marker. They
  // cannot become declaration values or block the `!important` reduction.
  const CssAstImportant = node(
    'CssAstImportant',
    // Lead with `!` (the cheap disambiguating signal) so this arm resolves a
    // concrete first-set and optional(Important) is first-char-gated instead of
    // entering the node frame at every declaration's value boundary. The former
    // leading many(blockComment) was dead: the enclosing declaration already
    // consumes any comments before the `!` marker, and this reducer ignores its
    // children, so dropping it is output-identical.
    sequence(literal('!'), many(blockComment), g.CssAstSyntaxImportant, many(blockComment)),
    () => true
  );
  const CssAstDeclaration = node(
    'CssAstDeclaration',
    choice(
      sequence(g.CssAstCustomProperty, literal(':'), g.CssAstCustomValue, optional(literal(';'))),
      sequence(
        g.CssAstProperty,
        many(blockComment),
        literal(':'),
        many(blockComment),
        // A declaration value is a component-value sequence. In particular, a
        // structured function is one component, not the entire value: `url(x)
        // / cover`, `var(--x) solid`, and `foo(bar) baz` all retain the
        // existing structured leaves inside a SpacedValue. The strict calc
        // route is selected at its opener; every other declaration value uses
        // the component-value route and cannot turn calc into a permissive
        // generic call.
        // A calc-prefixed value routes through the strict CssAstValue math
        // grammar; every other declaration value uses the component-value
        // route. The non-calc arm needs no second `(?=calc\()` guard: a
        // malformed calc that fails the first arm is already rejected inside
        // CssAstDeclarationValueAtom, whose own guard forbids `calc` degrading
        // into Keyword + paren. Dropping the duplicate lookahead removes one
        // regex probe from every ordinary declaration.
        choice(
          sequence(regex(/(?=calc\()/i), g.CssAstValue),
          g.CssAstDeclarationExtendedValue
        ),
        many(blockComment),
        not(literal('{')),
        optional(g.CssAstImportant),
        optional(literal(';'))
      )
    ),
    (children) => {
      const name = tokenText(children[0]);
      if (name.startsWith('--')) {
        const value = children.find((child): child is ValueNode => isNodeType(child, 'Any'));
        if (value === undefined) {
          throw new Error('CssAstDeclaration requires a captured custom-property value');
        }
        return decl(name, valueSlot(value));
      }
      const value = children.find(isValueSlotValue);
      if (value === undefined) {
        throw new Error('CssAstDeclaration requires a structured value');
      }
      return decl(name, Array.isArray(value) ? value : valueSlot(value), null, children.includes(true));
    }
  );
  // This import-local URL target intentionally accepts the public grammar's
  // comment trivia around `url` / `(` / payload / `)`. It does not change the
  // ordinary declaration-value URL grammar, and comments after the closing `)`
  // remain owned by CssAstImportTail as authored tail bytes.
  const CssAstImportUrlUnquoted = node<ValueNode>(
    'CssAstImportUrlUnquoted',
    g.CssAstSyntaxUrlInner,
    children => any(tokenText(children[0]!))
  );
  const CssAstImportUrl = node<ValueNode>(
    'CssAstImportUrl',
    sequence(
      urlName,
      many(blockComment),
      literal('('),
      many(blockComment),
      optional(choice(g.CssAstQuoted, g.CssAstImportUrlUnquoted)),
      many(blockComment),
      expect(literal(')'), ')')
    ),
    children => url(children.find(isValue) ?? any(''))
  );
  const CssAstImportTailRaw = node(
    'CssAstImportTailRaw',
    choice(importTailGroup, importTailSquareGroup, customDoubleQuoted, customSingleQuoted, blockComment, importTailText, literal('/')),
    children => any(children.map(tokenText).join(''))
  );
  const CssAstImportTailBody = node(
    'CssAstImportTailBody',
    sequence(g.CssAstImportTailRaw, many(choice(g.CssAstImportTailRaw, importTailWhitespace))),
    children => any(children.map(sourceText).join(''))
  );
  const CssAstImportTail = node(
    'CssAstImportTail',
    noTrivia(sequence(many(importTailWhitespace), g.CssAstImportTailBody)),
    children => any(sourceText(children[children.length - 1]!))
  );
  const CssAstImport = node(
    'CssAstImport',
    sequence(importAtKeyword, many(blockComment), choice(g.CssAstQuoted, g.CssAstImportUrl), optional(g.CssAstImportTail), literal(';')),
    (children) => {
      const target = children.find(isImportTarget);
      if (target === undefined) {
        throw new Error('CssAstImport requires a static quoted or url target');
      }
      const tail = children.find((child): child is ValueNode => isNodeType(child, 'Any')) ?? null;
      return atRuleStatement(tokenText(children[0]), importPrelude(target, tail));
    }
  );
  const CssAstAtRuleStatement = node(
    'CssAstAtRuleStatement',
    sequence(statementAtRuleName, g.CssAstStatementPrelude, literal(';')),
    (children) => {
      const name = tokenText(children[0]);
      return atRuleStatement(name, optionalValue(children[1]));
    }
  );
  // This grammar-owned header capture skips comments, strings, and balanced
  // query groups while locating the body brace. The core AST does not yet have
  // a typed query-condition node, so retain the already-parsed bytes as Any.
  const atPrelude = scanTo(literal('{'), {
    skip: [
      blockComment,
      customEscape,
      customDoubleQuoted,
      customSingleQuoted,
      balancedParens,
      balancedBrackets
    ]
  });
  const CssAstAtPrelude = node('CssAstAtPrelude', atPrelude, (children) => {
    const text = children.length === 0 ? '' : tokenText(children[0]).trim();
    return text === '' ? null : any(text);
  });
  const statementPrelude = scanTo(sequence(many(choice(whitespace, blockComment)), choice(literal('{'), literal(';'))), {
    skip: [
      blockComment,
      customEscape,
      customDoubleQuoted,
      customSingleQuoted,
      balancedParens,
      balancedBrackets
    ]
  });
  const CssAstStatementPrelude = node('CssAstStatementPrelude', statementPrelude, (children) => {
    const text = children.length === 0 ? '' : tokenText(children[0]).trim();
    return text === '' ? null : any(text);
  });
  const CssAstOpaqueAtPrelude = node('CssAstOpaqueAtPrelude', g.CssAstOpaqueCapturePrelude, (children) => {
    const text = children.length === 0 ? '' : tokenText(children[0]).trim();
    return text === '' ? null : text;
  });
  const CssAstOpaqueBody = node(
    'CssAstOpaqueBody',
    g.CssAstOpaqueCaptureBody,
    children => children.length === 0 ? '' : tokenText(children[0])
  );
  const CssAstOpaqueAtRuleBlock = node(
    'CssAstOpaqueAtRuleBlock',
    sequence(
      genericAtRuleName,
      noTrivia(sequence(
        g.CssAstOpaqueAtPrelude,
        literal('{'),
        g.CssAstOpaqueBody,
        literal('}')
      ))
    ),
    (children) => {
      const prelude = children[1];
      const rawBody = children[3];
      if ((prelude !== null && typeof prelude !== 'string') || typeof rawBody !== 'string') {
        throw new TypeError('CssAstOpaqueAtRuleBlock lost its grammar-owned raw facts.');
      }
      return opaqueAtRuleBlock(tokenText(children[0]!), prelude, rawBody);
    }
  );
  const CssAstQueryBareFeature = node(
    'CssAstQueryBareFeature',
    sequence(literal('('), g.CssAstProperty, literal(')')),
    children => block(keyword(tokenText(children[1]!)))
  );
  const CssAstQueryColonFeature = node(
    'CssAstQueryColonFeature',
    sequence(literal('('), g.CssAstProperty, literal(':'), g.CssAstValue, literal(')')),
    children => block(operation(':', keyword(tokenText(children[1]!)), firstValue(children)))
  );
  const CssAstQueryComparisonFeature = node(
    'CssAstQueryComparisonFeature',
    sequence(
      literal('('),
      g.CssAstProperty,
      g.CssAstSyntaxQueryComparisonOperator,
      g.CssAstValue,
      optional(sequence(g.CssAstSyntaxQueryComparisonOperator, g.CssAstValue)),
      literal(')')
    ),
    children => block(chainedQueryComparison(keyword(tokenText(children[1]!)), children))
  );
  // Media/container ranges can put the feature name between two values:
  // `(100em < width < 200em)`. Keep both comparisons as typed Operations;
  // the outer operation preserves their authored order without raw-prelude
  // fallback or a secondary query parser.
  const CssAstQueryRangeFeature = node(
    'CssAstQueryRangeFeature',
    sequence(
      literal('('),
      g.CssAstValue,
      g.CssAstSyntaxQueryComparisonOperator,
      g.CssAstProperty,
      optional(sequence(g.CssAstSyntaxQueryComparisonOperator, g.CssAstValue)),
      literal(')')
    ),
    (children) => {
      const values = valueChildren(children);
      const property = keyword(tokenText(children[3]!));
      if (values.length === 0) {
        throw new Error('CSS AST query range requires its leading value');
      }
      const operators = queryComparisonOperators(children);
      if (operators.length === 0) {
        throw new Error('CSS AST query range requires a comparison operator');
      }
      let result = operation(operators[0]!, values[0]!, property);
      if (operators.length > 1) {
        const right = values[1];
        if (right === undefined) {
          throw new Error('CSS AST query range lost its trailing value');
        }
        result = operation(operators[1]!, result, right);
      }
      return block(result);
    }
  );
  const CssAstQueryFeature = node(
    'CssAstQueryFeature',
    choice(CssAstQueryBareFeature, CssAstQueryColonFeature, CssAstQueryComparisonFeature, CssAstQueryRangeFeature),
    children => firstValue(children)
  );
  const CssAstQueryNonOnlyKeyword = node<Keyword>(
    'CssAstQueryNonOnlyKeyword',
    sequence(not(g.CssAstSyntaxQueryOnly), g.CssAstKeyword),
    (children) => {
      const value = children.find(isKeyword);
      if (value === undefined) {
        throw new Error('CSS AST query keyword requires a keyword fact');
      }
      return value;
    }
  );
  const CssAstQueryTerm = node<ValueNode>(
    'CssAstQueryTerm',
    choice(g.CssAstQueryFeature, g.CssAstQueryFunction, CssAstQueryNonOnlyKeyword),
    children => firstValue(children)
  );
  const CssAstQueryOnlyClause = node<ValueNode>(
    'CssAstQueryOnlyClause',
    sequence(
      g.CssAstSyntaxQueryOnly,
      CssAstQueryNonOnlyKeyword,
      many(sequence(g.CssAstSyntaxQueryAndOr, CssAstQueryTerm))
    ),
    children => spaced(children.map(child => isValue(child) ? child : keyword(tokenText(child))))
  );
  const CssAstQueryClause = node<ValueNode>(
    'CssAstQueryClause',
    choice(
      CssAstQueryOnlyClause,
      sequence(CssAstQueryTerm, many(sequence(optional(literal(',')), CssAstQueryTerm)))
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const CssAstQueryPrelude = node(
    'CssAstQueryPrelude',
    sequence(
      g.CssAstQueryClause,
      many(sequence(literal(','), g.CssAstQueryClause))
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1 ? values[0]! : list(values, ',');
    }
  );
  // A supports condition is deliberately distinct from the media/container
  // query prelude above. In particular it has no bare-keyword form: `@supports
  // color {}` must fail rather than being lowered to an opaque Any prelude.
  // General-enclosed carries its own raw-template content model, so it can be
  // admitted in supports without pretending that arbitrary CSS bytes are
  // FunctionCall arguments or parenthesized value expressions.
  const CssAstGeneralEnclosedRaw = node<string>(
    'CssAstGeneralEnclosedRaw',
    noTrivia(choice(blockComment, generalEnclosedText)),
    children => tokenText(children[0]!)
  );
  const CssAstGeneralEnclosedQuoted = node<string>(
    'CssAstGeneralEnclosedQuoted',
    choice(
      noTrivia(sequence(literal('"'), customDoubleQuotedText, literal('"'))),
      noTrivia(sequence(literal('\''), customSingleQuotedText, literal('\'')))
    ),
    children => children.map(tokenText).join('')
  );
  const CssAstGeneralEnclosedGroup = node<string>(
    'CssAstGeneralEnclosedGroup',
    choice(
      noTrivia(sequence(literal('('), g.CssAstGeneralEnclosedContent, literal(')'))),
      noTrivia(sequence(literal('['), g.CssAstGeneralEnclosedContent, literal(']'))),
      noTrivia(sequence(literal('{'), g.CssAstGeneralEnclosedContent, literal('}')))
    ),
    children => children.map(child => isInterpolation(child)
      ? child.parts.map(part => 'lit' in part ? part.lit : '').join('')
      : tokenText(child)).join('')
  );
  const CssAstGeneralEnclosedContent = node<Interpolation>(
    'CssAstGeneralEnclosedContent',
    noTrivia(many(choice(
      CssAstGeneralEnclosedRaw,
      g.CssAstGeneralEnclosedQuoted,
      g.CssAstGeneralEnclosedGroup
    ))),
    children => interpolation([{ lit: children.map(tokenText).join('') }])
  );
  const CssAstGeneralEnclosed = node<GeneralEnclosed>(
    'CssAstGeneralEnclosed',
    choice(
      noTrivia(sequence(g.CssAstSyntaxQueryFunctionName, literal('('), g.CssAstGeneralEnclosedContent, literal(')'))),
      noTrivia(sequence(literal('('), g.CssAstGeneralEnclosedContent, literal(')')))
    ),
    (children) => {
      const content = children.find((child): child is Interpolation => isNodeType(child, 'Interpolation'));
      if (content === undefined) {
        throw new TypeError('CSS general-enclosed lost its grammar-owned content.');
      }
      const head = children[0];
      return isTerminalText(head) && tokenText(head) !== '('
        ? generalEnclosed('function', tokenText(head), content)
        : generalEnclosed('paren', null, content);
    }
  );
  const CssAstQueryFunction = node(
    'CssAstQueryFunction',
    sequence(
      g.CssAstSyntaxQueryFunctionName,
      literal('('),
      scanTo(literal(')'), {
        skip: [
          blockComment,
          customEscape,
          customDoubleQuoted,
          customSingleQuoted,
          balancedParens
        ]
      }),
      expect(literal(')'), ')')
    ),
    children => funcCall(tokenText(children[0]!), [any(children.length > 2 ? tokenText(children[2]!) : '')])
  );
  const CssAstSupportsInParens = node(
    'CssAstSupportsInParens',
    choice(
      sequence(literal('('), g.CssAstSupportsCondition, literal(')')),
      g.CssAstQueryFeature,
      g.CssAstGeneralEnclosed
    ),
    (children) => {
      const value = firstValue(children);
      return isValue(children[0]) ? value : block(value);
    }
  );
  const CssAstSupportsCondition = node(
    'CssAstSupportsCondition',
    choice(
      sequence(g.CssAstSyntaxQueryNot, g.CssAstSupportsInParens),
      sequence(g.CssAstSupportsInParens, many(sequence(g.CssAstSyntaxQueryAndOr, g.CssAstSupportsInParens)))
    ),
    (children) => {
      const values: ValueNode[] = [];
      for (const child of children) {
        if (isValue(child)) {
          values.push(child);
        } else {
          const text = tokenText(child);
          const normalized = text.toLowerCase();
          if (normalized === 'not' || normalized === 'and' || normalized === 'or') {
            values.push(keyword(text));
          }
        }
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  // The existing public grammar currently admits a comma-separated condition
  // list for all conditional groups, including @supports. Keep the direct path
  // parity-compatible until that public grammar is intentionally tightened.
  const CssAstSupportsPrelude = node(
    'CssAstSupportsPrelude',
    sequence(g.CssAstSupportsCondition, many(sequence(literal(','), g.CssAstSupportsCondition))),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1 ? values[0]! : list(values, ',');
    }
  );
  const cssNestedBody = choice(g.CssAstComment, g.CssAstAtRuleStatement, g.CssAstDeclaration, g.CssAstNestedConditionalBlock, g.CssAstDescriptorBlock, g.CssAstFontFeatureValuesBlock, g.CssAstScopeBlock, g.CssAstNestedStartingStyleBlock, g.CssAstNestedLayerBlock, g.CssAstPageBlock, g.CssAstKeyframes, g.CssAstDocumentBlock, g.CssAstOpaqueAtRuleBlock, g.CssAstRuleset, literal(';'));
  const cssDeclarationBody = choice(g.CssAstComment, g.CssAstDeclaration, literal(';'));
  const cssConditionalBody = choice(g.CssAstComment, g.CssAstConditionalBlock, g.CssAstDescriptorBlock, g.CssAstFontFeatureValuesBlock, g.CssAstScopeBlock, g.CssAstLayerBlock, g.CssAstStartingStyleBlock, g.CssAstPageBlock, g.CssAstDocumentBlock, g.CssAstOpaqueAtRuleBlock, g.CssAstRuleset);
  const cssBlockBody = choice(g.CssAstComment, g.CssAstAtRuleStatement, g.CssAstConditionalBlock, g.CssAstDescriptorBlock, g.CssAstFontFeatureValuesBlock, g.CssAstScopeBlock, g.CssAstStartingStyleBlock, g.CssAstLayerBlock, g.CssAstPageBlock, g.CssAstKeyframes, g.CssAstDocumentBlock, g.CssAstOpaqueAtRuleBlock, g.CssAstRuleset);
  const CssAstLayerBlock = node(
    'CssAstLayerBlock',
    sequence(layerAtKeyword, g.CssAstAtPrelude, literal('{'), many(cssBlockBody), literal('}')),
    children => atRuleBlock(tokenText(children[0]!), optionalValue(children[1]), blockStatements(children))
  );
  const CssAstNestedLayerBlock = node(
    'CssAstNestedLayerBlock',
    sequence(layerAtKeyword, g.CssAstAtPrelude, literal('{'), many(cssNestedBody), literal('}')),
    children => atRuleBlock(tokenText(children[0]!), optionalValue(children[1]), rulesetStatements(children))
  );
  // `@page` accepts only declarations, empty statements, and its sixteen
  // margin-box at-rules. Each margin box is declarations-only as well. The
  // generic grammar-owned header capture retains a page selector until that
  // selector syntax receives a dedicated AST node family.
  const CssAstMarginBox = node(
    'CssAstMarginBox',
    sequence(
      g.CssAstSyntaxMarginAtKeyword,
      many(blockComment),
      literal('{'),
      many(cssDeclarationBody),
      literal('}')
    ),
    children => atRuleBlock(
      tokenText(children[0]!),
      null,
      children.filter((value): value is Comment | Declaration => isComment(value) || isDeclaration(value))
    )
  );
  const CssAstPageBlock = node(
    'CssAstPageBlock',
    sequence(
      pageAtKeyword,
      g.CssAstAtPrelude,
      literal('{'),
      many(choice(g.CssAstComment, g.CssAstDeclaration, g.CssAstMarginBox, literal(';'))),
      literal('}')
    ),
    children => atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      children.filter((value): value is Comment | Declaration | AtRuleBlock => isComment(value) || isDeclaration(value) || isAtRuleBlock(value))
    )
  );
  const CssAstKeyframeSelector = node(
    'CssAstKeyframeSelector',
    choice(keyframeEndpoint, keyframePercent),
    children => simpleSelector(tokenText(children[0]))
  );
  const CssAstKeyframeBlock = node(
    'CssAstKeyframeBlock',
    sequence(
      g.CssAstKeyframeSelector,
      many(sequence(many(blockComment), literal(','), many(blockComment), g.CssAstKeyframeSelector)),
      many(blockComment),
      literal('{'),
      // This is the public descriptorBody shape: empty declaration statements
      // are syntactically valid and deliberately have no AST statement node.
      many(cssDeclarationBody),
      literal('}')
    ),
    children => rule(keyframeSelectorList(children), children.filter((value): value is Comment | Declaration => isComment(value) || isDeclaration(value)))
  );
  const CssAstKeyframes = node(
    'CssAstKeyframes',
    sequence(keyframesAtKeyword, g.CssAstAtPrelude, literal('{'), many(choice(g.CssAstComment, g.CssAstKeyframeBlock)), literal('}')),
    (children) => {
      return atRuleBlock(tokenText(children[0]), optionalValue(children[1]), blockStatements(children));
    }
  );
  const CssAstRuleset = node(
    'CssAstRuleset',
    sequence(
      parser({ trivia: interstitialTrivia }, g.CssAstSelector),
      // The CST grammar accepts a block comment after a qualified-rule
      // selector. Spell that boundary explicitly in the direct public grammar:
      // it is trivia between the selector and `{`, never a body statement.
      many(blockComment),
      parser({ trivia: interstitialTrivia }, literal('{')),
      many(cssNestedBody),
      literal('}')
    ),
    (children) => {
      const selector = children.find(isSelectorList);
      if (selector === undefined) {
        throw new Error('CssAstRuleset requires a selector');
      }
      return rule(selector, rulesetStatements(children));
    }
  );
  const CssAstConditionalBlock = node(
    'CssAstConditionalBlock',
    choice(
      sequence(
        supportsAtKeyword,
        many(blockComment),
        parser({ trivia: interstitialTrivia }, g.CssAstSupportsPrelude),
        many(blockComment),
        literal('{'),
        many(cssConditionalBody),
        literal('}')
      ),
      sequence(
        mediaAtKeyword,
        g.CssAstQueryPrelude,
        literal('{'),
        many(cssConditionalBody),
        literal('}')
      ),
      sequence(
        containerAtKeyword,
        not(g.CssAstSyntaxQueryOnly),
        g.CssAstQueryPrelude,
        literal('{'),
        many(cssConditionalBody),
        literal('}')
      )
    ),
    (children) => {
      return atRuleBlock(tokenText(children[0]!), children.find(isValue)!, blockStatements(children));
    }
  );
  const CssAstNestedConditionalBlock = node(
    'CssAstNestedConditionalBlock',
    choice(
      sequence(
        supportsAtKeyword,
        many(blockComment),
        parser({ trivia: interstitialTrivia }, g.CssAstSupportsPrelude),
        many(blockComment),
        literal('{'),
        many(cssNestedBody),
        literal('}')
      ),
      sequence(
        mediaAtKeyword,
        g.CssAstQueryPrelude,
        literal('{'),
        many(cssNestedBody),
        literal('}')
      ),
      sequence(
        containerAtKeyword,
        not(g.CssAstSyntaxQueryOnly),
        g.CssAstQueryPrelude,
        literal('{'),
        many(cssNestedBody),
        literal('}')
      )
    ),
    (children) => {
      return atRuleBlock(tokenText(children[0]!), children.find(isValue)!, rulesetStatements(children));
    }
  );
  const CssAstDescriptorBlock = node(
    'CssAstDescriptorBlock',
    sequence(
      descriptorAtKeyword,
      g.CssAstAtPrelude,
      literal('{'),
      many(cssDeclarationBody),
      literal('}')
    ),
    children => atRuleBlock(
      tokenText(children[0]),
      children.find(isValue) ?? null,
      children.filter((value): value is Comment | Declaration => isComment(value) || isDeclaration(value))
    )
  );
  // `@font-feature-values` admits exactly seven named feature blocks, each
  // containing declarations only. Preserve that public grammar shape rather
  // than lowering either level to an ordinary CSS ruleset.
  const CssAstFontFeatureValueBlock = node(
    'CssAstFontFeatureValueBlock',
    sequence(
      g.CssAstSyntaxFontFeatureValueAtKeyword,
      many(blockComment),
      literal('{'),
      many(cssDeclarationBody),
      literal('}')
    ),
    children => atRuleBlock(
      tokenText(children[0]!),
      null,
      children.filter((value): value is Comment | Declaration => isComment(value) || isDeclaration(value))
    )
  );
  const CssAstFontFeatureValuesBlock = node(
    'CssAstFontFeatureValuesBlock',
    sequence(
      fontFeatureValuesAtKeyword,
      g.CssAstAtPrelude,
      literal('{'),
      many(choice(g.CssAstComment, g.CssAstFontFeatureValueBlock)),
      literal('}')
    ),
    children => atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      children.filter((value): value is Comment | AtRuleBlock => isComment(value) || isAtRuleBlock(value))
    )
  );
  const CssAstScopeBlock = node(
    'CssAstScopeBlock',
    sequence(
      scopeAtKeyword,
      g.CssAstAtPrelude,
      literal('{'),
      // `@scope` has the public declaration-list body model, so a nested
      // scope retains the existing canonical AtRuleBlock reduction rather than
      // being rejected or routed through an opaque body.
      many(cssNestedBody),
      literal('}')
    ),
    children => atRuleBlock(tokenText(children[0]!), optionalValue(children[1]), rulesetStatements(children))
  );
  const CssAstStartingStyleBlock = node(
    'CssAstStartingStyleBlock',
    sequence(
      startingStyleAtKeyword,
      g.CssAstAtPrelude,
      literal('{'),
      many(choice(g.CssAstComment, g.CssAstAtRuleStatement, g.CssAstConditionalBlock, g.CssAstDescriptorBlock, g.CssAstFontFeatureValuesBlock, g.CssAstScopeBlock, g.CssAstLayerBlock, g.CssAstStartingStyleBlock, g.CssAstPageBlock, g.CssAstKeyframes, g.CssAstDocumentBlock, g.CssAstOpaqueAtRuleBlock, g.CssAstRuleset)),
      literal('}')
    ),
    children => atRuleBlock(tokenText(children[0]), optionalValue(children[1]), blockStatements(children))
  );
  const CssAstNestedStartingStyleBlock = node(
    'CssAstNestedStartingStyleBlock',
    sequence(
      startingStyleAtKeyword,
      g.CssAstAtPrelude,
      literal('{'),
      many(cssNestedBody),
      literal('}')
    ),
    children => atRuleBlock(tokenText(children[0]), optionalValue(children[1]), rulesetStatements(children))
  );
  const CssAstDocumentBlock = node(
    'CssAstDocumentBlock',
    sequence(
      documentAtKeyword,
      g.CssAstAtPrelude,
      literal('{'),
      many(cssBlockBody),
      literal('}')
    ),
    children => atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      blockStatements(children)
    )
  );
  const CssAstDocument = node(
    'CssAstDocument',
    many(choice(g.CssAstComment, g.CssAstImport, g.CssAstAtRuleStatement, g.CssAstConditionalBlock, g.CssAstDescriptorBlock, g.CssAstFontFeatureValuesBlock, g.CssAstScopeBlock, g.CssAstStartingStyleBlock, g.CssAstLayerBlock, g.CssAstPageBlock, g.CssAstKeyframes, g.CssAstDocumentBlock, g.CssAstOpaqueAtRuleBlock, g.CssAstRuleset)),
    children => stylesheet(documentStatements(children)),
    { trailingTrivia: true }
  );
  return {
    CssAstDocument,
    CssAstComment,
    CssAstSelector,
    CssAstComplex,
    CssAstCompound,
    CssAstSimple,
    CssAstAttribute,
    CssAstPseudo,
    CssAstPseudoArgument,
    CssAstOfTypePseudoArgument,
    CssAstLeadingDashPseudoArgument,
    CssAstTypedNthPseudoArgument,
    CssAstLeadingDashOfTypePseudoArgument,
    CssAstTypedOfTypePseudoArgument,
    CssAstLeadingDashRawPseudoArgument,
    CssAstNestingSelector,
    CssAstProperty,
    CssAstCustomProperty,
    CssAstCustomValue,
    CssAstKeyword,
    CssAstColor,
    CssAstDimension,
    CssAstQuoted,
    CssAstUrl,
    CssAstCall,
    CssAstCalcCall,
    CssAstCalcVarFallbackPunctuation,
    CssAstCalcVarFallbackParen,
    CssAstCalcVarFallbackBracket,
    CssAstCalcVarFallbackBrace,
    CssAstCalcVarFallbackCall,
    CssAstCalcVarFallbackTerm,
    CssAstCalcVarFallbackEmpty,
    CssAstCalcVarFallbackItem,
    CssAstCalcVarFallback,
    CssAstCalcVarCall,
    CssAstCalcParen,
    CssAstDeclarationVarCall,
    CssAstDeclarationCall,
    CssAstDeclarationIdent,
    CssAstDeclarationParen,
    CssAstDeclarationAny,
    CssAstDeclarationValueAtom,
    CssAstDeclarationValueTerm,
    CssAstDeclarationExtendedValue,
    CssAstDeclarationValue,
    CssAstCalcValue,
    CssAstMathProduct,
    CssAstMathSum,
    CssAstValueAtom,
    CssAstValueTerm,
    CssAstValue,
    CssAstImportant,
    CssAstDeclaration,
    CssAstImport,
    CssAstImportUrl,
    CssAstImportUrlUnquoted,
    CssAstImportTailRaw,
    CssAstImportTailBody,
    CssAstImportTail,
    CssAstAtRuleStatement,
    CssAstAtPrelude,
    CssAstStatementPrelude,
    CssAstOpaqueAtPrelude,
    CssAstOpaqueBody,
    CssAstOpaqueAtRuleBlock,
    CssAstQueryBareFeature,
    CssAstQueryRangeFeature,
    CssAstQueryFeature,
    CssAstQueryClause,
    CssAstQueryPrelude,
    CssAstQueryFunction,
    CssAstGeneralEnclosed,
    CssAstGeneralEnclosedContent,
    CssAstGeneralEnclosedGroup,
    CssAstGeneralEnclosedQuoted,
    CssAstSupportsInParens,
    CssAstSupportsCondition,
    CssAstSupportsPrelude,
    CssAstLayerBlock,
    CssAstNestedLayerBlock,
    CssAstConditionalBlock,
    CssAstNestedConditionalBlock,
    CssAstDescriptorBlock,
    CssAstFontFeatureValueBlock,
    CssAstFontFeatureValuesBlock,
    CssAstScopeBlock,
    CssAstStartingStyleBlock,
    CssAstNestedStartingStyleBlock,
    CssAstDocumentBlock,
    CssAstMarginBox,
    CssAstPageBlock,
    CssAstKeyframeSelector,
    CssAstKeyframeBlock,
    CssAstKeyframes,
    CssAstRuleset,
    whitespace
  };
})]);
