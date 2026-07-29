/**
 * Canonical CSS grammar.
 *
 * Parseman reductions call core AST constructors directly in the default
 * artifact. The CST artifact is compiled from the same factory with
 * `hostMode: 'cst'` for language-service and dialect composition use.
 *
 * Dialect grammar dependents:
 * - Less: ../../../less/less-parser/src/grammar.ts
 * - SCSS: ../../../scss/scss-parser/src/grammar.ts
 * - Jess: ../../../jess/jess-parser/src/grammar.ts
 */
import { balanced, choice, composeLeaf, dispatch, endsWith, expect, field, keywords, literal, makeWhen, makeWord, many, noTrivia, node, not, oneOrMore, oneOrMoreSep, optional, otherwise, parser, peek, regex, routed, rules, scanTo, sepBy, sequence, token, trivia, when } from 'parseman' with { type: 'macro' };
import type { Combinator, FieldMap } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { opaqueAtRuleRecognition } from '@jesscss/parser-shared/opaque-at-rule';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';
import {
  any,
  atRuleBlock,
  atRuleStatement,
  color,
  selectorBranchCanonical,
  selectorBranchOf,
  relativeSelector,
  selectorTermOf,
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
  withBodySpan,
  withSourceSpan,
  withValueLayout
} from '@jesscss/core/ast';
import type {
  AtRuleBlock,
  OpaqueAtRuleBlock,
  CompoundSelector as AstCompoundSelector,
  Color as AstColor,
  Declaration as AstDeclaration,
  Dimension as AstDimension,
  Interpolation,
  Keyword,
  Quoted as AstQuoted,
  Ruleset as AstRuleset,
  SelectorBranch as AstSelectorBranch,
  SelectorList as AstSelectorList,
  SelectorTerm as AstSelectorTerm,
  SimpleSelector,
  SimpleToken,
  Statement,
  ValueNode,
  ValueSlot,
  Url as AstUrl
} from '@jesscss/core/ast';

type SourceSpan = { readonly start: number; readonly end: number };
type SpannedToken = { readonly value: unknown; readonly span: SourceSpan };

type CssGrammarRuleName =
  | 'AtPrelude'
  | 'AtRulePreludeSegments'
  | 'AtRuleStatement'
  | 'AttributeSelector'
  | 'BasicSelector'
  | 'CalcCall'
  | 'CalcIdentOrFunction'
  | 'CalcParen'
  | 'CalcProduct'
  | 'CalcSum'
  | 'CalcValue'
  | 'Call'
  | 'Color'
  | 'ComplexSelector'
  | 'CompoundSelector'
  | 'ConditionalBlock'
  | 'ConditionalGroupAtRule'
  | 'ContainerPrelude'
  | 'ContainerQueryClause'
  | 'ContainerQueryPrelude'
  | 'CssOpaqueCaptureBody'
  | 'CssOpaqueCapturePrelude'
  | 'CssSyntax'
  | 'CssSyntaxAttributeModifier'
  | 'CssSyntaxAttributeOperator'
  | 'CssSyntaxConditionalAtKeyword'
  | 'CssSyntaxContainerAtKeyword'
  | 'CssSyntaxCustomProperty'
  | 'CssSyntaxDescriptorAtKeyword'
  | 'CssSyntaxDocumentAtKeyword'
  | 'CssSyntaxDoubleQuotedText'
  | 'CssSyntaxFontFeatureValueAtKeyword'
  | 'CssSyntaxFontFeatureValuesAtKeyword'
  | 'CssSyntaxGenericAtRuleName'
  | 'CssSyntaxImportant'
  | 'CssSyntaxKeyframesAtKeyword'
  | 'CssSyntaxKeyword'
  | 'CssSyntaxLayerAtKeyword'
  | 'CssSyntaxMalformedPseudoNumericArgument'
  | 'CssSyntaxMarginAtKeyword'
  | 'CssSyntaxMediaAtKeyword'
  | 'CssSyntaxNth'
  | 'CssSyntaxNthChildName'
  | 'CssSyntaxNthName'
  | 'CssSyntaxNthTypeName'
  | 'CssSyntaxOfKeyword'
  | 'CssSyntaxPageAtKeyword'
  | 'CssSyntaxProperty'
  | 'CssSyntaxPseudoCloseAhead'
  | 'CssSyntaxQueryAndOr'
  | 'CssSyntaxQueryComparisonOperator'
  | 'CssSyntaxQueryFunctionOpen'
  | 'CssSyntaxQueryNot'
  | 'CssSyntaxQueryOnly'
  | 'CssSyntaxRoutedAtRuleKeyword'
  | 'CssSyntaxScopeAtKeyword'
  | 'CssSyntaxSelectorArgPseudoName'
  | 'CssSyntaxSingleQuotedText'
  | 'CssSyntaxStartingStyleAtKeyword'
  | 'CssSyntaxStatementAtRuleName'
  | 'CssSyntaxSupportsAtKeyword'
  | 'CssSyntaxUnicodeRange'
  | 'CssSyntaxUrlInner'
  | 'CssSyntaxUrlOpen'
  | 'CustomProperty'
  | 'CustomValue'
  | 'Declaration'
  | 'DeclarationListAtRule'
  | 'PunctuationValue'
  | 'ParenValue'
  | 'RawParenValue'
  | 'DescriptorBlock'
  | 'Dimension'
  | 'DocumentBlock'
  | 'FeatureValueBlock'
  | 'FontFeatureValuesBlock'
  | 'GeneralEnclosed'
  | 'GeneralEnclosedContent'
  | 'GeneralEnclosedGroup'
  | 'GeneralEnclosedQuoted'
  | 'ImportStatement'
  | 'ImportTail'
  | 'ImportTailBody'
  | 'ImportTailRaw'
  | 'ImportUrl'
  | 'ImportUrlUnquoted'
  | 'Important'
  | 'KeyframeBlock'
  | 'Keyframes'
  | 'Keyword'
  | 'LayerBlock'
  | 'LayerStatement'
  | 'LeadingDashOfTypePseudoArgument'
  | 'LeadingDashPseudoArgument'
  | 'LeadingDashRawPseudoArgument'
  | 'MarginAtRule'
  | 'NestedConditionalBlock'
  | 'NestedLayerBlock'
  | 'NestedStartingStyleBlock'
  | 'NestingSelector'
  | 'OfTypePseudoArgument'
  | 'OpaqueAtPrelude'
  | 'OpaqueAtRuleBlock'
  | 'OpaqueBody'
  | 'PageBlock'
  | 'Percentage'
  | 'Property'
  | 'PseudoArgument'
  | 'PseudoSelector'
  | 'QueryClause'
  | 'QueryFeature'
  | 'QueryFunction'
  | 'QueryPrelude'
  | 'Quoted'
  | 'Ruleset'
  | 'ScopeBlock'
  | 'SelectorList'
  | 'StartingStyleBlock'
  | 'StylesheetAtRule'
  | 'StatementPrelude'
  | 'SupportsCondition'
  | 'SupportsInParens'
  | 'SupportsPrelude'
  | 'TopLevelComplexSelector'
  | 'TopLevelCompoundSelector'
  | 'TopLevelRuleset'
  | 'TopLevelSelectorList'
  | 'TypedNthPseudoArgument'
  | 'TypedOfTypePseudoArgument'
  | 'UnicodeRange'
  | 'Url'
  | 'Value'
  | 'ValueList'
  | 'ValueSequence'
  | 'TypedValue'
  | 'TypedValueList'
  | 'TypedValueSequence'
  | 'VarCall'
  | 'VarFallback'
  | 'VarFallbackBrace'
  | 'VarFallbackBracket'
  | 'VarFallbackCall'
  | 'VarFallbackEmpty'
  | 'VarFallbackItem'
  | 'VarFallbackParen'
  | 'VarFallbackPunctuation'
  | 'VarFallbackTerm'
  | 'keyframeSelector';

type CssGrammarSelf = { readonly [K in CssGrammarRuleName]: Combinator<unknown> };

function tokenText(child: unknown): string {
  if (typeof child === 'string') {
    return child;
  }
  if (typeof child === 'object' && child !== null && 'value' in child && typeof child.value === 'string') {
    return child.value;
  }
  throw new Error('CSS AST grammar lost a required token');
}

function functionOpenName(child: unknown): string {
  const value = tokenText(child);
  return value.endsWith('(') ? value.slice(0, -1) : value;
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
  return separators.length === expected
    ? withValueLayout(
        value,
        separators
      )
    : value;
}

function sourceText(child: unknown): string {
  if (typeof child === 'object' && child !== null && 'src' in child && typeof child.src === 'string') {
    return child.src;
  }
  return tokenText(child);
}

function semanticGapText(text: string): string {
  let out = '';
  let inGap = false;
  for (const char of text) {
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f') {
      if (!inGap) {
        out += ' ';
        inGap = true;
      }
    } else {
      out += char;
      inGap = false;
    }
  }
  return out;
}

function semanticTextWithTriviaGaps(children: readonly unknown[], triviaLog: readonly number[]): string {
  const gapBefore = new Set<number>();
  for (let index = 2; index < triviaLog.length; index += 3) {
    gapBefore.add(triviaLog[index] ?? 0);
  }

  let text = '';
  for (let index = 0; index < children.length; index++) {
    if (gapBefore.has(index)) {
      text += ' ';
    }
    text += sourceText(children[index]);
  }
  if (gapBefore.has(children.length)) {
    text += ' ';
  }

  return semanticGapText(text);
}

function isSpannedToken(value: unknown): value is SpannedToken {
  return typeof value === 'object'
    && value !== null
    && 'value' in value
    && 'span' in value
    && typeof value.span === 'object'
    && value.span !== null
    && 'start' in value.span
    && 'end' in value.span
    && typeof value.span.start === 'number'
    && typeof value.span.end === 'number';
}

function bodySpanFromRaw(rawChildren: readonly unknown[]): SourceSpan | undefined {
  let start: number | undefined;
  let end: number | undefined;
  for (const child of rawChildren) {
    if (!isSpannedToken(child)) {
      continue;
    }
    if (child.value === '{' && start === undefined) {
      start = child.span.end;
    } else if (child.value === '}') {
      end = child.span.start;
    }
  }
  return start === undefined || end === undefined || end < start ? undefined : { start, end };
}

function withBlockBody<T extends object>(node: T, rawChildren: readonly unknown[]): T {
  const span = bodySpanFromRaw(rawChildren);
  return span === undefined ? node : withBodySpan(node, span);
}

function isNodeType<T extends string>(value: unknown, type: T): value is { readonly type: T } {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === type;
}

function isSimple(value: unknown): value is SimpleSelector {
  return isNodeType(
    value,
    'SimpleSelector'
  );
}

function isSimpleToken(value: unknown): value is SimpleToken {
  return isNodeType(
    value,
    'SimpleSelector'
  ) || isNodeType(
    value,
    'PseudoSelector'
  );
}

/*
 * Selector-function pseudos whose argument is retained as a structured
 * `SelectorList` (P0). Gated on the pseudo NAME (lowercased, colon-stripped),
 * never on colon count — `::slotted()` takes selector args but is absent here,
 * so it stays opaque text. `crossable` (a narrower set) is decided in core.
 */
const STRUCTURED_PSEUDOS = new Set(['is', 'where', 'not', 'has', 'matches']);

function isCompound(value: unknown): value is AstCompoundSelector {
  return isNodeType(
    value,
    'CompoundSelector'
  );
}

function isSelectorTerm(value: unknown): value is AstSelectorTerm {
  return isSimpleToken(value) || isCompound(value);
}

function selectorTermFromTokens(tokens: SimpleToken[]): AstSelectorTerm {
  const [first, ...rest] = tokens;
  if (first === undefined) {
    throw new TypeError('CSS selector production produced no simple selector tokens.');
  }
  return selectorTermOf([first, ...rest]);
}

function isComplex(value: unknown): value is Extract<AstSelectorBranch, { readonly type: 'ComplexSelector' }> {
  return isNodeType(
    value,
    'ComplexSelector'
  );
}

function isRelative(value: unknown): value is Extract<AstSelectorBranch, { readonly type: 'RelativeSelector' }> {
  return isNodeType(
    value,
    'RelativeSelector'
  );
}

function isSelectorBranch(value: unknown): value is AstSelectorBranch {
  return isSelectorTerm(value) || isComplex(value) || isRelative(value);
}

function isSelectorList(value: unknown): value is AstSelectorList {
  return isNodeType(
    value,
    'SelectorList'
  );
}

function isKeyword(value: unknown): value is Keyword {
  return isNodeType(
    value,
    'Keyword'
  );
}

function isInterpolation(value: unknown): value is Interpolation {
  return isNodeType(
    value,
    'Interpolation'
  );
}

function isDeclaration(value: unknown): value is AstDeclaration {
  return isNodeType(
    value,
    'Declaration'
  );
}

function isRuleset(value: unknown): value is AstRuleset {
  return isNodeType(
    value,
    'Ruleset'
  );
}

function isAtRuleBlock(value: unknown): value is AtRuleBlock {
  return isNodeType(
    value,
    'AtRuleBlock'
  );
}

