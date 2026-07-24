/**
 * Direct Jess canonical-AST grammar for the public `parse()` architecture.
 *
 * It never composes the CST grammar: Parseman reductions construct canonical
 * core facts directly.
 */
import { attempt, choice, composeLeaf, field, literal, many, noTrivia, node, not, oneOrMore, optional, parser, regex, rules, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator, FieldCapture, FieldMap } from 'parseman';
import { cssAstSyntax } from '@jesscss/internal-css-recognition/recognition';
import { opaqueAtRuleRecognition } from '@jesscss/internal-css-recognition/opaque-at-rule';
import { any, apply, atRuleBlock, atRuleStatement, block, color, comment, complexCanonical, complexSelector, compoundSelectorOf, condition, decl, collection, dimension, forNode, funcCall, generalEnclosed, ifNode, interpolation, keyword, list, mixinCall, mixinDef, moduleImport, opaqueAtRuleBlock, operation, propertyReference, pseudoSelector, quoted, range, reference, selectorCapture, styleImport, stylesheet, rule, selist, simpleSelector, interpolatedSimpleSelector, spaced, url, varIndirect, variableDeclaration, variableReference, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { Apply, AtRuleBlock, AtRuleStatement, Color, Comment, ComplexSelector, CompoundSelector, Declaration, Collection, Dimension, ExtendInstruction, For, ForBinding, FunctionCall, GeneralEnclosed, If, IfBranch, InterpPart, Interpolation, Keyword, MixinCall, MixinDef, ModuleImport, ModuleImportSpecifier, OpaqueAtRuleBlock, Param, Quoted, Range, PseudoSelector, Reference, SelectorCapture, Stylesheet, Rule, SelectorList, SimpleSelector, SimpleToken, SpacedValue, Statement, StyleImport, Url, ValueNode, ValueSlot, VariableDeclaration, VariableReference, GuardNode } from '@jesscss/core/ast';

type Token = { readonly value: string };
type ExpressionFact = { readonly value: ValueNode; readonly src: string };
type JessReferenceTail = { readonly step: Reference['steps'][number]; readonly src: string };
type JessComplexTail = { readonly comb: ' ' | '>' | '+' | '~' | '||'; readonly compound: CompoundSelector };
type JessStaticAtQueryProperty = { readonly property: Keyword };
type JessAtRuleHeader = { readonly name: string; readonly prelude: ValueNode | null };
type JessMixinCallArgument = MixinCall['args'][number];

type JessAstRules = {
  JessAstDocument: Combinator<Stylesheet>;
  DirectJessComment: Combinator<Comment>;
  DirectJessVarDeclaration: Combinator<VariableDeclaration>;
  DirectJessVarReference: Combinator<VariableReference>;
  DirectJessReferenceTail: Combinator<JessReferenceTail>;
  DirectJessDollarValue: Combinator<ValueNode>;
  DirectJessDollarInterp: Combinator<Interpolation>;
  DirectJessExpressionDollarInterp: Combinator<ExpressionFact>;
  DirectJessExpression: Combinator<Interpolation>;
  DirectJessExpressionInterpolation: Combinator<ExpressionFact>;
  DirectJessExpressionQuoted: Combinator<ExpressionFact>;
  DirectJessExpressionAtom: Combinator<ExpressionFact>;
  DirectJessExpressionProduct: Combinator<ExpressionFact>;
  DirectJessExpressionSum: Combinator<ExpressionFact>;
  DirectJessExpressionCompare: Combinator<ExpressionFact>;
  DirectJessUnwrappedProductRest: Combinator<ExpressionFact>;
  DirectJessGuardValue: Combinator<GuardNode>;
  DirectJessGuardCompare: Combinator<GuardNode>;
  DirectJessGuardCall: Combinator<GuardNode>;
  DirectJessGuardPrimary: Combinator<GuardNode>;
  DirectJessGuardAnd: Combinator<GuardNode>;
  DirectJessGuardOr: Combinator<GuardNode>;
  DirectJessMixinGuard: Combinator<GuardNode>;
  DirectJessKeyword: Combinator<Keyword>;
  DirectJessQuoted: Combinator<Quoted | Interpolation>;
  DirectJessStaticQuoted: Combinator<Quoted>;
  DirectJessDimension: Combinator<Dimension>;
  DirectJessColor: Combinator<Color>;
  DirectJessUrl: Combinator<Url>;
  DirectJessInterpolatedUrl: Combinator<Url>;
  DirectJessUrlInterpolatedValue: Combinator<Interpolation>;
  DirectJessCallComponent: Combinator<ValueSlot>;
  DirectJessCallArgument: Combinator<ValueSlot>;
  DirectJessCall: Combinator<FunctionCall>;
  DirectJessCollectionEntry: Combinator<Declaration>;
  DirectJessCollection: Combinator<Collection>;
  DirectJessValueAtom: Combinator<ValueNode>;
  DirectJessValueTerm: Combinator<ValueSlot>;
  DirectJessValue: Combinator<ValueSlot>;
  DirectJessImportant: Combinator<true>;
  DirectJessDeclaration: Combinator<Declaration>;
  DirectJessMixinParam: Combinator<Param>;
  DirectJessMixinParams: Combinator<Param[]>;
  DirectJessMixinCallArg: Combinator<JessMixinCallArgument>;
  DirectJessMixinCall: Combinator<MixinCall>;
  DirectJessReferenceCall: Combinator<Reference>;
  DirectJessApply: Combinator<Apply>;
  DirectJessExtend: Combinator<ExtendInstruction[]>;
  DirectJessMixinDef: Combinator<MixinDef>;
  DirectJessSimple: Combinator<SimpleSelector>;
  DirectJessInterpolatedSimple: Combinator<SimpleSelector>;
  DirectJessAttribute: Combinator<SimpleSelector>;
  DirectJessPseudo: Combinator<SimpleToken>;
  DirectJessStaticPseudoArgument: Combinator<SelectorList | string>;
  DirectJessCompound: Combinator<CompoundSelector>;
  DirectJessStaticCompound: Combinator<CompoundSelector>;
  DirectJessStaticComplexTail: Combinator<JessComplexTail>;
  DirectJessStaticComplex: Combinator<ComplexSelector>;
  DirectJessStaticSelectorTail: Combinator<ComplexSelector>;
  DirectJessStaticSelector: Combinator<SelectorList>;
  DirectJessSelectorCapture: Combinator<SelectorCapture>;
  DirectJessComplexTail: Combinator<JessComplexTail>;
  DirectJessComplex: Combinator<ComplexSelector>;
  DirectJessSelectorTail: Combinator<ComplexSelector>;
  DirectJessSelector: Combinator<SelectorList>;
  DirectJessRule: Combinator<Rule>;
  DirectJessForName: Combinator<string>;
  DirectJessForBinding: Combinator<ForBinding>;
  DirectJessForRangeBound: Combinator<ValueNode>;
  DirectJessForRange: Combinator<Range>;
  DirectJessFor: Combinator<For>;
  DirectJessIfCondition: Combinator<GuardNode>;
  DirectJessIfGuardValue: Combinator<GuardNode>;
  DirectJessIfGuardCompare: Combinator<GuardNode>;
  DirectJessIfGuardPrimary: Combinator<GuardNode>;
  DirectJessIfGuardAnd: Combinator<GuardNode>;
  DirectJessIfGuardOr: Combinator<GuardNode>;
  DirectJessIfGuard: Combinator<GuardNode>;
  DirectJessIfBody: Combinator<Statement[]>;
  DirectJessElseIfBranch: Combinator<IfBranch>;
  DirectJessElseBranch: Combinator<IfBranch>;
  DirectJessIf: Combinator<If>;
  DirectJessStyleImport: Combinator<StyleImport>;
  DirectJessModuleSpecifier: Combinator<ModuleImportSpecifier>;
  DirectJessModuleImport: Combinator<ModuleImport>;
  DirectJessStaticAtAtom: Combinator<ValueNode>;
  DirectJessStaticAtNonOnlyKeyword: Combinator<Keyword>;
  DirectJessStaticAtNonOnlyAtom: Combinator<ValueNode>;
  DirectJessStaticAtQuery: Combinator<ValueNode>;
  DirectJessStaticAtPreludeTerm: Combinator<ValueNode>;
  DirectJessStaticAtPrelude: Combinator<ValueNode | null>;
  DirectJessMediaVariableExpression: Combinator<Interpolation>;
  DirectJessMediaPrelude: Combinator<ValueNode | null>;
  DirectJessStaticAtRuleHeader: Combinator<JessAtRuleHeader>;
  DirectJessAtRuleHeader: Combinator<JessAtRuleHeader>;
  DirectJessSupportsAtom: Combinator<ValueNode>;
  DirectJessGeneralTemplate: Combinator<Interpolation>;
  DirectJessGeneralTemplateParen: Combinator<Interpolation>;
  DirectJessGeneralTemplateSquare: Combinator<Interpolation>;
  DirectJessGeneralTemplateBrace: Combinator<Interpolation>;
  DirectJessGeneralTemplateDoubleQuoted: Combinator<Interpolation>;
  DirectJessGeneralTemplateSingleQuoted: Combinator<Interpolation>;
  DirectJessGeneralEnclosed: Combinator<GeneralEnclosed>;
  DirectJessSupportsNot: Combinator<Keyword>;
  DirectJessSupportsLogical: Combinator<Keyword>;
  DirectJessSupportsFeature: Combinator<ValueNode>;
  DirectJessSupportsInParens: Combinator<ValueNode>;
  DirectJessSupportsCondition: Combinator<ValueNode>;
  DirectJessCssImportTarget: Combinator<Quoted | Url>;
  DirectJessCssImportPrelude: Combinator<ValueNode>;
  DirectJessCharset: Combinator<AtRuleStatement>;
  DirectJessCssImport: Combinator<AtRuleStatement>;
  DirectJessSupportsAtRuleBlock: Combinator<AtRuleBlock>;
  DirectJessPropertyName: Combinator<Keyword>;
  DirectJessStaticPropertyValueAtom: Combinator<ValueNode>;
  DirectJessStaticPropertyValue: Combinator<ValueSlot>;
  DirectJessStaticPropertyCallArgument: Combinator<ValueSlot>;
  DirectJessStaticPropertyCall: Combinator<FunctionCall>;
  DirectJessStaticPropertyDescriptor: Combinator<Declaration>;
  DirectJessPropertyAtRule: Combinator<AtRuleBlock>;
  DirectJessKeyframeSelector: Combinator<SimpleSelector>;
  DirectJessKeyframeBlock: Combinator<Rule>;
  DirectJessKeyframes: Combinator<AtRuleBlock>;
  DirectJessOpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  DirectJessAtRuleBlock: Combinator<AtRuleBlock>;
  DirectJessAtRuleStatement: Combinator<AtRuleStatement>;
  whitespace: Combinator<unknown>;
};

type SharedCssAstSyntax = {
  CssAstSyntaxAttributeModifier: Combinator<string>;
  CssAstSyntaxAttributeOperator: Combinator<string>;
  CssAstSyntaxDoubleQuotedText: Combinator<string>;
  CssAstSyntaxHexColor: Combinator<string>;
  CssAstSyntaxImportant: Combinator<string>;
  CssAstSyntaxKeyframesAtKeyword: Combinator<string>;
  CssAstSyntaxKeyword: Combinator<string>;
  CssAstSyntaxNth: Combinator<string>;
  CssAstSyntaxNumber: Combinator<string>;
  CssAstSyntaxProperty: Combinator<string>;
  CssAstSyntaxInterpolatedPropertyStart: Combinator<string>;
  CssAstSyntaxInterpolatedPropertyTail: Combinator<string>;
  CssAstSyntaxQueryAndOr: Combinator<string>;
  CssAstSyntaxQueryNot: Combinator<string>;
  CssAstSyntaxQueryOnly: Combinator<string>;
  CssAstSyntaxContainerAtKeyword: Combinator<string>;
  CssAstSyntaxSingleQuotedText: Combinator<string>;
  CssAstSyntaxDimensionUnit: Combinator<string>;
  CssAstSyntaxUrlOpen: Combinator<string>;
  CssAstSyntaxUrlInner: Combinator<string>;
  CssAstSyntaxStaticUrlInner: Combinator<string>;
  CssAstSyntaxGenericAtRuleName: Combinator<string>;
  CssAstSyntaxSimple: Combinator<string>;
  CssAstSyntaxPseudoColon: Combinator<string>;
  CssAstSyntaxMediaAtKeyword: Combinator<string>;
  JessAstOpaqueStaticPrelude: Combinator<string | null>;
  JessAstOpaqueBody: Combinator<string>;
};

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-token child.');
  }
  const token = value as { readonly value: unknown };
  if (typeof token.value !== 'string') {
    throw new TypeError('Direct Jess AST grammar produced a non-token child.');
  }
  return { value: token.value };
}

function requireFields(fields: FieldMap | undefined, name: string): readonly FieldCapture[] {
  const field = fields?.[name];
  if (field === undefined) {
    throw new TypeError(`Direct Jess AST grammar lost required ${name} field.`);
  }
  return Array.isArray(field) ? field : [field];
}

function isToken(value: unknown): value is Token {
  return typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string';
}

function isExpressionFact(value: unknown): value is ExpressionFact {
  return typeof value === 'object' && value !== null && 'value' in value && 'src' in value;
}

function isJessAtRuleHeader(value: unknown): value is JessAtRuleHeader {
  return typeof value === 'object'
    && value !== null
    && 'name' in value
    && typeof value.name === 'string'
    && 'prelude' in value;
}

function requireJessAtRuleHeader(value: unknown): JessAtRuleHeader {
  if (!isJessAtRuleHeader(value)) {
    throw new TypeError('Direct Jess AST grammar produced an invalid at-rule header.');
  }
  return value;
}

function isAtRuleNameToken(value: unknown): value is Token {
  return isToken(value)
    && !('type' in value)
    && value.value.startsWith('@');
}

function isCompound(value: unknown): value is CompoundSelector {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'CompoundSelector' && 'simples' in value && Array.isArray(value.simples);
}

function isSimpleSelector(value: unknown): value is SimpleSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'SimpleSelector'
    && 'text' in value && (typeof value.text === 'string' || value.text === null)
    && 'interp' in value && (isInterpolation(value.interp) || value.interp === null);
}

function isComplexSelector(value: unknown): value is ComplexSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'ComplexSelector'
    && 'head' in value && isCompound(value.head)
    && 'tail' in value && Array.isArray(value.tail);
}

function isSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'SelectorList'
    && 'selectors' in value && Array.isArray(value.selectors)
    && value.selectors.every(isComplexSelector);
}

function isJessComplexTail(value: unknown): value is JessComplexTail {
  return typeof value === 'object' && value !== null
    && 'comb' in value && (value.comb === ' ' || value.comb === '>' || value.comb === '+' || value.comb === '~' || value.comb === '||')
    && 'compound' in value && isCompound(value.compound);
}

function isJessReferenceTail(value: unknown): value is JessReferenceTail {
  return typeof value === 'object' && value !== null
    && 'step' in value && 'src' in value && typeof value.src === 'string';
}

function isPseudoSelector(value: unknown): value is PseudoSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'PseudoSelector';
}

function isSimpleToken(value: unknown): value is SimpleToken {
  return isSimpleSelector(value) || isPseudoSelector(value);
}

