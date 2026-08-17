/**
 * Canonical Jess host-mode grammar.
 *
 * CSS base: ../../../css/css-parser/src/grammar.ts
 *
 * Jess adds and overrides:
 * - Language-specific features: $variables, modules, apply/mixin constructs,
 *   guards, ranges, collections, boundary blocks, declaration lookups, and
 *   Jess interpolation forms.
 * - Expanded CSS shapes: expression-bearing values, selector captures, static
 *   CSS headers/descriptors that deliberately reject Jess runtime forms, and
 *   the narrow dynamic at-rule/header leaves Jess actually supports.
 * - Jess extends CSS: unchanged CSS structure stays CSS-owned and this grammar
 *   overrides only the smallest changed child, value slot, or reference.
 * - The one place that rule is knowingly broken is the `calc()` math family
 *   (`CalcValue`/`CalcParen`/`CalcProduct`/`CalcSum`/`CalcFunction`), which is
 *   PORTED from the CSS base rather than referenced, because parseman cannot
 *   share a mutually recursive, AST-reducing family across packages. See the
 *   comment on those consts. Less and SCSS model the same ladder as
 *   `MathProduct`/`MathSum`; converging the four is an open decision.
 *   Shared preprocessor constructs belong in parser-shared only after they
 *   prove real reuse.
 *
 * The same factory builds the package AST route and the public positioned CST
 * route via Parseman's `hostMode`.
 */
import { attempt, balanced, choice, classifiedTrivia, composeLeaf, dispatch, endsWith, expect, field, keywords, label, literal, makeWhen, makeWord, many, noTrivia, node, not, oneOrMore, oneOrMoreSep, optional, otherwise, parser, peek, regex, routed, rules, scanTo, sequence, token, when, word } from 'parseman' with { type: 'macro' };
import type { Combinator, FieldCapture, FieldMap } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { opaqueAtRuleRecognition } from '@jesscss/parser-shared/opaque-at-rule';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';
import { any, anonymousMixin, apply, atRuleBlock, atRuleStatement, attributeSelector, block, callArg, color, selectorBranchCanonical, selectorBranchOf, condition, decl, collection, collectionEntry, declarationReference, dimension, expression, forNode, funcCall, ifNode, interpolation, isComplexSelector, isForBinding, isModuleImport, isRelativeSelector, isToken, keyword, keywordOrNull, NULL_NODE, list, lookupStep, mixinCall, mixinDef, moduleImport, opaqueAtRuleBlock, operation, cssBaseMathOutsideParens, propertyReference, pseudoSelector, quoted, range, reference, selectorCapture, selectorTermOf, styleImport, stylesheet, rule, selist, simpleSelector, interpolatedSimpleSelector, spaced, url, variableDeclaration, variableReference, whileNode, withBlockBody, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { Token, AnonymousMixin, Apply, AtRuleBlock, AtRuleStatement, Block, Color, Declaration, Collection, CollectionEntry, Dimension, ExtendInstruction, For, ForBinding, FunctionCall, If, IfBranch, InterpPart, Interpolation, Keyword, Null, MixinCall, MixinDefinition, ModuleImport, ModuleImportSpecifier, OpaqueAtRuleBlock, Param, Quoted, Range, PseudoSelector, Reference, SelectorBranch, SelectorCapture, SelectorTerm, Stylesheet, Ruleset, SelectorList, SimpleSelector, SimpleToken, Sequence, Statement, StyleImport, Url, ValueNode, ValueSlot, VariableDeclaration, Lookup, LookupStep, GuardNode, While } from '@jesscss/core/ast';
type ExpressionFact = { readonly value: ValueNode; readonly src: string };
type JessOperatorFact = { readonly value: string; readonly src: string };
type JessReferenceTail = { readonly step: Reference['steps'][number]; readonly src: string };
type JessComplexTail = { readonly combinator: ' ' | '>' | '+' | '~' | '||'; readonly term: SelectorTerm };
type JessQueryFeatureName = { readonly property: Keyword };
type JessAtRuleHeader = { readonly name: string; readonly prelude: ValueNode | null };
type JessMixinCallArgument = MixinCall['args'][number];

type JessRules = {
  Stylesheet: Combinator<Stylesheet>;
  VariableDeclaration: Combinator<VariableDeclaration>;
  ValueBlockDeclaration: Combinator<VariableDeclaration>;
  BlockLambda: Combinator<AnonymousMixin>;
  ExpressionLambda: Combinator<AnonymousMixin>;
  ValueBlock: Combinator<ValueNode>;
  VariableReference: Combinator<Lookup>;
  ExpressionScopedReference: Combinator<Lookup>;
  DeclarationReference: Combinator<Lookup>;
  ReferenceTail: Combinator<JessReferenceTail>;
  ReferenceCallTail: Combinator<JessReferenceTail>;
  DollarValue: Combinator<ValueNode>;
  DollarBrace: Combinator<Interpolation>;
  ExpressionDollarBrace: Combinator<ExpressionFact>;
  DollarInterp: Combinator<Interpolation>;
  InterpolatedValue: Combinator<Interpolation>;
  ExpressionDollarInterp: Combinator<ExpressionFact>;
  Expression: Combinator<Interpolation>;
  ExpressionInterpolation: Combinator<ExpressionFact>;
  ExpressionQuoted: Combinator<ExpressionFact>;
  ExpressionDeclarationReference: Combinator<ExpressionFact>;
  ExpressionCallArgument: Combinator<JessMixinCallArgument>;
  ExpressionReferenceCallTail: Combinator<JessReferenceTail>;
  ExpressionAtom: Combinator<ExpressionFact>;
  ExpressionProduct: Combinator<ExpressionFact>;
  ExpressionSum: Combinator<ExpressionFact>;
  ExpressionCompare: Combinator<ExpressionFact>;
  ExpressionNot: Combinator<ExpressionFact>;
  ExpressionLogicalOperand: Combinator<ExpressionFact>;
  ExpressionAnd: Combinator<ExpressionFact>;
  ExpressionOr: Combinator<ExpressionFact>;
  ExpressionLogical: Combinator<ExpressionFact>;
  GuardValue: Combinator<GuardNode>;
  GuardCompare: Combinator<GuardNode>;
  GuardCall: Combinator<GuardNode>;
  GuardPrimary: Combinator<GuardNode>;
  GuardAnd: Combinator<GuardNode>;
  GuardOr: Combinator<GuardNode>;
  MixinGuard: Combinator<GuardNode>;
  Keyword: Combinator<Keyword>;
  Quoted: Combinator<Quoted | Interpolation>;
  LiteralQuoted: Combinator<Quoted>;
  Dimension: Combinator<Dimension>;
  Color: Combinator<Color>;
  Url: Combinator<Url>;
  PlainUrlInner: Combinator<string>;
  UnquotedUrlText: Combinator<string>;
  UrlInterpolatedValue: Combinator<Interpolation>;
  CallComponent: Combinator<ValueSlot>;
  CallArgument: Combinator<ValueSlot>;
  KeywordValue: Combinator<Keyword | Null>;
  NullLiteral: Combinator<Null>;
  VarCall: Combinator<FunctionCall>;
  UnicodeRange: Combinator<ValueNode>;
  CalcValue: Combinator<ValueNode>;
  CalcParen: Combinator<ValueNode>;
  CalcProduct: Combinator<ValueNode>;
  CalcSum: Combinator<ValueNode>;
  MathDollarValue: Combinator<ValueNode>;
  CalcSequence: Combinator<ValueSlot>;
  calcFunctionArguments: Combinator<ValueSlot>;
  MathFunction: Combinator<FunctionCall>;
  IdentifierOrFunction: Combinator<ValueNode>;
  CollectionEntry: Combinator<CollectionEntry>;
  Collection: Combinator<Collection>;
  SquareValue: Combinator<ValueNode>;
  ValueAtom: Combinator<ValueNode>;
  ValueSpaceGroup: Combinator<ValueSlot>;
  ValueTerm: Combinator<ValueSlot>;
  Value: Combinator<ValueSlot>;
  Important: Combinator<true>;
  CustomPropertyValue: Combinator<Keyword>;
  InterpolatedCustomPropertyName: Combinator<string | Interpolation>;
  CustomPart: Combinator<unknown>;
  CustomInnerPart: Combinator<unknown>;
  CustomGroup: Combinator<readonly unknown[]>;
  CustomValue: Combinator<ValueNode>;
  CustomDeclaration: Combinator<Declaration>;
  Declaration: Combinator<Declaration>;
  MixinParam: Combinator<Param>;
  MixinParams: Combinator<Param[]>;
  MixinCallArgument: Combinator<JessMixinCallArgument>;
  MixinCall: Combinator<MixinCall>;
  ReferenceCall: Combinator<Reference>;
  Apply: Combinator<Apply>;
  Extend: Combinator<ExtendInstruction[]>;
  MixinDefinition: Combinator<MixinDefinition>;
  BasicSelector: Combinator<SimpleSelector>;
  Parent: Combinator<SimpleSelector>;
  InterpolatedSimple: Combinator<SimpleSelector>;
  InterpolatedParentSuffix: Combinator<SimpleSelector>;
  NamespaceTypeSelector: Combinator<SimpleSelector>;
  AttributeSelector: Combinator<SimpleSelector>;
  PseudoSelector: Combinator<SimpleToken>;
  PseudoSelectorArgument: Combinator<SelectorList>;
  GenericPseudoText: Combinator<string>;
  GenericPseudoComment: Combinator<string>;
  GenericPseudoEscape: Combinator<string>;
  GenericPseudoItem: Combinator<string>;
  GenericPseudoGroup: Combinator<string>;
  GenericPseudoArgument: Combinator<string>;
  CompoundSelector: Combinator<SelectorTerm>;
  PseudoSelectorCompound: Combinator<SelectorTerm>;
  PseudoSelectorComplex: Combinator<SelectorBranch>;
  PseudoSelectorTail: Combinator<SelectorBranch>;
  PseudoSelectorList: Combinator<SelectorList>;
  SelectorCapture: Combinator<SelectorCapture>;
  ComplexSelector: Combinator<SelectorBranch>;
  SelectorList: Combinator<SelectorList>;
  Ruleset: Combinator<Ruleset>;
  ForName: Combinator<string>;
  ForBinding: Combinator<ForBinding>;
  ForRangeBound: Combinator<ValueNode>;
  ForRange: Combinator<Range>;
  ForSource: Combinator<ValueNode>;
  For: Combinator<For>;
  IfCondition: Combinator<GuardNode>;
  IfGuardCompare: Combinator<GuardNode>;
  IfGuardPrimary: Combinator<GuardNode>;
  IfGuardAnd: Combinator<GuardNode>;
  IfGuardOr: Combinator<GuardNode>;
  IfGuard: Combinator<GuardNode>;
  IfBody: Combinator<Statement[]>;
  ElseIfBranch: Combinator<IfBranch>;
  ElseBranch: Combinator<IfBranch>;
  If: Combinator<If>;
  While: Combinator<While>;
  StyleImport: Combinator<StyleImport>;
  ModuleSpecifier: Combinator<ModuleImportSpecifier>;
  ModuleImport: Combinator<ModuleImport>;
  HeaderValueAtom: Combinator<ValueNode>;
  HeaderValue: Combinator<ValueSlot>;
  HeaderCallArgument: Combinator<ValueSlot>;
  QueryValue: Combinator<ValueNode>;
  QueryFeatureName: Combinator<JessQueryFeatureName>;
  QueryComparisonFeature: Combinator<ValueNode>;
  QueryNonOnlyKeyword: Combinator<Keyword>;
  QueryTerm: Combinator<ValueNode>;
  QueryFeature: Combinator<ValueNode>;
  QueryDashedIdentifier: Combinator<Keyword>;
  QueryClause: Combinator<ValueNode>;
  QueryPrelude: Combinator<ValueNode>;
  AtRulePrelude: Combinator<ValueNode | null>;
  ContainerQueryClause: Combinator<ValueNode>;
  ContainerQueryPrelude: Combinator<ValueNode>;
  ContainerPrelude: Combinator<ValueNode>;
  MediaPrelude: Combinator<ValueNode | null>;
  AtRuleStatementHeader: Combinator<JessAtRuleHeader>;
  AtRuleHeader: Combinator<JessAtRuleHeader>;
  SupportsAtom: Combinator<ValueNode>;
  GeneralTemplate: Combinator<Interpolation>;
  GeneralTemplateGroup: Combinator<Interpolation>;
  GeneralTemplateQuoted: Combinator<Interpolation>;
  GeneralQuotedTemplate: Combinator<Interpolation>;
  GeneralQuotedTemplateGroup: Combinator<Interpolation>;
  Enclosed: Combinator<FunctionCall | Block>;
  SupportsNot: Combinator<Keyword>;
  SupportsLogical: Combinator<Keyword>;
  SupportsFeature: Combinator<ValueNode>;
  SupportsInParens: Combinator<ValueNode>;
  SupportsCondition: Combinator<ValueNode>;
  Charset: Combinator<AtRuleStatement>;
  ImportStatement: Combinator<AtRuleStatement>;
  SupportsAtRuleBlock: Combinator<AtRuleBlock>;
  PropertyName: Combinator<Keyword>;
  PropertyDescriptor: Combinator<Declaration>;
  PropertyAtRule: Combinator<AtRuleBlock>;
  Percentage: Combinator<string>;
  KeyframeSelector: Combinator<SimpleSelector>;
  KeyframeBlock: Combinator<Ruleset>;
  Keyframes: Combinator<AtRuleBlock>;
  OpaqueAtPrelude: Combinator<string | null>;
  OpaqueBody: Combinator<string>;
  OpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  ScopeBlock: Combinator<AtRuleBlock>;
  AtRuleBlock: Combinator<AtRuleBlock>;
  AtRuleStatement: Combinator<AtRuleStatement>;
  rw: Combinator<unknown>;
  whitespace: Combinator<unknown>;
  typedAtRuleHeader: Combinator<unknown>;
  identifierOrFunction: Combinator<string>;
};

type SharedSyntax = {
  AttributeModifier: Combinator<string>;
  AttributeOperator: Combinator<string>;
  DoubleQuotedText: Combinator<string>;
  HexColor: Combinator<string>;
  ImportantToken: Combinator<string>;
  KeyframesAtKeyword: Combinator<string>;
  Identifier: Combinator<string>;
  NthExpression: Combinator<string>;
  NthOfKeyword: Combinator<string>;
  PseudoSelectorCloseAhead: Combinator<string>;
  NumberToken: Combinator<string>;
  InterpolatedPropertyStart: Combinator<string>;
  InterpolatedPropertyTail: Combinator<string>;
  CustomPropertyName: Combinator<string>;
  CustomOuterContent: Combinator<string>;
  CustomInnerContent: Combinator<string>;
  CustomSingleQuoted: Combinator<string>;
  CustomDoubleQuoted: Combinator<string>;
  QueryAndOr: Combinator<string>;
  QueryNot: Combinator<string>;
  QueryOnly: Combinator<string>;
  QueryComparisonOperator: Combinator<string>;
  ContainerAtKeyword: Combinator<string>;
  SupportsAtKeyword: Combinator<string>;
  SingleQuotedText: Combinator<string>;
  DimensionUnit: Combinator<string>;
  UnicodeRangeToken: Combinator<string>;
  UrlOpen: Combinator<string>;
  UrlInner: Combinator<string>;
  GenericAtRuleName: Combinator<string>;
  SimpleSelectorToken: Combinator<string>;
  PseudoSelectorColon: Combinator<string>;
  MediaAtKeyword: Combinator<string>;
  PreprocessorOpaqueAtRulePreludeCapture: Combinator<string | null>;
  PreprocessorOpaqueAtRuleBodyCapture: Combinator<string>;
};

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value)) {
    throw new TypeError('Jess grammar produced a non-token child.');
  }
  const token = value as { readonly value: unknown };
  if (typeof token.value !== 'string') {
    throw new TypeError('Jess grammar produced a non-token child.');
  }
  return { value: token.value };
}

function requireFields(fields: FieldMap | undefined, name: string): readonly FieldCapture[] {
  const field = fields?.[name];
  if (field === undefined) {
    throw new TypeError(`Jess grammar lost required ${name} field.`);
  }
  return Array.isArray(field) ? field : [field];
}

function jessCombinator(value: Token): JessComplexTail['combinator'] {
  if (value.value === '>' || value.value === '+' || value.value === '~' || value.value === '||') {
    return value.value;
  }
  return ' ';
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
    throw new TypeError('Jess grammar produced an invalid at-rule header.');
  }
  return value;
}

function isAtRuleNameToken(value: unknown): value is Token {
  return isToken(value)
    && !('type' in value)
    && value.value.startsWith('@');
}

function isSelectorTerm(value: unknown): value is SelectorTerm {
  return isSimpleToken(value)
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'CompoundSelector' && 'value' in value && Array.isArray(value.value));
}

function isSimpleSelector(value: unknown): value is SimpleSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'SimpleSelector'
    && 'text' in value && (typeof value.text === 'string' || value.text === null)
    && 'interp' in value && (isInterpolation(value.interp) || value.interp === null);
}

function isSelectorBranch(value: unknown): value is SelectorBranch {
  return isSelectorTerm(value) || isComplexSelector(value) || isRelativeSelector(value);
}

function isSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'SelectorList'
    && 'selectors' in value && Array.isArray(value.selectors)
    && value.selectors.every(isSelectorBranch);
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

const selectorTermFromTokens = (tokens: readonly SimpleToken[]): SelectorTerm =>
  selectorTermOf([tokens[0]!, ...tokens.slice(1)]);

function requireSelectorList(value: unknown): SelectorList {
  if (!isSelectorList(value)) {
    throw new TypeError('Jess grammar produced a non-selector-list child.');
  }
  return value;
}

function requireJessReferenceTail(value: unknown): JessReferenceTail {
  if (!isJessReferenceTail(value)) {
    throw new TypeError('Jess grammar produced an invalid reference tail.');
  }
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Jess grammar produced a non-string child.');
  }
  return value;
}

function requireInterpolation(value: unknown): Interpolation {
  if (!isInterpolation(value)) {
    throw new TypeError('Jess grammar produced a non-interpolation child.');
  }
  return value;
}

function requireKeyword(value: unknown): Keyword {
  if (!isValueNode(value) || value.type !== 'Keyword') {
    throw new TypeError('Jess grammar produced a non-keyword child.');
  }
  return value;
}

function staticSelectorText(selector: SelectorList): string {
  return selector.selectors.map(selectorBranchCanonical).join(', ');
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

/*
 * A `MixinParams` child: the only param-shaped reduction the grammar produces,
 * distinguished from every AST node by carrying `name` without a `type` tag.
 * The list form is what a lambda or mixin definition finds among its children,
 * and an empty parameter list is still that list.
 */
function isParam(value: unknown): value is Param {
  return typeof value === 'object' && value !== null && !('type' in value) && 'name' in value;
}

function isParamList(value: unknown): value is Param[] {
  return Array.isArray(value) && value.every(isParam);
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
      || value.type === 'Null'
      || value.type === 'Quoted'
      || value.type === 'Lookup'
      || value.type === 'Reference'
      || value.type === 'Color'
      || value.type === 'Dimension'
      || value.type === 'SelectorCapture'
      || value.type === 'FunctionCall'
      || value.type === 'Operation'
      || value.type === 'Condition'
      || value.type === 'Interpolation'
      || value.type === 'Sequence'
      || value.type === 'List'
      || value.type === 'Block'
      || value.type === 'Expression'
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
  if (value.type === 'Sequence') {
    return value.parts;
  }
  if (value.type === 'Block' && isSequence(value.value)) {
    return { ...value, value: value.value.parts };
  }
  return value;
}

function isSequence(value: ValueSlot): value is Sequence {
  return isValueNode(value) && value.type === 'Sequence';
}

function isValueSlotValue(value: unknown): value is ValueSlot {
  return Array.isArray(value) ? value.every(isValueSlotValue) : isValueNode(value);
}

function requireValueSlot(value: unknown): ValueSlot {
  return isValueNodeArray(value) ? value : valueSlot(requireValueNode(value));
}

function isJessMixinCallArgument(value: unknown): value is JessMixinCallArgument {
  /* `name` is ALWAYS present — `undefined` is what positional means — so its
   * absence is a reduced-shape defect, not a positional argument. */
  return typeof value === 'object' && value !== null && 'value' in value && isValueSlotValue(value.value)
    && 'name' in value && (value.name === undefined || typeof value.name === 'string');
}

function requireValueNode(value: unknown): ValueNode {
  if (!isValueNode(value)) {
    throw new TypeError('Jess grammar produced a non-value child.');
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
    case 'match':
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
    throw new TypeError('Jess grammar produced a non-guard child.');
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
    throw new TypeError('Jess grammar produced an invalid expression fact.');
  }
  return { value: value.value, src: value.src };
}

/*
 * An arithmetic/comparison operator boundary carries two facts: the operator
 * symbol itself and the exact authored bytes around it. They are identical for a
 * plain whitespace-flanked operator token, and differ only when the boundary
 * also carries a block comment, which the operator-boundary productions recognize
 * as grammar structure rather than trimming out of a token.
 */
function requireJessOperatorFact(value: unknown): JessOperatorFact {
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
    const operator = requireJessOperatorFact(children[index]);
    const right = requireExpressionFact(children[index + 1]);
    fact = {
      value: operation(
        operator.value,
        fact.value,
        right.value,
        false,
        cssBaseMathOutsideParens(operator.value)
      ),
      src: `${fact.src}${operator.src}${right.src}`
    };
  }
  return fact;
}

