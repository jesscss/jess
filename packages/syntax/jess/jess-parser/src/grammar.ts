/**
 * Canonical Jess host-mode grammar.
 *
 * CSS base: ../../../css/css-parser/src/grammar.ts
 *
 * Jess adds and overrides:
 * - $variables, modules, apply/mixin constructs, guards, ranges, collections,
 *   boundary blocks, and Jess interpolation forms.
 * - Jess-specific expression and selector capture syntax.
 * - Jess is a sibling grammar over CSS/shared syntax; shared preprocessor
 *   constructs belong in parser-shared only after they prove real reuse.
 *
 * The same factory builds the package AST route and the public positioned CST
 * route via Parseman's `hostMode`.
 */
import { attempt, balanced, choice, composeLeaf, dispatch, field, literal, makeWhen, many, noTrivia, node, not, oneOrMore, optional, otherwise, parser, regex, routed, rules, scanTo, sequence, startsWith, token, trivia, when } from 'parseman' with { type: 'macro' };
import type { Combinator, FieldCapture, FieldMap } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { opaqueAtRuleRecognition } from '@jesscss/parser-shared/opaque-at-rule';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';
import { any, anonymousMixin, apply, atRuleBlock, atRuleStatement, block, boundaryBlock, color, complexCanonical, complexSelector, condition, decl, collection, collectionEntry, declarationReference, dimension, forNode, funcCall, generalEnclosed, ifNode, interpolation, keyword, list, mixinCall, mixinDef, moduleImport, opaqueAtRuleBlock, operation, propertyReference, pseudoSelector, quoted, range, reference, selectorCapture, selectorTermOf, styleImport, stylesheet, rule, selist, simpleSelector, interpolatedSimpleSelector, spaced, url, varIndirect, variableDeclaration, variableReference, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { AnonymousMixin, Apply, AtRuleBlock, AtRuleStatement, Color, ComplexSelector, Declaration, Collection, CollectionEntry, DeclarationReference, Dimension, ExtendInstruction, For, ForBinding, FunctionCall, GeneralEnclosed, If, IfBranch, InterpPart, Interpolation, Keyword, MixinCall, MixinDefinition, ModuleImport, ModuleImportSpecifier, OpaqueAtRuleBlock, Param, Quoted, Range, PseudoSelector, Reference, SelectorCapture, SelectorTerm, Stylesheet, Ruleset, SelectorList, SimpleSelector, SimpleToken, SpacedValue, Statement, StyleImport, Url, ValueNode, ValueSlot, VariableDeclaration, VariableReference, GuardNode } from '@jesscss/core/ast';

type Token = { readonly value: string };
type ExpressionFact = { readonly value: ValueNode; readonly src: string };
type JessOperatorFact = { readonly value: string; readonly src: string };
type JessReferenceTail = { readonly step: Reference['steps'][number]; readonly src: string };
type JessComplexTail = { readonly combinator: ' ' | '>' | '+' | '~' | '||'; readonly term: SelectorTerm };
type JessStaticAtQueryProperty = { readonly property: Keyword };
type JessAtRuleHeader = { readonly name: string; readonly prelude: ValueNode | null };
type JessMixinCallArgument = MixinCall['args'][number];

type JessRules = {
  Stylesheet: Combinator<Stylesheet>;
  VariableDeclaration: Combinator<VariableDeclaration>;
  ValueBlockDeclaration: Combinator<VariableDeclaration>;
  BlockLambda: Combinator<AnonymousMixin>;
  ExpressionLambda: Combinator<AnonymousMixin>;
  ValueBlock: Combinator<ValueNode>;
  VariableReference: Combinator<VariableReference>;
  DeclarationReference: Combinator<DeclarationReference>;
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
  GuardValue: Combinator<GuardNode>;
  GuardCompare: Combinator<GuardNode>;
  GuardCall: Combinator<GuardNode>;
  GuardPrimary: Combinator<GuardNode>;
  GuardAnd: Combinator<GuardNode>;
  GuardOr: Combinator<GuardNode>;
  MixinGuard: Combinator<GuardNode>;
  Keyword: Combinator<Keyword>;
  Quoted: Combinator<Quoted | Interpolation>;
  StaticQuoted: Combinator<Quoted>;
  Dimension: Combinator<Dimension>;
  Color: Combinator<Color>;
  Url: Combinator<Url>;
  InterpolatedUrl: Combinator<Url>;
  UrlInterpolatedValue: Combinator<Interpolation>;
  CallComponent: Combinator<ValueSlot>;
  CallArgument: Combinator<ValueSlot>;
  Call: Combinator<FunctionCall>;
  CollectionEntry: Combinator<CollectionEntry>;
  Collection: Combinator<Collection>;
  ValueAtom: Combinator<ValueNode>;
  ValueSpaceGroup: Combinator<ValueSlot>;
  ValueTerm: Combinator<ValueSlot>;
  Value: Combinator<ValueSlot>;
  Important: Combinator<true>;
  CustomPropertyValue: Combinator<Keyword>;
  CustomPropertyName: Combinator<string | Interpolation>;
  CustomPart: Combinator<unknown>;
  CustomInnerPart: Combinator<unknown>;
  CustomParen: Combinator<readonly unknown[]>;
  CustomSquare: Combinator<readonly unknown[]>;
  CustomCurly: Combinator<readonly unknown[]>;
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
  Simple: Combinator<SimpleSelector>;
  Parent: Combinator<SimpleSelector>;
  InterpolatedSimple: Combinator<SimpleSelector>;
  InterpolatedParentSuffix: Combinator<SimpleSelector>;
  Attribute: Combinator<SimpleSelector>;
  Pseudo: Combinator<SimpleToken>;
  StaticPseudoArgument: Combinator<SelectorList | string>;
  GenericPseudoArgument: Combinator<SelectorList | string>;
  Compound: Combinator<SelectorTerm>;
  StaticCompound: Combinator<SelectorTerm>;
  StaticComplexTail: Combinator<JessComplexTail>;
  StaticComplex: Combinator<ComplexSelector>;
  StaticSelectorTail: Combinator<ComplexSelector>;
  StaticSelector: Combinator<SelectorList>;
  SelectorCapture: Combinator<SelectorCapture>;
  ComplexTail: Combinator<JessComplexTail>;
  Complex: Combinator<ComplexSelector>;
  SelectorTail: Combinator<ComplexSelector>;
  Selector: Combinator<SelectorList>;
  Ruleset: Combinator<Ruleset>;
  ForName: Combinator<string>;
  ForBinding: Combinator<ForBinding>;
  ForRangeBound: Combinator<ValueNode>;
  ForRange: Combinator<Range>;
  ForSource: Combinator<ValueNode>;
  For: Combinator<For>;
  IfCondition: Combinator<GuardNode>;
  IfGuardValue: Combinator<GuardNode>;
  IfGuardCompare: Combinator<GuardNode>;
  IfGuardPrimary: Combinator<GuardNode>;
  IfGuardAnd: Combinator<GuardNode>;
  IfGuardOr: Combinator<GuardNode>;
  IfGuard: Combinator<GuardNode>;
  IfBody: Combinator<Statement[]>;
  ElseIfBranch: Combinator<IfBranch>;
  ElseBranch: Combinator<IfBranch>;
  If: Combinator<If>;
  StyleImport: Combinator<StyleImport>;
  ModuleSpecifier: Combinator<ModuleImportSpecifier>;
  ModuleImport: Combinator<ModuleImport>;
  StaticValueAtom: Combinator<ValueNode>;
  StaticValue: Combinator<ValueSlot>;
  StaticCallArgument: Combinator<ValueSlot>;
  StaticCall: Combinator<FunctionCall>;
  StaticAtNonOnlyKeyword: Combinator<Keyword>;
  StaticAtNonOnlyAtom: Combinator<ValueNode>;
  StaticAtQuery: Combinator<ValueNode>;
  StaticAtDashedIdent: Combinator<Keyword>;
  StaticAtPreludeTerm: Combinator<ValueNode>;
  StaticAtPrelude: Combinator<ValueNode | null>;
  MediaPrelude: Combinator<ValueNode | null>;
  StaticAtRuleHeader: Combinator<JessAtRuleHeader>;
  AtRuleHeader: Combinator<JessAtRuleHeader>;
  SupportsAtom: Combinator<ValueNode>;
  GeneralTemplate: Combinator<Interpolation>;
  GeneralTemplateParen: Combinator<Interpolation>;
  GeneralTemplateSquare: Combinator<Interpolation>;
  GeneralTemplateBrace: Combinator<Interpolation>;
  GeneralTemplateDoubleQuoted: Combinator<Interpolation>;
  GeneralTemplateSingleQuoted: Combinator<Interpolation>;
  GeneralQuotedTemplate: Combinator<Interpolation>;
  GeneralQuotedTemplateParen: Combinator<Interpolation>;
  GeneralQuotedTemplateSquare: Combinator<Interpolation>;
  GeneralQuotedTemplateBrace: Combinator<Interpolation>;
  GeneralQuotedTemplateDoubleQuoted: Combinator<Interpolation>;
  GeneralQuotedTemplateSingleQuoted: Combinator<Interpolation>;
  GeneralEnclosed: Combinator<GeneralEnclosed>;
  SupportsNot: Combinator<Keyword>;
  SupportsLogical: Combinator<Keyword>;
  SupportsFeature: Combinator<ValueNode>;
  SupportsInParens: Combinator<ValueNode>;
  SupportsCondition: Combinator<ValueNode>;
  CssImportTarget: Combinator<Quoted | Url>;
  ImportTailFunction: Combinator<FunctionCall>;
  CssImportPrelude: Combinator<ValueNode>;
  Charset: Combinator<AtRuleStatement>;
  CssImport: Combinator<AtRuleStatement>;
  SupportsAtRuleBlock: Combinator<AtRuleBlock>;
  PropertyName: Combinator<Keyword>;
  StaticPropertyDescriptor: Combinator<Declaration>;
  PropertyAtRule: Combinator<AtRuleBlock>;
  KeyframeSelector: Combinator<SimpleSelector>;
  KeyframeBlock: Combinator<Ruleset>;
  Keyframes: Combinator<AtRuleBlock>;
  OpaquePrelude: Combinator<string | null>;
  OpaqueBody: Combinator<string>;
  OpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  ScopeBlock: Combinator<AtRuleBlock>;
  AtRuleBlock: Combinator<AtRuleBlock>;
  AtRuleStatement: Combinator<AtRuleStatement>;
  rw: Combinator<unknown>;
  whitespace: Combinator<unknown>;
};

type SharedCssSyntax = {
  CssSyntaxAttributeModifier: Combinator<string>;
  CssSyntaxAttributeOperator: Combinator<string>;
  CssSyntaxDoubleQuotedText: Combinator<string>;
  CssSyntaxHexColor: Combinator<string>;
  CssSyntaxImportant: Combinator<string>;
  CssSyntaxKeyframesAtKeyword: Combinator<string>;
  CssSyntaxKeyword: Combinator<string>;
  CssSyntaxNth: Combinator<string>;
  CssSyntaxNthChildName: Combinator<string>;
  CssSyntaxNthTypeName: Combinator<string>;
  CssSyntaxNthName: Combinator<string>;
  CssSyntaxSelectorArgPseudoName: Combinator<string>;
  CssSyntaxOfKeyword: Combinator<string>;
  CssSyntaxPseudoCloseAhead: Combinator<string>;
  CssSyntaxNumber: Combinator<string>;
  CssSyntaxProperty: Combinator<string>;
  CssSyntaxInterpolatedPropertyStart: Combinator<string>;
  CssSyntaxInterpolatedPropertyTail: Combinator<string>;
  CssSyntaxCustomProperty: Combinator<string>;
  CssSyntaxCustomOuterContent: Combinator<string>;
  CssSyntaxCustomInnerContent: Combinator<string>;
  CssSyntaxCustomSingleQuoted: Combinator<string>;
  CssSyntaxCustomDoubleQuoted: Combinator<string>;
  CssSyntaxQueryAndOr: Combinator<string>;
  CssSyntaxQueryNot: Combinator<string>;
  CssSyntaxQueryOnly: Combinator<string>;
  CssSyntaxQueryComparisonOperator: Combinator<string>;
  CssSyntaxContainerAtKeyword: Combinator<string>;
  CssSyntaxSingleQuotedText: Combinator<string>;
  CssSyntaxDimensionUnit: Combinator<string>;
  CssSyntaxUrlOpen: Combinator<string>;
  CssSyntaxUrlInner: Combinator<string>;
  CssSyntaxStaticUrlInner: Combinator<string>;
  CssSyntaxGenericAtRuleName: Combinator<string>;
  CssSyntaxSimple: Combinator<string>;
  CssSyntaxPseudoColon: Combinator<string>;
  CssSyntaxMediaAtKeyword: Combinator<string>;
  JessOpaqueStaticPrelude: Combinator<string | null>;
  JessOpaqueBody: Combinator<string>;
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
    throw new TypeError('Jess grammar produced an invalid at-rule header.');
  }
  return value;
}

