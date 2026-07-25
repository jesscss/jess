/**
 * Canonical Jess AST grammar for the public `parse()` architecture.
 *
 * ## THIS IS A DELTA OVER CSS — the base is elsewhere
 *
 * Shared CSS surface: `packages/internal-css-recognition/src/`
 *   (`cssAstSyntax`, `cssAstPseudoSyntax`, `opaqueAtRuleRecognition`)
 * Reference CSS grammar: `packages/css-parser/src/ast/grammar.ts`
 *
 * **If the construct is CSS, it belongs in the base, not here.** Adding it to the shared
 * surface serves all four dialects; adding it here means Less and SCSS will each add their
 * own and the three will drift. Only genuinely Jess-specific constructs — collections,
 * the three `$` forms (`${name}` interpolation, `$[…]` lookup, `$(…)` expression), `:=`,
 * `@compose`/`@use`, stylesheet functions — earn a place in this file, and only those earn
 * Jess-specific rule names. A declaration is a `Declaration`.
 *
 * Grammar-writing rules and verification gates: `.cursor/rules/domains/parsers.mdc`.
 * Combinator reference: `docs/architecture/parser/PARSEMAN-COMBINATOR-CHEATSHEET.md`.
 *
 * It never composes the CST grammar: Parseman reductions construct canonical
 * core facts directly.
 */
import { attempt, balanced, choice, composeLeaf, field, literal, many, noTrivia, node, not, oneOrMore, optional, parser, regex, rules, scanTo, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator, FieldCapture, FieldMap } from 'parseman';
import { cssAstSyntax } from '@jesscss/internal-css-recognition/recognition';
import { opaqueAtRuleRecognition } from '@jesscss/internal-css-recognition/opaque-at-rule';
import { cssAstPseudoSyntax } from '@jesscss/internal-css-recognition/pseudo-consts';
import { any, anonymousMixin, apply, atRuleBlock, atRuleStatement, block, boundaryBlock, color, comment, complexCanonical, complexSelector, compoundSelectorOf, condition, decl, collection, dimension, forNode, funcCall, generalEnclosed, ifNode, interpolation, keyword, list, mixinCall, mixinDef, moduleImport, opaqueAtRuleBlock, operation, propertyReference, pseudoSelector, quoted, range, reference, selectorCapture, styleImport, stylesheet, rule, selist, simpleSelector, interpolatedSimpleSelector, spaced, url, varIndirect, variableDeclaration, variableReference, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { AnonymousMixin, Apply, AtRuleBlock, AtRuleStatement, Color, Comment, ComplexSelector, CompoundSelector, Declaration, Collection, Dimension, ExtendInstruction, For, ForBinding, FunctionCall, GeneralEnclosed, If, IfBranch, InterpPart, Interpolation, Keyword, MixinCall, MixinDef, ModuleImport, ModuleImportSpecifier, OpaqueAtRuleBlock, Param, Quoted, Range, PseudoSelector, Reference, SelectorCapture, Stylesheet, Rule, SelectorList, SimpleSelector, SimpleToken, SpacedValue, Statement, StyleImport, Url, ValueNode, ValueSlot, VariableDeclaration, VariableReference, GuardNode } from '@jesscss/core/ast';

type Token = { readonly value: string };
type ExpressionFact = { readonly value: ValueNode; readonly src: string };
type JessOperatorFact = { readonly value: string; readonly src: string };
type JessReferenceTail = { readonly step: Reference['steps'][number]; readonly src: string };
type JessComplexTail = { readonly comb: ' ' | '>' | '+' | '~' | '||'; readonly compound: CompoundSelector };
type JessStaticAtQueryProperty = { readonly property: Keyword };
type JessAtRuleHeader = { readonly name: string; readonly prelude: ValueNode | null };
type JessMixinCallArgument = MixinCall['args'][number];

type JessAstRules = {
  JessAstDocument: Combinator<Stylesheet>;
  DirectJessComment: Combinator<Comment>;
  DirectJessVarDeclaration: Combinator<VariableDeclaration>;
  DirectJessValueBlockDeclaration: Combinator<VariableDeclaration>;
  DirectJessBlockLambda: Combinator<AnonymousMixin>;
  DirectJessExprLambda: Combinator<AnonymousMixin>;
  DirectJessValueBlock: Combinator<ValueNode>;
  DirectJessVarReference: Combinator<VariableReference>;
  DirectJessReferenceTail: Combinator<JessReferenceTail>;
  DirectJessReferenceCallTail: Combinator<JessReferenceTail>;
  DirectJessDollarValue: Combinator<ValueNode>;
  DirectJessDollarBrace: Combinator<Interpolation>;
  DirectJessExpressionDollarBrace: Combinator<ExpressionFact>;
  DirectJessDollarInterp: Combinator<Interpolation>;
  DirectJessInterpolatedValue: Combinator<Interpolation>;
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
  DirectJessValueSpaceGroup: Combinator<ValueSlot>;
  DirectJessValueTerm: Combinator<ValueSlot>;
  DirectJessValue: Combinator<ValueSlot>;
  DirectJessImportant: Combinator<true>;
  DirectJessCustomPropertyValue: Combinator<Keyword>;
  DirectJessCustomPropertyName: Combinator<string | Interpolation>;
  DirectJessCustomPart: Combinator<unknown>;
  DirectJessCustomInnerPart: Combinator<unknown>;
  DirectJessCustomParen: Combinator<readonly unknown[]>;
  DirectJessCustomSquare: Combinator<readonly unknown[]>;
  DirectJessCustomCurly: Combinator<readonly unknown[]>;
  DirectJessCustomValue: Combinator<ValueNode>;
  DirectJessCustomDeclaration: Combinator<Declaration>;
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
  DirectJessParent: Combinator<SimpleSelector>;
  DirectJessInterpolatedSimple: Combinator<SimpleSelector>;
  DirectJessInterpolatedParentSuffix: Combinator<SimpleSelector>;
  DirectJessAttribute: Combinator<SimpleSelector>;
  DirectJessPseudo: Combinator<SimpleToken>;
  DirectJessStaticPseudoArgument: Combinator<SelectorList | string>;
  DirectJessGenericPseudoArgument: Combinator<SelectorList | string>;
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
  DirectJessForSource: Combinator<ValueNode>;
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
  DirectJessStaticValueAtom: Combinator<ValueNode>;
  DirectJessStaticValue: Combinator<ValueSlot>;
  DirectJessStaticCallArgument: Combinator<ValueSlot>;
  DirectJessStaticCall: Combinator<FunctionCall>;
  DirectJessStaticAtNonOnlyKeyword: Combinator<Keyword>;
  DirectJessStaticAtNonOnlyAtom: Combinator<ValueNode>;
  DirectJessStaticAtQuery: Combinator<ValueNode>;
  DirectJessStaticAtDashedIdent: Combinator<Keyword>;
  DirectJessStaticAtPreludeTerm: Combinator<ValueNode>;
  DirectJessStaticAtPrelude: Combinator<ValueNode | null>;
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
  DirectJessGeneralQuotedTemplate: Combinator<Interpolation>;
  DirectJessGeneralQuotedTemplateParen: Combinator<Interpolation>;
  DirectJessGeneralQuotedTemplateSquare: Combinator<Interpolation>;
  DirectJessGeneralQuotedTemplateBrace: Combinator<Interpolation>;
  DirectJessGeneralQuotedTemplateDoubleQuoted: Combinator<Interpolation>;
  DirectJessGeneralQuotedTemplateSingleQuoted: Combinator<Interpolation>;
  DirectJessGeneralEnclosed: Combinator<GeneralEnclosed>;
  DirectJessSupportsNot: Combinator<Keyword>;
  DirectJessSupportsLogical: Combinator<Keyword>;
  DirectJessSupportsFeature: Combinator<ValueNode>;
  DirectJessSupportsInParens: Combinator<ValueNode>;
  DirectJessSupportsCondition: Combinator<ValueNode>;
  DirectJessCssImportTarget: Combinator<Quoted | Url>;
  DirectJessImportTailFunction: Combinator<FunctionCall>;
  DirectJessCssImportPrelude: Combinator<ValueNode>;
  DirectJessCharset: Combinator<AtRuleStatement>;
  DirectJessCssImport: Combinator<AtRuleStatement>;
  DirectJessSupportsAtRuleBlock: Combinator<AtRuleBlock>;
  DirectJessPropertyName: Combinator<Keyword>;
  DirectJessStaticPropertyDescriptor: Combinator<Declaration>;
  DirectJessPropertyAtRule: Combinator<AtRuleBlock>;
  DirectJessKeyframeSelector: Combinator<SimpleSelector>;
  DirectJessKeyframeBlock: Combinator<Rule>;
  DirectJessKeyframes: Combinator<AtRuleBlock>;
  DirectJessOpaquePrelude: Combinator<string | null>;
  DirectJessOpaqueBody: Combinator<string>;
  DirectJessOpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  DirectJessScopeBlock: Combinator<AtRuleBlock>;
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
  CssAstSyntaxNthChildName: Combinator<string>;
  CssAstSyntaxNthTypeName: Combinator<string>;
  CssAstSyntaxNthName: Combinator<string>;
  CssAstSyntaxSelectorArgPseudoName: Combinator<string>;
  CssAstSyntaxOfKeyword: Combinator<string>;
  CssAstSyntaxPseudoCloseAhead: Combinator<string>;
  CssAstSyntaxNumber: Combinator<string>;
  CssAstSyntaxProperty: Combinator<string>;
  CssAstSyntaxInterpolatedPropertyStart: Combinator<string>;
  CssAstSyntaxInterpolatedPropertyTail: Combinator<string>;
  CssAstSyntaxCustomProperty: Combinator<string>;
  CssAstSyntaxCustomOuterContent: Combinator<string>;
  CssAstSyntaxCustomInnerContent: Combinator<string>;
  CssAstSyntaxCustomSingleQuoted: Combinator<string>;
  CssAstSyntaxCustomDoubleQuoted: Combinator<string>;
  CssAstSyntaxQueryAndOr: Combinator<string>;
  CssAstSyntaxQueryNot: Combinator<string>;
  CssAstSyntaxQueryOnly: Combinator<string>;
  CssAstSyntaxQueryComparisonOperator: Combinator<string>;
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

/*
 * Selector-function pseudos whose argument is retained as a structured
 * `SelectorList` rather than collapsed to text. Gated on the pseudo NAME
 * (lowercased, colon-stripped), never on colon count — `::slotted()` takes a
 * selector argument but is absent here, so it stays opaque text. `crossable`
 * (a narrower set) is decided in core. Mirrors the CSS grammar's set.
 */
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

    /*
     * `Any` is verbatim authored text: the reduced form of a custom-property
     * value, which Jess never evaluates.
     */
    && (value.type === 'Any'
      || value.type === 'Keyword'
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
          appendInterpolationLiteral(
            parts,
            part.lit
          );
        } else {
          parts.push(part);
        }
      }
    } else {
      appendInterpolationLiteral(
        parts,
        requireToken(child).value
      );
    }
  }
  return interpolation(parts);
}

/**
 * Flatten the grammar-owned parts of a custom-property value. Custom-property
 * values are never evaluated, so every byte outside a typed `$[…]` segment
 * stays literal `<declaration-value>` text and the reduction only joins grammar
 * children — it never rescans source. Nested balanced groups arrive as nested
 * arrays from the paren/square/curly productions.
 */
function appendCustomValueParts(children: readonly unknown[], parts: Interpolation['parts'], seen: { interpolated: boolean }): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      appendCustomValueParts(
        child,
        parts,
        seen
      );
    } else if (isInterpolation(child)) {
      seen.interpolated = true;
      for (const part of child.parts) {
        if (isInterpolationLiteral(part)) {
          appendInterpolationLiteral(
            parts,
            part.lit
          );
        } else {
          parts.push(part);
        }
      }
    } else {
      appendInterpolationLiteral(
        parts,
        requireToken(child).value
      );
    }
  }
}

/** Reduce a whole custom-property value to `Interpolation` (when it carries a
 * `$[…]`) or to verbatim `Any` text. */
function customValueFromChildren(children: readonly unknown[]): ValueNode {
  const parts: Interpolation['parts'] = [];
  const seen = { interpolated: false };
  appendCustomValueParts(
    children,
    parts,
    seen
  );
  if (seen.interpolated) {
    return interpolation(parts);
  }
  return any(parts.map(part => isInterpolationLiteral(part) ? part.lit : '').join(''));
}

function requireExpressionFact(value: unknown): ExpressionFact {
  if (typeof value !== 'object' || value === null || !('value' in value) || !('src' in value)
    || typeof value.src !== 'string' || !isValueNode(value.value)) {
    throw new TypeError('Direct Jess AST grammar produced an invalid expression fact.');
  }
  return { value: value.value, src: value.src };
}

/*
 * An arithmetic/comparison operator boundary carries two facts: the operator
 * symbol itself and the exact authored bytes around it. They are identical for a
 * plain whitespace-flanked operator token, and differ only when the boundary
 * also carries a block comment, which `DirectJessExpressionOperator` recognizes
 * as grammar structure rather than trimming out of a token.
 */
function requireOperatorFact(value: unknown): JessOperatorFact {
  if (typeof value === 'object' && value !== null && 'value' in value && 'src' in value
    && typeof value.value === 'string' && typeof value.src === 'string') {
    return { value: value.value, src: value.src };
  }
  const token = requireToken(value);
  return { value: token.value.trim(), src: token.value };
}

function foldExpression(children: readonly unknown[]): ExpressionFact {
  let fact = requireExpressionFact(children[0]);
  for (let index = 1; index < children.length; index += 2) {
    const operator = requireOperatorFact(children[index]);
    const right = requireExpressionFact(children[index + 1]);
    fact = {
      value: operation(
        operator.value,
        fact.value,
        right.value
      ),
      src: `${fact.src}${operator.src}${right.src}`
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
    const ref = variableReference(
      requireToken(children[2]).value,
      'live'
    );
    if (span) {
      withSourceSpan(
        ref,
        span
      );
    }
    return interpolation([{ ref: varIndirect(
      ref,
      'live'
    ), unquote: true }]);
  }
  if (children.length === 3) {
    const ref = variableReference(
      first,
      'live'
    );
    if (span) {
      withSourceSpan(
        ref,
        span
      );
    }
    return interpolation([{ ref, unquote: true }]);
  }
  const text = first === '"' || first === '\'' ? requireToken(children[2]).value : first;
  return interpolation([{ ref: propertyReference(
    text,
    tokenSource(children)
  ), unquote: true }]);
}

/**
 * Reduce a `${…}` interpolation. BARE-vs-BRACKETED selects the namespace:
 *
 * - `${foo}`      → the VARIABLE `$foo`
 * - `${[foo]}`    → a LOOKUP, i.e. the PROPERTY `foo` declared in scope
 * - `${["a b"]}`  → the same lookup; the quotes are only escaping, because
 *                   `a b` is not a valid identifier. `[foo]` and `["foo"]` are
 *                   the same plain-string key (ledger P14), so quoting never
 *                   carries meaning here.
 * - `${[$k]}`     → a lookup whose key is computed from `$k`.
 */
function dollarBraceInterpolation(
  children: readonly unknown[],
  span?: { readonly start: number; readonly end: number }
): Interpolation {
  if (requireToken(children[0]).value !== '${[') {
    const ref = variableReference(
      requireToken(children[1]).value,
      'live'
    );
    if (span) {
      withSourceSpan(
        ref,
        span
      );
    }
    return interpolation([{ ref, unquote: true }]);
  }
  const head = requireToken(children[1]).value;
  if (head === '$') {
    const named = variableReference(
      requireToken(children[2]).value,
      'live'
    );
    if (span) {
      withSourceSpan(
        named,
        span
      );
    }
    return interpolation([{ ref: varIndirect(
      named,
      'live'
    ), unquote: true }]);
  }
  const name = head === '"' || head === '\'' ? requireToken(children[2]).value : head;
  return interpolation([{ ref: propertyReference(
    name,
    tokenSource(children)
  ), unquote: true }]);
}

/*
 * The authored-ish source of one reference-call argument, used only to rebuild a
 * `Reference.raw` fallback string. It never feeds recognition, and it never
 * throws: a value with no direct spelling contributes nothing rather than
 * failing the parse.
 */
function referenceArgSource(value: JessMixinCallArgument['value']): string {
  if (Array.isArray(value)) {
    return value.map(referenceArgSource).join(' ');
  }
  if (!isValueNode(value)) {
    return '';
  }
  switch (value.type) {
    case 'Keyword': case 'Color': case 'Dimension': case 'Quoted': case 'Any': return value.src;
    case 'VariableReference': return `$${value.name}`;
    case 'Reference': case 'PropertyReference': return value.raw;
    default: return '';
  }
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
    return quoted(
      `${open.value}${content.value}${open.value}`,
      content.value,
      open.value,
      false
    );
  }
  const parts: Interpolation['parts'] = [{ lit: open.value }];
  for (const child of children.slice(
    1,
    -1
  )) {
    if (isInterpolation(child) || isExpressionFact(child)) {
      parts.push(...interpolationValue(child).parts);
    } else {
      parts.push({ lit: requireToken(child).value });
    }
  }
  parts.push({ lit: open.value });
  return interpolation(parts);
}

/*
 * `~"…"` drops its quotes, so an escaped string that carries interpolation is
 * exactly the Interpolation of its content — the `~` and both quote tokens are
 * authored escape syntax, not output bytes, and never become literal parts.
 */
function escapedInterpolationFromChildren(children: readonly unknown[]): Interpolation {
  const parts: Interpolation['parts'] = [];
  for (const child of children.slice(
    2,
    -1
  )) {
    if (isInterpolation(child)) {
      parts.push(...child.parts);
    } else {
      parts.push({ lit: requireToken(child).value });
    }
  }
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
        : requireToken(child).value).join('');
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
  return value === undefined
    ? block(keyword(propertyName))
    : block(operation(
        ':',
        keyword(propertyName),
        value
      ));
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

/*
 * Block bodies whose grammar admits array-producing arms (`$extend`) and a bare
 * `;` arm: flatten mixin-call arrays, drop other arrays and stray tokens.
 */
function collectBlockStatements(children: readonly unknown[], open: number): Statement[] {
  return requireStatements(children.slice(
    open,
    -1
  )
    .flatMap(child => isMixinCallArray(child) ? child : Array.isArray(child) ? [] : [child])
    .filter(child => !isToken(child)));
}

/*
 * Nested-scope bodies (mixin/for/if) whose grammar produces no array or bare
 * token arms other than mixin-call expansion: flatten mixin-call arrays only.
 */
