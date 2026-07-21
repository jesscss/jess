/** Direct canonical-AST grammar for the public Less `parse()` architecture. */
import { attempt, choice, composeLeaf, field, leaf, literal, many, noTrivia, node, not, oneOrMore, optional, parser, regex, rules, scanTo, sequence, trivia } from 'parseman' with { type: 'macro' };
import type { Combinator, FieldCapture, FieldMap } from 'parseman';
import { cssAstSyntax, lessAstSyntax } from '@jesscss/internal-css-recognition/recognition';
import { any, atRuleBlock, atRuleStatement, color, comment, complexCanonical, complexSelector, compoundSelectorOf, condition, decl, detachedRuleset, dimension, forNode, funcCall, generalEnclosed, important, importAtRule, interpolation, interpolatedSimpleSelector, keyword, list, mixinCall, mixinDef, operation, paren, propertyReference, quoted, reference, selectorCapture, stylesheet, rule, selist, simpleSelector, spaced, url, variableDeclaration, varIndirect, variableReference, withSourceSpan } from '@jesscss/core/ast';
import type { Any, AtRuleBlock, AtRuleStatement, Comment, ComplexSelector, CompoundSelector, Declaration, ExtendInstruction, For, ForBinding, FunctionCall, GeneralEnclosed, Important, ImportAtRule, Interpolation, List, MixinCall, MixinDef, Param, Plugin, Quoted, Reference, SelectorCapture, Stylesheet, Rule, SelectorList, SimpleSelector, Statement, Url, ValueNode, VariableDeclaration, VarIndirect, VariableReference } from '@jesscss/core/ast';

type Token = { readonly value: string };
type InterpolationFact = { readonly ref: ValueNode; readonly src: string };
type InterpolationAccessorFact = { readonly key: ValueNode | number; readonly keyKind: 'var' | 'prop' | 'index'; readonly src: string };
/** A typed continuation of a left-associated public Reference chain. */
type ReferenceTailFact = { readonly step: Reference['steps'][number]; readonly src: string };
type ComplexTailFact = { readonly comb: ' ' | '>' | '+' | '~' | '|' | '||'; readonly compound: CompoundSelector };
type MixinPathTailFact = { readonly comb: ' ' | '>'; readonly sel: string };
type LessEachCallback = { readonly binding: ForBinding; readonly rules: Statement[] };
type MixinGuard = NonNullable<MixinDef['guard']>;
type MixinCallArgument = MixinCall['args'][number];
/** Private grammar reduction: delimiters remain parser facts, while the public
 * MixinDef receives only the semantic Param array. */
type MixinParameterListFact = { readonly params: readonly Param[] };
type MixinSignatureFact = { readonly name: string; readonly params: readonly Param[]; readonly guard?: MixinGuard };
type DeclarationHeadTriviaFact = { readonly text: string; readonly outputBearing: boolean };
type StaticAttributeMatchFact = { readonly operator: string; readonly value: string; readonly modifier: string | null };
type StaticAttributeNameFact = { readonly namespace: string; readonly name: string };
type ExtendTargetFact = { readonly target: SelectorList; readonly partial: boolean };
type InlineExtendBranchFact = { readonly selector: ComplexSelector; readonly extensions: readonly ExtendInstruction[] };
type CustomValuePart = string | InterpolationFact | readonly CustomValuePart[];
type GeneralEnclosedNameFact = { readonly name: string };
type FunctionConditionFact = { readonly guard: MixinGuard; readonly src: string };

/** Rules this file defines; macro-fused recognition inputs are not local output. */
type LessAstLocalRules = {
  LessAstDocument: Combinator<Stylesheet>;
  DirectLessImport: Combinator<ImportAtRule>;
  DirectLessPlugin: Combinator<Plugin>;
  DirectLessVarDeclaration: Combinator<VariableDeclaration>;
  DirectLessDetachedRulesetDeclaration: Combinator<VariableDeclaration>;
  DirectLessDetachedRuleset: Combinator<ValueNode>;
  DirectLessVarIndirect: Combinator<VarIndirect>;
  DirectLessVarReferenceChain: Combinator<Reference>;
  DirectLessVarReference: Combinator<VariableReference>;
  DirectLessPropReference: Combinator<ValueNode>;
  DirectLessVariableInterpolation: Combinator<InterpolationFact>;
  DirectLessPropertyInterpolation: Combinator<InterpolationFact>;
  DirectLessInterpolation: Combinator<InterpolationFact>;
  DirectLessAtRuleInterpolation: Combinator<Interpolation>;
  DirectLessInterpolationAccessor: Combinator<InterpolationAccessorFact>;
  DirectLessReferenceTail: Combinator<ReferenceTailFact>;
  DirectLessInterpolatedValue: Combinator<Interpolation>;
  DirectLessInterpolatedProperty: Combinator<Interpolation>;
  DirectLessKeyword: Combinator<ValueNode>;
  DirectLessNamedColor: Combinator<ValueNode>;
  DirectLessColor: Combinator<ValueNode>;
  DirectLessDimension: Combinator<ValueNode>;
  DirectLessUnicodeRange: Combinator<Any>;
  DirectLessCssEscapeValue: Combinator<Any>;
  DirectLessPercentEscape: Combinator<Any>;
  DirectLessValueComment: Combinator<Any>;
  DirectLessPagePseudo: Combinator<Any>;
  DirectLessDoubledQuoteFunctionArgument: Combinator<Any>;
  DirectLessFunctionArgument: Combinator<ValueNode>;
  DirectLessFunctionScalarArgument: Combinator<ValueNode>;
  DirectLessFunctionValueTerm: Combinator<ValueNode>;
  DirectLessFunctionCondition: Combinator<ValueNode>;
  DirectLessFunctionConditionOr: Combinator<FunctionConditionFact>;
  DirectLessFunctionConditionAnd: Combinator<FunctionConditionFact>;
  DirectLessFunctionConditionTerm: Combinator<FunctionConditionFact>;
  DirectLessFunctionConditionOperand: Combinator<ValueNode>;
  DirectLessFunctionConditionParen: Combinator<FunctionConditionFact>;
  DirectLessFunction: Combinator<FunctionCall>;
  DirectLessCallArgumentFunction: Combinator<FunctionCall>;
  DirectLessFormatFunction: Combinator<FunctionCall>;
  DirectLessCallArgumentValue: Combinator<MixinCallArgument['value']>;
  DirectLessFunctionStatement: Combinator<FunctionCall>;
  DirectLessCalcFunction: Combinator<FunctionCall>;
  DirectLessValueAtom: Combinator<ValueNode>;
  DirectLessSelectorCapture: Combinator<SelectorCapture>;
  DirectLessMathAtom: Combinator<ValueNode>;
  DirectLessMathUnary: Combinator<ValueNode>;
  DirectLessMathProduct: Combinator<ValueNode>;
  DirectLessMathSum: Combinator<ValueNode>;
  DirectLessTopProduct: Combinator<ValueNode>;
  DirectLessTopSum: Combinator<ValueNode>;
  DirectLessPreservedDivision: Combinator<ValueNode>;
  DirectLessEscapedParen: Combinator<ValueNode>;
  DirectLessParen: Combinator<ValueNode>;
  DirectLessValueTerm: Combinator<ValueNode>;
  DirectLessValue: Combinator<ValueNode>;
  DirectLessVariableValue: Combinator<ValueNode>;
  DirectLessImportant: Combinator<Important>;
  DirectLessCustomPropertyName: Combinator<string | Interpolation>;
  DirectLessCustomPart: Combinator<CustomValuePart>;
  DirectLessCustomInnerPart: Combinator<CustomValuePart>;
  DirectLessCustomParen: Combinator<readonly CustomValuePart[]>;
  DirectLessCustomSquare: Combinator<readonly CustomValuePart[]>;
  DirectLessCustomCurly: Combinator<readonly CustomValuePart[]>;
  DirectLessCustomValue: Combinator<ValueNode>;
  DirectLessCssCustomPropertyValue: Combinator<Any>;
  DirectLessCustomDeclaration: Combinator<Declaration>;
  DirectLessPunctuationMapDeclaration: Combinator<Declaration>;
  DirectLessDeclaration: Combinator<Declaration>;
  DirectLessComment: Combinator<Comment>;
  DirectLessMixinParam: Combinator<Param>;
  DirectLessMixinParameterList: Combinator<MixinParameterListFact>;
  DirectLessMixinDefinition: Combinator<MixinDef>;
  DirectLessPositionalMixinCallArgument: Combinator<MixinCallArgument>;
  DirectLessMixinArgumentGroup: Combinator<MixinCallArgument>;
  DirectLessMixinArguments: Combinator<readonly MixinCallArgument[]>;
  DirectLessMixinCall: Combinator<MixinCall>;
  DirectLessBareMixinCall: Combinator<MixinCall>;
  DirectLessFlatMixinCall: Combinator<MixinCall>;
  DirectLessNamespacedMixinCall: Combinator<MixinCall>;
  DirectLessNamespacedMixinValue: Combinator<MixinCall>;
  DirectLessMixinPathTail: Combinator<MixinPathTailFact>;
  DirectLessMixinReference: Combinator<Reference>;
  DirectLessReferenceCall: Combinator<Reference>;
  DirectLessMixinGuard: Combinator<MixinGuard>;
  DirectLessMixinGuardOr: Combinator<MixinGuard>;
  DirectLessMixinGuardAnd: Combinator<MixinGuard>;
  DirectLessMixinGuardTerm: Combinator<MixinGuard>;
  DirectLessMixinGuardOperand: Combinator<ValueNode>;
  DirectLessEachName: Combinator<string>;
  /** A complete direct Less statement body, shared by detached rulesets and `each()` callbacks. */
  DirectLessBodyStatement: Combinator<Statement | string>;
  DirectLessEachCallback: Combinator<LessEachCallback>;
  DirectLessEach: Combinator<For>;
  DirectLessSupportsValue: Combinator<ValueNode>;
  DirectLessSupportsFeature: Combinator<ValueNode>;
  DirectLessSupportsInParens: Combinator<ValueNode>;
  DirectLessSupportsCondition: Combinator<ValueNode>;
  DirectLessGeneralEnclosedContent: Combinator<Interpolation>;
  DirectLessGeneralEnclosedGroup: Combinator<Interpolation>;
  DirectLessGeneralEnclosedQuoted: Combinator<Interpolation>;
  DirectLessGeneralEnclosedFunctionName: Combinator<GeneralEnclosedNameFact>;
  DirectLessGeneralEnclosed: Combinator<GeneralEnclosed>;
  DirectLessSupportsBlock: Combinator<AtRuleBlock>;
  DirectLessQueryValue: Combinator<ValueNode>;
  DirectLessQueryLogicalGroup: Combinator<ValueNode>;
  DirectLessQueryNegatedFeature: Combinator<ValueNode>;
  DirectLessQueryColonFeature: Combinator<ValueNode>;
  DirectLessQueryFeature: Combinator<ValueNode>;
  DirectLessQueryComment: Combinator<Any>;
  DirectLessQueryClause: Combinator<ValueNode>;
  DirectLessQueryPrelude: Combinator<ValueNode>;
  DirectLessContainerStyleQuery: Combinator<FunctionCall>;
  DirectLessMediaContainerBody: Combinator<readonly Statement[]>;
  DirectLessMediaContainerBlock: Combinator<AtRuleBlock>;
  DirectLessKeyframeSelector: Combinator<SimpleSelector>;
  DirectLessKeyframeBlock: Combinator<Rule>;
  DirectLessKeyframes: Combinator<AtRuleBlock>;
  DirectLessDottedAtRuleKeyword: Combinator<ValueNode>;
  DirectLessStaticAtRuleAtom: Combinator<ValueNode>;
  DirectLessStaticAtRuleTerm: Combinator<ValueNode>;
  DirectLessStaticAtRulePrelude: Combinator<ValueNode>;
  DirectLessAtRuleBlock: Combinator<AtRuleBlock>;
  DirectLessAtRuleStatement: Combinator<AtRuleStatement>;
  DirectLessStaticPseudo: Combinator<SimpleSelector>;
  DirectLessStaticNthPseudo: Combinator<SimpleSelector>;
  DirectLessStaticNthArgument: Combinator<string>;
  DirectLessStaticNonSelectorPseudoArgument: Combinator<string>;
  DirectLessStaticPseudoGroup: Combinator<string>;
  DirectLessStaticPseudoSquare: Combinator<string>;
  DirectLessStaticPseudoQuoted: Combinator<string>;
  DirectLessStaticPseudoCompound: Combinator<CompoundSelector>;
  DirectLessStaticPseudoComplexTail: Combinator<ComplexTailFact>;
  DirectLessStaticPseudoComplex: Combinator<ComplexSelector>;
  DirectLessStaticPseudoSelectorTail: Combinator<ComplexSelector>;
  DirectLessStaticPseudoSelector: Combinator<SelectorList>;
  DirectLessStaticAttributeNamespace: Combinator<string>;
  DirectLessStaticNamespaceType: Combinator<SimpleSelector>;
  DirectLessStaticAttributeName: Combinator<StaticAttributeNameFact>;
  DirectLessStaticAttributeQuoted: Combinator<string>;
  DirectLessStaticAttributeMatch: Combinator<StaticAttributeMatchFact>;
  DirectLessStaticAttribute: Combinator<SimpleSelector>;
  DirectLessInterpolatedAttributeToken: Combinator<Interpolation>;
  DirectLessInterpolatedAttributeValueToken: Combinator<Interpolation>;
  DirectLessInterpolatedAttributeQuoted: Combinator<Interpolation>;
  DirectLessInterpolatedAttribute: Combinator<SimpleSelector>;
  DirectLessInterpolatedSimpleSelector: Combinator<SimpleSelector>;
  DirectLessBareInterpolatedSelector: Combinator<SimpleSelector>;
  DirectLessInterpolatedParentSuffix: Combinator<SimpleSelector>;
  DirectLessCompound: Combinator<CompoundSelector>;
  DirectLessComplexTail: Combinator<ComplexTailFact>;
  DirectLessComplex: Combinator<ComplexSelector>;
  DirectLessSelectorTail: Combinator<ComplexSelector>;
  DirectLessSelector: Combinator<SelectorList>;
  DirectLessExtendComplex: Combinator<ComplexSelector>;
  DirectLessExtendTarget: Combinator<ExtendTargetFact>;
  DirectLessExtendStatement: Combinator<ExtendInstruction[]>;
  DirectLessInlineExtendRule: Combinator<Rule>;
  DirectLessRuleset: Combinator<Rule>;
  DirectLessQuoted: Combinator<Quoted | Interpolation>;
  DirectLessStaticQuoted: Combinator<Quoted>;
  DirectLessEscapedQuoted: Combinator<Quoted | Interpolation>;
  DirectLessStaticUrl: Combinator<Url>;
  DirectLessUrlInterpolatedValue: Combinator<Interpolation>;
  DirectLessDynamicUrl: Combinator<Url>;
  DirectLessImportOption: Combinator<Any>;
  DirectLessImportOptions: Combinator<List>;
  DirectLessStaticTail: Combinator<unknown>;
  DirectLessStaticTailGroup: Combinator<unknown>;
  DirectLessStaticTailParen: Combinator<unknown>;
  whitespace: Combinator<unknown>;
};

/** Macro-fused shared recognition plus this file's recursively defined outputs. */
type LessAstInputRules = LessAstLocalRules & typeof lessAstSyntax;

type SharedCssAstSyntax = {
  CssAstSyntaxAttributeModifier: Combinator<unknown>;
  CssAstSyntaxAttributeOperator: Combinator<unknown>;
  CssAstSyntaxHexColor: Combinator<string>;
  CssAstSyntaxNth: Combinator<unknown>;
  CssAstSyntaxNumber: Combinator<string>;
  CssAstSyntaxDimensionUnit: Combinator<string>;
  CssAstSyntaxInterpolatedPropertyStart: Combinator<unknown>;
  CssAstSyntaxInterpolatedPropertyTail: Combinator<unknown>;
  CssAstSyntaxProperty: Combinator<unknown>;
  CssAstSyntaxSupportsAtKeyword: Combinator<unknown>;
  CssAstSyntaxKeyframesAtKeyword: Combinator<unknown>;
  CssAstSyntaxMediaContainerAtKeyword: Combinator<unknown>;
  CssAstSyntaxMediaAtKeyword: Combinator<unknown>;
  CssAstSyntaxContainerAtKeyword: Combinator<unknown>;
  CssAstSyntaxQueryNot: Combinator<unknown>;
  CssAstSyntaxQueryAndOr: Combinator<unknown>;
  CssAstSyntaxQueryComparisonOperator: Combinator<unknown>;
};

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    throw new TypeError('Direct Less AST grammar produced a non-token child.');
  }
  return { value: value.value };
}

function requireTerminalText(value: unknown): string {
  return typeof value === 'string' ? value : requireToken(value).value;
}

function isTerminalText(value: unknown, text: string): boolean {
  return (typeof value === 'string' && value === text)
    || (typeof value === 'object' && value !== null && 'value' in value && value.value === text);
}

function requireField(fields: FieldMap | undefined, name: string): FieldCapture {
  const field = fields?.[name];
  if (field === undefined || Array.isArray(field)) {
    throw new TypeError(`Direct Less AST grammar lost required ${name} field.`);
  }
  return field;
}

function requireFields(fields: FieldMap | undefined, name: string): readonly FieldCapture[] {
  const field = fields?.[name];
  if (field === undefined) {
    throw new TypeError(`Direct Less AST grammar lost required ${name} field.`);
  }
  return Array.isArray(field) ? field : [field];
}

/** Reassemble only grammar-produced terminal values; never slice or rescan input. */
function staticText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (isQuoted(value)) {
    return value.src;
  }
  if (Array.isArray(value)) {
    return value.map(staticText).join('');
  }
  throw new TypeError('Direct Less AST grammar produced a non-static import fragment.');
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
    && (isValueNode(value.value) || isMixinCall(value.value));
}

function isVarRef(value: unknown): value is VariableReference {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VariableReference'
    && 'name' in value
    && typeof value.name === 'string';
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

function referenceWithBracketLookups(base: ValueNode, raw: string, accessors: readonly unknown[]): Reference {
  if (accessors.length === 0) return base;
  const steps: Reference['steps'] = [];
  for (const child of accessors) {
    const accessor = child as InterpolationAccessorFact;
    if (typeof accessor !== 'object' || accessor === null || !('key' in accessor) || !('keyKind' in accessor) || !('src' in accessor)) {
      throw new TypeError('Direct Less AST grammar produced an invalid accessor fact.');
    }
    raw += `[${accessor.src}]`;
    steps.push({ type: 'BracketLookup', key: accessor.key, keyKind: accessor.keyKind });
  }
  return reference(base, steps, raw);
}

/** Source fallback for a direct grammar fact. This deliberately walks already
 * reduced facts; it never inspects or re-parses source bytes. */
function mixinArgumentSource(value: ValueNode): string {
  switch (value.type) {
    case 'Keyword': case 'Color': case 'Dimension': case 'Any': case 'SelectorCapture': return value.src;
    case 'Quoted': return value.src;
    case 'VariableReference': return `@${value.name}`;
    case 'PropertyReference': return value.raw;
    case 'VarIndirect': return `@${mixinArgumentSource(value.nameRef)}`;
    case 'Reference': return value.raw;
    case 'FunctionCall': return `${value.name}(${value.args.map(mixinArgumentSource).join(', ')})`;
    case 'Paren': return `${value.escaped ? '~' : ''}(${mixinArgumentSource(value.inner)})`;
    case 'Operation': return `${mixinArgumentSource(value.left)} ${value.operator} ${mixinArgumentSource(value.right)}`;
    case 'SpacedValue': return value.parts.map(mixinArgumentSource).join(' ');
    case 'List': return value.items.map(mixinArgumentSource).join(', ');
    case 'Important': return `${mixinArgumentSource(value.inner)} !important`;
    default: throw new TypeError(`Direct Less mixin-reference raw source cannot represent ${value.type}.`);
  }
}

function mixinReferenceWithBracketLookups(base: MixinCall, baseRaw: string, accessors: readonly unknown[]): Reference {
  const steps: Reference['steps'] = [];
  let raw = baseRaw;
  for (const child of accessors) {
    const accessor = child as InterpolationAccessorFact;
    if (typeof accessor !== 'object' || accessor === null || !('key' in accessor) || !('keyKind' in accessor) || !('src' in accessor)) {
      throw new TypeError('Direct Less AST grammar produced an invalid mixin-reference accessor fact.');
    }
    raw += `[${accessor.src}]`;
    steps.push({ type: 'BracketLookup', key: accessor.key, keyKind: accessor.keyKind });
  }
  return reference(base, steps, raw);
}

/**
 * Fold only already-reduced grammar facts into a public Reference.  In
 * particular, this never re-reads the source to discover chain structure.
 */
function referenceWithTails(base: ValueNode | MixinCall, baseRaw: string, tails: readonly unknown[]): Reference {
  const steps: Reference['steps'] = [];
  let raw = baseRaw;
  for (const child of tails) {
    if (typeof child !== 'object' || child === null || !('step' in child) || !('src' in child)) {
      throw new TypeError('Direct Less AST grammar produced an invalid reference-tail fact.');
    }
    const tail = child as ReferenceTailFact;
    raw += tail.src;
    steps.push(tail.step);
  }
  return reference(base, steps, raw);
}

function isReferenceTailFact(value: unknown): value is ReferenceTailFact {
  return typeof value === 'object' && value !== null && 'step' in value && 'src' in value;
}

function interpolationFactFromChildren(children: readonly unknown[]): InterpolationFact {
  const opener = requireToken(children[0]).value;
  const head = requireToken(children[1]).value;
  let src = `${opener}${head}`;
  for (const child of children.slice(2, -1)) {
    src += `[${(child as InterpolationAccessorFact).src}]`;
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
  } else parts.push({ lit });
}

function appendGeneralEnclosedLiteral(parts: Interpolation['parts'], lit: string): void {
  if (lit.length === 0) return;
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
    if (child === undefined || child === null || child === false) return;
    if (isInterpolationFact(child)) {
      parts.push({ ref: child.ref, unquote: true });
    } else if (typeof child === 'object' && child !== null && 'type' in child && child.type === 'Interpolation') {
      for (const part of (child as Interpolation).parts) {
        if ('lit' in part) appendGeneralEnclosedLiteral(parts, part.lit);
        else parts.push(part);
      }
    } else if (Array.isArray(child)) {
      for (const nested of child) append(nested);
    } else if (typeof child === 'string') {
      appendGeneralEnclosedLiteral(parts, child);
    } else {
      appendGeneralEnclosedLiteral(parts, requireToken(child).value);
    }
  };
  for (const child of children) append(child);
  return interpolation(parts);
}