function isAtRuleNameToken(value: unknown): value is Token {
  return isToken(value)
    && !('type' in value)
    && value.value.startsWith('@');
}

function isCompound(value: unknown): value is SelectorTerm {
  return isSimpleToken(value)
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'CompoundSelector' && 'value' in value && Array.isArray(value.value));
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
    && 'value' in value && Array.isArray(value.value);
}

function isSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'SelectorList'
    && 'selectors' in value && Array.isArray(value.selectors)
    && value.selectors.every(isComplexSelector);
}

function isJessComplexTail(value: unknown): value is JessComplexTail {
  return typeof value === 'object' && value !== null
    && 'combinator' in value && (value.combinator === ' ' || value.combinator === '>' || value.combinator === '+' || value.combinator === '~' || value.combinator === '||')
    && 'term' in value && isCompound(value.term);
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
    throw new TypeError('Jess grammar produced a non-simple-token child.');
  }
  return value;
}

function requireCompound(value: unknown): SelectorTerm {
  if (!isCompound(value)) {
    throw new TypeError('Jess grammar produced a non-compound selector child.');
  }
  return value;
}

function selectorTermFromTokens(tokens: SimpleToken[]): SelectorTerm {
  const [first, ...rest] = tokens;
  if (first === undefined) {
    throw new TypeError('Jess selector production produced no simple selector tokens.');
  }
  return selectorTermOf([first, ...rest]);
}

function requireComplexSelector(value: unknown): ComplexSelector {
  if (!isComplexSelector(value)) {
    throw new TypeError('Jess grammar produced a non-complex selector child.');
  }
  return value;
}

function requireSelectorList(value: unknown): SelectorList {
  if (!isSelectorList(value)) {
    throw new TypeError('Jess grammar produced a non-selector-list child.');
  }
  return value;
}

function requireJessComplexTail(value: unknown): JessComplexTail {
  if (!isJessComplexTail(value)) {
    throw new TypeError('Jess grammar produced an invalid selector tail.');
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
      || value.type === 'DeclarationReference'
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
  if (value.type === 'Block' && isSpacedValue(value.value)) {
    return { ...value, value: value.value.parts };
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
    case 'DeclarationReference': return value.raw;
    case 'PropertyReference': return value.raw;
    case 'Operation': return `${expressionSource(value.left)} ${value.operator} ${expressionSource(value.right)}`;
    case 'Condition': return value.src;
    case 'Interpolation': return value.parts.map(part => 'lit' in part ? part.lit : expressionSource(part.ref)).join('');
    default: throw new TypeError(`Jess expression cannot preserve source for ${value.type}.`);
  }
}

function referenceBaseSource(value: ValueNode): string {
  switch (value.type) {
    case 'VariableReference': return `${value.lookup === 'scoped' ? '$$' : '$'}${value.name}`;
    case 'DeclarationReference': return value.raw;
    default: throw new TypeError(`Jess expression reference cannot start from ${value.type}.`);
  }
}

function declarationMemberReferenceFromVariableBase(
  base: VariableReference,
  tails: readonly JessReferenceTail[]
): Reference | null {
  if (base.lookup !== 'live' || base.name === 'type' || tails[0]?.step.type !== 'DotLookup') {
    return null;
  }
  return reference(
    declarationReference('$'),
    [
      { type: 'DotLookup', name: base.name },
      ...tails.map(tail => tail.step)
    ],
    `$${base.name}${tails.map(tail => tail.src).join('')}`
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
    case 'Reference': case 'DeclarationReference': case 'PropertyReference': return value.raw;
    case 'Operation': case 'Condition': case 'Interpolation': return expressionSource(value);
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
        value
      ));
}

