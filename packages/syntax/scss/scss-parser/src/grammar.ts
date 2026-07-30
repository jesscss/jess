/**
 * Canonical SCSS host-mode grammar.
 *
 * CSS base: ../../../css/css-parser/src/grammar.ts
 *
 * SCSS adds and overrides:
 * - Language-specific features: $variables, Sass interpolation, modules,
 *   mixins, functions, control rules, placeholder selectors, @extend, and
 *   Sass import/use/forward forms.
 * - Expanded CSS shapes: expression/map/list values, nested properties,
 *   interpolated selectors/properties/at-rule preludes, and selector forms
 *   where SCSS adds authored syntax inside otherwise CSS-owned structure.
 * - SCSS is a sibling grammar over CSS/shared syntax; it must not inherit Less
 *   routes or keep Less-only compatibility seams.
 *
 * The same factory builds the package AST route and the public positioned CST
 * route via Parseman's `hostMode`.
 */
import { balanced, choice, composeLeaf, dispatch, endsWith, expect, literal, makeWhen, many, noTrivia, node, not, oneOrMore, optional, otherwise, parser, peek, regex, routed, rules, scanTo, sequence, token, trivia, when } from 'parseman' with { type: 'macro' };
import type { Combinator, FusedRule } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';
import { opaqueAtRuleRecognition } from '@jesscss/parser-shared/opaque-at-rule';
import { anonymousMixin, any, atRuleBlock, atRuleStatement, block, collection, collectionEntry, color, comment, selectorBranchOf, decl, dimension, forNode, funcCall, generalEnclosed, ifNode, importAtRule, interpolation, interpolatedSimpleSelector, keyword, list, mixinCall, mixinDef, moduleImport, opaqueAtRuleBlock, operation, pseudoSelector, quoted, range, reference, relativeSelector, selectorTermOf, stylesheet, rule, selist, simpleSelector, spaced, styleImport, url, variableDeclaration, variableReference, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { AtRuleBlock, AtRuleStatement, Collection, CollectionEntry, Color, Comment, ComplexSelector, CompoundSelector, Declaration, Dimension, ExtendInstruction, For, ForBinding, FunctionCall, GeneralEnclosed, GuardNode, If, IfBranch, ImportAtRule, Interpolation, Keyword, MixinCall, MixinDefinition, ModuleImport, OpaqueAtRuleBlock, Param, Quoted, Reference, ReferenceStep, SelectorBranch, SelectorTerm, Stylesheet, Ruleset, SelectorList, SimpleSelector, SimpleToken, Statement, StyleImport, Url, ValueNode, ValueSlot, VariableDeclaration, VariableReference } from '@jesscss/core/ast';

type Token = { readonly value: string };
type ScssValuePair = { readonly separator: string; readonly value: ValueSlot };
type ScssValueTail = { readonly kind: 'space' | 'slash'; readonly value: ValueNode; readonly separator: string };
type ScssCallArg = { readonly value: ValueSlot; readonly name?: string; readonly spread?: boolean };
type ScssComplexTail = { readonly combinator: ' ' | '>' | '+' | '~' | '||'; readonly term: SelectorTerm };
type ScssSegmentCombinator = ' ' | '>' | '+' | '~' | '|' | '||';

const scriptModuleExtensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json'] as const;

function isScriptModulePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return scriptModuleExtensions.some(extension => normalized.slice(-extension.length) === extension);
}

type ScssRules = {
  Stylesheet: Combinator<Stylesheet>;
  VariableDeclaration: Combinator<VariableDeclaration>;
  Comment: Combinator<Comment>;
  VariableReference: Combinator<VariableReference>;
  SassInterpolation: Combinator<Interpolation>;
  Quoted: Combinator<Quoted | Interpolation>;
  StaticQuoted: Combinator<Quoted>;
  Keyword: Combinator<Keyword>;
  CustomPropertyValue: Combinator<Keyword>;
  Color: Combinator<Color>;
  UnicodeRange: Combinator<ValueNode>;
  Dimension: Combinator<Dimension>;
  InterpolatedUrlValue: Combinator<Interpolation>;
  InterpolatedValue: Combinator<Interpolation>;
  Paren: Combinator<ValueNode>;
  MapEntry: Combinator<CollectionEntry>;
  Map: Combinator<Collection>;
  ReturnRule: Combinator<Declaration>;
  FunctionRule: Combinator<VariableDeclaration>;
  Square: Combinator<ValueNode>;
  ValueAtom: Combinator<ValueNode>;
  MathUnary: Combinator<ValueNode>;
  MathProduct: Combinator<ValueNode>;
  MathSum: Combinator<ValueNode>;
  MathTopProduct: Combinator<ValueNode>;
  MathTopSum: Combinator<ValueNode>;
  ValueTerm: Combinator<ValueSlot>;
  ValuePair: Combinator<ScssValuePair>;
  Value: Combinator<ValueSlot>;
  Important: Combinator<true>;
  InterpolatedProperty: Combinator<Interpolation>;
  CustomPropertyName: Combinator<string | Interpolation>;
  CustomPart: Combinator<unknown>;
  CustomInnerPart: Combinator<unknown>;
  CustomParen: Combinator<readonly unknown[]>;
  CustomSquare: Combinator<readonly unknown[]>;
  CustomCurly: Combinator<readonly unknown[]>;
  CustomValue: Combinator<ValueNode>;
  CustomDeclaration: Combinator<Declaration>;
  Declaration: Combinator<Declaration>;
  NestedPropertyMember: Combinator<CollectionEntry>;
  NestedPropertyDeclaration: Combinator<Declaration>;
  StaticImportRule: Combinator<ImportAtRule>;
  UseNamespace: Combinator<string>;
  UseRule: Combinator<StyleImport | ModuleImport>;
  ForwardTail: Combinator<Token | null>;
  ForwardRule: Combinator<StyleImport>;
  StaticImportUrl: Combinator<Url>;
  StaticImportLayer: Combinator<ValueNode>;
  StaticImportDeclaration: Combinator<ValueNode>;
  StaticImportSupports: Combinator<FunctionCall>;
  StaticImportQualifier: Combinator<ValueNode>;
  StaticImportMediaFeature: Combinator<ValueNode>;
  StaticImportMediaInParens: Combinator<ValueNode>;
  StaticImportMediaCondition: Combinator<ValueNode>;
  StaticImportMediaOnlyClause: Combinator<ValueNode>;
  StaticImportMediaClause: Combinator<ValueNode>;
  StaticImportMediaPrelude: Combinator<ValueNode>;
  StaticImportTail: Combinator<ValueNode>;
  MixinParameter: Combinator<Param>;
  MixinParameters: Combinator<Param[]>;
  MixinCallArgument: Combinator<ScssCallArg>;
  MixinCallRule: Combinator<MixinCall>;
  MixinDefinitionRule: Combinator<MixinDefinition>;
  EachVariableName: Combinator<string>;
  EachBinding: Combinator<ForBinding>;
  EachRule: Combinator<For>;
  ForRule: Combinator<For>;
  IfCondition: Combinator<GuardNode>;
  IfAnd: Combinator<GuardNode>;
  IfTerm: Combinator<GuardNode>;
  IfAtom: Combinator<GuardNode>;
  IfComparison: Combinator<GuardNode>;
  IfBody: Combinator<Statement[]>;
  IfStaticRule: Combinator<Ruleset>;
  IfStaticConditionalBlock: Combinator<AtRuleBlock>;
  IfRule: Combinator<If>;
  QueryFeature: Combinator<ValueNode>;
  QueryFunction: Combinator<FunctionCall>;
  QueryInParens: Combinator<ValueNode>;
  QueryCondition: Combinator<ValueNode>;
  QueryClause: Combinator<ValueNode>;
  QueryPreludeTail: Combinator<ValueNode>;
  QueryPrelude: Combinator<ValueNode>;
  SupportsAtom: Combinator<ValueNode>;
  SupportsGeneralTemplate: Combinator<Interpolation>;
  SupportsGeneralTemplateParen: Combinator<Interpolation>;
  SupportsGeneralTemplateSquare: Combinator<Interpolation>;
  SupportsGeneralTemplateBrace: Combinator<Interpolation>;
  SupportsGeneralTemplateDoubleQuoted: Combinator<Interpolation>;
  SupportsGeneralTemplateSingleQuoted: Combinator<Interpolation>;
  SupportsGeneralEnclosed: Combinator<GeneralEnclosed>;
  SupportsFeature: Combinator<ValueNode>;
  SupportsInParens: Combinator<ValueNode>;
  SupportsNotKeyword: Combinator<Keyword>;
  SupportsAndOrKeyword: Combinator<Keyword>;
  SupportsCondition: Combinator<ValueNode>;
  SupportsPrelude: Combinator<ValueNode>;
  StaticMediaPrelude: Combinator<ValueNode>;

  /** Static-only generic CSS header capture for known passthrough blocks. */
  StaticAtPrelude: Combinator<ValueNode | null>;
  StaticAtPreludeAtom: Combinator<Token>;
  StaticAtPreludeParen: Combinator<Token>;
  StaticAtPreludeSquare: Combinator<Token>;
  StaticAtPreludeDoubleQuoted: Combinator<Token>;
  StaticAtPreludeSingleQuoted: Combinator<Token>;
  AtRuleStatement: Combinator<AtRuleStatement>;
  AtRootPrelude: Combinator<ValueNode | null>;
  AtRootFilterPrelude: Combinator<ValueNode>;
  AtRootBlock: Combinator<AtRuleBlock>;
  AtRootFilter: Combinator<AtRuleBlock>;
  ScopeBlock: Combinator<AtRuleBlock>;
  NestedScopeBlock: Combinator<AtRuleBlock>;
  ConditionalBlock: Combinator<AtRuleBlock>;
  StartingStyleBlock: Combinator<AtRuleBlock>;
  LayerBlock: Combinator<AtRuleBlock>;

  /** Static `@document` / `@-moz-document` with a frame-one stylesheet body. */
  DocumentBlock: Combinator<AtRuleBlock>;
  PageMarginBox: Combinator<AtRuleBlock>;
  PageBlock: Combinator<AtRuleBlock>;
  FontFeatureValueBlock: Combinator<AtRuleBlock>;
  FontFeatureValuesBlock: Combinator<AtRuleBlock>;
  FontFace: Combinator<AtRuleBlock>;
  CounterStyle: Combinator<AtRuleBlock>;
  PropertyName: Combinator<Keyword>;
  PropertyAtRule: Combinator<AtRuleBlock>;
  KeyframeSelector: Combinator<SimpleSelector>;
  KeyframeBlock: Combinator<Ruleset>;
  Keyframes: Combinator<AtRuleBlock>;
  NestedConditionalBlock: Combinator<AtRuleBlock>;
  NestedStartingStyleBlock: Combinator<AtRuleBlock>;
  NestedLayerBlock: Combinator<AtRuleBlock>;
  Simple: Combinator<SimpleSelector>;
  InterpolatedSimple: Combinator<SimpleSelector>;
  Placeholder: Combinator<SimpleSelector>;
  Attribute: Combinator<SimpleSelector>;
  PseudoArgument: Combinator<string>;
  StaticSelectorPseudoArgument: Combinator<string>;
  StaticSelectorPseudoItem: Combinator<string>;
  StaticSelectorPseudoTail: Combinator<string>;
  StaticPseudoArgument: Combinator<string>;
  StaticPseudoGroup: Combinator<string>;
  StaticPseudoSquare: Combinator<string>;
  PseudoSelector: Combinator<SimpleToken>;
  NestingSelector: Combinator<SimpleSelector>;
  Compound: Combinator<SelectorTerm>;
  ComplexTail: Combinator<ScssComplexTail>;
  Complex: Combinator<SelectorBranch>;
  RelativeComplex: Combinator<SelectorBranch>;
  SelectorTail: Combinator<SelectorBranch>;
  Selector: Combinator<SelectorList>;
  NestedSelectorTail: Combinator<SelectorBranch>;
  NestedSelector: Combinator<SelectorList>;
  Extend: Combinator<ExtendInstruction>;
  OpaqueAtPrelude: Combinator<string | null>;
  OpaqueBody: Combinator<string>;
  OpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  OpaqueAtRuleStatement: Combinator<AtRuleStatement>;
  Ruleset: Combinator<Ruleset>;
  NestedRuleset: Combinator<Ruleset>;
  rw: Combinator<unknown>;
  whitespace: Combinator<unknown>;
};

type ScssInputRules =
  ScssRules
  & typeof cssSyntax
  & typeof cssPseudoSyntax
  & typeof opaqueAtRuleRecognition;

function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    throw new TypeError('SCSS grammar produced a non-token child.');
  }
  return { value: value.value };
}

function isToken(value: unknown): value is Token {
  return typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string';
}

function sourceText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null && 'src' in value && typeof value.src === 'string') {
    return value.src;
  }
  return requireToken(value).value;
}

/** Map query/media-prelude children to value nodes, coercing bare keyword tokens
 *  (`and`/`or`/media types) to `Keyword`s while passing structured values through. */
function keywordizeValues(children: readonly unknown[]): ValueNode[] {
  return children.map(child => isValue(child) ? child : keyword(requireToken(child).value));
}

/** Concatenate the authored spelling of every child. The canonical opaque
 *  representation for attribute selectors and non-structured pseudo arguments. */
function joinSourceText(children: readonly unknown[]): string {
  return children.map(sourceText).join('');
}

/** Concatenate every child token value into one opaque static-prelude token. */
function joinTokenValue(children: readonly unknown[]): Token {
  return { value: children.map(requireToken).map(token => token.value).join('') };
}

/** Shared reducer for a static `"…"` / `'…'` quoted value: the opening quote is
 * `children[0]`, the raw body is `children[1]`, and both the source spelling and
 * decoded body are preserved verbatim (never interpolation). */
function staticQuoted(children: readonly unknown[]): Quoted {
  const quote = requireToken(children[0]).value;
  const value = requireToken(children[1]).value;
  return quoted(
    `${quote}${value}${quote}`,
    value,
    quote,
    false
  );
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

function isUrl(value: unknown): value is Url {
  return typeof value === 'object'
    && value !== null
    && 'type' in value && value.type === 'Url'
    && 'value' in value && isValue(value.value);
}

function isSimpleSelector(value: unknown): value is SimpleSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'SimpleSelector'
    && 'text' in value && (typeof value.text === 'string' || value.text === null)
    && 'interp' in value && (isInterpolation(value.interp) || value.interp === null);
}

function isCompoundSelector(value: unknown): value is CompoundSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'CompoundSelector'
    && 'value' in value && Array.isArray(value.value)
    && value.value.every(isSimpleToken);
}

function isSelectorTerm(value: unknown): value is SelectorTerm {
  return isSimpleToken(value) || isCompoundSelector(value);
}

function isComplexSelector(value: unknown): value is ComplexSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'ComplexSelector'
    && 'value' in value && Array.isArray(value.value);
}

function isRelativeSelector(value: unknown): value is Extract<SelectorBranch, { readonly type: 'RelativeSelector' }> {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'RelativeSelector'
    && 'value' in value && Array.isArray(value.value);
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

function requireSelectorList(value: unknown): SelectorList {
  if (!isSelectorList(value)) {
    throw new TypeError('SCSS grammar produced a non-selector-list child.');
  }
  return value;
}

const selectorTermFromTokens = (tokens: readonly SimpleToken[]): SelectorTerm =>
  selectorTermOf([tokens[0]!, ...tokens.slice(1)]);

/*
 * A compound token is either a plain `SimpleSelector` or a structured
 * `PseudoSelector` (`:is(.a, .b)` etc.). The structured pseudo carries its
 * argument as a `SelectorList` in `args` and leaves `text` null; core
 * serialization owns the inline join.
 */
function isSimpleToken(value: unknown): value is SimpleToken {
  return isSimpleSelector(value)
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'PseudoSelector');
}

function isScssComplexTail(value: unknown): value is ScssComplexTail {
  return typeof value === 'object' && value !== null
    && 'combinator' in value && (value.combinator === ' ' || value.combinator === '>' || value.combinator === '+' || value.combinator === '~' || value.combinator === '||')
    && 'term' in value && isSelectorTerm(value.term);
}

function scssCombinatorText(value: unknown): ScssComplexTail['combinator'] {
  if (isToken(value) && (value.value === '>' || value.value === '+' || value.value === '~' || value.value === '||')) {
    return value.value;
  }
  return ' ';
}

function scssRelativeCombinator(value: unknown): '>' | '+' | '~' {
  const token = requireToken(value).value;
  if (token === '>' || token === '+') {
    return token;
  }
  return '~';
}

function branchSegments(branch: SelectorBranch): [{ combinator?: ScssSegmentCombinator; term: SelectorTerm }, ...Array<{ combinator?: ScssSegmentCombinator; term: SelectorTerm }>] {
  if (branch.type !== 'ComplexSelector' && branch.type !== 'RelativeSelector') {
    return [{ term: branch }];
  }
  const segments: Array<{ combinator?: ScssSegmentCombinator; term: SelectorTerm }> = [];
  let combinator: ScssSegmentCombinator = ' ';
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

function isImportTarget(value: unknown): value is Quoted | Url | Interpolation {
  return isQuoted(value) || isUrl(value) || isInterpolation(value);
}

function isParam(value: unknown): value is Param {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if ('name' in value && typeof value.name !== 'string') {
    return false;
  }
  if ('default' in value && !isValueSlotValue(value.default)) {
    return false;
  }
  if ('pattern' in value && !isValueSlotValue(value.pattern)) {
    return false;
  }
  return !('rest' in value) || typeof value.rest === 'boolean';
}

function isParamArray(value: unknown): value is Param[] {
  return Array.isArray(value) && value.every(isParam);
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
    throw new TypeError('SCSS grammar produced an invalid for binding.');
  }
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('SCSS grammar produced a non-string child.');
  }
  return value;
}

function isVarRef(value: unknown): value is VariableReference {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VariableReference'
    && 'name' in value
    && typeof value.name === 'string';
}

function isColor(value: unknown): value is Color {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Color'
    && 'src' in value
    && typeof value.src === 'string';
}

function isDimension(value: unknown): value is Dimension {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Dimension'
    && 'number' in value
    && typeof value.number === 'number'
    && 'unit' in value
    && typeof value.unit === 'string'
    && 'src' in value
    && typeof value.src === 'string';
}

function isFunctionCall(value: unknown): value is FunctionCall {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'FunctionCall'
    && 'name' in value
    && typeof value.name === 'string'
    && 'args' in value
    && Array.isArray(value.args);
}

function isInterpolation(value: unknown): value is Interpolation {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Interpolation'
    && 'parts' in value
    && Array.isArray(value.parts);
}

function requireInterpolation(value: unknown): Interpolation {
  if (!isInterpolation(value)) {
    throw new TypeError('SCSS grammar produced a non-interpolation child.');
  }
  return value;
}