function isOpaqueAtRuleBlock(value: unknown): value is OpaqueAtRuleBlock {
  return isNodeType(
    value,
    'OpaqueAtRuleBlock'
  );
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
  if (value.type === 'Block' && isValue(value.value) && value.value.type === 'SpacedValue') {
    return { ...value, value: value.value.parts };
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
  let result = operation(
    operators[0]!,
    left,
    values[0]!
  );
  for (let index = 1; index < operators.length; index++) {
    const right = values[index];
    if (right === undefined) {
      throw new Error('CSS AST query comparison lost its chained value');
    }
    result = operation(
      operators[index]!,
      result,
      right
    );
  }
  return result;
}

function isImportTarget(value: unknown): value is AstQuoted | { readonly type: 'Url'; readonly value: ValueNode } {
  return isNodeType(
    value,
    'Quoted'
  ) || isNodeType(
    value,
    'Url'
  );
}

/** CSS `@import` is an ordinary statement at-rule. Its dedicated grammar only
 * validates the required target and retains its authored prelude; it does not
 * make import loading or resolution part of the AST. */
function importPrelude(target: AstQuoted | { readonly type: 'Url'; readonly value: ValueNode }, tail: ValueNode | null): ValueNode {
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
  return isRuleset(value)
    || isNodeType(
      value,
      'AtRuleStatement'
    )
    || isNodeType(
      value,
      'AtRuleBlock'
    )
    || isOpaqueAtRuleBlock(value);
}

function selectorBranches(children: readonly unknown[]): AstSelectorBranch[] {
  const selectors = children.filter(isSelectorBranch);
  if (selectors.length === 0) {
    throw new Error('SelectorList requires a selector branch');
  }
  return selectors;
}

function selectorArgumentText(value: unknown): string {
  if (isSelectorList(value)) {
    return value.selectors.map(selectorBranchCanonical).join(',');
  }
  return tokenText(value);
}

type CssComplexSegment = { combinator?: ' ' | '>' | '+' | '~' | '|' | '||'; term: AstSelectorTerm };

function complexSegments(children: readonly unknown[]): [CssComplexSegment, ...CssComplexSegment[]] {
  const segments: Array<{ combinator?: ' ' | '>' | '+' | '~' | '|' | '||'; term: AstSelectorTerm }> = [];
  let combinator: ' ' | '>' | '+' | '~' | '|' | '||' = ' ';
  for (const child of children) {
    if (isSelectorTerm(child)) {
      segments.push(segments.length === 0 ? { term: child } : { combinator, term: child });
      combinator = ' ';
      continue;
    }
    const token = tokenText(child);
    if (token !== '>' && token !== '+' && token !== '~' && token !== '|' && token !== '||') {
      throw new Error('ComplexSelector has an invalid combinator');
    }
    combinator = token;
  }
  const [first, ...rest] = segments;
  if (first === undefined) {
    throw new Error('ComplexSelector requires a compound selector');
  }
  return [first, ...rest];
}

function branchSegments(branch: AstSelectorBranch): [CssComplexSegment, ...CssComplexSegment[]] {
  if (branch.type !== 'ComplexSelector' && branch.type !== 'RelativeSelector') {
    return [{ term: branch }];
  }
  const segments: CssComplexSegment[] = [];
  let combinator: ' ' | '>' | '+' | '~' | '|' | '||' = ' ';
  const start = branch.type === 'RelativeSelector' ? 1 : 0;
  for (let index = start; index < branch.value.length; index++) {
    const part = branch.value[index]!;
    if (typeof part === 'string') {
      combinator = part;
    } else {
      segments.push(segments.length === 0 ? { term: part } : { combinator, term: part });
      combinator = ' ';
    }
  }
  const [first, ...rest] = segments;
  if (first === undefined) {
    throw new TypeError('CSS selector branch produced no selector terms.');
  }
  return [first, ...rest];
}

function valueChildren(children: readonly unknown[]): ValueNode[] {
  const values = children.filter(isValue);
  if (values.length === 0) {
    throw new Error('CSS AST value grammar lost its value child');
  }
  return values;
}

function flattenSpacedValues(values: readonly ValueNode[]): ValueNode[] {
  const flattened: ValueNode[] = [];
  for (const value of values) {
    if (value.type === 'SpacedValue') {
      flattened.push(...value.parts);
      continue;
    }
    flattened.push(value);
  }
  return flattened;
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
    result = operation(
      tokenText(operatorToken).trim(),
      result,
      right
    );
  }
  return result;
}

function rulesetStatements(children: readonly unknown[]): Statement[] {
  return children.filter(isRulesetStatement);
}

function documentStatements(children: readonly unknown[]): Statement[] {
  const statements = children.filter(isDocumentStatement);
  if (statements.length !== children.length) {
    throw new Error('Stylesheet has an unexpected child');
  }
  return statements;
}

function blockStatements(children: readonly unknown[]): Statement[] {
  return children.filter(isDocumentStatement);
}

function keyframeSelectorList(children: readonly unknown[]): AstSelectorList {
  const selectors = children.filter(isSimple);
  if (selectors.length === 0) {
    throw new Error('KeyframeBlock requires a keyframe selector');
  }
  return selist(...selectors);
}

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespace = trivia(oneOrMore(choice(
  regex(/[ \t\n\r\f]+/),
  blockComment
)));

/*
 * Value-slot boundaries are authored trivia, not semantic leaves. Capture the
 * complete run so raw ValueSlot arrays can replay comments/newlines/indentation
 * without growing a public `separators` field.
 */
