/**
 * Functional Less host-mode grammar.
 *
 * CSS base: ../../../css/css-parser/src/grammar.ts
 *
 * Less adds and overrides:
 * - @variables, property variables, detached rulesets, mixins, guards, loops,
 *   plugin/import options, escaped strings, and dynamic selectors.
 * - Less-specific block and at-rule placement, including documented deviations
 *   from CSS ordering/nesting rules.
 * - Inline :extend(...) collection during selector parsing; selectors must not
 *   be reparsed to discover extends.
 *
 * Its structural `node(parser)` entries are consumed by the CST runner or by
 * parser-local AST reductions; core supplies neither a parse host nor a
 * parse entry.
 */
import {
  attempt, rules, composeLeaf,
  node, regex, literal, sequence, choice, many, oneOrMore, oneOrMoreSep, optional,
  not, scanTo, balanced, parser, trivia, noTrivia, label, word, keywords, field, leaf, peek,
  dispatch, endsWith, makeWhen, makeWord, otherwise, routed, token, when
} from 'parseman' with { type: 'macro' };
import type { Combinator, FieldCapture, FieldMap } from 'parseman';
import { cssSyntax, lessSyntax } from '@jesscss/parser-shared/recognition';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';
import { any, atRuleBlock, atRuleStatement, block, color, complexCanonical, complexSelector, compoundSelectorOf, condition, decl, classifyValueBlock, dimension, forNode, funcCall, generalEnclosed, important, importAtRule, interpolation, interpolatedSimpleSelector, keyword, list, mixinCall, mixinDef, opaqueAtRuleBlock, operation, propertyReference, pseudoSelector, quoted, reference, selectorCapture, stylesheet, rule, selist, simpleSelector, sourceSpanOf, spaced, url, variableDeclaration, varIndirect, variableReference, valueLayoutOf, withBodySpan, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { Any, AtRuleBlock, AtRuleStatement, Combinator as SelectorCombinator, ComplexSelector, CompoundSelector, Declaration, ExtendInstruction, For, ForBinding, FunctionCall, GeneralEnclosed, Important, ImportAtRule, Interpolation, Keyword, List, MixinCall, MixinDef, OpaqueAtRuleBlock, Param, Plugin, Quoted, Reference, ReferenceStep, SelectorCapture, Stylesheet, Rule, SelectorList, SimpleSelector, SimpleToken, Statement, Url, ValueNode, ValueSlot, VariableDeclaration, VarIndirect, VariableReference } from '@jesscss/core/ast';
import { LessBareVariableInterpolationError, LessDynamicCharsetError, LessInlineJavaScriptError, LessUnparenthesizedMixinGuardError, LessUnsupportedMixinNameError, LessUnsupportedVariableNameError } from './parse-error.js';

// ---------------------------------------------------------------------------
// Grammar — Less host-mode grammar.
// ---------------------------------------------------------------------------

type Token = { readonly value: string };
type ChildContainer = { readonly children: readonly unknown[] };
type InterpolationFact = { readonly ref: ValueNode; readonly src: string };
type InterpolationAccessorFact = { readonly key: ValueNode | number; readonly keyKind: 'var' | 'prop' | 'index'; readonly src: string };
/** A typed continuation of a left-associated public Reference chain. */
type ReferenceTailFact = { readonly step: Reference['steps'][number]; readonly src: string };
type ComplexTailFact = { readonly comb: ' ' | '>' | '+' | '~' | '|' | '||'; readonly compound: CompoundSelector };
type MixinPathTailFact = { readonly comb: ' ' | '>'; readonly sel: string };
type LessEachCallback = { readonly binding: ForBinding; readonly rules: Statement[] };
type MixinGuard = NonNullable<MixinDef['guard']>;
type MixinCallArgument = MixinCall['args'][number];
type CallValue = ValueSlot | MixinCall;
type MixinReferenceBaseFact = { readonly call: MixinCall; readonly raw: string };
/** Private grammar reduction: delimiters remain parser facts, while the public
 * MixinDef receives only the semantic Param array. */
type MixinParameterListFact = { readonly params: readonly Param[] };
type MixinSignatureFact = { readonly name: string; readonly params: readonly Param[]; readonly guard?: MixinGuard };
type StaticAttributeMatchFact = { readonly operator: string; readonly value: string; readonly modifier: string | null };
type StaticAttributeNameFact = { readonly namespace: string; readonly name: string };
type ExtendTargetFact = { readonly target: SelectorList; readonly partial: boolean };
type SelectorBranchFact = { readonly selector: ComplexSelector; readonly extensions: readonly ExtendInstruction[] };
type SelectorListWithExtendsFact = { readonly selector: SelectorList; readonly extensions: readonly ExtendInstruction[] };
type CustomValuePart = string | InterpolationFact | VariableReference | readonly CustomValuePart[];
type GeneralEnclosedNameFact = { readonly name: string };
type FunctionConditionFact = {
  readonly guard: MixinGuard;
  readonly src: string;
  readonly grouped: boolean;
  readonly hasComparison: boolean;
};
type UnsupportedVariableNameFact = { readonly unsupportedVariableName: string };
type SlashBoundaryFact = { readonly before: string; readonly after: string };

/** Rules this file defines; macro-fused recognition inputs are not local output. */
type LessRules = {
  Stylesheet: Combinator<Stylesheet>;
  Document: Combinator<Stylesheet>;
  VarDeclaration: Combinator<VariableDeclaration>;
  ImportStatement: Combinator<ImportAtRule>;
  PluginDirective: Combinator<Plugin>;
  ValueBlockDeclaration: Combinator<VariableDeclaration>;
  ValueBlock: Combinator<ValueNode>;
  IndirectVariableReference: Combinator<VarIndirect>;
  VariableReferenceChain: Combinator<ValueNode>;
  VariableReference: Combinator<VariableReference>;
  PropertyReference: Combinator<ValueNode>;
  VariableInterpolation: Combinator<InterpolationFact>;
  PropertyInterpolation: Combinator<InterpolationFact>;
  Interpolation: Combinator<InterpolationFact>;
  AtRuleInterpolation: Combinator<Interpolation>;
  InterpolationAccessor: Combinator<InterpolationAccessorFact>;
  ReferenceTail: Combinator<ReferenceTailFact>;
  InterpolatedValue: Combinator<Interpolation>;
  InterpolatedProperty: Combinator<Interpolation>;
  Keyword: Combinator<ValueNode>;
  NamedColor: Combinator<ValueNode>;
  Color: Combinator<ValueNode>;
  Dimension: Combinator<ValueNode>;
  UnicodeRange: Combinator<Any>;
  EscapeValue: Combinator<Any>;
  PercentEscape: Combinator<Any>;
  PagePseudo: Combinator<Any>;
  DoubledQuoteArgument: Combinator<Any>;
  FunctionArgument: Combinator<ValueSlot>;
  FunctionScalarArgument: Combinator<ValueNode>;
  ArgumentValueSequence: Combinator<ValueSlot>;
  FunctionCondition: Combinator<ValueNode>;
  FunctionConditionOr: Combinator<FunctionConditionFact>;
  FunctionConditionAnd: Combinator<FunctionConditionFact>;
  FunctionConditionTerm: Combinator<FunctionConditionFact>;
  FunctionConditionOperand: Combinator<ValueNode>;
  FunctionConditionParen: Combinator<FunctionConditionFact>;
  Call: Combinator<FunctionCall>;
  CallArgumentFunction: Combinator<FunctionCall>;
  FormatFunction: Combinator<FunctionCall>;
  CallArgumentValue: Combinator<MixinCallArgument['value']>;
  FunctionStatement: Combinator<FunctionCall>;
  Value: Combinator<ValueNode>;
  SelectorCapture: Combinator<SelectorCapture>;
  MathAtom: Combinator<ValueNode>;
  MathUnary: Combinator<ValueNode>;
  MathProduct: Combinator<ValueNode>;
  MathSum: Combinator<ValueNode>;
  TopProduct: Combinator<ValueNode>;
  TopSum: Combinator<ValueNode>;
  PreservedDivision: Combinator<ValueNode>;
  EscapedParen: Combinator<ValueNode>;
  Paren: Combinator<ValueNode>;
  ValueSequence: Combinator<ValueSlot>;
  ValueList: Combinator<ValueSlot>;
  VariableValue: Combinator<ValueSlot>;
  ImportantValue: Combinator<Important>;
  ValueListWithPriority: Combinator<ValueSlot>;
  CustomPropertyName: Combinator<string | Interpolation>;
  CustomAtKeywordText: Combinator<string>;
  CustomPart: Combinator<CustomValuePart>;
  CustomInnerPart: Combinator<CustomValuePart>;
  CustomParen: Combinator<readonly CustomValuePart[]>;
  CustomSquare: Combinator<readonly CustomValuePart[]>;
  CustomCurly: Combinator<readonly CustomValuePart[]>;
  CustomValue: Combinator<ValueNode>;
  CssCustomPropertyValue: Combinator<Keyword>;
  CustomDeclaration: Combinator<Declaration>;
  PunctuationMapDeclaration: Combinator<Declaration>;
  Declaration: Combinator<Declaration>;
  MixinParam: Combinator<Param>;
  MixinParameterList: Combinator<MixinParameterListFact>;
  MixinDefinition: Combinator<MixinDef>;
  PositionalMixinCallArgument: Combinator<MixinCallArgument>;
  MixinArgumentGroup: Combinator<MixinCallArgument>;
  MixinArguments: Combinator<readonly MixinCallArgument[]>;
  MixinCall: Combinator<MixinCall>;
  BareMixinCall: Combinator<MixinCall>;
  FlatMixinCall: Combinator<MixinCall>;
  NamespacedMixinCall: Combinator<MixinCall>;
  NamespacedMixinValue: Combinator<MixinCall>;
  MixinPathTail: Combinator<MixinPathTailFact>;
  MixinReference: Combinator<Reference>;
  ReferenceCall: Combinator<Reference>;
  MixinGuard: Combinator<MixinGuard>;
  MixinGuardTopOr: Combinator<MixinGuard>;
  MixinGuardTopAnd: Combinator<MixinGuard>;
  MixinGuardTopTerm: Combinator<MixinGuard>;
  MixinGuardOr: Combinator<MixinGuard>;
  MixinGuardAnd: Combinator<MixinGuard>;
  MixinGuardTerm: Combinator<MixinGuard>;
  MixinGuardOperand: Combinator<ValueNode>;
  EachName: Combinator<string>;
  /** A complete Less statement body, shared by detached rulesets and `each()` callbacks. */
  BodyStatement: Combinator<Statement | string>;
  EachCallback: Combinator<LessEachCallback>;
  Each: Combinator<For>;
  SupportsValue: Combinator<ValueNode>;
  SupportsFeature: Combinator<ValueNode>;
  SupportsInParens: Combinator<ValueNode>;
  SupportsCondition: Combinator<ValueNode>;
  GeneralEnclosedContent: Combinator<Interpolation>;
  GeneralEnclosedGroup: Combinator<Interpolation>;
  GeneralEnclosedQuoted: Combinator<Interpolation>;
  GeneralEnclosedFunctionName: Combinator<GeneralEnclosedNameFact>;
  GeneralEnclosed: Combinator<GeneralEnclosed>;
  SupportsBlock: Combinator<AtRuleBlock>;
  QueryValue: Combinator<ValueNode>;
  QueryLogicalGroup: Combinator<ValueNode>;
  QueryNegatedFeature: Combinator<ValueNode>;
  QueryColonFeature: Combinator<ValueNode>;
  QueryFeature: Combinator<ValueNode>;
  QueryClause: Combinator<ValueNode>;
  QueryPrelude: Combinator<ValueNode>;
  MediaQueryTerm: Combinator<ValueNode>;
  MediaQueryOnlyClause: Combinator<ValueNode>;
  MediaQueryClause: Combinator<ValueNode>;
  MediaQueryPrelude: Combinator<ValueNode>;
  ContainerStyleQuery: Combinator<FunctionCall>;
  ContainerScrollStateQuery: Combinator<FunctionCall>;
  ContainerName: Combinator<Keyword>;
  ContainerQueryAtom: Combinator<ValueNode>;
  ContainerCondition: Combinator<ValueNode>;
  MediaContainerBody: Combinator<readonly Statement[]>;
  MediaContainerBlock: Combinator<AtRuleBlock>;
  KeyframeSelector: Combinator<SimpleSelector>;
  KeyframeBlock: Combinator<Rule>;
  Keyframes: Combinator<AtRuleBlock>;
  DottedAtRuleKeyword: Combinator<ValueNode>;
  StaticAtRuleAtom: Combinator<ValueNode>;
  StaticAtRuleTerm: Combinator<ValueNode>;
  StaticAtRulePrelude: Combinator<ValueNode>;
  CssAtRulePrelude: Combinator<ValueNode | null>;
  NamespacePrelude: Combinator<ValueNode>;
  AtRuleBlock: Combinator<AtRuleBlock>;
  OpaqueAtPrelude: Combinator<string | null>;
  OpaqueBody: Combinator<string>;
  OpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  AtRuleStatement: Combinator<AtRuleStatement>;
  StaticPseudo: Combinator<SimpleToken>;
  InterpolatedPseudo: Combinator<SimpleSelector>;
  InterpolatedNthPseudo: Combinator<SimpleSelector>;
  InterpolatedArgumentPseudo: Combinator<SimpleSelector>;
  StaticNthPseudo: Combinator<SimpleSelector>;
  StaticNthArgument: Combinator<string>;
  StaticNonSelectorPseudoArgument: Combinator<string>;
  StaticPseudoGroup: Combinator<string>;
  StaticPseudoSquare: Combinator<string>;
  StaticPseudoQuoted: Combinator<string>;
  StaticPseudoCompound: Combinator<CompoundSelector>;
  StaticPseudoComplexTail: Combinator<ComplexTailFact>;
  StaticPseudoComplex: Combinator<ComplexSelector>;
  StaticPseudoSelectorTail: Combinator<ComplexSelector>;
  StaticPseudoSelector: Combinator<SelectorList>;
  StaticAttributeNamespace: Combinator<string>;
  StaticNamespaceType: Combinator<SimpleSelector>;
  StaticAttributeName: Combinator<StaticAttributeNameFact>;
  StaticAttributeQuoted: Combinator<string>;
  StaticAttributeMatch: Combinator<StaticAttributeMatchFact>;
  StaticAttribute: Combinator<SimpleSelector>;
  InterpolatedAttributeToken: Combinator<Interpolation>;
  InterpolatedAttributeValueToken: Combinator<Interpolation>;
  InterpolatedAttributeQuoted: Combinator<Interpolation>;
  InterpolatedAttribute: Combinator<SimpleSelector>;
  InterpolatedSimpleSelector: Combinator<SimpleSelector>;
  BareInterpolatedSelector: Combinator<SimpleSelector>;
  AdjacentInterpolatedSelector: Combinator<SimpleSelector>;
  BareInterpolatedSelectorWithSuffix: Combinator<SimpleSelector>;
  InterpolatedParentSuffix: Combinator<SimpleSelector>;
  Compound: Combinator<CompoundSelector>;
  ComplexTail: Combinator<ComplexTailFact>;
  Complex: Combinator<ComplexSelector>;
  SelectorTail: Combinator<ComplexSelector>;
  Selector: Combinator<SelectorList>;
  ExtendComplex: Combinator<ComplexSelector>;
  ExtendTarget: Combinator<ExtendTargetFact>;
  ExtendStatement: Combinator<ExtendInstruction[]>;
  RulesetWithExtends: Combinator<Rule>;
  Quoted: Combinator<Quoted | Interpolation>;
  StaticQuoted: Combinator<Quoted>;
  EscapedQuoted: Combinator<Quoted | Interpolation>;
  StaticUrl: Combinator<Url>;
  UrlInterpolation: Combinator<Interpolation>;
  DynamicUrl: Combinator<Url>;
  ImportOption: Combinator<Any>;
  ImportOptions: Combinator<List>;
  ImportTarget: Combinator<Quoted | Url | Interpolation>;
  ImportTail: Combinator<unknown>;
  StaticTail: Combinator<unknown>;
  StaticTailGroup: Combinator<unknown>;
  StaticTailParen: Combinator<unknown>;
  whitespace: Combinator<unknown>;
};

function isToken(value: unknown): value is Token {
  return typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string';
}

/** Macro-fused shared recognition plus this file's recursively defined outputs. */
type LessInputRules = LessRules & typeof lessSyntax;

type SharedCssSyntax = {
  CssSyntaxAttributeModifier: Combinator<unknown>;
  CssSyntaxAttributeOperator: Combinator<unknown>;
  CssSyntaxHexColor: Combinator<string>;
  CssSyntaxUnicodeRange: Combinator<string>;
  CssSyntaxNth: Combinator<unknown>;
  CssSyntaxNthChildName: Combinator<string>;
  CssSyntaxNthTypeName: Combinator<string>;
  CssSyntaxNthName: Combinator<string>;
  CssSyntaxOfKeyword: Combinator<string>;
  CssSyntaxNumber: Combinator<string>;
  CssSyntaxDimensionUnit: Combinator<string>;
  CssSyntaxInterpolatedPropertyStart: Combinator<unknown>;
  CssSyntaxInterpolatedPropertyTail: Combinator<unknown>;
  CssSyntaxProperty: Combinator<unknown>;
  CssSyntaxSupportsAtKeyword: Combinator<unknown>;
  CssSyntaxKeyframesAtKeyword: Combinator<unknown>;
  CssSyntaxMediaContainerAtKeyword: Combinator<unknown>;
  CssSyntaxMediaAtKeyword: Combinator<unknown>;
  CssSyntaxContainerAtKeyword: Combinator<unknown>;
  CssSyntaxQueryNot: Combinator<unknown>;
  CssSyntaxQueryOnly: Combinator<unknown>;
  CssSyntaxQueryAndOr: Combinator<unknown>;
  CssSyntaxQueryComparisonOperator: Combinator<unknown>;
  CssSyntaxQueryFunctionName: Combinator<unknown>;
  CssSyntaxImportant: Combinator<unknown>;
  CssSyntaxBlockComment: Combinator<unknown>;
};

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    throw new TypeError('Less grammar produced a non-token child.');
  }
  return { value: value.value };
}

function functionNameFromOpener(value: unknown): string {
  const opener = requireToken(value).value;
  if (!opener.endsWith('(')) {
    throw new TypeError('Less function opener lost its glued opening paren.');
  }
  return opener.slice(0, -1);
}

function requireTerminalText(value: unknown): string {
  return typeof value === 'string' ? value : requireToken(value).value;
}

function isUnsupportedVariableNameFact(value: unknown): value is UnsupportedVariableNameFact {
  return typeof value === 'object'
    && value !== null
    && 'unsupportedVariableName' in value
    && typeof value.unsupportedVariableName === 'string';
}

function hasChildren(value: unknown): value is ChildContainer {
  return typeof value === 'object'
    && value !== null
    && 'children' in value
    && Array.isArray(value.children);
}

function hasGrammarType(value: unknown, grammarType: string): boolean {
  return typeof value === 'object'
    && value !== null
    && 'grammarType' in value
    && value.grammarType === grammarType;
}

function variableNameTerminalText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (isToken(value)) {
    return value.value;
  }
  if (Array.isArray(value)) {
    let text = '';
    let found = false;
    for (const child of value) {
      const childText = variableNameTerminalText(child);
      if (childText !== undefined) {
        text += childText;
        found = true;
      }
    }
    return found ? text : undefined;
  }
  if (typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string') {
    return value.value;
  }
  if (hasChildren(value)) {
    return variableNameTerminalText(value.children);
  }
  return undefined;
}

function unsupportedVariableNameFrom(value: unknown): string | undefined {
  if (isUnsupportedVariableNameFact(value)) {
    return value.unsupportedVariableName;
  }
  if (isTerminalText(value, '-')) {
    return '-';
  }
  if (hasGrammarType(value, 'UnsupportedVariableName') && hasChildren(value)) {
    return variableNameTerminalText(value.children);
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const unsupported = unsupportedVariableNameFrom(child);
      if (unsupported !== undefined) {
        return unsupported;
      }
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return unsupportedVariableNameFrom(value.value);
  }
  if (hasChildren(value)) {
    return unsupportedVariableNameFrom(value.children);
  }
  return undefined;
}

function variableNameText(value: unknown): string {
  return unsupportedVariableNameFrom(value) ?? variableNameTerminalText(value) ?? requireTerminalText(value);
}

function requireSupportedVariableName(value: unknown, start: number, end: number): string {
  const unsupported = unsupportedVariableNameFrom(value);
  if (unsupported !== undefined) {
    throw new LessUnsupportedVariableNameError(start, end, unsupported);
  }
  return variableNameTerminalText(value) ?? requireTerminalText(value);
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Less grammar produced a non-string child.');
  }
  return value;
}

function requireCombinator(value: unknown): SelectorCombinator {
  const text = requireTerminalText(value);
  if (text !== ' ' && text !== '>' && text !== '+' && text !== '~' && text !== '|' && text !== '||') {
    throw new TypeError('Less grammar produced an invalid selector combinator.');
  }
  return text;
}

function isTerminalText(value: unknown, text: string): boolean {
  return (typeof value === 'string' && value === text)
    || (typeof value === 'object' && value !== null && 'value' in value && value.value === text);
}

function requireField(fields: FieldMap | undefined, name: string): FieldCapture {
  const field = fields?.[name];
  if (field === undefined || Array.isArray(field)) {
    throw new TypeError(`Less grammar lost required ${name} field.`);
  }
  return field;
}

function requireFields(fields: FieldMap | undefined, name: string): readonly FieldCapture[] {
  const field = fields?.[name];
  if (field === undefined) {
    throw new TypeError(`Less grammar lost required ${name} field.`);
  }
  return Array.isArray(field) ? field : [field];
}

/** Reassemble only grammar-produced terminal values; never slice or rescan input. */
function staticText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isQuoted(value)) {
    return value.src;
  }
  // Parseman may retain a terminal capture as its token object when a
  // boundary is wrapped in `field(...)`.  It is still grammar-owned static
  // text; accepting it here avoids treating authored whitespace around a
  // preserved Less slash as a dynamic import fragment.
  if (typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string') {
    return value.value;
  }
  if (isSlashBoundaryFact(value)) {
    return value.before + '/' + value.after;
  }
  if (Array.isArray(value)) {
    return value.map(staticText).join('');
  }
  throw new TypeError('Less grammar produced a non-static import fragment.');
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

function staticTextWithTriviaGaps(children: readonly unknown[], triviaLog: readonly number[]): string {
  const gapBefore = new Set<number>();
  for (let index = 0; index < lessTriviaEntryCount(triviaLog); index += 1) {
    gapBefore.add(lessTriviaEntryInsertIndex(triviaLog, index));
  }

  let text = '';
  for (let index = 0; index < children.length; index++) {
    if (gapBefore.has(index)) {
      text += ' ';
    }
    text += staticText(children[index]);
  }
  if (gapBefore.has(children.length)) {
    text += ' ';
  }

  return semanticGapText(text);
}

function isQuoted(value: unknown): value is Quoted {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Quoted'
    && 'src' in value
    && typeof value.src === 'string'
    && 'value' in value
    && typeof value.value === 'string'
    && 'quote' in value
    && typeof value.quote === 'string'
    && 'escaped' in value
    && typeof value.escaped === 'boolean';
}

function isInterp(value: unknown): value is Interpolation {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'Interpolation' && 'parts' in value && Array.isArray(value.parts);
}

function isUrl(value: unknown): value is Url {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Url'
    && 'value' in value;
}

function isAny(value: unknown): value is Any {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Any'
    && 'src' in value
    && typeof value.src === 'string';
}

function isImportAtRule(value: unknown): value is ImportAtRule {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'ImportAtRule'
    && 'name' in value
    && typeof value.name === 'string'
    && 'target' in value
    && (isQuoted(value.target) || isUrl(value.target) || isInterp(value.target))
    && 'options' in value
    && 'alias' in value
    && 'tail' in value;
}

function isVarDeclaration(value: unknown): value is VariableDeclaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VariableDeclaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && (isValueSlotValue(value.value) || isMixinCall(value.value));
}

function isVarRef(value: unknown): value is VariableReference {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VariableReference'
    && 'name' in value
    && typeof value.name === 'string';
}

function isVarIndirect(value: unknown): value is VarIndirect {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VarIndirect'
    && 'nameRef' in value
    && isValueNode(value.nameRef);
}

function isPropRef(value: unknown): value is ValueNode & { readonly type: 'PropertyReference'; readonly name: string; readonly raw: string } {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'PropertyReference'
    && 'name' in value
    && typeof value.name === 'string'
    && 'raw' in value
    && typeof value.raw === 'string';
}

function isReference(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'Reference'
    && 'base' in value && isValueNode(value.base)
    && 'steps' in value && Array.isArray(value.steps);
}

function isInterpolationAccessorFact(value: unknown): value is InterpolationAccessorFact {
  return typeof value === 'object' && value !== null
    && 'key' in value && (typeof value.key === 'number' || isValueNode(value.key))
    && 'keyKind' in value && (value.keyKind === 'var' || value.keyKind === 'prop' || value.keyKind === 'index')
    && 'src' in value && typeof value.src === 'string';
}

function requireInterpolationAccessorFact(value: unknown): InterpolationAccessorFact {
  if (!isInterpolationAccessorFact(value)) {
    throw new TypeError('Less grammar produced an invalid accessor fact.');
  }
  return value;
}

function referenceWithBracketLookups(base: ValueNode, raw: string, accessors: readonly unknown[]): ValueNode {
  if (accessors.length === 0) {
    return base;
  }
  const steps: ReferenceStep[] = [];
  for (const child of accessors) {
    const accessor = requireInterpolationAccessorFact(child);
    raw += `[${accessor.src}]`;
    steps.push({ type: 'BracketLookup', key: accessor.key, keyKind: accessor.keyKind });
  }
  return reference(base, steps, raw);
}

/** Source fallback for a grammar fact. This deliberately walks already
 * reduced facts; it never inspects or re-parses source bytes. */
function mixinArgumentSource(value: CallValue): string {
  if (isMixinCall(value)) {
    const path = value.path.map((segment, index) => index === 0 ? segment.sel : `${segment.comb}${segment.sel}`).join('');
    const args = value.args.map(argument => `${argument.name === undefined ? '' : `@${argument.name}: `}${mixinArgumentSource(argument.value)}${argument.spread ? '...' : ''}`).join(', ');
    return `${path}${value.name}(${args})${value.important ? ' !important' : ''}`;
  }
  if (Array.isArray(value)) {
    return value.map(part => mixinArgumentSource(part)).join(' ');
  }
  const node = requireValueNode(value);
  switch (node.type) {
    case 'Keyword': case 'Color': case 'Dimension': case 'Any': case 'SelectorCapture': return node.src;
    case 'Quoted': return node.src;
    case 'VariableReference': return `@${node.name}`;
    case 'PropertyReference': return node.raw;
    case 'VarIndirect': return `@${mixinArgumentSource(node.nameRef)}`;
    case 'Reference': return node.raw;
    case 'FunctionCall': return `${node.name}(${node.args.map(mixinArgumentSource).join(', ')})`;
    case 'Block': return `${node.escaped ? '~' : ''}${node.delimiter === 'square' ? '[' : '('}${mixinArgumentSource(node.inner)}${node.delimiter === 'square' ? ']' : ')'}`;
    case 'Operation': return `${mixinArgumentSource(node.left)} ${node.operator} ${mixinArgumentSource(node.right)}`;
    case 'SpacedValue': return node.parts.map(mixinArgumentSource).join(' ');
    case 'List': return node.value.map(mixinArgumentSource).join(node.sep === ',' ? ', ' : node.sep === '/' ? ' / ' : ' ');
    case 'Important': return `${mixinArgumentSource(node.inner)} !important`;
    default: throw new TypeError(`Less mixin-reference raw source cannot represent ${node.type}.`);
  }
}

/**
 * Fold only already-reduced grammar facts into a public Reference.  In
 * particular, this never re-reads the source to discover chain structure.
 */
function referenceWithTails(base: ValueNode | MixinCall, baseRaw: string, tails: readonly unknown[]): Reference {
  const steps: ReferenceStep[] = [];
  let raw = baseRaw;
  for (const child of tails) {
    if (typeof child !== 'object' || child === null || !('step' in child) || !('src' in child)) {
      throw new TypeError('Less grammar produced an invalid reference-tail fact.');
    }
    const tail = requireReferenceTailFact(child);
    raw += tail.src;
    steps.push(tail.step);
  }
  return reference(base, steps, raw);
}

function isReferenceTailFact(value: unknown): value is ReferenceTailFact {
  return typeof value === 'object' && value !== null
    && 'step' in value && typeof value.step === 'object' && value.step !== null
    && 'src' in value && typeof value.src === 'string';
}

function requireReferenceTailFact(value: unknown): ReferenceTailFact {
  if (!isReferenceTailFact(value)) {
    throw new TypeError('Less grammar produced an invalid reference-tail fact.');
  }
  return value;
}

function isMixinReferenceBaseFact(value: unknown): value is MixinReferenceBaseFact {
  return typeof value === 'object' && value !== null
    && 'call' in value && isMixinCall(value.call)
    && 'raw' in value && typeof value.raw === 'string';
}

function requireMixinReferenceBaseFact(value: unknown): MixinReferenceBaseFact {
  if (!isMixinReferenceBaseFact(value)) {
    throw new TypeError('Less grammar produced an invalid mixin-reference base fact.');
  }
  return value;
}

