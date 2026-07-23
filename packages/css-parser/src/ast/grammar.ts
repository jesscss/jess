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
  CssAstLeadingDashPseudoArgument: Combinator<string>;
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
const nthPseudoNameWithArgument = regex(/nth-(?:last-)?(?:child|of-type)(?=\()/i);
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
// `@import` is a CSS statement at-rule with a required target. Its dedicated
// grammar retains the prelude as grammar-owned bytes while it validates that
// target; loading and resolution are not parser or AST responsibilities.
const importAtKeyword = regex(/@import(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const urlName = regex(/url(?![-_a-zA-Z0-9\u0080-\uffff\\])/i);
const importTailWhitespace = regex(/[ \t\n\r\f]+/);
const importTailText = regex(/[^()[\]"'\/; \t\n\r\f]+/);
const keyframePercent = regex(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)%/);
const keyframeEndpoint = regex(/(?:from|to)(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const combinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
const customDoubleQuotedText = regex(/(?:[^"\\]|\\[\s\S])*/);
const customSingleQuotedText = regex(/(?:[^'\\]|\\[\s\S])*/);
const customEscape = regex(/\\[^\n\r\f]/);
const customDoubleQuoted = sequence(literal('"'), customDoubleQuotedText, literal('"'));
const customSingleQuoted = sequence(literal('\''), customSingleQuotedText, literal('\''));
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
    balanced('(', ')', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
    balanced('[', ']', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
    balanced('{', '}', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] })
  ]
});
const nestedImportTailGroup = balanced('(', ')', {
  skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted]
});
const nestedImportTailSquare = balanced('[', ']', {
  skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted]
});
const importTailGroup = sequence(
  literal('('),
  scanTo(literal(')'), {
    skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, nestedImportTailGroup]
  }),
  expect(literal(')'), ')')
);
const importTailSquareGroup = sequence(
  literal('['),
  scanTo(literal(']'), {
    skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, nestedImportTailSquare]
  }),
  expect(literal(']'), ']')
);
export const cssAstGrammar = composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, rules<CssAstLocalRules>({ trivia: whitespace }, (g) => {
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
  const CssAstSimple = node('CssAstSimple', g.CssAstSyntaxSimple, children => simpleSelector(tokenText(children[0])));
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
      optional(sequence(optional(blockComment), regex(/of(?![-\w])/i), g.CssAstSelector)),
      regex(/(?=\))/)
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
  const CssAstPseudoArgument = node<string>(
    'CssAstPseudoArgument',
    choice(
      g.CssAstLeadingDashPseudoArgument,
      g.CssAstLeadingDashRawPseudoArgument,
      parser({ trivia: interstitialTrivia }, g.CssAstSelector),
      sequence(not(g.CssAstSyntaxMalformedPseudoNumericArgument), pseudoRawArgument)
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
  // Both pseudo arms share the leading `:`/`::` colon. Left-factor it so that
  // sub-rule runs once per pseudo instead of once per arm; the An+B and generic
  // branches then differ only after the colon. Both original reducers already
  // collapse to the same "head, plus optional (arg) at child index 3" shape, so
  // the merged node keeps byte-identical SimpleSelector text.
  const CssAstPseudo = node<SimpleToken>(
    'CssAstPseudo',
    sequence(
      g.CssAstSyntaxPseudoColon,
      choice(
        sequence(nthPseudoNameWithArgument, literal('('), g.CssAstPseudoArgument, literal(')')),
        sequence(not(nthPseudoNameWithArgument), g.CssAstSyntaxKeyword, optional(sequence(literal('('), CssAstGenericPseudoArgument, literal(')'))))
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
  const CssAstColor = node('CssAstColor', g.CssAstSyntaxHexColor, children => color(tokenText(children[0])));
  const CssAstDimension = node(
    'CssAstDimension',
    noTrivia(sequence(g.CssAstSyntaxNumber, optional(g.CssAstSyntaxDimensionUnit))),
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
    children => block(valueChildren(children)[0]!)
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
  // because the outer leaf sees its own closer first.
  const calcVarFallbackNestedBracket = balanced('[', ']', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] });
  const calcVarFallbackNestedBrace = balanced('{', '}', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] });
  const calcVarFallbackBracketCrossParen = sequence(
    literal('['),
    scanTo(literal('('), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, calcVarFallbackNestedBracket] }),
    literal('('),
    scanTo(choice(literal(')'), literal(']')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, calcVarFallbackNestedBracket] }),
    literal(']')
  );
  const calcVarFallbackBracketCrossBrace = sequence(
    literal('['),
    scanTo(literal('{'), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, calcVarFallbackNestedBracket] }),
    literal('{'),
    scanTo(choice(literal('}'), literal(']')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, calcVarFallbackNestedBracket] }),
    literal(']')
  );
  const calcVarFallbackBraceCrossParen = sequence(
    literal('{'),
    scanTo(literal('('), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, calcVarFallbackNestedBrace] }),
    literal('('),
    scanTo(choice(literal(')'), literal('}')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, calcVarFallbackNestedBrace] }),
    literal('}')
  );
  const calcVarFallbackBraceCrossBracket = sequence(
    literal('{'),
    scanTo(literal('['), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, calcVarFallbackNestedBrace] }),
    literal('['),
    scanTo(choice(literal(']'), literal('}')), { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, calcVarFallbackNestedBrace] }),
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
          balanced('[', ']', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] })
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
          balanced('{', '}', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] })
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
    children => valueSlotChildren(children)[0]!
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
    children => valueChildren(children)[0]!
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
    children => funcCall(tokenText(children[0]), [valueChildren(children)[0]!])
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
    choice(
      noTrivia(sequence(not(sequence(literal('/'), literal('*'))), literal('/'), regex(/(?=[.0-9 \t\n\r\f])/))),
      sequence(not(sequence(literal('/'), literal('*'))), oneOrMore(declarationAnyCharacter))
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
    // function, including after a prior component (`0 calc(...)`). It must
    // still be selected at its own opener: the guard keeps a malformed calc
    // from degrading into Keyword("calc") followed by a permissive paren.
    choice(
      g.CssAstCalcCall,
      sequence(
        not(regex(/(?=calc\()/i)),
        choice(g.CssAstDimension, g.CssAstColor, g.CssAstUrl, g.CssAstDeclarationVarCall, g.CssAstDeclarationCall, g.CssAstDeclarationParen, g.CssAstQuoted, CssAstCustomPropertyValue, g.CssAstKeyword, g.CssAstDeclarationAny)
      )
    ),
    children => valueChildren(children)[0]!
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
    children => valueSlotChildren(children)[0]!
  );
  const CssAstValueAtom = node(
    'CssAstValueAtom',
    choice(g.CssAstDimension, g.CssAstColor, g.CssAstUrl, g.CssAstCalcCall, g.CssAstCall, g.CssAstQuoted, CssAstCustomPropertyValue, g.CssAstKeyword),
    children => valueChildren(children)[0]!
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
    sequence(many(blockComment), literal('!'), many(blockComment), g.CssAstSyntaxImportant, many(blockComment)),
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
    sequence(g.CssAstSyntaxStatementAtRuleName, g.CssAstStatementPrelude, literal(';')),
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
      balanced('(', ')', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
      balanced('[', ']', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] })
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
      balanced('(', ')', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }),
      balanced('[', ']', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] })
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
      g.CssAstSyntaxGenericAtRuleName,
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
    children => block(operation(':', keyword(tokenText(children[1]!)), valueChildren(children)[0]!))
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
    children => valueChildren(children)[0]!
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
    children => valueChildren(children)[0]!
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
          balanced('(', ')', { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] })
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
      const value = valueChildren(children)[0]!;
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
    sequence(g.CssAstSyntaxLayerAtKeyword, g.CssAstAtPrelude, literal('{'), many(cssBlockBody), literal('}')),
    children => atRuleBlock(tokenText(children[0]!), optionalValue(children[1]), blockStatements(children))
  );
  const CssAstNestedLayerBlock = node(
    'CssAstNestedLayerBlock',
    sequence(g.CssAstSyntaxLayerAtKeyword, g.CssAstAtPrelude, literal('{'), many(cssNestedBody), literal('}')),
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
      g.CssAstSyntaxPageAtKeyword,
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
    sequence(g.CssAstSyntaxKeyframesAtKeyword, g.CssAstAtPrelude, literal('{'), many(choice(g.CssAstComment, g.CssAstKeyframeBlock)), literal('}')),
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
        g.CssAstSyntaxSupportsAtKeyword,
        many(blockComment),
        parser({ trivia: interstitialTrivia }, g.CssAstSupportsPrelude),
        many(blockComment),
        literal('{'),
        many(cssConditionalBody),
        literal('}')
      ),
      sequence(
        g.CssAstSyntaxMediaAtKeyword,
        g.CssAstQueryPrelude,
        literal('{'),
        many(cssConditionalBody),
        literal('}')
      ),
      sequence(
        g.CssAstSyntaxContainerAtKeyword,
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
        g.CssAstSyntaxSupportsAtKeyword,
        many(blockComment),
        parser({ trivia: interstitialTrivia }, g.CssAstSupportsPrelude),
        many(blockComment),
        literal('{'),
        many(cssNestedBody),
        literal('}')
      ),
      sequence(
        g.CssAstSyntaxMediaAtKeyword,
        g.CssAstQueryPrelude,
        literal('{'),
        many(cssNestedBody),
        literal('}')
      ),
      sequence(
        g.CssAstSyntaxContainerAtKeyword,
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
      g.CssAstSyntaxDescriptorAtKeyword,
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
      g.CssAstSyntaxFontFeatureValuesAtKeyword,
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
      g.CssAstSyntaxScopeAtKeyword,
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
      g.CssAstSyntaxStartingStyleAtKeyword,
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
      g.CssAstSyntaxStartingStyleAtKeyword,
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
      g.CssAstSyntaxDocumentAtKeyword,
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
    CssAstLeadingDashPseudoArgument,
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