function isInterpolationFact(value: unknown): value is InterpolationFact {
  return typeof value === 'object' && value !== null && 'ref' in value && 'src' in value;
}

/** Turn grammar-owned custom-property leaves into a canonical value without a source scan. */
function customValueFromParts(parts: readonly CustomValuePart[]): ValueNode {
  const interpolationParts: Interpolation['parts'] = [];
  let hasInterpolation = false;
  const append = (part: CustomValuePart): void => {
    if (typeof part === 'string') {
      appendInterpolationLiteral(interpolationParts, part);
    } else if (Array.isArray(part)) {
      for (const nested of part) append(nested);
    } else {
      hasInterpolation = true;
      interpolationParts.push({ ref: part.ref, unquote: true });
    }
  };
  for (const part of parts) append(part);
  if (hasInterpolation) return interpolation(interpolationParts);
  const src = interpolationParts.map(part => 'lit' in part ? part.lit : '').join('');
  // A single quoted custom-property value has already been recognized by the
  // dedicated custom-string leaf. Preserve the established AST literal shape;
  // this reads only that grammar-produced terminal, never the source input.
  if ((src.startsWith('"') && src.endsWith('"')) || (src.startsWith('\'') && src.endsWith('\''))) {
    return quoted(src, src.slice(1, -1), src[0]!, src.includes('\\'));
  }
  return any(src);
}

function customPartsFromChildren(children: readonly unknown[]): CustomValuePart[] {
  const parts: CustomValuePart[] = [];
  for (const child of children) {
    if (isInterpolationFact(child)) parts.push(child);
    else if (Array.isArray(child)) parts.push(customPartsFromChildren(child));
    else if (typeof child === 'string') parts.push(child);
    else parts.push(requireToken(child).value);
  }
  return parts;
}

function isValueNode(value: unknown): value is ValueNode {
  return isQuoted(value)
    || isAny(value)
    || isComment(value)
    || isVarRef(value)
    || (typeof value === 'object'
      && value !== null
      && 'type' in value
      && (value.type === 'Keyword'
        || value.type === 'Color'
        || value.type === 'Dimension'
        || value.type === 'Url'
        || value.type === 'FunctionCall'
        || value.type === 'SpacedValue'
        || value.type === 'List'
        || value.type === 'Operation'
        || value.type === 'Condition'
        || value.type === 'Paren'
        || value.type === 'PropertyReference'
        || value.type === 'VarIndirect'
        || value.type === 'Reference'
        || value.type === 'Interpolation'
        || value.type === 'Important'
        || value.type === 'SelectorCapture'
        || value.type === 'DetachedRuleset'
        || value.type === 'GeneralEnclosed'));
}

function variableValueWithoutComments(value: ValueNode): ValueNode {
  if (value.type === 'Comment') return any('');
  if (value.type === 'SpacedValue') {
    if (!value.parts.some(part => part.type === 'Comment')) return value;
    const parts = value.parts.filter(part => part.type !== 'Comment');
    return parts.length === 0 ? any('') : parts.length === 1 ? parts[0]! : spaced(parts, value.separators);
  }
  if (value.type === 'List') {
    const items = value.items.map(variableValueWithoutComments);
    if (items.every((item, index) => item === value.items[index])) return value;
    return list(items, value.separators);
  }
  return value;
}

function requireValueNode(value: unknown): ValueNode {
  if (!isValueNode(value)) {
    throw new TypeError('Direct Less AST grammar produced a non-value child.');
  }
  return value;
}

function requireMixinCallArgumentValue(value: unknown): MixinCallArgument['value'] {
  if (!isValueNode(value) && !isMixinCall(value)) {
    throw new TypeError('Direct Less AST grammar produced an invalid mixin-call argument.');
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
    && isValueNode(value.value)
    && 'merge' in value
    && (value.merge === null || value.merge === ',' || value.merge === ' ')
    && 'important' in value
    && typeof value.important === 'boolean';
}

function isComment(value: unknown): value is Comment {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Comment'
    && 'text' in value
    && typeof value.text === 'string';
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
    throw new TypeError('Direct Less AST grammar produced a non-selector child.');
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
    throw new TypeError('Direct Less AST grammar produced a non-complex selector child.');
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

function requireCompound(value: unknown): CompoundSelector {
  if (!isCompound(value)) {
    throw new TypeError('Direct Less AST grammar produced a non-compound selector child.');
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

function isDeclarationHeadTriviaFact(value: unknown): value is DeclarationHeadTriviaFact {
  return typeof value === 'object' && value !== null && 'text' in value
    && typeof value.text === 'string' && 'outputBearing' in value
    && typeof value.outputBearing === 'boolean';
}

function isMixinPathTail(value: unknown): value is MixinPathTailFact {
  return typeof value === 'object' && value !== null && 'comb' in value
    && (value.comb === ' ' || value.comb === '>') && 'sel' in value && typeof value.sel === 'string';
}

function isMixinCallArgument(value: unknown): value is MixinCallArgument {
  return typeof value === 'object' && value !== null && 'value' in value && (isValueNode(value.value) || isMixinCall(value.value))
    && (!('name' in value) || typeof value.name === 'string');
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

function isFunctionConditionFact(value: unknown): value is FunctionConditionFact {
  return typeof value === 'object' && value !== null && 'guard' in value && 'src' in value
    && typeof value.src === 'string' && isMixinGuard(value.guard);
}

function guardOperatorText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    return null;
  }
  const operator = value.value.trim();
  return ['>', '<', '>=', '<=', '=>', '=<', '=', '=~'].includes(operator) ? operator : null;
}

function foldMixinGuards(kind: 'and' | 'or', children: readonly unknown[]): MixinGuard {
  const guards = children.filter(isMixinGuard);
  const head = guards[0];
  if (head === undefined) {
    throw new TypeError('Direct Less AST grammar produced an empty logical guard.');
  }
  let result = head;
  for (let index = 1; index < guards.length; index++) {
    result = { g: kind, left: result, right: guards[index]! };
  }
  return result;
}

function functionConditionSource(value: ValueNode): string {
  switch (value.type) {
    case 'Keyword': case 'Color': case 'Quoted': case 'Any': case 'Dimension': return value.src;
    case 'VariableReference': return `@${value.name}`;
    case 'FunctionCall': return `${value.name}(${value.args.map(functionConditionSource).join(', ')})`;
    case 'Operation': return `${functionConditionSource(value.left)} ${value.operator} ${functionConditionSource(value.right)}`;
    case 'Paren': return `(${functionConditionSource(value.inner)})`;
    case 'SpacedValue': return value.parts.map(functionConditionSource).join(' ');
    case 'Condition': return value.src;
    default: throw new TypeError(`Direct Less function condition cannot preserve ${value.type}.`);
  }
}

function foldFunctionCondition(kind: 'and' | 'or', children: readonly unknown[]): FunctionConditionFact {
  const facts = children.filter(isFunctionConditionFact);
  const first = facts[0];
  if (first === undefined) throw new TypeError('Direct Less function condition lost its first term.');
  let guard = first.guard;
  let src = first.src;
  for (const right of facts.slice(1)) {
    guard = { g: kind, left: guard, right: right.guard };
    src += ` ${kind} ${right.src}`;
  }
  return { guard, src };
}

function isStatement(value: unknown): value is Statement {
  return isImportAtRule(value) || isVarDeclaration(value) || isDeclaration(value)
    || isComment(value) || isRule(value) || isAtRuleBlock(value) || isAtRuleStatement(value)
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'Plugin')
    || isMixinDef(value) || isMixinCall(value) || isReferenceCall(value) || isFor(value)
    || isFunctionCall(value);
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
      throw new TypeError('Direct Less AST grammar produced a non-ruleset-body child.');
    }
    body.push(child);
  }
  return body;
}

function requireStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isStatement(child)) {
      throw new TypeError('Direct Less AST grammar produced a non-statement child.');
    }
    statements.push(child);
  }
  return statements;
}

/** Retain every callback body fact except an authored empty statement. */
function requireCallbackStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (isTerminalText(child, ';')) continue;
    if (!isStatement(child)) {
      throw new TypeError('Direct Less AST grammar produced a non-statement callback-body child.');
    }
    statements.push(child);
  }
  return statements;
}

/** Read a grammar-owned `{ … }` body without silently dropping non-body facts. */
function requireDetachedRulesetBody(children: readonly unknown[]): Statement[] {
  const bodyStart = children.findIndex(child => isTerminalText(child, '{'));
  const bodyEnd = children.findIndex((child, index) => index > bodyStart && isTerminalText(child, '}'));
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new TypeError('Direct Less AST grammar produced a detached ruleset without a delimited body.');
  }
  for (const child of children.slice(bodyEnd + 1)) {
    if (!isTerminalText(child, ';')) {
      throw new TypeError('Direct Less AST grammar produced an invalid detached-ruleset suffix.');
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
    throw new TypeError('Direct Less arithmetic grammar produced no operand.');
  }
  let result = first;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 2) {
    const operatorToken = children[index];
    const right = children[index + 1];
    if (operatorToken === undefined || !isValueNode(right)) {
      throw new TypeError('Direct Less arithmetic grammar lost an operator operand.');
    }
    result = operation(requireTerminalText(operatorToken).trim(), result, right);
  }
  return result;
}