/**
 * A {@link Lookup} name is `string | ValueNode` now that `@@indirect` is spelled
 * as a node-valued name; a literal name is its own spelling, a node-valued one
 * defers to the expression printer.
 */
function lookupNameSource(name: string | ValueNode): string {
  return typeof name === 'string' ? name : expressionSource(name);
}

function expressionSource(value: ValueNode): string {
  switch (value.type) {
    case 'Keyword': case 'Null': case 'Color': case 'Dimension': case 'Quoted': case 'Any': return value.src;
    case 'Lookup': return value.kind === 'var'
      ? `${value.scope === 'scoped' ? '^' : '$'}${lookupNameSource(value.name)}`
      : value.raw;
    case 'Reference': return value.raw;
    case 'Operation': return `${expressionSource(value.left)} ${value.operator} ${expressionSource(value.right)}`;
    case 'Condition': return value.src;
    case 'Interpolation': return value.parts.map(part => 'lit' in part ? part.lit : expressionSource(part.ref)).join('');
    default: throw new TypeError(`Jess expression cannot preserve source for ${value.type}.`);
  }
}

/**
 * Fold one logical rung left-associatively (§4.5.5). The result is an
 * `Operation` carrying the word itself as its operator — the node that means
 * "return one of these operands, short-circuiting" — so the transpiled `.jess`
 * still reads `$a or $default` rather than a rewritten `$if` that duplicates
 * the operand and no direct author would write.
 */
function foldLogicalExpression(kind: 'and' | 'or', children: readonly unknown[]): ExpressionFact {
  const facts = children.filter(isExpressionFact);
  let fact = requireExpressionFact(facts[0]);
  for (let index = 1; index < facts.length; index += 1) {
    const right = facts[index]!;
    fact = {
      value: operation(kind, fact.value, right.value, false, cssBaseMathOutsideParens(kind)),
      src: `${fact.src} ${kind} ${right.src}`
    };
  }
  return fact;
}

function referenceBaseSource(value: ValueNode): string {
  switch (value.type) {
    case 'Lookup':
      if (value.kind === 'var') {
        return `${value.scope === 'scoped' ? '^' : '$'}${lookupNameSource(value.name)}`;
      }
      if (value.kind === 'entry') {
        return value.raw;
      }
      throw new TypeError(`Jess expression reference cannot start from ${value.type}.`);
    default: throw new TypeError(`Jess expression reference cannot start from ${value.type}.`);
  }
}

/** A member step is a `LookupStep` whose name is a literal — the old `DotLookup`. */
function isMemberStep(step: JessReferenceTail['step'] | undefined): boolean {
  return step?.type === 'LookupStep' && typeof step.name === 'string';
}

function declarationMemberReferenceFromVariableBase(
  base: Lookup,
  tails: readonly JessReferenceTail[]
): Reference | null {
  if (base.scope !== 'live' || base.name === 'type' || !isMemberStep(tails[0]?.step)) {
    return null;
  }
  return reference(
    declarationReference('$'),
    [
      lookupStep('member', base.name),
      ...tails.map(tail => tail.step)
    ],
    `$${lookupNameSource(base.name)}${tails.map(tail => tail.src).join('')}`
  );
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
    return interpolation([{ ref: variableReference(
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
  if (requireToken(children[1]).value !== '[') {
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
  const head = requireToken(children[2]).value;
  if (head === '$') {
    const named = variableReference(
      requireToken(children[3]).value,
      'live'
    );
    if (span) {
      withSourceSpan(
        named,
        span
      );
    }
    return interpolation([{ ref: variableReference(
      named,
      'live'
    ), unquote: true }]);
  }
  const name = head === '"' || head === '\'' ? requireToken(children[3]).value : head;
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
    case 'Keyword': case 'Null': case 'Color': case 'Dimension': case 'Quoted': case 'Any': return value.src;
    case 'Lookup': return value.kind === 'var'
      ? `${value.scope === 'scoped' ? '$^' : '$'}${lookupNameSource(value.name)}`
      : value.raw;
    case 'Reference': return value.raw;
    case 'Operation': case 'Condition': case 'Interpolation': return expressionSource(value);
    default: return '';
  }
}

function tokenSource(children: readonly unknown[]): string {
  return children.map(requireToken).map(token => token.value).join('');
}

function sourceFromState(state: unknown): string | undefined {
  return typeof state === 'object'
    && state !== null
    && 'source' in state
    && typeof state.source === 'string'
    ? state.source
    : undefined;
}

function interpolationValue(child: unknown): Interpolation {
  if (isInterpolation(child)) {
    return child;
  }
  const fact = requireExpressionFact(child);
  if (!isInterpolation(fact.value)) {
    throw new TypeError('Jess quoted expression produced a non-interpolation fact.');
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
            throw new TypeError('Jess expression quote lost interpolation source.');
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
        value,
        false,
        cssBaseMathOutsideParens(':')
      ));
}

function functionOpenName(child: unknown): string {
  const value = requireToken(child).value;
  return value.endsWith('(') ? value.slice(0, -1) : value;
}

function requireStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isVarDeclaration(child) && !isMixinDefinition(child) && !isMixinCall(child) && !isApply(child) && !isReferenceCall(child) && !isRuleset(child) && !isFor(child) && !isIf(child) && !isWhile(child) && !isDeclaration(child) && !isStyleImport(child) && !isModuleImport(child) && !isAtRuleBlock(child) && !isAtRuleStatement(child) && !isOpaqueAtRuleBlock(child)) {
      throw new TypeError('Jess grammar produced a non-statement child.');
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
    throw new TypeError('Jess grammar produced a non-statement list.');
  }
  return requireStatements(value);
}

function isIfBranch(value: unknown): value is IfBranch {
  return typeof value === 'object' && value !== null
    && 'guard' in value && (value.guard === null || isGuardNode(value.guard))
    && 'rules' in value && Array.isArray(value.rules);
}

function requireIfBranch(value: unknown): IfBranch {
  if (!isIfBranch(value)) {
    throw new TypeError('Jess grammar produced an invalid conditional branch.');
  }
  return { guard: value.guard, rules: requireStatementList(value.rules) };
}

function requireIfBranchArray(value: unknown): IfBranch[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Jess grammar produced an invalid conditional branch list.');
  }
  return value.map(requireIfBranch);
}

function requireIfBranchTuple(value: IfBranch[]): [IfBranch, ...IfBranch[]] {
  const first = value[0];
  if (first === undefined) {
    throw new TypeError('Jess grammar produced an empty conditional branch list.');
  }
  return [first, ...value.slice(1)];
}