function interpolationFactFromChildren(children: readonly unknown[], span: SourceSpan): InterpolationFact {
  const opener = requireToken(children[0]).value;
  const head = opener === '@{'
    ? requireSupportedVariableName(children[1], span.start, span.end)
    : requireToken(children[1]).value;
  let src = `${opener}${head}`;
  for (const child of children.slice(2, -1)) {
    src += `[${requireInterpolationAccessorFact(child).src}]`;
  }
  const ref = referenceWithBracketLookups(
    opener === '@{' ? variableReference(head, 'scoped') : propertyReference(head),
    `${opener === '@{' ? '@' : '$'}${head}`,
    children.slice(2, -1)
  );
  return { ref, src: `${src}}` };
}

function appendInterpolationLiteral(parts: Interpolation['parts'], lit: string): void {
  const previous = parts.at(-1);
  if (previous !== undefined && 'lit' in previous) {
    parts[parts.length - 1] = { lit: previous.lit + lit };
  } else {
    parts.push({ lit });
  }
}

function appendGeneralEnclosedLiteral(parts: Interpolation['parts'], lit: string): void {
  if (lit.length === 0) {
    return;
  }
  const last = parts.at(-1);
  if (last !== undefined && 'lit' in last) {
    last.lit += lit;
  } else {
    parts.push({ lit });
  }
}

function generalEnclosedInterpolationFromChildren(children: readonly unknown[]): Interpolation {
  const parts: Interpolation['parts'] = [];
  const append = (child: unknown): void => {
    if (child === undefined || child === null || child === false) {
      return;
    }
    if (isInterpolationFact(child)) {
      parts.push({ ref: child.ref, unquote: true });
    } else if (typeof child === 'object' && child !== null && 'type' in child && child.type === 'Interpolation') {
      if (!isValueNode(child) || child.type !== 'Interpolation') {
        throw new TypeError('Less general-enclosed grammar produced a non-interpolation child.');
      }
      for (const part of child.parts) {
        if ('lit' in part) {
          appendGeneralEnclosedLiteral(parts, part.lit);
        } else {
          parts.push(part);
        }
      }
    } else if (Array.isArray(child)) {
      for (const nested of child) {
        append(nested);
      }
    } else if (typeof child === 'string') {
      appendGeneralEnclosedLiteral(parts, child);
    } else {
      appendGeneralEnclosedLiteral(parts, requireToken(child).value);
    }
  };
  for (const child of children) {
    append(child);
  }
  return interpolation(parts);
}

function isInterpolationFact(value: unknown): value is InterpolationFact {
  return typeof value === 'object' && value !== null
    && 'ref' in value && isValueNode(value.ref)
    && 'src' in value && typeof value.src === 'string';
}

function isSlashBoundaryFact(value: unknown): value is SlashBoundaryFact {
  return typeof value === 'object' && value !== null
    && 'before' in value && typeof value.before === 'string'
    && 'after' in value && typeof value.after === 'string';
}

function requireInterpolationFact(value: unknown): InterpolationFact {
  if (!isInterpolationFact(value)) {
    throw new TypeError('Less grammar produced an invalid interpolation fact.');
  }
  return value;
}

/** Fold grammar-owned interpolation facts, bare variable references, and literal
 * tokens into canonical Interpolation parts.  An optional `leading` literal seeds
 * the run so quote openers stay attached to their following literal segment. */
function interpolationPartsFrom(children: readonly unknown[], unquote: boolean, leading?: string): Interpolation['parts'] {
  const parts: Interpolation['parts'] = [];
  if (leading !== undefined) {
    parts.push({ lit: leading });
  }
  for (const child of children) {
    if (isInterpolationFact(child)) {
      parts.push({ ref: child.ref, unquote });
    } else if (isVarRef(child)) {
      parts.push({ ref: child, unquote });
    } else {
      appendInterpolationLiteral(parts, requireToken(child).value);
    }
  }
  return parts;
}

/** Reduce grammar-produced `separator` field captures into their terminal text. */
function separatorsFromFields(fields: FieldMap | undefined): string[] {
  return fields?.separator === undefined
    ? []
    : requireFields(fields, 'separator').map(separator => staticText(separator.value));
}

function sourceFromState(state: unknown): string | undefined {
  return typeof state === 'object'
    && state !== null
    && 'source' in state
    && typeof state.source === 'string'
    ? state.source
    : undefined;
}

const lessTriviaKindLabels = ['whitespace', 'lineComment', 'blockComment'] as const;
const LESS_NODE_TRIVIA_STRIDE = 4;

function lessTriviaEntryCount(triviaLog: readonly number[]): number {
  return Math.trunc(triviaLog.length / LESS_NODE_TRIVIA_STRIDE);
}

function lessTriviaEntryStart(triviaLog: readonly number[], index: number): number {
  return triviaLog[index * LESS_NODE_TRIVIA_STRIDE] ?? 0;
}

function lessTriviaEntryEnd(triviaLog: readonly number[], index: number): number {
  return triviaLog[index * LESS_NODE_TRIVIA_STRIDE + 1] ?? 0;
}

function lessTriviaEntryInsertIndex(triviaLog: readonly number[], index: number): number {
  return triviaLog[index * LESS_NODE_TRIVIA_STRIDE + 2] ?? 0;
}

function lessTriviaEntryKind(triviaLog: readonly number[], index: number): typeof lessTriviaKindLabels[number] | undefined {
  const kindIndex = triviaLog[index * LESS_NODE_TRIVIA_STRIDE + 3];
  return kindIndex === undefined ? undefined : lessTriviaKindLabels[kindIndex];
}

function lessTriviaEntryText(triviaLog: readonly number[], source: string, index: number): string {
  return source.slice(lessTriviaEntryStart(triviaLog, index), lessTriviaEntryEnd(triviaLog, index));
}

function lessTriviaEntryHasLineBreak(triviaLog: readonly number[], source: string, index: number): boolean {
  for (const char of lessTriviaEntryText(triviaLog, source, index)) {
    if (char === '\n' || char === '\r') {
      return true;
    }
  }
  return false;
}

function triviaTextAtInsertIndex(
  triviaLog: readonly number[],
  state: unknown,
  insertIndex: number
): string {
  const source = sourceFromState(state);
  if (source === undefined) {
    return '';
  }

  const entryCount = lessTriviaEntryCount(triviaLog);
  const selected: number[] = [];
  let hasBlockComment = false;
  let hasLineBreak = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (lessTriviaEntryInsertIndex(triviaLog, index) !== insertIndex) {
      continue;
    }
    selected.push(index);
    if (lessTriviaEntryKind(triviaLog, index) === 'blockComment') {
      hasBlockComment = true;
    }
    if (lessTriviaEntryHasLineBreak(triviaLog, source, index)) {
      hasLineBreak = true;
    }
  }

  if (!hasBlockComment) {
    return hasLineBreak
      ? selected.map(index => lessTriviaEntryText(triviaLog, source, index)).join('')
      : '';
  }

  const outputEntries = new Set<number>();
  const selectedEntries = new Set(selected);
  for (const index of selected) {
    if (lessTriviaEntryKind(triviaLog, index) !== 'blockComment') {
      continue;
    }
    const previous = index - 1;
    const next = index + 1;
    if (selectedEntries.has(previous) && lessTriviaEntryKind(triviaLog, previous) === 'whitespace') {
      outputEntries.add(previous);
    }
    outputEntries.add(index);
    if (selectedEntries.has(next) && lessTriviaEntryKind(triviaLog, next) === 'whitespace') {
      outputEntries.add(next);
    }
  }
  return selected
    .filter(index => outputEntries.has(index))
    .map(index => lessTriviaEntryText(triviaLog, source, index))
    .join('');
}

function isFunctionSeparatorChild(child: unknown): boolean {
  const text = typeof child === 'string'
    ? child
    : typeof child === 'object'
      && child !== null
      && 'value' in child
      && typeof child.value === 'string'
      ? child.value
      : '';
  return text.slice(0, 1) === ',' || text.slice(0, 1) === ';';
}

function functionSeparatorsFromFields(
  fields: FieldMap | undefined,
  children: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown
): string[] {
  const separators = separatorsFromFields(fields);
  if (separators.length === 0) {
    return separators;
  }

  const separatorIndexes: number[] = [];
  for (let index = 0; index < children.length; index++) {
    if (isFunctionSeparatorChild(children[index])) {
      separatorIndexes.push(index);
    }
  }

  return separators.map((separator, index) => {
    const separatorIndex = separatorIndexes[index];
    if (separatorIndex === undefined) {
      return separator;
    }
    const nextValueIndex = children.findIndex((child, childIndex) =>
      childIndex > separatorIndex && isValueSlotValue(child));
    return triviaTextAtInsertIndex(triviaLog, state, separatorIndex)
      + separator
      + triviaTextAtInsertIndex(triviaLog, state, nextValueIndex);
  });
}

function hasField(fields: FieldMap | undefined, name: string): boolean {
  return fields?.[name] !== undefined;
}

function commaListWithTriviaFromChildren<T extends ValueSlot>(
  children: readonly unknown[],
  fields: FieldMap | undefined,
  triviaLog: readonly number[],
  state: unknown,
  pick: (child: unknown) => child is T
): T | List {
  const values = children.filter(pick);
  if (values.length === 1) {
    return values[0]!;
  }
  const result = list(values, ',');
  const authoredSeparators = separatorsFromFields(fields);
  if (authoredSeparators.length !== values.length - 1) {
    return result;
  }
  const separators: string[] = [];
  let valueIndex = 0;
  for (let index = 0; index < children.length; index += 1) {
    if (!pick(children[index])) {
      continue;
    }
    if (valueIndex > 0) {
      separators.push(
        triviaTextAtInsertIndex(triviaLog, state, index - 1)
        + authoredSeparators[valueIndex - 1]!
        + triviaTextAtInsertIndex(triviaLog, state, index)
      );
    }
    valueIndex++;
  }
  return separators.length === values.length - 1 ? withValueLayout(result, separators) : result;
}

function isGluedValueBoundary(child: unknown): boolean {
  return typeof child === 'object'
    && child !== null
    && 'kind' in child
    && child.kind === 'glued-value-boundary';
}

/** Shared value-term reduction for grammar branches that keep comments in
 * Parseman's trivia log rather than as semantic `Comment` value nodes. */
function valuePieceReducerWithTrivia(
  children: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown
): ValueSlot {
  const values = children
    .filter(child => isValueNode(child) || isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%'))
    .map(child => isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%')
      ? keyword(requireTerminalText(child))
      : requireValueNode(child));
  if (values.length === 1) {
    return values[0]!;
  }

  const separators: string[] = [];
  let previousValue = -1;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!(isValueNode(child) || isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%'))) {
      continue;
    }
    if (previousValue >= 0) {
      const trivia = triviaTextAtInsertIndex(triviaLog, state, index);
      const boundary = children.slice(previousValue + 1, index).some(isGluedValueBoundary);
      separators.push(trivia.length > 0 ? trivia : boundary ? '' : ' ');
    }
    previousValue = index;
  }

  return withValueLayout(values, separators);
}

/** A structural value child stays as-is; a grammar terminal becomes a keyword. */
function keywordOrValue(child: unknown): ValueNode {
  return isValueNode(child) ? child : keyword(requireTerminalText(child));
}

function layoutFromTriviaBoundaries(
  children: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown,
  pick: (child: unknown) => boolean
): string[] {
  const separators: string[] = [];
  let previous = -1;
  for (let index = 0; index < children.length; index += 1) {
    if (!pick(children[index])) {
      continue;
    }
    if (previous >= 0) {
      const trivia = triviaTextAtInsertIndex(triviaLog, state, index);
      separators.push(trivia.length > 0 ? trivia : ' ');
    }
    previous = index;
  }
  return separators;
}

/** Space-join value/terminal children into a single SpacedValue. */
function spacedFromValueChildren(
  children: readonly unknown[],
  triviaLog: readonly number[] = [],
  state?: unknown
): ValueNode {
  const values = children.map(keywordOrValue);
  if (values.length === 1) {
    return values[0]!;
  }
  const separators = layoutFromTriviaBoundaries(children, triviaLog, state, () => true);
  return spaced(values, separators);
}

function isComplexTailFact(value: unknown): value is ComplexTailFact {
  return typeof value === 'object' && value !== null && 'comb' in value && 'compound' in value;
}

/** Shared `optional(combinator) compound` selector-tail reduction: the compound
 * and combinator sub-rules vary by selector family, but the fold to a
 * `{ comb, compound }` fact is identical. */
function combinatorTailReducer(children: readonly unknown[]): ComplexTailFact {
  const compound = children.find(isCompound);
  if (compound === undefined) {
    throw new TypeError('Less grammar produced a selector tail without a compound.');
  }
  const token = children.find(child => !isCompound(child));
  return { comb: token === undefined ? ' ' : requireCombinator(token), compound };
}

/** Space-separated query clause reduction: keyword/value children join into a
 * SpacedValue, and a single value collapses to itself. */
function queryClauseReducer(
  children: readonly unknown[],
  triviaLog: readonly number[] = [],
  state?: unknown
): ValueNode {
  const values = children
    .filter(child => child !== undefined && child !== null && child !== false)
    .map(keywordOrValue);
  if (values.length === 1) {
    return values[0]!;
  }
  const separators = layoutFromTriviaBoundaries(
    children,
    triviaLog,
    state,
    child => child !== undefined && child !== null && child !== false
  );
  return spaced(values, separators);
}

function queryComparisonOperators(children: readonly unknown[]): string[] {
  return children
    .filter((child) => {
      const text = typeof child === 'string'
        ? child
        : typeof child === 'object' && child !== null && 'value' in child
          ? child.value
          : null;
      return text === '<' || text === '<=' || text === '=' || text === '>=' || text === '>';
    })
    .map(requireTerminalText);
}

/** Turn grammar-owned custom-property leaves into a canonical value without a source scan. */
function customValueFromParts(parts: readonly CustomValuePart[]): ValueNode {
  const interpolationParts: Interpolation['parts'] = [];
  let hasInterpolation = false;
  const append = (part: CustomValuePart): void => {
    if (typeof part === 'string') {
      appendInterpolationLiteral(interpolationParts, part);
    } else if (Array.isArray(part)) {
      for (const nested of part) {
        append(nested);
      }
    } else if (isInterpolationFact(part)) {
      hasInterpolation = true;
      interpolationParts.push({ ref: part.ref, unquote: true });
    } else if (isVarRef(part)) {
      hasInterpolation = true;
      interpolationParts.push({ ref: part, unquote: false });
    } else {
      throw new TypeError('Less custom value retained an untyped grammar part.');
    }
  };
  for (const part of parts) {
    append(part);
  }
  if (hasInterpolation) {
    return interpolation(interpolationParts);
  }
  // A custom-property value is verbatim `<declaration-value>` text that is never
  // evaluated (css-syntax-3 §7.2), so even a wholly-quoted value stays `Any`
  // rather than being re-typed as a `Quoted` string.
  return any(interpolationParts.map(part => 'lit' in part ? part.lit : '').join(''));
}

function customPartsFromChildren(children: readonly unknown[]): CustomValuePart[] {
  const parts: CustomValuePart[] = [];
  for (const child of children) {
    if (isInterpolationFact(child)) {
      parts.push(child);
    } else if (isVarRef(child)) {
      parts.push(child);
    } else if (Array.isArray(child)) {
      parts.push(customPartsFromChildren(child));
    } else if (typeof child === 'string') {
      parts.push(child);
    } else {
      parts.push(requireToken(child).value);
    }
  }
  return parts;
}

function isValueNode(value: unknown): value is ValueNode {
  // Dispatch once on the discriminant rather than re-running the object guard
  // through each `isX` prefix. Type-only arms return true directly (matching
  // the original union); the four structurally-validated node kinds delegate to
  // their deep guards, preserving identical acceptance.
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  switch (value.type) {
    case 'Keyword':
    case 'Color':
    case 'Dimension':
    case 'Url':
    case 'FunctionCall':
    case 'SpacedValue':
    case 'List':
    case 'Operation':
    case 'Condition':
    case 'Block':
    case 'PropertyReference':
    case 'VarIndirect':
    case 'Reference':
    case 'Interpolation':
    case 'Important':
    case 'SelectorCapture':
    case 'AnonymousMixin':
    case 'Collection':
    case 'GeneralEnclosed':
      return true;
    case 'Quoted':
      return isQuoted(value);
    case 'Any':
      return isAny(value);
    case 'VariableReference':
      return isVarRef(value);
    default:
      return false;
  }
}

function valueSlot(value: ValueSlot): ValueSlot {
  // Ordinary adjacent terms are raw recursive ValueSlot arrays.  The
  // variable-declaration reducer uses `variableValueSlot` below for the one
  // Less-specific boundary where a preserved slash must remain available to
  // later math-mode evaluation; declaration/value positions stay raw arrays.
  if (Array.isArray(value)) {
    return value;
  }
  if (isSpacedValue(value)) {
    return value.parts;
  }
  if (isValueNode(value) && value.type === 'Block' && isSpacedValue(value.inner)) {
    return { ...value, inner: value.inner.parts };
  }
  return value;
}

function isSpacedValue(value: ValueSlot): value is Extract<ValueNode, { type: 'SpacedValue' }> {
  return isValueNode(value) && value.type === 'SpacedValue';
}

function variableValueSlot(value: unknown): ValueSlot {
  const slot: ValueSlot = Array.isArray(value) ? value as ValueSlot : requireValueNode(value);
  if (Array.isArray(slot)) {
    // A variable-held slash with authored whitespace is one preserved Less
    // arithmetic value.  Keep ordinary adjacent values as the raw recursive
    // array, but retain this semantic boundary so a later operation does not
    // mistake `10px / 2` for a numeric operand and invent `calc(...)`.  Glued
    // slash values remain raw arrays for the existing Less structural shape.
    const layout = valueLayoutOf(slot);
    const hasSlash = slot.some(part =>
      isValueNode(part) && (part.type === 'Keyword' || part.type === 'Any') && part.src.trim() === '/');
    if (hasSlash && layout?.some(separator => separator.length > 0)) {
      return { type: 'SpacedValue', parts: slot, separators: layout };
    }
    return slot;
  }
  if (isSpacedValue(slot)) {
    const preservedDivision = slot.parts.some(part =>
      (part.type === 'Keyword' || part.type === 'Any') && part.src.trim() === '/');
    const authoredBoundary = slot.separators?.some(separator => separator.length > 0) === true;
    return preservedDivision && authoredBoundary ? slot : slot.parts;
  }
  if (isValueNode(slot) && slot.type === 'Block' && isSpacedValue(slot.inner)) {
    const preservedDivision = slot.inner.parts.some(part =>
      (part.type === 'Keyword' || part.type === 'Any') && part.src.trim() === '/');
    return preservedDivision ? slot : { ...slot, inner: slot.inner.parts };
  }
  return slot;
}

function isValueSlotValue(value: unknown): value is ValueSlot {
  return Array.isArray(value) ? value.every(isValueSlotValue) : isValueNode(value);
}

function callWithLayout(
  name: string,
  args: ValueSlot[],
  separators: string[],
  hasTrailingSeparator: boolean,
  span: SourceSpan
): FunctionCall {
  const call = funcCall(name, args);
  if (separators.length === args.length - 1 || hasTrailingSeparator) {
    withValueLayout(call.args, separators);
  }
  return withSourceSpan(call, span);
}

function functionCallFromChildren(
  children: readonly unknown[],
  fields: FieldMap | undefined,
  span: SourceSpan,
  triviaLog: readonly number[],
  state: unknown
): FunctionCall {
  const name = functionNameFromOpener(children[0]);
  const args: ValueSlot[] = [];
  for (const child of children.slice(1, -1)) {
    if (isValueSlotValue(child)) {
      args.push(child);
    }
  }
  const separators = functionSeparatorsFromFields(fields, children, triviaLog, state);
  return callWithLayout(name, args, separators, hasField(fields, 'trailingSeparator'), span);
}

function argumentFunctionFromChildren(
  children: readonly unknown[],
  fields: FieldMap | undefined,
  span: SourceSpan
): FunctionCall {
  const name = functionNameFromOpener(children[0]);
  const args = children.slice(1, -1).filter(isValueSlotValue);
  return callWithLayout(name, args, separatorsFromFields(fields), hasField(fields, 'trailingSeparator'), span);
}

function requireValueSlot(value: unknown): ValueSlot {
  return Array.isArray(value) ? value as ValueSlot : valueSlot(requireValueNode(value));
}

function requireValueNode(value: unknown): ValueNode {
  if (!isValueNode(value)) {
    throw new TypeError('Less grammar produced a non-value child.');
  }
  return value;
}

function requireKeyword(value: unknown): Keyword {
  const node = requireValueNode(value);
  if (node.type !== 'Keyword') {
    throw new TypeError('Less grammar produced a non-keyword child.');
  }
  return node;
}

function requireMixinCallArgumentValue(value: unknown): MixinCallArgument['value'] {
  if (!isValueSlotValue(value) && !isMixinCall(value)) {
    throw new TypeError('Less grammar produced an invalid mixin-call argument.');
  }
  return value;
}

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && (typeof value.name === 'string' || isInterp(value.name))
    && 'value' in value
    && 'value' in value
    && isValueSlotValue(value.value)
    && 'merge' in value
    && (value.merge === null || value.merge === ',' || value.merge === ' ')
    && 'important' in value
    && typeof value.important === 'boolean';
}

function isSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'SelectorList'
    && 'selectors' in value
    && Array.isArray(value.selectors);
}

function requireSelectorList(value: unknown): SelectorList {
  if (!isSelectorList(value)) {
    throw new TypeError('Less grammar produced a non-selector child.');
  }
  return value;
}

function isComplex(value: unknown): value is ComplexSelector {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'ComplexSelector'
    && 'head' in value
    && 'tail' in value
    && Array.isArray(value.tail);
}

function requireComplex(value: unknown): ComplexSelector {
  if (!isComplex(value)) {
    throw new TypeError('Less grammar produced a non-complex selector child.');
  }
  return value;
}

function requireComplexes(children: readonly unknown[]): ComplexSelector[] {
  const selectors: ComplexSelector[] = [];
  for (const child of children) {
    selectors.push(requireComplex(child));
  }
  return selectors;
}

type SourceSpan = { readonly start: number; readonly end: number };
type SpannedToken = { readonly value: unknown; readonly span: SourceSpan };

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

function isCompound(value: unknown): value is CompoundSelector {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'CompoundSelector'
    && 'simples' in value
    && Array.isArray(value.simples);
}

function isSimpleSelector(value: unknown): value is SimpleSelector {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'SimpleSelector'
    && 'text' in value
    && 'interp' in value;
}

// Selector-function pseudos whose static argument is retained as a structured
// `SelectorList` (P0). Gated on the pseudo NAME (lowercased, colon-stripped),
// mirroring the CSS grammar. `:global`/`:local` are recognized by
// `staticSelectorPseudoName` but stay opaque text — they are absent here.
// `crossable` (a narrower set) is decided in core.
const STRUCTURED_PSEUDOS = new Set(['is', 'where', 'not', 'has', 'matches']);

function isSimpleToken(value: unknown): value is SimpleToken {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && (value.type === 'SimpleSelector' || value.type === 'PseudoSelector');
}

function requireSimpleToken(value: unknown): SimpleToken {
  if (!isSimpleToken(value)) {
    throw new TypeError('Less AST grammar produced a non-simple selector child.');
  }
  return value;
}

function pseudoNameFromHead(head: string): string {
  return head.slice(0, 2) === '::'
    ? head.slice(2)
    : head.slice(0, 1) === ':'
      ? head.slice(1)
      : head;
}

function staticSelectorPseudoFrom(head: string, arg: unknown): SimpleToken {
  if (isSelectorList(arg) && STRUCTURED_PSEUDOS.has(pseudoNameFromHead(head).toLowerCase())) {
    return pseudoSelector(head, arg);
  }
  return simpleSelector(`${head}(${requireSelectorList(arg).selectors.map(complexCanonical).join(',')})`);
}

function staticNonSelectorPseudoFrom(head: string, arg: string | null): SimpleSelector {
  return arg === null
    ? simpleSelector(head)
    : simpleSelector(`${head}(${arg})`);
}

function requireCompound(value: unknown): CompoundSelector {
  if (!isCompound(value)) {
    throw new TypeError('Less grammar produced a non-compound selector child.');
  }
  return value;
}

function isRule(value: unknown): value is Rule {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Rule'
    && 'selector' in value
    && isSelectorList(value.selector)
    && 'body' in value
    && Array.isArray(value.body);
}

function isAtRuleBlock(value: unknown): value is AtRuleBlock {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'AtRuleBlock' && 'name' in value && typeof value.name === 'string'
    && 'prelude' in value && 'body' in value && Array.isArray(value.body);
}

function isAtRuleStatement(value: unknown): value is AtRuleStatement {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'AtRuleStatement' && 'name' in value && typeof value.name === 'string'
    && 'prelude' in value;
}

function isMixinDef(value: unknown): value is MixinDef {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'MixinDef' && 'name' in value && typeof value.name === 'string'
    && 'params' in value && Array.isArray(value.params) && 'body' in value && Array.isArray(value.body);
}

function isMixinCall(value: unknown): value is MixinCall {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'MixinCall' && 'name' in value && typeof value.name === 'string'
    && 'args' in value && Array.isArray(value.args) && 'path' in value && Array.isArray(value.path)
    && 'important' in value && typeof value.important === 'boolean';
}

function isReferenceCall(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'Reference' && 'base' in value && isVarRef(value.base)
    && 'steps' in value && Array.isArray(value.steps)
    && value.steps.length === 1 && value.steps[0]?.type === 'Call';
}

function isParam(value: unknown): value is Param {
  return typeof value === 'object' && value !== null && !('type' in value)
    && ('name' in value || 'pattern' in value || 'rest' in value);
}

function isMixinParameterListFact(value: unknown): value is MixinParameterListFact {
  return typeof value === 'object' && value !== null && 'params' in value
    && Array.isArray(value.params) && value.params.every(isParam);
}

function isMixinSignatureFact(value: unknown): value is MixinSignatureFact {
  return typeof value === 'object' && value !== null && 'name' in value
    && typeof value.name === 'string' && 'params' in value
    && Array.isArray(value.params) && value.params.every(isParam)
    && (!('guard' in value) || value.guard === undefined || isMixinGuard(value.guard));
}

function isStaticAttributeNameFact(value: unknown): value is StaticAttributeNameFact {
  return typeof value === 'object' && value !== null
    && 'namespace' in value && typeof value.namespace === 'string'
    && 'name' in value && typeof value.name === 'string';
}

function isExtendInstruction(value: unknown): value is ExtendInstruction {
  return typeof value === 'object' && value !== null
    && 'target' in value && isSelectorList(value.target)
    && 'partial' in value && typeof value.partial === 'boolean';
}

function isExtendTargetFact(value: unknown): value is ExtendTargetFact {
  return typeof value === 'object' && value !== null
    && 'target' in value && isSelectorList(value.target)
    && 'partial' in value && typeof value.partial === 'boolean';
}

function isSelectorBranchFact(value: unknown): value is SelectorBranchFact {
  return typeof value === 'object' && value !== null
    && 'selector' in value && isComplex(value.selector)
    && 'extensions' in value && Array.isArray(value.extensions)
    && value.extensions.every(isExtendInstruction);
}

function isSelectorListWithExtendsFact(value: unknown): value is SelectorListWithExtendsFact {
  return typeof value === 'object' && value !== null
    && 'selector' in value && isSelectorList(value.selector)
    && 'extensions' in value && Array.isArray(value.extensions)
    && value.extensions.every(isExtendInstruction);
}

function requireSelectorListWithExtendsFact(value: unknown): SelectorListWithExtendsFact {
  if (!isSelectorListWithExtendsFact(value)) {
    throw new TypeError('Less grammar produced a ruleset selector without selector facts.');
  }
  return value;
}

function isMixinPathTail(value: unknown): value is MixinPathTailFact {
  return typeof value === 'object' && value !== null && 'comb' in value
    && (value.comb === ' ' || value.comb === '>') && 'sel' in value && typeof value.sel === 'string';
}

function isMixinCallArgument(value: unknown): value is MixinCallArgument {
  return typeof value === 'object' && value !== null && 'value' in value && (isValueSlotValue(value.value) || isMixinCall(value.value))
    && (!('name' in value) || typeof value.name === 'string');
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

function isLessEachCallback(value: unknown): value is LessEachCallback {
  return typeof value === 'object' && value !== null
    && 'binding' in value && isForBinding(value.binding)
    && 'rules' in value && Array.isArray(value.rules) && value.rules.every(isStatement);
}

function mixinArgumentsFromChildren(children: readonly unknown[]): MixinCallArgument[] {
  return children.flatMap(child => Array.isArray(child)
    ? child.filter(isMixinCallArgument)
    : isMixinCallArgument(child) ? [child] : []);
}

function isMixinGuard(value: unknown): value is MixinGuard {
  return typeof value === 'object' && value !== null && 'g' in value
    && (value.g === 'cmp' || value.g === 'and' || value.g === 'or' || value.g === 'not'
      || value.g === 'truth' || value.g === 'call' || value.g === 'default');
}

function isDefaultGuardCall(value: FunctionCall): boolean {
  return value.type === 'FunctionCall' && value.name === 'default' && value.args.length === 0;
}

function isFunctionConditionFact(value: unknown): value is FunctionConditionFact {
  return typeof value === 'object' && value !== null && 'guard' in value && 'src' in value
    && typeof value.src === 'string' && isMixinGuard(value.guard)
    && 'grouped' in value && typeof value.grouped === 'boolean'
    && 'hasComparison' in value && typeof value.hasComparison === 'boolean';
}

function guardOperatorText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    return null;
  }
  const operator = value.value.trim();
  // The guard comparison vocabulary, spelled here in TS because a reducer cannot
  // read a combinator's alternation. It must stay in step with
  // `mixinGuardOperator` / `functionConditionOperator` — and it must NOT
  // be unified with the CSS media-range operator (`g.CssSyntaxQueryComparisonOperator`,
  // mediaqueries-4 §4 = `< <= = >= >`): `=~`, `=>` and `=<` are Less guard spellings
  // with no meaning in a media query, and merging the two would widen
  // `@media (width => 600px)` into acceptance.
  return ['>', '<', '>=', '<=', '=>', '=<', '=', '=~'].includes(operator) ? operator : null;
}