function requireStatements(children: readonly unknown[]): Statement[] {
  const statements: Statement[] = [];
  for (const child of children) {
    if (!isVarDeclaration(child) && !isMixinDefinition(child) && !isMixinCall(child) && !isApply(child) && !isReferenceCall(child) && !isRuleset(child) && !isFor(child) && !isIf(child) && !isDeclaration(child) && !isStyleImport(child) && !isModuleImport(child) && !isAtRuleBlock(child) && !isAtRuleStatement(child) && !isOpaqueAtRuleBlock(child)) {
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
    throw new TypeError('Jess module syntax requires a static quoted path.');
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
    throw new TypeError('Jess variable declaration lost its assignment operator.');
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
    throw new TypeError('Jess grammar produced a lambda without a body.');
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
function reduceCompound(children: readonly unknown[]): SelectorTerm {
  return selectorTermFromTokens(children.map(requireSimpleToken));
}
function reduceComplex(children: readonly unknown[]): ComplexSelector {
  return complexSelector([
    { term: requireCompound(children[0]) },
    ...children.slice(1).map(requireJessComplexTail).map(tail => ({ combinator: tail.combinator, term: tail.term }))
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
const commentTrivia = regex(/\/(?:\*(?:[^*]|\*(?!\/))*\*\/|\/[^\n\r]*)/);

/*
 * Comments are Jess trivia. Block comments can still survive through the AST
 * trivia map for rendering/source consumers; line comments are lexical-only and
 * never reach CSS output. URL bodies disable trivia below, so
 * `url(//host/path)` stays URL content.
 */
const whitespace = trivia(oneOrMore(choice(
  rawWhitespace,
  commentTrivia
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

export const jessFactory = (g: JessRules & SharedCssSyntax) => {
  const jessCase = makeWhen({ caseInsensitive: true });

  const VariableReference = node<VariableReference>(
    'VariableReference',
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
  const DeclarationReference = node<DeclarationReference>(
    'DeclarationReference',
    noTrivia(literal('$')),
    (_children, _fields, span) => withSourceSpan(declarationReference('$'), span)
  );
  const DollarBrace = node<Interpolation>(
    'DollarBrace',
    jessDollarBraceStructure,
    (children, _fields, span) => dollarBraceInterpolation(
      children,
      span
    )
  );
  const DollarInterp = node<Interpolation>(
    'DollarInterp',
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
  const ExpressionDollarBrace = node<ExpressionFact>(
    'ExpressionDollarBrace',
    jessDollarBraceStructure,
    (children, _fields, span) => {
      return { value: dollarBraceInterpolation(
        children,
        span
      ), src: tokenSource(children) };
    }
  );
  const ExpressionDollarInterp = node<ExpressionFact>(
    'ExpressionDollarInterp',
    jessDollarInterpStructure,
    (children, _fields, span) => ({ value: interpolationFromChildren(
      children,
      span
    ), src: tokenSource(children) })
  );
  const ExpressionProductOperator = node<JessOperatorFact>(
    'ExpressionProductOperator',
    noTrivia(sequence(
      jessExprBoundary,
      jessExprProductSymbol,
      jessExprBoundary
    )),
    children => ({ value: requireToken(children[1]).value, src: tokenSource(children) })
  );
  const ExpressionSumOperator = node<JessOperatorFact>(
    'ExpressionSumOperator',
    noTrivia(sequence(
      jessExprBoundary,
      jessExprSumSymbol,
      jessExprBoundary
    )),
    children => ({ value: requireToken(children[1]).value, src: tokenSource(children) })
  );
  const ExpressionCompareOperator = node<JessOperatorFact>(
    'ExpressionCompareOperator',
    noTrivia(sequence(
      jessExprBoundary,
      jessExprCompareSymbol,
      jessExprBoundary
    )),
    children => ({ value: requireToken(children[1]).value, src: tokenSource(children) })
  );
  const ExpressionDeclarationReference = node<ExpressionFact>(
    'ExpressionDeclarationReference',
    noTrivia(choice(
      sequence(
        g.DeclarationReference,
        literal('.'),
        jessDollarName,
        many(choice(
          g.ExpressionReferenceCallTail,
          g.ReferenceTail
        ))
      ),
      sequence(
        literal('.'),
        jessDollarName,
        many(choice(
          g.ExpressionReferenceCallTail,
          g.ReferenceTail
        ))
      )
    )),
    (children, _fields, span) => {
      const rooted = isValueNode(children[0]) && children[0].type === 'DeclarationReference';
      const name = requireToken(children[rooted ? 2 : 1]).value;
      const baseRaw = rooted ? '$' : '';
      const base = withSourceSpan(declarationReference(baseRaw), span);
      const tails = children.slice(rooted ? 3 : 2).map(requireJessReferenceTail);
      const raw = `${baseRaw}.${name}${tails.map(tail => tail.src).join('')}`;
      return { value: reference(
        base,
        [
          { type: 'DotLookup', name },
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
        jessDollarName,
        literal(':'),
        g.ExpressionCompare
      ),
      g.ExpressionCompare
    ),
    (children) => {
      const fact = children.find(isExpressionFact);
      if (fact === undefined) {
        throw new TypeError('Jess expression call argument lost its value.');
      }
      const name = children.find((child): child is Token => isToken(child) && child.value !== '$' && child.value !== ':');
      return name === undefined ? { value: fact.value } : { name: name.value, value: fact.value };
    }
  );
  const ExpressionReferenceCallTail = node<JessReferenceTail>(
    'ExpressionReferenceCallTail',
    noTrivia(sequence(
      literal('('),
      parser(
        { trivia: whitespace },
        optional(sequence(
          g.ExpressionCallArgument,
          many(sequence(
            literal(','),
            g.ExpressionCallArgument
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
  const ExpressionAtom = node<ExpressionFact>(
    'ExpressionAtom',

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
     * keep reducing through the arity-checked `GuardCall` predicate
     * syntax. Letting it take a generic call tail would silently admit
     * `$type.unknown($x)` and every wrong-arity spelling the guard grammar
     * exists to reject. Bare-name calls stay out of the atom entirely for the
     * same reason — `default()` is mixin-only syntax.
     */
    choice(
      noTrivia(sequence(
        not(jessTypeNamespace),
        g.VariableReference,
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
        g.ExpressionCompare,
        literal(')')
      ),

      /*
       * NOTE: a BARE-name call (`max(1, 2)`) is deliberately NOT an atom here.
       * This atom is shared with `$if`/`when` conditions, which must keep
       * rejecting the mixin-only `default()` form; admitting bare calls would
       * make `default()` a legal condition. Dispatch reaches an expression only
       * through the `$fn(…)` reference tail above, which cannot spell `default()`.
       */
      g.Keyword
    ),
    (children) => {
      if (isToken(children[0]) && requireToken(children[0]).value === '(') {
        const inner = requireExpressionFact(children[1]);
        return { value: block(inner.value), src: `(${inner.src})` };
      }
      if (isJessReferenceTail(children[1])) {
        const base = requireValueNode(children[0]);
        if (base.type !== 'VariableReference' && base.type !== 'DeclarationReference') {
          throw new TypeError('Jess expression reference base must be a variable or declaration reference.');
        }
        const tails = children.slice(1).map(requireJessReferenceTail);
        if (base.type === 'VariableReference') {
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
      regex(/>=|<=|>|<|=/),
      g.ExpressionSum
    ),
    reduceGuardCompare
  );
  const GuardCall = node<GuardNode>(
    'GuardCall',
    choice(
      sequence(
        jessGuardUnaryTypePredicate,
        literal('('),
        g.ValueTerm,
        literal(')')
      ),
      sequence(
        jessGuardIsUnitPredicate,
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
      g.ExpressionCompare,
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
  const ExpressionInterpolation = node<ExpressionFact>(
    'ExpressionInterpolation',
    sequence(
      literal('$('),
      g.ExpressionCompare,
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
  const quotedExpressionParser = parser(
    { trivia: whitespace },
    g.Expression
  );
  const quotedExpressionInterpolationParser = parser(
    { trivia: whitespace },
    g.ExpressionInterpolation
  );
  const escapedStaticQuoted = choice(
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
  const plainDoubleQuoted = noTrivia(sequence(
    literal('"'),
    plainDoubleQuotedText,
    literal('"')
  ));
  const plainSingleQuoted = noTrivia(sequence(
    literal('\''),
    plainSingleQuotedText,
    literal('\'')
  ));
  const Quoted = node<Quoted | Interpolation>(
    'Quoted',
    choice(
      escapedStaticQuoted,
      plainDoubleQuoted,
      plainSingleQuoted,

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
          g.DollarBrace,
          quotedExpressionParser,
          interpolatedDoubleQuotedText
        )),
        literal('"')
      )),
      noTrivia(sequence(
        literal('~'),
        literal('\''),
        many(choice(
          g.DollarBrace,
          quotedExpressionParser,
          interpolatedSingleQuotedText
        )),
        literal('\'')
      )),
      noTrivia(sequence(
        literal('"'),
        many(choice(
          g.DollarBrace,
          quotedExpressionParser,
          interpolatedDoubleQuotedText
        )),
        literal('"')
      )),
      noTrivia(sequence(
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
  const StaticQuoted = node<Quoted>(
    'StaticQuoted',
    choice(
      escapedStaticQuoted,
      plainDoubleQuoted,
      plainSingleQuoted
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
    regex(/as(?![-_a-zA-Z0-9\u0080-\uffff])/),
    moduleBindingName
  );
  const styleImportAsClause = sequence(
    regex(/as(?![-_a-zA-Z0-9\u0080-\uffff])/),
    choice(
      literal('*'),
      moduleBindingName
    )
  );
  const StyleImport = node<StyleImport>(
    'StyleImport',
    choice(
      sequence(
        regex(/@-compose(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.Quoted,
        optional(styleImportAsClause),
        optional(literal(';'))
      ),
      sequence(
        regex(/@-export(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.Quoted,
        optional(literal(';'))
      ),
      sequence(
        regex(/@-import(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.Quoted,
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
  const ModuleImport = node<ModuleImport>(
    'ModuleImport',
    choice(
      sequence(
        regex(/@-use(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.Quoted,
        optional(styleImportAsClause),
        optional(literal(';'))
      ),
      sequence(
        regex(/@-from(?![-_a-zA-Z0-9\u0080-\uffff])/),
        g.Quoted,
        regex(/import(?![-_a-zA-Z0-9\u0080-\uffff])/),
        choice(
          sequence(
            literal('*'),
            moduleAsClause
          ),
          sequence(
            g.ModuleSpecifier,
            literal(','),
            literal('('),
            g.ModuleSpecifier,
            many(sequence(
              literal(','),
              g.ModuleSpecifier
            )),
            literal(')')
          ),
          g.ModuleSpecifier,
          sequence(
            literal('('),
            g.ModuleSpecifier,
            many(sequence(
              literal(','),
              g.ModuleSpecifier
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
      escapedStaticQuoted,
      plainDoubleQuoted,
      plainSingleQuoted,
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
    g.CssSyntaxKeyword,
    children => keyword(requireToken(children[0]).value)
  );
  const Dimension = node<Dimension>(
    'Dimension',
    noTrivia(sequence(
      g.CssSyntaxNumber,
      optional(g.CssSyntaxDimensionUnit)
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
    g.CssSyntaxHexColor,
    children => color(requireToken(children[0]).value)
  );
  const UrlInterpolatedValue = node<Interpolation>(
    'UrlInterpolatedValue',
    noTrivia(sequence(
      optional(jessUrlInterpolatedText),
      choice(
        g.DollarBrace,
        g.Expression
      ),
      many(choice(
        jessUrlInterpolatedText,
        g.DollarBrace,
        g.Expression
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
  const Url = node<Url>(
    'Url',
    sequence(
      g.CssSyntaxUrlOpen,
      optional(choice(
        g.StaticQuoted,
        g.CssSyntaxStaticUrlInner
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
  const InterpolatedUrl = node<Url>(
    'InterpolatedUrl',
    sequence(
      g.CssSyntaxUrlOpen,
      choice(
        g.Quoted,
        g.UrlInterpolatedValue
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
  const Simple = node<SimpleSelector>(
    'Simple',
    g.CssSyntaxSimple,
    children => simpleSelector(requireToken(children[0]).value)
  );

  /*
   * The fused form and its explicit `&(X)` spelling reduce to one canonical
   * `SimpleSelector.text`, so `&(-1)` and Less's `&-1` hand core identical input.
   * The parenthesized arm leads: the fused terminal would otherwise commit the
   * bare `&` of `&(-1)` and strand its payload.
   */
  const Parent = node<SimpleSelector>(
    'Parent',
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
   * re-parse through Simple. The predicate mirrors this arm's own
   * leading shape (optional class/id sigil + selector-text run) and requires an
   * interpolation opener immediately after it, so the opener is bound to THIS
   * simple selector and a sibling selector's interpolation never falsely admits
   * a plain one.
   */
  const directInterpSimpleAhead = not(not(regex(/[.#]?[-_a-zA-Z0-9\u0080-\uffff]*\$[[{]/)));
  const InterpolatedSimple = node<SimpleSelector>(
    'InterpolatedSimple',
    noTrivia(sequence(
      directInterpSimpleAhead,
      optional(regex(/[.#]/)),
      many(jessSelectorTextRun),
      g.DollarBrace,
      many(choice(
        g.DollarBrace,
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
   * the same fast reject `InterpolatedSimple` uses, so an ordinary `&`
   * compound member never pays a failed template scan.
   */
  const directInterpParentAhead = not(not(regex(/&[-_a-zA-Z0-9\u0080-\uffff]*\$[[{]/)));
  const InterpolatedParentSuffix = node<SimpleSelector>(
    'InterpolatedParentSuffix',
    noTrivia(sequence(
      directInterpParentAhead,
      literal('&'),
      many(jessSelectorTextRun),
      g.DollarBrace,
      many(choice(
        g.DollarBrace,
        jessSelectorTextRun
      ))
    )),
    children => interpolatedSimpleSelector(templateInterpolationFromChildren(children.filter(child => !isToken(child) || !child.value.includes('$'))))
  );
  const attributeDoubleQuoted = noTrivia(sequence(
    literal('"'),
    g.CssSyntaxDoubleQuotedText,
    literal('"')
  ));
  const attributeSingleQuoted = noTrivia(sequence(
    literal('\''),
    g.CssSyntaxSingleQuotedText,
    literal('\'')
  ));
  const Attribute = node<SimpleSelector>(
    'Attribute',
    sequence(
      literal('['),
      g.CssSyntaxKeyword,
      optional(sequence(
        g.CssSyntaxAttributeOperator,
        choice(
          attributeDoubleQuoted,
          attributeSingleQuoted,
          g.CssSyntaxKeyword
        ),
        optional(g.CssSyntaxAttributeModifier)
      )),
      literal(']')
    ),
    children => simpleSelector(children.map(requireToken).map(token => token.value).join(''))
  );

  /*
   * `:nth-child`/`:nth-last-child` argument: a bare `<An+B>` OR `<An+B> of S`
   * (Selectors-4 §6.6.2, https://www.w3.org/TR/selectors-4/#the-nth-child-pseudo).
   * The shared `g.CssSyntaxNth`/`g.CssSyntaxOfKeyword`/`g.CssSyntaxPseudoCloseAhead`
   * recognitions replace the inlined `<An+B> of` regex; `of` keeps its authored
   * surrounding whitespace (explicit `rawWhitespace`, not trivia) so `2n+1of .a`
   * cannot be silently normalized into the distinct `2n+1 of .a` syntax. The
   * selector fallback keeps a previously-opaque selector arg (`:nth-child(.a)`)
   * accepted as before; typed An+B is tried first so `-n+2` is not claimed as a
   * static `-n` selector.
   */
  const StaticNthChildArgument = node<SelectorList | string>(
    'StaticNthChildArgument',
    choice(
      sequence(
        g.CssSyntaxNth,
        optional(sequence(
          rawWhitespace,
          g.CssSyntaxOfKeyword,
          rawWhitespace,
          parser(
            { trivia: whitespace },
            g.StaticSelector
          )
        )),
        g.CssSyntaxPseudoCloseAhead
      ),
      parser(
        { trivia: whitespace },
        g.StaticSelector
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
  const StaticNthTypeArgument = node<SelectorList | string>(
    'StaticNthTypeArgument',
    choice(
      sequence(
        g.CssSyntaxNth,
        g.CssSyntaxPseudoCloseAhead
      ),
      sequence(
        not(parser(
          { trivia: whitespace },
          sequence(
            g.CssSyntaxNth,
            g.CssSyntaxOfKeyword
          )
        )),
        parser(
          { trivia: whitespace },
          g.StaticSelector
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
  const Pseudo = node<SimpleToken>(
    'Pseudo',

    /*
     * Insignificant whitespace may surround a functional pseudo's argument inside
     * its parens (`:not( .b )`, `:nth-child( 2n+1 )`). Consume it here so valid
     * CSS is accepted in the .jess dialect exactly as the canonical CSS grammar
     * accepts it; it is trivia, so the serialized argument stays normalized.
     * The nth families dispatch by NAME (shared `g.CssSyntaxNthChildName`/
     * `g.CssSyntaxNthTypeName`) so `of S` is accepted only on the child index
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
      g.CssSyntaxPseudoColon,
      choice(
        sequence(
          g.CssSyntaxNthChildName,
          literal('('),
          optional(rawWhitespace),
          StaticNthChildArgument,
          optional(rawWhitespace),
          literal(')')
        ),
        sequence(
          g.CssSyntaxNthTypeName,
          literal('('),
          optional(rawWhitespace),
          StaticNthTypeArgument,
          optional(rawWhitespace),
          literal(')')
        ),
        sequence(
          g.CssSyntaxSelectorArgPseudoName,
          literal('('),
          optional(rawWhitespace),
          g.StaticPseudoArgument,
          optional(rawWhitespace),
          literal(')')
        ),
        sequence(
          not(g.CssSyntaxSelectorArgPseudoName),
          not(g.CssSyntaxNthName),
          g.CssSyntaxKeyword,
          optional(sequence(
            literal('('),
            g.GenericPseudoArgument,
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
  const StaticCompound = node<SelectorTerm>(
    'StaticCompound',
    noTrivia(oneOrMore(choice(
      parser(
        { trivia: whitespace },
        g.Attribute
      ),
      g.Pseudo,
      g.Parent,
      g.Simple
    ))),
    reduceCompound
  );
  const selectorCombinator = choice(
    literal('||'),
    literal('>'),
    literal('+'),
    literal('~')
  );
  const StaticComplexTail = node<JessComplexTail>(
    'StaticComplexTail',
    sequence(
      optional(selectorCombinator),
      g.StaticCompound
    ),
    (children) => {
      const term = children.find(isCompound);
      if (term === undefined) {
        throw new TypeError('Jess static selector requires a compound tail.');
      }
      const token = children.find(isToken);
      const combinator = token?.value ?? ' ';
      if (combinator !== ' ' && combinator !== '>' && combinator !== '+' && combinator !== '~' && combinator !== '||') {
        throw new TypeError('Jess static selector produced an invalid combinator.');
      }
      return { combinator, term };
    }
  );
  const StaticComplex = node<ComplexSelector>(
    'StaticComplex',
    sequence(
      g.StaticCompound,
      many(g.StaticComplexTail)
    ),
    reduceComplex
  );
  const StaticSelectorTail = node<ComplexSelector>(
    'StaticSelectorTail',
    parser(
      { trivia: whitespace },
      sequence(
        literal(','),
        g.StaticComplex
      )
    ),
    reduceSelectorTail
  );
  const StaticSelector = node<SelectorList>(
    'StaticSelector',
    parser(
      { trivia: whitespace },
      sequence(
        g.StaticComplex,
        many(g.StaticSelectorTail)
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
   * stay unpopulated); `Pseudo` derives opaque SimpleSelector text otherwise.
   */
  const StaticPseudoArgument = node<SelectorList | string>(
    'StaticPseudoArgument',
    parser(
      { trivia: whitespace },
      g.StaticSelector
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
   * fact, not a parse decision — `a:totally-made-up(1)` and `:lang("en-US")` lost
   * the whole stylesheet. The selector arm is tried first so every argument that
   * already parsed keeps its structured `SelectorList` byte-for-byte; only what
   * previously rejected reaches the delimiter-aware verbatim scan the other
   * dialects already run for this class. A top-level `$` ends the scan, so the
   * required `)` then fails: a Jess interpolation in a pseudo
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
  const GenericPseudoArgument = node<SelectorList | string>(
    'GenericPseudoArgument',
    choice(
      sequence(
        optional(rawWhitespace),
        g.StaticPseudoArgument,
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
  const SelectorCapture = node<SelectorCapture>(
    'SelectorCapture',
    sequence(
      literal('*['),
      g.StaticSelector,
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
  const CallArgument = node<ValueSlot>(
    'CallArgument',
    sequence(
      literal(','),
      optional(regex(/[ \t\n\r\f]+/)),
      g.CallComponent
    ),
    (children) => {
      if ((children.length !== 2 && children.length !== 3) || requireToken(children[0]).value !== ',') {
        throw new TypeError('Jess call argument produced unexpected children.');
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
  const Call = node<FunctionCall>(
    'Call',
    sequence(
      not(regex(/url(?=\()/i)),
      g.CssSyntaxKeyword,
      literal('('),
      optional(sequence(
        g.CallComponent,
        many(g.CallArgument)
      )),
      literal(')')
    ),
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '(' || requireToken(children.at(-1)).value !== ')') {
        throw new TypeError('Jess call produced unexpected children.');
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
  const CollectionEntry = node<CollectionEntry>(
    'CollectionEntry',
    sequence(
      g.CssSyntaxProperty,
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
        jessDollarName
      )),
      (children) => {
        const name = requireToken(children[1]).value;
        return { step: { type: 'DotLookup', name }, src: `.${name}` };
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
        optional(sequence(
          g.MixinCallArgument,
          many(sequence(
            literal(','),
            g.MixinCallArgument
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
   * The leading `VariableReference` is shared across plain references,
   * accessor-tail chains, and unwrapped `/` slash lists. Arithmetic and
   * comparison stay in the explicit `$(...)` expression grammar so normal value
   * position cannot admit expression-only forms like leading-dot declaration
   * lookup.
   */
  const DollarValue = node<ValueNode>(
    'DollarValue',
    noTrivia(choice(
      attempt(sequence(
        g.DeclarationReference,
        literal('.'),
        jessDollarName,
        many(choice(
          g.ReferenceCallTail,
          g.ReferenceTail
        ))
      )),
      sequence(
        g.VariableReference,
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
      )
    )),
    (children) => {
      const base = requireValueNode(children[0]);
      if (children.length === 1) {
        if (base.type !== 'VariableReference') {
          throw new TypeError('Jess reference base must be a variable reference.');
        }
        return base;
      }
      const rest = children.slice(1);
      if (base.type === 'DeclarationReference') {
        const name = requireToken(rest[1]).value;
        const tails = rest.slice(2).map(requireJessReferenceTail);
        return reference(
          base,
          [
            { type: 'DotLookup', name },
            ...tails.map(tail => tail.step)
          ],
          `${base.raw}.${name}${tails.map(tail => tail.src).join('')}`
        );
      }
      if (base.type !== 'VariableReference') {
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
          `${base.lookup === 'scoped' ? '$$' : '$'}${base.name}${tails.map(tail => tail.src).join('')}`
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
  );

  /*
   * A CSS custom-property token is an ordinary component value (`var(--accent)`),
   * not a Jess declaration name. It is not a CSS ident, so it cannot reach the
   * Keyword leaf; give it its own arm just ahead of Keyword, which shares the
   * leading `-` but can never match a second one.
   */
  const CustomPropertyValue = node<Keyword>(
    'CustomPropertyValue',
    g.CssSyntaxCustomProperty,
    children => keyword(requireToken(children[0]).value)
  );
  const keywordToken = choice(
    token(g.CssSyntaxCustomProperty),
    token(g.CssSyntaxKeyword)
  );
  const RoutedCustomPropertyValue = node<Keyword>(
    'CustomPropertyValue',
    routed(),
    children => keyword(requireToken(children[0]).value)
  );
  const KeywordValue = node<Keyword>(
    'Keyword',
    routed(),
    children => keyword(requireToken(children[0]).value)
  );

  /*
   * Custom-property values and ordinary identifiers are both value keywords once
   * reduced. Route the already-read token so the `--*` special case does not sit
   * beside a second identifier-shaped keyword arm in value atoms.
   */
  const KeywordLikeValue = dispatch(
    keywordToken,
    when(
      startsWith('--'),
      RoutedCustomPropertyValue
    ),
    otherwise(KeywordValue)
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
        jessInterpolatedValueTail,
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
  const nonBlockValueAtom = choice(
    g.DollarValue,
    g.ExpressionLambda,
    g.InterpolatedValue,
    g.SelectorCapture,
    g.Url,
    g.InterpolatedUrl,
    g.Call,
    g.Quoted,
    g.Color,
    g.Dimension,
    KeywordLikeValue
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
        jessValueSlashBoundary,
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
  const StaticValueAtom = node<ValueNode>(
    'StaticValueAtom',
    choice(
      g.Url,
      g.StaticCall,
      g.StaticQuoted,
      g.Color,
      g.Dimension,
      g.CustomPropertyValue,
      g.Keyword
    ),
    children => requireValueNode(children[0])
  );
  const StaticValue = node<ValueSlot>(
    'StaticValue',
    noTrivia(sequence(
      g.StaticValueAtom,
      many(sequence(
        regex(/[ \t\n\r\f]+/),
        g.StaticValueAtom
      ))
    )),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : values;
    }
  );
  const StaticCallArgument = node<ValueSlot>(
    'StaticCallArgument',
    sequence(
      literal(','),
      optional(regex(/[ \t\n\r\f]+/)),
      g.StaticValue
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
   * in StaticValueAtom and takes it first.
   */
  const StaticCall = node<FunctionCall>(
    'StaticCall',
    sequence(
      noTrivia(sequence(
        g.CssSyntaxKeyword,
        literal('(')
      )),
      optional(sequence(
        g.StaticValue,
        many(g.StaticCallArgument)
      )),
      literal(')')
    ),
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '(' || requireToken(children.at(-1)).value !== ')') {
        throw new TypeError('Jess static function call lost its call boundaries.');
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
  const StaticAtQueryValue = node<ValueNode>(
    'StaticAtQueryValue',
    sequence(
      g.StaticValueAtom,
      optional(sequence(
        optional(rawWhitespace),
        literal('/'),
        optional(rawWhitespace),
        g.StaticValueAtom
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
  const StaticAtQueryProperty = node<JessStaticAtQueryProperty>(
    'StaticAtQueryProperty',
    g.CssSyntaxKeyword,
    children => ({ property: keyword(requireToken(children[0]).value) })
  );
  const StaticAtComparisonQuery = node<ValueNode>(
    'StaticAtComparisonQuery',
    choice(
      sequence(
        literal('('),
        optional(rawWhitespace),
        StaticAtQueryProperty,
        optional(rawWhitespace),
        field(
          'comparison',
          g.CssSyntaxQueryComparisonOperator
        ),
        optional(rawWhitespace),
        StaticAtQueryValue,
        optional(rawWhitespace),
        literal(')')
      ),
      sequence(
        literal('('),
        optional(rawWhitespace),
        StaticAtQueryValue,
        optional(rawWhitespace),
        field(
          'comparison',
          g.CssSyntaxQueryComparisonOperator
        ),
        optional(rawWhitespace),
        StaticAtQueryProperty,
        optional(sequence(
          optional(rawWhitespace),
          field(
            'comparison',
            g.CssSyntaxQueryComparisonOperator
          ),
          optional(rawWhitespace),
          StaticAtQueryValue
        )),
        optional(rawWhitespace),
        literal(')')
      )
    ),
    (children, fields) => {
      const propertyFact = children.find((child): child is JessStaticAtQueryProperty => typeof child === 'object' && child !== null && 'property' in child);
      if (propertyFact === undefined) {
        throw new TypeError('Jess static query comparison lost its property.');
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
        throw new TypeError('Jess static query comparison lost an operand.');
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
          throw new TypeError('Jess static query comparison lost its range end.');
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
  const StaticAtQuery = node<ValueNode>(
    'StaticAtQuery',
    noTrivia(choice(
      StaticAtComparisonQuery,
      sequence(
        literal('('),
        optional(rawWhitespace),
        g.CssSyntaxKeyword,
        optional(rawWhitespace),
        literal(':'),
        optional(rawWhitespace),
        StaticAtQueryValue,
        optional(rawWhitespace),
        literal(')')
      ),
      sequence(
        literal('('),
        optional(rawWhitespace),
        g.CssSyntaxKeyword,
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
  const StaticAtNonOnlyKeyword = node<Keyword>(
    'StaticAtNonOnlyKeyword',
    sequence(
      not(g.CssSyntaxQueryOnly),
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
  const StaticAtDashedIdent = node<Keyword>(
    'StaticAtDashedIdent',
    g.CssSyntaxCustomProperty,
    children => keyword(requireToken(children[0]).value)
  );
  const StaticAtNonOnlyAtom = node<ValueNode>(
    'StaticAtNonOnlyAtom',
    choice(
      g.StaticAtQuery,
      g.StaticAtDashedIdent,
      sequence(
        not(g.CssSyntaxQueryOnly),
        g.StaticValueAtom
      )
    ),
    children => requireValueNode(children.at(-1))
  );
  const StaticAtPreludeTerm = node<ValueNode>(
    'StaticAtPreludeTerm',
    noTrivia(sequence(choice(
      sequence(
        g.CssSyntaxQueryOnly,
        regex(/[ \t\n\r\f]+/),
        StaticAtNonOnlyKeyword,
        many(sequence(
          regex(/[ \t\n\r\f]+/),
          StaticAtNonOnlyAtom
        ))
      ),
      sequence(
        StaticAtNonOnlyAtom,
        many(sequence(
          regex(/[ \t\n\r\f]+/),
          StaticAtNonOnlyAtom
        ))
      )
    ))),
    (children) => {
      const values = children.filter(isValueNode);
      const startsWithOnly = children.some(child => isToken(child) && requireToken(child).value.toLowerCase() === 'only');
      return startsWithOnly ? spaced([keyword('only'), ...values]) : values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const StaticAtPrelude = node<ValueNode | null>(
    'StaticAtPrelude',
    sequence(
      optional(g.StaticAtPreludeTerm),
      many(sequence(
        literal(','),
        g.StaticAtPreludeTerm
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
  const MediaPrelude = node<ValueNode | null>(
    'MediaPrelude',
    choice(
      g.DollarBrace,
      g.StaticAtPrelude
    ),
    children => children[0] === null ? null : requireValueNode(children[0])
  );

  /*
   * Statement headers remain fully static. The documented deferred media form
   * is a block-only construct, so it cannot silently become `@media $(x);`.
   * Every arm leads with a concrete `@`-first recognizer (no leading `not(...)`),
   * so the whole header — and the `AtRuleStatement`/`AtRuleBlock` that
   * wrap it — keeps a `{@}` first-set. That lets parseman fast-reject non-`@`
   * statements at the leading char instead of entering this node frame and
   * running the media/container lookaheads at every rule. The former arm-2
   * `not(@media)` / `not(@container only)` guards are folded into the dedicated
   * media/container arms plus the `media`/`container` exclusion in
   * `jessGenericCssAtRuleName`, preserving the exact accept/reject set.
   */
  const StaticAtRuleHeader = node<JessAtRuleHeader>(
    'StaticAtRuleHeader',
    choice(
      sequence(
        g.CssSyntaxMediaAtKeyword,
        not(choice(
          literal('{'),
          literal(';')
        )),
        g.StaticAtPrelude
      ),
      sequence(
        g.CssSyntaxContainerAtKeyword,
        not(g.CssSyntaxQueryOnly),
        g.StaticAtPrelude
      ),
      sequence(
        jessGenericCssAtRuleName,
        g.StaticAtPrelude
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
  const AtRuleHeader = node<JessAtRuleHeader>(
    'AtRuleHeader',
    choice(
      sequence(
        g.CssSyntaxMediaAtKeyword,
        not(literal('{')),
        g.MediaPrelude
      ),
      g.StaticAtRuleHeader
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
  const SupportsAtom = node<ValueNode>(
    'SupportsAtom',
    g.StaticValueAtom,
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
   * between the two chains is the `g.Expression` arm.
   */

  /*
   * STRICT chain — the general-enclosed body and its non-quoted wrappers. Its
   * quoted arms hand off to the permissive chain below and never come back.
   */
  const GeneralTemplateParen = node<Interpolation>(
    'GeneralTemplateParen',
    sequence(
      literal('('),
      g.GeneralTemplate,
      literal(')')
    ),
    templateInterpolationFromChildren
  );
  const GeneralTemplateSquare = node<Interpolation>(
    'GeneralTemplateSquare',
    sequence(
      literal('['),
      g.GeneralTemplate,
      literal(']')
    ),
    templateInterpolationFromChildren
  );
  const GeneralTemplateBrace = node<Interpolation>(
    'GeneralTemplateBrace',
    sequence(
      literal('{'),
      g.GeneralTemplate,
      literal('}')
    ),
    templateInterpolationFromChildren
  );
  const GeneralTemplateDoubleQuoted = node<Interpolation>(
    'GeneralTemplateDoubleQuoted',
    sequence(
      literal('"'),
      g.GeneralQuotedTemplate,
      literal('"')
    ),
    templateInterpolationFromChildren
  );
  const GeneralTemplateSingleQuoted = node<Interpolation>(
    'GeneralTemplateSingleQuoted',
    sequence(
      literal('\''),
      g.GeneralQuotedTemplate,
      literal('\'')
    ),
    templateInterpolationFromChildren
  );
  const GeneralTemplate = node<Interpolation>(
    'GeneralTemplate',
    many(choice(
      g.DollarBrace,
      g.GeneralTemplateParen,
      g.GeneralTemplateSquare,
      g.GeneralTemplateBrace,
      g.GeneralTemplateDoubleQuoted,
      g.GeneralTemplateSingleQuoted,
      jessGeneralTemplateText
    )),
    templateInterpolationFromChildren
  );

  /*
   * PERMISSIVE chain — everything reachable from inside a quoted sub-template.
   * Reached ONLY through the two quoted arms above, and closed under its own
   * wrappers so nesting never escapes back to the strict chain.
   */
  const GeneralQuotedTemplateParen = node<Interpolation>(
    'GeneralQuotedTemplateParen',
    sequence(
      literal('('),
      g.GeneralQuotedTemplate,
      literal(')')
    ),
    templateInterpolationFromChildren
  );
  const GeneralQuotedTemplateSquare = node<Interpolation>(
    'GeneralQuotedTemplateSquare',
    sequence(
      literal('['),
      g.GeneralQuotedTemplate,
      literal(']')
    ),
    templateInterpolationFromChildren
  );
  const GeneralQuotedTemplateBrace = node<Interpolation>(
    'GeneralQuotedTemplateBrace',
    sequence(
      literal('{'),
      g.GeneralQuotedTemplate,
      literal('}')
    ),
    templateInterpolationFromChildren
  );
  const GeneralQuotedTemplateDoubleQuoted = node<Interpolation>(
    'GeneralQuotedTemplateDoubleQuoted',
    sequence(
      literal('"'),
      g.GeneralQuotedTemplate,
      literal('"')
    ),
    templateInterpolationFromChildren
  );
  const GeneralQuotedTemplateSingleQuoted = node<Interpolation>(
    'GeneralQuotedTemplateSingleQuoted',
    sequence(
      literal('\''),
      g.GeneralQuotedTemplate,
      literal('\'')
    ),
    templateInterpolationFromChildren
  );
  const GeneralQuotedTemplate = node<Interpolation>(
    'GeneralQuotedTemplate',
    many(choice(
      g.DollarBrace,
      g.Expression,
      g.GeneralQuotedTemplateParen,
      g.GeneralQuotedTemplateSquare,
      g.GeneralQuotedTemplateBrace,
      g.GeneralQuotedTemplateDoubleQuoted,
      g.GeneralQuotedTemplateSingleQuoted,
      jessGeneralTemplateText
    )),
    templateInterpolationFromChildren
  );
  const GeneralEnclosed = node<GeneralEnclosed>(
    'GeneralEnclosed',
    choice(
      sequence(
        g.CssSyntaxKeyword,
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
  const SupportsNot = node<Keyword>(
    'SupportsNot',
    g.CssSyntaxQueryNot,
    children => keyword(requireToken(children[0]).value)
  );
  const SupportsLogical = node<Keyword>(
    'SupportsLogical',
    g.CssSyntaxQueryAndOr,
    children => keyword(requireToken(children[0]).value)
  );
  const SupportsFeature = node<ValueNode>(
    'SupportsFeature',
    noTrivia(choice(
      sequence(
        literal('('),
        optional(rawWhitespace),
        g.CssSyntaxKeyword,
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
        g.CssSyntaxKeyword,
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
      g.GeneralEnclosed
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
      jessCharsetAtRuleName,
      g.StaticQuoted,
      literal(';')
    ),
    children => atRuleStatement(
      requireToken(children[0]).value,
      requireStaticQuoted(children[1])
    )
  );
  const CssImportTarget = node<Quoted | Url>(
    'CssImportTarget',
    choice(
      g.StaticQuoted,
      sequence(
        g.CssSyntaxUrlOpen,
        literal(')')
      ),
      sequence(
        g.CssSyntaxUrlOpen,
        choice(
          g.Quoted,
          g.UrlInterpolatedValue,
          g.CssSyntaxStaticUrlInner
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
  const importTailFunctionName = token(noTrivia(sequence(
    g.CssSyntaxKeyword,
    not(not(literal('(')))
  )));
  const ImportTailFunction = node<FunctionCall>(
    'ImportTailFunction',
    dispatch(
      importTailFunctionName,

      /*
       * `<supports-condition>` already owns its own parentheses, so the
       * `supports(` opener IS the condition's leading paren — no second pair.
       */
      jessCase(
        'supports',
        sequence(
          routed(),
          g.SupportsCondition
        )
      ),
      jessCase(
        'layer',
        sequence(
          routed(),
          literal('('),
          g.Keyword,
          literal(')')
        )
      )
    ),
    children => funcCall(
      requireToken(children[0]).value,
      [requireValueNode(children.find(isValueNode))]
    )
  );
  const CssImportPrelude = node<ValueNode>(
    'CssImportPrelude',
    noTrivia(sequence(
      g.CssImportTarget,
      many(sequence(
        regex(/[ \t\n\r\f]+/),
        choice(
          g.ImportTailFunction,
          g.StaticAtPreludeTerm
        )
      ))
    )),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const CssImport = node<AtRuleStatement>(
    'CssImport',
    sequence(
      jessImportAtRuleName,
      g.CssImportPrelude,
      literal(';')
    ),
    children => atRuleStatement(
      requireToken(children[0]).value,
      requireValueNode(children[1])
    )
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
      jessSupportsAtRuleName,
      g.SupportsCondition,
      literal('{'),
      many(atBlockStatement),
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
  const PropertyName = node<Keyword>(
    'PropertyName',
    noTrivia(sequence(
      literal('--'),
      g.CssSyntaxKeyword
    )),
    children => keyword(`${requireToken(children[0]).value}${requireToken(children[1]).value}`)
  );

  /*
   * Registered-property descriptors are authored CSS component values, but they
   * are not Jess value positions: they take the shared static component value
   * above, never Value (which admits variable references,
   * interpolation, arithmetic, and collections) and never Any/raw source.
   */
  const StaticPropertyDescriptor = node<Declaration>(
    'StaticPropertyDescriptor',
    sequence(
      g.CssSyntaxProperty,
      literal(':'),
      g.StaticValue,
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
  const PropertyAtRule = node<AtRuleBlock>(
    'PropertyAtRule',
    sequence(
      jessPropertyAtRuleName,
      g.PropertyName,
      literal('{'),
      many(g.StaticPropertyDescriptor),
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
   * Keyframes already fit the canonical AtRuleBlock + Ruleset model.  Keep the
   * header and selector boundary static until Jess has typed interpolation for
   * those positions; never turn either into a source-text prelude.
   */
  const KeyframeSelector = node<SimpleSelector>(
    'KeyframeSelector',
    choice(
      jessKeyframeEndpoint,
      jessKeyframePercent
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
    (children) => {
      const selectors = children.filter((child): child is SimpleSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'SimpleSelector')
        .map(selector => complexSelector([{ term: selector }]));
      const bodyOpen = children.findIndex(child => isToken(child) && child.value === '{');
      if (bodyOpen < 0) {
        throw new TypeError('Jess keyframe block lost its body boundary.');
      }
      return rule(
        selist(...selectors),
        requireStatements(children.slice(
          bodyOpen + 1,
          -1
        ).filter(isDeclaration))
      );
    }
  );
  const Keyframes = node<AtRuleBlock>(
    'Keyframes',
    sequence(
      g.CssSyntaxKeyframesAtKeyword,
      choice(
        g.Keyword,
        g.StaticQuoted
      ),
      literal('{'),
      many(g.KeyframeBlock),
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
  const assignHead = choice(
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
   * direct grammar construction rather than a Jess-specific compatibility path.
   * Comments around the marker/name are ambient trivia, not value children.
   */
  const Important = node<true>(
    'Important',
    sequence(
      literal('!'),
      g.CssSyntaxImportant
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
   * Jess owns only its `$[…]` segment grammar and direct AST reduction.
   * Cheap superset lookahead so an ordinary `color: …` declaration does not
   * enter the interpolated-property arm, consume the whole property name via
   * the optional literal start, fail the required interpolation, and backtrack a
   * property re-parse through CssSyntaxProperty. Skip this arm unless a
   * `$[` or `${` actually precedes the next `:`/`;`/brace. A property name never
   * contains `:`, `;`, `{`, or `}`, so the predicate is a strict superset: a
   * real interpolated property is never skipped.
   */
  const directInterpPropertyAhead = not(not(regex(/[^{};:]*\$[[{]/)));
  const InterpolatedProperty = node<Interpolation>(
    'InterpolatedProperty',
    noTrivia(sequence(
      directInterpPropertyAhead,
      optional(g.CssSyntaxInterpolatedPropertyStart),
      g.DollarBrace,
      many(choice(
        g.CssSyntaxInterpolatedPropertyTail,
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
  const CustomPropertyName = node<string | Interpolation>(
    'CustomPropertyName',
    choice(
      noTrivia(sequence(
        literal('--'),
        many(jessCustomPropertyChunk),
        g.DollarBrace,
        many(choice(
          jessCustomPropertyChunk,
          g.DollarBrace
        ))
      )),
      g.CssSyntaxCustomProperty
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
  const CustomParen = node<readonly unknown[]>(
    'CustomParen',
    noTrivia(sequence(
      literal('('),
      many(g.CustomInnerPart),
      literal(')')
    )),
    children => children.slice()
  );
  const CustomSquare = node<readonly unknown[]>(
    'CustomSquare',
    noTrivia(sequence(
      literal('['),
      many(g.CustomInnerPart),
      literal(']')
    )),
    children => children.slice()
  );
  const CustomCurly = node<readonly unknown[]>(
    'CustomCurly',
    noTrivia(sequence(
      literal('{'),
      many(g.CustomInnerPart),
      literal('}')
    )),
    children => children.slice()
  );
  const CustomInnerPart: Combinator<unknown> = choice(
    g.DollarBrace,
    g.CssSyntaxCustomInnerContent,
    blockComment,
    g.CssSyntaxCustomSingleQuoted,
    g.CssSyntaxCustomDoubleQuoted,
    g.CustomParen,
    g.CustomSquare,
    g.CustomCurly
  );
  const CustomPart: Combinator<unknown> = choice(
    g.DollarBrace,
    g.CssSyntaxCustomOuterContent,
    blockComment,
    g.CssSyntaxCustomSingleQuoted,
    g.CssSyntaxCustomDoubleQuoted,
    g.CustomParen,
    g.CustomSquare,
    g.CustomCurly
  );
  const CustomValue = node<ValueNode>(
    'CustomValue',
    noTrivia(many(g.CustomPart)),
    children => customValueFromChildren(children)
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
      g.CustomPropertyName,
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
        choice(
          InterpolatedProperty,
          g.CssSyntaxProperty
        ),
        literal(':'),
        g.Value,
        optional(g.Important),
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
   * Ordered ahead of `AtRuleBlock`, whose generic name also admits
   * `@scope`; the statement form (`@scope;`) has no `{` and still falls through.
   */
  const ScopeBlock = node<AtRuleBlock>(
    'ScopeBlock',
    sequence(
      jessScopeAtRuleName,
      noTrivia(sequence(
        g.OpaquePrelude,
        literal('{')
      )),
      many(atBlockStatement),
      literal('}')
    ),
    (children) => {
      const prelude = children[1];
      if (prelude !== null && typeof prelude !== 'string') {
        throw new TypeError('Jess scope at-rule lost its grammar-owned prelude.');
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
  const AtRuleBlock = node<AtRuleBlock>(
    'AtRuleBlock',
    sequence(
      g.AtRuleHeader,
      literal('{'),
      many(atBlockStatement),
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
  const AtRuleStatement = node<AtRuleStatement>(
    'AtRuleStatement',
    sequence(
      g.StaticAtRuleHeader,
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
  const OpaquePrelude = node<string | null>(
    'OpaquePrelude',
    g.JessOpaqueStaticPrelude,
    (children) => {
      const text = children.length === 0 ? '' : requireToken(children[0]).value.trim();
      return text === '' ? null : text;
    }
  );
  const OpaqueBody = node<string>(
    'OpaqueBody',
    g.JessOpaqueBody,
    children => children.length === 0 ? '' : requireToken(children[0]).value
  );
  const OpaqueAtRuleBlock = node<OpaqueAtRuleBlock>(
    'OpaqueAtRuleBlock',
    sequence(
      not(jessCompilerAtRuleName),
      g.CssSyntaxGenericAtRuleName,
      noTrivia(sequence(
        g.OpaquePrelude,
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
      jessDollarName,
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
      optional(sequence(
        g.MixinParam,
        many(sequence(
          literal(','),
          g.MixinParam
        ))
      )),
      literal(')')
    ),
    children => children.filter((child): child is Param => typeof child === 'object' && child !== null && !('type' in child) && 'name' in child)
  );
  const MixinCallArgument = node<JessMixinCallArgument>(
    'MixinCallArgument',
    choice(
      sequence(
        literal('$'),
        jessDollarName,
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
      return name === undefined ? { value } : { name: name.value, value };
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
      optional(sequence(
        g.MixinCallArgument,
        many(sequence(
          literal(','),
          g.MixinCallArgument
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
  const MixinDefinition = node<MixinDefinition>(
    'MixinDefinition',
    sequence(
      mixinNameToken,
      g.MixinParams,
      optional(sequence(
        regex(/when(?![-_a-zA-Z0-9\u0080-\uffff])/),
        literal('('),
        g.MixinGuard,
        literal(')')
      )),
      literal('{'),
      many(nestedBodyStatement),
      literal('}')
    ),
    (children) => {
      const bodyOpen = children.findIndex(child =>
        isToken(child) && child.value === '{');
      if (bodyOpen < 0) {
        throw new TypeError('Jess grammar produced a mixin definition without a body.');
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
      jessDollarName
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
      regex(/to(?![-_a-zA-Z0-9\u0080-\uffff])/),
      optional(literal('<')),
      g.ForRangeBound,
      optional(sequence(
        regex(/step(?![-_a-zA-Z0-9\u0080-\uffff])/),
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
   */
  const IfGuardValue = node<GuardNode>(
    'IfGuardValue',
    g.ExpressionSum,
    reduceGuardTruth
  );
  const IfGuardCompare = node<GuardNode>(
    'IfGuardCompare',
    noTrivia(sequence(
      g.ExpressionSum,
      jessIfGuardCompareOperator,
      g.ExpressionSum
    )),
    reduceGuardCompare
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
      g.IfGuardValue
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
  const Compound = node<SelectorTerm>(
    'Compound',
    noTrivia(oneOrMore(choice(
      parser(
        { trivia: whitespace },
        g.Attribute
      ),
      g.Pseudo,
      g.InterpolatedParentSuffix,
      g.InterpolatedSimple,
      g.Parent,
      g.Simple
    ))),
    reduceCompound
  );
  const ComplexTail = node<JessComplexTail>(
    'ComplexTail',
    sequence(
      optional(selectorCombinator),
      g.Compound
    ),
    (children) => {
      const term = children.find(isCompound);
      if (term === undefined) {
        throw new TypeError('Jess selector tail requires a compound.');
      }
      const token = children.find(isToken);
      const combinator = token?.value ?? ' ';
      if (combinator !== ' ' && combinator !== '>' && combinator !== '+' && combinator !== '~' && combinator !== '||') {
        throw new TypeError('Jess selector tail produced an invalid combinator.');
      }
      return { combinator, term };
    }
  );
  const Complex = node<ComplexSelector>(
    'Complex',
    sequence(
      g.Compound,
      many(g.ComplexTail)
    ),
    reduceComplex
  );
  const SelectorTail = node<ComplexSelector>(
    'SelectorTail',
    sequence(
      literal(','),
      g.Complex
    ),
    reduceSelectorTail
  );
  const Selector = node<SelectorList>(
    'Selector',
    sequence(
      g.Complex,
      many(g.SelectorTail)
    ),
    reduceSelectorList
  );
  const Apply = node<Apply>(
    'Apply',
    sequence(
      regex(/\$apply(?![-\w])/),
      g.StaticCompound,
      many(sequence(
        literal(','),
        g.StaticCompound
      )),
      optional(literal(';'))
    ),
    children => apply(children.filter(isCompound))
  );
  const Extend = node<ExtendInstruction[]>(
    'Extend',
    sequence(
      regex(/\$extend(?![-\w])/),
      g.StaticComplex,
      many(sequence(
        literal(','),
        g.StaticComplex
      )),
      optional(regex(/!exact(?![-\w])/)),
      optional(literal(';'))
    ),
    children => children.filter((child): child is ComplexSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'ComplexSelector')
      .map(target => ({ target: selist(target), partial: !children.some(child => isToken(child) && child.value === '!exact') }))
  );
  const Ruleset = node<Ruleset>(
    'Ruleset',
    sequence(
      g.Selector,
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
        g.CssImport
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
    GuardValue,
    GuardCompare,
    GuardCall,
    GuardPrimary,
    GuardAnd,
    GuardOr,
    MixinGuard,
    Keyword,
    Quoted,
    StaticQuoted,
    StyleImport,
    ModuleSpecifier,
    ModuleImport,
    StaticValueAtom,
    StaticValue,
    StaticCallArgument,
    StaticCall,
    StaticAtNonOnlyKeyword,
    StaticAtNonOnlyAtom,
    StaticAtQuery,
    StaticAtDashedIdent,
    StaticAtPreludeTerm,
    StaticAtPrelude,
    MediaPrelude,
    StaticAtRuleHeader,
    AtRuleHeader,
    SupportsAtom,
    GeneralTemplate,
    GeneralTemplateParen,
    GeneralTemplateSquare,
    GeneralTemplateBrace,
    GeneralTemplateDoubleQuoted,
    GeneralTemplateSingleQuoted,
    GeneralQuotedTemplate,
    GeneralQuotedTemplateParen,
    GeneralQuotedTemplateSquare,
    GeneralQuotedTemplateBrace,
    GeneralQuotedTemplateDoubleQuoted,
    GeneralQuotedTemplateSingleQuoted,
    GeneralEnclosed,
    SupportsNot,
    SupportsLogical,
    SupportsFeature,
    SupportsInParens,
    SupportsCondition,
    CssImportTarget,
    ImportTailFunction,
    CssImportPrelude,
    UrlInterpolatedValue,
    Charset,
    CssImport,
    SupportsAtRuleBlock,
    PropertyName,
    StaticPropertyDescriptor,
    PropertyAtRule,
    KeyframeSelector,
    KeyframeBlock,
    Keyframes,
    OpaquePrelude,
    OpaqueBody,
    OpaqueAtRuleBlock,
    ScopeBlock,
    AtRuleBlock,
    AtRuleStatement,
    Dimension,
    Color,
    Url,
    InterpolatedUrl,
    CallComponent,
    CallArgument,
    Call,
    CollectionEntry,
    Collection,
    InterpolatedValue,
    ValueAtom,
    ValueSpaceGroup,
    ValueTerm,
    Value,
    Important,
    CustomPropertyValue,
    CustomPropertyName,
    CustomPart,
    CustomInnerPart,
    CustomParen,
    CustomSquare,
    CustomCurly,
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
    Simple,
    Parent,
    InterpolatedSimple,
    InterpolatedParentSuffix,
    Attribute,
    Pseudo,
    StaticPseudoArgument,
    GenericPseudoArgument,
    Compound,
    StaticCompound,
    StaticComplexTail,
    StaticComplex,
    StaticSelectorTail,
    StaticSelector,
    SelectorCapture,
    ComplexTail,
    Complex,
    SelectorTail,
    Selector,
    Ruleset,
    ForName,
    ForBinding,
    ForRangeBound,
    ForRange,
    ForSource,
    For,
    IfGuardValue,
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
    rw: whitespace,
    whitespace
  };
};

export const jessGrammar = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<JessRules>(
  { trivia: whitespace },
  jessFactory
)]);

export const jessAstGrammar = jessGrammar;

export const jessCstGrammar = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<JessRules>(
  { trivia: whitespace, hostMode: 'cst' },
  jessFactory
)]);