function requireSimpleToken(value: unknown): SimpleToken {
  if (!isSimpleToken(value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-simple-token child.');
  }
  return value;
}

function requireCompound(value: unknown): CompoundSelector {
  if (!isCompound(value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-compound selector child.');
  }
  return value;
}

function requireComplexSelector(value: unknown): ComplexSelector {
  if (!isComplexSelector(value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-complex selector child.');
  }
  return value;
}

function requireSelectorList(value: unknown): SelectorList {
  if (!isSelectorList(value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-selector-list child.');
  }
  return value;
}

function requireJessComplexTail(value: unknown): JessComplexTail {
  if (!isJessComplexTail(value)) {
    throw new TypeError('Direct Jess AST grammar produced an invalid selector tail.');
  }
  return value;
}

function requireJessReferenceTail(value: unknown): JessReferenceTail {
  if (!isJessReferenceTail(value)) {
    throw new TypeError('Direct Jess AST grammar produced an invalid reference tail.');
  }
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Direct Jess AST grammar produced a non-string child.');
  }
  return value;
}

function requireInterpolation(value: unknown): Interpolation {
  if (!isInterpolation(value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-interpolation child.');
  }
  return value;
}

function requireKeyword(value: unknown): Keyword {
  if (!isValueNode(value) || value.type !== 'Keyword') {
    throw new TypeError('Direct Jess AST grammar produced a non-keyword child.');
  }
  return value;
}

function staticSelectorText(selector: SelectorList): string {
  return selector.selectors.map(complexCanonical).join(', ');
}

// Selector-function pseudos whose argument is retained as a structured
// `SelectorList` rather than collapsed to text. Gated on the pseudo NAME
// (lowercased, colon-stripped), never on colon count — `::slotted()` takes a
// selector argument but is absent here, so it stays opaque text. `crossable`
// (a narrower set) is decided in core. Mirrors the CSS grammar's set.
const STRUCTURED_PSEUDOS = new Set(['is', 'where', 'not', 'has', 'matches']);

function isExtendInstruction(value: unknown): value is ExtendInstruction {
  return typeof value === 'object' && value !== null
    && 'target' in value && 'partial' in value
    && typeof value.partial === 'boolean';
}

function isMixinCallArray(value: unknown): value is MixinCall[] {
  return Array.isArray(value) && value.length > 0 && value.every(isMixinCall);
}

function isExtendInstructionArray(value: unknown): value is ExtendInstruction[] {
  return Array.isArray(value) && value.length > 0 && value.every(isExtendInstruction);
}

function isValueNode(value: unknown): value is ValueNode {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && (value.type === 'Keyword'
      || value.type === 'Quoted'
      || value.type === 'VariableReference'
      || value.type === 'Reference'
      || value.type === 'PropertyReference'
      || value.type === 'Color'
      || value.type === 'Dimension'
      || value.type === 'SelectorCapture'
      || value.type === 'FunctionCall'
      || value.type === 'Operation'
      || value.type === 'Condition'
      || value.type === 'Interpolation'
      || value.type === 'GeneralEnclosed'
      || value.type === 'SpacedValue'
      || value.type === 'List'
      || value.type === 'Block'
      || value.type === 'Url'
      || value.type === 'AnonymousMixin'
      || value.type === 'Collection'
      || value.type === 'Range');
}

function isValueNodeArray(value: unknown): value is ValueNode[] {
  return Array.isArray(value) && value.every(isValueNode);
}

function isValueSlotArray(value: ValueSlot): value is readonly ValueSlot[] {
  return Array.isArray(value);
}

function valueSlot(value: ValueSlot): ValueSlot {
  if (isValueSlotArray(value)) {
    return value;
  }
  if (value.type === 'SpacedValue') {
    return value.parts;
  }
  if (value.type === 'Block' && isSpacedValue(value.inner)) {
    return { ...value, inner: value.inner.parts };
  }
  return value;
}

function isSpacedValue(value: ValueSlot): value is SpacedValue {
  return isValueNode(value) && value.type === 'SpacedValue';
}

function isValueSlotValue(value: unknown): value is ValueSlot {
  return Array.isArray(value) ? value.every(isValueSlotValue) : isValueNode(value);
}

function requireValueSlot(value: unknown): ValueSlot {
  return isValueNodeArray(value) ? value : valueSlot(requireValueNode(value));
}

function isJessMixinCallArgument(value: unknown): value is JessMixinCallArgument {
  return typeof value === 'object' && value !== null && 'value' in value && isValueSlotValue(value.value);
}

function requireValueNode(value: unknown): ValueNode {
  if (!isValueNode(value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-value child.');
  }
  return value;
}

function isGuardNode(value: unknown): value is GuardNode {
  if (typeof value !== 'object' || value === null || !('g' in value)) {
    return false;
  }
  switch (value.g) {
    case 'default':
      return true;
    case 'truth':
      return 'value' in value && isValueNode(value.value);
    case 'cmp':
      return 'op' in value && typeof value.op === 'string'
        && 'left' in value && isValueNode(value.left)
        && 'right' in value && isValueNode(value.right);
    case 'call':
      return 'name' in value && typeof value.name === 'string'
        && 'args' in value && Array.isArray(value.args) && value.args.every(isValueNode);
    case 'not':
      return 'inner' in value && isGuardNode(value.inner);
    case 'and':
    case 'or':
      return 'left' in value && isGuardNode(value.left)
        && 'right' in value && isGuardNode(value.right);
    default:
      return false;
  }
}

function requireGuardNode(value: unknown): GuardNode {
  if (!isGuardNode(value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-guard child.');
  }
  return value;
}

function isInterpolation(value: unknown): value is Interpolation {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'Interpolation' && 'parts' in value && Array.isArray(value.parts);
}

function isInterpolationLiteral(part: InterpPart): part is { readonly lit: string } {
  return 'lit' in part;
}

function appendInterpolationLiteral(parts: Interpolation['parts'], text: string): void {
  const previous = parts[parts.length - 1];
  if (previous !== undefined && isInterpolationLiteral(previous)) {
    parts[parts.length - 1] = { lit: previous.lit + text };
  } else {
    parts.push({ lit: text });
  }
}

function templateInterpolationFromChildren(children: readonly unknown[]): Interpolation {
  const parts: Interpolation['parts'] = [];
  for (const child of children) {
    if (isInterpolation(child)) {
      for (const part of child.parts) {
        if ('lit' in part) {
          appendInterpolationLiteral(parts, part.lit);
        } else {
          parts.push(part);
        }
      }
    } else {
      appendInterpolationLiteral(parts, requireToken(child).value);
    }
  }
  return interpolation(parts);
}

function requireExpressionFact(value: unknown): ExpressionFact {
  if (typeof value !== 'object' || value === null || !('value' in value) || !('src' in value)
    || typeof value.src !== 'string' || !isValueNode(value.value)) {
    throw new TypeError('Direct Jess AST grammar produced an invalid expression fact.');
  }
  return { value: value.value, src: value.src };
}

function foldExpression(children: readonly unknown[]): ExpressionFact {
  let fact = requireExpressionFact(children[0]);
  for (let index = 1; index < children.length; index += 2) {
    const operatorText = requireToken(children[index]).value;
    const right = requireExpressionFact(children[index + 1]);
    fact = {
      value: operation(operatorText.trim(), fact.value, right.value),
      src: `${fact.src}${operatorText}${right.src}`
    };
  }
  return fact;
}

function expressionSource(value: ValueNode): string {
  switch (value.type) {
    case 'Keyword': case 'Color': case 'Dimension': case 'Quoted': case 'Any': return value.src;
    case 'VariableReference': return `$${value.name}`;
    case 'Reference': return value.raw;
    case 'PropertyReference': return value.raw;
    case 'Operation': return `${expressionSource(value.left)} ${value.operator} ${expressionSource(value.right)}`;
    case 'Condition': return value.src;
    case 'Interpolation': return value.parts.map(part => 'lit' in part ? part.lit : expressionSource(part.ref)).join('');
    default: throw new TypeError(`Direct Jess expression cannot preserve source for ${value.type}.`);
  }
}

function interpolationFromChildren(
  children: readonly unknown[],
  span?: { readonly start: number; readonly end: number }
): Interpolation {
  const first = requireToken(children[1]).value;
  if (first === '$') {
    const ref = variableReference(requireToken(children[2]).value, 'live');
    if (span) {
      withSourceSpan(ref, span);
    }
    return interpolation([{ ref: varIndirect(ref, 'live'), unquote: true }]);
  }
  if (children.length === 3) {
    const ref = variableReference(first, 'live');
    if (span) {
      withSourceSpan(ref, span);
    }
    return interpolation([{ ref, unquote: true }]);
  }
  const text = first === '"' || first === '\'' ? requireToken(children[2]).value : first;
  return interpolation([{ ref: propertyReference(text, tokenSource(children)), unquote: true }]);
}

function tokenSource(children: readonly unknown[]): string {
  return children.map(requireToken).map(token => token.value).join('');
}

function interpolationValue(child: unknown): Interpolation {
  if (isInterpolation(child)) {
    return child;
  }
  const fact = requireExpressionFact(child);
  if (!isInterpolation(fact.value)) {
    throw new TypeError('Direct Jess quoted expression produced a non-interpolation fact.');
  }
  return fact.value;
}

function quotedInterpolationFromChildren(children: readonly unknown[]): Quoted | Interpolation {
  const open = requireToken(children[0]);
  if (children.length === 3 && !isInterpolation(children[1])) {
    const content = requireToken(children[1]);
    return quoted(`${open.value}${content.value}${open.value}`, content.value, open.value, false);
  }
  const parts: Interpolation['parts'] = [{ lit: open.value }];
  for (const child of children.slice(1, -1)) {
    if (isInterpolation(child) || isExpressionFact(child)) {
      parts.push(...interpolationValue(child).parts);
    } else {
      parts.push({ lit: requireToken(child).value });
    }
  }
  parts.push({ lit: open.value });
  return interpolation(parts);
}

function quotedExpressionFact(children: readonly unknown[]): ExpressionFact {
  const value = quotedInterpolationFromChildren(children);
  const src = children.map(child =>
    isExpressionFact(child)
      ? requireExpressionFact(child).src
      : isInterpolation(child)
        ? (() => {
            throw new TypeError('Direct Jess expression quote lost interpolation source.');
          })()
        : requireToken(child).value
  ).join('');
  return { value, src };
}

function reduceColonFeature(children: readonly unknown[], lostMessage: string): ValueNode {
  const propertyName = children
    .filter(isToken)
    .map(requireToken)
    .find(token => token.value !== '(' && token.value !== ')' && token.value !== ':' && token.value.trim().length > 0)?.value;
  if (propertyName === undefined) {
    throw new TypeError(lostMessage);
  }
  const value = children.find(isValueNode);
  return value === undefined ? block(keyword(propertyName)) : block(operation(':', keyword(propertyName), value));
}

function requireStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isComment(child) && !isVarDeclaration(child) && !isMixinDef(child) && !isMixinCall(child) && !isApply(child) && !isReferenceCall(child) && !isRule(child) && !isFor(child) && !isIf(child) && !isDeclaration(child) && !isStyleImport(child) && !isModuleImport(child) && !isAtRuleBlock(child) && !isAtRuleStatement(child) && !isOpaqueAtRuleBlock(child)) {
      throw new TypeError('Direct Jess AST grammar produced a non-statement child.');
    }
    statements.push(child);
  }
  return statements;
}

// Block bodies whose grammar admits array-producing arms (`$extend`) and a bare
// `;` arm: flatten mixin-call arrays, drop other arrays and stray tokens.
function collectBlockStatements(children: readonly unknown[], open: number): Statement[] {
  return requireStatements(children.slice(open, -1)
    .flatMap(child => isMixinCallArray(child) ? child : Array.isArray(child) ? [] : [child])
    .filter(child => !isToken(child)));
}

// Nested-scope bodies (mixin/for/if) whose grammar produces no array or bare
// token arms other than mixin-call expansion: flatten mixin-call arrays only.
function collectBodyStatements(children: readonly unknown[], open: number): Statement[] {
  return requireStatements(children.slice(open, -1)
    .flatMap(child => isMixinCallArray(child) ? child : [child]));
}

function requireStatementList(value: unknown): Statement[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Direct Jess AST grammar produced a non-statement list.');
  }
  return requireStatements(value);
}

function isIfBranch(value: unknown): value is IfBranch {
  return typeof value === 'object' && value !== null
    && 'guard' in value && (value.guard === null || isGuardNode(value.guard))
    && 'body' in value && Array.isArray(value.body);
}

function requireIfBranch(value: unknown): IfBranch {
  if (!isIfBranch(value)) {
    throw new TypeError('Direct Jess AST grammar produced an invalid conditional branch.');
  }
  return { guard: value.guard, body: requireStatementList(value.body) };
}

function requireIfBranchArray(value: unknown): IfBranch[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Direct Jess AST grammar produced an invalid conditional branch list.');
  }
  return value.map(requireIfBranch);
}

function requireIfBranchTuple(value: IfBranch[]): [IfBranch, ...IfBranch[]] {
  const first = value[0];
  if (first === undefined) {
    throw new TypeError('Direct Jess AST grammar produced an empty conditional branch list.');
  }
  return [first, ...value.slice(1)];
}

function isForBinding(value: unknown): value is ForBinding {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  if (value.kind === 'single') {
    return 'name' in value && typeof value.name === 'string';
  }
  return (value.kind === 'comma' || value.kind === 'bracket' || value.kind === 'tuple')
    && 'names' in value && Array.isArray(value.names)
    && value.names.every(name => name === undefined || typeof name === 'string');
}

function requireForBinding(value: unknown): ForBinding {
  if (!isForBinding(value)) {
    throw new TypeError('Direct Jess AST grammar produced an invalid for binding.');
  }
  return value;
}

function isAtRuleBlock(value: unknown): value is AtRuleBlock {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'AtRuleBlock';
}

function isAtRuleStatement(value: unknown): value is AtRuleStatement {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'AtRuleStatement';
}

function isOpaqueAtRuleBlock(value: unknown): value is OpaqueAtRuleBlock {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'OpaqueAtRuleBlock';
}

function isStyleImport(value: unknown): value is StyleImport {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'StyleImport';
}

function isApply(value: unknown): value is Apply {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Apply';
}

function isModuleImport(value: unknown): value is ModuleImport {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'ModuleImport';
}

function isReferenceCall(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Reference';
}

function isQuoted(value: unknown): value is Quoted {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Quoted';
}

function requireStaticQuoted(value: unknown): Quoted {
  if (!isQuoted(value)) {
    throw new TypeError('Direct Jess module syntax requires a static quoted path.');
  }
  return value;
}

function isComment(value: unknown): value is Comment {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Comment';
}

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && (typeof value.name === 'string' || isInterpolation(value.name))
    && 'value' in value
    && (isValueNode(value.value)
      || (Array.isArray(value.value) && value.value.every(isValueNode)));
}

function isRule(value: unknown): value is Rule {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Rule';
}

function isMixinDef(value: unknown): value is MixinDef {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'MixinDef';
}

function isMixinCall(value: unknown): value is MixinCall {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'MixinCall';
}

function isFor(value: unknown): value is For {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'For'
    && 'iterable' in value
    && 'rules' in value
    && Array.isArray(value.rules)
    && 'binding' in value;
}

function isIf(value: unknown): value is If {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'If'
    && 'branches' in value
    && Array.isArray(value.branches);
}

function requireExactToken(value: unknown, expected: string): void {
  if (requireToken(value).value !== expected) {
    throw new TypeError(`Direct Jess AST grammar produced ${requireToken(value).value} where ${expected} was required.`);
  }
}

function isVarDeclaration(value: unknown): value is VariableDeclaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VariableDeclaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && isValueSlotValue(value.value);
}