function foldMixinGuards(kind: 'and' | 'or', children: readonly unknown[]): MixinGuard {
  const guards = children.filter(isMixinGuard);
  const head = guards[0];
  if (head === undefined) {
    throw new TypeError('Less grammar produced an empty logical guard.');
  }
  let result = head;
  for (let index = 1; index < guards.length; index++) {
    result = { g: kind, left: result, right: guards[index]! };
  }
  return result;
}

function functionConditionSource(value: ValueSlot): string {
  if (Array.isArray(value)) {
    return value.map(part => functionConditionSource(part)).join(' ');
  }
  const node = requireValueNode(value);
  switch (node.type) {
    case 'Keyword': case 'Color': case 'Quoted': case 'Any': case 'Dimension': return node.src;
    case 'VariableReference': return `@${node.name}`;
    case 'FunctionCall': return `${node.name}(${node.args.map(functionConditionSource).join(', ')})`;
    case 'Operation': return `${functionConditionSource(node.left)} ${node.operator} ${functionConditionSource(node.right)}`;
    case 'Block': return `${node.delimiter === 'square' ? '[' : '('}${functionConditionSource(node.inner)}${node.delimiter === 'square' ? ']' : ')'}`;
    case 'SpacedValue': return node.parts.map(functionConditionSource).join(' ');
    case 'Condition': return node.src;
    default: throw new TypeError(`Less function condition cannot preserve ${node.type}.`);
  }
}

function foldFunctionCondition(kind: 'and' | 'or', children: readonly unknown[]): FunctionConditionFact {
  const facts = children.filter(isFunctionConditionFact);
  const first = facts[0];
  if (first === undefined) {
    throw new TypeError('Less function condition lost its first term.');
  }
  let guard = first.guard;
  let src = first.src;
  if (facts.length > 1 && facts.some(fact => fact.hasComparison && !fact.grouped)) {
    throw new TypeError('Less function condition comparisons must be grouped before logical operators.');
  }
  let hasComparison = first.hasComparison;
  for (const right of facts.slice(1)) {
    guard = { g: kind, left: guard, right: right.guard };
    src += ` ${kind} ${right.src}`;
    hasComparison ||= right.hasComparison;
  }
  return { guard, src, grouped: false, hasComparison };
}

function isStatement(value: unknown): value is Statement {
  // Every statement guard gates on a distinct `type`, so dispatch once on the
  // discriminant instead of trying up to thirteen guards sequentially (each of
  // which re-runs the object guard). Behaviour is identical.
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  switch (value.type) {
    case 'ImportAtRule':
      return isImportAtRule(value);
    case 'VariableDeclaration':
      return isVarDeclaration(value);
    case 'Declaration':
      return isDeclaration(value);
    case 'Rule':
      return isRule(value);
    case 'AtRuleBlock':
      return isAtRuleBlock(value);
    case 'OpaqueAtRuleBlock':
      return typeof value === 'object' && value !== null && 'type' in value && value.type === 'OpaqueAtRuleBlock';
    case 'AtRuleStatement':
      return isAtRuleStatement(value);
    case 'Plugin':
      return true;
    case 'MixinDef':
      return isMixinDef(value);
    case 'MixinCall':
      return isMixinCall(value);
    case 'Reference':
      return isReferenceCall(value);
    case 'For':
      return isFor(value);
    case 'FunctionCall':
      return isFunctionCall(value);
    default:
      return false;
  }
}

function requireStatementArray(value: unknown): Statement[] {
  if (!Array.isArray(value) || !value.every(isStatement)) {
    throw new TypeError('Less grammar produced an invalid statement list.');
  }
  return value;
}

function isFunctionCall(value: unknown): value is FunctionCall {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'FunctionCall';
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

function requireRulesetBody(children: readonly unknown[]): Statement[] {
  const body: Statement[] = [];
  for (const child of children) {
    if (!isStatement(child)) {
      throw new TypeError('Less grammar produced a non-ruleset-body child.');
    }
    body.push(child);
  }
  return body;
}

/** Retain every callback body fact except an authored empty statement. */
function requireCallbackStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (isTerminalText(child, ';')) {
      continue;
    }
    if (!isStatement(child)) {
      throw new TypeError('Less grammar produced a non-statement callback-body child.');
    }
    statements.push(child);
  }
  return statements;
}

/** Read a grammar-owned `{ … }` body without silently dropping non-body facts. */
function requireValueBlockBody(children: readonly unknown[]): Statement[] {
  const bodyStart = children.findIndex(child => isTerminalText(child, '{'));
  const bodyEnd = children.findIndex((child, index) => index > bodyStart && isTerminalText(child, '}'));
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new TypeError('Less grammar produced a detached ruleset without a delimited body.');
  }
  for (const child of children.slice(bodyEnd + 1)) {
    if (!isTerminalText(child, ';')) {
      throw new TypeError('Less grammar produced an invalid detached-ruleset suffix.');
    }
  }
  return requireCallbackStatements(children.slice(bodyStart + 1, bodyEnd));
}

/** Fold a grammar-produced flat binary chain left-to-right.  Precedence is
 * represented by which production supplies each operand; no source text is
 * recovered or re-parsed here. */
function foldOperation(children: readonly unknown[]): ValueNode {
  const first = children.find(isValueNode);
  if (first === undefined) {
    throw new TypeError('Less arithmetic grammar produced no operand.');
  }
  let result = first;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 2) {
    const operatorToken = children[index];
    const right = children[index + 1];
    if (operatorToken === undefined || !isValueNode(right)) {
      throw new TypeError('Less arithmetic grammar lost an operator operand.');
    }
    const folded = operation(requireTerminalText(operatorToken).trim(), result, right);
    const leftSpan = sourceSpanOf(result);
    const rightSpan = sourceSpanOf(right);
    result = leftSpan === undefined || rightSpan === undefined
      ? folded
      : withSourceSpan(folded, { start: leftSpan.start, end: rightSpan.end });
  }
  return result;
}

const lineComment = regex(/\/\/[^\n\r]*/);
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lessTriviaGap = oneOrMore(choice(
  label('whitespace', regex(/[ \t\n\r\f]+/)),
  label('lineComment', lineComment),
  label('blockComment', blockComment)
));