function requireForBinding(value: unknown): ForBinding {
  if (!isForBinding(value)) {
    throw new TypeError('Jess grammar produced an invalid for binding.');
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

function isReferenceCall(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Reference';
}

function isQuoted(value: unknown): value is Quoted {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Quoted';
}

function isUrl(value: unknown): value is Url {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Url'
    && 'value' in value
    && isValueNode(value.value);
}

function urlFromChildren(children: readonly unknown[]): Url {
  if (children.length === 2) {
    return url(any(''));
  }
  const body = children[1];
  return isValueNode(body) ? url(body) : url(any(requireToken(body).value));
}

function requireLiteralQuoted(value: unknown): Quoted {
  if (!isQuoted(value)) {
    throw new TypeError('Jess module syntax requires a literal quoted path.');
  }
  return value;
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

function isCollectionEntry(value: unknown): value is CollectionEntry {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'CollectionEntry'
    && 'key' in value
    && isValueSlotValue(value.key)
    && 'value' in value
    && isValueSlotValue(value.value);
}

function isRuleset(value: unknown): value is Ruleset {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Ruleset';
}

function isMixinDefinition(value: unknown): value is MixinDefinition {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'MixinDefinition';
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

function isWhile(value: unknown): value is While {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'While'
    && 'guard' in value
    && 'rules' in value
    && Array.isArray(value.rules);
}

function requireExactToken(value: unknown, expected: string): void {
  if (requireToken(value).value !== expected) {
    throw new TypeError(`Jess grammar produced ${requireToken(value).value} where ${expected} was required.`);
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
 * shapes through distinct combinator arms, so the logical and truth reductions
 * are identical and shared here. COMPARISON is the one rung where the two
 * positions genuinely differ (§4.2a) and it gets a reducer each, below.
 */
function reduceGuardTruth(children: readonly unknown[]): GuardNode {
  return { g: 'truth', value: requireExpressionFact(children[0]).value };
}
/*
 * The two comparison POSITIONS (§4.2a). `$if` asserts — a groundless relational
 * pair raises, because the author asked which value is greater and there is no
 * answer. A mixin `when` clause TESTS — a groundless pair means this definition
 * does not apply, which is an answer, and raising there would turn a non-match
 * into a hard compile stop. Same operands, same ground; only the verdict on a
 * groundless pair differs, so they are two `g` spellings over one shape rather
 * than one node plus an eval-time context read.
 */
function reduceIfCompare(children: readonly unknown[]): GuardNode {
  return {
    g: 'cmp',
    op: requireToken(children[1]).value.trim(),
    left: requireExpressionFact(children[0]).value,
    right: requireExpressionFact(children[2]).value
  };
}
function reduceGuardCompare(children: readonly unknown[]): GuardNode {
  return {
    g: 'match',
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
    throw new TypeError('Jess variable declaration lost its assignment operator.');
  }
  const operator = requireToken(children[operatorIndex]).value;
  const lookup = operatorIndex === 3 ? 'scoped' as const : 'live' as const;
  const write = operator === '?:'
    ? { mode: 'if-absent' as const, scope: lookup }
    : operator === ':='
      ? { mode: 'reassign' as const, scope: lookup }
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
    throw new TypeError('Jess grammar produced a lambda without a body.');
  }
  const params = children.find(isParamList) ?? [];
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
function reduceCompound(children: readonly unknown[]): SelectorTerm {
  return selectorTermFromTokens(children.filter(isSimpleToken));
}
function reduceSelectorTail(children: readonly unknown[]): SelectorBranch {
  return children.find(isSelectorBranch)!;
}
function reduceSelectorList(children: readonly unknown[]): SelectorList {
  return selist(...children.filter(isSelectorBranch));
}

/*
 * Left-fold a `operand (operator operand)*` run into nested Operations. The
 * operator token carries its own padding (calc's additive operators require
 * it), so the spelling is trimmed back to the bare operator.
 */
function isCalcOperator(text: string): boolean {
  return text === '+' || text === '-' || text === '*' || text === '/' || text === '%';
}

/*
 * Operands and operator characters, in authored order, with the operators'
 * padding interleaved. The pads are their own terms, so an operator no longer
 * sits a constant distance from its operand and the fold reads the shape rather
 * than a fixed stride — and a pad can hold a comment whose own `/` and `*` would
 * defeat any attempt to recover the operator from the padded text.
 */
function dollarValueFromChildren(children: readonly unknown[]): ValueNode {
  const base = requireValueNode(children[0]);
  if (children.length === 1) {
    if (base.type !== 'Lookup' || base.kind !== 'var') {
      throw new TypeError('Jess reference base must be a variable reference.');
    }
    return base;
  }
  const rest = children.slice(1);
  if (base.type === 'Lookup' && base.kind === 'entry') {
    const name = requireToken(rest[0]).value;
    const tails = rest.slice(1).map(requireJessReferenceTail);
    return reference(
      base,
      [
        lookupStep('member', name),
        ...tails.map(tail => tail.step)
      ],
      `${base.raw}.${name}${tails.map(tail => tail.src).join('')}`
    );
  }
  if (base.type !== 'Lookup' || base.kind !== 'var') {
    throw new TypeError('Jess reference base must be a variable reference.');
  }
  if (isJessReferenceTail(rest[0])) {
    const tails = rest.map(requireJessReferenceTail);
    const memberReference = declarationMemberReferenceFromVariableBase(base, tails);
    if (memberReference) {
      return memberReference;
    }
    return reference(
      base,
      tails.map(tail => tail.step),
      `${base.scope === 'scoped' ? '$^' : '$'}${lookupNameSource(base.name)}${tails.map(tail => tail.src).join('')}`
    );
  }
  if (rest.some(child => isToken(child) && child.value === '/')) {
    return list(
      [base, requireValueNode(rest.at(-1))],
      '/'
    );
  }
  throw new TypeError('Jess dollar value matched an unknown continuation.');
}

function foldCalcOperation(children: readonly unknown[]): ValueNode {
  const first = children.find(isValueNode);
  if (first === undefined) {
    throw new TypeError('Jess calc grammar requires an operand.');
  }
  let result = first;
  let operator: string | undefined;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 1) {
    const child = children[index];
    if (isValueNode(child)) {
      if (operator === undefined) {
        throw new TypeError('Jess calc grammar lost an operator operand.');
      }

      /*
       * `inMathFunction` is TRUE for every pair this fold builds: the ladder is
       * reachable only from a css-values-4 §10 math function, so an operation
       * arriving here was AUTHORED inside one. The flag records that positional
       * fact and nothing more — whether it then folds is decided downstream,
       * together with `unitMode` and `mathMode`.
       */
      result = operation(
        operator,
        result,
        child,
        true,
        cssBaseMathOutsideParens(operator)
      );
      operator = undefined;
      continue;
    }
    if (child === undefined || child === null) {
      continue;
    }
    const text = requireToken(child).value;
    if (isCalcOperator(text)) {
      operator = text;
    }
  }
  if (operator !== undefined) {
    throw new TypeError('Jess calc grammar lost an operator operand.');
  }
  return result;
}

const rawWhitespace = regex(/[ \t\n\r\f]+/);

/*
 * calc() arithmetic, ported from the CSS base
 * (`../../../css/css-parser/src/grammar.ts`, `CalcValue`/`CalcProduct`/
 * `CalcSum`/`CalcParen`/`CalcFunction`). The operator spellings are CSS's and
 * are not a Jess divergence: the multiplicative operators bind tighter than
 * `+`/`-`, and the additive operators REQUIRE surrounding whitespace because
 * `+`/`-` are sign-ambiguous against a following number (css-values-4 §10.1).
 * The product class also admits `%`, which §10 does not define as a calc
 * operator; that over-acceptance is inherited from the CSS base verbatim
 * rather than introduced here, and narrowing it belongs in CSS, not Jess.
 *
 * These rules cannot be hoisted into `@jesscss/parser-shared`: that package's
 * artifacts are `g.`-free by contract (`rules(_g => ...)`) so a consuming
 * grammar can inline them at its own macro-fusion site, and the calc family is
 * mutually recursive through `g.` and carries AST reductions. `CalcValue` is
 * the only rule below that differs SEMANTICALLY from CSS — it admits Jess
 * operands. `CalcParen`/`CalcProduct`/`CalcSum`/`CalcFunction` are the CSS
 * bodies with Jess's typed reducers substituted; arm ORDER inside `CalcValue`
 * differs from CSS (first sets are disjoint, so the accept set is unchanged).
 */
/*
 * `valueTrivia` is the padding every value interior admits. The value ladder
 * runs under `noTrivia`, so an interior that admits authored padding has to
 * spell it, and it must spell THIS rather than a bare `rawWhitespace` run:
 * css-syntax-3 §4 makes a comment trivia wherever whitespace is trivia, so a
 * bare whitespace run is never the right spelling in a trivia slot. Both Jess
 * comment forms count, matching the document trivia table above.
 *
 * The operator pads keep the sum operator's whitespace REQUIREMENT
 * (css-values-4 §10.1: real whitespace on both sides of `+`/`-`, which a comment
 * does not supply), so the sum pad is `comment* ws+ (comment ws*)*` while the
 * product pad, which needs no whitespace, is `ws* (comment ws*)*`. Both keep
 * their comment and whitespace arms on disjoint first characters and no inner
 * group matches empty, so the match stays linear.
 *
 * Each pad is its OWN term rather than part of the operator regex, so the
 * operator token stays exactly the operator character. Folding the padding in
 * would leave `foldCalcOperation` recovering the operator from bytes that can
 * now contain a comment's own `/` and `*` — the parser handing core a value to
 * re-parse. With the pads as terms the operator no longer sits a constant
 * distance from its operand, so the fold reads the shape, not a fixed stride.
 */
const valueTrivia = regex(/(?:[ \t\n\r\f]+|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n\r]*)+/);

/*
 * The css-values-4 §10 math functions, as glued function OPENERS.
 *
 * CANONICAL TABLE: `CSS_MATH_FUNCTIONS` in `@jesscss/core/ast`
 * (`packages/core/src/ast/math-functions.ts`). Add or remove a name THERE
 * first; `test/math-function-table.test.ts` fails if this literal drifts.
 *
 * Spelled as a LITERAL because a dispatch key must be macro-visible: parseman's
 * plugin const-folds these at build time and cannot follow an imported binding
 * (measured — every import spelling fails the build with `composeLeaf() must
 * macro-fuse`).
 */
const CSS_MATH_FUNCTION_OPENERS = [
  'calc(',
  'min(', 'max(', 'clamp(',
  'round(', 'mod(', 'rem(',
  'sin(', 'cos(', 'tan(', 'asin(', 'acos(', 'atan(', 'atan2(',
  'pow(', 'sqrt(', 'hypot(', 'log(', 'exp(',
  'abs(', 'sign('
];

/*
 * A `+`/`-` GLUED to the number after it. Following a run separator inside a
 * math function this is never a run item — `calc(1px +2px)` is an ASYMMETRIC
 * additive operator, which css-values-4 §10.1 rejects. A leading `-` that
 * starts an identifier (`-webkit-foo`) is not this shape.
 */
const signedNumericStart = regex(/[-+](?=[.0-9])/);
const calcProductPad = regex(/[ \t\n\r\f]*(?:(?:\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n\r]*)[ \t\n\r\f]*)*/);
const calcSumPad = regex(/(?:\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n\r]*)*[ \t\n\r\f]+(?:(?:\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n\r]*)[ \t\n\r\f]*)*/);
const calcProductOperator = sequence(
  calcProductPad,
  regex(/[*/%]/),
  calcProductPad
);
const calcSumOperator = sequence(
  calcSumPad,
  regex(/[-+]/),
  calcSumPad
);

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const commentTrivia = regex(/\/(?:\*(?:[^*]|\*(?!\/))*\*\/|\/[^\n\r]*)/);

/* Keep custom-value comments visible as source trivia without making them
 * semantic custom-value parts. Jess names every comment `comment` in its
 * document trivia, and root capture is selected against that one table, so the
 * custom-value arm carries the same category name. */
const customValueBlockCommentRun = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const customValueCommentTrivia = classifiedTrivia({ comment: customValueBlockCommentRun });

/*
 * Comments are Jess trivia. Block comments can still survive through the AST
 * trivia map for rendering/source consumers; line comments are lexical-only and
 * never reach CSS output. URL bodies disable trivia below, so
 * `url(//host/path)` stays URL content.
 */
const whitespace = classifiedTrivia({
  whitespace: rawWhitespace,
  comment: commentTrivia
});
const plainDoubleQuotedText = regex(/(?:[^"\\$]|\\[\s\S]|\$(?![\[({]))*/);
const plainSingleQuotedText = regex(/(?:[^'\\$]|\\[\s\S]|\$(?![\[({]))*/);
const interpolatedDoubleQuotedText = regex(/(?:[^"\\$]|\\[\s\S]|\$(?![\[({]))+/);
const interpolatedSingleQuotedText = regex(/(?:[^'\\$]|\\[\s\S]|\$(?![\[({]))+/);

/*
 * Opaque Jess spans must not terminate inside a static quoted string. These
 * skippers reject `$` forms that the dialect treats as structural, so raw
 * scanner consumers still leave interpolation to their typed grammar.
 */
const scanSkipDoubleQuoted = sequence(
  literal('"'),
  plainDoubleQuotedText,
  literal('"')
);
const scanSkipSingleQuoted = sequence(
  literal('\''),
  plainSingleQuotedText,
  literal('\'')
);

/*
 * Jess's live `$` grammar does not permit CSS escapes in names. Keep that
 * dialect-local fact explicit while the value keyword leaf remains shared.
 */
const dollarName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);

/*
 * An operator boundary inside a Jess expression is whitespace, and a block
 * comment is ordinary whitespace there (`$(2px /* nudge *\/ * 2)`). Recognizing
 * the comment as part of the boundary keeps the operator symbol a separate
 * grammar fact, so no reduction has to strip comment bytes back out of a token.
 */
const expressionBoundary = regex(/(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);
const expressionProductSymbol = regex(/[*/%]/);
const expressionSumSymbol = regex(/[-+]/);
const expressionCompareSymbol = regex(/>=|<=|==|>|<|=/);

/*
 * `$if` conditions retain the CST's comparison spelling, which permits both
 * adjacent (`$a>5`) and spaced (`$a > 5`) operators. This is distinct from
 * expression interpolation, whose arithmetic/comparison grammar requires
 * spaces to avoid value-position ambiguity.
 */
const ifGuardCompareOperator = regex(/[ \t\n\r\f]*(?:>=|<=|==|>|<|=)[ \t\n\r\f]*/);

/*
 * This is intentionally the type-predicate namespace, not general function
 * syntax in a guard. The existing GuardNode evaluator accepts these names;
 * recognition retains a typed argument list and never routes through source.
 */
const guardUnaryTypePredicate = regex(/\$type\.(?:iscolor|isnumber|isstring|iskeyword|ispixel|ispercentage|isem)(?![-_a-zA-Z0-9\u0080-\uffff])/);
const guardIsUnitPredicate = regex(/\$type\.isunit(?![-_a-zA-Z0-9\u0080-\uffff])/);

/*
 * The reserved guard-predicate namespace. An expression atom uses this as a
 * negative lookahead so `$type.*` can never take a generic call tail and bypass
 * the closed, arity-checked predicate grammar above.
 */
const typeNamespace = regex(/\$type\./);

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
 * Consume `${` once, then branch on `[` versus a bare name; the bracket body
 * branches again on `$`, a name, or a quote. Those are disjoint continuation
 * sets, so this is structural factoring rather than five competing `${...}`
 * alternatives.
 */
const dollarBraceStructure = noTrivia(sequence(
  literal('${'),
  choice(
    sequence(
      literal('['),
      choice(
        sequence(
          literal('$'),
          dollarName,
          literal(']}')
        ),
        sequence(
          dollarName,
          literal(']}')
        ),
        sequence(
          literal('\''),
          regex(/(?:[^'\\]|\\[\s\S])*/),
          literal('\''),
          literal(']}')
        ),
        sequence(
          literal('"'),
          regex(/(?:[^"\\]|\\[\s\S])*/),
          literal('"'),
          literal(']}')
        )
      )
    ),
    sequence(
      dollarName,
      literal('}')
    )
  )
));

/*
 * Direct `$[...]` lookup is value/expression-only. Unlike `${...}`, it never
 * appears in a selector/name interpolation position.
 */
const dollarInterpolationStructure = noTrivia(sequence(
  literal('$['),
  choice(
    sequence(
      literal('$'),
      dollarName,
      literal(']')
    ),
    sequence(
      dollarName,
      literal(']')
    ),
    sequence(
      literal('\''),
      regex(/(?:[^'\\]|\\[\s\S])*/),
      literal('\''),
      literal(']')
    ),
    sequence(
      literal('"'),
      regex(/(?:[^"\\]|\\[\s\S])*/),
      literal('"'),
      literal(']')
    )
  )
));
const customPropertyChunk = regex(/(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
const selectorTextRun = regex(/[-_a-zA-Z0-9\u0080-\uffff]+/);

/*
 * A CSS-namespaces prefix: `<ident>|`, `*|`, or bare `|`, glued (no whitespace
 * around `|` \u2014 CSS Namespaces \u00a72, selectors-4 \u00a75.1). It prefixes a type/universal
 * selector (`svg|circle`, `*|a`, `|a`) and an attribute name (`[svg|attr]`), so
 * one recognizer serves both \u2014 the same shape the CSS base and the other dialects
 * use (one representation per construct). `(?!=)` keeps the attribute operator
 * `|=` (selectors-4 \u00a76.3) on its own route so `[a|=b]` is `a` matched by `|=`.
 */
const attributeNamespace = regex(/(?:-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)?\|(?!=)/);

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
const ampersand = regex(/&(?:--(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*)?/);

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
const ampersandAppendPayload = regex(/(?!nil\))[-_a-zA-Z0-9\u0080-\uffff]+/);

/*
 * The literal tail an authored value-position interpolation may carry: a unit
 * (`$(20)px`), a percent sign, or an identifier suffix (`$[name]-suffix`).
 */
const interpolatedValueTail = regex(/[-_a-zA-Z0-9\u0080-\uffff%]+/);

/*
 * One value-term slash boundary, with its authored whitespace on either side.
 * The negative lookahead keeps a comment opener (`/*`) out of the boundary so a
 * commented value still fails exactly where it did before.
 */
const valueSlashBoundary = regex(/[ \t\n\r\f]*\/(?!\*)[ \t\n\r\f]*/);
const generalTemplateText = regex(/(?:[^$()\[\]{}'"\\]|\\[\s\S])+/);

/* CSS at-rule URL bodies stay closed to Jess value syntax. */
const plainUrlInner = regex(/(?:[^"'()\\$ \t\n\r\f\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);

/*
 * An unquoted declaration-value URL recognizes `${...}` as its sole dynamic
 * segment. Every other `$` remains CSS URL-token text, so `$foo` and
 * `$[key]` do not become Jess value lookups. Whitespace, quotes, and
 * parentheses stay outside this closed URL slice.
 */
const unquotedUrlText = regex(/(?:[^"'()$\ \t\n\r\f\x00-\x08\x0B\x0E-\x1F\x7F]|\$(?!\{)|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);

/*
 * Jess's compiler namespace: the `@-\u2026` names a module directive lowers to. They
 * are not CSS output, so they must never be claimed by the generic at-rule arms
 * or captured as opaque bytes \u2014 their own typed productions own them, and a
 * malformed one must report its own error rather than silently degrade.
 */
const compilerAtRuleName = keywords(
  ['@-use', '@-compose', '@-export', '@-import', '@-from'],
  { boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF', caseInsensitive: true }
);

const charsetAtRuleName = word('@charset', '-_a-zA-Z0-9\\u0080-\\uFFFF', { caseInsensitive: true });
const importAtRuleName = word('@import', '-_a-zA-Z0-9\\u0080-\\uFFFF', { caseInsensitive: true });
const propertyAtRuleName = word('@property', '-_a-zA-Z0-9\\u0080-\\uFFFF', { caseInsensitive: true });
const scopeAtRuleName = word('@scope', '-_a-zA-Z0-9\\u0080-\\uFFFF', { caseInsensitive: true });

/** The `null` LITERAL's word (§4.3). Boundary-guarded, so `nullish` stays an ordinary identifier. */
const nullWord = word('null', '-_a-zA-Z0-9\\u0080-\\uFFFF');
const keyframeEndpoint = keywords(
  ['from', 'to'],
  { boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF', caseInsensitive: true }
);

/*
 * NOT exported, and must never be. The body is written entirely in parseman's
 * macro vocabulary (`makeWord`, `sequence`, `node`, ...), which exists only at
 * build time -- the macro plugin lowers each call site into inline JS and the
 * package emits no runtime `parseman` combinator import. Exporting the factory
 * makes the plugin emit a live runtime binding for it whose body still names
 * the macro-only identifiers, so the export throws
 * `ReferenceError: makeWord is not defined` the first time anyone calls it.
 * That artifact shipped until 205eba3c4 split each compiled grammar into its
 * own entry and tree-shook the factory out. `scripts/check-macro-buildable.mjs`
 * now fails the build if any built module references an undefined identifier.
 */
const jessFactory = (g: JessRules & SharedSyntax) => {
  const caseInsensitiveWhen = makeWhen({ caseInsensitive: true });
  const syntaxWord = makeWord('-_a-zA-Z0-9\\u0080-\\uFFFF');

  /*
   * CSS identifier-or-function positions consume the adjacent `(` as one
   * routed opener. Jess reuses the same opener for values and pseudo selectors;
   * only their selected tails differ.
   */
  const identifierOrFunction = token(noTrivia(sequence(
    g.Identifier,
    optional(literal('('))
  )));
  const typedAtRuleHeaderNames = [
    '@keyframes', '@charset', '@import', '@supports', '@property',
    '@-use', '@-compose', '@-export', '@-import', '@-from'
  ];

  const VariableReference = node<Lookup>(
    'VariableReference',
    choice(
      noTrivia(sequence(
        literal('$^'),
        dollarName
      )),
      noTrivia(sequence(
        literal('$'),
        dollarName
      ))
    ),
    (children, _fields, span) => withSourceSpan(
      variableReference(
        requireToken(children.at(-1)).value,
        requireToken(children[0]).value === '$^' ? 'scoped' : 'live'
      ),
      span
    )
  );
  const ExpressionScopedReference = node<Lookup>(
    'VariableReference',
    noTrivia(sequence(
      literal('^'),
      dollarName
    )),
    (children, _fields, span) => withSourceSpan(
      variableReference(
        requireToken(children[1]).value,
        'scoped'
      ),
      span
    )
  );
  const DeclarationReference = node<Lookup>(
    'DeclarationReference',
    noTrivia(literal('$')),
    (_children, _fields, span) => withSourceSpan(declarationReference('$'), span)
  );
  const DollarBrace = node<Interpolation>(
    'DollarBrace',
    dollarBraceStructure,
    (children, _fields, span) => dollarBraceInterpolation(
      children,
      span
    )
  );
  const DollarInterp = node<Interpolation>(
    'DollarInterp',
    dollarInterpolationStructure,
    (children, _fields, span) => interpolationFromChildren(
      children,
      span
    )
  );

  /*
   * The expression-context spelling of `${…}`, for the quoted-string family that
   * reduces to an `ExpressionFact` rather than a bare `Interpolation`.
   */
  const ExpressionDollarBrace = node<ExpressionFact>(
    'ExpressionDollarBrace',
    dollarBraceStructure,
    (children, _fields, span) => {
      return { value: dollarBraceInterpolation(
        children,
        span
      ), src: tokenSource(children) };
    }
  );
  const ExpressionDollarInterp = node<ExpressionFact>(
    'ExpressionDollarInterp',
    dollarInterpolationStructure,
    (children, _fields, span) => ({ value: interpolationFromChildren(
      children,
      span
    ), src: tokenSource(children) })
  );
  const ExpressionProductOperator = node<JessOperatorFact>(
    'ExpressionProductOperator',
    noTrivia(sequence(
      expressionBoundary,
      expressionProductSymbol,
      expressionBoundary
    )),
    children => ({ value: requireToken(children[1]).value, src: tokenSource(children) })
  );
  const ExpressionSumOperator = node<JessOperatorFact>(
    'ExpressionSumOperator',
    noTrivia(sequence(
      expressionBoundary,
      expressionSumSymbol,
      expressionBoundary
    )),
    children => ({ value: requireToken(children[1]).value, src: tokenSource(children) })
  );
  const ExpressionCompareOperator = node<JessOperatorFact>(
    'ExpressionCompareOperator',
    noTrivia(sequence(
      expressionBoundary,
      expressionCompareSymbol,
      expressionBoundary
    )),
    children => ({ value: requireToken(children[1]).value, src: tokenSource(children) })
  );
  const ExpressionDeclarationReference = node<ExpressionFact>(
    'ExpressionDeclarationReference',

    /*
     * The optional `$` is only the explicit declaration-root spelling. A
     * leading `.` remains expression-only because this production is reachable
     * only from ExpressionAtom, while `.1` stays on the Dimension path.
     */
    noTrivia(sequence(
      optional(g.DeclarationReference),
      literal('.'),
      dollarName,
      many(choice(
        g.ExpressionReferenceCallTail,
        g.ReferenceTail
      ))
    )),
    (children, _fields, span) => {
      const rooted = children.some(child => isValueNode(child) && child.type === 'Lookup' && child.kind === 'entry');
      const name = requireToken(children.find((child): child is Token => isToken(child) && child.value !== '.')).value;
      const sourceRoot = rooted ? '$' : '';
      const base = withSourceSpan(declarationReference('$'), span);
      const tails = children.filter(isJessReferenceTail);
      const raw = `${sourceRoot}.${name}${tails.map(tail => tail.src).join('')}`;
      return { value: reference(
        base,
        [
          lookupStep('member', name),
          ...tails.map(tail => tail.step)
        ],
        raw
      ), src: raw };
    }
  );
  const ExpressionCallArgument = node<JessMixinCallArgument>(
    'ExpressionCallArgument',
    choice(
      sequence(
        literal('$'),
        dollarName,
        literal(':'),
        g.ExpressionLogical
      ),
      g.ExpressionLogical
    ),
    (children) => {
      const fact = children.find(isExpressionFact);
      if (fact === undefined) {
        throw new TypeError('Jess expression call argument lost its value.');
      }
      const name = children.find((child): child is Token => isToken(child) && child.value !== '$' && child.value !== ':');
      return callArg(fact.value, name?.value);
    }
  );
  const ExpressionReferenceCallTail = node<JessReferenceTail>(
    'ExpressionReferenceCallTail',
    noTrivia(sequence(
      literal('('),
      parser(
        { trivia: whitespace },
        optional(oneOrMoreSep(
          g.ExpressionCallArgument,
          literal(',')
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
  const ExpressionAtom = node<ExpressionFact>(
    'ExpressionAtom',

    /*
     * `$name` references dominate expression atoms; try VarReference before the
     * `$[` lookup form (disjoint on the char after `$`) so a plain
     * reference does not first enter and roll back the DollarInterp node frame.
     * The reference keeps its accessor AND call tails here so a member read and
     * a call are the SAME grammar facts in arithmetic position that they already
     * are in value position — that is what lets `$(…)` nest calls to any depth
     * (`$($double($double($n)))`), since each argument is itself an ordinary
     * value. A parenthesized sub-group is the explicit precedence boundary.
     *
     * The `$type.` namespace is the one exception, and it gets the second arm:
     * this atom is shared with `$if`/`when`, where `$type.isnumber($x)` must
     * keep reducing through the arity-checked `GuardCall` predicate
     * syntax. Letting it take a generic call tail would silently admit
     * `$type.unknown($x)` and every wrong-arity spelling the guard grammar
     * exists to reject. Bare-name calls stay out of the atom entirely for the
     * same reason — `default()` is mixin-only syntax.
     */
    choice(
      noTrivia(sequence(
        not(typeNamespace),
        g.VariableReference,
        many(choice(
          g.ExpressionReferenceCallTail,
          g.ReferenceTail
        ))
      )),
      noTrivia(sequence(
        g.ExpressionScopedReference,
        many(choice(
          g.ExpressionReferenceCallTail,
          g.ReferenceTail
        ))
      )),
      noTrivia(sequence(
        g.VariableReference,
        many(g.ReferenceTail)
      )),
      g.ExpressionDeclarationReference,
      g.ExpressionDollarInterp,
      g.Dimension,
      g.Color,
      g.ExpressionQuoted,
      sequence(
        literal('('),
        g.ExpressionLogical,
        literal(')')
      ),

      /*
       * NOTE: a BARE-name call (`max(1, 2)`) is deliberately NOT an atom here.
       * This atom is shared with `$if`/`when` conditions, which must keep
       * rejecting the mixin-only `default()` form; admitting bare calls would
       * make `default()` a legal condition. Dispatch reaches an expression only
       * through the `$fn(…)` reference tail above, which cannot spell `default()`.
       */
      /*
       * `null` is the LITERAL (§4.3), tried before the generic identifier so an
       * expression operand carries the absent VALUE rather than an identifier
       * that spells one — that is what makes `$(1 + null)` be `1` and
       * `$if (null)` take the false branch. The word boundary keeps `nullish`
       * an ordinary keyword.
       */
      g.NullLiteral,
      g.Keyword
    ),
    (children) => {
      if (isToken(children[0]) && requireToken(children[0]).value === '(') {
        const inner = requireExpressionFact(children[1]);
        return { value: block(inner.value), src: `(${inner.src})` };
      }
      if (isJessReferenceTail(children[1])) {
        const base = requireValueNode(children[0]);
        if (base.type !== 'Lookup' || (base.kind !== 'var' && base.kind !== 'entry')) {
          throw new TypeError('Jess expression reference base must be a variable or declaration reference.');
        }
        const tails = children.slice(1).map(requireJessReferenceTail);
        if (base.kind === 'var') {
          const memberReference = declarationMemberReferenceFromVariableBase(base, tails);
          if (memberReference) {
            return { value: memberReference, src: memberReference.raw };
          }
        }
        const raw = `${referenceBaseSource(base)}${tails.map(tail => tail.src).join('')}`;
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
  const ExpressionProduct = node<ExpressionFact>(
    'ExpressionProduct',
    noTrivia(sequence(
      g.ExpressionAtom,
      many(sequence(
        ExpressionProductOperator,
        g.ExpressionAtom
      ))
    )),
    children => foldExpression(children)
  );
  const ExpressionSum = node<ExpressionFact>(
    'ExpressionSum',
    noTrivia(sequence(
      g.ExpressionProduct,
      many(sequence(
        ExpressionSumOperator,
        g.ExpressionProduct
      ))
    )),
    children => foldExpression(children)
  );
  const ExpressionCompare = node<ExpressionFact>(
    'ExpressionCompare',
    noTrivia(sequence(
      g.ExpressionSum,
      optional(sequence(
        ExpressionCompareOperator,
        g.ExpressionSum
      ))
    )),
    (children) => {
      if (children.length === 1) {
        return requireExpressionFact(children[0]);
      }
      const left = requireExpressionFact(children[0]);
      const operator = requireJessOperatorFact(children[1]);
      const right = requireExpressionFact(children[2]);
      const src = `${left.src}${operator.src}${right.src}`;
      return { value: condition(
        { g: 'cmp', op: operator.value, left: left.value, right: right.value },
        src
      ), src };
    }
  );

  /*
   * `not` / `and` / `or` in EXPRESSION VALUE position (§4.5.5). They are
   * operators in their own right, never calls: `and` / `or` return an OPERAND
   * and short-circuit (`$a or $default` is `$a` when truthy), and `not` returns
   * a `Bool`. Conditions truthiness-test the result (§4.4), which is what makes
   * `truthy($a and $b)` exactly `truthy($a) and truthy($b)` and lets ONE
   * semantics serve both this ladder and the guard ladder.
   *
   * This ladder and `IfGuardAnd`/`IfGuardOr` stay DISTINCT productions even
   * though they agree observationally in condition position (§4.5.5): one folds
   * VALUES, the other folds guard nodes.
   *
   * §4.5.4's two constraints are structural here, not checks bolted on:
   *   - `not` ALWAYS takes parens, because `literal('(')` follows the keyword
   *     with nothing optional between them — `not true` never matches.
   *   - a bare comparison is not an `and`/`or` operand, because the operand is
   *     `ExpressionSum`; `($x = 1px or $x = 2px)` therefore stays a parse error
   *     while `(($x = 1px) or ($x = 2px))` reaches the same operand through the
   *     atom's parenthesized arm.
   */
  const ExpressionNot = node<ExpressionFact>(
    'ExpressionNot',
    sequence(
      regex(/not(?![-_a-zA-Z0-9\u0080-\uffff])/),
      literal('('),
      g.ExpressionLogical,
      literal(')')
    ),
    (children) => {
      const inner = requireExpressionFact(children[2]);
      const src = `not(${inner.src})`;
      return { value: condition({ g: 'not', inner: { g: 'truth', value: inner.value } }, src), src };
    }
  );
  const ExpressionLogicalOperand = node<ExpressionFact>(
    'ExpressionLogicalOperand',
    choice(
      g.ExpressionNot,
      g.ExpressionSum
    ),
    children => requireExpressionFact(children[0])
  );
  const ExpressionAnd = node<ExpressionFact>(
    'ExpressionAnd',
    sequence(
      g.ExpressionLogicalOperand,
      oneOrMore(sequence(
        regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.ExpressionLogicalOperand
      ))
    ),
    children => foldLogicalExpression('and', children)
  );
  const ExpressionOr = node<ExpressionFact>(
    'ExpressionOr',
    sequence(
      g.ExpressionLogicalOperand,
      oneOrMore(sequence(
        regex(/or(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.ExpressionLogicalOperand
      ))
    ),
    children => foldLogicalExpression('or', children)
  );
  const ExpressionLogical = node<ExpressionFact>(
    'ExpressionLogical',

    /*
     * Both chained arms share their first operand with the shorter forms, so
     * they are transactional for the same reason `IfGuard` makes its comparison
     * arm transactional: a missing `and` must return recognition to `or`, and a
     * missing operator to the bare comparison, rather than committing the head.
     * Mixed chains group explicitly, exactly as the guard ladder requires.
     */
    choice(
      attempt(g.ExpressionAnd),
      attempt(g.ExpressionOr),
      g.ExpressionNot,
      g.ExpressionCompare
    ),
    children => requireExpressionFact(children[0])
  );

  /*
   * Mixin guards use the same structural GuardNode model as $if. Keep the
   * documented Jess condition rule strict: a comparison participating in an
   * and/or chain must be parenthesized; mixed chains must group explicitly.
   * No source string is retained or reparsed after recognition.
   */
  const GuardValue = node<GuardNode>(
    'GuardValue',
    g.ExpressionSum,
    reduceGuardTruth
  );
  const GuardCompare = node<GuardNode>(
    'GuardCompare',
    sequence(
      g.ExpressionSum,
      regex(/>=|<=|==|>|<|=/),
      g.ExpressionSum
    ),
    reduceGuardCompare
  );
  const GuardCall = node<GuardNode>(
    'GuardCall',
    choice(
      sequence(
        guardUnaryTypePredicate,
        literal('('),
        g.ValueTerm,
        literal(')')
      ),
      sequence(
        guardIsUnitPredicate,
        literal('('),
        g.ValueTerm,
        optional(sequence(
          literal(','),
          g.ValueTerm
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
  const GuardPrimary = node<GuardNode>(
    'GuardPrimary',
    choice(
      sequence(
        regex(/not(?![-_a-zA-Z0-9\u0080-\uffff])/),
        literal('('),
        g.MixinGuard,
        literal(')')
      ),
      sequence(
        literal('('),
        g.MixinGuard,
        literal(')')
      ),
      sequence(
        regex(/default(?![-_a-zA-Z0-9\u0080-\uffff])/),
        literal('('),
        literal(')')
      ),
      g.GuardCall,
      g.GuardValue
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
  const GuardAnd = node<GuardNode>(
    'GuardAnd',
    sequence(
      g.GuardPrimary,
      oneOrMore(sequence(
        regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.GuardPrimary
      ))
    ),
    reduceGuardAnd
  );
  const GuardOr = node<GuardNode>(
    'GuardOr',
    sequence(
      g.GuardPrimary,
      oneOrMore(sequence(
        regex(/or(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.GuardPrimary
      ))
    ),
    reduceGuardOr
  );
  const MixinGuard = node<GuardNode>(
    'MixinGuard',
    choice(
      g.GuardAnd,
      g.GuardOr,
      g.GuardCompare,
      g.GuardPrimary
    ),
    children => requireGuardNode(children[0])
  );
  const Expression = node<Interpolation>(
    'Expression',
    sequence(
      literal('$('),
      g.ExpressionLogical,
      literal(')')
    ),

    /*
     * `$()` is the explicit arithmetic boundary. Preserve that execution fact
     * in the canonical value graph so division operates under parens-division.
     * An `Expression` is a COMPUTATION BOUNDARY, not an authored group: the
     * parens are the `$(` and `)` of this very spelling, so they open the math
     * context without ever reaching output — otherwise `$(foo)` would emit a
     * paren pair nobody wrote.
     */
    children => interpolation([{ ref: expression(requireExpressionFact(children.find(isExpressionFact)).value), unquote: true }])
  );
  const ExpressionInterpolation = node<ExpressionFact>(
    'ExpressionInterpolation',
    sequence(
      literal('$('),
      g.ExpressionLogical,
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
        value: interpolation([{ ref: expression(body.value), unquote: true }]),
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
  const quotedExpressionParser = parser(
    { trivia: whitespace },
    g.Expression
  );
  const quotedExpressionInterpolationParser = parser(
    { trivia: whitespace },
    g.ExpressionInterpolation
  );

  /*
   * The escape is an OPTIONAL PREFIX on the quoted body, not a second spelling
   * of it. `~` used to lead its own full copy of each arm, so the body was
   * written twice per quote character and the two copies were free to drift —
   * the same one-fact-several-copies shape that let SCSS module paths lose
   * their escape arm. `optional` emits no child when absent, so the reducers'
   * positional indices are the ones they always were: `~` at 0 when written,
   * the opening quote at 0 otherwise.
   * Shared across the value, static, and expression quoted families; only the
   * interp-bearing arms and the reducer differ.
   */
  const staticDoubleQuoted = noTrivia(sequence(
    optional(literal('~')),
    literal('"'),
    plainDoubleQuotedText,
    literal('"')
  ));
  const staticSingleQuoted = noTrivia(sequence(
    optional(literal('~')),
    literal('\''),
    plainSingleQuotedText,
    literal('\'')
  ));
  const Quoted = node<Quoted | Interpolation>(
    'Quoted',
    choice(
      staticDoubleQuoted,
      staticSingleQuoted,

      /*
       * The same optional `~` leads the interp-bearing arms, so the escape is
       * written once per quote character rather than once per arm.
       *
       * DEFECT, NOT A CONTRACT: the reducer below still DROPS the `~` and both
       * quote tokens when an escaped string carries interpolation, so
       * `~"a$(b)"` reduces to a bare `Interpolation` while `"a$(b)"` keeps its
       * quote literals as parts. What the escape MEANS — that it strips the
       * delimiters — is an eval-time decision that has leaked into the parser,
       * and the resulting tree cannot say the escape was written at all. The
       * fix is one `Quoted` node carrying `escaped`, as the static arm already
       * does and as `Block` does for `~(`/`~[`; that needs `Quoted.value` to
       * admit an interpolation, which is an AST model change, not a grammar
       * one. Left as-is here so this arm collapse stays output-neutral.
       */
      noTrivia(sequence(
        optional(literal('~')),
        literal('"'),
        many(choice(
          g.DollarBrace,
          quotedExpressionParser,
          interpolatedDoubleQuotedText
        )),
        literal('"')
      )),
      noTrivia(sequence(
        optional(literal('~')),
        literal('\''),
        many(choice(
          g.DollarBrace,
          quotedExpressionParser,
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
  const LiteralQuoted = node<Quoted>(
    'Quoted',
    choice(
      staticDoubleQuoted,
      staticSingleQuoted
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
  const moduleBindingName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const moduleAsClause = sequence(
    syntaxWord('as'),
    moduleBindingName
  );
  const styleImportAsClause = sequence(
    syntaxWord('as'),
    choice(
      literal('*'),
      moduleBindingName
    )
  );
  const styleImportDirective = keywords(['@-compose', '@-export', '@-import'], {
    boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF'
  });
  const StyleImport = node<StyleImport>(
    'StyleImport',
    dispatch(
      styleImportDirective,
      when(
        '@-compose',
        sequence(
          routed(),
          g.Quoted,
          optional(styleImportAsClause),
          optional(literal(';'))
        )
      ),
      when(
        '@-export',
        sequence(
          routed(),
          g.Quoted,
          optional(literal(';'))
        )
      ),
      when(
        '@-import',
        sequence(
          routed(),
          g.Quoted,
          optional(literal(';'))
        )
      )
    ),
    (children) => {
      const source = requireToken(children[0]).value;
      const path = requireLiteralQuoted(children[1]);
      const names = children.slice(2).filter(isToken)
        .map(requireToken).map(token => token.value);
      if (source === '@-compose') {
        return styleImport('@-compose', path, {
          mode: 'compose',
          namespace: names.find(name => name !== 'as' && name !== ';') ?? null
        });
      }
      if (source === '@-export') {
        return styleImport('@-export', path, { mode: 'compose', forward: true });
      }
      if (source === '@-import') {
        return styleImport('@-import', path, { mode: 'import' });
      }
      throw new TypeError('Jess grammar produced an unknown style import form.');
    }
  );
  const ModuleSpecifier = node<ModuleImportSpecifier>(
    'ModuleSpecifier',
    sequence(
      moduleBindingName,
      optional(moduleAsClause)
    ),
    children => ({
      name: requireToken(children[0]).value,
      alias: children.length === 3 ? requireToken(children[2]).value : null
    })
  );
  const moduleSpecifierList = oneOrMoreSep(
    g.ModuleSpecifier,
    literal(',')
  );
  const moduleImportDirective = keywords(['@-use', '@-from'], {
    boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF'
  });
  const ModuleImport = node<ModuleImport>(
    'ModuleImport',
    dispatch(
      moduleImportDirective,
      when(
        '@-use',
        sequence(
          routed(),
          g.Quoted,
          optional(styleImportAsClause),
          optional(literal(';'))
        )
      ),
      when(
        '@-from',
        sequence(
          routed(),
          g.Quoted,
          syntaxWord('import'),

          /*
           * Left-factored on the specifier: as two arms, every plain
           * `import a;` parsed it, failed the `,`, and parsed it again. The
           * three arms now start on `*`, `(` and an identifier — disjoint, so
           * nothing backtracks and arm order is inert.
           */
          choice(
            sequence(
              literal('*'),
              moduleAsClause
            ),
            sequence(
              literal('('),
              moduleSpecifierList,
              literal(')')
            ),
            sequence(
              g.ModuleSpecifier,
              optional(sequence(
                literal(','),
                literal('('),
                moduleSpecifierList,
                literal(')')
              ))
            )
          ),
          optional(literal(';'))
        )
      )
    ),
    (children) => {
      const source = requireToken(children[0]).value;
      const path = requireLiteralQuoted(children[1]);
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
        throw new TypeError('Jess grammar produced an unknown module import form.');
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
          throw new TypeError('Jess grammar produced invalid default module import bindings.');
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
  const ExpressionQuoted = node<ExpressionFact>(
    'ExpressionQuoted',
    choice(
      staticDoubleQuoted,
      staticSingleQuoted,
      noTrivia(sequence(
        literal('"'),
        many(choice(
          g.ExpressionDollarBrace,
          quotedExpressionInterpolationParser,
          interpolatedDoubleQuotedText
        )),
        literal('"')
      )),
      noTrivia(sequence(
        literal('\''),
        many(choice(
          g.ExpressionDollarBrace,
          quotedExpressionInterpolationParser,
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
  const Keyword = node<Keyword>(
    'Keyword',
    g.Identifier,
    children => keyword(requireToken(children[0]).value)
  );

  /*
   * The `null` LITERAL (§4.3) — a rule of its own, so the identifier positions
   * that must keep reading `null` as a plain name (a lookup key, a media/container
   * name, a @keyframes name) are untouched: only the positions that reference this
   * rule admit the literal.
   */
  const NullLiteral = node<Null>(
    'Null',
    nullWord,
    () => NULL_NODE
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
  const Dimension = node<Dimension>(
    'Dimension',
    noTrivia(sequence(
      g.NumberToken,
      optional(g.DimensionUnit)
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
  const Color = node<Color>(
    'Color',
    g.HexColor,
    children => color(requireToken(children[0]).value)
  );

  /*
   * A `<urange>` is one opaque CSS token, so it must be recognized before the
   * identifier atom: `U+0-7F` split at the `+` leaves `+0`/`-7F` to be re-read
   * as signed numbers, which serializes valid CSS back out as `U +0 -7F`.
   * Jess had no `<urange>` rule at all, so `a { b: U+0-7F }` — plain CSS the
   * other three dialects accept — did not parse.
   *
   * The CSS base is the precedent, not an argument from first principles:
   * `../../../css/css-parser/src/grammar.ts:1739` defines it and admits it in
   * BOTH ladders, the ordinary value atom (`:2699`, `:2765`) and the calc rung
   * (`:2205`) — and the comment above that rung says why in as many words, that
   * `CalcValue` must be a SUPERSET of the ordinary typed value atom rather than
   * a narrower cousin of it, with `min(U+0-7F)` named as the measured case.
   * Jess ports that family rather than referencing it, so it owes both arms.
   */
  const UnicodeRange = node<ValueNode>(
    'UnicodeRange',
    g.UnicodeRangeToken,
    children => any(requireToken(children[0]).value)
  );
  const UrlInterpolatedValue = node<Interpolation>(
    'UrlInterpolatedValue',
    noTrivia(sequence(
      optional(unquotedUrlText),
      g.DollarBrace,
      many(choice(
        unquotedUrlText,
        g.DollarBrace
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
   * Static CSS at-rule headers use this closed URL production. Value-position
   * URLs route through IdentifierOrFunction below, where dynamic Jess segments
   * are a deliberate override of this static CSS leaf.
   */
  const Url = node<Url>(
    'Url',
    sequence(
      g.UrlOpen,
      noTrivia(sequence(
        optional(choice(
          g.LiteralQuoted,
          g.PlainUrlInner
        )),
        literal(')')
      ))
    ),
    urlFromChildren
  );

  /*
   * These static selector reductions are deliberately declared before values:
   * `*[…]` uses them as an ordered selector payload, while selectors themselves
   * never need to parse a value. Keeping that dependency one-way avoids a
   * recording-phase forward-reference cycle.
   */
  const BasicSelector = node<SimpleSelector>(
    'BasicSelector',
    g.SimpleSelectorToken,
    children => simpleSelector(requireToken(children[0]).value)
  );

  /*
   * The fused form and its explicit `&(X)` spelling reduce to one canonical
   * `SimpleSelector.text`, so `&(-1)` and Less's `&-1` hand core identical input.
   * The parenthesized arm leads: the fused terminal would otherwise commit the
   * bare `&` of `&(-1)` and strand its payload.
   */
  const Parent = node<SimpleSelector>(
    'SimpleSelector',
    choice(
      sequence(
        literal('&('),
        ampersandAppendPayload,
        literal(')')
      ),
      ampersand
    ),
    (children) => {
      const head = requireToken(children[0]).value;
      return simpleSelector(head === '&(' ? `&${requireToken(children[1]).value}` : head);
    }
  );

  /*
   * Cheap `${…}` lookahead so an ordinary `.card` simple selector does not
   * consume its `[.#]`+text run, fail the required interpolation, and backtrack a
   * re-parse through BasicSelector. The predicate mirrors this arm's own
   * leading shape (optional class/id sigil + selector-text run) and requires an
   * interpolation opener immediately after it, so the opener is bound to THIS
   * simple selector and a sibling selector's interpolation never falsely admits
   * a plain one.
   */
  const interpolatedSimpleAhead = peek(regex(/[.#]?[-_a-zA-Z0-9\u0080-\uffff]*\$\{/));
  const InterpolatedSimple = node<SimpleSelector>(
    'InterpolatedSimple',
    noTrivia(sequence(
      interpolatedSimpleAhead,
      optional(regex(/[.#]/)),
      many(selectorTextRun),
      g.DollarBrace,
      many(choice(
        g.DollarBrace,
        selectorTextRun
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
           * The superset lookahead emits a throwaway match token (`…${`). Real
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
   * `&` glued to a `${...}` template is ONE parent-suffix selector atom, not a
   * parent reference followed by a second compound member. Only the fused shape
   * distributes the concatenation per parent; a split one would resolve the bare
   * `&` to `:is(parents)` first and then append to that.
   *
   * The literal run between `&` and the template is a template fragment, not a
   * completed identifier, so the fused terminal's identifier rule does not apply
   * to it: `&-${tone}` is the authored spelling of `&-primary`. The required
   * `DollarBrace` is the decisive continuation, so this production owns that
   * decision directly rather than pre-scanning it with `peek(...)`.
   */
  const InterpolatedParentSuffix = node<SimpleSelector>(
    'InterpolatedParentSuffix',
    noTrivia(sequence(
      literal('&'),
      many(selectorTextRun),
      g.DollarBrace,
      many(choice(
        g.DollarBrace,
        selectorTextRun
      ))
    )),
    children => interpolatedSimpleSelector(templateInterpolationFromChildren(children))
  );

  /*
   * `ns|E` / `*|E` / `|E` is ONE type selector with a namespace prefix
   * (selectors-4 §5.1), not two compounds joined by a `|` combinator — Jess's
   * combinator set already excludes `|`, so before this arm the whole selector
   * was rejected. It leads the compound choice because its prefix shares a first
   * char with a plain type selector; `noTrivia` keeps the prefix glued. The
   * reduced value is a plain `SimpleSelector` carrying the whole `svg|circle`
   * text, matching the CSS base and the other dialects (one representation per
   * construct).
   */
  const NamespaceTypeSelector = node<SimpleSelector>(
    'NamespaceTypeSelector',
    noTrivia(sequence(
      attributeNamespace,
      choice(g.Identifier, literal('*'))
    )),
    children => simpleSelector(children.map(child => requireToken(child).value).join(''))
  );

  /*
   * CSS owns the attribute frame. Its quoted value is static selector syntax,
   * so the Jess-specific string override is the restricted LiteralQuoted slot.
   * A namespaced attribute name (`[svg|attr]`, `[*|attr]`, `[|attr]`) takes the
   * same glued `attributeNamespace` prefix the CSS base uses.
   */
  const AttributeSelector = node<SimpleSelector>(
    'AttributeSelector',
    sequence(
      literal('['),
      optional(attributeNamespace),
      g.Identifier,
      optional(sequence(
        g.AttributeOperator,
        choice(
          g.LiteralQuoted,
          g.Identifier
        ),
        optional(g.AttributeModifier)
      )),
      literal(']')
    ),
    children => attributeSelector(children.map(child => isQuoted(child) ? child.src : requireToken(child).value))
  );

  /*
   * `:nth-child`/`:nth-last-child` argument: a bare `<An+B>` OR `<An+B> of S`
   * (Selectors-4 §6.6.2, https://www.w3.org/TR/selectors-4/#the-nth-child-pseudo).
   * The shared `g.NthExpression`/`g.NthOfKeyword`/`g.PseudoSelectorCloseAhead`
   * recognitions replace the inlined `<An+B> of` regex; `of` keeps its authored
   * surrounding whitespace (explicit `rawWhitespace`, not trivia) so `2n+1of .a`
   * cannot be silently normalized into the distinct `2n+1 of .a` syntax. The
   * selector fallback keeps a previously-opaque selector arg (`:nth-child(.a)`)
   * accepted as before; typed An+B is tried first so `-n+2` is not claimed as a
   * static `-n` selector.
   */
  const NthChildArgument = node<SelectorList | string>(
    'NthChildArgument',
    sequence(
      not(noTrivia(sequence(
        g.NthExpression,
        g.NthOfKeyword
      ))),
      parser(
        { trivia: whitespace },
        choice(
          sequence(
            g.NthExpression,
            optional(sequence(
              g.NthOfKeyword,
              g.PseudoSelectorList
            )),
            g.PseudoSelectorCloseAhead
          ),
          g.PseudoSelectorList
        )
      )
    ),
    (children) => {
      const selector = children.find(isSelectorList);
      const nth = children.find(isToken);
      if (nth === undefined) {
        if (selector === undefined) {
          throw new TypeError('Jess nth-child pseudo argument lost its selector.');
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
  const NthTypeArgument = node<SelectorList | string>(
    'NthTypeArgument',
    choice(
      sequence(
        g.NthExpression,
        g.PseudoSelectorCloseAhead
      ),
      parser(
        { trivia: whitespace },
        sequence(
          not(parser(
            { trivia: whitespace },
            sequence(
              g.NthExpression,
              g.NthOfKeyword
            )
          )),
          g.PseudoSelectorList
        )
      )
    ),
    (children) => {
      const selector = children.find(isSelectorList);
      const nth = children.find(isToken);
      if (nth === undefined) {
        if (selector === undefined) {
          throw new TypeError('Jess nth-of-type pseudo argument lost its selector.');
        }
        return selector;
      }
      return nth.value;
    }
  );
  const PseudoSelector = node<SimpleToken>(
    'PseudoSelector',

    /*
     * Insignificant whitespace may surround a functional pseudo's argument inside
     * its parens (`:not( .b )`, `:nth-child( 2n+1 )`). Consume it here so valid
     * CSS is accepted in the .jess dialect exactly as the canonical CSS grammar
     * accepts it; it is trivia, so the serialized argument stays normalized.
     * The one glued name/function opener routes nth and selector-only names to
     * their own argument grammars, so `of S` stays child-index-only and
     * `:not(2n+1)` cannot fall through to general-any text. A bare nth or
     * selector-only name rejects rather than becoming a keyword pseudo.
     */
    sequence(
      g.PseudoSelectorColon,
      dispatch(
        g.identifierOrFunction,
        caseInsensitiveWhen(
          ['nth-child(', 'nth-last-child('],
          sequence(
            routed(),
            optional(rawWhitespace),
            NthChildArgument,
            optional(rawWhitespace),
            literal(')')
          )
        ),
        caseInsensitiveWhen(
          ['nth-of-type(', 'nth-last-of-type('],
          sequence(
            routed(),
            optional(rawWhitespace),
            NthTypeArgument,
            optional(rawWhitespace),
            literal(')')
          )
        ),
        caseInsensitiveWhen(
          ['is(', 'where(', 'not(', 'has(', 'matches('],
          sequence(
            routed(),
            optional(rawWhitespace),
            g.PseudoSelectorArgument,
            optional(rawWhitespace),
            literal(')')
          )
        ),
        caseInsensitiveWhen(
          [
            'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type',
            'is', 'where', 'not', 'has', 'matches'
          ],
          not(routed())
        ),
        when(
          endsWith('('),
          noTrivia(sequence(
            routed(),
            g.GenericPseudoArgument
          ))
        ),
        otherwise(routed())
      )
    ),
    (children) => {
      const pseudoName = functionOpenName(children[1]);
      const head = `${requireToken(children[0]).value}${pseudoName}`;
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
      if (isSelectorList(arg) && STRUCTURED_PSEUDOS.has(pseudoName.toLowerCase())) {
        return pseudoSelector(
          head,
          arg
        );
      }
      const argText = isSelectorList(arg) ? staticSelectorText(arg) : requireString(arg);
      return simpleSelector(`${head}(${argText})`);
    }
  );
  const PseudoSelectorCompound = node<SelectorTerm>(
    'PseudoSelectorCompound',
    noTrivia(oneOrMore(choice(
      parser(
        { trivia: whitespace },
        g.AttributeSelector
      ),
      g.PseudoSelector,
      g.Parent,
      g.NamespaceTypeSelector,
      g.BasicSelector
    ))),
    reduceCompound
  );
  const selectorCombinator = choice(
    literal('||'),
    literal('>'),
    literal('+'),
    literal('~')
  );
  const PseudoSelectorComplex = node<SelectorBranch>(
    'PseudoSelectorComplex',
    sequence(
      g.PseudoSelectorCompound,
      many(sequence(
        optional(selectorCombinator),
        g.PseudoSelectorCompound
      ))
    ),
    (children) => {
      const segments: Array<{ combinator?: JessComplexTail['combinator']; term: SelectorTerm }> = [];
      let combinator: JessComplexTail['combinator'] = ' ';
      for (const child of children) {
        if (isSelectorTerm(child)) {
          segments.push(segments.length === 0 ? { term: child } : { combinator, term: child });
          combinator = ' ';
          continue;
        }
        if (isToken(child)) {
          combinator = jessCombinator(child);
        }
      }
      return selectorBranchOf([segments[0]!, ...segments.slice(1)]);
    }
  );
  const PseudoSelectorTail = node<SelectorBranch>(
    'PseudoSelectorTail',
    parser(
      { trivia: whitespace },
      sequence(
        literal(','),
        g.PseudoSelectorComplex
      )
    ),
    reduceSelectorTail
  );
  const PseudoSelectorList = node<SelectorList>(
    'PseudoSelectorList',
    parser(
      { trivia: whitespace },
      sequence(
        g.PseudoSelectorComplex,
        many(g.PseudoSelectorTail)
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
   * stay unpopulated); `PseudoSelector` derives opaque SimpleSelector text otherwise.
   */
  const PseudoSelectorArgument = node<SelectorList | string>(
    'PseudoSelectorArgument',
    parser(
      { trivia: whitespace },
      g.PseudoSelectorList
    ),
    (children) => {
      const selector = children.find(isSelectorList);
      if (selector === undefined) {
        throw new TypeError('Jess static pseudo argument lost its selector.');
      }
      return selector;
    }
  );

  /*
   * A functional pseudo this grammar has no typed argument for is still
   * well-formed CSS: Selectors-4 §3.5 gives an unknown functional pseudo-class an
   * `<any-value>` argument, and WHETHER a pseudo exists is a language-service
   * fact, not a parse decision — `a:totally-made-up(1)` and `:lang("en-US")` keep
   * the whole stylesheet parseable. This is its own structural `<any-value>`
   * production, not a speculative selector parse: only the explicitly routed
   * selector pseudo names accept `PseudoSelectorArgument`. A top-level `$` ends
   * this structured argument, so the required `)` then fails and a Jess
   * interpolation cannot become a generic pseudo-argument byte sequence.
   */
  const GenericPseudoText = node<string>(
    'GenericPseudoText',
    regex(/(?:[^$()[\]{}'"\\/]|\/(?!\*))+/),
    children => requireToken(children[0]).value
  );

  /*
   * The entry points scan opaque runs with `scanSkip: [blockComment, quoted…]`,
   * so a `)` inside a comment or a string is argument content everywhere the
   * scanner owns the run. This structured `<any-value>` argument replaces that
   * scanner (a top-level `$` has to end it), so it owns the same three skips:
   * quoted text below, groups below, and a block comment here. The comment is
   * not semantic payload — it is a non-terminating byte of an opaque capture,
   * retained because the capture is byte-preserving.
   */
  const GenericPseudoComment = node<string>(
    'GenericPseudoComment',
    regex(/\/\*(?:[^*]|\*(?!\/))*\*\//),
    children => requireToken(children[0]).value
  );
  const GenericPseudoEscape = node<string>(
    'GenericPseudoEscape',
    regex(/\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])/),
    children => requireToken(children[0]).value
  );
  const GenericPseudoItem = node<string>(
    'GenericPseudoItem',
    noTrivia(choice(
      g.GenericPseudoText,
      g.GenericPseudoComment,
      g.GenericPseudoEscape,
      g.LiteralQuoted,
      g.GenericPseudoGroup
    )),
    (children) => {
      const child = children[0];
      return isQuoted(child) ? child.src : requireString(child);
    }
  );
  const GenericPseudoGroup = node<string>(
    'GenericPseudoGroup',
    choice(
      sequence(literal('('), many(g.GenericPseudoItem), literal(')')),
      sequence(literal('['), many(g.GenericPseudoItem), literal(']')),
      sequence(literal('{'), many(g.GenericPseudoItem), literal('}'))
    ),
    children => children.map(child => typeof child === 'string' ? child : requireToken(child).value).join('')
  );
  const GenericPseudoArgument = node<string>(
    'GenericPseudoArgument',
    noTrivia(sequence(
      many(g.GenericPseudoItem),
      literal(')')
    )),
    (children, _fields, span, _rawChildren, _triviaLog, state) => {
      const source = sourceFromState(state);
      if (source !== undefined && span.end > span.start) {
        return source.slice(span.start, span.end - 1);
      }
      return children.filter((child): child is string => typeof child === 'string').join('');
    }
  );
  const SelectorCapture = node<SelectorCapture>(
    'SelectorCapture',
    sequence(
      literal('*['),
      g.PseudoSelectorList,
      literal(']')
    ),
    (children) => {
      const branches = requireSelectorList(children[1]).selectors.map(selectorBranchCanonical);
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
  const CallComponent = node<ValueSlot>(
    'CallComponent',
    sequence(
      g.ValueSpaceGroup,
      optional(sequence(
        optional(rawWhitespace),
        literal('/'),
        optional(rawWhitespace),
        g.ValueSpaceGroup
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
      throw new TypeError('Jess call component produced unexpected children.');
    }
  );

  /*
   * An argument comma admits padding on BOTH sides. Unlike a value-list comma
   * there is no competing punctuation reading inside an argument list, so
   * `f(c , d)` and `f(c /* z *\/, d)` are plain padded separators.
   */
  const CallArgument = node<ValueSlot>(
    'CallArgument',
    sequence(
      optional(valueTrivia),
      literal(','),
      optional(valueTrivia),
      g.CallComponent
    ),
    (children) => {
      if (!children.some(child => isToken(child) && child.value === ',')) {
        throw new TypeError('Jess call argument lost its comma.');
      }
      const value = children.at(-1);
      return Array.isArray(value) ? value : requireValueNode(value);
    }
  );

  /*
   * CSS keeps custom-property values as their own atom; ordinary identifiers
   * and glued function openers are the routed family. Route that consumed
   * spelling exactly once: `url(` keeps its dedicated body, `var(` retains its
   * comma rule, generic functions own Call, and a bare identifier remains a
   * Keyword. This prevents a malformed known URL from falling through to
   * GenericCall after its URL production rejects.
   */
  const CustomPropertyValue = node<Keyword>(
    'CustomPropertyValue',
    g.CustomPropertyName,
    children => keyword(requireToken(children[0]).value)
  );
  const KeywordValue = node<Keyword | Null>(
    'Keyword',
    routed(),
    children => keywordOrNull(requireToken(children[0]).value)
  );
  const VarCall = node<FunctionCall>(
    'VarCall',
    sequence(
      routed(),
      optional(valueTrivia),
      g.CustomPropertyValue,
      optional(valueTrivia),
      optional(sequence(
        literal(','),
        optional(valueTrivia),
        optional(g.Value),
        optional(valueTrivia)
      )),
      literal(')')
    ),
    children => funcCall(
      functionOpenName(children[0]),
      children.filter(isValueSlotValue)
    )
  );

  /*
   * A direct call owns its argument boundaries and recursive call shape. Its
   * components retain the existing Jess value-term contract, including
   * variable-led expressions (documented function arguments); the new slash
   * separator does not make `/` available as bare Jess arithmetic. Dynamic
   * `$[...]` lookup remains outside this slice until it has a typed reduction;
   * a named argument now has one — `FunctionCall.args` is a `CallArg[]`, the
   * same node a mixin-call argument is. `var()` is the one CSS-defined exception that
   * permits the comma without a following value, so it routes before the
   * generic continuation instead of relaxing every function call.
   */
  const GenericCall = node<FunctionCall>(
    'Call',
    sequence(
      routed(),
      optional(valueTrivia),
      optional(sequence(
        g.CallComponent,
        many(g.CallArgument)
      )),
      optional(valueTrivia),
      literal(')')
    ),
    children => funcCall(
      functionOpenName(children[0]),
      children.slice(1, -1).filter(isValueSlotValue)
    )
  );
  const UrlFunction = node<Url>(
    'Url',
    sequence(
      routed(),
      noTrivia(sequence(
        optional(choice(
          g.Quoted,
          g.UrlInterpolatedValue,
          g.UnquotedUrlText
        )),
        literal(')')
      ))
    ),
    urlFromChildren
  );

  /*
   * The single Jess divergence from the CSS calc family: an operand may be any
   * Jess value form ($var, `$.`-lookup, and the three interpolation spellings).
   * They resolve to an operand — Jess does not REDUCE the arithmetic here, it
   * only records the structure, exactly as CSS does for `var()`.
   */
  const CalcValue = node<ValueNode>(
    'CalcValue',
    choice(
      g.Dimension,
      g.Color,
      g.UnicodeRange,
      g.MathDollarValue,
      g.InterpolatedValue,
      g.CalcParen,
      g.IdentifierOrFunction,
      g.Quoted,
      g.CustomPropertyValue
    ),
    { project: 0 }
  );

  /*
   * CSS arithmetic parentheses are structural only inside calc(), where they
   * preserve math precedence in the AST.
   */
  const CalcParen = node<ValueNode>(
    'CalcParen',
    noTrivia(sequence(
      literal('('),
      optional(valueTrivia),
      g.CalcSum,
      optional(valueTrivia),
      literal(')')
    )),
    children => block(requireValueNode(children.find(isValueNode)))
  );

  const CalcProduct = node<ValueNode>(
    'CalcProduct',
    noTrivia(sequence(
      g.CalcValue,
      many(sequence(
        calcProductOperator,
        g.CalcValue
      ))
    )),
    foldCalcOperation
  );
  const CalcSum = node<ValueNode>(
    'CalcSum',
    noTrivia(sequence(
      g.CalcProduct,
      many(sequence(
        calcSumOperator,
        g.CalcProduct
      ))
    )),
    foldCalcOperation
  );

  /*
   * The SEQUENCE rung, and the reason routing every §10 name to the ladder is a
   * widening rather than a narrowing. `CalcSum` has no space-separated-run
   * derivation because `calc()` never needed one, but `min(1px 2px)`,
   * `clamp(1px 2px, 3px)` and `min(red blue)` are shapes the grammar accepts
   * today — the parser accepts SHAPES, not semantics, so narrowing them would
   * be a regression.
   *
   * The separator is REQUIRED between run items, which is the adjacency
   * question (ledger G24) and the one deliberate difference from an ordinary
   * value run: at top level `1rem+1vw` is two adjacent component values, but
   * inside a math function css-values-4 §10.1 requires real whitespace on both
   * sides of `+`/`-`, so `calc(1rem+1vw)` must be REJECTED. It is rejected by
   * the absence of an adjacent-items arm, not by any production re-spelling
   * what a separator looks like.
   */
  const CalcSequence = node<ValueSlot>(
    'CalcSequence',
    noTrivia(sequence(
      g.CalcSum,
      many(sequence(
        field(
          'separator',
          regex(/[ \t\n\r\f]+/)
        ),
        not(signedNumericStart),
        g.CalcSum
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
  const mathArgumentComma = noTrivia(sequence(
    optional(valueTrivia),
    literal(','),
    optional(valueTrivia)
  ));

  /*
   * `<calc-sum>#`. `round()` additionally takes an optional leading
   * `<rounding-strategy>` keyword (`round(up, 1.2px, 1px)`), which needs no arm
   * of its own — a bare keyword is already a `CalcValue`, so the strategy
   * arrives as the first argument. The grammar is therefore NOT uniformly
   * `<calc-sum>#`, and enforcing which name takes what is the language
   * service's job, not the parser's.
   */
  const calcFunctionArguments = oneOrMoreSep(
    g.CalcSequence,
    mathArgumentComma
  );

  /*
   * The css-values-4 §10 math functions — `calc` and the other twenty — share
   * ONE tail. `calc()` computes nothing; it is a spelling the parser detects so
   * the operations inside it keep their authorship, and every other §10 name
   * has exactly that relationship to the grammar.
   */
  const MathFunction = node<FunctionCall>(
    'Call',
    noTrivia(sequence(
      routed(),
      optional(valueTrivia),
      g.calcFunctionArguments,
      optional(valueTrivia),
      literal(')')
    )),
    children => funcCall(
      functionOpenName(children[0]),
      children.slice(1).filter(isValueSlotValue)
    )
  );

  const IdentifierOrFunction = dispatch(
    g.identifierOrFunction,
    caseInsensitiveWhen(
      'url(',
      UrlFunction
    ),
    caseInsensitiveWhen(
      'var(',
      g.VarCall
    ),

    /*
     * ONE multi-key arm, not twenty. parseman compiles `dispatch` to a linear
     * if/else chain with each tail fully INLINED, so twenty arms would inline
     * twenty copies of this tail — measured at roughly 1.4 MB of generated code
     * across css+jess against roughly 70 KB for the multi-key form. The tail is
     * a `g.`-rule reference for the same reason.
     */
    caseInsensitiveWhen(
      CSS_MATH_FUNCTION_OPENERS,
      g.MathFunction
    ),
    when(
      endsWith('('),
      GenericCall
    ),
    otherwise(g.KeywordValue)
  );

  /*
   * Jess collections are value-position maps. The canonical AST already has a
   * dedicated detached-ruleset carrier and the serializer already iterates its
   * declaration names/values for bracket `$for` bindings; lower it directly
   * instead of preserving a CST-shaped collection node or opaque source bytes.
   */
  const CollectionEntry = node<CollectionEntry>(
    'CollectionEntry',
    sequence(
      g.Identifier,
      literal(':'),
      parser(
        { trivia: whitespace },
        choice(
          g.ValueBlock,
          g.Value
        )
      ),
      optional(literal(';'))
    ),
    (children) => {
      const value = children[2];
      return collectionEntry(
        keyword(requireToken(children[0]).value),
        Array.isArray(value) ? value : valueSlot(requireValueNode(value))
      );
    }
  );
  const Collection = node<Collection>(
    'Collection',
    sequence(
      literal('{'),
      parser(
        { trivia: whitespace },
        many(g.CollectionEntry)
      ),
      optional(rawWhitespace),
      literal('}')
    ),
    children => collection(children.filter(isCollectionEntry))
  );

  /*
   * A chained reference is a value-only Jess form. It requires a tail so a
   * plain `$name` retains the existing VariableReference reduction, while the
   * authored chain stays one typed Reference without a post-parse walk.
   */
  const ReferenceTail = choice(
    node<JessReferenceTail>(
      'ReferenceDotTail',
      noTrivia(sequence(
        literal('.'),
        dollarName
      )),
      (children) => {
        const name = requireToken(children[1]).value;
        return { step: lookupStep('member', name), src: `.${name}` };
      }
    ),
    node<JessReferenceTail>(
      'ReferenceBracketTail',
      noTrivia(sequence(
        literal('['),
        choice(
          g.VariableReference,
          g.Quoted,
          regex(/[+-]?\d+(?:\.\d+)?/),
          g.Keyword
        ),
        literal(']')
      )),
      (children) => {
        const key = children[1];
        if (isValueNode(key) && key.type === 'Lookup' && key.kind === 'var') {
          return { step: lookupStep('var', key), src: `[${key.scope === 'scoped' ? '$^' : '$'}${lookupNameSource(key.name)}]` };
        }
        if (isValueNode(key) && key.type === 'Quoted') {
          return { step: lookupStep('member', key), src: `[${key.src}]` };
        }
        if (isToken(key)) {
          return { step: lookupStep('index', Number(key.value), 0), src: `[${key.value}]` };
        }
        if (isValueNode(key) && key.type === 'Keyword') {
          return { step: lookupStep('member', key), src: `[${key.src}]` };
        }
        throw new TypeError('Jess reference bracket key must be a typed value.');
      }
    )
  );

  /*
   * `(args)` — a CALL step on a variable-held value: `$f(1, 2)`, `$f($b: 2)`.
   * It reuses the mixin argument production verbatim, so a lambda call binds
   * positionally, by name, and against defaults through the ONE binder a named
   * mixin call already uses. It is deliberately NOT folded INTO the shared
   * `ReferenceTail`, which stays access-only: `$type.*()` must keep
   * reducing through the dedicated `GuardCall` mixin-guard syntax
   * instead of collapsing into an ordinary member-call chain. Expression and
   * condition positions opt in to dispatch by listing this tail alongside the
   * access tail (see `ExpressionAtom`, `DollarValue`).
   */
  const ReferenceCallTail = node<JessReferenceTail>(
    'ReferenceCallTail',
    noTrivia(sequence(
      literal('('),
      parser(
        { trivia: whitespace },
        optional(oneOrMoreSep(
          g.MixinCallArgument,
          literal(',')
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
   * The first dollar-family characters determine the base unambiguously:
   * `$.` starts declaration access, `$^name` starts a scoped variable, and
   * `$name` starts a live variable. Consume that complete normal-value opener
   * once and route the selected semantic tail; a speculative declaration arm
   * would otherwise consume `$` and reparse every ordinary variable value.
   * `$(` and `$[` deliberately do not match this opener, so Expression and
   * DollarInterp retain their distinct value-position syntax.
   *
   * Arithmetic and comparison stay in the explicit `$(...)` expression grammar
   * so normal value position cannot admit expression-only forms like leading-dot
   * declaration lookup.
   */
  const dollarValueHead = token(noTrivia(choice(
    literal('$.'),
    sequence(literal('$^'), dollarName),
    sequence(literal('$'), dollarName)
  )));
  const RoutedDeclarationReference = node<Lookup>(
    'DeclarationReference',
    routed(),
    (_children, _fields, span) => withSourceSpan(declarationReference('$'), span)
  );
  const RoutedVariableReference = node<Lookup>(
    'VariableReference',
    routed(),
    (children, _fields, span) => {
      /* The discriminator carries the full `$name` or `$^name` opener. */
      const raw = requireToken(children[0]).value;
      const scoped = raw.startsWith('$^');
      return withSourceSpan(
        variableReference(raw.slice(scoped ? 2 : 1), scoped ? 'scoped' : 'live'),
        span
      );
    }
  );

  /*
   * The same tail WITHOUT the slash-list arm, for use inside a css-values-4 §10
   * math function.
   *
   * In ordinary value position a `/` after a variable is an authored value
   * boundary, not division — that is a deliberate `.jess` rule and `$( $w / 2 )`
   * is the arithmetic spelling. Inside a math function the same bytes ARE
   * division: `calc($val / 2)` must come back as `calc(8px / 2)`, one preserved
   * operation, and the slash-list arm was swallowing the `/` before the math
   * ladder could see it — which is why that row emitted `8px / 2` with the
   * wrapper dropped.
   */
  const mathVariableDollarValueTail = sequence(
    RoutedVariableReference,
    optional(oneOrMore(choice(
      g.ReferenceCallTail,
      g.ReferenceTail
    )))
  );
  const variableDollarValueTail = sequence(
    RoutedVariableReference,
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
        g.ValueAtom
      ),

      /* Accessor-tail chain (`.name`, `[key]`). */
      oneOrMore(choice(
        g.ReferenceCallTail,
        g.ReferenceTail
      ))
    ))
  );
  const DollarValue = node<ValueNode>(
    'DollarValue',
    noTrivia(dispatch(
      dollarValueHead,
      when(
        '$.',
        sequence(
          RoutedDeclarationReference,
          dollarName,
          many(choice(
            g.ReferenceCallTail,
            g.ReferenceTail
          ))
        )
      ),
      otherwise(variableDollarValueTail)
    )),
    dollarValueFromChildren
  );

  /*
   * `DollarValue` for math positions: same reduction, slash-free tail. Sharing
   * ONE reducer keeps the two spellings from drifting — the difference between
   * them is exactly which continuations the tail admits.
   */
  const MathDollarValue = node<ValueNode>(
    'DollarValue',
    noTrivia(dispatch(
      dollarValueHead,
      when(
        '$.',
        sequence(
          RoutedDeclarationReference,
          dollarName,
          many(choice(
            g.ReferenceCallTail,
            g.ReferenceTail
          ))
        )
      ),
      otherwise(mathVariableDollarValueTail)
    )),
    dollarValueFromChildren
  );

  /*
   * A value-position interpolation may carry an authored literal tail — the unit
   * in `$(20)px`, a suffix in `$[name]-suffix`. That tail is grammar structure
   * (one more Interpolation part), never a re-scan of the interpolation's bytes.
   * Recognizing the `$(`/`$[` head ONCE and folding the optional tail here keeps
   * the plain (tail-free) form a single parse with its existing Interpolation.
   */
  const InterpolatedValue = node<Interpolation>(
    'InterpolatedValue',
    noTrivia(sequence(
      choice(
        g.Expression,
        g.DollarInterp
      ),
      many(choice(
        interpolatedValueTail,
        g.Expression,
        g.DollarInterp
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
   * `[a]` in value position — CSS `<line-names>`, and the same bytes Sass spells
   * as a bracketed list. Mirrors the CSS base's `SquareValue` so `.jess` stays a
   * superset; named for the delimiter rather than for grid, because the shape has
   * more than one consumer.
   *
   * It belongs in the continuation set, unlike `Collection`: `]` terminates it, so
   * a following atom has an unambiguous start. `$[ … ]` lookup is unaffected — that
   * form is claimed by `DollarValue`, whose `$` head this arm never sees.
   *
   * The empty interior is the EMPTY SLOT `[]`, exactly as the CSS base spells it —
   * not `any('')`. A contentless `Any` erases the only fact `[]` carries, so
   * `isTruthy` read a non-empty group and answered TRUTHY for the empty list
   * (§4.4's fourth falsy row is EMPTINESS). The emptiness is stored here, losslessly,
   * rather than re-derived downstream from an empty `src`.
   */
  const SquareValue = node<ValueNode>(
    'SquareValue',
    noTrivia(sequence(
      literal('['),
      optional(valueTrivia),
      optional(g.Value),
      optional(valueTrivia),
      literal(']')
    )),
    children => block(
      children.find(isValueSlotValue) ?? [],
      'square'
    )
  );

  /*
   * The three `$`-headed arms (DollarValue `$name`, the `$(` expression / `$[` lookup
   * family, and the `$[` accessor inside it) are mutually exclusive on the
   * character after `$`, so their relative order is behaviour-neutral. Plain
   * `$name` references dominate real values, so DollarValue leads the `$` group.
   * Its complete `$name` / `$^name` head rejects `$(`/`$[` before dispatch, so
   * those forms enter only their own node families rather than a failed variable
   * route.
   * Every value atom EXCEPT a brace-delimited block. A block is self-terminating,
   * which is exactly why it may only ever be a value's FIRST atom: once a value
   * has started, a following `{ … }` would have no unambiguous end for the value
   * that precedes it. Keeping the block out of the continuation set is what makes
   * `$foo: bar { … }` a positioned parse error instead of a silent two-value read.
   */
  const nonBlockValueAtom = choice(
    g.SquareValue,
    g.DollarValue,
    g.ExpressionLambda,
    g.InterpolatedValue,
    g.SelectorCapture,
    g.CustomPropertyValue,
    g.UnicodeRange,
    g.IdentifierOrFunction,
    g.Quoted,
    g.Color,
    g.Dimension
  );
  const ValueAtom = node<ValueNode>(
    'ValueAtom',
    choice(
      g.Collection,
      nonBlockValueAtom
    ),
    children => requireValueNode(children[0])
  );

  /*
   * The authored space-adjacency run: the value atoms between two slash
   * boundaries, or the whole term when the value carries no slash.
   */
  const ValueSpaceGroup = node<ValueSlot>(
    'ValueSpaceGroup',
    noTrivia(sequence(
      g.ValueAtom,
      many(sequence(
        field(
          'separator',
          regex(/[ \t\n\r\f]+/)
        ),
        nonBlockValueAtom
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
  const ValueTerm = node<ValueSlot>(
    'ValueTerm',
    noTrivia(sequence(
      g.ValueSpaceGroup,
      many(sequence(
        valueSlashBoundary,
        g.ValueSpaceGroup
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
  const Value = node<ValueSlot>(
    'Value',
    sequence(
      g.ValueTerm,
      many(sequence(
        literal(','),
        optional(regex(/[ \t\n\r\f]+/)),
        g.ValueTerm
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
   * The plain CSS component value: the leaves an authored CSS position admits
   * once every Jess execution form (`$…`, `$[…]`, `$(…)`, arithmetic, lambdas,
   * collections) is excluded. Both constrained positions — a conditional at-rule
   * header and an `@property` descriptor — take exactly this set, so they share
   * one production instead of drifting two copies apart.
   *
   * A CSS at-rule header must stay structural: a header form Jess does not model
   * is rejected rather than hidden in an Any/raw prelude. Extend this with
   * another typed form when Jess gives that form semantics.
   */
  const HeaderValue = node<ValueSlot>(
    'Value',
    noTrivia(sequence(
      g.HeaderValueAtom,
      many(sequence(
        regex(/[ \t\n\r\f]+/),
        g.HeaderValueAtom
      ))
    )),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : values;
    }
  );
  const HeaderCallArgument = node<ValueSlot>(
    'CallArgument',
    sequence(
      literal(','),
      optional(regex(/[ \t\n\r\f]+/)),
      g.HeaderValue
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
   * The shared identifier/function opener is routed below, so the static URL
   * leaf, generic call, and bare keyword never reread one another's prefix.
   */
  const HeaderCall = node<FunctionCall>(
    'Call',
    sequence(
      routed(),
      optional(sequence(
        g.HeaderValue,
        many(g.HeaderCallArgument)
      )),
      literal(')')
    ),
    (children) => {
      if (children.length < 2 || requireToken(children.at(-1)).value !== ')') {
        throw new TypeError('Jess plain function call lost its call boundaries.');
      }
      return funcCall(
        functionOpenName(children[0]),
        children.slice(1, -1).filter(isValueSlotValue)
      );
    }
  );

  /*
   * Header URLs deliberately retain the CSS-only URL payload. The normal Jess
   * value route replaces this child with its dynamic URL override, but media,
   * supports, and descriptor headers are not value positions. Routing after the
   * shared glued opener keeps that narrow override local without a competing
   * `Url` / `Call` / `Keyword` choice.
   */
  const HeaderUrl = node<Url>(
    'Url',
    sequence(
      routed(),
      optional(choice(
        g.LiteralQuoted,
        g.PlainUrlInner
      )),
      literal(')')
    ),
    urlFromChildren
  );
  const HeaderIdentifierOrFunction = dispatch(
    g.identifierOrFunction,
    caseInsensitiveWhen('url(', HeaderUrl),
    when(endsWith('('), HeaderCall),
    otherwise(g.KeywordValue)
  );
  const HeaderValueAtom = node<ValueNode>(
    'ValueAtom',
    choice(
      g.LiteralQuoted,
      g.Color,
      g.Dimension,
      g.CustomPropertyValue,
      HeaderIdentifierOrFunction
    ),
    children => requireValueNode(children[0])
  );

  /*
   * A media/container feature value may be a `<ratio>` — media-queries-4 §2.1,
   * `<number> [ / <number> ]?` — as in `(aspect-ratio: 16/9)`. The constrained header
   * atoms carry no slash of their own, so the query value takes the ratio tail
   * explicitly and reduces to the same typed Operation the prelude already uses
   * for `:` and the range comparisons. Left-factored on the atom: the no-slash
   * majority takes an absent optional tail instead of a doomed ratio arm.
   */
  const QueryValue = node<ValueNode>(
    'QueryValue',
    sequence(
      g.HeaderValueAtom,
      optional(sequence(
        optional(rawWhitespace),
        literal('/'),
        optional(rawWhitespace),
        g.HeaderValueAtom
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
            denominator,
            false,
            cssBaseMathOutsideParens('/')
          );
    }
  );
  const QueryFeatureName = node<JessQueryFeatureName>(
    'QueryFeatureName',
    g.Identifier,
    children => ({ property: keyword(requireToken(children[0]).value) })
  );
  const QueryComparisonFeature = node<ValueNode>(
    'QueryComparisonFeature',
    choice(
      sequence(
        literal('('),
        optional(rawWhitespace),
        g.QueryFeatureName,
        optional(rawWhitespace),
        field(
          'comparison',
          g.QueryComparisonOperator
        ),
        optional(rawWhitespace),
        g.QueryValue,
        optional(rawWhitespace),
        literal(')')
      ),
      sequence(
        literal('('),
        optional(rawWhitespace),
        g.QueryValue,
        optional(rawWhitespace),
        field(
          'comparison',
          g.QueryComparisonOperator
        ),
        optional(rawWhitespace),
        g.QueryFeatureName,
        optional(sequence(
          optional(rawWhitespace),
          field(
            'comparison',
            g.QueryComparisonOperator
          ),
          optional(rawWhitespace),
          g.QueryValue
        )),
        optional(rawWhitespace),
        literal(')')
      )
    ),
    (children, fields) => {
      const propertyFact = children.find((child): child is JessQueryFeatureName => typeof child === 'object' && child !== null && 'property' in child);
      if (propertyFact === undefined) {
        throw new TypeError('Jess query comparison lost its property.');
      }
      const values = children.filter(isValueNode);

      /*
       * Read the operators back from the shared terminal's captures. Restating the
       * operator set as a runtime filter would be a second, drift-prone copy of a
       * spelling `parser-shared` already owns — and PEG `choice` is ordered, so
       * every hand-maintained copy is a fresh chance to put `<` before `<=` and
       * mis-parse a range without erroring.
       */
      const operators = fields?.comparison === undefined
        ? []
        : requireFields(
            fields,
            'comparison'
          ).map(capture => typeof capture.value === 'string' ? capture.value : requireToken(capture.value).value);
      if (values.length === 0 || operators.length === 0) {
        throw new TypeError('Jess query comparison lost an operand.');
      }
      const propertyIndex = children.indexOf(propertyFact);
      const firstValueIndex = children.findIndex(isValueNode);
      let result = propertyIndex < firstValueIndex
        ? operation(
            operators[0]!,
            propertyFact.property,
            values[0]!,
            false,
            cssBaseMathOutsideParens(operators[0]!)
          )
        : operation(
            operators[0]!,
            values[0]!,
            propertyFact.property,
            false,
            cssBaseMathOutsideParens(operators[0]!)
          );
      if (operators.length === 2) {
        const trailing = values.at(-1);
        if (trailing === undefined) {
          throw new TypeError('Jess query comparison lost its range end.');
        }
        result = operation(
          operators[1]!,
          result,
          trailing,
          false,
          cssBaseMathOutsideParens(operators[1]!)
        );
      }
      return block(result);
    }
  );
  const QueryFeature = node<ValueNode>(
    'QueryFeature',
    noTrivia(choice(
      g.QueryComparisonFeature,
      sequence(
        literal('('),
        optional(rawWhitespace),
        g.Identifier,
        optional(rawWhitespace),
        literal(':'),
        optional(rawWhitespace),
        g.QueryValue,
        optional(rawWhitespace),
        literal(')')
      ),
      sequence(
        literal('('),
        optional(rawWhitespace),
        g.Identifier,
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
        'Jess CSS at-rule query lost its property name.'
      );
    }
  );

  /*
   * `only` belongs to the media-type form (`only screen and (...)`), not the
   * parenthesized-condition form. The generic at-rule prelude still shares
   * the same term combinator, but this branch keeps that syntactic boundary.
   */
  const QueryNonOnlyKeyword = node<Keyword>(
    'QueryNonOnlyKeyword',
    sequence(
      not(g.QueryOnly),
      g.Keyword
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
  const QueryDashedIdentifier = node<Keyword>(
    'QueryDashedIdentifier',
    g.CustomPropertyName,
    children => keyword(requireToken(children[0]).value)
  );
  const QueryTerm = node<ValueNode>(
    'QueryTerm',
    choice(
      g.QueryFeature,
      g.QueryDashedIdentifier,
      sequence(
        not(g.QueryOnly),
        g.HeaderValueAtom
      )
    ),
    children => requireValueNode(children.at(-1))
  );

  /*
   * This is the CSS media-query clause shape, named identically so the AST and
   * CST retain the shared semantic concept. It stays local only because direct
   * cross-artifact CSS AST builders cannot macro-fuse; Jess changes the term
   * leaf, not the clause/list structure.
   */
  const queryClause = noTrivia(sequence(choice(
    sequence(
      g.QueryOnly,
      regex(/[ \t\n\r\f]+/),
      g.QueryNonOnlyKeyword,
      many(sequence(
        regex(/[ \t\n\r\f]+/),
        g.QueryTerm
      ))
    ),
    sequence(
      g.QueryTerm,
      many(sequence(
        regex(/[ \t\n\r\f]+/),
        g.QueryTerm
      ))
    )
  )));
  const QueryClause = node<ValueNode>(
    'QueryClause',
    queryClause,
    (children) => {
      const values = children.filter(isValueNode);
      const startsWithOnly = children.some(child => isToken(child) && requireToken(child).value.toLowerCase() === 'only');
      return startsWithOnly ? spaced([keyword('only'), ...values]) : values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const QueryPrelude = node<ValueNode>(
    'QueryPrelude',
    oneOrMoreSep(g.QueryClause, literal(',')),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : list(values, ',');
    }
  );

  /*
   * A generic at-rule prelude is a comma-separated `<media-query-list>` that
   * may also be absent, so its clause is `QueryClause` exactly as `QueryPrelude`'s
   * is. It carried a second name for its CALLER, `AtRulePreludeTerm`, and that
   * is what kept a byte-identical copy alive.
   */
  const AtRulePrelude = node<ValueNode | null>(
    'AtRulePrelude',
    sequence(
      optional(g.QueryClause),
      many(sequence(
        literal(','),
        g.QueryClause
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

  const containerNameReserved = keywords(
    ['none'],
    { boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF', caseInsensitive: true }
  );
  const containerName = sequence(
    not(containerNameReserved),
    g.Keyword
  );
  const ContainerQueryClause = node<ValueNode>(
    'ContainerQueryClause',
    sequence(
      g.QueryFeature,
      many(sequence(
        g.QueryAndOr,
        g.QueryFeature
      ))
    ),
    (children) => {
      const values = children
        .filter((child): child is Token | ValueNode => isToken(child) || isValueNode(child))
        .map(child => isToken(child) ? keyword(child.value) : child);
      return values.length === 1
        ? values[0]!
        : spaced(values);
    }
  );
  const ContainerQueryPrelude = node<ValueNode>(
    'ContainerQueryPrelude',
    oneOrMoreSep(g.ContainerQueryClause, literal(',')),
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
  const ContainerPrelude = node<ValueNode>(
    'ContainerPrelude',
    choice(
      sequence(
        containerName,
        optional(g.ContainerQueryPrelude)
      ),
      g.ContainerQueryPrelude
    ),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );

  /*
   * An at-rule prelude is an IDENTIFIER position, so its dynamic form is the
   * same `${…}` every other name position takes — no prelude-local spelling.
   * `$(…)` is a value-position expression and is deliberately not admitted here:
   * its bare-identifier semantics differ from a name splice, which is exactly
   * the confusion one form per position removes.
   */
  const MediaPrelude = node<ValueNode | null>(
    'MediaPrelude',
    choice(
      g.DollarBrace,
      g.QueryPrelude
    ),
    children => children[0] === null ? null : requireValueNode(children[0])
  );

  /*
   * CSS owns the broad statement at-keyword token. Jess routes it once here
   * because the consumed spelling decides the media/container/generic header
   * family. The blocked spellings have dedicated typed productions elsewhere;
   * reject them here instead of letting a generic header steal their input.
   */
  const atRuleHeaderKeyword = token(noTrivia(g.StatementAtRuleName));
  const typedAtRuleHeader = not(routed());

  /*
   * The compiler route rejects this slot normally. The public CST route is
   * tolerant, so retain the same rejection as a positioned diagnostic instead
   * of silently dropping an invalid at-rule list item after the committed
   * routed header.
   */
  const requiredContainerPrelude = expect(g.ContainerPrelude, 'container prelude');

  /*
   * Statement headers remain interpolation-free. The documented deferred media form
   * is a block-only construct, so it cannot silently become `@media $(x);`.
   * The one consumed at-keyword routes `@media` to its stricter statement
   * form, rejects names owned by another typed production, and gives every
   * remaining CSS name the generic prelude. This is a routed token family, not
   * a late-delimiter choice.
   */
  const AtRuleStatementHeader = node<JessAtRuleHeader>(
    'AtRuleStatementHeader',
    dispatch(
      atRuleHeaderKeyword,
      caseInsensitiveWhen(
        '@media',
        sequence(
          routed(),
          not(choice(
            literal('{'),
            literal(';')
          )),
          g.AtRulePrelude
        )
      ),
      caseInsensitiveWhen(typedAtRuleHeaderNames, g.typedAtRuleHeader),
      when(endsWith('-keyframes'), g.typedAtRuleHeader, { caseInsensitive: true }),
      otherwise(sequence(
        routed(),
        g.AtRulePrelude
      ))
    ),
    (children) => {
      const name = requireToken(children.find(isToken)!).value;
      const prelude = children.find(isValueNode) ?? null;
      return { name, prelude };
    }
  );

  /*
   * The generic block-header branch has already consumed its at-keyword in
   * `AtRuleHeader`. It retains the semantic statement-header CST owner rather
   * than inventing a routed/provenance node name for the same concept.
   */
  const RoutedAtRuleStatementHeader = node<JessAtRuleHeader>(
    'AtRuleStatementHeader',
    sequence(
      routed(),
      g.AtRulePrelude
    ),
    (children) => {
      const name = requireToken(children.find(isToken)!).value;
      const prelude = children.find(isValueNode) ?? null;
      return { name, prelude };
    }
  );

  /*
   * Keep the dynamic extension scoped to documented block `@media $(…)`.
   * The routed keyword itself decides media/container/generic ownership; each
   * selected branch then owns its distinct prelude. Mixing the deferred media
   * form with query terms remains rejected by `MediaPrelude`.
   */
  const AtRuleHeader = node<JessAtRuleHeader>(
    'AtRuleHeader',
    dispatch(
      atRuleHeaderKeyword,
      caseInsensitiveWhen(
        '@media',
        sequence(
          routed(),
          not(literal('{')),
          g.MediaPrelude
        )
      ),
      caseInsensitiveWhen(
        '@container',
        sequence(
          routed(),
          requiredContainerPrelude
        )
      ),
      caseInsensitiveWhen(typedAtRuleHeaderNames, g.typedAtRuleHeader),
      when(endsWith('-keyframes'), g.typedAtRuleHeader, { caseInsensitive: true }),
      otherwise(RoutedAtRuleStatementHeader)
    ),
    (children) => {
      const statementHeader = children.find(isJessAtRuleHeader);
      if (statementHeader !== undefined) {
        return statementHeader;
      }
      const name = requireToken(children.find(isAtRuleNameToken)!).value;
      const prelude = children.find(isValueNode) ?? null;
      return { name, prelude };
    }
  );

  /*
   * `@supports` is not a generic CSS header: its condition grammar owns every
   * parenthesis and logical connective. Keep this interpolation-free until a
   * typed model exists for general-enclosed forms such as `selector(...)`.
   * In particular, do not hide their arguments in Any/raw header bytes.
   * A supported declaration's value is the same plain CSS component value a
   * media feature takes — `@supports (width: min(1px, 2px))` and
   * `@supports (background: url(a.png))` are ordinary CSS. A third private copy
   * of the leaf set is what let those degrade to opaque general-enclosed text.
   */
  const SupportsAtom = node<ValueNode>(
    'SupportsAtom',
    g.HeaderValueAtom,
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
   * strict chain mirrors every non-quoted wrapper and the permissive chain
   * mirrors every wrapper of its own. Within one chain, delimiter spellings are
   * first-set-disjoint alternatives of one semantic group or quoted template;
   * only the `g.Expression` arm distinguishes the two chains.
   */

  /*
   * STRICT chain — the general-enclosed body and its non-quoted wrappers. Its
   * quoted arms hand off to the permissive chain below and never come back.
   */
  const GeneralTemplateGroup = node<Interpolation>(
    'GeneralTemplateGroup',
    choice(
      sequence(literal('('), g.GeneralTemplate, literal(')')),
      sequence(literal('['), g.GeneralTemplate, literal(']')),
      sequence(literal('{'), g.GeneralTemplate, literal('}'))
    ),
    templateInterpolationFromChildren
  );

  /*
   * The single door into the permissive chain, from EITHER side: a string body
   * is permissive wherever the quote was written, so this rung is chain-
   * independent and shared. Only the wrappers below actually differ.
   */
  const GeneralTemplateQuoted = node<Interpolation>(
    'GeneralTemplateQuoted',
    choice(
      sequence(literal('"'), g.GeneralQuotedTemplate, literal('"')),
      sequence(literal('\''), g.GeneralQuotedTemplate, literal('\''))
    ),
    templateInterpolationFromChildren
  );
  const GeneralTemplate = node<Interpolation>(
    'GeneralTemplate',
    many(choice(
      g.DollarBrace,
      g.GeneralTemplateGroup,
      g.GeneralTemplateQuoted,
      generalTemplateText
    )),
    templateInterpolationFromChildren
  );

  /*
   * PERMISSIVE chain — everything reachable from inside a quoted sub-template.
   * Reached ONLY through the two quoted arms above, and closed under its own
   * wrappers so nesting never escapes back to the strict chain.
   */
  const GeneralQuotedTemplateGroup = node<Interpolation>(
    'GeneralQuotedTemplateGroup',
    choice(
      sequence(literal('('), g.GeneralQuotedTemplate, literal(')')),
      sequence(literal('['), g.GeneralQuotedTemplate, literal(']')),
      sequence(literal('{'), g.GeneralQuotedTemplate, literal('}'))
    ),
    templateInterpolationFromChildren
  );
  const GeneralQuotedTemplate = node<Interpolation>(
    'GeneralQuotedTemplate',
    many(choice(
      g.DollarBrace,
      g.Expression,
      g.GeneralQuotedTemplateGroup,
      g.GeneralTemplateQuoted,
      generalTemplateText
    )),
    templateInterpolationFromChildren
  );
  const Enclosed = node<FunctionCall | Block>(
    'Enclosed',
    choice(
      sequence(
        g.Identifier,
        literal('('),
        g.GeneralTemplate,
        literal(')')
      ),
      sequence(
        literal('('),
        g.GeneralTemplate,
        literal(')')
      )
    ),
    children => children.length === 4
      ? funcCall(
          requireToken(children[0]).value,
          [requireInterpolation(children[2])]
        )
      : block(requireInterpolation(children[1]))
  );
  const SupportsNot = node<Keyword>(
    'SupportsNot',
    g.QueryNot,
    children => keyword(requireToken(children[0]).value)
  );
  const SupportsLogical = node<Keyword>(
    'SupportsLogical',
    g.QueryAndOr,
    children => keyword(requireToken(children[0]).value)
  );
  const SupportsFeature = node<ValueNode>(
    'SupportsFeature',
    noTrivia(choice(
      sequence(
        literal('('),
        optional(rawWhitespace),
        g.Identifier,
        optional(rawWhitespace),
        literal(':'),
        optional(rawWhitespace),
        g.SupportsAtom,
        optional(rawWhitespace),
        literal(')')
      ),
      sequence(
        literal('('),
        optional(rawWhitespace),
        g.Identifier,
        optional(rawWhitespace),
        literal(')')
      )
    )),
    children => reduceColonFeature(
      children,
      'Jess supports feature lost its property name.'
    )
  );
  const SupportsInParens = node<ValueNode>(
    'SupportsInParens',
    choice(
      sequence(
        literal('('),
        g.SupportsCondition,
        literal(')')
      ),
      g.SupportsFeature,
      g.Enclosed
    ),
    (children) => {
      const value = children.find(isValueNode);
      if (value === undefined) {
        throw new TypeError('Jess supports parenthesis lost its typed condition.');
      }
      return isValueNode(children[0]) ? value : block(value);
    }
  );
  const SupportsCondition = node<ValueNode>(
    'SupportsCondition',
    choice(
      sequence(
        g.SupportsNot,
        g.SupportsInParens
      ),
      sequence(
        g.SupportsInParens,
        many(sequence(
          g.SupportsLogical,
          g.SupportsInParens
        ))
      )
    ),
    (children) => {
      const values = children.filter(isValueNode);
      if (values.length === 0) {
        throw new TypeError('Jess supports condition lost every typed part.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const Charset = node<AtRuleStatement>(
    'Charset',
    sequence(
      charsetAtRuleName,
      g.LiteralQuoted,
      literal(';')
    ),
    children => atRuleStatement(
      requireToken(children[0]).value,
      requireLiteralQuoted(children[1])
    )
  );

  /*
   * A bare Jess `@import` is CSS only. The target is the existing static CSS
   * quoted/URL family and its tail is the existing CSS-shaped opaque prelude.
   * Top-level `$` remains a sentinel, so compiler values cannot be flattened
   * into an authored import. Compiler loading is explicitly `@-import`.
   */
  const ImportStatement = node<AtRuleStatement>(
    'ImportStatement',
    sequence(
      importAtRuleName,
      choice(
        g.LiteralQuoted,
        g.Url
      ),
      g.OpaqueAtPrelude,
      literal(';')
    ),
    (children) => {
      const target = children[1];
      if (!isQuoted(target) && !isUrl(target)) {
        throw new TypeError('Jess CSS import lost its static target.');
      }
      const tail = children[2];
      if (tail !== null && typeof tail !== 'string') {
        throw new TypeError('Jess CSS import lost its opaque tail.');
      }
      const targetText = target.type === 'Quoted'
        ? target.src
        : `url(${expressionSource(target.value)})`;
      return atRuleStatement(
        requireToken(children[0]).value,
        any(tail === null ? targetText : `${targetText} ${tail}`)
      );
    }
  );

  /*
   * Shared block-body statement set for the at-rule-bearing blocks (`@supports`,
   * generic at-rules): identical 16-rule choice plus a bare `;` arm. Keep this
   * as one local const so the macro fuses a single shared choice instead of
   * re-emitting it per block.
   *
   * The `@`-headed cluster is placed AFTER Ruleset: a ruleset requires a
   * selector (never `@`) and every at-rule requires `@`, so the two are disjoint
   * and this ordering is behaviour-neutral. Because rules dominate block bodies,
   * trying Ruleset first means a non-`@` statement never enters (and rolls back) the
   * at-rule recognizers — only genuine `@` statements reach the cluster.
    */
  const atBlockStatement = choice(
    g.MixinCall,
    g.ValueBlockDeclaration,
    g.VariableDeclaration,
    g.Declaration,
    g.MixinDefinition,
    g.ReferenceCall,
    g.Apply,
    g.Extend,
    g.For,
    g.If,
    g.While,
    g.Ruleset,
    g.SupportsAtRuleBlock,
    g.Keyframes,
    g.OpaqueAtRuleBlock,
    g.ScopeBlock,
    g.AtRuleBlock,
    g.AtRuleStatement,
    literal(';')
  );

  /*
   * Shared nested-scope statement set for `$mixin`/`$for`/`$if` bodies: identical
   * 15-rule choice with no bare `;` or `$extend` arm.
    */
  const nestedBodyStatement = choice(
    literal(';'),
    g.MixinCall,
    g.ValueBlockDeclaration,
    g.VariableDeclaration,
    g.Declaration,
    g.MixinDefinition,
    g.For,
    g.If,
    g.While,
    g.ReferenceCall,
    g.Apply,
    g.Ruleset,
    g.SupportsAtRuleBlock,
    g.Keyframes,
    g.OpaqueAtRuleBlock,
    g.ScopeBlock,
    g.AtRuleBlock,
    g.AtRuleStatement
  );
  const SupportsAtRuleBlock = node<AtRuleBlock>(
    'SupportsAtRuleBlock',
    sequence(
      g.SupportsAtKeyword,
      g.SupportsCondition,
      literal('{'),
      many(atBlockStatement),
      literal('}')
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      requireToken(children[0]).value,
      requireValueNode(children[1]),
      collectBlockStatements(
        children,
        3
      )
    ), rawChildren), span)
  );

  /*
   * `@property` headers name a CSS custom property, not an ordinary at-rule
   * prelude. Retaining the contiguous `--` prefix as grammar structure blocks
   * a dynamic or malformed header from falling through the generic at-rule arm.
   */
  const PropertyName = node<Keyword>(
    'PropertyName',
    noTrivia(sequence(
      literal('--'),
      g.Identifier
    )),
    children => keyword(`${requireToken(children[0]).value}${requireToken(children[1]).value}`)
  );

  /*
   * Registered-property descriptors are authored CSS component values, but they
   * are not Jess value positions: they take the shared plain component value
   * above, never Value (which admits variable references,
   * interpolation, arithmetic, and collections) and never Any/raw source.
   */
  const PropertyDescriptor = node<Declaration>(
    'PropertyDescriptor',
    sequence(

      /* Statement span, terminator excluded — see `Declaration`. */
      field('statement', sequence(
        g.Identifier,
        literal(':'),
        g.HeaderValue
      )),
      literal(';')
    ),
    (children, fields) => {
      const value = children[2];
      const node = decl(
        requireToken(children[0]).value,
        Array.isArray(value) ? value : valueSlot(requireValueNode(value))
      );
      const statement = fields?.statement;
      return statement === undefined || Array.isArray(statement)
        ? node
        : withSourceSpan(node, statement.span);
    }
  );
  const PropertyAtRule = node<AtRuleBlock>(
    'PropertyAtRule',
    sequence(
      propertyAtRuleName,
      g.PropertyName,
      literal('{'),
      many(g.PropertyDescriptor),
      literal('}')
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      requireToken(children[0]).value,
      requireKeyword(children[1]),
      requireStatements(children.slice(
        3,
        -1
      ))
    ), rawChildren), span)
  );

  /*
   * Keyframes already fit the canonical AtRuleBlock + Ruleset model.  Keep the
   * header and selector boundary static until Jess has typed interpolation for
   * those positions; never turn either into a source-text prelude.
   */
  const KeyframeSelector = node<SimpleSelector>(
    'SimpleSelector',
    choice(
      keyframeEndpoint,
      g.Percentage
    ),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const KeyframeBlock = node<Ruleset>(
    'KeyframeBlock',
    sequence(
      g.KeyframeSelector,
      many(sequence(
        literal(','),
        g.KeyframeSelector
      )),
      literal('{'),
      many(choice(
        g.Declaration,
        literal(';')
      )),
      literal('}')
    ),
    (children, _fields, _span, rawChildren) => {
      const selectors = children.filter((child): child is SimpleSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'SimpleSelector')
        .map(selector => selector);
      const bodyOpen = children.findIndex(child => isToken(child) && child.value === '{');
      if (bodyOpen < 0) {
        throw new TypeError('Jess keyframe block lost its body boundary.');
      }
      return withBlockBody(rule(
        selist(...selectors),
        requireStatements(children.slice(
          bodyOpen + 1,
          -1
        ).filter(isDeclaration))
      ), rawChildren);
    }
  );
  const Keyframes = node<AtRuleBlock>(
    'Keyframes',
    sequence(
      g.KeyframesAtKeyword,
      choice(
        g.Keyword,
        g.LiteralQuoted
      ),
      literal('{'),
      many(g.KeyframeBlock),
      literal('}')
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      requireToken(children[0]).value,
      requireValueNode(children[1]),
      requireStatements(children.slice(
        3,
        -1
      ))
    ), rawChildren), span)
  );

  /*
   * The `$name` + assignment-operator head shared by the ordinary and the
   * block-valued variable declaration. Both reduce with `reduceVarDeclaration`,
   * which reads the operator by position, so the head must stay one shape.
   */
  const assignHead = choice(
    noTrivia(sequence(
      literal('$'),
      literal('^'),
      dollarName,
      literal('?:')
    )),
    noTrivia(sequence(
      literal('$'),
      dollarName,
      literal('?:')
    )),
    sequence(
      noTrivia(sequence(
        literal('$'),
        literal('^'),
        dollarName
      )),
      choice(
        literal(':='),
        literal(':')
      )
    ),
    sequence(
      noTrivia(sequence(
        literal('$'),
        dollarName
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
   * rule `Declaration` already follows. The last declaration in a list
   * needs no `;`, so the terminator is optional here too; there is no separate
   * "variable assignment" termination category.
   */
  const VariableDeclaration = node<VariableDeclaration>(
    'VariableDeclaration',
    sequence(
      assignHead,
      g.Value,
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
   * `ValueBlock` arm in the space-group continuation), because that is
   * exactly the case where the value's end would be ambiguous. Compose instead:
   * bind the block first (`$foo: {}`), then use it (`$bar: $foo bar;`).
   */
  const ValueBlockDeclaration = node<VariableDeclaration>(
    'ValueBlockDeclaration',
    sequence(
      assignHead,
      g.ValueBlock,
      optional(literal(';'))
    ),
    reduceVarDeclaration
  );

  /*
   * Priority is a Declaration field in the canonical AST, so this is ordinary
   * host-mode grammar construction rather than a Jess-specific compatibility path.
   * Comments around the marker/name are ambient trivia, not value children.
   */
  const Important = node<true>(
    'Important',
    sequence(
      literal('!'),
      g.ImportantToken
    ),
    (children) => {
      const marker = children.find((child): child is Token => isToken(child) && child.value === '!');
      if (marker === undefined) {
        throw new TypeError('Jess grammar lost its declaration-priority marker.');
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
   * Jess owns only its `${...}` segment grammar and AST reduction.
   * Cheap superset lookahead so an ordinary `color: …` declaration does not
   * enter the interpolated-property arm, consume the whole property name via
   * the optional literal start, fail the required interpolation, and backtrack a
   * property re-parse through Identifier. Skip this arm unless a
   * `${` actually precedes the next `:`/`;`/brace. A property name never
   * contains `:`, `;`, `{`, or `}`, so the predicate is a strict superset: a
   * real interpolated property is never skipped.
   */
  const interpolatedPropertyAhead = peek(regex(/[^{};:]*\$\{/));
  const InterpolatedProperty = node<Interpolation>(
    'InterpolatedProperty',
    noTrivia(sequence(
      interpolatedPropertyAhead,
      optional(g.InterpolatedPropertyStart),
      g.DollarBrace,
      many(choice(
        g.InterpolatedPropertyTail,
        g.DollarBrace
      ))
    )),
    (children) => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolation(child)) {
          parts.push(...child.parts);
        } else {
          /*
           * The superset lookahead emits a throwaway match token (`…${`). Real
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
   * the custom-property leaf, or that leaf's `--` prefix followed by `${...}`
   * segments.
   */
  const InterpolatedCustomPropertyName = node<string | Interpolation>(
    'InterpolatedCustomPropertyName',
    choice(
      noTrivia(sequence(
        literal('--'),
        many(customPropertyChunk),
        g.DollarBrace,
        many(choice(
          customPropertyChunk,
          g.DollarBrace
        ))
      )),
      g.CustomPropertyName
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
  const CustomGroup = node<readonly unknown[]>(
    'CustomGroup',
    parser({ trivia: customValueCommentTrivia },
      choice(
        sequence(literal('('), many(g.CustomInnerPart), literal(')')),
        sequence(literal('['), many(g.CustomInnerPart), literal(']')),
        sequence(literal('{'), many(g.CustomInnerPart), literal('}'))
      )
    ),
    children => children.slice()
  );
  const CustomInnerPart: Combinator<unknown> = choice(
    g.DollarBrace,
    g.CustomInnerContent,
    g.CustomSingleQuoted,
    g.CustomDoubleQuoted,
    g.CustomGroup
  );
  const CustomPart: Combinator<unknown> = choice(
    g.DollarBrace,
    g.CustomOuterContent,
    g.CustomSingleQuoted,
    g.CustomDoubleQuoted,
    g.CustomGroup
  );
  const CustomValue = node<ValueNode>(
    'CustomValue',
    parser({ trivia: customValueCommentTrivia }, many(g.CustomPart)),
    (children, _fields, span) => withSourceSpan(customValueFromChildren(children), span)
  );
  const CustomDeclaration = node<Declaration>(
    'CustomDeclaration',

    /*
     * A trailing `!important` is declaration priority, not value text: css-syntax-3
     * §5.5.6 strips it before the custom-property original-text step. The shared
     * value leaf already stops before the marker (and before the whitespace
     * preceding it), so this tail simply claims it, exactly like the ordinary
     * declaration tail below.
     */
    sequence(
      g.InterpolatedCustomPropertyName,
      literal(':'),
      g.CustomValue,
      optional(g.Important),
      optional(literal(';'))
    ),
    (children) => {
      const name = children[0];
      if (typeof name !== 'string' && !isInterpolation(name)) {
        throw new TypeError('Jess grammar produced a custom declaration without a name.');
      }

      /*
       * An interpolated custom-property name is itself a ValueNode, so read the
       * value from its fixed position after the colon rather than by shape.
       */
      const value = children[2];
      if (!isValueNode(value)) {
        throw new TypeError('Jess grammar produced an incomplete custom declaration.');
      }
      return decl(
        name,
        valueSlot(value),
        null,
        children.includes(true)
      );
    }
  );
  const Declaration = node<Declaration>(
    'Declaration',
    choice(
      g.CustomDeclaration,
      sequence(

        /*
         * The statement `;` is OUTSIDE this field on purpose. The field span is
         * the declaration's source span, and it has to end at the end of the
         * VALUE: the renderer treats a comment run beginning exactly at that
         * offset as the declaration's INLINE trailing comment, and a span that
         * reached past the semicolon would both mis-claim that run and swallow
         * any comment authored between the value and the `;`. Less gets the
         * same end for free — its declaration production never contained the
         * terminator.
         */
        field('statement', sequence(
          choice(
            InterpolatedProperty,
            g.Identifier
          ),
          literal(':'),
          g.Value,

          /*
           * The CSS base's declaration-vs-nested-rule decision, unchanged:
           * `css-parser/src/grammar.ts` puts `not(literal('{'))` in exactly this
           * position so an ident-colon construct followed by a block falls
           * through to `Ruleset` instead of matching as a declaration.
           */
          not(literal('{')),
          optional(g.Important)
        )),

        /*
         * A declaration may not strand a selector comma — see the same guard in
         * `scss-parser/src/grammar.ts`. Without it `div:hover, .b { … }` matches
         * as `div: hover` and strands `, .b { … }`.
         */
        choice(
          literal(';'),
          not(literal(','))
        )
      )
    ),
    (children, fields) => {
      /*
       * The custom-property arm is a single completed Declaration child; pass it
       * through so every body that admits a declaration admits a custom property
       * without respelling the arm at each site.
       */
      const custom = children[0];
      if (children.length === 1 && isDeclaration(custom)) {
        return custom;
      }
      const node = decl(
        isToken(children[0]) ? requireToken(children[0]).value : requireInterpolation(children[0]),
        requireValueSlot(children[2]),
        null,
        children.includes(true)
      );
      const statement = fields?.statement;
      return statement === undefined || Array.isArray(statement)
        ? node
        : withSourceSpan(node, statement.span);
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
   * Ordered ahead of `AtRuleBlock`, whose generic name also admits
   * `@scope`; the statement form (`@scope;`) has no `{` and still falls through.
   */
  const ScopeBlock = node<AtRuleBlock>(
    'ScopeBlock',
    sequence(
      scopeAtRuleName,
      noTrivia(sequence(
        g.OpaqueAtPrelude,
        literal('{')
      )),
      many(atBlockStatement),
      literal('}')
    ),
    (children, _fields, span, rawChildren) => {
      const prelude = children[1];
      if (prelude !== null && typeof prelude !== 'string') {
        throw new TypeError('Jess scope at-rule lost its grammar-owned prelude.');
      }
      return withSourceSpan(withBlockBody(atRuleBlock(
        requireToken(children[0]).value,
        prelude === null ? null : any(prelude),
        collectBlockStatements(
          children,
          2
        )
      ), rawChildren), span);
    }
  );
  const AtRuleBlock = node<AtRuleBlock>(
    'AtRuleBlock',
    sequence(
      g.AtRuleHeader,
      literal('{'),
      many(atBlockStatement),
      literal('}')
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      requireJessAtRuleHeader(children[0]).name,
      requireJessAtRuleHeader(children[0]).prelude,
      collectBlockStatements(
        children,
        2
      )
    ), rawChildren), span)
  );
  const AtRuleStatement = node<AtRuleStatement>(
    'AtRuleStatement',
    sequence(
      g.AtRuleStatementHeader,
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
   * fixed: the shared optional prelude capture emits NO child when the prelude is
   * empty, which shifted every positional index below by one and silently reduced
   * `@foo { … }` to `prelude: '{'` / `rawBody: '}'`. A node always emits exactly
   * one child, matching the explicit wrapper shape the other dialects use for
   * optional opaque captures.
   */
  const OpaqueAtPrelude = node<string | null>(
    'OpaqueAtPrelude',
    g.PreprocessorOpaqueAtRulePreludeCapture,
    (children) => {
      const text = children.length === 0 ? '' : requireToken(children[0]).value.trim();
      return text === '' ? null : text;
    }
  );
  const OpaqueBody = node<string>(
    'OpaqueBody',
    g.PreprocessorOpaqueAtRuleBodyCapture,
    children => children.length === 0 ? '' : requireToken(children[0]).value
  );
  const OpaqueAtRuleBlock = node<OpaqueAtRuleBlock>(
    'OpaqueAtRuleBlock',
    sequence(
      not(compilerAtRuleName),
      g.GenericAtRuleName,
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
        throw new TypeError('Jess opaque at-rule lost its grammar-owned raw facts.');
      }
      return opaqueAtRuleBlock(
        requireToken(children[0]).value,
        prelude,
        rawBody
      );
    }
  );

  /*
   * Jess shares the core MixinDefinition/MixinCall model with the other dialects, but
   * owns its `$ >` invocation spelling and Less/Sass-style names here. Guards
   * and selector interpolation remain separate typed families; named arguments
   * already have the canonical CallArg fact and reduce directly to it.
   */
  const mixinNameToken = regex(/[.#]?-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const MixinParam = node<Param>(
    'MixinParam',
    sequence(
      literal('$'),
      dollarName,
      optional(sequence(
        literal(':'),
        g.ValueTerm
      ))
    ),
    (children) => {
      const defaultValue = children.find(isValueNode);
      return defaultValue === undefined
        ? { name: requireToken(children[1]).value }
        : { name: requireToken(children[1]).value, default: defaultValue };
    }
  );
  const MixinParams = node<Param[]>(
    'MixinParams',
    sequence(
      literal('('),
      optional(oneOrMoreSep(
        g.MixinParam,
        literal(',')
      )),
      literal(')')
    ),
    children => children.filter(isParam)
  );
  const MixinCallArgument = node<JessMixinCallArgument>(
    'MixinCallArgument',
    choice(
      sequence(
        literal('$'),
        dollarName,
        literal(':'),
        g.ValueTerm
      ),
      g.ValueTerm
    ),
    (children) => {
      const value = children.find(isValueNode);
      if (value === undefined) {
        throw new TypeError('Jess grammar produced a mixin argument without a value.');
      }
      const name = children.find((child): child is Token => isToken(child) && child.value !== '$' && child.value !== ':');
      return callArg(value, name?.value);
    }
  );
  const MixinCall = node<MixinCall>(
    'MixinCall',
    sequence(
      literal('$'),
      literal('>'),
      mixinNameToken,
      many(sequence(
        literal('>'),
        mixinNameToken
      )),
      literal('('),
      optional(oneOrMoreSep(
        g.MixinCallArgument,
        literal(',')
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
        throw new TypeError('Jess grammar produced a mixin call without a name.');
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
          ).map(selector => ({ combinator: '>' as const, selector })) };
    }
  );

  /*
   * A variable-held callable has an explicit target and empty argument array.
   * Argument-bearing syntax remains intentionally closed in the Jess grammar.
   */
  const ReferenceCall = node<Reference>(
    'ReferenceCall',
    sequence(
      literal('$'),
      dollarName,
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
  const MixinDefinition = node<MixinDefinition>(
    'MixinDefinition',
    sequence(
      mixinNameToken,
      g.MixinParams,
      optional(sequence(
        syntaxWord('when'),
        literal('('),
        g.MixinGuard,
        literal(')')
      )),
      literal('{'),
      many(nestedBodyStatement),
      literal('}')
    ),
    (children, _fields, _span, rawChildren) => {
      const bodyOpen = children.findIndex(child =>
        isToken(child) && child.value === '{');
      if (bodyOpen < 0) {
        throw new TypeError('Jess grammar produced a mixin definition without a body.');
      }
      return withBlockBody(mixinDef(
        requireToken(children[0]).value,
        children.find(isParamList) ?? [],
        collectBodyStatements(
          children,
          bodyOpen + 1
        ),
        children.find((child): child is GuardNode => typeof child === 'object' && child !== null && 'g' in child)
      ), rawChildren);
    }
  );

  /*
   * The lambda parameter list is the SAME production a named mixin declares, but
   * a lambda literal is reachable from a `noTrivia` value term while a mixin
   * definition is not. Re-establish the ordinary trivia scope at the reference so
   * the one shared rule keeps one recognition mode in both positions.
   */
  const lambdaParamsParser = parser(
    { trivia: whitespace },
    g.MixinParams
  );

  /*
   * A value-position lambda literal. `@(params)` is the same parameter list a
   * named mixin declares, and `>` is the same "yield one value" marker the mixin
   * CALL spelling (`$ > name()`) uses: `@(params) > { … }` is a FUNCTION whose
   * block body yields its `result:` entry, `@(params) { … }` / `@{ … }` is a
   * plain anonymous mixin whose body is spliced. There is no `$function` node —
   * this is the same `AnonymousMixin` (with the same `params` shape a `MixinDefinition`
   * uses) that an SCSS user `@function` already lowers to, so one core binder and
   * one `result:` convention serve both dialects.
   *
   * Left-factored on the leading `@` and then on `(`, so a `@`-headed value costs
   * one parameter-list parse rather than one per shape. The block-bodied family
   * is a SEPARATE rule from the expression-bodied one because only a block
   * auto-terminates its assignment: `$f: @() > { }` needs no `;`, while
   * `$f: @() > expr;` does.
   */
  const BlockLambda = node<AnonymousMixin>(
    'BlockLambda',
    sequence(
      literal('@'),
      choice(
        sequence(
          lambdaParamsParser,
          optional(literal('>')),
          literal('{'),
          many(nestedBodyStatement),
          literal('}')
        ),
        sequence(
          literal('{'),
          many(nestedBodyStatement),
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
  const ExpressionLambda = node<AnonymousMixin>(
    'ExpressionLambda',
    parser(
      { trivia: whitespace },
      sequence(
        literal('@'),
        g.MixinParams,
        literal('>'),
        not(literal('{')),
        g.Value
      )
    ),
    (children) => {
      const params = children.find(isParamList) ?? [];
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
  const ValueBlock = node<ValueNode>(
    'ValueBlock',
    choice(
      g.BlockLambda,
      g.Collection
    ),
    children => requireValueNode(children[0])
  );
  const ForName = node<string>(
    'ForName',
    sequence(
      literal('$'),
      dollarName
    ),
    children => requireToken(children[1]).value
  );
  const ForBinding = node<ForBinding>(
    'ForBinding',
    choice(
      sequence(
        literal('['),
        g.ForName,
        literal(','),
        g.ForName,
        literal(']')
      ),
      sequence(
        g.ForName,
        optional(sequence(
          literal(','),
          g.ForName,
          optional(sequence(
            literal(','),
            g.ForName
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
      throw new TypeError('Jess grammar produced an invalid $for binding.');
    }
  );

  /*
   * The public Jess grammar permits a range bound to be either a reference or
   * a numeric/dimension literal. Both already have direct typed reductions;
   * retain that exact public set rather than widening ranges to every value.
   */
  const ForRangeBound = node<ValueNode>(
    'ForRangeBound',
    choice(
      g.VariableReference,
      g.Dimension
    ),
    children => requireValueNode(children[0])
  );
  const ForRange = node<Range>(
    'ForRange',
    sequence(
      optional(literal('>')),
      g.ForRangeBound,
      syntaxWord('to'),
      optional(literal('<')),
      g.ForRangeBound,
      optional(sequence(
        syntaxWord('step'),
        g.ForRangeBound
      ))
    ),
    (children) => {
      const bounds = children.filter(isValueNode);
      if (bounds.length < 2 || bounds.length > 3) {
        throw new TypeError('Jess grammar produced an invalid $for range.');
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
  const ForSource = node<ValueNode>(
    'ForSource',
    sequence(
      g.ValueAtom,
      many(sequence(
        literal(','),
        optional(rawWhitespace),
        g.ValueAtom
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
  const For = node<For>(
    'For',
    sequence(
      regex(/\$for(?![-_a-zA-Z0-9\u0080-\uffff])/),
      literal('('),
      g.ForBinding,
      regex(/of(?![-_a-zA-Z0-9\u0080-\uffff])/),
      choice(
        g.ForRange,
        g.ForSource
      ),
      literal(')'),
      literal('{'),
      many(nestedBodyStatement),
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
   *
   * The divergence is in the LADDER, not every rung: a bare truth value is
   * `GuardValue` in both, so `$if` shares that rung rather than mirroring it.
   */
  const IfGuardCompare = node<GuardNode>(
    'IfGuardCompare',
    noTrivia(sequence(
      g.ExpressionSum,
      ifGuardCompareOperator,
      g.ExpressionSum
    )),
    reduceIfCompare
  );
  const IfGuardPrimary = node<GuardNode>(
    'IfGuardPrimary',
    choice(
      sequence(
        regex(/not(?![-_a-zA-Z0-9\u0080-\uffff])/),
        literal('('),
        g.IfGuard,
        literal(')')
      ),
      sequence(
        literal('('),
        g.IfGuard,
        literal(')')
      ),
      g.GuardValue
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
  const IfGuardAnd = node<GuardNode>(
    'IfGuardAnd',
    sequence(
      g.IfGuardPrimary,
      oneOrMore(sequence(
        regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.IfGuardPrimary
      ))
    ),
    reduceGuardAnd
  );
  const IfGuardOr = node<GuardNode>(
    'IfGuardOr',
    sequence(
      g.IfGuardPrimary,
      oneOrMore(sequence(
        regex(/or(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.IfGuardPrimary
      ))
    ),
    reduceGuardOr
  );
  const IfGuard = node<GuardNode>(
    'IfGuard',

    /*
     * A comparison shares its left operand with the documented bare-truth
     * form (`$if (true)`). Make the longer arm transactional so a missing
     * comparison operator returns recognition to the primary truth reduction.
     */
    choice(
      attempt(g.IfGuardCompare),
      g.IfGuardAnd,
      g.IfGuardOr,
      g.IfGuardPrimary
    ),
    children => requireGuardNode(children[0])
  );
  const IfCondition = node<GuardNode>(
    'IfCondition',
    sequence(
      literal('('),
      g.IfGuard,
      literal(')')
    ),
    children => requireGuardNode(children[1])
  );
  const IfBody = node<Statement[]>(
    'IfBody',
    sequence(
      literal('{'),

      /*
       * Selected branches publish declarations and definitions into their
       * containing frame in source order. Existing statement evaluators already
       * execute calls and loops here; imports and placement-sensitive extends
       * remain held until their respective models are available.
       */
      many(nestedBodyStatement),
      literal('}')
    ),
    children => collectBodyStatements(
      children,
      1
    )
  );
  const ElseIfBranch = node<IfBranch>(
    'ElseIfBranch',
    sequence(
      regex(/\$else(?![-_a-zA-Z0-9\u0080-\uffff])/),
      regex(/if(?![-_a-zA-Z0-9\u0080-\uffff])/),
      g.IfCondition,
      g.IfBody
    ),
    children => ({ guard: requireGuardNode(children[2]), rules: requireStatementList(children[3]) })
  );
  const ElseBranch = node<IfBranch>(
    'ElseBranch',
    sequence(
      regex(/\$else(?![-_a-zA-Z0-9\u0080-\uffff])/),
      g.IfBody
    ),
    children => ({ guard: null, rules: requireStatementList(children[1]) })
  );
  const If = node<If>(
    'If',
    sequence(
      regex(/\$if(?![-_a-zA-Z0-9\u0080-\uffff])/),
      g.IfCondition,
      g.IfBody,
      many(g.ElseIfBranch),
      optional(g.ElseBranch)
    ),
    (children) => {
      const branches: IfBranch[] = [{ guard: requireGuardNode(children[1]), rules: requireStatementList(children[2]) }];
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

  /*
   * `$while (…) { … }` — the third control statement, built from the SAME
   * `IfCondition` and `IfBody` rungs `$if` uses. It is a node of its own and not
   * a `$for` because the condition is re-read BETWEEN iterations: `$for`
   * iterates an iterable decided once, and no `$for` spelling reproduces that.
   *
   * Like `$if`, a control block is not a scope, so the body's declarations
   * publish into the containing frame — which is what lets the next condition
   * observe the counter the last iteration wrote.
   */
  const While = node<While>(
    'While',
    sequence(
      regex(/\$while(?![-_a-zA-Z0-9\u0080-\uffff])/),
      g.IfCondition,
      g.IfBody
    ),
    children => whileNode(
      requireGuardNode(children[1]),
      requireStatementList(children[2])
    )
  );

  const CompoundSelector = node<SelectorTerm>(
    'CompoundSelector',
    noTrivia(oneOrMore(choice(
      parser(
        { trivia: whitespace },
        g.AttributeSelector
      ),
      g.PseudoSelector,
      g.InterpolatedParentSuffix,
      g.InterpolatedSimple,
      g.Parent,
      g.NamespaceTypeSelector,
      g.BasicSelector
    ))),
    reduceCompound
  );

  /*
   * The separator between compound selectors may be an explicit combinator
   * (`>`, `+`, `~`, `||`) or just ambient trivia, which is treated as the
   * descendant combinator. Combinators are folded inline exactly as the CSS
   * base does — there is no `ComplexTail` wrapper node, so the concrete tree
   * converges to CSS's `ComplexSelector` shape.
   */
  const ComplexSelector = node<SelectorBranch>(
    'ComplexSelector',
    sequence(
      g.CompoundSelector,
      many(sequence(
        optional(selectorCombinator),
        g.CompoundSelector
      ))
    ),
    (children) => {
      const segments: Array<{ combinator?: JessComplexTail['combinator']; term: SelectorTerm }> = [];
      let combinator: JessComplexTail['combinator'] = ' ';
      for (const child of children) {
        if (isSelectorTerm(child)) {
          segments.push(segments.length === 0 ? { term: child } : { combinator, term: child });
          combinator = ' ';
          continue;
        }
        if (isToken(child)) {
          combinator = jessCombinator(child);
        }
      }
      return selectorBranchOf([segments[0]!, ...segments.slice(1)]);
    }
  );

  /*
   * A ruleset's selector list carries the STATEMENT's start offset: the
   * renderer reads `sourceStartOf(node.selector)` for a `Ruleset`, because a
   * `Ruleset` itself has no span of its own. Without it the root trivia cursor
   * never advances past a rule. Spanned here rather than in the shared
   * `reduceSelectorList`, which `PseudoSelectorList` also uses: a pseudo
   * argument is never a `Ruleset`'s selector, so a span there would move the
   * tree for nothing. Less draws the same line.
   */
  const SelectorList = node<SelectorList>(
    'SelectorList',
    oneOrMoreSep(
      g.ComplexSelector,
      literal(',')
    ),
    (children, _fields, span) => withSourceSpan(reduceSelectorList(children), span)
  );
  const Apply = node<Apply>(
    'Apply',
    sequence(
      regex(/\$apply(?![-_a-zA-Z0-9\u0080-\uffff])/),
      g.PseudoSelectorCompound,
      many(sequence(
        literal(','),
        g.PseudoSelectorCompound
      )),
      optional(literal(';'))
    ),
    children => apply(children.filter(isSelectorTerm))
  );
  const Extend = node<ExtendInstruction[]>(
    'Extend',
    sequence(
      regex(/\$extend(?![-_a-zA-Z0-9\u0080-\uffff])/),
      g.PseudoSelectorComplex,
      many(sequence(
        literal(','),
        g.PseudoSelectorComplex
      )),
      optional(regex(/!exact(?![-_a-zA-Z0-9\u0080-\uffff])/)),
      optional(literal(';'))
    ),
    children => children.filter(isSelectorBranch)
      .map(target => ({ target: selist(target), partial: !children.some(child => isToken(child) && child.value === '!exact') }))
  );
  const Ruleset = node<Ruleset>(
    'Ruleset',
    sequence(
      g.SelectorList,
      literal('{'),
      many(choice(
        literal(';'),
        g.MixinCall,
        g.ValueBlockDeclaration,
        g.VariableDeclaration,
        g.Declaration,
        g.MixinDefinition,
        g.For,
        g.If,
        g.While,
        g.ReferenceCall,
        g.Apply,
        g.Extend,
        g.Ruleset,
        g.SupportsAtRuleBlock,
        g.OpaqueAtRuleBlock,
        g.ScopeBlock,
        g.AtRuleBlock,
        g.AtRuleStatement
      )),
      literal('}')
    ),
    (children, _fields, _span, rawChildren) => {
      requireExactToken(
        children[1],
        '{'
      );
      requireExactToken(
        children.at(-1),
        '}'
      );
      const extensions = children.filter(isExtendInstructionArray).flat();
      return withBlockBody(rule(
        requireSelectorList(children[0]),
        collectBlockStatements(
          children,
          2
        ),
        extensions.length ? extensions : undefined
      ), rawChildren);
    }
  );
  const Stylesheet = node<Stylesheet>(
    'Stylesheet',
    sequence(
      optional(g.Charset),

      /*
       * Compiler directives and variable declarations may precede a CSS import:
       * a `$[...]` import target is a live read and therefore needs its binding
       * activated in source order. CSS imports still cannot appear after a rule.
       */
      many(choice(
        g.StyleImport,
        g.ModuleImport,
        g.ValueBlockDeclaration,
        g.VariableDeclaration,
        g.ImportStatement
      )),
      many(choice(
        g.MixinCall,
        g.StyleImport,
        g.ModuleImport,
        g.ValueBlockDeclaration,
        g.VariableDeclaration,
        g.MixinDefinition,
        g.For,
        g.If,
        g.While,
        g.ReferenceCall,
        g.Apply,
        g.Ruleset,
        g.SupportsAtRuleBlock,
        g.PropertyAtRule,
        g.Keyframes,
        g.OpaqueAtRuleBlock,
        g.ScopeBlock,
        g.AtRuleBlock,
        g.AtRuleStatement
      ))
    ),
    children => stylesheet(requireStatements(children.flatMap(child => isMixinCallArray(child) ? child : Array.isArray(child) ? [] : [child])))
  );

  return {
    Stylesheet,
    VariableDeclaration,
    ValueBlockDeclaration,
    BlockLambda,
    ExpressionLambda,
    ValueBlock,
    VariableReference,
    ExpressionScopedReference,
    DeclarationReference,
    ReferenceTail,
    ReferenceCallTail,
    DollarValue,
    DollarBrace,
    ExpressionDollarBrace,
    DollarInterp,
    ExpressionDollarInterp,
    Expression,
    ExpressionInterpolation,
    ExpressionQuoted,
    ExpressionDeclarationReference,
    ExpressionCallArgument,
    ExpressionReferenceCallTail,
    ExpressionAtom,
    ExpressionProduct,
    ExpressionSum,
    ExpressionCompare,
    ExpressionNot,
    ExpressionLogicalOperand,
    ExpressionAnd,
    ExpressionOr,
    ExpressionLogical,
    GuardValue,
    GuardCompare,
    GuardCall,
    GuardPrimary,
    GuardAnd,
    GuardOr,
    MixinGuard,
    Keyword,
    Quoted,
    LiteralQuoted,
    StyleImport,
    ModuleSpecifier,
    ModuleImport,
    HeaderValueAtom,
    HeaderValue,
    HeaderCallArgument,
    QueryValue,
    QueryFeatureName,
    QueryComparisonFeature,
    QueryNonOnlyKeyword,
    QueryTerm,
    QueryFeature,
    QueryDashedIdentifier,
    QueryClause,
    QueryPrelude,
    AtRulePrelude,
    ContainerQueryClause,
    ContainerQueryPrelude,
    ContainerPrelude,
    MediaPrelude,
    AtRuleStatementHeader,
    AtRuleHeader,
    SupportsAtom,
    GeneralTemplate,
    GeneralTemplateGroup,
    GeneralTemplateQuoted,
    GeneralQuotedTemplate,
    GeneralQuotedTemplateGroup,
    Enclosed,
    SupportsNot,
    SupportsLogical,
    SupportsFeature,
    SupportsInParens,
    SupportsCondition,
    UrlInterpolatedValue,
    PlainUrlInner: plainUrlInner,
    UnquotedUrlText: unquotedUrlText,
    Charset,
    ImportStatement,
    SupportsAtRuleBlock,
    PropertyName,
    PropertyDescriptor,
    PropertyAtRule,
    Percentage,
    KeyframeSelector,
    KeyframeBlock,
    Keyframes,
    OpaqueAtPrelude,
    OpaqueBody,
    OpaqueAtRuleBlock,
    ScopeBlock,
    AtRuleBlock,
    AtRuleStatement,
    Dimension,
    Color,
    Url,
    CallComponent,
    CallArgument,
    KeywordValue,
    NullLiteral,
    VarCall,
    UnicodeRange,
    CalcValue,
    CalcParen,
    CalcProduct,
    CalcSum,
    MathDollarValue,
    CalcSequence,
    calcFunctionArguments,
    MathFunction,
    IdentifierOrFunction,
    CollectionEntry,
    Collection,
    SquareValue,
    InterpolatedValue,
    ValueAtom,
    ValueSpaceGroup,
    ValueTerm,
    Value,
    Important,
    CustomPropertyValue,
    InterpolatedCustomPropertyName,
    CustomPart,
    CustomInnerPart,
    CustomGroup,
    CustomValue,
    CustomDeclaration,
    Declaration,
    MixinParam,
    MixinParams,
    MixinCallArgument,
    MixinCall,
    ReferenceCall,
    Apply,
    Extend,
    MixinDefinition,
    BasicSelector,
    Parent,
    InterpolatedSimple,
    InterpolatedParentSuffix,
    NamespaceTypeSelector,
    AttributeSelector,
    PseudoSelector,
    PseudoSelectorArgument,
    GenericPseudoText,
    GenericPseudoComment,
    GenericPseudoEscape,
    GenericPseudoItem,
    GenericPseudoGroup,
    GenericPseudoArgument,
    CompoundSelector,
    PseudoSelectorCompound,
    PseudoSelectorComplex,
    PseudoSelectorTail,
    PseudoSelectorList,
    SelectorCapture,
    ComplexSelector,
    SelectorList,
    Ruleset,
    ForName,
    ForBinding,
    ForRangeBound,
    ForRange,
    ForSource,
    For,
    IfGuardCompare,
    IfGuardPrimary,
    IfGuardAnd,
    IfGuardOr,
    IfGuard,
    IfCondition,
    IfBody,
    ElseIfBranch,
    ElseBranch,
    If,
    While,
    rw: whitespace,
    whitespace,
    typedAtRuleHeader,
    identifierOrFunction
  };
};

export const jessGrammar = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<JessRules>(
  { trivia: whitespace, scanSkip: [blockComment, scanSkipDoubleQuoted, scanSkipSingleQuoted] },
  jessFactory
)]);

/** AST artifact with Parseman line/column tracking enabled. */
export const jessPositionsGrammar = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<JessRules>(
  { trivia: whitespace, scanSkip: [blockComment, scanSkipDoubleQuoted, scanSkipSingleQuoted], trackLines: true },
  jessFactory
)]);

export const jessCstGrammar = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<JessRules>(
  { trivia: whitespace, scanSkip: [blockComment, scanSkipDoubleQuoted, scanSkipSingleQuoted], hostMode: 'cst' },
  jessFactory
)]);

/** CST artifact with Parseman line/column tracking enabled. */
export const jessCstPositionsGrammar = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<JessRules>(
  { trivia: whitespace, scanSkip: [blockComment, scanSkipDoubleQuoted, scanSkipSingleQuoted], hostMode: 'cst', trackLines: true },
  jessFactory
)]);