function collectBodyStatements(children: readonly unknown[], open: number): Statement[] {
  return requireStatements(children.slice(
    open,
    -1
  )
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

/*
 * Shared guard reducers. `$if` and mixin guards recognize the same GuardNode
 * shapes through distinct combinator arms; only the recognition differs, so the
 * reduction bodies are identical and shared here.
 */
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
function reduceVarDeclaration(children: readonly unknown[]): VariableDeclaration {
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

/*
 * Every block-bodied lambda spelling reduces the same way: an `AnonymousMixin`
 * over the body statements, carrying the declared params. The `params` field is
 * OMITTED for an empty list so the plain `@{ … }` block keeps the monomorphic
 * shape core's value paths already expect.
 */
function reduceLambda(children: readonly unknown[]): AnonymousMixin {
  const bodyOpen = children.findIndex(child => isToken(child) && child.value === '{');
  if (bodyOpen < 0) {
    throw new TypeError('Direct Jess AST grammar produced a lambda without a body.');
  }
  const params = children.find(Array.isArray) as Param[] | undefined ?? [];
  return anonymousMixin(
    collectBodyStatements(
      children,
      bodyOpen + 1
    ),
    params.length > 0 ? params : undefined
  );
}

/*
 * Shared selector reducers. The static and dynamic selector families differ only
 * in their recognition arms (static excludes interpolation); the compound,
 * complex, tail, and list reductions are structurally identical.
 */
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
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);

/*
 * Jess `//` comments are trivia, not CSS comments — exactly as in Less: they are
 * recognized between direct AST facts but must never become a renderable
 * `Comment` node, because `//` is not valid CSS and cannot survive into output.
 * URL bodies disable trivia below, so `url(//host/path)` stays URL content.
 */
const whitespace = trivia(oneOrMore(choice(
  rawWhitespace,
  lineComment
)));
const plainDoubleQuotedText = regex(/(?:[^"\\$]|\\[\s\S]|\$(?![\[({]))*/);
const plainSingleQuotedText = regex(/(?:[^'\\$]|\\[\s\S]|\$(?![\[({]))*/);
const interpolatedDoubleQuotedText = regex(/(?:[^"\\$]|\\[\s\S]|\$(?![\[({]))+/);
const interpolatedSingleQuotedText = regex(/(?:[^'\\$]|\\[\s\S]|\$(?![\[({]))+/);

/*
 * Jess's live `$` grammar does not permit CSS escapes in names. Keep that
 * dialect-local fact explicit while the value keyword leaf remains shared.
 */
const jessDollarName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);

/*
 * An operator boundary inside a Jess expression is whitespace, and a block
 * comment is ordinary whitespace there (`$(2px /* nudge *\/ * 2)`). Recognizing
 * the comment as part of the boundary keeps the operator symbol a separate
 * grammar fact, so no reduction has to strip comment bytes back out of a token.
 */
const jessExprBoundary = regex(/(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);
const jessExprProductSymbol = regex(/[*/%]/);
const jessExprSumSymbol = regex(/[-+]/);
const jessExprCompareSymbol = regex(/>=|<=|>|<|=/);

/*
 * `$if` conditions retain the CST's comparison spelling, which permits both
 * adjacent (`$a>5`) and spaced (`$a > 5`) operators. This is distinct from
 * expression interpolation, whose arithmetic/comparison grammar requires
 * spaces to avoid value-position ambiguity.
 */
const jessIfGuardCompareOperator = regex(/[ \t\n\r\f]*(?:>=|<=|>|<|=)[ \t\n\r\f]*/);

/*
 * The unwrapped value form deliberately excludes `/` and `%`: `/` remains a
 * structured slash list in value position, and `%` has no documented unwrapped
 * spelling. Wrapped `$(...)` remains the complete arithmetic syntax.
 */
const jessUnwrappedProductOperator = regex(/[ \t\n\r\f]+\*[ \t\n\r\f]+/);
const jessUnwrappedSumOperator = regex(/[ \t\n\r\f]+[-+][ \t\n\r\f]+/);

/*
 * This is intentionally the type-predicate namespace, not general function
 * syntax in a guard. The existing GuardNode evaluator accepts these names;
 * recognition retains a typed argument list and never routes through source.
 */
const jessGuardUnaryTypePredicate = regex(/\$type\.(?:iscolor|isnumber|isstring|iskeyword|ispixel|ispercentage|isem)(?![-_a-zA-Z0-9\u0080-\uffff])/);
const jessGuardIsUnitPredicate = regex(/\$type\.isunit(?![-_a-zA-Z0-9\u0080-\uffff])/);

/*
 * The reserved guard-predicate namespace. An expression atom uses this as a
 * negative lookahead so `$type.*` can never take a generic call tail and bypass
 * the closed, arity-checked predicate grammar above.
 */
const jessTypeNamespace = regex(/\$type\./);

/*
 * `${…}` — the interpolation form for every NAME, SELECTOR, and STRING position.
 * Its body follows the one rule `[…]` already follows everywhere else in the
 * language, so this is not new vocabulary:
 *
 * `${foo}`      a bare NAME — the VARIABLE `$foo`. Less-style, and the default.
 * `${[foo]}`    bracketed — a LOOKUP, which in a name position is the PROPERTY
 * `foo` declared in scope.
 *
 * BARE-vs-BRACKETED is what carries the namespace, exactly as `[…]` does
 * everywhere else in the language. Quoting carries nothing: `[foo]` and
 * `["foo"]` are the same plain string (ledger P14), so quotes appear only when
 * the string is not a valid identifier — `${["foo bar"]}`.
 *
 * The bare form is the default because an interpolation position is a splice
 * point, not a place to compute; the bracketed form is the explicit opt-in for
 * the cases a bare name cannot reach. `${[$m[key]]}` is three bracket levels and
 * is deliberately left that way — the spelling is committed to, rather than
 * sugared around.
 *
 * Bare interpolation (no braces) is impossible because `-` is an identifier byte,
 * so `--$name-color` has no unambiguous name boundary.
 *
 * The `${[` / `]}` openers are ONE literal each so that the bracketed arms carry
 * the same child layout as `jessDollarInterpStructure` and share its reducer —
 * two reducers for one body grammar would drift.
 */
const jessDollarBraceStructure = noTrivia(choice(
  sequence(
    literal('${['),
    literal('$'),
    jessDollarName,
    literal(']}')
  ),
  sequence(
    literal('${['),
    jessDollarName,
    literal(']}')
  ),
  sequence(
    literal('${['),
    literal('\''),
    regex(/(?:[^'\\]|\\[\s\S])*/),
    literal('\''),
    literal(']}')
  ),
  sequence(
    literal('${['),
    literal('"'),
    regex(/(?:[^"\\]|\\[\s\S])*/),
    literal('"'),
    literal(']}')
  ),
  sequence(
    literal('${'),
    jessDollarName,
    literal('}')
  )
));
const jessDollarInterpStructure = noTrivia(choice(
  sequence(
    literal('$['),
    literal('$'),
    jessDollarName,
    literal(']')
  ),
  sequence(
    literal('$['),
    jessDollarName,
    literal(']')
  ),
  sequence(
    literal('$['),
    literal('\''),
    regex(/(?:[^'\\]|\\[\s\S])*/),
    literal('\''),
    literal(']')
  ),
  sequence(
    literal('$['),
    literal('"'),
    regex(/(?:[^"\\]|\\[\s\S])*/),
    literal('"'),
    literal(']')
  )
));
const jessCustomPropertyChunk = regex(/(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
const jessSelectorTextRun = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);

/*
 * The parent selector. `&` alone is a selector reference; `&` fused with an
 * identifier is the parent-NAME concatenation extension (`&__el`, `&--mod`,
 * `&-suffix`). `SimpleSelector.text` retaining `&` is already the canonical AST:
 * core's selector path identifies parent references from that text and performs
 * both the spec substitution and the name concatenation.
 *
 * Unlike Less's `staticAmpersand`, which fuses any `[-_a-zA-Z0-9\u0080-\uffff]*`
 * run, the fused tail here must be a valid CSS identifier. `&-1` is therefore a
 * positioned parse error in `.jess` \u2014 `-1` is not an identifier \u2014 and `&(-1)` is
 * its explicit spelling.
 */
const jessAmpersand = regex(/&(?:--(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*)?/);

/*
 * `&(X)` is the explicit spelling of the fused append: `&(-1)` appends `-1` to
 * the parent name exactly as Less's `&-1` does. It is the escape hatch for the
 * suffixes the fused form rejects, so its payload is Less's fused tail run.
 *
 * `&('')` (at-root output placement) and `&(nil)` are NOT append payloads and
 * stay out: `''` is an output-placement instruction with no AST v2 carrier, and
 * `nil` is not a Jess keyword. Neither may degrade into "append nothing", so the
 * payload is non-empty and excludes a bare `nil`.
 */
const jessAmpersandAppendPayload = regex(/(?!nil\))[-_a-zA-Z0-9\u0080-\uffff]+/);

/*
 * The literal tail an authored value-position interpolation may carry: a unit
 * (`$(20)px`), a percent sign, or an identifier suffix (`$[name]-suffix`).
 */
const jessInterpolatedValueTail = regex(/[-_a-zA-Z0-9\u0080-\uffff%]+/);

/*
 * One value-term slash boundary, with its authored whitespace on either side.
 * The negative lookahead keeps a comment opener (`/*`) out of the boundary so a
 * commented value still fails exactly where it did before.
 */
const jessValueSlashBoundary = regex(/[ \t\n\r\f]*\/(?!\*)[ \t\n\r\f]*/);
const jessGeneralTemplateText = regex(/(?:[^$()\[\]{}'"\\]|\\[\s\S])+/);

/*
 * An unquoted Jess URL keeps literal URL-token bytes and `$[…]` segments as
 * separate grammar facts. Whitespace, quotes, parentheses, and any other `$`
 * form remain outside this closed URL slice rather than becoming raw payload.
 */
const jessUrlInterpolatedText = regex(/(?:[^"'()$\ \t\n\r\f\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);

/*
 * Jess's compiler namespace: the `@-\u2026` names a module directive lowers to. They
 * are not CSS output, so they must never be claimed by the generic at-rule arms
 * or captured as opaque bytes \u2014 their own typed productions own them, and a
 * malformed one must report its own error rather than silently degrade.
 */
const jessCompilerAtRuleName = regex(/@-(?:use|compose|export|import|from)(?![-_a-zA-Z0-9\u0080-\uffff])/i);

/*
 * The exclusion list is dispatch, not vocabulary: every name here HAS a typed
 * production. Media and container are excluded so the header choice can lead
 * every arm with a concrete `@` first-set (their dedicated arms own those
 * names); keeping `media`/`container` out of the generic name is what lets the
 * whole at-rule subtree be `@`-dispatched instead of speculatively entered at
 * every rule. Only the five compiler names are excluded from the `@-\u2026` space \u2014
 * which at-rules exist is a language-service fact, so an ordinary vendor prefix
 * (`@-webkit-anything`, `@-moz-document`) is plain unknown CSS and passes.
 */
const jessGenericCssAtRuleName = regex(/@(?!(?:charset|import|supports|property|media|container|-use|-compose|-export|-import|-from|(?:-[a-z]+-)?keyframes)(?![-_a-zA-Z0-9\u0080-\uffff]))-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
const jessCharsetAtRuleName = regex(/@charset(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessImportAtRuleName = regex(/@import(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessSupportsAtRuleName = regex(/@supports(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessPropertyAtRuleName = regex(/@property(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessScopeAtRuleName = regex(/@scope(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessKeyframeEndpoint = regex(/(?:from|to)(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const jessKeyframePercent = regex(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)%/);

export const jessAstGrammar = composeLeaf([cssAstSyntax, opaqueAtRuleRecognition, cssAstPseudoSyntax, rules<JessAstRules>(
  { trivia: whitespace },
  (g: JessAstRules & SharedCssAstSyntax) => {
  /*
   * Only a block comment is CSS output. A `//` line comment is lexical trivia
   * (see `whitespace`) and is dropped, matching Less.
   */
    const DirectJessComment = node<Comment>(
      'DirectJessComment',
      blockComment,
      children => comment(requireToken(children[0]).value)
    );
    const DirectJessVarReference = node<VariableReference>(
      'DirectJessVarReference',
      choice(
        noTrivia(sequence(
          literal('$$'),
          jessDollarName
        )),
        noTrivia(sequence(
          literal('$'),
          jessDollarName
        ))
      ),
      (children, _fields, span) => withSourceSpan(
        variableReference(
          requireToken(children.at(-1)).value,
          requireToken(children[0]).value === '$$' ? 'scoped' : 'live'
        ),
        span
      )
    );
    const DirectJessDollarBrace = node<Interpolation>(
      'DirectJessDollarBrace',
      jessDollarBraceStructure,
      (children, _fields, span) => dollarBraceInterpolation(
        children,
        span
      )
    );
    const DirectJessDollarInterp = node<Interpolation>(
      'DirectJessDollarInterp',
      jessDollarInterpStructure,
      (children, _fields, span) => interpolationFromChildren(
        children,
        span
      )
    );

    /*
   * The expression-context spelling of `${…}`, for the quoted-string family that
   * reduces to an `ExpressionFact` rather than a bare `Interpolation`.
   */
    const DirectJessExpressionDollarBrace = node<ExpressionFact>(
      'DirectJessExpressionDollarBrace',
      jessDollarBraceStructure,
      (children, _fields, span) => {
        return { value: dollarBraceInterpolation(
          children,
          span
        ), src: tokenSource(children) };
      }
    );
    const DirectJessExpressionDollarInterp = node<ExpressionFact>(
      'DirectJessExpressionDollarInterp',
      jessDollarInterpStructure,
      (children, _fields, span) => ({ value: interpolationFromChildren(
        children,
        span
      ), src: tokenSource(children) })
    );
    const DirectJessExpressionProductOperator = node<JessOperatorFact>(
      'DirectJessExpressionProductOperator',
      noTrivia(sequence(
        jessExprBoundary,
        jessExprProductSymbol,
        jessExprBoundary
      )),
      children => ({ value: requireToken(children[1]).value, src: tokenSource(children) })
    );
    const DirectJessExpressionSumOperator = node<JessOperatorFact>(
      'DirectJessExpressionSumOperator',
      noTrivia(sequence(
        jessExprBoundary,
        jessExprSumSymbol,
        jessExprBoundary
      )),
      children => ({ value: requireToken(children[1]).value, src: tokenSource(children) })
    );
    const DirectJessExpressionCompareOperator = node<JessOperatorFact>(
      'DirectJessExpressionCompareOperator',
      noTrivia(sequence(
        jessExprBoundary,
        jessExprCompareSymbol,
        jessExprBoundary
      )),
      children => ({ value: requireToken(children[1]).value, src: tokenSource(children) })
    );
    const DirectJessExpressionAtom = node<ExpressionFact>(
      'DirectJessExpressionAtom',

      /*
     * `$name` references dominate expression atoms; try VarReference before the
     * `$[` interpolation form (disjoint on the char after `$`) so a plain
     * reference does not first enter and roll back the DollarInterp node frame.
     * The reference keeps its accessor AND call tails here so a member read and
     * a call are the SAME grammar facts in arithmetic position that they already
     * are in value position — that is what lets `$(…)` nest calls to any depth
     * (`$($double($double($n)))`), since each argument is itself an ordinary
     * value. A parenthesized sub-group is the explicit precedence boundary.
     *
     * The `$type.` namespace is the one exception, and it gets the second arm:
     * this atom is shared with `$if`/`when`, where `$type.isnumber($x)` must
     * keep reducing through the arity-checked `DirectJessGuardCall` predicate
     * syntax. Letting it take a generic call tail would silently admit
     * `$type.unknown($x)` and every wrong-arity spelling the guard grammar
     * exists to reject. Bare-name calls stay out of the atom entirely for the
     * same reason — `default()` is mixin-only syntax.
     */
      choice(
        noTrivia(sequence(
          not(jessTypeNamespace),
          g.DirectJessVarReference,
          many(choice(
            g.DirectJessReferenceCallTail,
            g.DirectJessReferenceTail
          ))
        )),
        noTrivia(sequence(
          g.DirectJessVarReference,
          many(g.DirectJessReferenceTail)
        )),
        g.DirectJessExpressionDollarInterp,
        g.DirectJessDimension,
        g.DirectJessColor,
        g.DirectJessExpressionQuoted,
        sequence(
          literal('('),
          g.DirectJessExpressionCompare,
          literal(')')
        ),

        /*
       * NOTE: a BARE-name call (`max(1, 2)`) is deliberately NOT an atom here.
       * This atom is shared with `$if`/`when` conditions, which must keep
       * rejecting the mixin-only `default()` form; admitting bare calls would
       * make `default()` a legal condition. Dispatch reaches an expression only
       * through the `$fn(…)` reference tail above, which cannot spell `default()`.
       */
        g.DirectJessKeyword
      ),
      (children) => {
        if (isToken(children[0]) && requireToken(children[0]).value === '(') {
          const inner = requireExpressionFact(children[1]);
          return { value: block(inner.value), src: `(${inner.src})` };
        }
        if (isJessReferenceTail(children[1])) {
          const base = requireValueNode(children[0]);
          if (base.type !== 'VariableReference') {
            throw new TypeError('Direct Jess expression reference base must be a variable reference.');
          }
          const tails = children.slice(1).map(requireJessReferenceTail);
          const raw = `${base.lookup === 'scoped' ? '$$' : '$'}${base.name}${tails.map(tail => tail.src).join('')}`;
          return { value: reference(
            base,
            tails.map(tail => tail.step),
            raw
          ), src: raw };
        }
        if (isExpressionFact(children[0])) {
          return requireExpressionFact(children[0]);
        }
        const value = requireValueNode(children[0]);
        return { value, src: expressionSource(value) };
      }
    );
    const DirectJessExpressionProduct = node<ExpressionFact>(
      'DirectJessExpressionProduct',
      noTrivia(sequence(
        g.DirectJessExpressionAtom,
        many(sequence(
          DirectJessExpressionProductOperator,
          g.DirectJessExpressionAtom
        ))
      )),
      children => foldExpression(children)
    );
    const DirectJessExpressionSum = node<ExpressionFact>(
      'DirectJessExpressionSum',
      noTrivia(sequence(
        g.DirectJessExpressionProduct,
        many(sequence(
          DirectJessExpressionSumOperator,
          g.DirectJessExpressionProduct
        ))
      )),
      children => foldExpression(children)
    );
    const DirectJessExpressionCompare = node<ExpressionFact>(
      'DirectJessExpressionCompare',
      noTrivia(sequence(
        g.DirectJessExpressionSum,
        optional(sequence(
          DirectJessExpressionCompareOperator,
          g.DirectJessExpressionSum
        ))
      )),
      (children) => {
        if (children.length === 1) {
          return requireExpressionFact(children[0]);
        }
        const left = requireExpressionFact(children[0]);
        const operator = requireOperatorFact(children[1]);
        const right = requireExpressionFact(children[2]);
        const src = `${left.src}${operator.src}${right.src}`;
        return { value: condition(
          { g: 'cmp', op: operator.value, left: left.value, right: right.value },
          src
        ), src };
      }
    );

    /*
   * Shared sum-level operand for unwrapped arithmetic: an ExpressionAtom folded
   * with any `*` product operators. `DirectJessDollarValue` reuses this for the
   * products that follow the first (whitespace-flanked) sum operator; the first
   * product is rebuilt there from the already-parsed leading reference.
   */
    const DirectJessUnwrappedProductRest = node<ExpressionFact>(
      'DirectJessUnwrappedProductRest',
      noTrivia(sequence(
        g.DirectJessExpressionAtom,
        many(sequence(
          jessUnwrappedProductOperator,
          g.DirectJessExpressionAtom
        ))
      )),
      foldExpression
    );

    /*
   * Mixin guards use the same structural GuardNode model as $if. Keep the
   * documented Jess condition rule strict: a comparison participating in an
   * and/or chain must be parenthesized; mixed chains must group explicitly.
   * No source string is retained or reparsed after recognition.
   */
    const DirectJessGuardValue = node<GuardNode>(
      'DirectJessGuardValue',
      g.DirectJessExpressionSum,
      reduceGuardTruth
    );
    const DirectJessGuardCompare = node<GuardNode>(
      'DirectJessGuardCompare',
      sequence(
        g.DirectJessExpressionSum,
        regex(/>=|<=|>|<|=/),
        g.DirectJessExpressionSum
      ),
      reduceGuardCompare
    );
    const DirectJessGuardCall = node<GuardNode>(
      'DirectJessGuardCall',
      choice(
        sequence(
          jessGuardUnaryTypePredicate,
          literal('('),
          g.DirectJessValueTerm,
          literal(')')
        ),
        sequence(
          jessGuardIsUnitPredicate,
          literal('('),
          g.DirectJessValueTerm,
          optional(sequence(
            literal(','),
            g.DirectJessValueTerm
          )),
          literal(')')
        )
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
        sequence(
          regex(/not(?![-_a-zA-Z0-9\u0080-\uffff])/),
          literal('('),
          g.DirectJessMixinGuard,
          literal(')')
        ),
        sequence(
          literal('('),
          g.DirectJessMixinGuard,
          literal(')')
        ),
        sequence(
          regex(/default(?![-_a-zA-Z0-9\u0080-\uffff])/),
          literal('('),
          literal(')')
        ),
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
      sequence(
        g.DirectJessGuardPrimary,
        oneOrMore(sequence(
          regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessGuardPrimary
        ))
      ),
      reduceGuardAnd
    );
    const DirectJessGuardOr = node<GuardNode>(
      'DirectJessGuardOr',
      sequence(
        g.DirectJessGuardPrimary,
        oneOrMore(sequence(
          regex(/or(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessGuardPrimary
        ))
      ),
      reduceGuardOr
    );
    const DirectJessMixinGuard = node<GuardNode>(
      'DirectJessMixinGuard',
      choice(
        g.DirectJessGuardAnd,
        g.DirectJessGuardOr,
        g.DirectJessGuardCompare,
        g.DirectJessGuardPrimary
      ),
      children => requireGuardNode(children[0])
    );
    const DirectJessExpression = node<Interpolation>(
      'DirectJessExpression',
      sequence(
        literal('$('),
        many(blockComment),
        g.DirectJessExpressionCompare,
        many(blockComment),
        literal(')')
      ),

      /*
     * `$()` is the explicit arithmetic boundary. Preserve that execution fact
     * in the canonical value graph so division operates under parens-division.
     * The block is a BOUNDARY, not an authored group: the parens are the `$(`
     * and `)` of this very spelling, so they open the math context without ever
     * reaching output — otherwise `$(foo)` emits a paren pair nobody wrote.
     */
      children => interpolation([{ ref: boundaryBlock(requireExpressionFact(children.find(isExpressionFact)).value), unquote: true }])
    );
    const DirectJessExpressionInterpolation = node<ExpressionFact>(
      'DirectJessExpressionInterpolation',
      sequence(
        literal('$('),
        many(blockComment),
        g.DirectJessExpressionCompare,
        many(blockComment),
        literal(')')
      ),
      (children) => {
        const body = requireExpressionFact(children.find(isExpressionFact));

        /*
       * Quoted/template positions retain the same explicit `$()` evaluation
       * boundary as a standalone expression. Otherwise the AST silently loses
       * parens-division semantics depending on where the expression appears.
       */
        return {
          value: interpolation([{ ref: boundaryBlock(body.value), unquote: true }]),
          src: children.map(child => isExpressionFact(child) ? body.src : requireToken(child).value).join('')
        };
      }
    );

    /*
   * This is only the already-modelled static escaped-string fact. An escaped
   * interpolation needs a distinct AST representation for its unquoting mode.
   * Every quoted arm is `noTrivia`: string contents are literal bytes, so the
   * ambient trivia must not reach inside a string and silently drop a leading
   * space or swallow a `//` run as a line comment.
   *
   * An interpolated `$( … )` inside a string must NOT inherit that `noTrivia`:
   * the expression rule is SHARED, so a single no-trivia call site strips trivia
   * from every `$( … )` in the document and `$( 1px + 1px )` stops parsing.
   * These two re-enter the ambient trivia for the nested expression only.
   */
    const directJessQuotedExpression = parser(
      { trivia: whitespace },
      g.DirectJessExpression
    );
    const directJessQuotedExpressionInterpolation = parser(
      { trivia: whitespace },
      g.DirectJessExpressionInterpolation
    );
    const directJessEscapedStaticQuoted = choice(
      noTrivia(sequence(
        literal('~'),
        literal('"'),
        plainDoubleQuotedText,
        literal('"')
      )),
      noTrivia(sequence(
        literal('~'),
        literal('\''),
        plainSingleQuotedText,
        literal('\'')
      ))
    );

    /*
   * Shared static plain-quoted arms. The escaped, double-, and single-quoted
   * static prefix is identical across the value, static, and expression quoted
   * families; only the interp-bearing arms and the reducer differ.
   */
    const directJessPlainDoubleQuoted = noTrivia(sequence(
      literal('"'),
      plainDoubleQuotedText,
      literal('"')
    ));
    const directJessPlainSingleQuoted = noTrivia(sequence(
      literal('\''),
      plainSingleQuotedText,
      literal('\'')
    ));
    const DirectJessQuoted = node<Quoted | Interpolation>(
      'DirectJessQuoted',
      choice(
        directJessEscapedStaticQuoted,
        directJessPlainDoubleQuoted,
        directJessPlainSingleQuoted,

        /*
       * An escaped string that carries interpolation IS representable: the
       * escape drops the quotes, so the value is exactly the Interpolation of
       * its content parts with no quote literals around them. Only the static
       * arm needs the separate `Quoted` escaped fact.
       */
        noTrivia(sequence(
          literal('~'),
          literal('"'),
          many(choice(
            g.DirectJessDollarBrace,
            directJessQuotedExpression,
            interpolatedDoubleQuotedText
          )),
          literal('"')
        )),
        noTrivia(sequence(
          literal('~'),
          literal('\''),
          many(choice(
            g.DirectJessDollarBrace,
            directJessQuotedExpression,
            interpolatedSingleQuotedText
          )),
          literal('\'')
        )),
        noTrivia(sequence(
          literal('"'),
          many(choice(
            g.DirectJessDollarBrace,
            directJessQuotedExpression,
            interpolatedDoubleQuotedText
          )),
          literal('"')
        )),
        noTrivia(sequence(
          literal('\''),
          many(choice(
            g.DirectJessDollarBrace,
            directJessQuotedExpression,
            interpolatedSingleQuotedText
          )),
          literal('\'')
        ))
      ),
      (children) => {
        if (requireToken(children[0]).value !== '~') {
          return quotedInterpolationFromChildren(children);
        }
        if (children.some(isInterpolation)) {
          return escapedInterpolationFromChildren(children);
        }
        const quote = requireToken(children[1]).value;
        const content = requireToken(children[2]).value;
        return quoted(
          `~${quote}${content}${quote}`,
          content,
          quote,
          true
        );
      }
    );

    /*
   * CSS statement/header strings are deliberately static facts. Keeping this
   * separate from the general Jess quoted form makes `$[…]`/`$(…)` fail as
   * grammar recognition, rather than reaching a reducer that could throw a
   * non-SyntaxError from the public parse path.
   */
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
          return quoted(
            `~${quote}${content}${quote}`,
            content,
            quote,
            true
          );
        }
        const open = requireToken(children[0]).value;
        const content = requireToken(children[1]).value;
        return quoted(
          `${open}${content}${open}`,
          content,
          open,
          false
        );
      }
    );

    /*
   * These are source facts, not resolution instructions. The parser owns only
   * the static authored path/binding structure; Context-dispatched plugins own
   * loading, target classification, and execution.
   */
    const directJessImportName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
    const directJessAsClause = sequence(
      regex(/as(?![-_a-zA-Z0-9\u0080-\uffff])/),
      directJessImportName
    );
    const directJessStyleAsClause = sequence(
      regex(/as(?![-_a-zA-Z0-9\u0080-\uffff])/),
      choice(
        literal('*'),
        directJessImportName
      )
    );
    const DirectJessStyleImport = node<StyleImport>(
      'DirectJessStyleImport',
      choice(
        sequence(
          regex(/@-compose(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessQuoted,
          optional(directJessStyleAsClause),
          optional(literal(';'))
        ),
        sequence(
          regex(/@-export(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessQuoted,
          optional(literal(';'))
        ),
        sequence(
          regex(/@-import(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessQuoted,
          optional(literal(';'))
        )
      ),
      (children) => {
        const source = requireToken(children[0]).value;
        const path = requireStaticQuoted(children[1]);
        const names = children.slice(2).filter(isToken)
          .map(requireToken).map(token => token.value);
        if (source === '@-compose') {
          return styleImport(
            path,
            'compose',
            names.find(name => name !== 'as' && name !== ';') ?? null,
            false
          );
        }
        if (source === '@-export') {
          return styleImport(
            path,
            'compose',
            null,
            true
          );
        }
        if (source === '@-import') {
          return styleImport(
            path,
            'import'
          );
        }
        throw new TypeError('Direct Jess AST grammar produced an unknown style import form.');
      }
    );
    const DirectJessModuleSpecifier = node<ModuleImportSpecifier>(
      'DirectJessModuleSpecifier',
      sequence(
        directJessImportName,
        optional(directJessAsClause)
      ),
      children => ({
        name: requireToken(children[0]).value,
        alias: children.length === 3 ? requireToken(children[2]).value : null
      })
    );
    const DirectJessModuleImport = node<ModuleImport>(
      'DirectJessModuleImport',
      choice(
        sequence(
          regex(/@-use(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessQuoted,
          optional(directJessStyleAsClause),
          optional(literal(';'))
        ),
        sequence(
          regex(/@-from(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessQuoted,
          regex(/import(?![-_a-zA-Z0-9\u0080-\uffff])/),
          choice(
            sequence(
              literal('*'),
              directJessAsClause
            ),
            sequence(
              g.DirectJessModuleSpecifier,
              literal(','),
              literal('('),
              g.DirectJessModuleSpecifier,
              many(sequence(
                literal(','),
                g.DirectJessModuleSpecifier
              )),
              literal(')')
            ),
            g.DirectJessModuleSpecifier,
            sequence(
              literal('('),
              g.DirectJessModuleSpecifier,
              many(sequence(
                literal(','),
                g.DirectJessModuleSpecifier
              )),
              literal(')')
            )
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
          return moduleImport(
            path,
            'use',
            names.find(name => name !== 'as' && name !== ';') ?? null
          );
        }
        if (source !== '@-from') {
          throw new TypeError('Direct Jess AST grammar produced an unknown module import form.');
        }
        const star = children.find((child): child is Token => isToken(child) && child.value === '*');
        if (star !== undefined) {
          const tokens = children.filter(isToken)
            .map(requireToken).map(token => token.value);
          const asIndex = tokens.indexOf('as');
          return moduleImport(
            path,
            'from',
            asIndex >= 0 ? tokens[asIndex + 1] ?? null : null
          );
        }
        const imports = children.filter((child): child is ModuleImportSpecifier => typeof child === 'object' && child !== null && 'name' in child && 'alias' in child);
        const hasNamedGroup = children.some(child => isToken(child) && child.value === '(');
        if (!hasNamedGroup) {
          if (imports.length !== 1) {
            throw new TypeError('Direct Jess AST grammar produced invalid default module import bindings.');
          }
          return moduleImport(
            path,
            'from',
            null,
            [],
            imports[0]!.name
          );
        }
        const commaBeforeNamedGroup = children.some((child, index) => index > 0 && isToken(child) && child.value === ',' && children.slice(index + 1).some(next => isToken(next) && next.value === '('));
        return commaBeforeNamedGroup
          ? moduleImport(
              path,
              'from',
              null,
              imports.slice(1),
              imports[0]!.name
            )
          : moduleImport(
              path,
              'from',
              null,
              imports
            );
      }
    );
    const DirectJessExpressionQuoted = node<ExpressionFact>(
      'DirectJessExpressionQuoted',
      choice(
        directJessEscapedStaticQuoted,
        directJessPlainDoubleQuoted,
        directJessPlainSingleQuoted,
        noTrivia(sequence(
          literal('"'),
          many(choice(
            g.DirectJessExpressionDollarBrace,
            directJessQuotedExpressionInterpolation,
            interpolatedDoubleQuotedText
          )),
          literal('"')
        )),
        noTrivia(sequence(
          literal('\''),
          many(choice(
            g.DirectJessExpressionDollarBrace,
            directJessQuotedExpressionInterpolation,
            interpolatedSingleQuotedText
          )),
          literal('\'')
        ))
      ),
      (children) => {
        if (requireToken(children[0]).value !== '~') {
          return quotedExpressionFact(children);
        }
        const quote = requireToken(children[1]).value;
        const content = requireToken(children[2]).value;
        const value = quoted(
          `~${quote}${content}${quote}`,
          content,
          quote,
          true
        );
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
      noTrivia(sequence(
        g.CssAstSyntaxNumber,
        optional(g.CssAstSyntaxDimensionUnit)
      )),
      (children) => {
        const numberText = requireToken(children[0]).value;
        const unit = children.length > 1 ? requireToken(children[1]).value : '';
        return dimension(
          Number(numberText),
          unit,
          `${numberText}${unit}`
        );
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
        choice(
          g.DirectJessDollarBrace,
          g.DirectJessExpression
        ),
        many(choice(
          jessUrlInterpolatedText,
          g.DirectJessDollarBrace,
          g.DirectJessExpression
        ))
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

    /*
   * Static CSS at-rule headers use this closed URL production. Dynamic URL
   * segments are admitted only by the value and CSS-import productions below.
   */
    const DirectJessUrl = node<Url>(
      'DirectJessUrl',
      sequence(
        g.CssAstSyntaxUrlOpen,
        optional(choice(
          g.DirectJessStaticQuoted,
          g.CssAstSyntaxStaticUrlInner
        )),
        literal(')')
      ),
      (children) => {
        if (children.length === 2) {
          return url(any(''));
        }
        const body = children[1];
        return isValueNode(body) ? url(body) : url(any(requireToken(body).value));
      }
    );

    /*
   * Ordinary Jess value URLs retain `$[…]` as typed interpolation, instead of
   * lowering it to opaque URL text or a generic function call.
   */
    const DirectJessInterpolatedUrl = node<Url>(
      'DirectJessInterpolatedUrl',
      sequence(
        g.CssAstSyntaxUrlOpen,
        choice(
          g.DirectJessQuoted,
          g.DirectJessUrlInterpolatedValue
        ),
        literal(')')
      ),
      children => url(requireValueNode(children[1]))
    );

    /*
   * These static selector reductions are deliberately declared before values:
   * `*[…]` uses them as an ordered selector payload, while selectors themselves
   * never need to parse a value. Keeping that dependency one-way avoids a
   * recording-phase forward-reference cycle.
   */
    const DirectJessSimple = node<SimpleSelector>(
      'DirectJessSimple',
      g.CssAstSyntaxSimple,
      children => simpleSelector(requireToken(children[0]).value)
    );

    /*
   * The fused form and its explicit `&(X)` spelling reduce to one canonical
   * `SimpleSelector.text`, so `&(-1)` and Less's `&-1` hand core identical input.
   * The parenthesized arm leads: the fused terminal would otherwise commit the
   * bare `&` of `&(-1)` and strand its payload.
   */
    const DirectJessParent = node<SimpleSelector>(
      'DirectJessParent',
      choice(
        sequence(
          literal('&('),
          jessAmpersandAppendPayload,
          literal(')')
        ),
        jessAmpersand
      ),
      (children) => {
        const head = requireToken(children[0]).value;
        return simpleSelector(head === '&(' ? `&${requireToken(children[1]).value}` : head);
      }
    );

    /*
   * Cheap superset lookahead so an ordinary `.card` simple selector does not
   * consume its `[.#]`+text run, fail the required `$[…]`, and backtrack a
   * re-parse through DirectJessSimple. The predicate mirrors this arm's own
   * leading shape (optional class/id sigil + selector-text run) and requires an
   * interpolation opener immediately after it, so the opener is bound to THIS
   * simple selector and a sibling selector's interpolation never falsely admits
   * a plain one.
   */
    const directInterpSimpleAhead = not(not(regex(/[.#]?[-_a-zA-Z0-9\u0080-\uffff]*\$[[{]/)));
    const DirectJessInterpolatedSimple = node<SimpleSelector>(
      'DirectJessInterpolatedSimple',
      noTrivia(sequence(
        directInterpSimpleAhead,
        optional(regex(/[.#]/)),
        many(jessSelectorTextRun),
        g.DirectJessDollarBrace,
        many(choice(
          g.DirectJessDollarBrace,
          jessSelectorTextRun
        ))
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
          /*
           * The superset lookahead emits a throwaway match token (`…$[`). Real
           * selector-text chunks never contain `$`, so this content check drops
           * only that throwaway, independent of its position.
           */
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

    /*
   * `&` glued to a `$[…]` template is ONE parent-suffix selector atom, not a
   * parent reference followed by a second compound member. Only the fused shape
   * distributes the concatenation per parent; a split one would resolve the bare
   * `&` to `:is(parents)` first and then append to that.
   *
   * The literal run between `&` and the template is a template FRAGMENT, not a
   * completed identifier, so the fused terminal's identifier rule does not apply
   * to it: `&-$[tone]` is the authored spelling of `&-primary`. The lookahead is
   * the same fast reject `DirectJessInterpolatedSimple` uses, so an ordinary `&`
   * compound member never pays a failed template scan.
   */
    const directInterpParentAhead = not(not(regex(/&[-_a-zA-Z0-9\u0080-\uffff]*\$[[{]/)));
    const DirectJessInterpolatedParentSuffix = node<SimpleSelector>(
      'DirectJessInterpolatedParentSuffix',
      noTrivia(sequence(
        directInterpParentAhead,
        literal('&'),
        many(jessSelectorTextRun),
        g.DirectJessDollarBrace,
        many(choice(
          g.DirectJessDollarBrace,
          jessSelectorTextRun
        ))
      )),
      children => interpolatedSimpleSelector(templateInterpolationFromChildren(children.filter(child => !isToken(child) || !child.value.includes('$'))))
    );
    const directJessAttributeDoubleQuoted = noTrivia(sequence(
      literal('"'),
      g.CssAstSyntaxDoubleQuotedText,
      literal('"')
    ));
    const directJessAttributeSingleQuoted = noTrivia(sequence(
      literal('\''),
      g.CssAstSyntaxSingleQuotedText,
      literal('\'')
    ));
    const DirectJessAttribute = node<SimpleSelector>(
      'DirectJessAttribute',
      sequence(
        literal('['),
        g.CssAstSyntaxKeyword,
        optional(sequence(
          g.CssAstSyntaxAttributeOperator,
          choice(
            directJessAttributeDoubleQuoted,
            directJessAttributeSingleQuoted,
            g.CssAstSyntaxKeyword
          ),
          optional(g.CssAstSyntaxAttributeModifier)
        )),
        literal(']')
      ),
      children => simpleSelector(children.map(requireToken).map(token => token.value).join(''))
    );

    /*
   * `:nth-child`/`:nth-last-child` argument: a bare `<An+B>` OR `<An+B> of S`
   * (Selectors-4 §6.6.2, https://www.w3.org/TR/selectors-4/#the-nth-child-pseudo).
   * The shared `g.CssAstSyntaxNth`/`g.CssAstSyntaxOfKeyword`/`g.CssAstSyntaxPseudoCloseAhead`
   * recognitions replace the inlined `<An+B> of` regex; `of` keeps its authored
   * surrounding whitespace (explicit `rawWhitespace`, not trivia) so `2n+1of .a`
   * cannot be silently normalized into the distinct `2n+1 of .a` syntax. The
   * selector fallback keeps a previously-opaque selector arg (`:nth-child(.a)`)
   * accepted as before; typed An+B is tried first so `-n+2` is not claimed as a
   * static `-n` selector.
   */
    const DirectJessStaticNthChildArgument = node<SelectorList | string>(
      'DirectJessStaticNthChildArgument',
      choice(
        sequence(
          g.CssAstSyntaxNth,
          optional(sequence(
            rawWhitespace,
            g.CssAstSyntaxOfKeyword,
            rawWhitespace,
            parser(
              { trivia: whitespace },
              g.DirectJessStaticSelector
            )
          )),
          g.CssAstSyntaxPseudoCloseAhead
        ),
        parser(
          { trivia: whitespace },
          g.DirectJessStaticSelector
        )
      ),
      (children) => {
        const selector = children.find(isSelectorList);
        const nth = children.find(isToken);
        if (nth === undefined) {
          if (selector === undefined) {
            throw new TypeError('Direct Jess nth-child pseudo argument lost its selector.');
          }
          return selector;
        }
        return selector === undefined ? nth.value : `${nth.value} of ${staticSelectorText(selector)}`;
      }
    );

    /*
   * `:nth-of-type`/`:nth-last-of-type` argument: a BARE `<An+B>` only — Selectors-4
   * §6.6.2 defines no `of S` tail for the type-index families. The bare arm's
   * close-ahead rejects a trailing `of …`, and the selector fallback (which keeps
   * a previously-opaque `:nth-of-type(.a)` accepted) is guarded by a negative
   * lookahead for an `<An+B>` immediately followed by `of` so `2n of .a`,
   * `n of .a`, `-n+3 of .a` fail rather than being re-captured as a descendant
   * selector — the CSS-aligned owner decision (PSEUDO-ARGUMENT-CONSOLIDATION §7.1).
   */
    const DirectJessStaticNthTypeArgument = node<SelectorList | string>(
      'DirectJessStaticNthTypeArgument',
      choice(
        sequence(
          g.CssAstSyntaxNth,
          g.CssAstSyntaxPseudoCloseAhead
        ),
        sequence(
          not(parser(
            { trivia: whitespace },
            sequence(
              g.CssAstSyntaxNth,
              g.CssAstSyntaxOfKeyword
            )
          )),
          parser(
            { trivia: whitespace },
            g.DirectJessStaticSelector
          )
        )
      ),
      (children) => {
        const selector = children.find(isSelectorList);
        const nth = children.find(isToken);
        if (nth === undefined) {
          if (selector === undefined) {
            throw new TypeError('Direct Jess nth-of-type pseudo argument lost its selector.');
          }
          return selector;
        }
        return nth.value;
      }
    );
    const DirectJessPseudo = node<SimpleToken>(
      'DirectJessPseudo',

      /*
     * Insignificant whitespace may surround a functional pseudo's argument inside
     * its parens (`:not( .b )`, `:nth-child( 2n+1 )`). Consume it here so valid
     * CSS is accepted in the .jess dialect exactly as the canonical CSS grammar
     * accepts it; it is trivia, so the serialized argument stays normalized.
     * The nth families dispatch by NAME (shared `g.CssAstSyntaxNthChildName`/
     * `g.CssAstSyntaxNthTypeName`) so `of S` is accepted only on the child index
     * and rejected on the type index. The selector-argument pseudos
     * (`:is`/`:where`/`:not`/`:has`/`:matches`) dispatch by their own shared name
     * class and take a selector-ONLY argument with no any-value fallback, so
     * `:not(2n+1)` fails the selector and rejects the whole pseudo. Everything
     * else is the general-any class. Both guards are restated as negative
     * lookaheads on that last arm so a failed selector or malformed nth argument
     * cannot fall through to the any-value scan; a bare, paren-less nth name
     * (`:nth-child`) still rejects rather than becoming a keyword pseudo.
     */
      sequence(
        g.CssAstSyntaxPseudoColon,
        choice(
          sequence(
            g.CssAstSyntaxNthChildName,
            literal('('),
            optional(rawWhitespace),
            DirectJessStaticNthChildArgument,
            optional(rawWhitespace),
            literal(')')
          ),
          sequence(
            g.CssAstSyntaxNthTypeName,
            literal('('),
            optional(rawWhitespace),
            DirectJessStaticNthTypeArgument,
            optional(rawWhitespace),
            literal(')')
          ),
          sequence(
            g.CssAstSyntaxSelectorArgPseudoName,
            literal('('),
            optional(rawWhitespace),
            g.DirectJessStaticPseudoArgument,
            optional(rawWhitespace),
            literal(')')
          ),
          sequence(
            not(g.CssAstSyntaxSelectorArgPseudoName),
            not(g.CssAstSyntaxNthName),
            g.CssAstSyntaxKeyword,
            optional(sequence(
              literal('('),
              g.DirectJessGenericPseudoArgument,
              literal(')')
            ))
          )
        )
      ),
      (children) => {
        const head = `${requireToken(children[0]).value}${requireToken(children[1]).value}`;

        /*
       * The argument reduces to a `SelectorList` or a plain An+B string; the
       * colon, name, parens, and surrounding-whitespace children are all tokens,
       * so a find on those two shapes locates the argument regardless of whether
       * optional whitespace is present.
       */
        const arg = children.find((child): child is SelectorList | string => isSelectorList(child) || typeof child === 'string');
        if (arg === undefined) {
          return simpleSelector(head);
        }

        /*
       * Parser = STRUCTURE + trivia only. A whitelisted selector-function pseudo
       * keeps the parsed `args` (SelectorList) and does NOT join: core serialize
       * owns the inline `:is(a, b)` rule (`pseudoCanonical`). The nth/opaque path
       * still collapses to canonical SimpleSelector text via `staticSelectorText`.
       */
        if (isSelectorList(arg) && STRUCTURED_PSEUDOS.has(requireToken(children[1]).value.toLowerCase())) {
          return pseudoSelector(
            head,
            arg
          );
        }
        const argText = isSelectorList(arg) ? staticSelectorText(arg) : requireString(arg);
        return simpleSelector(`${head}(${argText})`);
      }
    );
    const DirectJessStaticCompound = node<CompoundSelector>(
      'DirectJessStaticCompound',
      noTrivia(oneOrMore(choice(
        parser(
          { trivia: whitespace },
          g.DirectJessAttribute
        ),
        g.DirectJessPseudo,
        g.DirectJessParent,
        g.DirectJessSimple
      ))),
      reduceCompound
    );
    const directJessCombinator = choice(
      literal('||'),
      literal('>'),
      literal('+'),
      literal('~')
    );
    const DirectJessStaticComplexTail = node<JessComplexTail>(
      'DirectJessStaticComplexTail',
      sequence(
        optional(directJessCombinator),
        g.DirectJessStaticCompound
      ),
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
      sequence(
        g.DirectJessStaticCompound,
        many(g.DirectJessStaticComplexTail)
      ),
      reduceComplex
    );
    const DirectJessStaticSelectorTail = node<ComplexSelector>(
      'DirectJessStaticSelectorTail',
      parser(
        { trivia: whitespace },
        sequence(
          literal(','),
          g.DirectJessStaticComplex
        )
      ),
      reduceSelectorTail
    );
    const DirectJessStaticSelector = node<SelectorList>(
      'DirectJessStaticSelector',
      parser(
        { trivia: whitespace },
        sequence(
          g.DirectJessStaticComplex,
          many(g.DirectJessStaticSelectorTail)
        )
      ),
      reduceSelectorList
    );

    /*
   * The generic (non-nth) functional-pseudo argument: a static `SelectorList`
   * only (`:not(.a, .b)`, `:is(.a)`, `:lang(en)`). The nth families dispatch by
   * name to their own arguments above; CSS's generic raw pseudo-argument arm is
   * deliberately NOT used here — it would hide dynamic Jess interpolation as
   * source text. Retain the parsed `SelectorList` rather than collapsing it to
   * text: a whitelisted selector-function pseudo (`:is`/`:not`/…) keeps it as
   * structured `args` and never canonicalizes at parse (the inner `_canon` memos
   * stay unpopulated); `DirectJessPseudo` derives opaque SimpleSelector text otherwise.
   */
    const DirectJessStaticPseudoArgument = node<SelectorList | string>(
      'DirectJessStaticPseudoArgument',
      parser(
        { trivia: whitespace },
        g.DirectJessStaticSelector
      ),
      (children) => {
        const selector = children.find(isSelectorList);
        if (selector === undefined) {
          throw new TypeError('Direct Jess static pseudo argument lost its selector.');
        }
        return selector;
      }
    );

    /*
   * A functional pseudo this grammar has no typed argument for is still
   * well-formed CSS: Selectors-4 §3.5 gives an unknown functional pseudo-class an
   * `<any-value>` argument, and WHETHER a pseudo exists is a language-service
   * fact, not a parse decision — `a:totally-made-up(1)` and `:lang("en-US")` lost
   * the whole stylesheet. The selector arm is tried first so every argument that
   * already parsed keeps its structured `SelectorList` byte-for-byte; only what
   * previously rejected reaches the delimiter-aware verbatim scan the other three
   * dialects already run for this class (css `pseudoRawArgument`, scss's chunk
   * grammar, less `DirectLessStaticNonSelectorPseudo`). A top-level `$` ends the
   * scan, so the required `)` then fails: a Jess interpolation in a pseudo
   * argument still rejects rather than being flattened into opaque text.
   */
    const jessPseudoRawDoubleQuoted = sequence(
      literal('"'),
      plainDoubleQuotedText,
      literal('"')
    );
    const jessPseudoRawSingleQuoted = sequence(
      literal('\''),
      plainSingleQuotedText,
      literal('\'')
    );
    const jessPseudoRawArgument = scanTo(
      choice(
        literal('$'),
        literal(')')
      ),
      {
        skip: [
          balanced(
            '(',
            ')',
            { skip: [jessPseudoRawDoubleQuoted, jessPseudoRawSingleQuoted] }
          ),
          balanced(
            '[',
            ']',
            { skip: [jessPseudoRawDoubleQuoted, jessPseudoRawSingleQuoted] }
          ),
          jessPseudoRawDoubleQuoted,
          jessPseudoRawSingleQuoted,
          blockComment
        ]
      }
    );
    const DirectJessGenericPseudoArgument = node<SelectorList | string>(
      'DirectJessGenericPseudoArgument',
      choice(
        sequence(
          optional(rawWhitespace),
          g.DirectJessStaticPseudoArgument,
          optional(rawWhitespace)
        ),
        jessPseudoRawArgument
      ),
      (children) => {
        const selector = children.find(isSelectorList);
        if (selector !== undefined) {
          return selector;
        }
        return children.length === 0 ? '' : requireToken(children[0]).value;
      }
    );
    const DirectJessSelectorCapture = node<SelectorCapture>(
      'DirectJessSelectorCapture',
      sequence(
        literal('*['),
        g.DirectJessStaticSelector,
        literal(']')
      ),
      (children) => {
        const branches = requireSelectorList(children[1]).selectors.map(complexCanonical);
        return selectorCapture(
          branches,
          `*[${branches.join(', ')}]`
        );
      }
    );

    /*
   * Modern CSS function components can carry one structural slash separator
   * (`rgb(15 23 42 / .22)`). Keep that separator inside the call grammar: `/`
   * remains unavailable as unwrapped Jess arithmetic, and a second or dangling
   * separator cannot fall back to a generic function or raw value.
   */
    const DirectJessCallComponent = node<ValueSlot>(
      'DirectJessCallComponent',
      sequence(
        g.DirectJessValueSpaceGroup,
        optional(sequence(
          optional(rawWhitespace),
          literal('/'),
          optional(rawWhitespace),
          g.DirectJessValueSpaceGroup
        ))
      ),
      (children) => {
        const values = children.filter((child): child is ValueSlot => Array.isArray(child) || isValueNode(child));
        if (values.length === 1) {
          return values[0]!;
        }
        if (values.length === 2 && children.some(child => isToken(child) && child.value === '/')) {
        /*
         * Keep each side as one slash-list item.  The left side of modern
         * `rgb(15 23 42 / .22)` is an authored space group, not three slash
         * operands; flattening it changes the public AST and renders
         * `rgb(15 / 23 / 42 / .22)`.
         */
          return list(
            [values[0]!, values[1]!],
            '/'
          );
        }
        throw new TypeError('Direct Jess AST call component produced unexpected children.');
      }
    );
    const DirectJessCallArgument = node<ValueSlot>(
      'DirectJessCallArgument',
      sequence(
        literal(','),
        optional(regex(/[ \t\n\r\f]+/)),
        g.DirectJessCallComponent
      ),
      (children) => {
        if ((children.length !== 2 && children.length !== 3) || requireToken(children[0]).value !== ',') {
          throw new TypeError('Direct Jess AST call argument produced unexpected children.');
        }
        const value = children.at(-1);
        return Array.isArray(value) ? value : requireValueNode(value);
      }
    );

    /*
   * A direct call owns its argument boundaries and recursive call shape. Its
   * components retain the existing Jess value-term contract, including
   * variable-led expressions (documented function arguments); the new slash
   * separator does not make `/` available as bare Jess arithmetic. Dynamic
   * `$[...]` interpolation and named arguments remain outside this slice until
   * they have typed reductions.
   */
    const DirectJessCall = node<FunctionCall>(
      'DirectJessCall',
      sequence(
        not(regex(/url(?=\()/i)),
        g.CssAstSyntaxKeyword,
        literal('('),
        optional(sequence(
          g.DirectJessCallComponent,
          many(g.DirectJessCallArgument)
        )),
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
        return funcCall(
          requireToken(children[0]).value,
          args
        );
      }
    );

    /*
   * Jess collections are value-position maps. The canonical AST already has a
   * dedicated detached-ruleset carrier and the serializer already iterates its
   * declaration names/values for bracket `$for` bindings; lower it directly
   * instead of preserving a CST-shaped collection node or opaque source bytes.
   */
    const DirectJessCollectionEntry = node<Declaration>(
      'DirectJessCollectionEntry',
      sequence(
        g.CssAstSyntaxProperty,
        literal(':'),
        parser(
          { trivia: whitespace },
          g.DirectJessValue
        ),
        optional(literal(';'))
      ),
      (children) => {
        const value = children[2];
        return decl(
          requireToken(children[0]).value,
          Array.isArray(value) ? value : valueSlot(requireValueNode(value))
        );
      }
    );
    const DirectJessCollection = node<Collection>(
      'DirectJessCollection',
      sequence(
        literal('{'),
        parser(
          { trivia: whitespace },
          many(g.DirectJessCollectionEntry)
        ),
        optional(rawWhitespace),
        literal('}')
      ),
      children => collection(children.filter(isDeclaration))
    );

    /*
   * A chained reference is a value-only Jess form. It requires a tail so a
   * plain `$name` retains the existing VariableReference reduction, while the
   * authored chain stays one typed Reference without a post-parse walk.
   */
    const DirectJessReferenceTail = choice(
      node<JessReferenceTail>(
        'DirectJessReferenceDotTail',
        noTrivia(sequence(
          literal('.'),
          jessDollarName
        )),
        (children) => {
          const name = requireToken(children[1]).value;
          return { step: { type: 'DotLookup', name }, src: `.${name}` };
        }
      ),
      node<JessReferenceTail>(
        'DirectJessReferenceBracketTail',
        noTrivia(sequence(
          literal('['),
          choice(
            g.DirectJessVarReference,
            g.DirectJessQuoted,
            regex(/[+-]?\d+(?:\.\d+)?/),
            g.DirectJessKeyword
          ),
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

    /*
   * `(args)` — a CALL step on a variable-held value: `$f(1, 2)`, `$f($b: 2)`.
   * It reuses the mixin argument production verbatim, so a lambda call binds
   * positionally, by name, and against defaults through the ONE binder a named
   * mixin call already uses. It is deliberately NOT folded INTO the shared
   * `DirectJessReferenceTail`, which stays access-only: `$type.*()` must keep
   * reducing through the dedicated `DirectJessGuardCall` mixin-guard syntax
   * instead of collapsing into an ordinary member-call chain. Expression and
   * condition positions opt in to dispatch by listing this tail alongside the
   * access tail (see `DirectJessExpressionAtom`, `DirectJessDollarValue`).
   */
    const DirectJessReferenceCallTail = node<JessReferenceTail>(
      'DirectJessReferenceCallTail',
      noTrivia(sequence(
        literal('('),
        parser(
          { trivia: whitespace },
          optional(sequence(
            g.DirectJessMixinCallArg,
            many(sequence(
              literal(','),
              g.DirectJessMixinCallArg
            ))
          ))
        ),
        optional(rawWhitespace),
        literal(')')
      )),
      (children) => {
        const args = children.filter(isJessMixinCallArgument);
        return {
          step: { type: 'Call', args },
          src: `(${args.map(arg => (arg.name === undefined ? '' : `$${arg.name}: `) + referenceArgSource(arg.value)).join(', ')})`
        };
      }
    );

    /*
   * Left-factored `$`/`$$`+name so the ubiquitous dollar value is parsed ONCE.
   * The leading `DirectJessVarReference` is shared across all four continuations
   * — plain reference, accessor-tail chain, unwrapped `/` slash list, and
   * unwrapped `+ - *` arithmetic — which are disjoint by their next token
   * (`.`/`[` tails, `/` slash, whitespace-flanked operators). Previously each
   * arm re-parsed `$name` (up to four VariableReference builds per plain ref,
   * each allocating a discarded source-spanned node); this reduction preserves
   * every prior AST shape while recognizing the reference exactly once.
   */
    const DirectJessDollarValue = node<ValueNode>(
      'DirectJessDollarValue',
      noTrivia(sequence(
        g.DirectJessVarReference,
        optional(choice(

          /*
         * Slash list: `/` is intentionally not an unwrapped Operation. Preserve
         * the authored value boundary as an explicit slash List; `$( $w / 2 )`
         * is the arithmetic spelling.
         */
          sequence(
            optional(rawWhitespace),
            literal('/'),
            optional(rawWhitespace),
            g.DirectJessValueAtom
          ),

          /*
         * Unwrapped arithmetic. The documented `$var + 1` form folds with the
         * same left-associative product-before-sum grouping as `$(...)`: at
         * least one operator is required (else this is a plain reference), and
         * `*` binds tighter than `+`/`-`.
         */
          choice(
            sequence(
              oneOrMore(sequence(
                jessUnwrappedProductOperator,
                g.DirectJessExpressionAtom
              )),
              many(sequence(
                jessUnwrappedSumOperator,
                g.DirectJessUnwrappedProductRest
              ))
            ),
            sequence(
              many(sequence(
                jessUnwrappedProductOperator,
                g.DirectJessExpressionAtom
              )),
              oneOrMore(sequence(
                jessUnwrappedSumOperator,
                g.DirectJessUnwrappedProductRest
              ))
            )
          ),

          /* Accessor-tail chain (`.name`, `[key]`). */
          oneOrMore(choice(
            g.DirectJessReferenceCallTail,
            g.DirectJessReferenceTail
          ))
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
          return reference(
            base,
            tails.map(tail => tail.step),
            `${base.lookup === 'scoped' ? '$$' : '$'}${base.name}${tails.map(tail => tail.src).join('')}`
          );
        }
        if (rest.some(child => isToken(child) && child.value === '/')) {
          return list(
            [base, requireValueNode(rest.at(-1))],
            '/'
          );
        }

        /*
       * Arithmetic: rebuild the first product (leading reference plus its `*`
       * operators), then fold the whitespace-flanked sum operators over the
       * remaining pre-folded products.
       */
        const firstProduct: unknown[] = [{ value: base, src: expressionSource(base) }];
        let index = 0;
        while (index < rest.length && isToken(rest[index]) && requireToken(rest[index]).value.trim() === '*') {
          firstProduct.push(
            rest[index],
            rest[index + 1]
          );
          index += 2;
        }
        const sumParts: unknown[] = [foldExpression(firstProduct)];
        while (index < rest.length) {
          sumParts.push(
            rest[index],
            rest[index + 1]
          );
          index += 2;
        }
        return requireExpressionFact(foldExpression(sumParts)).value;
      }
    );

    /*
   * A CSS custom-property token is an ordinary component value (`var(--accent)`),
   * not a Jess declaration name. It is not a CSS ident, so it cannot reach the
   * Keyword leaf; give it its own arm just ahead of Keyword, which shares the
   * leading `-` but can never match a second one.
   */
    const DirectJessCustomPropertyValue = node<Keyword>(
      'DirectJessCustomPropertyValue',
      g.CssAstSyntaxCustomProperty,
      children => keyword(requireToken(children[0]).value)
    );

    /*
   * A value-position interpolation may carry an authored literal tail — the unit
   * in `$(20)px`, a suffix in `$[name]-suffix`. That tail is grammar structure
   * (one more Interpolation part), never a re-scan of the interpolation's bytes.
   * Recognizing the `$(`/`$[` head ONCE and folding the optional tail here keeps
   * the plain (tail-free) form a single parse with its existing Interpolation.
   */
    const DirectJessInterpolatedValue = node<Interpolation>(
      'DirectJessInterpolatedValue',
      noTrivia(sequence(
        choice(
          g.DirectJessExpression,
          g.DirectJessDollarInterp
        ),
        many(choice(
          jessInterpolatedValueTail,
          g.DirectJessExpression,
          g.DirectJessDollarInterp
        ))
      )),
      (children) => {
        if (children.length === 1) {
          return requireInterpolation(children[0]);
        }
        const parts: InterpPart[] = [];
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

    /*
   * The three `$`-headed arms (DollarValue `$name`, the `$(`/`$[` interpolation
   * family, and the `$[` accessor inside it) are mutually exclusive on the
   * character after `$`, so their relative order is behaviour-neutral. Plain
   * `$name` references dominate real values, so DollarValue leads the `$` group:
   * parseman tries it first on any `$`, matching references without first
   * entering (and rolling back) the `$(` / `$[` node frames. `$(`/`$[` cost one
   * fast VarReference reject instead.
   * Every value atom EXCEPT a brace-delimited block. A block is self-terminating,
   * which is exactly why it may only ever be a value's FIRST atom: once a value
   * has started, a following `{ … }` would have no unambiguous end for the value
   * that precedes it. Keeping the block out of the continuation set is what makes
   * `$foo: bar { … }` a positioned parse error instead of a silent two-value read.
   */
    const directJessNonBlockValueAtom = choice(
      g.DirectJessDollarValue,
      g.DirectJessExprLambda,
      g.DirectJessInterpolatedValue,
      g.DirectJessSelectorCapture,
      g.DirectJessUrl,
      g.DirectJessInterpolatedUrl,
      g.DirectJessCall,
      g.DirectJessQuoted,
      g.DirectJessColor,
      g.DirectJessDimension,
      g.DirectJessCustomPropertyValue,
      g.DirectJessKeyword
    );
    const DirectJessValueAtom = node<ValueNode>(
      'DirectJessValueAtom',
      choice(
        g.DirectJessCollection,
        directJessNonBlockValueAtom
      ),
      children => requireValueNode(children[0])
    );

    /*
   * The authored space-adjacency run: the value atoms between two slash
   * boundaries, or the whole term when the value carries no slash.
   */
    const DirectJessValueSpaceGroup = node<ValueSlot>(
      'DirectJessValueSpaceGroup',
      noTrivia(sequence(
        g.DirectJessValueAtom,
        many(sequence(
          field(
            'separator',
            regex(/[ \t\n\r\f]+/)
          ),
          directJessNonBlockValueAtom
        ))
      )),
      (children, fields) => {
        const values = children.filter(isValueSlotValue);
        if (values.length === 1) {
          return values[0]!;
        }
        const separators = fields?.separator === undefined
          ? []
          : requireFields(
              fields,
              'separator'
            ).map(separator => typeof separator.value === 'string'
              ? separator.value
              : requireToken(separator.value).value);
        return withValueLayout(
          values,
          separators
        );
      }
    );

    /*
   * `/` is a structural component boundary in plain CSS (`grid-area: 1 / 2`,
   * `font: 12px/1.5 sans-serif`), so it has to be recognized for every value,
   * not only for a `$`-headed left side or a modern function component. This
   * lifts the slash `List` those two already build to the whole value term:
   * each side stays ONE authored space group (flattening it would render
   * `1 / 2 / sans-serif`), and `/` still never becomes unwrapped arithmetic.
   */
    const DirectJessValueTerm = node<ValueSlot>(
      'DirectJessValueTerm',
      noTrivia(sequence(
        g.DirectJessValueSpaceGroup,
        many(sequence(
          jessValueSlashBoundary,
          g.DirectJessValueSpaceGroup
        ))
      )),
      (children) => {
        const groups = children.filter(isValueSlotValue);
        return groups.length === 1
          ? groups[0]!
          : list(
              groups,
              '/'
            );
      }
    );
    const DirectJessValue = node<ValueSlot>(
      'DirectJessValue',
      sequence(
        g.DirectJessValueTerm,
        many(sequence(
          literal(','),
          optional(regex(/[ \t\n\r\f]+/)),
          g.DirectJessValueTerm
        ))
      ),
      (children) => {
        const values = children.filter(isValueSlotValue);
        return values.length === 1
          ? values[0]!
          : list(
              values,
              ','
            );
      }
    );

    /*
   * The static CSS component value: the leaves an authored CSS position admits
   * once every Jess execution form (`$…`, `$[…]`, `$(…)`, arithmetic, lambdas,
   * collections) is excluded. Both static positions — a conditional at-rule
   * header and an `@property` descriptor — take exactly this set, so they share
   * one production instead of drifting two copies apart.
   *
   * A CSS at-rule header must stay structural: a header form Jess does not model
   * is rejected rather than hidden in an Any/raw prelude. Extend this with
   * another typed form when Jess gives that form semantics.
   */
    const DirectJessStaticValueAtom = node<ValueNode>(
      'DirectJessStaticValueAtom',
      choice(
        g.DirectJessUrl,
        g.DirectJessStaticCall,
        g.DirectJessStaticQuoted,
        g.DirectJessColor,
        g.DirectJessDimension,
        g.DirectJessCustomPropertyValue,
        g.DirectJessKeyword
      ),
      children => requireValueNode(children[0])
    );
    const DirectJessStaticValue = node<ValueSlot>(
      'DirectJessStaticValue',
      noTrivia(sequence(
        g.DirectJessStaticValueAtom,
        many(sequence(
          regex(/[ \t\n\r\f]+/),
          g.DirectJessStaticValueAtom
        ))
      )),
      (children) => {
        const values = children.filter(isValueNode);
        return values.length === 1 ? values[0]! : values;
      }
    );
    const DirectJessStaticCallArgument = node<ValueSlot>(
      'DirectJessStaticCallArgument',
      sequence(
        literal(','),
        optional(regex(/[ \t\n\r\f]+/)),
        g.DirectJessStaticValue
      ),
      (children) => {
        const value = children.at(-1);
        return Array.isArray(value) ? value : requireValueSlot(value);
      }
    );

    /*
   * css-syntax-3 §4.3.4: an ident is a function token only when `(` follows it
   * with nothing between, so the name and its opener are one glued shape. That
   * glue is the whole disambiguation this production needs — `screen and (hover)`
   * stays three prelude atoms because the `(` is detached.
   *
   * No function NAME is excluded. Which functions carry meaning in a media
   * feature or an `@property` descriptor is a language-service fact; a parser
   * that rejects `var()` here turns a diagnosable squiggle into a lost file.
   * `url(` needs no exclusion either: the dedicated Url leaf precedes this arm
   * in DirectJessStaticValueAtom and takes it first.
   */
    const DirectJessStaticCall = node<FunctionCall>(
      'DirectJessStaticCall',
      sequence(
        noTrivia(sequence(
          g.CssAstSyntaxKeyword,
          literal('(')
        )),
        optional(sequence(
          g.DirectJessStaticValue,
          many(g.DirectJessStaticCallArgument)
        )),
        literal(')')
      ),
      (children) => {
        if (children.length < 3 || requireToken(children[1]).value !== '(' || requireToken(children.at(-1)).value !== ')') {
          throw new TypeError('Direct Jess static function call lost its call boundaries.');
        }
        return funcCall(
          requireToken(children[0]).value,
          children.slice(
            2,
            -1
          ).filter(isValueSlotValue)
        );
      }
    );

    /*
   * A media/container feature value may be a `<ratio>` — media-queries-4 §2.1,
   * `<number> [ / <number> ]?` — as in `(aspect-ratio: 16/9)`. The static header
   * atoms carry no slash of their own, so the query value takes the ratio tail
   * explicitly and reduces to the same typed Operation the prelude already uses
   * for `:` and the range comparisons. Left-factored on the atom: the no-slash
   * majority takes an absent optional tail instead of a doomed ratio arm.
   */
    const DirectJessStaticAtQueryValue = node<ValueNode>(
      'DirectJessStaticAtQueryValue',
      sequence(
        g.DirectJessStaticValueAtom,
        optional(sequence(
          optional(rawWhitespace),
          literal('/'),
          optional(rawWhitespace),
          g.DirectJessStaticValueAtom
        ))
      ),
      (children) => {
        const values = children.filter(isValueNode);
        const numerator = requireValueNode(values[0]);
        const denominator = values[1];
        return denominator === undefined
          ? numerator
          : operation(
              '/',
              numerator,
              denominator
            );
      }
    );
    const DirectJessStaticAtQueryProperty = node<JessStaticAtQueryProperty>(
      'DirectJessStaticAtQueryProperty',
      g.CssAstSyntaxKeyword,
      children => ({ property: keyword(requireToken(children[0]).value) })
    );
    const DirectJessStaticAtComparisonQuery = node<ValueNode>(
      'DirectJessStaticAtComparisonQuery',
      choice(
        sequence(
          literal('('),
          optional(rawWhitespace),
          DirectJessStaticAtQueryProperty,
          optional(rawWhitespace),
          field(
            'comparison',
            g.CssAstSyntaxQueryComparisonOperator
          ),
          optional(rawWhitespace),
          DirectJessStaticAtQueryValue,
          optional(rawWhitespace),
          literal(')')
        ),
        sequence(
          literal('('),
          optional(rawWhitespace),
          DirectJessStaticAtQueryValue,
          optional(rawWhitespace),
          field(
            'comparison',
            g.CssAstSyntaxQueryComparisonOperator
          ),
          optional(rawWhitespace),
          DirectJessStaticAtQueryProperty,
          optional(sequence(
            optional(rawWhitespace),
            field(
              'comparison',
              g.CssAstSyntaxQueryComparisonOperator
            ),
            optional(rawWhitespace),
            DirectJessStaticAtQueryValue
          )),
          optional(rawWhitespace),
          literal(')')
        )
      ),
      (children, fields) => {
        const propertyFact = children.find((child): child is JessStaticAtQueryProperty => typeof child === 'object' && child !== null && 'property' in child);
        if (propertyFact === undefined) {
          throw new TypeError('Direct Jess static query comparison lost its property.');
        }
        const values = children.filter(isValueNode);

        /*
       * Read the operators back from the shared terminal's captures. Restating the
       * operator set as a runtime filter would be a second, drift-prone copy of a
       * spelling `internal-css-recognition` already owns — and PEG `choice` is
       * ordered, so every hand-maintained copy is a fresh chance to put `<` before
       * `<=` and mis-parse a range without erroring.
       */
        const operators = fields?.comparison === undefined
          ? []
          : requireFields(
              fields,
              'comparison'
            ).map(capture => typeof capture.value === 'string' ? capture.value : requireToken(capture.value).value);
        if (values.length === 0 || operators.length === 0) {
          throw new TypeError('Direct Jess static query comparison lost an operand.');
        }
        const propertyIndex = children.indexOf(propertyFact);
        const firstValueIndex = children.findIndex(isValueNode);
        let result = propertyIndex < firstValueIndex
          ? operation(
              operators[0]!,
              propertyFact.property,
              values[0]!
            )
          : operation(
              operators[0]!,
              values[0]!,
              propertyFact.property
            );
        if (operators.length === 2) {
          const trailing = values.at(-1);
          if (trailing === undefined) {
            throw new TypeError('Direct Jess static query comparison lost its range end.');
          }
          result = operation(
            operators[1]!,
            result,
            trailing
          );
        }
        return block(result);
      }
    );
    const DirectJessStaticAtQuery = node<ValueNode>(
      'DirectJessStaticAtQuery',
      noTrivia(choice(
        DirectJessStaticAtComparisonQuery,
        sequence(
          literal('('),
          optional(rawWhitespace),
          g.CssAstSyntaxKeyword,
          optional(rawWhitespace),
          literal(':'),
          optional(rawWhitespace),
          DirectJessStaticAtQueryValue,
          optional(rawWhitespace),
          literal(')')
        ),
        sequence(
          literal('('),
          optional(rawWhitespace),
          g.CssAstSyntaxKeyword,
          optional(rawWhitespace),
          literal(')')
        )
      )),
      (children) => {
        if (children.length === 1 && isValueNode(children[0])) {
          return requireValueNode(children[0]);
        }
        return reduceColonFeature(
          children,
          'Direct Jess CSS at-rule query lost its property name.'
        );
      }
    );

    /*
   * `only` belongs to the media-type form (`only screen and (...)`), not the
   * parenthesized-condition form. The generic at-rule prelude still shares
   * the same term combinator, but this branch keeps that syntactic boundary.
   */
    const DirectJessStaticAtNonOnlyKeyword = node<Keyword>(
      'DirectJessStaticAtNonOnlyKeyword',
      sequence(
        not(g.CssAstSyntaxQueryOnly),
        g.DirectJessKeyword
      ),
      children => requireKeyword(children.at(-1))
    );

    /*
   * A `<dashed-ident>` header name (`@position-try --foo`, css-anchor-position-1
   * §5.1). The CSS ident leaf admits ONE leading dash, so `-foo` already parsed
   * and only the two-dash spelling was rejected — losing the whole stylesheet
   * over valid CSS. It is the same production as a custom-property name, so it
   * reuses that shared leaf rather than restating the character class; the
   * reduction is the plain `Keyword` less produces for the same header.
   */
    const DirectJessStaticAtDashedIdent = node<Keyword>(
      'DirectJessStaticAtDashedIdent',
      g.CssAstSyntaxCustomProperty,
      children => keyword(requireToken(children[0]).value)
    );
    const DirectJessStaticAtNonOnlyAtom = node<ValueNode>(
      'DirectJessStaticAtNonOnlyAtom',
      choice(
        g.DirectJessStaticAtQuery,
        g.DirectJessStaticAtDashedIdent,
        sequence(
          not(g.CssAstSyntaxQueryOnly),
          g.DirectJessStaticValueAtom
        )
      ),
      children => requireValueNode(children.at(-1))
    );
    const DirectJessStaticAtPreludeTerm = node<ValueNode>(
      'DirectJessStaticAtPreludeTerm',
      noTrivia(sequence(choice(
        sequence(
          g.CssAstSyntaxQueryOnly,
          regex(/[ \t\n\r\f]+/),
          DirectJessStaticAtNonOnlyKeyword,
          many(sequence(
            regex(/[ \t\n\r\f]+/),
            DirectJessStaticAtNonOnlyAtom
          ))
        ),
        sequence(
          DirectJessStaticAtNonOnlyAtom,
          many(sequence(
            regex(/[ \t\n\r\f]+/),
            DirectJessStaticAtNonOnlyAtom
          ))
        )
      ))),
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
        many(sequence(
          literal(','),
          g.DirectJessStaticAtPreludeTerm
        ))
      ),
      (children) => {
        const values = children.filter(isValueNode);
        return values.length === 0
          ? null
          : values.length === 1
            ? values[0]!
            : list(
                values,
                ','
              );
      }
    );

    /*
   * An at-rule prelude is an IDENTIFIER position, so its dynamic form is the
   * same `${…}` every other name position takes — no prelude-local spelling.
   * `$(…)` is a value-position expression and is deliberately not admitted here:
   * its bare-identifier semantics differ from a name splice, which is exactly
   * the confusion one form per position removes.
   */
    const DirectJessMediaPrelude = node<ValueNode | null>(
      'DirectJessMediaPrelude',
      choice(
        g.DirectJessDollarBrace,
        g.DirectJessStaticAtPrelude
      ),
      children => children[0] === null ? null : requireValueNode(children[0])
    );

    /*
   * Statement headers remain fully static. The documented deferred media form
   * is a block-only construct, so it cannot silently become `@media $(x);`.
   * Every arm leads with a concrete `@`-first recognizer (no leading `not(...)`),
   * so the whole header — and the `DirectJessAtRuleStatement`/`AtRuleBlock` that
   * wrap it — keeps a `{@}` first-set. That lets parseman fast-reject non-`@`
   * statements at the leading char instead of entering this node frame and
   * running the media/container lookaheads at every rule. The former arm-2
   * `not(@media)` / `not(@container only)` guards are folded into the dedicated
   * media/container arms plus the `media`/`container` exclusion in
   * `jessGenericCssAtRuleName`, preserving the exact accept/reject set.
   */
    const DirectJessStaticAtRuleHeader = node<JessAtRuleHeader>(
      'DirectJessStaticAtRuleHeader',
      choice(
        sequence(
          g.CssAstSyntaxMediaAtKeyword,
          not(choice(
            literal('{'),
            literal(';')
          )),
          g.DirectJessStaticAtPrelude
        ),
        sequence(
          g.CssAstSyntaxContainerAtKeyword,
          not(g.CssAstSyntaxQueryOnly),
          g.DirectJessStaticAtPrelude
        ),
        sequence(
          jessGenericCssAtRuleName,
          g.DirectJessStaticAtPrelude
        )
      ),
      (children) => {
        const name = requireToken(children.find(isToken)!).value;
        const prelude = children.find(isValueNode) ?? null;
        return { name, prelude };
      }
    );

    /*
   * Keep the dynamic extension scoped to documented block `@media $(…)`.
   * Every other header, including `@container`, stays on the static grammar;
   * mixing the deferred form with query terms remains rejected.
   */
    const DirectJessAtRuleHeader = node<JessAtRuleHeader>(
      'DirectJessAtRuleHeader',
      choice(
        sequence(
          g.CssAstSyntaxMediaAtKeyword,
          not(literal('{')),
          g.DirectJessMediaPrelude
        ),
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

    /*
   * `@supports` is not a generic CSS header: its condition grammar owns every
   * parenthesis and logical connective.  Keep this deliberately static until a
   * typed model exists for general-enclosed forms such as `selector(...)`.
   * In particular, do not hide their arguments in Any/raw header bytes.
   * A supported declaration's value is the same static CSS component value a
   * media feature takes — `@supports (width: min(1px, 2px))` and
   * `@supports (background: url(a.png))` are ordinary CSS. A third private copy
   * of the leaf set is what let those degrade to opaque GeneralEnclosed text.
   */
    const DirectJessSupportsAtom = node<ValueNode>(
      'DirectJessSupportsAtom',
      g.DirectJessStaticValueAtom,
      children => requireValueNode(children[0])
    );

    /*
   * ── `@supports` general-enclosed template: TWO chains, one per position ──────
   * The general-enclosed body is an INTERPOLATED position, and every interpolated
   * position takes `${…}` only — `$(…)` is a value-position EXPRESSION, not
   * interpolation, so it is rejected here (HANDOFF.md: general-enclosed content
   * admits literal structured bytes plus the dialect's explicit interpolation
   * syntax). A QUOTED sub-template is a different position — an ordinary Jess
   * string, which the matrix does permit `$(…)` in, exactly as `Quoted` does
   * everywhere else in the language.
   *
   * Those two positions are entry-disjoint but they RECURSE, which is why this is
   * two mirrored chains rather than one production with a flag: once inside a
   * string you stay inside it, so a `(…)` group nested in a quoted sub-template is
   * still string content and must stay permissive. Rejecting `$(…)` only at the
   * top level would mean an extra paren unlocks the spelling
   * (`@supports foo($(x))` rejected but `@supports foo(($(x)))` accepted), so the
   * strict chain mirrors ALL its non-quoted wrappers and the permissive chain
   * mirrors all five of its own.
   *
   * The duplication is deliberate and required: grammar dedup here admits only
   * parameterless combinator consts and plain reducers, and a factory would
   * degrade the macro-compiled artifact into the interpreter. The ONLY difference
   * between the two chains is the `g.DirectJessExpression` arm.
   */

    /*
   * STRICT chain — the general-enclosed body and its non-quoted wrappers. Its
   * quoted arms hand off to the permissive chain below and never come back.
   */
    const DirectJessGeneralTemplateParen = node<Interpolation>(
      'DirectJessGeneralTemplateParen',
      sequence(
        literal('('),
        g.DirectJessGeneralTemplate,
        literal(')')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralTemplateSquare = node<Interpolation>(
      'DirectJessGeneralTemplateSquare',
      sequence(
        literal('['),
        g.DirectJessGeneralTemplate,
        literal(']')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralTemplateBrace = node<Interpolation>(
      'DirectJessGeneralTemplateBrace',
      sequence(
        literal('{'),
        g.DirectJessGeneralTemplate,
        literal('}')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralTemplateDoubleQuoted = node<Interpolation>(
      'DirectJessGeneralTemplateDoubleQuoted',
      sequence(
        literal('"'),
        g.DirectJessGeneralQuotedTemplate,
        literal('"')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralTemplateSingleQuoted = node<Interpolation>(
      'DirectJessGeneralTemplateSingleQuoted',
      sequence(
        literal('\''),
        g.DirectJessGeneralQuotedTemplate,
        literal('\'')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralTemplate = node<Interpolation>(
      'DirectJessGeneralTemplate',
      many(choice(
        g.DirectJessDollarBrace,
        g.DirectJessGeneralTemplateParen,
        g.DirectJessGeneralTemplateSquare,
        g.DirectJessGeneralTemplateBrace,
        g.DirectJessGeneralTemplateDoubleQuoted,
        g.DirectJessGeneralTemplateSingleQuoted,
        jessGeneralTemplateText
      )),
      templateInterpolationFromChildren
    );

    /*
   * PERMISSIVE chain — everything reachable from inside a quoted sub-template.
   * Reached ONLY through the two quoted arms above, and closed under its own
   * wrappers so nesting never escapes back to the strict chain.
   */
    const DirectJessGeneralQuotedTemplateParen = node<Interpolation>(
      'DirectJessGeneralQuotedTemplateParen',
      sequence(
        literal('('),
        g.DirectJessGeneralQuotedTemplate,
        literal(')')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralQuotedTemplateSquare = node<Interpolation>(
      'DirectJessGeneralQuotedTemplateSquare',
      sequence(
        literal('['),
        g.DirectJessGeneralQuotedTemplate,
        literal(']')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralQuotedTemplateBrace = node<Interpolation>(
      'DirectJessGeneralQuotedTemplateBrace',
      sequence(
        literal('{'),
        g.DirectJessGeneralQuotedTemplate,
        literal('}')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralQuotedTemplateDoubleQuoted = node<Interpolation>(
      'DirectJessGeneralQuotedTemplateDoubleQuoted',
      sequence(
        literal('"'),
        g.DirectJessGeneralQuotedTemplate,
        literal('"')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralQuotedTemplateSingleQuoted = node<Interpolation>(
      'DirectJessGeneralQuotedTemplateSingleQuoted',
      sequence(
        literal('\''),
        g.DirectJessGeneralQuotedTemplate,
        literal('\'')
      ),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralQuotedTemplate = node<Interpolation>(
      'DirectJessGeneralQuotedTemplate',
      many(choice(
        g.DirectJessDollarBrace,
        g.DirectJessExpression,
        g.DirectJessGeneralQuotedTemplateParen,
        g.DirectJessGeneralQuotedTemplateSquare,
        g.DirectJessGeneralQuotedTemplateBrace,
        g.DirectJessGeneralQuotedTemplateDoubleQuoted,
        g.DirectJessGeneralQuotedTemplateSingleQuoted,
        jessGeneralTemplateText
      )),
      templateInterpolationFromChildren
    );
    const DirectJessGeneralEnclosed = node<GeneralEnclosed>(
      'DirectJessGeneralEnclosed',
      choice(
        sequence(
          g.CssAstSyntaxKeyword,
          literal('('),
          g.DirectJessGeneralTemplate,
          literal(')')
        ),
        sequence(
          literal('('),
          g.DirectJessGeneralTemplate,
          literal(')')
        )
      ),
      children => children.length === 4
        ? generalEnclosed(
            'function',
            requireToken(children[0]).value,
            requireInterpolation(children[2])
          )
        : generalEnclosed(
            'paren',
            null,
            requireInterpolation(children[1])
          )
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
        sequence(
          literal('('),
          optional(rawWhitespace),
          g.CssAstSyntaxKeyword,
          optional(rawWhitespace),
          literal(':'),
          optional(rawWhitespace),
          g.DirectJessSupportsAtom,
          optional(rawWhitespace),
          literal(')')
        ),
        sequence(
          literal('('),
          optional(rawWhitespace),
          g.CssAstSyntaxKeyword,
          optional(rawWhitespace),
          literal(')')
        )
      )),
      children => reduceColonFeature(
        children,
        'Direct Jess supports feature lost its property name.'
      )
    );
    const DirectJessSupportsInParens = node<ValueNode>(
      'DirectJessSupportsInParens',
      choice(
        sequence(
          literal('('),
          g.DirectJessSupportsCondition,
          literal(')')
        ),
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
        sequence(
          g.DirectJessSupportsNot,
          g.DirectJessSupportsInParens
        ),
        sequence(
          g.DirectJessSupportsInParens,
          many(sequence(
            g.DirectJessSupportsLogical,
            g.DirectJessSupportsInParens
          ))
        )
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
      sequence(
        jessCharsetAtRuleName,
        g.DirectJessStaticQuoted,
        literal(';')
      ),
      children => atRuleStatement(
        requireToken(children[0]).value,
        requireStaticQuoted(children[1])
      )
    );
    const DirectJessCssImportTarget = node<Quoted | Url>(
      'DirectJessCssImportTarget',
      choice(
        g.DirectJessStaticQuoted,
        sequence(
          g.CssAstSyntaxUrlOpen,
          literal(')')
        ),
        sequence(
          g.CssAstSyntaxUrlOpen,
          choice(
            g.DirectJessQuoted,
            g.DirectJessUrlInterpolatedValue,
            g.CssAstSyntaxStaticUrlInner
          ),
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

    /*
   * The two functional `@import` conditions — `supports(<condition>)` and
   * `layer(<layer-name>)`, css-cascade-5 §2.1. Neither is an ordinary media
   * query term, so the static prelude term could not recognize either and a
   * conditional import lost the whole stylesheet. `supports(...)` reuses the
   * typed `@supports` condition this grammar already owns rather than restating
   * it, and both reduce to the `FunctionCall` scss produces for the same tail.
   * Kept local to the import tail: the general at-rule value grammar is not
   * widened, so no other header gains a function-call spelling here.
   */
    const DirectJessImportTailFunction = node<FunctionCall>(
      'DirectJessImportTailFunction',
      choice(

        /*
       * `<supports-condition>` already owns its own parentheses, so the
       * `supports(` opener IS the condition's leading paren — no second pair.
       */
        sequence(
          regex(/supports(?=\()/i),
          g.DirectJessSupportsCondition
        ),
        sequence(
          regex(/layer(?=\()/i),
          literal('('),
          g.DirectJessKeyword,
          literal(')')
        )
      ),
      children => funcCall(
        requireToken(children[0]).value,
        [requireValueNode(children.find(isValueNode))]
      )
    );
    const DirectJessCssImportPrelude = node<ValueNode>(
      'DirectJessCssImportPrelude',
      noTrivia(sequence(
        g.DirectJessCssImportTarget,
        many(sequence(
          regex(/[ \t\n\r\f]+/),
          choice(
            g.DirectJessImportTailFunction,
            g.DirectJessStaticAtPreludeTerm
          )
        ))
      )),
      (children) => {
        const values = children.filter(isValueNode);
        return values.length === 1 ? values[0]! : spaced(values);
      }
    );
    const DirectJessCssImport = node<AtRuleStatement>(
      'DirectJessCssImport',
      sequence(
        jessImportAtRuleName,
        g.DirectJessCssImportPrelude,
        literal(';')
      ),
      children => atRuleStatement(
        requireToken(children[0]).value,
        requireValueNode(children[1])
      )
    );

    /*
   * Shared block-body statement set for the at-rule-bearing blocks (`@supports`,
   * generic at-rules): identical 16-rule choice plus a bare `;` arm. Mirrors the
   * less-parser `directLessBlockStatement` const so the macro fuses a single
   * shared choice instead of re-emitting it per block.
   *
   * The `@`-headed cluster is placed AFTER DirectJessRule: a rule requires a
   * selector (never `@`) and every at-rule requires `@`, so the two are disjoint
   * and this ordering is behaviour-neutral. Because rules dominate block bodies,
   * trying Rule first means a non-`@` statement never enters (and rolls back) the
   * at-rule recognizers — only genuine `@` statements reach the cluster.
   */
    const directJessAtBlockStatement = choice(
      g.DirectJessComment,
      g.DirectJessMixinCall,
      g.DirectJessValueBlockDeclaration,
      g.DirectJessVarDeclaration,
      g.DirectJessDeclaration,
      g.DirectJessMixinDef,
      g.DirectJessReferenceCall,
      g.DirectJessApply,
      g.DirectJessExtend,
      g.DirectJessFor,
      g.DirectJessIf,
      g.DirectJessRule,
      g.DirectJessSupportsAtRuleBlock,
      g.DirectJessKeyframes,
      g.DirectJessOpaqueAtRuleBlock,
      g.DirectJessScopeBlock,
      g.DirectJessAtRuleBlock,
      g.DirectJessAtRuleStatement,
      literal(';')
    );

    /*
   * Shared nested-scope statement set for `$mixin`/`$for`/`$if` bodies: identical
   * 15-rule choice with no bare `;` or `$extend` arm.
   */
    const directJessNestedBodyStatement = choice(
      literal(';'),
      g.DirectJessComment,
      g.DirectJessMixinCall,
      g.DirectJessValueBlockDeclaration,
      g.DirectJessVarDeclaration,
      g.DirectJessDeclaration,
      g.DirectJessMixinDef,
      g.DirectJessFor,
      g.DirectJessIf,
      g.DirectJessReferenceCall,
      g.DirectJessApply,
      g.DirectJessRule,
      g.DirectJessSupportsAtRuleBlock,
      g.DirectJessKeyframes,
      g.DirectJessOpaqueAtRuleBlock,
      g.DirectJessScopeBlock,
      g.DirectJessAtRuleBlock,
      g.DirectJessAtRuleStatement
    );
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
        collectBlockStatements(
          children,
          3
        )
      )
    );

    /*
   * `@property` headers name a CSS custom property, not an ordinary at-rule
   * prelude. Retaining the contiguous `--` prefix as grammar structure blocks
   * a dynamic or malformed header from falling through the generic at-rule arm.
   */
    const DirectJessPropertyName = node<Keyword>(
      'DirectJessPropertyName',
      noTrivia(sequence(
        literal('--'),
        g.CssAstSyntaxKeyword
      )),
      children => keyword(`${requireToken(children[0]).value}${requireToken(children[1]).value}`)
    );

    /*
   * Registered-property descriptors are authored CSS component values, but they
   * are not Jess value positions: they take the shared static component value
   * above, never DirectJessValue (which admits variable references,
   * interpolation, arithmetic, and collections) and never Any/raw source.
   */
    const DirectJessStaticPropertyDescriptor = node<Declaration>(
      'DirectJessStaticPropertyDescriptor',
      sequence(
        g.CssAstSyntaxProperty,
        literal(':'),
        g.DirectJessStaticValue,
        literal(';')
      ),
      (children) => {
        const value = children[2];
        return decl(
          requireToken(children[0]).value,
          Array.isArray(value) ? value : valueSlot(requireValueNode(value))
        );
      }
    );
    const DirectJessPropertyAtRule = node<AtRuleBlock>(
      'DirectJessPropertyAtRule',
      sequence(
        jessPropertyAtRuleName,
        g.DirectJessPropertyName,
        literal('{'),
        many(choice(
          g.DirectJessComment,
          g.DirectJessStaticPropertyDescriptor
        )),
        literal('}')
      ),
      children => atRuleBlock(
        requireToken(children[0]).value,
        requireKeyword(children[1]),
        requireStatements(children.slice(
          3,
          -1
        ))
      )
    );

    /*
   * Keyframes already fit the canonical AtRuleBlock + Rule model.  Keep the
   * header and selector boundary static until Jess has typed interpolation for
   * those positions; never turn either into a source-text prelude.
   */
    const DirectJessKeyframeSelector = node<SimpleSelector>(
      'DirectJessKeyframeSelector',
      choice(
        jessKeyframeEndpoint,
        jessKeyframePercent
      ),
      children => simpleSelector(requireToken(children[0]).value)
    );
    const DirectJessKeyframeBlock = node<Rule>(
      'DirectJessKeyframeBlock',
      sequence(
        g.DirectJessKeyframeSelector,
        many(sequence(
          many(g.DirectJessComment),
          literal(','),
          many(g.DirectJessComment),
          g.DirectJessKeyframeSelector
        )),
        many(g.DirectJessComment),
        literal('{'),
        many(choice(
          g.DirectJessComment,
          g.DirectJessDeclaration,
          literal(';')
        )),
        literal('}')
      ),
      (children) => {
        const selectors = children.filter((child): child is SimpleSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'SimpleSelector')
          .map(selector => complexSelector([{ compound: compoundSelectorOf([selector]) }]));
        const bodyOpen = children.findIndex(child => isToken(child) && child.value === '{');
        if (bodyOpen < 0) {
          throw new TypeError('Direct Jess keyframe block lost its body boundary.');
        }
        return rule(
          selist(...selectors),
          requireStatements(children.slice(
            bodyOpen + 1,
            -1
          ).filter(child => isComment(child) || isDeclaration(child)))
        );
      }
    );
    const DirectJessKeyframes = node<AtRuleBlock>(
      'DirectJessKeyframes',
      sequence(
        g.CssAstSyntaxKeyframesAtKeyword,
        choice(
          g.DirectJessKeyword,
          g.DirectJessStaticQuoted
        ),
        literal('{'),
        many(choice(
          g.DirectJessComment,
          g.DirectJessKeyframeBlock
        )),
        literal('}')
      ),
      children => atRuleBlock(
        requireToken(children[0]).value,
        requireValueNode(children[1]),
        requireStatements(children.slice(
          3,
          -1
        ))
      )
    );

    /*
   * The `$name` + assignment-operator head shared by the ordinary and the
   * block-valued variable declaration. Both reduce with `reduceVarDeclaration`,
   * which reads the operator by position, so the head must stay one shape.
   */
    const directJessAssignHead = choice(
      noTrivia(sequence(
        literal('$'),
        literal('$'),
        jessDollarName,
        literal('?:')
      )),
      noTrivia(sequence(
        literal('$'),
        jessDollarName,
        literal('?:')
      )),
      sequence(
        noTrivia(sequence(
          literal('$'),
          literal('$'),
          jessDollarName
        )),
        choice(
          literal(':='),
          literal(':')
        )
      ),
      sequence(
        noTrivia(sequence(
          literal('$'),
          jessDollarName
        )),
        choice(
          literal(':='),
          literal(':')
        )
      )
    );

    /*
   * A variable assignment IS a declaration, so `;` separates it from the next
   * declaration rather than terminating it (css-syntax-3 §5.4.7) — exactly the
   * rule `DirectJessDeclaration` already follows. The last declaration in a list
   * needs no `;`, so the terminator is optional here too; there is no separate
   * "variable assignment" termination category.
   */
    const DirectJessVarDeclaration = node<VariableDeclaration>(
      'DirectJessVarDeclaration',
      sequence(
        directJessAssignHead,
        g.DirectJessValue,
        optional(literal(';'))
      ),
      reduceVarDeclaration
    );

    /*
   * A block-valued assignment AUTO-TERMINATES at its closing brace: the block is
   * its own unambiguous end, so `$foo: { … }`, `$foo: @{ … }`, and
   * `$foo: @() > { … }` need no `;` and whatever follows the brace begins a new
   * statement. Less has the same rule for a detached ruleset bound to a variable.
   * The block must be the WHOLE value — a value can never precede it (there is no
   * `DirectJessValueBlock` arm in the space-group continuation), because that is
   * exactly the case where the value's end would be ambiguous. Compose instead:
   * bind the block first (`$foo: {}`), then use it (`$bar: $foo bar;`).
   */
    const DirectJessValueBlockDeclaration = node<VariableDeclaration>(
      'DirectJessValueBlockDeclaration',
      sequence(
        directJessAssignHead,
        g.DirectJessValueBlock,
        optional(literal(';'))
      ),
      reduceVarDeclaration
    );

    /*
   * Priority is a Declaration field in the canonical AST, so this is ordinary
   * direct grammar construction rather than a Jess-specific compatibility path.
   */
    const DirectJessImportant = node<true>(
      'DirectJessImportant',

      /*
     * Jess accepts both CSS block comments and its own `//` comments between
     * the declaration value, priority marker, priority name, and semicolon.
     * They are component-value trivia here, not standalone Comment statements.
     */
      sequence(
        many(choice(
          blockComment,
          lineComment
        )),
        literal('!'),
        many(choice(
          blockComment,
          lineComment
        )),
        g.CssAstSyntaxImportant,
        many(choice(
          blockComment,
          lineComment
        ))
      ),
      (children) => {
        const marker = children.find((child): child is Token => isToken(child) && child.value === '!');
        if (marker === undefined) {
          throw new TypeError('Direct Jess AST grammar lost its declaration-priority marker.');
        }
        requireExactToken(
          marker,
          '!'
        );
        return true;
      }
    );

    /*
   * A property interpolation is an existing Declaration.name Interpolation, never a
   * raw name string. Static identifier segments come from shared CSS syntax;
   * Jess owns only its `$[…]` segment grammar and direct AST reduction.
   * Cheap superset lookahead so an ordinary `color: …` declaration does not
   * enter the interpolated-property arm, consume the whole property name via
   * the optional literal start, fail the required interpolation, and backtrack a
   * property re-parse through CssAstSyntaxProperty. Skip this arm unless a
   * `$[` or `${` actually precedes the next `:`/`;`/brace. A property name never
   * contains `:`, `;`, `{`, or `}`, so the predicate is a strict superset: a
   * real interpolated property is never skipped.
   */
    const directInterpPropertyAhead = not(not(regex(/[^{};:]*\$[[{]/)));
    const DirectJessInterpolatedProperty = node<Interpolation>(
      'DirectJessInterpolatedProperty',
      noTrivia(sequence(
        directInterpPropertyAhead,
        optional(g.CssAstSyntaxInterpolatedPropertyStart),
        g.DirectJessDollarBrace,
        many(choice(
          g.CssAstSyntaxInterpolatedPropertyTail,
          g.DirectJessDollarBrace
        ))
      )),
      (children) => {
        const parts: Interpolation['parts'] = [];
        for (const child of children) {
          if (isInterpolation(child)) {
            parts.push(...child.parts);
          } else {
          /*
           * The superset lookahead emits a throwaway match token (`…$[`). Real
           * property-name chunks never contain `$`, so this content check drops
           * only that throwaway, independent of its position.
           */
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

    /*
   * A custom property is plain CSS in every dialect, so Jess composes the same
   * recognition the CSS base does rather than routing `--x` through the ordinary
   * property terminal (a CSS ident, which cannot start with `--`). The name is
   * the custom-property leaf, or that leaf's `--` prefix followed by `$[…]`
   * segments.
   */
    const DirectJessCustomPropertyName = node<string | Interpolation>(
      'DirectJessCustomPropertyName',
      choice(
        noTrivia(sequence(
          literal('--'),
          many(jessCustomPropertyChunk),
          g.DirectJessDollarBrace,
          many(choice(
            jessCustomPropertyChunk,
            g.DirectJessDollarBrace
          ))
        )),
        g.CssAstSyntaxCustomProperty
      ),
      (children) => {
        if (!children.some(isInterpolation)) {
          return requireToken(children[0]).value;
        }
        const parts: Interpolation['parts'] = [];
        appendCustomValueParts(
          children,
          parts,
          { interpolated: false }
        );
        return interpolation(parts);
      }
    );

    /*
   * The value is a CSS `<declaration-value>`: an almost-arbitrary token stream
   * whose only structure is balanced groups, strings, comments — and, in Jess,
   * `$[…]`. A custom-property value is never evaluated, so every other byte
   * stays literal text: a bare `$name` is authored CSS here, not a variable
   * reference. Delimiters recurse as grammar children rather than being captured
   * as one opaque span, so an inner `;` or `}` cannot end the declaration.
   */
    const DirectJessCustomParen = node<readonly unknown[]>(
      'DirectJessCustomParen',
      noTrivia(sequence(
        literal('('),
        many(g.DirectJessCustomInnerPart),
        literal(')')
      )),
      children => children.slice()
    );
    const DirectJessCustomSquare = node<readonly unknown[]>(
      'DirectJessCustomSquare',
      noTrivia(sequence(
        literal('['),
        many(g.DirectJessCustomInnerPart),
        literal(']')
      )),
      children => children.slice()
    );
    const DirectJessCustomCurly = node<readonly unknown[]>(
      'DirectJessCustomCurly',
      noTrivia(sequence(
        literal('{'),
        many(g.DirectJessCustomInnerPart),
        literal('}')
      )),
      children => children.slice()
    );
    const DirectJessCustomInnerPart: Combinator<unknown> = choice(
      g.DirectJessDollarBrace,
      g.CssAstSyntaxCustomInnerContent,
      blockComment,
      g.CssAstSyntaxCustomSingleQuoted,
      g.CssAstSyntaxCustomDoubleQuoted,
      g.DirectJessCustomParen,
      g.DirectJessCustomSquare,
      g.DirectJessCustomCurly
    );
    const DirectJessCustomPart: Combinator<unknown> = choice(
      g.DirectJessDollarBrace,
      g.CssAstSyntaxCustomOuterContent,
      blockComment,
      g.CssAstSyntaxCustomSingleQuoted,
      g.CssAstSyntaxCustomDoubleQuoted,
      g.DirectJessCustomParen,
      g.DirectJessCustomSquare,
      g.DirectJessCustomCurly
    );
    const DirectJessCustomValue = node<ValueNode>(
      'DirectJessCustomValue',
      noTrivia(many(g.DirectJessCustomPart)),
      children => customValueFromChildren(children)
    );
    const DirectJessCustomDeclaration = node<Declaration>(
      'DirectJessCustomDeclaration',

      /*
     * A trailing `!important` is declaration priority, not value text: css-syntax-3
     * §5.5.6 strips it before the custom-property original-text step. The shared
     * value leaf already stops before the marker (and before the whitespace
     * preceding it), so this tail simply claims it, exactly like the ordinary
     * declaration tail below.
     */
      sequence(
        g.DirectJessCustomPropertyName,
        literal(':'),
        g.DirectJessCustomValue,
        optional(g.DirectJessImportant),
        optional(literal(';'))
      ),
      (children) => {
        const name = children[0];
        if (typeof name !== 'string' && !isInterpolation(name)) {
          throw new TypeError('Direct Jess AST grammar produced a custom declaration without a name.');
        }

        /*
       * An interpolated custom-property name is itself a ValueNode, so read the
       * value from its fixed position after the colon rather than by shape.
       */
        const value = children[2];
        if (!isValueNode(value)) {
          throw new TypeError('Direct Jess AST grammar produced an incomplete custom declaration.');
        }
        return decl(
          name,
          valueSlot(value),
          null,
          children.includes(true)
        );
      }
    );
    const DirectJessDeclaration = node<Declaration>(
      'DirectJessDeclaration',
      choice(
        g.DirectJessCustomDeclaration,
        sequence(
          choice(
            DirectJessInterpolatedProperty,
            g.CssAstSyntaxProperty
          ),
          literal(':'),
          g.DirectJessValue,
          optional(g.DirectJessImportant),
          optional(literal(';'))
        )
      ),
      (children) => {
      /*
       * The custom-property arm is a single completed Declaration child; pass it
       * through so every body that admits a declaration admits a custom property
       * without respelling the arm at each site.
       */
        const custom = children[0];
        if (children.length === 1 && isDeclaration(custom)) {
          return custom;
        }
        return decl(
          isToken(children[0]) ? requireToken(children[0]).value : requireInterpolation(children[0]),
          requireValueSlot(children[2]),
          null,
          children.includes(true)
        );
      }
    );

    /*
   * `@scope (<scope-start>) [to (<scope-end>)]` — css-cascade-6 §3. Its prelude is
   * a pair of SELECTOR lists in parens, not a media-style feature query, so the
   * generic static header (whose parenthesized form is `(<ident>)`/`(<ident>:
   * <value>)`) cannot recognize it and the whole stylesheet was lost. css and
   * scss both carry this prelude as one verbatim `Any` and keep the ordinary
   * declaration-list body; Jess reduces to the byte-identical shape by reusing
   * the shared static prelude capture — which stops at a top-level `$`, so a
   * dynamic `@scope ($sel)` still rejects instead of being hidden in raw bytes.
   * Ordered ahead of `DirectJessAtRuleBlock`, whose generic name also admits
   * `@scope`; the statement form (`@scope;`) has no `{` and still falls through.
   */
    const DirectJessScopeBlock = node<AtRuleBlock>(
      'DirectJessScopeBlock',
      sequence(
        jessScopeAtRuleName,
        noTrivia(sequence(
          g.DirectJessOpaquePrelude,
          literal('{')
        )),
        many(directJessAtBlockStatement),
        literal('}')
      ),
      (children) => {
        const prelude = children[1];
        if (prelude !== null && typeof prelude !== 'string') {
          throw new TypeError('Direct Jess scope at-rule lost its grammar-owned prelude.');
        }
        return atRuleBlock(
          requireToken(children[0]).value,
          prelude === null ? null : any(prelude),
          collectBlockStatements(
            children,
            2
          )
        );
      }
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
        collectBlockStatements(
          children,
          2
        )
      )
    );
    const DirectJessAtRuleStatement = node<AtRuleStatement>(
      'DirectJessAtRuleStatement',
      sequence(
        g.DirectJessStaticAtRuleHeader,
        literal(';')
      ),
      (children) => {
        const header = requireJessAtRuleHeader(children[0]);
        return atRuleStatement(
          header.name,
          header.prelude
        );
      }
    );

    /*
   * An unknown CSS block is terminal authored syntax. Its shared recognition
   * artifact owns every balanced/string/comment boundary; the Jess reduction
   * only records raw facts and keeps `$` out of an unquoted dynamic header.
   * Wrap the two raw captures in their own nodes so this family's child count is
   * fixed: `JessAstOpaqueStaticPrelude` is an `optional(scanTo(...))` that emits
   * NO child when the prelude is empty, which shifted every positional index
   * below by one and silently reduced `@foo { … }` to `prelude: '{'` /
   * `rawBody: '}'`. A node always emits exactly one child. Mirrors the
   * `DirectScssOpaquePrelude`/`DirectScssOpaqueBody` and css `CssAstOpaqueAtPrelude`/
   * `CssAstOpaqueBody` spellings.
   */
    const DirectJessOpaquePrelude = node<string | null>(
      'DirectJessOpaquePrelude',
      g.JessAstOpaqueStaticPrelude,
      (children) => {
        const text = children.length === 0 ? '' : requireToken(children[0]).value.trim();
        return text === '' ? null : text;
      }
    );
    const DirectJessOpaqueBody = node<string>(
      'DirectJessOpaqueBody',
      g.JessAstOpaqueBody,
      children => children.length === 0 ? '' : requireToken(children[0]).value
    );
    const DirectJessOpaqueAtRuleBlock = node<OpaqueAtRuleBlock>(
      'DirectJessOpaqueAtRuleBlock',
      sequence(
        not(jessCompilerAtRuleName),
        g.CssAstSyntaxGenericAtRuleName,
        noTrivia(sequence(
          g.DirectJessOpaquePrelude,
          literal('{'),
          g.DirectJessOpaqueBody,
          literal('}')
        ))
      ),
      (children) => {
        const prelude = children[1];
        const rawBody = children[3];
        if ((prelude !== null && typeof prelude !== 'string') || typeof rawBody !== 'string') {
          throw new TypeError('Direct Jess opaque at-rule lost its grammar-owned raw facts.');
        }
        return opaqueAtRuleBlock(
          requireToken(children[0]).value,
          prelude,
          rawBody
        );
      }
    );

    /*
   * Jess shares the core MixinDef/MixinCall model with the other dialects, but
   * owns its `$ >` invocation spelling and Less/Sass-style names here. Guards
   * and selector interpolation remain separate typed families; named arguments
   * already have the canonical CallArg fact and reduce directly to it.
   */
    const directJessMixinName = regex(/[.#]?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
    const DirectJessMixinParam = node<Param>(
      'DirectJessMixinParam',
      sequence(
        literal('$'),
        jessDollarName,
        optional(sequence(
          literal(':'),
          g.DirectJessValueTerm
        ))
      ),
      (children) => {
        const defaultValue = children.find(isValueNode);
        return defaultValue === undefined
          ? { name: requireToken(children[1]).value }
          : { name: requireToken(children[1]).value, default: defaultValue };
      }
    );
    const DirectJessMixinParams = node<Param[]>(
      'DirectJessMixinParams',
      sequence(
        literal('('),
        optional(sequence(
          g.DirectJessMixinParam,
          many(sequence(
            literal(','),
            g.DirectJessMixinParam
          ))
        )),
        literal(')')
      ),
      children => children.filter((child): child is Param => typeof child === 'object' && child !== null && !('type' in child) && 'name' in child)
    );
    const DirectJessMixinCallArg = node<JessMixinCallArgument>(
      'DirectJessMixinCallArg',
      choice(
        sequence(
          literal('$'),
          jessDollarName,
          literal(':'),
          g.DirectJessValueTerm
        ),
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
        literal('$'),
        literal('>'),
        directJessMixinName,
        many(sequence(
          literal('>'),
          directJessMixinName
        )),
        literal('('),
        optional(sequence(
          g.DirectJessMixinCallArg,
          many(sequence(
            literal(','),
            g.DirectJessMixinCallArg
          ))
        )),
        literal(')'),
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
        const call = mixinCall(
          name,
          args
        );
        return names.length === 1
          ? call
          : { ...call, path: names.slice(
              0,
              -1
            ).map(sel => ({ comb: '>' as const, sel })) };
      }
    );

    /*
   * A variable-held callable has an explicit target and empty argument array.
   * Argument-bearing syntax remains intentionally closed in the Jess grammar.
   */
    const DirectJessReferenceCall = node<Reference>(
      'DirectJessReferenceCall',
      sequence(
        literal('$'),
        jessDollarName,
        literal('('),
        literal(')'),
        optional(literal(';'))
      ),
      (children) => {
        const name = requireToken(children[1]).value;
        return reference(
          variableReference(
            name,
            'live'
          ),
          [{ type: 'Call', args: [] }],
          `$${name}()`
        );
      }
    );
    const DirectJessMixinDef = node<MixinDef>(
      'DirectJessMixinDef',
      sequence(
        directJessMixinName,
        g.DirectJessMixinParams,
        optional(sequence(
          regex(/when(?![-_a-zA-Z0-9\u0080-\uffff])/),
          literal('('),
          g.DirectJessMixinGuard,
          literal(')')
        )),
        literal('{'),
        many(directJessNestedBodyStatement),
        literal('}')
      ),
      (children) => {
        const bodyOpen = children.findIndex(child =>
          isToken(child) && child.value === '{');
        if (bodyOpen < 0) {
          throw new TypeError('Direct Jess AST grammar produced a mixin definition without a body.');
        }
        return mixinDef(
          requireToken(children[0]).value,
          children.find(Array.isArray) as Param[] | undefined ?? [],
          collectBodyStatements(
            children,
            bodyOpen + 1
          ),
          children.find((child): child is GuardNode => typeof child === 'object' && child !== null && 'g' in child)
        );
      }
    );

    /*
   * The lambda parameter list is the SAME production a named mixin declares, but
   * a lambda literal is reachable from a `noTrivia` value term while a mixin
   * definition is not. Re-establish the ordinary trivia scope at the reference so
   * the one shared rule keeps one recognition mode in both positions.
   */
    const directJessLambdaParams = parser(
      { trivia: whitespace },
      g.DirectJessMixinParams
    );

    /*
   * A value-position lambda literal. `@(params)` is the same parameter list a
   * named mixin declares, and `>` is the same "yield one value" marker the mixin
   * CALL spelling (`$ > name()`) uses: `@(params) > { … }` is a FUNCTION whose
   * block body yields its `result:` entry, `@(params) { … }` / `@{ … }` is a
   * plain anonymous mixin whose body is spliced. There is no `$function` node —
   * this is the same `AnonymousMixin` (with the same `params` shape a `MixinDef`
   * uses) that an SCSS user `@function` already lowers to, so one core binder and
   * one `result:` convention serve both dialects.
   *
   * Left-factored on the leading `@` and then on `(`, so a `@`-headed value costs
   * one parameter-list parse rather than one per shape. The block-bodied family
   * is a SEPARATE rule from the expression-bodied one because only a block
   * auto-terminates its assignment: `$f: @() > { }` needs no `;`, while
   * `$f: @() > expr;` does.
   */
    const DirectJessBlockLambda = node<AnonymousMixin>(
      'DirectJessBlockLambda',
      sequence(
        literal('@'),
        choice(
          sequence(
            directJessLambdaParams,
            optional(literal('>')),
            literal('{'),
            many(directJessNestedBodyStatement),
            literal('}')
          ),
          sequence(
            literal('{'),
            many(directJessNestedBodyStatement),
            literal('}')
          )
        )
      ),
      reduceLambda
    );

    /*
   * `@(params) > <expr>` — the single-expression body, sugar for a block whose
   * only statement is `result: <expr>`. Normalizing it here keeps a function
   * uniformly "an anonymous mixin that assigns `result`", so evaluation never
   * has to know which spelling produced it.
   */
    const DirectJessExprLambda = node<AnonymousMixin>(
      'DirectJessExprLambda',
      parser(
        { trivia: whitespace },
        sequence(
          literal('@'),
          g.DirectJessMixinParams,
          literal('>'),
          not(literal('{')),
          g.DirectJessValue
        )
      ),
      (children) => {
        const params = children.find(Array.isArray) as Param[] | undefined ?? [];
        const value = children.at(-1);
        return anonymousMixin(
          [decl(
            'result',
            requireValueSlot(value)
          )],
          params.length > 0 ? params : undefined
        );
      }
    );

    /*
   * The value-position `{ … }` block family. A block is the ONLY value that can
   * terminate an assignment without a `;`, so it has its own rule: everything
   * that reaches this rule is brace-delimited and self-terminating.
   */
    const DirectJessValueBlock = node<ValueNode>(
      'DirectJessValueBlock',
      choice(
        g.DirectJessBlockLambda,
        g.DirectJessCollection
      ),
      children => requireValueNode(children[0])
    );
    const DirectJessForName = node<string>(
      'DirectJessForName',
      sequence(
        literal('$'),
        jessDollarName
      ),
      children => requireToken(children[1]).value
    );
    const DirectJessForBinding = node<ForBinding>(
      'DirectJessForBinding',
      choice(
        sequence(
          literal('['),
          g.DirectJessForName,
          literal(','),
          g.DirectJessForName,
          literal(']')
        ),
        sequence(
          g.DirectJessForName,
          optional(sequence(
            literal(','),
            g.DirectJessForName,
            optional(sequence(
              literal(','),
              g.DirectJessForName
            ))
          ))
        )
      ),
      (children) => {
        if (typeof children[0] !== 'string') {
          requireExactToken(
            children[0],
            '['
          );
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

    /*
   * The public Jess grammar permits a range bound to be either a reference or
   * a numeric/dimension literal. Both already have direct typed reductions;
   * retain that exact public set rather than widening ranges to every value.
   */
    const DirectJessForRangeBound = node<ValueNode>(
      'DirectJessForRangeBound',
      choice(
        g.DirectJessVarReference,
        g.DirectJessDimension
      ),
      children => requireValueNode(children[0])
    );
    const DirectJessForRange = node<Range>(
      'DirectJessForRange',
      sequence(
        optional(literal('>')),
        g.DirectJessForRangeBound,
        regex(/to(?![-_a-zA-Z0-9\u0080-\uffff])/),
        optional(literal('<')),
        g.DirectJessForRangeBound,
        optional(sequence(
          regex(/step(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessForRangeBound
        ))
      ),
      (children) => {
        const bounds = children.filter(isValueNode);
        if (bounds.length < 2 || bounds.length > 3) {
          throw new TypeError('Direct Jess AST grammar produced an invalid $for range.');
        }
        const tokens = children.filter(isToken);
        return range(
          bounds[0]!,
          bounds[1]!,
          bounds[2] ?? null,
          !tokens.some(token => token.value === '>'),
          !tokens.some(token => token.value === '<')
        );
      }
    );

    /*
   * `$for (\u2026 of \u2026)` iterates ONE typed source: a range, a reference, a call, a
   * collection, or an authored comma list. It deliberately does NOT admit a
   * space-adjacency run, which has no iteration semantics and cannot reduce to
   * a single iterable value \u2014 `$for ($i of 1 through 3)` (the Sass `@for`
   * spelling; Jess ranges are `1 to 3` / `1 to <3`) must fail as a positioned
   * parse error at `through`, not as an internal reduction throw.
   */
    const DirectJessForSource = node<ValueNode>(
      'DirectJessForSource',
      sequence(
        g.DirectJessValueAtom,
        many(sequence(
          literal(','),
          optional(rawWhitespace),
          g.DirectJessValueAtom
        ))
      ),
      (children) => {
        const values = children.filter(isValueNode);
        return values.length === 1
          ? values[0]!
          : list(
              values,
              ','
            );
      }
    );
    const DirectJessFor = node<For>(
      'DirectJessFor',
      sequence(
        regex(/\$for(?![-_a-zA-Z0-9\u0080-\uffff])/),
        literal('('),
        g.DirectJessForBinding,
        regex(/of(?![-_a-zA-Z0-9\u0080-\uffff])/),
        choice(
          g.DirectJessForRange,
          g.DirectJessForSource
        ),
        literal(')'),
        literal('{'),
        many(directJessNestedBodyStatement),
        literal('}')
      ),
      children => forNode(
        requireValueNode(children[4]),
        collectBodyStatements(
          children,
          7
        ),
        requireForBinding(children[2])
      )
    );

    /*
   * `$if` conditions deliberately do *not* reuse the broader mixin-guard
   * grammar. Jess control conditions are the strict historical language: bare
   * truth values, comparisons, grouped conditions, and `not` / pure `and` /
   * pure `or` trees. In particular, `default()` and `$type.*()` are mixin
   * dispatch syntax, not `$if` syntax. A comparison in an `and`/`or` chain
   * must be parenthesized and mixed chains must group explicitly.
   */
    const DirectJessIfGuardValue = node<GuardNode>(
      'DirectJessIfGuardValue',
      g.DirectJessExpressionSum,
      reduceGuardTruth
    );
    const DirectJessIfGuardCompare = node<GuardNode>(
      'DirectJessIfGuardCompare',
      noTrivia(sequence(
        g.DirectJessExpressionSum,
        jessIfGuardCompareOperator,
        g.DirectJessExpressionSum
      )),
      reduceGuardCompare
    );
    const DirectJessIfGuardPrimary = node<GuardNode>(
      'DirectJessIfGuardPrimary',
      choice(
        sequence(
          regex(/not(?![-_a-zA-Z0-9\u0080-\uffff])/),
          literal('('),
          g.DirectJessIfGuard,
          literal(')')
        ),
        sequence(
          literal('('),
          g.DirectJessIfGuard,
          literal(')')
        ),
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
      sequence(
        g.DirectJessIfGuardPrimary,
        oneOrMore(sequence(
          regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessIfGuardPrimary
        ))
      ),
      reduceGuardAnd
    );
    const DirectJessIfGuardOr = node<GuardNode>(
      'DirectJessIfGuardOr',
      sequence(
        g.DirectJessIfGuardPrimary,
        oneOrMore(sequence(
          regex(/or(?![-_a-zA-Z0-9\u0080-\uffff])/),
          g.DirectJessIfGuardPrimary
        ))
      ),
      reduceGuardOr
    );
    const DirectJessIfGuard = node<GuardNode>(
      'DirectJessIfGuard',

      /*
     * A comparison shares its left operand with the documented bare-truth
     * form (`$if (true)`). Make the longer arm transactional so a missing
     * comparison operator returns recognition to the primary truth reduction.
     */
      choice(
        attempt(g.DirectJessIfGuardCompare),
        g.DirectJessIfGuardAnd,
        g.DirectJessIfGuardOr,
        g.DirectJessIfGuardPrimary
      ),
      children => requireGuardNode(children[0])
    );
    const DirectJessIfCondition = node<GuardNode>(
      'DirectJessIfCondition',
      sequence(
        literal('('),
        g.DirectJessIfGuard,
        literal(')')
      ),
      children => requireGuardNode(children[1])
    );
    const DirectJessIfBody = node<Statement[]>(
      'DirectJessIfBody',
      sequence(
        literal('{'),

        /*
       * Selected branches publish declarations and definitions into their
       * containing frame in source order. Existing statement evaluators already
       * execute calls and loops here; imports and placement-sensitive extends
       * remain held until their respective models are available.
       */
        many(directJessNestedBodyStatement),
        literal('}')
      ),
      children => collectBodyStatements(
        children,
        1
      )
    );
    const DirectJessElseIfBranch = node<IfBranch>(
      'DirectJessElseIfBranch',
      sequence(
        regex(/\$else(?![-_a-zA-Z0-9\u0080-\uffff])/),
        regex(/if(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.DirectJessIfCondition,
        g.DirectJessIfBody
      ),
      children => ({ guard: requireGuardNode(children[2]), body: requireStatementList(children[3]) })
    );
    const DirectJessElseBranch = node<IfBranch>(
      'DirectJessElseBranch',
      sequence(
        regex(/\$else(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.DirectJessIfBody
      ),
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
      noTrivia(oneOrMore(choice(
        parser(
          { trivia: whitespace },
          g.DirectJessAttribute
        ),
        g.DirectJessPseudo,
        g.DirectJessInterpolatedParentSuffix,
        g.DirectJessInterpolatedSimple,
        g.DirectJessParent,
        g.DirectJessSimple
      ))),
      reduceCompound
    );
    const DirectJessComplexTail = node<JessComplexTail>(
      'DirectJessComplexTail',
      sequence(
        optional(directJessCombinator),
        g.DirectJessCompound
      ),
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
      sequence(
        g.DirectJessCompound,
        many(g.DirectJessComplexTail)
      ),
      reduceComplex
    );
    const DirectJessSelectorTail = node<ComplexSelector>(
      'DirectJessSelectorTail',
      sequence(
        literal(','),
        g.DirectJessComplex
      ),
      reduceSelectorTail
    );
    const DirectJessSelector = node<SelectorList>(
      'DirectJessSelector',
      sequence(
        g.DirectJessComplex,
        many(g.DirectJessSelectorTail)
      ),
      reduceSelectorList
    );
    const DirectJessApply = node<Apply>(
      'DirectJessApply',
      sequence(
        regex(/\$apply(?![-\w])/),
        g.DirectJessStaticCompound,
        many(sequence(
          literal(','),
          g.DirectJessStaticCompound
        )),
        optional(literal(';'))
      ),
      children => apply(children.filter(isCompound))
    );
    const DirectJessExtend = node<ExtendInstruction[]>(
      'DirectJessExtend',
      sequence(
        regex(/\$extend(?![-\w])/),
        g.DirectJessStaticComplex,
        many(sequence(
          literal(','),
          g.DirectJessStaticComplex
        )),
        optional(regex(/!exact(?![-\w])/)),
        optional(literal(';'))
      ),
      children => children.filter((child): child is ComplexSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'ComplexSelector')
        .map(target => ({ target: selist(target), partial: !children.some(child => isToken(child) && child.value === '!exact') }))
    );
    const DirectJessRule = node<Rule>(
      'DirectJessRule',
      sequence(
        g.DirectJessSelector,
        literal('{'),
        many(choice(
          literal(';'),
          g.DirectJessComment,
          g.DirectJessMixinCall,
          g.DirectJessValueBlockDeclaration,
          g.DirectJessVarDeclaration,
          g.DirectJessDeclaration,
          g.DirectJessMixinDef,
          g.DirectJessFor,
          g.DirectJessIf,
          g.DirectJessReferenceCall,
          g.DirectJessApply,
          g.DirectJessExtend,
          g.DirectJessRule,
          g.DirectJessSupportsAtRuleBlock,
          g.DirectJessOpaqueAtRuleBlock,
          g.DirectJessScopeBlock,
          g.DirectJessAtRuleBlock,
          g.DirectJessAtRuleStatement
        )),
        literal('}')
      ),
      (children) => {
        requireExactToken(
          children[1],
          '{'
        );
        requireExactToken(
          children.at(-1),
          '}'
        );
        const extensions = children.filter(isExtendInstructionArray).flat();
        return rule(
          requireSelectorList(children[0]),
          collectBlockStatements(
            children,
            2
          ),
          extensions.length ? extensions : undefined
        );
      }
    );
    const JessAstDocument = node<Stylesheet>(
      'JessAstDocument',
      sequence(
        optional(g.DirectJessCharset),

        /*
       * Compiler directives and variable declarations may precede a CSS import:
       * a `$[...]` import target is a live read and therefore needs its binding
       * activated in source order. CSS imports still cannot appear after a rule.
       */
        many(choice(
          g.DirectJessStyleImport,
          g.DirectJessModuleImport,
          g.DirectJessValueBlockDeclaration,
          g.DirectJessVarDeclaration,
          g.DirectJessCssImport
        )),
        many(choice(
          g.DirectJessComment,
          g.DirectJessMixinCall,
          g.DirectJessStyleImport,
          g.DirectJessModuleImport,
          g.DirectJessValueBlockDeclaration,
          g.DirectJessVarDeclaration,
          g.DirectJessMixinDef,
          g.DirectJessFor,
          g.DirectJessIf,
          g.DirectJessReferenceCall,
          g.DirectJessApply,
          g.DirectJessRule,
          g.DirectJessSupportsAtRuleBlock,
          g.DirectJessPropertyAtRule,
          g.DirectJessKeyframes,
          g.DirectJessOpaqueAtRuleBlock,
          g.DirectJessScopeBlock,
          g.DirectJessAtRuleBlock,
          g.DirectJessAtRuleStatement
        ))
      ),
      children => stylesheet(requireStatements(children.flatMap(child => isMixinCallArray(child) ? child : Array.isArray(child) ? [] : [child])))
    );

    return {
      JessAstDocument,
      DirectJessComment,
      DirectJessVarDeclaration,
      DirectJessValueBlockDeclaration,
      DirectJessBlockLambda,
      DirectJessExprLambda,
      DirectJessValueBlock,
      DirectJessVarReference,
      DirectJessReferenceTail,
      DirectJessReferenceCallTail,
      DirectJessDollarValue,
      DirectJessDollarBrace,
      DirectJessExpressionDollarBrace,
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
      DirectJessStaticValueAtom,
      DirectJessStaticValue,
      DirectJessStaticCallArgument,
      DirectJessStaticCall,
      DirectJessStaticAtNonOnlyKeyword,
      DirectJessStaticAtNonOnlyAtom,
      DirectJessStaticAtQuery,
      DirectJessStaticAtDashedIdent,
      DirectJessStaticAtPreludeTerm,
      DirectJessStaticAtPrelude,
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
      DirectJessGeneralQuotedTemplate,
      DirectJessGeneralQuotedTemplateParen,
      DirectJessGeneralQuotedTemplateSquare,
      DirectJessGeneralQuotedTemplateBrace,
      DirectJessGeneralQuotedTemplateDoubleQuoted,
      DirectJessGeneralQuotedTemplateSingleQuoted,
      DirectJessGeneralEnclosed,
      DirectJessSupportsNot,
      DirectJessSupportsLogical,
      DirectJessSupportsFeature,
      DirectJessSupportsInParens,
      DirectJessSupportsCondition,
      DirectJessCssImportTarget,
      DirectJessImportTailFunction,
      DirectJessCssImportPrelude,
      DirectJessUrlInterpolatedValue,
      DirectJessCharset,
      DirectJessCssImport,
      DirectJessSupportsAtRuleBlock,
      DirectJessPropertyName,
      DirectJessStaticPropertyDescriptor,
      DirectJessPropertyAtRule,
      DirectJessKeyframeSelector,
      DirectJessKeyframeBlock,
      DirectJessKeyframes,
      DirectJessOpaquePrelude,
      DirectJessOpaqueBody,
      DirectJessOpaqueAtRuleBlock,
      DirectJessScopeBlock,
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
      DirectJessInterpolatedValue,
      DirectJessValueAtom,
      DirectJessValueSpaceGroup,
      DirectJessValueTerm,
      DirectJessValue,
      DirectJessImportant,
      DirectJessCustomPropertyValue,
      DirectJessCustomPropertyName,
      DirectJessCustomPart,
      DirectJessCustomInnerPart,
      DirectJessCustomParen,
      DirectJessCustomSquare,
      DirectJessCustomCurly,
      DirectJessCustomValue,
      DirectJessCustomDeclaration,
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
      DirectJessParent,
      DirectJessInterpolatedSimple,
      DirectJessInterpolatedParentSuffix,
      DirectJessAttribute,
      DirectJessPseudo,
      DirectJessStaticPseudoArgument,
      DirectJessGenericPseudoArgument,
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
      DirectJessForSource,
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
  }
)]);