// Shared guard reducers. `$if` and mixin guards recognize the same GuardNode
// shapes through distinct combinator arms; only the recognition differs, so the
// reduction bodies are identical and shared here.
function reduceGuardTruth(children: readonly unknown[]): GuardNode {
  return { g: 'truth', value: requireExpressionFact(children[0]).value };
}
function reduceGuardCompare(children: readonly unknown[]): GuardNode {
  return {
    g: 'cmp',
    op: requireToken(children[1]).value.trim(),
    left: requireExpressionFact(children[0]).value,
    right: requireExpressionFact(children[2]).value
  };
}
function reduceGuardAnd(children: readonly unknown[]): GuardNode {
  let result = requireGuardNode(children[0]);
  for (let index = 2; index < children.length; index += 2) {
    result = { g: 'and', left: result, right: requireGuardNode(children[index]) };
  }
  return result;
}
function reduceGuardOr(children: readonly unknown[]): GuardNode {
  let result = requireGuardNode(children[0]);
  for (let index = 2; index < children.length; index += 2) {
    result = { g: 'or', left: result, right: requireGuardNode(children[index]) };
  }
  return result;
}
// Shared selector reducers. The static and dynamic selector families differ only
// in their recognition arms (static excludes interpolation); the compound,
// complex, tail, and list reductions are structurally identical.
function reduceCompound(children: readonly unknown[]): CompoundSelector {
  return compoundSelectorOf(children.map(requireSimpleToken));
}
function reduceComplex(children: readonly unknown[]): ComplexSelector {
  return complexSelector([
    { compound: requireCompound(children[0]) },
    ...children.slice(1).map(requireJessComplexTail).map(tail => ({ comb: tail.comb, compound: tail.compound }))
  ]);
}
function reduceSelectorTail(children: readonly unknown[]): ComplexSelector {
  return requireComplexSelector(children[1]);
}
function reduceSelectorList(children: readonly unknown[]): SelectorList {
  return selist(...children.map(requireComplexSelector));
}

