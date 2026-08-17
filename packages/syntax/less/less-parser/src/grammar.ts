/**
 * Functional Less host-mode grammar.
 *
 * CSS base: ../../../css/css-parser/src/grammar.ts
 *
 * Less extends CSS and adds or overrides only:
 * - Language-specific features: @variables, property variables, detached
 *   rulesets, mixins, guards, loops, plugin/import options, escaped strings,
 *   and inline :extend(...). Extends are collected while parsing selectors
 *   because reparsing selectors to discover them loses source ownership.
 * - Expanded CSS shapes: dynamic/interpolated values, selectors, property
 *   names, imports, and media/query terms where Less permits runtime data.
 * - Less-specific placement: block and at-rule ordering/nesting deviations
 *   that are documented Less behavior rather than generic CSS structure.
 * Unchanged CSS productions remain CSS-owned; an override changes the smallest
 * child, value slot, or reference that Less syntax actually changes.
 *
 * Its structural `node(parser)` entries are consumed by the CST runner or by
 * parser-local AST reductions; core supplies neither a parse host nor a
 * parse entry.
 */
import {
  attempt, rules, classifiedTrivia, composeLeaf,
  node, regex, literal, sequence, choice, many, oneOrMore, oneOrMoreSep, optional,
  not, scanTo, balanced, parser, noTrivia, label, word, keywords, field, leaf, peek,
  dispatch, endsWith, makeWhen, makeWord, matches, otherwise, routed, token, transform, when
} from 'parseman' with { type: 'macro' };
import type { Combinator, FieldCapture, FieldMap, Span } from 'parseman';
import { cssSyntax, lessSyntax } from '@jesscss/parser-shared/recognition';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';
import { any, atRuleBlock, atRuleStatement, block, bodySpanFromRaw, callArg, color, selectorBranchCanonical, selectorBranchOf, condition, decl, classifyValueBlock, dimension, expression, forNode, funcCall, important, importIsCompileTime, interpolation, interpolatedSimpleSelector, isForBinding, isSpannedToken, isToken, keyword, list, mixinCall, mixinDef, opaqueAtRuleBlock, operation, ifNode, ifValue, propertyReference, pseudoSelector, quoted, reference, relativeSelector, selectorCapture, selectorTermOf, semanticGapText, styleImport, stylesheet, rule, selist, simpleSelector, sourceSpanOf, spaced, url, variableDeclaration, variableReference, valueLayoutOf, withBlockBody, withBodySpan, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { SourceSpan, SpannedToken, Token, AnonymousMixin, Any, AtRuleBlock, AtRuleStatement, CallArg, Combinator as SelectorCombinator, ComplexSelector, Declaration, ExtendInstruction, For, ForBinding, Expression, FunctionCall, If, IfBranch, IfValueBranch, Block, Important, Interpolation, Keyword, List, Lookup, MixinCall, MixinDefinition, OpaqueAtRuleBlock, Param, Plugin, Quoted, Reference, ReferenceStep, SelectorBranch, SelectorCapture, SelectorTerm, Stylesheet, Ruleset, SelectorList, SimpleSelector, SimpleToken, Statement, StyleImport, Url, ValueNode, ValueSlot, VariableDeclaration } from '@jesscss/core/ast';
import { requireLessParseState } from './parse-state.js';
import { LessBareVariableInterpolationError, LessDynamicCharsetError, LessImportPostludeError, LessInlineJavaScriptError, LessUnparenthesizedMixinGuardError, LessUnsupportedMixinNameError, LessUnsupportedVariableNameError } from './parse-error.js';

// ---------------------------------------------------------------------------
// Grammar — Less host-mode grammar.
// ---------------------------------------------------------------------------

/** A `Lookup` whose target is named literally — the `@name` / `$prop` shapes. */
type VarRef = Lookup & { readonly name: string };
/** A `Lookup` whose target is named by a nested node — Less `@@name`. */
type IndirectRef = Lookup & { readonly name: ValueNode };
type ChildContainer = { readonly rules: readonly unknown[] };
type InterpolationFact = { readonly ref: ValueNode; readonly src: string };
type InterpolationAccessorFact = { readonly key: ValueNode | number; readonly keyKind: 'var' | 'prop' | 'index'; readonly src: string };
/** A typed continuation of a left-associated public Reference chain. */
type ReferenceTailFact = { readonly step: Reference['steps'][number]; readonly src: string };
type ComplexTailFact = { readonly combinator: ' ' | '>' | '+' | '~' | '|' | '||'; readonly term: SelectorTerm };
type MixinPathSegmentFact = { readonly combinator: ' ' | '>'; readonly selector: string };
type LessEachCallback = { readonly binding: ForBinding; readonly rules: Statement[] };
type MixinGuard = NonNullable<MixinDefinition['guard']>;
type MixinCallArgument = MixinCall['args'][number];

/** One authored FUNCTION-call argument. The same {@link CallArg} a mixin-call
 *  argument is — `fade(@c, @amount: 50%)` and `.m(@amount: 50%)` are one
 *  construct in two callee positions. */
type LessCallArg = CallArg<ValueSlot>;
type CallValue = ValueSlot | MixinCall;
type MixinInteriorItem =
  | { readonly kind: 'binding'; readonly reference: VarRef; readonly default?: CallValue; readonly rest: boolean }
  | { readonly kind: 'anonymous-rest' }
  | { readonly kind: 'positional'; readonly value: CallValue };
type MixinInteriorFact = {
  readonly items: readonly MixinInteriorItem[];
  readonly separators: readonly (',' | ';')[];
  readonly trailingSeparator?: ',' | ';';
};
type MixinReferenceBaseFact = { readonly call: MixinCall; readonly raw: string };
type AttributeMatchFact = { readonly operator: string; readonly value: string; readonly modifier: string | null };
type AttributeNameFact = { readonly namespace: string; readonly name: string };
type ExtendTargetFact = { readonly target: SelectorList; readonly partial: boolean };
type BodyExtendFact = { readonly bodyExtensions: readonly ExtendInstruction[] };
type SelectorBranchFact = { readonly selector: SelectorBranch; readonly extensions: readonly ExtendInstruction[] };
type SelectorListWithExtendsFact = { readonly selector: SelectorList; readonly extensions: readonly ExtendInstruction[] };
type MixinDefinitionFact = {
  readonly params: readonly Param[];
  readonly guard?: MixinGuard;
  readonly rules: readonly Statement[];
  readonly bodySpan?: SourceSpan;
};
type MixinCallFact = { readonly args: readonly MixinCallArgument[]; readonly important: boolean };
type BareMixinCallFact = { readonly important: boolean };
type MixinStatementFact = MixinDefinitionFact | MixinCallFact;
type RulesetTailFact = {
  /** INLINE `:extend()` written on the first branch; its subject is that branch alone. */
  readonly firstExtensions: readonly ExtendTargetFact[];
  readonly branches: readonly SelectorBranchFact[];
  readonly selectorEnd: number;
  readonly guard?: MixinGuard;
  readonly rules: readonly Statement[];
  readonly extensions: readonly ExtendInstruction[];
  readonly bodySpan?: SourceSpan;
  readonly terminated?: true;
};
type CustomValuePart = string | InterpolationFact | Lookup | readonly CustomValuePart[];
type EnclosedNameFact = { readonly name: string };
type FunctionConditionFact = {
  readonly guard: MixinGuard;
  readonly src: string;
  readonly grouped: boolean;
  readonly hasComparison: boolean;

  /** The operand a BARE condition was built from, kept so a following comparison
   *  operator can reclaim it rather than unpick the {@link lessTruth} lowering. */
  readonly bare?: ValueNode;
};
type UnsupportedVariableNameFact = { readonly unsupportedVariableName: string };
type SlashBoundaryFact = { readonly before: string; readonly after: string };

/** Rules this file defines; macro-fused recognition inputs are not local output. */
type LessRules = {
  Stylesheet: Combinator<Stylesheet>;
  Document: Combinator<Stylesheet>;
  VarDeclaration: Combinator<VariableDeclaration>;
  ImportStatement: Combinator<StyleImport | AtRuleStatement>;
  PluginDirective: Combinator<Plugin>;
  ValueBlockDeclaration: Combinator<VariableDeclaration>;
  ValueBlock: Combinator<ValueNode>;
  IndirectVariableReference: Combinator<Lookup>;
  VariableReferenceChain: Combinator<ValueNode>;
  VariableReference: Combinator<Lookup>;
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
  Color: Combinator<ValueNode>;
  Percentage: Combinator<string>;
  Dimension: Combinator<ValueNode>;
  UnicodeRange: Combinator<Any>;
  EscapeValue: Combinator<Any>;
  PagePseudo: Combinator<Any>;
  DoubledQuoteArgument: Combinator<Any>;
  FunctionArgument: Combinator<ValueSlot | LessCallArg>;
  FunctionScalarArgument: Combinator<ValueNode>;
  FunctionAssignmentArgument: Combinator<ValueNode>;
  FunctionKeywordArgument: Combinator<LessCallArg>;
  ArgumentValueSequence: Combinator<ValueSlot>;
  FunctionCondition: Combinator<ValueNode>;
  FunctionConditionOr: Combinator<FunctionConditionFact>;
  FunctionConditionAnd: Combinator<FunctionConditionFact>;
  FunctionConditionTerm: Combinator<FunctionConditionFact>;
  FunctionConditionOperand: Combinator<ValueNode>;
  FunctionConditionParen: Combinator<FunctionConditionFact>;
  Call: Combinator<ValueNode>;
  CallArgumentFunction: Combinator<FunctionCall>;
  FormatFunction: Combinator<ValueNode>;
  CallArgumentValue: Combinator<MixinCallArgument['value']>;
  FunctionStatement: Combinator<Statement | string>;
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
  CustomGroup: Combinator<readonly CustomValuePart[]>;
  CustomValue: Combinator<ValueNode>;
  CustomPropertyValue: Combinator<Keyword>;
  CustomDeclaration: Combinator<Declaration>;
  Declaration: Combinator<Declaration>;
  ClassIdStatement: Combinator<Statement>;
  MixinArgumentGroup: Combinator<MixinCallArgument>;
  MixinArguments: Combinator<readonly MixinCallArgument[]>;
  MixinInterior: Combinator<MixinInteriorFact>;
  ClassIdSelectorPrefix: Combinator<SelectorBranchFact>;
  SelectorBranchTail: Combinator<SelectorBranchFact>;
  FlatMixinCall: Combinator<MixinCall>;
  NamespacedMixinCall: Combinator<MixinCall>;
  NamespacedMixinValue: Combinator<MixinCall>;
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
  EachFunctionStatement: Combinator<For>;
  SupportsValue: Combinator<ValueNode>;
  SupportsFeature: Combinator<ValueNode>;
  SupportsInParens: Combinator<ValueNode>;
  SupportsCondition: Combinator<ValueNode>;
  EnclosedContent: Combinator<Interpolation>;
  EnclosedGroup: Combinator<Interpolation>;
  EnclosedQuoted: Combinator<Interpolation>;
  EnclosedFunctionName: Combinator<EnclosedNameFact>;
  Enclosed: Combinator<FunctionCall | Block>;
  SupportsBlock: Combinator<AtRuleBlock>;
  QueryValue: Combinator<ValueNode>;
  QueryColonFeature: Combinator<ValueNode>;
  /** A feature value, folding an authored `<ratio>` slash into one Operation. */
  QueryFeatureValue: Combinator<ValueNode>;
  /** A query keyword that is not the `only` modifier. */
  QueryNonOnlyKeyword: Combinator<Keyword>;
  /** One term of a query clause. */
  QueryTerm: Combinator<ValueNode>;
  /** One term of a media query clause, admitting Less interpolation. */
  MediaQueryTerm: Combinator<ValueNode>;
  QueryFeature: Combinator<ValueNode>;
  QueryClause: Combinator<ValueNode>;
  ContainerStyleQuery: Combinator<FunctionCall>;
  ContainerScrollStateQuery: Combinator<FunctionCall>;
  ContainerName: Combinator<Keyword>;
  ContainerQueryAtom: Combinator<ValueNode>;
  ContainerCondition: Combinator<ValueNode>;
  MediaContainerBody: Combinator<readonly Statement[]>;
  MediaContainerBlock: Combinator<AtRuleBlock>;
  KeyframeSelector: Combinator<SimpleSelector>;
  KeyframeBlock: Combinator<Ruleset>;
  Keyframes: Combinator<AtRuleBlock>;
  DottedAtRuleKeyword: Combinator<ValueNode>;
  AtRulePreludeValueAtom: Combinator<ValueNode>;
  AtRulePreludeValueTerm: Combinator<ValueNode>;
  AtRulePreludeValue: Combinator<ValueNode>;
  AtRulePrelude: Combinator<ValueNode | null>;
  NamespacePrelude: Combinator<ValueNode>;
  AtRuleBlock: Combinator<AtRuleBlock>;
  OpaqueAtPrelude: Combinator<string | null>;
  OpaqueBody: Combinator<string>;
  AtRuleName: Combinator<string>;
  CustomValueAtKeyword: Combinator<string>;
  StaticAtRuleStatementName: Combinator<string>;
  OpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  AtRuleStatement: Combinator<AtRuleStatement>;
  PseudoSelector: Combinator<SimpleToken>;
  InterpolatedPseudo: Combinator<SimpleSelector>;
  InterpolatedNthPseudo: Combinator<SimpleSelector>;
  InterpolatedArgumentPseudo: Combinator<SimpleSelector>;
  NthPseudoSelector: Combinator<SimpleSelector>;
  NthPseudoArgument: Combinator<string>;
  PseudoArgumentText: Combinator<string>;
  PseudoArgumentGroup: Combinator<string>;
  PseudoArgumentCompound: Combinator<SelectorTerm>;
  PseudoArgumentComplex: Combinator<SelectorBranch>;
  PseudoArgumentSelectorTail: Combinator<SelectorBranch>;
  PseudoArgumentSelector: Combinator<SelectorList>;
  AttributeNamespace: Combinator<string>;
  NamespaceTypeSelector: Combinator<SimpleSelector>;
  AttributeName: Combinator<AttributeNameFact>;
  AttributeMatch: Combinator<AttributeMatchFact>;
  AttributeSelector: Combinator<SimpleSelector>;
  InterpolatedAttributeToken: Combinator<Interpolation>;
  InterpolatedAttributeValueToken: Combinator<Interpolation>;
  InterpolatedAttributeQuoted: Combinator<Interpolation>;
  InterpolatedAttributeSelector: Combinator<SimpleSelector>;
  InterpolatedSimpleSelector: Combinator<SimpleSelector>;
  BareInterpolatedSelector: Combinator<SimpleSelector>;
  AdjacentInterpolatedSelector: Combinator<SimpleSelector>;
  BareInterpolatedSelectorWithSuffix: Combinator<SimpleSelector>;
  InterpolatedParentSuffix: Combinator<SimpleSelector>;
  CompoundSelector: Combinator<SelectorTerm>;
  ComplexSelector: Combinator<SelectorBranch>;
  RelativeComplex: Combinator<SelectorBranch>;
  SelectorList: Combinator<SelectorList>;
  ExtendTarget: Combinator<ExtendTargetFact>;
  ExtendStatement: Combinator<BodyExtendFact>;
  RulesetWithExtends: Combinator<Ruleset>;
  NestedRulesetWithExtends: Combinator<Ruleset>;
  Quoted: Combinator<Quoted | Interpolation>;
  LiteralQuoted: Combinator<Quoted>;
  EscapedQuoted: Combinator<Quoted | Interpolation>;
  PlainUrl: Combinator<Url>;
  UrlInterpolation: Combinator<Interpolation>;
  VariableUrl: Combinator<Url>;
  ImportOption: Combinator<Any>;
  ImportOptions: Combinator<List>;
  ImportTarget: Combinator<Quoted | Url | Interpolation>;
  ImportTail: Combinator<unknown>;
  ImportTailText: Combinator<unknown>;
  ImportTailGroup: Combinator<unknown>;
  ImportTailParen: Combinator<unknown>;
  whitespace: Combinator<unknown>;
  blockBody: Combinator<unknown>;
  BareVariableInterpolation: Combinator<unknown>;
  valuePiece: Combinator<unknown>;
  pseudoArgumentInner: Combinator<unknown>;
  queryLeaf: Combinator<unknown>;
  interpolatedValueTail: Combinator<unknown>;
  GenericFunction: Combinator<unknown>;
  CalcFunction: Combinator<unknown>;
  FunctionArguments: Combinator<unknown>;
};

/** Macro-fused shared recognition plus this file's recursively defined outputs. */
type LessInputRules = LessRules & typeof lessSyntax;

type SharedSyntax = {
  AttributeModifier: Combinator<unknown>;
  AttributeOperator: Combinator<unknown>;
  HexColor: Combinator<string>;
  UnicodeRangeToken: Combinator<string>;
  NthExpression: Combinator<unknown>;
  NthChildPseudoSelectorName: Combinator<string>;
  NthTypePseudoSelectorName: Combinator<string>;
  NthPseudoSelectorName: Combinator<string>;
  NthOfKeyword: Combinator<string>;
  NumberToken: Combinator<string>;
  DimensionUnit: Combinator<string>;
  InterpolatedPropertyStart: Combinator<unknown>;
  InterpolatedPropertyTail: Combinator<unknown>;
  Identifier: Combinator<string>;
  SupportsAtKeyword: Combinator<unknown>;
  KeyframesAtKeyword: Combinator<unknown>;
  MediaContainerAtKeyword: Combinator<unknown>;
  MediaAtKeyword: Combinator<unknown>;
  ContainerAtKeyword: Combinator<unknown>;
  QueryNot: Combinator<unknown>;
  QueryOnly: Combinator<unknown>;
  QueryAndOr: Combinator<unknown>;
  QueryComparisonOperator: Combinator<unknown>;
  QueryFunctionName: Combinator<unknown>;
  ImportantToken: Combinator<unknown>;
  BlockCommentToken: Combinator<unknown>;
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
    && 'rules' in value
    && Array.isArray(value.rules);
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
    return variableNameTerminalText(value.rules);
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
    return variableNameTerminalText(value.rules);
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
    return unsupportedVariableNameFrom(value.rules);
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
  if (text === '>' || text === '+' || text === '~' || text === '|' || text === '||') {
    return text;
  }
  return ' ';
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

function isStyleImport(value: unknown): value is StyleImport {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'StyleImport'
    && 'name' in value
    && typeof value.name === 'string'
    && 'target' in value
    && (isQuoted(value.target) || isUrl(value.target) || isInterp(value.target))
    && 'options' in value
    && 'alias' in value;
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

function isVarRef(value: unknown): value is VarRef {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Lookup'
    && 'kind' in value
    && value.kind === 'var'
    && 'name' in value
    && typeof value.name === 'string';
}

function isVarIndirect(value: unknown): value is IndirectRef {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Lookup'
    && 'kind' in value
    && value.kind === 'var'
    && 'name' in value
    && isValueNode(value.name);
}

function isPropRef(value: unknown): value is VarRef {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Lookup'
    && 'kind' in value
    && value.kind === 'prop'
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
    steps.push({ type: 'LookupStep', kind: accessor.keyKind, name: accessor.key });
  }
  return reference(base, steps, raw);
}

/** Source fallback for a grammar fact. This deliberately walks already
 * reduced facts; it never inspects or re-parses source bytes. */
/** One authored call argument re-spelled, KEYWORD INCLUDED. A named argument
 *  whose name were dropped here would re-emit as a positional one — the same
 *  lossy re-derivation the node shape exists to prevent. */
function callArgumentSource(argument: MixinCallArgument): string {
  return `${argument.name === undefined ? '' : `@${argument.name}: `}${mixinArgumentSource(argument.value)}${argument.spread ? '...' : ''}`;
}

function mixinArgumentSource(value: CallValue): string {
  if (isMixinCall(value)) {
    const path = value.path.map((segment, index) => index === 0 ? segment.selector : `${segment.combinator}${segment.selector}`).join('');
    const args = value.args.map(callArgumentSource).join(', ');
    return `${path}${value.name}(${args})${value.important ? ' !important' : ''}`;
  }
  if (Array.isArray(value)) {
    return value.map(part => mixinArgumentSource(part)).join(' ');
  }
  const node = requireValueNode(value);
  switch (node.type) {
    case 'Keyword': case 'Color': case 'Dimension': case 'Any': case 'SelectorCapture': return node.src;
    case 'Quoted': return node.src;
    case 'Lookup': return node.kind === 'var'
      ? `@${typeof node.name === 'string' ? node.name : mixinArgumentSource(node.name)}`
      : node.raw;
    case 'Reference': return node.raw;
    case 'FunctionCall': return `${node.name}(${node.args.map(callArgumentSource).join(', ')})`;
    case 'Block': return `${node.escaped ? '~' : ''}${node.delimiter === 'square' ? '[' : '('}${mixinArgumentSource(node.value)}${node.delimiter === 'square' ? ']' : ')'}`;
    case 'Operation': return `${mixinArgumentSource(node.left)} ${node.operator} ${mixinArgumentSource(node.right)}`;
    case 'Sequence': return node.parts.map(mixinArgumentSource).join(' ');
    case 'List': return node.value.map(mixinArgumentSource).join(node.sep === ',' ? ', ' : node.sep === '/' ? ' / ' : ' ');
    case 'Important': return `${mixinArgumentSource(node.value)} !important`;
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

function isMixinInteriorItem(value: unknown): value is MixinInteriorItem {
  return typeof value === 'object' && value !== null && 'kind' in value
    && (value.kind === 'binding' || value.kind === 'anonymous-rest' || value.kind === 'positional');
}

function requireMixinInteriorItem(value: unknown): MixinInteriorItem {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new TypeError('Less mixin interior produced an invalid item.');
  }
  if (!isMixinInteriorItem(value)) {
    throw new TypeError('Less mixin interior produced an unknown item kind.');
  }
  return value;
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

function appendEnclosedLiteral(parts: Interpolation['parts'], lit: string): void {
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

function enclosedInterpolationFromChildren(children: readonly unknown[]): Interpolation {
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
          appendEnclosedLiteral(parts, part.lit);
        } else {
          parts.push(part);
        }
      }
    } else if (Array.isArray(child)) {
      for (const nested of child) {
        append(nested);
      }
    } else if (typeof child === 'string') {
      appendEnclosedLiteral(parts, child);
    } else {
      appendEnclosedLiteral(parts, requireToken(child).value);
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

/**
 * Does Less's configured `math:` policy compute THIS operator with no enclosing
 * math context (§12.6b)?
 *
 * - `always` — every operator computes bare.
 * - `parens-division` (Less's default) — everything but `/`, which stays a CSS
 *   separator until a paren or `calc(…)` says otherwise.
 * - `parens` / `strict` — nothing computes bare.
 *
 * The answer is written onto `Operation.mathOutsideParens` and the evaluator
 * reads the node. It is deliberately NOT handed to eval as a mode: a dialect
 * difference is carried by what the lowered node says.
 */
/**
 * Restate one operand of a PRESERVED slash group as arithmetic that does not
 * happen on its own.
 *
 * When the math policy keeps an authored top-level `/` as a slash rather than a
 * division, the whole group is authored bytes — so a neighbouring `+` inside it
 * must not fold either, or `4 / 2 + 5em` prints `4 / 7em`. That suppression
 * used to live at eval, where `serialize.ts` re-entered the slot with
 * `mathMode` forced to `'strict'`; it belongs here, because the shape that
 * causes it is one the GRAMMAR recognised (§12.6b).
 *
 * Only the operation spine is restated. A parenthesized operand is a `Block`,
 * not an `Operation`, and keeps its own math context — which is exactly why
 * `(4px / 2) + 1px` still folds inside the parens.
 */
function withoutBareMath(node: ValueNode): ValueNode {
  if (node.type !== 'Operation' || !node.mathOutsideParens) {
    return node;
  }
  const restated = operation(
    node.operator,
    withoutBareMath(node.left),
    withoutBareMath(node.right),
    node.inMathFunction,
    false
  );
  const span = sourceSpanOf(node);
  return span === undefined ? restated : withSourceSpan(restated, span);
}

function lessMathOutsideParens(state: unknown, operator: string): boolean {
  const { mathMode } = requireLessParseState(state);
  if (mathMode === 'always') {
    return true;
  }
  if (mathMode === 'parens-division') {
    return operator !== '/';
  }
  return false;
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

function rawLeafText(entry: unknown): string | undefined {
  return typeof entry === 'object'
    && entry !== null
    && '_tag' in entry
    && entry._tag === 'leaf'
    && 'value' in entry
    && typeof entry.value === 'string'
    ? entry.value
    : undefined;
}

/** `sepBy`/`oneOrMoreSep` contribute their items and nothing else, so a list
 * separator is absent from `children` and present in `rawChildren` — which is
 * the array a trivia insert index has always addressed. Locate the k-th
 * separator's `rawChildren` index by the exact text `field('separator')`
 * captured, matched in source order, so trivia can be read against the array it
 * is indexed against rather than against a `children` array that no longer
 * advances in step with it. */
function separatorRawIndexes(
  rawChildren: readonly unknown[],
  separators: readonly string[]
): number[] {
  const indexes: number[] = [];
  let next = 0;
  for (let index = 0; index < rawChildren.length && next < separators.length; index += 1) {
    if (rawLeafText(rawChildren[index]) === separators[next]) {
      indexes.push(index);
      next += 1;
    }
  }
  return indexes;
}

/** Trivia around one separator: what sits before it, then the separator, then
 * what sits between it and the item that follows. `rawIndex + 1` is that item —
 * a `sepBy` separator is always followed immediately by one item entry. */
function separatorWithSurroundingTrivia(
  separator: string,
  rawIndex: number,
  triviaLog: readonly number[],
  state: unknown
): string {
  return triviaTextAtInsertIndex(triviaLog, state, rawIndex)
    + separator
    + triviaTextAtInsertIndex(triviaLog, state, rawIndex + 1);
}

function functionSeparatorsFromFields(
  fields: FieldMap | undefined,
  rawChildren: readonly unknown[],
  triviaLog: readonly number[],
  state: unknown
): string[] {
  const separators = separatorsFromFields(fields);
  if (separators.length === 0) {
    return separators;
  }

  const separatorIndexes = separatorRawIndexes(rawChildren, separators);

  return separators.map((separator, index) => {
    const separatorIndex = separatorIndexes[index];
    return separatorIndex === undefined
      ? separator
      : separatorWithSurroundingTrivia(separator, separatorIndex, triviaLog, state);
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
  pick: (child: unknown) => child is T,
  rawChildren: readonly unknown[]
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
  const separatorIndexes = separatorRawIndexes(rawChildren, authoredSeparators);
  if (separatorIndexes.length !== authoredSeparators.length) {
    return result;
  }
  const separators = authoredSeparators.map((separator, index) =>
    separatorWithSurroundingTrivia(separator, separatorIndexes[index]!, triviaLog, state));
  return withValueLayout(result, separators);
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

/** Space-join value/terminal children into a single Sequence. */
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
  return typeof value === 'object' && value !== null && 'combinator' in value && 'term' in value;
}

/** Shared `optional(combinator) term` selector-tail reduction: the term
 * and combinator sub-rules vary by selector family, but the fold to a
 * `{ combinator, term }` fact is identical. */
function combinatorTailReducer(children: readonly unknown[]): ComplexTailFact {
  const token = children.find(child => !isSelectorTerm(child));
  const term = children.find(isSelectorTerm)!;
  return { combinator: token === undefined ? ' ' : requireCombinator(token), term };
}

/**
 * Fold an inlined `CompoundSelector (combinator? CompoundSelector)*` child run
 * into the `{ term }, { combinator, term }, …` segment list `selectorBranchOf`
 * consumes. The combinator token is folded inline exactly as the CSS base does
 * — there is no `ComplexTail` wrapper node — so the concrete tree converges to
 * CSS's `ComplexSelector` shape. Recognition-only children (the `not(…)` guard
 * lookaheads) contribute no term and reduce to the descendant default, so they
 * never disturb the fold.
 */
function complexSegmentsFrom(
  children: readonly unknown[]
): [{ combinator?: SelectorCombinator; term: SelectorTerm }, ...Array<{ combinator?: SelectorCombinator; term: SelectorTerm }>] {
  const segments: Array<{ combinator?: SelectorCombinator; term: SelectorTerm }> = [];
  let combinator: SelectorCombinator = ' ';
  for (const child of children) {
    if (isSelectorTerm(child)) {
      segments.push(segments.length === 0 ? { term: child } : { combinator, term: child });
      combinator = ' ';
    } else {
      combinator = requireCombinator(child);
    }
  }
  return [segments[0]!, ...segments.slice(1)];
}

/** Space-separated query clause reduction: keyword/value children join into a
 * Sequence, and a single value collapses to itself. */
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
    case 'Sequence':
    case 'List':
    case 'Operation':
    case 'Condition':
    case 'Block':
    case 'Expression':
    case 'Lookup':
    case 'Reference':
    case 'Interpolation':
    case 'Important':
    case 'SelectorCapture':
    case 'AnonymousMixin':
    case 'Collection':
    case 'IfValue':
      return true;
    case 'Quoted':
      return isQuoted(value);
    case 'Any':
      return isAny(value);
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
  if (isSequence(value)) {
    return value.parts;
  }
  if (isValueNode(value) && value.type === 'Block' && isSequence(value.value)) {
    return { ...value, value: value.value.parts };
  }
  return value;
}

function isSequence(value: ValueSlot): value is Extract<ValueNode, { type: 'Sequence' }> {
  return isValueNode(value) && value.type === 'Sequence';
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
      const parts: ValueNode[] = [];
      for (const part of slot) {
        if (!isValueNode(part)) {
          return slot;
        }
        parts.push(part);
      }
      return withValueLayout(spaced(parts), layout);
    }
    return slot;
  }
  if (isSequence(slot)) {
    const preservedDivision = slot.parts.some(part =>
      (part.type === 'Keyword' || part.type === 'Any') && part.src.trim() === '/');
    const authoredBoundary = valueLayoutOf(slot)?.some(separator => separator.length > 0) === true;
    return preservedDivision && authoredBoundary ? slot : slot.parts;
  }
  if (isValueNode(slot) && slot.type === 'Block' && isSequence(slot.value)) {
    const preservedDivision = slot.value.parts.some(part =>
      (part.type === 'Keyword' || part.type === 'Any') && part.src.trim() === '/');
    return preservedDivision ? slot : { ...slot, value: slot.value.parts };
  }
  return slot;
}

function isValueSlotValue(value: unknown): value is ValueSlot {
  return Array.isArray(value) ? value.every(isValueSlotValue) : isValueNode(value);
}

/** A reduced {@link LessCallArg}: an argument that carried a `@name:` keyword,
 *  as opposed to the bare value slot a positional argument reduces to. */
function isLessCallArg(value: unknown): value is LessCallArg {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'value' in value
    && 'name' in value
    && isValueSlotValue(value.value);
}

function callWithLayout(
  name: string,
  args: Array<ValueSlot | LessCallArg>,
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

/**
 * The CONDITION an `if()` / `boolean()` / `not()` / `and()` / `or()` argument
 * states, in Less's own terms.
 *
 * A structured {@link Condition} (the argument carried a comparison, `not(…)`
 * or `and`/`or`) already IS a guard tree. Anything else is a bare operand, and
 * Less's condition asks "is this literally the boolean `true`" — the same
 * {@link lessTruth} rule `when (@x)` uses (§4.4.2). `"a"`, `red`, `0` and even
 * the STRING `"true"` are all false under it.
 */
function lessConditionGuard(arg: ValueSlot): MixinGuard {
  return !Array.isArray(arg) && isValueNode(arg) && arg.type === 'Condition' ? arg.guard : lessTruth(arg);
}

/**
 * Lower Less's `if()` / `boolean()` — SYNTAX wearing call parentheses, never
 * functions (§4.5.3a) — into the jess constructs they mean:
 *
 * ```
 * boolean(<cond>)      ->  $( <cond> )                        an expression boundary
 * not(<cond>)          ->  $( not(<cond>) )                   the native operator
 * and(<c>, <c>, …)     ->  $( (<c>) and (<c>) … )             the native operator
 * or(<c>, <c>, …)      ->  $( (<c>) or (<c>) … )              the native operator
 * if(<cond>, a, b)     ->  $if (<cond>) { a } $else { b }     the VALUE-position $if
 * ```
 *
 * Doing it HERE is the whole point. The condition is lowered by the grammar
 * that knows the dialect, so nothing downstream needs to — core evaluates a
 * guard tree that already means what `.less` meant, and the identical `.scss`
 * spelling lowers to Sass's rule in its own grammar. A dialect switch in the
 * evaluator would be the alternative, and there is no dialect in core.
 *
 * `not` / `and` / `or` land on the native logical operators (§4.5.5) rather than
 * on `fns/` entries, which is the same ruling that puts them in this set at all.
 */
function lowerLogicalCall(call: FunctionCall): ValueNode {
  const args = call.args;
  const first = args[0]?.value;
  if (first === undefined) {
    return call;
  }
  const boundaryCondition = (guard: MixinGuard): Expression =>
    expression(condition(guard, functionConditionSource(call)));

  /* `and`/`or` are n-ary in Less and fold LEFT, so `and(a, b, c)` is
   * `(a and b) and c` — the same order the guard evaluator short-circuits in. */
  const fold = (kind: 'and' | 'or'): MixinGuard =>
    args.slice(1).reduce<MixinGuard>(
      (left, arg) => ({ g: kind, left, right: lessConditionGuard(arg.value) }),
      lessConditionGuard(first)
    );
  switch (call.name.toLowerCase()) {
    case 'boolean':
      return args.length === 1 ? boundaryCondition(lessConditionGuard(first)) : call;
    case 'not':
      return args.length === 1 ? boundaryCondition({ g: 'not', inner: lessConditionGuard(first) }) : call;
    case 'and':
      return boundaryCondition(fold('and'));
    case 'or':
      return boundaryCondition(fold('or'));
    case 'if': {
      if (args.length < 2 || args.length > 3) {
        return call;
      }
      const guard = lessConditionGuard(first);
      const taken: IfValueBranch = { guard, value: args[1]!.value };
      const otherwise = args[2]?.value;
      return ifValue(otherwise === undefined ? [taken] : [taken, { guard: null, value: otherwise }]);
    }
    default:
      return call;
  }
}

/**
 * STATEMENT-position `if(<cond>, {…}, {…});` is the STATEMENT `$if`, not the
 * value form (§4.5.3b, §4.5.6): its arms are rule bodies, so they attach as
 * statements rather than producing a value.
 *
 * Only detached-ruleset arms qualify. `if(true, 1, 2);` returns a VALUE, which
 * lessc 4.6.3 rejects outright ("Dimension node returned by a function is not
 * valid here"); it stays an ordinary call statement rather than being forced
 * into a shape it does not have.
 */
function lowerLogicalCallStatement(call: FunctionCall): FunctionCall | If {
  const args = call.args;
  const first = args[0]?.value;
  if (call.name.toLowerCase() !== 'if' || first === undefined || args.length < 2 || args.length > 3) {
    return call;
  }
  const arms = args.slice(1).map(arm => arm.value);
  if (!arms.every((arm): arm is AnonymousMixin => !Array.isArray(arm) && isValueNode(arm) && arm.type === 'AnonymousMixin')) {
    return call;
  }
  const taken: IfBranch = { guard: lessConditionGuard(first), rules: arms[0]!.rules };
  const otherwise = arms[1];
  return ifNode(otherwise === undefined ? [taken] : [taken, { guard: null, rules: otherwise.rules }]);
}

function functionCallFromChildren(
  children: readonly unknown[],
  fields: FieldMap | undefined,
  span: SourceSpan,
  triviaLog: readonly number[],
  state: unknown,
  rawChildren: readonly unknown[]
): ValueNode {
  const name = functionNameFromOpener(children[0]);
  const args: Array<ValueSlot | LessCallArg> = [];
  for (const child of children.slice(1, -1)) {
    if (isLessCallArg(child) || isValueSlotValue(child)) {
      args.push(child);
    }
  }
  const separators = functionSeparatorsFromFields(fields, rawChildren, triviaLog, state);
  return lowerLogicalCall(callWithLayout(name, args, separators, hasField(fields, 'trailingSeparator'), span));
}

/**
 * The STATEMENT lane's call (`foo();`). {@link lowerLogicalCall} deliberately
 * does not run here: `if(…)` / `boolean(…)` are VALUE-position syntax, and a
 * bare `if(true, 1, 2);` statement is not that construct — lessc 4.6.3 rejects
 * it outright, and the un-lowered call keeps it an ordinary unknown-call
 * statement rather than a value node in a statement slot.
 */
function argumentFunctionFromChildren(
  children: readonly unknown[],
  fields: FieldMap | undefined,
  span: SourceSpan
): FunctionCall {
  const name = functionNameFromOpener(children[0]);
  const args = children.slice(1, -1).filter(
    (child): child is ValueSlot | LessCallArg => isLessCallArg(child) || isValueSlotValue(child)
  );
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
    && 'value' in value
    && Array.isArray(value.value);
}

function isRelative(value: unknown): value is Extract<SelectorBranch, { readonly type: 'RelativeSelector' }> {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'RelativeSelector'
    && 'value' in value
    && Array.isArray(value.value);
}

function isSelectorBranch(value: unknown): value is SelectorBranch {
  return isSelectorTerm(value) || isComplex(value) || isRelative(value);
}

const selectorBranchesFrom = (children: readonly unknown[]): SelectorBranch[] =>
  children.filter(isSelectorBranch);

function branchSegments(branch: SelectorBranch): [{ combinator?: SelectorCombinator; term: SelectorTerm }, ...Array<{ combinator?: SelectorCombinator; term: SelectorTerm }>] {
  if (branch.type !== 'ComplexSelector' && branch.type !== 'RelativeSelector') {
    return [{ term: branch }];
  }
  const segments: Array<{ combinator?: SelectorCombinator; term: SelectorTerm }> = [];
  let combinator: SelectorCombinator = ' ';
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
  return [segments[0]!, ...segments.slice(1)];
}

type MixinPrefixSegment = { readonly combinator: ' ' | '>'; readonly selector: string };

function mixinPrefixFromSelectorBranch(branch: SelectorBranch): readonly MixinPrefixSegment[] | null {
  const prefix: MixinPrefixSegment[] = [];
  for (const segment of branchSegments(branch)) {
    if (segment.combinator !== undefined && segment.combinator !== ' ' && segment.combinator !== '>') {
      return null;
    }
    const tokens = segment.term.type === 'CompoundSelector'
      ? segment.term.value
      : [segment.term];
    for (const token of tokens) {
      const isMixinName = token.text?.startsWith('.') === true || token.text?.startsWith('#') === true;
      if (!isSimpleSelector(token) || token.interp !== null || token.text === null || !isMixinName) {
        return null;
      }
      prefix.push({
        combinator: prefix.length === 0 ? ' ' : segment.combinator ?? ' ',
        selector: token.text
      });
    }
  }
  return prefix.length === 0 ? null : prefix;
}

function mixinCallFromSelectorBranch(
  branch: SelectorBranch,
  args: readonly MixinCallArgument[],
  important: boolean,
  span: SourceSpan
): MixinCall {
  const prefix = mixinPrefixFromSelectorBranch(branch);
  const final = prefix?.at(-1);
  // `prefix === null` already implies `final === undefined`, so the extra
  // conjunct is redundant at runtime; it narrows `prefix` for the spread below.
  if (prefix === null || final === undefined) {
    throw new SyntaxError('Less mixin calls require a class or id selector path.');
  }
  const call = mixinCall(final.selector, args);
  return withSourceSpan({
    ...call,
    ...(prefix.length > 1 ? { path: prefix.slice(0, -1) } : {}),
    ...(important ? { important: true } : {})
  }, span);
}

function mixinDefinitionNameFromSelectorBranch(branch: SelectorBranch): string {
  const prefix = mixinPrefixFromSelectorBranch(branch);
  if (prefix?.length !== 1) {
    throw new SyntaxError('Less mixin definitions require one class or id name.');
  }
  return prefix[0]!.selector;
}

function requiredTokenStart(rawChildren: readonly unknown[], value: string): number {
  const token = rawChildren.find((child): child is SpannedToken =>
    isSpannedToken(child) && child.value === value
  );
  if (token === undefined) {
    throw new TypeError(`Less grammar lost required ${JSON.stringify(value)} token provenance.`);
  }
  return token.span.start;
}

function hasRulesetTerminator(rawChildren: readonly unknown[]): boolean {
  const tail = rawChildren[rawChildren.length - 1];
  return isSpannedToken(tail) && tail.value === ';';
}

function isSelectorTerm(value: unknown): value is SelectorTerm {
  if (isSimpleToken(value)) {
    return true;
  }
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'CompoundSelector'
    && 'value' in value
    && Array.isArray(value.value);
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

const selectorTermFromTokens = (tokens: readonly SimpleToken[]): SelectorTerm =>
  selectorTermOf([tokens[0]!, ...tokens.slice(1)]);

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
  return simpleSelector(`${head}(${requireSelectorList(arg).selectors.map(selectorBranchCanonical).join(',')})`);
}

function staticNonSelectorPseudoFrom(head: string, arg: string | null): SimpleSelector {
  return arg === null
    ? simpleSelector(head)
    : simpleSelector(`${head}(${arg})`);
}

function isRuleset(value: unknown): value is Ruleset {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Ruleset'
    && 'selector' in value
    && isSelectorList(value.selector)
    && 'rules' in value
    && Array.isArray(value.rules);
}

function isAtRuleBlock(value: unknown): value is AtRuleBlock {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'AtRuleBlock' && 'name' in value && typeof value.name === 'string'
    && 'prelude' in value && 'rules' in value && Array.isArray(value.rules);
}

function isAtRuleStatement(value: unknown): value is AtRuleStatement {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'AtRuleStatement' && 'name' in value && typeof value.name === 'string'
    && 'prelude' in value;
}

function isMixinDefinition(value: unknown): value is MixinDefinition {
  return typeof value === 'object' && value !== null && 'type' in value
    && value.type === 'MixinDefinition' && 'name' in value && typeof value.name === 'string'
    && 'params' in value && Array.isArray(value.params) && 'rules' in value && Array.isArray(value.rules);
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

function isAttributeNameFact(value: unknown): value is AttributeNameFact {
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

function isBodyExtendFact(value: unknown): value is BodyExtendFact {
  return typeof value === 'object' && value !== null
    && 'bodyExtensions' in value && Array.isArray(value.bodyExtensions)
    && value.bodyExtensions.every(isExtendInstruction);
}

function isSelectorBranchFact(value: unknown): value is SelectorBranchFact {
  return typeof value === 'object' && value !== null
    && 'selector' in value && isSelectorBranch(value.selector)
    && 'extensions' in value && Array.isArray(value.extensions)
    && value.extensions.every(isExtendInstruction);
}

function isSelectorListWithExtendsFact(value: unknown): value is SelectorListWithExtendsFact {
  return typeof value === 'object' && value !== null
    && 'selector' in value && isSelectorList(value.selector)
    && 'extensions' in value && Array.isArray(value.extensions)
    && value.extensions.every(isExtendInstruction);
}

function isMixinDefinitionFact(value: unknown): value is MixinDefinitionFact {
  return typeof value === 'object' && value !== null
    && 'params' in value && Array.isArray(value.params) && value.params.every(isParam)
    && 'rules' in value && Array.isArray(value.rules) && value.rules.every(isStatement);
}

function isMixinCallFact(value: unknown): value is MixinCallFact {
  return typeof value === 'object' && value !== null
    && 'args' in value && Array.isArray(value.args) && value.args.every(isMixinCallArgument)
    && 'important' in value && typeof value.important === 'boolean';
}

function isBareMixinCallFact(value: unknown): value is BareMixinCallFact {
  return typeof value === 'object' && value !== null
    && 'important' in value && typeof value.important === 'boolean';
}

function isRulesetTailFact(value: unknown): value is RulesetTailFact {
  return typeof value === 'object' && value !== null
    && 'firstExtensions' in value && Array.isArray(value.firstExtensions) && value.firstExtensions.every(isExtendTargetFact)
    && 'branches' in value && Array.isArray(value.branches) && value.branches.every(isSelectorBranchFact)
    && 'rules' in value && Array.isArray(value.rules) && value.rules.every(isStatement)
    && 'extensions' in value && Array.isArray(value.extensions) && value.extensions.every(isExtendInstruction);
}

function requireSelectorListWithExtendsFact(value: unknown): SelectorListWithExtendsFact {
  if (!isSelectorListWithExtendsFact(value)) {
    throw new TypeError('Less grammar produced a ruleset selector without selector facts.');
  }
  return value;
}

function isMixinPathTail(value: unknown): value is MixinPathSegmentFact {
  return typeof value === 'object' && value !== null && 'combinator' in value
    && (value.combinator === ' ' || value.combinator === '>') && 'selector' in value && typeof value.selector === 'string';
}

function isMixinCallArgument(value: unknown): value is MixinCallArgument {
  /* `name` is ALWAYS present — `undefined` is what positional means — so its
   * absence is a reduced-shape defect, not a positional argument. */
  return typeof value === 'object' && value !== null && 'value' in value && (isValueSlotValue(value.value) || isMixinCall(value.value))
    && 'name' in value && (value.name === undefined || typeof value.name === 'string');
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

function mixinParamsFromInterior(interior: MixinInteriorFact): Param[] {
  return interior.items.map((item) => {
    if (item.kind === 'anonymous-rest') {
      return { rest: true };
    }
    if (item.kind === 'binding') {
      if (item.rest) {
        return { name: item.reference.name, rest: true };
      }
      if (item.default === undefined) {
        return { name: item.reference.name };
      }
      if (!isValueSlotValue(item.default)) {
        throw new SyntaxError('Less mixin parameter defaults must be values.');
      }
      return { name: item.reference.name, default: item.default };
    }
    if (!isValueSlotValue(item.value)) {
      throw new SyntaxError('Less mixin pattern parameters must be values.');
    }
    return { pattern: item.value };
  });
}

function mixinCallArgumentFromInterior(item: MixinInteriorItem): MixinCallArgument {
  if (item.kind === 'anonymous-rest') {
    throw new SyntaxError('Less mixin calls cannot use an anonymous rest argument.');
  }
  if (item.kind === 'binding') {
    if (item.rest) {
      return callArg(item.reference, undefined, true);
    }
    return item.default === undefined
      ? callArg(item.reference)
      : callArg(item.default, item.reference.name);
  }
  return callArg(item.value);
}

function mixinCallArgsFromInterior(interior: MixinInteriorFact): MixinCallArgument[] {
  if (!interior.separators.includes(';')) {
    return interior.items.map(mixinCallArgumentFromInterior);
  }

  const groups: MixinInteriorItem[][] = [[]];
  for (let index = 0; index < interior.items.length; index++) {
    groups.at(-1)!.push(interior.items[index]!);
    if (interior.separators[index] === ';') {
      groups.push([]);
    }
  }
  if (groups.at(-1)?.length === 0) {
    groups.pop();
  }

  return groups.map((group) => {
    const args = group.map(mixinCallArgumentFromInterior);
    if (args.length === 1) {
      return args[0]!;
    }
    if (args.some(argument => argument.name !== undefined || argument.spread)) {
      throw new SyntaxError('Less comma-list mixin argument groups cannot use named or spread arguments.');
    }
    return callArg(list(args.map(argument => requireValueSlot(argument.value)), ','));
  });
}

/**
 * The LESS condition lowering (§4.4.2): `when (@x)` means `$if($x == true)`.
 *
 * Less's bare condition asks "is this literally the boolean `true`" — `0`,
 * `"a"`, `red` and `"true"` are all false — which is a DIFFERENT question from
 * `.jess`'s `$if($x)` (falsy iff `false` / `null` / `""` / `()`, §4.4). So the
 * dialect states its own meaning in plain `.jess` here rather than sharing the
 * truth node, which is what makes `.less` -> `.jess` -> `.css` reachable.
 *
 * `==` is load-bearing: with the loose `=` a `"true"` string would ground
 * against `true` and come out TRUE, which Less says it is not.
 */
function lessTruth(value: ValueSlot): MixinGuard {
  return { g: 'cmp', op: '==', left: value, right: keyword('true') };
}

/** {@link lessTruth} in `when` position — the same lowering, as a MATCH test
 *  (§4.2a), so a `when` tree contains no value-position assertion. `==` never
 *  raises, so this changes no answer; it keeps the invariant readable. */
function lessGuardTruth(value: ValueSlot): MixinGuard {
  return { g: 'match', op: '==', left: value, right: keyword('true') };
}

function isMixinGuard(value: unknown): value is MixinGuard {
  return typeof value === 'object' && value !== null && 'g' in value
    && (value.g === 'cmp' || value.g === 'match' || value.g === 'and' || value.g === 'or' || value.g === 'not'
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
  // be unified with the CSS media-range operator (`g.QueryComparisonOperator`,
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
    case 'Lookup': return node.kind === 'var'
      ? `@${typeof node.name === 'string' ? node.name : functionConditionSource(node.name)}`
      : node.raw;
    case 'FunctionCall': return `${node.name}(${node.args.map(argument => `${argument.name === undefined ? '' : `@${argument.name}: `}${functionConditionSource(argument.value)}`).join(', ')})`;
    case 'Operation': return `${functionConditionSource(node.left)} ${node.operator} ${functionConditionSource(node.right)}`;
    case 'Block': return `${node.delimiter === 'square' ? '[' : '('}${functionConditionSource(node.value)}${node.delimiter === 'square' ? ']' : ')'}`;
    /*
     * A nested `boolean(…)`/`if(…)` already lowered to a computation boundary
     * (`Expression`). It owns no delimiters of its own, so its replay source is
     * the enclosing group's — the same `(inner)` the boundary `Block` spelled
     * before the boundary flag became its own node kind.
     */
    case 'Expression': return `(${functionConditionSource(node.value)})`;
    case 'Sequence': return node.parts.map(functionConditionSource).join(' ');
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
    case 'StyleImport':
      return isStyleImport(value);
    case 'VariableDeclaration':
      return isVarDeclaration(value);
    case 'Declaration':
      return isDeclaration(value);
    case 'Ruleset':
      return isRuleset(value);
    case 'AtRuleBlock':
      return isAtRuleBlock(value);
    case 'OpaqueAtRuleBlock':
      return typeof value === 'object' && value !== null && 'type' in value && value.type === 'OpaqueAtRuleBlock';
    case 'AtRuleStatement':
      return isAtRuleStatement(value);
    case 'Plugin':
      return true;
    case 'MixinDefinition':
      return isMixinDefinition(value);
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
  const rules: Statement[] = [];
  for (const child of children) {
    if (!isStatement(child)) {
      throw new TypeError('Less grammar produced a non-ruleset-body child.');
    }
    rules.push(child);
  }
  return rules;
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
 * recovered or re-parsed here.  Each folded pair records whether Less's
 * configured `math:` policy computes it with no enclosing math context, so the
 * evaluator never reads that policy from ambient config (§12.6b). */
function foldOperation(
  children: readonly unknown[],
  _fields: FieldMap | undefined,
  _span: Span,
  rawChildren: readonly unknown[],
  _triviaLog: readonly number[],
  state: unknown
): ValueNode {
  const first = children.find(isValueNode);
  if (first === undefined) {
    throw new TypeError('Less arithmetic grammar produced no operand.');
  }
  const firstIndex = children.indexOf(first);
  const firstRaw = rawChildren[firstIndex];
  // In AST mode Parseman supplies the original spanned children here. That
  // gives each folded operation its authored range without retaining one span
  // per standalone dimension. A synthetic child can still contribute an
  // existing provenance fact when it has one.
  const firstSpan = isSpannedToken(firstRaw) ? firstRaw.span : sourceSpanOf(first);
  let result = first;
  const start = firstSpan?.start;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 2) {
    const operatorToken = children[index];
    const right = children[index + 1];
    if (operatorToken === undefined || !isValueNode(right)) {
      throw new TypeError('Less arithmetic grammar lost an operator operand.');
    }
    const rightRaw = rawChildren[index + 1];
    const rightSpan = isSpannedToken(rightRaw) ? rightRaw.span : sourceSpanOf(right);
    const operator = requireTerminalText(operatorToken).trim();
    const folded = operation(operator, result, right, false, lessMathOutsideParens(state, operator));
    result = start === undefined || rightSpan === undefined
      ? folded
      : withSourceSpan(folded, { start, end: rightSpan.end });
  }
  return result;
}

const lineComment = regex(/\/\/[^\n\r]*/);
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
/*
 * Parseman trivia labels belong to terminal identity. This dedicated terminal
 * keeps custom-value comments classed as `blockComment` in the root index rather
 * than inheriting the generic whitespace label of the shared scanner terminal.
 */
const customValueBlockCommentRun = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespaceRun = regex(/[ \t\n\r\f]+/);

// Less comments are trivia. Line comments must not become renderable CSS
// comments; block comments may still make an otherwise empty ruleset renderable
// through body-span trivia, not through a `Comment` statement node.
// URL bodies explicitly disable trivia below, so `url(//host/path)` remains
// URL content rather than a comment.
const whitespace = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
const selectorAttributeModifierSpace = regex(/[ \t\n\r\f]+/);
const importKeyword = keywords(
  ['@-import', '@import'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
);
/* `customValueAtKeyword` is now the composed `g.CustomValueAtKeyword` rule. */
// Opaque quoted-string skippers for the grammar-level ambient `scanSkip`.
// `scanTo`/`balanced` with no per-call skip consults these so a delimiter hidden
// inside a string is never matched. Consumes quote-to-quote including escapes;
// used only as a scan hole, so it builds nothing.
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
const mathTrivia = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
// Function argument comments are trivia. Block comments stay out of the value
// AST and are replayed through the call argument ValueLayout when they sit on an
// argument boundary.
const functionTrivia = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
// Mixin signatures and guards are invisible definition syntax. Unlike an
// ordinary declaration value, a block comment at one of their token boundaries
// is lexical trivia (the legacy MixinArgs production used the same rule). The
// signature scope still needs the normal classified trivia: it spans a
// continuation which may contain a block body, so collapsing comments into a
// synthetic `whitespace` label here would hide them from selected root capture.
const mixinSignatureGap = regex(/(?:(?:[ \t\n\r\f]+)|(?:\/\/[^\n\r]*)|(?:\/\*(?:[^*]|\*(?!\/))*\*\/))+/);
const mixinGuardGap = regex(/(?:(?:[ \t\n\r\f]+)|(?:\/\/[^\n\r]*)|(?:\/\*(?:[^*]|\*(?!\/))*\*\/))+/);
const mixinSignatureTrivia = whitespace;
const mixinGuardTrivia = classifiedTrivia({ whitespace: mixinGuardGap });
// Selector grammar components used inside functional pseudos retain their
// established lexical-comment behavior.
const staticSelectorTrivia = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
const compoundSelectorTrivia = classifiedTrivia({
  lineComment,
  blockComment
});
const atPreludeCommentTrivia = classifiedTrivia({ blockComment });
const customValueCommentTrivia = classifiedTrivia({ blockComment: customValueBlockCommentRun });
// Outer selector comments are lexical trivia. Render-time body/source spans own
// whether a trivia-only body remains output-bearing; selectors do not invent
// comment simple selectors.
const outerSelectorTrivia = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
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
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
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
/*
 * `+`/`-` are ambiguous between a binary operator and a leading sign, so the
 * operand must be SEPARATED from the operator for this to be arithmetic: `1 - 2`
 * subtracts, `1 -2` is a space list whose second item is the signed dimension.
 * Less additionally treats the fully glued `1-2` as arithmetic.
 *
 * What separates them is the DIALECT'S trivia, not a local spelling of it. This
 * used to hand-spell the pad as `comment* ws+ (comment ws*)*`, which is a second,
 * private definition of the trivia table inside one expression production
 * (DESIGN-DECISIONS G24) — and it drifted from the table in a way that was
 * visible in emitted CSS: because the pad REQUIRED a whitespace run, a comment
 * standing alone as the separator did not count, so `1px/**\/-/**\/2px` performed
 * no arithmetic and the comment bytes were emitted verbatim as value content.
 * `mathTrivia` is the same `classifiedTrivia` the `*`/`/`/`%` product operators
 * above already use, and `classifiedTrivia` is one-or-more by construction, so
 * naming it bare (rather than under `optional()`) IS the "must be separated"
 * assertion. css-syntax-3 §4 makes a comment trivia wherever whitespace is, so
 * both Less comment forms now count, exactly as the document trivia table says.
 *
 * The separation is required on BOTH sides, which is what keeps `1 -2` a list:
 * there is a pad before the `-` and none after it, so this arm cannot match and
 * the glued arms below reject it on their `(?![0-9.])` guard. That guard is why
 * the pad may not be relaxed to one side — a comment defeats it, since in
 * `1/**\/-2px` the lookahead sees `/` rather than the digit actually there.
 *
 * The three arms remain separated-both-sides | glued-to-number | asymmetric
 * reject guard. This one is a `leaf()` for the same reason the product operators
 * are: the leaf's value is exactly the sign, so `foldOperation` still reads a
 * flat operator stream and no CST arity moves. Folding the pad into the operator
 * terminal instead would leave the reducer recovering the sign with `.trim()`
 * from bytes that can now hold a comment's own `/` and `*` — the parser handing
 * core a value to re-parse.
 */
const sumOperatorSpaced = leaf(
  noTrivia(sequence(mathTrivia, keywords(['-', '+']), mathTrivia)),
  children => children[1] as string
);
const sumOperatorGlued = regex(/[-+](?=[0-9.])|[ \t\n\r\f]*[-+](?![0-9.])[ \t\n\r\f]*/);
const sumOperator = choice(sumOperatorSpaced, sumOperatorGlued);
// Generic Less at-rule names are grammar terminals. This grammar keeps
// their prelude/body semantic only where the existing canonical AST has a
// truthful structured representation; it never captures a block as text.
// Imports are typed facts with stricter target validation. Excluding their names
// here prevents a malformed import from falling through as a generic at-rule.
const charsetAtRuleName = word(
  '@charset',
  '-_a-zA-Z0-9\\u0080-\\uFFFF',
  { caseInsensitive: true }
);
const layerAtRuleName = word(
  '@layer',
  '-_a-zA-Z0-9\\u0080-\\uFFFF',
  { caseInsensitive: true }
);
/*
 * The Less-only compiler-namespace at-rule names, declared ONCE. The CSS names
 * this must also exclude (@import, @layer, @media/@container/@supports,
 * @keyframes) are NOT re-spelled: `AtRuleName` below inverts cssSyntax's own
 * leaves for them, so the two polarities cannot drift apart and the
 * css-syntax-3 §4.3.11 boundary is inherited rather than re-typed.
 */
const lessOwnAtKeyword = keywords(
  ['@-import', '@-export'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
);
/* `staticAtRuleStatementName` is now the composed `g.StaticAtRuleStatementName` rule. */
const mixinName = regex(/[.#]-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const mixinPathCombinator = regex(/>/);
const mixinGuardOperator = regex(/>=|<=|=>|=<|=~|[<>=]/);
const functionConditionStop = regex(/[ \t\n\r\f]*(?:>=|<=|=>|=<|=~|[<>=]|(?:and|or)(?![-_a-zA-Z0-9\u0080-\uffff]))/i);
const functionConditionOperator = regex(/[ \t\n\r\f]*(?:>=|<=|=>|=<|=~|[<>=])[ \t\n\r\f]*/);
const functionConditionAnd = regex(/[ \t\n\r\f]*and(?![-_a-zA-Z0-9\u0080-\uffff])[ \t\n\r\f]*/i);
const functionConditionOr = regex(/[ \t\n\r\f]*or(?![-_a-zA-Z0-9\u0080-\uffff])[ \t\n\r\f]*/i);
const functionConditionNot = word(
  'not',
  '-_a-zA-Z0-9\\u0080-\\uFFFF',
  { caseInsensitive: true }
);
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
const enclosedText = regex(/(?:\\[\s\S]|\/(?!\*)|@(?!\{)|[^\\/'"@()[\]{}]+)+/);
const enclosedDoubleChunk = regex(/(?:\\[\s\S]|@(?!\{)|[^"\\@])+/);
const enclosedSingleChunk = regex(/(?:\\[\s\S]|@(?!\{)|[^'\\@])+/);
const lessSupportedVariableName = regex(/[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessUnsupportedNumericVariableName = node(
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

const lessGrammarFactory = (g: LessInputRules & SharedSyntax) => {
  const caseOf = makeWhen({ caseInsensitive: true });
  const lessWord = makeWord('-_a-zA-Z0-9\\u0080-\\uFFFF');
  const lessCaseWord = makeWord('-_a-zA-Z0-9\\u0080-\\uFFFF', { caseInsensitive: true });
  const whenGuardAhead = sequence(optional(regex(/[ \t\n\r\f]+/)), lessCaseWord('when'));
  const mixinGuardDefaultCall = regex(/default[ \t\n\r\f]*\([ \t\n\r\f]*\)(?![-_a-zA-Z0-9\u0080-\uffff])/);
  // `@@name` is a variable reference whose lookup name is the resolved value
  // of `@name`; retain that two-step lookup as a typed AST edge.  The doubled
  // sigil is glued just like the production `nestedRef`, so trivia cannot turn
  // it into two unrelated tokens.
  const IndirectVariableReference = node(
    'Reference',
    noTrivia(sequence(literal('@@'), lessVariableName)),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.end);
      return withSourceSpan(
        variableReference(variableReference(name, 'scoped'), 'scoped', `@@${name}`),
        span
      );
    }
  );
  const VariableReference = node(
    'Reference',
    sequence(literal('@'), lessVariableName),
    (children, _fields, span) => withSourceSpan(
      variableReference(requireSupportedVariableName(children[1], span.start, span.end), 'scoped'),
      span
    )
  );
  const BareVariableInterpolation = node(
    'BareVariableInterpolation',
    noTrivia(sequence(literal('@'), lessVariableName)),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.end);
      throw new LessBareVariableInterpolationError(span.start, span.end, name);
    }
  );
  const PropertyReference = node(
    'Reference',
    noTrivia(sequence(literal('$'), g.LessIdentifier)),
    (children, _fields, span) => withSourceSpan(propertyReference(requireToken(children[1]).value), span)
  );
  const InterpolationAccessor = choice(
    // Less `[]` selects the final declaration of a namespace/mixin result.
    // Lower it directly to the established negative-one index contract; the
    // existing Reference evaluator already applies negative indexes from the
    // end of its typed declaration map.
    node(
      'InterpolationLastAccessor',
      noTrivia(literal('[]')),
      (): InterpolationAccessorFact => ({ key: -1, keyKind: 'index', src: '-1' })
    ),
    node(
      'InterpolationIndexAccessor',
      noTrivia(sequence(literal('['), g.InterpolationIndex, literal(']'))),
      (children): InterpolationAccessorFact => {
        const text = requireToken(children[1]).value;
        return { key: Number(text), keyKind: 'index', src: text };
      }
    ),
    // `$@name` is a property-map key selected by the VALUE of `@name`, e.g.
    // `#namespace[$@prop-name]`. Keep both the indirection and the property
    // namespace explicit: the existing resolver evaluates this key, then uses
    // `keyKind: 'prop'` to select the declaration-member map.
    node(
      'InterpolationPropertyVariableAccessor',
      noTrivia(sequence(literal('['), literal('$'), g.VariableReference, literal(']'))),
      (children): InterpolationAccessorFact => {
        const key = requireValueNode(children[2]);
        if (!isVarRef(key)) {
          throw new TypeError('Less property-variable map key must retain its variable reference.');
        }
        return { key, keyKind: 'prop', src: `$@${key.name}` };
      }
    ),
    node(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(literal('['), choice(g.IndirectVariableReference, g.VariableReference, g.PropertyReference, g.InterpolationKey), literal(']'))),
      (children): InterpolationAccessorFact => {
        const key = children[1];
        if (isVarIndirect(key)) {
          const nameRef = key.name;
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
  const VariableReferenceChain = node(
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
  const MixinPathTail = node(
    'MixinPathTail',
    sequence(optional(mixinPathCombinator), mixinName),
    (children) => {
      const combToken = children.find(child => isTerminalText(child, '>'));
      return {
        combinator: combToken === undefined ? ' ' : '>',
        selector: requireToken(children.at(-1)).value
      };
    }
  );
  const UnsupportedDashVariableInterpolation = node(
    'UnsupportedVariableName',
    noTrivia(literal('@{-}')),
    (_children, _fields, span) => {
      throw new LessUnsupportedVariableNameError(span.start, span.end, '-');
    }
  );
  const VariableInterpolation = node(
    'VariableInterpolation',
    choice(
      UnsupportedDashVariableInterpolation,
      noTrivia(sequence(literal('@{'), lessVariableName, many(g.InterpolationAccessor), literal('}')))
    ),
    (children, _fields, span) => interpolationFactFromChildren(children, span)
  );
  const PropertyInterpolation = node(
    'PropertyInterpolation',
    noTrivia(sequence(literal('${'), g.InterpolationHead, many(g.InterpolationAccessor), literal('}'))),
    (children, _fields, span) => interpolationFactFromChildren(children, span)
  );
  const Interpolation = node(
    'Interpolation',
    choice(g.VariableInterpolation, g.PropertyInterpolation),
    children => requireInterpolationFact(children[0])
  );
  // A complete Less at-rule header can be deferred through one `@{…}` lookup.
  // Keep that as the existing typed Interpolation value rather than treating a header
  // as raw text; dedicated query/supports reducers still own static structure.
  const AtRuleInterpolation = node(
    'AtRuleInterpolation',
    g.VariableInterpolation,
    (children) => {
      const fact = requireInterpolationFact(children[0]);
      return interpolation([{ ref: fact.ref, unquote: true }]);
    }
  );
  const interpolatedValueTail = choice(g.InterpolatedValueTail, g.Interpolation);
  const InterpolatedValue = node(
    'InterpolatedValue',
    noTrivia(sequence(
      g.Interpolation,
      many(g.interpolatedValueTail)
    )),
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const Quoted = node(
    'Quoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.QuotedDoubleText, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.QuotedSingleText, literal('@'), literal('$'))), literal('\'')))
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
  // Plain (interpolation-free) single/double-quoted body shared by the quoted
  // value, functional-pseudo, and attribute-selector static grammars.
  const staticQuotedBody = choice(
    noTrivia(sequence(literal('"'), many(choice(g.QuotedDoubleText, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('"'))),
    noTrivia(sequence(literal('\''), many(choice(g.QuotedSingleText, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('\'')))
  );
  const LiteralQuoted = node(
    'Quoted',
    staticQuotedBody,
    (children) => {
      const open = requireToken(children[0]);
      const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
      return quoted(`${open.value}${value}${open.value}`, value, open.value, false);
    }
  );
  // A non-interpolated Less `~"…"` / `~'…'` is an ordinary quoted value with the
  // existing escaped flag. Its interpolation-bearing form is a structural,
  // unquoted template—never a recovered source string.
  const EscapedQuoted = node(
    'Quoted',
    choice(
      noTrivia(sequence(literal('~"'), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.QuotedDoubleText, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('~\''), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.QuotedSingleText, literal('@'), literal('$'))), literal('\'')))
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
  const PlainUrl = node(
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
        throw new TypeError('Less plain URL produced repeated body facts.');
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
  const UrlInterpolation = node(
    'UrlInterpolation',
    noTrivia(choice(
      sequence(g.VariableReference, oneOrMore(choice(staticUrlText, g.Interpolation))),
      sequence(g.Interpolation, many(choice(staticUrlText, g.Interpolation)))
    )),
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const VariableUrl = node(
    'Url',
    sequence(urlFunctionOpen, choice(g.UrlInterpolation, g.VariableReference), literal(')')),
    children => url(requireValueNode(children[1]))
  );
  const RoutedVariableUrl = node(
    'Url',
    sequence(routed(), choice(g.UrlInterpolation, g.VariableReference), literal(')')),
    children => url(requireValueNode(children[1]))
  );
  const RoutedPlainUrl = node(
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
        throw new TypeError('Less routed plain URL produced repeated body facts.');
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
  const UrlTarget = choice(g.VariableUrl, g.PlainUrl);
  const ImportOption = node(
    'ImportOption',
    importOption,
    children => any(requireToken(children[0]).value)
  );
  const ImportOptions = node(
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
  const ImportTailParen = noTrivia(sequence(
    literal('('),
    many(choice(staticTailText, g.Quoted, g.ImportTailGroup)),
    literal(')')
  ));
  const ImportTailGroup = g.ImportTailParen;
  const ImportTailText = noTrivia(oneOrMore(choice(
    staticTailText,
    g.Quoted,
    g.ImportTailGroup
  )));
  // An import postlude's variable-bearing media feature has an exact typed
  // shape. Keep this small prelude production here because the generic query
  // family is defined after `ImportStatement`; no forward grammar reference
  // may poison the document's direct start rule.
  const ImportQueryTail = node(
    'ImportQueryTail',
    sequence(literal('('), g.Identifier, regex(/:[ \t\n\r\f]*/), g.VariableReference, literal(')')),
    (children, _fields, _span, _rawChildren, _triviaLog, state) =>
      block(operation(':', keyword(requireToken(children[1]).value), requireValueNode(children[3]), false,
        lessMathOutsideParens(state, ':')))
  );
  const quotedOrUrlTarget = choice(g.EscapedQuoted, g.Quoted, UrlTarget);
  const ImportTarget = node(
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
  const ImportTail = node(
    'ImportTail',
    choice(
      ImportQueryTail,
      g.AtRuleInterpolation,
      g.ImportTailText
    ),
    children => children.length === 1 ? children[0] : children
  );
  /*
   * There are TWO import nodes and this reducer picks between them. A plain CSS
   * `@import` is an ordinary `AtRuleStatement`; a compile-time import — one with
   * options, or with a loadable target — is a `StyleImport`. `importIsCompileTime`
   * is the ONE definition of that split, shared by every dialect, and all of its
   * inputs are authored syntax, so nothing about the shape defers to eval.
   *
   * The CSS-terminal prelude stays TYPED (`target`, then the tail) rather than
   * being flattened to bytes: the root CSS-import hoist reads the target node
   * back out of it, and a variable-bearing media feature still has to evaluate.
   * The option clause is import machinery with no CSS meaning, so it is simply
   * absent from that statement — exactly as Less 4.x emits it.
   *
   * A postlude on the COMPILE-TIME branch is rejected here rather than carried:
   * a media/layer/supports query describes a linked CSS resource, and a loaded
   * document is spliced into this one instead. Deliberately unlike Less 4.x,
   * which accepts `@import "foo.less" screen` and wraps the result in `@media`.
   */
  const ImportStatement = node(
    'ImportStatement',
    sequence(importKeyword, optional(g.ImportOptions), g.ImportTarget, optional(field('tail', g.ImportTail)), literal(';')),
    (children, fields, span) => {
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
      // the import tail has a typed segment model; do not flatten it back into
      // opaque source bytes.
      const tailValue = tailField === undefined ? undefined : requireField(fields, 'tail').value;
      const tail = tailValue === undefined ? null : isValueNode(tailValue) ? tailValue : any(staticText(tailValue));
      if (importIsCompileTime(keyword.value, target, options)) {
        if (tail !== null) {
          throw new LessImportPostludeError(span.start, span.end);
        }
        return styleImport(keyword.value, target, { options, mode: 'import' });
      }
      return atRuleStatement(keyword.value, tail === null ? target : spaced([target, tail]));
    }
  );
  // `@plugin` is a compile-time directive, not an unknown CSS at-rule. Its
  // target and the *inner* option string are grammar facts so the evaluator
  // never rediscovers either from raw prelude bytes. EnclosedContent
  // recursively closes delimiters and preserves arbitrary option text as
  // interpolation literal/ref segments, matching Less's opaque option string.
  const PluginDirective = node(
    'Plugin',
    sequence(
      word(
        '@plugin',
        '-_a-zA-Z0-9\\u0080-\\uFFFF',
        { caseInsensitive: true }
      ),
      optional(sequence(literal('('), field('options', g.EnclosedContent), literal(')'))),
      field('target', quotedOrUrlTarget),
      literal(';')
    ),
    (_children, fields): Plugin => {
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
  // `;` separates block-list items, so the final item in a braced body may omit
  // it — `.a { @o: 3 }` and `.a { o: 3 }` are both Less. The omission is allowed
  // ONLY against the block's own `}`: `@o: 3` at end-of-stylesheet stays a parse
  // error (`lessc` 4.8.1: "@o rule is missing block or ending semi-colon"), and
  // a declaration still may not run into a following declaration or nested rule.
  const declarationEnd = choice(
    literal(';'),
    peek(literal('}'))
  );
  const variableName = node(
    'VariableName',
    noTrivia(sequence(literal('@'), lessVariableName)),
    (children, _fields, span) => `@${requireSupportedVariableName(children[1], span.start, span.end)}`
  );
  const VarDeclaration = node(
    'VariableDeclaration',
    sequence(variableName, literal(':'), choice(sequence(g.NamespacedMixinValue, mixinValueWithoutLookup), g.ImportantValue, sequence(g.FlatMixinCall, mixinValueWithoutLookup), sequence(not(literal('{')), g.VariableValue)), declarationEnd),
    (children, _fields, span) => {
      const name = requireTerminalText(children[0]).slice(1);
      const value = children[2];
      return withSourceSpan(
        variableDeclaration(name, isMixinCall(value) ? value : variableValueSlot(value), { mode: 'declare' }),
        span
      );
    }
  );
  const ValueBlockDeclaration = node(
    'VariableDeclaration',
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
  const Keyword = node(
    'Keyword',
    g.ValueIdentifier,
    children => keyword(requireToken(children[0]).value)
  );
  const Color = node(
    'Color',
    g.HexColor,
    children => color(requireToken(children[0]).value)
  );
  /*
   * `<percentage>` — css-values-4 §8.2: "a `<number>` immediately followed by a
   * percent sign `%`", i.e. `<percentage> = <number> %`. It is a NAMED CSS value
   * type, referenced by name from many productions — `<keyframe-selector> = from
   * | to | <percentage>` (css-animations-1 §4), `image-set()`, `color-mix()`,
   * `<position>` — so it is a rule here rather than a shape each consumer
   * re-spells. Three dialects previously carried three different hand-rolled
   * numeric regexes for it, none referenceable and none agreeing with this
   * grammar's own `<number>` token.
   *
   * This does NOT add an AST node type: a percentage is still a `Dimension`
   * whose unit is `%`, which is why this is a token rule and not a `node()`.
   * `noTrivia` enforces the "immediately followed by" of the spec, so `50 %`
   * is not a percentage.
   */
  const Percentage = token(noTrivia(sequence(g.NumberToken, literal('%'))));
  const Dimension = node(
    'Dimension',
    noTrivia(sequence(g.NumberToken, optional(g.DimensionUnit))),
    (children, _fields, span) => {
      const numberText = requireToken(children[0]).value;
      const unit = children.length > 1 ? requireToken(children[1]).value : '';
      return dimension(Number(numberText), unit, `${numberText}${unit}`);
    }
  );
  // CSS unicode-range is one opaque CSS token, not Less arithmetic. It belongs
  // in the value-term layer, but intentionally not the math-atom layer: Less
  // rejects `U+0-7F + 1` rather than applying numeric operations to the range.
  const UnicodeRange = node(
    'UnicodeRange',
    g.UnicodeRangeToken,
    children => any(requireToken(children[0]).value)
  );
  // CSS declaration hacks such as `#000 \\9` are a real one-token value
  // suffix. Keep the escape structural and narrow; this is not a raw-value
  // fallback or a second scanner for declaration text.
  const EscapeValue = node(
    'EscapeValue',
    regex(/(?:\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/),
    children => any(requireToken(children[0]).value)
  );
  const PercentEscape = node(
    'PercentEscape',
    g.PercentEscapeToken,
    children => any(requireToken(children[0]).value)
  );
  // `@page` pseudo-pages are header atoms, not selector syntax in a value
  // position. Preserve their one-token spelling without widening generic values.
  const PagePseudo = node(
    'PagePseudo',
    sequence(literal(':'), g.ValueIdentifier),
    children => any(`:${requireToken(children[1]).value}`)
  );
  // Unknown at-rule functions are intentionally permissive.  This legacy Less
  // argument spelling is one opaque grammar fact—not two quoted strings around
  // a value—and remains available to any unknown function name.
  const DoubledQuoteArgument = node(
    'DoubledQuoteArgument',
    sequence(literal('""'), regex(/[^"()]+/), literal('""')),
    children => any(`""${requireToken(children[1]).value}""`)
  );
  // This is the AST reduction of the public Less `ArgCondition` grammar. Its
  // operands are bounded ordinary values; comparison/logical structure is added
  // only after those values have been recognized.
  const FunctionConditionOperand = node(
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
  const FunctionConditionParen = node(
    'FunctionConditionParen',
    sequence(literal('('), g.FunctionConditionOr, literal(')')),
    (children): FunctionConditionFact => {
      const inner = children.find(isFunctionConditionFact);
      if (inner === undefined) {
        throw new TypeError('Less function condition lost its parenthesized operand.');
      }
      return { guard: inner.guard, src: `(${inner.src})`, grouped: true, hasComparison: inner.hasComparison };
    }
  );
  const FunctionConditionTerm = node(
    'FunctionConditionTerm',
    sequence(
      optional(functionConditionNot),
      choice(g.FunctionConditionParen, g.FunctionConditionOperand),
      optional(sequence(functionConditionOperator, choice(g.FunctionConditionParen, g.FunctionConditionOperand)))
    ),
    (children): FunctionConditionFact => {
      const nested = children.filter(isFunctionConditionFact);
      const values = children.filter(isValueNode);
      const operator = children.map(guardOperatorText).find((value): value is string => value !== null)?.trim();
      const left = nested[0] ?? (values[0] === undefined ? undefined : { guard: lessTruth(values[0]), src: functionConditionSource(values[0]), grouped: false, hasComparison: false, bare: values[0] });
      const right = nested[1] ?? (values.length > 1 && values[1] !== undefined ? { guard: lessTruth(values[1]), src: functionConditionSource(values[1]), grouped: false, hasComparison: false, bare: values[1] } : undefined);
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
        const leftValue = left.bare ?? condition(left.guard, left.src);
        const rightValue = right.bare ?? condition(right.guard, right.src);
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
  const FunctionConditionAnd = node(
    'FunctionConditionAnd',
    sequence(g.FunctionConditionTerm, many(sequence(functionConditionAnd, g.FunctionConditionTerm))),
    children => foldFunctionCondition('and', children)
  );
  const FunctionConditionOr = node(
    'FunctionConditionOr',
    sequence(g.FunctionConditionAnd, many(sequence(functionConditionOr, g.FunctionConditionAnd))),
    children => foldFunctionCondition('or', children)
  );
  const FunctionCondition = node(
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
  // boundary. It stays zero-width so the delimiter and surrounding trivia
  // remain owned by the enclosing function call, not a value/CST child.
  const functionArgumentBoundaryAhead = choice(
    peek(choice(literal(','), literal(';'), literal(')'))),
    peek(parser({ trivia: functionTrivia }, choice(literal(','), literal(';'))))
  );
  const FunctionScalarArgument = node(
    'FunctionScalarArgument',
    sequence(g.MathSum, functionArgumentBoundaryAhead),
    children => requireValueNode(children[0])
  );
  // `not(...)` is an explicit Less condition opener even without a comparison.
  // Keep this bounded opener test local: it only distinguishes that condition
  // form from an ordinary function value, and does not inspect an opaque
  // argument body.
  const functionConditionNotAhead = peek(parser(
    { trivia: functionTrivia },
    sequence(functionConditionNot, literal('('))
  ));
  // `name=value` is a call-argument PAIR, not a comparison — Less models it as a
  // dedicated assignment (`tree/assignment.js`) so `filter: alpha(opacity=50)`
  // replays verbatim instead of collapsing to `false`. The form is nothing
  // IE-specific: `foo(bar=1)` takes the same shape.
  //
  // The two forms are separated by SHAPE, not by function name: an assignment
  // key is a bare authored identifier, so a comparison whose left operand is
  // anything else — a number (`boolean(3 = 4)`), a variable (`foo(@a = 1)`), a
  // group or a call — still reaches `FunctionCondition` untouched. The `=` must
  // also open no other operator, keeping `==`, `=<`, `=>` and `=~` out.
  const assignmentKey = regex(/[-_a-zA-Z\u0080-\uffff][-\w\u0080-\uffff]*(?=[ \t\n\r\f]*=(?![=<>~]))/);
  const assignmentOperator = regex(/[ \t\n\r\f]*=[ \t\n\r\f]*/);
  const FunctionAssignmentArgument = node(
    'FunctionAssignmentArgument',
    noTrivia(sequence(field('key', assignmentKey), assignmentOperator, g.ArgumentValueSequence)),
    (children, fields) => {
      const value = children.find(isValueSlotValue);
      if (value === undefined) {
        throw new TypeError('Less function assignment argument lost its value.');
      }
      /*
       * §12.3 row 2: the pair is VERBATIM BYTES, not a node. Resolving `@x` in
       * `alpha(opacity=@x)` has no utility — the construct is dropped from
       * Less v5 — so this keeps the authored spelling and stops pretending the
       * value is live. The `=` re-emits unspaced, exactly as `Assignment` did.
       */
      return any(`${staticText(requireField(fields, 'key').value)}=${mixinArgumentSource(value)}`);
    }
  );
  // `@name: value` is a KEYWORD argument — the SAME construct `.m(@name: 1)`
  // already spells on the mixin lane (§12.0: one `.less` source, one node), so
  // it reduces to the same `CallArg` and the callee's own parameter names bind
  // it. It sits beside `FunctionAssignmentArgument` because it is the same
  // shape of problem — a key, an operator, a value — and it is gated the same
  // way: the key regex carries the operator LOOKAHEAD, so a positional `@c`
  // fails the key match outright instead of parsing a variable and backtracking
  // out of it. `@name:` must open no other operator, keeping `::` out.
  const keywordArgumentKey = regex(/@[-_a-zA-Z\u0080-\uffff][-\w\u0080-\uffff]*(?=[ \t\n\r\f]*:(?!:))/);
  const keywordArgumentOperator = regex(/[ \t\n\r\f]*:[ \t\n\r\f]*/);
  const FunctionKeywordArgument = node(
    'FunctionKeywordArgument',
    noTrivia(sequence(field('key', keywordArgumentKey), keywordArgumentOperator, g.ArgumentValueSequence)),
    (children, fields) => {
      const value = children.find(isValueSlotValue);
      if (value === undefined) {
        throw new TypeError('Less function keyword argument lost its value.');
      }
      return callArg(value, staticText(requireField(fields, 'key').value).slice(1));
    }
  );
  const FunctionArgument = node(
    'FunctionArgument',
    choice(
      sequence(functionConditionNotAhead, g.FunctionCondition),
      g.FunctionKeywordArgument,
      g.FunctionScalarArgument,
      g.ArgumentValueSequence,
      g.FunctionAssignmentArgument,
      g.FunctionCondition
    ),
    (children) => {
      const named = children.find(isLessCallArg);
      if (named !== undefined) {
        return named;
      }
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
  const identOrFunction = token(noTrivia(sequence(g.InterpolatedValueStart, optional(literal('(')))));
  const genericFunctionOpen = token(noTrivia(sequence(
    not(keywords(['url(', 'calc('], { caseInsensitive: true })),
    g.InterpolatedValueStart,
    literal('(')
  )));
  const GenericFunction = node(
    'Call',
    parser({ trivia: functionTrivia }, sequence(routed(), g.FunctionArguments, literal(')'))),
    (children, fields, span, rawChildren, triviaLog, state) =>
      functionCallFromChildren(children, fields, span, triviaLog, state, rawChildren)
  );
  const Call = node(
    'Call',
    parser({ trivia: functionTrivia }, sequence(genericFunctionOpen, g.FunctionArguments, literal(')'))),
    (children, fields, span, rawChildren, triviaLog, state) =>
      functionCallFromChildren(children, fields, span, triviaLog, state, rawChildren)
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
  const CallArgumentFunction = node(
    'Call',
    sequence(routed(genericFunctionOpen), CallArgumentFunctionArguments, literal(')')),
    argumentFunctionFromChildren
  );
  // Deprecated Less percent-format syntax is a normal existing function fact.
  // The glued `%(` opener keeps it distinct from the `%` arithmetic operator.
  const FormatFunction = node(
    'Call',
    sequence(noTrivia(literal('%(')), optional(sequence(not(literal('{')), g.ValueSequence)), many(noTrivia(sequence(regex(/,[ \t\n\r\f]*/), not(literal('{')), g.ValueSequence))), literal(')')),
    children => funcCall('%', children.slice(1, -1).filter(isValueSlotValue))
  );
  // A bare call is a Less statement only with its terminator.  Keep this
  // distinct from Call, which is also a value piece and must not
  // consume a declaration/list boundary.
  const terminalFunctionBoundary = noTrivia(peek(sequence(
    optional(g.whitespace),
    choice(literal('}'), not(regex(/[\s\S]/)))
  )));
  const GenericFunctionStatement = node(
    'Call',
    sequence(g.CallArgumentFunction, literal(';')),
    (children) => {
      const call = children.find(isFunctionCall);
      if (call === undefined) {
        throw new TypeError('Less function statement lost its call fact.');
      }
      return lowerLogicalCallStatement(call);
    }
  );
  const TerminalGenericFunction = transform(
    sequence(GenericFunction, terminalFunctionBoundary),
    ([call]) => isStatement(call) ? call : ''
  );
  const FunctionStatement = transform(
    dispatch(
      identOrFunction,
      caseOf('each(', g.EachFunctionStatement),
      when(
        matches(/^(?!(?:url|calc)\($).+\($/i),
        choice(GenericFunctionStatement, TerminalGenericFunction)
      )
    ),
    ([, statement]) => statement
  );
  // `calc(` owns its boundary gaps for the same reason `Paren` below does: the
  // math ladder runs under `noTrivia`, so an interior that admits authored
  // padding has to spell it. Without these terms `calc( 1px + 2px )` was
  // rejected as hard as `calc(/* c */1px + 2px)` was, and `Paren`'s own padding
  // was unreachable from inside a calc — `calc( (1px + 2px) )` failed too.
  const CalcFunction = node(
    'CalcCall',
    noTrivia(sequence(routed(), optional(whitespace), g.MathSum, optional(whitespace), literal(')'))),
    children => funcCall(functionNameFromOpener(children[0]), [requireValueNode(children.find(isValueNode))])
  );
  const Identifier = node(
    'Identifier',
    noTrivia(sequence(routed(), many(g.interpolatedValueTail))),
    (children) => {
      if (children.some(isInterpolationFact)) {
        return interpolation(interpolationPartsFrom(children, true));
      }
      return keyword(children.map(child => requireToken(child).value).join(''));
    }
  );
  const IdentifierOrFunction = dispatch(
    identOrFunction,
    caseOf('url(', choice(RoutedVariableUrl, RoutedPlainUrl)),
    caseOf('calc(', g.CalcFunction),
    when(endsWith('('), g.GenericFunction),
    otherwise(Identifier)
  );
  // Less 5 removed inline backtick JavaScript. Recognize the complete legacy
  // value shape so public diagnostics can point at the removed construct instead
  // of reporting a generic value-position expected-token failure.
  const BacktickJavaScript = node(
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
  const EscapedParen = node(
    'Block',
    noTrivia(sequence(literal('~('), g.ValueList, literal(')'))),
    (children, _fields, span) => withSourceSpan(
      block(requireValueSlot(children[1]), 'paren', true),
      span
    )
  );
  // A bare `(...)` is a math grouping in Less.  Function/mixin argument lists
  // have their own productions above; do not widen this value position into a
  // permissive raw list.
  const Paren = node(
    'Block',
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
  const gridLineName = node(
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
  const QueryColonFeature = node(
    'QueryColonFeature',
    sequence(literal('('), g.Identifier, regex(/:[ \t\n\r\f]*/), g.MathSum, literal(')')),
    (children, _fields, span, _rawChildren, _triviaLog, state) => withSourceSpan(
      block(operation(':', keyword(requireToken(children[1]).value), requireValueNode(children[3]), false,
        lessMathOutsideParens(state, ':'))),
      span
    )
  );
  const Value = node(
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
      g.CustomPropertyValue,
      g.Dimension,
      g.Color,
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
  const MathUnary = node(
    'MathUnary',
    sequence(
      optional(noTrivia(regex(/-(?=[(@])/))),
      g.Value
    ),
    (children, _fields, _span, _rawChildren, _triviaLog, state) => children.length === 1
      ? requireValueNode(children[0])
      : operation(
          '*',
          dimension(-1, '', '-1'),
          requireValueNode(children[1]),
          false,
          lessMathOutsideParens(state, '*')
        ),
    { collapse: true }
  );
  const MathAtom = node(
    'MathAtom',
    g.MathUnary,
    children => requireValueNode(children[0]),
    { collapse: true }
  );
  // Parenthesized and calc math follows Less precedence: product before sum,
  // both left-associative.  Top-level declarations deliberately exclude `/`:
  // with Less's default parens-division mode it is a preserved slash group, not
  // an eager division Operation.  The existing serializer already recognizes
  // that Sequence shape and reinterprets it only inside calc().
  const MathProduct = node(
    'MathProduct',
    noTrivia(sequence(g.MathAtom, many(sequence(productOperator, g.MathAtom)))),
    foldOperation,
    { collapse: true }
  );
  const MathSum = node(
    'MathSum',
    noTrivia(sequence(g.MathProduct, many(sequence(sumOperator, g.MathProduct)))),
    foldOperation,
    { collapse: true }
  );
  const TopProduct = node(
    'TopProduct',
    noTrivia(sequence(g.MathAtom, many(sequence(topProductOperator, g.MathAtom)))),
    foldOperation,
    { collapse: true }
  );
  const TopSum = node(
    'TopSum',
    noTrivia(sequence(g.TopProduct, many(sequence(sumOperator, g.TopProduct)))),
    foldOperation,
    { collapse: true }
  );
  // In Less's default `parens-division` mode a glued top-level `/` is not an
  // eager Operation. It is one parser-owned slash group that becomes division
  // only when a surrounding calc context consumes it.
  const PreservedDivision = node(
    'PreservedDivision',
    noTrivia(sequence(g.TopSum, oneOrMore(sequence(field('separator', preservedSlashBoundary), g.TopSum)))),
    (children, fields, _span, _rawChildren, _triviaLog, state): ValueNode => {
      /*
       * The group is preserved bytes exactly when the policy does NOT divide a
       * bare `/`. Under `math: always` it is not preserved at all, so operands
       * keep the arithmetic they were built with.
       */
      const preserved = !lessMathOutsideParens(state, '/');
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
        parts.push(preserved ? withoutBareMath(values[index]!) : values[index]!);
        if (index < slashBoundaries.length) {
          parts.push(keyword('/'));
        }
      }
      const separators = slashBoundaries.flatMap(boundary => [boundary.before, boundary.after]);
      return withValueLayout(
        spaced(parts),
        separators.length === parts.length - 1
          ? separators
          : Array.from({ length: parts.length - 1 }, () => '')
      );
    }
  );
  // Value pieces are separated by grammar-owned whitespace. Keeping that token
  // here is what lets a canonical Sequence retain multiline CSS layout without
  // scanning/re-splitting a completed declaration value later.
  // Left-factored `TopSum (/ TopSum)*`: the value-piece choice used to try
  // `PreservedDivision` (a full `TopSum` + REQUIRED slash tail) and, on the
  // no-slash majority, fail the tail, backtrack, and re-parse `TopSum` from the
  // same position (the two arms share `TopSum`'s first-set, so the `choice` is
  // not disjoint and cannot dispatch past the redundant descent). Parsing
  // `TopSum` once and taking an OPTIONAL slash tail yields byte-identical values
  // — a bare `TopSum` when no slash follows, the same `Sequence` when one
  // does — without the second full value descent per non-slash piece.
  const topSumMaybeDivision = node(
    'TopSumMaybeDivision',
    noTrivia(sequence(g.TopSum, many(sequence(field('separator', preservedSlashBoundary), g.TopSum)))),
    (children, fields, _span, _rawChildren, _triviaLog, state) => {
      if (fields?.separator === undefined) {
        return requireValueNode(children[0]);
      }
      const slashBoundaries = requireFields(fields, 'separator').map((separator) => {
        if (!isSlashBoundaryFact(separator.value)) {
          throw new TypeError('Less value piece produced an invalid slash boundary.');
        }
        return separator.value;
      });

      /*
       * The group is preserved bytes exactly when the policy does NOT divide a
       * bare `/`; under `math: always` it is not preserved and its operands keep
       * the arithmetic they were built with. See {@link withoutBareMath}.
       */
      const preserved = !lessMathOutsideParens(state, '/');
      const values = children.filter(isValueNode);
      const parts: ValueNode[] = [];
      for (let index = 0; index < values.length; index += 1) {
        parts.push(preserved ? withoutBareMath(values[index]!) : values[index]!);
        if (index < slashBoundaries.length) {
          parts.push(keyword('/'));
        }
      }
      const separators = slashBoundaries.flatMap(boundary => [boundary.before, boundary.after]);
      return withValueLayout(
        spaced(parts),
        separators.length === parts.length - 1
          ? separators
          : Array.from({ length: parts.length - 1 }, () => '')
      );
    }
  );
  const valuePiece = choice(g.UnicodeRange, topSumMaybeDivision, literal('/'), literal('-'), literal('%'));
  const nestedAtRuleValueStart = regex(/@[^;{}()'"]*\{/);
  const valueTriviaBoundary = parser(
    { trivia: whitespace },
    sequence(
      peek(whitespace),
      not(nestedAtRuleValueStart),
      g.valuePiece
    )
  );
  const gluedVariableValueBoundary = sequence(
    leaf(peek(literal('@')), () => ({ kind: 'glued-value-boundary' })),
    g.valuePiece
  );
  const valueContinuation = choice(valueTriviaBoundary, gluedVariableValueBoundary);
  // Function arguments are the one value context where top-level Less
  // comparison/logical syntax has a separate continuation. Stop before that
  // marker so the FunctionArgument family can route it through FunctionCondition;
  // nested calls are already one value piece and therefore never leak an inner
  // operator into their parent's decision.
  const functionArgumentValueTriviaBoundary = sequence(
    not(functionConditionStop),
    valueTriviaBoundary
  );
  const functionArgumentValueContinuation = choice(
    functionArgumentValueTriviaBoundary,
    gluedVariableValueBoundary
  );
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
  const ValueSequence = node(
    'ValueSequence',
    noTrivia(sequence(g.valuePiece, many(valueContinuation))),
    (children, _fields, _span, _rawChildren, triviaLog, state) => valuePieceReducerWithTrivia(children, triviaLog, state)
  );
  // Function bodies use their own argument boundary rule, but comments *inside*
  // an argument are still lexical trivia. This local value term therefore uses
  // the same continuation boundary as ordinary values, while a completed
  // argument's trailing trivia remains owned by `functionTrivia`.
  const ArgumentValueSequence = node(
    'FunctionValueSequence',
    noTrivia(sequence(
      g.valuePiece,
      many(functionArgumentValueContinuation),
      functionArgumentBoundaryAhead
    )),
    (children, _fields, _span, _rawChildren, triviaLog, state) => valuePieceReducerWithTrivia(children, triviaLog, state)
  );
  const ValueList = node(
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
    (children, fields, _span, rawChildren, triviaLog, state) => {
      const referenceValue = children.find(isReference);
      if (referenceValue !== undefined) {
        return referenceValue;
      }
      return commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueSlotValue, rawChildren);
    }
  );
  // Variable declarations additionally permit Less trivia immediately after
  // `:` and after comma boundaries. A `//` line comment is trivia (never a CSS
  // value node), while the comma-separated value remains the normal List fact.
  const VariableValue = node(
    'VariableValue',
    sequence(
      optional(whitespace),
      oneOrMoreSep(
        g.ValueSequence,
        field('separator', regex(/,[ \t\n\r\f]*/))
      ),
      optional(sequence(literal(','), optional(whitespace)))
    ),
    (children, fields, _span, rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueSlotValue, rawChildren)
  );
  // `!important` is a grammar-owned declaration/value modifier.  Variables
  // carry the wrapper so references hoist importance once; declarations expose
  // their own flag.  Do not represent it as an opaque keyword/value suffix.
  const ImportantValue = node(
    'ImportantValue',
    // Priority syntax is token structure, not one glued source string: Less
    // accepts `!important`, `! important`, and `!/*comment*/important`.
    sequence(g.ValueList, literal('!'), g.ImportantToken),
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
  const ValueListWithPriority = node(
    'ValueListWithPriority',
    sequence(
      not(literal('{')),
      g.ValueList,
      optional(sequence(literal('!'), g.ImportantToken))
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
  const CustomPropertyName = node(
    'CustomPropertyName',
    choice(
      noTrivia(sequence(
        literal('--'),
        optional(choice(g.InterpolatedCustomPropertyStart, g.InterpolatedCustomPropertyDash)),
        g.Interpolation,
        many(choice(g.InterpolatedCustomPropertyTail, g.Interpolation))
      )),
      g.CustomPropertyToken
    ),
    (children) => {
      if (!children.some(isInterpolationFact)) {
        return requireToken(children[0]).value;
      }
      return interpolation(interpolationPartsFrom(children, false));
    }
  );
  const CustomGroup = node(
    'CustomGroup',
    parser(
      { trivia: customValueCommentTrivia },
      choice(
        sequence(literal('('), many(g.CustomInnerPart), literal(')')),
        sequence(literal('['), many(g.CustomInnerPart), literal(']')),
        sequence(literal('{'), many(g.CustomInnerPart), literal('}'))
      )
    ),
    children => customPartsFromChildren(children)
  );
  const CustomAtKeywordText = node(
    'CustomAtKeywordText',
    g.CustomValueAtKeyword,
    children => requireToken(children[0]).value
  );
  const CustomInnerPart: Combinator<CustomValuePart> = choice(
    g.Interpolation,
    g.CustomValueInnerContent,
    g.CustomValueSingleQuoted,
    g.CustomValueDoubleQuoted,
    g.CustomGroup,
    g.CustomAtKeywordText,
    g.VariableReference
  );
  const CustomPart: Combinator<CustomValuePart> = choice(
    g.Interpolation,
    g.CustomValueOuterContent,
    g.CustomValueSingleQuoted,
    g.CustomValueDoubleQuoted,
    g.CustomGroup,
    g.CustomAtKeywordText,
    g.VariableReference
  );
  const CustomValue = node(
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
  // same one the at-rule prelude custom-property branch produces for the
  // identical token in an at-rule header.
  const CustomPropertyValue = node(
    'CustomPropertyValue',
    g.CustomPropertyToken,
    children => keyword(requireToken(children[0]).value)
  );
  const CustomDeclaration = node(
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
      optional(sequence(literal('!'), g.ImportantToken))
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
  const InterpolatedProperty = node(
    'InterpolatedProperty',
    choice(
      noTrivia(sequence(optional(literal('*')), optional(literal('-')), optional(g.InterpolatedPropertyStart), g.Interpolation, many(choice(g.InterpolatedPropertyTail, g.Interpolation)))),
      noTrivia(sequence(literal('--'), optional(choice(g.InterpolatedCustomPropertyStart, g.InterpolatedCustomPropertyDash)), g.Interpolation, many(choice(g.InterpolatedCustomPropertyTail, g.Interpolation))))
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
  // the literal DeclarationProperty arm. The collapsed semantic node keeps the
  // marker off the declaration reducer's `children[0]` property slot without
  // adding a second public CST name for the same InterpolatedProperty concept.
  const interpolatedPropertyAhead = peek(regex(/[^:;{}]*[@$]\{/));
  const interpolatedPropertyHead = node(
    'InterpolatedProperty',
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
      interpolatedPropertyHead,
      g.NumericMapKeyToken,
      g.DeclarationPropertyToken
    ),
    optional(sequence(choice(literal('+_'), literal('+')))),
    literal(':')
  ));
  const StandardDeclaration = node(
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
      const layout = Array.isArray(value) || isSequence(value) ? valueLayoutOf(value) : undefined;
      const valueOnNewLine = (valueGap.includes('\n') || valueGap.includes('\r'))
        && layout?.some(separator => separator.includes('\n') || separator.includes('\r')) === true;
      if (merge !== null && merge !== ',' && merge !== ' ') {
        throw new TypeError('Less grammar produced an invalid declaration merge modifier.');
      }
      const node = !Array.isArray(value) && isValueNode(value) && value.type === 'Important'
        ? decl(isInterp(rawName) ? rawName : requireToken(rawName).value, valueSlot(value.value), merge, true, valueOnNewLine)
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
  const PunctuationMapDeclaration = node(
    'PunctuationMapDeclaration',
    sequence(
      g.PunctuationMapKeyToken,
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
  const PositionalMixinCallArgument = node(
    'PositionalMixinArgument',
    sequence(g.CallArgumentValue, optional(literal('...'))),
    /* ONE shape for both arms and both call families. The conditional spread
     * this replaced realized a second hidden class for every `@args...`. */
    children => callArg(
      requireMixinCallArgumentValue(children[0]),
      undefined,
      children.some(child => isTerminalText(child, '...'))
    )
  );
  const mixinCallArgument: Combinator<MixinCallArgument> = choice(
    node(
      'NamedMixinArgument',
      sequence(literal('@'), lessVariableName, literal(':'), g.CallArgumentValue),
      (children, _fields, span) => {
        const name = requireSupportedVariableName(children[1], span.start, span.start + variableNameText(children[1]).length + 1);
        return callArg(requireMixinCallArgumentValue(children[3]), name);
      }
    ),
    PositionalMixinCallArgument
  );
  // In Less, a semicolon starts a new mixin argument group; commas *within*
  // that group form one list-valued argument. Keep the semicolon branch
  // transactional so ordinary comma-only calls retain their existing individual
  // argument shape.
  const MixinArgumentGroup = node(
    'MixinArgumentGroup',
    sequence(PositionalMixinCallArgument, oneOrMore(sequence(literal(','), PositionalMixinCallArgument))),
    (children) => {
      const args = children.filter(isMixinCallArgument);
      return callArg(list(args.map(argument => requireValueSlot(argument.value)), ','));
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
  const MixinArguments = node(
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
  /*
   * A class/id statement has one parenthesized interior. It becomes a mixin
   * definition only when the continuation reaches `when` / `{`; otherwise it
   * is a call. Keep the shared syntax as facts until that continuation is
   * known, rather than retrying the entire parameter list as call arguments.
   */
  // A bare `@name` is a parameter binding only at an item boundary. In a call,
  // `@name - 1` is one positional value, so the boundary gate leaves that form
  // to CallArgumentValue without reparsing the variable reference.
  const mixinInteriorBoundary = choice(literal(','), literal(';'), literal(')'));
  const MixinInteriorBinding = node(
    'MixinBinding',
    sequence(
      g.VariableReference,
      choice(
        literal('...'),
        sequence(literal(':'), g.CallArgumentValue),
        peek(mixinInteriorBoundary)
      )
    ),
    (children) => {
      const reference = children[0];
      if (!isVarRef(reference)) {
        throw new TypeError('Less mixin binding lost its variable reference.');
      }
      const defaultValue = children.slice(1).find(value => isValueSlotValue(value) || isMixinCall(value));
      return {
        kind: 'binding',
        reference,
        ...(defaultValue === undefined ? {} : { default: requireMixinCallArgumentValue(defaultValue) }),
        rest: children.some(child => isTerminalText(child, '...'))
      };
    }
  );
  const MixinInteriorAnonymousRest = node(
    'MixinRestParam',
    literal('...'),
    () => ({ kind: 'anonymous-rest' })
  );
  const MixinInteriorPositional = node(
    'MixinArgument',
    g.CallArgumentValue,
    children => ({ kind: 'positional', value: requireMixinCallArgumentValue(children[0]) })
  );
  const mixinInteriorItem = choice(
    MixinInteriorBinding,
    MixinInteriorAnonymousRest,
    MixinInteriorPositional
  );
  const mixinInteriorSeparator = parser({ trivia: mixinSignatureTrivia }, commaOrSemicolon);
  const MixinInterior = node(
    'MixinInterior',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      literal('('),
      optional(oneOrMoreSep(
        field('item', mixinInteriorItem),
        field('separator', mixinInteriorSeparator)
      )),
      optional(field('trailingSeparator', choice(literal(','), literal(';'))))
    )),
    (_children, fields): MixinInteriorFact => ({
      items: fields?.item === undefined
        ? []
        : requireFields(fields, 'item').map(item => requireMixinInteriorItem(item.value)),
      separators: fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map((separator) => {
            const value = requireTerminalText(separator.value);
            if (value !== ',' && value !== ';') {
              throw new TypeError('Less mixin interior produced an invalid separator.');
            }
            return value;
          }),
      ...(fields?.trailingSeparator === undefined
        ? {}
        : (() => {
            const value = requireTerminalText(requireField(fields, 'trailingSeparator').value);
            if (value !== ',' && value !== ';') {
              throw new TypeError('Less mixin interior produced an invalid trailing separator.');
            }
            return { trailingSeparator: value };
          })())
    })
  );
  const ReferenceTail = choice(
    node(
      'ReferenceBracketTail',
      g.InterpolationAccessor,
      (children): ReferenceTailFact => {
        const accessor = requireInterpolationAccessorFact(children[0]);
        return { step: { type: 'LookupStep', kind: accessor.keyKind, name: accessor.key }, src: `[${accessor.src}]` };
      }
    ),
    node(
      'ReferenceDotTail',
      sequence(literal('.'), g.VariableNameToken),
      (children): ReferenceTailFact => {
        const name = requireToken(children[1]).value;
        return { step: { type: 'LookupStep', kind: 'member', name }, src: `.${name}` };
      }
    ),
    node(
      'ReferenceCallTail',
      sequence(literal('('), optional(g.MixinArguments), literal(')')),
      (children): ReferenceTailFact => {
        const args = mixinArgumentsFromChildren(children);
        return { step: { type: 'Call', args }, src: `(${args.map(callArgumentSource).join(', ')})` };
      }
    )
  );
  const InterpolationLastAccessorFromRouted = node(
    'InterpolationLastAccessor',
    noTrivia(routed()),
    (): InterpolationAccessorFact => ({ key: -1, keyKind: 'index', src: '-1' })
  );
  const InterpolationIndexAccessorFromRouted = node(
    'InterpolationIndexAccessor',
    noTrivia(sequence(routed(), g.InterpolationIndex, literal(']'))),
    (children): InterpolationAccessorFact => {
      const text = requireToken(children[1]).value;
      return { key: Number(text), keyKind: 'index', src: text };
    }
  );
  const InterpolationPropertyVariableAccessorFromRouted = node(
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
    node(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.IndirectVariableReference, literal(']'))),
      (children) => {
        const key = requireValueNode(children[1]);
        if (!isVarIndirect(key) || !isVarRef(key.name)) {
          throw new TypeError('Less indirect map key must retain its variable reference.');
        }
        return { key, keyKind: 'var', src: `@@${key.name.name}` };
      }
    ),
    node(
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
    node(
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
    node(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.InterpolationKey, literal(']'))),
      (children): InterpolationAccessorFact => {
        const text = requireToken(children[1]).value;
        return { key: keyword(text), keyKind: 'prop', src: text };
      }
    )
  );
  const ReferenceLastTailFromRouted = node(
    'ReferenceBracketTail',
    InterpolationLastAccessorFromRouted,
    (children): ReferenceTailFact => {
      const accessor = requireInterpolationAccessorFact(children[0]);
      return { step: { type: 'LookupStep', kind: accessor.keyKind, name: accessor.key }, src: `[${accessor.src}]` };
    }
  );
  const ReferenceBracketTailFromRouted = node(
    'ReferenceBracketTail',
    choice(
      InterpolationIndexAccessorFromRouted,
      InterpolationPropertyVariableAccessorFromRouted,
      InterpolationReferenceAccessorFromRouted
    ),
    (children): ReferenceTailFact => {
      const accessor = requireInterpolationAccessorFact(children[0]);
      return { step: { type: 'LookupStep', kind: accessor.keyKind, name: accessor.key }, src: `[${accessor.src}]` };
    }
  );
  const ReferenceDotTailFromRouted = node(
    'ReferenceDotTail',
    sequence(routed(), g.VariableNameToken),
    (children): ReferenceTailFact => {
      const name = requireToken(children[1]).value;
      return { step: { type: 'LookupStep', kind: 'member', name }, src: `.${name}` };
    }
  );
  const ReferenceCallTailFromRouted = node(
    'ReferenceCallTail',
    sequence(routed(), optional(g.MixinArguments), literal(')')),
    (children): ReferenceTailFact => {
      const args = mixinArgumentsFromChildren(children);
      return { step: { type: 'Call', args }, src: `(${args.map(callArgumentSource).join(', ')})` };
    }
  );
  const ReferenceTailFromDelimiter = dispatch(
    choice(literal('[]'), literal('['), literal('.'), literal('(')),
    when('[]', ReferenceLastTailFromRouted),
    when('[', ReferenceBracketTailFromRouted),
    when('.', ReferenceDotTailFromRouted),
    when('(', ReferenceCallTailFromRouted)
  );
  // This is the existing callable-value fact shared by `each(.mixin(), …)` and
  // `@name: .mixin()`. Keep it narrower than an ordinary MixinCall: namespace
  // paths, dynamic names, and call-level modifiers have no approved binding
  // contract in this direct slice.
  const FlatMixinCall = node(
    'MixinCall',
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
  const NamespacedMixinCall = node(
    'MixinCall',
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
      const path: MixinCall['path'] = [{ combinator: ' ', selector: head }, ...tails.slice(0, -1)];
      return {
        ...mixinCall(last.selector, mixinArgumentsFromChildren(children)),
        path
      };
    }
  );
  // A variable can retain a namespaced mixin call as its lazy map value. This
  // differs from the `each()` iterable route above because Less permits a
  // call-level `!important` modifier here; the established MixinCall flag
  // carries it without a raw-value recovery or a new AST node family.
  const NamespacedMixinValue = node(
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
      const path: MixinCall['path'] = [{ combinator: ' ', selector: head }, ...tails.slice(0, -1)];
      const call = {
        ...mixinCall(last.selector, mixinArgumentsFromChildren(children)),
        path
      };
      return children.some(child => isTerminalText(child, '!important')) ? { ...call, important: true } : call;
    }
  );
  const MixinReferenceBase = node(
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
      const call = mixinCall(terminal?.selector ?? head, mixinArgumentsFromChildren(children));
      const path: MixinCall['path'] = [{ combinator: ' ', selector: head }, ...tails.slice(0, -1)];
      const withPath = tails.length === 0 ? call : { ...call, path };
      const hasCall = children.some(child => isTerminalText(child, '('));
      const raw = `${head}${tails.map(tail => `${tail.combinator}${tail.selector}`).join('')}${hasCall ? `(${withPath.args.map(callArgumentSource).join(', ')})` : ''}`;
      return { call: withPath, raw };
    }
  );
  // A static namespace/mixin invocation remains the existing typed MixinCall
  // (including its selector-path combinators). Once the shared base is followed
  // by a lookup/call accessor, the whole value is a Reference. The first
  // accessor delimiter is consumed once and routed to the matching tail builder,
  // so malformed accessor bodies stay on the selected reference route instead
  // of probing forward with a broad value-position lookahead.
  const MixinReference = node(
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
  const ReferenceCall = node(
    'VarCall',
    sequence(
      literal('@'), not(word(
        'supports',
        '-_a-zA-Z0-9\\u0080-\\uFFFF',
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
  const mixinGuardDefaultOperand = node(
    'MixinGuardDefaultOperand',
    mixinGuardDefaultCall,
    () => funcCall('default', [])
  );
  const MixinGuardOperand = node(
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
      g.Call,
      g.Keyword
    ),
    children => requireValueNode(children[0])
  );
  const MixinGuardTerm = node(
    'MixinGuardTerm',
    sequence(
      optional(lessWord('not')),
      choice(
        sequence(literal('('), g.MixinGuardOr, literal(')')),
        sequence(g.MixinGuardOperand, optional(sequence(mixinGuardOperator, g.MixinGuardOperand)))
      )
    ),
    (children): MixinGuard => {
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
            guard = { g: 'call', name: call.name, args: call.args.map(arg => requireValueNode(arg.value)) };
          } else {
            guard = lessGuardTruth(left);
          }
        } else {
          const right = values[1];
          if (right === undefined) {
            throw new TypeError('Less grammar produced a comparison guard without a right operand.');
          }
          /*
           * GUARD position, so the comparison lowers to the MATCH test (§4.2a).
           * This production family is reached only from `g.MixinGuard` — the
           * `when` clause of a mixin definition or a CSS guard — and both ask
           * whether a definition APPLIES. `.generic(1, true) when (@a < @b)`
           * has no ordering and therefore does not match; lessc 4.6.3 agrees,
           * and so does the owner-maintained expected CSS. Value position keeps
           * the assertion, built separately in `FunctionConditionTerm`.
           */
          guard = { g: 'match', op: operator, left, right };
        }
      }
      return children.some(child => isTerminalText(child, 'not')) ? { g: 'not', inner: guard } : guard;
    }
  );
  const MixinGuardAnd = node(
    'MixinGuardAnd',
    sequence(g.MixinGuardTerm, many(sequence(lessWord('and'), g.MixinGuardTerm))),
    children => foldMixinGuards('and', children)
  );
  const MixinGuardOr = node(
    'MixinGuardOr',
    sequence(g.MixinGuardAnd, many(sequence(choice(lessWord('or'), literal(',')), g.MixinGuardAnd))),
    children => foldMixinGuards('or', children)
  );
  const unparenthesizedMixinGuard = node(
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
  const MixinGuardTopTerm = node(
    'MixinGuardTopTerm',
    choice(
      unparenthesizedMixinGuard,
      sequence(optional(lessWord('not')), literal('('), g.MixinGuardOr, literal(')')),
      sequence(lessWord('not'), g.MixinGuardTerm)
    ),
    (children): MixinGuard => {
      const guard = children.find(isMixinGuard);
      if (guard === undefined) {
        throw new TypeError('Less grammar produced an empty top-level grouped guard.');
      }
      return children.some(child => isTerminalText(child, 'not')) ? { g: 'not', inner: guard } : guard;
    }
  );
  const MixinGuardTopAnd = node(
    'MixinGuardTopAnd',
    sequence(g.MixinGuardTopTerm, many(sequence(lessWord('and'), g.MixinGuardTopTerm))),
    children => foldMixinGuards('and', children)
  );
  const MixinGuardTopOr = node(
    'MixinGuardTopOr',
    sequence(g.MixinGuardTopAnd, many(sequence(choice(lessWord('or'), literal(',')), g.MixinGuardTopAnd))),
    children => foldMixinGuards('or', children)
  );
  const MixinGuard = node(
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
  // Shared block-body statement choice. Every braced Less body (mixin
  // definitions, `@supports`/media/container/generic at-rule blocks, and the
  // ruleset body via the extend-augmented reuse below) accepts this exact
  // ordered arm set. Factoring it into one named combinator keeps the arm-win
  // precedence identical across all block contexts instead of hand-copying the
  // arms per production. The root document and the detached-ruleset/`each`
  // `BodyStatement` deliberately keep their own ordered arm sets
  // because they legitimately differ (comment-first root ordering; the
  // punctuation-map arm and function/ruleset reordering in body statements).
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
  // Class/id statement starts are resolved by `ClassIdStatement` below. It
  // parses the selector prefix once, then the literal-led continuation decides
  // whether the retained structure is a mixin definition/call or a ruleset.
  // Keep the unsupported dash-only spelling separate because it has a dedicated
  // public diagnostic and cannot form the shared selector prefix.
  const UnsupportedDashOnlyMixin = node(
    'UnsupportedMixinName',
    noTrivia(choice(
      sequence(choice(literal('.'), literal('#')), literal('-'), literal('('), optional(g.MixinArguments), literal(')')),
      sequence(choice(literal('.'), literal('#')), literal('-'), literal(';'))
    )),
    (_children, _fields, span) => {
      throw new LessUnsupportedMixinNameError(span.start, span.end);
    }
  );
  const mixinStatement = choice(UnsupportedDashOnlyMixin, g.ClassIdStatement);
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
  const guardedRuleset = node(
    'GuardedRuleset',
    sequence(rulesetNotDeclaration, g.RulesetWithExtends),
    (children) => {
      const ruleset = children.find(isRuleset);
      if (ruleset === undefined) {
        throw new TypeError('Less declaration-guarded ruleset lost its rule.');
      }
      return ruleset;
    },
    { collapse: true }
  );
  const declarationItem = node(
    'DeclarationItem',
    sequence(
      g.Declaration,
      declarationEnd
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
  const rootDeclarationItem = node(
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
  const punctuationMapDeclarationItem = node(
    'PunctuationMapDeclarationItem',
    sequence(
      PunctuationMapDeclaration,
      declarationEnd
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
  const nestedGuardedRuleset = node(
    'GuardedRuleset',
    sequence(rulesetNotDeclaration, g.NestedRulesetWithExtends),
    (children) => {
      const ruleset = children.find(isRuleset);
      if (ruleset === undefined) {
        throw new TypeError('Less guarded ruleset lost its ruleset fact.');
      }
      return ruleset;
    },
    { collapse: true }
  );
  const blockItem = choice(atStatement, mixinStatement, g.FunctionStatement, nestedGuardedRuleset, declarationItem, literal(';'));
  const blockBody = many(blockItem);
  // The ruleset body adds one extra arm (`ExtendStatement`) after the
  // shared arms. Nesting the shared choice ahead of it preserves the original
  // precedence: the shared arms (including the empty `;`) are tried in the same
  // order first, then the extend statement — behaviourally identical to the
  // former flat `choice(<shared arms>, ExtendStatement, ';')` because
  // an extend head never matches `;` or any shared arm the flat list did not.
  const rulesetBody = many(choice(blockItem, g.ExtendStatement));
  const EachName = node(
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
  // The ruleset arm is `nestedGuardedRuleset`, the same arm `blockItem` uses:
  // a detached-ruleset body is a nested context, so a child selector may lead
  // with a combinator (`> td { … }`). Only `Stylesheet` keeps the absolute
  // `guardedRuleset`, where a leading combinator stays an error.
  const BodyStatement = choice(punctuationMapDeclarationItem, atStatement, mixinStatement, nestedGuardedRuleset, g.FunctionStatement, declarationItem, literal(';'));
  const ValueBlock = node(
    'ValueBlock',
    sequence(literal('{'), many(g.BodyStatement), optional(g.Call), literal('}')),
    children => classifyValueBlock(requireValueBlockBody(children))
  );
  const CallArgumentValue = node(
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
  const EachCallback = node(
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
    (children): LessEachCallback => {
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
  const EachFunctionStatement = node(
    'For',
    // An inline detached ruleset is an ordinary `each()` iterable
    // (`each({ margin: m; padding: p; }, \u2026)`). It is listed here rather than in
    // ValueList because the call-only `{ \u2026 }` first set must stay out of
    // ordinary declaration values.
    sequence(
      routed(),
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
      const callback = children.find(isLessEachCallback);
      if (callback === undefined) {
        throw new TypeError('Less each() reduction produced an invalid callback.');
      }
      const iterable = children.find(child => isMixinCall(child) || isValueSlotValue(child));
      if (iterable === undefined) {
        throw new TypeError('Less each() reduction produced an invalid iterable.');
      }
      return forNode(isMixinCall(iterable) ? iterable : requireValueSlot(iterable), callback.rules, callback.binding);
    }
  );
  const enclosedRaw = node(
    'EnclosedRaw',
    noTrivia(choice(g.BlockCommentToken, enclosedText)),
    children => requireToken(children[0]).value
  );
  const EnclosedQuoted = node(
    'EnclosedQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.VariableInterpolation, g.BareVariableInterpolation, enclosedDoubleChunk)), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.VariableInterpolation, g.BareVariableInterpolation, enclosedSingleChunk)), literal('\'')))
    ),
    enclosedInterpolationFromChildren
  );
  const EnclosedGroup = node(
    'EnclosedGroup',
    choice(
      noTrivia(sequence(literal('('), g.EnclosedContent, literal(')'))),
      noTrivia(sequence(literal('['), g.EnclosedContent, literal(']'))),
      noTrivia(sequence(literal('{'), g.EnclosedContent, literal('}')))
    ),
    enclosedInterpolationFromChildren
  );
  const EnclosedContent = node(
    'EnclosedContent',
    noTrivia(many(choice(
      g.BareVariableInterpolation,
      enclosedRaw,
      g.VariableInterpolation,
      g.EnclosedQuoted,
      g.EnclosedGroup
    ))),
    enclosedInterpolationFromChildren
  );
  const EnclosedFunctionName = node(
    'EnclosedFunctionName',
    token(noTrivia(sequence(g.QueryFunctionName, literal('(')))),
    children => ({ name: functionNameFromOpener(children[0]) })
  );
  const Enclosed = node(
    'Enclosed',
    choice(
      noTrivia(sequence(g.EnclosedFunctionName, g.EnclosedContent, literal(')'))),
      noTrivia(sequence(literal('('), g.EnclosedContent, literal(')')))
    ),
    (children) => {
      const content = children.find((child): child is Interpolation => typeof child === 'object' && child !== null && 'type' in child && child.type === 'Interpolation');
      if (content === undefined) {
        throw new TypeError('Less general-enclosed lost its grammar-owned content.');
      }
      const name = children.find((child): child is EnclosedNameFact => typeof child === 'object' && child !== null && 'name' in child);
      return name === undefined ? block(content) : funcCall(name.name, [content]);
    }
  );
  // `@supports` has its own typed condition grammar. Keep this narrower than
  // ordinary Less values: feature values are static leaf facts, logical terms
  // and nested conditions retain their authored parentheses as `Block`, and
  // functions/general-enclosed/dynamic forms fail instead of becoming raw text.
  const SupportsValue = node(
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
  const SupportsFeature = node(
    'SupportsFeature',
    sequence(
      literal('('),
      g.Identifier,
      optional(sequence(literal(':'), g.SupportsValue)),
      literal(')')
    ),
    (children, _fields, _span, _rawChildren, _triviaLog, state) => {
      const property = keyword(requireToken(children[1]).value);
      const value = children.find(isValueNode);
      return value === undefined
        ? block(property)
        : block(operation(':', property, value, false, lessMathOutsideParens(state, ':')));
    }
  );
  const SupportsInParens = node(
    'SupportsInParens',
    choice(
      sequence(literal('('), g.SupportsCondition, literal(')')),
      g.SupportsFeature,
      g.Enclosed
    ),
    children => children.length === 1
      ? requireValueNode(children[0])
      : block(requireValueNode(children[1]))
  );
  const SupportsCondition = node(
    'SupportsCondition',
    choice(
      sequence(g.QueryNot, g.SupportsInParens),
      sequence(g.SupportsInParens, many(sequence(g.QueryAndOr, g.SupportsInParens)))
    ),
    (children) => {
      const values = children.map(child => isValueNode(child)
        ? child
        : keyword(requireToken(child).value));
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const SupportsBlock = node(
    'SupportsBlock',
    sequence(
      g.SupportsAtKeyword,
      choice(g.AtRuleInterpolation, g.BareVariableInterpolation, g.SupportsCondition),
      literal('{'),
      g.blockBody,
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
  const QueryKeyword = node(
    'Keyword',
    routed(),
    children => keyword(requireToken(children[0]).value)
  );
  const QueryIdentOrFunction = dispatch(
    queryIdentOrFunction,
    caseOf('calc(', g.CalcFunction),
    when(
      endsWith('('),
      g.GenericFunction
    ),
    otherwise(QueryKeyword)
  );
  const queryLeaf = choice(g.VariableReferenceChain, g.Dimension, g.Color, g.LiteralQuoted, QueryIdentOrFunction);
  // Media/container query syntax shares CSS's grammar-owned comparison terminal
  // and canonical `Block(paren, Operation)` shape. Less only supplies the additional
  // variable-bearing value leaves; it does not capture a query prelude as raw
  // text or run a second scanner over it.
  const QueryValue = node(
    'QueryValue',
    choice(g.PreservedDivision, g.queryLeaf),
    children => requireValueNode(children[0])
  );
  // A media/container feature value may be a `<ratio>` — media-queries-4 §2.1,
  // `<number> [ / <number> ]?` — as in `(aspect-ratio >= 16/9)`. The colon form
  // already folds that slash into a typed `/` Operation through its math value;
  // the comparison and range forms took the value-position leaf, where Less's
  // `parens-division` slash group turned the same ratio into a Sequence. Fold
  // it here so every feature form — and every dialect — carries one ratio shape.
  // `style(--x: …)` keeps QueryValue above: that payload is a
  // declaration, so its slash stays a value-position slash group.
  const QueryFeatureValue = node(
    'QueryFeatureValue',
    sequence(g.queryLeaf, many(sequence(literal('/'), g.queryLeaf))),
    foldOperation
  );
  const QueryBareFeature = node(
    'QueryBareFeature',
    sequence(literal('('), g.Identifier, literal(')')),
    children => block(keyword(requireToken(children[1]).value))
  );
  const QueryComparisonFeature = node(
    'QueryComparisonFeature',
    sequence(
      literal('('), g.Identifier, g.QueryComparisonOperator, g.QueryFeatureValue,
      optional(sequence(g.QueryComparisonOperator, g.QueryFeatureValue)), literal(')')
    ),
    (children, _fields, _span, _rawChildren, _triviaLog, state) => {
      const values = children.filter(isValueNode);
      const operators = queryComparisonOperators(children);
      if (values.length < 1 || operators.length < 1) {
        throw new TypeError('Less query comparison lost a value or operator.');
      }
      let comparison = operation(operators[0]!, keyword(requireToken(children[1]).value), values[0]!, false,
        lessMathOutsideParens(state, operators[0]!));
      if (operators.length === 2) {
        if (values[1] === undefined) {
          throw new TypeError('Less chained query comparison lost its final value.');
        }
        comparison = operation(operators[1]!, comparison, values[1], false,
          lessMathOutsideParens(state, operators[1]!));
      }
      return block(comparison);
    }
  );
  const QueryRangeFeature = node(
    'QueryRangeFeature',
    sequence(
      literal('('), g.QueryFeatureValue, g.QueryComparisonOperator, g.Identifier,
      optional(sequence(g.QueryComparisonOperator, g.QueryFeatureValue)), literal(')')
    ),
    (children, _fields, _span, _rawChildren, _triviaLog, state) => {
      const values = children.filter(isValueNode);
      const operators = queryComparisonOperators(children);
      if (values.length < 1 || operators.length < 1) {
        throw new TypeError('Less query range lost a value or operator.');
      }
      let comparison = operation(operators[0]!, values[0]!, keyword(requireToken(children[3]).value), false,
        lessMathOutsideParens(state, operators[0]!));
      if (operators.length === 2) {
        if (values[1] === undefined) {
          throw new TypeError('Less chained query range lost its final value.');
        }
        comparison = operation(operators[1]!, comparison, values[1], false,
          lessMathOutsideParens(state, operators[1]!));
      }
      return block(comparison);
    }
  );
  // Container queries permit parenthesized boolean groups, for example
  // `((width < 500px) or (height < 500px))`. The individual features retain
  // their existing typed Block(paren, Operation) representation inside the group.
  const QueryLogicalGroup = node(
    'QueryLogicalGroup',
    sequence(literal('('), g.QueryFeature, oneOrMore(sequence(g.QueryAndOr, g.QueryFeature)), literal(')')),
    children => block(spaced(children.filter(child => isValueNode(child) ? true : isTerminalText(child, 'and') || isTerminalText(child, 'or')).map(keywordOrValue)))
  );
  // Container queries permit a nested negated condition, for example
  // `(not (height > 670px))`. It is a parenthesized structural query fact,
  // not an opaque at-rule header.
  const QueryNegatedFeature = node(
    'QueryNegatedFeature',
    sequence(literal('('), g.QueryNot, g.QueryFeature, literal(')')),
    children => block(spaced([keyword(requireToken(children[1]).value), requireValueNode(children[2])]))
  );
  const QueryFeature = node(
    'QueryFeature',
    choice(QueryBareFeature, g.QueryColonFeature, QueryComparisonFeature, QueryRangeFeature, QueryLogicalGroup, QueryNegatedFeature),
    children => requireValueNode(children[0])
  );
  // `only` is a media/query modifier, not an ordinary media-type keyword.
  const QueryNonOnlyKeyword = node(
    'QueryNonOnlyKeyword',
    sequence(not(g.QueryOnly), g.Keyword),
    children => requireKeyword(children.at(-1))
  );
  const QueryTerm = node(
    'QueryTerm',
    choice(
      // A namespace/map read is a whole query term only after its required
      // accessor has succeeded; otherwise ordinary colors and mixin prefixes
      // continue to the existing query alternatives.
      attempt(g.MixinReference),
      g.QueryFeature,
      g.VariableReference,
      g.QueryNonOnlyKeyword
    ),
    children => requireValueNode(children[0])
  );
  const QueryOnlyClause = node(
    'QueryOnlyClause',
    sequence(
      g.QueryOnly,
      g.QueryNonOnlyKeyword,
      many(sequence(g.QueryAndOr, g.QueryTerm))
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => spacedFromValueChildren(children, triviaLog, state)
  );
  // Gating note: `only` and ordinary query terms share the keyword first set.
  // `QueryNonOnlyKeyword` already rejects `only` in the generic branch; a
  // dispatch wrapper would mostly restate that negative guard without removing
  // the media/container semantic split.
  const QueryClause = node(
    'QueryClause',
    choice(
      QueryOnlyClause,
      sequence(
        g.QueryTerm,
        many(sequence(g.QueryAndOr, g.QueryTerm))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => queryClauseReducer(children, triviaLog, state)
  );
  const QueryPrelude = node(
    'QueryPrelude',
    oneOrMoreSep(
      g.QueryClause,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields, _span, rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueNode, rawChildren)
  );
  // Less permits a variable interpolation as an ordinary `@media` query term:
  // `@media @{all} and @{tv}`. That is not a container-query form, so retain
  // the stricter shared query prelude used by `@container` and construct this
  // media-only typed sequence from the same structural leaves.
  const MediaQueryTerm = node(
    'MediaQueryTerm',
    choice(g.AtRuleInterpolation, g.BareVariableInterpolation, g.QueryTerm),
    children => requireValueNode(children[0])
  );
  const MediaQueryOnlyClause = node(
    'MediaQueryOnlyClause',
    sequence(
      g.QueryOnly,
      g.QueryNonOnlyKeyword,
      many(sequence(g.QueryAndOr, g.MediaQueryTerm))
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => spacedFromValueChildren(children, triviaLog, state)
  );
  const MediaQueryNotClause = node(
    'MediaQueryNotClause',
    sequence(
      g.QueryNot,
      g.MediaQueryTerm,
      many(sequence(g.QueryAndOr, g.MediaQueryTerm))
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => spacedFromValueChildren(children, triviaLog, state)
  );
  const MediaQueryClause = node(
    'MediaQueryClause',
    choice(
      MediaQueryOnlyClause,
      MediaQueryNotClause,
      sequence(
        g.MediaQueryTerm,
        many(sequence(g.QueryAndOr, g.MediaQueryTerm))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => queryClauseReducer(children, triviaLog, state)
  );
  const MediaQueryPrelude = node(
    'MediaQueryPrelude',
    oneOrMoreSep(
      MediaQueryClause,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields, _span, rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueNode, rawChildren)
  );
  // A style query is a real typed container-header function. Its argument is a
  // structural custom-property comparison rather than an opaque header slice.
  const styleFunctionOpener = token(noTrivia(sequence(word(
    'style',
    '-_a-zA-Z0-9\\u0080-\\uFFFF',
    { caseInsensitive: true }
  ), literal('('))));
  const scrollStateFunctionOpener = token(noTrivia(sequence(word(
    'scroll-state',
    '-_a-zA-Z0-9\\u0080-\\uFFFF',
    { caseInsensitive: true }
  ), literal('('))));
  const ContainerStyleQuery = node(
    'ContainerStyleQuery',
    sequence(styleFunctionOpener, g.CustomPropertyToken, literal(':'), g.QueryValue, literal(')')),
    (children, _fields, _span, _rawChildren, _triviaLog, state) =>
      funcCall(functionNameFromOpener(children[0]), [operation(':', keyword(requireToken(children[1]).value),
        requireValueNode(children[3]), false, lessMathOutsideParens(state, ':'))])
  );
  const ContainerScrollStateQuery = node(
    'ContainerScrollStateQuery',
    sequence(scrollStateFunctionOpener, g.Identifier, literal(':'), g.QueryValue, literal(')')),
    (children, _fields, _span, _rawChildren, _triviaLog, state) =>
      funcCall(functionNameFromOpener(children[0]), [operation(':', keyword(requireToken(children[1]).value),
        requireValueNode(children[3]), false, lessMathOutsideParens(state, ':'))])
  );
  const ContainerName = node(
    'ContainerName',
    sequence(
      not(word(
        'none',
        '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\',
        { caseInsensitive: true }
      )),
      not(g.QueryNot),
      not(g.QueryAndOr),
      g.Keyword
    ),
    children => requireKeyword(children.at(-1))
  );
  const ContainerQueryAtom = node(
    'ContainerQueryAtom',
    choice(
      g.ContainerStyleQuery,
      g.ContainerScrollStateQuery,
      g.QueryFeature
    ),
    children => requireValueNode(children[0])
  );
  const ContainerCondition = node(
    'ContainerCondition',
    choice(
      sequence(
        g.QueryNot,
        g.ContainerQueryAtom
      ),
      sequence(
        g.ContainerQueryAtom,
        many(sequence(
          g.QueryAndOr,
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
  const ContainerConditionItem = node(
    'ContainerConditionItem',
    choice(
      g.BareVariableInterpolation,
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
  const ContainerQueryPrelude = node(
    'ContainerQueryPrelude',
    oneOrMoreSep(
      ContainerConditionItem,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields, _span, rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueNode, rawChildren)
  );
  // Media and container headers differ, but their child statement language is
  // one shared grammar production. Keep it shared so a valid nested Less
  // construct cannot become valid in one conditional at-rule but not the other.
  const MediaContainerBody = node(
    'MediaContainerBody',
    sequence(
      literal('{'),
      g.blockBody,
      optional(g.Call),
      literal('}')
    ),
    children => children.filter(isStatement)
  );
  const MediaContainerBlock = node(
    'QueryAtRuleBlock',
    dispatch(
      token(noTrivia(g.MediaContainerAtKeyword)),
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
  // Keyframes use the existing canonical AtRuleBlock + Ruleset shape. Keeping the
  // header and selector list structural avoids routing valid CSS keyframes
  // through the generic Less at-rule/ruleset combination, which cannot model
  // percentage selectors as selector facts.
  // Gating note: block entries overlap on ident-led declarations and
  // function-call statements. The shared prefix is the property/call name, but
  // the deciding delimiter is `:` versus `(` / `;`, so a cosmetic dispatch on
  // the identifier would commit too early.
  const KeyframeSelector = node(
    'SimpleSelector',
    choice(keyframeEndpoint, g.Percentage),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const KeyframeBlock = node(
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
        .map(selector => selector);
      if (selectors.length === 0) {
        throw new TypeError('Less keyframe block requires a selector.');
      }
      return withSourceSpan(
        withBlockBody(rule(selist(...selectors), children.filter(isStatement)), rawChildren),
        span
      );
    }
  );
  const Keyframes = node(
    'Keyframes',
    sequence(
      g.KeyframesAtKeyword,
      field('prelude', choice(g.AtRuleInterpolation, g.BareVariableInterpolation, g.EscapedQuoted, g.LiteralQuoted, g.Keyword)),
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
  const DottedAtRuleKeyword = node(
    'DottedAtRuleKeyword',
    sequence(staticIdentifier, oneOrMore(sequence(noTrivia(literal('.')), noTrivia(staticIdentifier)))),
    children => keyword(children.map(requireTerminalText).join(''))
  );
  const atRulePreludeCustomProperty = node(
    'AtRulePreludeValueCustomProperty',
    g.CustomPropertyToken,
    children => keyword(requireToken(children[0]).value)
  );
  const atRulePreludeIdentOrFunction = token(noTrivia(sequence(staticIdentifier, optional(literal('(')))));
  const AtRulePreludeKeyword = node(
    'Keyword',
    routed(),
    children => keyword(requireToken(children[0]).value)
  );
  const AtRulePreludeIdentOrFunction = dispatch(
    atRulePreludeIdentOrFunction,
    caseOf('url(', RoutedPlainUrl),
    caseOf('calc(', g.CalcFunction),
    when(endsWith('('), g.GenericFunction),
    otherwise(AtRulePreludeKeyword)
  );
  // Generic at-rule headers have no parser-owned syntax-preserving evaluation
  // model for interpolation or parenthesized forms. Their direct subset stays
  // static; `@layer` gets its own typed interpolation alternative below.
  const AtRulePreludeValueAtom = node(
    'AtRulePreludeValueAtom',
    choice(
      g.EscapedQuoted,
      g.LiteralQuoted,
      g.Color,
      g.Dimension,
      g.PagePseudo,
      g.Paren,
      g.DottedAtRuleKeyword,
      atRulePreludeCustomProperty,
      AtRulePreludeIdentOrFunction
    ),
    children => requireValueNode(children[0])
  );
  const AtRulePreludeValueTerm = node(
    'AtRulePreludeValueTerm',
    oneOrMore(g.AtRulePreludeValueAtom),
    (children) => {
      const values = children.map(requireValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const AtRulePreludeValue = node(
    'AtRulePreludeValue',
    oneOrMoreSep(
      g.AtRulePreludeValueTerm,
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
    token(balanced(
      '(',
      ')'
    )),
    token(balanced(
      '[',
      ']'
    ))
  ));
  const atPreludeQuoted = noTrivia(choice(
    scanSkipDoubleString,
    scanSkipSingleString
  ));
  const atPreludeText = noTrivia(regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/@ \t\n\r\f,;{}()[\]"'])+/));
  const AtRulePrelude = node(
    'AtRulePrelude',
    parser(
      { trivia: atPreludeCommentTrivia },
      many(choice(
        atPreludeWhitespace,
        atPreludeComma,
        atPreludeGroup,
        atPreludeQuoted,
        g.BareVariableInterpolation,
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
    g.BareVariableInterpolation,
    lessOpaqueAtPreludeText
  ));
  // CSS-defined statement at-rules have grammar-owned interpolation forms that
  // the generic at-rule subset intentionally does not accept. Keep the
  // namespace prefix and URI as ordinary typed values; this preserves
  // `@namespace @{prefix} "…"` without widening unknown at-rules such as
  // `@custom foo@{name};` into a raw/recovered-header path.
  // Gating note: `url(` overlaps the URI-only arm with an identifier-prefixed
  // namespace in the analyzer, but the glued `url(` delimiter belongs to
  // `PlainUrl`; dispatching on bare `url` would lose that distinction.
  const NamespacePrelude = node(
    'NamespacePrelude',
    choice(
      g.PlainUrl,
      g.Quoted,
      sequence(
        choice(g.AtRuleInterpolation, g.Keyword),
        choice(g.Quoted, g.PlainUrl)
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
    g.blockBody,
    optional(g.Call),
    literal('}')
  );
  const genericAtRuleBlockTail = choice(
    attempt(sequence(
      // Generic headers serialize as ordinary bytes. Their interpolation and
      // parenthesized forms need a dedicated syntax-preserving model, so this
      // This route deliberately leaves them closed.
      attempt(g.AtRulePreludeValue),
      atRuleBlockBody
    )),
    sequence(
      not(regex(/[ \t\n\r\f]*:/)),
      g.AtRulePrelude,
      atRuleBlockBody
    )
  );
  const AtRuleBlock = node(
    'AtRuleBlock',
    choice(
      sequence(
        layerAtRuleName,
        not(noTrivia(literal('('))),
        optional(choice(g.BareVariableInterpolation, g.InterpolatedValue, g.AtRulePreludeValue)),
        atRuleBlockBody
      ),
      sequence(
        g.AtRuleName,
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
  const OpaqueAtPrelude = node(
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
  const OpaqueBody = node(
    'OpaqueBody',
    lessOpaqueBodyCapture,
    children => children.length === 0 ? '' : staticText(children)
  );
  /*
   * The at-rule names Less routes to a TYPED production, in one place. Every
   * name here is defined by the leaf that also matches it positively -- Less's
   * own compiler namespace plus cssSyntax's shared CSS leaves -- so the
   * positive form (`CustomValueAtKeyword`) and the two negative forms below
   * cannot drift. This replaced three hand-spelled copies of the same set.
   */
  const CustomValueAtKeyword = token(noTrivia(choice(
    lessOwnAtKeyword,
    g.ImportAtKeyword,
    g.ConditionalAtKeyword,
    g.KeyframesAtKeyword
  )));
  const StaticAtRuleStatementName = token(noTrivia(sequence(
    not(CustomValueAtKeyword),
    g.AtIdentifierUnescaped
  )));
  const AtRuleName = token(noTrivia(sequence(
    not(CustomValueAtKeyword),
    not(g.LayerAtKeyword),
    g.AtIdentifierUnescaped
  )));
  const OpaqueAtRuleBlock = node(
    'OpaqueAtRuleBlock',
    sequence(
      g.AtRuleName,
      not(regex(/[ \t\n\r\f]*:/)),
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
  const CharsetStatement = node(
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
    node(
      'AtRuleStatement',
      dispatch(
        g.StaticAtRuleStatementName,
        caseOf('@namespace', sequence(routed(), g.NamespacePrelude, literal(';'))),
        caseOf(
          '@layer',
          sequence(
            routed(),
            not(noTrivia(literal('('))),
            optional(choice(g.BareVariableInterpolation, g.InterpolatedValue, g.AtRulePreludeValue)),
            literal(';')
          )
        ),
        otherwise(sequence(
          routed(),
          choice(
            attempt(sequence(
              g.AtRulePreludeValue,
              literal(';')
            )),
            sequence(
              not(regex(/[ \t\n\r\f]*:/)),
              g.AtRulePrelude,
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
  const NthPseudoArgument = node(
    'NthChildArgument',
    sequence(
      g.NthExpression,
      optional(sequence(g.NthOfKeyword, parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentSelector)))
    ),
    (children) => {
      const nth = requireToken(children[0]).value;
      const selector = children.find(isSelectorList);
      return selector === undefined ? nth : `${nth} of ${selector.selectors.map(selectorBranchCanonical).join(',')}`;
    }
  );
  const NthPseudoSelector: Combinator<SimpleSelector> = choice(
    node(
      'NthChildPseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(
        token(noTrivia(sequence(pseudoDelimiter, g.NthChildPseudoSelectorName, literal('(')))),
        g.NthPseudoArgument,
        literal(')')
      )),
      children => simpleSelector(`${requireToken(children[0]).value}${requireString(children[1])})`)
    ),
    node(
      'NthTypePseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(
        token(noTrivia(sequence(pseudoDelimiter, g.NthTypePseudoSelectorName, literal('(')))),
        g.NthExpression,
        literal(')')
      )),
      children => simpleSelector(`${requireToken(children[0]).value}${requireToken(children[1]).value})`)
    )
  );
  // Less permits a variable interpolation as an An+B argument (`:nth-child(@{n})`).
  // Keep the pseudo delimiter/name, variable reference, and closing delimiter as
  // typed interpolation segments; no raw selector recovery or second parse is
  // needed when the value is substituted during evaluation.
  const InterpolatedNthPseudo = node(
    'InterpolatedNthPseudo',
    parser({ trivia: staticSelectorTrivia }, sequence(
      token(noTrivia(sequence(pseudoDelimiter, choice(g.NthChildPseudoSelectorName, g.NthTypePseudoSelectorName), literal('(')))),
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
  // the PseudoSelector route it already had.
  const InterpolatedArgumentPseudo = node(
    'InterpolatedArgumentPseudo',
    parser({ trivia: staticSelectorTrivia }, sequence(
      token(noTrivia(sequence(
        pseudoDelimiter,
        not(extendPseudoNameOpen),
        g.LessIdentifier,
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
  const pseudoArgumentInner = choice(g.PseudoArgumentGroup, g.LiteralQuoted, staticPseudoChunk);
  const PseudoArgumentGroup = node(
    'PseudoArgumentGroup',
    parser({ trivia: staticSelectorTrivia }, choice(
      sequence(literal('('), many(g.pseudoArgumentInner), literal(')')),
      sequence(literal('['), many(g.pseudoArgumentInner), literal(']'))
    )),
    (children, _fields, _span, _rawChildren, triviaLog) => staticTextWithTriviaGaps(children, triviaLog)
  );
  const PseudoArgumentText = node(
    'PseudoArgumentText',
    parser({ trivia: staticSelectorTrivia }, oneOrMore(g.pseudoArgumentInner)),
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
  // `args`; `PseudoSelector` joins the opaque `:global`/`:local`
  // fallback via `selectorBranchCanonical`. The parser never bakes the inline
  // `:is(a, b)` spelling — core serialization owns that.
  const pseudoSelectorArgument = node(
    'PseudoSelectorArgument',
    parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentSelector),
    children => requireSelectorList(children[0])
  );
  // This selector family is private to functional pseudo arguments.  A block
  // comment immediately between two simple selectors is lexical trivia, not a
  // descendant relation (`.a/*x*/.b` is one compound); actual whitespace still
  // belongs to the complex-tail descendant boundary.
  const PseudoArgumentCompound = node(
    'PseudoArgumentCompound',
    parser(
      { trivia: compoundSelectorTrivia },
      oneOrMore(choice(g.NamespaceTypeSelector, staticSimpleSelector, staticAmpersand, g.PseudoSelector, g.NthPseudoSelector, g.AttributeSelector))
    ),
    children => selectorTermFromTokens(children.map((child) => {
      return isSimpleToken(child) ? child : simpleSelector(requireToken(child).value);
    }))
  );
  // This selector family is private to functional pseudo arguments.  Its tail
  // admits Less selector trivia immediately before the next compound, so
  // `.a /* note */ > /* note */ .b` remains one structured complex selector.
  // The ordinary outer selector folds its combinator tail inline (there is no
  // `ComplexTail` node), and its no-trivia compound boundary is intentionally
  // unchanged.
  const PseudoArgumentComplex = node(
    'PseudoArgumentComplex',
    sequence(
      optional(relativeSelectorCombinator),
      g.PseudoArgumentCompound,
      many(sequence(not(whenGuardAhead), optional(staticCombinator), parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentCompound)))
    ),
    (children) => {
      const first = children[0];
      const leading = (isTerminalText(first, '>') || isTerminalText(first, '+') || isTerminalText(first, '~')) ? first : undefined;
      const branch = selectorBranchOf(complexSegmentsFrom(children));
      return leading === undefined ? branch : relativeSelector(requireCombinator(leading), branchSegments(branch));
    }
  );
  const PseudoArgumentSelectorTail = node(
    'PseudoArgumentSelectorTail',
    sequence(literal(','), parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentComplex)),
    children => children.find(isSelectorBranch)!
  );
  const PseudoArgumentSelector = node(
    'PseudoArgumentSelector',
    sequence(g.PseudoArgumentComplex, many(g.PseudoArgumentSelectorTail)),
    children => selist(...selectorBranchesFrom(children))
  );
  // `*[ … ]` is only the glued capture delimiter around the existing static
  // selector-list grammar. It is a selector-valued Less value, not a text
  // capture: the selector grammar owns every branch boundary and the AST keeps
  // the canonical branches for selector interpolation.
  const SelectorCapture = node(
    'SelectorCapture',
    sequence(noTrivia(literal('*[')), parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentSelector), noTrivia(literal(']'))),
    (children) => {
      const selector = requireSelectorList(children[1]);
      const branches = selector.selectors.map(selectorBranchCanonical);
      return selectorCapture(branches, `*[${branches.join(', ')}]`);
    }
  );
  const pseudoOpen = token(noTrivia(sequence(
    regex(/::?(?![ \t\n\r\f])/),
    not(extendPseudoNameOpen),
    not(g.NthPseudoSelectorName),
    g.LessIdentifier,
    optional(literal('('))
  )));
  const pseudoSelectorRouted = node(
    'PseudoSelector',
    sequence(routed(), pseudoSelectorArgument, literal(')')),
    children => staticSelectorPseudoFrom(
      requireToken(children[0]).value.slice(0, -1),
      children[1]
    )
  );
  const interpolatedArgumentPseudoRouted = node(
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
  const staticNonSelectorPseudoRouted = node(
    'GenericPseudo',
    sequence(routed(), g.PseudoArgumentText, literal(')')),
    children => staticNonSelectorPseudoFrom(
      requireToken(children[0]).value.slice(0, -1),
      requireString(children[1])
    )
  );
  const staticBarePseudoRouted = node(
    'GenericPseudo',
    routed(),
    children => staticNonSelectorPseudoFrom(requireToken(children[0]).value, null)
  );
  const pseudo = dispatch(
    pseudoOpen,
    caseOf(
      [':is(', '::is(', ':not(', '::not(', ':has(', '::has(', ':where(', '::where(', ':matches(', '::matches(', ':global(', '::global(', ':local(', '::local('],
      choice(pseudoSelectorRouted, interpolatedArgumentPseudoRouted)
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
      pseudoSelectorRouted
    ),
    when(
      endsWith('('),
      staticNonSelectorPseudoRouted
    ),
    otherwise(staticBarePseudoRouted)
  );
  const PseudoSelector = node(
    'PseudoSelector',
    staticPseudoDispatch,
    children => children.find(isSimpleToken)!
  );
  // A Less pseudo name may itself be interpolated (`:@{pseudo}` / `::@{pseudo}`)
  // and remains one interpolation-backed selector atom. Keep the delimiter and
  // interpolation structural so evaluation can substitute the name without a
  // selector-string reparse.
  const InterpolatedPseudo = node(
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
  const AttributeNamespace = node(
    'AttributeNamespace',
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
  const NamespaceTypeSelector = node(
    'NamespaceTypeSelector',
    sequence(g.AttributeNamespace, choice(staticIdentifier, literal('*'))),
    children => simpleSelector(children.map(requireTerminalText).join(''))
  );
  const AttributeName = node(
    'AttributeName',
    sequence(optional(g.AttributeNamespace), staticIdentifier),
    children => ({
      namespace: children.find((child): child is string => typeof child === 'string') ?? '',
      name: requireToken(children.at(-1)).value
    })
  );
  // Less's attribute name/value interpolation is one complete selector token.
  // Keep every literal delimiter and every interpolation reference (`@{…}` and
  // `${…}`) as an `Interpolation` part rather than recovering the bracket text
  // after parsing. Dynamic pseudos and extend headers remain separate, rejected forms.
  // Attribute name and value interpolation share one grammar body; the reducers
  // differ only by whether each reference part is unquoted (name) or kept quoted
  // (value, so `[data=@{value}]` retains its source spelling).
  const attributeInterpolationTokenBody = noTrivia(sequence(
    optional(choice(g.InterpolatedValueStart, g.InterpolatedValueDash)),
    g.Interpolation,
    many(g.interpolatedValueTail)
  ));
  const InterpolatedAttributeToken = node(
    'InterpolatedAttributeToken',
    attributeInterpolationTokenBody,
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const InterpolatedAttributeValueToken = node(
    'InterpolatedAttributeValueToken',
    attributeInterpolationTokenBody,
    children => interpolation(interpolationPartsFrom(children, false))
  );
  const InterpolatedAttributeQuoted = node(
    'InterpolatedAttributeQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.VariableInterpolation, g.QuotedDoubleText, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.VariableInterpolation, g.QuotedSingleText, literal('@'), literal('$'))), literal('\'')))
    ),
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const AttributeMatch = node(
    'AttributeMatch',
    sequence(
      g.AttributeOperator,
      choice(staticIdentifier, g.LiteralQuoted),
      optional(g.AttributeModifier)
    ),
    children => ({
      operator: requireToken(children[0]).value,
      value: staticText(children[1]),
      modifier: children.length === 2 ? null : requireToken(children[2]).value
    })
  );
  /*
   * Inside `[` … `]` whitespace is trivia, exactly as it is in the CSS base.
   * selectors-4 §6 puts optional whitespace on both sides of the matcher and
   * before the modifier, so `[data-x = y i]` is valid CSS and every superset
   * must accept it. The separation of the unquoted value from the modifier is
   * carried by ident tokenization — `[a=yi]` is one greedy `staticIdentifier`,
   * `[a=y i]` is two — not by a mandatory whitespace terminal, which is what
   * rejected the spaced spellings. The `[` itself keeps the ambient compound
   * trivia, so a comment before it still joins one compound and `a [b]` stays
   * a descendant relation.
   */
  const AttributeSelector = node(
    'AttributeSelector',
    sequence(
      literal('['),
      parser(
        { trivia: staticSelectorTrivia },
        sequence(g.AttributeName, optional(g.AttributeMatch), literal(']'))
      )
    ),
    (children) => {
      const match = children.find((child): child is AttributeMatchFact =>
        typeof child === 'object' && child !== null && 'operator' in child && 'value' in child && 'modifier' in child
      );
      const name = children.find((child): child is AttributeNameFact =>
        typeof child === 'object' && child !== null && 'namespace' in child && 'name' in child
      );
      if (name === undefined) {
        throw new TypeError('Less grammar produced an attribute selector without a name.');
      }
      return simpleSelector(`[${name.namespace}${name.name}${match === undefined ? '' : `${match.operator}${match.value}${match.modifier === null ? '' : ` ${match.modifier}`}`}]`);
    }
  );
  const InterpolatedAttributeSelector = node(
    'InterpolatedAttributeSelector',
    sequence(
      literal('['),
      choice(
        sequence(
          optional(g.AttributeNamespace),
          g.InterpolatedAttributeToken,
          optional(sequence(
            g.AttributeOperator,
            choice(g.InterpolatedAttributeValueToken, g.InterpolatedAttributeQuoted, g.LessIdentifier, g.LiteralQuoted),
            optional(sequence(selectorAttributeModifierSpace, g.AttributeModifier))
          ))
        ),
        sequence(
          g.AttributeName,
          g.AttributeOperator,
          choice(g.InterpolatedAttributeValueToken, g.InterpolatedAttributeQuoted),
          optional(sequence(selectorAttributeModifierSpace, g.AttributeModifier))
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
        } else if (isAttributeNameFact(child)) {
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
  const BareInterpolatedSelector = node(
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
  const AdjacentInterpolatedSelector = node(
    'AdjacentInterpolatedSelector',
    noTrivia(sequence(g.VariableInterpolation, oneOrMore(g.VariableInterpolation))),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  // A bare interpolation may be followed by a glued selector simple, such as
  // `@{base}.bbb`. Keep that suffix as an interpolation literal segment rather
  // than recovering a completed selector string after parse.
  const BareInterpolatedSelectorWithSuffix = node(
    'BareInterpolatedSelectorWithSuffix',
    noTrivia(sequence(g.VariableInterpolation, oneOrMore(choice(interpolatedSelectorTail, staticSimpleSelector)))),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  const InterpolatedSimpleSelector = node(
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
  const InterpolatedParentSuffix = node(
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
    g.NamespaceTypeSelector,
    staticSimpleSelector,
    staticAmpersand,
    // Generic and selector pseudos (`:hover`, `::before`, `:not(...)`) dominate
    // real selectors; the two nth arms and the interpolated-name arm are rare.
    // PseudoSelector carries the generic/selector case and is name-set
    // disjoint from the other three — its NonSelectorPseudo `not(nth-name)` /
    // `not(selector-name)` guards and its SelectorPseudo name regex mean it can
    // never match an nth pseudo or an interpolated-name pseudo (`:@{n}`). So
    // trying it first lets the common pseudo commit on the first arm instead of
    // paying four failed `::?`+name re-scans through the nth/interp arms, while a
    // rare nth/interp pseudo still falls through to its arm with output and PEG
    // priority unchanged.
    pseudo,
    g.InterpolatedNthPseudo,
    g.NthPseudoSelector,
    g.InterpolatedArgumentPseudo,
    g.InterpolatedPseudo,
    g.AttributeSelector,
    g.InterpolatedAttributeSelector
  );
  /*
   * Statement-position class/id starts share their parsed selector prefix with
   * mixin paths. `(` and `;` later select the mixin tails; selector punctuation
   * continues from this same branch. The first simple is deliberately the
   * class/id-only mixin name, while the rest of the compound and complex path
   * retain the ordinary selector productions and their exact AST structure.
   */
  const ClassIdCompound = node(
    'CompoundSelector',
    parser({ trivia: compoundSelectorTrivia }, sequence(mixinName, many(compoundSimple))),
    children => selectorTermFromTokens(children.map((child) => {
      return isSimpleToken(child) ? child : simpleSelector(requireToken(child).value);
    }))
  );
  const ClassIdSelectorPrefix = node(
    'SelectorBranch',
    sequence(
      ClassIdCompound,
      many(sequence(not(whenGuardAhead), optional(staticCombinator), g.CompoundSelector))
    ),
    (children, _fields, span) => ({
      selector: withSourceSpan(selectorBranchOf(complexSegmentsFrom(children)), span),
      extensions: []
    })
  );
  const CompoundSelector: Combinator<SelectorTerm> = node(
    'CompoundSelector',
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
      return selectorTermFromTokens(simples);
    }
  );
  const ComplexSelector = node(
    'ComplexSelector',
    sequence(
      g.CompoundSelector,
      many(sequence(not(whenGuardAhead), optional(staticCombinator), g.CompoundSelector))
    ),
    (children, _fields, span) => withSourceSpan(selectorBranchOf(complexSegmentsFrom(children)), span)
  );
  const RelativeComplex = node(
    'RelativeComplexSelector',
    sequence(
      optional(relativeSelectorCombinator),
      g.ComplexSelector
    ),
    (children, _fields, span) => {
      const branch = children.find(isSelectorBranch)!;
      const leading = children.find(child => isTerminalText(child, '>') || isTerminalText(child, '+') || isTerminalText(child, '~'));
      return withSourceSpan(leading === undefined ? branch : relativeSelector(requireCombinator(leading), branchSegments(branch)), span);
    }
  );
  const SelectorList = node(
    'SelectorList',
    parser({ trivia: outerSelectorTrivia }, oneOrMoreSep(g.ComplexSelector, literal(','))),
    (children, _fields, span) => withSourceSpan(selist(...selectorBranchesFrom(children)), span)
  );
  const RelativeSelector = node(
    'SelectorList',
    parser({ trivia: outerSelectorTrivia }, sequence(g.RelativeComplex, many(sequence(literal(','), g.ComplexSelector)))),
    (children, _fields, span) => withSourceSpan(selist(...selectorBranchesFrom(children)), span)
  );
  const extendAllFlag = regex(/!?all(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const InlineExtendSubjectCompound = node(
    'InlineExtendSubjectCompound',
    parser(
      { trivia: compoundSelectorTrivia },
      oneOrMore(choice(g.NamespaceTypeSelector, staticSimpleSelector, staticAmpersand, pseudo, g.NthPseudoSelector, g.AttributeSelector))
    ),
    children => selectorTermFromTokens(children.map(child => isSimpleToken(child) ? child : simpleSelector(requireToken(child).value)))
  );
  const InlineExtendSubjectComplexTail = node(
    'InlineExtendSubjectComplexTail',
    sequence(optional(staticCombinator), InlineExtendSubjectCompound),
    combinatorTailReducer
  );
  const ExtendComplex = node(
    'ComplexSelector',
    sequence(
      InlineExtendSubjectCompound,
      many(sequence(not(regex(/[ \t\n\r\f]*!?all(?=[ \t\n\r\f]*(?:,|\)))/i)), InlineExtendSubjectComplexTail))
    ),
    (children, _fields, span) => withSourceSpan(selectorBranchOf([
      { term: children.find(isSelectorTerm)! },
      // The terminal-flag lookahead is a recognition-only child. Keep only
      // actual tail facts: otherwise the successful stop check is emitted as
      // a fake descendant tail with no compound.
      ...children.slice(1).filter(isComplexTailFact)
    ]), span)
  );
  const ExtendTargetComplex = node(
    'ComplexSelector',
    sequence(
      // An extend target can carry a typed selector interpolation, unlike its
      // inline subject. Keep `.@{name}` in the AST rather than rescanning it.
      g.CompoundSelector,
      many(sequence(not(regex(/[ \t\n\r\f]*!?all(?=[ \t\n\r\f]*(?:,|\)))/i)), optional(staticCombinator), g.CompoundSelector))
    ),
    (children, _fields, span) => withSourceSpan(selectorBranchOf(complexSegmentsFrom(children)), span)
  );
  const ExtendTarget = node(
    'ExtendTarget',
    sequence(ExtendTargetComplex, optional(extendAllFlag)),
    children => ({
      target: selist(children.find(isSelectorBranch)!),
      partial: children.some(child => isTerminalText(child, 'all') || isTerminalText(child, '!all'))
    })
  );
  const ExtendPseudo = node(
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
  // A body-form `&:extend(...)` applies to the WHOLE carrying rule selector, so
  // its instructions carry no `subject` (see `ExtendInstruction`: absent subject
  // means whole-rule). That is the opposite of an inline `.a:extend(...)`, which
  // binds to its own branch. The two are indistinguishable as bare `{target,
  // partial}` arrays, so the body form reduces to its own fact instead; a ruleset
  // reducer that mixed them stamped the first branch onto every body extend and
  // silently dropped the rest of a comma list.
  const ExtendStatement = node(
    'ExtendStatement',
    sequence(literal('&'), ExtendPseudo, optional(literal(';'))),
    children => ({
      bodyExtensions: children
        .flatMap(child => Array.isArray(child) ? child.filter(isExtendTargetFact) : [])
        .map(target => ({ target: target.target, partial: target.partial }))
    })
  );
  const selectorBranchContinuation = choice(
    sequence(ExtendPseudo, selectorBranchBoundary),
    selectorBranchBoundary
  );
  const SelectorBranch = node(
    'SelectorBranch',
    sequence(ExtendComplex, selectorBranchContinuation),
    (children) => {
      const subject = children.find(isSelectorBranch)!;
      const extensions = children
        .filter(Array.isArray)
        .flatMap(child => child.filter(isExtendTargetFact))
        .map(target => ({ target: target.target, partial: target.partial, subject: selist(subject) }));
      return { selector: subject, extensions };
    }
  );
  const DynamicSelectorBranch = node(
    'SelectorBranch',
    g.ComplexSelector,
    children => ({ selector: children.find(isSelectorBranch)!, extensions: [] })
  );
  const selectorBranch = choice(SelectorBranch, DynamicSelectorBranch);
  const SelectorBranchTail = node(
    'SelectorBranch',
    sequence(literal(','), selectorBranch),
    (children) => {
      const branch = children.find(isSelectorBranchFact);
      if (branch === undefined) {
        throw new TypeError('Less selector list tail lost its selector branch.');
      }
      return branch;
    }
  );
  const selectorListWithExtends = node(
    'SelectorListWithExtends',
    parser(
      { trivia: outerSelectorTrivia },
      oneOrMoreSep(
        selectorBranch,
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
  const relativeSelectorListWithExtends = node(
    'SelectorListWithExtends',
    parser(
      { trivia: outerSelectorTrivia },
      oneOrMoreSep(
        choice(SelectorBranch, node(
          'SelectorBranch',
          g.RelativeComplex,
          children => ({ selector: children.find(isSelectorBranch)!, extensions: [] })
        )),
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
  const RulesetWithExtends = node(
    'Ruleset',
    sequence(selectorListWithExtends, optional(g.MixinGuard), literal('{'), rulesetBody, optional(g.Call), literal('}'), optional(literal(';'))),
    (children, _fields, span, rawChildren) => {
      const selectorFact = requireSelectorListWithExtendsFact(children[0]);
      const bodyExtensions = children.filter(isBodyExtendFact).flatMap(fact => fact.bodyExtensions);
      const extensions = [...selectorFact.extensions, ...bodyExtensions];
      const node = withBlockBody(
        rule(
          selectorFact.selector,
          // The fixed sequence places only direct declaration/comment facts between
          // the braces. This validates that fact list; it never reparses body text.
          requireRulesetBody(children.filter(isStatement)),
          extensions.length === 0 ? undefined : extensions,
          children.find(isMixinGuard)
        ),
        rawChildren
      );
      return hasRulesetTerminator(rawChildren) ? withSourceSpan(node, span) : node;
    }
  );
  const NestedRulesetWithExtends = node(
    'Ruleset',
    sequence(relativeSelectorListWithExtends, optional(g.MixinGuard), literal('{'), rulesetBody, optional(g.Call), literal('}'), optional(literal(';'))),
    (children, _fields, span, rawChildren) => {
      const selectorFact = requireSelectorListWithExtendsFact(children[0]);
      const bodyExtensions = children.filter(isBodyExtendFact).flatMap(fact => fact.bodyExtensions);
      const extensions = [...selectorFact.extensions, ...bodyExtensions];
      const node = withBlockBody(
        rule(
          selectorFact.selector,
          requireRulesetBody(children.filter(isStatement)),
          extensions.length === 0 ? undefined : extensions,
          children.find(isMixinGuard)
        ),
        rawChildren
      );
      return hasRulesetTerminator(rawChildren) ? withSourceSpan(node, span) : node;
    }
  );
  const MixinDefinitionContinuation = node(
    'MixinDefinition',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      literal(')'),
      choice(
        sequence(g.MixinGuard, optional(mixinSignatureGap), literal('{')),
        literal('{')
      ),
      g.blockBody,
      optional(g.Call),
      literal('}'),
      optional(literal(';'))
    )),
    (children, _fields, _span, rawChildren) => {
      const bodySpan = bodySpanFromRaw(rawChildren);
      return {
        params: [],
        ...(children.find(isMixinGuard) === undefined ? {} : { guard: children.find(isMixinGuard) }),
        rules: children.filter(isStatement),
        ...(bodySpan === undefined ? {} : { bodySpan })
      };
    }
  );
  const MixinCallContinuation = node(
    'MixinCall',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      literal(')'),
      not(whenGuardAhead),
      optional(literal('!important')),
      optional(literal(';'))
    )),
    children => ({
      args: [],
      important: children.some(child => isTerminalText(child, '!important'))
    })
  );
  const MixinStatementTail = node(
    'MixinStatement',
    sequence(g.MixinInterior, choice(attempt(MixinDefinitionContinuation), MixinCallContinuation)),
    (children) => {
      const interior = children.find((value): value is MixinInteriorFact =>
        typeof value === 'object' && value !== null && 'items' in value && 'separators' in value
      );
      if (interior === undefined) {
        throw new TypeError('Less mixin statement lost its parenthesized interior.');
      }
      const definition = children.find(isMixinDefinitionFact);
      if (definition !== undefined) {
        return { ...definition, params: mixinParamsFromInterior(interior) };
      }
      const call = children.find(isMixinCallFact);
      if (call === undefined) {
        throw new TypeError('Less mixin statement lost its continuation.');
      }
      return { ...call, args: mixinCallArgsFromInterior(interior) };
    }
  );
  const BareMixinCall = node(
    'MixinCall',
    sequence(optional(literal('!important')), literal(';')),
    children => ({ important: children.some(child => isTerminalText(child, '!important')) })
  );
  const RulesetTail = node(
    'Ruleset',
    sequence(
      selectorBranchContinuation,
      many(g.SelectorBranchTail),
      optional(g.MixinGuard),
      literal('{'),
      rulesetBody,
      optional(g.Call),
      literal('}'),
      optional(literal(';'))
    ),
    (children, _fields, _span, rawChildren) => {
      const bodySpan = bodySpanFromRaw(rawChildren);
      return {
        firstExtensions: children
          .filter(Array.isArray)
          .flatMap(values => values.filter(isExtendTargetFact)),
        branches: children.filter(isSelectorBranchFact),
        selectorEnd: requiredTokenStart(rawChildren, '{'),
        ...(children.find(isMixinGuard) === undefined ? {} : { guard: children.find(isMixinGuard) }),
        rules: children.filter(isStatement),
        extensions: children.filter(isBodyExtendFact).flatMap(fact => fact.bodyExtensions),
        ...(bodySpan === undefined ? {} : { bodySpan }),
        ...(hasRulesetTerminator(rawChildren) ? { terminated: true } : {})
      };
    }
  );
  const ClassIdStatement = node(
    'Statement',
    sequence(
      g.ClassIdSelectorPrefix,
      choice(
        MixinStatementTail,
        BareMixinCall,
        RulesetTail
      )
    ),
    (children, _fields, span) => {
      const prefix = children.find(isSelectorBranchFact);
      if (prefix === undefined) {
        throw new TypeError('Less class/id statement lost its selector prefix.');
      }
      const definition = children.find(isMixinDefinitionFact);
      if (definition !== undefined) {
        const node = mixinDef(
          mixinDefinitionNameFromSelectorBranch(prefix.selector),
          [...definition.params],
          [...definition.rules],
          definition.guard
        );
        return withSourceSpan(
          definition.bodySpan === undefined ? node : withBodySpan(node, definition.bodySpan),
          span
        );
      }
      const call = children.find(isMixinCallFact);
      if (call !== undefined) {
        return mixinCallFromSelectorBranch(prefix.selector, call.args, call.important, span);
      }
      const bare = children.find(isBareMixinCallFact);
      if (bare !== undefined) {
        return mixinCallFromSelectorBranch(prefix.selector, [], bare.important, span);
      }
      const ruleset = children.find(isRulesetTailFact);
      if (ruleset === undefined) {
        throw new TypeError('Less class/id statement lost its continuation.');
      }
      const prefixSpan = sourceSpanOf(prefix.selector);
      const guardSpan = ruleset.guard === undefined ? undefined : sourceSpanOf(ruleset.guard);
      const selector = prefixSpan === undefined
        ? selist(prefix.selector, ...ruleset.branches.map(branch => branch.selector))
        : withSourceSpan(
            selist(prefix.selector, ...ruleset.branches.map(branch => branch.selector)),
            { start: prefixSpan.start, end: guardSpan?.start ?? ruleset.selectorEnd }
          );
      const extensions = [
        ...ruleset.firstExtensions.map(target => ({
          target: target.target,
          partial: target.partial,
          subject: selist(prefix.selector)
        })),
        ...ruleset.branches.flatMap(branch => branch.extensions),
        ...ruleset.extensions
      ];
      const node = rule(
        selector,
        [...ruleset.rules],
        extensions.length === 0 ? undefined : extensions,
        ruleset.guard
      );
      const withBody = ruleset.bodySpan === undefined ? node : withBodySpan(node, ruleset.bodySpan);
      return ruleset.terminated === true ? withSourceSpan(withBody, span) : withBody;
    },
    { collapse: true }
  );
  const Stylesheet = node(
    'Stylesheet',
    sequence(many(choice(atStatement, mixinStatement, g.FunctionStatement, guardedRuleset, rootDeclarationItem, literal(';'))), optional(g.Call)),
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
    Color,
    Percentage,
    Dimension,
    UnicodeRange,
    EscapeValue,
    PagePseudo,
    DoubledQuoteArgument,
    FunctionArgument,
    FunctionScalarArgument,
    FunctionAssignmentArgument,
    FunctionKeywordArgument,
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
    CustomGroup,
    CustomValue,
    CustomPropertyValue,
    CustomDeclaration,
    Declaration,
    ClassIdStatement,
    MixinArgumentGroup,
    MixinArguments,
    MixinInterior,
    ClassIdSelectorPrefix,
    SelectorBranchTail,
    FlatMixinCall,
    NamespacedMixinCall,
    NamespacedMixinValue,
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
    EachFunctionStatement,
    SupportsValue,
    SupportsFeature,
    SupportsInParens,
    SupportsCondition,
    EnclosedContent,
    EnclosedGroup,
    EnclosedQuoted,
    EnclosedFunctionName,
    Enclosed,
    SupportsBlock,
    QueryValue,
    QueryColonFeature,
    QueryFeatureValue,
    QueryNonOnlyKeyword,
    QueryTerm,
    MediaQueryTerm,
    QueryFeature,
    QueryClause,
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
    AtRulePreludeValueAtom,
    AtRulePreludeValueTerm,
    AtRulePreludeValue,
    AtRulePrelude,
    NamespacePrelude,
    AtRuleBlock,
    OpaqueAtPrelude,
    OpaqueBody,
    AtRuleName,
    CustomValueAtKeyword,
    StaticAtRuleStatementName,
    OpaqueAtRuleBlock,
    AtRuleStatement,
    PseudoSelector,
    InterpolatedPseudo,
    InterpolatedNthPseudo,
    InterpolatedArgumentPseudo,
    NthPseudoSelector,
    NthPseudoArgument,
    PseudoArgumentText,
    PseudoArgumentGroup,
    PseudoArgumentCompound,
    PseudoArgumentComplex,
    PseudoArgumentSelectorTail,
    PseudoArgumentSelector,
    AttributeNamespace,
    NamespaceTypeSelector,
    AttributeName,
    AttributeMatch,
    AttributeSelector,
    InterpolatedAttributeToken,
    InterpolatedAttributeValueToken,
    InterpolatedAttributeQuoted,
    InterpolatedAttributeSelector,
    InterpolatedSimpleSelector,
    BareInterpolatedSelector,
    AdjacentInterpolatedSelector,
    BareInterpolatedSelectorWithSuffix,
    InterpolatedParentSuffix,
    CompoundSelector,
    ComplexSelector,
    SelectorList,
    ExtendTarget,
    ExtendStatement,
    RulesetWithExtends,
    RelativeComplex,
    NestedRulesetWithExtends,
    Quoted,
    LiteralQuoted,
    EscapedQuoted,
    PlainUrl,
    UrlInterpolation,
    VariableUrl,
    ImportOption,
    ImportOptions,
    ImportTarget,
    ImportTail,
    ImportTailText,
    ImportTailGroup,
    ImportTailParen,
    blockBody,
    BareVariableInterpolation,
    valuePiece,
    pseudoArgumentInner,
    queryLeaf,
    interpolatedValueTail,
    GenericFunction,
    CalcFunction,
    FunctionArguments,
    whitespace,
    rw: whitespace
  };
};

export const lessGrammar = composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment] }, lessGrammarFactory)]);

/** AST artifact with Parseman line/column tracking enabled. */
export const lessPositionsGrammar = composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment], trackLines: true }, lessGrammarFactory)]);

/** Public Less CST artifact: the same grammar factory compiled in CST mode. */
export const lessCstGrammar = composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment], hostMode: 'cst' }, lessGrammarFactory)]);

/** CST artifact with Parseman line/column tracking enabled. */
export const lessCstPositionsGrammar = composeLeaf([cssSyntax, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment], hostMode: 'cst', trackLines: true }, lessGrammarFactory)]);