function appendLiteral(parts: Interpolation['parts'], text: string): void {
  const previous = parts[parts.length - 1];
  if (previous !== undefined && 'lit' in previous) {
    parts[parts.length - 1] = { lit: previous.lit + text };
  } else {
    parts.push({ lit: text });
  }
}

/** Flatten a grammar-owned raw template without ever reparsing its bytes. */
function interpolationFromTemplateChildren(children: readonly unknown[]): Interpolation {
  const parts: Interpolation['parts'] = [];
  for (const child of children) {
    if (isInterpolation(child)) {
      for (const part of child.parts) {
        if ('lit' in part) {
          appendLiteral(
            parts,
            part.lit
          );
        } else {
          parts.push(part);
        }
      }
    } else {
      appendLiteral(
        parts,
        requireToken(child).value
      );
    }
  }
  return interpolation(parts);
}

/**
 * Turn the grammar-owned parts of a custom-property value into one canonical
 * value. Custom-property values are not evaluated: everything outside a typed
 * `#{…}` stays literal `<declaration-value>` text, so the reduction only joins
 * grammar children — it never rescans source. Nested balanced groups arrive as
 * nested arrays from the paren/square/curly productions.
 */
function customValueFromParts(children: readonly unknown[], parts: Interpolation['parts'], seen: { interpolated: boolean }): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      customValueFromParts(
        child,
        parts,
        seen
      );
    } else if (isInterpolation(child)) {
      seen.interpolated = true;
      for (const part of child.parts) {
        if ('lit' in part) {
          appendLiteral(
            parts,
            part.lit
          );
        } else {
          parts.push(part);
        }
      }
    } else {
      appendLiteral(
        parts,
        requireToken(child).value
      );
    }
  }
}

/** Reduce a whole custom-property value to `Interpolation` (when it carries a
 * `#{…}`) or to verbatim `Any` text. */
function customValue(children: readonly unknown[]): ValueNode {
  const parts: Interpolation['parts'] = [];
  const seen = { interpolated: false };
  customValueFromParts(
    children,
    parts,
    seen
  );
  if (seen.interpolated) {
    return interpolation(parts);
  }
  return any(parts.map(part => 'lit' in part ? part.lit : '').join(''));
}

/** Fold a grammar-produced left-associative operator chain. Precedence belongs
 * to the caller's product/sum production, never to a source-text recovery. */
function foldOperation(children: readonly unknown[]): ValueNode {
  const first = children.find(isValue);
  if (first === undefined) {
    throw new TypeError('SCSS arithmetic grammar produced no operand.');
  }
  let result = first;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 2) {
    const operatorToken = children[index];
    const right = children[index + 1];
    if (operatorToken === undefined || !isValue(right)) {
      throw new TypeError('SCSS arithmetic grammar lost an operator operand.');
    }
    result = operation(
      requireToken(operatorToken).value.trim(),
      result,
      right
    );
  }
  return result;
}

function isValue(value: unknown): value is ValueNode {
  /*
   * Dispatch on the node tag once instead of re-testing typeof/null/`type` in a
   * flat `||` chain: this predicate runs on essentially every value child via
   * `.find(isValue)`/`.filter(isValue)`. Each tag maps to exactly one shape
   * check, so the accepted set is identical to the former ordered disjunction.
   */
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  switch (value.type) {
    case 'Quoted':
      return isQuoted(value);
    case 'VariableReference':
      return isVarRef(value);
    case 'Color':
      return isColor(value);
    case 'Dimension':
      return isDimension(value);
    case 'FunctionCall':
      return isFunctionCall(value);
    case 'Interpolation':
      return isInterpolation(value);
    case 'GeneralEnclosed':
      return 'content' in value && isInterpolation(value.content);
    case 'Any':
      return 'src' in value && typeof value.src === 'string';
    case 'Url':
      return 'value' in value && isValue(value.value);
    case 'SpacedValue':
      return 'parts' in value && Array.isArray(value.parts);
    case 'List':
      return 'value' in value && Array.isArray(value.value);
    case 'Block':
      return 'value' in value && isValueSlotValue(value.value);
    case 'Operation':
      return 'left' in value && 'right' in value && isValue(value.left) && isValue(value.right);
    case 'Keyword':
      return 'src' in value && typeof value.src === 'string';
    case 'Collection':
      return 'entries' in value && Array.isArray(value.entries);
    case 'Reference':
      return 'base' in value && 'steps' in value && Array.isArray(value.steps);
    case 'AnonymousMixin':
      return 'rules' in value && Array.isArray(value.rules);
    default:
      return false;
  }
}

function valueSlot(value: ValueNode): ValueSlot {
  if (value.type === 'SpacedValue') {
    return value.parts;
  }
  if (value.type === 'Block' && isSpacedValue(value.value)) {
    return { ...value, value: value.value.parts };
  }
  return value;
}

function isSpacedValue(value: ValueSlot): value is Extract<ValueNode, { type: 'SpacedValue' }> {
  return isValue(value) && value.type === 'SpacedValue';
}

function isValueSlotValue(value: unknown): value is ValueSlot {
  return Array.isArray(value) ? value.every(isValueSlotValue) : isValue(value);
}

function requireValueSlot(value: unknown): ValueSlot {
  return Array.isArray(value) ? value as ValueSlot : valueSlot(requireValue(value));
}

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && (typeof value.name === 'string' || isInterpolation(value.name))
    && 'value' in value
    && isValueSlotValue(value.value);
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
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'For';
}

function isIf(value: unknown): value is If {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'If';
}

function isAtRuleBlock(value: unknown): value is AtRuleBlock {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'AtRuleBlock';
}

function isAtRuleStatement(value: unknown): value is AtRuleStatement {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'AtRuleStatement';
}

function isComment(value: unknown): value is Comment {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Comment';
}
function isImport(value: unknown): value is ImportAtRule {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'ImportAtRule';
}
function isStyleImport(value: unknown): value is StyleImport {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'StyleImport';
}
function isModuleImport(value: unknown): value is ModuleImport {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'ModuleImport';
}

function isExtendInstruction(value: unknown): value is ExtendInstruction {
  return typeof value === 'object' && value !== null
    && 'target' in value && value.target !== null && typeof value.target === 'object'
    && 'type' in value.target && value.target.type === 'SelectorList'
    && 'partial' in value && typeof value.partial === 'boolean';
}

function requireValue(value: unknown): ValueNode {
  if (!isValue(value)) {
    throw new TypeError('SCSS grammar produced a non-value child.');
  }
  return value;
}

function requireKeyword(value: unknown): Keyword {
  const node = requireValue(value);
  if (node.type !== 'Keyword') {
    throw new TypeError('SCSS grammar produced a non-keyword child.');
  }
  return node;
}

/** The best-effort authored spelling of a value node for a Reference `raw`. */
function referenceKeyRaw(node: ValueNode): string {
  if (node.type === 'VariableReference') {
    return `$${node.name}`;
  }
  if (node.type === 'Quoted') {
    return node.src;
  }
  return 'src' in node && typeof node.src === 'string' ? node.src : '';
}

/** Lower `map-get($m, k)` to the shared `$[…]` accessor read `$m[k]`: a Reference
 *  whose single BracketLookup step carries the key. A `$var` key selects the
 *  variable-namespace lookup; every other key is a value-equality member lookup
 *  (map keys compare by value, never by position, so `index` is never used). */
function lowerMapGet(base: ValueNode, key: ValueNode): Reference {
  const step: ReferenceStep = key.type === 'VariableReference'
    ? { type: 'BracketLookup', key, keyKind: 'var' }
    : { type: 'BracketLookup', key, keyKind: 'member' };
  const baseRaw = base.type === 'Reference' ? base.raw : referenceKeyRaw(base);
  return reference(
    base,
    [step],
    `${baseRaw}[${referenceKeyRaw(key)}]`
  );
}

function reduceScssCall(name: string, children: readonly unknown[], minArgumentIndex: number): FunctionCall | Reference {
  const lastIndex = children.length - 1;
  const firstIndex = children.findIndex((child, index) => index > minArgumentIndex && index < lastIndex && isValueSlotValue(child));
  if (firstIndex === -1) {
    return funcCall(
      name,
      []
    );
  }
  const first = requireValueSlot(children[firstIndex]);
  const args: ValueSlot[] = [first];
  const separators: string[] = [];
  for (let index = firstIndex + 1; index < lastIndex; index += 1) {
    const child = children[index];
    if (!isScssValuePair(child)) {
      continue;
    }
    separators.push(String(child.separator));
    args.push(requireValueSlot(child.value));
  }
  const call = funcCall(
    name,
    args
  );
  if (call.name === 'map-get' && args.length === 2 && isValue(args[0]) && isValue(args[1])) {
    return lowerMapGet(
      args[0],
      args[1]
    );
  }
  if (separators.length === args.length - 1) {
    withValueLayout(
      call.args,
      separators
    );
  }
  return call;
}

/** A Sass map key stays an authored value node; equality belongs to value-domain
 * map comparison, not to declaration-name stringification. */
function mapKeyValue(node: ValueNode): ValueSlot {
  return valueSlot(node);
}

function isGuardNode(value: unknown): value is GuardNode {
  if (typeof value !== 'object' || value === null || !('g' in value)) {
    return false;
  }
  switch (value.g) {
    case 'default':
      return true;
    case 'truth':
      return 'value' in value && isValue(value.value);
    case 'cmp':
      return 'op' in value && typeof value.op === 'string'
        && 'left' in value && isValue(value.left)
        && 'right' in value && isValue(value.right);
    case 'call':
      return 'name' in value && typeof value.name === 'string'
        && 'args' in value && Array.isArray(value.args) && value.args.every(isValue);
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
    throw new TypeError('SCSS grammar produced a non-guard child.');
  }
  return value;
}

function optionalValue(value: unknown): ValueNode | null {
  return value === null || value === undefined ? null : requireValue(value);
}

function isScssValuePair(value: unknown): value is ScssValuePair {
  return typeof value === 'object'
    && value !== null
    && 'separator' in value
    && typeof value.separator === 'string'
    && 'value' in value
    && isValueSlotValue(value.value);
}