const rawWhitespace = regex(/[ \t\n\r\f]+/);
const whitespace = trivia(rawWhitespace);
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);
const plainDoubleQuotedText = regex(/(?:[^"\\$]|\\[\s\S]|\$(?![\[(]))*/);
const plainSingleQuotedText = regex(/(?:[^'\\$]|\\[\s\S]|\$(?![\[(]))*/);
const interpolatedDoubleQuotedText = regex(/(?:[^"\\$]|\\[\s\S]|\$(?![\[(]))+/);
const interpolatedSingleQuotedText = regex(/(?:[^'\\$]|\\[\s\S]|\$(?![\[(]))+/);
// Jess's live `$` grammar does not permit CSS escapes in names. Keep that
// dialect-local fact explicit while the value keyword leaf remains shared.
const jessDollarName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const jessExprProductOperator = regex(/[ \t\n\r\f]+[*/%][ \t\n\r\f]+/);
const jessExprSumOperator = regex(/[ \t\n\r\f]+[-+][ \t\n\r\f]+/);
const jessExprCompareOperator = regex(/[ \t\n\r\f]+(?:>=|<=|>|<|=)[ \t\n\r\f]+/);
// `$if` conditions retain the CST's comparison spelling, which permits both
// adjacent (`$a>5`) and spaced (`$a > 5`) operators. This is distinct from
// expression interpolation, whose arithmetic/comparison grammar requires
// spaces to avoid value-position ambiguity.
const jessIfGuardCompareOperator = regex(/[ \t\n\r\f]*(?:>=|<=|>|<|=)[ \t\n\r\f]*/);
// The unwrapped value form deliberately excludes `/` and `%`: `/` remains a
// structured slash list in value position, and `%` has no documented unwrapped
// spelling. Wrapped `$(...)` remains the complete arithmetic syntax.
const jessUnwrappedProductOperator = regex(/[ \t\n\r\f]+\*[ \t\n\r\f]+/);
const jessUnwrappedSumOperator = regex(/[ \t\n\r\f]+[-+][ \t\n\r\f]+/);
// This is intentionally the type-predicate namespace, not general function
// syntax in a guard. The existing GuardNode evaluator accepts these names;
// recognition retains a typed argument list and never routes through source.
const jessGuardUnaryTypePredicate = regex(/\$type\.(?:iscolor|isnumber|isstring|iskeyword|ispixel|ispercentage|isem)(?![-_a-zA-Z0-9\u0080-\uffff])/);
const jessGuardIsUnitPredicate = regex(/\$type\.isunit(?![-_a-zA-Z0-9\u0080-\uffff])/);
const jessDollarInterpStructure = noTrivia(choice(
  sequence(literal('$['), literal('$'), jessDollarName, literal(']')),
  sequence(literal('$['), jessDollarName, literal(']')),
  sequence(literal('$['), literal('\''), regex(/(?:[^'\\]|\\[\s\S])*/), literal('\''), literal(']')),
  sequence(literal('$['), literal('"'), regex(/(?:[^"\\]|\\[\s\S])*/), literal('"'), literal(']'))
));
const jessSelectorTextRun = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);
const jessGeneralTemplateText = regex(/(?:[^$()\[\]{}'"\\]|\\[\s\S])+/);
// An unquoted Jess URL keeps literal URL-token bytes and `$[…]` segments as
// separate grammar facts. Whitespace, quotes, parentheses, and any other `$`
// form remain outside this closed URL slice rather than becoming raw payload.
const jessUrlInterpolatedText = regex(/(?:[^"'()$\ \t\n\r\f\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
// Media and container are excluded here so the header choice can lead every arm
// with a concrete `@` first-set (their dedicated arms own those names). Keeping
// `media`/`container` out of the generic name is what lets the whole at-rule
// subtree be `@`-dispatched instead of speculatively entered at every rule.
const jessGenericCssAtRuleName = regex(/@(?!-|(?:charset|import|supports|property|media|container|(?:-[a-z]+-)?keyframes)(?![-_a-zA-Z0-9\u0080-\uffff]))[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
const jessCharsetAtRuleName = regex(/@charset(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessImportAtRuleName = regex(/@import(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessSupportsAtRuleName = regex(/@supports(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessPropertyAtRuleName = regex(/@property(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessKeyframeEndpoint = regex(/(?:from|to)(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessKeyframePercent = regex(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)%/);

export const jessAstGrammar = composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, rules<JessAstRules>({ trivia: whitespace }, (g: JessAstRules & SharedCssAstSyntax) => {
  const DirectJessComment = node<Comment>(
    'DirectJessComment',
    choice(blockComment, lineComment),
    children => comment(requireToken(children[0]).value)
  );
  const DirectJessVarReference = node<VariableReference>(
    'DirectJessVarReference',
    choice(
      noTrivia(sequence(literal('$$'), jessDollarName)),
      noTrivia(sequence(literal('$'), jessDollarName))
    ),
    (children, _fields, span) => withSourceSpan(
      variableReference(requireToken(children.at(-1)).value, requireToken(children[0]).value === '$$' ? 'scoped' : 'live'),
      span
    )
  );
  const DirectJessDollarInterp = node<Interpolation>(
    'DirectJessDollarInterp',
    jessDollarInterpStructure,
    (children, _fields, span) => interpolationFromChildren(children, span)
  );
  const DirectJessExpressionDollarInterp = node<ExpressionFact>(
    'DirectJessExpressionDollarInterp',
    jessDollarInterpStructure,
    (children, _fields, span) => ({ value: interpolationFromChildren(children, span), src: tokenSource(children) })
  );
  const DirectJessExpressionAtom = node<ExpressionFact>(
    'DirectJessExpressionAtom',
    // `$name` references dominate expression atoms; try VarReference before the
    // `$[` interpolation form (disjoint on the char after `$`) so a plain
    // reference does not first enter and roll back the DollarInterp node frame.
    choice(g.DirectJessVarReference, g.DirectJessExpressionDollarInterp, g.DirectJessDimension, g.DirectJessColor, g.DirectJessExpressionQuoted, g.DirectJessKeyword),
    (children) => {
      if (isExpressionFact(children[0])) {
        return requireExpressionFact(children[0]);
      }
      const value = requireValueNode(children[0]);
      return { value, src: expressionSource(value) };
    }
  );
  const DirectJessExpressionProduct = node<ExpressionFact>(
    'DirectJessExpressionProduct',
    noTrivia(sequence(g.DirectJessExpressionAtom, many(sequence(jessExprProductOperator, g.DirectJessExpressionAtom)))),
    children => foldExpression(children)
  );
  const DirectJessExpressionSum = node<ExpressionFact>(
    'DirectJessExpressionSum',
    noTrivia(sequence(g.DirectJessExpressionProduct, many(sequence(jessExprSumOperator, g.DirectJessExpressionProduct)))),
    children => foldExpression(children)
  );
  const DirectJessExpressionCompare = node<ExpressionFact>(
    'DirectJessExpressionCompare',
    noTrivia(sequence(g.DirectJessExpressionSum, optional(sequence(jessExprCompareOperator, g.DirectJessExpressionSum)))),
    (children) => {
      if (children.length === 1) {
        return requireExpressionFact(children[0]);
      }
      const left = requireExpressionFact(children[0]);
      const operatorText = requireToken(children[1]).value;
      const right = requireExpressionFact(children[2]);
      const src = `${left.src}${operatorText}${right.src}`;
      return { value: condition({ g: 'cmp', op: operatorText.trim(), left: left.value, right: right.value }, src), src };
    }
  );
  // Shared sum-level operand for unwrapped arithmetic: an ExpressionAtom folded
  // with any `*` product operators. `DirectJessDollarValue` reuses this for the
  // products that follow the first (whitespace-flanked) sum operator; the first
  // product is rebuilt there from the already-parsed leading reference.
  const DirectJessUnwrappedProductRest = node<ExpressionFact>(
    'DirectJessUnwrappedProductRest',
    noTrivia(sequence(g.DirectJessExpressionAtom, many(sequence(jessUnwrappedProductOperator, g.DirectJessExpressionAtom)))),
    foldExpression
  );
  // Mixin guards use the same structural GuardNode model as $if. Keep the
  // documented Jess condition rule strict: a comparison participating in an
  // and/or chain must be parenthesized; mixed chains must group explicitly.
  // No source string is retained or reparsed after recognition.
  const DirectJessGuardValue = node<GuardNode>(
    'DirectJessGuardValue',
    g.DirectJessExpressionSum,
    reduceGuardTruth
  );
  const DirectJessGuardCompare = node<GuardNode>(
    'DirectJessGuardCompare',
    sequence(g.DirectJessExpressionSum, regex(/>=|<=|>|<|=/), g.DirectJessExpressionSum),
    reduceGuardCompare
  );
  const DirectJessGuardCall = node<GuardNode>(
    'DirectJessGuardCall',
    choice(
      sequence(jessGuardUnaryTypePredicate, literal('('), g.DirectJessValueTerm, literal(')')),
      sequence(jessGuardIsUnitPredicate, literal('('), g.DirectJessValueTerm, optional(sequence(literal(','), g.DirectJessValueTerm)), literal(')'))
    ),
    children => ({
      g: 'call',
      name: requireToken(children[0]).value.slice('$type.'.length),
      args: children.filter(isValueNode)
    })
  );
  const DirectJessGuardPrimary = node<GuardNode>(
    'DirectJessGuardPrimary',
    choice(
      sequence(regex(/not(?![-_a-zA-Z0-9\u0080-\uffff])/), literal('('), g.DirectJessMixinGuard, literal(')')),
      sequence(literal('('), g.DirectJessMixinGuard, literal(')')),
      sequence(regex(/default(?![-_a-zA-Z0-9\u0080-\uffff])/), literal('('), literal(')')),
      g.DirectJessGuardCall,
      g.DirectJessGuardValue
    ),
    (children) => {
      if (children.length === 1) {
        return requireGuardNode(children[0]);
      }
      if (requireToken(children[0]).value === 'not') {
        return { g: 'not', inner: requireGuardNode(children[2]) };
      }
      if (requireToken(children[0]).value === '(') {
        return requireGuardNode(children[1]);
      }
      return { g: 'default' };
    }
  );
  const DirectJessGuardAnd = node<GuardNode>(
    'DirectJessGuardAnd',
    sequence(g.DirectJessGuardPrimary, oneOrMore(sequence(regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessGuardPrimary))),
    reduceGuardAnd
  );
  const DirectJessGuardOr = node<GuardNode>(
    'DirectJessGuardOr',
    sequence(g.DirectJessGuardPrimary, oneOrMore(sequence(regex(/or(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessGuardPrimary))),
    reduceGuardOr
  );
  const DirectJessMixinGuard = node<GuardNode>(
    'DirectJessMixinGuard',
    choice(g.DirectJessGuardAnd, g.DirectJessGuardOr, g.DirectJessGuardCompare, g.DirectJessGuardPrimary),
    children => requireGuardNode(children[0])
  );
  const DirectJessExpression = node<Interpolation>(
    'DirectJessExpression',
    sequence(literal('$('), g.DirectJessExpressionCompare, literal(')')),
    // `$()` is the explicit arithmetic boundary. Preserve that execution fact
    // in the canonical value graph so division operates under parens-division.
    children => interpolation([{ ref: block(requireExpressionFact(children[1]).value), unquote: true }])
  );
  const DirectJessExpressionInterpolation = node<ExpressionFact>(
    'DirectJessExpressionInterpolation',
    sequence(literal('$('), g.DirectJessExpressionCompare, literal(')')),
    (children) => {
      const body = requireExpressionFact(children[1]);
      // Quoted/template positions retain the same explicit `$()` evaluation
      // boundary as a standalone expression. Otherwise the AST silently loses
      // parens-division semantics depending on where the expression appears.
      return { value: interpolation([{ ref: block(body.value), unquote: true }]), src: `${requireToken(children[0]).value}${body.src}${requireToken(children[2]).value}` };
    }
  );
  // This is only the already-modelled static escaped-string fact. An escaped
  // interpolation needs a distinct AST representation for its unquoting mode.
  const directJessEscapedStaticQuoted = choice(
    sequence(literal('~'), literal('"'), plainDoubleQuotedText, literal('"')),
    sequence(literal('~'), literal('\''), plainSingleQuotedText, literal('\''))
  );
  // Shared static plain-quoted arms. The escaped, double-, and single-quoted
  // static prefix is identical across the value, static, and expression quoted
  // families; only the interp-bearing arms and the reducer differ.
  const directJessPlainDoubleQuoted = sequence(literal('"'), plainDoubleQuotedText, literal('"'));
  const directJessPlainSingleQuoted = sequence(literal('\''), plainSingleQuotedText, literal('\''));
  const DirectJessQuoted = node<Quoted | Interpolation>(
    'DirectJessQuoted',
    choice(
      directJessEscapedStaticQuoted,
      directJessPlainDoubleQuoted,
      directJessPlainSingleQuoted,
      sequence(literal('"'), many(choice(g.DirectJessDollarInterp, g.DirectJessExpression, interpolatedDoubleQuotedText)), literal('"')),
      sequence(literal('\''), many(choice(g.DirectJessDollarInterp, g.DirectJessExpression, interpolatedSingleQuotedText)), literal('\''))
    ),
    (children) => {
      if (requireToken(children[0]).value !== '~') {
        return quotedInterpolationFromChildren(children);
      }
      const quote = requireToken(children[1]).value;
      const content = requireToken(children[2]).value;
      return quoted(`~${quote}${content}${quote}`, content, quote, true);
    }
  );
  // CSS statement/header strings are deliberately static facts. Keeping this
  // separate from the general Jess quoted form makes `$[…]`/`$(…)` fail as
  // grammar recognition, rather than reaching a reducer that could throw a
  // non-SyntaxError from the public parse path.
  const DirectJessStaticQuoted = node<Quoted>(
    'DirectJessStaticQuoted',
    choice(
      directJessEscapedStaticQuoted,
      directJessPlainDoubleQuoted,
      directJessPlainSingleQuoted
    ),
    (children) => {
      if (requireToken(children[0]).value === '~') {
        const quote = requireToken(children[1]).value;
        const content = requireToken(children[2]).value;
        return quoted(`~${quote}${content}${quote}`, content, quote, true);
      }
      const open = requireToken(children[0]).value;
      const content = requireToken(children[1]).value;
      return quoted(`${open}${content}${open}`, content, open, false);
    }
  );
  // These are source facts, not resolution instructions. The parser owns only
  // the static authored path/binding structure; Context-dispatched plugins own
  // loading, target classification, and execution.
  const directJessImportName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const directJessAsClause = sequence(regex(/as(?![-_a-zA-Z0-9\u0080-\uffff])/), directJessImportName);
  const directJessStyleAsClause = sequence(regex(/as(?![-_a-zA-Z0-9\u0080-\uffff])/), choice(literal('*'), directJessImportName));
  const DirectJessStyleImport = node<StyleImport>(
    'DirectJessStyleImport',
    choice(
      sequence(regex(/@-compose(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessQuoted, optional(directJessStyleAsClause), optional(literal(';'))),
      sequence(regex(/@-export(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessQuoted, optional(literal(';'))),
      sequence(regex(/@-import(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessQuoted, optional(literal(';')))
    ),
    (children) => {
      const source = requireToken(children[0]).value;
      const path = requireStaticQuoted(children[1]);
      const names = children.slice(2).filter(isToken)
        .map(requireToken).map(token => token.value);
      if (source === '@-compose') {
        return styleImport(path, 'compose', names.find(name => name !== 'as' && name !== ';') ?? null, false);
      }
      if (source === '@-export') {
        return styleImport(path, 'compose', null, true);
      }
      if (source === '@-import') {
        return styleImport(path, 'import');
      }
      throw new TypeError('Direct Jess AST grammar produced an unknown style import form.');
    }
  );
  const DirectJessModuleSpecifier = node<ModuleImportSpecifier>(
    'DirectJessModuleSpecifier',
    sequence(directJessImportName, optional(directJessAsClause)),
    children => ({
      name: requireToken(children[0]).value,
      alias: children.length === 3 ? requireToken(children[2]).value : null
    })
  );
  const DirectJessModuleImport = node<ModuleImport>(
    'DirectJessModuleImport',
    choice(
      sequence(regex(/@-use(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessQuoted, optional(directJessStyleAsClause), optional(literal(';'))),
      sequence(
        regex(/@-from(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessQuoted, regex(/import(?![-_a-zA-Z0-9\u0080-\uffff])/),
        choice(
          sequence(literal('*'), directJessAsClause),
          sequence(g.DirectJessModuleSpecifier, literal(','), literal('('), g.DirectJessModuleSpecifier, many(sequence(literal(','), g.DirectJessModuleSpecifier)), literal(')')),
          g.DirectJessModuleSpecifier,
          sequence(literal('('), g.DirectJessModuleSpecifier, many(sequence(literal(','), g.DirectJessModuleSpecifier)), literal(')'))
        ),
        optional(literal(';'))
      )
    ),
    (children) => {
      const source = requireToken(children[0]).value;
      const path = requireStaticQuoted(children[1]);
      if (source === '@-use') {
        const names = children.slice(2).filter(isToken)
          .map(requireToken).map(token => token.value);
        return moduleImport(path, 'use', names.find(name => name !== 'as' && name !== ';') ?? null);
      }
      if (source !== '@-from') {
        throw new TypeError('Direct Jess AST grammar produced an unknown module import form.');
      }
      const star = children.find((child): child is Token => isToken(child) && child.value === '*');
      if (star !== undefined) {
        const tokens = children.filter(isToken)
          .map(requireToken).map(token => token.value);
        const asIndex = tokens.indexOf('as');
        return moduleImport(path, 'from', asIndex >= 0 ? tokens[asIndex + 1] ?? null : null);
      }
      const imports = children.filter((child): child is ModuleImportSpecifier => typeof child === 'object' && child !== null && 'name' in child && 'alias' in child);
      const hasNamedGroup = children.some(child => isToken(child) && child.value === '(');
      if (!hasNamedGroup) {
        if (imports.length !== 1) {
          throw new TypeError('Direct Jess AST grammar produced invalid default module import bindings.');
        }
        return moduleImport(path, 'from', null, [], imports[0]!.name);
      }
      const commaBeforeNamedGroup = children.some((child, index) => index > 0 && isToken(child) && child.value === ',' && children.slice(index + 1).some(next => isToken(next) && next.value === '('));
      return commaBeforeNamedGroup
        ? moduleImport(path, 'from', null, imports.slice(1), imports[0]!.name)
        : moduleImport(path, 'from', null, imports);
    }
  );
  const DirectJessExpressionQuoted = node<ExpressionFact>(
    'DirectJessExpressionQuoted',
    choice(
      directJessEscapedStaticQuoted,
      directJessPlainDoubleQuoted,
      directJessPlainSingleQuoted,
      sequence(literal('"'), many(choice(g.DirectJessExpressionDollarInterp, g.DirectJessExpressionInterpolation, interpolatedDoubleQuotedText)), literal('"')),
      sequence(literal('\''), many(choice(g.DirectJessExpressionDollarInterp, g.DirectJessExpressionInterpolation, interpolatedSingleQuotedText)), literal('\''))
    ),
    (children) => {
      if (requireToken(children[0]).value !== '~') {
        return quotedExpressionFact(children);
      }
      const quote = requireToken(children[1]).value;
      const content = requireToken(children[2]).value;
      const value = quoted(`~${quote}${content}${quote}`, content, quote, true);
      return { value, src: value.src };
    }
  );
  const DirectJessKeyword = node<Keyword>(
    'DirectJessKeyword',
    g.CssAstSyntaxKeyword,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectJessDimension = node<Dimension>(
    'DirectJessDimension',
    noTrivia(sequence(g.CssAstSyntaxNumber, optional(g.CssAstSyntaxDimensionUnit))),
    (children) => {
      const numberText = requireToken(children[0]).value;
      const unit = children.length > 1 ? requireToken(children[1]).value : '';
      return dimension(Number(numberText), unit, `${numberText}${unit}`);
    }
  );
  const DirectJessColor = node<Color>(
    'DirectJessColor',
    g.CssAstSyntaxHexColor,
    children => color(requireToken(children[0]).value)
  );
  const DirectJessUrlInterpolatedValue = node<Interpolation>(
    'DirectJessUrlInterpolatedValue',
    noTrivia(sequence(
      optional(jessUrlInterpolatedText),
      choice(g.DirectJessDollarInterp, g.DirectJessExpression),
      many(choice(jessUrlInterpolatedText, g.DirectJessDollarInterp, g.DirectJessExpression))
    )),
    (children) => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolation(child)) {
          parts.push(...child.parts);
        } else {
          parts.push({ lit: requireToken(child).value });
        }
      }
      return interpolation(parts);
    }
  );
  // Static CSS at-rule headers use this closed URL production. Dynamic URL
  // segments are admitted only by the value and CSS-import productions below.
  const DirectJessUrl = node<Url>(
    'DirectJessUrl',
    sequence(g.CssAstSyntaxUrlOpen, optional(choice(g.DirectJessStaticQuoted, g.CssAstSyntaxStaticUrlInner)), literal(')')),
    (children) => {
      if (children.length === 2) {
        return url(any(''));
      }
      const body = children[1];
      return isValueNode(body) ? url(body) : url(any(requireToken(body).value));
    }
  );
  // Ordinary Jess value URLs retain `$[…]` as typed interpolation, instead of
  // lowering it to opaque URL text or a generic function call.
  const DirectJessInterpolatedUrl = node<Url>(
    'DirectJessInterpolatedUrl',
    sequence(g.CssAstSyntaxUrlOpen, choice(g.DirectJessQuoted, g.DirectJessUrlInterpolatedValue), literal(')')),
    children => url(requireValueNode(children[1]))
  );
  // These static selector reductions are deliberately declared before values:
  // `*[…]` uses them as an ordered selector payload, while selectors themselves
  // never need to parse a value. Keeping that dependency one-way avoids a
  // recording-phase forward-reference cycle.
  const DirectJessSimple = node<SimpleSelector>(
    'DirectJessSimple',
    g.CssAstSyntaxSimple,
    children => simpleSelector(requireToken(children[0]).value)
  );
  // Cheap superset lookahead so an ordinary `.card` simple selector does not
  // consume its `[.#]`+text run, fail the required `$[…]`, and backtrack a
  // re-parse through DirectJessSimple. The predicate mirrors this arm's own
  // leading shape (optional class/id sigil + selector-text run) and requires a
  // `$[` immediately after it, so the `$[` is bound to THIS simple selector and
  // a sibling selector's interpolation never falsely admits a plain one.
  const directInterpSimpleAhead = not(not(regex(/[.#]?[-_a-zA-Z0-9\u0080-\uffff]*\$\[/)));
  const DirectJessInterpolatedSimple = node<SimpleSelector>(
    'DirectJessInterpolatedSimple',
    noTrivia(sequence(
      directInterpSimpleAhead,
      optional(regex(/[.#]/)),
      many(jessSelectorTextRun),
      g.DirectJessDollarInterp,
      many(choice(g.DirectJessDollarInterp, jessSelectorTextRun))
    )),
    (children) => {
      const parts: Interpolation['parts'] = [];
      const append = (part: Interpolation['parts'][number]): void => {
        const previous = parts[parts.length - 1];
        if (isInterpolationLiteral(part) && previous !== undefined && isInterpolationLiteral(previous)) {
          parts[parts.length - 1] = { lit: previous.lit + part.lit };
        } else {
          parts.push(part);
        }
      };
      for (const child of children) {
        if (isInterpolation(child)) {
          child.parts.forEach(append);
        } else {
          // The superset lookahead emits a throwaway match token (`…$[`). Real
          // selector-text chunks never contain `$`, so this content check drops
          // only that throwaway, independent of its position.
          const text = requireToken(child).value;
          if (text.includes('$')) {
            continue;
          }
          append({ lit: text });
        }
      }
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const directJessAttributeDoubleQuoted = noTrivia(sequence(literal('"'), g.CssAstSyntaxDoubleQuotedText, literal('"')));
  const directJessAttributeSingleQuoted = noTrivia(sequence(literal('\''), g.CssAstSyntaxSingleQuotedText, literal('\'')));
  const DirectJessAttribute = node<SimpleSelector>(
    'DirectJessAttribute',
    sequence(
      literal('['),
      g.CssAstSyntaxKeyword,
      optional(sequence(
        g.CssAstSyntaxAttributeOperator,
        choice(directJessAttributeDoubleQuoted, directJessAttributeSingleQuoted, g.CssAstSyntaxKeyword),
        optional(g.CssAstSyntaxAttributeModifier)
      )),
      literal(']')
    ),
    children => simpleSelector(children.map(requireToken).map(token => token.value).join(''))
  );
  const DirectJessPseudo = node<SimpleToken>(
    'DirectJessPseudo',
    // Insignificant whitespace may surround a functional pseudo's argument inside
    // its parens (`:not( .b )`, `:nth-child( 2n+1 )`). Consume it here so valid
    // CSS is accepted in the .jess dialect exactly as the canonical CSS grammar
    // accepts it; it is trivia, so the serialized argument stays normalized.
    sequence(
      g.CssAstSyntaxPseudoColon,
      g.CssAstSyntaxKeyword,
      optional(sequence(literal('('), optional(rawWhitespace), g.DirectJessStaticPseudoArgument, optional(rawWhitespace), literal(')')))
    ),
    (children) => {
      const head = `${requireToken(children[0]).value}${requireToken(children[1]).value}`;
      // The argument reduces to a `SelectorList` or a plain An+B string; the
      // colon, name, parens, and surrounding-whitespace children are all tokens,
      // so a find on those two shapes locates the argument regardless of whether
      // optional whitespace is present.
      const arg = children.find((child): child is SelectorList | string => isSelectorList(child) || typeof child === 'string');
      if (arg === undefined) {
        return simpleSelector(head);
      }
      // Parser = STRUCTURE + trivia only. A whitelisted selector-function pseudo
      // keeps the parsed `args` (SelectorList) and does NOT join: core serialize
      // owns the inline `:is(a, b)` rule (`pseudoCanonical`). The nth/opaque path
      // still collapses to canonical SimpleSelector text via `staticSelectorText`.
      if (isSelectorList(arg) && STRUCTURED_PSEUDOS.has(requireToken(children[1]).value.toLowerCase())) {
        return pseudoSelector(head, arg);
      }
      const argText = isSelectorList(arg) ? staticSelectorText(arg) : requireString(arg);
      return simpleSelector(`${head}(${argText})`);
    }
  );
  const DirectJessStaticCompound = node<CompoundSelector>(
    'DirectJessStaticCompound',
    noTrivia(oneOrMore(choice(parser({ trivia: whitespace }, g.DirectJessAttribute), g.DirectJessPseudo, g.DirectJessSimple))),
    reduceCompound
  );
  const directJessCombinator = choice(literal('||'), literal('>'), literal('+'), literal('~'));
  const DirectJessStaticComplexTail = node<JessComplexTail>(
    'DirectJessStaticComplexTail',
    sequence(optional(directJessCombinator), g.DirectJessStaticCompound),
    (children) => {
      const compound = children.find(isCompound);
      if (compound === undefined) {
        throw new TypeError('Direct Jess static selector requires a compound tail.');
      }
      const token = children.find(isToken);
      const comb = token?.value ?? ' ';
      if (comb !== ' ' && comb !== '>' && comb !== '+' && comb !== '~' && comb !== '||') {
        throw new TypeError('Direct Jess static selector produced an invalid combinator.');
      }
      return { comb, compound };
    }
  );
  const DirectJessStaticComplex = node<ComplexSelector>(
    'DirectJessStaticComplex',
    sequence(g.DirectJessStaticCompound, many(g.DirectJessStaticComplexTail)),
    reduceComplex
  );
  const DirectJessStaticSelectorTail = node<ComplexSelector>(
    'DirectJessStaticSelectorTail',
    parser({ trivia: whitespace }, sequence(literal(','), g.DirectJessStaticComplex)),
    reduceSelectorTail
  );
  const DirectJessStaticSelector = node<SelectorList>(
    'DirectJessStaticSelector',
    parser({ trivia: whitespace }, sequence(g.DirectJessStaticComplex, many(g.DirectJessStaticSelectorTail))),
    reduceSelectorList
  );
  // The selector-list shared by ordinary selectors and `*[…]` is deliberately
  // limited to authored static pseudo arguments and typed An+B forms. CSS's
  // generic raw pseudo-argument arm is not used here: it would hide dynamic
  // Jess interpolation as source text.
  // Try typed An+B first: otherwise `-n+2` is prematurely claimed as a static
  // `-n` selector. `of` needs an authored separator, so `2n+1of .item` cannot
  // be silently normalized into the distinct `2n+1 of .item` syntax.
  const directJessStaticNthOfHead = regex(/(?:even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+)[ \t\n\r\f]+of(?![-_a-zA-Z0-9\u0080-\uffff])[ \t\n\r\f]+/i);
  // The trailing lookahead tolerates insignificant whitespace before `)` so a
  // valid CSS `:nth-child( 2n+1 )` argument is recognized; `DirectJessPseudo`
  // consumes that surrounding paren whitespace (Selectors-4 §6.6.2,
  // https://www.w3.org/TR/selectors-4/#anb-microsyntax).
  const directJessStaticNthPseudoArgument = choice(
    sequence(directJessStaticNthOfHead, parser({ trivia: whitespace }, g.DirectJessStaticSelector), regex(/(?=[ \t\n\r\f]*\))/)),
    sequence(g.CssAstSyntaxNth, regex(/(?=[ \t\n\r\f]*\))/))
  );
  // Retain the parsed `SelectorList` rather than collapsing it to text: a
  // whitelisted selector-function pseudo (`:is`/`:not`/…) keeps it as structured
  // `args` and never canonicalizes at parse (the inner `_canon` memos stay
  // unpopulated). The typed An+B / `2n+1 of …` arm still yields scanned text;
  // `DirectJessPseudo` derives opaque SimpleSelector text from either shape.
  const DirectJessStaticPseudoArgument = node<SelectorList | string>(
    'DirectJessStaticPseudoArgument',
    choice(
      directJessStaticNthPseudoArgument,
      parser({ trivia: whitespace }, g.DirectJessStaticSelector)
    ),
    (children) => {
      const selector = children.find(isSelectorList);
      const nth = children.find(isToken);
      if (nth === undefined) {
        if (selector === undefined) {
          throw new TypeError('Direct Jess static pseudo argument lost its selector.');
        }
        return selector;
      }
      return selector === undefined ? nth.value : `${nth.value}${staticSelectorText(selector)}`;
    }
  );
  const DirectJessSelectorCapture = node<SelectorCapture>(
    'DirectJessSelectorCapture',
    sequence(literal('*['), g.DirectJessStaticSelector, literal(']')),
    (children) => {
      const branches = requireSelectorList(children[1]).selectors.map(complexCanonical);
      return selectorCapture(branches, `*[${branches.join(', ')}]`);
    }
  );
  // Modern CSS function components can carry one structural slash separator
  // (`rgb(15 23 42 / .22)`). Keep that separator inside the call grammar: `/`
  // remains unavailable as unwrapped Jess arithmetic, and a second or dangling
  // separator cannot fall back to a generic function or raw value.
  const DirectJessCallComponent = node<ValueSlot>(
    'DirectJessCallComponent',
    sequence(
      g.DirectJessValueTerm,
      optional(sequence(optional(rawWhitespace), literal('/'), optional(rawWhitespace), g.DirectJessValueTerm))
    ),
    (children) => {
      const values = children.filter((child): child is ValueSlot => Array.isArray(child) || isValueNode(child));
      if (values.length === 1) {
        return values[0]!;
      }
      if (values.length === 2 && children.some(child => isToken(child) && child.value === '/')) {
        // Keep each side as one slash-list item.  The left side of modern
        // `rgb(15 23 42 / .22)` is an authored space group, not three slash
        // operands; flattening it changes the public AST and renders
        // `rgb(15 / 23 / 42 / .22)`.
        return list([values[0]!, values[1]!], '/');
      }
      throw new TypeError('Direct Jess AST call component produced unexpected children.');
    }
  );
  const DirectJessCallArgument = node<ValueSlot>(
    'DirectJessCallArgument',
    sequence(literal(','), optional(regex(/[ \t\n\r\f]+/)), g.DirectJessCallComponent),
    (children) => {
      if ((children.length !== 2 && children.length !== 3) || requireToken(children[0]).value !== ',') {
        throw new TypeError('Direct Jess AST call argument produced unexpected children.');
      }
      const value = children.at(-1);
      return Array.isArray(value) ? value : requireValueNode(value);
    }
  );
  // A direct call owns its argument boundaries and recursive call shape. Its
  // components retain the existing Jess value-term contract, including
  // variable-led expressions (documented function arguments); the new slash
  // separator does not make `/` available as bare Jess arithmetic. Dynamic
  // `$[...]` interpolation and named arguments remain outside this slice until
  // they have typed reductions.
  const DirectJessCall = node<FunctionCall>(
    'DirectJessCall',
    sequence(
      not(regex(/url(?=\()/i)), g.CssAstSyntaxKeyword,
      literal('('),
      optional(sequence(g.DirectJessCallComponent, many(g.DirectJessCallArgument))),
      literal(')')
    ),
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '(' || requireToken(children.at(-1)).value !== ')') {
        throw new TypeError('Direct Jess AST call produced unexpected children.');
      }
      const args: ValueSlot[] = [];
      for (let index = 2; index < children.length - 1; index += 1) {
        const value = children[index];
        args.push(Array.isArray(value) ? value : requireValueNode(value));
      }
      return funcCall(requireToken(children[0]).value, args);
    }
  );
  // Jess collections are value-position maps. The canonical AST already has a
  // dedicated detached-ruleset carrier and the serializer already iterates its
  // declaration names/values for bracket `$for` bindings; lower it directly
  // instead of preserving a CST-shaped collection node or opaque source bytes.
  const DirectJessCollectionEntry = node<Declaration>(
    'DirectJessCollectionEntry',
    sequence(g.CssAstSyntaxProperty, literal(':'), parser({ trivia: whitespace }, g.DirectJessValue), optional(literal(';'))),
    (children) => {
      const value = children[2];
      return decl(requireToken(children[0]).value, Array.isArray(value) ? value : valueSlot(requireValueNode(value)));
    }
  );
  const DirectJessCollection = node<Collection>(
    'DirectJessCollection',
    sequence(literal('{'), parser({ trivia: whitespace }, many(g.DirectJessCollectionEntry)), optional(rawWhitespace), literal('}')),
    children => collection(children.filter(isDeclaration))
  );
  // A chained reference is a value-only Jess form. It requires a tail so a
  // plain `$name` retains the existing VariableReference reduction, while the
  // authored chain stays one typed Reference without a post-parse walk.
  const DirectJessReferenceTail = choice(
    node<JessReferenceTail>(
      'DirectJessReferenceDotTail',
      noTrivia(sequence(literal('.'), jessDollarName)),
      (children) => {
        const name = requireToken(children[1]).value;
        return { step: { type: 'DotLookup', name }, src: `.${name}` };
      }
    ),
    node<JessReferenceTail>(
      'DirectJessReferenceBracketTail',
      noTrivia(sequence(
        literal('['),
        choice(g.DirectJessVarReference, g.DirectJessQuoted, regex(/[+-]?\d+(?:\.\d+)?/), g.DirectJessKeyword),
        literal(']')
      )),
      (children) => {
        const key = children[1];
        if (isValueNode(key) && key.type === 'VariableReference') {
          return { step: { type: 'BracketLookup', key, keyKind: 'var' }, src: `[${key.lookup === 'scoped' ? '$$' : '$'}${key.name}]` };
        }
        if (isValueNode(key) && key.type === 'Quoted') {
          return { step: { type: 'BracketLookup', key, keyKind: 'member' }, src: `[${key.src}]` };
        }
        if (isToken(key)) {
          return { step: { type: 'BracketLookup', key: Number(key.value), keyKind: 'index', indexBase: 0 }, src: `[${key.value}]` };
        }
        if (isValueNode(key) && key.type === 'Keyword') {
          return { step: { type: 'BracketLookup', key, keyKind: 'member' }, src: `[${key.src}]` };
        }
        throw new TypeError('Direct Jess reference bracket key must be a typed value.');
      }
    )
  );
  // Left-factored `$`/`$$`+name so the ubiquitous dollar value is parsed ONCE.
  // The leading `DirectJessVarReference` is shared across all four continuations
  // — plain reference, accessor-tail chain, unwrapped `/` slash list, and
  // unwrapped `+ - *` arithmetic — which are disjoint by their next token
  // (`.`/`[` tails, `/` slash, whitespace-flanked operators). Previously each
  // arm re-parsed `$name` (up to four VariableReference builds per plain ref,
  // each allocating a discarded source-spanned node); this reduction preserves
  // every prior AST shape while recognizing the reference exactly once.
  const DirectJessDollarValue = node<ValueNode>(
    'DirectJessDollarValue',
    noTrivia(sequence(
      g.DirectJessVarReference,
      optional(choice(
        // Slash list: `/` is intentionally not an unwrapped Operation. Preserve
        // the authored value boundary as an explicit slash List; `$( $w / 2 )`
        // is the arithmetic spelling.
        sequence(optional(rawWhitespace), literal('/'), optional(rawWhitespace), g.DirectJessValueAtom),
        // Unwrapped arithmetic. The documented `$var + 1` form folds with the
        // same left-associative product-before-sum grouping as `$(...)`: at
        // least one operator is required (else this is a plain reference), and
        // `*` binds tighter than `+`/`-`.
        choice(
          sequence(oneOrMore(sequence(jessUnwrappedProductOperator, g.DirectJessExpressionAtom)), many(sequence(jessUnwrappedSumOperator, g.DirectJessUnwrappedProductRest))),
          sequence(many(sequence(jessUnwrappedProductOperator, g.DirectJessExpressionAtom)), oneOrMore(sequence(jessUnwrappedSumOperator, g.DirectJessUnwrappedProductRest)))
        ),
        // Accessor-tail chain (`.name`, `[key]`).
        oneOrMore(g.DirectJessReferenceTail)
      ))
    )),
    (children) => {
      const base = requireValueNode(children[0]);
      if (base.type !== 'VariableReference') {
        throw new TypeError('Direct Jess reference base must be a variable reference.');
      }
      if (children.length === 1) {
        return base;
      }
      const rest = children.slice(1);
      if (isJessReferenceTail(rest[0])) {
        const tails = rest.map(requireJessReferenceTail);
        return reference(base, tails.map(tail => tail.step), `${base.lookup === 'scoped' ? '$$' : '$'}${base.name}${tails.map(tail => tail.src).join('')}`);
      }
      if (rest.some(child => isToken(child) && child.value === '/')) {
        return list([base, requireValueNode(rest.at(-1))], '/');
      }
      // Arithmetic: rebuild the first product (leading reference plus its `*`
      // operators), then fold the whitespace-flanked sum operators over the
      // remaining pre-folded products.
      const firstProduct: unknown[] = [{ value: base, src: expressionSource(base) }];
      let index = 0;
      while (index < rest.length && isToken(rest[index]) && requireToken(rest[index]).value.trim() === '*') {
        firstProduct.push(rest[index], rest[index + 1]);
        index += 2;
      }
      const sumParts: unknown[] = [foldExpression(firstProduct)];
      while (index < rest.length) {
        sumParts.push(rest[index], rest[index + 1]);
        index += 2;
      }
      return requireExpressionFact(foldExpression(sumParts)).value;
    }
  );
  // The three `$`-headed arms (DollarValue `$name`, Expression `$(`, DollarInterp
  // `$[`) are mutually exclusive on the character after `$`, so their relative
  // order is behaviour-neutral. Plain `$name` references dominate real values, so
  // DollarValue leads the `$` group: parseman tries it first on any `$`, matching
  // references without first entering (and rolling back) the `$(` / `$[` node
  // frames. `$(`/`$[` cost one fast VarReference reject instead.
  const DirectJessValueAtom = node<ValueNode>(
    'DirectJessValueAtom',
    choice(g.DirectJessCollection, g.DirectJessDollarValue, g.DirectJessExpression, g.DirectJessDollarInterp, g.DirectJessSelectorCapture, g.DirectJessUrl, g.DirectJessInterpolatedUrl, g.DirectJessCall, g.DirectJessQuoted, g.DirectJessColor, g.DirectJessDimension, g.DirectJessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectJessValueTerm = node<ValueSlot>(
    'DirectJessValueTerm',
    noTrivia(sequence(g.DirectJessValueAtom, many(sequence(field('separator', regex(/[ \t\n\r\f]+/)), g.DirectJessValueAtom)))),
    (children, fields) => {
      const values = children.filter(isValueSlotValue);
      if (values.length === 1) {
        return values[0]!;
      }
      const separators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => typeof separator.value === 'string'
            ? separator.value
            : requireToken(separator.value).value);
      return withValueLayout(values, separators);
    }
  );
  const DirectJessValue = node<ValueSlot>(
    'DirectJessValue',
    sequence(g.DirectJessValueTerm, many(sequence(literal(','), optional(regex(/[ \t\n\r\f]+/)), g.DirectJessValueTerm))),
    (children) => {
      const values = children.filter(isValueSlotValue);
      return values.length === 1 ? values[0]! : list(values, ',');
    }
  );
  // A CSS at-rule header must stay structural. This deliberately admits only
  // static CSS atoms plus the two common query-group forms; `$…`, `$[…]`, and
  // `$(…)` are excluded rather than being hidden in an Any/raw prelude. Extend
  // this with another typed header form when Jess gives that form semantics.
  const DirectJessStaticAtAtom = node<ValueNode>(
    'DirectJessStaticAtAtom',
    choice(g.DirectJessUrl, g.DirectJessStaticQuoted, g.DirectJessColor, g.DirectJessDimension, g.DirectJessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectJessStaticAtQueryProperty = node<JessStaticAtQueryProperty>(
    'DirectJessStaticAtQueryProperty',
    g.CssAstSyntaxKeyword,
    children => ({ property: keyword(requireToken(children[0]).value) })
  );
  const directJessStaticAtQueryComparisonOperator = choice(literal('<='), literal('>='), literal('<'), literal('='), literal('>'));
  const DirectJessStaticAtComparisonQuery = node<ValueNode>(
    'DirectJessStaticAtComparisonQuery',
    choice(
      sequence(
        literal('('), optional(rawWhitespace), DirectJessStaticAtQueryProperty, optional(rawWhitespace),
        directJessStaticAtQueryComparisonOperator, optional(rawWhitespace), g.DirectJessStaticAtAtom,
        optional(rawWhitespace), literal(')')
      ),
      sequence(
        literal('('), optional(rawWhitespace), g.DirectJessStaticAtAtom, optional(rawWhitespace),
        directJessStaticAtQueryComparisonOperator, optional(rawWhitespace), DirectJessStaticAtQueryProperty,
        optional(sequence(optional(rawWhitespace), directJessStaticAtQueryComparisonOperator, optional(rawWhitespace), g.DirectJessStaticAtAtom)),
        optional(rawWhitespace), literal(')')
      )
    ),
    (children) => {
      const propertyFact = children.find((child): child is JessStaticAtQueryProperty => typeof child === 'object' && child !== null && 'property' in child);
      if (propertyFact === undefined) {
        throw new TypeError('Direct Jess static query comparison lost its property.');
      }
      const values = children.filter(isValueNode);
      const operators = children.filter(isToken).map(requireToken).map(token => token.value)
        .filter(value => value === '<' || value === '<=' || value === '=' || value === '>=' || value === '>');
      if (values.length === 0 || operators.length === 0) {
        throw new TypeError('Direct Jess static query comparison lost an operand.');
      }
      const propertyIndex = children.indexOf(propertyFact);
      const firstValueIndex = children.findIndex(isValueNode);
      let result = propertyIndex < firstValueIndex
        ? operation(operators[0]!, propertyFact.property, values[0]!)
        : operation(operators[0]!, values[0]!, propertyFact.property);
      if (operators.length === 2) {
        const trailing = values.at(-1);
        if (trailing === undefined) {
          throw new TypeError('Direct Jess static query comparison lost its range end.');
        }
        result = operation(operators[1]!, result, trailing);
      }
      return block(result);
    }
  );
  const DirectJessStaticAtQuery = node<ValueNode>(
    'DirectJessStaticAtQuery',
    noTrivia(choice(
      DirectJessStaticAtComparisonQuery,
      sequence(literal('('), optional(rawWhitespace), g.CssAstSyntaxKeyword, optional(rawWhitespace), literal(':'), optional(rawWhitespace), g.DirectJessStaticAtAtom, optional(rawWhitespace), literal(')')),
      sequence(literal('('), optional(rawWhitespace), g.CssAstSyntaxKeyword, optional(rawWhitespace), literal(')'))
    )),
    (children) => {
      if (children.length === 1 && isValueNode(children[0])) {
        return requireValueNode(children[0]);
      }
      return reduceColonFeature(children, 'Direct Jess CSS at-rule query lost its property name.');
    }
  );
  // `only` belongs to the media-type form (`only screen and (...)`), not the
  // parenthesized-condition form. The generic at-rule prelude still shares
  // the same term combinator, but this branch keeps that syntactic boundary.
  const DirectJessStaticAtNonOnlyKeyword = node<Keyword>(
    'DirectJessStaticAtNonOnlyKeyword',
    sequence(not(g.CssAstSyntaxQueryOnly), g.DirectJessKeyword),
    children => requireKeyword(children.at(-1))
  );
  const DirectJessStaticAtNonOnlyAtom = node<ValueNode>(
    'DirectJessStaticAtNonOnlyAtom',
    choice(
      g.DirectJessStaticAtQuery,
      sequence(not(g.CssAstSyntaxQueryOnly), g.DirectJessStaticAtAtom)
    ),
    children => requireValueNode(children.at(-1))
  );
  const DirectJessStaticAtPreludeTerm = node<ValueNode>(
    'DirectJessStaticAtPreludeTerm',
    noTrivia(sequence(
      choice(
        sequence(
          g.CssAstSyntaxQueryOnly,
          regex(/[ \t\n\r\f]+/),
          DirectJessStaticAtNonOnlyKeyword,
          many(sequence(regex(/[ \t\n\r\f]+/), DirectJessStaticAtNonOnlyAtom))
        ),
        sequence(
          DirectJessStaticAtNonOnlyAtom,
          many(sequence(regex(/[ \t\n\r\f]+/), DirectJessStaticAtNonOnlyAtom))
        )
      )
    )),
    (children) => {
      const values = children.filter(isValueNode);
      const startsWithOnly = children.some(child => isToken(child) && requireToken(child).value.toLowerCase() === 'only');
      return startsWithOnly ? spaced([keyword('only'), ...values]) : values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectJessStaticAtPrelude = node<ValueNode | null>(
    'DirectJessStaticAtPrelude',
    sequence(
      optional(g.DirectJessStaticAtPreludeTerm),
      many(sequence(literal(','), g.DirectJessStaticAtPreludeTerm))
    ),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 0 ? null : values.length === 1 ? values[0]! : list(values, ',');
    }
  );
  // A lone `$(name)` is the documented dynamic media prelude. It lowers
  // directly to the existing unquoted interpolation/value form; it does not
  // borrow the general expression grammar, whose bare identifier semantics are
  // deliberately different from this at-rule lookup spelling.
  const DirectJessMediaVariableExpression = node<Interpolation>(
    'DirectJessMediaVariableExpression',
    sequence(literal('$('), jessDollarName, literal(')')),
    children => interpolation([{ ref: variableReference(requireToken(children[1]).value, 'live'), unquote: true }])
  );
  const DirectJessMediaPrelude = node<ValueNode | null>(
    'DirectJessMediaPrelude',
    choice(g.DirectJessMediaVariableExpression, g.DirectJessStaticAtPrelude),
    children => children[0] === null ? null : requireValueNode(children[0])
  );
  // Statement headers remain fully static. The documented deferred media form
  // is a block-only construct, so it cannot silently become `@media $(x);`.
  // Every arm leads with a concrete `@`-first recognizer (no leading `not(...)`),
  // so the whole header — and the `DirectJessAtRuleStatement`/`AtRuleBlock` that
  // wrap it — keeps a `{@}` first-set. That lets parseman fast-reject non-`@`
  // statements at the leading char instead of entering this node frame and
  // running the media/container lookaheads at every rule. The former arm-2
  // `not(@media)` / `not(@container only)` guards are folded into the dedicated
  // media/container arms plus the `media`/`container` exclusion in
  // `jessGenericCssAtRuleName`, preserving the exact accept/reject set.
  const DirectJessStaticAtRuleHeader = node<JessAtRuleHeader>(
    'DirectJessStaticAtRuleHeader',
    choice(
      sequence(g.CssAstSyntaxMediaAtKeyword, not(choice(literal('{'), literal(';'))), g.DirectJessStaticAtPrelude),
      sequence(g.CssAstSyntaxContainerAtKeyword, not(g.CssAstSyntaxQueryOnly), g.DirectJessStaticAtPrelude),
      sequence(jessGenericCssAtRuleName, g.DirectJessStaticAtPrelude)
    ),
    (children) => {
      const name = requireToken(children.find(isToken)!).value;
      const prelude = children.find(isValueNode) ?? null;
      return { name, prelude };
    }
  );
  // Keep the dynamic extension scoped to documented block `@media $(…)`.
  // Every other header, including `@container`, stays on the static grammar;
  // mixing the deferred form with query terms remains rejected.
  const DirectJessAtRuleHeader = node<JessAtRuleHeader>(
    'DirectJessAtRuleHeader',
    choice(
      sequence(g.CssAstSyntaxMediaAtKeyword, not(literal('{')), g.DirectJessMediaPrelude),
      g.DirectJessStaticAtRuleHeader
    ),
    (children) => {
      const staticHeader = children.find(isJessAtRuleHeader);
      if (staticHeader !== undefined) {
        return staticHeader;
      }
      const name = requireToken(children.find(isAtRuleNameToken)!).value;
      const prelude = children.find(isValueNode) ?? null;
      return { name, prelude };
    }
  );
  // `@supports` is not a generic CSS header: its condition grammar owns every
  // parenthesis and logical connective.  Keep this deliberately static until a
  // typed model exists for general-enclosed forms such as `selector(...)`.
  // In particular, do not hide their arguments in Any/raw header bytes.
  const DirectJessSupportsAtom = node<ValueNode>(
    'DirectJessSupportsAtom',
    choice(g.DirectJessStaticQuoted, g.DirectJessColor, g.DirectJessDimension, g.DirectJessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectJessGeneralTemplateParen = node<Interpolation>(
    'DirectJessGeneralTemplateParen',
    sequence(literal('('), g.DirectJessGeneralTemplate, literal(')')),
    templateInterpolationFromChildren
  );
  const DirectJessGeneralTemplateSquare = node<Interpolation>(
    'DirectJessGeneralTemplateSquare',
    sequence(literal('['), g.DirectJessGeneralTemplate, literal(']')),
    templateInterpolationFromChildren
  );
  const DirectJessGeneralTemplateBrace = node<Interpolation>(
    'DirectJessGeneralTemplateBrace',
    sequence(literal('{'), g.DirectJessGeneralTemplate, literal('}')),
    templateInterpolationFromChildren
  );
  const DirectJessGeneralTemplateDoubleQuoted = node<Interpolation>(
    'DirectJessGeneralTemplateDoubleQuoted',
    sequence(literal('"'), g.DirectJessGeneralTemplate, literal('"')),
    templateInterpolationFromChildren
  );
  const DirectJessGeneralTemplateSingleQuoted = node<Interpolation>(
    'DirectJessGeneralTemplateSingleQuoted',
    sequence(literal('\''), g.DirectJessGeneralTemplate, literal('\'')),
    templateInterpolationFromChildren
  );
  const DirectJessGeneralTemplate = node<Interpolation>(
    'DirectJessGeneralTemplate',
    many(choice(
      g.DirectJessDollarInterp,
      g.DirectJessExpression,
      g.DirectJessGeneralTemplateParen,
      g.DirectJessGeneralTemplateSquare,
      g.DirectJessGeneralTemplateBrace,
      g.DirectJessGeneralTemplateDoubleQuoted,
      g.DirectJessGeneralTemplateSingleQuoted,
      jessGeneralTemplateText
    )),
    templateInterpolationFromChildren
  );
  const DirectJessGeneralEnclosed = node<GeneralEnclosed>(
    'DirectJessGeneralEnclosed',
    choice(
      sequence(g.CssAstSyntaxKeyword, literal('('), g.DirectJessGeneralTemplate, literal(')')),
      sequence(literal('('), g.DirectJessGeneralTemplate, literal(')'))
    ),
    children => children.length === 4
      ? generalEnclosed('function', requireToken(children[0]).value, requireInterpolation(children[2]))
      : generalEnclosed('paren', null, requireInterpolation(children[1]))
  );
  const DirectJessSupportsNot = node<Keyword>(
    'DirectJessSupportsNot',
    g.CssAstSyntaxQueryNot,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectJessSupportsLogical = node<Keyword>(
    'DirectJessSupportsLogical',
    g.CssAstSyntaxQueryAndOr,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectJessSupportsFeature = node<ValueNode>(
    'DirectJessSupportsFeature',
    noTrivia(choice(
      sequence(literal('('), optional(rawWhitespace), g.CssAstSyntaxKeyword, optional(rawWhitespace), literal(':'), optional(rawWhitespace), g.DirectJessSupportsAtom, optional(rawWhitespace), literal(')')),
      sequence(literal('('), optional(rawWhitespace), g.CssAstSyntaxKeyword, optional(rawWhitespace), literal(')'))
    )),
    children => reduceColonFeature(children, 'Direct Jess supports feature lost its property name.')
  );
  const DirectJessSupportsInParens = node<ValueNode>(
    'DirectJessSupportsInParens',
    choice(
      sequence(literal('('), g.DirectJessSupportsCondition, literal(')')),
      g.DirectJessSupportsFeature,
      g.DirectJessGeneralEnclosed
    ),
    (children) => {
      const value = children.find(isValueNode);
      if (value === undefined) {
        throw new TypeError('Direct Jess supports parenthesis lost its typed condition.');
      }
      return isValueNode(children[0]) ? value : block(value);
    }
  );
  const DirectJessSupportsCondition = node<ValueNode>(
    'DirectJessSupportsCondition',
    choice(
      sequence(g.DirectJessSupportsNot, g.DirectJessSupportsInParens),
      sequence(g.DirectJessSupportsInParens, many(sequence(g.DirectJessSupportsLogical, g.DirectJessSupportsInParens)))
    ),
    (children) => {
      const values = children.filter(isValueNode);
      if (values.length === 0) {
        throw new TypeError('Direct Jess supports condition lost every typed part.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectJessCharset = node<AtRuleStatement>(
    'DirectJessCharset',
    sequence(jessCharsetAtRuleName, g.DirectJessStaticQuoted, literal(';')),
    children => atRuleStatement(requireToken(children[0]).value, requireStaticQuoted(children[1]))
  );
  const DirectJessCssImportTarget = node<Quoted | Url>(
    'DirectJessCssImportTarget',
    choice(
      g.DirectJessStaticQuoted,
      sequence(g.CssAstSyntaxUrlOpen, literal(')')),
      sequence(
        g.CssAstSyntaxUrlOpen,
        choice(g.DirectJessQuoted, g.DirectJessUrlInterpolatedValue, g.CssAstSyntaxStaticUrlInner),
        literal(')')
      )
    ),
    (children) => {
      if (children.length === 1) {
        return requireStaticQuoted(children[0]);
      }
      if (children.length === 2) {
        return url(any(''));
      }
      const inner = children.find(isValueNode);
      return url(inner ?? keyword(requireToken(children[1]).value));
    }
  );
  const DirectJessCssImportPrelude = node<ValueNode>(
    'DirectJessCssImportPrelude',
    noTrivia(sequence(
      g.DirectJessCssImportTarget,
      many(sequence(regex(/[ \t\n\r\f]+/), g.DirectJessStaticAtPreludeTerm))
    )),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectJessCssImport = node<AtRuleStatement>(
    'DirectJessCssImport',
    sequence(jessImportAtRuleName, g.DirectJessCssImportPrelude, literal(';')),
    children => atRuleStatement(requireToken(children[0]).value, requireValueNode(children[1]))
  );
  // Shared block-body statement set for the at-rule-bearing blocks (`@supports`,
  // generic at-rules): identical 16-rule choice plus a bare `;` arm. Mirrors the
  // less-parser `directLessBlockStatement` const so the macro fuses a single
  // shared choice instead of re-emitting it per block.
  //
  // The `@`-headed cluster is placed AFTER DirectJessRule: a rule requires a
  // selector (never `@`) and every at-rule requires `@`, so the two are disjoint
  // and this ordering is behaviour-neutral. Because rules dominate block bodies,
  // trying Rule first means a non-`@` statement never enters (and rolls back) the
  // at-rule recognizers — only genuine `@` statements reach the cluster.
  const directJessAtBlockStatement = choice(
    g.DirectJessComment, g.DirectJessMixinCall, g.DirectJessVarDeclaration, g.DirectJessDeclaration,
    g.DirectJessMixinDef, g.DirectJessReferenceCall, g.DirectJessApply, g.DirectJessExtend,
    g.DirectJessFor, g.DirectJessIf,
    g.DirectJessRule,
    g.DirectJessSupportsAtRuleBlock, g.DirectJessKeyframes, g.DirectJessOpaqueAtRuleBlock, g.DirectJessAtRuleBlock, g.DirectJessAtRuleStatement,
    literal(';')
  );
  // Shared nested-scope statement set for `$mixin`/`$for`/`$if` bodies: identical
  // 15-rule choice with no bare `;` or `$extend` arm.
  const directJessNestedBodyStatement = choice(g.DirectJessComment, g.DirectJessMixinCall, g.DirectJessVarDeclaration, g.DirectJessDeclaration, g.DirectJessMixinDef, g.DirectJessFor, g.DirectJessIf, g.DirectJessReferenceCall, g.DirectJessApply, g.DirectJessRule, g.DirectJessSupportsAtRuleBlock, g.DirectJessKeyframes, g.DirectJessOpaqueAtRuleBlock, g.DirectJessAtRuleBlock, g.DirectJessAtRuleStatement);
  const DirectJessSupportsAtRuleBlock = node<AtRuleBlock>(
    'DirectJessSupportsAtRuleBlock',
    sequence(
      jessSupportsAtRuleName,
      g.DirectJessSupportsCondition,
      literal('{'),
      many(directJessAtBlockStatement),
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      requireValueNode(children[1]),
      collectBlockStatements(children, 3)
    )
  );
  // `@property` headers name a CSS custom property, not an ordinary at-rule
  // prelude. Retaining the contiguous `--` prefix as grammar structure blocks
  // a dynamic or malformed header from falling through the generic at-rule arm.
  const DirectJessPropertyName = node<Keyword>(
    'DirectJessPropertyName',
    noTrivia(sequence(literal('--'), g.CssAstSyntaxKeyword)),
    children => keyword(`${requireToken(children[0]).value}${requireToken(children[1]).value}`)
  );
  // Registered-property descriptors are authored CSS component values, but
  // they are not Jess value positions: retain only static, typed leaves and
  // recursive CSS function calls. In particular, do not borrow DirectJessValue
  // (which admits variable references, interpolation, arithmetic, collections,
  // and other Jess execution forms) or hide a descriptor in Any/raw source.
  const DirectJessStaticPropertyValueAtom = node<ValueNode>(
    'DirectJessStaticPropertyValueAtom',
    choice(g.DirectJessStaticPropertyCall, g.DirectJessStaticQuoted, g.DirectJessColor, g.DirectJessDimension, g.DirectJessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectJessStaticPropertyValue = node<ValueSlot>(
    'DirectJessStaticPropertyValue',
    noTrivia(sequence(
      g.DirectJessStaticPropertyValueAtom,
      many(sequence(regex(/[ \t\n\r\f]+/), g.DirectJessStaticPropertyValueAtom))
    )),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : values;
    }
  );
  const DirectJessStaticPropertyCallArgument = node<ValueSlot>(
    'DirectJessStaticPropertyCallArgument',
    sequence(literal(','), optional(regex(/[ \t\n\r\f]+/)), g.DirectJessStaticPropertyValue),
    (children) => {
      const value = children.at(-1);
      return Array.isArray(value) ? value : requireValueSlot(value);
    }
  );
  const DirectJessStaticPropertyCall = node<FunctionCall>(
    'DirectJessStaticPropertyCall',
    sequence(
      // var()/env() are references, even though their spelling is a CSS
      // function. url() has its own Url node and needs a separate static-path
      // reduction rather than an opaque FunctionCall argument.
      not(regex(/(?:url|var|env)(?![-_a-zA-Z0-9\u0080-\uffff])/i)), g.CssAstSyntaxKeyword,
      literal('('),
      optional(sequence(g.DirectJessStaticPropertyValue, many(g.DirectJessStaticPropertyCallArgument))),
      literal(')')
    ),
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '(' || requireToken(children.at(-1)).value !== ')') {
        throw new TypeError('Direct Jess static @property function lost its call boundaries.');
      }
      return funcCall(requireToken(children[0]).value, children.slice(2, -1).filter(isValueSlotValue));
    }
  );
  const DirectJessStaticPropertyDescriptor = node<Declaration>(
    'DirectJessStaticPropertyDescriptor',
    sequence(g.CssAstSyntaxProperty, literal(':'), g.DirectJessStaticPropertyValue, literal(';')),
    (children) => {
      const value = children[2];
      return decl(requireToken(children[0]).value, Array.isArray(value) ? value : valueSlot(requireValueNode(value)));
    }
  );
  const DirectJessPropertyAtRule = node<AtRuleBlock>(
    'DirectJessPropertyAtRule',
    sequence(
      jessPropertyAtRuleName,
      g.DirectJessPropertyName,
      literal('{'),
      many(choice(g.DirectJessComment, g.DirectJessStaticPropertyDescriptor)),
      literal('}')
    ),
    children => atRuleBlock(requireToken(children[0]).value, requireKeyword(children[1]), requireStatements(children.slice(3, -1)))
  );
  // Keyframes already fit the canonical AtRuleBlock + Rule model.  Keep the
  // header and selector boundary static until Jess has typed interpolation for
  // those positions; never turn either into a source-text prelude.
  const DirectJessKeyframeSelector = node<SimpleSelector>(
    'DirectJessKeyframeSelector',
    choice(jessKeyframeEndpoint, jessKeyframePercent),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const DirectJessKeyframeBlock = node<Rule>(
    'DirectJessKeyframeBlock',
    sequence(
      g.DirectJessKeyframeSelector,
      many(sequence(many(g.DirectJessComment), literal(','), many(g.DirectJessComment), g.DirectJessKeyframeSelector)),
      many(g.DirectJessComment),
      literal('{'),
      many(choice(g.DirectJessComment, g.DirectJessDeclaration, literal(';'))),
      literal('}')
    ),
    (children) => {
      const selectors = children.filter((child): child is SimpleSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'SimpleSelector')
        .map(selector => complexSelector([{ compound: compoundSelectorOf([selector]) }]));
      const bodyOpen = children.findIndex(child => isToken(child) && child.value === '{');
      if (bodyOpen < 0) {
        throw new TypeError('Direct Jess keyframe block lost its body boundary.');
      }
      return rule(selist(...selectors), requireStatements(children.slice(bodyOpen + 1, -1).filter(child => isComment(child) || isDeclaration(child))));
    }
  );
  const DirectJessKeyframes = node<AtRuleBlock>(
    'DirectJessKeyframes',
    sequence(
      g.CssAstSyntaxKeyframesAtKeyword,
      choice(g.DirectJessKeyword, g.DirectJessStaticQuoted),
      literal('{'),
      many(choice(g.DirectJessComment, g.DirectJessKeyframeBlock)),
      literal('}')
    ),
    children => atRuleBlock(requireToken(children[0]).value, requireValueNode(children[1]), requireStatements(children.slice(3, -1)))
  );
  const DirectJessVarDeclaration = node<VariableDeclaration>(
    'DirectJessVarDeclaration',
    sequence(
      choice(
        noTrivia(sequence(literal('$'), literal('$'), jessDollarName, literal('?:'))),
        noTrivia(sequence(literal('$'), jessDollarName, literal('?:'))),
        sequence(noTrivia(sequence(literal('$'), literal('$'), jessDollarName)), choice(literal(':='), literal(':'))),
        sequence(noTrivia(sequence(literal('$'), jessDollarName)), choice(literal(':='), literal(':')))
      ),
      g.DirectJessValue,
      literal(';')
    ),
    (children) => {
      const operatorIndex = children.findIndex(child => isToken(child)
        && (child.value === ':' || child.value === '?:' || child.value === ':='));
      if (operatorIndex < 1) {
        throw new TypeError('Direct Jess variable declaration lost its assignment operator.');
      }
      const operator = requireToken(children[operatorIndex]).value;
      const lookup = operatorIndex === 3 ? 'scoped' as const : 'live' as const;
      const write = operator === '?:'
        ? { mode: 'if-absent' as const, lookup }
        : operator === ':='
          ? { mode: 'reassign' as const, lookup }
          : { mode: 'declare' as const };
      return variableDeclaration(
        requireToken(children[operatorIndex - 1]).value,
        valueSlot(requireValueSlot(children[operatorIndex + 1])),
        write
      );
    }
  );
  // Priority is a Declaration field in the canonical AST, so this is ordinary
  // direct grammar construction rather than a Jess-specific compatibility path.
  const DirectJessImportant = node<true>(
    'DirectJessImportant',
    // Jess accepts both CSS block comments and its own `//` comments between
    // the declaration value, priority marker, priority name, and semicolon.
    // They are component-value trivia here, not standalone Comment statements.
    sequence(
      many(choice(blockComment, lineComment)),
      literal('!'),
      many(choice(blockComment, lineComment)),
      g.CssAstSyntaxImportant,
      many(choice(blockComment, lineComment))
    ),
    (children) => {
      const marker = children.find((child): child is Token => isToken(child) && child.value === '!');
      if (marker === undefined) {
        throw new TypeError('Direct Jess AST grammar lost its declaration-priority marker.');
      }
      requireExactToken(marker, '!');
      return true;
    }
  );
  // A property interpolation is an existing Declaration.name Interpolation, never a
  // raw name string. Static identifier segments come from shared CSS syntax;
  // Jess owns only its `$[…]` segment grammar and direct AST reduction.
  // Cheap superset lookahead so an ordinary `color: …` declaration does not
  // enter the interpolated-property arm, consume the whole property name via
  // the optional literal start, fail the required `$[…]`, and backtrack a
  // property re-parse through CssAstSyntaxProperty. Skip this arm unless a
  // `$[` actually precedes the next `:`/`;`/brace. A property name never
  // contains `:`, `;`, `{`, or `}`, so the predicate is a strict superset: a
  // real interpolated property is never skipped.
  const directInterpPropertyAhead = not(not(regex(/[^{};:]*\$\[/)));
  const DirectJessInterpolatedProperty = node<Interpolation>(
    'DirectJessInterpolatedProperty',
    noTrivia(sequence(
      directInterpPropertyAhead,
      optional(g.CssAstSyntaxInterpolatedPropertyStart),
      g.DirectJessDollarInterp,
      many(choice(g.CssAstSyntaxInterpolatedPropertyTail, g.DirectJessDollarInterp))
    )),
    (children) => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolation(child)) {
          parts.push(...child.parts);
        } else {
          // The superset lookahead emits a throwaway match token (`…$[`). Real
          // property-name chunks never contain `$`, so this content check drops
          // only that throwaway, independent of its position.
          const text = requireToken(child).value;
          if (text.includes('$')) {
            continue;
          }
          parts.push({ lit: text });
        }
      }
      return interpolation(parts);
    }
  );
  const DirectJessDeclaration = node<Declaration>(
    'DirectJessDeclaration',
    sequence(choice(DirectJessInterpolatedProperty, g.CssAstSyntaxProperty), literal(':'), g.DirectJessValue, optional(g.DirectJessImportant), literal(';')),
    children => decl(isToken(children[0]) ? requireToken(children[0]).value : requireInterpolation(children[0]), requireValueSlot(children[2]), null, children.includes(true))
  );
  const DirectJessAtRuleBlock = node<AtRuleBlock>(
    'DirectJessAtRuleBlock',
    sequence(
      g.DirectJessAtRuleHeader,
      literal('{'),
      many(directJessAtBlockStatement),
      literal('}')
    ),
    children => atRuleBlock(
      requireJessAtRuleHeader(children[0]).name,
      requireJessAtRuleHeader(children[0]).prelude,
      collectBlockStatements(children, 2)
    )
  );
  const DirectJessAtRuleStatement = node<AtRuleStatement>(
    'DirectJessAtRuleStatement',
    sequence(g.DirectJessStaticAtRuleHeader, literal(';')),
    (children) => {
      const header = requireJessAtRuleHeader(children[0]);
      return atRuleStatement(header.name, header.prelude);
    }
  );
  // An unknown CSS block is terminal authored syntax. Its shared recognition
  // artifact owns every balanced/string/comment boundary; the Jess reduction
  // only records raw facts and keeps `$` out of an unquoted dynamic header.
  const DirectJessOpaqueAtRuleBlock = node<OpaqueAtRuleBlock>(
    'DirectJessOpaqueAtRuleBlock',
    sequence(
      not(literal('@-')),
      g.CssAstSyntaxGenericAtRuleName,
      noTrivia(sequence(g.JessAstOpaqueStaticPrelude, literal('{'), g.JessAstOpaqueBody, literal('}')))
    ),
    (children) => {
      const prelude = children[1];
      const rawBody = children[3];
      if ((prelude !== null && prelude !== undefined && !isToken(prelude)) || !isToken(rawBody)) {
        throw new TypeError('Direct Jess opaque at-rule lost its grammar-owned raw facts.');
      }
      const preludeText = prelude === null || prelude === undefined ? null : requireToken(prelude).value.trim() || null;
      return opaqueAtRuleBlock(requireToken(children[0]).value, preludeText, requireToken(rawBody).value);
    }
  );
  // Jess shares the core MixinDef/MixinCall model with the other dialects, but
  // owns its `$ >` invocation spelling and Less/Sass-style names here. Guards
  // and selector interpolation remain separate typed families; named arguments
  // already have the canonical CallArg fact and reduce directly to it.
  const directJessMixinName = regex(/[.#]?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const DirectJessMixinParam = node<Param>(
    'DirectJessMixinParam',
    sequence(literal('$'), jessDollarName, optional(sequence(literal(':'), g.DirectJessValueTerm))),
    (children) => {
      const defaultValue = children.find(isValueNode);
      return defaultValue === undefined
        ? { name: requireToken(children[1]).value }
        : { name: requireToken(children[1]).value, default: defaultValue };
    }
  );
  const DirectJessMixinParams = node<Param[]>(
    'DirectJessMixinParams',
    sequence(literal('('), optional(sequence(g.DirectJessMixinParam, many(sequence(literal(','), g.DirectJessMixinParam)))), literal(')')),
    children => children.filter((child): child is Param => typeof child === 'object' && child !== null && !('type' in child) && 'name' in child)
  );
  const DirectJessMixinCallArg = node<JessMixinCallArgument>(
    'DirectJessMixinCallArg',
    choice(
      sequence(literal('$'), jessDollarName, literal(':'), g.DirectJessValueTerm),
      g.DirectJessValueTerm
    ),
    (children) => {
      const value = children.find(isValueNode);
      if (value === undefined) {
        throw new TypeError('Direct Jess AST grammar produced a mixin argument without a value.');
      }
      const name = children.find((child): child is Token => isToken(child) && child.value !== '$' && child.value !== ':');
      return name === undefined ? { value } : { name: name.value, value };
    }
  );
  const DirectJessMixinCall = node<MixinCall>(
    'DirectJessMixinCall',
    sequence(
      literal('$'), literal('>'), directJessMixinName,
      many(sequence(literal('>'), directJessMixinName)),
      literal('('), optional(sequence(g.DirectJessMixinCallArg, many(sequence(literal(','), g.DirectJessMixinCallArg)))), literal(')'),
      optional(literal(';'))
    ),
    (children) => {
      const names = children.filter(isToken)
        .map(token => token.value)
        .filter(value => value !== '$' && value !== '>' && value !== '(' && value !== ')' && value !== ',' && value !== ';');
      const args = children.filter(isJessMixinCallArgument);
      const name = names.at(-1);
      if (name === undefined) {
        throw new TypeError('Direct Jess AST grammar produced a mixin call without a name.');
      }
      const call = mixinCall(name, args);
      return names.length === 1 ? call : { ...call, path: names.slice(0, -1).map(sel => ({ comb: '>' as const, sel })) };
    }
  );
  // A variable-held callable has an explicit target and empty argument array.
  // Argument-bearing syntax remains intentionally closed in the Jess grammar.
  const DirectJessReferenceCall = node<Reference>(
    'DirectJessReferenceCall',
    sequence(literal('$'), jessDollarName, literal('('), literal(')'), optional(literal(';'))),
    (children) => {
      const name = requireToken(children[1]).value;
      return reference(variableReference(name, 'live'), [{ type: 'Call', args: [] }], `$${name}()`);
    }
  );
  const DirectJessMixinDef = node<MixinDef>(
    'DirectJessMixinDef',
    sequence(
      directJessMixinName, g.DirectJessMixinParams,
      optional(sequence(regex(/when(?![-_a-zA-Z0-9\u0080-\uffff])/), literal('('), g.DirectJessMixinGuard, literal(')'))),
      literal('{'),
      many(directJessNestedBodyStatement),
      literal('}')
    ),
    (children) => {
      const bodyOpen = children.findIndex(child =>
        isToken(child) && child.value === '{'
      );
      if (bodyOpen < 0) {
        throw new TypeError('Direct Jess AST grammar produced a mixin definition without a body.');
      }
      return mixinDef(
        requireToken(children[0]).value,
        children.find(Array.isArray) as Param[] | undefined ?? [],
        collectBodyStatements(children, bodyOpen + 1),
        children.find((child): child is GuardNode => typeof child === 'object' && child !== null && 'g' in child)
      );
    }
  );
  const DirectJessForName = node<string>(
    'DirectJessForName',
    sequence(literal('$'), jessDollarName),
    children => requireToken(children[1]).value
  );
  const DirectJessForBinding = node<ForBinding>(
    'DirectJessForBinding',
    choice(
      sequence(literal('['), g.DirectJessForName, literal(','), g.DirectJessForName, literal(']')),
      sequence(
        g.DirectJessForName,
        optional(sequence(literal(','), g.DirectJessForName, optional(sequence(literal(','), g.DirectJessForName))))
      )
    ),
    (children) => {
      if (typeof children[0] !== 'string') {
        requireExactToken(children[0], '[');
        return { kind: 'bracket', names: [requireString(children[1]), requireString(children[3])] };
      }
      const names = children.filter((child): child is string => typeof child === 'string');
      if (names.length === 1) {
        return { kind: 'single', name: names[0]! };
      }
      if (names.length === 2 || names.length === 3) {
        return { kind: 'comma', names: [names[0]!, names[1]!, names[2]] };
      }
      throw new TypeError('Direct Jess AST grammar produced an invalid $for binding.');
    }
  );
  // The public Jess grammar permits a range bound to be either a reference or
  // a numeric/dimension literal. Both already have direct typed reductions;
  // retain that exact public set rather than widening ranges to every value.
  const DirectJessForRangeBound = node<ValueNode>(
    'DirectJessForRangeBound',
    choice(g.DirectJessVarReference, g.DirectJessDimension),
    children => requireValueNode(children[0])
  );
  const DirectJessForRange = node<Range>(
    'DirectJessForRange',
    sequence(
      optional(literal('>')), g.DirectJessForRangeBound,
      regex(/to(?![-_a-zA-Z0-9\u0080-\uffff])/),
      optional(literal('<')), g.DirectJessForRangeBound,
      optional(sequence(regex(/step(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessForRangeBound))
    ),
    (children) => {
      const bounds = children.filter(isValueNode);
      if (bounds.length < 2 || bounds.length > 3) {
        throw new TypeError('Direct Jess AST grammar produced an invalid $for range.');
      }
      const tokens = children.filter(isToken);
      return range(bounds[0]!, bounds[1]!, bounds[2] ?? null, !tokens.some(token => token.value === '>'), !tokens.some(token => token.value === '<'));
    }
  );
  const DirectJessFor = node<For>(
    'DirectJessFor',
    sequence(
      regex(/\$for(?![-_a-zA-Z0-9\u0080-\uffff])/),
      literal('('),
      g.DirectJessForBinding,
      regex(/of(?![-_a-zA-Z0-9\u0080-\uffff])/),
      choice(g.DirectJessForRange, g.DirectJessValue),
      literal(')'),
      literal('{'),
      many(directJessNestedBodyStatement),
      literal('}')
    ),
    children => forNode(
      requireValueNode(children[4]),
      collectBodyStatements(children, 7),
      requireForBinding(children[2])
    )
  );
  // `$if` conditions deliberately do *not* reuse the broader mixin-guard
  // grammar. Jess control conditions are the strict historical language: bare
  // truth values, comparisons, grouped conditions, and `not` / pure `and` /
  // pure `or` trees. In particular, `default()` and `$type.*()` are mixin
  // dispatch syntax, not `$if` syntax. A comparison in an `and`/`or` chain
  // must be parenthesized and mixed chains must group explicitly.
  const DirectJessIfGuardValue = node<GuardNode>(
    'DirectJessIfGuardValue',
    g.DirectJessExpressionSum,
    reduceGuardTruth
  );
  const DirectJessIfGuardCompare = node<GuardNode>(
    'DirectJessIfGuardCompare',
    noTrivia(sequence(g.DirectJessExpressionSum, jessIfGuardCompareOperator, g.DirectJessExpressionSum)),
    reduceGuardCompare
  );
  const DirectJessIfGuardPrimary = node<GuardNode>(
    'DirectJessIfGuardPrimary',
    choice(
      sequence(regex(/not(?![-_a-zA-Z0-9\u0080-\uffff])/), literal('('), g.DirectJessIfGuard, literal(')')),
      sequence(literal('('), g.DirectJessIfGuard, literal(')')),
      g.DirectJessIfGuardValue
    ),
    (children) => {
      if (children.length === 1) {
        return requireGuardNode(children[0]);
      }
      return requireToken(children[0]).value === 'not'
        ? { g: 'not', inner: requireGuardNode(children[2]) }
        : requireGuardNode(children[1]);
    }
  );
  const DirectJessIfGuardAnd = node<GuardNode>(
    'DirectJessIfGuardAnd',
    sequence(g.DirectJessIfGuardPrimary, oneOrMore(sequence(regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessIfGuardPrimary))),
    reduceGuardAnd
  );
  const DirectJessIfGuardOr = node<GuardNode>(
    'DirectJessIfGuardOr',
    sequence(g.DirectJessIfGuardPrimary, oneOrMore(sequence(regex(/or(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessIfGuardPrimary))),
    reduceGuardOr
  );
  const DirectJessIfGuard = node<GuardNode>(
    'DirectJessIfGuard',
    // A comparison shares its left operand with the documented bare-truth
    // form (`$if (true)`). Make the longer arm transactional so a missing
    // comparison operator returns recognition to the primary truth reduction.
    choice(attempt(g.DirectJessIfGuardCompare), g.DirectJessIfGuardAnd, g.DirectJessIfGuardOr, g.DirectJessIfGuardPrimary),
    children => requireGuardNode(children[0])
  );
  const DirectJessIfCondition = node<GuardNode>(
    'DirectJessIfCondition',
    sequence(literal('('), g.DirectJessIfGuard, literal(')')),
    children => requireGuardNode(children[1])
  );
  const DirectJessIfBody = node<Statement[]>(
    'DirectJessIfBody',
    sequence(
      literal('{'),
      // Selected branches publish declarations and definitions into their
      // containing frame in source order. Existing statement evaluators already
      // execute calls and loops here; imports and placement-sensitive extends
      // remain held until their respective models are available.
      many(directJessNestedBodyStatement),
      literal('}')
    ),
    children => collectBodyStatements(children, 1)
  );
  const DirectJessElseIfBranch = node<IfBranch>(
    'DirectJessElseIfBranch',
    sequence(regex(/\$else(?![-_a-zA-Z0-9\u0080-\uffff])/), regex(/if(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessIfCondition, g.DirectJessIfBody),
    children => ({ guard: requireGuardNode(children[2]), body: requireStatementList(children[3]) })
  );
  const DirectJessElseBranch = node<IfBranch>(
    'DirectJessElseBranch',
    sequence(regex(/\$else(?![-_a-zA-Z0-9\u0080-\uffff])/), g.DirectJessIfBody),
    children => ({ guard: null, body: requireStatementList(children[1]) })
  );
  const DirectJessIf = node<If>(
    'DirectJessIf',
    sequence(
      regex(/\$if(?![-_a-zA-Z0-9\u0080-\uffff])/),
      g.DirectJessIfCondition,
      g.DirectJessIfBody,
      many(g.DirectJessElseIfBranch),
      optional(g.DirectJessElseBranch)
    ),
    (children) => {
      const branches: IfBranch[] = [{ guard: requireGuardNode(children[1]), body: requireStatementList(children[2]) }];
      for (const child of children.slice(3)) {
        if (Array.isArray(child)) {
          branches.push(...requireIfBranchArray(child));
        } else if (isIfBranch(child)) {
          branches.push(requireIfBranch(child));
        }
      }
      return ifNode(requireIfBranchTuple(branches));
    }
  );
  const DirectJessCompound = node<CompoundSelector>(
    'DirectJessCompound',
    noTrivia(oneOrMore(choice(parser({ trivia: whitespace }, g.DirectJessAttribute), g.DirectJessPseudo, g.DirectJessInterpolatedSimple, g.DirectJessSimple))),
    reduceCompound
  );
  const DirectJessComplexTail = node<JessComplexTail>(
    'DirectJessComplexTail',
    sequence(optional(directJessCombinator), g.DirectJessCompound),
    (children) => {
      const compound = children.find((child): child is CompoundSelector => typeof child === 'object' && child !== null && 'simples' in child);
      if (compound === undefined) {
        throw new TypeError('Direct Jess selector tail requires a compound.');
      }
      const combinator = children.find(isToken);
      const comb = combinator?.value ?? ' ';
      if (comb !== ' ' && comb !== '>' && comb !== '+' && comb !== '~' && comb !== '||') {
        throw new TypeError('Direct Jess selector tail produced an invalid combinator.');
      }
      return { comb, compound };
    }
  );
  const DirectJessComplex = node<ComplexSelector>(
    'DirectJessComplex',
    sequence(g.DirectJessCompound, many(g.DirectJessComplexTail)),
    reduceComplex
  );
  const DirectJessSelectorTail = node<ComplexSelector>(
    'DirectJessSelectorTail',
    sequence(literal(','), g.DirectJessComplex),
    reduceSelectorTail
  );
  const DirectJessSelector = node<SelectorList>(
    'DirectJessSelector',
    sequence(g.DirectJessComplex, many(g.DirectJessSelectorTail)),
    reduceSelectorList
  );
  const DirectJessApply = node<Apply>(
    'DirectJessApply',
    sequence(regex(/\$apply(?![-\w])/), g.DirectJessStaticCompound, many(sequence(literal(','), g.DirectJessStaticCompound)), optional(literal(';'))),
    children => apply(children.filter(isCompound))
  );
  const DirectJessExtend = node<ExtendInstruction[]>(
    'DirectJessExtend',
    sequence(regex(/\$extend(?![-\w])/), g.DirectJessStaticComplex, many(sequence(literal(','), g.DirectJessStaticComplex)), optional(regex(/!exact(?![-\w])/)), optional(literal(';'))),
    children => children.filter((child): child is ComplexSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'ComplexSelector')
      .map(target => ({ target: selist(target), partial: !children.some(child => isToken(child) && child.value === '!exact') }))
  );
  const DirectJessRule = node<Rule>(
    'DirectJessRule',
    sequence(g.DirectJessSelector, literal('{'), many(choice(g.DirectJessComment, g.DirectJessMixinCall, g.DirectJessVarDeclaration, g.DirectJessDeclaration, g.DirectJessMixinDef, g.DirectJessFor, g.DirectJessIf, g.DirectJessReferenceCall, g.DirectJessApply, g.DirectJessExtend, g.DirectJessRule, g.DirectJessSupportsAtRuleBlock, g.DirectJessOpaqueAtRuleBlock, g.DirectJessAtRuleBlock, g.DirectJessAtRuleStatement)), literal('}')),
    (children) => {
      requireExactToken(children[1], '{');
      requireExactToken(children.at(-1), '}');
      const extensions = children.filter(isExtendInstructionArray).flat();
      return rule(requireSelectorList(children[0]), collectBlockStatements(children, 2), extensions.length ? extensions : undefined);
    }
  );
  const JessAstDocument = node<Stylesheet>(
    'JessAstDocument',
    sequence(
      optional(g.DirectJessCharset),
      // Compiler directives and variable declarations may precede a CSS import:
      // a `$[...]` import target is a live read and therefore needs its binding
      // activated in source order. CSS imports still cannot appear after a rule.
      many(choice(g.DirectJessStyleImport, g.DirectJessModuleImport, g.DirectJessVarDeclaration, g.DirectJessCssImport)),
      many(choice(g.DirectJessComment, g.DirectJessMixinCall, g.DirectJessStyleImport, g.DirectJessModuleImport, g.DirectJessVarDeclaration, g.DirectJessMixinDef, g.DirectJessFor, g.DirectJessIf, g.DirectJessReferenceCall, g.DirectJessApply, g.DirectJessRule, g.DirectJessSupportsAtRuleBlock, g.DirectJessPropertyAtRule, g.DirectJessKeyframes, g.DirectJessOpaqueAtRuleBlock, g.DirectJessAtRuleBlock, g.DirectJessAtRuleStatement))
    ),
    children => stylesheet(requireStatements(children.flatMap(child => isMixinCallArray(child) ? child : Array.isArray(child) ? [] : [child])))
  );

  return {
    JessAstDocument,
    DirectJessComment,
    DirectJessVarDeclaration,
    DirectJessVarReference,
    DirectJessReferenceTail,
    DirectJessDollarValue,
    DirectJessDollarInterp,
    DirectJessExpressionDollarInterp,
    DirectJessExpression,
    DirectJessExpressionInterpolation,
    DirectJessExpressionQuoted,
    DirectJessExpressionAtom,
    DirectJessExpressionProduct,
    DirectJessExpressionSum,
    DirectJessExpressionCompare,
    DirectJessUnwrappedProductRest,
    DirectJessGuardValue,
    DirectJessGuardCompare,
    DirectJessGuardCall,
    DirectJessGuardPrimary,
    DirectJessGuardAnd,
    DirectJessGuardOr,
    DirectJessMixinGuard,
    DirectJessKeyword,
    DirectJessQuoted,
    DirectJessStaticQuoted,
    DirectJessStyleImport,
    DirectJessModuleSpecifier,
    DirectJessModuleImport,
    DirectJessStaticAtAtom,
    DirectJessStaticAtNonOnlyKeyword,
    DirectJessStaticAtNonOnlyAtom,
    DirectJessStaticAtQuery,
    DirectJessStaticAtPreludeTerm,
    DirectJessStaticAtPrelude,
    DirectJessMediaVariableExpression,
    DirectJessMediaPrelude,
    DirectJessStaticAtRuleHeader,
    DirectJessAtRuleHeader,
    DirectJessSupportsAtom,
    DirectJessGeneralTemplate,
    DirectJessGeneralTemplateParen,
    DirectJessGeneralTemplateSquare,
    DirectJessGeneralTemplateBrace,
    DirectJessGeneralTemplateDoubleQuoted,
    DirectJessGeneralTemplateSingleQuoted,
    DirectJessGeneralEnclosed,
    DirectJessSupportsNot,
    DirectJessSupportsLogical,
    DirectJessSupportsFeature,
    DirectJessSupportsInParens,
    DirectJessSupportsCondition,
    DirectJessCssImportTarget,
    DirectJessCssImportPrelude,
    DirectJessUrlInterpolatedValue,
    DirectJessCharset,
    DirectJessCssImport,
    DirectJessSupportsAtRuleBlock,
    DirectJessPropertyName,
    DirectJessStaticPropertyValueAtom,
    DirectJessStaticPropertyValue,
    DirectJessStaticPropertyCallArgument,
    DirectJessStaticPropertyCall,
    DirectJessStaticPropertyDescriptor,
    DirectJessPropertyAtRule,
    DirectJessKeyframeSelector,
    DirectJessKeyframeBlock,
    DirectJessKeyframes,
    DirectJessOpaqueAtRuleBlock,
    DirectJessAtRuleBlock,
    DirectJessAtRuleStatement,
    DirectJessDimension,
    DirectJessColor,
    DirectJessUrl,
    DirectJessInterpolatedUrl,
    DirectJessCallComponent,
    DirectJessCallArgument,
    DirectJessCall,
    DirectJessCollectionEntry,
    DirectJessCollection,
    DirectJessValueAtom,
    DirectJessValueTerm,
    DirectJessValue,
    DirectJessImportant,
    DirectJessDeclaration,
    DirectJessMixinParam,
    DirectJessMixinParams,
    DirectJessMixinCallArg,
    DirectJessMixinCall,
    DirectJessReferenceCall,
    DirectJessApply,
    DirectJessExtend,
    DirectJessMixinDef,
    DirectJessSimple,
    DirectJessInterpolatedSimple,
    DirectJessAttribute,
    DirectJessPseudo,
    DirectJessStaticPseudoArgument,
    DirectJessCompound,
    DirectJessStaticCompound,
    DirectJessStaticComplexTail,
    DirectJessStaticComplex,
    DirectJessStaticSelectorTail,
    DirectJessStaticSelector,
    DirectJessSelectorCapture,
    DirectJessComplexTail,
    DirectJessComplex,
    DirectJessSelectorTail,
    DirectJessSelector,
    DirectJessRule,
    DirectJessForName,
    DirectJessForBinding,
    DirectJessForRangeBound,
    DirectJessForRange,
    DirectJessFor,
    DirectJessIfGuardValue,
    DirectJessIfGuardCompare,
    DirectJessIfGuardPrimary,
    DirectJessIfGuardAnd,
    DirectJessIfGuardOr,
    DirectJessIfGuard,
    DirectJessIfCondition,
    DirectJessIfBody,
    DirectJessElseIfBranch,
    DirectJessElseBranch,
    DirectJessIf,
    whitespace
  };
})]);