const cssValueTrivia = regex(/(?:[ \t\n\r\f]+|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);

/*
 * Block comments are grammar trivia. noTrivia lexical leaves still cannot glue
 * `10/*x*\/px` into one Dimension.
 */
const interstitialTrivia = trivia(oneOrMore(choice(
  regex(/[ \t\n\r\f]+/),
  blockComment
)));
const compoundTrivia = trivia(oneOrMore(blockComment));
const commentTrivia = trivia(oneOrMore(blockComment));
const calcWhitespace = regex(/[ \t\n\r\f]+/);
const calcProductOperator = regex(/[ \t\n\r\f]*[*/%][ \t\n\r\f]*/);
const calcSumOperator = regex(/[ \t\n\r\f]+[-+][ \t\n\r\f]+/);
const genericIdentifier = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
const genericFunctionIdentifier = regex(/(?!(?:calc|url|var)(?=\())-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
const genericFunctionOpen = noTrivia(sequence(
  genericFunctionIdentifier,
  literal('(')
));
const customEscape = regex(/\\[^\n\r\f]/);

/*
 * Only the Selectors An+B pseudo families give a leading numeric argument the
 * special An+B meaning. Every other functional pseudo retains its raw argument.
 * The two families diverge on the `of S` tail: `:nth-child`/`:nth-last-child`
 * accept it (Selectors-4 §6.6.2), `:nth-of-type`/`:nth-last-of-type` do not.
 * The `g`-free name recognitions live in the shared `cssPseudoSyntax`
 * artifact and are referenced as `g.CssSyntaxNthChildName` /
 * `g.CssSyntaxNthTypeName`.
 * Public `anyValue` is intentionally permissive. The direct declaration
 * extension needs only its punctuation-run branch: identifier-shaped values
 * already lower through Keyword, and `#` stays reserved for the strict
 * color production. Literal combinators keep this recognition macro-owned.
 */
const punctuationValueCharacter = choice(
  customEscape,
  literal('+'),
  literal('-'),
  literal('*'),
  literal('/'),
  literal('='),
  literal('<'),
  literal('>'),
  literal('|'),
  literal('~'),
  literal('^'),
  literal('?'),
  literal('$'),
  literal('@'),
  literal('%'),
  literal('&'),
  literal(':'),
  literal('.')
);

/*
 * punctuationValueCharacter minus `/`. Leading the punctuation-run arm with this
 * (concrete 16-char first-set) instead of a `not('/*')` guard lets the compiler
 * resolve PunctuationValue's first-set and first-char-gate it; the `/` cases
 * keep their adjacent-comment guard in the dedicated slash arm.
 * An at-keyword may not BEGIN a declaration-value component. `;` separates
 * declarations rather than terminating them (css-syntax-3 §5.4.7), so the last
 * declaration in a block ends at whatever follows it — and when that is a nested
 * at-rule, `a { color: red @media all { … } }`, the value run would otherwise
 * swallow `@` as permissive punctuation and strand the `{` with no statement to
 * open. A nested at-rule can only start where a value component could start, so
 * rejecting the at-keyword exactly there is the whole boundary: `@` keeps its
 * permissive reading everywhere it is not an at-keyword (`@`, `@1`, `@(`), and
 * mid-run `@` is untouched because no statement can begin inside a punctuation
 * run. The lookahead is css-syntax-3 §4.3.1 "would start an ident sequence",
 * the same spelling the at-rule name terminals use.
 * This const is the value-component START only; `punctuationValueCharacter` stays
 * unguarded because it also carries the `var()` fallback, where an at-keyword is
 * a legal `<declaration-value>` token (css-variables-1 §2.1).
 */
const nonSlashPunctuationValueStart = choice(
  customEscape,
  literal('+'),
  literal('-'),
  literal('*'),
  literal('='),
  literal('<'),
  literal('>'),
  literal('|'),
  literal('~'),
  literal('^'),
  literal('?'),
  literal('$'),
  regex(/@(?!-?(?:[-_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])))/),
  literal('%'),
  literal('&'),
  literal(':'),
  literal('.')
);

const importTailWhitespace = regex(/[ \t\n\r\f]+/);
const importTailText = regex(/[^()[\]"'\/; \t\n\r\f]+/);
const keyframeEndpoint = keywords(
  ['from', 'to'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
);
const combinator = keywords(['||', '>', '+', '~', '|']);

/*
 * A relative selector (a `:has()` argument) may open with a combinator. Only the
 * child/sibling combinators lead a relative selector; a leading `|`/`||` is
 * namespace syntax, not a relative combinator.
 */
const relativeSelectorCombinator = keywords(['>', '+', '~']);

/*
 * A pseudo selector always opens with `:`/`::`. Spelling this leading colon as a
 * grammar-local recognizer (identical to the shared CssSyntaxPseudoColon) lets
 * the compiler resolve the pseudo arm's first-set to `:` and first-char-gate it in
 * the compound-selector choice, instead of treating a cross-composition reference
 * as an `any` first-set and speculatively entering the pseudo node at every simple
 * selector.
 * The colon and the pseudo name are ADJACENT tokens: selectors-4 §3.5 spells a
 * pseudo-class as `':' <ident-token>` / `':' <function-token>`, with no
 * <whitespace-token> between them. The pseudo arm runs under `interstitialTrivia`
 * so that its ARGUMENT may be spaced (`:not( .b )`) and so a comment may sit
 * where tokenization already removes one (`:/*c*\/hover` is still `:hover`), but
 * that same trivia was silently swallowing a whitespace token here and accepting
 * `a : hover` — and, worse, letting `color: red b` read as the compound
 * `color` + `:red` followed by ` b`, which is what made a declaration whose value
 * strands a `{` look like a valid nested rule. Rejecting only the whitespace
 * keeps the comment case and restores the token adjacency.
 */
const pseudoColon = regex(/::?(?![ \t\n\r\f])/);

/*
 * Grammar-local copy of CssSyntaxSimple. As the fallback arm of the compound
 * selector choice it must resolve a concrete first-set (`.`/`#`/`-`/letter/digit/
 * `*`) so the compiler first-char-gates the whole compound choice; a cross-
 * composition reference reads as `any`, entering the simple-selector node frame
 * at every compound-selector boundary (`{`, `,`, whitespace).
 */
const simpleSelectorToken = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\d+(?:\.\d+)?%|\*)/);

/*
 * Grammar-local copies of the leading hex-color and number recognizers (identical
 * to CssSyntaxHexColor / CssSyntaxNumber). Leading a component-value choice
 * arm with a cross-composition `g.CssSyntax*` reference leaves that arm's
 * first-set unresolved (`any`), so the compiler enters the Color / Dimension node
 * frame speculatively at every value atom. A local leading recognizer resolves the
 * arm's first-set (`#` / `[+-.0-9]`) so it is first-char-gated instead.
 */
const hexColor = regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);
const numberValue = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
const numberNoPercentage = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)(?!%)/);
const dimensionUnit = regex(/-?[_a-zA-Z\u0080-\uFFFF](?:[_a-zA-Z0-9\u0080-\uFFFF]|-(?![0-9]))*/);
const customDoubleQuotedText = regex(/(?:[^"\\]|\\[\s\S])*/);
const customSingleQuotedText = regex(/(?:[^'\\]|\\[\s\S])*/);
const customDoubleQuoted = sequence(
  literal('"'),
  customDoubleQuotedText,
  literal('"')
);
const customSingleQuoted = sequence(
  literal('\''),
  customSingleQuotedText,
  literal('\'')
);

/*
 * A balanced interior stops at the first character of every skipper it is given,
 * so `blockComment` puts `/` in the interior's stop set: a `/` that does NOT open
 * a comment matches no interior arm and truncates the group early (the balanced
 * close is recovered, so the truncation is silent). `url(//host/a;b)` inside a
 * custom-property value is exactly that shape — the group ended at the first `/`
 * and the `;` inside it then terminated the declaration. This arm gives the lone
 * slash somewhere to go. It is ordered after `blockComment` at every skip site,
 * so a real `/*` still opens a comment.
 */
const customSlash = regex(/\/(?!\*)/);

/*
 * Balanced-group skips shared by the value, import-tail, calc var()-fallback,
 * and at-prelude scanners. One combinator per delimiter, reused at every skip
 * site instead of respelling the identical comment/escape/quote skip set.
 */
const balancedParens = balanced(
  '(',
  ')',
  { skip: [customSlash] }
);
const balancedBrackets = balanced(
  '[',
  ']',
  { skip: [customSlash] }
);
const balancedBraces = balanced(
  '{',
  '}',
  { skip: [customSlash] }
);

/*
 * A general-enclosed payload is grammar-owned arbitrary CSS component text. This
 * raw-template chunk deliberately stops at every structural delimiter; quotes,
 * comments, and balanced groups below own those bytes instead. It is a Parseman
 * terminal, not a source scan or a post-parse text recovery step.
 */
const generalEnclosedText = regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/'"()[\]{}]+)+/);

/*
 * A custom property is a CSS `<declaration-value>`: its opaque bytes must be
 * captured as one value while its balanced groups, quoted strings, and comments
 * cannot terminate the declaration. This is a Parseman grammar combinator, not
 * a secondary scanner or a post-parse source slice.
 * css-syntax-3 §5.5.6 strips a trailing `!important` and sets the declaration's
 * priority flag *before* the custom-property original-text step, so the preserved
 * text excludes the marker. css-variables-1 §2.1 confirms the `<declaration-value>`
 * ban on a top-level `!` does not apply, because the removal happens first.
 * The marker is a scan sentinel rather than a post-parse text slice: the leading
 * `[ \t\n\r\f]*` makes the scan stop *before* the whitespace that precedes `!`, so
 * the captured value keeps no trailing space. Only a marker that is genuinely last
 * qualifies — the `(?=[;}])` tail is what leaves `--x: a !important b` untouched and
 * what makes `--x: a !important !important` strip only the final one.
 */
const customImportantTail = regex(/[ \t\n\r\f]*!(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*important(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?=[;}])/i);
const customValue = scanTo(
  choice(
    literal(';'),
    literal('}'),
    customImportantTail
  ),
  {
    skip: [
      balancedParens,
      balancedBrackets,
      balancedBraces
    ]
  }
);
const importTailGroup = sequence(
  literal('('),
  scanTo(
    literal(')'),
    {
      skip: [balancedParens]
    }
  ),
  expect(
    literal(')'),
    ')'
  )
);
const importTailSquareGroup = sequence(
  literal('['),
  scanTo(
    literal(']'),
    {
      skip: [balancedBrackets]
    }
  ),
  expect(
    literal(']'),
    ']'
  )
);
export const cssFactory = (g: CssGrammarSelf) => {
  const identWord = makeWord(
    '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\',
    { caseInsensitive: true }
  );
  const cssCase = makeWhen({ caseInsensitive: true });

  /*
   * CSS keywords, at-keywords, and function names are ASCII-case-insensitive.
   * Function openers are glued with noTrivia so `url (` / `calc (` / `var (`
   * remain an identifier plus a parenthesized value, not a function token.
   */
  const importAtKeyword = identWord('@import');
  const urlOpen = noTrivia(sequence(
    identWord('url'),
    literal('(')
  ));
  const calcOpen = noTrivia(sequence(
    identWord('calc'),
    literal('(')
  ));
  const varOpen = noTrivia(sequence(
    identWord('var'),
    literal('(')
  ));

  const pseudoRawDoubleQuoted = sequence(
    literal('"'),
    g.CssSyntaxDoubleQuotedText,
    literal('"')
  );
  const pseudoRawSingleQuoted = sequence(
    literal('\''),
    g.CssSyntaxSingleQuotedText,
    literal('\'')
  );
  const pseudoIdentOrFunction = token(noTrivia(sequence(
    g.CssSyntaxKeyword,
    optional(literal('('))
  )));
  const pseudoRawArgument = scanTo(
    literal(')'),
    {
      skip: [
        balanced(
          '(',
          ')',
          { skip: [pseudoRawDoubleQuoted, pseudoRawSingleQuoted] }
        ),
        balanced(
          '[',
          ']',
          { skip: [pseudoRawDoubleQuoted, pseudoRawSingleQuoted] }
        ),
        pseudoRawDoubleQuoted,
        pseudoRawSingleQuoted,
        blockComment
      ]
    }
  );
  const authoredValueComma = field(
    'separator',
    noTrivia(sequence(
      literal(','),
      optional(cssValueTrivia)
    ))
  );
  const valueFunctionArguments = sepBy(
    g.TypedValueSequence,
    authoredValueComma
  );
  const genericFunctionArguments = sepBy(
    g.ValueSequence,
    authoredValueComma
  );
  const BasicSelector = node(
    'BasicSelector',
    simpleSelectorToken,
    children => simpleSelector(tokenText(children[0]))
  );
  const AttributeSelector = node(
    'AttributeSelector',
    sequence(
      literal('['),
      g.CssSyntaxKeyword,
      optional(sequence(
        g.CssSyntaxAttributeOperator,
        choice(
          g.Quoted,
          g.Keyword
        ),
        optional(g.CssSyntaxAttributeModifier)
      )),
      literal(']')
    ),
    children => simpleSelector(children.map(sourceText).join(''))
  );

  /*
   * A leading dash in a valid contiguous negative An+B argument must not be
   * greedily consumed as a selector token. The zero-width close check makes
   * this a complete argument recognition, so malformed `-n+` and generic raw
   * `-` arguments still reach the existing raw branch. Parser trivia owns
   * comments before `of`; semantic pseudo text keeps only `of <selector>`.
   */
  const LeadingDashPseudoArgument = node(
    'LeadingDashPseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        noTrivia(sequence(
          literal('-'),
          g.CssSyntaxNth
        )),
        optional(sequence(
          g.CssSyntaxOfKeyword,
          g.SelectorList
        )),
        g.CssSyntaxPseudoCloseAhead
      )
    ),
    (children) => {
      const nth = `-${tokenText(children[1])}`;
      const selector = children.find(isSelectorList);
      return selector === undefined ? nth : `${nth} of ${selectorArgumentText(selector)}`;
    }
  );
  const LeadingDashRawPseudoArgument = node(
    'LeadingDashRawPseudoArgument',

    /*
     * Preserve only dash-led raw forms that cannot begin a contiguous An+B
     * attempt. A `-` followed by `n`/digits belongs to the complete typed arm
     * above; if that arm cannot close, the public grammar rejects it rather
     * than accepting malformed An+B bytes as a generic pseudo argument.
     */
    choice(
      sequence(
        literal('-'),
        g.CssSyntaxPseudoCloseAhead
      ),
      noTrivia(sequence(
        literal('-'),
        regex(/[ \t\n\r\f]+/),
        pseudoRawArgument
      )),
      noTrivia(sequence(
        literal('-'),
        literal('-'),
        pseudoRawArgument
      ))
    ),
    children => children.map(sourceText).join('')
  );

  /*
   * A non-dash-led An+B argument (`2n+1`, `n+3`, `n - 3`, `even`). Selectors-4
   * defines the `<An+B>` microsyntax with OPTIONAL whitespace around the `+`/`-`
   * sign — `2n + 1` and `n - 3` are as valid as `2n+1`
   * (https://www.w3.org/TR/selectors-4/#anb-microsyntax; the equivalent grammar
   * note is https://www.w3.org/TR/css-syntax-3/#the-anb-type). The shared `nth`
   * recognition already spans that whitespace; recognize the complete typed form
   * here so a bare-`n`-led argument (`n+3`) is not first claimed by the selector
   * arm below as a lone type selector `n` and then left unable to close. This
   * mirrors the negative `LeadingDashPseudoArgument` arm for the positive
   * and unsigned cases; the trailing `(?=\))` keeps malformed forms (`2n +`,
   * `2n+1x`) on their existing rejecting path.
   */
  const TypedNthPseudoArgument = node(
    'TypedNthPseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        g.CssSyntaxNth,
        optional(sequence(
          g.CssSyntaxOfKeyword,
          g.SelectorList
        )),
        g.CssSyntaxPseudoCloseAhead
      )
    ),
    (children) => {
      const nth = tokenText(children[0]);
      const selector = children.find(isSelectorList);
      return selector === undefined ? nth : `${nth} of ${selectorArgumentText(selector)}`;
    }
  );

  /*
   * `:nth-of-type`/`:nth-last-of-type` accept only a BARE `<An+B>` — Selectors-4
   * §6.6.2 does not define an `of S` tail for the type-index families. These arms
   * mirror the child arms above but omit the optional `of <selector>` clause, so
   * a `... of ...` argument no longer matches here and falls to the raw/reject
   * path (the CSS-aligned owner decision, §7.1).
   */
  const LeadingDashOfTypePseudoArgument = node(
    'LeadingDashOfTypePseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        noTrivia(sequence(
          literal('-'),
          g.CssSyntaxNth
        )),
        g.CssSyntaxPseudoCloseAhead
      )
    ),
    children => `-${tokenText(children[1])}`
  );
  const TypedOfTypePseudoArgument = node(
    'TypedOfTypePseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        g.CssSyntaxNth,
        g.CssSyntaxPseudoCloseAhead
      )
    ),
    children => tokenText(children[0])
  );
  const PseudoArgument = node(
    'PseudoArgument',
    choice(
      g.LeadingDashPseudoArgument,
      g.LeadingDashRawPseudoArgument,
      g.TypedNthPseudoArgument,
      parser(
        { trivia: interstitialTrivia },
        g.SelectorList
      ),
      sequence(
        not(g.CssSyntaxMalformedPseudoNumericArgument),
        pseudoRawArgument
      )
    ),
    children => selectorArgumentText(children[0])
  );

  /*
   * The `:nth-of-type` family's argument: identical to `PseudoArgument`
   * except the An+B arms are the bare (no-`of`) variants. The two bare An+B arms
   * reject an `of` tail via their close-ahead, but the selector and raw fallbacks
   * would otherwise re-capture `<An+B> of …` as opaque text (the selector arm as a
   * compound selector, the raw arm as a scanned span). A negative lookahead for an
   * `<An+B>` immediately followed by `of` closes both leaks so the whole of-type
   * branch fails — Selectors-4 §6.6.2 defines `of S` only for nth-child/last-child
   * (§7.1). The guard fires ONLY on an An+B-prefixed `of` tail, so every argument
   * that does not use one (a plain selector or opaque raw arg) stays byte-identical.
   */
  const OfTypePseudoArgument = node(
    'OfTypePseudoArgument',
    choice(
      g.LeadingDashOfTypePseudoArgument,
      g.LeadingDashRawPseudoArgument,
      g.TypedOfTypePseudoArgument,
      sequence(
        not(parser(
          { trivia: whitespace },
          sequence(
            g.CssSyntaxNth,
            g.CssSyntaxOfKeyword
          )
        )),
        choice(
          parser(
            { trivia: interstitialTrivia },
            g.SelectorList
          ),
          sequence(
            not(g.CssSyntaxMalformedPseudoNumericArgument),
            pseudoRawArgument
          )
        )
      )
    ),
    children => selectorArgumentText(children[0])
  );

  /*
   * Retain the parsed `SelectorList` rather than collapsing it to text: a
   * whitelisted selector-function pseudo (`:is`/`:not`/…) keeps it as structured
   * `args`. The raw arm still yields its scanned text. `PseudoSelector` derives the
   * authored `text` from whichever it gets via `selectorArgumentText`, so the
   * SimpleSelector text is byte-identical to the pre-P0.2 collapse.
   */
  const GenericPseudoArgument = node(
    'GenericPseudoArgument',
    choice(
      parser(
        { trivia: interstitialTrivia },
        g.SelectorList
      ),
      pseudoRawArgument
    ),
    children => isSelectorList(children[0]) ? children[0] : selectorArgumentText(children[0])
  );

  /*
   * A `:has()` argument is a relative selector, so an individual branch may open
   * with a combinator (`:has(> .b)`). The outer selector grammar forbids a leading
   * combinator, so this pseudo-private branch admits an optional relative one and
   * emits a `RelativeSelector`. A leading `|` is namespace
   * syntax, not a relative combinator, so it is excluded (mirrors Less's
   * `relativeSelectorCombinator`).
   */
  const RelativeComplexSelector = node(
    'RelativeComplexSelector',
    sequence(
      optional(relativeSelectorCombinator),
      g.ComplexSelector
    ),
    (children) => {
      const branch = children.find(isSelectorBranch);
      if (branch === undefined) {
        throw new Error('RelativeComplexSelector requires a selector branch');
      }
      if (children.length === 1) {
        return branch;
      }
      const lead = tokenText(children[0]);
      if (lead !== '>' && lead !== '+' && lead !== '~') {
        throw new Error('RelativeComplexSelector produced an invalid leading combinator');
      }
      return relativeSelector(lead, branchSegments(branch));
    }
  );

  /*
   * The selector-argument pseudos (`:is`/`:where`/`:not`/`:has`/`:matches`) take a
   * selector-ONLY argument: a (relative) selector list with no general-any text
   * fallback, so `:not(2n+1)` fails the selector and rejects the whole pseudo. The
   * non-relative shape reduces byte-identically to `SelectorList` (both assemble
   * `selist(...selectorBranches(children))`); the retained `SelectorList` becomes
   * structured `PseudoSelector.args` in `PseudoSelector`, never joined at parse.
   */
  const SelectorOnlyPseudoArgument = node(
    'SelectorOnlyPseudoArgument',
    parser(
      { trivia: interstitialTrivia },
      oneOrMoreSep(
        RelativeComplexSelector,
        literal(',')
      )
    ),
    children => selist(...selectorBranches(children))
  );

  /*
   * Pseudo selectors share one identifier/function opener after `:`/`::`.
   * Route that opener once, so known function pseudos commit to their structured
   * argument grammar while unknown glued functions keep the generic raw argument
   * path and bare pseudos stay bare keyword pseudos.
   *
   * Functional pseudos consume a CSS function-token opener: the name and `(` are
   * adjacent bytes. `:not (.a)` must not become `:not(.a)` through ambient
   * interstitial trivia, even though spacing inside the argument remains valid.
   */
  const PseudoSelector = node(
    'PseudoSelector',
    sequence(
      pseudoColon,
      dispatch(
        pseudoIdentOrFunction,
        cssCase(
          ['nth-child(', 'nth-last-child('],
          sequence(
            routed(),
            g.PseudoArgument,
            literal(')')
          )
        ),
        cssCase(
          ['nth-of-type(', 'nth-last-of-type('],
          sequence(
            routed(),
            g.OfTypePseudoArgument,
            literal(')')
          )
        ),
        cssCase(
          ['is(', 'where(', 'not(', 'has(', 'matches('],
          sequence(
            routed(),
            SelectorOnlyPseudoArgument,
            literal(')')
          )
        ),
        when(
          endsWith('('),
          sequence(
            routed(),
            GenericPseudoArgument,
            literal(')')
          )
        ),
        otherwise(sequence(
          not(g.CssSyntaxNthName),
          routed()
        ))
      )
    ),
    (children) => {
      const pseudoName = functionOpenName(children[1]);
      const head = `${tokenText(children[0])}${pseudoName}`;
      if (children.length === 2) {
        return simpleSelector(head);
      }

      /*
       * Parser = STRUCTURE + trivia only. A whitelisted selector-function pseudo
       * keeps the parsed `args` (SelectorList) and does NOT join: core serialize
       * owns the inline `:is(a, b)` rule (`pseudoCanonical`). The opaque/nth/raw
       * path still collapses to SimpleSelector text via `selectorArgumentText`.
       */
      const arg = children[2];
      if (isSelectorList(arg) && STRUCTURED_PSEUDOS.has(pseudoName.toLowerCase())) {
        return pseudoSelector(
          head,
          arg
        );
      }
      return simpleSelector(`${head}(${selectorArgumentText(arg)})`);
    }
  );

  /*
   * `&` is a semantic selector token, not a post-parse text substitution. The
   * core selector model represents it as the canonical SimpleSelector text expected by
   * nested-rule serialization.
   */
  const NestingSelector = node(
    'NestingSelector',
    literal('&'),
    () => simpleSelector('&')
  );
  const CompoundSelector = node(
    'CompoundSelector',
    noTrivia(parser(
      { trivia: compoundTrivia },
      oneOrMore(choice(
        g.NestingSelector,
        parser(
          { trivia: interstitialTrivia },
          g.AttributeSelector
        ),
        parser(
          { trivia: interstitialTrivia },
          g.PseudoSelector
        ),
        g.BasicSelector
      ))
    )),
    (children) => {
      const simples: SimpleToken[] = [];
      for (const child of children) {
        if (!isSimpleToken(child)) {
          throw new TypeError('CompoundSelector produced a non-simple selector child.');
        }
        simples.push(child);
      }
      return selectorTermFromTokens(simples);
    }
  );
  const TopLevelCompoundSelector = node(
    'TopLevelCompoundSelector',
    noTrivia(parser(
      { trivia: compoundTrivia },
      oneOrMore(choice(
        parser(
          { trivia: interstitialTrivia },
          g.AttributeSelector
        ),
        parser(
          { trivia: interstitialTrivia },
          g.PseudoSelector
        ),
        g.BasicSelector
      ))
    )),
    (children) => {
      const simples: SimpleToken[] = [];
      for (const child of children) {
        if (!isSimpleToken(child)) {
          throw new TypeError('TopLevelCompoundSelector produced a non-simple selector child.');
        }
        simples.push(child);
      }
      return selectorTermFromTokens(simples);
    }
  );
  const ComplexSelector = node(
    'ComplexSelector',
    sequence(
      g.CompoundSelector,

      /*
       * The separator between compound selectors may be an explicit combinator
       * (`>`, `+`, `~`, `|`, `||`) or just ambient trivia, which CSS treats as
       * the descendant combinator. Do not collapse this to oneOrMoreSep(): a
       * nullable separator would be the wrong Parseman shape.
       */
      many(sequence(
        optional(combinator),
        g.CompoundSelector
      ))
    ),
    children => selectorBranchOf(complexSegments(children))
  );
  const TopLevelComplexSelector = node(
    'TopLevelComplexSelector',
    sequence(
      g.TopLevelCompoundSelector,
      many(sequence(
        optional(combinator),
        g.TopLevelCompoundSelector
      ))
    ),
    children => selectorBranchOf(complexSegments(children))
  );
  const SelectorList = node(
    'SelectorList',
    oneOrMoreSep(
      g.ComplexSelector,
      literal(',')
    ),
    children => selist(...selectorBranches(children))
  );
  const TopLevelSelectorList = node(
    'TopLevelSelectorList',
    oneOrMoreSep(
      g.TopLevelComplexSelector,
      literal(',')
    ),
    children => selist(...selectorBranches(children))
  );
  const Property = node(
    'Property',
    g.CssSyntaxProperty,
    children => tokenText(children[0])
  );
  const CustomProperty = node(
    'CustomProperty',
    g.CssSyntaxCustomProperty,
    children => tokenText(children[0])
  );
  const CustomValue = node(
    'CustomValue',
    customValue,
    children => any(children.length === 0 ? '' : tokenText(children[0]))
  );
  const Keyword = node(
    'Keyword',
    g.CssSyntaxKeyword,
    children => keyword(tokenText(children[0]))
  );

  /*
   * Dashed identifiers are not ordinary CSS keywords, but they are valid
   * component values (most visibly as `var(--name)` arguments). Keep the
   * authored dashed identifier as a structured keyword leaf rather than
   * collapsing the whole function or its enclosing calc to raw bytes.
   */
  const CustomPropertyValue = node(
    'CustomPropertyValue',
    g.CssSyntaxCustomProperty,
    children => keyword(tokenText(children[0]))
  );
  const Color = node<AstColor>(
    'Color',
    hexColor,
    children => color(tokenText(children[0]))
  );

  /*
   * A `<urange>` is one opaque CSS token, so it must be recognized before the
   * numeric/keyword atoms: `U+0-7F` split at the `+` leaves `+0`/`-7F` to be
   * re-read as signed numbers, which serializes valid CSS back out as `U +0 -7F`.
   */
  const UnicodeRange = node(
    'UnicodeRange',
    g.CssSyntaxUnicodeRange,
    children => any(tokenText(children[0]))
  );
  const Percentage = node<AstDimension>(
    'Percentage',
    noTrivia(sequence(
      numberValue,
      literal('%')
    )),
    (children) => {
      const numberText = tokenText(children[0]);
      return dimension(
        Number(numberText),
        '%',
        `${numberText}%`
      );
    }
  );
  const Dimension = node<AstDimension>(
    'Dimension',
    noTrivia(sequence(
      numberNoPercentage,
      optional(dimensionUnit)
    )),
    (children) => {
      const numberText = tokenText(children[0]);
      const unit = children.length > 1 ? tokenText(children[1]) : '';
      return dimension(
        Number(numberText),
        unit,
        `${numberText}${unit}`
      );
    }
  );
  const Quoted = node<AstQuoted>(
    'Quoted',
    choice(
      noTrivia(sequence(
        literal('"'),
        g.CssSyntaxDoubleQuotedText,
        literal('"')
      )),
      noTrivia(sequence(
        literal('\''),
        g.CssSyntaxSingleQuotedText,
        literal('\'')
      )),

      /*
       * The public CST already recognizes this static escaped-string spelling.
       * Reduce it to the existing `Quoted.escaped` fact, never an opaque value.
       */
      noTrivia(sequence(
        literal('~"'),
        g.CssSyntaxDoubleQuotedText,
        literal('"')
      )),
      noTrivia(sequence(
        literal('~\''),
        g.CssSyntaxSingleQuotedText,
        literal('\'')
      ))
    ),
    (children) => {
      const opener = tokenText(children[0]);
      const escaped = opener.startsWith('~');
      const quote = escaped ? opener[1]! : opener;
      const value = tokenText(children[1]);
      return quoted(
        `${escaped ? '~' : ''}${quote}${value}${quote}`,
        value,
        quote,
        escaped
      );
    }
  );
  const UrlUnquoted = node(
    'UrlUnquoted',
    g.CssSyntaxUrlInner,
    children => any(tokenText(children[0]!))
  );
  const Url = node<AstUrl>(
    'Url',
    sequence(
      urlOpen,
      optional(regex(/[ \t\n\r\f]+/)),
      optional(choice(
        g.Quoted,
        UrlUnquoted
      )),
      optional(regex(/[ \t\n\r\f]+/)),
      expect(
        literal(')'),
        ')'
      )
    ),
    (children) => {
      const body = children.find(isValue);
      return url(body ?? any(''));
    }
  );
  const Call = node(
    'Call',
    sequence(
      genericFunctionOpen,
      optional(cssValueTrivia),
      valueFunctionArguments,
      optional(cssValueTrivia),
      literal(')')
    ),
    (children, fields) => {
      const name = functionOpenName(children[0]);
      const args = children.slice(1).filter(isValueSlotValue);
      return funcCall(
        name,
        withAuthoredSeparators(
          args,
          fields,
          Math.max(
            0,
            args.length - 1
          )
        )
      );
    }
  );

  /*
   * CSS arithmetic parentheses are structural only inside calc(), where they
   * preserve math precedence in the AST.
   */
  const CalcParen = node(
    'CalcParen',
    noTrivia(sequence(
      literal('('),
      many(calcWhitespace),
      g.CalcSum,
      many(calcWhitespace),
      literal(')')
    )),
    children => block(firstValue(children))
  );

  /*
   * `var()` is a component-value substitution boundary even inside a strict
   * calc expression. Its fallback is its own component-value sequence, while
   * the surrounding calc still supplies the arithmetic reduction. This keeps
   * `var(--x, 1px + 2px)` and non-math component fallbacks lossless without
   * turning the function or outer calc into opaque raw bytes.
   */
  const VarFallbackPunctuation = node(
    'VarFallbackPunctuation',
    oneOrMore(punctuationValueCharacter),
    children => any(children.map(tokenText).join(''))
  );

  /*
   * The fallback's bracket/brace leaves retain their authored bytes, so their
   * bodies are captured with scanTo. These zero-width structural guards make
   * that lossless capture reject a closer reached before a nested, differently
   * shaped block has closed: `[a(b]` and `{a[b}` cannot be accepted merely
   * because the outer leaf sees its own closer first. The nested-group skips are
   * the shared `balancedBrackets`/`balancedBraces` combinators.
   */
  const varFallbackBracketCrossParen = sequence(
    literal('['),
    scanTo(
      literal('('),
      { skip: [balancedBrackets] }
    ),
    literal('('),
    scanTo(
      choice(
        literal(')'),
        literal(']')
      ),
      { skip: [balancedBrackets] }
    ),
    literal(']')
  );
  const varFallbackBracketCrossBrace = sequence(
    literal('['),
    scanTo(
      literal('{'),
      { skip: [balancedBrackets] }
    ),
    literal('{'),
    scanTo(
      choice(
        literal('}'),
        literal(']')
      ),
      { skip: [balancedBrackets] }
    ),
    literal(']')
  );
  const varFallbackBraceCrossParen = sequence(
    literal('{'),
    scanTo(
      literal('('),
      { skip: [balancedBraces] }
    ),
    literal('('),
    scanTo(
      choice(
        literal(')'),
        literal('}')
      ),
      { skip: [balancedBraces] }
    ),
    literal('}')
  );
  const varFallbackBraceCrossBracket = sequence(
    literal('{'),
    scanTo(
      literal('['),
      { skip: [balancedBraces] }
    ),
    literal('['),
    scanTo(
      choice(
        literal(']'),
        literal('}')
      ),
      { skip: [balancedBraces] }
    ),
    literal('}')
  );

  /*
   * A parenthesized fallback is structural, unlike the raw bracket/brace
   * leaves below. Give it the same ordered-delimiter guard: `([a])` and
   * `({a})` are valid adjacent nested groups, while `([a)]` and `({a)}` are
   * crossed closures rather than an opportunity to reassign a closer to an
   * enclosing var()/calc() production.
   */
  const varFallbackParenCrossBracket = sequence(
    literal('('),
    scanTo(
      literal('[')
    ),
    literal('['),
    scanTo(
      choice(
        literal(']'),
        literal(')')
      )
    ),
    literal(')')
  );
  const varFallbackParenCrossBrace = sequence(
    literal('('),
    scanTo(
      literal('{')
    ),
    literal('{'),
    scanTo(
      choice(
        literal('}'),
        literal(')')
      )
    ),
    literal(')')
  );
  const VarFallbackParen = node(
    'VarFallbackParen',
    sequence(
      not(choice(
        varFallbackParenCrossBracket,
        varFallbackParenCrossBrace
      )),
      literal('('),
      optional(g.VarFallback),
      literal(')')
    ),
    children => block(valueSlotChildren(children)[0] ?? any(''))
  );

  /*
   * Core has no bracket value node. Keep a bracket component as its existing
   * lossless Any leaf, but let Parseman recognize its balanced structure so a
   * nested group or quoted/string content can never terminate the fallback
   * early or make the enclosing var call opaque.
   */
  const VarFallbackBracket = node(
    'VarFallbackBracket',
    sequence(
      not(choice(
        varFallbackBracketCrossParen,
        varFallbackBracketCrossBrace
      )),
      literal('['),
      scanTo(
        literal(']'),
        {
          skip: [balancedBrackets]
        }
      ),
      literal(']')
    ),
    children => any(children.map(tokenText).join(''))
  );
  const VarFallbackBrace = node(
    'VarFallbackBrace',
    sequence(
      not(choice(
        varFallbackBraceCrossParen,
        varFallbackBraceCrossBracket
      )),
      literal('{'),
      scanTo(
        literal('}'),
        {
          skip: [balancedBraces]
        }
      ),
      literal('}')
    ),
    children => any(children.map(tokenText).join(''))
  );

  /*
   * A nested var() needs its own first separator and trailing fallback commas
   * preserved exactly as the outer var does. It must therefore win before the
   * generic function-call component arm in every fallback component position.
   * This is a dispatch-adjacent hotspot, but not a blind rewrite target:
   * fallback generic functions use fallback comma semantics, while ordinary
   * typed values use CSS value-list separators. A future routed shape must keep
   * that fallback-specific function body instead of merely reusing
   * TypedIdentOrFunction.
   */
  const varFallbackComponent = choice(
    g.VarCall,
    g.VarFallbackCall,
    g.TypedValue,
    g.VarFallbackParen,
    g.VarFallbackBracket,
    g.VarFallbackBrace,
    g.VarFallbackPunctuation
  );

  const VarFallbackTerm = node(
    'VarFallbackTerm',
    sequence(
      varFallbackComponent,
      many(sequence(
        many(calcWhitespace),
        varFallbackComponent
      ))
    ),
    (children) => {
      const values = valueSlotChildren(children);
      return values.length === 1 ? values[0]! : values;
    }
  );
  const VarFallbackEmpty = node(
    'VarFallbackEmpty',
    choice(
      peek(literal(',')),
      peek(literal(')'))
    ),
    () => any('')
  );
  const varFallbackComma = sequence(
    literal(','),
    many(calcWhitespace)
  );
  const VarFallbackItem = node(
    'VarFallbackItem',
    choice(
      g.VarFallbackTerm,
      g.VarFallbackEmpty
    ),
    { project: 0 }
  );
  const VarFallback = node(
    'VarFallback',
    oneOrMoreSep(
      g.VarFallbackItem,
      varFallbackComma
    ),
    (children) => {
      const values = valueSlotChildren(children);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );
  const VarFallbackCall = node(
    'VarFallbackCall',
    sequence(
      genericFunctionOpen,
      optional(sequence(
        not(peek(literal(')'))),
        oneOrMoreSep(
          g.VarFallbackItem,
          varFallbackComma
        )
      )),
      literal(')')
    ),
    children => funcCall(
      functionOpenName(children[0]),
      children.filter(isValueSlotValue)
    )
  );
  const VarCall = node(
    'VarCall',
    sequence(
      varOpen,
      CustomPropertyValue,
      optional(sequence(
        literal(','),
        many(calcWhitespace),
        choice(
          g.VarFallback,
          g.VarFallbackEmpty
        )
      )),
      literal(')')
    ),
    children => funcCall(
      functionOpenName(children[0]),
      children.filter(isValueSlotValue)
    )
  );
  const CalcValue = node(
    'CalcValue',
    choice(
      g.Percentage,
      g.Dimension,
      g.Color,
      g.CalcIdentOrFunction,
      g.CalcParen,
      g.Quoted,
      CustomPropertyValue
    ),
    { project: 0 }
  );
  const CalcProduct = node(
    'CalcProduct',
    noTrivia(sequence(
      g.CalcValue,
      many(sequence(
        calcProductOperator,
        g.CalcValue
      ))
    )),
    foldOperation
  );
  const CalcSum = node(
    'CalcSum',
    noTrivia(sequence(
      g.CalcProduct,
      many(sequence(
        calcSumOperator,
        g.CalcProduct
      ))
    )),
    foldOperation
  );
  const CalcCall = node(
    'CalcCall',
    noTrivia(sequence(
      calcOpen,
      many(calcWhitespace),
      g.CalcSum,
      many(calcWhitespace),
      literal(')')
    )),
    children => funcCall(
      functionOpenName(children[0]),
      [firstValue(children)]
    )
  );

  /*
   * Preserve the public declaration component-value language without letting
   * its permissive forms leak into query preludes or dedicated function
   * productions. url()/var()/calc() stay owned by their strict branches;
   * genericFunctionOpen excludes those glued openers.
   */
  const ParenValue = node(
    'ParenValue',
    sequence(
      literal('('),
      optional(g.ValueList),
      literal(')')
    ),
    children => block(valueSlotChildren(children)[0] ?? any(''))
  );
  const RawParenValue = node(
    'RawParenValue',
    sequence(
      literal('('),
      scanTo(
        literal(')'),
        { skip: [balancedParens, balancedBrackets, balancedBraces] }
      ),
      literal(')')
    ),
    children => block(any(tokenText(children[1])))
  );
  const IdentBlock = node(
    'IdentBlock',
    sequence(
      genericIdentifier,
      field(
        'separator',
        cssValueTrivia
      ),
      g.RawParenValue
    ),
    (children, fields) => withAuthoredSeparators(
      spaced([
        keyword(tokenText(children[0])),
        firstValue(children)
      ]),
      fields,
      1
    )
  );
  const slashValueBoundaryAhead = peek(choice(
    literal('.'),
    regex(/[0-9]/),
    regex(/[ \t\n\r\f]/)
  ));
  const atRuleKeyword = token(noTrivia(g.CssSyntaxRoutedAtRuleKeyword));
  const identOrFunction = token(noTrivia(
    sequence(
      genericIdentifier,
      optional(literal('('))
    )
  ));
  const PunctuationValue = node(
    'PunctuationValue',

    /*
     * Slash is a component boundary before a number or whitespace. Keep just
     * that slash as one structured punctuation component so `/ .5` does not
     * swallow the numeric leaf into opaque bytes; punctuation runs such as
     * `//` remain losslessly represented as one Any node.
     *
     * Both original arms led with not('/*'), collapsing this node's first-set to
     * 'any' so it (and the whole value atom it terminates) entered speculatively
     * at every value-term boundary. This value path runs under the enclosing
     * value-term noTrivia, so the '/*' guard is adjacent-only; split on the first
     * char instead: the '/' arm consumes '/', rejects an adjacent '*' (comment),
     * then keeps the single-slash-before-number/ws case or continues the run; the
     * non-slash arm leads with the 16 non-'/' punctuation literals. Every arm now
     * resolves a concrete first-set, so the compiler first-char-gates it.
     */
    choice(
      noTrivia(sequence(
        literal('/'),
        not(literal('*')),
        choice(
          slashValueBoundaryAhead,
          many(punctuationValueCharacter)
        )
      )),
      sequence(
        nonSlashPunctuationValueStart,
        many(punctuationValueCharacter)
      )
    ),
    children => any(children.map(tokenText).join(''))
  );
  const GenericFunction = node(
    'Call',
    sequence(
      routed(),
      optional(cssValueTrivia),
      genericFunctionArguments,
      optional(cssValueTrivia),
      literal(')')
    ),
    (children, fields) => {
      const name = functionOpenName(children[0]);
      const args = children.filter(isValueSlotValue);
      return funcCall(
        name,
        withAuthoredSeparators(
          args,
          fields,
          Math.max(
            0,
            args.length - 1
          )
        )
      );
    }
  );
  const UrlFunction = node<AstUrl>(
    'Url',
    sequence(
      routed(),
      optional(regex(/[ \t\n\r\f]+/)),
      optional(choice(
        g.Quoted,
        UrlUnquoted
      )),
      optional(regex(/[ \t\n\r\f]+/)),
      expect(
        literal(')'),
        ')'
      )
    ),
    (children) => {
      const body = children.find(isValue);
      return url(body ?? any(''));
    }
  );
  const CalcFunction = node(
    'CalcCall',
    noTrivia(sequence(
      routed(),
      many(calcWhitespace),
      g.CalcSum,
      many(calcWhitespace),
      literal(')')
    )),
    children => funcCall(
      functionOpenName(children[0]),
      [firstValue(children)]
    )
  );
  const VarFunction = node(
    'VarCall',
    sequence(
      routed(),
      CustomPropertyValue,
      optional(sequence(
        literal(','),
        many(calcWhitespace),
        choice(
          g.VarFallback,
          g.VarFallbackEmpty
        )
      )),
      literal(')')
    ),
    children => funcCall(
      functionOpenName(children[0]),
      children.filter(isValueSlotValue)
    )
  );
  const Identifier = node(
    'Keyword',
    routed(),
    children => keyword(tokenText(children[0]))
  );

  /*
   * Declaration identifiers and glued function openers share one lexical shape.
   * Parse it once, then route the complete opener to the dedicated URL, calc(),
   * var(), generic-call, or keyword tail. `foo (` remains a keyword followed by
   * a parenthesized value because the opener is parsed with noTrivia.
   */
  const IdentOrFunction = dispatch(
    identOrFunction,
    cssCase(
      'url(',
      UrlFunction
    ),
    cssCase(
      'calc(',
      CalcFunction
    ),
    cssCase(
      'var(',
      VarFunction
    ),
    when(
      endsWith('('),
      GenericFunction
    ),
    otherwise(Identifier)
  );
  const TypedGenericFunction = node(
    'Call',
    sequence(
      routed(),
      optional(cssValueTrivia),
      valueFunctionArguments,
      optional(cssValueTrivia),
      literal(')')
    ),
    (children, fields) => {
      const name = functionOpenName(children[0]);
      const args = children.slice(1).filter(isValueSlotValue);
      return funcCall(
        name,
        withAuthoredSeparators(
          args,
          fields,
          Math.max(
            0,
            args.length - 1
          )
        )
      );
    }
  );
  const typedIdentOrFunction = dispatch(
    identOrFunction,
    cssCase(
      'url(',
      UrlFunction
    ),
    cssCase(
      'calc(',
      CalcFunction
    ),
    cssCase(
      'var(',
      VarFunction
    ),
    when(
      endsWith('('),
      TypedGenericFunction
    ),
    otherwise(Identifier)
  );
  const CalcIdentOrFunction = typedIdentOrFunction;
  const TypedIdentOrFunction = typedIdentOrFunction;
  const NonIdentifierPunctuationValue = node(
    'NonIdentifierPunctuationValue',
    sequence(
      not(peek(identOrFunction)),
      g.PunctuationValue
    ),
    children => firstValue(children)
  );
  const Value = node(
    'Value',

    /*
     * Identifier-shaped atoms are routed by `IdentOrFunction`: known glued
     * functions keep their dedicated tails, other glued functions use the
     * generic call tail, and bare identifiers become keywords. Keep the spaced
     * paren bridge first so `foo (bar)` can preserve its authored separator as
     * a value boundary instead of becoming a glued function token.
     */
    choice(
      g.Percentage,
      g.Dimension,
      g.Color,
      g.UnicodeRange,
      IdentBlock,
      IdentOrFunction,
      g.ParenValue,
      g.Quoted,
      CustomPropertyValue,
      NonIdentifierPunctuationValue
    ),
    { project: 0 }
  );
  const ValueSequence = node(
    'ValueSequence',
    noTrivia(sequence(
      g.Value,
      many(choice(
        sequence(
          field(
            'separator',
            cssValueTrivia
          ),
          g.Value
        ),
        g.Value
      ))
    )),
    (children, fields) => {
      const values = valueSlotChildren(children);
      if (values.length === 1) {
        return values[0]!;
      }
      return withAuthoredSeparators(
        values,
        fields,
        values.length - 1
      );
    }
  );
  const ValueList = node(
    'ValueList',
    oneOrMoreSep(
      g.ValueSequence,
      authoredValueComma
    ),
    (children, fields) => {
      const terms = valueSlotChildren(children);
      if (terms.length === 1) {
        return terms[0]!;
      }
      return withAuthoredSeparators(
        list(
          terms,
          ','
        ),
        fields,
        terms.length - 1
      );
    }
  );
  const TypedValue = node(
    'TypedValue',
    choice(
      g.Percentage,
      g.Dimension,
      g.Color,
      g.Quoted,
      CustomPropertyValue,
      g.UnicodeRange,
      TypedIdentOrFunction
    ),
    { project: 0 }
  );
  const TypedValueSequence = node(
    'TypedValueSequence',
    noTrivia(sequence(
      TypedValue,
      many(choice(
        sequence(
          field(
            'separator',
            cssValueTrivia
          ),
          TypedValue
        ),
        TypedValue
      ))
    )),
    (children, fields) => {
      const values = valueSlotChildren(children);
      if (values.length === 1) {
        return values[0]!;
      }
      return withAuthoredSeparators(
        values,
        fields,
        values.length - 1
      );
    }
  );
  const TypedValueList = node(
    'TypedValueList',
    oneOrMoreSep(
      g.TypedValueSequence,
      authoredValueComma
    ),
    (children, fields) => {
      const terms = valueSlotChildren(children);
      if (terms.length === 1) {
        return terms[0]!;
      }
      return withAuthoredSeparators(
        list(
          terms,
          ','
        ),
        fields,
        terms.length - 1
      );
    }
  );

  /*
   * Comments are CSS component-value trivia around a priority marker. They
   * cannot become declaration values or block the `!important` reduction.
   */
  const Important = node(
    'Important',

    /*
     * Lead with `!` (the cheap disambiguating signal) so this arm resolves a
     * concrete first-set and optional(Important) is first-char-gated instead of
     * entering the node frame at every declaration's value boundary.
     */
    sequence(literal('!'), g.CssSyntaxImportant),
    () => true
  );
  const Declaration = node(
    'Declaration',
    choice(
      sequence(
        g.CustomProperty,
        literal(':'),
        g.CustomValue,
        optional(g.Important)
      ),
      sequence(
        g.Property,
        literal(':'),

        /*
         * A declaration value is a component-value sequence. In particular, a
         * structured function is one component, not the entire value: `url(x)
         * / cover`, `var(--x) solid`, and `foo(bar) baz` all retain the
         * existing structured leaves inside a SpacedValue. Identifier-shaped
         * components route from one opener, so a malformed known function such
         * as `calc()` cannot degrade into a keyword plus punctuation.
         */
        g.ValueList,
        not(literal('{')),
        optional(g.Important)
      )
    ),
    (children) => {
      const name = tokenText(children[0]);
      if (name.startsWith('--')) {
        const value = children.find((child): child is ValueNode => isNodeType(
          child,
          'Any'
        ));
        if (value === undefined) {
          throw new Error('Declaration requires a captured custom-property value');
        }
        return decl(
          name,
          valueSlot(value),
          null,
          children.includes(true)
        );
      }
      const value = children.find(isValueSlotValue);
      if (value === undefined) {
        throw new Error('Declaration requires a structured value');
      }
      return decl(
        name,
        Array.isArray(value) ? value : valueSlot(value),
        null,
        children.includes(true)
      );
    }
  );

  /*
   * This import-local URL target intentionally accepts the public grammar's
   * comment trivia around `url` / `(` / payload / `)`. It does not change the
   * ordinary declaration-value URL grammar, and comments after the closing `)`
   * remain owned by ImportTail as authored tail bytes.
   */
  const ImportUrlUnquoted = node(
    'ImportUrlUnquoted',
    g.CssSyntaxUrlInner,
    children => any(tokenText(children[0]!))
  );
  const ImportUrl = node(
    'ImportUrl',
    sequence(
      urlOpen,
      optional(choice(
        g.Quoted,
        g.ImportUrlUnquoted
      )),
      expect(
        literal(')'),
        ')'
      )
    ),
    children => url(children.find(isValue) ?? any(''))
  );
  const ImportTailRaw = node(
    'ImportTailRaw',
    choice(
      importTailGroup,
      importTailSquareGroup,
      customDoubleQuoted,
      customSingleQuoted,
      importTailText,
      literal('/')
    ),
    children => any(children.map(tokenText).join(''))
  );
  const ImportTailBody = node(
    'ImportTailBody',
    parser(
      { trivia: commentTrivia },
      sequence(
        g.ImportTailRaw,
        many(choice(
          g.ImportTailRaw,
          importTailWhitespace
        ))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog) => any(semanticTextWithTriviaGaps(children, triviaLog))
  );
  const ImportTail = node(
    'ImportTail',
    noTrivia(sequence(
      many(importTailWhitespace),
      g.ImportTailBody
    )),
    children => any(sourceText(children[children.length - 1]!))
  );
  const ImportStatement = node(
    'ImportStatement',
    sequence(
      importAtKeyword,
      choice(
        g.Quoted,
        g.ImportUrl
      ),
      optional(g.ImportTail),
      literal(';')
    ),
    (children, _fields, span) => {
      const target = children.find(isImportTarget);
      if (target === undefined) {
        throw new Error('ImportStatement requires a static quoted or url target');
      }
      const tail = children.find((child): child is ValueNode => isNodeType(
        child,
        'Any'
      )) ?? null;
      return withSourceSpan(atRuleStatement(
        tokenText(children[0]),
        importPrelude(
          target,
          tail
        )
      ), span);
    }
  );
  const AtRuleStatement = node(
    'AtRuleStatement',
    sequence(
      g.CssSyntaxStatementAtRuleName,
      g.StatementPrelude,
      literal(';')
    ),
    (children, _fields, span) => {
      const name = tokenText(children[0]);
      return withSourceSpan(atRuleStatement(
        name,
        optionalValue(children[1])
      ), span);
    }
  );
  const RoutedAtRuleStatement = node(
    'AtRuleStatement',
    sequence(
      routed(),
      g.StatementPrelude,
      literal(';')
    ),
    (children, _fields, span) => {
      const name = tokenText(children[0]);
      return withSourceSpan(atRuleStatement(
        name,
        optionalValue(children[1])
      ), span);
    }
  );
  const AtPreludeWhitespace = node(
    'AtPreludeWhitespace',
    noTrivia(regex(/[ \t\n\r\f]+/)),
    children => authoredText(children)
  );
  const AtPreludeComma = node(
    'AtPreludeComma',
    noTrivia(literal(',')),
    children => authoredText(children)
  );
  const AtPreludeGroup = node(
    'AtPreludeGroup',
    noTrivia(choice(
      balanced('(', ')'),
      balanced('[', ']')
    )),
    children => authoredText(children)
  );
  const AtPreludeQuoted = node(
    'AtPreludeQuoted',
    noTrivia(choice(
      customSingleQuoted,
      customDoubleQuoted
    )),
    children => authoredText(children)
  );
  const atPreludeTextSegment = regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/ \t\n\r\f,;{}()[\]"'])+/);
  const AtPreludeText = node(
    'AtPreludeText',
    noTrivia(atPreludeTextSegment),
    children => authoredText(children)
  );
  const AtRulePreludeSegments = node(
    'AtRulePreludeSegments',
    parser(
      { trivia: commentTrivia },
      many(choice(
        AtPreludeWhitespace,
        AtPreludeComma,
        AtPreludeGroup,
        AtPreludeQuoted,
        AtPreludeText
      ))
    ),
    (children, _fields, _span, _rawChildren, triviaLog) => semanticTextWithTriviaGaps(children, triviaLog)
  );
  const LayerStatement = node(
    'LayerStatement',
    sequence(
      g.CssSyntaxLayerAtKeyword,
      g.StatementPrelude,
      literal(';')
    ),
    children => atRuleStatement(
      tokenText(children[0]),
      optionalValue(children[1])
    )
  );

  const AtPrelude = node(
    'AtPrelude',
    g.AtRulePreludeSegments,
    (children) => {
      const text = children.length === 0 ? '' : tokenText(children[0]).trim();
      return text === '' ? null : any(text);
    }
  );
  const StatementPrelude = node(
    'StatementPrelude',
    g.AtRulePreludeSegments,
    (children) => {
      const text = children.length === 0 ? '' : tokenText(children[0]).trim();
      return text === '' ? null : any(text);
    }
  );
  const OpaqueAtPrelude = node(
    'OpaqueAtPrelude',
    g.CssOpaqueCapturePrelude,
    (children) => {
      const text = children.length === 0 ? '' : tokenText(children[0]).trim();
      return text === '' ? null : text;
    }
  );
  const OpaqueBody = node(
    'OpaqueBody',
    g.CssOpaqueCaptureBody,
    children => children.length === 0 ? '' : tokenText(children[0])
  );
  const OpaqueAtRuleBlock = node(
    'OpaqueAtRuleBlock',
    sequence(
      g.CssSyntaxGenericAtRuleName,
      noTrivia(sequence(
        g.OpaqueAtPrelude,
        literal('{'),
        g.OpaqueBody,
        literal('}')
      ))
    ),
    (children) => {
      const prelude = children[1];
      const rawBody = children[3];
      if ((prelude !== null && typeof prelude !== 'string') || typeof rawBody !== 'string') {
        throw new TypeError('OpaqueAtRuleBlock lost its grammar-owned raw facts.');
      }
      return opaqueAtRuleBlock(
        tokenText(children[0]!),
        prelude,
        rawBody
      );
    }
  );
  const RoutedOpaqueAtRuleBlock = node(
    'OpaqueAtRuleBlock',
    sequence(
      routed(),
      noTrivia(sequence(
        g.OpaqueAtPrelude,
        literal('{'),
        g.OpaqueBody,
        literal('}')
      ))
    ),
    (children) => {
      const prelude = children[1];
      const rawBody = children[3];
      if ((prelude !== null && typeof prelude !== 'string') || typeof rawBody !== 'string') {
        throw new TypeError('OpaqueAtRuleBlock lost its grammar-owned raw facts.');
      }
      return opaqueAtRuleBlock(
        tokenText(children[0]!),
        prelude,
        rawBody
      );
    }
  );

  /*
   * A media/container feature value may be a `<ratio>` — media-queries-4 §2.1,
   * `<number> [ / <number> ]?` — as in `(aspect-ratio: 16/9)`. The component
   * value language has no top-level slash (only the permissive declaration
   * fallback carries one), so the query value takes the ratio's slash tail
   * explicitly and reduces it to the same typed Operation the prelude already
   * uses for `:` and the range comparisons. Left-factored on the atom: the
   * no-slash majority parses one value and takes an absent optional tail
   * instead of speculating a doomed ratio arm first.
   *
   * `<mf-value>` is ONE component value (media-queries-4 §4: `<number>`,
   * `<dimension>`, `<ident>` or `<ratio>`), so this takes TypedValue, not
   * the space/comma-list ValueList. A list-valued operand (`(foo: bar baz)`)
   * is `<general-enclosed>` per §3.1, and the whole-list production could not
   * represent one anyway: its multi-part slot is an array, which the enclosing
   * feature reducers cannot place in an Operation. Matching that shape here and
   * failing in the reduction is what let a raw `Error` escape `parse()`; the
   * shape now fails to MATCH, so the caller gets a positioned CssParseError,
   * and `@supports` falls through to its general-enclosed arm as intended.
   */
  const QueryValue = node(
    'QueryValue',
    sequence(
      g.TypedValue,
      optional(sequence(
        literal('/'),
        g.TypedValue
      ))
    ),
    (children) => {
      const values = valueChildren(children);
      const numerator = values[0]!;
      const denominator = values[1];
      if (denominator === undefined) {
        return numerator;
      }
      return operation(
        '/',
        numerator,
        denominator
      );
    }
  );
  const QueryBareFeature = node(
    'QueryBareFeature',
    sequence(
      literal('('),
      g.Property,
      literal(')')
    ),
    children => block(keyword(tokenText(children[1]!)))
  );
  const QueryColonFeature = node(
    'QueryColonFeature',
    sequence(
      literal('('),
      g.Property,
      literal(':'),
      QueryValue,
      literal(')')
    ),
    children => block(operation(
      ':',
      keyword(tokenText(children[1]!)),
      firstValue(children)
    ))
  );
  const QueryComparisonFeature = node(
    'QueryComparisonFeature',
    sequence(
      literal('('),
      g.Property,
      g.CssSyntaxQueryComparisonOperator,
      QueryValue,
      optional(sequence(
        g.CssSyntaxQueryComparisonOperator,
        QueryValue
      )),
      literal(')')
    ),
    children => block(chainedQueryComparison(
      keyword(tokenText(children[1]!)),
      children
    ))
  );

  /*
   * Media/container ranges can put the feature name between two values:
   * `(100em < width < 200em)`. Keep both comparisons as typed Operations;
   * the outer operation preserves their authored order without raw-prelude
   * fallback or a secondary query parser.
   */
  const QueryRangeFeature = node(
    'QueryRangeFeature',
    sequence(
      literal('('),
      QueryValue,
      g.CssSyntaxQueryComparisonOperator,
      g.Property,
      optional(sequence(
        g.CssSyntaxQueryComparisonOperator,
        QueryValue
      )),
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
      let result = operation(
        operators[0]!,
        values[0]!,
        property
      );
      if (operators.length > 1) {
        const right = values[1];
        if (right === undefined) {
          throw new Error('CSS AST query range lost its trailing value');
        }
        result = operation(
          operators[1]!,
          result,
          right
        );
      }
      return block(result);
    }
  );
  const QueryFeature = node(
    'QueryFeature',
    choice(
      QueryBareFeature,
      QueryColonFeature,
      QueryComparisonFeature,
      QueryRangeFeature
    ),
    { project: 0 }
  );
  const mediaTypeKeywordReserved = keywords(
    ['only', 'layer'],
    { caseInsensitive: true, boundary: '-_0-9A-Za-z' }
  );
  const containerNameReserved = keywords(
    ['none'],
    { caseInsensitive: true, boundary: '-_0-9A-Za-z' }
  );
  const QueryNonOnlyKeyword = node(
    'QueryNonOnlyKeyword',
    sequence(
      not(mediaTypeKeywordReserved),
      g.Keyword
    ),
    (children) => {
      const value = children.find(isKeyword);
      if (value === undefined) {
        throw new Error('CSS AST query keyword requires a keyword fact');
      }
      return value;
    }
  );
  const queryFunctionOpen = token(noTrivia(sequence(
    genericIdentifier,
    literal('(')
  )));
  const queryIdentOrFunction = token(noTrivia(sequence(
    not(sequence(
      mediaTypeKeywordReserved,
      not(literal('('))
    )),
    genericIdentifier,
    optional(literal('('))
  )));
  const RoutedQueryFunction = node(
    'QueryFunction',
    sequence(
      routed(),
      scanTo(
        literal(')'),
        { skip: [balancedParens] }
      ),
      expect(
        literal(')'),
        ')'
      )
    ),
    children => funcCall(
      functionOpenName(children[0]!),
      [any(children.length > 2 ? tokenText(children[1]!) : '')]
    )
  );
  const RoutedQueryNonOnlyKeyword = node(
    'QueryNonOnlyKeyword',
    routed(),
    children => keyword(tokenText(children[0]))
  );
  const queryIdentOrFunctionTerm = dispatch(
    queryIdentOrFunction,
    when(
      endsWith('('),
      RoutedQueryFunction
    ),
    otherwise(RoutedQueryNonOnlyKeyword)
  );
  const QueryTerm = node(
    'QueryTerm',
    choice(
      g.QueryFeature,
      queryIdentOrFunctionTerm
    ),
    { project: 0 }
  );
  const QueryOnlyClause = node(
    'QueryOnlyClause',
    sequence(
      g.CssSyntaxQueryOnly,
      QueryNonOnlyKeyword,
      many(sequence(
        g.CssSyntaxQueryAndOr,
        QueryTerm
      ))
    ),
    children => spaced(children.map(child => isValue(child) ? child : keyword(tokenText(child))))
  );

  /*
   * A clause is one `<media-query>`: whitespace-joined terms only. The comma
   * belongs to the enclosing `<media-query-list>` (mediaqueries-4 §2.1), so it
   * must not be an optional separator here — swallowing it collapsed
   * `screen, print` into a SpacedValue instead of the List the other three
   * dialects produce.
   */
  const QueryClause = node(
    'QueryClause',
    choice(
      QueryOnlyClause,
      sequence(
        QueryTerm,
        many(QueryTerm)
      )
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const QueryPrelude = node(
    'QueryPrelude',
    oneOrMoreSep(
      g.QueryClause,
      literal(',')
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );
  const containerName = sequence(
    not(g.CssSyntaxQueryFunctionOpen),
    not(containerNameReserved),
    g.Keyword
  );
  const ContainerQueryClause = node(
    'ContainerQueryClause',
    sequence(
      choice(
        g.QueryFeature,
        g.QueryFunction
      ),
      many(QueryTerm)
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const ContainerQueryPrelude = node(
    'ContainerQueryPrelude',
    oneOrMoreSep(
      g.ContainerQueryClause,
      literal(',')
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );
  const ContainerPrelude = node(
    'ContainerPrelude',
    choice(
      sequence(
        containerName,
        optional(g.ContainerQueryPrelude)
      ),
      g.ContainerQueryPrelude
    ),
    (children) => {
      const values = flattenSpacedValues(valueChildren(children));
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );

  /*
   * A supports condition is deliberately distinct from the media/container
   * query prelude above. In particular it has no bare-keyword form: `@supports
   * color {}` must fail rather than being lowered to an opaque Any prelude.
   * General-enclosed carries its own raw-template content model, so it can be
   * admitted in supports without pretending that arbitrary CSS bytes are
   * FunctionCall arguments or parenthesized value expressions.
   */
  const GeneralEnclosedRaw = node(
    'GeneralEnclosedRaw',
    noTrivia(choice(
      blockComment,
      generalEnclosedText
    )),
    children => tokenText(children[0]!)
  );
  const GeneralEnclosedQuoted = node(
    'GeneralEnclosedQuoted',
    choice(
      noTrivia(sequence(
        literal('"'),
        customDoubleQuotedText,
        literal('"')
      )),
      noTrivia(sequence(
        literal('\''),
        customSingleQuotedText,
        literal('\'')
      ))
    ),
    children => children.map(tokenText).join('')
  );
  const GeneralEnclosedGroup = node(
    'GeneralEnclosedGroup',
    choice(
      noTrivia(sequence(
        literal('('),
        g.GeneralEnclosedContent,
        literal(')')
      )),
      noTrivia(sequence(
        literal('['),
        g.GeneralEnclosedContent,
        literal(']')
      )),
      noTrivia(sequence(
        literal('{'),
        g.GeneralEnclosedContent,
        literal('}')
      ))
    ),
    children => children.map(child => isInterpolation(child)
      ? child.parts.map(part => 'lit' in part ? part.lit : '').join('')
      : tokenText(child)).join('')
  );
  const GeneralEnclosedContent = node(
    'GeneralEnclosedContent',
    noTrivia(many(choice(
      GeneralEnclosedRaw,
      g.GeneralEnclosedQuoted,
      g.GeneralEnclosedGroup
    ))),
    children => interpolation([{ lit: children.map(tokenText).join('') }])
  );
  const GeneralEnclosed = node(
    'GeneralEnclosed',
    choice(
      noTrivia(sequence(
        g.CssSyntaxQueryFunctionOpen,
        g.GeneralEnclosedContent,
        literal(')')
      )),
      noTrivia(sequence(
        literal('('),
        g.GeneralEnclosedContent,
        literal(')')
      ))
    ),
    (children) => {
      const content = children.find((child): child is Interpolation => isNodeType(
        child,
        'Interpolation'
      ));
      if (content === undefined) {
        throw new TypeError('CSS general-enclosed lost its grammar-owned content.');
      }
      const head = children[0];
      return isTerminalText(head) && tokenText(head) !== '('
        ? generalEnclosed(
            'function',
            tokenText(head),
            content
          )
        : generalEnclosed(
            'paren',
            null,
            content
          );
    }
  );
  const QueryFunction = node(
    'QueryFunction',
    sequence(
      queryFunctionOpen,
      scanTo(
        literal(')'),
        { skip: [balancedParens] }
      ),
      expect(
        literal(')'),
        ')'
      )
    ),
    children => funcCall(
      functionOpenName(children[0]!),
      [any(children.length > 2 ? tokenText(children[1]!) : '')]
    )
  );
  const SupportsInParens = node(
    'SupportsInParens',
    choice(
      sequence(
        literal('('),
        g.SupportsCondition,
        literal(')')
      ),
      g.QueryFeature,
      g.GeneralEnclosed
    ),
    (children) => {
      const value = firstValue(children);
      return isValue(children[0]) ? value : block(value);
    }
  );
  const SupportsCondition = node(
    'SupportsCondition',
    choice(
      sequence(
        g.CssSyntaxQueryNot,
        g.SupportsInParens
      ),
      sequence(
        g.SupportsInParens,
        many(sequence(
          g.CssSyntaxQueryAndOr,
          g.SupportsInParens
        ))
      )
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

  /*
   * The existing public grammar currently admits a comma-separated condition
   * list for all conditional groups, including @supports. Keep the direct path
   * parity-compatible until that public grammar is intentionally tightened.
   */
  const SupportsPrelude = node(
    'SupportsPrelude',
    oneOrMoreSep(
      g.SupportsCondition,
      literal(',')
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );
  const declarationListDeclaration = sequence(
    g.Declaration,
    choice(
      literal(';'),
      peek(literal('}'))
    )
  );
  const declarationListItem = choice(declarationListDeclaration, g.NestedConditionalBlock, g.DeclarationListAtRule, g.Ruleset, literal(';'));
  const descriptorBodyItem = choice(declarationListDeclaration, literal(';'));
  const conditionalGroupBodyItem = choice(g.ConditionalBlock, g.ConditionalGroupAtRule, g.TopLevelRuleset);
  const stylesheetBodyItem = choice(g.ConditionalBlock, g.StylesheetAtRule, g.TopLevelRuleset);
  const descriptorBodyBlock = sequence(literal('{'), many(descriptorBodyItem), literal('}'));
  const declarationListBlock = sequence(literal('{'), many(declarationListItem), literal('}'));
  const conditionalGroupBodyBlock = sequence(literal('{'), many(conditionalGroupBodyItem), literal('}'));
  const stylesheetBodyBlock = sequence(literal('{'), many(stylesheetBodyItem), literal('}'));
  const pageBodyItem = choice(declarationListDeclaration, g.MarginAtRule, literal(';'));
  const pageBodyBlock = sequence(literal('{'), many(pageBodyItem), literal('}'));
  const keyframesBodyBlock = sequence(literal('{'), many(g.KeyframeBlock), literal('}'));
  const fontFeatureValuesBodyBlock = sequence(literal('{'), many(g.FeatureValueBlock), literal('}'));
  const RoutedLayerBlock = node(
    'LayerBlock',
    sequence(
      routed(),
      g.AtPrelude,
      stylesheetBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      optionalValue(children[1]),
      blockStatements(children)
    ), rawChildren)
  );
  const RoutedNestedLayerBlock = node(
    'NestedLayerBlock',
    sequence(
      routed(),
      g.AtPrelude,
      declarationListBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      optionalValue(children[1]),
      rulesetStatements(children)
    ), rawChildren)
  );
  const RoutedDescriptorBlock = node(
    'DescriptorBlock',
    sequence(
      routed(),
      g.AtPrelude,
      descriptorBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]),
      children.find(isValue) ?? null,
      children.filter(isDeclaration)
    ), rawChildren)
  );
  const RoutedPageBlock = node(
    'PageBlock',
    sequence(
      routed(),
      g.AtPrelude,
      pageBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      children.filter((value): value is AstDeclaration | AtRuleBlock => isDeclaration(value) || isAtRuleBlock(value))
    ), rawChildren)
  );
  const RoutedKeyframes = node(
    'Keyframes',
    sequence(
      routed(),
      g.AtPrelude,
      keyframesBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]),
      optionalValue(children[1]),
      blockStatements(children)
    ), rawChildren)
  );
  const RoutedFontFeatureValuesBlock = node(
    'FontFeatureValuesBlock',
    sequence(
      routed(),
      g.AtPrelude,
      fontFeatureValuesBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      children.filter(isAtRuleBlock)
    ), rawChildren)
  );
  const RoutedScopeBlock = node(
    'ScopeBlock',
    sequence(
      routed(),
      g.AtPrelude,
      declarationListBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      optionalValue(children[1]),
      rulesetStatements(children)
    ), rawChildren)
  );
  const RoutedStartingStyleBlock = node(
    'StartingStyleBlock',
    sequence(
      routed(),
      g.AtPrelude,
      stylesheetBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]),
      optionalValue(children[1]),
      blockStatements(children)
    ), rawChildren)
  );
  const RoutedNestedStartingStyleBlock = node(
    'NestedStartingStyleBlock',
    sequence(
      routed(),
      g.AtPrelude,
      declarationListBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]),
      optionalValue(children[1]),
      rulesetStatements(children)
    ), rawChildren)
  );
  const RoutedDocumentBlock = node(
    'DocumentBlock',
    sequence(
      routed(),
      g.AtPrelude,
      stylesheetBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      blockStatements(children)
    ), rawChildren)
  );
  const keyframesAtRuleNames = [
    '@keyframes',
    '@-webkit-keyframes',
    '@-moz-keyframes',
    '@-o-keyframes',
    '@-ms-keyframes'
  ];
  const StylesheetAtRule = dispatch(
    atRuleKeyword,
    cssCase(
      '@layer',
      choice(
        RoutedAtRuleStatement,
        RoutedLayerBlock
      )
    ),
    cssCase(
      '@starting-style',
      choice(
        RoutedAtRuleStatement,
        RoutedStartingStyleBlock
      )
    ),
    cssCase(
      '@scope',
      choice(
        RoutedAtRuleStatement,
        RoutedScopeBlock
      )
    ),
    cssCase(
      [
        '@font-face',
        '@counter-style',
        '@property',
        '@color-profile',
        '@font-palette-values',
        '@position-try',
        '@view-transition'
      ],
      choice(
        RoutedAtRuleStatement,
        RoutedDescriptorBlock
      )
    ),
    cssCase(
      '@page',
      choice(
        RoutedAtRuleStatement,
        RoutedPageBlock
      )
    ),
    cssCase(
      keyframesAtRuleNames,
      choice(
        RoutedAtRuleStatement,
        RoutedKeyframes
      )
    ),
    cssCase(
      '@font-feature-values',
      choice(
        RoutedAtRuleStatement,
        RoutedFontFeatureValuesBlock
      )
    ),
    cssCase(
      ['@document', '@-moz-document'],
      choice(
        RoutedAtRuleStatement,
        RoutedDocumentBlock
      )
    ),
    otherwise(choice(
      RoutedAtRuleStatement,
      RoutedOpaqueAtRuleBlock
    ))
  );
  const DeclarationListAtRule = dispatch(
    atRuleKeyword,
    cssCase(
      '@layer',
      choice(
        RoutedAtRuleStatement,
        RoutedNestedLayerBlock
      )
    ),
    cssCase(
      '@starting-style',
      choice(
        RoutedAtRuleStatement,
        RoutedNestedStartingStyleBlock
      )
    ),
    cssCase(
      '@scope',
      choice(
        RoutedAtRuleStatement,
        RoutedScopeBlock
      )
    ),
    cssCase(
      [
        '@font-face',
        '@counter-style',
        '@property',
        '@color-profile',
        '@font-palette-values',
        '@position-try',
        '@view-transition'
      ],
      choice(
        RoutedAtRuleStatement,
        RoutedDescriptorBlock
      )
    ),
    cssCase(
      '@page',
      choice(
        RoutedAtRuleStatement,
        RoutedPageBlock
      )
    ),
    cssCase(
      keyframesAtRuleNames,
      choice(
        RoutedAtRuleStatement,
        RoutedKeyframes
      )
    ),
    cssCase(
      '@font-feature-values',
      choice(
        RoutedAtRuleStatement,
        RoutedFontFeatureValuesBlock
      )
    ),
    cssCase(
      ['@document', '@-moz-document'],
      choice(
        RoutedAtRuleStatement,
        RoutedDocumentBlock
      )
    ),
    otherwise(choice(
      RoutedAtRuleStatement,
      RoutedOpaqueAtRuleBlock
    ))
  );
  const ConditionalGroupAtRule = dispatch(
    atRuleKeyword,
    cssCase(
      '@layer',
      RoutedLayerBlock
    ),
    cssCase(
      '@starting-style',
      RoutedStartingStyleBlock
    ),
    cssCase(
      '@scope',
      RoutedScopeBlock
    ),
    cssCase(
      [
        '@font-face',
        '@counter-style',
        '@property',
        '@color-profile',
        '@font-palette-values',
        '@position-try',
        '@view-transition'
      ],
      RoutedDescriptorBlock
    ),
    cssCase(
      '@page',
      RoutedPageBlock
    ),
    cssCase(
      keyframesAtRuleNames,
      RoutedKeyframes
    ),
    cssCase(
      '@font-feature-values',
      RoutedFontFeatureValuesBlock
    ),
    cssCase(
      ['@document', '@-moz-document'],
      RoutedDocumentBlock
    ),
    otherwise(RoutedOpaqueAtRuleBlock)
  );
  const LayerBlock = node(
    'LayerBlock',
    sequence(
      g.CssSyntaxLayerAtKeyword,
      g.AtPrelude,
      stylesheetBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      optionalValue(children[1]),
      blockStatements(children)
    ), rawChildren)
  );
  const NestedLayerBlock = node(
    'NestedLayerBlock',
    sequence(
      g.CssSyntaxLayerAtKeyword,
      g.AtPrelude,
      declarationListBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      optionalValue(children[1]),
      rulesetStatements(children)
    ), rawChildren)
  );

  /*
   * `@page` accepts only declarations, empty statements, and its sixteen
   * margin-box at-rules. Each margin box is declarations-only as well. The
   * generic grammar-owned header capture retains a page selector until that
   * selector syntax receives a dedicated AST node family.
   */
  const MarginAtRule = node(
    'MarginAtRule',
    sequence(
      g.CssSyntaxMarginAtKeyword,
      descriptorBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      null,
      children.filter(isDeclaration)
    ), rawChildren)
  );
  const PageBlock = node(
    'PageBlock',
    sequence(
      g.CssSyntaxPageAtKeyword,
      g.AtPrelude,
      pageBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      children.filter((value): value is AstDeclaration | AtRuleBlock => isDeclaration(value) || isAtRuleBlock(value))
    ), rawChildren)
  );
  const keyframeSelector = node(
    'keyframeSelector',
    choice(
      keyframeEndpoint,
      g.Percentage
    ),
    children => simpleSelector(sourceText(children[0]))
  );
  const KeyframeBlock = node(
    'KeyframeBlock',
    sequence(
      oneOrMoreSep(
        g.keyframeSelector,
        literal(',')
      ),

      /*
       * This is the public descriptorBody shape: empty declaration statements
       * are syntactically valid and deliberately have no AST statement node.
       */
      descriptorBodyBlock
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(rule(
      keyframeSelectorList(children),
      children.filter(isDeclaration)
    ), rawChildren), span)
  );
  const Keyframes = node(
    'Keyframes',
    sequence(
      g.CssSyntaxKeyframesAtKeyword,
      g.AtPrelude,
      keyframesBodyBlock
    ),
    (children, _fields, _span, rawChildren) => {
      return withBlockBody(atRuleBlock(
        tokenText(children[0]),
        optionalValue(children[1]),
        blockStatements(children)
      ), rawChildren);
    }
  );
  const Ruleset = node(
    'Ruleset',
    sequence(
      parser(
        { trivia: interstitialTrivia },
        g.SelectorList
      ),

      parser(
        { trivia: interstitialTrivia },
        literal('{')
      ),
      many(declarationListItem),
      expect(literal('}'), '}')
    ),
    (children, _fields, _span, rawChildren) => {
      const selector = children.find(isSelectorList);
      if (selector === undefined) {
        throw new Error('Ruleset requires a selector');
      }
      return withBlockBody(rule(
        selector,
        rulesetStatements(children)
      ), rawChildren);
    }
  );
  const TopLevelRuleset = node(
    'TopLevelRuleset',
    sequence(
      parser(
        { trivia: interstitialTrivia },
        g.TopLevelSelectorList
      ),
      parser(
        { trivia: interstitialTrivia },
        literal('{')
      ),
      many(declarationListItem),
      expect(literal('}'), '}')
    ),
    (children, _fields, _span, rawChildren) => {
      const selector = children.find(isSelectorList);
      if (selector === undefined) {
        throw new Error('TopLevelRuleset requires a selector');
      }
      return withBlockBody(rule(
        selector,
        rulesetStatements(children)
      ), rawChildren);
    }
  );
  const ConditionalBlock = node(
    'ConditionalBlock',
    choice(
      sequence(
        g.CssSyntaxSupportsAtKeyword,
        parser(
          { trivia: interstitialTrivia },
          g.SupportsPrelude
        ),
        conditionalGroupBodyBlock
      ),
      sequence(
        g.CssSyntaxMediaAtKeyword,
        g.QueryPrelude,
        conditionalGroupBodyBlock
      ),
      sequence(
        g.CssSyntaxContainerAtKeyword,
        g.ContainerPrelude,
        conditionalGroupBodyBlock
      )
    ),
    (children, _fields, _span, rawChildren) => {
      return withBlockBody(atRuleBlock(
        tokenText(children[0]!),
        children.find(isValue)!,
        blockStatements(children)
      ), rawChildren);
    }
  );
  const NestedConditionalBlock = node(
    'NestedConditionalBlock',
    choice(
      sequence(
        g.CssSyntaxSupportsAtKeyword,
        parser(
          { trivia: interstitialTrivia },
          g.SupportsPrelude
        ),
        declarationListBlock
      ),
      sequence(
        g.CssSyntaxMediaAtKeyword,
        g.QueryPrelude,
        declarationListBlock
      ),
      sequence(
        g.CssSyntaxContainerAtKeyword,
        g.ContainerPrelude,
        declarationListBlock
      )
    ),
    (children, _fields, _span, rawChildren) => {
      return withBlockBody(atRuleBlock(
        tokenText(children[0]!),
        children.find(isValue)!,
        rulesetStatements(children)
      ), rawChildren);
    }
  );
  const DescriptorBlock = node(
    'DescriptorBlock',
    sequence(
      g.CssSyntaxDescriptorAtKeyword,
      g.AtPrelude,
      descriptorBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]),
      children.find(isValue) ?? null,
      children.filter(isDeclaration)
    ), rawChildren)
  );

  /*
   * `@font-feature-values` admits exactly seven named feature blocks, each
   * containing declarations only. Preserve that public grammar shape rather
   * than lowering either level to an ordinary CSS ruleset.
   */
  const FeatureValueBlock = node(
    'FeatureValueBlock',
    sequence(
      g.CssSyntaxFontFeatureValueAtKeyword,
      descriptorBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      null,
      children.filter(isDeclaration)
    ), rawChildren)
  );
  const FontFeatureValuesBlock = node(
    'FontFeatureValuesBlock',
    sequence(
      g.CssSyntaxFontFeatureValuesAtKeyword,
      g.AtPrelude,
      fontFeatureValuesBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      children.filter(isAtRuleBlock)
    ), rawChildren)
  );
  const ScopeBlock = node(
    'ScopeBlock',
    sequence(
      g.CssSyntaxScopeAtKeyword,
      g.AtPrelude,

      /*
       * `@scope` has the public declaration-list body model, so a nested
       * scope retains the existing canonical AtRuleBlock reduction rather than
       * being rejected or routed through an opaque body.
       */
      declarationListBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      optionalValue(children[1]),
      rulesetStatements(children)
    ), rawChildren)
  );
  const StartingStyleBlock = node(
    'StartingStyleBlock',
    sequence(
      g.CssSyntaxStartingStyleAtKeyword,
      g.AtPrelude,
      stylesheetBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]),
      optionalValue(children[1]),
      blockStatements(children)
    ), rawChildren)
  );
  const NestedStartingStyleBlock = node(
    'NestedStartingStyleBlock',
    sequence(
      g.CssSyntaxStartingStyleAtKeyword,
      g.AtPrelude,
      declarationListBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]),
      optionalValue(children[1]),
      rulesetStatements(children)
    ), rawChildren)
  );
  const DocumentBlock = node(
    'DocumentBlock',
    sequence(
      g.CssSyntaxDocumentAtKeyword,
      g.AtPrelude,
      stylesheetBodyBlock
    ),
    (children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      blockStatements(children)
    ), rawChildren)
  );
  const Stylesheet = node(
    'Stylesheet',
    sequence(
      many(choice(g.ImportStatement, g.LayerStatement)),
      many(stylesheetBodyItem)
    ),
    children => stylesheet(documentStatements(children)),
    { trailingTrivia: true }
  );
  return {
    Stylesheet,
    SelectorList,
    TopLevelSelectorList,
    ComplexSelector,
    TopLevelComplexSelector,
    CompoundSelector,
    TopLevelCompoundSelector,
    BasicSelector,
    AttributeSelector,
    PseudoSelector,
    PseudoArgument,
    OfTypePseudoArgument,
    LeadingDashPseudoArgument,
    TypedNthPseudoArgument,
    LeadingDashOfTypePseudoArgument,
    TypedOfTypePseudoArgument,
    LeadingDashRawPseudoArgument,
    NestingSelector,
    Property,
    CustomProperty,
    CustomValue,
    Keyword,
    Color,
    UnicodeRange,
    Percentage,
    Dimension,
    Quoted,
    Url,
    Call,
    CalcCall,
    VarFallbackPunctuation,
    VarFallbackParen,
    VarFallbackBracket,
    VarFallbackBrace,
    VarFallbackCall,
    VarFallbackTerm,
    VarFallbackEmpty,
    VarFallbackItem,
    VarFallback,
    VarCall,
    CalcIdentOrFunction,
    CalcParen,
    ParenValue,
    RawParenValue,
    PunctuationValue,
    ValueSequence,
    ValueList,
    CalcValue,
    CalcProduct,
    CalcSum,
    Value,
    TypedValue,
    TypedValueSequence,
    TypedValueList,
    Important,
    Declaration,
    ImportStatement,
    ImportUrl,
    ImportUrlUnquoted,
    ImportTailRaw,
    ImportTailBody,
    ImportTail,
    AtRuleStatement,
    AtPreludeWhitespace,
    AtPreludeComma,
    AtPreludeGroup,
    AtPreludeQuoted,
    AtPreludeText,
    AtRulePreludeSegments,
    LayerStatement,
    AtPrelude,
    StatementPrelude,
    OpaqueAtPrelude,
    OpaqueBody,
    OpaqueAtRuleBlock,
    StylesheetAtRule,
    DeclarationListAtRule,
    ConditionalGroupAtRule,
    QueryBareFeature,
    QueryRangeFeature,
    QueryFeature,
    QueryClause,
    QueryPrelude,
    ContainerQueryClause,
    ContainerQueryPrelude,
    ContainerPrelude,
    QueryFunction,
    GeneralEnclosed,
    GeneralEnclosedContent,
    GeneralEnclosedGroup,
    GeneralEnclosedQuoted,
    SupportsInParens,
    SupportsCondition,
    SupportsPrelude,
    LayerBlock,
    NestedLayerBlock,
    ConditionalBlock,
    NestedConditionalBlock,
    DescriptorBlock,
    FeatureValueBlock,
    FontFeatureValuesBlock,
    ScopeBlock,
    StartingStyleBlock,
    NestedStartingStyleBlock,
    DocumentBlock,
    MarginAtRule,
    PageBlock,
    keyframeSelector,
    KeyframeBlock,
    Keyframes,
    Ruleset,
    TopLevelRuleset,
    whitespace,
    rw: whitespace
  };
};

export const cssGrammar = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] },
  cssFactory
)]);

export const cssAstGrammar = cssGrammar;

export const cssCstGrammar = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted], hostMode: 'cst' },
  cssFactory
)]);

export const {
  Stylesheet,
  Ruleset,
  SelectorList,
  ComplexSelector,
  CompoundSelector,
  BasicSelector,
  AttributeSelector,
  PseudoSelector,
  Declaration,
  CustomDeclaration,
  Dimension,
  Color,
  Url,
  Call,
  Quoted,
  AtRuleStatement
} = cssCstGrammar;