function isScssValueTail(value: unknown): value is ScssValueTail {
  return typeof value === 'object'
    && value !== null
    && 'kind' in value
    && (value.kind === 'space' || value.kind === 'slash')
    && 'value' in value
    && isValue(value.value)
    && 'separator' in value
    && typeof value.separator === 'string';
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
 * The single statement-membership predicate behind both body reducers:
 * `statements` throws on the first non-statement child, `statementChildren`
 * silently keeps only the statement children. `allowDeclarations` admits a
 * `Declaration` in declaration-capable bodies.
 */
function isStatementChild(child: unknown, allowDeclarations: boolean): child is Statement {
  return isComment(child)
    || isImport(child)
    || isStyleImport(child)
    || isModuleImport(child)
    || isAtRuleBlock(child)
    || isAtRuleStatement(child)
    || isVarDeclaration(child)
    || isMixinDefinition(child)
    || isMixinCall(child)
    || isFor(child)
    || isIf(child)
    || isRuleset(child)
    || isOpaqueAtRuleBlock(child)
    || (allowDeclarations && isDeclaration(child));
}

function isOpaqueAtRuleBlock(value: unknown): value is OpaqueAtRuleBlock {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'OpaqueAtRuleBlock';
}

function statements(children: readonly unknown[], allowDeclarations = false): Statement[] {
  const result: Statement[] = [];
  for (const child of children) {
    if (!isStatementChild(
      child,
      allowDeclarations
    )) {
      throw new TypeError('SCSS grammar produced a non-statement child.');
    }
    result.push(child);
  }
  return result;
}

function statementChildren(children: readonly unknown[], allowDeclarations = false): Statement[] {
  const result: Statement[] = [];
  for (const child of children) {
    if (isStatementChild(
      child,
      allowDeclarations
    )) {
      result.push(child);
    }
  }
  return result;
}

function requireStatementList(value: unknown): Statement[] {
  if (!Array.isArray(value)) {
    throw new TypeError('SCSS grammar produced a non-statement list.');
  }
  return statements(
    value,
    true
  );
}

function keyframeSelectorListFromChildren(children: readonly unknown[]): SelectorList {
  const selectors = children
    .filter((child): child is SimpleSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'SimpleSelector');
  if (selectors.length === 0) {
    throw new TypeError('SCSS keyframe block requires a selector.');
  }
  return selist(...selectors);
}

function scssPseudoName(opener: string): string {
  return opener.slice(-1) === '(' ? opener.slice(0, -1) : opener;
}

/*
 * Sass `//` comments are trivia, not CSS comments: they must be recognized
 * between host-mode AST facts but must never become a renderable `Comment` node,
 * because `//` is silent in Sass and is not valid CSS. Same shape as Less.
 * URL bodies and quoted strings run under `noTrivia`, so `url(//host/path)`
 * stays URL content and `"//u"` stays string content.
 */
const whitespace = trivia(oneOrMore(choice(
  regex(/[ \t\n\r\f]+/),
  regex(/\/\/[^\n\r]*/)
)));

/*
 * These productions run under `noTrivia`: each operator owns the precise
 * whitespace that Sass uses to distinguish arithmetic from a space list.
 * A whitespace-before, no-whitespace-after minus (`1 -2`) remains a list whose
 * second item is the signed dimension, matching Dart Sass's current syntax.
 */
const productOperator = regex(/[ \t\n\r\f]*[*/%][ \t\n\r\f]*/);
const topProductOperator = regex(/[ \t\n\r\f]*[*%][ \t\n\r\f]*/);
const sumOperator = regex(/(?:\+[ \t\n\r\f]*|-[ \t\n\r\f]*|[ \t\n\r\f]+\+[ \t\n\r\f]*|[ \t\n\r\f]+-[ \t\n\r\f]+)/);
const space = regex(/[ \t\n\r\f]+/);
const valueTrivia = regex(/(?:[ \t\n\r\f]+|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);
const keyframeEndpoint = regex(/(?:from|to)(?![-_a-zA-Z0-9\u0080-\uffff])/i);

/*
 * Keep the static SCSS slice aligned with the shared CSS keyframe-selector
 * shape: signed percentages and a trailing decimal point are valid selectors.
 */
const keyframePercent = regex(/[-+]?(?:\d+\.?\d*|\.\d+)%/);

/*
 * The AST counterpart of the CST grammar's `InterpolatedSelector`: static
 * identifier chunks and structural `#{…}` atoms only. Attribute, pseudo, and
 * namespace interpolation each need a different AST shape and stay outside
 * this simple-token fact.
 */
const selectorTextRun = regex(/[-_a-zA-Z0-9]+/);

/*
 * General-enclosed retains its body as an interpolation template. Delimiters
 * recurse below; this leaf owns every other byte without a source reparse.
 */
const generalTemplateText = regex(/(?:[^#()\[\]{}'"\\]|\\[\s\S]|#(?!\{))+/);

/*
 * Grammar-local copies of the leading pseudo-colon, hex-color and number
 * recognizers (byte-identical to the shared CssSyntaxPseudoColon /
 * CssSyntaxHexColor / CssSyntaxNumber). Leading a choice arm with a
 * cross-composition `g.CssSyntax*` reference leaves that arm's first-set
 * unresolved (`any`) across the composeLeaf artifact boundary, so the compiler
 * enters the PseudoSelector / Color / Dimension node frame SPECULATIVELY at every simple
 * selector and value atom. A grammar-local leading recognizer lets the compiler
 * resolve the arm's first-set (`:`, `#`, a digit/sign) and first-char-gate it,
 * skipping the doomed frame entirely.
 */
const pseudoColon = regex(/::?(?![ \t\n\r\f])/);
const hexColor = regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);
const numberValue = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);

/*
 * Grammar-local block/line comment recognizers (byte-identical to the shared
 * CssSyntaxBlockComment / ScssSyntaxLineComment). Both open on `/`, so a
 * local copy lets the statement-comment arm resolve its first-set to `/` and be
 * first-char-gated in the body-prefix choice instead of entering the comment
 * node frame speculatively at every rule/at-statement position.
 */
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const lineComment = regex(/\/\/[^\n\r]*/);

/*
 * Opaque quoted-string skippers for the grammar-level ambient `scanSkip`: a scan
 * with no per-call skip treats a string as one atomic unit, so a sentinel hidden
 * inside it (an arg terminator, `with(`, etc.) is never matched. Consumes
 * quote-to-quote including escapes; used only as a scan hole (builds nothing).
 */
const scssScanSkipDoubleString = noTrivia(sequence(
  literal('"'),
  regex(/(?:[^"\\]|\\.)*/),
  literal('"')
));
const scssScanSkipSingleString = noTrivia(sequence(
  literal('\''),
  regex(/(?:[^'\\]|\\.)*/),
  literal('\'')
));

/*
 * Grammar-local CSS bubbling-at-rule keyword recognizers (byte-identical to the
 * shared CssSyntax*AtKeyword leaves). Every nested at-statement arm must have
 * a resolvable first-set for the whole `@`-cluster choice to first-char-gate: the
 * mixin/control-flow arms already lead with local `@…` regexes, so spelling these
 * CSS block keywords locally too resolves the cluster's first-set to `@` and lets
 * the compiler skip the entire cluster on any non-`@` statement (ordinary rules,
 * and every block-close where the cluster is otherwise entered speculatively).
 */
const supportsAtKeyword = regex(/@supports(?![-\w])/i);
const mediaAtKeyword = regex(/@media(?![-\w])/i);
const containerAtKeyword = regex(/@container(?![-\w])/i);
const startingStyleAtKeyword = regex(/@starting-style(?![-\w])/i);
const layerAtKeyword = regex(/@layer(?![-\w])/i);
const scopeAtKeyword = regex(/@scope(?![-\w])/i);
const atRootAtKeyword = regex(/@at-root(?![-\w])/i);
const documentAtKeyword = regex(/@(?:-moz-)?document(?![-\w])/i);
const pageAtKeyword = regex(/@page(?![-\w])/i);
const fontFeatureValuesAtKeyword = regex(/@font-feature-values(?![-\w])/i);

/*
 * An at-rule this grammar has no typed production for is still well-formed CSS:
 * which at-rules exist is a language-service fact, not a parse decision, so an
 * unknown block (`@view-transition`, `@position-try`, anything newer than this
 * grammar) is captured opaquely instead of failing the whole stylesheet. The
 * exclusion list is dispatch, not vocabulary: every name here HAS a typed
 * production above, and a malformed one must report its own error rather than
 * silently degrade to opaque bytes. Sass's evaluated directives are excluded for
 * the same reason — `@debug`/`@warn`/`@error`/`@else`/`@while`/`@at-root`/
 * `@content` are not CSS output and must never be emitted verbatim. The `@-…`
 * compiler namespace (`@-use`/`@-compose`/`@-export`/`@-import`/`@-from`, what
 * SCSS module directives LOWER to) is excluded for the same reason, while a
 * vendor prefix (`@-webkit-anything`) stays ordinary unknown CSS.
 */
const scssGenericAtRuleName = regex(/@(?!(?:use|forward|import|mixin|include|function|return|if|else|each|for|while|extend|at-root|content|debug|warn|error|charset|namespace|media|container|supports|starting-style|page|scope|font-face|counter-style|property|font-feature-values|layer|-moz-document|document|-use|-compose|-export|-import|-from|(?:-[a-z]+-)?keyframes)(?![-_a-zA-Z0-9\u0080-\uFFFF]))-?[_a-zA-Z\u0080-\uFFFF][-_a-zA-Z0-9\u0080-\uFFFF]*/i);

/*
 * Grammar-local property-name recognizer (byte-identical to CssSyntaxProperty).
 * Declaration and NestedPropertyDeclaration lead their arm with a `choice(interpolated
 * property, property)`; spelling the plain property locally resolves that arm's
 * first-set to the property opener class (`*`, `-`, an identifier char) so the
 * declaration arms first-char-gate — an ordinary rule (`.x`, `&…`) or block-close
 * no longer enters and rolls back the declaration/nested-property node frames.
 */
const propertyName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);

export const scssFactory = (g: ScssInputRules) => {
  const caseInsensitive = makeWhen({ caseInsensitive: true });

  /*
   * SCSS owns the token after its `$` sigil. The shared CSS keyword leaf is
   * valid for closed value facts, but admits CSS escapes that SCSS variables do
   * not: `scssVar` in the production grammar is deliberately unescaped.
   * A closed static value must not split an unsupported escaped `$` reference
   * into a valid short reference plus a following keyword in a space sequence.
   * The legacy scanner accepts no backslash in this token either; the boundary
   * makes that rejection atomic in this host-mode grammar.
   */
  const scssVarName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?![-_a-zA-Z0-9\u0080-\uffff\\])/);

  /*
   * The `$name` sigil + identifier pair. As a nested sequence it flattens its
   * two tokens (`$`, name) into the enclosing sequence's children, so every
   * reducer that reads the name at `children[1]` is unaffected.
   */
  const scssVarSigilName = sequence(
    literal('$'),
    scssVarName
  );

  /*
   * Static chunks stop at a real `#{` opener; the structural interpolation
   * production below owns that form. Ordinary `#foo` stays literal text and
   * escapes remain grammar-recognized.
   */
  const doubleQuotedText = regex(/(?:[^"\\#]|\\[\s\S]|#(?!\{))*/);
  const singleQuotedText = regex(/(?:[^'\\#]|\\[\s\S]|#(?!\{))*/);
  const VariableReference = node<VariableReference>(
    'VariableReference',
    scssVarSigilName,
    children => variableReference(
      requireToken(children[1]).value,
      'live'
    )
  );
  const SassInterpolation = node<Interpolation>(
    'SassInterpolation',
    sequence(
      literal('#{'),
      g.Value,
      literal('}')
    ),
    children => interpolation([{ ref: requireValue(children[1]), unquote: true }])
  );
  const Quoted = node<Quoted | Interpolation>(
    'Quoted',
    choice(
      sequence(
        literal('"'),
        doubleQuotedText,
        literal('"')
      ),
      sequence(
        literal('\''),
        singleQuotedText,
        literal('\'')
      ),
      sequence(
        literal('"'),
        many(choice(
          g.SassInterpolation,
          regex(/(?:[^"\\#]|\\[\s\S]|#(?!\{))+/)
        )),
        literal('"')
      ),
      sequence(
        literal('\''),
        many(choice(
          g.SassInterpolation,
          regex(/(?:[^'\\#]|\\[\s\S]|#(?!\{))+/)
        )),
        literal('\'')
      )
    ),
    (children) => {
      const quote = requireToken(children[0]).value;
      if (children.length === 3 && !isInterpolation(children[1])) {
        return staticQuoted(children);
      }
      const parts: Interpolation['parts'] = [{ lit: quote }];
      for (const child of children.slice(
        1,
        -1
      )) {
        if (isInterpolation(child)) {
          parts.push(...child.parts);
        } else {
          appendLiteral(
            parts,
            requireToken(child).value
          );
        }
      }
      appendLiteral(
        parts,
        quote
      );
      return interpolation(parts);
    }
  );

  /*
   * Module directives are classified from their literal authored path. They
   * deliberately use this interpolation-free quoted production: a dynamic path
   * or escape-bearing path has no decoded parser-time target class and must not
   * be guessed or resolved here.
   */
  const staticDoubleQuotedPath = regex(/(?:[^"\\#]|#(?!\{))*/);
  const staticSingleQuotedPath = regex(/(?:[^'\\#]|#(?!\{))*/);

  /*
   * `noTrivia`: a module path is literal bytes, so the ambient `//` trivia arm
   * must not reach inside the quotes and swallow `@use "//host/lib"` as a line
   * comment. Both arms are closed regex/literal, so disabling trivia here
   * cannot propagate into a shared rule.
   */
  const StaticQuoted = node<Quoted>(
    'StaticQuoted',
    choice(
      noTrivia(sequence(
        literal('"'),
        staticDoubleQuotedPath,
        literal('"')
      )),
      noTrivia(sequence(
        literal('\''),
        staticSingleQuotedPath,
        literal('\'')
      ))
    ),
    staticQuoted
  );

  /*
   * Static values retain escapes, unlike module paths (whose classification
   * deliberately rejects them). A real `#{` opener remains outside this fact
   * so a supports condition can never flatten interpolation into a Quoted node.
   * `noTrivia` for the same reason as the module-path fact above: a supports
   * condition's string is literal bytes, not a place the `//` trivia arm may
   * reach. Closed regex/literal arms, so nothing shared is affected.
   */
  const StaticValueQuoted = node<Quoted>(
    'StaticValueQuoted',
    choice(
      noTrivia(sequence(
        literal('"'),
        doubleQuotedText,
        literal('"')
      )),
      noTrivia(sequence(
        literal('\''),
        singleQuotedText,
        literal('\'')
      ))
    ),
    staticQuoted
  );

  /*
   * Only a block comment is CSS output. A `//` line comment is lexical trivia
   * (see `whitespace`) and is dropped, matching Sass and Less.
   */
  const Comment = node<Comment>(
    'Comment',
    blockComment,
    (children, _fields, span) => withSourceSpan(
      comment(requireToken(children[0]).value),
      span
    )
  );
  const Keyword = node<Keyword>(
    'Keyword',
    g.CssSyntaxKeyword,
    children => keyword(requireToken(children[0]).value)
  );
  const CustomPropertyValue = node<Keyword>(
    'CustomPropertyValue',
    g.CssSyntaxCustomProperty,
    children => keyword(requireToken(children[0]).value)
  );
  const Color = node<Color>(
    'Color',
    hexColor,
    children => color(requireToken(children[0]).value)
  );

  /*
   * A `<urange>` is one opaque CSS token, so it must be recognized before the
   * keyword atom: `U+0-7F` split at the `+` leaves `+0`/`-7F` to be folded as
   * SCSS arithmetic, which serializes valid CSS back out as `U + 0 - 7F`.
   */
  const UnicodeRange = node<ValueNode>(
    'UnicodeRange',
    g.CssSyntaxUnicodeRange,
    children => any(requireToken(children[0]).value)
  );
  const Dimension = node<Dimension>(
    'Dimension',
    noTrivia(sequence(
      numberValue,
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

  /*
   * The legacy URL lexical body permits ordinary `#` bytes, but an interpolation
   * opener has its own typed SCSS production. This closed static branch must not
   * flatten it into `Any`, so `#{` is excluded by grammar rather than a post-parse
   * inspection.
   */
  const staticUrlInner = regex(/(?:[^\"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F#]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])|#(?!\{))+/);

  /*
   * URL chunks reserve a real interpolation opener for the structural branch,
   * while retaining CSS URL escaping and ordinary `#` bytes as literal text.
   */
  const interpolatedUrlChunk = regex(/(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F#]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])|#(?!\{))+/);
  const InterpolatedUrlValue = node<Interpolation>(
    'InterpolatedUrlValue',
    sequence(
      optional(interpolatedUrlChunk),
      g.SassInterpolation,
      many(choice(
        interpolatedUrlChunk,
        g.SassInterpolation
      ))
    ),
    children => interpolation(children.flatMap(child => isInterpolation(child)
      ? child.parts
      : [{ lit: requireToken(child).value }]))
  );

  /*
   * Interpolation-LED value leaf: an interpolation at the value start, then any
   * mix of identifier chunks and further interpolations (`#{$x}foo#{$y}`). The
   * identifier-LED spelling (`foo#{$x}bar`) and the plain keyword are both owned
   * by the merged `KeywordOrInterpolatedValue` terminal below, so this
   * production never speculatively scans a leading identifier for an ordinary
   * keyword value and then backtracks. Because it requires `#{` first, it also
   * cannot capture a `--name#{...}` token, which the old leading-identifier arm
   * had to exclude with a dedicated `not(--\u2026#{)` guard.
   */
  const InterpolatedValue = node<Interpolation>(
    'InterpolatedValue',
    sequence(
      g.SassInterpolation,
      many(choice(
        regex(/[-_a-zA-Z0-9\u0080-\uffff]+/),
        g.SassInterpolation
      ))
    ),
    children => interpolation(children.flatMap(child => isInterpolation(child)
      ? child.parts
      : [{ lit: requireToken(child).value }]))
  );

  /*
   * A parenthesized SCSS value can either enforce arithmetic precedence or hold
   * an ordinary list. Try the fully structured arithmetic form first; the list
   * branch is deliberately separate so `(1 2)` stays a paren Block around a list
   * rather than being invented as math.
   */
  const Paren = node<ValueNode>(
    'Paren',
    choice(
      noTrivia(sequence(
        literal('('),
        g.MathSum,
        literal(')')
      )),
      noTrivia(sequence(
        literal('('),
        g.Value,
        literal(')')
      ))
    ),
    children => block(requireValueSlot(children[1]))
  );

  /*
   * Sass bracketed lists carry the square delimiter as a first-class Block fact;
   * the inner value uses the same separator-aware list grammar as ordinary values.
   */
  const Square = node<ValueNode>(
    'Square',
    noTrivia(sequence(
      literal('['),
      g.Value,
      literal(']')
    )),
    children => block(
      requireValue(children[1]),
      'square'
    )
  );

  /*
   * A Sass map entry `key: value`. The key is a single arithmetic term (an
   * identifier, string, number, or `#{…}`); the value is an ordinary value term
   * (a space/slash list, never a comma list — commas separate entries). It lowers
   * to a typed Collection entry, preserving the authored key value node.
   */
  const MapEntry = node<CollectionEntry>(
    'MapEntry',
    noTrivia(sequence(
      g.MathTopSum,
      optional(valueTrivia),
      literal(':'),
      optional(valueTrivia),
      g.ValueTerm
    )),
    children => collectionEntry(
      mapKeyValue(requireValue(children[0])),
      requireValueSlot(children[children.length - 1])
    )
  );

  /*
   * A Sass map literal `(a: 1, b: 2)` lowers to the shared `Collection` (the same
   * key/value-entries node used for SCSS nested properties), disambiguated from a
   * paren value-list `(1 2 3)` by the `key: value` entry shape. Empty `()` and a
   * single `(a: 1)` are both maps. This arm sits before `Paren` in the
   * value-atom choice; when no entry carries a colon it backtracks to the paren
   * list/arithmetic form.
   */
  const Map = node<Collection>(
    'Map',
    choice(
      noTrivia(sequence(
        literal('('),
        optional(valueTrivia),
        g.MapEntry,
        many(noTrivia(sequence(
          optional(valueTrivia),
          literal(','),
          optional(valueTrivia),
          g.MapEntry
        ))),
        optional(noTrivia(sequence(
          optional(valueTrivia),
          literal(',')
        ))),
        optional(valueTrivia),
        literal(')')
      )),
      noTrivia(sequence(
        literal('('),
        optional(valueTrivia),
        literal(')')
      ))
    ),
    children => collection(children.filter(isCollectionEntry))
  );

  /*
     * Identifier/function values share the same glued opener. Parse it once, then
     * route the owned token to the dedicated URL, generic function, or keyword /
     * identifier-led interpolation branch without reparsing the identifier.
     */
  const identOrFunction = token(noTrivia(sequence(
    g.CssSyntaxKeyword,
    optional(literal('('))
  )));
  const UrlFunction = node<ValueNode>(
    'Url',
    sequence(
      routed(),
      optional(choice(
        g.Quoted,
        g.InterpolatedUrlValue,
        staticUrlInner
      )),
      literal(')')
    ),
    (children) => {
      if (children.length === 2) {
        if (requireToken(children[0]).value.toLowerCase() !== 'url(' || requireToken(children[1]).value !== ')') {
          throw new TypeError('SCSS URL produced unexpected children.');
        }
        return url(any(''));
      }
      if (children.length !== 3 || requireToken(children[0]).value.toLowerCase() !== 'url(' || requireToken(children[2]).value !== ')') {
        throw new TypeError('SCSS URL produced unexpected children.');
      }
      const body = children[1];
      return url(isValue(body) ? body : any(requireToken(body).value));
    }
  );
  const Call = node<FunctionCall | Reference>(
    'Call',
    sequence(
      routed(),
      optional(valueTrivia),
      optional(sequence(
        g.ValueTerm,
        many(g.ValuePair)
      )),
      optional(valueTrivia),
      literal(')')
    ),
    children => reduceScssCall(requireToken(children[0]).value.slice(0, -1), children, 0)
  );
  const KeywordOrInterpolatedValue = node<ValueNode>(
    'KeywordOrInterpolatedValue',
    sequence(
      routed(),
      many(choice(
        regex(/[-_a-zA-Z0-9\u0080-\uffff]+/),
        g.SassInterpolation
      ))
    ),
    (children) => {
      if (children.some(isInterpolation)) {
        return interpolation(children.flatMap(child => isInterpolation(child)
          ? child.parts
          : [{ lit: requireToken(child).value }]));
      }
      return keyword(children.map(child => requireToken(child).value).join(''));
    }
  );
  const IdentifierOrFunction = dispatch(
    identOrFunction,
    caseInsensitive('url(', UrlFunction),
    when(endsWith('('), Call),
    otherwise(KeywordOrInterpolatedValue)
  );

  /*
   * A bare `#{…}` is already owned by `InterpolatedValue`: its
   * trailing `many` matches zero chunks, so an interpolation with no following
   * identifier reduces to the identical `Interpolation` value. A standalone
   * `SassInterpolation` arm after it is therefore unreachable.
   */
  const ValueAtom = node<ValueNode>(
    'ValueAtom',
    choice(
      g.Quoted,
      g.InterpolatedValue,
      g.VariableReference,
      g.Color,
      g.Dimension,
      g.CustomPropertyValue,
      g.UnicodeRange,
      IdentifierOrFunction,
      g.Map,
      g.Paren,
      g.Square
    ),
    children => requireValue(children[0])
  );

  /*
   * Signed numerics are one Dimension leaf. Unary signs only own a variable or
   * paren operand here, so `-2px` does not acquire an unnecessary Operation.
   * The sign may have trailing whitespace (`- $x`, `+ ($x)`), but it must be
   * at the current expression start: `1 -2` is still a space-list boundary.
   */
  const MathUnary = node<ValueNode>(
    'MathUnary',
    choice(
      noTrivia(sequence(
        regex(/-(?=[ \t\n\r\f]*[\$(])/),
        optional(space),
        g.ValueAtom
      )),
      noTrivia(sequence(
        regex(/\+(?=[ \t\n\r\f]*[\$(])/),
        optional(space),
        g.ValueAtom
      )),
      g.ValueAtom
    ),
    (children) => {
      if (children.length === 1) {
        return requireValue(children[0]);
      }
      const sign = requireToken(children[0]).value;
      const value = requireValue(children[children.length - 1]);
      return sign === '-'
        ? operation(
            '*',
            dimension(
              -1,
              '',
              '-1'
            ),
            value
          )
        : value;
    }
  );

  /*
   * Parenthesized SCSS arithmetic has the normal product-before-sum precedence,
   * including slash division. At top level slash remains a Sass slash-list
   * separator, so the top-level product intentionally excludes it below.
   */
  const MathProduct = node<ValueNode>(
    'MathProduct',
    noTrivia(sequence(
      g.MathUnary,
      many(sequence(
        productOperator,
        g.MathUnary
      ))
    )),
    foldOperation
  );
  const MathSum = node<ValueNode>(
    'MathSum',
    noTrivia(sequence(
      g.MathProduct,
      many(sequence(
        sumOperator,
        g.MathProduct
      ))
    )),
    foldOperation
  );
  const MathTopProduct = node<ValueNode>(
    'MathTopProduct',
    noTrivia(sequence(
      g.MathUnary,
      many(sequence(
        topProductOperator,
        g.MathUnary
      ))
    )),
    foldOperation
  );
  const MathTopSum = node<ValueNode>(
    'MathTopSum',
    noTrivia(sequence(
      g.MathTopProduct,
      many(sequence(
        sumOperator,
        g.MathTopProduct
      ))
    )),
    foldOperation
  );
  const ValueTail = node<ScssValueTail>(
    'ValueTail',
    choice(
      sequence(
        valueTrivia,
        g.MathTopSum
      ),
      sequence(
        optional(space),
        literal('/'),
        optional(space),
        g.MathTopSum
      )
    ),
    (children) => {
      if (isValue(children[1])) {
        return { kind: 'space', value: children[1], separator: isToken(children[0]) ? children[0].value : ' ' };
      }
      const value = children[children.length - 1];
      if (!isValue(value)) {
        throw new TypeError('SCSS slash list lost its value.');
      }
      const separators = children.filter(isToken).map(child => child.value).filter(text => text !== '/');
      return { kind: 'slash', value, separator: `${separators[0] ?? ''}/${separators[1] ?? ''}` };
    }
  );
  const ValueTerm = node<ValueSlot>(
    'ValueTerm',
    noTrivia(sequence(
      g.MathTopSum,
      many(ValueTail)
    )),
    (children) => {
      const groups: ValueNode[][] = [[requireValue(children[0])]];
      const groupSeparators: string[][] = [[]];
      for (const child of children.slice(1)) {
        if (!isScssValueTail(child)) {
          throw new TypeError('SCSS value term produced an invalid list boundary.');
        }
        if (child.kind === 'slash') {
          groups.push([child.value]);
          groupSeparators.push([]);
        } else {
          groups.at(-1)!.push(child.value);
          groupSeparators.at(-1)!.push(child.separator);
        }
      }
      const values = groups.map((group, index) => group.length === 1
        ? group[0]!
        : withValueLayout(
            group,
            groupSeparators[index]!
          ));
      return groups.length === 1
        ? values[0]!
        : list(
            values,
            '/'
          );
    }
  );
  const ValuePair = node<ScssValuePair>(
    'ValuePair',
    noTrivia(sequence(
      literal(','),
      optional(valueTrivia),
      g.ValueTerm
    )),
    (children) => {
      if (children.length !== 2 && children.length !== 3) {
        throw new TypeError('ValuePair produced unexpected children.');
      }
      if (requireToken(children[0]).value !== ',') {
        throw new TypeError('ValuePair lost its comma.');
      }
      const separator = children.length === 3
        ? `,${requireToken(children[1]).value}`
        : ',';
      return { separator, value: requireValueSlot(children[children.length - 1]) };
    }
  );
  const Value = node<ValueSlot>(
    'Value',
    sequence(
      g.ValueTerm,
      many(g.ValuePair)
    ),
    (children) => {
      const first = requireValueSlot(children[0]);
      if (children.length === 1) {
        return first;
      }
      const pairs: ScssValuePair[] = [];
      for (let index = 1; index < children.length; index += 1) {
        const child = children[index];
        if (!isScssValuePair(child)) {
          throw new TypeError('SCSS value produced a non-list child.');
        }
        pairs.push(child);
      }
      const result = list(
        [first, ...pairs.map(pair => pair.value)],
        ','
      );
      return withValueLayout(
        result,
        pairs.map(pair => pair.separator)
      );
    }
  );
  const VariableDeclaration = node<VariableDeclaration>(
    'VariableDeclaration',
    sequence(
      scssVarSigilName,
      literal(':'),
      g.Value,
      optional(choice(
        literal('!default'),
        literal('!global')
      )),
      optional(literal(';'))
    ),
    (children) => {
      const modifier = children.find((child): child is { readonly value: string } =>
        typeof child === 'object' && child !== null && 'value' in child
        && typeof child.value === 'string'
        && (child.value === '!default' || child.value === '!global'));
      const write = modifier?.value === '!default'
        ? { mode: 'if-absent' as const, lookup: 'scoped' as const }
        : modifier?.value === '!global'
          ? { mode: 'reassign' as const, lookup: 'scoped' as const }
          : { mode: 'declare' as const };
      return variableDeclaration(
        requireToken(children[1]).value,
        requireValueSlot(children[3]),
        write
      );
    }
  );
  const Important = node<true>(
    'Important',
    sequence(
      literal('!'),
      g.CssSyntaxImportant
    ),
    (children) => {
      if (children.length !== 2 || requireToken(children[0]).value !== '!') {
        throw new TypeError('Important produced unexpected children.');
      }
      return true;
    }
  );

  /*
   * Declaration names are one of the few canonical AST fields that already
   * carries typed interpolation (`string | Interpolation`). Keep the `#{…}` segments
   * structural here instead of accepting the whole name as an opaque token.
   * The production requires an interpolation atom, so ordinary CSS properties
   * remain on the compact shared CSS terminal below.
   */
  const propertyNameChunk = regex(/(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
  const InterpolatedProperty = node<Interpolation>(
    'InterpolatedProperty',
    sequence(
      optional(literal('*')),
      many(propertyNameChunk),
      g.SassInterpolation,
      many(choice(
        propertyNameChunk,
        g.SassInterpolation
      ))
    ),
    (children) => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolation(child)) {
          parts.push(...child.parts);
        } else {
          appendLiteral(
            parts,
            requireToken(child).value
          );
        }
      }
      return interpolation(parts);
    }
  );

  /*
   * A custom property is plain CSS in every dialect, so SCSS composes the same
   * recognition the CSS base does rather than routing `--x` through the ordinary
   * property terminal (which is a CSS ident and cannot start with `--`). The name
   * is the shared custom-property leaf, or that leaf's `--` prefix followed by
   * SCSS `#{…}` segments.
   */
  const CustomPropertyName = node<string | Interpolation>(
    'CustomPropertyName',
    choice(
      noTrivia(sequence(
        literal('--'),
        many(propertyNameChunk),
        g.SassInterpolation,
        many(choice(
          propertyNameChunk,
          g.SassInterpolation
        ))
      )),
      g.CssSyntaxCustomProperty
    ),
    (children) => {
      if (!children.some(isInterpolation)) {
        return requireToken(children[0]).value;
      }
      const parts: Interpolation['parts'] = [];
      customValueFromParts(
        children,
        parts,
        { interpolated: false }
      );
      return interpolation(parts);
    }
  );

  /*
   * The value is a CSS `<declaration-value>`: an almost-arbitrary token stream
   * whose only structure is balanced groups, strings, comments — and, in SCSS,
   * `#{…}`. Sass does not evaluate a custom-property value, so every other byte
   * stays literal text. Delimiters recurse as grammar children rather than being
   * captured as one opaque span, so an inner `;` or `}` cannot end the
   * declaration and an inner `#{…}` still reduces to a typed segment.
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
    g.SassInterpolation,
    g.CssSyntaxCustomInnerContent,
    blockComment,
    g.CssSyntaxCustomSingleQuoted,
    g.CssSyntaxCustomDoubleQuoted,
    g.CustomParen,
    g.CustomSquare,
    g.CustomCurly
  );
  const CustomPart: Combinator<unknown> = choice(
    g.SassInterpolation,
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
    children => customValue(children)
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
        throw new TypeError('SCSS grammar produced a custom declaration without a name.');
      }

      /*
       * An interpolated custom-property name is itself a ValueNode, so read the
       * value from its fixed position after the colon rather than by shape.
       */
      const value = children[2];
      if (!isValue(value)) {
        throw new TypeError('SCSS grammar produced an incomplete custom declaration.');
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
          g.InterpolatedProperty,
          propertyName
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
      if (children.length < 3 || children.length > 6) {
        throw new TypeError('SCSS declaration produced unexpected children.');
      }
      const isImportant = children.includes(true);

      /*
       * An interpolated declaration name is itself a ValueNode. The declaration
       * value is the grammar child immediately after its owned colon, rather
       * than the first value-shaped child in the reduction.
       */
      const colon = children.findIndex(child => isToken(child) && child.value === ':');
      const value = colon < 0 ? undefined : children[colon + 1];
      if (value === undefined) {
        throw new TypeError('SCSS declaration requires a value.');
      }
      const name = isInterpolation(children[0]) ? children[0] : requireToken(children[0]).value;
      return decl(
        name,
        requireValueSlot(value),
        null,
        isImportant
      );
    }
  );

  /*
   * The nested-property form is compile-time property-prefix syntax, not a
   * runtime container. This direct slice admits static or interpolated property
   * names and declaration-only bodies, then lowers the prefix during grammar reduction to
   * the existing ordered Declaration facts the serializer already owns.
   * The legacy CST also accepts variable and namespaced-variable assignments,
   * @if/@each/@for/@while, and comments in
   * this block.
   * Those are deliberately held here: lowering them needs a typed delayed
   * property-prefix placement fact, not a synthetic container. Recursive
   * nested properties and @extend are not legacy body forms, so this
   * grammar does not create extensions for them either.
   */
  const NestedPropertyMember = node<CollectionEntry>(
    'NestedPropertyMember',
    sequence(
      choice(
        g.InterpolatedProperty,
        propertyName
      ),
      literal(':'),
      g.Value,
      optional(literal(';'))
    ),
    children => collectionEntry(
      isInterpolation(children[0]) ? children[0] : keyword(requireToken(children[0]).value),
      requireValueSlot(children[2]),
      null,
      false
    )
  );

  /*
   * Cheap zero-width gate so an ordinary declaration (`color: red;`) does not
   * speculatively parse its full value as a nested-property own-value, fail the
   * required block `{`, and backtrack a whole value re-parse before
   * `Declaration` re-parses it. A nested property always opens a block
   * `{` before the statement terminates; this single `not` fails (skipping the
   * arm) only when a `;`/`}` is reachable through non-brace bytes first, i.e.
   * the statement ends before any `{`. `[^{};]` halts at an interpolation's `{`
   * too, so a `#{…}`-bearing declaration still enters (unchanged), and a real
   * nested property is never skipped (its block or own-value `#{` `{` always
   * precedes any terminator). Single `not` is a predicate — it emits no child,
   * so the positional reducer below is unaffected.
   */
  const directNestedPropertyAhead = not(regex(/[^{};]*[;}]/));
  const NestedPropertyDeclaration = node<Declaration>(
    'NestedPropertyDeclaration',
    sequence(
      directNestedPropertyAhead,
      choice(
        g.InterpolatedProperty,
        propertyName
      ),
      literal(':'),
      optional(g.Value),
      literal('{'),
      many(g.NestedPropertyMember),
      literal('}'),
      optional(g.Important),
      optional(literal(';'))
    ),
    (children) => {
      const prefix = isInterpolation(children[0]) ? children[0] : requireToken(children[0]).value;
      const open = children.findIndex(child => isToken(child) && child.value === '{');
      const close = children.findIndex((child, index) => index > open && isToken(child) && child.value === '}');
      if (open < 0 || close < 0) {
        throw new TypeError('SCSS nested property lost its block delimiters.');
      }
      const ownValue = open > 2 && isValueSlotValue(children[2]) ? children[2] : null;
      const ownImportant = children.includes(true);
      if (ownImportant && ownValue === null) {
        throw new TypeError('SCSS nested property cannot apply !important without an own declaration value.');
      }

      /*
       * The leaf entries stay LEAF-ONLY-keyed CollectionEntries inside a
       * Collection value. Hyphenation and own-value placement move to the
       * serializer; the carrier's own value (when present) rides on `base`.
       */
      const entries: CollectionEntry[] = [];
      for (let index = open + 1; index < close; index++) {
        const child = children[index];
        if (isCollectionEntry(child)) {
          entries.push(child);
        } else {
          throw new TypeError('SCSS nested property produced a non-entry child.');
        }
      }
      return decl(
        prefix,
        collection(
          entries,
          ownValue ?? undefined
        ),
        null,
        ownValue === null ? false : ownImportant
      );
    }
  );
  const StaticImportUrl = node<Url>(
    'StaticImportUrl',

    /*
     * SCSS accepts an empty CSS URL target. Keep that fact explicit
     * rather than treating it as a generic call or a text fallback. The only
     * newly admitted shape here is `url()`; quoted, static unquoted, and
     * interpolation-bearing targets remain their existing structural arms.
     */
    sequence(
      g.CssSyntaxUrlOpen,
      optional(choice(
        g.Quoted,
        staticUrlInner
      )),
      literal(')')
    ),
    (children) => {
      /*
       * Parseman omits an unmatched optional from `children`, leaving the
       * closing delimiter at index 1 for exactly `url()`.
       */
      if (children.length === 2) {
        return url(any(''));
      }
      const body = children[1];
      return url(isQuoted(body) || isInterpolation(body) ? body : any(requireToken(body).value));
    }
  );

  /*
   * This remains a deliberately bounded CSS-import tail. Every admitted part
   * has an existing lossless ValueNode representation: `layer`/`layer(name)`,
   * the structural `supports(<supports-condition>)` form, and one media type.
   * Media-query structure, general-enclosed supports, dynamic terms, and
   * multi-item imports still need their own typed reductions rather than a
   * generic value or authored-text fallback.
   */
  const StaticImportLayer = node<ValueNode>(
    'StaticImportLayer',
    choice(
      noTrivia(sequence(
        regex(/layer(?![-_a-zA-Z0-9\u0080-\uffff])/i),
        literal('('),
        g.Keyword,
        literal(')')
      )),
      noTrivia(regex(/layer(?![-_a-zA-Z0-9\u0080-\uffff])/i))
    ),
    children => children.length === 1
      ? keyword(requireToken(children[0]).value)
      : funcCall(
          requireToken(children[0]).value,
          [requireValue(children[2])]
        )
  );

  /*
   * In an import condition, CSS permits a single declaration without the
   * parentheses required by a general <supports-condition>. Its canonical fact
   * is still the same parenthesized declaration condition used elsewhere.
   */
  const StaticImportDeclaration = node<ValueNode>(
    'StaticImportDeclaration',
    sequence(
      propertyName,
      literal(':'),
      g.SupportsAtom
    ),
    children => block(operation(
      ':',
      keyword(requireToken(children[0]).value),
      requireValue(children[2])
    ))
  );
  const StaticImportSupports = node<FunctionCall>(
    'StaticImportSupports',
    sequence(
      noTrivia(sequence(
        regex(/supports(?![-_a-zA-Z0-9\u0080-\uffff])/i),
        literal('(')
      )),
      choice(
        g.SupportsCondition,
        g.StaticImportDeclaration
      ),
      literal(')')
    ),
    children => funcCall(
      requireToken(children[0]).value,
      [requireValue(children[2])]
    )
  );

  /*
   * CSS import tails share the media-query *shape* used by conditional groups,
   * but not their recovery branch: a query function there lowers an arbitrary
   * payload to `Any`, which is not an AST import fact. This local family
   * admits only the static values and boolean/query forms the canonical nodes
   * already represent.
   */
  const StaticImportQualifier = node<ValueNode>(
    'StaticImportQualifier',
    choice(
      sequence(
        g.StaticImportLayer,
        g.StaticImportSupports
      ),
      g.StaticImportLayer,
      g.StaticImportSupports
    ),
    (children) => {
      const values = children.filter(isValue);
      if (values.length === 0) {
        throw new TypeError('Static import qualifier requires typed facts.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const StaticImportMediaFeature = node<ValueNode>(
    'StaticImportMediaFeature',
    choice(
      sequence(
        literal('('),
        propertyName,
        literal(')')
      ),
      sequence(
        literal('('),
        propertyName,
        literal(':'),
        g.SupportsAtom,
        literal(')')
      ),
      sequence(
        literal('('),
        propertyName,
        g.CssSyntaxQueryComparisonOperator,
        g.SupportsAtom,
        literal(')')
      )
    ),
    (children) => {
      const property = keyword(requireToken(children[1]).value);
      if (children.length === 3) {
        return block(property);
      }
      return block(operation(
        requireToken(children[2]).value,
        property,
        requireValue(children[3])
      ));
    }
  );
  const StaticImportMediaInParens = node<ValueNode>(
    'StaticImportMediaInParens',
    choice(
      sequence(
        literal('('),
        g.StaticImportMediaCondition,
        literal(')')
      ),
      g.StaticImportMediaFeature
    ),
    children => children.length === 1 ? requireValue(children[0]) : block(requireValue(children[1]))
  );
  const StaticImportMediaCondition = node<ValueNode>(
    'StaticImportMediaCondition',
    choice(
      sequence(
        g.CssSyntaxQueryNot,
        g.StaticImportMediaInParens
      ),
      sequence(
        g.StaticImportMediaInParens,
        many(sequence(
          g.CssSyntaxQueryAndOr,
          g.StaticImportMediaInParens
        ))
      )
    ),
    (children) => {
      const values = keywordizeValues(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const StaticImportMediaNonOnlyKeyword = node<Keyword>(
    'StaticImportMediaNonOnlyKeyword',
    sequence(
      not(g.CssSyntaxQueryOnly),
      g.Keyword
    ),
    children => requireKeyword(children.at(-1))
  );

  /*
   * A media *type* can only continue with `and`; `or` remains available in a
   * condition made solely from parenthesized media features below.
   */
  const staticImportMediaAnd = regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const StaticImportMediaOnlyClause = node<ValueNode>(
    'StaticImportMediaOnlyClause',
    sequence(
      g.CssSyntaxQueryOnly,
      StaticImportMediaNonOnlyKeyword,
      many(sequence(
        staticImportMediaAnd,
        g.StaticImportMediaInParens
      ))
    ),
    children => spaced(keywordizeValues(children))
  );
  const StaticImportMediaClause = node<ValueNode>(
    'StaticImportMediaClause',
    choice(
      StaticImportMediaOnlyClause,
      sequence(
        StaticImportMediaNonOnlyKeyword,
        choice(
          sequence(
            staticImportMediaAnd,
            g.StaticImportMediaInParens
          ),
          g.StaticImportMediaInParens
        )
      ),
      g.StaticImportMediaCondition,
      StaticImportMediaNonOnlyKeyword
    ),
    (children) => {
      const values = keywordizeValues(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const StaticImportMediaPrelude = node<ValueNode>(
    'StaticImportMediaPrelude',
    sequence(
      g.StaticImportMediaClause,
      many(sequence(
        literal(','),
        g.StaticImportMediaClause
      ))
    ),
    (children) => {
      const values = children.filter(isValue);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );
  const StaticImportTail = node<ValueNode>(
    'StaticImportTail',
    choice(
      sequence(
        g.StaticImportQualifier,
        g.StaticImportMediaPrelude
      ),
      g.StaticImportQualifier,
      g.StaticImportMediaPrelude
    ),
    (children) => {
      const values = children.filter(isValue).flatMap(value =>
        typeof value === 'object' && value !== null && 'type' in value && value.type === 'SpacedValue'
          ? value.parts
          : [value]);
      if (values.length === 0) {
        throw new TypeError('Static import tail requires a typed value.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const StaticImportRule = node<ImportAtRule>(
    'StaticImportRule',
    sequence(
      regex(/@import(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      choice(
        g.Quoted,
        g.StaticImportUrl
      ),
      optional(g.StaticImportTail),
      literal(';')
    ),
    (children) => {
      const targetIndex = children.findIndex(isImportTarget);
      const target = children[targetIndex];
      if (!isImportTarget(target)) {
        throw new TypeError('StaticImportRule requires a typed target.');
      }
      const tail = children.slice(targetIndex + 1).find(isValue) ?? null;
      return importAtRule(
        '@import',
        target,
        null,
        null,
        tail
      );
    }
  );
  const moduleNamespaceName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const UseNamespace = node<string>(
    'UseNamespace',
    sequence(
      regex(/as(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      choice(
        literal('*'),
        moduleNamespaceName
      )
    ),
    children => requireToken(children[1]).value
  );
  const UseRule = node<StyleImport | ModuleImport>(
    'UseRule',
    sequence(
      regex(/@use(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.StaticQuoted,
      optional(g.UseNamespace),
      literal(';')
    ),
    (children) => {
      const path = children[1];
      if (!isQuoted(path)) {
        throw new TypeError('SCSS @use requires a quoted module path.');
      }
      const namespace = children.find((child): child is string => typeof child === 'string') ?? null;
      if (path.value.startsWith('sass:')) {
        const rewritten = `#sass/${path.value.slice('sass:'.length)}`;
        return moduleImport(
          quoted(
            `${path.quote}${rewritten}${path.quote}`,
            rewritten,
            path.quote,
            false
          ),
          'use',
          namespace
        );
      }
      return isScriptModulePath(path.value)
        ? moduleImport(
            path,
            'use',
            namespace
          )
        : styleImport(
            path,
            'compose',
            namespace,
            false
          );
    }
  );
  const ForwardRule = node<StyleImport>(
    'ForwardRule',
    sequence(
      regex(/@forward(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.StaticQuoted,
      g.ForwardTail,
      literal(';')
    ),
    (children) => {
      if (!isQuoted(children[1])) {
        throw new TypeError('SCSS @forward requires a quoted module path.');
      }
      if (children[2] !== null) {
        throw new TypeError('SCSS @forward modifiers are not representable in the canonical import fact.');
      }
      return styleImport(
        children[1],
        'compose',
        null,
        true
      );
    }
  );
  const ForwardTail = node<Token | null>(
    'ForwardTail',
    optional(scanTo(
      literal(';'),
      { skip: [balanced('(', ')'), g.StaticQuoted] }
    )),
    (children) => {
      const text = children.length === 0 ? '' : requireToken(children[0]).value.trim();
      return text === '' ? null : { value: text };
    }
  );

  /*
   * The core canonical tree already owns MixinDefinition/MixinCall and its ordinary
   * parameter/argument binding semantics. This direct SCSS family therefore
   * covers static mixin names, positional/named/default/rest arguments, and
   * bodies made from the statements already available below. `@content`,
   * module-qualified calls, and interpolated names remain separate families.
   */
  const mixinNameToken = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const mixinParamSigilName = scssVarSigilName;
  const MixinParameter = node<Param>(
    'MixinParameter',
    choice(
      sequence(
        literal('...'),
        mixinParamSigilName
      ),
      sequence(
        mixinParamSigilName,
        optional(sequence(
          literal(':'),
          g.ValueTerm
        )),
        optional(literal('...'))
      )
    ),
    (children) => {
      const name = requireToken(children.find(child => typeof child === 'object' && child !== null && 'value' in child && typeof child.value === 'string' && child.value !== '$' && child.value !== '...' && child.value !== ':')!).value;
      if (children.some(child => typeof child === 'object' && child !== null && 'value' in child && child.value === '...')) {
        return { name, rest: true };
      }
      const defaultValue = children.find(isValueSlotValue);
      return defaultValue === undefined ? { name } : { name, default: defaultValue };
    }
  );
  const MixinParameters = node<Param[]>(
    'MixinParameters',
    sequence(
      literal('('),
      optional(sequence(
        g.MixinParameter,
        many(sequence(
          literal(','),
          g.MixinParameter
        )),
        optional(literal(','))
      )),
      literal(')')
    ),
    children => children.filter((child): child is Param => typeof child === 'object' && child !== null && !('type' in child) && ('name' in child || 'rest' in child))
  );
  const MixinCallArgument = node<ScssCallArg>(
    'MixinCallArgument',
    choice(
      sequence(
        mixinParamSigilName,
        literal(':'),
        g.ValueTerm
      ),
      sequence(
        g.ValueTerm,
        literal('...')
      ),
      g.ValueTerm
    ),
    (children) => {
      const value = children.find(isValueSlotValue);
      if (value === undefined) {
        throw new TypeError('MixinCallArgument requires a value.');
      }
      const nameToken = children.find((child): child is Token => typeof child === 'object' && child !== null && 'value' in child && typeof child.value === 'string' && child.value !== '$' && child.value !== ':' && child.value !== '...');
      if (nameToken !== undefined && children.some(child => typeof child === 'object' && child !== null && 'value' in child && child.value === ':')) {
        return { name: nameToken.value, value };
      }
      return children.some(child => typeof child === 'object' && child !== null && 'value' in child && child.value === '...')
        ? { value, spread: true }
        : { value };
    }
  );
  const MixinCallRule = node<MixinCall>(
    'MixinCallRule',
    sequence(
      regex(/@include(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      mixinNameToken,
      optional(sequence(
        literal('('),
        optional(sequence(
          g.MixinCallArgument,
          many(sequence(
            literal(','),
            g.MixinCallArgument
          )),
          optional(literal(','))
        )),
        literal(')')
      )),
      optional(literal(';'))
    ),
    children => mixinCall(
      requireToken(children[1]).value,
      children.filter((child): child is ScssCallArg => typeof child === 'object' && child !== null && 'value' in child && isValueSlotValue(child.value))
    )
  );

  /*
   * Shared block-body statement dispatch. The nested-declaration-capable body
   * contexts (mixin definitions, `@each`/`@for` loops, nested bubbling at-rule
   * blocks, and the ruleset body via the extend-augmented reuse below) all list
   * the same ordered arm set. Factoring each distinct signature into one named
   * combinator keeps arm-win precedence identical across every context instead
   * of hand-copying the arms per production. Grouping the contiguous `@`-led
   * arms into one nested choice is byte-identical (a bare `choice` passes its
   * winning arm's value through unchanged and firstMatch order is preserved),
   * and lets parseman first-set-gate the whole cluster behind a single `@`
   * check. The `@import` arm stays ahead of the cluster because its authored
   * order there predates the cluster; keeping it out preserves precedence.
   * Cluster arms are ordered most-frequent-first. Every arm opens with a
   * distinct, word-boundaried `@` at-keyword (`@include`/`@mixin`/`@function`/
   * `@if`/`@each`/`@for`/`@supports`/`@media`/`@container`/`@starting-style`/
   * `@layer`/`@scope`/`@document`/`@page`/`@font-feature-values`), so no input
   * matches two arms — firstMatch order is immaterial to WHICH arm wins and any
   * permutation is byte-identical. `@include` (mixin call) is by far the most
   * common nested at-statement, followed by the control-flow forms, so placing
   * them ahead of the rarely-nested CSS bubbling blocks lets the common case win
   * on its first recognizer instead of failing the block recognizers first.
   * The opaque arm is last in every cluster: its name recognizer already excludes
   * every name the typed arms own, so it can only win where nothing else could.
   */
  const nestedAtStatement = choice(
    g.MixinCallRule,
    g.IfRule,
    g.EachRule,
    g.ForRule,
    g.MixinDefinitionRule,
    g.FunctionRule,
    g.AtRootFilter,
    g.AtRootBlock,
    g.NestedConditionalBlock,
    g.NestedStartingStyleBlock,
    g.NestedLayerBlock,
    g.NestedScopeBlock,
    g.DocumentBlock,
    g.PageBlock,
    g.FontFeatureValuesBlock,
    g.OpaqueAtRuleBlock,
    g.OpaqueAtRuleStatement
  );

  /*
   * The `@`-led cluster is tried LAST in every body, after `Ruleset`. Every cluster
   * arm opens with a literal `@` at-keyword, so it is disjoint from `Ruleset` (a
   * selector never opens with `@`), from `@keyframes`/`@extend` (distinct
   * at-keywords with no cluster arm), and from every prefix arm (`Declaration`,
   * `NestedPropertyDeclaration`, `VarDeclaration`, `Comment` never open with `@`, and
   * `Import`'s `@use`/`@forward`/`@import` are distinct at-keywords). Because no
   * input can match both the cluster and any arm ahead of it, moving it last is
   * firstMatch-order-preserving (byte-identical) while letting the common
   * non-`@` statements — ordinary rules and `&`-selectors, the bulk of a
   * stylesheet — reach `Ruleset` without first walking all thirteen at-rule
   * recognizers on a doomed speculation.
   * Declarations (`prop: value`) and nested-property blocks (`prop: { … }`) are
   * by far the most common body statements, so they lead the prefix. Both open
   * on a property token (an identifier, `--custom`, or `#{…}`) that is first-char
   * disjoint from `Comment` (`/`), `Import` (`@`) and `VarDeclaration` (`$`), so
   * no input matches both a leading arm and a following one — the reorder is
   * firstMatch-order-preserving (byte-identical). `NestedPropertyDeclaration` keeps
   * its own cheap `not([^{};]*[;}])` block-ahead gate and stays ahead of
   * `Declaration` (the two share the `prop:` prefix). Leading with them means an
   * ordinary declaration no longer enters and rolls back the Comment/Import/
   * VarDeclaration node frames before matching.
   * `;` SEPARATES declarations rather than terminating them (css-syntax-3 §5.4.7
   * "consume a list of declarations": a declaration ends at `;` OR at the end of
   * the block, and an empty declaration between two separators is discarded, not
   * an error). The declaration productions already make their own `;` optional,
   * so what was missing is the empty declaration — `a { ; }`, `a { color: red;; }`
   * and a leading `;`. A skipped bare `;` arm IS that discard: `statementChildren`
   * drops the token, so the arm contributes no node. It goes last because `;` is
   * first-char disjoint from every arm ahead of it (property tokens, `/`, `@`,
   * `$`), so no input matches both and the placement is firstMatch-order-
   * preserving — while an empty declaration stays rare enough not to belong in
   * front of the two arms this prefix deliberately leads with.
   */
  const nestedBodyPrefix = choice(
    g.NestedPropertyDeclaration,
    g.Declaration,
    g.Comment,
    g.StaticImportRule,
    g.VariableDeclaration,
    literal(';')
  );

  /* Nested body ending in `Ruleset` (mixin/each/for/nested-scope bodies). */
  const nestedBody = many(choice(
    nestedBodyPrefix,
    g.NestedRuleset,
    nestedAtStatement
  ));

  /* Nested bubbling at-rule bodies additionally accept `@keyframes` before `Ruleset`. */
  const nestedKeyframesBody = many(choice(
    nestedBodyPrefix,
    g.Keyframes,
    g.NestedRuleset,
    nestedAtStatement
  ));

  /* The ruleset body adds one extra arm (`Extend`) before `Ruleset`. */
  const ruleBody = many(choice(
    nestedBodyPrefix,
    g.Extend,
    g.NestedRuleset,
    nestedAtStatement
  ));

  /*
   * Statement-level bubbling at-rule bodies (media/supports/container and the
   * starting-style/layer variant) each list a fixed ordered arm set shared
   * across their own arms; hoist each distinct signature to one combinator.
   */
  const conditionalBlockBody = many(choice(
    g.Comment,
    g.StaticImportRule,
    g.MixinDefinitionRule,
    g.MixinCallRule,
    g.EachRule,
    g.ForRule,
    g.IfRule,
    g.AtRootFilter,
    g.AtRootBlock,
    g.ConditionalBlock,
    g.StartingStyleBlock,
    g.LayerBlock,
    g.ScopeBlock,
    g.DocumentBlock,
    g.PageBlock,
    g.FontFeatureValuesBlock,
    g.Keyframes,
    g.OpaqueAtRuleBlock,
    g.OpaqueAtRuleStatement,
    g.NestedRuleset
  ));
  const startingLayerBlockBody = many(choice(
    g.Comment,
    g.StaticImportRule,
    g.MixinDefinitionRule,
    g.MixinCallRule,
    g.EachRule,
    g.ForRule,
    g.IfRule,
    g.AtRootFilter,
    g.AtRootBlock,
    g.ConditionalBlock,
    g.StartingStyleBlock,
    g.LayerBlock,
    g.DocumentBlock,
    g.PageBlock,
    g.FontFeatureValuesBlock,
    g.Keyframes,
    g.OpaqueAtRuleBlock,
    g.OpaqueAtRuleStatement,
    g.NestedRuleset
  ));
  const MixinDefinitionRule = node<MixinDefinition>(
    'MixinDefinitionRule',
    sequence(
      regex(/@mixin(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      mixinNameToken,
      optional(g.MixinParameters),
      literal('{'),
      nestedBody,
      literal('}')
    ),
    children => mixinDef(
      requireToken(children[1]).value,
      isParamArray(children[2]) ? children[2] : [],
      statementChildren(
        children,
        true
      )
    )
  );

  /*
   * `@return v` inside a user `@function` yields the function's value. Per the
   * SCSS→Jess lowering it becomes a `result: v` declaration in the lambda body;
   * the shared evaluator reads a `result` entry as the yielded value.
   */
  const ReturnRule = node<Declaration>(
    'ReturnRule',
    sequence(
      regex(/@return(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.Value,
      optional(literal(';'))
    ),
    children => decl(
      'result',
      requireValueSlot(children[1])
    )
  );

  /*
   * A user `@function f($n) { @return v }` lowers to a value-returning anonymous
   * mixin (lambda) bound to a `$var`: `$f: @($n) > { result: v }`. There is NO
   * first-class `$function` node — this reuses `variableDeclaration` +
   * `AnonymousMixin` (with the same `params` shape a MixinDefinition uses), and `@return`
   * reuses `result:`. The parameter list threads into `AnonymousMixin.params`; an
   * empty/absent list is omitted so the plain-block shape stays monomorphic.
   */
  const FunctionRule = node<VariableDeclaration>(
    'FunctionRule',
    sequence(
      regex(/@function(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      mixinNameToken,
      optional(g.MixinParameters),
      literal('{'),
      many(choice(
        g.Comment,
        g.VariableDeclaration,
        g.ReturnRule,
        g.IfRule,
        g.EachRule,
        g.ForRule
      )),
      literal('}')
    ),
    (children) => {
      const params = isParamArray(children[2]) ? children[2] : [];
      return variableDeclaration(
        requireToken(children[1]).value,
        anonymousMixin(
          statementChildren(
            children,
            true
          ),
          params.length > 0 ? params : undefined
        ),
        { mode: 'declare' }
      );
    }
  );
  const EachVariableName = node<string>(
    'EachVariableName',
    scssVarSigilName,
    children => requireToken(children[1]).value
  );
  const EachBinding = node<ForBinding>(
    'EachBinding',
    sequence(
      g.EachVariableName,
      many(sequence(
        literal(','),
        g.EachVariableName
      ))
    ),
    (children) => {
      const names = children.filter((child): child is string => typeof child === 'string');
      if (names.length === 1) {
        return { kind: 'single', name: names[0]! };
      }
      if (names.length < 2) {
        throw new TypeError('SCSS grammar produced an invalid @each binding.');
      }
      return { kind: 'tuple', names: [names[0]!, names[1]!, ...names.slice(2)] };
    }
  );

  /*
   * SCSS comma bindings destructure each iterable value. This is distinct from
   * Jess bracket key/value bindings and Less callback key/index bindings, so it
   * owns the canonical `tuple` pattern rather than borrowing either meaning.
   */
  const EachRule = node<For>(
    'EachRule',
    sequence(
      regex(/@each(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.EachBinding,
      regex(/\bin\b/),
      g.Value,
      literal('{'),
      nestedBody,
      literal('}')
    ),
    (children) => {
      const iterable = children.find(isValueSlotValue);
      if (iterable === undefined) {
        throw new TypeError('EachRule requires an iterable.');
      }
      return forNode(
        iterable,
        statementChildren(
          children,
          true
        ),
        requireForBinding(children[1])
      );
    }
  );

  /*
   * SCSS `@for` has an authored inclusive (`through`) or exclusive (`to`) end.
   * Preserve that fact in the canonical typed Range rather than lowering the
   * range into a text list or borrowing Less's `range()` call spelling.
   */
  const ForRule = node<For>(
    'ForRule',
    sequence(
      regex(/@for(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.EachVariableName,

      /*
       * SCSS range bounds use the same top-level arithmetic grammar as the
       * legacy CST (`topSum`). Keep them as ValueNode facts for Range; the
       * evaluator already evaluates both bounds before iterating.
       */
      regex(/from(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.MathTopSum,
      choice(
        regex(/through(?![-_a-zA-Z0-9\u0080-\uffff])/i),
        regex(/to(?![-_a-zA-Z0-9\u0080-\uffff])/i)
      ),
      g.MathTopSum,
      literal('{'),
      nestedBody,
      literal('}')
    ),
    children => forNode(
      range(
        requireValue(children[3]),
        requireValue(children[5]),
        null,
        true,
        requireToken(children[4]).value.toLowerCase() === 'through'
      ),
      statementChildren(
        children.slice(
          7,
          -1
        ),
        true
      ),
      { kind: 'single', name: requireString(children[1]) }
    )
  );

  /*
   * SCSS conditionals use the canonical If/GuardNode. Bare truthiness is
   * deliberately still held because the current truth node has Less's exact-
   * true behavior; comparisons have their own existing typed evaluator path.
   */
  const scssTrueKeyword = regex(/true(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const scssFalseKeyword = regex(/false(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const scssNotKeyword = regex(/not(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const scssAndKeyword = regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const scssOrKeyword = regex(/or(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const IfComparison = node<GuardNode>(
    'IfComparison',
    sequence(
      g.MathTopSum,
      choice(
        literal('=='),
        literal('!='),
        literal('>='),
        literal('<='),
        literal('>'),
        literal('<')
      ),
      g.MathTopSum
    ),
    (children) => {
      const left = requireValue(children[0]);
      const operator = requireToken(children[1]).value;
      const right = requireValue(children[2]);
      const comparison = { g: 'cmp' as const, op: operator === '==' || operator === '!=' ? '=' : operator, left, right };
      return operator === '!=' ? { g: 'not', inner: comparison } : comparison;
    }
  );
  const IfAtom = node<GuardNode>(
    'IfAtom',
    choice(
      sequence(
        literal('('),
        g.IfCondition,
        literal(')')
      ),
      g.IfComparison,
      scssTrueKeyword,
      scssFalseKeyword
    ),
    (children) => {
      const nested = children.find((child): child is GuardNode => typeof child === 'object' && child !== null && 'g' in child);
      if (nested !== undefined) {
        return nested;
      }
      const token = requireToken(children[0]).value.toLowerCase();
      return { g: 'truth', value: keyword(token) };
    }
  );
  const IfTerm = node<GuardNode>(
    'IfTerm',
    sequence(
      optional(scssNotKeyword),
      g.IfAtom
    ),
    (children) => {
      const atom = children.find((child): child is GuardNode => typeof child === 'object' && child !== null && 'g' in child);
      if (atom === undefined) {
        throw new TypeError('SCSS @if term lost its guard.');
      }
      return children.some(child => isToken(child) && child.value.toLowerCase() === 'not')
        ? { g: 'not', inner: atom }
        : atom;
    }
  );
  const IfAnd = node<GuardNode>(
    'IfAnd',
    sequence(
      g.IfTerm,
      many(sequence(
        scssAndKeyword,
        g.IfTerm
      ))
    ),
    (children) => {
      let guard = requireGuardNode(children[0]);
      for (let index = 2; index < children.length; index += 2) {
        guard = { g: 'and', left: guard, right: requireGuardNode(children[index]) };
      }
      return guard;
    }
  );
  const IfCondition = node<GuardNode>(
    'IfCondition',
    sequence(
      g.IfAnd,
      many(sequence(
        scssOrKeyword,
        g.IfAnd
      ))
    ),
    (children) => {
      let guard = requireGuardNode(children[0]);
      for (let index = 2; index < children.length; index += 2) {
        guard = { g: 'or', left: guard, right: requireGuardNode(children[index]) };
      }
      return guard;
    }
  );
  const IfBody = node<Statement[]>(
    'IfBody',
    sequence(
      literal('{'),
      many(choice(
        g.Comment,
        g.StaticImportRule,
        g.VariableDeclaration,
        g.NestedPropertyDeclaration,
        g.Declaration,
        g.IfStaticConditionalBlock,
        g.DocumentBlock,
        g.PageBlock,
        g.FontFeatureValuesBlock,
        g.MixinDefinitionRule,
        g.MixinCallRule,
        g.EachRule,
        g.ForRule,
        g.IfRule,
        g.AtRootFilter,
        g.AtRootBlock,
        g.IfStaticRule
      )),
      literal('}')
    ),
    children => statementChildren(
      children.slice(
        1,
        -1
      ),
      true
    )
  );
  const IfStaticRule = node<Ruleset>(
    'IfStaticRule',
    sequence(
      g.Selector,
      g.IfBody
    ),
    children => rule(
      requireSelectorList(children[0]),
      requireStatementList(children[1])
    )
  );
  const IfStaticConditionalBlock = node<AtRuleBlock>(
    'IfStaticConditionalBlock',
    choice(
      sequence(
        g.CssSyntaxSupportsAtKeyword,
        g.SupportsPrelude,
        g.IfBody
      ),
      sequence(
        choice(
          g.CssSyntaxMediaAtKeyword,
          sequence(
            g.CssSyntaxContainerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.QueryPrelude,
        g.IfBody
      ),
      sequence(
        choice(
          g.CssSyntaxMediaAtKeyword,
          sequence(
            g.CssSyntaxContainerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.StaticMediaPrelude,
        g.IfBody
      ),
      sequence(
        g.CssSyntaxStartingStyleAtKeyword,
        g.StaticAtPrelude,
        g.IfBody
      ),
      sequence(
        g.CssSyntaxLayerAtKeyword,
        g.StaticAtPrelude,
        g.IfBody
      )
    ),
    (children) => {
      const body = children[2];
      if (!Array.isArray(body)) {
        throw new TypeError('SCSS conditional block lost its statement body.');
      }
      return atRuleBlock(
        requireToken(children[0]).value,
        optionalValue(children[1]),
        statements(body)
      );
    }
  );
  const IfRule = node<If>(
    'IfRule',
    sequence(
      regex(/@if(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.IfCondition,
      g.IfBody,
      many(sequence(
        regex(/@else(?![-_a-zA-Z0-9\u0080-\uffff])/i),
        choice(
          sequence(
            regex(/if(?![-_a-zA-Z0-9\u0080-\uffff])/i),
            g.IfCondition,
            g.IfBody
          ),
          g.IfBody
        )
      ))
    ),
    (children) => {
      const branches: IfBranch[] = [{ guard: requireGuardNode(children[1]), rules: requireStatementList(children[2]) }];
      for (let index = 3; index < children.length;) {
        /*
         * Every tail begins with @else. An else-if has its literal `if`, guard,
         * and body; a bare else contributes just its body.
         */
        index += 1;
        const child = children[index];
        if (isToken(child) && child.value.toLowerCase() === 'if') {
          branches.push({ guard: requireGuardNode(children[index + 1]), rules: requireStatementList(children[index + 2]) });
          index += 3;
        } else {
          branches.push({ guard: null, rules: requireStatementList(children[index]) });
          index += 1;
        }
      }
      const first = branches[0];
      if (first === undefined) {
        throw new TypeError('SCSS @if reduction produced no branches.');
      }
      return ifNode([first, ...branches.slice(1)]);
    }
  );

  /*
   * Static conditional-group preludes are structured in the grammar. The public
   * SCSS CST also accepts `#{...}` query preludes for language-service recovery,
   * but public `parse() -> Stylesheet` intentionally rejects that CST-only form
   * until the AST owns typed query-prelude interpolation. Never lower it to raw
   * prelude text merely to erase that deliberate acceptance mismatch.
   *
   * A media/container feature value is a single CSS component value, not one of
   * SCSS's comma/space/slash lists, and it may be a `<ratio>` — media-queries-4
   * §2.1, `<number> [ / <number> ]?` — as in `(aspect-ratio: 16/9)`. Building it
   * on the pre-list math term keeps the feature's `/` a ratio operator (the same
   * typed Operation the prelude uses for `:` and the comparisons) instead of
   * SCSS's value-position slash list, so every dialect carries one ratio shape.
   */
  const QueryValue = node<ValueNode>(
    'QueryValue',
    noTrivia(sequence(
      g.MathTopSum,
      optional(sequence(
        optional(space),
        literal('/'),
        optional(space),
        g.MathTopSum
      ))
    )),
    (children) => {
      const values = children.filter(isValue);
      const numerator = requireValue(values[0]);
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
  const queryComparisonOperator = g.CssSyntaxQueryComparisonOperator;

  /*
   * media-queries-4 §2.4.3 lets `<mf-range>` lead with the value rather than the
   * feature name — `(100px < width)` and the two-sided `(100px < width < 200px)`
   * — so a name-first comparison is only half of the production. This is plain
   * CSS, and plain CSS parses in every dialect, so SCSS carries the same arm and
   * the same typed shape as the css/less/jess grammars: the outer comparison
   * wraps the inner one, giving Block(paren, Operation('<', Operation('<', …))).
   * Building it on QueryValue is what gives the range form `<ratio>`
   * bounds (`(16/9 < aspect-ratio < 2/1)`) without restating the ratio grammar.
   */
  const QueryFeature = node<ValueNode>(
    'QueryFeature',
    choice(
      sequence(
        literal('('),
        propertyName,
        literal(')')
      ),
      sequence(
        literal('('),
        propertyName,
        literal(':'),
        QueryValue,
        literal(')')
      ),
      sequence(
        literal('('),
        propertyName,
        queryComparisonOperator,
        QueryValue,
        literal(')')
      ),
      sequence(
        literal('('),
        QueryValue,
        queryComparisonOperator,
        propertyName,
        optional(sequence(
          queryComparisonOperator,
          QueryValue
        )),
        literal(')')
      )
    ),
    (children) => {
      /*
       * The value-first arm is the only one holding a value where the other three
       * hold the feature name, so that child alone settles which arm matched.
       */
      if (isValue(children[1])) {
        const values = children.filter(isValue);
        const property = keyword(requireToken(children[3]).value);
        let comparison = operation(
          requireToken(children[2]).value,
          requireValue(values[0]),
          property
        );
        const upper = values[1];
        if (upper !== undefined) {
          comparison = operation(
            requireToken(children[children.length - 3]).value,
            comparison,
            upper
          );
        }
        return block(comparison);
      }
      const property = keyword(requireToken(children[1]).value);
      if (children.length === 3) {
        return block(property);
      }
      const value = requireValue(children[children.length - 2]);
      return block(operation(
        requireToken(children[2]).value,
        property,
        value
      ));
    }
  );
  const QueryFunction = node<FunctionCall>(
    'QueryFunction',
    sequence(
      g.CssSyntaxQueryFunctionName,
      literal('('),
      scanTo(
        literal(')'),
        { skip: [balanced(
          '(',
          ')'
        ), g.Quoted] }
      ),
      expect(
        literal(')'),
        ')'
      )
    ),
    children => funcCall(
      requireToken(children[0]).value,
      [any(children.length > 2 ? requireToken(children[2]).value : '')]
    )
  );
  const QueryInParens = node<ValueNode>(
    'QueryInParens',
    choice(
      sequence(
        literal('('),
        g.QueryCondition,
        literal(')')
      ),
      g.QueryFeature,
      g.QueryFunction
    ),
    children => children.length === 1
      ? requireValue(children[0])
      : block(requireValue(children[1]))
  );
  const QueryCondition = node<ValueNode>(
    'QueryCondition',
    choice(
      sequence(
        g.CssSyntaxQueryNot,
        g.QueryInParens
      ),
      sequence(
        g.QueryInParens,
        many(sequence(
          g.CssSyntaxQueryAndOr,
          g.QueryInParens
        ))
      )
    ),
    (children) => {
      const values = keywordizeValues(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );

  /*
   * `only` modifies a media type; it cannot introduce a parenthesized query
   * condition. Keep `not (...)` in QueryCondition, where that form
   * is structurally valid.
   */
  const QueryNonOnlyKeyword = node<Keyword>(
    'QueryNonOnlyKeyword',
    sequence(
      not(g.CssSyntaxQueryOnly),
      g.Keyword
    ),
    children => requireKeyword(children.at(-1))
  );
  const QueryOnlyClause = node<ValueNode>(
    'QueryOnlyClause',
    sequence(
      g.CssSyntaxQueryOnly,
      QueryNonOnlyKeyword,
      many(sequence(
        g.CssSyntaxQueryAndOr,
        g.QueryInParens
      ))
    ),
    children => spaced(keywordizeValues(children))
  );
  const QueryClause = node<ValueNode>(
    'QueryClause',
    choice(
      QueryOnlyClause,
      sequence(
        QueryNonOnlyKeyword,
        optional(g.CssSyntaxQueryAndOr),
        g.QueryInParens
      ),
      g.QueryCondition,
      QueryNonOnlyKeyword
    ),
    (children) => {
      const values = keywordizeValues(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const QueryPreludeTail = node<ValueNode>(
    'QueryPreludeTail',
    sequence(
      literal(','),
      g.QueryClause
    ),
    children => requireValue(children[1])
  );
  const QueryPrelude = node<ValueNode>(
    'QueryPrelude',
    sequence(
      g.QueryClause,
      many(g.QueryPreludeTail)
    ),
    (children) => {
      const values = children.map(requireValue);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );

  /*
   * `@supports` is not the media/container query grammar: a general-enclosed
   * function would otherwise reach QueryFunction and be lowered to
   * FunctionCall(Any). Keep this public parse route to facts the canonical
   * AST actually owns; dynamic SCSS values require their own semantic model.
   */
  const SupportsAtom = node<ValueNode>(
    'SupportsAtom',
    choice(
      StaticValueQuoted,
      g.Color,
      g.Dimension,
      g.CustomPropertyValue,
      g.Keyword
    ),
    children => requireValue(children[0])
  );
  const SupportsGeneralTemplateParen = node<Interpolation>(
    'SupportsGeneralTemplateParen',
    sequence(
      literal('('),
      g.SupportsGeneralTemplate,
      literal(')')
    ),
    interpolationFromTemplateChildren
  );
  const SupportsGeneralTemplateSquare = node<Interpolation>(
    'SupportsGeneralTemplateSquare',
    sequence(
      literal('['),
      g.SupportsGeneralTemplate,
      literal(']')
    ),
    interpolationFromTemplateChildren
  );
  const SupportsGeneralTemplateBrace = node<Interpolation>(
    'SupportsGeneralTemplateBrace',
    sequence(
      literal('{'),
      g.SupportsGeneralTemplate,
      literal('}')
    ),
    interpolationFromTemplateChildren
  );
  const SupportsGeneralTemplateDoubleQuoted = node<Interpolation>(
    'SupportsGeneralTemplateDoubleQuoted',
    sequence(
      literal('"'),
      g.SupportsGeneralTemplate,
      literal('"')
    ),
    interpolationFromTemplateChildren
  );
  const SupportsGeneralTemplateSingleQuoted = node<Interpolation>(
    'SupportsGeneralTemplateSingleQuoted',
    sequence(
      literal('\''),
      g.SupportsGeneralTemplate,
      literal('\'')
    ),
    interpolationFromTemplateChildren
  );
  const SupportsGeneralTemplate = node<Interpolation>(
    'SupportsGeneralTemplate',
    many(choice(
      g.SassInterpolation,
      g.SupportsGeneralTemplateParen,
      g.SupportsGeneralTemplateSquare,
      g.SupportsGeneralTemplateBrace,
      g.SupportsGeneralTemplateDoubleQuoted,
      g.SupportsGeneralTemplateSingleQuoted,
      generalTemplateText
    )),
    interpolationFromTemplateChildren
  );
  const SupportsGeneralEnclosed = node<GeneralEnclosed>(
    'SupportsGeneralEnclosed',
    choice(
      sequence(
        g.CssSyntaxKeyword,
        literal('('),
        g.SupportsGeneralTemplate,
        literal(')')
      ),
      sequence(
        literal('('),
        g.SupportsGeneralTemplate,
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
  const SupportsFeature = node<ValueNode>(
    'SupportsFeature',
    choice(
      sequence(
        literal('('),
        propertyName,
        literal(')')
      ),
      sequence(
        literal('('),
        propertyName,
        literal(':'),
        g.SupportsAtom,
        literal(')')
      )
    ),
    (children) => {
      const property = keyword(requireToken(children[1]).value);
      const value = children.find(isValue);
      return value === undefined
        ? block(property)
        : block(operation(
            ':',
            property,
            value
          ));
    }
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
      g.SupportsGeneralEnclosed
    ),
    (children) => {
      const value = children.find(isValue);
      if (value === undefined) {
        throw new TypeError('SCSS supports parenthesis lost its typed condition.');
      }
      return isValue(children[0]) ? value : block(value);
    }
  );
  const SupportsNotKeyword = node<Keyword>(
    'SupportsNotKeyword',
    g.CssSyntaxQueryNot,
    children => keyword(requireToken(children[0]).value)
  );
  const SupportsAndOrKeyword = node<Keyword>(
    'SupportsAndOrKeyword',
    g.CssSyntaxQueryAndOr,
    children => keyword(requireToken(children[0]).value)
  );
  const SupportsCondition = node<ValueNode>(
    'SupportsCondition',
    choice(
      sequence(
        g.SupportsNotKeyword,
        g.SupportsInParens
      ),
      sequence(
        g.SupportsInParens,
        many(sequence(
          g.SupportsAndOrKeyword,
          g.SupportsInParens
        ))
      )
    ),
    (children) => {
      const values = children.filter(isValue);
      if (values.length === 0) {
        throw new TypeError('SCSS supports condition lost every typed part.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const SupportsPrelude = node<ValueNode>(
    'SupportsPrelude',
    g.SupportsCondition,
    children => requireValue(children[0])
  );
  const StaticMediaPrelude = node<ValueNode>(
    'StaticMediaPrelude',
    noTrivia(oneOrMore(g.ScssSyntaxStaticMediaModifier)),
    children => any(children.map(requireToken).map(token => token.value).join('').trim())
  );

  /*
   * CSS's host-mode grammar retains a known block at-rule's static header as a
   * grammar-owned `Any` when no more specific value model applies. SCSS needs
   * the same lossless fact for `@layer` and `@starting-style`, but must not
   * flatten its `#{…}` form: every atom below reserves that opener, including
   * inside quotes and nested paren/square groups. Dynamic headers remain held
   * until they have an interpolation-bearing prelude model.
   */
  const staticAtPreludeText = regex(/(?:[^#()\[\]{}'"\\/]|\\[\s\S]|#(?!\{)|\/(?!\*))+/);
  const StaticAtPreludeDoubleQuoted = node<Token>(
    'StaticAtPreludeDoubleQuoted',
    sequence(
      literal('"'),
      doubleQuotedText,
      literal('"')
    ),
    joinTokenValue
  );
  const StaticAtPreludeSingleQuoted = node<Token>(
    'StaticAtPreludeSingleQuoted',
    sequence(
      literal('\''),
      singleQuotedText,
      literal('\'')
    ),
    joinTokenValue
  );
  const StaticAtPreludeParen = node<Token>(
    'StaticAtPreludeParen',
    sequence(
      literal('('),
      many(g.StaticAtPreludeAtom),
      literal(')')
    ),
    joinTokenValue
  );
  const StaticAtPreludeSquare = node<Token>(
    'StaticAtPreludeSquare',
    sequence(
      literal('['),
      many(g.StaticAtPreludeAtom),
      literal(']')
    ),
    joinTokenValue
  );
  const StaticAtPreludeAtom = node<Token>(
    'StaticAtPreludeAtom',
    choice(
      g.StaticAtPreludeParen,
      g.StaticAtPreludeSquare,
      g.StaticAtPreludeDoubleQuoted,
      g.StaticAtPreludeSingleQuoted,
      g.CssSyntaxBlockComment,
      g.ScssSyntaxLineComment,
      staticAtPreludeText
    ),
    children => ({ value: requireToken(children[0]).value })
  );
  const StaticAtPrelude = node<ValueNode | null>(
    'StaticAtPrelude',
    noTrivia(many(g.StaticAtPreludeAtom)),
    (children) => {
      const text = children.map(requireToken).map(token => token.value).join('').trim();
      return text.length === 0 ? null : any(text);
    }
  );

  /*
   * Statement headers need the same static nested syntax as block headers but
   * must leave their top-level semicolon to the statement production.
   */
  const staticStatementPreludeText = regex(/(?:[^#;()\[\]{}'"\\/]|\\[\s\S]|#(?!\{)|\/(?![/*]))+/);
  const StaticStatementPrelude = node<ValueNode | null>(
    'StaticStatementPrelude',
    noTrivia(many(choice(
      g.StaticAtPreludeParen,
      g.StaticAtPreludeSquare,
      g.StaticAtPreludeDoubleQuoted,
      g.StaticAtPreludeSingleQuoted,
      g.CssSyntaxBlockComment,
      g.ScssSyntaxLineComment,
      staticStatementPreludeText
    ))),
    (children) => {
      /*
       * Sass line comments are non-emitting trivia. Keeping their bytes here
       * would comment out the serializer's terminal semicolon.
       */
      const text = children.map(requireToken).filter(token => !token.value.startsWith('//')).map(token => token.value).join('').trim();
      return text.length === 0 ? null : any(text);
    }
  );

  /*
   * CSS statement at-rules retain the existing canonical statement fact. This
   * deliberately excludes Sass diagnostics (`@debug`, `@warn`, `@error`) and
   * all dynamic headers: neither can truthfully lower to CSS output here.
   */
  const AtRuleStatement = node<AtRuleStatement>(
    'AtRuleStatement',
    sequence(
      regex(/@(?:charset|namespace|layer)(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      StaticStatementPrelude,
      literal(';')
    ),
    children => atRuleStatement(
      requireToken(children[0]).value,
      optionalValue(children[1])
    )
  );
  const AtRootPrelude = node<ValueNode | null>(
    'AtRootPrelude',
    optional(scanTo(
      literal('{'),
      { skip: [balanced('(', ')'), g.StaticQuoted] }
    )),
    (children) => {
      const text = children.length === 0 ? '' : requireToken(children[0]).value.trim();
      return text === '' ? null : any(text);
    }
  );
  const AtRootFilterPrelude = node<ValueNode>(
    'AtRootFilterPrelude',
    sequence(
      literal('('),
      scanTo(
        literal('{'),
        { skip: [balanced('(', ')'), g.StaticQuoted] }
      )
    ),
    children => any(children.map(requireToken).map(token => token.value).join('').trim())
  );
  const AtRootBlock = node<AtRuleBlock>(
    'AtRootBlock',
    sequence(
      atRootAtKeyword,
      g.AtRootPrelude,
      literal('{'),
      nestedBody,
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statementChildren(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );
  const AtRootFilter = node<AtRuleBlock>(
    'AtRootFilter',
    sequence(
      atRootAtKeyword,
      g.AtRootFilterPrelude,
      literal('{'),
      nestedBody,
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statementChildren(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );

  /*
   * `@scope` is an existing CSS at-rule fact: its static header remains a
   * grammar-owned prelude and its SCSS body remains typed statements. Dynamic
   * interpolation is intentionally outside StaticAtPrelude.
   */
  const ScopeBlock = node<AtRuleBlock>(
    'ScopeBlock',
    sequence(
      g.CssSyntaxScopeAtKeyword,
      g.StaticAtPrelude,
      literal('{'),
      many(choice(
        g.Comment,
        g.StaticImportRule,
        g.VariableDeclaration,
        g.MixinDefinitionRule,
        g.MixinCallRule,
        g.EachRule,
        g.ForRule,
        g.IfRule,
        g.AtRootFilter,
        g.AtRootBlock,
        g.ConditionalBlock,
        g.StartingStyleBlock,
        g.LayerBlock,
        g.ScopeBlock,
        g.DocumentBlock,
        g.PageBlock,
        g.FontFeatureValuesBlock,
        g.Keyframes,
        g.Ruleset
      )),
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statements(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );

  /*
   * A scope placed in an SCSS nested rule has the same header fact but the
   * nested declaration-capable body used by the other bubbling at-rules.
   */
  const NestedScopeBlock = node<AtRuleBlock>(
    'NestedScopeBlock',
    sequence(
      g.CssSyntaxScopeAtKeyword,
      g.StaticAtPrelude,
      literal('{'),
      nestedBody,
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statements(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );
  const ConditionalBlock = node<AtRuleBlock>(
    'ConditionalBlock',
    choice(
      sequence(
        g.CssSyntaxSupportsAtKeyword,
        g.SupportsPrelude,
        literal('{'),
        conditionalBlockBody,
        literal('}')
      ),
      sequence(
        choice(
          g.CssSyntaxMediaAtKeyword,
          sequence(
            g.CssSyntaxContainerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.QueryPrelude,
        literal('{'),
        conditionalBlockBody,
        literal('}')
      ),
      sequence(
        choice(
          g.CssSyntaxMediaAtKeyword,
          sequence(
            g.CssSyntaxContainerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.StaticMediaPrelude,
        literal('{'),
        conditionalBlockBody,
        literal('}')
      )
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      requireValue(children[1]),
      statements(children.slice(
        3,
        -1
      ))
    )
  );
  const StartingStyleBlock = node<AtRuleBlock>(
    'StartingStyleBlock',
    sequence(
      g.CssSyntaxStartingStyleAtKeyword,
      g.StaticAtPrelude,
      literal('{'),
      startingLayerBlockBody,
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statements(children.slice(
        3,
        -1
      ))
    )
  );
  const LayerBlock = node<AtRuleBlock>(
    'LayerBlock',
    sequence(
      g.CssSyntaxLayerAtKeyword,
      g.StaticAtPrelude,
      literal('{'),
      startingLayerBlockBody,
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statements(children.slice(
        3,
        -1
      ))
    )
  );

  /*
   * Deprecated CSS document blocks still have a precise structural shape: a
   * static grammar-owned header and a frame-one stylesheet body. The existing
   * `Any` prelude retains static url-match functions and separators without
   * claiming an interpolation segment model; `#{...}` is rejected by the
   * shared static-header grammar before a node exists.
   */
  const DocumentBlock = node<AtRuleBlock>(
    'DocumentBlock',
    sequence(
      g.CssSyntaxDocumentAtKeyword,
      g.StaticAtPrelude,
      literal('{'),
      many(choice(
        g.Comment,
        g.MixinDefinitionRule,
        g.MixinCallRule,
        g.EachRule,
        g.ForRule,
        g.IfRule,
        g.AtRootFilter,
        g.AtRootBlock,
        g.ConditionalBlock,
        g.StartingStyleBlock,
        g.LayerBlock,
        g.DocumentBlock,
        g.PageBlock,
        g.FontFeatureValuesBlock,
        g.FontFace,
        g.CounterStyle,
        g.PropertyAtRule,
        g.Keyframes,
        g.Ruleset
      )),
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statements(children.slice(
        3,
        -1
      ))
    )
  );

  /*
   * Page-margin boxes are a finite CSS family, not generic nested at-rules.
   * Keep the header/body policy local to this grammar: every named box has no
   * prelude and contains declarations/comments only. Header comments are trivia,
   * not a body comment.
   */
  const PageMarginBox = node<AtRuleBlock>(
    'PageMarginBox',
    sequence(
      g.CssSyntaxMarginAtKeyword,
      many(g.CssSyntaxBlockComment),
      literal('{'),
      many(choice(
        g.Comment,
        g.Declaration,
        literal(';')
      )),
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      null,
      statementChildren(
        children,
        true
      )
    )
  );

  /*
   * The shared AST deliberately retains a static page selector as an existing
   * grammar-owned Any, just as the CSS route does. `#{...}` remains
   * excluded by StaticAtPrelude rather than being flattened.
   */
  const PageBlock = node<AtRuleBlock>(
    'PageBlock',
    sequence(
      g.CssSyntaxPageAtKeyword,
      g.StaticAtPrelude,
      literal('{'),
      many(choice(
        g.Comment,
        g.Declaration,
        g.PageMarginBox,
        literal(';')
      )),
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statementChildren(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );

  /*
   * The inner names are a finite CSS family.  Keep each descriptor block
   * declaration/comment-only and retain the outer static font list as the
   * existing grammar-owned Any fact; dynamic SCSS headers are not flattened.
   */
  const FontFeatureValueBlock = node<AtRuleBlock>(
    'FontFeatureValueBlock',
    sequence(
      g.CssSyntaxFontFeatureValueAtKeyword,
      many(g.CssSyntaxBlockComment),
      literal('{'),
      many(choice(
        g.Comment,
        g.Declaration,
        literal(';')
      )),
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      null,
      statementChildren(
        children,
        true
      )
    )
  );
  const FontFeatureValuesBlock = node<AtRuleBlock>(
    'FontFeatureValuesBlock',
    sequence(
      g.CssSyntaxFontFeatureValuesAtKeyword,
      g.StaticAtPrelude,
      literal('{'),
      many(choice(
        g.Comment,
        g.FontFeatureValueBlock
      )),
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statementChildren(children.slice(
        3,
        -1
      ))
    )
  );
  const NestedConditionalBlock = node<AtRuleBlock>(
    'NestedConditionalBlock',
    choice(
      sequence(
        g.CssSyntaxSupportsAtKeyword,
        g.SupportsPrelude,
        literal('{'),
        nestedKeyframesBody,
        literal('}')
      ),
      sequence(
        choice(
          g.CssSyntaxMediaAtKeyword,
          sequence(
            g.CssSyntaxContainerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.QueryPrelude,
        literal('{'),
        nestedKeyframesBody,
        literal('}')
      ),
      sequence(
        choice(
          g.CssSyntaxMediaAtKeyword,
          sequence(
            g.CssSyntaxContainerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.StaticMediaPrelude,
        literal('{'),
        nestedKeyframesBody,
        literal('}')
      )
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      requireValue(children[1]),
      statements(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );
  const NestedStartingStyleBlock = node<AtRuleBlock>(
    'NestedStartingStyleBlock',
    sequence(
      g.CssSyntaxStartingStyleAtKeyword,
      g.StaticAtPrelude,
      literal('{'),
      nestedKeyframesBody,
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statements(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );
  const NestedLayerBlock = node<AtRuleBlock>(
    'NestedLayerBlock',
    sequence(
      g.CssSyntaxLayerAtKeyword,
      g.StaticAtPrelude,
      literal('{'),
      nestedKeyframesBody,
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      optionalValue(children[1]),
      statements(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );
  const FontFace = node<AtRuleBlock>(
    'FontFace',
    sequence(
      regex(/@font-face(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      literal('{'),
      many(choice(
        g.Comment,
        g.Declaration
      )),
      literal('}')
    ),
    children => atRuleBlock(
      '@font-face',
      null,
      statements(
        children.slice(
          2,
          -1
        ),
        true
      )
    )
  );
  const CounterStyle = node<AtRuleBlock>(
    'CounterStyle',
    sequence(
      regex(/@counter-style(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.Keyword,
      literal('{'),
      many(choice(
        g.Comment,
        g.Declaration
      )),
      literal('}')
    ),
    children => atRuleBlock(
      '@counter-style',
      requireKeyword(children[1]),
      statements(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );

  /*
   * `@property` names are custom-property names, not ordinary CSS keywords:
   * the mandatory `--` prefix must be retained in the typed prelude. Keeping
   * the prefix and identifier as grammar leaves also means interpolation cannot
   * slip through as a flattened string.
   */
  const PropertyName = node<Keyword>(
    'PropertyName',
    noTrivia(sequence(
      literal('--'),
      g.CssSyntaxKeyword
    )),
    children => keyword(`${requireToken(children[0]).value}${requireToken(children[1]).value}`)
  );
  const PropertyAtRule = node<AtRuleBlock>(
    'PropertyAtRule',
    sequence(
      regex(/@property(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.PropertyName,
      literal('{'),
      many(choice(
        g.Comment,
        g.Declaration
      )),
      literal('}')
    ),
    children => atRuleBlock(
      '@property',
      requireKeyword(children[1]),
      statements(
        children.slice(
          3,
          -1
        ),
        true
      )
    )
  );

  /*
   * Keyframes already fit the canonical AtRuleBlock + Ruleset model: the at-rule
   * name/prelude and every descriptor block remain structured.  Keep this
   * deliberately static at the header and selector boundary; interpolated
   * keyframe names/selectors need typed selector interpolation rather than raw
   * text capture.
   */
  const KeyframeSelector = node<SimpleSelector>(
    'KeyframeSelector',
    choice(
      keyframeEndpoint,
      keyframePercent
    ),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const KeyframeBlock = node<Ruleset>(
    'KeyframeBlock',
    sequence(
      g.KeyframeSelector,

      /*
       * Comments are valid selector-list delimiters.  Keep them as grammar
       * facts (and statement comments only when they are actual body items),
       * matching the CSS keyframe list without source recovery.
       */
      many(sequence(
        many(g.Comment),
        literal(','),
        many(g.Comment),
        g.KeyframeSelector
      )),
      many(g.Comment),
      literal('{'),
      many(choice(
        g.Comment,
        g.Declaration,
        literal(';')
      )),
      literal('}')
    ),
    children => rule(
      keyframeSelectorListFromChildren(children),
      statementChildren(
        children.slice(
          2,
          -1
        ),
        true
      )
    )
  );

  /*
   * Keyframe names do not participate in the module-path classification that
   * deliberately keeps `StaticQuoted` escape-free. They are ordinary
   * static quoted values, so they reuse the escape-preserving
   * `StaticValueQuoted` production (identical grammar and reducer)
   * while still leaving a real `#{` opener for the rejected dynamic path.
   */
  const Keyframes = node<AtRuleBlock>(
    'Keyframes',
    sequence(
      g.CssSyntaxKeyframesAtKeyword,
      choice(
        g.Keyword,
        StaticValueQuoted
      ),
      literal('{'),
      many(choice(
        g.Comment,
        g.KeyframeBlock
      )),
      literal('}')
    ),
    children => atRuleBlock(
      requireToken(children[0]).value,
      requireValue(children[1]),
      statementChildren(children.slice(
        3,
        -1
      ))
    )
  );

  /*
   * Static selector structure is grammar-owned too: selector lists and compact
   * compounds do not pass through a text bridge. SCSS-specific interpolation,
   * attribute selectors and pseudo arguments remain explicit
   * follow-up families rather than being flattened into a string fallback.
   */
  const Simple = node<SimpleSelector>(
    'Simple',
    g.CssSyntaxSimple,
    children => simpleSelector(requireToken(children[0]).value)
  );
  const InterpolatedSimple = node<SimpleSelector>(
    'InterpolatedSimple',
    noTrivia(sequence(
      optional(regex(/[.#]/)),
      many(selectorTextRun),
      g.SassInterpolation,
      many(choice(
        g.SassInterpolation,
        selectorTextRun
      ))
    )),
    (children) => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterpolation(child)) {
          parts.push(...child.parts);
        } else {
          appendLiteral(
            parts,
            requireToken(child).value
          );
        }
      }
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );

  /*
   * SCSS placeholder selectors are selector syntax, not declarations or a
   * runtime-only marker. The canonical selector tree already represents their
   * exact static spelling as a SimpleSelector; interpolated placeholder names need a
   * typed interpolation model and are deliberately excluded.
   */
  const Placeholder = node<SimpleSelector>(
    'Placeholder',
    regex(/%-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/),
    children => simpleSelector(requireToken(children[0]).value)
  );

  /*
   * This is the static CSS-compatible attribute-selector family. The canonical
   * selector tree represents an attribute as one source-faithful SimpleSelector, just
   * as the CSS grammar does. Namespaced and interpolation-bearing
   * attributes stay outside this closed slice because their segments need
   * their own typed representation rather than text flattening.
   */
  const Attribute = node<SimpleSelector>(
    'Attribute',
    sequence(
      literal('['),
      g.Identifier,
      optional(sequence(
        g.AttributeOperator,
        choice(

          /*
           * `noTrivia` on the quoted arms only: the attribute itself re-enters
           * the ambient trivia (see the selector production) so `[a = "b"]`
           * keeps its spacing, but the string body must stay literal bytes so
           * `[href="//host"]` is not swallowed by the `//` trivia arm.
           */
          noTrivia(sequence(
            literal('"'),
            doubleQuotedText,
            literal('"')
          )),
          noTrivia(sequence(
            literal('\''),
            singleQuotedText,
            literal('\'')
          )),
          g.Identifier
        ),
        optional(g.AttributeModifier)
      )),
      literal(']')
    ),
    children => simpleSelector(joinSourceText(children))
  );

  /*
   * Selector-valued pseudo arguments have the same canonical selector shape as
   * an ordinary rule header. Parse them through that grammar, then preserve the
   * canonical text inside the existing SimpleSelector selector representation. Raw
   * pseudo arguments are deliberately not accepted here: an SCSS interpolation
   * in one must stay typed rather than being swallowed as a string.
   */
  const PseudoArgument = node<string>(
    'PseudoArgument',

    /*
     * A pseudo's selector-valued argument is carried by its containing
     * SimpleSelector text in AST v2, not as a second selector field. Recognize
     * its static grammar here so it remains accepted without giving a nested
     * Selector an interpolation escape hatch.
     */
    sequence(
      not(g.CssSyntaxMalformedPseudoNumericArgument),
      g.StaticPseudoArgument
    ),
    joinSourceText
  );

  /*
   * A static functional pseudo is still a canonical SimpleSelector leaf. Its
   * argument is grammar-recognized (including balanced groups, brackets,
   * strings, and comments) rather than post-parse text recovery. Every chunk
   * excludes a real SCSS `#{` opener, so interpolation cannot be flattened into
   * this static spelling while selector-valued arguments retain their existing
   * canonical spelling inside the containing SimpleSelector.
   */
  const staticPseudoChunk = regex(/(?:[^()\[\]'"#\/]|#(?!\{)|\/(?!\*))+/);
  const StaticPseudoGroup = node<string>(
    'StaticPseudoGroup',
    sequence(
      literal('('),
      many(choice(
        g.StaticPseudoGroup,
        g.StaticPseudoSquare,
        StaticValueQuoted,
        g.CssSyntaxBlockComment,
        staticPseudoChunk
      )),
      literal(')')
    ),
    joinSourceText
  );
  const StaticPseudoSquare = node<string>(
    'StaticPseudoSquare',
    sequence(
      literal('['),
      many(choice(
        g.StaticPseudoGroup,
        g.StaticPseudoSquare,
        StaticValueQuoted,
        g.CssSyntaxBlockComment,
        staticPseudoChunk
      )),
      literal(']')
    ),
    joinSourceText
  );
  const StaticPseudoArgument = node<string>(
    'StaticPseudoArgument',
    oneOrMore(choice(
      g.StaticPseudoGroup,
      g.StaticPseudoSquare,
      StaticValueQuoted,
      g.CssSyntaxBlockComment,
      staticPseudoChunk
    )),
    joinSourceText
  );

  /*
   * Selector-valued pseudo arguments are still text inside the containing
   * SimpleSelector, but their top-level commas have the established canonical
   * selector spelling (no following whitespace). Keep that grammar-owned
   * normalization separate from generic functional pseudo arguments.
   */
  const staticSelectorPseudoChunk = regex(/(?:[^(),\[\]'"#\/]|#(?!\{)|\/(?!\*))+/);
  const StaticSelectorPseudoItem = node<string>(
    'StaticSelectorPseudoItem',
    oneOrMore(choice(
      g.StaticPseudoGroup,
      g.StaticPseudoSquare,
      StaticValueQuoted,
      g.CssSyntaxBlockComment,
      staticSelectorPseudoChunk
    )),
    joinSourceText
  );
  const StaticSelectorPseudoTail = node<string>(
    'StaticSelectorPseudoTail',
    sequence(
      literal(','),
      optional(space),
      g.StaticSelectorPseudoItem
    ),
    children => `,${requireString(children.at(-1))}`
  );
  const StaticSelectorPseudoArgument = node<string>(
    'StaticSelectorPseudoArgument',
    sequence(
      g.StaticSelectorPseudoItem,
      many(g.StaticSelectorPseudoTail)
    ),
    joinSourceText
  );

  /*
   * Pseudos share a glued `:name` / `:name(` opener. Route it once, then let the
   * selected branch own that opener through `routed()` so the public
   * semantic pseudo CST labels keep their source span.
   */
  const pseudoIdentOrFunction = token(noTrivia(sequence(
    pseudoColon,
    g.CssSyntaxKeyword,
    optional(literal('('))
  )));

  /*
   * A relative selector (a `:has()` argument) may open with a child/sibling
   * combinator (`:has(> .b)`). The outer selector grammar forbids a leading
   * combinator, so this pseudo-private branch admits an optional relative one and
   * emits a `RelativeSelector`. A leading `||`/`|` is
   * namespace syntax, not a relative combinator, so it is excluded (mirrors the
   * css/less landings).
   */
  const scssRelativeSelectorCombinator = choice(
    literal('>'),
    literal('+'),
    literal('~')
  );
  const RelativeComplex = node<SelectorBranch>(
    'RelativeComplex',
    parser(
      { trivia: whitespace },
      sequence(
        optional(scssRelativeSelectorCombinator),
        g.Complex
      )
    ),
    (children) => {
      const branch = children.find(isSelectorBranch)!;
      if (children.length === 1) {
        return branch;
      }
      const lead = scssRelativeCombinator(children[0]);
      return relativeSelector(lead, branchSegments(branch));
    }
  );

  /*
   * The selector-argument pseudos (`:is`/`:where`/`:not`/`:has`/`:matches`) take a
   * selector-ONLY argument: a (relative) selector list with no general-any text
   * fallback, so `:not(2n+1)` fails the selector and rejects the whole pseudo. The
   * non-relative shape reduces identically to `g.Selector`; the retained
   * `SelectorList` becomes structured `PseudoSelector.args`, never joined at parse.
   */
  const SelectorOnlyPseudoArgument = node<SelectorList>(
    'SelectorOnlyPseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        RelativeComplex,
        many(sequence(
          literal(','),
          RelativeComplex
        ))
      )
    ),
    children => selist(...children.filter(isSelectorBranch))
  );
  const NthPseudo = node<SimpleSelector>(
    'NthPseudo',

    /*
       * `:nth-child`/`:nth-last-child`: a bare `<An+B>` OR `<An+B> of <selector>`
       * (Selectors-4 §6.6.2). Dispatched by the shared `g.CssSyntaxNthChildName`
       * so `of S` is admitted only on the child index. An+B input cannot first try
       * the selector-valued arm: `-n+2` has a valid selector prefix (`-n`) but is
       * not a complete selector argument. Its complete static grammar owns the
       * whole argument, and the numeric malformed-prefix gate prevents a broken
       * An+B form from falling through to ordinary raw pseudo content.
       */
    sequence(
      routed(),
      not(g.CssSyntaxMalformedPseudoNumericArgument),
      g.StaticPseudoArgument,
      literal(')')
    ),

    /*
       * Insignificant whitespace surrounding the `<An+B>` argument inside the
       * parens (`:nth-child( 2n+1 )`) is normalized away, matching the other
       * dialects; sign whitespace inside the argument (`2n + 1`, `n - 3`) stays
       * verbatim in the captured chunk. Selectors-4 §6.6.2 permits both
       * (https://www.w3.org/TR/selectors-4/#anb-microsyntax).
       */
    children => simpleSelector(`${requireToken(children[0]).value}${requireString(children.find(child => typeof child === 'string')).trim()})`)
  );
  const NthTypePseudo = node<SimpleSelector>(
    'NthTypePseudo',

    /*
       * `:nth-of-type`/`:nth-last-of-type`: a BARE `<An+B>` only — Selectors-4
       * §6.6.2 defines no `of S` tail for the type-index families. The
       * `not(sequence(g.CssSyntaxNth, g.CssSyntaxOfKeyword))` guard rejects
       * an `<An+B> of …` argument so `:nth-of-type(2n of .a)` fails rather than
       * being captured as opaque text (the CSS-aligned owner decision), matching
       * the css/jess landings.
       */
    sequence(
      routed(),
      not(g.CssSyntaxMalformedPseudoNumericArgument),
      not(parser(
        { trivia: whitespace },
        sequence(
          g.CssSyntaxNth,
          g.CssSyntaxOfKeyword
        )
      )),
      g.StaticPseudoArgument,
      literal(')')
    ),
    children => simpleSelector(`${requireToken(children[0]).value}${requireString(children.find(child => typeof child === 'string')).trim()})`)
  );
  const StructuredPseudo = node<SimpleToken>(
    'StructuredPseudo',

    /*
       * Parser = STRUCTURE + trivia only: keep the parsed `SelectorList` as `args`
       * and DO NOT join — core serialization owns the inline `:is(a, b)` rule
       * (`pseudoCanonical`). The positive lookahead confirms the
       * argument is a fully STATIC selector arg (the chunk grammar rejects `#{`)
       * before the structural parse commits; an interpolated arg fails here and,
       * with no text fallback for these names, rejects exactly as before.
       * Insignificant whitespace surrounding the argument inside the parens
       * (`:not( .b )`) is consumed here; it is trivia, so the structured arg
       * normalizes it away (`:not(.b)`) via `pseudoCanonical`, matching the other
       * dialects (Selectors-4; the residual SCSS surrounding-whitespace divergence).
       */
    sequence(
      routed(),
      optional(space),
      expect(
        peek(sequence(
          g.StaticSelectorPseudoArgument,
          literal(')')
        )),
        'static selector pseudo argument'
      ),
      SelectorOnlyPseudoArgument,
      optional(space),
      literal(')')
    ),
    children => pseudoSelector(
      scssPseudoName(requireToken(children[0]).value),
      requireSelectorList(children.find(isSelectorList))
    )
  );
  const GlobalLocalPseudo = node<SimpleSelector>(
    'GlobalLocalPseudo',

    /*
       * `:global(…)`/`:local(…)` retain the opaque, comma-normalized selector text
       * inside the containing SimpleSelector — they are sealed and never structured.
        */
    sequence(
      routed(),
      g.PseudoArgument,
      literal(')')
    ),
    children => simpleSelector(`${requireToken(children[0]).value}${requireString(children[1])})`)
  );
  const GenericFunctionPseudo = node<SimpleSelector>(
    'GenericPseudo',

    /*
       * Generic glued functions remain the general-any class. Known selector and
       * nth families are routed before this branch, so malformed arguments stay
       * committed to the known branch and cannot fall through here.
       */
    sequence(
      routed(),
      g.PseudoArgument,
      literal(')')
    ),
    children => simpleSelector(`${requireToken(children[0]).value}${requireString(children[1])})`)
  );
  const GenericBarePseudo = node<SimpleSelector>(
    'GenericPseudo',
    routed(),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const PseudoSelectorDispatch = dispatch(
    pseudoIdentOrFunction,
    caseInsensitive([':nth-child(', ':nth-last-child('], NthPseudo),
    caseInsensitive([':nth-of-type(', ':nth-last-of-type('], NthTypePseudo),
    caseInsensitive([':is(', ':where(', ':not(', ':has(', ':matches('], StructuredPseudo),
    caseInsensitive([':global(', ':local('], GlobalLocalPseudo),
    caseInsensitive([
      ':nth-child',
      ':nth-last-child',
      ':nth-of-type',
      ':nth-last-of-type',
      ':is',
      ':where',
      ':not',
      ':has',
      ':matches'
    ], not(routed())),
    when(endsWith('('), GenericFunctionPseudo),
    otherwise(GenericBarePseudo)
  );
  const PseudoSelector = node<SimpleToken>(
    'PseudoSelector',
    PseudoSelectorDispatch,
    children => children.find(isSimpleToken)!
  );
  const NestingSelector = node<SimpleSelector>(
    'NestingSelector',
    literal('&'),
    () => simpleSelector('&')
  );
  const Compound = node<SelectorTerm>(
    'Compound',
    noTrivia(sequence(
      oneOrMore(choice(
        g.NestingSelector,
        parser(
          { trivia: whitespace },
          g.Attribute
        ),
        g.PseudoSelector,
        g.Placeholder,
        g.InterpolatedSimple,
        g.Simple
      )),
      not(pseudoColon)
    )),
    children => selectorTermFromTokens(children.filter(isSimpleToken))
  );
  const scssCombinator = choice(
    literal('||'),
    literal('>'),
    literal('+'),
    literal('~')
  );
  const ComplexTail = node<ScssComplexTail>(
    'ComplexTail',
    sequence(
      optional(scssCombinator),
      g.Compound
    ),
    (children) => {
      const token = children.find(isToken);
      const term = children.find(isSelectorTerm)!;
      const combinator = token === undefined ? ' ' : scssCombinatorText(token);
      return { combinator, term };
    }
  );
  const Complex = node<SelectorBranch>(
    'Complex',
    sequence(
      g.Compound,
      many(g.ComplexTail)
    ),
    children => selectorBranchOf([
      { term: children.find(isSelectorTerm)! },
      ...children.filter(isScssComplexTail).map(tail => ({ combinator: tail.combinator, term: tail.term }))
    ])
  );
  const SelectorTail = node<SelectorBranch>(
    'SelectorTail',
    sequence(
      literal(','),
      g.Complex
    ),
    children => children.find(isSelectorBranch)!
  );
  const Selector = node<SelectorList>(
    'Selector',
    sequence(
      not(sequence(
        g.Placeholder,
        literal(',')
      )),
      g.Complex,
      many(g.SelectorTail)
    ),
    children => selist(...children.filter(isSelectorBranch))
  );
  const NestedSelectorTail = node<SelectorBranch>(
    'NestedSelectorTail',
    sequence(
      literal(','),
      g.RelativeComplex
    ),
    children => children.find(isSelectorBranch)!
  );
  const NestedSelector = node<SelectorList>(
    'NestedSelector',
    sequence(
      not(sequence(
        g.Placeholder,
        literal(',')
      )),
      g.RelativeComplex,
      many(g.NestedSelectorTail)
    ),
    children => selist(...children.filter(isSelectorBranch))
  );

  /*
   * SCSS `@extend` is a rule-body instruction, not a synthetic statement node.
   * Its target stays a typed selector list and is hoisted onto the carrying Ruleset
   * through the existing canonical extendInstructions field. `!optional` has
   * missing-target diagnostic semantics that the canonical instruction does not
   * yet model, so this slice rejects it rather than silently dropping it.
   */
  const Extend = node<ExtendInstruction>(
    'Extend',
    sequence(
      regex(/@extend(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.Selector,
      optional(literal(';'))
    ),
    children => ({ target: requireSelectorList(children[1]), partial: false })
  );

  /*
   * An unknown CSS block is terminal authored syntax. The shared recognition
   * artifact owns every balanced/string/comment boundary; this reduction only
   * records raw facts and keeps `$` out of an unquoted dynamic header, so a
   * dynamic prelude still rejects rather than becoming opaque text.
   * Wrap the two raw captures in their own nodes so this family's child count is
   * fixed: an `optional(scanTo(...))` that matches nothing emits no child and
   * would otherwise shift every positional index in the reducers below.
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
      scssGenericAtRuleName,
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
        throw new TypeError('SCSS opaque at-rule lost its grammar-owned raw facts.');
      }
      return opaqueAtRuleBlock(
        requireToken(children[0]).value,
        prelude,
        rawBody
      );
    }
  );

  /*
   * The statement spelling of the same fact (`@view-transition;`). It shares the
   * block's name recognizer, so the two are disjoint from every typed arm and
   * from each other — this one requires `;` where the block requires `{`.
   */
  const OpaqueAtRuleStatement = node<AtRuleStatement>(
    'OpaqueAtRuleStatement',
    sequence(
      scssGenericAtRuleName,
      noTrivia(sequence(
        g.OpaqueAtPrelude,
        literal(';')
      ))
    ),
    (children) => {
      const prelude = children[1];
      if (prelude !== null && typeof prelude !== 'string') {
        throw new TypeError('SCSS opaque at-rule statement lost its grammar-owned raw facts.');
      }
      return atRuleStatement(
        requireToken(children[0]).value,
        prelude === null ? null : any(prelude)
      );
    }
  );
  const Ruleset = node<Ruleset>(
    'Ruleset',
    sequence(
      g.Selector,
      literal('{'),
      ruleBody,
      literal('}')
    ),
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '{' || requireToken(children[children.length - 1]).value !== '}') {
        throw new TypeError('SCSS rule produced unexpected children.');
      }
      const extendInstructions = children.filter(isExtendInstruction);
      return rule(
        requireSelectorList(children[0]),
        statementChildren(
          children.slice(
            2,
            -1
          ),
          true
        ),
        extendInstructions.length > 0 ? extendInstructions : undefined
      );
    }
  );
  const NestedRuleset = node<Ruleset>(
    'NestedRuleset',
    sequence(
      g.NestedSelector,
      literal('{'),
      ruleBody,
      literal('}')
    ),
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '{' || requireToken(children[children.length - 1]).value !== '}') {
        throw new TypeError('SCSS nested rule produced unexpected children.');
      }
      const extendInstructions = children.filter(isExtendInstruction);
      return rule(
        requireSelectorList(children[0]),
        statementChildren(
          children.slice(
            2,
            -1
          ),
          true
        ),
        extendInstructions.length > 0 ? extendInstructions : undefined
      );
    }
  );
  const Stylesheet = node<Stylesheet>(
    'Stylesheet',

    /*
     * Sass module directives are document-prefix syntax. Variables and comments
     * may surround them there, and @use/@forward may remain interleaved, but an
     * ordinary stylesheet item closes that prefix permanently. This is grammar
     * shape, not a reducer-time placement check.
     */
    sequence(
      many(choice(
        g.Comment,
        g.VariableDeclaration,
        g.UseRule,
        g.ForwardRule
      )),
      many(choice(
        g.Comment,
        g.StaticImportRule,
        g.AtRuleStatement,
        g.VariableDeclaration,
        g.MixinDefinitionRule,
        g.FunctionRule,
        g.MixinCallRule,
        g.EachRule,
        g.ForRule,
        g.IfRule,
        g.AtRootFilter,
        g.AtRootBlock,
        g.ConditionalBlock,
        g.StartingStyleBlock,
        g.LayerBlock,
        g.ScopeBlock,
        g.DocumentBlock,
        g.PageBlock,
        g.FontFeatureValuesBlock,
        g.FontFace,
        g.CounterStyle,
        g.PropertyAtRule,
        g.Keyframes,
        g.OpaqueAtRuleBlock,
        g.OpaqueAtRuleStatement,
        g.Ruleset
      ))
    ),
    children => stylesheet(statements(children.flatMap(child => Array.isArray(child) ? child : [child])))
  );

  return {
    Stylesheet,
    VariableDeclaration,
    Comment,
    VariableReference,
    SassInterpolation,
    Quoted,
    StaticQuoted,
    Keyword,
    CustomPropertyValue,
    Color,
    UnicodeRange,
    Dimension,
    InterpolatedUrlValue,
    InterpolatedValue,
    Paren,
    MapEntry,
    Map,
    ReturnRule,
    FunctionRule,
    Square,
    ValueAtom,
    MathUnary,
    MathProduct,
    MathSum,
    MathTopProduct,
    MathTopSum,
    ValueTerm,
    ValuePair,
    Value,
    Important,
    InterpolatedProperty,
    CustomPropertyName,
    CustomPart,
    CustomInnerPart,
    CustomParen,
    CustomSquare,
    CustomCurly,
    CustomValue,
    CustomDeclaration,
    Declaration,
    NestedPropertyMember,
    NestedPropertyDeclaration,
    StaticImportRule,
    UseNamespace,
    UseRule,
    ForwardTail,
    ForwardRule,
    StaticImportUrl,
    StaticImportLayer,
    StaticImportDeclaration,
    StaticImportSupports,
    StaticImportQualifier,
    StaticImportMediaFeature,
    StaticImportMediaInParens,
    StaticImportMediaCondition,
    StaticImportMediaOnlyClause,
    StaticImportMediaClause,
    StaticImportMediaPrelude,
    StaticImportTail,
    MixinParameter,
    MixinParameters,
    MixinCallArgument,
    MixinCallRule,
    MixinDefinitionRule,
    EachVariableName,
    EachBinding,
    EachRule,
    ForRule,
    IfCondition,
    IfAnd,
    IfTerm,
    IfAtom,
    IfComparison,
    IfBody,
    IfStaticRule,
    IfStaticConditionalBlock,
    IfRule,
    QueryFeature,
    QueryFunction,
    QueryInParens,
    QueryCondition,
    QueryClause,
    QueryPreludeTail,
    QueryPrelude,
    SupportsAtom,
    SupportsGeneralTemplate,
    SupportsGeneralTemplateParen,
    SupportsGeneralTemplateSquare,
    SupportsGeneralTemplateBrace,
    SupportsGeneralTemplateDoubleQuoted,
    SupportsGeneralTemplateSingleQuoted,
    SupportsGeneralEnclosed,
    SupportsFeature,
    SupportsInParens,
    SupportsNotKeyword,
    SupportsAndOrKeyword,
    SupportsCondition,
    SupportsPrelude,
    StaticMediaPrelude,
    StaticAtPrelude,
    StaticAtPreludeAtom,
    StaticAtPreludeParen,
    StaticAtPreludeSquare,
    StaticAtPreludeDoubleQuoted,
    StaticAtPreludeSingleQuoted,
    AtRuleStatement,
    AtRootPrelude,
    AtRootFilterPrelude,
    AtRootBlock,
    AtRootFilter,
    ScopeBlock,
    NestedScopeBlock,
    ConditionalBlock,
    StartingStyleBlock,
    LayerBlock,
    DocumentBlock,
    PageMarginBox,
    PageBlock,
    FontFeatureValueBlock,
    FontFeatureValuesBlock,
    NestedConditionalBlock,
    NestedStartingStyleBlock,
    NestedLayerBlock,
    FontFace,
    CounterStyle,
    PropertyName,
    PropertyAtRule,
    KeyframeSelector,
    KeyframeBlock,
    Keyframes,
    OpaqueAtPrelude,
    OpaqueBody,
    OpaqueAtRuleBlock,
    OpaqueAtRuleStatement,
    Simple,
    InterpolatedSimple,
    Placeholder,
    Attribute,
    PseudoArgument,
    StaticSelectorPseudoArgument,
    StaticSelectorPseudoItem,
    StaticSelectorPseudoTail,
    StaticPseudoArgument,
    StaticPseudoGroup,
    StaticPseudoSquare,
    PseudoSelector,
    NestingSelector,
    Compound,
    ComplexTail,
    Complex,
    RelativeComplex,
    SelectorTail,
    Selector,
    NestedSelectorTail,
    NestedSelector,
    Extend,
    Ruleset,
    NestedRuleset,
    rw: whitespace,
    whitespace
  };
};

export const scssGrammar: Record<keyof ScssRules, FusedRule> = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<ScssRules>(
  { trivia: whitespace, scanSkip: [blockComment, lineComment, scssScanSkipDoubleString, scssScanSkipSingleString] },
  scssFactory
)]);

export const scssAstGrammar = scssGrammar;

export const scssLineGrammar: Record<keyof ScssRules, FusedRule> = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<ScssRules>(
  { trivia: whitespace, scanSkip: [blockComment, lineComment, scssScanSkipDoubleString, scssScanSkipSingleString], trackLines: true },
  scssFactory
)]);

export const scssAstLineGrammar = scssLineGrammar;

export const scssCstGrammar: Record<keyof ScssRules, FusedRule> = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<ScssRules>(
  { trivia: whitespace, scanSkip: [blockComment, lineComment, scssScanSkipDoubleString, scssScanSkipSingleString], hostMode: 'cst' },
  scssFactory
)]);

export const scssDiagnosticCstGrammar: Record<keyof ScssRules, FusedRule> = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<ScssRules>(
  { trivia: whitespace, scanSkip: [blockComment, lineComment, scssScanSkipDoubleString, scssScanSkipSingleString], hostMode: 'cst', trackLines: true },
  scssFactory
)]);

export type ScssGrammarOptions = {
  readonly cst?: boolean;
  readonly trackLines?: boolean;
};

export function scssGrammarFor(options: ScssGrammarOptions = {}) {
  if (options.cst) {
    return options.trackLines ? scssDiagnosticCstGrammar : scssCstGrammar;
  }
  return options.trackLines ? scssAstLineGrammar : scssAstGrammar;
}