// Less `//` comments are trivia, not CSS comments: they must be recognized
// between direct AST facts but must not become a renderable `Comment` node.
// URL bodies explicitly disable trivia below, so `url(//host/path)` remains
// URL content rather than a comment.
const whitespace = trivia(oneOrMore(choice(
  regex(/[ \t\n\r\f]+/),
  regex(/\/\/[^\n\r]*/)
)));
const selectorAttributeModifierSpace = regex(/[ \t\n\r\f]+/);
const importKeyword = regex(/@(?:-import|-export|import)(?![-\w])/i);
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
// Line comments are separator trivia in function arguments. Block comments are
// CSS value syntax and must reach DirectLessFunctionValueTerm so they remain in
// the typed AST (including immediately before a comma).
const functionTrivia = trivia(oneOrMore(choice(
  regex(/[ \t\n\r\f]+/),
  regex(/\/\/[^\n\r]*/)
)));
// Mixin signatures and guards are invisible definition syntax. Unlike an
// ordinary declaration value, a block comment at one of their token boundaries
// is lexical trivia (the legacy MixinArgs production used the same rule). Keep
// this wider trivia local: output-bearing value comments remain typed facts.
const mixinSignatureGap = regex(/(?:(?:[ \t\n\r\f]+)|(?:\/\/[^\n\r]*)|(?:\/\*(?:[^*]|\*(?!\/))*\*\/))+/);
const mixinGuardGap = regex(/(?:(?:[ \t\n\r\f]+)|(?:\/\/[^\n\r]*)|(?:\/\*(?:[^*]|\*(?!\/))*\*\/))+/);
const mixinSignatureTrivia = trivia(mixinSignatureGap);
const mixinGuardTrivia = trivia(mixinGuardGap);
// Selector grammar components used inside functional pseudos retain their
// established lexical-comment behavior.
const staticSelectorTrivia = trivia(oneOrMore(choice(
  regex(/[ \t\n\r\f]+/),
  regex(/\/\/[^\n\r]*/),
  blockComment
)));
// Outer selector comments are CSS output, so they reduce as typed
// SimpleSelector facts below rather than parser trivia.
const outerSelectorTrivia = trivia(oneOrMore(choice(
  regex(/[ \t\n\r\f]+/),
  regex(/\/\/[^\n\r]*/)
)));
const staticSimpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)/);
const directStaticIdentifier = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
// A selector simple that contains Less interpolation stays one selector atom.
// Its literal runs deliberately exclude `.`, `#`, `[`, `:`, whitespace, and
// combinators: those have separate selector grammar roles and must not be
// flattened into an interpolation template.
const directInterpolatedSelectorPrefix = regex(/[.#](?:-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*)?/);
const directInterpolatedSelectorTail = regex(/(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
// A bare `@{name}` is a whole-selector interpolation only. Keeping the
// delimiter lookahead here prevents it from consuming the interpolation prefix
// of an unmodelled namespace/attribute selector such as `@{ns}|a`.
const directBareInterpolatedSelectorEnd = regex(/(?=[ \t\n\r\f]*(?:[,{]))/);
// Semantically identical to the production Less `ampToken` terminal. A static ampersand
// is already the canonical AST representation: `SimpleSelector.text` retains `&` and
// core's selector path identifies parent references from that text.  The
// parenthesized and interpolation forms stay outside this direct static slice
// until their typed semantic payloads are constructed by grammar reductions.
const staticAmpersand = regex(/&[-_a-zA-Z0-9\u0080-\uffff]*/);
const directLessKeyframeEndpoint = regex(/(?:from|to)(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const directLessKeyframePercent = regex(/[-+]?(?:\d+\.?\d*|\.\d+)%/);
// Ordered longest-first, identical to the production Less `combinator`
// terminal. A missing authored token between compounds is the canonical
// descendant relation; grammar trivia provides the separating whitespace.
const staticCombinator = choice(literal('||'), literal('>'), literal('+'), literal('~'), literal('|'));
// A leading `|` belongs to namespace selector syntax (`|a`), not a relative
// selector. Keep relative starts to the Less nested-selector combinators.
const relativeSelectorCombinator = choice(literal('>'), literal('+'), literal('~'));
// The production Less `urlInner` terminal, narrowed only at a dynamic Less
// opener. A leading `@name` / `@{…}` belongs to the unimplemented Reference /
// interpolation path, so this direct static slice rejects it instead of
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
const staticTailText = regex(/[^()\[\]{};@'"]+/);
const importOption = regex(/(?:reference|optional|once|multiple|inline|css|less)(?![-\w])/i);
// The current direct Less subset intentionally uses the same bare identifier
// boundary as its property/keyword facts.  `url()` has its own typed node and
// is excluded so an unsupported dynamic URL cannot fall through as a generic call.
const directFunctionName = regex(/(?!(?:url|calc)(?=\())-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
const directCalcFunctionName = regex(/calc(?=\()/i);
// Math productions run under `noTrivia`, so their operators own precisely the
// gap that distinguishes arithmetic from a Less space-list. `leaf()` keeps the
// comment-aware structural gap hidden from `foldOperation`: it receives the
// same flat `*`/`/`/`%` terminal stream it did before, with no scanner or
// post-parse text recovery. Keep the sum terminal below unchanged: its glued
// numeric-sign lookahead is intentional Less syntax, not an operator gap.
const directProductOperator = leaf(
  noTrivia(sequence(optional(whitespace), choice(literal('*'), literal('/'), literal('%')), optional(whitespace))),
  children => children[1] as string
);
const directTopProductOperator = leaf(
  noTrivia(sequence(optional(whitespace), choice(literal('*'), literal('%')), optional(whitespace))),
  children => children[1] as string
);
const directSumOperator = regex(/(?:[ \t\n\r\f]+[-+][ \t\n\r\f]+|[-+](?=[0-9.])|[ \t\n\r\f]*[-+](?![0-9.])[ \t\n\r\f]*)/);
// CSS unicode-range is one opaque CSS token, not Less arithmetic.  Keep this
// terminal byte-for-byte equivalent to the public CST grammar.  It belongs in
// `DirectLessValueTerm`, but intentionally not `DirectLessMathAtom`: Less
// rejects `U+0-7F + 1` rather than applying numeric operations to the range.
const directUnicodeRange = regex(/[Uu]\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?/);
// Generic Less at-rule names are grammar terminals. This direct slice keeps
// their prelude/body semantic only where the existing canonical AST has a
// truthful structured representation; it never captures a block as text.
// Imports are typed facts with stricter target validation. Excluding their names
// here prevents a malformed import from falling through as a generic at-rule.
const directLayerAtRuleName = regex(/@layer(?![-\w])/i);
const directAtRuleName = regex(/@(?!(?:-import|-export|import|layer|media|container|supports|(?:-[a-z]+-)?keyframes)(?![-\w]))-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
const directMixinName = regex(/[.#]-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const directMixinPathCombinator = regex(/>/);
const directMixinGuardOperator = regex(/>=|<=|=>|=<|=~|[<>=]/);
const directFunctionConditionStop = regex(/[ \t\n\r\f]*(?:>=|<=|=>|=<|=~|[<>=]|(?:and|or)(?![-\w]))/i);
const directFunctionConditionOperator = regex(/[ \t\n\r\f]*(?:>=|<=|=>|=<|=~|[<>=])[ \t\n\r\f]*/);
const directFunctionConditionAnd = regex(/[ \t\n\r\f]*and(?![-\w])[ \t\n\r\f]*/i);
const directFunctionConditionOr = regex(/[ \t\n\r\f]*or(?![-\w])[ \t\n\r\f]*/i);
const directFunctionConditionNot = regex(/not(?![-\w])/i);
const directFunctionConditionAhead = regex(/>=|<=|=>|=<|=~|[<>=]|(?<![-\w])(?:and|or|not)(?![-\w])/i);
// This is deliberately narrower than a generic pseudo identifier: direct
// functional pseudo support currently has a truthful grammar only for the
// An+B forms named here. Keep the public grammar's case-insensitive spelling.
const directStaticNthPseudoName = regex(/nth-(?:last-)?(?:child|of-type)(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const directStaticNthChildPseudoName = regex(/nth-(?:last-)?child(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const directStaticNthTypePseudoName = regex(/nth-(?:last-)?of-type(?![-_a-zA-Z0-9\u0080-\uffff])/i);
const directStaticSelectorPseudoName = regex(/(?:is|not|has|where|matches|global|local)(?=\()/i);
// A non-selector functional pseudo is still one canonical SimpleSelector leaf.
// A pseudo body cannot quietly turn a Less variable read into static bytes.
// Keep only `@` that cannot start `@{...}`, `@@name`, or `@name`; nested
// delimiters, quoted strings, and comments are reduced below rather than
// recovered from source after recognition.
const directLessStaticPseudoChunk = regex(/(?:[^()\[\]'"@/]|@(?![@{_a-zA-Z\u0080-\uffff-])|\/(?!\*))+/);
// General-enclosed content is a raw template assembled by Parseman: structural
// delimiters, strings, comments, and `@{…}` each have their own grammar arm.
// This terminal owns only the remaining literal bytes; no completed source span
// is scanned or re-parsed after recognition.
const directLessGeneralEnclosedText = regex(/(?:\\[\s\S]|\/(?!\*)|@(?!\{)|[^\\/'"@()[\]{}]+)+/);
const directLessGeneralEnclosedDoubleChunk = regex(/(?:\\[\s\S]|@(?!\{)|[^"\\@])+/);
const directLessGeneralEnclosedSingleChunk = regex(/(?:\\[\s\S]|@(?!\{)|[^'\\@])+/);

export const lessAstGrammar = composeLeaf([cssAstSyntax, lessAstSyntax, rules<LessAstLocalRules>({ trivia: whitespace }, (g: LessAstInputRules & SharedCssAstSyntax) => {
  // `@@name` is a variable reference whose lookup name is the resolved value
  // of `@name`; retain that two-step lookup as a typed AST edge.  The doubled
  // sigil is glued just like the production `nestedRef`, so trivia cannot turn
  // it into two unrelated tokens.
  const DirectLessVarIndirect = node<VarIndirect>(
    'DirectLessVarIndirect',
    noTrivia(sequence(literal('@@'), g.LessAstSyntaxVariableName)),
    children => varIndirect(variableReference(requireToken(children[1]).value, 'scoped'), 'scoped')
  );
  const DirectLessVarReference = node<VariableReference>(
    'DirectLessVarReference',
    sequence(literal('@'), g.LessAstSyntaxVariableName),
    (children, _fields, span) => withSourceSpan(variableReference(requireToken(children[1]).value, 'scoped'), span)
  );
  const DirectLessPropReference = node<ValueNode>(
    'DirectLessPropReference',
    noTrivia(sequence(literal('$'), g.LessAstSyntaxIdentifier)),
    children => propertyReference(requireToken(children[1]).value)
  );
  const DirectLessInterpolationAccessor = choice(
    // Less `[]` selects the final declaration of a namespace/mixin result.
    // Lower it directly to the established negative-one index contract; the
    // existing Reference evaluator already applies negative indexes from the
    // end of its typed declaration map.
    node<InterpolationAccessorFact>(
      'DirectLessInterpolationLastAccessor',
      noTrivia(literal('[]')),
      () => ({ key: -1, keyKind: 'index', src: '-1' })
    ),
    node<InterpolationAccessorFact>(
      'DirectLessInterpolationIndexAccessor',
      noTrivia(sequence(literal('['), g.LessAstSyntaxInterpIndexKey, literal(']'))),
      children => {
        const text = requireToken(children[1]).value;
        return { key: Number(text), keyKind: 'index', src: text };
      }
    ),
    // `$@name` is a property-map key selected by the VALUE of `@name`, e.g.
    // `#namespace[$@prop-name]`. Keep both the indirection and the property
    // namespace explicit: the existing resolver evaluates this key, then uses
    // `keyKind: 'prop'` to select the declaration-member map.
    node<InterpolationAccessorFact>(
      'DirectLessInterpolationPropertyVariableAccessor',
      noTrivia(sequence(literal('['), literal('$'), g.DirectLessVarReference, literal(']'))),
      children => {
        const key = requireValueNode(children[2]);
        if (!isVarRef(key)) throw new TypeError('Direct Less property-variable map key must retain its variable reference.');
        return { key, keyKind: 'prop', src: `$@${key.name}` };
      }
    ),
    node<InterpolationAccessorFact>(
      'DirectLessInterpolationReferenceAccessor',
      noTrivia(sequence(literal('['), choice(g.DirectLessVarIndirect, g.DirectLessVarReference, g.DirectLessPropReference, g.LessAstSyntaxInterpBareKey), literal(']'))),
      children => {
        const key = children[1];
        if (typeof key === 'object' && key !== null && 'type' in key && key.type === 'VarIndirect') {
          const nameRef = key.nameRef;
          if (!isVarRef(nameRef)) throw new TypeError('Direct Less indirect map key must retain its variable reference.');
          return { key, keyKind: 'var', src: `@@${nameRef.name}` };
        }
        if (isVarRef(key)) return { key, keyKind: 'var', src: `@${key.name}` };
        if (isPropRef(key)) return { key, keyKind: 'prop', src: key.raw };
        const text = requireToken(key).value;
        return { key: keyword(text), keyKind: 'prop', src: text };
      }
    )
  );
  const DirectLessVarReferenceChain = node<Reference>(
    'DirectLessVarReferenceChain',
    noTrivia(sequence(literal('@'), g.LessAstSyntaxVariableName, oneOrMore(g.DirectLessReferenceTail))),
    (children, _fields, span) => {
      const name = requireToken(children[1]).value;
      return referenceWithTails(variableReference(name, 'scoped'), `@${name}`, children.slice(2));
    }
  );
  const DirectLessMixinPathTail = node<MixinPathTailFact>(
    'DirectLessMixinPathTail',
    sequence(optional(directMixinPathCombinator), directMixinName),
    children => {
      const combToken = children.find(child => isTerminalText(child, '>'));
      return {
        comb: combToken === undefined ? ' ' : '>',
        sel: requireToken(children.at(-1)).value
      };
    }
  );
  const DirectLessVariableInterpolation = node<InterpolationFact>(
    'DirectLessVariableInterpolation',
    noTrivia(sequence(literal('@{'), g.LessAstSyntaxInterpHead, many(g.DirectLessInterpolationAccessor), literal('}'))),
    interpolationFactFromChildren
  );
  const DirectLessPropertyInterpolation = node<InterpolationFact>(
    'DirectLessPropertyInterpolation',
    noTrivia(sequence(literal('${'), g.LessAstSyntaxInterpHead, many(g.DirectLessInterpolationAccessor), literal('}'))),
    interpolationFactFromChildren
  );
  const DirectLessInterpolation = node<InterpolationFact>(
    'DirectLessInterpolation',
    choice(g.DirectLessVariableInterpolation, g.DirectLessPropertyInterpolation),
    children => children[0] as InterpolationFact
  );
  // A complete Less at-rule header can be deferred through one `@{…}` lookup.
  // Keep that as the existing typed Interpolation value rather than treating a header
  // as raw text; dedicated query/supports reducers still own static structure.
  const DirectLessAtRuleInterpolation = node<Interpolation>(
    'DirectLessAtRuleInterpolation',
    g.DirectLessVariableInterpolation,
    (children, _fields, span) => {
      const fact = children[0] as InterpolationFact;
      return interpolation([{ ref: fact.ref, unquote: true }]);
    }
  );
  const DirectLessInterpolatedValue = node<Interpolation>(
    'DirectLessInterpolatedValue',
    noTrivia(sequence(
      optional(choice(g.LessAstSyntaxInterpolatedValueStart, g.LessAstSyntaxInterpolatedValueDash)),
      g.DirectLessInterpolation,
      many(choice(g.LessAstSyntaxInterpolatedValueTail, g.DirectLessInterpolation))
    )),
    children => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (typeof child === 'object' && child !== null && 'ref' in child && 'src' in child) {
          parts.push({ ref: (child as InterpolationFact).ref, unquote: true });
        } else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolation(parts);
    }
  );
  const DirectLessQuoted = node<Quoted | Interpolation>(
    'DirectLessQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.DirectLessVariableInterpolation, g.DirectLessPropertyInterpolation, g.LessAstSyntaxQuotedDoubleChunk, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.DirectLessVariableInterpolation, g.DirectLessPropertyInterpolation, g.LessAstSyntaxQuotedSingleChunk, literal('@'), literal('$'))), literal('\'')))
    ),
    (children) => {
      const open = requireToken(children[0]);
      if (!children.some(child => typeof child === 'object' && child !== null && 'ref' in child && 'src' in child)) {
        const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
        return quoted(`${open.value}${value}${open.value}`, value, open.value, false);
      }
      const parts: Interpolation['parts'] = [{ lit: open.value }];
      for (const child of children.slice(1, -1)) {
        if (typeof child === 'object' && child !== null && 'ref' in child && 'src' in child) {
          parts.push({ ref: (child as InterpolationFact).ref, unquote: true });
        } else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      appendInterpolationLiteral(parts, open.value);
      return interpolation(parts);
    }
  );
  const DirectLessStaticQuoted = node<Quoted>(
    'DirectLessStaticQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.LessAstSyntaxQuotedDoubleChunk, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.LessAstSyntaxQuotedSingleChunk, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('\'')))
    ),
    children => {
      const open = requireToken(children[0]);
      const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
      return quoted(`${open.value}${value}${open.value}`, value, open.value, false);
    }
  );
  // A static Less `~"…"` / `~'…'` is an ordinary quoted value with the
  // existing escaped flag. Its interpolation-bearing form is a structural,
  // unquoted template—never a recovered source string.
  const DirectLessEscapedQuoted = node<Quoted | Interpolation>(
    'DirectLessEscapedQuoted',
    choice(
      noTrivia(sequence(literal('~"'), many(choice(g.DirectLessVariableInterpolation, g.DirectLessPropertyInterpolation, g.LessAstSyntaxQuotedDoubleChunk, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal("~'"), many(choice(g.DirectLessVariableInterpolation, g.DirectLessPropertyInterpolation, g.LessAstSyntaxQuotedSingleChunk, literal('@'), literal('$'))), literal("'")))
    ),
    children => {
      const opener = requireToken(children[0]).value;
      const quote = opener[1];
      if (quote !== '"' && quote !== "'") throw new TypeError('Direct Less escaped quote lost its quote delimiter.');
      if (children.some(child => typeof child === 'object' && child !== null && 'ref' in child && 'src' in child)) {
        const parts: Interpolation['parts'] = [];
        for (const child of children.slice(1, -1)) {
          if (typeof child === 'object' && child !== null && 'ref' in child && 'src' in child) {
            parts.push({ ref: (child as InterpolationFact).ref, unquote: true });
          } else {
            appendInterpolationLiteral(parts, requireToken(child).value);
          }
        }
        return interpolation(parts);
      }
      const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
      return quoted(`${opener}${value}${quote}`, value, quote, true);
    }
  );
  const DirectLessStaticUrl = node<Url>(
    'DirectLessStaticUrl',
    noTrivia(sequence(
      regex(/url\(/i),
      optional(urlBoundaryWhitespace),
      optional(field('body', choice(g.DirectLessEscapedQuoted, g.DirectLessQuoted, staticDataUrlText, staticUrlText))),
      optional(urlBoundaryWhitespace),
      literal(')')
    )),
    (_children, fields) => {
      const captured = fields?.body;
      if (Array.isArray(captured)) {
        throw new TypeError('Direct Less static URL produced repeated body facts.');
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
  const DirectLessUrlInterpolatedValue = node<Interpolation>(
    'DirectLessUrlInterpolatedValue',
    noTrivia(choice(
      sequence(g.DirectLessVarReference, oneOrMore(choice(staticUrlText, g.DirectLessInterpolation))),
      sequence(g.DirectLessInterpolation, many(choice(staticUrlText, g.DirectLessInterpolation)))
    )),
    children => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isVarRef(child)) {
          parts.push({ ref: child, unquote: true });
        } else if (typeof child === 'object' && child !== null && 'ref' in child && 'src' in child) {
          parts.push({ ref: (child as InterpolationFact).ref, unquote: true });
        } else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolation(parts);
    }
  );
  const DirectLessDynamicUrl = node<Url>(
    'DirectLessDynamicUrl',
    sequence(regex(/url\(/i), choice(g.DirectLessUrlInterpolatedValue, g.DirectLessVarReference), literal(')')),
    children => url(requireValueNode(children[1]))
  );
  const DirectLessImportOption = node<Any>(
    'DirectLessImportOption',
    importOption,
    children => any(requireToken(children[0]).value)
  );
  const DirectLessImportOptions = node<List>(
    'DirectLessImportOptions',
    sequence(literal('('), field('option', g.DirectLessImportOption), many(sequence(literal(','), field('option', g.DirectLessImportOption))), literal(')')),
    (_children, fields) => {
      const options = requireFields(fields, 'option').map((option) => {
        const value = option.value;
        if (!isAny(value)) {
          throw new TypeError('Direct Less AST grammar produced a non-static import option.');
        }
        return value;
      });
      return list(options, Array(options.length - 1).fill(', '));
    }
  );
  const DirectLessStaticTailParen = noTrivia(sequence(
    literal('('),
    many(choice(staticTailText, g.DirectLessQuoted, g.DirectLessStaticTailGroup)),
    literal(')')
  ));
  const DirectLessStaticTailGroup = g.DirectLessStaticTailParen;
  const DirectLessStaticTail = noTrivia(oneOrMore(choice(
    staticTailText,
    g.DirectLessQuoted,
    g.DirectLessStaticTailGroup
  )));
  const DirectLessImport = node<ImportAtRule>(
    'DirectLessImport',
    sequence(importKeyword, optional(g.DirectLessImportOptions), choice(g.DirectLessEscapedQuoted, g.DirectLessQuoted, g.DirectLessDynamicUrl, g.DirectLessStaticUrl), optional(field('tail', choice(g.DirectLessAtRuleInterpolation, g.DirectLessStaticTail))), literal(';')),
    (children, fields) => {
      // Every accepted import fact is a grammar child or a field capture. In
      // particular, the opaque tail is reconstructed from terminal values only
      // after the recursive grammar has closed every delimiter.
      const keyword = requireToken(children[0]);
      const options = children.find((child): child is List => typeof child === 'object' && child !== null && 'type' in child && child.type === 'List') ?? null;
      const target = children.find((child): child is Quoted | Url | Interpolation => isQuoted(child) || isUrl(child) || isInterp(child));
      if (target === undefined) {
        throw new TypeError('Direct Less AST grammar produced no import target.');
      }
      const tailField = fields?.tail;
      // A complete `@{…}` tail is one structural value. Mixed text and
      // interpolation stays rejected until ImportAtRule has a typed segment
      // model; do not flatten it back into opaque source bytes.
      const tailValue = tailField === undefined ? undefined : requireField(fields, 'tail').value;
      const tail = tailValue === undefined ? null : isInterp(tailValue) ? tailValue : any(staticText(tailValue));
      return importAtRule(keyword.value, target, options, null, tail);
    }
  );
  // `@plugin` is a compile-time directive, not an unknown CSS at-rule. Its
  // target and the *inner* option string are grammar facts so the evaluator
  // never rediscovers either from raw prelude bytes. GeneralEnclosedContent
  // recursively closes delimiters and preserves arbitrary option text as
  // interpolation literal/ref segments, matching Less's opaque option string.
  const DirectLessPlugin = node<Plugin>(
    'DirectLessPlugin',
    sequence(
      regex(/@plugin(?![-\w])/i),
      optional(sequence(literal('('), field('options', g.DirectLessGeneralEnclosedContent), literal(')'))),
      field('target', choice(g.DirectLessEscapedQuoted, g.DirectLessQuoted, g.DirectLessDynamicUrl, g.DirectLessStaticUrl)),
      literal(';'),
    ),
    (_children, fields) => {
      const target = requireField(fields, 'target').value;
      if (!isQuoted(target) && !isUrl(target) && !isInterp(target)) {
        throw new TypeError('Direct Less Plugin lost its typed target.');
      }
      const optionValue = fields?.options === undefined ? null : requireField(fields, 'options').value;
      if (optionValue !== null && !isInterp(optionValue)) {
        throw new TypeError('Direct Less Plugin options must remain an interpolation template.');
      }
      return { type: 'Plugin', target, options: optionValue };
    }
  );
  const DirectLessVarDeclaration = node<VariableDeclaration>(
    'DirectLessVarDeclaration',
    sequence(literal('@'), g.LessAstSyntaxVariableName, literal(':'), choice(g.DirectLessNamespacedMixinValue, g.DirectLessImportant, g.DirectLessFlatMixinCall, sequence(not(literal('{')), g.DirectLessVariableValue)), literal(';')),
    (children) => {
      // The sigil and name are distinct grammar children, so AST `name` is not
      // recovered from authored text or sliced from a source span.
      const name = requireToken(children[1]);
      const value = children[3];
      return variableDeclaration(name.value, isMixinCall(value) ? value : variableValueWithoutComments(requireValueNode(value)), { mode: 'declare' });
    }
  );
  const DirectLessDetachedRulesetDeclaration = node<VariableDeclaration>(
    'DirectLessDetachedRulesetDeclaration',
    sequence(
      literal('@'),
      g.LessAstSyntaxVariableName,
      literal(':'),
      g.DirectLessDetachedRuleset,
      optional(literal(';'))
    ),
    children => variableDeclaration(
      requireToken(children[1]).value,
      requireValueNode(children[3]),
      { mode: 'declare' }
    )
  );
  const DirectLessKeyword = node<ValueNode>(
    'DirectLessKeyword',
    g.LessAstSyntaxKeyword,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectLessNamedColor = node<ValueNode>(
    'DirectLessNamedColor',
    g.LessAstSyntaxNamedColor,
    children => color(requireToken(children[0]).value)
  );
  const DirectLessColor = node<ValueNode>(
    'DirectLessColor',
    g.CssAstSyntaxHexColor,
    children => color(requireToken(children[0]).value)
  );
  const DirectLessDimension = node<ValueNode>(
    'DirectLessDimension',
    noTrivia(sequence(g.CssAstSyntaxNumber, optional(g.CssAstSyntaxDimensionUnit))),
    (children) => {
      const numberText = requireToken(children[0]).value;
      const unit = children.length > 1 ? requireToken(children[1]).value : '';
      return dimension(Number(numberText), unit, `${numberText}${unit}`);
    }
  );
  const DirectLessUnicodeRange = node<Any>(
    'DirectLessUnicodeRange',
    directUnicodeRange,
    children => any(requireToken(children[0]).value)
  );
  // CSS declaration hacks such as `#000 \\9` are a real one-token value
  // suffix. Keep the escape structural and narrow; this is not a raw-value
  // fallback or a second scanner for declaration text.
  const DirectLessCssEscapeValue = node<Any>(
    'DirectLessCssEscapeValue',
    regex(/(?:\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/),
    children => any(requireToken(children[0]).value)
  );
  const DirectLessPercentEscape = node<Any>(
    'DirectLessPercentEscape',
    g.LessAstSyntaxPercentEscape,
    children => any(requireToken(children[0]).value),
  );
  // A block comment in an ordinary value position is output-bearing value
  // syntax, not document trivia and not a statement-level Comment node.
  const DirectLessValueComment = node<Comment>(
    'DirectLessValueComment',
    blockComment,
    children => comment(requireToken(children[0]).value)
  );
  // `@page` pseudo-pages are header atoms, not selector syntax in a value
  // position. Preserve their one-token spelling without widening generic values.
  const DirectLessPagePseudo = node<Any>(
    'DirectLessPagePseudo',
    sequence(literal(':'), g.LessAstSyntaxKeyword),
    children => any(`:${requireToken(children[1]).value}`)
  );
  // Unknown at-rule functions are intentionally permissive.  This legacy Less
  // argument spelling is one opaque grammar fact—not two quoted strings around
  // a value—and remains available to any unknown function name.
  const DirectLessDoubledQuoteFunctionArgument = node<Any>(
    'DirectLessDoubledQuoteFunctionArgument',
    sequence(literal('""'), regex(/[^"()]+/), literal('""')),
    children => any(`""${requireToken(children[1]).value}""`)
  );
  // This is the AST reduction of the public Less `ArgCondition` grammar. Its
  // operands are bounded ordinary values; comparison/logical structure is added
  // only after those values have been recognized.
  const DirectLessFunctionConditionOperand = node<ValueNode>(
    'DirectLessFunctionConditionOperand',
    oneOrMore(sequence(not(directFunctionConditionStop), g.DirectLessTopSum)),
    children => {
      const values = children.filter(isValueNode);
      if (values.length === 0) throw new TypeError('Direct Less function condition lost its operand.');
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectLessFunctionConditionParen = node<FunctionConditionFact>(
    'DirectLessFunctionConditionParen',
    sequence(literal('('), g.DirectLessFunctionConditionOr, literal(')')),
    children => {
      const inner = children.find(isFunctionConditionFact);
      if (inner === undefined) throw new TypeError('Direct Less function condition lost its parenthesized operand.');
      return { guard: inner.guard, src: `(${inner.src})` };
    }
  );
  const DirectLessFunctionConditionTerm = node<FunctionConditionFact>(
    'DirectLessFunctionConditionTerm',
    sequence(
      optional(directFunctionConditionNot),
      choice(g.DirectLessFunctionConditionParen, g.DirectLessFunctionConditionOperand),
      optional(sequence(directFunctionConditionOperator, choice(g.DirectLessFunctionConditionParen, g.DirectLessFunctionConditionOperand)))
    ),
    children => {
      const nested = children.filter(isFunctionConditionFact);
      const values = children.filter(isValueNode);
      const operator = children.map(guardOperatorText).find((value): value is string => value !== null)?.trim();
      const left = nested[0] ?? (values[0] === undefined ? undefined : { guard: { g: 'truth' as const, value: values[0] }, src: functionConditionSource(values[0]) });
      const right = nested[1] ?? (values.length > 1 && values[1] !== undefined ? { guard: { g: 'truth' as const, value: values[1] }, src: functionConditionSource(values[1]) } : undefined);
      if (left === undefined) throw new TypeError('Direct Less function condition term lost its left operand.');
      let guard: MixinGuard;
      let src: string;
      if (operator === undefined) { guard = left.guard; src = left.src; }
      else {
        if (right === undefined || left.guard.g !== 'truth' || right.guard.g !== 'truth') throw new TypeError('Direct Less comparison requires value operands.');
        guard = { g: 'cmp', op: operator, left: left.guard.value, right: right.guard.value };
        src = `${left.src} ${operator} ${right.src}`;
      }
      const negated = children.some(child => typeof child === 'object' && child !== null && 'value' in child && child.value === 'not');
      return negated ? { guard: { g: 'not', inner: guard }, src: `not(${src})` } : { guard, src };
    }
  );
  const DirectLessFunctionConditionAnd = node<FunctionConditionFact>(
    'DirectLessFunctionConditionAnd',
    sequence(g.DirectLessFunctionConditionTerm, many(sequence(directFunctionConditionAnd, g.DirectLessFunctionConditionTerm))),
    children => foldFunctionCondition('and', children)
  );
  const DirectLessFunctionConditionOr = node<FunctionConditionFact>(
    'DirectLessFunctionConditionOr',
    sequence(g.DirectLessFunctionConditionAnd, many(sequence(directFunctionConditionOr, g.DirectLessFunctionConditionAnd))),
    children => foldFunctionCondition('or', children)
  );
  const DirectLessFunctionCondition = node<ValueNode>(
    'DirectLessFunctionCondition',
    g.DirectLessFunctionConditionOr,
    children => {
      const fact = children.find(isFunctionConditionFact);
      if (fact === undefined) throw new TypeError('Direct Less function condition lost its fact.');
      return condition(fact.guard, fact.src);
    }
  );
  // A math expression may claim a function argument only at an actual argument
  // boundary. This retains Less arithmetic, while allowing the value-term arm
  // to reduce a following space-list as one argument instead of accepting its
  // first scalar as a prefix.
  const DirectLessFunctionScalarArgument = node<ValueNode>(
    'DirectLessFunctionScalarArgument',
    sequence(g.DirectLessMathSum, regex(/(?=[,)])/)),
    children => requireValueNode(children[0])
  );
  const DirectLessFunctionArgument = node<ValueNode>(
    'DirectLessFunctionArgument',
    choice(
      sequence(not(not(sequence(scanTo(choice(directFunctionConditionAhead, regex(/[,)]/))), directFunctionConditionAhead))), g.DirectLessFunctionCondition),
      g.DirectLessFunctionScalarArgument,
      g.DirectLessFunctionValueTerm
    ),
    children => {
      const value = children.flat().find(isValueNode);
      if (value === undefined) throw new TypeError('Direct Less function argument lost its value.');
      return value;
    }
  );
  const DirectLessFunction = node<FunctionCall>(
    'DirectLessFunction',
    parser({ trivia: functionTrivia }, sequence(noTrivia(sequence(directFunctionName, literal('('))), optional(choice(g.DirectLessDoubledQuoteFunctionArgument, g.DirectLessDetachedRuleset, g.DirectLessFunctionArgument)), many(noTrivia(sequence(regex(/,[ \t]*/), choice(g.DirectLessDoubledQuoteFunctionArgument, g.DirectLessDetachedRuleset, g.DirectLessFunctionArgument)))), literal(')'))),
    (children) => {
      const name = requireToken(children[0]).value;
      const args: ValueNode[] = [];
      for (const child of children.slice(1, -1)) {
        if (isValueNode(child)) {
          args.push(child);
        }
      }
      return funcCall(name, args);
    }
  );
  // A detached ruleset is a call-argument form, not a general value atom.
  // Keep this argument-enabled function production out of DirectLessValueAtom
  // so a declaration value cannot acquire the call-only `{ … }` first set.
  const DirectLessCallArgumentFunction = node<FunctionCall>(
    'DirectLessCallArgumentFunction',
    sequence(noTrivia(sequence(directFunctionName, literal('('))), optional(g.DirectLessCallArgumentValue), many(noTrivia(sequence(regex(/,[ \t]*/), g.DirectLessCallArgumentValue))), literal(')')),
    children => {
      const name = requireToken(children[0]).value;
      return funcCall(name, children.slice(1, -1).filter(isValueNode));
    }
  );
  // Deprecated Less percent-format syntax is a normal existing function fact.
  // The glued `%(` opener keeps it distinct from the `%` arithmetic operator.
  const DirectLessFormatFunction = node<FunctionCall>(
    'DirectLessFormatFunction',
    sequence(noTrivia(literal('%(')), optional(sequence(not(literal('{')), g.DirectLessValueTerm)), many(noTrivia(sequence(regex(/,[ \t]*/), not(literal('{')), g.DirectLessValueTerm))), literal(')')),
    children => funcCall('%', children.slice(1, -1).filter(isValueNode))
  );
  // A bare call is a Less statement only with its terminator.  Keep this
  // distinct from DirectLessFunction, which is also a value atom and must not
  // consume a declaration/list boundary.
  const DirectLessFunctionStatement = node<FunctionCall>(
    'DirectLessFunctionStatement',
    sequence(g.DirectLessCallArgumentFunction, literal(';')),
    children => {
      const call = children.find(isFunctionCall);
      if (call === undefined) throw new TypeError('Direct Less function statement lost its call fact.');
      return call;
    }
  );
  // `calc()` is not an opaque generic call: its sole argument is the Less math
  // grammar, including nested arithmetic parentheses.  This gives the runtime
  // the existing Operation/Paren tree it needs for calc-safe evaluation.
  const DirectLessCalcFunction = node<FunctionCall>(
    'DirectLessCalcFunction',
    noTrivia(sequence(directCalcFunctionName, literal('('), g.DirectLessMathSum, literal(')'))),
    children => funcCall(requireToken(children[0]).value, [requireValueNode(children[2])])
  );
  // `~(...)` escapes its delimiters and makes the complete inner list the value
  // (rather than a math grouping). A `Paren` already has exactly the required
  // evaluation behavior for that typed list: a computed list loses its outer
  // parentheses, while the inner list remains indexable by `each()` and list
  // functions.  This is grammar construction, not a raw source-value escape.
  const DirectLessEscapedParen = node<ValueNode>(
    'DirectLessEscapedParen',
    noTrivia(sequence(literal('~('), g.DirectLessValue, literal(')'))),
    children => paren(requireValueNode(children[1]), true)
  );
  // A bare `(...)` is a math grouping in Less.  Function/mixin argument lists
  // have their own productions above; do not widen this value position into a
  // permissive raw list.
  const DirectLessParen = node<ValueNode>(
    'DirectLessParen',
    // Math itself is deliberately no-trivia so space-list and glued-sign rules
    // stay exact. Parentheses own their boundary gaps, including Less `//`
    // comments before the first or after the final operand.
    noTrivia(sequence(literal('('), optional(whitespace), g.DirectLessMathSum, optional(whitespace), literal(')'))),
    children => {
      const inner = children.find(isValueNode);
      if (inner === undefined) throw new TypeError('Direct Less parenthesized math lost its inner value.');
      return paren(inner);
    }
  );
  // CSS grid line names are a bracketed value atom, not a map accessor or an
  // opaque post-parse string. Keep the delimited grammar fact as one existing
  // raw value leaf; dynamic/interpolated grid names remain outside this slice.
  const DirectLessGridLineName = node<Any>(
    'DirectLessGridLineName',
    noTrivia(sequence(literal('['), g.DirectLessKeyword, literal(']'))),
    children => {
      const name = requireValueNode(children[1]);
      if (name.type !== 'Keyword') throw new TypeError('Direct Less grid line name requires a keyword fact.');
      return any(`[${name.src}]`);
    }
  );
  // A parenthesized `feature: value` is an ordinary typed Less value as well
  // as a media/container query fact: `@tablet: (min-width: @size)`.  Keep the
  // one canonical Paren(Operation(':')) reduction outside QueryValue so the
  // value and query grammars share it without a recursive query-value cycle.
  const DirectLessQueryColonFeature = node<ValueNode>(
    'DirectLessQueryColonFeature',
    sequence(literal('('), g.CssAstSyntaxProperty, regex(/:[ \t\n\r\f]*/), g.DirectLessMathSum, literal(')')),
    children => paren(operation(':', keyword(requireToken(children[1]).value), requireValueNode(children[3])))
  );
  const DirectLessValueAtom = node<ValueNode>(
    'DirectLessValueAtom',
    choice(attempt(g.DirectLessMixinReference), g.DirectLessInterpolatedValue, g.DirectLessEscapedQuoted, g.DirectLessQuoted, g.DirectLessVarIndirect, g.DirectLessVarReferenceChain, g.DirectLessVarReference, g.DirectLessPropReference, g.DirectLessCssCustomPropertyValue, g.DirectLessDimension, g.DirectLessColor, g.DirectLessNamedColor, g.DirectLessDynamicUrl, g.DirectLessStaticUrl, g.DirectLessCalcFunction, g.DirectLessFormatFunction, g.DirectLessFunction, g.DirectLessSelectorCapture, g.DirectLessEscapedParen, g.DirectLessQueryColonFeature, g.DirectLessParen, DirectLessGridLineName, g.DirectLessCssEscapeValue, DirectLessPercentEscape, g.DirectLessKeyword),
    children => requireValueNode(children[0])
  );
  // Signed numerics are already one Dimension leaf (`-2px`).  Less unary minus
  // is glued to a variable or grouping (`-@x`, `-(...)`); `- @x` is instead a
  // preserved space-list.  The direct grammar keeps that source-order/spacing
  // distinction rather than normalizing both spellings to negation.
  const DirectLessMathUnary = node<ValueNode>(
    'DirectLessMathUnary',
    choice(
      noTrivia(sequence(regex(/-(?=[(@])/), g.DirectLessValueAtom)),
      g.DirectLessValueAtom
    ),
    children => children.length === 1
      ? requireValueNode(children[0])
      : operation('*', dimension(-1, '', '-1'), requireValueNode(children[1]))
  );
  const DirectLessMathAtom = node<ValueNode>(
    'DirectLessMathAtom',
    g.DirectLessMathUnary,
    children => requireValueNode(children[0])
  );
  // Parenthesized and calc math follows Less precedence: product before sum,
  // both left-associative.  Top-level declarations deliberately exclude `/`:
  // with Less's default parens-division mode it is a preserved slash group, not
  // an eager division Operation.  The existing serializer already recognizes
  // that SpacedValue shape and reinterprets it only inside calc().
  const DirectLessMathProduct = node<ValueNode>(
    'DirectLessMathProduct',
    noTrivia(sequence(g.DirectLessMathAtom, many(sequence(directProductOperator, g.DirectLessMathAtom)))),
    foldOperation
  );
  const DirectLessMathSum = node<ValueNode>(
    'DirectLessMathSum',
    noTrivia(sequence(g.DirectLessMathProduct, many(sequence(directSumOperator, g.DirectLessMathProduct)))),
    foldOperation
  );
  const DirectLessTopProduct = node<ValueNode>(
    'DirectLessTopProduct',
    noTrivia(sequence(g.DirectLessMathAtom, many(sequence(directTopProductOperator, g.DirectLessMathAtom)))),
    foldOperation
  );
  const DirectLessTopSum = node<ValueNode>(
    'DirectLessTopSum',
    noTrivia(sequence(g.DirectLessTopProduct, many(sequence(directSumOperator, g.DirectLessTopProduct)))),
    foldOperation
  );
  // In Less's default `parens-division` mode a glued top-level `/` is not an
  // eager Operation. It is one parser-owned slash group that becomes division
  // only when a surrounding calc context consumes it.
  const DirectLessPreservedDivision = node<ValueNode>(
    'DirectLessPreservedDivision',
    noTrivia(sequence(g.DirectLessTopSum, oneOrMore(sequence(literal('/'), g.DirectLessTopSum)))),
    children => {
      const parts: ValueNode[] = [];
      for (const child of children) {
        if (isValueNode(child)) parts.push(child);
        else if (isTerminalText(child, '/')) parts.push(keyword('/'));
      }
      return { type: 'SpacedValue', parts, separators: Array.from({ length: parts.length - 1 }, () => '') };
    }
  );
  // Value pieces are separated by grammar-owned whitespace. Keeping that token
  // here is what lets canonical SpacedValue retain multiline CSS layout without
  // scanning/re-splitting a completed declaration value later.
  const DirectLessValuePiece = choice(g.DirectLessUnicodeRange, g.DirectLessPreservedDivision, g.DirectLessTopSum, g.DirectLessValueComment, literal('/'), literal('-'), literal('%'));
  const DirectLessValueTerm = node<ValueNode>(
    'DirectLessValueTerm',
    noTrivia(sequence(DirectLessValuePiece, many(sequence(field('separator', regex(/[ \t\n\r\f]+/)), DirectLessValuePiece)), many(noTrivia(g.DirectLessValueComment)))),
    (children, fields) => {
      const values = children.filter(child => isValueNode(child) || isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%')).map(child => isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%')
        ? keyword(requireTerminalText(child))
        : requireValueNode(child));
      const authoredSeparators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => requireTerminalText(separator.value));
      const separators = authoredSeparators.length === values.length - 1
        ? authoredSeparators
        : [...authoredSeparators, ...Array(Math.max(0, values.length - 1 - authoredSeparators.length)).fill('')];
      return values.length === 1 ? values[0]! : spaced(values, separators);
    }
  );
  // Function bodies use their own argument boundary rule, but comments *inside*
  // an argument are still output-bearing Less value syntax. This local value
  // term therefore keeps the ordinary comment piece while its scalar sibling
  // above leaves a completed argument's trailing trivia to `functionTrivia`.
  const DirectLessFunctionValuePiece = choice(
    g.DirectLessUnicodeRange,
    g.DirectLessPreservedDivision,
    g.DirectLessTopSum,
    g.DirectLessValueComment,
    literal('/'),
    literal('-'),
    literal('%')
  );
  const DirectLessFunctionValueTerm = node<ValueNode>(
    'DirectLessFunctionValueTerm',
    noTrivia(sequence(DirectLessFunctionValuePiece, many(sequence(field('separator', regex(/[ \t\n\r\f]+/)), DirectLessFunctionValuePiece)))),
    (children, fields) => {
      const values = children
        .filter(child => isValueNode(child) || isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%'))
        .map(child => isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%')
          ? keyword(requireTerminalText(child))
          : requireValueNode(child));
      const authoredSeparators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => requireTerminalText(separator.value));
      const separators = authoredSeparators.length === values.length - 1
        ? authoredSeparators
        : [...authoredSeparators, ...Array(Math.max(0, values.length - 1 - authoredSeparators.length)).fill('')];
      return values.length === 1 ? values[0]! : spaced(values, separators);
    }
  );
  const DirectLessValue = node<ValueNode>(
    'DirectLessValue',
    choice(
      // This transaction owns the WHOLE accessor-bearing value. Keeping it out
      // of ValueAtom means its typed mixin arguments do not recurse through the
      // same candidate before the required bracket fact has been established.
      attempt(sequence(g.DirectLessMixinReference, not(choice(directTopProductOperator, directSumOperator)))),
      sequence(g.DirectLessValueTerm, many(sequence(field('separator', regex(/,[ \t\n\r\f]*/)), g.DirectLessValueTerm)))
    ),
    (children, fields) => {
      const referenceValue = children.find(child => typeof child === 'object' && child !== null && 'type' in child && child.type === 'Reference');
      if (referenceValue !== undefined) return referenceValue as Reference;
      const values = children.filter(isValueNode);
      const separators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => requireTerminalText(separator.value));
      return values.length === 1 ? values[0]! : list(values, separators);
    }
  );
  // Variable declarations additionally permit Less trivia immediately after
  // `:` and after comma boundaries. A `//` line comment is trivia (never a CSS
  // value node), while the comma-separated value remains the normal List fact.
  const DirectLessVariableValue = node<ValueNode>(
    'DirectLessVariableValue',
    sequence(
      optional(whitespace),
      g.DirectLessValueTerm,
      many(sequence(field('separator', literal(',')), optional(whitespace), g.DirectLessValueTerm)),
      optional(sequence(literal(','), optional(whitespace))),
    ),
    (children, fields) => {
      const values = children.filter(isValueNode);
      const separators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => requireTerminalText(separator.value));
      return values.length === 1 ? values[0]! : list(values, separators);
    }
  );
  // `!important` is a grammar-owned declaration/value modifier.  Variables
  // carry the wrapper so references hoist importance once; declarations expose
  // their own flag.  Do not represent it as an opaque keyword/value suffix.
  const DirectLessImportant = node<Important>(
    'DirectLessImportant',
    // Priority syntax is token structure, not one glued source string: Less
    // accepts `!important`, `! important`, and `!/*comment*/important`.
    sequence(g.DirectLessValue, literal('!'), many(blockComment), g.CssAstSyntaxImportant),
    children => important(requireValueNode(children[0]))
  );
  // Less custom properties retain CSS declaration-value text.  The direct
  // route therefore treats every ordinary byte run as literal `Any` content,
  // but lets the shared strict `@{…}` grammar surface interpolation as typed
  // AST facts.  Delimiters, comments, and strings are grammar children—not a
  // captured source span—and nested delimiters are balanced before reduction.
  const DirectLessCustomPropertyName = node<string | Interpolation>(
    'DirectLessCustomPropertyName',
    choice(
      noTrivia(sequence(
        literal('--'),
        optional(choice(g.LessAstSyntaxInterpolatedCustomPropertyStart, g.LessAstSyntaxInterpolatedCustomPropertyDash)),
        g.DirectLessInterpolation,
        many(choice(g.LessAstSyntaxInterpolatedCustomPropertyTail, g.DirectLessInterpolation))
      )),
      g.LessAstSyntaxCustomProperty
    ),
    children => {
      if (!children.some(isInterpolationFact)) return requireToken(children[0]).value;
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolationFact(child)) parts.push({ ref: child.ref, unquote: false });
        else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolation(parts);
    }
  );
  const DirectLessCustomParen = node<readonly CustomValuePart[]>(
    'DirectLessCustomParen',
    noTrivia(sequence(literal('('), many(g.DirectLessCustomInnerPart), literal(')'))),
    children => customPartsFromChildren(children)
  );
  const DirectLessCustomSquare = node<readonly CustomValuePart[]>(
    'DirectLessCustomSquare',
    noTrivia(sequence(literal('['), many(g.DirectLessCustomInnerPart), literal(']'))),
    children => customPartsFromChildren(children)
  );
  const DirectLessCustomCurly = node<readonly CustomValuePart[]>(
    'DirectLessCustomCurly',
    noTrivia(sequence(literal('{'), many(g.DirectLessCustomInnerPart), literal('}'))),
    children => customPartsFromChildren(children)
  );
  const DirectLessCustomInnerPart: Combinator<CustomValuePart> = choice(
    g.DirectLessInterpolation,
    g.LessAstSyntaxCustomInnerContent,
    blockComment,
    g.LessAstSyntaxCustomSingleQuoted,
    g.LessAstSyntaxCustomDoubleQuoted,
    g.DirectLessCustomParen,
    g.DirectLessCustomSquare,
    g.DirectLessCustomCurly
  );
  const DirectLessCustomPart: Combinator<CustomValuePart> = choice(
    g.DirectLessInterpolation,
    g.LessAstSyntaxCustomOuterContent,
    blockComment,
    g.LessAstSyntaxCustomSingleQuoted,
    g.LessAstSyntaxCustomDoubleQuoted,
    g.DirectLessCustomParen,
    g.DirectLessCustomSquare,
    g.DirectLessCustomCurly
  );
  const DirectLessCustomValue = node<ValueNode>(
    'DirectLessCustomValue',
    noTrivia(many(g.DirectLessCustomPart)),
    children => customValueFromParts(customPartsFromChildren(children))
  );
  // A CSS custom-property token is a valid opaque value argument in Less
  // functions such as `var(--accent)`. It is not a Less declaration name here.
  const DirectLessCssCustomPropertyValue = node<Any>(
    'DirectLessCssCustomPropertyValue',
    g.LessAstSyntaxCustomProperty,
    children => any(requireToken(children[0]).value)
  );
  const DirectLessCustomDeclaration = node<Declaration>(
    'DirectLessCustomDeclaration',
    sequence(g.DirectLessCustomPropertyName, literal(':'), g.DirectLessCustomValue, optional(literal(';'))),
    children => {
      const name = children[0];
      // A custom property name may itself be an `Interpolation`, so choose the final
      // value child rather than treating the first AST value in this reduction
      // as the declaration value.
      const value = children.filter(isValueNode).at(-1);
      if (name === undefined || value === undefined) {
        throw new TypeError('Direct Less AST grammar produced an incomplete custom declaration.');
      }
      return decl(typeof name === 'string' ? name : name, value);
    }
  );
  const DirectLessInterpolatedProperty = node<Interpolation>(
    'DirectLessInterpolatedProperty',
    choice(
      noTrivia(sequence(optional(literal('*')), optional(literal('-')), optional(g.CssAstSyntaxInterpolatedPropertyStart), g.DirectLessInterpolation, many(choice(g.CssAstSyntaxInterpolatedPropertyTail, g.DirectLessInterpolation)))),
      noTrivia(sequence(literal('--'), optional(choice(g.LessAstSyntaxInterpolatedCustomPropertyStart, g.LessAstSyntaxInterpolatedCustomPropertyDash)), g.DirectLessInterpolation, many(choice(g.LessAstSyntaxInterpolatedCustomPropertyTail, g.DirectLessInterpolation))))
    ),
    children => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (typeof child === 'object' && child !== null && 'ref' in child && 'src' in child) {
          parts.push({ ref: (child as InterpolationFact).ref, unquote: false });
        } else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolation(parts);
    }
  );
  // A block comment between a property and `:` is authored declaration-name
  // syntax. Preserve it through the existing structural Interpolation name
  // representation; ordinary whitespace is retained only when such a comment
  // is present, while Less `//` comments remain non-output lexical trivia.
  const DirectLessDeclarationHeadTrivia: Combinator<DeclarationHeadTriviaFact> = choice(
    node<DeclarationHeadTriviaFact>('DirectLessDeclarationHeadBlockComment', blockComment,
      children => ({ text: requireToken(children[0]).value, outputBearing: true })),
    node<DeclarationHeadTriviaFact>('DirectLessDeclarationHeadWhitespace', regex(/[ \t\n\r\f]+/),
      children => ({ text: requireToken(children[0]).value, outputBearing: false })),
    node<DeclarationHeadTriviaFact>('DirectLessDeclarationHeadLineComment', regex(/\/\/[^\n\r]*/),
      () => ({ text: '', outputBearing: false }))
  );
  const DirectLessStandardDeclaration = node<Declaration>(
    'DirectLessStandardDeclaration',
    noTrivia(sequence(
      sequence(
        choice(
          g.DirectLessInterpolatedProperty,
          g.LessAstSyntaxNumericMapKey,
          g.LessAstSyntaxDeclarationProperty,
        ),
        many(DirectLessDeclarationHeadTrivia),
        optional(sequence(choice(literal('+_'), literal('+')), many(DirectLessDeclarationHeadTrivia))),
        literal(':')
      ),
      noTrivia(sequence(
        field('valueGap', regex(/[ \t\n\r\f]*/)),
        // Less accepts an explicit empty declaration value (`margin: ;`). Keep
        // it as a canonical empty opaque value rather than dropping the
        // declaration or falling back to a second parser.
        optional(choice(g.DirectLessImportant, sequence(not(literal('{')), g.DirectLessValue))),
      )),
      optional(literal(';'))
    )),
    (children, fields) => {
      // Property, delimiter, and value are independently recognized grammar
      // children; AST construction does not split or reclassify authored text.
      const rawName = children[0];
      // Parseman's optional branch is transparent when absent. Find the value
      // only after the property delimiter, because an interpolated property
      // name is itself an `Interpolation` value node.
      const mergeToken = children.find(child => typeof child === 'object' && child !== null && 'value' in child
        && ((child as Token).value === '+' || (child as Token).value === '+_'));
      const colonIndex = children.findIndex(child => isTerminalText(child, ':'));
      if (colonIndex < 0) throw new TypeError('Direct Less AST grammar produced no declaration delimiter.');
      const valueChild = children.slice(colonIndex + 1).find(isValueNode);
      const value = valueChild === undefined ? any('') : requireValueNode(valueChild);
      const merge = mergeToken === undefined ? null : requireToken(mergeToken).value === '+_' ? ' ' : ',';
      const valueGap = fields?.valueGap === undefined ? '' : requireTerminalText(requireField(fields, 'valueGap').value);
      // A lone line break after `:` is ordinary parser layout and canonicalizes
      // back to `: value`. Preserve the declaration break only when the value
      // itself carries multiline separator facts (grid-area style output).
      const valueOnNewLine = (valueGap.includes('\n') || valueGap.includes('\r'))
        && value.type === 'SpacedValue'
        && value.separators?.some(separator => separator.includes('\n') || separator.includes('\r')) === true;
      if (merge !== null && merge !== ',' && merge !== ' ') {
        throw new TypeError('Direct Less AST grammar produced an invalid declaration merge modifier.');
      }
      const headTrivia = children.filter(isDeclarationHeadTriviaFact);
      const name = headTrivia.some(trivia => trivia.outputBearing)
        ? (() => {
            const parts: Interpolation['parts'] = isInterp(rawName)
              ? [...rawName.parts]
              : [{ lit: requireTerminalText(rawName) }];
            for (const trivia of headTrivia) appendInterpolationLiteral(parts, trivia.text);
            return interpolation(parts);
          })()
        : rawName;
      if (isValueNode(value) && value.type === 'Important') {
        return decl(isInterp(name) ? name : requireToken(name).value, value.inner, merge, true, valueOnNewLine);
      }
      return decl(isInterp(name) ? name : requireToken(name).value, value, merge, false, valueOnNewLine);
    }
  );
  // Ordered before the ordinary value grammar: a `--*` declaration has the
  // custom-property semantics above, while every other property remains on the
  // typed Less value path.
  const DirectLessDeclaration: Combinator<Declaration> = choice(
    g.DirectLessCustomDeclaration,
    DirectLessStandardDeclaration
  );
  /** Less detached maps can use punctuation members (`<: %3c; #: %23;`).
   * This is a declaration fact with a non-CSS name, not an opaque body slice. */
  const DirectLessPunctuationMapDeclaration = node<Declaration>(
    'DirectLessPunctuationMapDeclaration',
    sequence(
      g.LessAstSyntaxPunctuationMapKey,
      literal(':'),
      optional(choice(g.DirectLessImportant, sequence(not(literal('{')), g.DirectLessValue))),
      optional(literal(';')),
    ),
    children => {
      const value = children.find(isValueNode);
      return decl(requireToken(children[0]).value, value === undefined ? any('') : value);
    },
  );
  const DirectLessComment = node<Comment>(
    'DirectLessComment',
    blockComment,
    children => comment(requireToken(children[0]).value)
  );
  // A parameter default stops before a line-comment signature boundary. The
  // ordinary value term deliberately treats a whitespace run as the start of a
  // next value piece; guard that transition here so `@x: 1 // note\n )` leaves
  // the comment to the signature rather than committing the whitespace first.
  const DirectLessMixinParamValueTerm = node<ValueNode>(
    'DirectLessMixinParamValueTerm',
    noTrivia(sequence(
      DirectLessValuePiece,
      many(sequence(field('separator', regex(/[ \t\n\r\f]+/)), not(regex(/\/\//)), DirectLessValuePiece)),
      many(noTrivia(g.DirectLessValueComment)),
    )),
    (children, fields) => {
      const values = children.filter(child => isValueNode(child) || isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%')).map(child => isTerminalText(child, '/') || isTerminalText(child, '-') || isTerminalText(child, '%')
        ? keyword(requireTerminalText(child))
        : requireValueNode(child));
      const authoredSeparators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => requireTerminalText(separator.value));
      const separators = authoredSeparators.length === values.length - 1
        ? authoredSeparators
        : [...authoredSeparators, ...Array(Math.max(0, values.length - 1 - authoredSeparators.length)).fill('')];
      return values.length === 1 ? values[0]! : spaced(values, separators);
    }
  );
  const DirectLessMixinParam: Combinator<Param> = choice(
    node<Param>(
      'DirectLessMixinRestParam',
      sequence(literal('@'), g.LessAstSyntaxVariableName, literal('...')),
      children => ({ name: requireToken(children[1]).value, rest: true })
    ),
    node<Param>('DirectLessMixinAnonymousRestParam', literal('...'), () => ({ rest: true })),
    node<Param>(
      'DirectLessMixinBoundParam',
      sequence(
        literal('@'),
        g.LessAstSyntaxVariableName,
        optional(sequence(
          literal(':'),
          choice(g.DirectLessDetachedRuleset, DirectLessMixinParamValueTerm),
          optional(whitespace),
        ))
      ),
      children => {
        const name = requireToken(children[1]).value;
        const value = children.at(-1);
        return isValueNode(value) ? { name, default: value } : { name };
      }
    ),
    node<Param>(
      'DirectLessMixinPatternParam',
      sequence(DirectLessMixinParamValueTerm, optional(whitespace)),
      children => ({ pattern: requireValueNode(children[0]) })
    )
  );
  const DirectLessMixinParamWithSignatureTrivia = node<Param>(
    'DirectLessMixinParamWithSignatureTrivia',
    sequence(g.DirectLessMixinParam, optional(whitespace), optional(mixinSignatureGap)),
    children => {
      const param = children.find(isParam);
      if (param === undefined) throw new TypeError('Direct Less mixin signature lost a Param fact.');
      return param;
    },
  );
  const DirectLessMixinParamSeparator = parser({ trivia: mixinSignatureTrivia }, choice(literal(','), literal(';')));
  const DirectLessMixinParamTrailingSeparator = parser({ trivia: mixinSignatureTrivia }, literal(';'));
  const DirectLessMixinParamClose = parser({ trivia: mixinSignatureTrivia }, literal(')'));
  // The signature owns trivia at every delimiter boundary: mixin name → `(`,
  // after `(`, between params/separators, after the final param, after `)`, and
  // before `when`/`{`. Delimiters remain explicit private field facts so the
  // grammar—not a post-parse text pass—decides where a comment belongs; public
  // AST v2 keeps its deliberately semantic `Param[]` surface.
  const DirectLessMixinParameterList = node<MixinParameterListFact>(
    'DirectLessMixinParameterList',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      field('open', literal('(')),
      optional(sequence(
        field('param', DirectLessMixinParamWithSignatureTrivia),
        many(sequence(
          field('separator', DirectLessMixinParamSeparator),
          field('param', DirectLessMixinParamWithSignatureTrivia),
        )),
        optional(field('trailingSeparator', DirectLessMixinParamTrailingSeparator)),
      )),
      field('close', DirectLessMixinParamClose),
    )),
    (_children, fields) => ({
      params: fields?.param === undefined
        ? []
        : requireFields(fields, 'param').map((param) => {
          if (!isParam(param.value)) throw new TypeError('Direct Less mixin signature produced a non-Param field.');
          return param.value;
        }),
    })
  );
  const DirectLessPositionalMixinCallArgument = node<MixinCallArgument>(
    'DirectLessPositionalMixinArgument',
    sequence(g.DirectLessCallArgumentValue, optional(literal('...'))),
    children => ({
      value: requireMixinCallArgumentValue(children[0]),
      ...(children.some(child => isTerminalText(child, '...')) ? { spread: true } : {})
    })
  );
  const DirectLessMixinCallArgument: Combinator<MixinCallArgument> = choice(
    node<MixinCallArgument>(
      'DirectLessNamedMixinArgument',
      sequence(literal('@'), g.LessAstSyntaxVariableName, literal(':'), g.DirectLessCallArgumentValue),
      children => ({ name: requireToken(children[1]).value, value: requireMixinCallArgumentValue(children[3]) })
    ),
    DirectLessPositionalMixinCallArgument
  );
  // In Less, a semicolon starts a new mixin argument group; commas *within*
  // that group form one list-valued argument. Keep the semicolon branch
  // transactional so ordinary comma-only calls retain their existing individual
  // argument shape.
  const DirectLessMixinArgumentGroup = node<MixinCallArgument>(
    'DirectLessMixinArgumentGroup',
    sequence(DirectLessPositionalMixinCallArgument, oneOrMore(sequence(literal(','), DirectLessPositionalMixinCallArgument))),
    children => {
      const args = children.filter(isMixinCallArgument);
      return { value: list(args.map(argument => argument.value as ValueNode), Array(Math.max(0, args.length - 1)).fill(', ')) };
    }
  );
  const DirectLessMixinArguments = node<readonly MixinCallArgument[]>(
    'DirectLessMixinArguments',
    choice(
      attempt(sequence(
        choice(g.DirectLessMixinArgumentGroup, DirectLessMixinCallArgument),
        literal(';'),
        optional(sequence(
          choice(g.DirectLessMixinArgumentGroup, DirectLessMixinCallArgument),
          many(sequence(literal(';'), choice(g.DirectLessMixinArgumentGroup, DirectLessMixinCallArgument))),
          optional(literal(';'))
        ))
      )),
      // A comma-only call has individual arguments. Once a semicolon appears,
      // Less switches to its semicolon-group grammar above; a mixed named
      // `@a: x, @b: y; @c: z` call is invalid and must not fall through.
      sequence(DirectLessMixinCallArgument, many(sequence(literal(','), DirectLessMixinCallArgument)), optional(literal(';')))
    ),
    children => mixinArgumentsFromChildren(children)
  );
  const DirectLessReferenceTail = choice<ReferenceTailFact>(
    node<ReferenceTailFact>(
      'DirectLessReferenceBracketTail',
      g.DirectLessInterpolationAccessor,
      children => {
        const accessor = children[0] as InterpolationAccessorFact;
        return { step: { type: 'BracketLookup', key: accessor.key, keyKind: accessor.keyKind }, src: `[${accessor.src}]` };
      }
    ),
    node<ReferenceTailFact>(
      'DirectLessReferenceDotTail',
      sequence(literal('.'), g.LessAstSyntaxVariableName),
      children => {
        const name = requireToken(children[1]).value;
        return { step: { type: 'DotLookup', name }, src: `.${name}` };
      }
    ),
    node<ReferenceTailFact>(
      'DirectLessReferenceCallTail',
      sequence(literal('('), optional(g.DirectLessMixinArguments), literal(')')),
      children => {
        const args = mixinArgumentsFromChildren(children);
        return { step: { type: 'Call', args }, src: `(${args.map(argument => `${argument.name === undefined ? '' : `@${argument.name}: `}${mixinArgumentSource(argument.value)}${argument.spread ? '...' : ''}`).join(', ')})` };
      }
    )
  );
  const DirectLessMixinCall = node<MixinCall>(
    'DirectLessMixinCall',
    sequence(
      directMixinName,
      many(DirectLessMixinPathTail),
      literal('('),
      optional(g.DirectLessMixinArguments),
      literal(')'),
      // A malformed guarded definition must not split into a bare mixin call
      // followed by a selector rule (`.m() when default { … }`). Definitions get
      // first choice above; this lookahead only blocks that invalid fallback.
      not(regex(/[ \t\n\r\f]*when(?![-\w])/)),
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
  // of this direct route: it is ambiguous with a selector/ruleset prefix.
  const DirectLessBareMixinCall = node<MixinCall>(
    'DirectLessBareMixinCall',
    sequence(directMixinName, many(DirectLessMixinPathTail), optional(literal('!important')), literal(';')),
    children => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const last = tails.at(-1);
      const call = mixinCall(last?.sel ?? head, []);
      const withPath = tails.length === 0
        ? call
        : {
            ...call,
            path: [
              { comb: ' ', sel: head },
              ...tails.slice(0, -1)
            ]
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
  const DirectLessFlatMixinCall = node<MixinCall>(
    'DirectLessFlatMixinCall',
    sequence(
      directMixinName,
      literal('('),
      optional(g.DirectLessMixinArguments),
      literal(')')
    ),
    children => mixinCall(requireToken(children[0]).value, mixinArgumentsFromChildren(children))
  );
  // `each()` can iterate the emitted declaration map of an existing static
  // namespaced MixinCall.  This is intentionally narrower than statement-level
  // calls: a namespace path is required, and call-level `!important`/`;` forms
  // are not iterable values.  The resulting `path` is the ordinary MixinCall
  // path already consumed by `forItemsFromMixinCall` / `expandCall`.
  const DirectLessNamespacedMixinCall = node<MixinCall>(
    'DirectLessNamespacedMixinCall',
    sequence(
      directMixinName,
      oneOrMore(DirectLessMixinPathTail),
      literal('('),
      optional(g.DirectLessMixinArguments),
      literal(')')
    ),
    children => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const last = tails.at(-1);
      if (last === undefined) throw new TypeError('Direct Less namespaced iterable lost its final mixin name.');
      return {
        ...mixinCall(last.sel, mixinArgumentsFromChildren(children)),
        path: [{ comb: ' ', sel: head }, ...tails.slice(0, -1)]
      };
    }
  );
  // A variable can retain a namespaced mixin call as its lazy map value. This
  // differs from the `each()` iterable route above because Less permits a
  // call-level `!important` modifier here; the established MixinCall flag
  // carries it without a raw-value recovery or a new AST node family.
  const DirectLessNamespacedMixinValue = node<MixinCall>(
    'DirectLessNamespacedMixinValue',
    sequence(
      directMixinName,
      oneOrMore(DirectLessMixinPathTail),
      literal('('),
      optional(g.DirectLessMixinArguments),
      literal(')'),
      optional(literal('!important')),
    ),
    children => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const last = tails.at(-1);
      if (last === undefined) throw new TypeError('Direct Less namespaced variable value lost its final mixin name.');
      const call = {
        ...mixinCall(last.sel, mixinArgumentsFromChildren(children)),
        path: [{ comb: ' ', sel: head }, ...tails.slice(0, -1)],
      };
      return children.some(child => isTerminalText(child, '!important')) ? { ...call, important: true } : call;
    },
  );
  // A static namespace/mixin invocation remains the existing typed MixinCall
  // (including its selector-path combinators).  Once it is followed by a map
  // lookup, the whole value is a Reference: its base stays dispatchable by the
  // proven namespace resolver and its dynamic accessors retain their ordered
  // typed steps. `attempt` is essential here: a `#DEF` color or ordinary mixin
  // prefix must be returned to the later value alternatives unless this grammar
  // reaches at least one complete bracket accessor.
  const DirectLessMixinReference = node<Reference>(
    'DirectLessMixinReference',
    sequence(
      directMixinName,
      many(DirectLessMixinPathTail),
      optional(sequence(
        literal('('),
        optional(g.DirectLessMixinArguments),
        literal(')')
      )),
      oneOrMore(g.DirectLessReferenceTail)
    ),
    children => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const terminal = tails.at(-1);
      const call = mixinCall(terminal?.sel ?? head, mixinArgumentsFromChildren(children));
      const base = tails.length === 0
        ? call
        : { ...call, path: [{ comb: ' ', sel: head }, ...tails.slice(0, -1)] };
      const hasCall = children.some(child => isTerminalText(child, '('));
      const baseRaw = `${head}${tails.map(tail => `${tail.comb}${tail.sel}`).join('')}${hasCall ? `(${base.args.map(argument => `${argument.name === undefined ? '' : `@${argument.name}: `}${mixinArgumentSource(argument.value)}${argument.spread ? '...' : ''}`).join(', ')})` : ''}`;
      return referenceWithTails(base, baseRaw, children.filter(isReferenceTailFact));
    }
  );
  const DirectLessReferenceCall = node<Reference>(
    'DirectLessReferenceCall',
    sequence(
      literal('@'), not(regex(/supports(?![-\w])/i)), g.LessAstSyntaxVariableName, literal('('),
      optional(g.DirectLessMixinArguments),
      literal(')'), optional(literal(';'))
    ),
    children => {
      const name = requireToken(children[1]).value;
      const args = mixinArgumentsFromChildren(children);
      return reference(variableReference(name, 'scoped'), [{ type: 'Call', args }], `@${name}()`);
    }
  );
  const DirectLessMixinGuardDefaultOperand = node<ValueNode>(
    'DirectLessMixinGuardDefaultOperand',
    regex(/default[ \t\n\r\f]*\([ \t\n\r\f]*\)(?![-\w])/),
    () => funcCall('default', [])
  );
  const DirectLessMixinGuardOperand = node<ValueNode>(
    'DirectLessMixinGuardOperand',
    // `default` has no bare guard spelling in Less. A complete `default()` is
    // a typed FunctionCall when used as a comparison operand; the evaluator
    // already supplies its mixin-dispatch value in that exact context.
    choice(
      DirectLessMixinGuardDefaultOperand,
      noTrivia(sequence(
        not(regex(/default(?![-\w])/)),
        choice(
          // Guard operands reuse the ordinary typed access References. The
          // namespace branch must backtrack for ordinary non-accessor colors.
          attempt(g.DirectLessMixinReference),
          g.DirectLessVarReferenceChain,
          g.DirectLessVarReference,
          g.DirectLessQuoted,
          g.DirectLessEscapedQuoted,
          g.DirectLessDimension,
          g.DirectLessColor,
          g.DirectLessNamedColor,
          g.DirectLessFunction,
          g.DirectLessKeyword
        )
      ))
    ),
    children => requireValueNode(children[0])
  );
  const DirectLessMixinGuardTerm = node<MixinGuard>(
    'DirectLessMixinGuardTerm',
    sequence(
      optional(regex(/not(?![-\w])/)),
      choice(
        node<MixinGuard>('DirectLessMixinGuardDefault', regex(/default[ \t\n\r\f]*\([ \t\n\r\f]*\)(?![-\w])/), () => ({ g: 'default' })),
        sequence(literal('('), g.DirectLessMixinGuardOr, literal(')')),
        sequence(g.DirectLessMixinGuardOperand, optional(sequence(directMixinGuardOperator, g.DirectLessMixinGuardOperand)))
      )
    ),
    children => {
      const nested = children.find(isMixinGuard);
      const values = children.filter(isValueNode);
      const operator = children.map(guardOperatorText).find((value): value is string => value !== null);
      let guard: MixinGuard;
      if (nested !== undefined) {
        guard = nested;
      } else {
        const left = values[0];
        if (left === undefined) {
          throw new TypeError('Direct Less AST grammar produced a guard without a value.');
        }
        if (operator === undefined) {
          guard = left.type === 'FunctionCall'
            ? { g: 'call', name: left.name, args: left.args }
            : { g: 'truth', value: left };
        } else {
          const right = values[1];
          if (right === undefined) {
            throw new TypeError('Direct Less AST grammar produced a comparison guard without a right operand.');
          }
          guard = { g: 'cmp', op: operator, left, right };
        }
      }
      return children.some(child => isTerminalText(child, 'not')) ? { g: 'not', inner: guard } : guard;
    }
  );
  const DirectLessMixinGuardAnd = node<MixinGuard>(
    'DirectLessMixinGuardAnd',
    sequence(g.DirectLessMixinGuardTerm, many(sequence(regex(/and(?![-\w])/), g.DirectLessMixinGuardTerm))),
    children => foldMixinGuards('and', children)
  );
  const DirectLessMixinGuardOr = node<MixinGuard>(
    'DirectLessMixinGuardOr',
    sequence(g.DirectLessMixinGuardAnd, many(sequence(choice(regex(/or(?![-\w])/), literal(',')), g.DirectLessMixinGuardAnd))),
    children => foldMixinGuards('or', children)
  );
  const DirectLessMixinGuard = node<MixinGuard>(
    'DirectLessMixinGuard',
    parser({ trivia: mixinGuardTrivia }, sequence(regex(/when(?![-\w])/), g.DirectLessMixinGuardOr)),
    children => {
      const guard = children.find(isMixinGuard);
      if (guard === undefined) {
        throw new TypeError('Direct Less AST grammar produced a missing mixin guard.');
      }
      return guard;
    }
  );
  // Scope the signature-only trivia through the opening `{`, then leave the
  // body to its ordinary statement grammar where block comments are CSS output.
  const DirectLessMixinSignature = node<MixinSignatureFact>(
    'DirectLessMixinSignature',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      field('name', directMixinName),
      field('parameters', g.DirectLessMixinParameterList),
      optional(mixinSignatureGap),
      optional(field('guard', DirectLessMixinGuard)),
      optional(mixinSignatureGap),
      field('open', literal('{')),
    )),
    (_children, fields) => {
      const name = requireField(fields, 'name').value;
      const parameters = requireField(fields, 'parameters').value;
      if (!isMixinParameterListFact(parameters)) {
        throw new TypeError('Direct Less mixin signature produced invalid header facts.');
      }
      const guardField = fields?.guard === undefined ? undefined : requireField(fields, 'guard').value;
      if (guardField !== undefined && !isMixinGuard(guardField)) {
        throw new TypeError('Direct Less mixin signature produced an invalid guard fact.');
      }
      return {
        name: requireTerminalText(name),
        params: parameters.params,
        ...(guardField === undefined ? {} : { guard: guardField }),
      };
    }
  );
  const DirectLessMixinDefinition = node<MixinDef>(
    'DirectLessMixinDefinition',
    sequence(
      DirectLessMixinSignature,
      many(choice(g.DirectLessImport, g.DirectLessPlugin, g.DirectLessDetachedRulesetDeclaration, g.DirectLessVarDeclaration, g.DirectLessSupportsBlock, g.DirectLessMediaContainerBlock, g.DirectLessReferenceCall, g.DirectLessKeyframes, g.DirectLessAtRuleBlock, g.DirectLessAtRuleStatement, g.DirectLessMixinDefinition, g.DirectLessMixinCall, g.DirectLessBareMixinCall, g.DirectLessEach, g.DirectLessFunctionStatement, g.DirectLessInlineExtendRule, g.DirectLessRuleset, g.DirectLessDeclaration, g.DirectLessComment, literal(';'))),
      optional(g.DirectLessFunction),
      literal('}'),
      optional(literal(';'))
    ),
    children => {
      const signature = children.find(isMixinSignatureFact);
      if (signature === undefined) throw new TypeError('Direct Less mixin definition lost its signature fact.');
      return mixinDef(signature.name, [...signature.params], children.filter(isStatement), signature.guard);
    }
  );
  const DirectLessEachName = node<string>(
    'DirectLessEachName',
    sequence(literal('@'), g.LessAstSyntaxVariableName),
    children => requireToken(children[1]).value
  );
  // Detached rulesets and `each()` callbacks are both statement containers.
  // Keep their accepted content on the same direct grammar path as normal Less
  // bodies: reductions above construct each canonical statement, and these
  // containers merely retain those typed children.  This is deliberately not a
  // CST/tree conversion or an opaque body fallback.
  const DirectLessBodyStatement = choice(
    DirectLessPunctuationMapDeclaration,
    g.DirectLessImport,
    g.DirectLessPlugin,
    g.DirectLessDetachedRulesetDeclaration,
    g.DirectLessVarDeclaration,
    g.DirectLessSupportsBlock,
    g.DirectLessMediaContainerBlock,
    g.DirectLessReferenceCall,
    g.DirectLessKeyframes,
    g.DirectLessAtRuleBlock,
    g.DirectLessAtRuleStatement,
    g.DirectLessMixinDefinition,
    g.DirectLessMixinCall,
    g.DirectLessBareMixinCall,
    g.DirectLessInlineExtendRule,
    g.DirectLessRuleset,
    g.DirectLessEach,
    g.DirectLessFunctionStatement,
    g.DirectLessDeclaration,
    g.DirectLessComment,
    literal(';')
  );
  const DirectLessDetachedRuleset = node<ValueNode>(
    'DirectLessDetachedRuleset',
    sequence(literal('{'), many(g.DirectLessBodyStatement), optional(g.DirectLessFunction), literal('}')),
    children => detachedRuleset(requireDetachedRulesetBody(children))
  );
  const DirectLessCallArgumentValue = node<MixinCallArgument['value']>(
    'DirectLessCallArgumentValue',
    choice(attempt(g.DirectLessFlatMixinCall), g.DirectLessDetachedRuleset, g.DirectLessValueTerm),
    children => {
      const value = children[0];
      if (isMixinCall(value) || isValueNode(value)) return value;
      throw new TypeError('Direct Less call argument must reduce to a value or typed mixin call.');
    }
  );
  const DirectLessEachCallback = node<LessEachCallback>(
    'DirectLessEachCallback',
    choice(
      sequence(
        literal('{'),
        many(g.DirectLessBodyStatement),
        optional(g.DirectLessFunction),
        literal('}')
      ),
      sequence(
        // Less anonymous mixin callbacks accept either `.(...) { ... }` or
        // `#(...) { ... }`; both lower to the same canonical For binding.
        choice(literal('.'), literal('#')), literal('('), g.DirectLessEachName,
        optional(sequence(choice(literal(','), literal(';')), g.DirectLessEachName, optional(sequence(choice(literal(','), literal(';')), g.DirectLessEachName)))),
        literal(')'), literal('{'),
        many(g.DirectLessBodyStatement),
        optional(g.DirectLessFunction),
        literal('}')
      )
    ),
    children => {
      if (requireToken(children[0]).value === '{') {
        return {
          binding: { kind: 'comma', names: ['value', 'key', 'index'] },
          rules: requireCallbackStatements(children.slice(1, -1))
        };
      }
      const names = children.filter((child): child is string => typeof child === 'string');
      const bodyStart = children.findIndex(child => isTerminalText(child, '{'));
      if (bodyStart < 0) {
        throw new TypeError('Direct Less AST grammar produced a named each() callback without a body.');
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
      throw new TypeError('Direct Less AST grammar produced an invalid each() callback binding.');
    }
  );
  const DirectLessEach = node<For>(
    'DirectLessEach',
    sequence(regex(/each(?![-_a-zA-Z0-9\u0080-\uffff])/i), literal('('), choice(g.DirectLessNamespacedMixinCall, g.DirectLessFlatMixinCall, g.DirectLessValue), choice(literal(','), literal(';')), g.DirectLessEachCallback, literal(')'), optional(literal(';'))),
    children => {
      const callback = children[4] as LessEachCallback;
      const iterable = children[2];
      return forNode(isMixinCall(iterable) ? iterable : requireValueNode(iterable), callback.rules, callback.binding);
    }
  );
  const DirectLessGeneralEnclosedRaw = node<string>(
    'DirectLessGeneralEnclosedRaw',
    noTrivia(choice(g.CssAstSyntaxBlockComment, directLessGeneralEnclosedText)),
    children => requireToken(children[0]).value
  );
  const DirectLessGeneralEnclosedQuoted = node<Interpolation>(
    'DirectLessGeneralEnclosedQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.DirectLessVariableInterpolation, directLessGeneralEnclosedDoubleChunk)), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.DirectLessVariableInterpolation, directLessGeneralEnclosedSingleChunk)), literal('\'')))
    ),
    generalEnclosedInterpolationFromChildren
  );
  const DirectLessGeneralEnclosedGroup = node<Interpolation>(
    'DirectLessGeneralEnclosedGroup',
    choice(
      noTrivia(sequence(literal('('), g.DirectLessGeneralEnclosedContent, literal(')'))),
      noTrivia(sequence(literal('['), g.DirectLessGeneralEnclosedContent, literal(']'))),
      noTrivia(sequence(literal('{'), g.DirectLessGeneralEnclosedContent, literal('}')))
    ),
    generalEnclosedInterpolationFromChildren
  );
  const DirectLessGeneralEnclosedContent = node<Interpolation>(
    'DirectLessGeneralEnclosedContent',
    noTrivia(many(choice(
      DirectLessGeneralEnclosedRaw,
      g.DirectLessVariableInterpolation,
      g.DirectLessGeneralEnclosedQuoted,
      g.DirectLessGeneralEnclosedGroup
    ))),
    generalEnclosedInterpolationFromChildren
  );
  const DirectLessGeneralEnclosedFunctionName = node<GeneralEnclosedNameFact>(
    'DirectLessGeneralEnclosedFunctionName',
    g.CssAstSyntaxQueryFunctionName,
    children => ({ name: requireToken(children[0]).value })
  );
  const DirectLessGeneralEnclosed = node<GeneralEnclosed>(
    'DirectLessGeneralEnclosed',
    choice(
      noTrivia(sequence(g.DirectLessGeneralEnclosedFunctionName, literal('('), g.DirectLessGeneralEnclosedContent, literal(')'))),
      noTrivia(sequence(literal('('), g.DirectLessGeneralEnclosedContent, literal(')')))
    ),
    children => {
      const content = children.find((child): child is Interpolation => typeof child === 'object' && child !== null && 'type' in child && child.type === 'Interpolation');
      if (content === undefined) throw new TypeError('Direct Less general-enclosed lost its grammar-owned content.');
      const name = children.find((child): child is GeneralEnclosedNameFact => typeof child === 'object' && child !== null && 'name' in child);
      return name === undefined ? generalEnclosed('paren', null, content) : generalEnclosed('function', name.name, content);
    }
  );
  // `@supports` has its own typed condition grammar. Keep this narrower than
  // ordinary Less values: feature values are static leaf facts, logical terms
  // and nested conditions retain their authored parentheses as `Paren`, and
  // functions/general-enclosed/dynamic forms fail instead of becoming raw text.
  const DirectLessSupportsValue = node<ValueNode>(
    'DirectLessSupportsValue',
    g.DirectLessValue,
    children => requireValueNode(children[0])
  );
  const DirectLessSupportsFeature = node<ValueNode>(
    'DirectLessSupportsFeature',
    choice(
      sequence(literal('('), g.CssAstSyntaxProperty, literal(')'),),
      sequence(literal('('), g.CssAstSyntaxProperty, literal(':'), g.DirectLessSupportsValue, literal(')'))
    ),
    children => {
      const property = keyword(requireToken(children[1]).value);
      return children.length === 3
        ? paren(property)
        : paren(operation(':', property, requireValueNode(children[3])));
    }
  );
  const DirectLessSupportsInParens = node<ValueNode>(
    'DirectLessSupportsInParens',
    choice(
      sequence(literal('('), g.DirectLessSupportsCondition, literal(')')),
      g.DirectLessSupportsFeature,
      g.DirectLessGeneralEnclosed
    ),
    children => children.length === 1
      ? requireValueNode(children[0])
      : paren(requireValueNode(children[1]))
  );
  const DirectLessSupportsCondition = node<ValueNode>(
    'DirectLessSupportsCondition',
    choice(
      sequence(g.CssAstSyntaxQueryNot, g.DirectLessSupportsInParens),
      sequence(g.DirectLessSupportsInParens, many(sequence(g.CssAstSyntaxQueryAndOr, g.DirectLessSupportsInParens)))
    ),
    children => {
      const values = children.map(child => isValueNode(child)
        ? child
        : keyword(requireToken(child).value));
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectLessSupportsBlock = node<AtRuleBlock>(
    'DirectLessSupportsBlock',
    sequence(
      g.CssAstSyntaxSupportsAtKeyword,
      choice(g.DirectLessAtRuleInterpolation, g.DirectLessSupportsCondition),
      literal('{'),
      many(choice(g.DirectLessImport, g.DirectLessPlugin, g.DirectLessDetachedRulesetDeclaration, g.DirectLessVarDeclaration, g.DirectLessSupportsBlock, g.DirectLessMediaContainerBlock, g.DirectLessReferenceCall, g.DirectLessKeyframes, g.DirectLessAtRuleBlock, g.DirectLessAtRuleStatement, g.DirectLessMixinDefinition, g.DirectLessMixinCall, g.DirectLessBareMixinCall, g.DirectLessEach, g.DirectLessFunctionStatement, g.DirectLessInlineExtendRule, g.DirectLessRuleset, g.DirectLessDeclaration, g.DirectLessComment, literal(';'))),
      optional(g.DirectLessFunction),
      literal('}')
    ),
    children => atRuleBlock(requireToken(children[0]).value, requireValueNode(children[1]), children.filter(isStatement))
  );
  // Media/container query syntax shares CSS's grammar-owned comparison terminal
  // and canonical `Paren(Operation)` shape. Less only supplies the additional
  // variable-bearing value leaves; it does not capture a query prelude as raw
  // text or run a second scanner over it.
  const DirectLessQueryValue = node<ValueNode>(
    'DirectLessQueryValue',
    choice(g.DirectLessPreservedDivision, g.DirectLessVarReferenceChain, g.DirectLessVarReference, g.DirectLessDimension, g.DirectLessColor, g.DirectLessNamedColor, g.DirectLessStaticQuoted, g.DirectLessCalcFunction, g.DirectLessFunction, g.DirectLessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectLessQueryBareFeature = node<ValueNode>(
    'DirectLessQueryBareFeature',
    sequence(literal('('), g.CssAstSyntaxProperty, literal(')')),
    children => paren(keyword(requireToken(children[1]).value))
  );
  const DirectLessQueryComparisonFeature = node<ValueNode>(
    'DirectLessQueryComparisonFeature',
    sequence(
      literal('('), g.CssAstSyntaxProperty, g.CssAstSyntaxQueryComparisonOperator, g.DirectLessQueryValue,
      optional(sequence(g.CssAstSyntaxQueryComparisonOperator, g.DirectLessQueryValue)), literal(')')
    ),
    children => {
      const values = children.filter(isValueNode);
      const operators = children.filter(child => {
        const text = typeof child === 'string' ? child : typeof child === 'object' && child !== null && 'value' in child ? child.value : null;
        return text === '<' || text === '<=' || text === '=' || text === '>=' || text === '>';
      }).map(requireTerminalText);
      if (values.length < 1 || operators.length < 1) throw new TypeError('Direct Less query comparison lost a value or operator.');
      let comparison = operation(operators[0]!, keyword(requireToken(children[1]).value), values[0]!);
      if (operators.length === 2) {
        if (values[1] === undefined) throw new TypeError('Direct Less chained query comparison lost its final value.');
        comparison = operation(operators[1]!, comparison, values[1]);
      }
      return paren(comparison);
    }
  );
  const DirectLessQueryRangeFeature = node<ValueNode>(
    'DirectLessQueryRangeFeature',
    sequence(
      literal('('), g.DirectLessQueryValue, g.CssAstSyntaxQueryComparisonOperator, g.CssAstSyntaxProperty,
      optional(sequence(g.CssAstSyntaxQueryComparisonOperator, g.DirectLessQueryValue)), literal(')')
    ),
    children => {
      const values = children.filter(isValueNode);
      const operators = children.filter(child => {
        const text = typeof child === 'string' ? child : typeof child === 'object' && child !== null && 'value' in child ? child.value : null;
        return text === '<' || text === '<=' || text === '=' || text === '>=' || text === '>';
      }).map(requireTerminalText);
      if (values.length < 1 || operators.length < 1) throw new TypeError('Direct Less query range lost a value or operator.');
      let comparison = operation(operators[0]!, values[0]!, keyword(requireToken(children[3]).value));
      if (operators.length === 2) {
        if (values[1] === undefined) throw new TypeError('Direct Less chained query range lost its final value.');
        comparison = operation(operators[1]!, comparison, values[1]);
      }
      return paren(comparison);
    }
  );
  // Container queries permit parenthesized boolean groups, for example
  // `((width < 500px) or (height < 500px))`. The individual features retain
  // their existing typed Paren(Operation) representation inside the group.
  const DirectLessQueryLogicalGroup = node<ValueNode>(
    'DirectLessQueryLogicalGroup',
    sequence(literal('('), g.DirectLessQueryFeature, oneOrMore(sequence(g.CssAstSyntaxQueryAndOr, g.DirectLessQueryFeature)), literal(')')),
    children => paren(spaced(children.filter(child => isValueNode(child) ? true : isTerminalText(child, 'and') || isTerminalText(child, 'or')).map(child => isValueNode(child) ? child : keyword(requireTerminalText(child)))))
  );
  // Container queries permit a nested negated condition, for example
  // `(not (height > 670px))`. It is a parenthesized structural query fact,
  // not an opaque at-rule header.
  const DirectLessQueryNegatedFeature = node<ValueNode>(
    'DirectLessQueryNegatedFeature',
    sequence(literal('('), g.CssAstSyntaxQueryNot, g.DirectLessQueryFeature, literal(')')),
    children => paren(spaced([keyword(requireToken(children[1]).value), requireValueNode(children[2])]))
  );
  const DirectLessQueryFeature = node<ValueNode>(
    'DirectLessQueryFeature',
    choice(DirectLessQueryBareFeature, DirectLessQueryColonFeature, DirectLessQueryComparisonFeature, DirectLessQueryRangeFeature, DirectLessQueryLogicalGroup, DirectLessQueryNegatedFeature),
    children => requireValueNode(children[0])
  );
  // `only` must modify a media type. It cannot introduce a parenthesized
  // condition (unlike `not`), so keep it out of the ordinary keyword arm.
  const DirectLessQueryNonOnlyKeyword = node<Keyword>(
    'DirectLessQueryNonOnlyKeyword',
    sequence(not(g.CssAstSyntaxQueryOnly), g.DirectLessKeyword),
    children => requireValueNode(children.at(-1)) as Keyword
  );
  // A media query comment is output-bearing syntax, not document trivia. Keep
  // it as a typed opaque value in the query sequence so `screen /* … */, print`
  // remains one direct grammar reduction and the serializer retains its bytes.
  const DirectLessQueryComment = node<Any>(
    'DirectLessQueryComment',
    g.CssAstSyntaxBlockComment,
    children => any(requireToken(children[0]).value)
  );
  const DirectLessQueryTerm = node<ValueNode>(
    'DirectLessQueryTerm',
    sequence(many(g.DirectLessQueryComment), choice(
      // A namespace/map read is a whole query term only after its required
      // accessor has succeeded; otherwise ordinary colors and mixin prefixes
      // continue to the existing query alternatives.
      attempt(g.DirectLessMixinReference),
      g.DirectLessQueryFeature,
      g.DirectLessVarReference,
      DirectLessQueryNonOnlyKeyword
    )),
    children => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectLessQueryOnlyClause = node<ValueNode>(
    'DirectLessQueryOnlyClause',
    sequence(
      g.CssAstSyntaxQueryOnly,
      DirectLessQueryNonOnlyKeyword,
      many(sequence(g.CssAstSyntaxQueryAndOr, DirectLessQueryTerm)),
      many(DirectLessQueryComment)
    ),
    children => spaced(children.map(child => isValueNode(child) ? child : keyword(requireTerminalText(child))))
  );
  const DirectLessQueryClause = node<ValueNode>(
    'DirectLessQueryClause',
    choice(
      DirectLessQueryOnlyClause,
      sequence(
        optional(g.CssAstSyntaxQueryNot),
        DirectLessQueryTerm,
        many(sequence(g.CssAstSyntaxQueryAndOr, DirectLessQueryTerm)),
        many(DirectLessQueryComment)
      )
    ),
    children => {
      const values = children
        .filter(child => child !== undefined && child !== null && child !== false)
        .map(child => isValueNode(child) ? child : keyword(requireTerminalText(child)));
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectLessQueryPrelude = node<ValueNode>(
    'DirectLessQueryPrelude',
    sequence(g.DirectLessQueryClause, many(sequence(literal(','), g.DirectLessQueryClause))),
    children => {
      const clauses = children.filter(isValueNode);
      return clauses.length === 1 ? clauses[0]! : list(clauses, Array(clauses.length - 1).fill(','));
    }
  );
  // Less permits a variable interpolation as an ordinary `@media` query term:
  // `@media @{all} and @{tv}`. That is not a container-query form, so retain
  // the stricter shared query prelude used by `@container` and construct this
  // media-only typed sequence from the same structural leaves.
  const DirectLessMediaQueryTerm = node<ValueNode>(
    'DirectLessMediaQueryTerm',
    choice(g.DirectLessAtRuleInterpolation, DirectLessQueryTerm),
    children => requireValueNode(children[0])
  );
  const DirectLessMediaQueryOnlyClause = node<ValueNode>(
    'DirectLessMediaQueryOnlyClause',
    sequence(
      g.CssAstSyntaxQueryOnly,
      DirectLessQueryNonOnlyKeyword,
      many(sequence(g.CssAstSyntaxQueryAndOr, DirectLessMediaQueryTerm)),
      many(DirectLessQueryComment)
    ),
    children => spaced(children.map(child => isValueNode(child) ? child : keyword(requireTerminalText(child))))
  );
  const DirectLessMediaQueryClause = node<ValueNode>(
    'DirectLessMediaQueryClause',
    choice(
      DirectLessMediaQueryOnlyClause,
      sequence(
        optional(g.CssAstSyntaxQueryNot),
        DirectLessMediaQueryTerm,
        many(sequence(g.CssAstSyntaxQueryAndOr, DirectLessMediaQueryTerm)),
        many(DirectLessQueryComment)
      )
    ),
    children => {
      const values = children
        .filter(child => child !== undefined && child !== null && child !== false)
        .map(child => isValueNode(child) ? child : keyword(requireTerminalText(child)));
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectLessMediaQueryPrelude = node<ValueNode>(
    'DirectLessMediaQueryPrelude',
    sequence(DirectLessMediaQueryClause, many(sequence(literal(','), DirectLessMediaQueryClause))),
    children => {
      const clauses = children.filter(isValueNode);
      return clauses.length === 1 ? clauses[0]! : list(clauses, Array(clauses.length - 1).fill(','));
    }
  );
  // A style query is a real typed container-header function. Its argument is a
  // structural custom-property comparison rather than an opaque header slice.
  const DirectLessContainerStyleQuery = node<FunctionCall>(
    'DirectLessContainerStyleQuery',
    sequence(noTrivia(sequence(regex(/style/i), literal('('))), g.LessAstSyntaxCustomProperty, literal(':'), g.DirectLessQueryValue, literal(')')),
    children => funcCall('style', [operation(':', keyword(requireToken(children[2]).value), requireValueNode(children[4]))])
  );
  // Container names are a separate leading grammar fact: `@container sidebar
  // (width > …)`.  It is not a media type and therefore must not widen the
  // shared media-query clause to accept an unjoined `screen (width > …)`.
  const DirectLessContainerQueryPrelude = node<ValueNode>(
    'DirectLessContainerQueryPrelude',
    choice(
      g.DirectLessContainerStyleQuery,
      sequence(g.DirectLessAtRuleInterpolation, g.DirectLessQueryPrelude),
      sequence(g.DirectLessKeyword, g.DirectLessQueryPrelude),
      g.DirectLessQueryPrelude
    ),
    children => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  // Media and container headers differ, but their child statement language is
  // one shared grammar production. Keep it shared so a valid nested Less
  // construct cannot become valid in one conditional at-rule but not the other.
  const DirectLessMediaContainerBody = node<readonly Statement[]>(
    'DirectLessMediaContainerBody',
    sequence(
      literal('{'),
      many(choice(g.DirectLessImport, g.DirectLessPlugin, g.DirectLessDetachedRulesetDeclaration, g.DirectLessVarDeclaration, g.DirectLessSupportsBlock, g.DirectLessMediaContainerBlock, g.DirectLessReferenceCall, g.DirectLessKeyframes, g.DirectLessAtRuleBlock, g.DirectLessAtRuleStatement, g.DirectLessMixinDefinition, g.DirectLessMixinCall, g.DirectLessBareMixinCall, g.DirectLessEach, g.DirectLessFunctionStatement, g.DirectLessInlineExtendRule, g.DirectLessRuleset, g.DirectLessDeclaration, g.DirectLessComment, literal(';'))),
      optional(g.DirectLessFunction),
      literal('}')
    ),
    children => children.filter(isStatement)
  );
  const DirectLessMediaContainerBlock = node<AtRuleBlock>(
    'DirectLessMediaContainerBlock',
    choice(
      sequence(g.CssAstSyntaxMediaAtKeyword, choice(DirectLessMediaQueryPrelude, g.DirectLessAtRuleInterpolation), g.DirectLessMediaContainerBody),
      sequence(g.CssAstSyntaxContainerAtKeyword, not(g.CssAstSyntaxQueryOnly), DirectLessContainerQueryPrelude, g.DirectLessMediaContainerBody)
    ),
    children => {
      const body = children.find(Array.isArray);
      if (body === undefined) throw new TypeError('Direct Less conditional at-rule lost its body facts.');
      return atRuleBlock(requireToken(children[0]).value, requireValueNode(children[1]), body as Statement[]);
    }
  );
  // Keyframes use the existing canonical AtRuleBlock + Rule shape. Keeping the
  // header and selector list structural avoids routing valid CSS keyframes
  // through the generic Less at-rule/ruleset combination, which cannot model
  // percentage selectors as selector facts.
  const DirectLessKeyframeSelector = node<SimpleSelector>(
    'DirectLessKeyframeSelector',
    choice(directLessKeyframeEndpoint, directLessKeyframePercent),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const DirectLessKeyframeBlock = node<Rule>(
    'DirectLessKeyframeBlock',
    sequence(
      g.DirectLessKeyframeSelector,
      // Selector comments have no canonical selector-node placement. Do not
      // accept and then misplace them in the keyframe rule body; body comments
      // remain structural statements in the following body production.
      many(sequence(literal(','), g.DirectLessKeyframeSelector)),
      literal('{'),
      many(choice(g.DirectLessComment, g.DirectLessDeclaration, g.DirectLessFunctionStatement, literal(';'))),
      optional(g.DirectLessFunction),
      literal('}')
    ),
    children => {
      const selectors = children.filter(isSimpleSelector)
        .map(selector => complexSelector([{ compound: compoundSelectorOf([selector]) }]));
      if (selectors.length === 0) throw new TypeError('Direct Less keyframe block requires a selector.');
      return rule(selist(...selectors), children.filter(isStatement));
    }
  );
  const DirectLessKeyframes = node<AtRuleBlock>(
    'DirectLessKeyframes',
    sequence(
      g.CssAstSyntaxKeyframesAtKeyword,
      many(g.DirectLessQueryComment),
      field('prelude', choice(g.DirectLessAtRuleInterpolation, g.DirectLessEscapedQuoted, g.DirectLessStaticQuoted, g.DirectLessKeyword)),
      many(g.DirectLessQueryComment),
      literal('{'),
      // Less permits a detached-ruleset call as a keyframes-body entry. Keep
      // that as the existing typed Reference fact so a parameterized keyframe
      // name and its body are both grammar-owned.
      many(choice(g.DirectLessComment, g.DirectLessReferenceCall, g.DirectLessKeyframeBlock)),
      literal('}')
    ),
    (children, fields) => {
      // The keyframes body may itself contain Reference values. Select header
      // facts only from the grammar region before `{`, rather than filtering
      // every value-shaped child in the whole production.
      requireField(fields, 'prelude');
      const bodyStart = children.findIndex(child => isTerminalText(child, '{'));
      if (bodyStart < 0) throw new TypeError('Direct Less keyframes lost its body boundary.');
      const preludeParts = children.slice(1, bodyStart).filter(isValueNode);
      if (preludeParts.length === 0) throw new TypeError('Direct Less keyframes lost their header fact.');
      return atRuleBlock(
        requireToken(children[0]).value,
        preludeParts.length === 1 ? preludeParts[0]! : spaced(preludeParts),
        children.filter(isStatement)
      );
    }
  );
  // A dotted layer name is one syntactic identifier, rather than a selector or
  // a post-parse string shape. Keep its spelling in the ordinary Keyword node.
  const DirectLessDottedAtRuleKeyword = node<ValueNode>(
    'DirectLessDottedAtRuleKeyword',
    sequence(directStaticIdentifier, oneOrMore(sequence(noTrivia(literal('.')), noTrivia(directStaticIdentifier)))),
    children => keyword(children.map(requireTerminalText).join(''))
  );
  const DirectLessStaticAtRuleCustomProperty = node<ValueNode>(
    'DirectLessStaticAtRuleCustomProperty',
    g.LessAstSyntaxCustomProperty,
    children => keyword(requireToken(children[0]).value)
  );
  // Generic at-rule headers have no parser-owned syntax-preserving evaluation
  // model for interpolation or parenthesized forms. Their direct subset stays
  // static; `@layer` gets its own typed interpolation alternative below.
  const DirectLessStaticAtRuleAtom = node<ValueNode>(
    'DirectLessStaticAtRuleAtom',
    choice(g.DirectLessEscapedQuoted, g.DirectLessStaticQuoted, g.DirectLessColor, g.DirectLessNamedColor, g.DirectLessDimension, g.DirectLessStaticUrl, g.DirectLessPagePseudo, g.DirectLessFunction, g.DirectLessParen, g.DirectLessDottedAtRuleKeyword, DirectLessStaticAtRuleCustomProperty, g.DirectLessKeyword),
    children => requireValueNode(children[0])
  );
  const DirectLessStaticAtRuleTerm = node<ValueNode>(
    'DirectLessStaticAtRuleTerm',
    oneOrMore(g.DirectLessStaticAtRuleAtom),
    children => {
      const values = children.map(requireValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectLessStaticAtRulePrelude = node<ValueNode>(
    'DirectLessStaticAtRulePrelude',
    sequence(g.DirectLessStaticAtRuleTerm, many(sequence(field('separator', regex(/,[ \t\n\r\f]*/)), g.DirectLessStaticAtRuleTerm))),
    (children, fields) => {
      const values = children.filter(isValueNode);
      const separators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => requireTerminalText(separator.value));
      return values.length === 1 ? values[0]! : list(values, separators);
    }
  );
  const DirectLessAtRuleBlock = node<AtRuleBlock>(
    'DirectLessAtRuleBlock',
    choice(
      sequence(
      directLayerAtRuleName,
      // Generic headers serialize as ordinary bytes. Their interpolation and
      // parenthesized forms need a dedicated syntax-preserving model, so this
      // direct route deliberately leaves them closed.
      // Keep an `@name(...)` form out of the generic at-rule fallback.  It is a
      // variable-call candidate. This direct slice only accepts its truthful
      // zero-argument form.
      not(noTrivia(literal('('))),
      optional(choice(g.DirectLessInterpolatedValue, g.DirectLessStaticAtRulePrelude)),
      literal('{'),
      many(choice(g.DirectLessImport, g.DirectLessPlugin, g.DirectLessDetachedRulesetDeclaration, g.DirectLessVarDeclaration, g.DirectLessSupportsBlock, g.DirectLessMediaContainerBlock, g.DirectLessReferenceCall, g.DirectLessKeyframes, g.DirectLessAtRuleBlock, g.DirectLessAtRuleStatement, g.DirectLessMixinDefinition, g.DirectLessMixinCall, g.DirectLessBareMixinCall, g.DirectLessEach, g.DirectLessFunctionStatement, g.DirectLessInlineExtendRule, g.DirectLessRuleset, g.DirectLessDeclaration, g.DirectLessComment, literal(';'))),
      optional(g.DirectLessFunction),
      literal('}')
      ),
      sequence(
      directAtRuleName,
      not(noTrivia(literal('('))),
      optional(g.DirectLessStaticAtRulePrelude),
      literal('{'),
      many(choice(g.DirectLessImport, g.DirectLessPlugin, g.DirectLessDetachedRulesetDeclaration, g.DirectLessVarDeclaration, g.DirectLessSupportsBlock, g.DirectLessMediaContainerBlock, g.DirectLessReferenceCall, g.DirectLessKeyframes, g.DirectLessAtRuleBlock, g.DirectLessAtRuleStatement, g.DirectLessMixinDefinition, g.DirectLessMixinCall, g.DirectLessBareMixinCall, g.DirectLessEach, g.DirectLessFunctionStatement, g.DirectLessInlineExtendRule, g.DirectLessRuleset, g.DirectLessDeclaration, g.DirectLessComment, literal(';'))),
      optional(g.DirectLessFunction),
      literal('}')
      )
    ),
    children => {
      const prelude = children.find(isValueNode) ?? null;
      // A FunctionCall is a legal statement *and* a legal generic prelude
      // component. Exclude the exact selected prelude object rather than
      // reclassifying it through text or weakening the statement grammar.
      const body = children.filter(isStatement).filter(statement => statement !== prelude);
      return atRuleBlock(requireToken(children[0]).value, prelude, body);
    }
  );
  const DirectLessAtRuleStatement = node<AtRuleStatement>(
    'DirectLessAtRuleStatement',
    choice(
      sequence(directLayerAtRuleName, not(noTrivia(literal('('))), optional(choice(g.DirectLessInterpolatedValue, g.DirectLessStaticAtRulePrelude)), literal(';')),
      sequence(directAtRuleName, not(noTrivia(literal('('))), optional(g.DirectLessStaticAtRulePrelude), literal(';'))
    ),
    children => atRuleStatement(requireToken(children[0]).value, children.find(isValueNode) ?? null)
  );
  const DirectLessStaticNthArgument = node<string>(
    'DirectLessStaticNthArgument',
    sequence(
      g.CssAstSyntaxNth,
      optional(sequence(regex(/of(?![-_a-zA-Z\u0080-\uffff])/i), parser({ trivia: staticSelectorTrivia }, g.DirectLessStaticPseudoSelector)))
    ),
    children => {
      const nth = requireToken(children[0]).value;
      const selector = children.find(isSelectorList);
      return selector === undefined ? nth : `${nth} of ${selector.selectors.map(complexCanonical).join(',')}`;
    }
  );
  const DirectLessStaticNthPseudo: Combinator<SimpleSelector> = choice(
    node<SimpleSelector>(
      'DirectLessStaticNthChildPseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(regex(/::?/), directStaticNthChildPseudoName, literal('('), g.DirectLessStaticNthArgument, literal(')'))),
      children => simpleSelector(`${requireToken(children[0]).value}${requireToken(children[1]).value}(${children[3] as string})`)
    ),
    node<SimpleSelector>(
      'DirectLessStaticNthTypePseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(regex(/::?/), directStaticNthTypePseudoName, literal('('), g.CssAstSyntaxNth, literal(')'))),
      children => simpleSelector(children.map(requireToken).map(token => token.value).join(''))
    )
  );
  const DirectLessStaticPseudoQuoted = node<string>(
    'DirectLessStaticPseudoQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.LessAstSyntaxQuotedDoubleChunk, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.LessAstSyntaxQuotedSingleChunk, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('\'')))
    ),
    children => children.map(child => typeof child === 'string' ? child : requireToken(child).value).join('')
  );
  const DirectLessStaticPseudoGroup = node<string>(
    'DirectLessStaticPseudoGroup',
    sequence(literal('('), many(choice(g.DirectLessStaticPseudoGroup, g.DirectLessStaticPseudoSquare, g.DirectLessStaticPseudoQuoted, blockComment, directLessStaticPseudoChunk)), literal(')')),
    children => children.map(child => typeof child === 'string' ? child : requireToken(child).value).join('')
  );
  const DirectLessStaticPseudoSquare = node<string>(
    'DirectLessStaticPseudoSquare',
    sequence(literal('['), many(choice(g.DirectLessStaticPseudoGroup, g.DirectLessStaticPseudoSquare, g.DirectLessStaticPseudoQuoted, blockComment, directLessStaticPseudoChunk)), literal(']')),
    children => children.map(child => typeof child === 'string' ? child : requireToken(child).value).join('')
  );
  const DirectLessStaticNonSelectorPseudoArgument = node<string>(
    'DirectLessStaticNonSelectorPseudoArgument',
    oneOrMore(choice(g.DirectLessStaticPseudoGroup, g.DirectLessStaticPseudoSquare, g.DirectLessStaticPseudoQuoted, blockComment, directLessStaticPseudoChunk)),
    children => children.map(child => typeof child === 'string' ? child : requireToken(child).value).join('')
  );
  // A functional pseudo's static selector argument is the same recursive
  // selector grammar as a rule header. `rules()` names the cycle at macro
  // lowering (`pseudo argument -> selector -> compound -> pseudo`), so this
  // retains structural selector facts without a text scanner or a reparse.
  // Keep it local, like CSS's generic pseudo argument: it is an implementation
  // component of the public pseudo production, not a second parser API.
  const DirectLessStaticPseudoArgument = node<string>(
    'DirectLessStaticPseudoArgument',
    parser({ trivia: staticSelectorTrivia }, g.DirectLessStaticPseudoSelector),
    children => {
      const selectors = requireSelectorList(children[0]);
      return selectors.selectors.map(complexCanonical).join(',');
    }
  );
  const DirectLessSelectorComment = node<SimpleSelector>(
    'DirectLessSelectorComment',
    // Keep authored layout attached to the output-bearing comment token. That
    // preserves `/* note */\n.foo` without inventing a selector relationship
    // or asking the renderer to recover discarded source whitespace.
    sequence(blockComment, optional(regex(/[ \t\n\r\f]+/))),
    children => simpleSelector(children.map(requireToken).map(token => token.value).join(''))
  );
  // This selector family is private to functional pseudo arguments.  A block
  // comment immediately between two simple selectors is lexical trivia, not a
  // descendant relation (`.a/*x*/.b` is one compound); actual whitespace still
  // belongs to the complex-tail descendant boundary.
  const DirectLessStaticPseudoCompound = node<CompoundSelector>(
    'DirectLessStaticPseudoCompound',
    noTrivia(sequence(
      choice(g.DirectLessStaticNamespaceType, staticSimpleSelector, staticAmpersand, g.DirectLessStaticNthPseudo, g.DirectLessStaticPseudo, g.DirectLessStaticAttribute, blockComment),
      many(choice(g.DirectLessStaticNamespaceType, staticSimpleSelector, staticAmpersand, g.DirectLessStaticNthPseudo, g.DirectLessStaticPseudo, g.DirectLessStaticAttribute, blockComment))
    )),
    children => compoundSelectorOf(children.flatMap(child => {
      if (isSimpleSelector(child)) return [child];
      const text = requireToken(child).value;
      return text.startsWith('/*') ? [] : [simpleSelector(text)];
    }))
  );
  // This selector family is private to functional pseudo arguments.  Its tail
  // admits Less selector trivia immediately before the next compound, so
  // `.a /* note */ > /* note */ .b` remains one structured complex selector.
  // The ordinary outer selector continues to use DirectLessComplexTail, whose
  // no-trivia compound boundary is intentionally unchanged.
  const DirectLessStaticPseudoComplexTail = node<ComplexTailFact>(
    'DirectLessStaticPseudoComplexTail',
    sequence(optional(staticCombinator), parser({ trivia: staticSelectorTrivia }, g.DirectLessStaticPseudoCompound)),
    children => {
      const compound = children.find(isCompound);
      if (compound === undefined) throw new TypeError('Direct Less pseudo selector tail has no compound.');
      const token = children.find(child => !isCompound(child));
      const comb = token === undefined ? ' ' : requireTerminalText(token);
      if (comb !== ' ' && comb !== '>' && comb !== '+' && comb !== '~' && comb !== '|' && comb !== '||') {
        throw new TypeError('Direct Less pseudo selector tail has an invalid combinator.');
      }
      return { comb, compound };
    }
  );
  const DirectLessStaticPseudoComplex = node<ComplexSelector>(
    'DirectLessStaticPseudoComplex',
    sequence(g.DirectLessStaticPseudoCompound, many(sequence(not(regex(/[ \t\n\r\f]*when(?![-\w])/i)), g.DirectLessStaticPseudoComplexTail))),
    children => complexSelector([
      { compound: requireCompound(children[0]) },
      ...children.slice(1).filter((tail): tail is ComplexTailFact => typeof tail === 'object' && tail !== null && 'comb' in tail && 'compound' in tail)
    ])
  );
  const DirectLessStaticPseudoSelectorTail = node<ComplexSelector>(
    'DirectLessStaticPseudoSelectorTail',
    sequence(literal(','), parser({ trivia: staticSelectorTrivia }, g.DirectLessStaticPseudoComplex)),
    children => requireComplex(children[1])
  );
  const DirectLessStaticPseudoSelector = node<SelectorList>(
    'DirectLessStaticPseudoSelector',
    sequence(g.DirectLessStaticPseudoComplex, many(g.DirectLessStaticPseudoSelectorTail)),
    children => selist(...requireComplexes(children))
  );
  // `*[ … ]` is only the glued capture delimiter around the existing static
  // selector-list grammar. It is a selector-valued Less value, not a text
  // capture: the selector grammar owns every branch boundary and the AST keeps
  // the canonical branches for selector interpolation.
  const DirectLessSelectorCapture = node<SelectorCapture>(
    'DirectLessSelectorCapture',
    sequence(noTrivia(literal('*[')), parser({ trivia: staticSelectorTrivia }, g.DirectLessStaticPseudoSelector), noTrivia(literal(']'))),
    children => {
      const selector = requireSelectorList(children[1]);
      const branches = selector.selectors.map(complexCanonical);
      return selectorCapture(branches, `*[${branches.join(', ')}]`);
    }
  );
  // `:extend(...)` is an inline-extend production, not a pseudo.  The direct
  // inline-extend reduction does not yet own block-comment trivia in that
  // header, but selector-pseudo trivia does; reject this form here rather than
  // silently reclassifying it as a SimpleSelector pseudo.
  const DirectLessExtendPseudoOpen = sequence(
    regex(/extend(?![-_a-zA-Z0-9\u0080-\uffff])/i),
    many(choice(regex(/[ \t\n\r\f]+/), blockComment)),
    literal('(')
  );
  const DirectLessStaticPseudo = choice(
    node<SimpleSelector>(
      'DirectLessStaticSelectorPseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(regex(/::?/), not(DirectLessExtendPseudoOpen), directStaticSelectorPseudoName, literal('('), DirectLessStaticPseudoArgument, literal(')'))),
      children => simpleSelector(`${requireToken(children[0]).value}${requireToken(children[1]).value}(${children[3] as string})`)
    ),
    node<SimpleSelector>(
      'DirectLessStaticNonSelectorPseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(
        regex(/::?/),
        not(choice(DirectLessExtendPseudoOpen, directStaticSelectorPseudoName, directStaticNthPseudoName)),
        g.LessAstSyntaxIdentifier,
        optional(sequence(literal('('), g.DirectLessStaticNonSelectorPseudoArgument, literal(')'))),
        // If a functional argument did not parse, do not fall back to a bare
        // pseudo and let an invalid Less variable body acquire another role.
        not(noTrivia(literal('(')))
      )),
      children => {
        const head = `${requireToken(children[0]).value}${requireToken(children[1]).value}`;
        return children.length === 2 ? simpleSelector(head) : simpleSelector(`${head}(${children[3] as string})`);
      }
    )
  );
  const DirectLessStaticAttributeNamespace = node<string>(
    'DirectLessStaticAttributeNamespace',
    choice(
      sequence(directStaticIdentifier, literal('|')),
      literal('*|'),
      literal('|')
    ),
    children => children.map(requireToken).map(token => token.value).join('')
  );
  const DirectLessStaticNamespaceType = node<SimpleSelector>(
    'DirectLessStaticNamespaceType',
    sequence(g.DirectLessStaticAttributeNamespace, choice(directStaticIdentifier, literal('*'))),
    children => simpleSelector(children.map(requireTerminalText).join(''))
  );
  const DirectLessStaticAttributeName = node<StaticAttributeNameFact>(
    'DirectLessStaticAttributeName',
    sequence(optional(g.DirectLessStaticAttributeNamespace), directStaticIdentifier),
    children => ({
      namespace: children.find((child): child is string => typeof child === 'string') ?? '',
      name: requireToken(children.at(-1)).value
    })
  );
  const DirectLessStaticAttributeQuoted = node<string>(
    'DirectLessStaticAttributeQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.LessAstSyntaxQuotedDoubleChunk, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.LessAstSyntaxQuotedSingleChunk, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('\'')))
    ),
    children => children.map(requireToken).map(token => token.value).join('')
  );
  // Less's attribute name/value interpolation is one complete selector token.
  // Keep every literal delimiter and every `@{…}` reference as an
  // `Interpolation` part rather than recovering the bracket text after parsing.
  // This deliberately admits only the existing Less variable interpolation
  // spelling; dynamic pseudos and extend headers remain separate, rejected forms.
  const DirectLessInterpolatedAttributeToken = node<Interpolation>(
    'DirectLessInterpolatedAttributeToken',
    noTrivia(sequence(
      optional(choice(g.LessAstSyntaxInterpolatedValueStart, g.LessAstSyntaxInterpolatedValueDash)),
      g.DirectLessVariableInterpolation,
      many(choice(g.LessAstSyntaxInterpolatedValueTail, g.DirectLessVariableInterpolation))
    )),
    children => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolationFact(child)) parts.push({ ref: child.ref, unquote: true });
        else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolation(parts);
    }
  );
  // Attribute-value interpolation differs from an interpolated attribute name:
  // a quoted Less variable must retain its quote bytes when it becomes the
  // unquoted source spelling `[data=@{value}]`.  Static keyword values are
  // unchanged; quoted values render as the corresponding quoted CSS selector.
  const DirectLessInterpolatedAttributeValueToken = node<Interpolation>(
    'DirectLessInterpolatedAttributeValueToken',
    noTrivia(sequence(
      optional(choice(g.LessAstSyntaxInterpolatedValueStart, g.LessAstSyntaxInterpolatedValueDash)),
      g.DirectLessVariableInterpolation,
      many(choice(g.LessAstSyntaxInterpolatedValueTail, g.DirectLessVariableInterpolation))
    )),
    children => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolationFact(child)) parts.push({ ref: child.ref, unquote: false });
        else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolation(parts);
    }
  );
  const DirectLessInterpolatedAttributeQuoted = node<Interpolation>(
    'DirectLessInterpolatedAttributeQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.DirectLessVariableInterpolation, g.LessAstSyntaxQuotedDoubleChunk, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal("'"), many(choice(g.DirectLessVariableInterpolation, g.LessAstSyntaxQuotedSingleChunk, literal('@'), literal('$'))), literal("'")))
    ),
    children => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolationFact(child)) parts.push({ ref: child.ref, unquote: true });
        else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolation(parts);
    }
  );
  const DirectLessStaticAttributeMatch = node<StaticAttributeMatchFact>(
    'DirectLessStaticAttributeMatch',
    sequence(
      g.CssAstSyntaxAttributeOperator,
      choice(directStaticIdentifier, g.DirectLessStaticAttributeQuoted),
      optional(sequence(selectorAttributeModifierSpace, g.CssAstSyntaxAttributeModifier))
    ),
    children => ({
      operator: requireToken(children[0]).value,
      value: typeof children[1] === 'string' ? children[1] : requireToken(children[1]).value,
      modifier: children.length === 2 ? null : requireToken(children[3]).value
    })
  );
  const DirectLessStaticAttribute = node<SimpleSelector>(
    'DirectLessStaticAttribute',
    sequence(literal('['), g.DirectLessStaticAttributeName, optional(g.DirectLessStaticAttributeMatch), literal(']')),
    children => {
      const match = children.find((child): child is StaticAttributeMatchFact =>
        typeof child === 'object' && child !== null && 'operator' in child && 'value' in child && 'modifier' in child
      );
      const name = children.find((child): child is StaticAttributeNameFact =>
        typeof child === 'object' && child !== null && 'namespace' in child && 'name' in child
      );
      if (name === undefined) throw new TypeError('Direct Less AST grammar produced an attribute selector without a name.');
      return simpleSelector(`[${name.namespace}${name.name}${match === undefined ? '' : `${match.operator}${match.value}${match.modifier === null ? '' : ` ${match.modifier}`}`}]`);
    }
  );
  const DirectLessInterpolatedAttribute = node<SimpleSelector>(
    'DirectLessInterpolatedAttribute',
    sequence(
      literal('['),
      choice(
        sequence(
          optional(g.DirectLessStaticAttributeNamespace),
          g.DirectLessInterpolatedAttributeToken,
          optional(sequence(
            g.CssAstSyntaxAttributeOperator,
            choice(g.DirectLessInterpolatedAttributeValueToken, g.DirectLessInterpolatedAttributeQuoted, g.LessAstSyntaxIdentifier, g.DirectLessStaticAttributeQuoted),
            optional(sequence(selectorAttributeModifierSpace, g.CssAstSyntaxAttributeModifier))
          ))
        ),
        sequence(
          g.DirectLessStaticAttributeName,
          g.CssAstSyntaxAttributeOperator,
          choice(g.DirectLessInterpolatedAttributeValueToken, g.DirectLessInterpolatedAttributeQuoted),
          optional(sequence(selectorAttributeModifierSpace, g.CssAstSyntaxAttributeModifier))
        )
      ),
      literal(']')
    ),
    children => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterp(child)) {
          for (const part of child.parts) {
            if ('lit' in part) appendInterpolationLiteral(parts, part.lit);
            else parts.push(part);
          }
        } else if (typeof child === 'object' && child !== null && 'namespace' in child && 'name' in child) {
          const name = child as StaticAttributeNameFact;
          appendInterpolationLiteral(parts, `${name.namespace}${name.name}`);
        } else if (typeof child === 'string') appendInterpolationLiteral(parts, child);
        else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const DirectLessBareInterpolatedSelector = node<SimpleSelector>(
    'DirectLessBareInterpolatedSelector',
    sequence(g.DirectLessVariableInterpolation, directBareInterpolatedSelectorEnd),
    children => {
      const fact = children[0] as InterpolationFact;
      return interpolatedSimpleSelector(interpolation([{ ref: fact.ref, unquote: true }]));
    }
  );
  // A bare interpolation may be followed by a glued selector simple, such as
  // `@{base}.bbb`. Keep that suffix as an interpolation literal segment rather
  // than recovering a completed selector string after parse.
  const DirectLessBareInterpolatedSelectorWithSuffix = node<SimpleSelector>(
    'DirectLessBareInterpolatedSelectorWithSuffix',
    noTrivia(sequence(g.DirectLessVariableInterpolation, oneOrMore(choice(directInterpolatedSelectorTail, staticSimpleSelector)))),
    children => {
      const fact = children[0] as InterpolationFact;
      const parts: Interpolation['parts'] = [{ ref: fact.ref, unquote: true }];
      for (const child of children.slice(1)) appendInterpolationLiteral(parts, requireToken(child).value);
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const DirectLessInterpolatedSimpleSelector = node<SimpleSelector>(
    'DirectLessInterpolatedSimpleSelector',
    noTrivia(sequence(
      directInterpolatedSelectorPrefix,
      g.DirectLessVariableInterpolation,
      many(choice(directInterpolatedSelectorTail, g.DirectLessVariableInterpolation))
    )),
    children => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolationFact(child)) parts.push({ ref: child.ref, unquote: true });
        else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  // `&` plus a glued Less interpolation is one parent-suffix selector token,
  // not a static parent selector followed by a second compound member. The
  // existing Interpolation-backed SimpleSelector is its complete canonical model.
  const DirectLessInterpolatedParentSuffix = node<SimpleSelector>(
    'DirectLessInterpolatedParentSuffix',
    noTrivia(sequence(
      staticAmpersand,
      g.DirectLessVariableInterpolation,
      many(choice(directInterpolatedSelectorTail, g.DirectLessVariableInterpolation))
    )),
    children => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolationFact(child)) parts.push({ ref: child.ref, unquote: true });
        else appendInterpolationLiteral(parts, requireToken(child).value);
      }
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const directLessNonCommentCompoundSimple = choice(
    g.DirectLessInterpolatedParentSuffix,
    g.DirectLessInterpolatedSimpleSelector,
    DirectLessBareInterpolatedSelectorWithSuffix,
    g.DirectLessBareInterpolatedSelector,
    g.DirectLessStaticNamespaceType,
    staticSimpleSelector,
    staticAmpersand,
    g.DirectLessStaticNthPseudo,
    g.DirectLessStaticPseudo,
    g.DirectLessStaticAttribute,
    g.DirectLessInterpolatedAttribute,
  );
  const DirectLessCompound: Combinator<CompoundSelector> = node<CompoundSelector>(
    'DirectLessCompound',
    // Production's CompoundSelector is a run of adjacent simple selectors.
    // Keep that same structural distinction here: `.a#id` is one CompoundSelector with
    // two SimpleSelector children, not a recovered selector string. Static pseudos use
    // the same canonical SimpleSelector representation. The exact shared An+B terminal
    // is also direct; arbitrary pseudo arguments, attributes, and interpolation
    // remain outside this slice until their own typed payloads have reductions.
    // The functional form precedes its no-argument prefix so ordered choice does
    // not commit `:nth-child` before seeing the opening parenthesis.
    noTrivia(oneOrMore(choice(directLessNonCommentCompoundSimple, DirectLessSelectorComment))),
    (children) => {
      const simples = children.map(child => isSimpleSelector(child) ? child : simpleSelector(requireToken(child).value));
      return compoundSelectorOf(simples);
    }
  );
  const DirectLessComplex = node<ComplexSelector>(
    'DirectLessComplex',
    sequence(
      optional(relativeSelectorCombinator),
      g.DirectLessCompound,
      many(sequence(not(regex(/[ \t\n\r\f]*when(?![-\w])/i)), g.DirectLessComplexTail))
    ),
    children => {
      const head = children.find(isCompound);
      if (head === undefined) throw new TypeError('Direct Less AST grammar produced a selector without a head compound.');
      const leading = children.find(child => isTerminalText(child, '>') || isTerminalText(child, '+') || isTerminalText(child, '~'));
      const tails = children.filter((tail): tail is ComplexTailFact => typeof tail === 'object' && tail !== null && 'comb' in tail && 'compound' in tail).map((tail): ComplexTailFact => {
        if (typeof tail !== 'object' || tail === null || !('comb' in tail) || !('compound' in tail)) {
          throw new TypeError('Direct Less AST grammar produced an invalid selector tail.');
        }
        return tail as ComplexTailFact;
      });
      // A list branch may start with CSS comments before its first selector
      // simple (`/* note */\n.foo`). There is no selector on the left for that
      // newline to separate, so Parseman's ordinary descendant tail would be
      // structurally false. Keep the comments as typed SimpleSelectors and
      // attach them to the first authored compound instead.
      const commentOnlyHead = head.simples.length > 0 && head.simples.every(simple => simple.interp === null && simple.text?.startsWith('/*'));
      if (commentOnlyHead && tails[0]?.comb === ' ') {
        const [firstTail, ...remainingTails] = tails;
        return complexSelector([
          { compound: compoundSelectorOf([...head.simples, ...firstTail.compound.simples]) },
          ...remainingTails,
        ], leading === undefined ? undefined : requireTerminalText(leading) as ComplexSelector['leadingComb']);
      }
      return complexSelector([
        { compound: head },
        ...tails,
      ], leading === undefined ? undefined : requireTerminalText(leading) as ComplexSelector['leadingComb']);
    }
  );
  const DirectLessComplexTail = node<ComplexTailFact>(
    'DirectLessComplexTail',
    sequence(optional(staticCombinator), g.DirectLessCompound),
    children => {
      const compound = children.find(isCompound);
      if (compound === undefined) {
        throw new TypeError('Direct Less AST grammar produced a selector tail without a compound.');
      }
      const token = children.find(child => !isCompound(child));
      const comb = token === undefined ? ' ' : requireTerminalText(token);
      if (comb !== ' ' && comb !== '>' && comb !== '+' && comb !== '~' && comb !== '|' && comb !== '||') {
        throw new TypeError('Direct Less AST grammar produced an invalid selector combinator.');
      }
      return { comb, compound };
    }
  );
  const DirectLessSelectorTail = node<ComplexSelector>(
    'DirectLessSelectorTail',
    sequence(literal(','), g.DirectLessComplex),
    children => requireComplex(children[1])
  );
  const DirectLessSelector = node<SelectorList>(
    'DirectLessSelector',
    // In selector position, Less block and line comments are lexical
    // whitespace. Scope that rule to the selector reduction: comments remain
    // output-bearing statements/values everywhere else.
    parser({ trivia: outerSelectorTrivia }, sequence(g.DirectLessComplex, many(g.DirectLessSelectorTail))),
    children => selist(...requireComplexes(children))
  );
  const directExtendAll = regex(/!?all(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const DirectLessStaticExtendCompound = node<CompoundSelector>(
    'DirectLessStaticExtendCompound',
    noTrivia(oneOrMore(choice(g.DirectLessStaticNamespaceType, staticSimpleSelector, staticAmpersand, g.DirectLessStaticNthPseudo, g.DirectLessStaticPseudo, g.DirectLessStaticAttribute, DirectLessSelectorComment))),
    children => compoundSelectorOf(children.filter(child => !isTerminalText(child, '/*')).map(child => isSimpleSelector(child) ? child : simpleSelector(requireToken(child).value)))
  );
  const DirectLessStaticExtendComplexTail = node<ComplexTailFact>(
    'DirectLessStaticExtendComplexTail',
    sequence(optional(staticCombinator), DirectLessStaticExtendCompound),
    children => {
      const compound = children.find(isCompound);
      if (compound === undefined) throw new TypeError('Direct Less static extend selector tail has no compound.');
      const token = children.find(child => !isCompound(child));
      const comb = token === undefined ? ' ' : requireTerminalText(token);
      if (comb !== ' ' && comb !== '>' && comb !== '+' && comb !== '~' && comb !== '|' && comb !== '||') {
        throw new TypeError('Direct Less static extend selector tail has an invalid combinator.');
      }
      return { comb, compound };
    }
  );
  const DirectLessExtendComplex = node<ComplexSelector>(
    'DirectLessExtendComplex',
    sequence(
      DirectLessStaticExtendCompound,
      many(sequence(not(regex(/[ \t\n\r\f]*!?all(?=[ \t\n\r\f]*(?:,|\)))/i)), DirectLessStaticExtendComplexTail))
    ),
    children => complexSelector([
      { compound: requireCompound(children[0]) },
      // The terminal-flag lookahead is a recognition-only child. Keep only
      // actual tail facts: otherwise the successful stop check is emitted as
      // a fake descendant tail with no compound.
      ...children.slice(1).filter((tail): tail is ComplexTailFact =>
        typeof tail === 'object' && tail !== null && 'comb' in tail && 'compound' in tail
      )
    ])
  );
  const DirectLessExtendTargetComplexTail = node<ComplexTailFact>(
    'DirectLessExtendTargetComplexTail',
    sequence(optional(staticCombinator), g.DirectLessCompound),
    children => {
      const compound = children.find(isCompound);
      if (compound === undefined) throw new TypeError('Direct Less extend target selector tail has no compound.');
      const token = children.find(child => !isCompound(child));
      const comb = token === undefined ? ' ' : requireTerminalText(token);
      if (comb !== ' ' && comb !== '>' && comb !== '+' && comb !== '~' && comb !== '|' && comb !== '||') {
        throw new TypeError('Direct Less extend target selector tail has an invalid combinator.');
      }
      return { comb, compound };
    }
  );
  const DirectLessExtendTargetComplex = node<ComplexSelector>(
    'DirectLessExtendTargetComplex',
    sequence(
      // An extend target can carry a typed selector interpolation, unlike its
      // inline subject. Keep `.@{name}` in the AST rather than rescanning it.
      g.DirectLessCompound,
      many(sequence(not(regex(/[ \t\n\r\f]*!?all(?=[ \t\n\r\f]*(?:,|\)))/i)), DirectLessExtendTargetComplexTail))
    ),
    children => complexSelector([
      { compound: requireCompound(children[0]) },
      ...children.slice(1).filter((tail): tail is ComplexTailFact =>
        typeof tail === 'object' && tail !== null && 'comb' in tail && 'compound' in tail
      )
    ])
  );
  const DirectLessExtendTarget = node<ExtendTargetFact>(
    'DirectLessExtendTarget',
    sequence(DirectLessExtendTargetComplex, optional(directExtendAll)),
    children => ({
      target: selist(requireComplex(children[0])),
      partial: children.some(child => isTerminalText(child, 'all') || isTerminalText(child, '!all'))
    })
  );
  const DirectLessExtendStatement = node<ExtendInstruction[]>(
    'DirectLessExtendStatement',
    sequence(literal('&:extend('), g.DirectLessExtendTarget, many(sequence(literal(','), g.DirectLessExtendTarget)), literal(')'), optional(literal(';'))),
    children => children.filter((child): child is ExtendTargetFact => typeof child === 'object' && child !== null && 'target' in child && 'partial' in child)
      .map(target => ({ target: target.target, partial: target.partial }))
  );
  const DirectLessInlineExtendBranch = node<InlineExtendBranchFact>(
    'DirectLessInlineExtendBranch',
    sequence(
      DirectLessExtendComplex,
      literal(':extend('),
      g.DirectLessExtendTarget,
      many(sequence(literal(','), g.DirectLessExtendTarget)),
      literal(')')
    ),
    children => {
      const subject = requireComplex(children[0]);
      const extensions = children
        .filter((child): child is ExtendTargetFact => typeof child === 'object' && child !== null && 'target' in child && 'partial' in child)
        .map(target => ({ target: target.target, partial: target.partial, subject: selist(subject) }));
      return { selector: subject, extensions };
    }
  );
  const DirectLessInlineExtendRule = node<Rule>(
    'DirectLessInlineExtendRule',
    sequence(
      // A selector list may carry an inline extend on more than one branch:
      // `.a:extend(.x), .b:extend(.y) {}`.  Keep every branch as a typed
      // fact so each instruction retains its own subject rather than folding
      // the whole selector list into either extend.
      many(sequence(DirectLessExtendComplex, literal(','))),
      DirectLessInlineExtendBranch,
      many(sequence(literal(','), choice(DirectLessInlineExtendBranch, DirectLessExtendComplex))),
      optional(g.DirectLessMixinGuard),
      literal('{'), many(choice(g.DirectLessBodyStatement, g.DirectLessExtendStatement)), optional(g.DirectLessFunction), literal('}'), optional(literal(';'))
    ),
    children => {
      const branches = children.filter((child): child is InlineExtendBranchFact =>
        typeof child === 'object' && child !== null && 'selector' in child && 'extensions' in child
      );
      const selector = selist(...children.flatMap(child => isComplex(child) ? [child] : (
        typeof child === 'object' && child !== null && 'selector' in child && 'extensions' in child
          ? [child.selector as ComplexSelector]
          : []
      )));
      const extensions = branches.flatMap(branch => branch.extensions);
      const body = children.filter(isStatement);
      const bodyExtensions = children.filter(Array.isArray).flat() as ExtendInstruction[];
      return rule(selector, body, [...extensions, ...bodyExtensions], children.find(isMixinGuard));
    }
  );
  const DirectLessRuleset = node<Rule>(
    'DirectLessRuleset',
    sequence(g.DirectLessSelector, optional(g.DirectLessMixinGuard), literal('{'), many(choice(g.DirectLessImport, g.DirectLessPlugin, g.DirectLessDetachedRulesetDeclaration, g.DirectLessVarDeclaration, g.DirectLessSupportsBlock, g.DirectLessMediaContainerBlock, g.DirectLessReferenceCall, g.DirectLessKeyframes, g.DirectLessAtRuleBlock, g.DirectLessAtRuleStatement, g.DirectLessMixinDefinition, g.DirectLessMixinCall, g.DirectLessBareMixinCall, g.DirectLessEach, g.DirectLessFunctionStatement, g.DirectLessInlineExtendRule, g.DirectLessRuleset, g.DirectLessDeclaration, g.DirectLessComment, g.DirectLessExtendStatement, literal(';'))), optional(g.DirectLessFunction), literal('}')),
    children => {
      const extensions = children.filter(Array.isArray).flat() as ExtendInstruction[];
      return rule(
      requireSelectorList(children[0]),
      // The fixed sequence places only direct declaration/comment facts between
      // the braces. This validates that fact list; it never reparses body text.
      requireRulesetBody(children.filter(isStatement)),
      extensions.length === 0 ? undefined : extensions,
      children.find(isMixinGuard)
    ); }
  );
  const LessAstDocument = node<Stylesheet>(
    'LessAstDocument',
    // A standalone root block comment must reduce before selector productions
    // may treat it as selector trivia for the following ruleset.
    sequence(many(choice(g.DirectLessComment, g.DirectLessImport, g.DirectLessPlugin, g.DirectLessDetachedRulesetDeclaration, g.DirectLessVarDeclaration, g.DirectLessSupportsBlock, g.DirectLessMediaContainerBlock, g.DirectLessReferenceCall, g.DirectLessKeyframes, g.DirectLessAtRuleBlock, g.DirectLessAtRuleStatement, g.DirectLessMixinDefinition, g.DirectLessInlineExtendRule, g.DirectLessMixinCall, g.DirectLessBareMixinCall, g.DirectLessEach, g.DirectLessFunctionStatement, g.DirectLessRuleset, g.DirectLessDeclaration)), optional(g.DirectLessFunction)),
    children => stylesheet(requireStatements(children)),
    { trailingTrivia: true }
  );

  return {
    LessAstDocument,
    DirectLessImport,
    DirectLessPlugin,
    DirectLessVarDeclaration,
    DirectLessDetachedRulesetDeclaration,
    DirectLessDetachedRuleset,
    DirectLessVarIndirect,
    DirectLessVarReferenceChain,
    DirectLessVarReference,
    DirectLessPropReference,
    DirectLessVariableInterpolation,
    DirectLessPropertyInterpolation,
    DirectLessInterpolation,
    DirectLessAtRuleInterpolation,
    DirectLessInterpolationAccessor,
    DirectLessReferenceTail,
    DirectLessInterpolatedValue,
    DirectLessInterpolatedProperty,
    DirectLessKeyword,
    DirectLessNamedColor,
    DirectLessColor,
    DirectLessDimension,
    DirectLessUnicodeRange,
    DirectLessCssEscapeValue,
    DirectLessPercentEscape,
    DirectLessValueComment,
    DirectLessPagePseudo,
    DirectLessDoubledQuoteFunctionArgument,
    DirectLessFunctionArgument,
    DirectLessFunctionScalarArgument,
    DirectLessFunctionValueTerm,
    DirectLessFunctionCondition,
    DirectLessFunctionConditionOr,
    DirectLessFunctionConditionAnd,
    DirectLessFunctionConditionTerm,
    DirectLessFunctionConditionOperand,
    DirectLessFunctionConditionParen,
    DirectLessFunction,
    DirectLessCallArgumentFunction,
    DirectLessFormatFunction,
    DirectLessCallArgumentValue,
    DirectLessFunctionStatement,
    DirectLessCalcFunction,
    DirectLessValueAtom,
    DirectLessSelectorCapture,
    DirectLessMathAtom,
    DirectLessMathUnary,
    DirectLessMathProduct,
    DirectLessMathSum,
    DirectLessTopProduct,
    DirectLessTopSum,
    DirectLessPreservedDivision,
    DirectLessEscapedParen,
    DirectLessParen,
    DirectLessValueTerm,
    DirectLessValue,
    DirectLessVariableValue,
    DirectLessImportant,
    DirectLessCustomPropertyName,
    DirectLessCustomPart,
    DirectLessCustomInnerPart,
    DirectLessCustomParen,
    DirectLessCustomSquare,
    DirectLessCustomCurly,
    DirectLessCustomValue,
    DirectLessCssCustomPropertyValue,
    DirectLessCustomDeclaration,
    DirectLessPunctuationMapDeclaration,
    DirectLessDeclaration,
    DirectLessComment,
    DirectLessMixinParam,
    DirectLessMixinParameterList,
    DirectLessMixinDefinition,
    DirectLessPositionalMixinCallArgument,
    DirectLessMixinArgumentGroup,
    DirectLessMixinArguments,
    DirectLessMixinCall,
    DirectLessBareMixinCall,
    DirectLessFlatMixinCall,
    DirectLessNamespacedMixinCall,
    DirectLessNamespacedMixinValue,
    DirectLessMixinPathTail,
    DirectLessMixinReference,
    DirectLessReferenceCall,
    DirectLessMixinGuard,
    DirectLessMixinGuardOr,
    DirectLessMixinGuardAnd,
    DirectLessMixinGuardTerm,
    DirectLessMixinGuardOperand,
    DirectLessEachName,
    DirectLessBodyStatement,
    DirectLessEachCallback,
    DirectLessEach,
    DirectLessSupportsValue,
    DirectLessSupportsFeature,
    DirectLessSupportsInParens,
    DirectLessSupportsCondition,
    DirectLessGeneralEnclosedContent,
    DirectLessGeneralEnclosedGroup,
    DirectLessGeneralEnclosedQuoted,
    DirectLessGeneralEnclosedFunctionName,
    DirectLessGeneralEnclosed,
    DirectLessSupportsBlock,
    DirectLessQueryValue,
    DirectLessQueryLogicalGroup,
    DirectLessQueryNegatedFeature,
    DirectLessQueryColonFeature,
    DirectLessQueryFeature,
    DirectLessQueryComment,
    DirectLessQueryClause,
    DirectLessQueryPrelude,
    DirectLessContainerStyleQuery,
    DirectLessMediaContainerBody,
    DirectLessMediaContainerBlock,
    DirectLessKeyframeSelector,
    DirectLessKeyframeBlock,
    DirectLessKeyframes,
    DirectLessDottedAtRuleKeyword,
    DirectLessStaticAtRuleAtom,
    DirectLessStaticAtRuleTerm,
    DirectLessStaticAtRulePrelude,
    DirectLessAtRuleBlock,
    DirectLessAtRuleStatement,
    DirectLessStaticPseudo,
    DirectLessStaticNthPseudo,
    DirectLessStaticNthArgument,
    DirectLessStaticNonSelectorPseudoArgument,
    DirectLessStaticPseudoGroup,
    DirectLessStaticPseudoSquare,
    DirectLessStaticPseudoQuoted,
    DirectLessStaticPseudoCompound,
    DirectLessStaticPseudoComplexTail,
    DirectLessStaticPseudoComplex,
    DirectLessStaticPseudoSelectorTail,
    DirectLessStaticPseudoSelector,
    DirectLessStaticAttributeNamespace,
    DirectLessStaticNamespaceType,
    DirectLessStaticAttributeName,
    DirectLessStaticAttributeQuoted,
    DirectLessStaticAttributeMatch,
    DirectLessStaticAttribute,
    DirectLessInterpolatedAttributeToken,
    DirectLessInterpolatedAttributeValueToken,
    DirectLessInterpolatedAttributeQuoted,
    DirectLessInterpolatedAttribute,
    DirectLessInterpolatedSimpleSelector,
    DirectLessBareInterpolatedSelector,
    DirectLessInterpolatedParentSuffix,
    DirectLessCompound,
    DirectLessComplexTail,
    DirectLessComplex,
    DirectLessSelectorTail,
    DirectLessSelector,
    DirectLessExtendComplex,
    DirectLessExtendTarget,
    DirectLessExtendStatement,
    DirectLessInlineExtendRule,
    DirectLessRuleset,
    DirectLessQuoted,
    DirectLessStaticQuoted,
    DirectLessEscapedQuoted,
    DirectLessStaticUrl,
    DirectLessUrlInterpolatedValue,
    DirectLessDynamicUrl,
    DirectLessImportOption,
    DirectLessImportOptions,
    DirectLessStaticTail,
    DirectLessStaticTailGroup,
    DirectLessStaticTailParen,
    whitespace
  };
})]);