// Less comments are trivia. Line comments must not become renderable CSS
// comments; block comments may still make an otherwise empty ruleset renderable
// through body-span trivia, not through a `Comment` statement node.
// URL bodies explicitly disable trivia below, so `url(//host/path)` remains
// URL content rather than a comment.
const whitespace = trivia(lessTriviaGap);
const selectorAttributeModifierSpace = regex(/[ \t\n\r\f]+/);
const importKeyword = keywords(
  ['@-import', '@import'],
  { caseInsensitive: true, boundary: '-_0-9A-Za-z' }
);
const customValueAtKeyword = regex(/@(?:-import|-export|import|media|container|supports|(?:-[a-z]+-)?keyframes)(?![-\w])/i);
// Opaque quoted-string skippers for the grammar-level ambient `scanSkip`: a
// `scanTo`/`balanced` with no per-call skip consults these so a sentinel (an
// arg terminator, or a `functionConditionAhead` operator like `or`)
// hidden INSIDE a string is never matched. Consumes quote-to-quote including
// escapes; used only as a scan hole, so it builds nothing.
const scanSkipDoubleString = noTrivia(sequence(literal('"'), regex(/(?:[^"\\]|\\.)*/), literal('"')));
const scanSkipSingleString = noTrivia(sequence(literal('\''), regex(/(?:[^'\\]|\\.)*/), literal('\'')));
const lessOpaqueBodyBrace = balanced(
  '{',
  '}'
);
const lessOpaqueBodyCapture = noTrivia(scanTo(
  literal('}'),
  { skip: [lessOpaqueBodyBrace] }
));
// Trivia that may surround an UNAMBIGUOUS product operator (`*`/`/`/`%`):
// whitespace, `//` line comments, or `/* */` block comments. This matches CSS,
// where `*` and `/` need no whitespace and comments are freely allowed around
// them (`1/**/*/**/2`, `1 // c\n * 2`). It is deliberately NOT used by the sum
// terminal: `+`/`-` are sign-ambiguous, so — like CSS `calc()` — they require
// real whitespace and comments do NOT count (see `sumOperator`). In
// operator position this trivia is a separator the arithmetic consumes; a comment
// in value-LIST position (`1 /* c */ 2`, no operator char follows) makes the
// operator loop backtrack and is left as preserved value syntax.
const mathTrivia = trivia(lessTriviaGap);
// Function argument comments are trivia. Block comments stay out of the value
// AST and are replayed through the call argument ValueLayout when they sit on an
// argument boundary.
const functionTrivia = trivia(lessTriviaGap);
// Mixin signatures and guards are invisible definition syntax. Unlike an
// ordinary declaration value, a block comment at one of their token boundaries
// is lexical trivia (the legacy MixinArgs production used the same rule). Keep
// this wider trivia local: output-bearing value comments remain typed facts.
const mixinSignatureGap = regex(/(?:(?:[ \t\n\r\f]+)|(?:\/\/[^\n\r]*)|(?:\/\*(?:[^*]|\*(?!\/))*\*\/))+/);
const mixinGuardGap = regex(/(?:(?:[ \t\n\r\f]+)|(?:\/\/[^\n\r]*)|(?:\/\*(?:[^*]|\*(?!\/))*\*\/))+/);
const mixinSignatureTrivia = trivia(label('whitespace', mixinSignatureGap));
const mixinGuardTrivia = trivia(label('whitespace', mixinGuardGap));
// Selector grammar components used inside functional pseudos retain their
// established lexical-comment behavior.
const staticSelectorTrivia = trivia(lessTriviaGap);
const compoundSelectorTrivia = trivia(oneOrMore(choice(
  label('lineComment', lineComment),
  label('blockComment', blockComment)
)));
const atPreludeCommentTrivia = trivia(oneOrMore(label('blockComment', blockComment)));
const customValueCommentTrivia = trivia(oneOrMore(label('blockComment', blockComment)));
// Outer selector comments are lexical trivia. Render-time body/source spans own
// whether a trivia-only body remains output-bearing; selectors do not invent
// comment simple selectors.
const outerSelectorTrivia = trivia(lessTriviaGap);
const staticSimpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)/);
const staticIdentifier = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
// A selector simple that contains Less interpolation stays one selector atom.
// Its literal runs deliberately exclude `.`, `#`, `[`, `:`, whitespace, and
// combinators: those have separate selector grammar roles and must not be
// flattened into an interpolation template.
const interpolatedSelectorPrefix = regex(/[.#](?:-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*)?/);
const interpolatedSelectorTail = regex(/(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
// A bare `@{name}` is a whole-selector interpolation only. Keeping the
// delimiter lookahead here prevents it from consuming the interpolation prefix
// of an unmodelled namespace/attribute selector such as `@{ns}|a`.
const bareInterpolatedSelectorEnd = regex(/(?=[ \t\n\r\f]*(?:[,{]))/);
// Semantically identical to the production Less `ampToken` terminal. A static ampersand
// is already the canonical AST representation: `SimpleSelector.text` retains `&` and
// core's selector path identifies parent references from that text.  The
// parenthesized and interpolation forms stay outside this static slice
// until their typed semantic payloads are constructed by grammar reductions.
const staticAmpersand = regex(/&[-_a-zA-Z0-9\u0080-\uffff]*/);
const keyframeEndpoint = keywords(
  ['from', 'to'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
);
const keyframePercent = regex(/[-+]?(?:\d+\.?\d*|\.\d+)%/);
// Ordered longest-first, identical to the production Less `combinator`
// terminal. A missing authored token between compounds is the canonical
// descendant relation; grammar trivia provides the separating whitespace.
const staticCombinator = keywords(['||', '>', '+', '~', '|']);
// A leading `|` belongs to namespace selector syntax (`|a`), not a relative
// selector. Keep relative starts to the Less nested-selector combinators.
const relativeSelectorCombinator = keywords(['>', '+', '~']);
const pseudoDelimiter = keywords(['::', ':']);
const commaOrSemicolon = keywords([',', ';']);
const eachCallbackSigil = keywords(['.', '#']);
// The production Less `urlInner` terminal, narrowed only at a dynamic Less
// opener. A leading `@name` / `@{…}` belongs to the unimplemented Reference /
// interpolation path, so this static slice rejects it instead of
// misrepresenting it as `Any`. Other URL-token escapes and control boundaries
// remain the production terminal exactly.
const staticUrlText = regex(/(?!@(?:-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|\{))(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
// Less accepts formatting whitespace in an unquoted data URL and preserves it
// in the URL payload (for example, a wrapped base64 body). CSS's shared
// unquoted URL terminal remains strict: this is a Less-only Parseman leaf.
// Keep the production URL exclusions intact—quotes, unescaped parentheses,
// controls, and malformed escapes never become opaque URL text.
const staticDataUrlText = regex(/data:(?:[^"'()\\\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+?(?=[ \t\n\r\f]*\))/i);
// URL-edge whitespace is deliberately not the Less `whitespace` production:
// that production also recognizes `//` comments, while `url(//cdn.example)`
// is an ordinary URL payload.
const urlBoundaryWhitespace = regex(/[ \t\n\r\f]+/);
const urlFunctionOpen = token(noTrivia(regex(/url\(/i)));
const staticTailText = regex(/[^()\[\]{};@'"]+/);
const importOption = keywords(
  ['reference', 'optional', 'once', 'multiple', 'inline', 'css', 'less'],
  { caseInsensitive: true, boundary: '-_0-9A-Za-z' }
);
const inlineJavaScriptBody = regex(/(?:[^`\\]|\\[\s\S])*/);
// Math productions run under `noTrivia`, so their operators own precisely the
// gap that distinguishes arithmetic from a Less space-list. `leaf()` keeps the
// comment-aware structural gap hidden from `foldOperation`: it receives the
// same flat `*`/`/`/`%` terminal stream it did before, with no scanner or
// post-parse text recovery. Keep the sum terminal below unchanged: its glued
// numeric-sign lookahead is intentional Less syntax, not an operator gap.
const productOperator = leaf(
  noTrivia(sequence(optional(mathTrivia), keywords(['*', '/', '%']), optional(mathTrivia))),
  children => children[1] as string
);
const topProductOperator = leaf(
  noTrivia(sequence(optional(mathTrivia), keywords(['*', '%']), optional(mathTrivia))),
  children => children[1] as string
);
// A preserved top-level Less slash is not arithmetic in parens-division mode,
// but authored whitespace around `/` is still part of that opaque value. Keep
// the boundary explicit so `10px / 2` does not flatten into a plain ValueSlot
// array before the evaluator can apply the math-mode rule.
const preservedSlashGap = regex(/[ \t\n\r\f]+/);
const preservedSlashBoundary = leaf(
  sequence(
    optional(preservedSlashGap),
    literal('/'),
    optional(preservedSlashGap)
  ),
  (children) => {
    if (!Array.isArray(children)) {
      throw new TypeError('Less slash boundary produced a non-sequence value.');
    }
    return {
      before: staticText(children[0]),
      after: staticText(children[2])
    };
  }
);
// CSS rule (kept, NOT widened for comments): `+`/`-` are ambiguous between a
// binary operator and a leading sign, so — like CSS `calc()` — they require REAL
// whitespace on both sides (or Less's glued-to-a-number form `1-2`). Comments do
// NOT count as that whitespace (`1/**/-/**/2` is NOT math), unlike the unambiguous
// `*`/`/`/`%` product operators above, which DO admit comment trivia. The three
// arms are symmetric-ws | glued-to-number | asymmetric-reject guard.
const sumOperator = regex(/(?:[ \t\n\r\f]+[-+][ \t\n\r\f]+|[-+](?=[0-9.])|[ \t\n\r\f]*[-+](?![0-9.])[ \t\n\r\f]*)/);
// Generic Less at-rule names are grammar terminals. This grammar keeps
// their prelude/body semantic only where the existing canonical AST has a
// truthful structured representation; it never captures a block as text.
// Imports are typed facts with stricter target validation. Excluding their names
// here prevents a malformed import from falling through as a generic at-rule.
const charsetAtRuleName = word(
  '@charset',
  '-_0-9A-Za-z',
  { caseInsensitive: true }
);
const layerAtRuleName = word(
  '@layer',
  '-_0-9A-Za-z',
  { caseInsensitive: true }
);
const atRuleName = regex(/@(?!(?:-import|-export|import|layer|media|container|supports|(?:-[a-z]+-)?keyframes)(?![-\w]))-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
const staticAtRuleStatementName = regex(/@(?!(?:-import|-export|import|media|container|supports|(?:-[a-z]+-)?keyframes)(?![-\w]))-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
const mixinName = regex(/[.#]-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const mixinPathCombinator = regex(/>/);
const mixinGuardOperator = regex(/>=|<=|=>|=<|=~|[<>=]/);
const functionConditionStop = regex(/[ \t\n\r\f]*(?:>=|<=|=>|=<|=~|[<>=]|(?:and|or)(?![-\w]))/i);
const functionConditionOperator = regex(/[ \t\n\r\f]*(?:>=|<=|=>|=<|=~|[<>=])[ \t\n\r\f]*/);
const functionConditionAnd = regex(/[ \t\n\r\f]*and(?![-\w])[ \t\n\r\f]*/i);
const functionConditionOr = regex(/[ \t\n\r\f]*or(?![-\w])[ \t\n\r\f]*/i);
const functionConditionNot = word(
  'not',
  '-_0-9A-Za-z',
  { caseInsensitive: true }
);
// Built on `mixinGuardOperator` rather than re-spelling the guard comparison
// alternation: this is only ever consumed inside `not(not(…))`, so the extra frames
// roll back and contribute no child. The keyword arm keeps its own regex — it is a
// `scanTo` sentinel, so it lands at arbitrary offsets and needs the LEADING
// `(?<![-\w])` boundary a token-position terminal does not carry.
const functionConditionAhead = choice(mixinGuardOperator, regex(/(?<![-\w])(?:and|or|not)(?![-\w])/i));
// A non-selector functional pseudo is still one canonical SimpleSelector leaf.
// A pseudo body cannot quietly turn a Less variable read into static bytes.
// Keep only `@` that cannot start `@{...}`, `@@name`, or `@name`; nested
// delimiters, quoted strings, and comments are reduced below rather than
// recovered from source after recognition.
const staticPseudoChunk = regex(/(?:[^()\[\]'"@/]|@(?![@{_a-zA-Z\u0080-\uffff-])|\/(?!\*))+/);
// General-enclosed content is a raw template assembled by Parseman: structural
// delimiters, strings, comments, and `@{…}` each have their own grammar arm.
// This terminal owns only the remaining literal bytes; no completed source span
// is scanned or re-parsed after recognition.
const generalEnclosedText = regex(/(?:\\[\s\S]|\/(?!\*)|@(?!\{)|[^\\/'"@()[\]{}]+)+/);
const generalEnclosedDoubleChunk = regex(/(?:\\[\s\S]|@(?!\{)|[^"\\@])+/);
const generalEnclosedSingleChunk = regex(/(?:\\[\s\S]|@(?!\{)|[^'\\@])+/);
const lessSupportedVariableName = regex(/[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessUnsupportedNumericVariableName = node<UnsupportedVariableNameFact>(
  'UnsupportedVariableName',
  regex(/[0-9][-_a-zA-Z0-9\u0080-\uffff]*/),
  children => ({ unsupportedVariableName: requireToken(children[0]).value })
);
const lessDashVariableName = leaf(
  noTrivia(sequence(literal('-'), optional(regex(/[-_a-zA-Z0-9\u0080-\uffff]+/)))),
  (children) => {
    if (!Array.isArray(children)) {
      throw new TypeError('Less dash variable name lost its grammar facts.');
    }
    const tail = children[1];
    return tail === undefined || tail === null
      ? { unsupportedVariableName: '-' }
      : `-${requireTerminalText(tail)}`;
  }
);
const lessVariableName = choice(lessUnsupportedNumericVariableName, lessSupportedVariableName, lessDashVariableName);

const lessGrammarFactory = (g: LessInputRules & SharedCssSyntax) => {
  const caseOf = makeWhen({ caseInsensitive: true });
  const lessWord = makeWord('-_0-9A-Za-z');
  const lessCaseWord = makeWord('-_0-9A-Za-z', { caseInsensitive: true });
  const whenGuardAhead = sequence(optional(regex(/[ \t\n\r\f]+/)), lessCaseWord('when'));
  const mixinGuardDefaultCall = regex(/default[ \t\n\r\f]*\([ \t\n\r\f]*\)(?![-\w])/);
  // `@@name` is a variable reference whose lookup name is the resolved value
  // of `@name`; retain that two-step lookup as a typed AST edge.  The doubled
  // sigil is glued just like the production `nestedRef`, so trivia cannot turn
  // it into two unrelated tokens.
  const IndirectVariableReference = node<VarIndirect>(
    'Reference',
    noTrivia(sequence(literal('@@'), lessVariableName)),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.end);
      return withSourceSpan(
        varIndirect(variableReference(name, 'scoped'), 'scoped'),
        span
      );
    }
  );
  const VariableReference = node<VariableReference>(
    'Reference',
    sequence(literal('@'), lessVariableName),
    (children, _fields, span) => withSourceSpan(
      variableReference(requireSupportedVariableName(children[1], span.start, span.end), 'scoped'),
      span
    )
  );
  const BareVariableInterpolation = node<never>(
    'BareVariableInterpolation',
    noTrivia(sequence(literal('@'), lessVariableName)),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.end);
      throw new LessBareVariableInterpolationError(span.start, span.end, name);
    }
  );
  const PropertyReference = node<ValueNode>(
    'Reference',
    noTrivia(sequence(literal('$'), g.LessSyntaxIdentifier)),
    (children, _fields, span) => withSourceSpan(propertyReference(requireToken(children[1]).value), span)
  );
  const InterpolationAccessor = choice(
    // Less `[]` selects the final declaration of a namespace/mixin result.
    // Lower it directly to the established negative-one index contract; the
    // existing Reference evaluator already applies negative indexes from the
    // end of its typed declaration map.
    node<InterpolationAccessorFact>(
      'InterpolationLastAccessor',
      noTrivia(literal('[]')),
      () => ({ key: -1, keyKind: 'index', src: '-1' })
    ),
    node<InterpolationAccessorFact>(
      'InterpolationIndexAccessor',
      noTrivia(sequence(literal('['), g.LessSyntaxInterpIndexKey, literal(']'))),
      (children) => {
        const text = requireToken(children[1]).value;
        return { key: Number(text), keyKind: 'index', src: text };
      }
    ),
    // `$@name` is a property-map key selected by the VALUE of `@name`, e.g.
    // `#namespace[$@prop-name]`. Keep both the indirection and the property
    // namespace explicit: the existing resolver evaluates this key, then uses
    // `keyKind: 'prop'` to select the declaration-member map.
    node<InterpolationAccessorFact>(
      'InterpolationPropertyVariableAccessor',
      noTrivia(sequence(literal('['), literal('$'), g.VariableReference, literal(']'))),
      (children) => {
        const key = requireValueNode(children[2]);
        if (!isVarRef(key)) {
          throw new TypeError('Less property-variable map key must retain its variable reference.');
        }
        return { key, keyKind: 'prop', src: `$@${key.name}` };
      }
    ),
    node<InterpolationAccessorFact>(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(literal('['), choice(g.IndirectVariableReference, g.VariableReference, g.PropertyReference, g.LessSyntaxInterpBareKey), literal(']'))),
      (children) => {
        const key = children[1];
        if (isVarIndirect(key)) {
          const nameRef = key.nameRef;
          if (!isVarRef(nameRef)) {
            throw new TypeError('Less indirect map key must retain its variable reference.');
          }
          return { key, keyKind: 'var', src: `@@${nameRef.name}` };
        }
        if (isVarRef(key)) {
          return { key, keyKind: 'var', src: `@${key.name}` };
        }
        if (isPropRef(key)) {
          return { key, keyKind: 'prop', src: key.raw };
        }
        const text = requireToken(key).value;
        return { key: keyword(text), keyKind: 'prop', src: text };
      }
    )
  );
  // Left-factored `@`+name so the ubiquitous plain `@var` is parsed ONCE: the
  // accessor tails are optional, so a bare variable reference no longer parses
  // `@name`, fails a required tail, backtracks, and re-parses `@name` through a
  // separate plain-reference production. With tails this reduces to the tailed
  // Reference node; without, to the plain VariableReference (identical shapes).
  const VariableReferenceChain = node<ValueNode>(
    'Reference',
    noTrivia(sequence(literal('@'), lessVariableName, optional(oneOrMore(g.ReferenceTail)))),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.end);
      const base = variableReference(name, 'scoped');
      return children.length > 2
        ? withSourceSpan(referenceWithTails(base, `@${name}`, children.slice(2)), span)
        : withSourceSpan(base, span);
    }
  );
  const MixinPathTail = node<MixinPathTailFact>(
    'MixinPathTail',
    sequence(optional(mixinPathCombinator), mixinName),
    (children) => {
      const combToken = children.find(child => isTerminalText(child, '>'));
      return {
        comb: combToken === undefined ? ' ' : '>',
        sel: requireToken(children.at(-1)).value
      };
    }
  );
  const UnsupportedDashVariableInterpolation = node<never>(
    'UnsupportedVariableName',
    noTrivia(literal('@{-}')),
    (_children, _fields, span) => {
      throw new LessUnsupportedVariableNameError(span.start, span.end, '-');
    }
  );
  const VariableInterpolation = node<InterpolationFact>(
    'VariableInterpolation',
    choice(
      UnsupportedDashVariableInterpolation,
      noTrivia(sequence(literal('@{'), lessVariableName, many(g.InterpolationAccessor), literal('}')))
    ),
    (children, _fields, span) => interpolationFactFromChildren(children, span)
  );
  const PropertyInterpolation = node<InterpolationFact>(
    'PropertyInterpolation',
    noTrivia(sequence(literal('${'), g.LessSyntaxInterpHead, many(g.InterpolationAccessor), literal('}'))),
    (children, _fields, span) => interpolationFactFromChildren(children, span)
  );
  const Interpolation = node<InterpolationFact>(
    'Interpolation',
    choice(g.VariableInterpolation, g.PropertyInterpolation),
    children => requireInterpolationFact(children[0])
  );
  // A complete Less at-rule header can be deferred through one `@{…}` lookup.
  // Keep that as the existing typed Interpolation value rather than treating a header
  // as raw text; dedicated query/supports reducers still own static structure.
  const AtRuleInterpolation = node<Interpolation>(
    'AtRuleInterpolation',
    g.VariableInterpolation,
    (children) => {
      const fact = requireInterpolationFact(children[0]);
      return interpolation([{ ref: fact.ref, unquote: true }]);
    }
  );
  const interpolatedValueTail = choice(g.LessSyntaxInterpolatedValueTail, g.Interpolation);
  const InterpolatedValue = node<Interpolation>(
    'InterpolatedValue',
    noTrivia(sequence(
      g.Interpolation,
      many(interpolatedValueTail)
    )),
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const Quoted = node<Quoted | Interpolation>(
    'Quoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.LessSyntaxQuotedDoubleChunk, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.LessSyntaxQuotedSingleChunk, literal('@'), literal('$'))), literal('\'')))
    ),
    (children) => {
      const open = requireToken(children[0]);
      if (!children.some(isInterpolationFact)) {
        const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
        return quoted(`${open.value}${value}${open.value}`, value, open.value, false);
      }
      const parts = interpolationPartsFrom(children.slice(1, -1), true, open.value);
      appendInterpolationLiteral(parts, open.value);
      return interpolation(parts);
    }
  );
  // Static (interpolation-free) single/double-quoted body shared by the quoted
  // value, functional-pseudo, and attribute-selector static grammars.
  const staticQuotedBody = choice(
    noTrivia(sequence(literal('"'), many(choice(g.LessSyntaxQuotedDoubleChunk, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('"'))),
    noTrivia(sequence(literal('\''), many(choice(g.LessSyntaxQuotedSingleChunk, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('\'')))
  );
  const StaticQuoted = node<Quoted>(
    'Quoted',
    staticQuotedBody,
    (children) => {
      const open = requireToken(children[0]);
      const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
      return quoted(`${open.value}${value}${open.value}`, value, open.value, false);
    }
  );
  // A static Less `~"…"` / `~'…'` is an ordinary quoted value with the
  // existing escaped flag. Its interpolation-bearing form is a structural,
  // unquoted template—never a recovered source string.
  const EscapedQuoted = node<Quoted | Interpolation>(
    'Quoted',
    choice(
      noTrivia(sequence(literal('~"'), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.LessSyntaxQuotedDoubleChunk, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('~\''), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.LessSyntaxQuotedSingleChunk, literal('@'), literal('$'))), literal('\'')))
    ),
    (children) => {
      const opener = requireToken(children[0]).value;
      const quote = opener[1];
      if (quote !== '"' && quote !== '\'') {
        throw new TypeError('Less escaped quote lost its quote delimiter.');
      }
      if (children.some(isInterpolationFact)) {
        return interpolation(interpolationPartsFrom(children.slice(1, -1), true));
      }
      const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
      return quoted(`${opener}${value}${quote}`, value, quote, true);
    }
  );
  const StaticUrl = node<Url>(
    'Url',
    noTrivia(sequence(
      urlFunctionOpen,
      optional(urlBoundaryWhitespace),
      optional(field('body', choice(g.EscapedQuoted, g.Quoted, staticDataUrlText, staticUrlText))),
      optional(urlBoundaryWhitespace),
      literal(')')
    )),
    (_children, fields) => {
      const captured = fields?.body;
      if (Array.isArray(captured)) {
        throw new TypeError('Less static URL produced repeated body facts.');
      }
      const body = captured?.value;
      if (body === undefined) {
        return url(any(''));
      }
      if (isQuoted(body) || isInterp(body)) {
        return url(body);
      }
      return url(any(requireTerminalText(body)));
    }
  );
  // Bare `@name` and `@{name}` URL bodies are structural Less values, not
  // opaque URL text. The interpolation branch retains its literal suffixes as
  // `Interpolation` parts, so neither form needs a source scan or a value re-parser.
  const UrlInterpolation = node<Interpolation>(
    'UrlInterpolation',
    noTrivia(choice(
      sequence(g.VariableReference, oneOrMore(choice(staticUrlText, g.Interpolation))),
      sequence(g.Interpolation, many(choice(staticUrlText, g.Interpolation)))
    )),
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const DynamicUrl = node<Url>(
    'Url',
    sequence(urlFunctionOpen, choice(g.UrlInterpolation, g.VariableReference), literal(')')),
    children => url(requireValueNode(children[1]))
  );
  const RoutedDynamicUrl = node<Url>(
    'Url',
    sequence(routed(), choice(g.UrlInterpolation, g.VariableReference), literal(')')),
    children => url(requireValueNode(children[1]))
  );
  const RoutedStaticUrl = node<Url>(
    'Url',
    noTrivia(sequence(
      routed(),
      optional(urlBoundaryWhitespace),
      optional(field('body', choice(g.EscapedQuoted, g.Quoted, staticDataUrlText, staticUrlText))),
      optional(urlBoundaryWhitespace),
      literal(')')
    )),
    (_children, fields) => {
      const captured = fields?.body;
      if (Array.isArray(captured)) {
        throw new TypeError('Less routed static URL produced repeated body facts.');
      }
      const body = captured?.value;
      if (body === undefined) {
        return url(any(''));
      }
      if (isQuoted(body) || isInterp(body)) {
        return url(body);
      }
      return url(any(requireTerminalText(body)));
    }
  );
  const UrlTarget = choice(g.DynamicUrl, g.StaticUrl);
  const ImportOption = node<Any>(
    'ImportOption',
    importOption,
    children => any(requireToken(children[0]).value)
  );
  const ImportOptions = node<List>(
    'ImportOptions',
    sequence(
      literal('('),
      oneOrMoreSep(
        field('option', g.ImportOption),
        literal(',')
      ),
      literal(')')
    ),
    (_children, fields) => {
      const options = requireFields(fields, 'option').map((option) => {
        const value = option.value;
        if (!isAny(value)) {
          throw new TypeError('Less grammar produced a non-static import option.');
        }
        return value;
      });
      return list(options, ',');
    }
  );
  const StaticTailParen = noTrivia(sequence(
    literal('('),
    many(choice(staticTailText, g.Quoted, g.StaticTailGroup)),
    literal(')')
  ));
  const StaticTailGroup = g.StaticTailParen;
  const StaticTail = noTrivia(oneOrMore(choice(
    staticTailText,
    g.Quoted,
    g.StaticTailGroup
  )));
  // An import postlude's variable-bearing media feature has an exact typed
  // shape. Keep this small prelude production here because the generic query
  // family is defined after `ImportStatement`; no forward grammar reference
  // may poison the document's direct start rule.
  const ImportQueryTail = node<ValueNode>(
    'ImportQueryTail',
    sequence(literal('('), g.CssSyntaxProperty, regex(/:[ \t\n\r\f]*/), g.VariableReference, literal(')')),
    children => block(operation(':', keyword(requireToken(children[1]).value), requireValueNode(children[3])))
  );
  const quotedOrUrlTarget = choice(g.EscapedQuoted, g.Quoted, UrlTarget);
  const ImportTarget = node<Quoted | Url | Interpolation>(
    'ImportTarget',
    quotedOrUrlTarget,
    (children) => {
      const target = children.find(child => isQuoted(child) || isUrl(child) || isInterp(child));
      if (target === undefined) {
        throw new TypeError('Less import target lost its typed value.');
      }
      return target;
    }
  );
  const ImportTail = node<unknown>(
    'ImportTail',
    choice(
      ImportQueryTail,
      g.AtRuleInterpolation,
      g.StaticTail
    ),
    children => children.length === 1 ? children[0] : children
  );
  const ImportStatement = node<ImportAtRule>(
    'ImportAtRule',
    sequence(importKeyword, optional(g.ImportOptions), g.ImportTarget, optional(field('tail', g.ImportTail)), literal(';')),
    (children, fields, _span) => {
      // Every accepted import fact is a grammar child or a field capture. In
      // particular, the opaque tail is reconstructed from terminal values only
      // after the recursive grammar has closed every delimiter.
      const keyword = requireToken(children[0]);
      const options = children.find((child): child is List => typeof child === 'object' && child !== null && 'type' in child && child.type === 'List') ?? null;
      const target = children.find((child): child is Quoted | Url | Interpolation => isQuoted(child) || isUrl(child) || isInterp(child));
      if (target === undefined) {
        throw new TypeError('Less grammar produced no import target.');
      }
      const tailField = fields?.tail;
      // The variable-bearing query feature and a complete `@{…}` tail are
      // structural values. Mixed text and interpolation stays rejected until
      // ImportAtRule has a typed segment model; do not flatten it back into
      // opaque source bytes.
      const tailValue = tailField === undefined ? undefined : requireField(fields, 'tail').value;
      const tail = tailValue === undefined ? null : isValueNode(tailValue) ? tailValue : any(staticText(tailValue));
      return importAtRule(keyword.value, target, options, null, tail);
    }
  );
  // `@plugin` is a compile-time directive, not an unknown CSS at-rule. Its
  // target and the *inner* option string are grammar facts so the evaluator
  // never rediscovers either from raw prelude bytes. GeneralEnclosedContent
  // recursively closes delimiters and preserves arbitrary option text as
  // interpolation literal/ref segments, matching Less's opaque option string.
  const PluginDirective = node<Plugin>(
    'Plugin',
    sequence(
      word(
        '@plugin',
        '-_0-9A-Za-z',
        { caseInsensitive: true }
      ),
      optional(sequence(literal('('), field('options', g.GeneralEnclosedContent), literal(')'))),
      field('target', quotedOrUrlTarget),
      literal(';')
    ),
    (_children, fields) => {
      const target = requireField(fields, 'target').value;
      if (!isQuoted(target) && !isUrl(target) && !isInterp(target)) {
        throw new TypeError('Less Plugin lost its typed target.');
      }
      const optionValue = fields?.options === undefined ? null : requireField(fields, 'options').value;
      if (optionValue !== null && !isInterp(optionValue)) {
        throw new TypeError('Less Plugin options must remain an interpolation template.');
      }
      return { type: 'Plugin', target, options: optionValue };
    }
  );
  // A call arm here is a COMPLETE variable value, so it must not claim the call
  // half of a lookup-bearing mixin reference (`#m(@a)[]`). Without this the
  // choice commits to the bare call and the trailing `[…]` can never be read,
  // even though Value already recognizes the whole reference —
  // which is why the same value parsed in property position and not here.
  const mixinValueWithoutLookup = not(noTrivia(literal('[')));
  const variableName = node<string>(
    'VariableName',
    noTrivia(sequence(literal('@'), lessVariableName)),
    (children, _fields, span) => `@${requireSupportedVariableName(children[1], span.start, span.end)}`
  );
  const VarDeclaration = node<VariableDeclaration>(
    'VarDeclaration',
    sequence(variableName, literal(':'), choice(sequence(g.NamespacedMixinValue, mixinValueWithoutLookup), g.ImportantValue, sequence(g.FlatMixinCall, mixinValueWithoutLookup), sequence(not(literal('{')), g.VariableValue)), literal(';')),
    (children, _fields, span) => {
      const name = requireTerminalText(children[0]).slice(1);
      const value = children[2];
      return withSourceSpan(
        variableDeclaration(name, isMixinCall(value) ? value : variableValueSlot(value), { mode: 'declare' }),
        span
      );
    }
  );
  const ValueBlockDeclaration = node<VariableDeclaration>(
    'VarDeclaration',
    sequence(
      variableName,
      literal(':'),
      g.ValueBlock
    ),
    (children, _fields, span) => {
      const name = requireTerminalText(children[0]).slice(1);
      return withSourceSpan(
        variableDeclaration(
          name,
          valueSlot(requireValueNode(children[2])),
          { mode: 'declare' }
        ),
        span
      );
    }
  );
  const Keyword = node<ValueNode>(
    'Keyword',
    g.LessSyntaxKeyword,
    children => keyword(requireToken(children[0]).value)
  );
  const NamedColor = node<ValueNode>(
    'NamedColor',
    g.LessSyntaxNamedColor,
    children => color(requireToken(children[0]).value)
  );
  const Color = node<ValueNode>(
    'Color',
    g.CssSyntaxHexColor,
    children => color(requireToken(children[0]).value)
  );
  const Dimension = node<ValueNode>(
    'Dimension',
    noTrivia(sequence(g.CssSyntaxNumber, optional(g.CssSyntaxDimensionUnit))),
    (children, _fields, span) => {
      const numberText = requireToken(children[0]).value;
      const unit = children.length > 1 ? requireToken(children[1]).value : '';
      return withSourceSpan(
        dimension(Number(numberText), unit, `${numberText}${unit}`),
        span
      );
    }
  );
  // CSS unicode-range is one opaque CSS token, not Less arithmetic. It belongs
  // in the value-term layer, but intentionally not the math-atom layer: Less
  // rejects `U+0-7F + 1` rather than applying numeric operations to the range.
  const UnicodeRange = node<Any>(
    'UnicodeRange',
    g.CssSyntaxUnicodeRange,
    children => any(requireToken(children[0]).value)
  );
  // CSS declaration hacks such as `#000 \\9` are a real one-token value
  // suffix. Keep the escape structural and narrow; this is not a raw-value
  // fallback or a second scanner for declaration text.
  const EscapeValue = node<Any>(
    'EscapeValue',
    regex(/(?:\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/),
    children => any(requireToken(children[0]).value)
  );
  const PercentEscape = node<Any>(
    'PercentEscape',
    g.LessSyntaxPercentEscape,
    children => any(requireToken(children[0]).value)
  );
  // `@page` pseudo-pages are header atoms, not selector syntax in a value
  // position. Preserve their one-token spelling without widening generic values.
  const PagePseudo = node<Any>(
    'PagePseudo',
    sequence(literal(':'), g.LessSyntaxKeyword),
    children => any(`:${requireToken(children[1]).value}`)
  );
  // Unknown at-rule functions are intentionally permissive.  This legacy Less
  // argument spelling is one opaque grammar fact—not two quoted strings around
  // a value—and remains available to any unknown function name.
  const DoubledQuoteArgument = node<Any>(
    'DoubledQuoteArgument',
    sequence(literal('""'), regex(/[^"()]+/), literal('""')),
    children => any(`""${requireToken(children[1]).value}""`)
  );
  // This is the AST reduction of the public Less `ArgCondition` grammar. Its
  // operands are bounded ordinary values; comparison/logical structure is added
  // only after those values have been recognized.
  const FunctionConditionOperand = node<ValueNode>(
    'FunctionConditionOperand',
    oneOrMore(sequence(not(functionConditionStop), g.TopSum)),
    (children) => {
      const values = children.filter(isValueNode);
      if (values.length === 0) {
        throw new TypeError('Less function condition lost its operand.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const FunctionConditionParen = node<FunctionConditionFact>(
    'FunctionConditionParen',
    sequence(literal('('), g.FunctionConditionOr, literal(')')),
    (children) => {
      const inner = children.find(isFunctionConditionFact);
      if (inner === undefined) {
        throw new TypeError('Less function condition lost its parenthesized operand.');
      }
      return { guard: inner.guard, src: `(${inner.src})`, grouped: true, hasComparison: inner.hasComparison };
    }
  );
  const FunctionConditionTerm = node<FunctionConditionFact>(
    'FunctionConditionTerm',
    sequence(
      optional(functionConditionNot),
      choice(g.FunctionConditionParen, g.FunctionConditionOperand),
      optional(sequence(functionConditionOperator, choice(g.FunctionConditionParen, g.FunctionConditionOperand)))
    ),
    (children) => {
      const nested = children.filter(isFunctionConditionFact);
      const values = children.filter(isValueNode);
      const operator = children.map(guardOperatorText).find((value): value is string => value !== null)?.trim();
      const left = nested[0] ?? (values[0] === undefined ? undefined : { guard: { g: 'truth' as const, value: values[0] }, src: functionConditionSource(values[0]), grouped: false, hasComparison: false });
      const right = nested[1] ?? (values.length > 1 && values[1] !== undefined ? { guard: { g: 'truth' as const, value: values[1] }, src: functionConditionSource(values[1]), grouped: false, hasComparison: false } : undefined);
      if (left === undefined) {
        throw new TypeError('Less function condition term lost its left operand.');
      }
      let guard: MixinGuard;
      let src: string;
      if (operator === undefined) {
        guard = left.guard;
        src = left.src;
      } else {
        if (right === undefined) {
          throw new TypeError('Less comparison requires value operands.');
        }
        if (nested.length === 0 && children.some(child => typeof child === 'object' && child !== null && 'value' in child && child.value === 'not')) {
          throw new TypeError('Less function condition `not` requires a grouped condition operand.');
        }
        const leftValue = left.guard.g === 'truth' ? left.guard.value : condition(left.guard, left.src);
        const rightValue = right.guard.g === 'truth' ? right.guard.value : condition(right.guard, right.src);
        guard = { g: 'cmp', op: operator, left: leftValue, right: rightValue };
        src = `${left.src} ${operator} ${right.src}`;
      }
      const negated = children.some(child => typeof child === 'object' && child !== null && 'value' in child && child.value === 'not');
      const hasComparison = operator !== undefined || left.hasComparison || right?.hasComparison === true;
      const grouped = operator === undefined && left.grouped;
      return negated
        ? { guard: { g: 'not', inner: guard }, src: `not(${src})`, grouped, hasComparison }
        : { guard, src, grouped, hasComparison };
    }
  );
  const FunctionConditionAnd = node<FunctionConditionFact>(
    'FunctionConditionAnd',
    sequence(g.FunctionConditionTerm, many(sequence(functionConditionAnd, g.FunctionConditionTerm))),
    children => foldFunctionCondition('and', children)
  );
  const FunctionConditionOr = node<FunctionConditionFact>(
    'FunctionConditionOr',
    sequence(g.FunctionConditionAnd, many(sequence(functionConditionOr, g.FunctionConditionAnd))),
    children => foldFunctionCondition('or', children)
  );
  const FunctionCondition = node<ValueNode>(
    'FunctionCondition',
    g.FunctionConditionOr,
    (children) => {
      const fact = children.find(isFunctionConditionFact);
      if (fact === undefined) {
        throw new TypeError('Less function condition lost its fact.');
      }
      return condition(fact.guard, fact.src);
    }
  );
  // A math expression may claim a function argument only at an actual argument
  // boundary. A plain delimiter keeps the final-argument arithmetic fast path;
  // a comment-separated comma/semicolon boundary is trivia owned by the
  // enclosing function call, not a value child.
  const functionArgumentBoundaryAhead = choice(
    regex(/(?=[,;)])/),
    peek(parser({ trivia: functionTrivia }, choice(literal(','), literal(';'))))
  );
  const FunctionScalarArgument = node<ValueNode>(
    'FunctionScalarArgument',
    sequence(g.MathSum, functionArgumentBoundaryAhead),
    children => requireValueNode(children[0])
  );
  const FunctionArgument = node<ValueSlot>(
    'FunctionArgument',
    choice(
      sequence(not(not(sequence(scanTo(choice(functionConditionAhead, regex(/[,;)]/))), functionConditionAhead))), g.FunctionCondition),
      g.FunctionScalarArgument,
      g.ArgumentValueSequence
    ),
    (children) => {
      const value = children.find(isValueSlotValue);
      if (value === undefined) {
        throw new TypeError('Less function argument lost its value.');
      }
      return value;
    }
  );
  // Generic Less function calls carry one flat positional argument vector.
  // Unlike mixin arguments, commas and semicolons do not create nested groups
  // here: either delimiter separates the next typed argument, and evaluation
  // canonicalizes both to the ordinary function-call comma spelling.
  // A final delimiter has no following argument, so it intentionally has no
  // ValueLayout boundary to retain.
  // The `separator` capture records the authored delimiter gap for byte-faithful
  // replay; it is layout, never a substitute for trivia. The following argument
  // therefore stays under ambient trivia (`functionTrivia` here), so a `//` line
  // comment after a delimiter is skipped exactly as it is before the first
  // argument. Block comments on argument boundaries stay in that trivia stream
  // and are replayed through ValueLayout; only comments inside a value sequence
  // still reach ArgumentValueSequence.
  const functionArgumentSeparator = field('separator', regex(/[;,][ \t\n\r\f]*/));
  const trailingFunctionArgumentSeparator = field('trailingSeparator', noTrivia(regex(/[;,][ \t\n\r\f]*/)));
  const functionArgument = choice(
    g.DoubledQuoteArgument,
    g.ValueBlock,
    g.FunctionArgument
  );
  const FunctionArguments = optional(sequence(
    oneOrMoreSep(functionArgument, functionArgumentSeparator),
    optional(trailingFunctionArgumentSeparator)
  ));
  // Value-position identifiers and glued function openers share one lexical
  // family. Parse that opener once, then route by the returned text. Branch
  // nodes own `routed()` so the consumed opener remains inside the selected CST
  // node, and `foo (` still stays keyword + paren because the `(` is not glued
  // into the opener.
  const identOrFunction = token(noTrivia(sequence(g.LessSyntaxInterpolatedValueStart, optional(literal('(')))));
  const genericFunctionOpen = token(noTrivia(sequence(
    not(keywords(['url(', 'calc('], { caseInsensitive: true })),
    g.LessSyntaxInterpolatedValueStart,
    literal('(')
  )));
  const GenericFunction = node<FunctionCall>(
    'Call',
    parser({ trivia: functionTrivia }, sequence(routed(), FunctionArguments, literal(')'))),
    (children, fields, span, _rawChildren, triviaLog, state) =>
      functionCallFromChildren(children, fields, span, triviaLog, state)
  );
  const Call = node<FunctionCall>(
    'Call',
    parser({ trivia: functionTrivia }, sequence(genericFunctionOpen, FunctionArguments, literal(')'))),
    (children, fields, span, _rawChildren, triviaLog, state) =>
      functionCallFromChildren(children, fields, span, triviaLog, state)
  );
  // A detached ruleset is a call-argument form, not a general value piece.
  // Keep this argument-enabled function production out of Value
  // so a declaration value cannot acquire the call-only `{ … }` first set.
  const callArgumentFunctionSeparator = field('separator', regex(/[;,][ \t\n\r\f]*/));
  const trailingCallArgumentFunctionSeparator = field('trailingSeparator', noTrivia(regex(/[;,][ \t\n\r\f]*/)));
  const CallArgumentFunctionArguments = optional(sequence(
    oneOrMoreSep(g.CallArgumentValue, callArgumentFunctionSeparator),
    optional(trailingCallArgumentFunctionSeparator)
  ));
  const CallArgumentFunction = node<FunctionCall>(
    'Call',
    sequence(genericFunctionOpen, CallArgumentFunctionArguments, literal(')')),
    argumentFunctionFromChildren
  );
  // Deprecated Less percent-format syntax is a normal existing function fact.
  // The glued `%(` opener keeps it distinct from the `%` arithmetic operator.
  const FormatFunction = node<FunctionCall>(
    'Call',
    sequence(noTrivia(literal('%(')), optional(sequence(not(literal('{')), g.ValueSequence)), many(noTrivia(sequence(regex(/,[ \t\n\r\f]*/), not(literal('{')), g.ValueSequence))), literal(')')),
    children => funcCall('%', children.slice(1, -1).filter(isValueSlotValue))
  );
  // A bare call is a Less statement only with its terminator.  Keep this
  // distinct from Call, which is also a value piece and must not
  // consume a declaration/list boundary.
  const FunctionStatement = node<FunctionCall>(
    'Call',
    sequence(g.CallArgumentFunction, literal(';')),
    (children) => {
      const call = children.find(isFunctionCall);
      if (call === undefined) {
        throw new TypeError('Less function statement lost its call fact.');
      }
      return call;
    }
  );
  const CalcFunction = node<FunctionCall>(
    'CalcCall',
    noTrivia(sequence(routed(), g.MathSum, literal(')'))),
    children => funcCall(functionNameFromOpener(children[0]), [requireValueNode(children[1])])
  );
  const Identifier = node<ValueNode>(
    'Identifier',
    noTrivia(sequence(routed(), many(interpolatedValueTail))),
    (children) => {
      if (children.some(isInterpolationFact)) {
        return interpolation(interpolationPartsFrom(children, true));
      }
      return keyword(children.map(child => requireToken(child).value).join(''));
    }
  );
  const IdentifierOrFunction = dispatch(
    identOrFunction,
    caseOf('url(', choice(RoutedDynamicUrl, RoutedStaticUrl)),
    caseOf('calc(', CalcFunction),
    when(endsWith('('), GenericFunction),
    otherwise(Identifier)
  );
  // Less 5 removed inline backtick JavaScript. Recognize the complete legacy
  // value shape so public diagnostics can point at the removed construct instead
  // of reporting a generic value-position expected-token failure.
  const BacktickJavaScript = node<ValueNode>(
    'BacktickJavaScript',
    noTrivia(sequence(literal('`'), inlineJavaScriptBody, literal('`'))),
    (_children, _fields, span) => {
      throw new LessInlineJavaScriptError(span.start, span.end);
    }
  );
  // `~(...)` escapes its delimiters and makes the complete inner list the value
  // (rather than a math grouping). A paren-delimited `Block` already has exactly the required
  // evaluation behavior for that typed list: a computed list loses its outer
  // parentheses, while the inner list remains indexable by `each()` and list
  // functions.  This is grammar construction, not a raw source-value escape.
  const EscapedParen = node<ValueNode>(
    'EscapedParen',
    noTrivia(sequence(literal('~('), g.ValueList, literal(')'))),
    (children, _fields, span) => withSourceSpan(
      block(requireValueSlot(children[1]), 'paren', true),
      span
    )
  );
  // A bare `(...)` is a math grouping in Less.  Function/mixin argument lists
  // have their own productions above; do not widen this value position into a
  // permissive raw list.
  const Paren = node<ValueNode>(
    'Paren',
    // Math itself is deliberately no-trivia so space-list and glued-sign rules
    // stay exact. Parentheses own their boundary gaps, including Less `//`
    // comments before the first or after the final operand.
    noTrivia(sequence(literal('('), optional(whitespace), g.MathSum, optional(whitespace), literal(')'))),
    (children, _fields, span) => {
      const inner = children.find(isValueNode);
      if (inner === undefined) {
        throw new TypeError('Less parenthesized math lost its inner value.');
      }
      return withSourceSpan(block(inner), span);
    }
  );
  // CSS grid line names are a bracketed value piece, not a map accessor or an
  // opaque post-parse string. Keep the delimited grammar fact as one existing
  // raw value leaf; dynamic/interpolated grid names remain outside this slice.
  const gridLineName = node<Any>(
    'GridLineName',
    noTrivia(sequence(literal('['), g.Keyword, literal(']'))),
    (children) => {
      const name = requireValueNode(children[1]);
      if (name.type !== 'Keyword') {
        throw new TypeError('Less grid line name requires a keyword fact.');
      }
      return any(`[${name.src}]`);
    }
  );
  // A parenthesized `feature: value` is an ordinary typed Less value as well
  // as a media/container query fact: `@tablet: (min-width: @size)`.  Keep the
  // one canonical Block(paren, Operation(':')) reduction outside QueryValue so the
  // value and query grammars share it without a recursive query-value cycle.
  const QueryColonFeature = node<ValueNode>(
    'QueryColonFeature',
    sequence(literal('('), g.CssSyntaxProperty, regex(/:[ \t\n\r\f]*/), g.MathSum, literal(')')),
    (children, _fields, span) => withSourceSpan(
      block(operation(':', keyword(requireToken(children[1]).value), requireValueNode(children[3]))),
      span
    )
  );
  const Value = node<ValueNode>(
    'Value',
    choice(
      attempt(g.MixinReference),
      g.InterpolatedValue,
      g.EscapedQuoted,
      g.Quoted,
      BacktickJavaScript,
      g.IndirectVariableReference,
      g.VariableReferenceChain,
      g.PropertyReference,
      g.CssCustomPropertyValue,
      g.Dimension,
      g.Color,
      g.NamedColor,
      g.FormatFunction,
      IdentifierOrFunction,
      g.SelectorCapture,
      g.EscapedParen,
      g.QueryColonFeature,
      g.Paren,
      gridLineName,
      g.EscapeValue,
      PercentEscape
    ),
    children => requireValueNode(children.find(isValueNode))
  );
  // Signed numerics are already one Dimension leaf (`-2px`).  Less unary minus
  // is glued to a variable or grouping (`-@x`, `-(...)`); `- @x` is instead a
  // preserved space-list. The grammar keeps that source-order/spacing
  // distinction rather than normalizing both spellings to negation.
  const MathUnary = node<ValueNode>(
    'MathUnary',
    choice(
      noTrivia(sequence(regex(/-(?=[(@])/), g.Value)),
      g.Value
    ),
    children => children.length === 1
      ? requireValueNode(children[0])
      : operation('*', dimension(-1, '', '-1'), requireValueNode(children[1])),
    { collapse: true }
  );
  const MathAtom = node<ValueNode>(
    'MathAtom',
    g.MathUnary,
    children => requireValueNode(children[0]),
    { collapse: true }
  );
  // Parenthesized and calc math follows Less precedence: product before sum,
  // both left-associative.  Top-level declarations deliberately exclude `/`:
  // with Less's default parens-division mode it is a preserved slash group, not
  // an eager division Operation.  The existing serializer already recognizes
  // that SpacedValue shape and reinterprets it only inside calc().
  const MathProduct = node<ValueNode>(
    'MathProduct',
    noTrivia(sequence(g.MathAtom, many(sequence(productOperator, g.MathAtom)))),
    foldOperation,
    { collapse: true }
  );
  const MathSum = node<ValueNode>(
    'MathSum',
    noTrivia(sequence(g.MathProduct, many(sequence(sumOperator, g.MathProduct)))),
    foldOperation,
    { collapse: true }
  );
  const TopProduct = node<ValueNode>(
    'TopProduct',
    noTrivia(sequence(g.MathAtom, many(sequence(topProductOperator, g.MathAtom)))),
    foldOperation,
    { collapse: true }
  );
  const TopSum = node<ValueNode>(
    'TopSum',
    noTrivia(sequence(g.TopProduct, many(sequence(sumOperator, g.TopProduct)))),
    foldOperation,
    { collapse: true }
  );
  // In Less's default `parens-division` mode a glued top-level `/` is not an
  // eager Operation. It is one parser-owned slash group that becomes division
  // only when a surrounding calc context consumes it.
  const PreservedDivision = node<ValueNode>(
    'PreservedDivision',
    noTrivia(sequence(g.TopSum, oneOrMore(sequence(field('separator', preservedSlashBoundary), g.TopSum)))),
    (children, fields, _span) => {
      const slashBoundaries = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map((separator) => {
            if (!isSlashBoundaryFact(separator.value)) {
              throw new TypeError('Less preserved division produced an invalid slash boundary.');
            }
            return separator.value;
          });
      const values = children.filter(isValueNode);
      const parts: ValueNode[] = [];
      for (let index = 0; index < values.length; index += 1) {
        parts.push(values[index]!);
        if (index < slashBoundaries.length) {
          parts.push(keyword('/'));
        }
      }
      const separators = slashBoundaries.flatMap(boundary => [boundary.before, boundary.after]);
      return {
        type: 'SpacedValue',
        parts,
        separators: separators.length === parts.length - 1
          ? separators
          : Array.from({ length: parts.length - 1 }, () => '')
      };
    }
  );
  // Value pieces are separated by grammar-owned whitespace. Keeping that token
  // here is what lets canonical SpacedValue retain multiline CSS layout without
  // scanning/re-splitting a completed declaration value later.
  // Left-factored `TopSum (/ TopSum)*`: the value-piece choice used to try
  // `PreservedDivision` (a full `TopSum` + REQUIRED slash tail) and, on the
  // no-slash majority, fail the tail, backtrack, and re-parse `TopSum` from the
  // same position (the two arms share `TopSum`'s first-set, so the `choice` is
  // not disjoint and cannot dispatch past the redundant descent). Parsing
  // `TopSum` once and taking an OPTIONAL slash tail yields byte-identical values
  // — a bare `TopSum` when no slash follows, the same `SpacedValue` when one
  // does — without the second full value descent per non-slash piece.
  const topSumMaybeDivision = node<ValueNode>(
    'TopSumMaybeDivision',
    noTrivia(sequence(g.TopSum, many(sequence(field('separator', preservedSlashBoundary), g.TopSum)))),
    (children, fields) => {
      if (fields?.separator === undefined) {
        return requireValueNode(children[0]);
      }
      const slashBoundaries = requireFields(fields, 'separator').map((separator) => {
        if (!isSlashBoundaryFact(separator.value)) {
          throw new TypeError('Less value piece produced an invalid slash boundary.');
        }
        return separator.value;
      });
      const values = children.filter(isValueNode);
      const parts: ValueNode[] = [];
      for (let index = 0; index < values.length; index += 1) {
        parts.push(values[index]!);
        if (index < slashBoundaries.length) {
          parts.push(keyword('/'));
        }
      }
      const separators = slashBoundaries.flatMap(boundary => [boundary.before, boundary.after]);
      return {
        type: 'SpacedValue',
        parts,
        separators: separators.length === parts.length - 1
          ? separators
          : Array.from({ length: parts.length - 1 }, () => '')
      };
    }
  );
  const valuePiece = choice(g.UnicodeRange, topSumMaybeDivision, literal('/'), literal('-'), literal('%'));
  const nestedAtRuleValueStart = regex(/@[^;{}()'"]*\{/);
  const valueTriviaBoundary = parser(
    { trivia: whitespace },
    sequence(
      peek(whitespace),
      not(nestedAtRuleValueStart),
      valuePiece
    )
  );
  const gluedVariableValueBoundary = sequence(
    leaf(peek(literal('@')), () => ({ kind: 'glued-value-boundary' })),
    valuePiece
  );
  const valueContinuation = choice(valueTriviaBoundary, gluedVariableValueBoundary);
  // Adjacent value pieces are normally separated by authored whitespace, but a
  // Less variable reference may also be glued straight onto the previous piece
  // (`1px@v`, `calc(@w + 2vw)@suffix`). Less treats the glued form as the same
  // space-separated expression as `1px @v` — the missing gap is layout, not a
  // different value shape — so the `@` boundary is a zero-width separator here.
  // One shared piece-tail keeps declaration values and `@name:` variable values
  // on the same rule instead of diverging on the glued spelling.
  // The piece separator stops the value before a nested at-rule. `;` separates
  // declarations rather than terminating them (css-syntax-3 §5.4.7), so the last
  // declaration in a block ends at whatever follows it — and in Less that
  // successor may be `@media all { … }`, whose at-keyword this term would
  // otherwise take as an ordinary `@name` variable reference, leaving the `{`
  // with no statement to open. Less cannot resolve this by reserving the CSS
  // at-rule names the way css/scss/jess do: `@name` IS Less's variable spelling,
  // so `color: red @media` must stay a two-piece value. The discriminator is
  // therefore the shape that follows, not the name — an at-keyword run that
  // reaches `{` before any `;`, `}`, group, or quote is a nested at-rule header
  // and nothing else, because a value piece can never contain a top-level `{`.
  // The lookahead is name-independent (so `@foo all { … }` works too) and costs
  // nothing on ordinary values: it fails on its first character unless the next
  // non-space character is `@`, and even then stops at the declaration's own
  // terminator a few characters later.
  const ValueSequence = node<ValueSlot>(
    'ValueSequence',
    noTrivia(sequence(valuePiece, many(valueContinuation))),
    (children, _fields, _span, _rawChildren, triviaLog, state) => valuePieceReducerWithTrivia(children, triviaLog, state)
  );
  // Function bodies use their own argument boundary rule, but comments *inside*
  // an argument are still lexical trivia. This local value term therefore uses
  // the same continuation boundary as ordinary values, while a completed
  // argument's trailing trivia remains owned by `functionTrivia`.
  const ArgumentValueSequence = node<ValueSlot>(
    'FunctionValueSequence',
    noTrivia(sequence(valuePiece, many(valueContinuation))),
    (children, _fields, _span, _rawChildren, triviaLog, state) => valuePieceReducerWithTrivia(children, triviaLog, state)
  );
  const ValueList = node<ValueSlot>(
    'ValueList',
    choice(
      // This transaction owns the WHOLE accessor-bearing value. Keeping it out
      // of Value means its typed mixin arguments do not recurse through the
      // same candidate before the required accessor fact has been established.
      attempt(sequence(g.MixinReference, not(choice(topProductOperator, sumOperator)))),
      oneOrMoreSep(
        g.ValueSequence,
        field('separator', regex(/,[ \t\n\r\f]*/))
      )
    ),
    (children, fields, _span, _rawChildren, triviaLog, state) => {
      const referenceValue = children.find(isReference);
      if (referenceValue !== undefined) {
        return referenceValue;
      }
      return commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueSlotValue);
    }
  );
  // Variable declarations additionally permit Less trivia immediately after
  // `:` and after comma boundaries. A `//` line comment is trivia (never a CSS
  // value node), while the comma-separated value remains the normal List fact.
  const VariableValue = node<ValueSlot>(
    'VariableValue',
    sequence(
      optional(whitespace),
      oneOrMoreSep(
        g.ValueSequence,
        field('separator', regex(/,[ \t\n\r\f]*/))
      ),
      optional(sequence(literal(','), optional(whitespace)))
    ),
    (children, fields, _span, _rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueSlotValue)
  );
  // `!important` is a grammar-owned declaration/value modifier.  Variables
  // carry the wrapper so references hoist importance once; declarations expose
  // their own flag.  Do not represent it as an opaque keyword/value suffix.
  const ImportantValue = node<Important>(
    'ImportantValue',
    // Priority syntax is token structure, not one glued source string: Less
    // accepts `!important`, `! important`, and `!/*comment*/important`.
    sequence(g.ValueList, literal('!'), g.CssSyntaxImportant),
    children => important(requireValueSlot(children[0]))
  );
  // Left-factored value/priority: parse the value tower ONCE, then an optional
  // `!important` tail.  The old `choice(ImportantValue, ValueList)`
  // was non-disjoint on the value first-set, so every declaration without a
  // priority (~99%) descended the whole value tower inside `ImportantValue`,
  // failed at the required `!`, backtracked, and re-descended as a bare value.
  // The tail mirrors `ImportantValue` exactly (`!`, trivia, `important`),
  // so the AST is identical either way:
  // an `Important` wrapper when the tail matched, else the bare value.
  const ValueListWithPriority = node<ValueSlot>(
    'ValueListWithPriority',
    sequence(
      not(literal('{')),
      g.ValueList,
      optional(sequence(literal('!'), g.CssSyntaxImportant))
    ),
    (children) => {
      const value = requireValueSlot(children[0]);
      return children.some(child => isTerminalText(child, '!')) ? important(value) : value;
    }
  );
  // Less custom properties retain CSS declaration-value text.  The direct
  // route therefore treats every ordinary byte run as literal `Any` content,
  // but lets the shared strict `@{…}` grammar surface interpolation as typed
  // AST facts.  Delimiters and strings are grammar children—not a captured
  // source span—while block comments stay in Parseman's trivia log.
  // Gating note: the static and interpolated `--*` name arms share `-`; keep the
  // public name branches explicit until the custom-property family has a shared
  // opener that preserves both AST construction and CST ownership.
  const CustomPropertyName = node<string | Interpolation>(
    'CustomPropertyName',
    choice(
      noTrivia(sequence(
        literal('--'),
        optional(choice(g.LessSyntaxInterpolatedCustomPropertyStart, g.LessSyntaxInterpolatedCustomPropertyDash)),
        g.Interpolation,
        many(choice(g.LessSyntaxInterpolatedCustomPropertyTail, g.Interpolation))
      )),
      g.LessSyntaxCustomProperty
    ),
    (children) => {
      if (!children.some(isInterpolationFact)) {
        return requireToken(children[0]).value;
      }
      return interpolation(interpolationPartsFrom(children, false));
    }
  );
  const CustomParen = node<readonly CustomValuePart[]>(
    'CustomParen',
    parser(
      { trivia: customValueCommentTrivia },
      sequence(literal('('), many(g.CustomInnerPart), literal(')'))
    ),
    children => customPartsFromChildren(children)
  );
  const CustomSquare = node<readonly CustomValuePart[]>(
    'CustomSquare',
    parser(
      { trivia: customValueCommentTrivia },
      sequence(literal('['), many(g.CustomInnerPart), literal(']'))
    ),
    children => customPartsFromChildren(children)
  );
  const CustomCurly = node<readonly CustomValuePart[]>(
    'CustomCurly',
    parser(
      { trivia: customValueCommentTrivia },
      sequence(literal('{'), many(g.CustomInnerPart), literal('}'))
    ),
    children => customPartsFromChildren(children)
  );
  const CustomAtKeywordText = node<string>(
    'CustomAtKeywordText',
    token(customValueAtKeyword),
    children => requireToken(children[0]).value
  );
  const CustomInnerPart: Combinator<CustomValuePart> = choice(
    g.Interpolation,
    g.LessSyntaxCustomInnerContent,
    g.LessSyntaxCustomSingleQuoted,
    g.LessSyntaxCustomDoubleQuoted,
    g.CustomParen,
    g.CustomSquare,
    g.CustomCurly,
    g.CustomAtKeywordText,
    g.VariableReference
  );
  const CustomPart: Combinator<CustomValuePart> = choice(
    g.Interpolation,
    g.LessSyntaxCustomOuterContent,
    g.LessSyntaxCustomSingleQuoted,
    g.LessSyntaxCustomDoubleQuoted,
    g.CustomParen,
    g.CustomSquare,
    g.CustomCurly,
    g.CustomAtKeywordText,
    g.VariableReference
  );
  const CustomValue = node<ValueNode>(
    'CustomValue',
    parser(
      { trivia: customValueCommentTrivia },
      many(g.CustomPart)
    ),
    (children, _fields, span) => withSourceSpan(
      customValueFromParts(customPartsFromChildren(children)),
      span
    )
  );
  // A CSS custom-property token is an ordinary component value in Less
  // functions such as `var(--accent)`. It is not a Less declaration name here.
  // It reduces to the same Keyword the css/scss/jess grammars produce, and the
  // same one StaticAtRuleCustomProperty already produces for the
  // identical token in an at-rule header.
  const CssCustomPropertyValue = node<Keyword>(
    'CssCustomPropertyValue',
    g.LessSyntaxCustomProperty,
    children => keyword(requireToken(children[0]).value)
  );
  const CustomDeclaration = node<Declaration>(
    'CustomDeclaration',
    // A trailing `!important` is declaration priority, not value text: css-syntax-3
    // §5.5.6 strips it before the custom-property original-text step. The value leaf
    // already stops before the marker (and before the whitespace preceding it), so
    // this tail simply claims it. It mirrors the ordinary-declaration tail exactly:
    // `!`, trivia, `important`.
    sequence(
      g.CustomPropertyName,
      literal(':'),
      g.CustomValue,
      optional(sequence(literal('!'), g.CssSyntaxImportant))
    ),
    (children) => {
      const name = children[0];
      // A custom property name may itself be an `Interpolation`, so choose the final
      // value child rather than treating the first AST value in this reduction
      // as the declaration value.
      const value = children.filter(isValueNode).at(-1);
      if (name === undefined || value === undefined) {
        throw new TypeError('Less grammar produced an incomplete custom declaration.');
      }
      return decl(
        isInterp(name) ? name : requireTerminalText(name),
        valueSlot(value),
        null,
        children.some(child => isTerminalText(child, '!'))
      );
    }
  );
  const InterpolatedProperty = node<Interpolation>(
    'InterpolatedProperty',
    choice(
      noTrivia(sequence(optional(literal('*')), optional(literal('-')), optional(g.CssSyntaxInterpolatedPropertyStart), g.Interpolation, many(choice(g.CssSyntaxInterpolatedPropertyTail, g.Interpolation)))),
      noTrivia(sequence(literal('--'), optional(choice(g.LessSyntaxInterpolatedCustomPropertyStart, g.LessSyntaxInterpolatedCustomPropertyDash)), g.Interpolation, many(choice(g.LessSyntaxInterpolatedCustomPropertyTail, g.Interpolation))))
    ),
    children => interpolation(interpolationPartsFrom(children, false))
  );
  // An interpolated property name always carries a `@{`/`${` marker before the
  // declaration `:`; a plain property never does. InterpolatedProperty
  // is tried first in the property choice (its literal prefix arm can begin a
  // property like `color-@{n}`), so a plain `color:` otherwise scans the whole
  // property ident through the interpolated-property-start production before
  // failing at the required interpolation. This positive lookahead is the cheap
  // commit signal: only enter the interpolated-property arm when a marker is
  // actually present before the delimiter, so plain properties fall straight to
  // the literal DeclarationProperty arm. The `node()` boundary keeps the marker
  // off the declaration reducer's `children[0]` property slot.
  const interpolatedPropertyAhead = peek(regex(/[^:;{}]*[@$]\{/));
  const gatedInterpolatedProperty = node<Interpolation>(
    'GatedInterpolatedProperty',
    sequence(interpolatedPropertyAhead, g.InterpolatedProperty),
    (children) => {
      const property = children.find(isInterp);
      if (property === undefined) {
        throw new TypeError('Less interpolated-property gate lost its interpolation.');
      }
      return property;
    },
    { collapse: true }
  );
  // Declaration-head gaps are trivia, not declaration-name syntax. The AST keeps
  // the semantic property name clean; rendering replays output-bearing block
  // comments from the source trivia map before writing the colon.
  const DeclarationHead = parser({ trivia: whitespace }, sequence(
    choice(
      gatedInterpolatedProperty,
      g.LessSyntaxNumericMapKey,
      g.LessSyntaxDeclarationProperty
    ),
    optional(sequence(choice(literal('+_'), literal('+')))),
    literal(':')
  ));
  const StandardDeclaration = node<Declaration>(
    'Declaration',
    noTrivia(sequence(
      DeclarationHead,
      noTrivia(sequence(
        field('valueGap', regex(/[ \t\n\r\f]*/)),
        // Less accepts an explicit empty declaration value (`margin: ;`). Keep
        // it as a canonical empty opaque value rather than dropping the
        // declaration or falling back to a second parser.
        optional(g.ValueListWithPriority)
      ))
    )),
    (children, fields, span) => {
      // Property, delimiter, and value are independently recognized grammar
      // children; AST construction does not split or reclassify authored text.
      const rawName = children[0];
      // Parseman's optional branch is transparent when absent. Find the value
      // only after the property delimiter, because an interpolated property
      // name is itself an `Interpolation` value node.
      const mergeToken = children.find(child => isToken(child) && (child.value === '+' || child.value === '+_'));
      const colonIndex = children.findIndex(child => isTerminalText(child, ':'));
      if (colonIndex < 0) {
        throw new TypeError('Less grammar produced no declaration delimiter.');
      }
      const valueChild = children.slice(colonIndex + 1).find(isValueSlotValue);
      const value: ValueSlot = valueChild === undefined ? any('') : requireValueSlot(valueChild);
      const merge = mergeToken === undefined ? null : requireToken(mergeToken).value === '+_' ? ' ' : ',';
      const valueGap = fields?.valueGap === undefined ? '' : requireTerminalText(requireField(fields, 'valueGap').value);
      // A lone line break after `:` is ordinary parser layout and canonicalizes
      // back to `: value`. Preserve the declaration break only when the value
      // itself carries multiline separator facts (grid-area style output).
      const layout = Array.isArray(value) ? valueLayoutOf(value) : isSpacedValue(value) ? value.separators : undefined;
      const valueOnNewLine = (valueGap.includes('\n') || valueGap.includes('\r'))
        && layout?.some(separator => separator.includes('\n') || separator.includes('\r')) === true;
      if (merge !== null && merge !== ',' && merge !== ' ') {
        throw new TypeError('Less grammar produced an invalid declaration merge modifier.');
      }
      const node = !Array.isArray(value) && isValueNode(value) && value.type === 'Important'
        ? decl(isInterp(rawName) ? rawName : requireToken(rawName).value, valueSlot(value.inner), merge, true, valueOnNewLine)
        : decl(isInterp(rawName) ? rawName : requireToken(rawName).value, Array.isArray(value) ? value : valueSlot(value), merge, false, valueOnNewLine);
      return withSourceSpan(node, span);
    }
  );
  // Ordered before the ordinary value grammar: a `--*` declaration has the
  // custom-property semantics above, while every other property remains on the
  // typed Less value path.
  // Gating note: `CustomDeclaration` and ordinary `Declaration` overlap on
  // `--*`; the real fix is the custom-property factoring/trivia pass above,
  // not a zero-width dispatch wrapper around the same ambiguous opener.
  const Declaration: Combinator<Declaration> = choice(
    g.CustomDeclaration,
    StandardDeclaration
  );
  /** Less detached maps can use punctuation members (`<: %3c; #: %23;`).
   * This is a declaration fact with a non-CSS name, not an opaque body slice. */
  const PunctuationMapDeclaration = node<Declaration>(
    'PunctuationMapDeclaration',
    sequence(
      g.LessSyntaxPunctuationMapKey,
      literal(':'),
      optional(g.ValueListWithPriority)
    ),
    (children, _fields, span) => {
      const value = children.find(isValueSlotValue);
      return withSourceSpan(
        decl(requireToken(children[0]).value, value === undefined ? any('') : value),
        span
      );
    }
  );
  // A parameter default stops before a line-comment signature boundary. The
  // ordinary value term deliberately treats a whitespace run as the start of a
  // next value piece; guard that transition here so `@x: 1 // note\n )` leaves
  // the comment to the signature rather than committing the whitespace first.
  const mixinParamValueTerm = node<ValueSlot>(
    'MixinParamValueTerm',
    noTrivia(sequence(
      valuePiece,
      many(valueContinuation)
    )),
    (children, _fields, _span, _rawChildren, triviaLog, state) => valuePieceReducerWithTrivia(children, triviaLog, state)
  );
  const MixinParam: Combinator<Param> = choice(
    node<Param>(
      'MixinRestParam',
      sequence(literal('@'), lessVariableName, literal('...')),
      (children, _fields, span) => ({
        name: requireSupportedVariableName(children[1], span.start, span.start + variableNameText(children[1]).length + 1),
        rest: true
      })
    ),
    node<Param>('MixinAnonymousRestParam', literal('...'), () => ({ rest: true })),
    node<Param>(
      'MixinBoundParam',
      sequence(
        literal('@'),
        lessVariableName,
        optional(sequence(
          literal(':'),
          choice(g.ValueBlock, mixinParamValueTerm),
          optional(whitespace)
        ))
      ),
      (children, _fields, span) => {
        const name = requireSupportedVariableName(children[1], span.start, span.start + variableNameText(children[1]).length + 1);
        const value = children.at(-1);
        return isValueSlotValue(value) ? { name, default: value } : { name };
      }
    ),
    node<Param>(
      'MixinPatternParam',
      sequence(mixinParamValueTerm, optional(whitespace)),
      children => ({ pattern: requireValueSlot(children[0]) })
    )
  );
  const mixinParamWithSignatureTrivia = node<Param>(
    'MixinParamWithSignatureTrivia',
    sequence(g.MixinParam, optional(whitespace), optional(mixinSignatureGap)),
    (children) => {
      const param = children.find(isParam);
      if (param === undefined) {
        throw new TypeError('Less mixin signature lost a Param fact.');
      }
      return param;
    }
  );
  const mixinParamSeparator = parser({ trivia: mixinSignatureTrivia }, commaOrSemicolon);
  const mixinParamTrailingSeparator = parser({ trivia: mixinSignatureTrivia }, literal(';'));
  const mixinParamClose = parser({ trivia: mixinSignatureTrivia }, literal(')'));
  // The signature owns trivia at every delimiter boundary: mixin name → `(`,
  // after `(`, between params/separators, after the final param, after `)`, and
  // before `when`/`{`. Delimiters remain explicit private field facts so the
  // grammar—not a post-parse text pass—decides where a comment belongs; public
  // AST v2 keeps its deliberately semantic `Param[]` surface.
  const MixinParameterList = node<MixinParameterListFact>(
    'MixinParameterList',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      field('open', literal('(')),
      optional(sequence(
        oneOrMoreSep(
          field('param', mixinParamWithSignatureTrivia),
          field('separator', mixinParamSeparator)
        ),
        optional(field('trailingSeparator', mixinParamTrailingSeparator))
      )),
      field('close', mixinParamClose)
    )),
    (_children, fields) => ({
      params: fields?.param === undefined
        ? []
        : requireFields(fields, 'param').map((param) => {
            if (!isParam(param.value)) {
              throw new TypeError('Less mixin signature produced a non-Param field.');
            }
            return param.value;
          })
    })
  );
  const PositionalMixinCallArgument = node<MixinCallArgument>(
    'PositionalMixinArgument',
    sequence(g.CallArgumentValue, optional(literal('...'))),
    children => ({
      value: requireMixinCallArgumentValue(children[0]),
      ...(children.some(child => isTerminalText(child, '...')) ? { spread: true } : {})
    })
  );
  const mixinCallArgument: Combinator<MixinCallArgument> = choice(
    node<MixinCallArgument>(
      'NamedMixinArgument',
      sequence(literal('@'), lessVariableName, literal(':'), g.CallArgumentValue),
      (children, _fields, span) => {
        const name = requireSupportedVariableName(children[1], span.start, span.start + variableNameText(children[1]).length + 1);
        return { name, value: requireMixinCallArgumentValue(children[3]) };
      }
    ),
    PositionalMixinCallArgument
  );
  // In Less, a semicolon starts a new mixin argument group; commas *within*
  // that group form one list-valued argument. Keep the semicolon branch
  // transactional so ordinary comma-only calls retain their existing individual
  // argument shape.
  const MixinArgumentGroup = node<MixinCallArgument>(
    'MixinArgumentGroup',
    sequence(PositionalMixinCallArgument, oneOrMore(sequence(literal(','), PositionalMixinCallArgument))),
    (children) => {
      const args = children.filter(isMixinCallArgument);
      return { value: list(args.map(argument => requireValueSlot(argument.value)), ',') };
    }
  );
  const mixinSemicolonArgument = choice(g.MixinArgumentGroup, mixinCallArgument);
  const semicolonSeparatedMixinArguments = sequence(
    mixinSemicolonArgument,
    literal(';'),
    optional(sequence(
      oneOrMoreSep(
        mixinSemicolonArgument,
        literal(';')
      ),
      optional(literal(';'))
    ))
  );
  const MixinArguments = node<readonly MixinCallArgument[]>(
    'MixinArguments',
    choice(
      attempt(semicolonSeparatedMixinArguments),
      // A comma-only call has individual arguments. Once a semicolon appears,
      // Less switches to its semicolon-group grammar above; a mixed named
      // `@a: x, @b: y; @c: z` call is invalid and must not fall through.
      sequence(
        oneOrMoreSep(
          mixinCallArgument,
          literal(',')
        ),
        optional(literal(';'))
      )
    ),
    children => mixinArgumentsFromChildren(children)
  );
  const ReferenceTail = choice(
    node<ReferenceTailFact>(
      'ReferenceBracketTail',
      g.InterpolationAccessor,
      (children) => {
        const accessor = requireInterpolationAccessorFact(children[0]);
        return { step: { type: 'BracketLookup', key: accessor.key, keyKind: accessor.keyKind }, src: `[${accessor.src}]` };
      }
    ),
    node<ReferenceTailFact>(
      'ReferenceDotTail',
      sequence(literal('.'), g.LessSyntaxVariableName),
      (children) => {
        const name = requireToken(children[1]).value;
        return { step: { type: 'DotLookup', name }, src: `.${name}` };
      }
    ),
    node<ReferenceTailFact>(
      'ReferenceCallTail',
      sequence(literal('('), optional(g.MixinArguments), literal(')')),
      (children) => {
        const args = mixinArgumentsFromChildren(children);
        return { step: { type: 'Call', args }, src: `(${args.map(argument => `${argument.name === undefined ? '' : `@${argument.name}: `}${mixinArgumentSource(argument.value)}${argument.spread ? '...' : ''}`).join(', ')})` };
      }
    )
  );
  const InterpolationLastAccessorFromRouted = node<InterpolationAccessorFact>(
    'InterpolationLastAccessor',
    noTrivia(routed()),
    () => ({ key: -1, keyKind: 'index', src: '-1' })
  );
  const InterpolationIndexAccessorFromRouted = node<InterpolationAccessorFact>(
    'InterpolationIndexAccessor',
    noTrivia(sequence(routed(), g.LessSyntaxInterpIndexKey, literal(']'))),
    (children) => {
      const text = requireToken(children[1]).value;
      return { key: Number(text), keyKind: 'index', src: text };
    }
  );
  const InterpolationPropertyVariableAccessorFromRouted = node<InterpolationAccessorFact>(
    'InterpolationPropertyVariableAccessor',
    noTrivia(sequence(routed(), literal('$'), g.VariableReference, literal(']'))),
    (children) => {
      const key = requireValueNode(children[2]);
      if (!isVarRef(key)) {
        throw new TypeError('Less property-variable map key must retain its variable reference.');
      }
      return { key, keyKind: 'prop', src: `$@${key.name}` };
    }
  );
  const InterpolationReferenceAccessorFromRouted = choice(
    node<InterpolationAccessorFact>(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.IndirectVariableReference, literal(']'))),
      (children) => {
        const key = requireValueNode(children[1]);
        if (!isVarIndirect(key) || !isVarRef(key.nameRef)) {
          throw new TypeError('Less indirect map key must retain its variable reference.');
        }
        return { key, keyKind: 'var', src: `@@${key.nameRef.name}` };
      }
    ),
    node<InterpolationAccessorFact>(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.VariableReference, literal(']'))),
      (children) => {
        const key = requireValueNode(children[1]);
        if (!isVarRef(key)) {
          throw new TypeError('Less variable map key must retain its variable reference.');
        }
        return { key, keyKind: 'var', src: `@${key.name}` };
      }
    ),
    node<InterpolationAccessorFact>(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.PropertyReference, literal(']'))),
      (children) => {
        const key = requireValueNode(children[1]);
        if (!isPropRef(key)) {
          throw new TypeError('Less property map key must retain its property reference.');
        }
        return { key, keyKind: 'prop', src: key.raw };
      }
    ),
    node<InterpolationAccessorFact>(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.LessSyntaxInterpBareKey, literal(']'))),
      (children) => {
        const text = requireToken(children[1]).value;
        return { key: keyword(text), keyKind: 'prop', src: text };
      }
    )
  );
  const ReferenceLastTailFromRouted = node<ReferenceTailFact>(
    'ReferenceBracketTail',
    InterpolationLastAccessorFromRouted,
    (children) => {
      const accessor = requireInterpolationAccessorFact(children[0]);
      return { step: { type: 'BracketLookup', key: accessor.key, keyKind: accessor.keyKind }, src: `[${accessor.src}]` };
    }
  );
  const ReferenceBracketTailFromRouted = node<ReferenceTailFact>(
    'ReferenceBracketTail',
    choice(
      InterpolationIndexAccessorFromRouted,
      InterpolationPropertyVariableAccessorFromRouted,
      InterpolationReferenceAccessorFromRouted
    ),
    (children) => {
      const accessor = requireInterpolationAccessorFact(children[0]);
      return { step: { type: 'BracketLookup', key: accessor.key, keyKind: accessor.keyKind }, src: `[${accessor.src}]` };
    }
  );
  const ReferenceDotTailFromRouted = node<ReferenceTailFact>(
    'ReferenceDotTail',
    sequence(routed(), g.LessSyntaxVariableName),
    (children) => {
      const name = requireToken(children[1]).value;
      return { step: { type: 'DotLookup', name }, src: `.${name}` };
    }
  );
  const ReferenceCallTailFromRouted = node<ReferenceTailFact>(
    'ReferenceCallTail',
    sequence(routed(), optional(g.MixinArguments), literal(')')),
    (children) => {
      const args = mixinArgumentsFromChildren(children);
      return { step: { type: 'Call', args }, src: `(${args.map(argument => `${argument.name === undefined ? '' : `@${argument.name}: `}${mixinArgumentSource(argument.value)}${argument.spread ? '...' : ''}`).join(', ')})` };
    }
  );
  const ReferenceTailFromDelimiter = dispatch(
    choice(literal('[]'), literal('['), literal('.'), literal('(')),
    when('[]', ReferenceLastTailFromRouted),
    when('[', ReferenceBracketTailFromRouted),
    when('.', ReferenceDotTailFromRouted),
    when('(', ReferenceCallTailFromRouted)
  );
  const MixinCall = node<MixinCall>(
    'MixinCall',
    sequence(
      mixinName,
      many(MixinPathTail),
      literal('('),
      optional(g.MixinArguments),
      literal(')'),
      // A malformed guarded definition must not split into a bare mixin call
      // followed by a selector rule (`.m() when default { … }`). Definitions get
      // first choice above; this lookahead only blocks that invalid fallback.
      not(whenGuardAhead),
      optional(literal('!important')),
      optional(literal(';'))
    ),
    (children, _fields, span) => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const last = tails.at(-1);
      const call = mixinCall(last?.sel ?? head, mixinArgumentsFromChildren(children));
      return withSourceSpan({
        ...call,
        ...(tails.length > 0
          ? {
              path: [
                { comb: ' ', sel: head },
                ...tails.slice(0, -1)
              ]
            }
          : {}),
        ...(children.some(child => isTerminalText(child, '!important')) ? { important: true } : {})
      }, span);
    }
  );
  // Less permits a zero-argument mixin call without parentheses only when the
  // semicolon fixes the statement boundary. Keep the no-semicolon spelling out
  // of this route: it is ambiguous with a selector/ruleset prefix.
  const BareMixinCall = node<MixinCall>(
    'BareMixinCall',
    sequence(mixinName, many(MixinPathTail), optional(literal('!important')), literal(';')),
    (children) => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const last = tails.at(-1);
      const call = mixinCall(last?.sel ?? head, []);
      const path: MixinCall['path'] = [
        { comb: ' ', sel: head },
        ...tails.slice(0, -1)
      ];
      const withPath = tails.length === 0
        ? call
        : {
            ...call,
            path
          };
      return children.some(child => isTerminalText(child, '!important'))
        ? { ...withPath, important: true }
        : withPath;
    }
  );
  // This is the existing callable-value fact shared by `each(.mixin(), …)` and
  // `@name: .mixin()`. Keep it narrower than an ordinary MixinCall: namespace
  // paths, dynamic names, and call-level modifiers have no approved binding
  // contract in this direct slice.
  const FlatMixinCall = node<MixinCall>(
    'FlatMixinCall',
    sequence(
      mixinName,
      literal('('),
      optional(g.MixinArguments),
      literal(')')
    ),
    children => mixinCall(requireToken(children[0]).value, mixinArgumentsFromChildren(children))
  );
  // `each()` can iterate the emitted declaration map of an existing static
  // namespaced MixinCall.  This is intentionally narrower than statement-level
  // calls: a namespace path is required, and call-level `!important`/`;` forms
  // are not iterable values.  The resulting `path` is the ordinary MixinCall
  // path already consumed by `forItemsFromMixinCall` / `expandCall`.
  const NamespacedMixinCall = node<MixinCall>(
    'NamespacedMixinCall',
    sequence(
      mixinName,
      oneOrMore(MixinPathTail),
      literal('('),
      optional(g.MixinArguments),
      literal(')')
    ),
    (children) => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const last = tails.at(-1);
      if (last === undefined) {
        throw new TypeError('Less namespaced iterable lost its final mixin name.');
      }
      const path: MixinCall['path'] = [{ comb: ' ', sel: head }, ...tails.slice(0, -1)];
      return {
        ...mixinCall(last.sel, mixinArgumentsFromChildren(children)),
        path
      };
    }
  );
  // A variable can retain a namespaced mixin call as its lazy map value. This
  // differs from the `each()` iterable route above because Less permits a
  // call-level `!important` modifier here; the established MixinCall flag
  // carries it without a raw-value recovery or a new AST node family.
  const NamespacedMixinValue = node<MixinCall>(
    'NamespacedMixinValue',
    sequence(
      mixinName,
      oneOrMore(MixinPathTail),
      literal('('),
      optional(g.MixinArguments),
      literal(')'),
      optional(literal('!important'))
    ),
    (children) => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const last = tails.at(-1);
      if (last === undefined) {
        throw new TypeError('Less namespaced variable value lost its final mixin name.');
      }
      const path: MixinCall['path'] = [{ comb: ' ', sel: head }, ...tails.slice(0, -1)];
      const call = {
        ...mixinCall(last.sel, mixinArgumentsFromChildren(children)),
        path
      };
      return children.some(child => isTerminalText(child, '!important')) ? { ...call, important: true } : call;
    }
  );
  const MixinReferenceBase = node<MixinReferenceBaseFact>(
    'MixinReferenceBase',
    sequence(
      mixinName,
      many(MixinPathTail),
      optional(sequence(
        literal('('),
        optional(g.MixinArguments),
        literal(')')
      ))
    ),
    (children) => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const terminal = tails.at(-1);
      const call = mixinCall(terminal?.sel ?? head, mixinArgumentsFromChildren(children));
      const withPath = tails.length === 0
        ? call
        : { ...call, path: [{ comb: ' ', sel: head }, ...tails.slice(0, -1)] as MixinCall['path'] };
      const hasCall = children.some(child => isTerminalText(child, '('));
      const raw = `${head}${tails.map(tail => `${tail.comb}${tail.sel}`).join('')}${hasCall ? `(${withPath.args.map(argument => `${argument.name === undefined ? '' : `@${argument.name}: `}${mixinArgumentSource(argument.value)}${argument.spread ? '...' : ''}`).join(', ')})` : ''}`;
      return { call: withPath, raw };
    }
  );
  // A static namespace/mixin invocation remains the existing typed MixinCall
  // (including its selector-path combinators). Once the shared base is followed
  // by a lookup/call accessor, the whole value is a Reference. The first
  // accessor delimiter is consumed once and routed to the matching tail builder,
  // so malformed accessor bodies stay on the selected reference route instead
  // of probing forward with a broad value-position lookahead.
  const MixinReference = node<Reference>(
    'MixinReference',
    sequence(
      MixinReferenceBase,
      oneOrMore(ReferenceTailFromDelimiter)
    ),
    (children, _fields, span) => {
      const base = requireMixinReferenceBaseFact(children.find(isMixinReferenceBaseFact));
      return withSourceSpan(referenceWithTails(base.call, base.raw, children.filter(isReferenceTailFact)), span);
    }
  );
  const ReferenceCall = node<Reference>(
    'VarCall',
    sequence(
      literal('@'), not(word(
        'supports',
        '-_0-9A-Za-z',
        { caseInsensitive: true }
      )), lessVariableName, literal('('),
      optional(g.MixinArguments),
      literal(')'), optional(literal(';'))
    ),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.start + variableNameText(children[1]).length + 1);
      const args = mixinArgumentsFromChildren(children);
      return withSourceSpan(reference(variableReference(name, 'scoped'), [{ type: 'Call', args }], `@${name}()`), span);
    }
  );
  const mixinGuardDefaultOperand = node<ValueNode>(
    'MixinGuardDefaultOperand',
    mixinGuardDefaultCall,
    () => funcCall('default', [])
  );
  const MixinGuardOperand = node<ValueNode>(
    'MixinGuardOperand',
    // A complete `default()` is a typed FunctionCall when used as a comparison
    // operand; the evaluator already supplies its mixin-dispatch value in that
    // exact context. Leading with that arm is the whole disambiguation needed —
    // a bare `default` is an ordinary ident SHAPE and reduces to a Keyword, as
    // less.js does (`@a: default; .m() when (@a = default)` matches there).
    // Whether that comparison means anything is a language-service fact.
    choice(
      mixinGuardDefaultOperand,
      // Guard operands reuse the ordinary typed access References. The
      // namespace branch must backtrack for ordinary non-accessor colors.
      attempt(g.MixinReference),
      g.VariableReferenceChain,
      g.Quoted,
      g.EscapedQuoted,
      g.Dimension,
      g.Color,
      g.NamedColor,
      g.Call,
      g.Keyword
    ),
    children => requireValueNode(children[0])
  );
  const MixinGuardTerm = node<MixinGuard>(
    'MixinGuardTerm',
    sequence(
      optional(lessWord('not')),
      choice(
        sequence(literal('('), g.MixinGuardOr, literal(')')),
        sequence(g.MixinGuardOperand, optional(sequence(mixinGuardOperator, g.MixinGuardOperand)))
      )
    ),
    (children) => {
      const nested = children.find(isMixinGuard);
      const values = children.filter(isValueNode);
      const operator = children.map(guardOperatorText).find((value): value is string => value !== null);
      let guard: MixinGuard;
      if (nested !== undefined) {
        guard = nested;
      } else {
        const left = values[0];
        if (left === undefined) {
          throw new TypeError('Less grammar produced a guard without a value.');
        }
        if (operator === undefined) {
          const call = isFunctionCall(left) ? left : null;
          if (call !== null && isDefaultGuardCall(call)) {
            guard = { g: 'default' };
          } else if (call !== null) {
            guard = { g: 'call', name: call.name, args: call.args.map(requireValueNode) };
          } else {
            guard = { g: 'truth', value: left };
          }
        } else {
          const right = values[1];
          if (right === undefined) {
            throw new TypeError('Less grammar produced a comparison guard without a right operand.');
          }
          guard = { g: 'cmp', op: operator, left, right };
        }
      }
      return children.some(child => isTerminalText(child, 'not')) ? { g: 'not', inner: guard } : guard;
    }
  );
  const MixinGuardAnd = node<MixinGuard>(
    'MixinGuardAnd',
    sequence(g.MixinGuardTerm, many(sequence(lessWord('and'), g.MixinGuardTerm))),
    children => foldMixinGuards('and', children)
  );
  const MixinGuardOr = node<MixinGuard>(
    'MixinGuardOr',
    sequence(g.MixinGuardAnd, many(sequence(choice(lessWord('or'), literal(',')), g.MixinGuardAnd))),
    children => foldMixinGuards('or', children)
  );
  const unparenthesizedMixinGuard = node<MixinGuard>(
    'UnparenthesizedMixinGuard',
    choice(
      sequence(
        optional(lessWord('not')),
        choice(mixinGuardDefaultOperand, g.Call),
        optional(sequence(mixinGuardOperator, g.MixinGuardOperand))
      ),
      sequence(
        optional(lessWord('not')),
        g.MixinGuardOperand,
        mixinGuardOperator,
        g.MixinGuardOperand
      )
    ),
    (_children, _fields, span) => {
      throw new LessUnparenthesizedMixinGuardError(span.start, span.end);
    }
  );
  const MixinGuardTopTerm = node<MixinGuard>(
    'MixinGuardTopTerm',
    choice(
      unparenthesizedMixinGuard,
      sequence(optional(lessWord('not')), literal('('), g.MixinGuardOr, literal(')')),
      sequence(lessWord('not'), g.MixinGuardTerm)
    ),
    (children) => {
      const guard = children.find(isMixinGuard);
      if (guard === undefined) {
        throw new TypeError('Less grammar produced an empty top-level grouped guard.');
      }
      return children.some(child => isTerminalText(child, 'not')) ? { g: 'not', inner: guard } : guard;
    }
  );
  const MixinGuardTopAnd = node<MixinGuard>(
    'MixinGuardTopAnd',
    sequence(g.MixinGuardTopTerm, many(sequence(lessWord('and'), g.MixinGuardTopTerm))),
    children => foldMixinGuards('and', children)
  );
  const MixinGuardTopOr = node<MixinGuard>(
    'MixinGuardTopOr',
    sequence(g.MixinGuardTopAnd, many(sequence(choice(lessWord('or'), literal(',')), g.MixinGuardTopAnd))),
    children => foldMixinGuards('or', children)
  );
  const MixinGuard = node<MixinGuard>(
    'MixinGuard',
    parser({ trivia: mixinGuardTrivia }, sequence(lessWord('when'), g.MixinGuardTopOr)),
    (children) => {
      const guard = children.find(isMixinGuard);
      if (guard === undefined) {
        throw new TypeError('Less grammar produced a missing mixin guard.');
      }
      return guard;
    }
  );
  // Scope the signature-only trivia through the opening `{`, then leave the
  // body to its ordinary statement grammar where block comments are CSS output.
  const mixinSignature = node<MixinSignatureFact>(
    'MixinSignature',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      field('name', mixinName),
      field('parameters', g.MixinParameterList),
      optional(mixinSignatureGap),
      optional(field('guard', MixinGuard)),
      optional(mixinSignatureGap),
      field('open', literal('{'))
    )),
    (_children, fields) => {
      const name = requireField(fields, 'name').value;
      const parameters = requireField(fields, 'parameters').value;
      if (!isMixinParameterListFact(parameters)) {
        throw new TypeError('Less mixin signature produced invalid header facts.');
      }
      const guardField = fields?.guard === undefined ? undefined : requireField(fields, 'guard').value;
      if (guardField !== undefined && !isMixinGuard(guardField)) {
        throw new TypeError('Less mixin signature produced an invalid guard fact.');
      }
      return {
        name: requireTerminalText(name),
        params: parameters.params,
        ...(guardField === undefined ? {} : { guard: guardField })
      };
    }
  );
  // Shared block-body statement choice. Every braced Less body (mixin
  // definitions, `@supports`/media/container/generic at-rule blocks, and the
  // ruleset body via the extend-augmented reuse below) accepts this exact
  // ordered arm set. Factoring it into one named combinator keeps the arm-win
  // precedence identical across all block contexts instead of hand-copying the
  // arms per production. The root document and the detached-ruleset/`each`
  // `BodyStatement` deliberately keep their own ordered arm sets
  // because they legitimately differ (comment-first root ordering; the
  // punctuation-map arm and Each/Ruleset reordering in body statements).
  // `@`-led statement group. Every body context lists these eleven arms in this
  // exact contiguous order, so grouping them into one nested choice is
  // byte-identical to the flat listing (a bare `choice` passes its winning arm's
  // value through unchanged, and firstMatch order is preserved). This is the
  // structural "one at-rule choice group"; parseman already first-set-gates the
  // whole group behind a single `@` (codepoint 64) check, so a non-`@` statement
  // skips all ten arms with one integer compare. This is deliberately not a
  // `dispatch(...)` yet: Less `@name` forms need more than bare `@` or bare
  // `@name` to distinguish variable declarations, reference calls, known
  // at-rules, generic blocks, and generic statements.
  const atStatement = choice(g.ImportStatement, g.PluginDirective, g.ValueBlockDeclaration, g.VarDeclaration, g.SupportsBlock, g.MediaContainerBlock, g.ReferenceCall, g.Keyframes, g.AtRuleBlock, g.OpaqueAtRuleBlock, g.AtRuleStatement);
  // Chevrotain funneled every `.foo`/`#foo` block through ONE mixin-or-ruleset
  // dispatch: a cheap token-only test (`mixinStart` then `(` or `;`) chose the
  // mixin arm, otherwise the qualified-rule arm ran, so the shared class/id
  // prefix was never re-scanned by three separate mixin productions. Parseman
  // already first-set-gates the whole `.`/`#` group behind one codepoint check,
  // but WITHIN that group the three mixin productions each restart from the name
  // before the ruleset finally matches. This positive lookahead reproduces
  // Chevrotain's `testMixin`: a mixin header always reaches a `(` or `;` before
  // any `{`/`}`, so a plain ruleset — whose selector has no such delimiter before
  // its block — skips all three mixin productions with one bounded scan instead
  // of three failed name re-scans. The gate only ever over-accepts (a
  // parenthesized-pseudo ruleset such as `.a:not(.b){}` still falls through to
  // the ruleset arm), so PEG priority and output stay identical.
  const mixinStatementAhead = not(not(regex(/[.#][^{};]*[(;]/)));
  const UnsupportedDashOnlyMixin = node<never>(
    'UnsupportedMixinName',
    noTrivia(choice(
      sequence(choice(literal('.'), literal('#')), literal('-'), literal('('), optional(g.MixinArguments), literal(')')),
      sequence(choice(literal('.'), literal('#')), literal('-'), literal(';'))
    )),
    (_children, _fields, span) => {
      throw new LessUnsupportedMixinNameError(span.start, span.end);
    }
  );
  // A `node()` reduction boundary keeps the gated group's single mixin fact from
  // splicing the zero-width lookahead marker into the parent statement list; the
  // reducer returns the inner MixinDef/MixinCall/MixinCall (bare) node unchanged,
  // so the emitted AST and its `type`-keyed shape are identical to the ungrouped
  // arms. `collapse` lets parseman drop the transparent wrapper allocation.
  const mixinStatement = node<Statement>(
    'MixinStatement',
    sequence(mixinStatementAhead, choice(UnsupportedDashOnlyMixin, g.MixinDefinition, g.MixinCall, g.BareMixinCall)),
    (children) => {
      const statement = children.find(isStatement);
      if (statement === undefined) {
        throw new TypeError('Less mixin-or-ruleset gate lost its mixin statement.');
      }
      return statement;
    },
    { collapse: true }
  );
  // Chevrotain disambiguated a nested rule from a declaration on the colon's
  // trailing trivia, not a full selector speculation: `foo: bar` (colon then
  // whitespace) is always a declaration, never a selector, because a selector
  // pseudo requires its name glued to the colon (`foo:hover`). Ruleset is tried
  // before Declaration (a bare type-selector nested rule must win over a property
  // name), so every `foo: value` otherwise parses `foo` as a type-selector
  // compound and only fails at the missing `{`. This negative lookahead skips the
  // Ruleset arm for the unambiguous `<ident><ws?>:<ws>` declaration shape, leaving
  // the rarer `foo:bar` / `@{p}:` / `foo+:` forms on the original
  // Ruleset-then-Declaration path. No real selector matches `<ident>:<ws>`, so the
  // emitted AST and PEG priority are unchanged; a `node()` boundary keeps the
  // lookahead marker from splicing into the statement list.
  const rulesetNotDeclaration = not(regex(/[-\w]+[ \t]*:[ \t\n\r\f]/));
  const guardedRuleset = node<Rule>(
    'GuardedRuleset',
    sequence(rulesetNotDeclaration, g.RulesetWithExtends),
    (children) => {
      const ruleset = children.find(isRule);
      if (ruleset === undefined) {
        throw new TypeError('Less declaration-guarded ruleset lost its rule.');
      }
      return ruleset;
    },
    { collapse: true }
  );
  const declarationItem = node<Declaration>(
    'DeclarationItem',
    sequence(
      g.Declaration,
      choice(
        literal(';'),
        peek(literal('}'))
      )
    ),
    (children) => {
      const declaration = children.find(isDeclaration);
      if (declaration === undefined) {
        throw new TypeError('Less declaration-list item lost its declaration fact.');
      }
      return declaration;
    },
    { collapse: true }
  );
  const stylesheetEnd = not(regex(/[\s\S]/));
  const rootDeclarationItem = node<Declaration>(
    'RootDeclarationItem',
    sequence(
      g.Declaration,
      choice(
        literal(';'),
        stylesheetEnd
      )
    ),
    (children) => {
      const declaration = children.find(isDeclaration);
      if (declaration === undefined) {
        throw new TypeError('Less root declaration item lost its declaration fact.');
      }
      return declaration;
    },
    { collapse: true }
  );
  const punctuationMapDeclarationItem = node<Declaration>(
    'PunctuationMapDeclarationItem',
    sequence(
      PunctuationMapDeclaration,
      choice(
        literal(';'),
        peek(literal('}'))
      )
    ),
    (children) => {
      const declaration = children.find(isDeclaration);
      if (declaration === undefined) {
        throw new TypeError('Less punctuation map item lost its declaration fact.');
      }
      return declaration;
    },
    { collapse: true }
  );
  const blockItem = choice(atStatement, mixinStatement, g.Each, g.FunctionStatement, guardedRuleset, declarationItem, literal(';'));
  const blockBody = many(blockItem);
  // The ruleset body adds one extra arm (`ExtendStatement`) after the
  // shared arms. Nesting the shared choice ahead of it preserves the original
  // precedence: the shared arms (including the empty `;`) are tried in the same
  // order first, then the extend statement — behaviourally identical to the
  // former flat `choice(<shared arms>, ExtendStatement, ';')` because
  // an extend head never matches `;` or any shared arm the flat list did not.
  const rulesetBody = many(choice(blockItem, g.ExtendStatement));
  const MixinDefinition = node<MixinDef>(
    'MixinOrQualifiedRule',
    sequence(
      mixinSignature,
      blockBody,
      optional(g.Call),
      literal('}'),
      optional(literal(';'))
    ),
    (children, _fields, span, rawChildren) => {
      const signature = children.find(isMixinSignatureFact);
      if (signature === undefined) {
        throw new TypeError('Less mixin definition lost its signature fact.');
      }
      return withSourceSpan(withBlockBody(
        mixinDef(signature.name, [...signature.params], children.filter(isStatement), signature.guard),
        rawChildren
      ), span);
    }
  );
  const EachName = node<string>(
    'EachName',
    sequence(literal('@'), lessVariableName),
    (children, _fields, span) => requireSupportedVariableName(
      children[1],
      span.start,
      span.start + variableNameText(children[1]).length + 1
    )
  );
  // Detached rulesets and `each()` callbacks are both statement containers.
  // Keep their accepted content on the same grammar path as normal Less
  // bodies: reductions above construct each canonical statement, and these
  // containers merely retain those typed children.  This is deliberately not a
  // CST/tree conversion or an opaque body fallback.
  const BodyStatement = choice(punctuationMapDeclarationItem, atStatement, mixinStatement, guardedRuleset, g.Each, g.FunctionStatement, declarationItem, literal(';'));
  const ValueBlock = node<ValueNode>(
    'ValueBlock',
    sequence(literal('{'), many(g.BodyStatement), optional(g.Call), literal('}')),
    children => classifyValueBlock(requireValueBlockBody(children))
  );
  const CallArgumentValue = node<MixinCallArgument['value']>(
    'CallArgumentValue',
    choice(attempt(g.FlatMixinCall), g.ValueBlock, g.ValueSequence),
    (children) => {
      const value = children[0];
      if (isMixinCall(value) || isValueSlotValue(value)) {
        return value;
      }
      throw new TypeError('Less call argument must reduce to a value or typed mixin call.');
    }
  );
  const EachCallback = node<LessEachCallback>(
    'EachCallback',
    choice(
      sequence(
        literal('{'),
        many(g.BodyStatement),
        optional(g.Call),
        literal('}')
      ),
      sequence(
        // Less anonymous mixin callbacks accept either `.(...) { ... }` or
        // `#(...) { ... }`; both lower to the same canonical For binding.
        eachCallbackSigil, literal('('), g.EachName,
        optional(sequence(commaOrSemicolon, g.EachName, optional(sequence(commaOrSemicolon, g.EachName)))),
        literal(')'), literal('{'),
        many(g.BodyStatement),
        optional(g.Call),
        literal('}')
      )
    ),
    (children) => {
      if (requireToken(children[0]).value === '{') {
        return {
          binding: { kind: 'comma', names: ['value', 'key', 'index'] },
          rules: requireCallbackStatements(children.slice(1, -1))
        };
      }
      const names = children.filter((child): child is string => typeof child === 'string');
      const bodyStart = children.findIndex(child => isTerminalText(child, '{'));
      if (bodyStart < 0) {
        throw new TypeError('Less grammar produced a named each() callback without a body.');
      }
      const body = requireCallbackStatements(children.slice(bodyStart + 1, -1));
      if (names.length === 1) {
        return { binding: { kind: 'single', name: names[0]! }, rules: body };
      }
      if (names.length === 2 || names.length === 3) {
        return {
          binding: { kind: 'comma', names: [names[0]!, names[1]!, names[2]] },
          rules: body
        };
      }
      throw new TypeError('Less grammar produced an invalid each() callback binding.');
    }
  );
  const Each = node<For>(
    'For',
    // An inline detached ruleset is an ordinary `each()` iterable
    // (`each({ margin: m; padding: p; }, \u2026)`). It is listed here rather than in
    // ValueList because the call-only `{ \u2026 }` first set must stay out of
    // ordinary declaration values.
    sequence(
      noTrivia(sequence(
        word(
          'each',
          '-_a-zA-Z0-9\\u0080-\\uFFFF',
          { caseInsensitive: true }
        ),
        literal('(')
      )),
      choice(
        g.NamespacedMixinCall,
        g.FlatMixinCall,
        g.ValueBlock,
        g.ValueList
      ),
      choice(
        literal(','),
        literal(';')
      ),
      g.EachCallback,
      literal(')'),
      optional(literal(';'))
    ),
    (children) => {
      const callback = children[4];
      if (!isLessEachCallback(callback)) {
        throw new TypeError('Less each() reduction produced an invalid callback.');
      }
      const iterable = children[2];
      return forNode(isMixinCall(iterable) ? iterable : requireValueSlot(iterable), callback.rules, callback.binding);
    }
  );
  const generalEnclosedRaw = node<string>(
    'GeneralEnclosedRaw',
    noTrivia(choice(g.CssSyntaxBlockComment, generalEnclosedText)),
    children => requireToken(children[0]).value
  );
  const GeneralEnclosedQuoted = node<Interpolation>(
    'GeneralEnclosedQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.VariableInterpolation, BareVariableInterpolation, generalEnclosedDoubleChunk)), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.VariableInterpolation, BareVariableInterpolation, generalEnclosedSingleChunk)), literal('\'')))
    ),
    generalEnclosedInterpolationFromChildren
  );
  const GeneralEnclosedGroup = node<Interpolation>(
    'GeneralEnclosedGroup',
    choice(
      noTrivia(sequence(literal('('), g.GeneralEnclosedContent, literal(')'))),
      noTrivia(sequence(literal('['), g.GeneralEnclosedContent, literal(']'))),
      noTrivia(sequence(literal('{'), g.GeneralEnclosedContent, literal('}')))
    ),
    generalEnclosedInterpolationFromChildren
  );
  const GeneralEnclosedContent = node<Interpolation>(
    'GeneralEnclosedContent',
    noTrivia(many(choice(
      BareVariableInterpolation,
      generalEnclosedRaw,
      g.VariableInterpolation,
      g.GeneralEnclosedQuoted,
      g.GeneralEnclosedGroup
    ))),
    generalEnclosedInterpolationFromChildren
  );
  const GeneralEnclosedFunctionName = node<GeneralEnclosedNameFact>(
    'GeneralEnclosedFunctionName',
    token(noTrivia(sequence(g.CssSyntaxQueryFunctionName, literal('(')))),
    children => ({ name: functionNameFromOpener(children[0]) })
  );
  const GeneralEnclosed = node<GeneralEnclosed>(
    'GeneralEnclosed',
    choice(
      noTrivia(sequence(g.GeneralEnclosedFunctionName, g.GeneralEnclosedContent, literal(')'))),
      noTrivia(sequence(literal('('), g.GeneralEnclosedContent, literal(')')))
    ),
    (children) => {
      const content = children.find((child): child is Interpolation => typeof child === 'object' && child !== null && 'type' in child && child.type === 'Interpolation');
      if (content === undefined) {
        throw new TypeError('Less general-enclosed lost its grammar-owned content.');
      }
      const name = children.find((child): child is GeneralEnclosedNameFact => typeof child === 'object' && child !== null && 'name' in child);
      return name === undefined ? generalEnclosed('paren', null, content) : generalEnclosed('function', name.name, content);
    }
  );
  // `@supports` has its own typed condition grammar. Keep this narrower than
  // ordinary Less values: feature values are static leaf facts, logical terms
  // and nested conditions retain their authored parentheses as `Block`, and
  // functions/general-enclosed/dynamic forms fail instead of becoming raw text.
  const SupportsValue = node<ValueNode>(
    'SupportsValue',
    g.ValueList,
    (children) => {
      const value = requireValueSlot(children[0]);
      if (isValueNode(value)) {
        return value;
      }
      return spaced(value.map(requireValueNode));
    }
  );
  const SupportsFeature = node<ValueNode>(
    'SupportsFeature',
    sequence(
      literal('('),
      g.CssSyntaxProperty,
      optional(sequence(literal(':'), g.SupportsValue)),
      literal(')')
    ),
    (children) => {
      const property = keyword(requireToken(children[1]).value);
      const value = children.find(isValueNode);
      return value === undefined
        ? block(property)
        : block(operation(':', property, value));
    }
  );
  const SupportsInParens = node<ValueNode>(
    'SupportsInParens',
    choice(
      sequence(literal('('), g.SupportsCondition, literal(')')),
      g.SupportsFeature,
      g.GeneralEnclosed
    ),
    children => children.length === 1
      ? requireValueNode(children[0])
      : block(requireValueNode(children[1]))
  );
  const SupportsCondition = node<ValueNode>(
    'SupportsCondition',
    choice(
      sequence(g.CssSyntaxQueryNot, g.SupportsInParens),
      sequence(g.SupportsInParens, many(sequence(g.CssSyntaxQueryAndOr, g.SupportsInParens)))
    ),
    (children) => {
      const values = children.map(child => isValueNode(child)
        ? child
        : keyword(requireToken(child).value));
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const SupportsBlock = node<AtRuleBlock>(
    'SupportsBlock',
    sequence(
      g.CssSyntaxSupportsAtKeyword,
      choice(g.AtRuleInterpolation, BareVariableInterpolation, g.SupportsCondition),
      literal('{'),
      blockBody,
      optional(g.Call),
      literal('}')
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(
      withBlockBody(
        atRuleBlock(requireToken(children[0]).value, requireValueNode(children[1]), children.filter(isStatement)),
        rawChildren
      ),
      span
    )
  );
  const queryIdentifier = regex(/(?!(?:url)(?=\())-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
  const queryIdentOrFunction = token(noTrivia(sequence(
    queryIdentifier,
    optional(literal('('))
  )));
  const QueryKeyword = node<ValueNode>(
    'Keyword',
    routed(),
    children => keyword(requireToken(children[0]).value)
  );
  const QueryIdentOrFunction = dispatch(
    queryIdentOrFunction,
    caseOf('calc(', CalcFunction),
    when(
      endsWith('('),
      GenericFunction
    ),
    otherwise(QueryKeyword)
  );
  const queryLeaf = choice(g.VariableReferenceChain, g.Dimension, g.Color, g.NamedColor, g.StaticQuoted, QueryIdentOrFunction);
  // Media/container query syntax shares CSS's grammar-owned comparison terminal
  // and canonical `Block(paren, Operation)` shape. Less only supplies the additional
  // variable-bearing value leaves; it does not capture a query prelude as raw
  // text or run a second scanner over it.
  const QueryValue = node<ValueNode>(
    'QueryValue',
    choice(g.PreservedDivision, queryLeaf),
    children => requireValueNode(children[0])
  );
  // A media/container feature value may be a `<ratio>` — media-queries-4 §2.1,
  // `<number> [ / <number> ]?` — as in `(aspect-ratio >= 16/9)`. The colon form
  // already folds that slash into a typed `/` Operation through its math value;
  // the comparison and range forms took the value-position leaf, where Less's
  // `parens-division` slash group turned the same ratio into a SpacedValue. Fold
  // it here so every feature form — and every dialect — carries one ratio shape.
  // `style(--x: …)` keeps QueryValue above: that payload is a
  // declaration, so its slash stays a value-position slash group.
  const QueryFeatureValue = node<ValueNode>(
    'QueryFeatureValue',
    sequence(queryLeaf, many(sequence(literal('/'), queryLeaf))),
    foldOperation
  );
  const QueryBareFeature = node<ValueNode>(
    'QueryBareFeature',
    sequence(literal('('), g.CssSyntaxProperty, literal(')')),
    children => block(keyword(requireToken(children[1]).value))
  );
  const QueryComparisonFeature = node<ValueNode>(
    'QueryComparisonFeature',
    sequence(
      literal('('), g.CssSyntaxProperty, g.CssSyntaxQueryComparisonOperator, QueryFeatureValue,
      optional(sequence(g.CssSyntaxQueryComparisonOperator, QueryFeatureValue)), literal(')')
    ),
    (children) => {
      const values = children.filter(isValueNode);
      const operators = queryComparisonOperators(children);
      if (values.length < 1 || operators.length < 1) {
        throw new TypeError('Less query comparison lost a value or operator.');
      }
      let comparison = operation(operators[0]!, keyword(requireToken(children[1]).value), values[0]!);
      if (operators.length === 2) {
        if (values[1] === undefined) {
          throw new TypeError('Less chained query comparison lost its final value.');
        }
        comparison = operation(operators[1]!, comparison, values[1]);
      }
      return block(comparison);
    }
  );
  const QueryRangeFeature = node<ValueNode>(
    'QueryRangeFeature',
    sequence(
      literal('('), QueryFeatureValue, g.CssSyntaxQueryComparisonOperator, g.CssSyntaxProperty,
      optional(sequence(g.CssSyntaxQueryComparisonOperator, QueryFeatureValue)), literal(')')
    ),
    (children) => {
      const values = children.filter(isValueNode);
      const operators = queryComparisonOperators(children);
      if (values.length < 1 || operators.length < 1) {
        throw new TypeError('Less query range lost a value or operator.');
      }
      let comparison = operation(operators[0]!, values[0]!, keyword(requireToken(children[3]).value));
      if (operators.length === 2) {
        if (values[1] === undefined) {
          throw new TypeError('Less chained query range lost its final value.');
        }
        comparison = operation(operators[1]!, comparison, values[1]);
      }
      return block(comparison);
    }
  );
  // Container queries permit parenthesized boolean groups, for example
  // `((width < 500px) or (height < 500px))`. The individual features retain
  // their existing typed Block(paren, Operation) representation inside the group.
  const QueryLogicalGroup = node<ValueNode>(
    'QueryLogicalGroup',
    sequence(literal('('), g.QueryFeature, oneOrMore(sequence(g.CssSyntaxQueryAndOr, g.QueryFeature)), literal(')')),
    children => block(spaced(children.filter(child => isValueNode(child) ? true : isTerminalText(child, 'and') || isTerminalText(child, 'or')).map(keywordOrValue)))
  );
  // Container queries permit a nested negated condition, for example
  // `(not (height > 670px))`. It is a parenthesized structural query fact,
  // not an opaque at-rule header.
  const QueryNegatedFeature = node<ValueNode>(
    'QueryNegatedFeature',
    sequence(literal('('), g.CssSyntaxQueryNot, g.QueryFeature, literal(')')),
    children => block(spaced([keyword(requireToken(children[1]).value), requireValueNode(children[2])]))
  );
  const QueryFeature = node<ValueNode>(
    'QueryFeature',
    choice(QueryBareFeature, QueryColonFeature, QueryComparisonFeature, QueryRangeFeature, QueryLogicalGroup, QueryNegatedFeature),
    children => requireValueNode(children[0])
  );
  // `only` is a media/query modifier, not an ordinary media-type keyword.
  const QueryNonOnlyKeyword = node<Keyword>(
    'QueryNonOnlyKeyword',
    sequence(not(g.CssSyntaxQueryOnly), g.Keyword),
    children => requireKeyword(children.at(-1))
  );
  const QueryTerm = node<ValueNode>(
    'QueryTerm',
    choice(
      // A namespace/map read is a whole query term only after its required
      // accessor has succeeded; otherwise ordinary colors and mixin prefixes
      // continue to the existing query alternatives.
      attempt(g.MixinReference),
      g.QueryFeature,
      g.VariableReference,
      QueryNonOnlyKeyword
    ),
    children => requireValueNode(children[0])
  );
  const QueryOnlyClause = node<ValueNode>(
    'QueryOnlyClause',
    sequence(
      g.CssSyntaxQueryOnly,
      QueryNonOnlyKeyword,
      many(sequence(g.CssSyntaxQueryAndOr, QueryTerm))
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => spacedFromValueChildren(children, triviaLog, state)
  );
  // Gating note: `only` and ordinary query terms share the keyword first set.
  // `QueryNonOnlyKeyword` already rejects `only` in the generic branch; a
  // dispatch wrapper would mostly restate that negative guard without removing
  // the media/container semantic split.
  const QueryClause = node<ValueNode>(
    'QueryClause',
    choice(
      QueryOnlyClause,
      sequence(
        QueryTerm,
        many(sequence(g.CssSyntaxQueryAndOr, QueryTerm))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => queryClauseReducer(children, triviaLog, state)
  );
  const QueryPrelude = node<ValueNode>(
    'QueryPrelude',
    oneOrMoreSep(
      g.QueryClause,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields, _span, _rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueNode)
  );
  // Less permits a variable interpolation as an ordinary `@media` query term:
  // `@media @{all} and @{tv}`. That is not a container-query form, so retain
  // the stricter shared query prelude used by `@container` and construct this
  // media-only typed sequence from the same structural leaves.
  const MediaQueryTerm = node<ValueNode>(
    'MediaQueryTerm',
    choice(g.AtRuleInterpolation, BareVariableInterpolation, QueryTerm),
    children => requireValueNode(children[0])
  );
  const MediaQueryOnlyClause = node<ValueNode>(
    'MediaQueryOnlyClause',
    sequence(
      g.CssSyntaxQueryOnly,
      QueryNonOnlyKeyword,
      many(sequence(g.CssSyntaxQueryAndOr, MediaQueryTerm))
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => spacedFromValueChildren(children, triviaLog, state)
  );
  const MediaQueryNotClause = node<ValueNode>(
    'MediaQueryNotClause',
    sequence(
      g.CssSyntaxQueryNot,
      MediaQueryTerm,
      many(sequence(g.CssSyntaxQueryAndOr, MediaQueryTerm))
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => spacedFromValueChildren(children, triviaLog, state)
  );
  const MediaQueryClause = node<ValueNode>(
    'MediaQueryClause',
    choice(
      MediaQueryOnlyClause,
      MediaQueryNotClause,
      sequence(
        MediaQueryTerm,
        many(sequence(g.CssSyntaxQueryAndOr, MediaQueryTerm))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => queryClauseReducer(children, triviaLog, state)
  );
  const MediaQueryPrelude = node<ValueNode>(
    'MediaQueryPrelude',
    oneOrMoreSep(
      MediaQueryClause,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields, _span, _rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueNode)
  );
  // A style query is a real typed container-header function. Its argument is a
  // structural custom-property comparison rather than an opaque header slice.
  const styleFunctionOpener = token(noTrivia(sequence(word(
    'style',
    '-_0-9A-Za-z',
    { caseInsensitive: true }
  ), literal('('))));
  const scrollStateFunctionOpener = token(noTrivia(sequence(word(
    'scroll-state',
    '-_0-9A-Za-z',
    { caseInsensitive: true }
  ), literal('('))));
  const ContainerStyleQuery = node<FunctionCall>(
    'ContainerStyleQuery',
    sequence(styleFunctionOpener, g.LessSyntaxCustomProperty, literal(':'), g.QueryValue, literal(')')),
    children => funcCall(functionNameFromOpener(children[0]), [operation(':', keyword(requireToken(children[1]).value), requireValueNode(children[3]))])
  );
  const ContainerScrollStateQuery = node<FunctionCall>(
    'ContainerScrollStateQuery',
    sequence(scrollStateFunctionOpener, g.CssSyntaxProperty, literal(':'), g.QueryValue, literal(')')),
    children => funcCall(functionNameFromOpener(children[0]), [operation(':', keyword(requireToken(children[1]).value), requireValueNode(children[3]))])
  );
  const ContainerName = node<Keyword>(
    'ContainerName',
    sequence(
      not(word(
        'none',
        '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\',
        { caseInsensitive: true }
      )),
      not(g.CssSyntaxQueryNot),
      not(g.CssSyntaxQueryAndOr),
      g.Keyword
    ),
    children => requireKeyword(children.at(-1))
  );
  const ContainerQueryAtom = node<ValueNode>(
    'ContainerQueryAtom',
    choice(
      g.ContainerStyleQuery,
      g.ContainerScrollStateQuery,
      g.QueryFeature
    ),
    children => requireValueNode(children[0])
  );
  const ContainerCondition = node<ValueNode>(
    'ContainerCondition',
    choice(
      sequence(
        g.CssSyntaxQueryNot,
        g.ContainerQueryAtom
      ),
      sequence(
        g.ContainerQueryAtom,
        many(sequence(
          g.CssSyntaxQueryAndOr,
          g.ContainerQueryAtom
        ))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => queryClauseReducer(children, triviaLog, state)
  );
  // A container condition is either a container-query, an optional leading
  // container name plus a query, or a name-only condition. The condition remains
  // container-query syntax, not a media-query prelude, so a second bare media
  // type cannot masquerade as a condition after the optional name.
  const ContainerConditionItem = node<ValueNode>(
    'ContainerConditionItem',
    choice(
      BareVariableInterpolation,
      g.ContainerCondition,
      sequence(
        g.AtRuleInterpolation,
        g.ContainerCondition
      ),
      sequence(
        g.ContainerName,
        g.ContainerCondition
      ),
      g.ContainerName
    ),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const ContainerQueryPrelude = node<ValueNode>(
    'ContainerQueryPrelude',
    oneOrMoreSep(
      ContainerConditionItem,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields, _span, _rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueNode)
  );
  // Media and container headers differ, but their child statement language is
  // one shared grammar production. Keep it shared so a valid nested Less
  // construct cannot become valid in one conditional at-rule but not the other.
  const MediaContainerBody = node<readonly Statement[]>(
    'MediaContainerBody',
    sequence(
      literal('{'),
      blockBody,
      optional(g.Call),
      literal('}')
    ),
    children => children.filter(isStatement)
  );
  const MediaContainerBlock = node<AtRuleBlock>(
    'QueryAtRuleBlock',
    dispatch(
      token(noTrivia(g.CssSyntaxMediaContainerAtKeyword)),
      caseOf(
        '@media',
        sequence(routed(), choice(MediaQueryPrelude, g.AtRuleInterpolation), g.MediaContainerBody)
      ),
      caseOf(
        '@container',
        sequence(routed(), ContainerQueryPrelude, g.MediaContainerBody)
      )
    ),
    (children, _fields, span) => {
      const body = children.find(Array.isArray);
      if (body === undefined) {
        throw new TypeError('Less conditional at-rule lost its body facts.');
      }
      return withSourceSpan(
        atRuleBlock(requireToken(children[0]).value, requireValueNode(children[1]), requireStatementArray(body)),
        span
      );
    }
  );
  // Keyframes use the existing canonical AtRuleBlock + Rule shape. Keeping the
  // header and selector list structural avoids routing valid CSS keyframes
  // through the generic Less at-rule/ruleset combination, which cannot model
  // percentage selectors as selector facts.
  // Gating note: block entries overlap on ident-led declarations and
  // function-call statements. The shared prefix is the property/call name, but
  // the deciding delimiter is `:` versus `(` / `;`, so a cosmetic dispatch on
  // the identifier would commit too early.
  const KeyframeSelector = node<SimpleSelector>(
    'KeyframeSelector',
    choice(keyframeEndpoint, keyframePercent),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const KeyframeBlock = node<Rule>(
    'KeyframeBlock',
    sequence(
      oneOrMoreSep(
        g.KeyframeSelector,
        literal(',')
      ),
      literal('{'),
      many(choice(declarationItem, g.FunctionStatement, literal(';'))),
      optional(g.Call),
      literal('}')
    ),
    (children, _fields, span, rawChildren) => {
      const selectors = children.filter(isSimpleSelector)
        .map(selector => complexSelector([{ compound: compoundSelectorOf([selector]) }]));
      if (selectors.length === 0) {
        throw new TypeError('Less keyframe block requires a selector.');
      }
      return withSourceSpan(
        withBlockBody(rule(selist(...selectors), children.filter(isStatement)), rawChildren),
        span
      );
    }
  );
  const Keyframes = node<AtRuleBlock>(
    'Keyframes',
    sequence(
      g.CssSyntaxKeyframesAtKeyword,
      field('prelude', choice(g.AtRuleInterpolation, BareVariableInterpolation, g.EscapedQuoted, g.StaticQuoted, g.Keyword)),
      literal('{'),
      // Less permits a detached-ruleset call as a keyframes-body entry. Keep
      // that as the existing typed Reference fact so a parameterized keyframe
      // name and its body are both grammar-owned.
      many(choice(g.ReferenceCall, g.KeyframeBlock)),
      literal('}')
    ),
    (children, fields, span, rawChildren) => {
      // The keyframes body may itself contain Reference values. Select header
      // facts only from the grammar region before `{`, rather than filtering
      // every value-shaped child in the whole production.
      requireField(fields, 'prelude');
      const bodyStart = children.findIndex(child => isTerminalText(child, '{'));
      if (bodyStart < 0) {
        throw new TypeError('Less keyframes lost its body boundary.');
      }
      const preludeParts = children.slice(1, bodyStart).filter(isValueNode);
      if (preludeParts.length === 0) {
        throw new TypeError('Less keyframes lost their header fact.');
      }
      return withSourceSpan(withBlockBody(
        atRuleBlock(
          requireToken(children[0]).value,
          preludeParts.length === 1 ? preludeParts[0]! : spaced(preludeParts),
          children.filter(isStatement)
        ),
        rawChildren
      ), span);
    }
  );
  // A dotted layer name is one syntactic identifier, rather than a selector or
  // a post-parse string shape. Keep its spelling in the ordinary Keyword node.
  const DottedAtRuleKeyword = node<ValueNode>(
    'DottedAtRuleKeyword',
    sequence(staticIdentifier, oneOrMore(sequence(noTrivia(literal('.')), noTrivia(staticIdentifier)))),
    children => keyword(children.map(requireTerminalText).join(''))
  );
  const StaticAtRuleCustomProperty = node<ValueNode>(
    'StaticAtRuleCustomProperty',
    g.LessSyntaxCustomProperty,
    children => keyword(requireToken(children[0]).value)
  );
  const staticIdentOrFunction = token(noTrivia(sequence(staticIdentifier, optional(literal('(')))));
  const StaticAtRuleIdentifier = node<ValueNode>(
    'Keyword',
    routed(),
    children => keyword(requireToken(children[0]).value)
  );
  const StaticAtRuleIdentOrFunction = dispatch(
    staticIdentOrFunction,
    caseOf('url(', RoutedStaticUrl),
    caseOf('calc(', CalcFunction),
    when(endsWith('('), GenericFunction),
    otherwise(StaticAtRuleIdentifier)
  );
  // Generic at-rule headers have no parser-owned syntax-preserving evaluation
  // model for interpolation or parenthesized forms. Their direct subset stays
  // static; `@layer` gets its own typed interpolation alternative below.
  const StaticAtRuleAtom = node<ValueNode>(
    'StaticAtRuleAtom',
    choice(
      g.EscapedQuoted,
      g.StaticQuoted,
      g.Color,
      g.NamedColor,
      g.Dimension,
      g.PagePseudo,
      g.Paren,
      g.DottedAtRuleKeyword,
      StaticAtRuleCustomProperty,
      StaticAtRuleIdentOrFunction
    ),
    children => requireValueNode(children[0])
  );
  const StaticAtRuleTerm = node<ValueNode>(
    'StaticAtRuleTerm',
    oneOrMore(g.StaticAtRuleAtom),
    (children) => {
      const values = children.map(requireValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const StaticAtRulePrelude = node<ValueNode>(
    'StaticAtRulePrelude',
    oneOrMoreSep(
      g.StaticAtRuleTerm,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields) => {
      const values = children.filter(isValueNode);
      if (values.length === 1) {
        return values[0]!;
      }
      const result = list(values, ',');
      const separators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => requireTerminalText(separator.value));
      return separators.length === values.length - 1 ? withValueLayout(result, separators) : result;
    }
  );
  const atPreludeWhitespace = noTrivia(regex(/[ \t\n\r\f]+/));
  const atPreludeComma = noTrivia(literal(','));
  const atPreludeGroup = noTrivia(choice(
    balanced(
      '(',
      ')'
    ),
    balanced(
      '[',
      ']'
    )
  ));
  const atPreludeQuoted = noTrivia(choice(
    scanSkipDoubleString,
    scanSkipSingleString
  ));
  const atPreludeText = noTrivia(regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/@ \t\n\r\f,;{}()[\]"'])+/));
  const CssAtRulePrelude = node<ValueNode | null>(
    'CssAtRulePrelude',
    parser(
      { trivia: atPreludeCommentTrivia },
      many(choice(
        atPreludeWhitespace,
        atPreludeComma,
        atPreludeGroup,
        atPreludeQuoted,
        BareVariableInterpolation,
        atPreludeText
      ))
    ),
    (children, _fields, _span, _rawChildren, triviaLog) => {
      const text = staticTextWithTriviaGaps(children, triviaLog).trim();
      return text === '' ? null : any(text);
    }
  );
  const lessOpaqueAtPreludeText = noTrivia(regex(/(?:\\[\s\S]|@(?!\{)|\/(?!\*)|[^\\/@ \t\n\r\f,;{}()[\]"'])+/));
  const lessOpaqueAtPreludeCapture = many(choice(
    atPreludeWhitespace,
    atPreludeComma,
    atPreludeGroup,
    atPreludeQuoted,
    BareVariableInterpolation,
    lessOpaqueAtPreludeText
  ));
  // CSS-defined statement at-rules have grammar-owned interpolation forms that
  // the generic at-rule subset intentionally does not accept. Keep the
  // namespace prefix and URI as ordinary typed values; this preserves
  // `@namespace @{prefix} "…"` without widening unknown at-rules such as
  // `@custom foo@{name};` into a raw/recovered-header path.
  // Gating note: `url(` overlaps the URI-only arm with an identifier-prefixed
  // namespace in the analyzer, but the glued `url(` delimiter belongs to
  // `StaticUrl`; dispatching on bare `url` would lose that distinction.
  const NamespacePrelude = node<ValueNode>(
    'NamespacePrelude',
    choice(
      g.StaticUrl,
      g.Quoted,
      sequence(
        choice(g.AtRuleInterpolation, g.Keyword),
        choice(g.Quoted, g.StaticUrl)
      )
    ),
    (children) => {
      const values = children.filter(isValueNode);
      const uri = values.at(-1);
      if (uri === undefined) {
        throw new TypeError('Less namespace prelude lost its URI value.');
      }
      return children.length === 1
        ? uri
        : spaced([values[0]!, uri]);
    }
  );
  const atRuleBlockBody = sequence(
    literal('{'),
    blockBody,
    optional(g.Call),
    literal('}')
  );
  const genericAtRuleBlockTail = choice(
    attempt(sequence(
      // Generic headers serialize as ordinary bytes. Their interpolation and
      // parenthesized forms need a dedicated syntax-preserving model, so this
      // This route deliberately leaves them closed.
      attempt(g.StaticAtRulePrelude),
      atRuleBlockBody
    )),
    sequence(
      not(peek(regex(/[ \t\n\r\f]*:/))),
      g.CssAtRulePrelude,
      atRuleBlockBody
    )
  );
  const AtRuleBlock = node<AtRuleBlock>(
    'AtRuleBlock',
    choice(
      sequence(
        layerAtRuleName,
        not(noTrivia(literal('('))),
        optional(choice(BareVariableInterpolation, g.InterpolatedValue, g.StaticAtRulePrelude)),
        atRuleBlockBody
      ),
      sequence(
        atRuleName,
        genericAtRuleBlockTail
      )
    ),
    (children, _fields, span, rawChildren) => {
      const prelude = children.find(isValueNode) ?? null;
      // A FunctionCall is a legal statement *and* a legal generic prelude
      // component. Exclude the exact selected prelude object rather than
      // reclassifying it through text or weakening the statement grammar.
      const body = children.filter(isStatement).filter(statement => statement !== prelude);
      return withSourceSpan(withBlockBody(atRuleBlock(requireToken(children[0]).value, prelude, body), rawChildren), span);
    }
  );
  const OpaqueAtPrelude = node<string | null>(
    'OpaqueAtPrelude',
    parser(
      { trivia: atPreludeCommentTrivia },
      lessOpaqueAtPreludeCapture
    ),
    (children, _fields, _span, _rawChildren, triviaLog) => {
      const text = children.length === 0 ? '' : staticTextWithTriviaGaps(children, triviaLog).trim();
      return text === '' ? null : text;
    }
  );
  const OpaqueBody = node<string>(
    'OpaqueBody',
    lessOpaqueBodyCapture,
    children => children.length === 0 ? '' : staticText(children)
  );
  const OpaqueAtRuleBlock = node<OpaqueAtRuleBlock>(
    'OpaqueAtRuleBlock',
    sequence(
      atRuleName,
      not(peek(regex(/[ \t\n\r\f]*:/))),
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
        throw new TypeError('Less opaque at-rule block lost its grammar-owned raw facts.');
      }
      return opaqueAtRuleBlock(
        requireToken(children[0]).value,
        prelude,
        rawBody
      );
    }
  );
  // CSS @charset is a single static token. Less 4 interpolated inside it, but
  // Less 5 deliberately rejects that legacy form. Recognize the authored form
  // here so the public diagnostic carries its exact grammar span instead of
  // falling through the root repetition as generic trailing input.
  const CharsetStatement = node<AtRuleStatement>(
    'AtRuleStatement',
    sequence(charsetAtRuleName, g.Quoted, literal(';')),
    (children, _fields, span) => {
      const prelude = requireValueNode(children[1]);
      if (prelude.type === 'Interpolation') {
        throw new LessDynamicCharsetError(span.start, span.end);
      }
      return atRuleStatement(requireToken(children[0]).value, prelude);
    }
  );
  const AtRuleStatement: Combinator<AtRuleStatement> = choice(
    CharsetStatement,
    node<AtRuleStatement>(
      'AtRuleStatement',
      dispatch(
        token(noTrivia(staticAtRuleStatementName)),
        caseOf('@namespace', sequence(routed(), g.NamespacePrelude, literal(';'))),
        caseOf(
          '@layer',
          sequence(
            routed(),
            not(noTrivia(literal('('))),
            optional(choice(BareVariableInterpolation, g.InterpolatedValue, g.StaticAtRulePrelude)),
            literal(';')
          )
        ),
        otherwise(sequence(
          routed(),
          choice(
            attempt(sequence(
              g.StaticAtRulePrelude,
              literal(';')
            )),
            sequence(
              not(peek(regex(/[ \t\n\r\f]*:/))),
              g.CssAtRulePrelude,
              literal(';')
            )
          )
        ))
      ),
      (children) => {
        const routedChildren = children.flatMap(child => Array.isArray(child) ? child : [child]);
        return atRuleStatement(requireToken(routedChildren[0]).value, routedChildren.find(isValueNode) ?? null);
      }
    )
  );
  const StaticNthArgument = node<string>(
    'StaticNthArgument',
    sequence(
      g.CssSyntaxNth,
      optional(sequence(g.CssSyntaxOfKeyword, parser({ trivia: staticSelectorTrivia }, g.StaticPseudoSelector)))
    ),
    (children) => {
      const nth = requireToken(children[0]).value;
      const selector = children.find(isSelectorList);
      return selector === undefined ? nth : `${nth} of ${selector.selectors.map(complexCanonical).join(',')}`;
    }
  );
  const StaticNthPseudo: Combinator<SimpleSelector> = choice(
    node<SimpleSelector>(
      'StaticNthChildPseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(
        token(noTrivia(sequence(pseudoDelimiter, g.CssSyntaxNthChildName, literal('(')))),
        g.StaticNthArgument,
        literal(')')
      )),
      children => simpleSelector(`${requireToken(children[0]).value}${requireString(children[1])})`)
    ),
    node<SimpleSelector>(
      'StaticNthTypePseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(
        token(noTrivia(sequence(pseudoDelimiter, g.CssSyntaxNthTypeName, literal('(')))),
        g.CssSyntaxNth,
        literal(')')
      )),
      children => simpleSelector(`${requireToken(children[0]).value}${requireToken(children[1]).value})`)
    )
  );
  // Less permits a variable interpolation as an An+B argument (`:nth-child(@{n})`).
  // Keep the pseudo delimiter/name, variable reference, and closing delimiter as
  // typed interpolation segments; no raw selector recovery or second parse is
  // needed when the value is substituted during evaluation.
  const InterpolatedNthPseudo = node<SimpleSelector>(
    'InterpolatedNthPseudo',
    parser({ trivia: staticSelectorTrivia }, sequence(
      token(noTrivia(sequence(pseudoDelimiter, choice(g.CssSyntaxNthChildName, g.CssSyntaxNthTypeName), literal('(')))),
      g.VariableInterpolation,
      literal(')')
    )),
    (children) => {
      const open = requireTerminalText(children[0]);
      const interpolationFact = requireInterpolationFact(children[1]);
      return interpolatedSimpleSelector(interpolation([
        { lit: open },
        { ref: interpolationFact.ref, unquote: true },
        { lit: ')' }
      ]));
    }
  );
  const extendPseudoNameOpen = parser(
    { trivia: staticSelectorTrivia },
    token(noTrivia(sequence(lessCaseWord('extend'), literal('('))))
  );
  // A functional pseudo's ARGUMENT may be interpolated (`:lang(@{lang})`,
  // `:dir(@{d})`), which no static argument grammar can recognize because the
  // argument's bytes do not exist until evaluation. Keep it structural: the
  // whole atom becomes one Interpolation-backed SimpleSelector holding typed
  // literal/ref parts, exactly like the interpolated nth and name pseudos. The
  // parser never joins it into text and never re-scans the span.
  // At least one interpolation is required, so a fully static argument stays on
  // the StaticPseudo route it already had.
  const InterpolatedArgumentPseudo = node<SimpleSelector>(
    'InterpolatedArgumentPseudo',
    parser({ trivia: staticSelectorTrivia }, sequence(
      token(noTrivia(sequence(
        pseudoDelimiter,
        not(extendPseudoNameOpen),
        g.LessSyntaxIdentifier,
        literal('(')
      ))),
      many(staticPseudoChunk),
      g.VariableInterpolation,
      many(choice(g.VariableInterpolation, staticPseudoChunk)),
      literal(')')
    )),
    (children) => {
      const open = requireTerminalText(children[0]);
      const parts = interpolationPartsFrom(children.slice(1, -1), true, open);
      parts.push({ lit: ')' });
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const StaticPseudoQuoted = node<string>(
    'StaticPseudoQuoted',
    staticQuotedBody,
    children => children.map(child => typeof child === 'string' ? child : requireToken(child).value).join('')
  );
  const staticPseudoInner = choice(g.StaticPseudoGroup, g.StaticPseudoSquare, g.StaticPseudoQuoted, staticPseudoChunk);
  const StaticPseudoGroup = node<string>(
    'StaticPseudoGroup',
    parser({ trivia: staticSelectorTrivia }, sequence(literal('('), many(staticPseudoInner), literal(')'))),
    (children, _fields, _span, _rawChildren, triviaLog) => staticTextWithTriviaGaps(children, triviaLog)
  );
  const StaticPseudoSquare = node<string>(
    'StaticPseudoSquare',
    parser({ trivia: staticSelectorTrivia }, sequence(literal('['), many(staticPseudoInner), literal(']'))),
    (children, _fields, _span, _rawChildren, triviaLog) => staticTextWithTriviaGaps(children, triviaLog)
  );
  const StaticNonSelectorPseudoArgument = node<string>(
    'StaticNonSelectorPseudoArgument',
    parser({ trivia: staticSelectorTrivia }, oneOrMore(staticPseudoInner)),
    (children, _fields, _span, _rawChildren, triviaLog) => staticTextWithTriviaGaps(children, triviaLog)
  );
  // A functional pseudo's static selector argument is the same recursive
  // selector grammar as a rule header. `rules()` names the cycle at macro
  // lowering (`pseudo argument -> selector -> compound -> pseudo`), so this
  // retains structural selector facts without a text scanner or a reparse.
  // Keep it local, like CSS's generic pseudo argument: it is an implementation
  // component of the public pseudo production, not a second parser API.
  // Retain the parsed `SelectorList` rather than collapsing it to text. A
  // whitelisted selector-function pseudo (`:is`/`:not`/…) keeps it as structured
  // `args`; `StaticSelectorPseudo` joins the opaque `:global`/`:local`
  // fallback via `complexCanonical`. The parser never bakes the inline
  // `:is(a, b)` spelling — core serialization owns that.
  const staticPseudoArgument = node<SelectorList>(
    'StaticPseudoArgument',
    parser({ trivia: staticSelectorTrivia }, g.StaticPseudoSelector),
    children => requireSelectorList(children[0])
  );
  // This selector family is private to functional pseudo arguments.  A block
  // comment immediately between two simple selectors is lexical trivia, not a
  // descendant relation (`.a/*x*/.b` is one compound); actual whitespace still
  // belongs to the complex-tail descendant boundary.
  const StaticPseudoCompound = node<CompoundSelector>(
    'StaticPseudoCompound',
    parser(
      { trivia: compoundSelectorTrivia },
      oneOrMore(choice(g.StaticNamespaceType, staticSimpleSelector, staticAmpersand, g.StaticPseudo, g.StaticNthPseudo, g.StaticAttribute))
    ),
    children => compoundSelectorOf(children.map((child) => {
      return isSimpleToken(child) ? child : simpleSelector(requireToken(child).value);
    }))
  );
  // This selector family is private to functional pseudo arguments.  Its tail
  // admits Less selector trivia immediately before the next compound, so
  // `.a /* note */ > /* note */ .b` remains one structured complex selector.
  // The ordinary outer selector continues to use ComplexTail, whose
  // no-trivia compound boundary is intentionally unchanged.
  const StaticPseudoComplexTail = node<ComplexTailFact>(
    'StaticPseudoComplexTail',
    sequence(optional(staticCombinator), parser({ trivia: staticSelectorTrivia }, g.StaticPseudoCompound)),
    combinatorTailReducer
  );
  const StaticPseudoComplex = node<ComplexSelector>(
    'StaticPseudoComplex',
    sequence(
      optional(relativeSelectorCombinator),
      g.StaticPseudoCompound,
      many(sequence(not(whenGuardAhead), g.StaticPseudoComplexTail))
    ),
    (children) => {
      const head = requireCompound(children.find(isCompound));
      const leading = children.find(child => isTerminalText(child, '>') || isTerminalText(child, '+') || isTerminalText(child, '~'));
      return complexSelector([
        { compound: head },
        ...children.filter(isComplexTailFact)
      ], leading === undefined ? undefined : requireCombinator(leading));
    }
  );
  const StaticPseudoSelectorTail = node<ComplexSelector>(
    'StaticPseudoSelectorTail',
    sequence(literal(','), parser({ trivia: staticSelectorTrivia }, g.StaticPseudoComplex)),
    children => requireComplex(children[1])
  );
  const StaticPseudoSelector = node<SelectorList>(
    'StaticPseudoSelector',
    sequence(g.StaticPseudoComplex, many(g.StaticPseudoSelectorTail)),
    children => selist(...requireComplexes(children))
  );
  // `*[ … ]` is only the glued capture delimiter around the existing static
  // selector-list grammar. It is a selector-valued Less value, not a text
  // capture: the selector grammar owns every branch boundary and the AST keeps
  // the canonical branches for selector interpolation.
  const SelectorCapture = node<SelectorCapture>(
    'SelectorCapture',
    sequence(noTrivia(literal('*[')), parser({ trivia: staticSelectorTrivia }, g.StaticPseudoSelector), noTrivia(literal(']'))),
    (children) => {
      const selector = requireSelectorList(children[1]);
      const branches = selector.selectors.map(complexCanonical);
      return selectorCapture(branches, `*[${branches.join(', ')}]`);
    }
  );
  const pseudoOpen = token(noTrivia(sequence(
    regex(/::?(?![ \t\n\r\f])/),
    not(extendPseudoNameOpen),
    not(g.CssSyntaxNthName),
    g.LessSyntaxIdentifier,
    optional(literal('('))
  )));
  const staticSelectorPseudoRouted = node<SimpleToken>(
    'StaticSelectorPseudo',
    sequence(routed(), staticPseudoArgument, literal(')')),
    children => staticSelectorPseudoFrom(
      requireToken(children[0]).value.slice(0, -1),
      children[1]
    )
  );
  const interpolatedArgumentPseudoRouted = node<SimpleSelector>(
    'InterpolatedArgumentPseudo',
    sequence(
      routed(),
      many(staticPseudoChunk),
      g.VariableInterpolation,
      many(choice(g.VariableInterpolation, staticPseudoChunk)),
      literal(')')
    ),
    (children) => {
      const open = requireToken(children[0]).value;
      const parts = interpolationPartsFrom(children.slice(1, -1), true, open);
      parts.push({ lit: ')' });
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const staticNonSelectorPseudoRouted = node<SimpleSelector>(
    'StaticNonSelectorPseudo',
    sequence(routed(), g.StaticNonSelectorPseudoArgument, literal(')')),
    children => staticNonSelectorPseudoFrom(
      requireToken(children[0]).value.slice(0, -1),
      requireString(children[1])
    )
  );
  const staticBarePseudoRouted = node<SimpleSelector>(
    'StaticNonSelectorPseudo',
    routed(),
    children => staticNonSelectorPseudoFrom(requireToken(children[0]).value, null)
  );
  const pseudo = dispatch(
    pseudoOpen,
    caseOf(
      [':is(', '::is(', ':not(', '::not(', ':has(', '::has(', ':where(', '::where(', ':matches(', '::matches(', ':global(', '::global(', ':local(', '::local('],
      choice(staticSelectorPseudoRouted, interpolatedArgumentPseudoRouted)
    ),
    when(
      endsWith('('),
      choice(interpolatedArgumentPseudoRouted, staticNonSelectorPseudoRouted)
    ),
    otherwise(staticBarePseudoRouted)
  );
  // `:extend(...)` is an inline-extend production, not a pseudo. Like ordinary
  // function openers, every pseudo-function opener is glued, so
  // `:extend /*...*/ (` must not fall through as a generic pseudo or reparsed
  // selector surface.
  const staticPseudoDispatch = dispatch(
    pseudoOpen,
    caseOf(
      [':is(', '::is(', ':not(', '::not(', ':has(', '::has(', ':where(', '::where(', ':matches(', '::matches(', ':global(', '::global(', ':local(', '::local('],
      staticSelectorPseudoRouted
    ),
    when(
      endsWith('('),
      staticNonSelectorPseudoRouted
    ),
    otherwise(staticBarePseudoRouted)
  );
  const StaticPseudo = node<SimpleToken>(
    'StaticPseudo',
    staticPseudoDispatch,
    children => requireSimpleToken(children.find(isSimpleToken))
  );
  // A Less pseudo name may itself be interpolated (`:@{pseudo}` / `::@{pseudo}`)
  // and remains one interpolation-backed selector atom. Keep the delimiter and
  // interpolation structural so evaluation can substitute the name without a
  // selector-string reparse.
  const InterpolatedPseudo = node<SimpleSelector>(
    'InterpolatedPseudo',
    noTrivia(sequence(pseudoDelimiter, g.VariableInterpolation)),
    (children) => {
      const delimiter = requireTerminalText(children[0]);
      const interpolationFact = requireInterpolationFact(children[1]);
      return interpolatedSimpleSelector(interpolation([
        { lit: delimiter },
        { ref: interpolationFact.ref, unquote: true }
      ]));
    }
  );
  const StaticAttributeNamespace = node<string>(
    'StaticAttributeNamespace',
    choice(
      // `|=` is the CSS attribute operator, not a namespace separator. Guard
      // the namespace arm before consuming `|` so a quoted interpolation after
      // `prop|=` remains on the ordinary attribute-value route.
      sequence(staticIdentifier, literal('|'), not(literal('='))),
      literal('*|'),
      literal('|')
    ),
    children => children.map(requireToken).map(token => token.value).join('')
  );
  const StaticNamespaceType = node<SimpleSelector>(
    'StaticNamespaceType',
    sequence(g.StaticAttributeNamespace, choice(staticIdentifier, literal('*'))),
    children => simpleSelector(children.map(requireTerminalText).join(''))
  );
  const StaticAttributeName = node<StaticAttributeNameFact>(
    'StaticAttributeName',
    sequence(optional(g.StaticAttributeNamespace), staticIdentifier),
    children => ({
      namespace: children.find((child): child is string => typeof child === 'string') ?? '',
      name: requireToken(children.at(-1)).value
    })
  );
  const StaticAttributeQuoted = node<string>(
    'StaticAttributeQuoted',
    staticQuotedBody,
    children => children.map(requireToken).map(token => token.value).join('')
  );
  // Less's attribute name/value interpolation is one complete selector token.
  // Keep every literal delimiter and every interpolation reference (`@{…}` and
  // `${…}`) as an `Interpolation` part rather than recovering the bracket text
  // after parsing. Dynamic pseudos and extend headers remain separate, rejected forms.
  // Attribute name and value interpolation share one grammar body; the reducers
  // differ only by whether each reference part is unquoted (name) or kept quoted
  // (value, so `[data=@{value}]` retains its source spelling).
  const attributeInterpolationTokenBody = noTrivia(sequence(
    optional(choice(g.LessSyntaxInterpolatedValueStart, g.LessSyntaxInterpolatedValueDash)),
    g.Interpolation,
    many(interpolatedValueTail)
  ));
  const InterpolatedAttributeToken = node<Interpolation>(
    'InterpolatedAttributeToken',
    attributeInterpolationTokenBody,
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const InterpolatedAttributeValueToken = node<Interpolation>(
    'InterpolatedAttributeValueToken',
    attributeInterpolationTokenBody,
    children => interpolation(interpolationPartsFrom(children, false))
  );
  const InterpolatedAttributeQuoted = node<Interpolation>(
    'InterpolatedAttributeQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.VariableInterpolation, g.LessSyntaxQuotedDoubleChunk, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.VariableInterpolation, g.LessSyntaxQuotedSingleChunk, literal('@'), literal('$'))), literal('\'')))
    ),
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const StaticAttributeMatch = node<StaticAttributeMatchFact>(
    'StaticAttributeMatch',
    sequence(
      g.CssSyntaxAttributeOperator,
      choice(staticIdentifier, g.StaticAttributeQuoted),
      optional(sequence(selectorAttributeModifierSpace, g.CssSyntaxAttributeModifier))
    ),
    children => ({
      operator: requireToken(children[0]).value,
      value: typeof children[1] === 'string' ? children[1] : requireToken(children[1]).value,
      modifier: children.length === 2 ? null : requireToken(children[3]).value
    })
  );
  const StaticAttribute = node<SimpleSelector>(
    'StaticAttribute',
    sequence(literal('['), g.StaticAttributeName, optional(g.StaticAttributeMatch), literal(']')),
    (children) => {
      const match = children.find((child): child is StaticAttributeMatchFact =>
        typeof child === 'object' && child !== null && 'operator' in child && 'value' in child && 'modifier' in child
      );
      const name = children.find((child): child is StaticAttributeNameFact =>
        typeof child === 'object' && child !== null && 'namespace' in child && 'name' in child
      );
      if (name === undefined) {
        throw new TypeError('Less grammar produced an attribute selector without a name.');
      }
      return simpleSelector(`[${name.namespace}${name.name}${match === undefined ? '' : `${match.operator}${match.value}${match.modifier === null ? '' : ` ${match.modifier}`}`}]`);
    }
  );
  const InterpolatedAttribute = node<SimpleSelector>(
    'InterpolatedAttribute',
    sequence(
      literal('['),
      choice(
        sequence(
          optional(g.StaticAttributeNamespace),
          g.InterpolatedAttributeToken,
          optional(sequence(
            g.CssSyntaxAttributeOperator,
            choice(g.InterpolatedAttributeValueToken, g.InterpolatedAttributeQuoted, g.LessSyntaxIdentifier, g.StaticAttributeQuoted),
            optional(sequence(selectorAttributeModifierSpace, g.CssSyntaxAttributeModifier))
          ))
        ),
        sequence(
          g.StaticAttributeName,
          g.CssSyntaxAttributeOperator,
          choice(g.InterpolatedAttributeValueToken, g.InterpolatedAttributeQuoted),
          optional(sequence(selectorAttributeModifierSpace, g.CssSyntaxAttributeModifier))
        )
      ),
      literal(']')
    ),
    (children) => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterp(child)) {
          for (const part of child.parts) {
            if ('lit' in part) {
              appendInterpolationLiteral(parts, part.lit);
            } else {
              parts.push(part);
            }
          }
        } else if (isStaticAttributeNameFact(child)) {
          const name = child;
          appendInterpolationLiteral(parts, `${name.namespace}${name.name}`);
        } else if (typeof child === 'string') {
          appendInterpolationLiteral(parts, child);
        } else {
          appendInterpolationLiteral(parts, requireToken(child).value);
        }
      }
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const BareInterpolatedSelector = node<SimpleSelector>(
    'BareInterpolatedSelector',
    sequence(g.VariableInterpolation, bareInterpolatedSelectorEnd),
    (children) => {
      const fact = requireInterpolationFact(children[0]);
      return interpolatedSimpleSelector(interpolation([{ ref: fact.ref, unquote: true }]));
    }
  );
  // Adjacent selector interpolations are one compound simple, not two selector
  // branches. Keep this arm separate from literal suffixes so Parseman's
  // generated choice commits on the second `@{…}` without treating it as a
  // static selector-tail byte sequence.
  const AdjacentInterpolatedSelector = node<SimpleSelector>(
    'AdjacentInterpolatedSelector',
    noTrivia(sequence(g.VariableInterpolation, oneOrMore(g.VariableInterpolation))),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  // A bare interpolation may be followed by a glued selector simple, such as
  // `@{base}.bbb`. Keep that suffix as an interpolation literal segment rather
  // than recovering a completed selector string after parse.
  const BareInterpolatedSelectorWithSuffix = node<SimpleSelector>(
    'BareInterpolatedSelectorWithSuffix',
    noTrivia(sequence(g.VariableInterpolation, oneOrMore(choice(interpolatedSelectorTail, staticSimpleSelector)))),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  const InterpolatedSimpleSelector = node<SimpleSelector>(
    'InterpolatedSimpleSelector',
    noTrivia(sequence(
      interpolatedSelectorPrefix,
      g.VariableInterpolation,
      many(choice(interpolatedSelectorTail, g.VariableInterpolation))
    )),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  // `&` plus a glued Less interpolation is one parent-suffix selector token,
  // not a static parent selector followed by a second compound member. The
  // existing Interpolation-backed SimpleSelector is its complete canonical model.
  const InterpolatedParentSuffix = node<SimpleSelector>(
    'InterpolatedParentSuffix',
    noTrivia(sequence(
      staticAmpersand,
      g.VariableInterpolation,
      many(choice(interpolatedSelectorTail, g.VariableInterpolation))
    )),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  const compoundSimple = choice(
    g.InterpolatedParentSuffix,
    g.InterpolatedSimpleSelector,
    g.AdjacentInterpolatedSelector,
    g.BareInterpolatedSelectorWithSuffix,
    g.BareInterpolatedSelector,
    g.StaticNamespaceType,
    staticSimpleSelector,
    staticAmpersand,
    // Generic and selector pseudos (`:hover`, `::before`, `:not(...)`) dominate
    // real selectors; the two nth arms and the interpolated-name arm are rare.
    // StaticPseudo carries the generic/selector case and is name-set
    // disjoint from the other three — its NonSelectorPseudo `not(nth-name)` /
    // `not(selector-name)` guards and its SelectorPseudo name regex mean it can
    // never match an nth pseudo or an interpolated-name pseudo (`:@{n}`). So
    // trying it first lets the common pseudo commit on the first arm instead of
    // paying four failed `::?`+name re-scans through the nth/interp arms, while a
    // rare nth/interp pseudo still falls through to its arm with output and PEG
    // priority unchanged.
    pseudo,
    g.InterpolatedNthPseudo,
    g.StaticNthPseudo,
    g.InterpolatedArgumentPseudo,
    g.InterpolatedPseudo,
    g.StaticAttribute,
    g.InterpolatedAttribute
  );
  const Compound: Combinator<CompoundSelector> = node<CompoundSelector>(
    'Compound',
    // Production's CompoundSelector is a run of adjacent simple selectors.
    // Keep that same structural distinction here: `.a#id` is one CompoundSelector with
    // two SimpleSelector children, not a recovered selector string. Static pseudos use
    // the same canonical SimpleSelector representation. The exact shared An+B terminal
    // is also direct; arbitrary pseudo arguments, attributes, and interpolation
    // remain outside this slice until their own typed payloads have reductions.
    // The functional form precedes its no-argument prefix so ordered choice does
    // not commit `:nth-child` before seeing the opening parenthesis.
    parser({ trivia: compoundSelectorTrivia }, oneOrMore(compoundSimple)),
    (children) => {
      const simples = children.map(child => isSimpleToken(child) ? child : simpleSelector(requireToken(child).value));
      return compoundSelectorOf(simples);
    }
  );
  const Complex = node<ComplexSelector>(
    'Complex',
    sequence(
      optional(relativeSelectorCombinator),
      g.Compound,
      many(sequence(not(whenGuardAhead), g.ComplexTail))
    ),
    (children, _fields, span) => {
      const head = children.find(isCompound);
      if (head === undefined) {
        throw new TypeError('Less grammar produced a selector without a head compound.');
      }
      const leading = children.find(child => isTerminalText(child, '>') || isTerminalText(child, '+') || isTerminalText(child, '~'));
      const tails = children.filter(isComplexTailFact).map((tail): ComplexTailFact => {
        if (typeof tail !== 'object' || tail === null || !('comb' in tail) || !('compound' in tail)) {
          throw new TypeError('Less grammar produced an invalid selector tail.');
        }
        return tail as ComplexTailFact;
      });
      return withSourceSpan(complexSelector([
        { compound: head },
        ...tails
      ], leading === undefined ? undefined : requireCombinator(leading)), span);
    }
  );
  const ComplexTail = node<ComplexTailFact>(
    'ComplexTail',
    sequence(optional(staticCombinator), g.Compound),
    combinatorTailReducer
  );
  const SelectorTail = node<ComplexSelector>(
    'SelectorTail',
    sequence(literal(','), g.Complex),
    children => requireComplex(children[1])
  );
  const Selector = node<SelectorList>(
    'Selector',
    parser({ trivia: outerSelectorTrivia }, sequence(g.Complex, many(g.SelectorTail))),
    (children, _fields, span) => withSourceSpan(selist(...requireComplexes(children)), span)
  );
  const extendAllFlag = regex(/!?all(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const StaticExtendCompound = node<CompoundSelector>(
    'StaticExtendCompound',
    parser(
      { trivia: compoundSelectorTrivia },
      oneOrMore(choice(g.StaticNamespaceType, staticSimpleSelector, staticAmpersand, pseudo, g.StaticNthPseudo, g.StaticAttribute))
    ),
    children => compoundSelectorOf(children.map(child => isSimpleToken(child) ? child : simpleSelector(requireToken(child).value)))
  );
  const StaticExtendComplexTail = node<ComplexTailFact>(
    'StaticExtendComplexTail',
    sequence(optional(staticCombinator), StaticExtendCompound),
    combinatorTailReducer
  );
  const ExtendComplex = node<ComplexSelector>(
    'ExtendComplex',
    sequence(
      StaticExtendCompound,
      many(sequence(not(regex(/[ \t\n\r\f]*!?all(?=[ \t\n\r\f]*(?:,|\)))/i)), StaticExtendComplexTail))
    ),
    (children, _fields, span) => withSourceSpan(complexSelector([
      { compound: requireCompound(children[0]) },
      // The terminal-flag lookahead is a recognition-only child. Keep only
      // actual tail facts: otherwise the successful stop check is emitted as
      // a fake descendant tail with no compound.
      ...children.slice(1).filter(isComplexTailFact)
    ]), span)
  );
  const ExtendTargetComplexTail = node<ComplexTailFact>(
    'ExtendTargetComplexTail',
    sequence(optional(staticCombinator), g.Compound),
    combinatorTailReducer
  );
  const ExtendTargetComplex = node<ComplexSelector>(
    'ExtendTargetComplex',
    sequence(
      // An extend target can carry a typed selector interpolation, unlike its
      // inline subject. Keep `.@{name}` in the AST rather than rescanning it.
      g.Compound,
      many(sequence(not(regex(/[ \t\n\r\f]*!?all(?=[ \t\n\r\f]*(?:,|\)))/i)), ExtendTargetComplexTail))
    ),
    (children, _fields, span) => withSourceSpan(complexSelector([
      { compound: requireCompound(children[0]) },
      ...children.slice(1).filter(isComplexTailFact)
    ]), span)
  );
  const ExtendTarget = node<ExtendTargetFact>(
    'ExtendTarget',
    sequence(ExtendTargetComplex, optional(extendAllFlag)),
    children => ({
      target: selist(requireComplex(children[0])),
      partial: children.some(child => isTerminalText(child, 'all') || isTerminalText(child, '!all'))
    })
  );
  const ExtendPseudo = node<readonly ExtendTargetFact[]>(
    'ExtendPseudo',
    sequence(
      noTrivia(sequence(literal(':'), literal('extend'), literal('('))),
      oneOrMoreSep(
        g.ExtendTarget,
        literal(',')
      ),
      literal(')')
    ),
    children => children.filter(isExtendTargetFact)
  );
  const selectorBranchBoundary = peek(choice(literal(','), whenGuardAhead, literal('{')));
  const ExtendStatement = node<ExtendInstruction[]>(
    'ExtendStatement',
    sequence(literal('&'), ExtendPseudo, optional(literal(';'))),
    children => children
      .flatMap(child => Array.isArray(child) ? child.filter(isExtendTargetFact) : [])
      .map(target => ({ target: target.target, partial: target.partial }))
  );
  const selectorBranchContinuation = choice(
    sequence(ExtendPseudo, selectorBranchBoundary),
    selectorBranchBoundary
  );
  const SelectorBranch = node<SelectorBranchFact>(
    'SelectorBranch',
    sequence(ExtendComplex, selectorBranchContinuation),
    (children) => {
      const subject = requireComplex(children[0]);
      const extensions = children
        .filter(Array.isArray)
        .flatMap(child => child.filter(isExtendTargetFact))
        .map(target => ({ target: target.target, partial: target.partial, subject: selist(subject) }));
      return { selector: subject, extensions };
    }
  );
  const DynamicSelectorBranch = node<SelectorBranchFact>(
    'SelectorBranch',
    g.Complex,
    children => ({ selector: requireComplex(children[0]), extensions: [] })
  );
  const selectorListWithExtends = node<SelectorListWithExtendsFact>(
    'SelectorListWithExtends',
    parser(
      { trivia: outerSelectorTrivia },
      oneOrMoreSep(
        choice(SelectorBranch, DynamicSelectorBranch),
        literal(',')
      )
    ),
    (children, _fields, span) => ({
      selector: withSourceSpan(selist(...children.flatMap(child => isSelectorBranchFact(child)
        ? [child.selector]
        : [])), span),
      extensions: children.filter(isSelectorBranchFact).flatMap(branch => branch.extensions)
    })
  );
  const RulesetWithExtends = node<Rule>(
    'Ruleset',
    sequence(selectorListWithExtends, optional(g.MixinGuard), literal('{'), rulesetBody, optional(g.Call), literal('}'), optional(literal(';'))),
    (children, _fields, span, rawChildren) => {
      const selectorFact = requireSelectorListWithExtendsFact(children[0]);
      const bodyExtensions = children.filter(Array.isArray).flatMap(child => child.filter(isExtendInstruction));
      const extensions = [...selectorFact.extensions, ...bodyExtensions];
      return withSourceSpan(withBlockBody(
        rule(
          selectorFact.selector,
          // The fixed sequence places only direct declaration/comment facts between
          // the braces. This validates that fact list; it never reparses body text.
          requireRulesetBody(children.filter(isStatement)),
          extensions.length === 0 ? undefined : extensions,
          children.find(isMixinGuard)
        ),
        rawChildren
      ), span);
    }
  );
  const Stylesheet = node<Stylesheet>(
    'Stylesheet',
    sequence(many(choice(atStatement, mixinStatement, g.Each, g.FunctionStatement, guardedRuleset, rootDeclarationItem, literal(';'))), optional(g.Call)),
    children => stylesheet(children.filter(isStatement)),
    { trailingTrivia: true }
  );

  return {
    Stylesheet,
    Document: Stylesheet,
    VarDeclaration,
    ImportStatement,
    PluginDirective,
    ValueBlockDeclaration,
    ValueBlock,
    IndirectVariableReference,
    VariableReferenceChain,
    VariableReference,
    PropertyReference,
    VariableInterpolation,
    PropertyInterpolation,
    Interpolation,
    AtRuleInterpolation,
    InterpolationAccessor,
    ReferenceTail,
    InterpolatedValue,
    InterpolatedProperty,
    Keyword,
    NamedColor,
    Color,
    Dimension,
    UnicodeRange,
    EscapeValue,
    PercentEscape,
    PagePseudo,
    DoubledQuoteArgument,
    FunctionArgument,
    FunctionScalarArgument,
    ArgumentValueSequence,
    FunctionCondition,
    FunctionConditionOr,
    FunctionConditionAnd,
    FunctionConditionTerm,
    FunctionConditionOperand,
    FunctionConditionParen,
    Call,
    CallArgumentFunction,
    FormatFunction,
    CallArgumentValue,
    FunctionStatement,
    Value,
    SelectorCapture,
    MathAtom,
    MathUnary,
    MathProduct,
    MathSum,
    TopProduct,
    TopSum,
    PreservedDivision,
    EscapedParen,
    Paren,
    ValueSequence,
    ValueList,
    VariableValue,
    ImportantValue,
    ValueListWithPriority,
    CustomPropertyName,
    CustomAtKeywordText,
    CustomPart,
    CustomInnerPart,
    CustomParen,
    CustomSquare,
    CustomCurly,
    CustomValue,
    CssCustomPropertyValue,
    CustomDeclaration,
    PunctuationMapDeclaration,
    Declaration,
    MixinParam,
    MixinParameterList,
    MixinDefinition,
    PositionalMixinCallArgument,
    MixinArgumentGroup,
    MixinArguments,
    MixinCall,
    BareMixinCall,
    FlatMixinCall,
    NamespacedMixinCall,
    NamespacedMixinValue,
    MixinPathTail,
    MixinReference,
    ReferenceCall,
    MixinGuard,
    MixinGuardTopOr,
    MixinGuardTopAnd,
    MixinGuardTopTerm,
    MixinGuardOr,
    MixinGuardAnd,
    MixinGuardTerm,
    MixinGuardOperand,
    EachName,
    BodyStatement,
    EachCallback,
    Each,
    SupportsValue,
    SupportsFeature,
    SupportsInParens,
    SupportsCondition,
    GeneralEnclosedContent,
    GeneralEnclosedGroup,
    GeneralEnclosedQuoted,
    GeneralEnclosedFunctionName,
    GeneralEnclosed,
    SupportsBlock,
    QueryValue,
    QueryLogicalGroup,
    QueryNegatedFeature,
    QueryColonFeature,
    QueryFeature,
    QueryClause,
    QueryPrelude,
    MediaQueryTerm,
    MediaQueryOnlyClause,
    MediaQueryClause,
    MediaQueryPrelude,
    ContainerStyleQuery,
    ContainerScrollStateQuery,
    ContainerName,
    ContainerQueryAtom,
    ContainerCondition,
    MediaContainerBody,
    MediaContainerBlock,
    KeyframeSelector,
    KeyframeBlock,
    Keyframes,
    DottedAtRuleKeyword,
    StaticAtRuleAtom,
    StaticAtRuleTerm,
    StaticAtRulePrelude,
    CssAtRulePrelude,
    NamespacePrelude,
    AtRuleBlock,
    OpaqueAtPrelude,
    OpaqueBody,
    OpaqueAtRuleBlock,
    AtRuleStatement,
    StaticPseudo,
    InterpolatedPseudo,
    InterpolatedNthPseudo,
    InterpolatedArgumentPseudo,
    StaticNthPseudo,
    StaticNthArgument,
    StaticNonSelectorPseudoArgument,
    StaticPseudoGroup,
    StaticPseudoSquare,
    StaticPseudoQuoted,
    StaticPseudoCompound,
    StaticPseudoComplexTail,
    StaticPseudoComplex,
    StaticPseudoSelectorTail,
    StaticPseudoSelector,
    StaticAttributeNamespace,
    StaticNamespaceType,
    StaticAttributeName,
    StaticAttributeQuoted,
    StaticAttributeMatch,
    StaticAttribute,
    InterpolatedAttributeToken,
    InterpolatedAttributeValueToken,
    InterpolatedAttributeQuoted,
    InterpolatedAttribute,
    InterpolatedSimpleSelector,
    BareInterpolatedSelector,
    AdjacentInterpolatedSelector,
    BareInterpolatedSelectorWithSuffix,
    InterpolatedParentSuffix,
    Compound,
    ComplexTail,
    Complex,
    SelectorTail,
    Selector,
    ExtendComplex,
    ExtendTarget,
    ExtendStatement,
    RulesetWithExtends,
    Quoted,
    StaticQuoted,
    EscapedQuoted,
    StaticUrl,
    UrlInterpolation,
    DynamicUrl,
    ImportOption,
    ImportOptions,
    ImportTarget,
    ImportTail,
    StaticTail,
    StaticTailGroup,
    StaticTailParen,
    whitespace,
    rw: whitespace
  };
};

export const lessGrammar = composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment] }, lessGrammarFactory)]);
export const lessAstGrammar = lessGrammar;

/** Public Less CST artifact: the same grammar factory compiled in CST mode. */
export const lessCstGrammar = composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment], hostMode: 'cst' }, lessGrammarFactory)]);
