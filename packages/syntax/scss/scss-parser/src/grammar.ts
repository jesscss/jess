/**
 * Canonical SCSS host-mode grammar.
 *
 * CSS base: ../../../css/css-parser/src/grammar.ts
 *
 * SCSS adds and overrides:
 * - $variables, Sass interpolation, modules, mixins, functions, control rules,
 *   placeholder selectors, @extend, and Sass import/use/forward forms.
 * - SCSS-specific expression, map/list, nested-property, and selector syntax.
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
import { anonymousMixin, any, atRuleBlock, atRuleStatement, block, collection, color, comment, complexSelector, compoundSelectorOf, decl, dimension, forNode, funcCall, generalEnclosed, ifNode, importAtRule, interpolation, interpolatedSimpleSelector, keyword, list, mixinCall, mixinDef, moduleImport, opaqueAtRuleBlock, operation, pseudoSelector, quoted, range, reference, stylesheet, rule, selist, simpleSelector, spaced, styleImport, url, variableDeclaration, variableReference, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { AtRuleBlock, AtRuleStatement, Collection, Color, Comment, ComplexSelector, CompoundSelector, Declaration, Dimension, ExtendInstruction, For, ForBinding, FunctionCall, GeneralEnclosed, GuardNode, If, IfBranch, ImportAtRule, Interpolation, Keyword, MixinCall, MixinDef, ModuleImport, OpaqueAtRuleBlock, Param, Quoted, Reference, ReferenceStep, Stylesheet, Rule, SelectorList, SimpleSelector, SimpleToken, Statement, StyleImport, Url, ValueNode, ValueSlot, VariableDeclaration, VariableReference } from '@jesscss/core/ast';

type Token = { readonly value: string };
type ScssValuePair = { readonly separator: string; readonly value: ValueSlot };
type ScssValueTail = { readonly kind: 'space' | 'slash'; readonly value: ValueNode; readonly separator: string };
type ScssCallArg = { readonly value: ValueSlot; readonly name?: string; readonly spread?: boolean };
type ScssComplexTail = { readonly comb: ' ' | '>' | '+' | '~' | '||'; readonly compound: CompoundSelector };

const scriptModuleExtensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json'] as const;

function isScriptModulePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return scriptModuleExtensions.some(extension => normalized.slice(-extension.length) === extension);
}

type ScssRules = {
  Stylesheet: Combinator<Stylesheet>;
  VariableDeclaration: Combinator<VariableDeclaration>;
  DirectScssComment: Combinator<Comment>;
  DirectScssVarReference: Combinator<VariableReference>;
  SassInterpolation: Combinator<Interpolation>;
  DirectScssQuoted: Combinator<Quoted | Interpolation>;
  DirectScssStaticQuoted: Combinator<Quoted>;
  Keyword: Combinator<Keyword>;
  DirectScssCustomPropertyValue: Combinator<Keyword>;
  Color: Combinator<Color>;
  DirectScssUnicodeRange: Combinator<ValueNode>;
  Dimension: Combinator<Dimension>;
  DirectScssInterpolatedUrlValue: Combinator<Interpolation>;
  DirectScssInterpolatedValue: Combinator<Interpolation>;
  DirectScssParen: Combinator<ValueNode>;
  MapEntry: Combinator<Declaration>;
  Map: Combinator<Collection>;
  DirectScssReturn: Combinator<Declaration>;
  DirectScssFunction: Combinator<VariableDeclaration>;
  DirectScssSquare: Combinator<ValueNode>;
  ScssValueAtom: Combinator<ValueNode>;
  DirectScssMathUnary: Combinator<ValueNode>;
  DirectScssMathProduct: Combinator<ValueNode>;
  DirectScssMathSum: Combinator<ValueNode>;
  DirectScssMathTopProduct: Combinator<ValueNode>;
  DirectScssMathTopSum: Combinator<ValueNode>;
  ValueTerm: Combinator<ValueSlot>;
  ValuePair: Combinator<ScssValuePair>;
  Value: Combinator<ValueSlot>;
  DirectScssImportant: Combinator<true>;
  DirectScssInterpolatedProperty: Combinator<Interpolation>;
  DirectScssCustomPropertyName: Combinator<string | Interpolation>;
  DirectScssCustomPart: Combinator<unknown>;
  DirectScssCustomInnerPart: Combinator<unknown>;
  DirectScssCustomParen: Combinator<readonly unknown[]>;
  DirectScssCustomSquare: Combinator<readonly unknown[]>;
  DirectScssCustomCurly: Combinator<readonly unknown[]>;
  DirectScssCustomValue: Combinator<ValueNode>;
  DirectScssCustomDeclaration: Combinator<Declaration>;
  DirectScssDeclaration: Combinator<Declaration>;
  DirectScssStaticNestedPropertyLeaf: Combinator<Declaration>;
  DirectScssStaticNestedProperty: Combinator<Declaration>;
  ScssImport: Combinator<ImportAtRule>;
  DirectScssUseAs: Combinator<string>;
  DirectScssUse: Combinator<StyleImport | ModuleImport>;
  DirectScssForward: Combinator<StyleImport>;
  DirectScssStaticImportUrl: Combinator<Url>;
  DirectScssStaticImportLayer: Combinator<ValueNode>;
  DirectScssStaticImportDeclaration: Combinator<ValueNode>;
  DirectScssStaticImportSupports: Combinator<FunctionCall>;
  DirectScssStaticImportQualifier: Combinator<ValueNode>;
  DirectScssStaticImportMediaFeature: Combinator<ValueNode>;
  DirectScssStaticImportMediaInParens: Combinator<ValueNode>;
  DirectScssStaticImportMediaCondition: Combinator<ValueNode>;
  DirectScssStaticImportMediaOnlyClause: Combinator<ValueNode>;
  DirectScssStaticImportMediaClause: Combinator<ValueNode>;
  DirectScssStaticImportMediaPrelude: Combinator<ValueNode>;
  DirectScssStaticImportTail: Combinator<ValueNode>;
  DirectScssMixinParam: Combinator<Param>;
  DirectScssMixinParams: Combinator<Param[]>;
  ScssMixinCallArg: Combinator<ScssCallArg>;
  DirectScssMixinCall: Combinator<MixinCall>;
  DirectScssMixinDef: Combinator<MixinDef>;
  DirectScssEachName: Combinator<string>;
  DirectScssEachBinding: Combinator<ForBinding>;
  DirectScssEach: Combinator<For>;
  DirectScssFor: Combinator<For>;
  DirectScssIfCondition: Combinator<GuardNode>;
  DirectScssIfAnd: Combinator<GuardNode>;
  DirectScssIfTerm: Combinator<GuardNode>;
  DirectScssIfAtom: Combinator<GuardNode>;
  DirectScssIfComparison: Combinator<GuardNode>;
  DirectScssIfBody: Combinator<Statement[]>;
  DirectScssIfStaticRule: Combinator<Rule>;
  DirectScssIfStaticConditionalBlock: Combinator<AtRuleBlock>;
  DirectScssIf: Combinator<If>;
  DirectScssQueryFeature: Combinator<ValueNode>;
  DirectScssQueryFunction: Combinator<FunctionCall>;
  DirectScssQueryInParens: Combinator<ValueNode>;
  DirectScssQueryCondition: Combinator<ValueNode>;
  DirectScssQueryClause: Combinator<ValueNode>;
  DirectScssQueryPreludeTail: Combinator<ValueNode>;
  DirectScssQueryPrelude: Combinator<ValueNode>;
  DirectScssSupportsAtom: Combinator<ValueNode>;
  DirectScssGeneralTemplate: Combinator<Interpolation>;
  DirectScssGeneralTemplateParen: Combinator<Interpolation>;
  DirectScssGeneralTemplateSquare: Combinator<Interpolation>;
  DirectScssGeneralTemplateBrace: Combinator<Interpolation>;
  DirectScssGeneralTemplateDoubleQuoted: Combinator<Interpolation>;
  DirectScssGeneralTemplateSingleQuoted: Combinator<Interpolation>;
  DirectScssGeneralEnclosed: Combinator<GeneralEnclosed>;
  DirectScssSupportsFeature: Combinator<ValueNode>;
  DirectScssSupportsInParens: Combinator<ValueNode>;
  DirectScssSupportsNot: Combinator<Keyword>;
  DirectScssSupportsAndOr: Combinator<Keyword>;
  DirectScssSupportsCondition: Combinator<ValueNode>;
  DirectScssSupportsPrelude: Combinator<ValueNode>;
  DirectScssStaticMediaPrelude: Combinator<ValueNode>;

  /** Static-only generic CSS header capture for known passthrough blocks. */
  DirectScssStaticAtPrelude: Combinator<ValueNode | null>;
  DirectScssStaticAtPreludeAtom: Combinator<Token>;
  DirectScssStaticAtPreludeParen: Combinator<Token>;
  DirectScssStaticAtPreludeSquare: Combinator<Token>;
  DirectScssStaticAtPreludeDoubleQuoted: Combinator<Token>;
  DirectScssStaticAtPreludeSingleQuoted: Combinator<Token>;
  DirectScssAtRuleStatement: Combinator<AtRuleStatement>;
  DirectScssScopeBlock: Combinator<AtRuleBlock>;
  DirectScssNestedScopeBlock: Combinator<AtRuleBlock>;
  DirectScssConditionalBlock: Combinator<AtRuleBlock>;
  DirectScssStartingStyleBlock: Combinator<AtRuleBlock>;
  DirectScssLayerBlock: Combinator<AtRuleBlock>;

  /** Static `@document` / `@-moz-document` with a frame-one stylesheet body. */
  DirectScssDocumentBlock: Combinator<AtRuleBlock>;
  DirectScssPageMarginBox: Combinator<AtRuleBlock>;
  DirectScssPageBlock: Combinator<AtRuleBlock>;
  DirectScssFontFeatureValueBlock: Combinator<AtRuleBlock>;
  DirectScssFontFeatureValuesBlock: Combinator<AtRuleBlock>;
  DirectScssFontFace: Combinator<AtRuleBlock>;
  DirectScssCounterStyle: Combinator<AtRuleBlock>;
  DirectScssPropertyName: Combinator<Keyword>;
  DirectScssPropertyAtRule: Combinator<AtRuleBlock>;
  DirectScssKeyframeSelector: Combinator<SimpleSelector>;
  DirectScssKeyframeBlock: Combinator<Rule>;
  DirectScssKeyframes: Combinator<AtRuleBlock>;
  DirectScssNestedConditionalBlock: Combinator<AtRuleBlock>;
  DirectScssNestedStartingStyleBlock: Combinator<AtRuleBlock>;
  DirectScssNestedLayerBlock: Combinator<AtRuleBlock>;
  DirectScssSimple: Combinator<SimpleSelector>;
  DirectScssInterpolatedSimple: Combinator<SimpleSelector>;
  DirectScssPlaceholder: Combinator<SimpleSelector>;
  DirectScssAttribute: Combinator<SimpleSelector>;
  DirectScssPseudoArgument: Combinator<string>;
  DirectScssStaticSelectorPseudoArgument: Combinator<string>;
  DirectScssStaticSelectorPseudoItem: Combinator<string>;
  DirectScssStaticSelectorPseudoTail: Combinator<string>;
  DirectScssStaticPseudoArgument: Combinator<string>;
  DirectScssStaticPseudoGroup: Combinator<string>;
  DirectScssStaticPseudoSquare: Combinator<string>;
  DirectScssPseudo: Combinator<SimpleToken>;
  DirectScssNestingSelector: Combinator<SimpleSelector>;
  DirectScssCompound: Combinator<CompoundSelector>;
  DirectScssComplexTail: Combinator<ScssComplexTail>;
  DirectScssComplex: Combinator<ComplexSelector>;
  DirectScssSelectorTail: Combinator<ComplexSelector>;
  DirectScssSelector: Combinator<SelectorList>;
  DirectScssExtend: Combinator<ExtendInstruction>;
  DirectScssOpaquePrelude: Combinator<string | null>;
  DirectScssOpaqueBody: Combinator<string>;
  DirectScssOpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  DirectScssOpaqueAtRuleStatement: Combinator<AtRuleStatement>;
  DirectScssRule: Combinator<Rule>;
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
    throw new TypeError('Direct SCSS AST grammar produced a non-token child.');
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
    && 'simples' in value && Array.isArray(value.simples)
    && value.simples.every(isSimpleToken);
}

function isComplexSelector(value: unknown): value is ComplexSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'ComplexSelector'
    && 'head' in value && isCompoundSelector(value.head)
    && 'tail' in value && Array.isArray(value.tail);
}

function isSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'SelectorList'
    && 'selectors' in value && Array.isArray(value.selectors)
    && value.selectors.every(isComplexSelector);
}

function requireSelectorList(value: unknown): SelectorList {
  if (!isSelectorList(value)) {
    throw new TypeError('Direct SCSS AST grammar produced a non-selector-list child.');
  }
  return value;
}

function isScssComplexTail(value: unknown): value is ScssComplexTail {
  return typeof value === 'object' && value !== null
    && 'comb' in value && (value.comb === ' ' || value.comb === '>' || value.comb === '+' || value.comb === '~' || value.comb === '||')
    && 'compound' in value && isCompoundSelector(value.compound);
}

function requireScssComplexTail(value: unknown): ScssComplexTail {
  if (!isScssComplexTail(value)) {
    throw new TypeError('Direct SCSS AST grammar produced an invalid selector tail.');
  }
  return value;
}

function requireCompoundSelector(value: unknown): CompoundSelector {
  if (!isCompoundSelector(value)) {
    throw new TypeError('Direct SCSS AST grammar produced a non-compound selector child.');
  }
  return value;
}

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

function requireSimpleToken(value: unknown): SimpleToken {
  if (!isSimpleToken(value)) {
    throw new TypeError('Direct SCSS AST grammar produced a non-simple selector child.');
  }
  return value;
}

function requireComplexSelector(value: unknown): ComplexSelector {
  if (!isComplexSelector(value)) {
    throw new TypeError('Direct SCSS AST grammar produced a non-complex selector child.');
  }
  return value;
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
    throw new TypeError('Direct SCSS AST grammar produced an invalid for binding.');
  }
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Direct SCSS AST grammar produced a non-string child.');
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
    throw new TypeError('Direct SCSS AST grammar produced a non-interpolation child.');
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
    throw new TypeError('Direct SCSS arithmetic grammar produced no operand.');
  }
  let result = first;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 2) {
    const operatorToken = children[index];
    const right = children[index + 1];
    if (operatorToken === undefined || !isValue(right)) {
      throw new TypeError('Direct SCSS arithmetic grammar lost an operator operand.');
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
      return 'inner' in value && isValueSlotValue(value.inner);
    case 'Operation':
      return 'left' in value && 'right' in value && isValue(value.left) && isValue(value.right);
    case 'Keyword':
      return 'src' in value && typeof value.src === 'string';
    case 'Collection':
      return 'entries' in value && Array.isArray(value.entries);
    case 'Reference':
      return 'base' in value && 'steps' in value && Array.isArray(value.steps);
    case 'AnonymousMixin':
      return 'body' in value && Array.isArray(value.body);
    default:
      return false;
  }
}

function valueSlot(value: ValueNode): ValueSlot {
  if (value.type === 'SpacedValue') {
    return value.parts;
  }
  if (value.type === 'Block' && isSpacedValue(value.inner)) {
    return { ...value, inner: value.inner.parts };
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
    throw new TypeError('Direct SCSS AST grammar produced a non-value child.');
  }
  return value;
}

function requireKeyword(value: unknown): Keyword {
  const node = requireValue(value);
  if (node.type !== 'Keyword') {
    throw new TypeError('Direct SCSS AST grammar produced a non-keyword child.');
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

/** A Sass map key lowers to a Collection entry NAME. Collection names are
 *  `string | Interpolation` (leaf identifiers), so identifier, string, dimension,
 *  and interpolation keys lower cleanly; other value keys (colors aside, which
 *  carry a `src`) are unrepresentable as a Collection name and are rejected. */
function mapKeyName(node: ValueNode): string | Interpolation {
  if (node.type === 'Interpolation') {
    return node;
  }
  if (node.type === 'Quoted') {
    return node.value;
  }
  if ('src' in node && typeof node.src === 'string') {
    return node.src;
  }
  throw new TypeError('Unsupported SCSS map key: Collection entry names must be identifiers, strings, dimensions, or interpolations.');
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
    throw new TypeError('Direct SCSS AST grammar produced a non-guard child.');
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
    || isMixinDef(child)
    || isMixinCall(child)
    || isFor(child)
    || isIf(child)
    || isRule(child)
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
      throw new TypeError('Direct SCSS AST grammar produced a non-statement child.');
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
    throw new TypeError('Direct SCSS AST grammar produced a non-statement list.');
  }
  return statements(
    value,
    true
  );
}

function directScssKeyframeSelectorList(children: readonly unknown[]): SelectorList {
  const selectors = children
    .filter((child): child is SimpleSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'SimpleSelector')
    .map(selector => complexSelector([{ compound: compoundSelectorOf([selector]) }]));
  if (selectors.length === 0) {
    throw new TypeError('Direct SCSS keyframe block requires a selector.');
  }
  return selist(...selectors);
}

function scssPseudoName(opener: string): string {
  return opener.slice(-1) === '(' ? opener.slice(0, -1) : opener;
}

/*
 * Sass `//` comments are trivia, not CSS comments: they must be recognized
 * between direct AST facts but must never become a renderable `Comment` node,
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
 * The direct counterpart of the CST grammar's `InterpolatedSelector`: static
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
 * enters the Pseudo / Color / Dimension node frame SPECULATIVELY at every simple
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
 * Declaration and StaticNestedProperty lead their arm with a `choice(interpolated
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
   * makes that rejection atomic in this direct grammar.
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
  const directDoubleQuotedText = regex(/(?:[^"\\#]|\\[\s\S]|#(?!\{))*/);
  const directSingleQuotedText = regex(/(?:[^'\\#]|\\[\s\S]|#(?!\{))*/);
  const DirectScssVarReference = node<VariableReference>(
    'DirectScssVarReference',
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
  const DirectScssQuoted = node<Quoted | Interpolation>(
    'DirectScssQuoted',
    choice(
      sequence(
        literal('"'),
        directDoubleQuotedText,
        literal('"')
      ),
      sequence(
        literal('\''),
        directSingleQuotedText,
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
  const directStaticDoubleQuotedPath = regex(/(?:[^"\\#]|#(?!\{))*/);
  const directStaticSingleQuotedPath = regex(/(?:[^'\\#]|#(?!\{))*/);

  /*
   * `noTrivia`: a module path is literal bytes, so the ambient `//` trivia arm
   * must not reach inside the quotes and swallow `@use "//host/lib"` as a line
   * comment. Both arms are closed regex/literal, so disabling trivia here
   * cannot propagate into a shared rule.
   */
  const DirectScssStaticQuoted = node<Quoted>(
    'DirectScssStaticQuoted',
    choice(
      noTrivia(sequence(
        literal('"'),
        directStaticDoubleQuotedPath,
        literal('"')
      )),
      noTrivia(sequence(
        literal('\''),
        directStaticSingleQuotedPath,
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
    'DirectScssStaticValueQuoted',
    choice(
      noTrivia(sequence(
        literal('"'),
        directDoubleQuotedText,
        literal('"')
      )),
      noTrivia(sequence(
        literal('\''),
        directSingleQuotedText,
        literal('\'')
      ))
    ),
    staticQuoted
  );

  /*
   * Only a block comment is CSS output. A `//` line comment is lexical trivia
   * (see `whitespace`) and is dropped, matching Sass and Less.
   */
  const DirectScssComment = node<Comment>(
    'DirectScssComment',
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
  const DirectScssCustomPropertyValue = node<Keyword>(
    'DirectScssCustomPropertyValue',
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
  const DirectScssUnicodeRange = node<ValueNode>(
    'DirectScssUnicodeRange',
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
  const directScssUrlInterpolatedChunk = regex(/(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F#]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])|#(?!\{))+/);
  const DirectScssInterpolatedUrlValue = node<Interpolation>(
    'DirectScssInterpolatedUrlValue',
    sequence(
      optional(directScssUrlInterpolatedChunk),
      g.SassInterpolation,
      many(choice(
        directScssUrlInterpolatedChunk,
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
  const DirectScssInterpolatedValue = node<Interpolation>(
    'DirectScssInterpolatedValue',
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
  const DirectScssParen = node<ValueNode>(
    'DirectScssParen',
    choice(
      noTrivia(sequence(
        literal('('),
        g.DirectScssMathSum,
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
  const DirectScssSquare = node<ValueNode>(
    'DirectScssSquare',
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
   * to a Collection entry: a leaf-named Declaration.
   */
  const MapEntry = node<Declaration>(
    'MapEntry',
    noTrivia(sequence(
      g.DirectScssMathTopSum,
      optional(valueTrivia),
      literal(':'),
      optional(valueTrivia),
      g.ValueTerm
    )),
    children => decl(
      mapKeyName(requireValue(children[0])),
      requireValueSlot(children[children.length - 1])
    )
  );

  /*
   * A Sass map literal `(a: 1, b: 2)` lowers to the shared `Collection` (the same
   * key/value-entries node used for SCSS nested properties), disambiguated from a
   * paren value-list `(1 2 3)` by the `key: value` entry shape. Empty `()` and a
   * single `(a: 1)` are both maps. This arm sits before `DirectScssParen` in the
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
    children => collection(children.filter(isDeclaration))
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
    'DirectScssUrl',
    sequence(
      routed(),
      optional(choice(
        g.DirectScssQuoted,
        g.DirectScssInterpolatedUrlValue,
        staticUrlInner
      )),
      literal(')')
    ),
    (children) => {
      if (children.length === 2) {
        if (requireToken(children[0]).value.toLowerCase() !== 'url(' || requireToken(children[1]).value !== ')') {
          throw new TypeError('DirectScssUrl produced unexpected children.');
        }
        return url(any(''));
      }
      if (children.length !== 3 || requireToken(children[0]).value.toLowerCase() !== 'url(' || requireToken(children[2]).value !== ')') {
        throw new TypeError('DirectScssUrl produced unexpected children.');
      }
      const body = children[1];
      return url(isValue(body) ? body : any(requireToken(body).value));
    }
  );
  const Call = node<FunctionCall | Reference>(
    'DirectScssCall',
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
   * A bare `#{…}` is already owned by `DirectScssInterpolatedValue`: its
   * trailing `many` matches zero chunks, so an interpolation with no following
   * identifier reduces to the identical `Interpolation` value. A standalone
   * `SassInterpolation` arm after it is therefore unreachable.
   */
  const ScssValueAtom = node<ValueNode>(
    'ScssValueAtom',
    choice(
      g.DirectScssQuoted,
      g.DirectScssInterpolatedValue,
      g.DirectScssVarReference,
      g.Color,
      g.Dimension,
      g.DirectScssCustomPropertyValue,
      g.DirectScssUnicodeRange,
      IdentifierOrFunction,
      g.Map,
      g.DirectScssParen,
      g.DirectScssSquare
    ),
    children => requireValue(children[0])
  );

  /*
   * Signed numerics are one Dimension leaf. Unary signs only own a variable or
   * paren operand here, so `-2px` does not acquire an unnecessary Operation.
   * The sign may have trailing whitespace (`- $x`, `+ ($x)`), but it must be
   * at the current expression start: `1 -2` is still a space-list boundary.
   */
  const DirectScssMathUnary = node<ValueNode>(
    'DirectScssMathUnary',
    choice(
      noTrivia(sequence(
        regex(/-(?=[ \t\n\r\f]*[\$(])/),
        optional(space),
        g.ScssValueAtom
      )),
      noTrivia(sequence(
        regex(/\+(?=[ \t\n\r\f]*[\$(])/),
        optional(space),
        g.ScssValueAtom
      )),
      g.ScssValueAtom
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
  const DirectScssMathProduct = node<ValueNode>(
    'DirectScssMathProduct',
    noTrivia(sequence(
      g.DirectScssMathUnary,
      many(sequence(
        productOperator,
        g.DirectScssMathUnary
      ))
    )),
    foldOperation
  );
  const DirectScssMathSum = node<ValueNode>(
    'DirectScssMathSum',
    noTrivia(sequence(
      g.DirectScssMathProduct,
      many(sequence(
        sumOperator,
        g.DirectScssMathProduct
      ))
    )),
    foldOperation
  );
  const DirectScssMathTopProduct = node<ValueNode>(
    'DirectScssMathTopProduct',
    noTrivia(sequence(
      g.DirectScssMathUnary,
      many(sequence(
        topProductOperator,
        g.DirectScssMathUnary
      ))
    )),
    foldOperation
  );
  const DirectScssMathTopSum = node<ValueNode>(
    'DirectScssMathTopSum',
    noTrivia(sequence(
      g.DirectScssMathTopProduct,
      many(sequence(
        sumOperator,
        g.DirectScssMathTopProduct
      ))
    )),
    foldOperation
  );
  const ValueTail = node<ScssValueTail>(
    'ValueTail',
    choice(
      sequence(
        valueTrivia,
        g.DirectScssMathTopSum
      ),
      sequence(
        optional(space),
        literal('/'),
        optional(space),
        g.DirectScssMathTopSum
      )
    ),
    (children) => {
      if (isValue(children[1])) {
        return { kind: 'space', value: children[1], separator: isToken(children[0]) ? children[0].value : ' ' };
      }
      const value = children[children.length - 1];
      if (!isValue(value)) {
        throw new TypeError('Direct SCSS slash list lost its value.');
      }
      const separators = children.filter(isToken).map(child => child.value).filter(text => text !== '/');
      return { kind: 'slash', value, separator: `${separators[0] ?? ''}/${separators[1] ?? ''}` };
    }
  );
  const ValueTerm = node<ValueSlot>(
    'ValueTerm',
    noTrivia(sequence(
      g.DirectScssMathTopSum,
      many(ValueTail)
    )),
    (children) => {
      const groups: ValueNode[][] = [[requireValue(children[0])]];
      const groupSeparators: string[][] = [[]];
      for (const child of children.slice(1)) {
        if (!isScssValueTail(child)) {
          throw new TypeError('Direct SCSS AST value term produced an invalid list boundary.');
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
          throw new TypeError('Direct SCSS AST value produced a non-list child.');
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
  const DirectScssImportant = node<true>(
    'DirectScssImportant',
    sequence(
      literal('!'),
      g.CssSyntaxImportant
    ),
    (children) => {
      if (children.length !== 2 || requireToken(children[0]).value !== '!') {
        throw new TypeError('DirectScssImportant produced unexpected children.');
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
  const directScssPropertyChunk = regex(/(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
  const DirectScssInterpolatedProperty = node<Interpolation>(
    'DirectScssInterpolatedProperty',
    sequence(
      optional(literal('*')),
      many(directScssPropertyChunk),
      g.SassInterpolation,
      many(choice(
        directScssPropertyChunk,
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
  const DirectScssCustomPropertyName = node<string | Interpolation>(
    'DirectScssCustomPropertyName',
    choice(
      noTrivia(sequence(
        literal('--'),
        many(directScssPropertyChunk),
        g.SassInterpolation,
        many(choice(
          directScssPropertyChunk,
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
  const DirectScssCustomParen = node<readonly unknown[]>(
    'DirectScssCustomParen',
    noTrivia(sequence(
      literal('('),
      many(g.DirectScssCustomInnerPart),
      literal(')')
    )),
    children => children.slice()
  );
  const DirectScssCustomSquare = node<readonly unknown[]>(
    'DirectScssCustomSquare',
    noTrivia(sequence(
      literal('['),
      many(g.DirectScssCustomInnerPart),
      literal(']')
    )),
    children => children.slice()
  );
  const DirectScssCustomCurly = node<readonly unknown[]>(
    'DirectScssCustomCurly',
    noTrivia(sequence(
      literal('{'),
      many(g.DirectScssCustomInnerPart),
      literal('}')
    )),
    children => children.slice()
  );
  const DirectScssCustomInnerPart: Combinator<unknown> = choice(
    g.SassInterpolation,
    g.CssSyntaxCustomInnerContent,
    blockComment,
    g.CssSyntaxCustomSingleQuoted,
    g.CssSyntaxCustomDoubleQuoted,
    g.DirectScssCustomParen,
    g.DirectScssCustomSquare,
    g.DirectScssCustomCurly
  );
  const DirectScssCustomPart: Combinator<unknown> = choice(
    g.SassInterpolation,
    g.CssSyntaxCustomOuterContent,
    blockComment,
    g.CssSyntaxCustomSingleQuoted,
    g.CssSyntaxCustomDoubleQuoted,
    g.DirectScssCustomParen,
    g.DirectScssCustomSquare,
    g.DirectScssCustomCurly
  );
  const DirectScssCustomValue = node<ValueNode>(
    'DirectScssCustomValue',
    noTrivia(many(g.DirectScssCustomPart)),
    children => customValue(children)
  );
  const DirectScssCustomDeclaration = node<Declaration>(
    'DirectScssCustomDeclaration',

    /*
     * A trailing `!important` is declaration priority, not value text: css-syntax-3
     * §5.5.6 strips it before the custom-property original-text step. The shared
     * value leaf already stops before the marker (and before the whitespace
     * preceding it), so this tail simply claims it, exactly like the ordinary
     * declaration tail below.
     */
    sequence(
      g.DirectScssCustomPropertyName,
      literal(':'),
      g.DirectScssCustomValue,
      optional(g.DirectScssImportant),
      optional(literal(';'))
    ),
    (children) => {
      const name = children[0];
      if (typeof name !== 'string' && !isInterpolation(name)) {
        throw new TypeError('Direct SCSS AST grammar produced a custom declaration without a name.');
      }

      /*
       * An interpolated custom-property name is itself a ValueNode, so read the
       * value from its fixed position after the colon rather than by shape.
       */
      const value = children[2];
      if (!isValue(value)) {
        throw new TypeError('Direct SCSS AST grammar produced an incomplete custom declaration.');
      }
      return decl(
        name,
        valueSlot(value),
        null,
        children.includes(true)
      );
    }
  );
  const DirectScssDeclaration = node<Declaration>(
    'DirectScssDeclaration',
    choice(
      g.DirectScssCustomDeclaration,
      sequence(
        choice(
          g.DirectScssInterpolatedProperty,
          propertyName
        ),
        literal(':'),
        g.Value,
        optional(g.DirectScssImportant),
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
        throw new TypeError('DirectScssDeclaration produced unexpected children.');
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
        throw new TypeError('DirectScssDeclaration requires a value.');
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
   * The public CST's nested-property form is compile-time property-prefix syntax, not a
   * runtime container. This direct slice admits static or interpolated property
   * names and declaration-only bodies, then lowers the prefix during grammar reduction to
   * the existing ordered Declaration facts the serializer already owns.
   * The legacy CST also accepts variable and namespaced-variable assignments,
   * @if/@each/@for/@while, and comments in
   * this block.
   * Those are deliberately held here: lowering them needs a typed delayed
   * property-prefix placement fact, not a synthetic container. Recursive
   * nested properties and @extend are not legacy body forms, so this direct
   * grammar does not create extensions for them either.
   */
  const DirectScssStaticNestedPropertyLeaf = node<Declaration>(
    'DirectScssStaticNestedPropertyLeaf',
    sequence(
      choice(
        g.DirectScssInterpolatedProperty,
        propertyName
      ),
      literal(':'),
      g.Value,
      optional(literal(';'))
    ),
    children => decl(
      isInterpolation(children[0]) ? children[0] : requireToken(children[0]).value,
      requireValueSlot(children[2]),
      null,
      false
    )
  );

  /*
   * Cheap zero-width gate so an ordinary declaration (`color: red;`) does not
   * speculatively parse its full value as a nested-property own-value, fail the
   * required block `{`, and backtrack a whole value re-parse before
   * `DirectScssDeclaration` re-parses it. A nested property always opens a block
   * `{` before the statement terminates; this single `not` fails (skipping the
   * arm) only when a `;`/`}` is reachable through non-brace bytes first, i.e.
   * the statement ends before any `{`. `[^{};]` halts at an interpolation's `{`
   * too, so a `#{…}`-bearing declaration still enters (unchanged), and a real
   * nested property is never skipped (its block or own-value `#{` `{` always
   * precedes any terminator). Single `not` is a predicate — it emits no child,
   * so the positional reducer below is unaffected.
   */
  const directNestedPropertyAhead = not(regex(/[^{};]*[;}]/));
  const DirectScssStaticNestedProperty = node<Declaration>(
    'DirectScssStaticNestedProperty',
    choice(sequence(
      directNestedPropertyAhead,
      choice(
        g.DirectScssInterpolatedProperty,
        propertyName
      ),
      literal(':'),
      optional(g.Value),
      literal('{'),
      many(g.DirectScssStaticNestedPropertyLeaf),
      literal('}'),
      optional(g.DirectScssImportant),
      optional(literal(';'))
    )),
    (children) => {
      const prefix = isInterpolation(children[0]) ? children[0] : requireToken(children[0]).value;
      const open = children.findIndex(child => isToken(child) && child.value === '{');
      const close = children.findIndex((child, index) => index > open && isToken(child) && child.value === '}');
      if (open < 0 || close < 0) {
        throw new TypeError('Direct SCSS nested property lost its block delimiters.');
      }
      const ownValue = open > 2 && isValueSlotValue(children[2]) ? children[2] : null;
      const ownImportant = children.includes(true);
      if (ownImportant && ownValue === null) {
        throw new TypeError('Direct SCSS nested property cannot apply !important without an own declaration value.');
      }

      /*
       * The leaf entries stay LEAF-ONLY-named plain Declarations inside a
       * Collection value. Hyphenation and own-value placement move to the
       * serializer; the carrier's own value (when present) rides on `base`.
       */
      const entries: Declaration[] = [];
      for (let index = open + 1; index < close; index++) {
        const child = children[index];
        if (isDeclaration(child)) {
          entries.push(child);
        } else {
          throw new TypeError('Direct SCSS nested property produced a non-declaration child.');
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
  const DirectScssStaticImportUrl = node<Url>(
    'DirectScssStaticImportUrl',

    /*
     * The public CST accepts an empty CSS URL target. Keep that fact explicit
     * rather than treating it as a generic call or a text fallback. The only
     * newly admitted shape here is `url()`; quoted, static unquoted, and
     * interpolation-bearing targets remain their existing structural arms.
     */
    sequence(
      g.CssSyntaxUrlOpen,
      optional(choice(
        g.DirectScssQuoted,
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
  const DirectScssStaticImportLayer = node<ValueNode>(
    'DirectScssStaticImportLayer',
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
  const DirectScssStaticImportDeclaration = node<ValueNode>(
    'DirectScssStaticImportDeclaration',
    sequence(
      propertyName,
      literal(':'),
      g.DirectScssSupportsAtom
    ),
    children => block(operation(
      ':',
      keyword(requireToken(children[0]).value),
      requireValue(children[2])
    ))
  );
  const DirectScssStaticImportSupports = node<FunctionCall>(
    'DirectScssStaticImportSupports',
    sequence(
      noTrivia(sequence(
        regex(/supports(?![-_a-zA-Z0-9\u0080-\uffff])/i),
        literal('(')
      )),
      choice(
        g.DirectScssSupportsCondition,
        g.DirectScssStaticImportDeclaration
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
   * payload to `Any`, which is not a direct AST import fact. This local family
   * admits only the static values and boolean/query forms the canonical nodes
   * already represent.
   */
  const DirectScssStaticImportQualifier = node<ValueNode>(
    'DirectScssStaticImportQualifier',
    choice(
      sequence(
        g.DirectScssStaticImportLayer,
        g.DirectScssStaticImportSupports
      ),
      g.DirectScssStaticImportLayer,
      g.DirectScssStaticImportSupports
    ),
    (children) => {
      const values = children.filter(isValue);
      if (values.length === 0) {
        throw new TypeError('Direct SCSS import qualifier requires typed facts.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectScssStaticImportMediaFeature = node<ValueNode>(
    'DirectScssStaticImportMediaFeature',
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
        g.DirectScssSupportsAtom,
        literal(')')
      ),
      sequence(
        literal('('),
        propertyName,
        g.CssSyntaxQueryComparisonOperator,
        g.DirectScssSupportsAtom,
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
  const DirectScssStaticImportMediaInParens = node<ValueNode>(
    'DirectScssStaticImportMediaInParens',
    choice(
      sequence(
        literal('('),
        g.DirectScssStaticImportMediaCondition,
        literal(')')
      ),
      g.DirectScssStaticImportMediaFeature
    ),
    children => children.length === 1 ? requireValue(children[0]) : block(requireValue(children[1]))
  );
  const DirectScssStaticImportMediaCondition = node<ValueNode>(
    'DirectScssStaticImportMediaCondition',
    choice(
      sequence(
        g.CssSyntaxQueryNot,
        g.DirectScssStaticImportMediaInParens
      ),
      sequence(
        g.DirectScssStaticImportMediaInParens,
        many(sequence(
          g.CssSyntaxQueryAndOr,
          g.DirectScssStaticImportMediaInParens
        ))
      )
    ),
    (children) => {
      const values = keywordizeValues(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectScssStaticImportMediaNonOnlyKeyword = node<Keyword>(
    'DirectScssStaticImportMediaNonOnlyKeyword',
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
  const directScssStaticImportMediaAnd = regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const DirectScssStaticImportMediaOnlyClause = node<ValueNode>(
    'DirectScssStaticImportMediaOnlyClause',
    sequence(
      g.CssSyntaxQueryOnly,
      DirectScssStaticImportMediaNonOnlyKeyword,
      many(sequence(
        directScssStaticImportMediaAnd,
        g.DirectScssStaticImportMediaInParens
      ))
    ),
    children => spaced(keywordizeValues(children))
  );
  const DirectScssStaticImportMediaClause = node<ValueNode>(
    'DirectScssStaticImportMediaClause',
    choice(
      DirectScssStaticImportMediaOnlyClause,
      sequence(
        DirectScssStaticImportMediaNonOnlyKeyword,
        choice(
          sequence(
            directScssStaticImportMediaAnd,
            g.DirectScssStaticImportMediaInParens
          ),
          g.DirectScssStaticImportMediaInParens
        )
      ),
      g.DirectScssStaticImportMediaCondition,
      DirectScssStaticImportMediaNonOnlyKeyword
    ),
    (children) => {
      const values = keywordizeValues(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectScssStaticImportMediaPrelude = node<ValueNode>(
    'DirectScssStaticImportMediaPrelude',
    sequence(
      g.DirectScssStaticImportMediaClause,
      many(sequence(
        literal(','),
        g.DirectScssStaticImportMediaClause
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
  const DirectScssStaticImportTail = node<ValueNode>(
    'DirectScssStaticImportTail',
    choice(
      sequence(
        g.DirectScssStaticImportQualifier,
        g.DirectScssStaticImportMediaPrelude
      ),
      g.DirectScssStaticImportQualifier,
      g.DirectScssStaticImportMediaPrelude
    ),
    (children) => {
      const values = children.filter(isValue).flatMap(value =>
        typeof value === 'object' && value !== null && 'type' in value && value.type === 'SpacedValue'
          ? value.parts
          : [value]);
      if (values.length === 0) {
        throw new TypeError('Direct SCSS static import tail requires a typed value.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const ScssImport = node<ImportAtRule>(
    'ScssImport',
    sequence(
      regex(/@import(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      choice(
        g.DirectScssQuoted,
        g.DirectScssStaticImportUrl
      ),
      optional(g.DirectScssStaticImportTail),
      literal(';')
    ),
    (children) => {
      const targetIndex = children.findIndex(isImportTarget);
      const target = children[targetIndex];
      if (!isImportTarget(target)) {
        throw new TypeError('ScssImport requires a typed target.');
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
  const directScssImportName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const DirectScssUseAs = node<string>(
    'DirectScssUseAs',
    sequence(
      regex(/as(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      choice(
        literal('*'),
        directScssImportName
      )
    ),
    children => requireToken(children[1]).value
  );
  const DirectScssUse = node<StyleImport | ModuleImport>(
    'DirectScssUse',
    sequence(
      regex(/@use(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.DirectScssStaticQuoted,
      optional(g.DirectScssUseAs),
      literal(';')
    ),
    (children) => {
      const path = children[1];
      if (!isQuoted(path)) {
        throw new TypeError('Direct SCSS @use requires a quoted module path.');
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
  const DirectScssForward = node<StyleImport>(
    'DirectScssForward',
    sequence(
      regex(/@forward(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.DirectScssStaticQuoted,
      literal(';')
    ),
    (children) => {
      if (!isQuoted(children[1])) {
        throw new TypeError('Direct SCSS @forward requires a quoted module path.');
      }
      return styleImport(
        children[1],
        'compose',
        null,
        true
      );
    }
  );

  /*
   * The core canonical tree already owns MixinDef/MixinCall and its ordinary
   * parameter/argument binding semantics. This direct SCSS family therefore
   * covers static mixin names, positional/named/default/rest arguments, and
   * bodies made from the direct statements already available below. `@content`,
   * module-qualified calls, and interpolated names remain separate families.
   */
  const directMixinName = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
  const directMixinParamName = scssVarSigilName;
  const DirectScssMixinParam = node<Param>(
    'DirectScssMixinParam',
    choice(
      sequence(
        literal('...'),
        directMixinParamName
      ),
      sequence(
        directMixinParamName,
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
  const DirectScssMixinParams = node<Param[]>(
    'DirectScssMixinParams',
    sequence(
      literal('('),
      optional(sequence(
        g.DirectScssMixinParam,
        many(sequence(
          literal(','),
          g.DirectScssMixinParam
        )),
        optional(literal(','))
      )),
      literal(')')
    ),
    children => children.filter((child): child is Param => typeof child === 'object' && child !== null && !('type' in child) && ('name' in child || 'rest' in child))
  );
  const ScssMixinCallArg = node<ScssCallArg>(
    'ScssMixinCallArg',
    choice(
      sequence(
        directMixinParamName,
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
        throw new TypeError('ScssMixinCallArg requires a value.');
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
  const DirectScssMixinCall = node<MixinCall>(
    'DirectScssMixinCall',
    sequence(
      regex(/@include(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      directMixinName,
      optional(sequence(
        literal('('),
        optional(sequence(
          g.ScssMixinCallArg,
          many(sequence(
            literal(','),
            g.ScssMixinCallArg
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
  const directScssNestedAtStatement = choice(
    g.DirectScssMixinCall,
    g.DirectScssIf,
    g.DirectScssEach,
    g.DirectScssFor,
    g.DirectScssMixinDef,
    g.DirectScssFunction,
    g.DirectScssNestedConditionalBlock,
    g.DirectScssNestedStartingStyleBlock,
    g.DirectScssNestedLayerBlock,
    g.DirectScssNestedScopeBlock,
    g.DirectScssDocumentBlock,
    g.DirectScssPageBlock,
    g.DirectScssFontFeatureValuesBlock,
    g.DirectScssOpaqueAtRuleBlock,
    g.DirectScssOpaqueAtRuleStatement
  );

  /*
   * The `@`-led cluster is tried LAST in every body, after `Rule`. Every cluster
   * arm opens with a literal `@` at-keyword, so it is disjoint from `Rule` (a
   * selector never opens with `@`), from `@keyframes`/`@extend` (distinct
   * at-keywords with no cluster arm), and from every prefix arm (`Declaration`,
   * `StaticNestedProperty`, `VarDeclaration`, `Comment` never open with `@`, and
   * `Import`'s `@use`/`@forward`/`@import` are distinct at-keywords). Because no
   * input can match both the cluster and any arm ahead of it, moving it last is
   * firstMatch-order-preserving (byte-identical) while letting the common
   * non-`@` statements — ordinary rules and `&`-selectors, the bulk of a
   * stylesheet — reach `Rule` without first walking all thirteen at-rule
   * recognizers on a doomed speculation.
   * Declarations (`prop: value`) and nested-property blocks (`prop: { … }`) are
   * by far the most common body statements, so they lead the prefix. Both open
   * on a property token (an identifier, `--custom`, or `#{…}`) that is first-char
   * disjoint from `Comment` (`/`), `Import` (`@`) and `VarDeclaration` (`$`), so
   * no input matches both a leading arm and a following one — the reorder is
   * firstMatch-order-preserving (byte-identical). `StaticNestedProperty` keeps
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
  const directScssNestedBodyPrefix = choice(
    g.DirectScssStaticNestedProperty,
    g.DirectScssDeclaration,
    g.DirectScssComment,
    g.ScssImport,
    g.VariableDeclaration,
    literal(';')
  );

  /* Nested body ending in `Rule` (mixin/each/for/nested-scope bodies). */
  const directScssNestedBody = many(choice(
    directScssNestedBodyPrefix,
    g.DirectScssRule,
    directScssNestedAtStatement
  ));

  /* Nested bubbling at-rule bodies additionally accept `@keyframes` before `Rule`. */
  const directScssNestedKeyframesBody = many(choice(
    directScssNestedBodyPrefix,
    g.DirectScssKeyframes,
    g.DirectScssRule,
    directScssNestedAtStatement
  ));

  /* The ruleset body adds one extra arm (`DirectScssExtend`) before `Rule`. */
  const directScssRuleBody = many(choice(
    directScssNestedBodyPrefix,
    g.DirectScssExtend,
    g.DirectScssRule,
    directScssNestedAtStatement
  ));

  /*
   * Statement-level bubbling at-rule bodies (media/supports/container and the
   * starting-style/layer variant) each list a fixed ordered arm set shared
   * across their own arms; hoist each distinct signature to one combinator.
   */
  const directScssConditionalBody = many(choice(
    g.DirectScssComment,
    g.ScssImport,
    g.DirectScssMixinDef,
    g.DirectScssMixinCall,
    g.DirectScssEach,
    g.DirectScssFor,
    g.DirectScssIf,
    g.DirectScssConditionalBlock,
    g.DirectScssStartingStyleBlock,
    g.DirectScssLayerBlock,
    g.DirectScssScopeBlock,
    g.DirectScssDocumentBlock,
    g.DirectScssPageBlock,
    g.DirectScssFontFeatureValuesBlock,
    g.DirectScssKeyframes,
    g.DirectScssOpaqueAtRuleBlock,
    g.DirectScssOpaqueAtRuleStatement,
    g.DirectScssRule
  ));
  const directScssStartingLayerBody = many(choice(
    g.DirectScssComment,
    g.ScssImport,
    g.DirectScssMixinDef,
    g.DirectScssMixinCall,
    g.DirectScssEach,
    g.DirectScssFor,
    g.DirectScssIf,
    g.DirectScssConditionalBlock,
    g.DirectScssStartingStyleBlock,
    g.DirectScssLayerBlock,
    g.DirectScssDocumentBlock,
    g.DirectScssPageBlock,
    g.DirectScssFontFeatureValuesBlock,
    g.DirectScssKeyframes,
    g.DirectScssOpaqueAtRuleBlock,
    g.DirectScssOpaqueAtRuleStatement,
    g.DirectScssRule
  ));
  const DirectScssMixinDef = node<MixinDef>(
    'DirectScssMixinDef',
    sequence(
      regex(/@mixin(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      directMixinName,
      optional(g.DirectScssMixinParams),
      literal('{'),
      directScssNestedBody,
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
  const DirectScssReturn = node<Declaration>(
    'DirectScssReturn',
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
   * `AnonymousMixin` (with the same `params` shape a MixinDef uses), and `@return`
   * reuses `result:`. The parameter list threads into `AnonymousMixin.params`; an
   * empty/absent list is omitted so the plain-block shape stays monomorphic.
   */
  const DirectScssFunction = node<VariableDeclaration>(
    'DirectScssFunction',
    sequence(
      regex(/@function(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      directMixinName,
      optional(g.DirectScssMixinParams),
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.VariableDeclaration,
        g.DirectScssReturn,
        g.DirectScssIf,
        g.DirectScssEach,
        g.DirectScssFor
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
  const DirectScssEachName = node<string>(
    'DirectScssEachName',
    scssVarSigilName,
    children => requireToken(children[1]).value
  );
  const DirectScssEachBinding = node<ForBinding>(
    'DirectScssEachBinding',
    sequence(
      g.DirectScssEachName,
      many(sequence(
        literal(','),
        g.DirectScssEachName
      ))
    ),
    (children) => {
      const names = children.filter((child): child is string => typeof child === 'string');
      if (names.length === 1) {
        return { kind: 'single', name: names[0]! };
      }
      if (names.length < 2) {
        throw new TypeError('Direct SCSS AST grammar produced an invalid @each binding.');
      }
      return { kind: 'tuple', names: [names[0]!, names[1]!, ...names.slice(2)] };
    }
  );

  /*
   * SCSS comma bindings destructure each iterable value. This is distinct from
   * Jess bracket key/value bindings and Less callback key/index bindings, so it
   * owns the canonical `tuple` pattern rather than borrowing either meaning.
   */
  const DirectScssEach = node<For>(
    'DirectScssEach',
    sequence(
      regex(/@each(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.DirectScssEachBinding,
      regex(/\bin\b/),
      g.Value,
      literal('{'),
      directScssNestedBody,
      literal('}')
    ),
    (children) => {
      const iterable = children.find(isValueSlotValue);
      if (iterable === undefined) {
        throw new TypeError('DirectScssEach requires an iterable.');
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
  const DirectScssFor = node<For>(
    'DirectScssFor',
    sequence(
      regex(/@for(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.DirectScssEachName,

      /*
       * SCSS range bounds use the same top-level arithmetic grammar as the
       * legacy CST (`topSum`). Keep them as ValueNode facts for Range; the
       * evaluator already evaluates both bounds before iterating.
       */
      regex(/from(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.DirectScssMathTopSum,
      choice(
        regex(/through(?![-_a-zA-Z0-9\u0080-\uffff])/i),
        regex(/to(?![-_a-zA-Z0-9\u0080-\uffff])/i)
      ),
      g.DirectScssMathTopSum,
      literal('{'),
      directScssNestedBody,
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
   * Direct SCSS conditionals use the canonical If/GuardNode. Bare truthiness is
   * deliberately still held because the current truth node has Less's exact-
   * true behavior; comparisons have their own existing typed evaluator path.
   */
  const directScssTrue = regex(/true(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const directScssFalse = regex(/false(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const directScssNot = regex(/not(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const directScssAnd = regex(/and(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const directScssOr = regex(/or(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const DirectScssIfComparison = node<GuardNode>(
    'DirectScssIfComparison',
    sequence(
      g.DirectScssMathTopSum,
      choice(
        literal('=='),
        literal('!='),
        literal('>='),
        literal('<='),
        literal('>'),
        literal('<')
      ),
      g.DirectScssMathTopSum
    ),
    (children) => {
      const left = requireValue(children[0]);
      const operator = requireToken(children[1]).value;
      const right = requireValue(children[2]);
      const comparison = { g: 'cmp' as const, op: operator === '==' || operator === '!=' ? '=' : operator, left, right };
      return operator === '!=' ? { g: 'not', inner: comparison } : comparison;
    }
  );
  const DirectScssIfAtom = node<GuardNode>(
    'DirectScssIfAtom',
    choice(
      sequence(
        literal('('),
        g.DirectScssIfCondition,
        literal(')')
      ),
      g.DirectScssIfComparison,
      directScssTrue,
      directScssFalse
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
  const DirectScssIfTerm = node<GuardNode>(
    'DirectScssIfTerm',
    sequence(
      optional(directScssNot),
      g.DirectScssIfAtom
    ),
    (children) => {
      const atom = children.find((child): child is GuardNode => typeof child === 'object' && child !== null && 'g' in child);
      if (atom === undefined) {
        throw new TypeError('Direct SCSS @if term lost its guard.');
      }
      return children.some(child => isToken(child) && child.value.toLowerCase() === 'not')
        ? { g: 'not', inner: atom }
        : atom;
    }
  );
  const DirectScssIfAnd = node<GuardNode>(
    'DirectScssIfAnd',
    sequence(
      g.DirectScssIfTerm,
      many(sequence(
        directScssAnd,
        g.DirectScssIfTerm
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
  const DirectScssIfCondition = node<GuardNode>(
    'DirectScssIfCondition',
    sequence(
      g.DirectScssIfAnd,
      many(sequence(
        directScssOr,
        g.DirectScssIfAnd
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
  const DirectScssIfBody = node<Statement[]>(
    'DirectScssIfBody',
    sequence(
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.ScssImport,
        g.VariableDeclaration,
        g.DirectScssStaticNestedProperty,
        g.DirectScssDeclaration,
        g.DirectScssIfStaticConditionalBlock,
        g.DirectScssDocumentBlock,
        g.DirectScssPageBlock,
        g.DirectScssFontFeatureValuesBlock,
        g.DirectScssMixinDef,
        g.DirectScssMixinCall,
        g.DirectScssEach,
        g.DirectScssFor,
        g.DirectScssIf,
        g.DirectScssIfStaticRule
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
  const DirectScssIfStaticRule = node<Rule>(
    'DirectScssIfStaticRule',
    sequence(
      g.DirectScssSelector,
      g.DirectScssIfBody
    ),
    children => rule(
      requireSelectorList(children[0]),
      requireStatementList(children[1])
    )
  );
  const DirectScssIfStaticConditionalBlock = node<AtRuleBlock>(
    'DirectScssIfStaticConditionalBlock',
    choice(
      sequence(
        supportsAtKeyword,
        g.DirectScssSupportsPrelude,
        g.DirectScssIfBody
      ),
      sequence(
        choice(
          mediaAtKeyword,
          sequence(
            containerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.DirectScssQueryPrelude,
        g.DirectScssIfBody
      ),
      sequence(
        choice(
          mediaAtKeyword,
          sequence(
            containerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.DirectScssStaticMediaPrelude,
        g.DirectScssIfBody
      ),
      sequence(
        startingStyleAtKeyword,
        g.DirectScssStaticAtPrelude,
        g.DirectScssIfBody
      ),
      sequence(
        layerAtKeyword,
        g.DirectScssStaticAtPrelude,
        g.DirectScssIfBody
      )
    ),
    (children) => {
      const body = children[2];
      if (!Array.isArray(body)) {
        throw new TypeError('Direct SCSS conditional block lost its statement body.');
      }
      return atRuleBlock(
        requireToken(children[0]).value,
        optionalValue(children[1]),
        statements(body)
      );
    }
  );
  const DirectScssIf = node<If>(
    'DirectScssIf',
    sequence(
      regex(/@if(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.DirectScssIfCondition,
      g.DirectScssIfBody,
      many(sequence(
        regex(/@else(?![-_a-zA-Z0-9\u0080-\uffff])/i),
        choice(
          sequence(
            regex(/if(?![-_a-zA-Z0-9\u0080-\uffff])/i),
            g.DirectScssIfCondition,
            g.DirectScssIfBody
          ),
          g.DirectScssIfBody
        )
      ))
    ),
    (children) => {
      const branches: IfBranch[] = [{ guard: requireGuardNode(children[1]), body: requireStatementList(children[2]) }];
      for (let index = 3; index < children.length;) {
        /*
         * Every tail begins with @else. An else-if has its literal `if`, guard,
         * and body; a bare else contributes just its body.
         */
        index += 1;
        const child = children[index];
        if (isToken(child) && child.value.toLowerCase() === 'if') {
          branches.push({ guard: requireGuardNode(children[index + 1]), body: requireStatementList(children[index + 2]) });
          index += 3;
        } else {
          branches.push({ guard: null, body: requireStatementList(children[index]) });
          index += 1;
        }
      }
      const first = branches[0];
      if (first === undefined) {
        throw new TypeError('Direct SCSS @if reduction produced no branches.');
      }
      return ifNode([first, ...branches.slice(1)]);
    }
  );

  /*
   * Static conditional-group preludes are structured in the grammar. The public
   * SCSS CST also accepts `#{...}` query preludes for language-service recovery,
   * but direct `parse() -> Stylesheet` intentionally rejects that CST-only form
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
    'DirectScssQueryValue',
    noTrivia(sequence(
      g.DirectScssMathTopSum,
      optional(sequence(
        optional(space),
        literal('/'),
        optional(space),
        g.DirectScssMathTopSum
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
  const directScssQueryComparisonOperator = g.CssSyntaxQueryComparisonOperator;

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
  const DirectScssQueryFeature = node<ValueNode>(
    'DirectScssQueryFeature',
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
        directScssQueryComparisonOperator,
        QueryValue,
        literal(')')
      ),
      sequence(
        literal('('),
        QueryValue,
        directScssQueryComparisonOperator,
        propertyName,
        optional(sequence(
          directScssQueryComparisonOperator,
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
  const DirectScssQueryFunction = node<FunctionCall>(
    'DirectScssQueryFunction',
    sequence(
      g.CssSyntaxQueryFunctionName,
      literal('('),
      scanTo(
        literal(')'),
        { skip: [balanced(
          '(',
          ')'
        ), g.DirectScssQuoted] }
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
  const DirectScssQueryInParens = node<ValueNode>(
    'DirectScssQueryInParens',
    choice(
      sequence(
        literal('('),
        g.DirectScssQueryCondition,
        literal(')')
      ),
      g.DirectScssQueryFeature,
      g.DirectScssQueryFunction
    ),
    children => children.length === 1
      ? requireValue(children[0])
      : block(requireValue(children[1]))
  );
  const DirectScssQueryCondition = node<ValueNode>(
    'DirectScssQueryCondition',
    choice(
      sequence(
        g.CssSyntaxQueryNot,
        g.DirectScssQueryInParens
      ),
      sequence(
        g.DirectScssQueryInParens,
        many(sequence(
          g.CssSyntaxQueryAndOr,
          g.DirectScssQueryInParens
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
   * condition. Keep `not (...)` in DirectScssQueryCondition, where that form
   * is structurally valid.
   */
  const QueryNonOnlyKeyword = node<Keyword>(
    'DirectScssQueryNonOnlyKeyword',
    sequence(
      not(g.CssSyntaxQueryOnly),
      g.Keyword
    ),
    children => requireKeyword(children.at(-1))
  );
  const QueryOnlyClause = node<ValueNode>(
    'DirectScssQueryOnlyClause',
    sequence(
      g.CssSyntaxQueryOnly,
      QueryNonOnlyKeyword,
      many(sequence(
        g.CssSyntaxQueryAndOr,
        g.DirectScssQueryInParens
      ))
    ),
    children => spaced(keywordizeValues(children))
  );
  const DirectScssQueryClause = node<ValueNode>(
    'DirectScssQueryClause',
    choice(
      QueryOnlyClause,
      sequence(
        QueryNonOnlyKeyword,
        optional(g.CssSyntaxQueryAndOr),
        g.DirectScssQueryInParens
      ),
      g.DirectScssQueryCondition,
      QueryNonOnlyKeyword
    ),
    (children) => {
      const values = keywordizeValues(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectScssQueryPreludeTail = node<ValueNode>(
    'DirectScssQueryPreludeTail',
    sequence(
      literal(','),
      g.DirectScssQueryClause
    ),
    children => requireValue(children[1])
  );
  const DirectScssQueryPrelude = node<ValueNode>(
    'DirectScssQueryPrelude',
    sequence(
      g.DirectScssQueryClause,
      many(g.DirectScssQueryPreludeTail)
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
   * function would otherwise reach DirectScssQueryFunction and be lowered to
   * FunctionCall(Any).  Keep this public direct route to facts the canonical
   * AST actually owns; dynamic SCSS values require their own semantic model.
   */
  const DirectScssSupportsAtom = node<ValueNode>(
    'DirectScssSupportsAtom',
    choice(
      StaticValueQuoted,
      g.Color,
      g.Dimension,
      g.DirectScssCustomPropertyValue,
      g.Keyword
    ),
    children => requireValue(children[0])
  );
  const DirectScssGeneralTemplateParen = node<Interpolation>(
    'DirectScssGeneralTemplateParen',
    sequence(
      literal('('),
      g.DirectScssGeneralTemplate,
      literal(')')
    ),
    interpolationFromTemplateChildren
  );
  const DirectScssGeneralTemplateSquare = node<Interpolation>(
    'DirectScssGeneralTemplateSquare',
    sequence(
      literal('['),
      g.DirectScssGeneralTemplate,
      literal(']')
    ),
    interpolationFromTemplateChildren
  );
  const DirectScssGeneralTemplateBrace = node<Interpolation>(
    'DirectScssGeneralTemplateBrace',
    sequence(
      literal('{'),
      g.DirectScssGeneralTemplate,
      literal('}')
    ),
    interpolationFromTemplateChildren
  );
  const DirectScssGeneralTemplateDoubleQuoted = node<Interpolation>(
    'DirectScssGeneralTemplateDoubleQuoted',
    sequence(
      literal('"'),
      g.DirectScssGeneralTemplate,
      literal('"')
    ),
    interpolationFromTemplateChildren
  );
  const DirectScssGeneralTemplateSingleQuoted = node<Interpolation>(
    'DirectScssGeneralTemplateSingleQuoted',
    sequence(
      literal('\''),
      g.DirectScssGeneralTemplate,
      literal('\'')
    ),
    interpolationFromTemplateChildren
  );
  const DirectScssGeneralTemplate = node<Interpolation>(
    'DirectScssGeneralTemplate',
    many(choice(
      g.SassInterpolation,
      g.DirectScssGeneralTemplateParen,
      g.DirectScssGeneralTemplateSquare,
      g.DirectScssGeneralTemplateBrace,
      g.DirectScssGeneralTemplateDoubleQuoted,
      g.DirectScssGeneralTemplateSingleQuoted,
      generalTemplateText
    )),
    interpolationFromTemplateChildren
  );
  const DirectScssGeneralEnclosed = node<GeneralEnclosed>(
    'DirectScssGeneralEnclosed',
    choice(
      sequence(
        g.CssSyntaxKeyword,
        literal('('),
        g.DirectScssGeneralTemplate,
        literal(')')
      ),
      sequence(
        literal('('),
        g.DirectScssGeneralTemplate,
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
  const DirectScssSupportsFeature = node<ValueNode>(
    'DirectScssSupportsFeature',
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
        g.DirectScssSupportsAtom,
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
  const DirectScssSupportsInParens = node<ValueNode>(
    'DirectScssSupportsInParens',
    choice(
      sequence(
        literal('('),
        g.DirectScssSupportsCondition,
        literal(')')
      ),
      g.DirectScssSupportsFeature,
      g.DirectScssGeneralEnclosed
    ),
    (children) => {
      const value = children.find(isValue);
      if (value === undefined) {
        throw new TypeError('Direct SCSS supports parenthesis lost its typed condition.');
      }
      return isValue(children[0]) ? value : block(value);
    }
  );
  const DirectScssSupportsNot = node<Keyword>(
    'DirectScssSupportsNot',
    g.CssSyntaxQueryNot,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectScssSupportsAndOr = node<Keyword>(
    'DirectScssSupportsAndOr',
    g.CssSyntaxQueryAndOr,
    children => keyword(requireToken(children[0]).value)
  );
  const DirectScssSupportsCondition = node<ValueNode>(
    'DirectScssSupportsCondition',
    choice(
      sequence(
        g.DirectScssSupportsNot,
        g.DirectScssSupportsInParens
      ),
      sequence(
        g.DirectScssSupportsInParens,
        many(sequence(
          g.DirectScssSupportsAndOr,
          g.DirectScssSupportsInParens
        ))
      )
    ),
    (children) => {
      const values = children.filter(isValue);
      if (values.length === 0) {
        throw new TypeError('Direct SCSS supports condition lost every typed part.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const DirectScssSupportsPrelude = node<ValueNode>(
    'DirectScssSupportsPrelude',
    g.DirectScssSupportsCondition,
    children => requireValue(children[0])
  );
  const DirectScssStaticMediaPrelude = node<ValueNode>(
    'DirectScssStaticMediaPrelude',
    noTrivia(oneOrMore(g.ScssSyntaxStaticMediaModifier)),
    children => any(children.map(requireToken).map(token => token.value).join('').trim())
  );

  /*
   * CSS's direct grammar retains a known block at-rule's static header as a
   * grammar-owned `Any` when no more specific value model applies. SCSS needs
   * the same lossless fact for `@layer` and `@starting-style`, but must not
   * flatten its `#{…}` form: every atom below reserves that opener, including
   * inside quotes and nested paren/square groups. Dynamic headers remain held
   * until they have an interpolation-bearing prelude model.
   */
  const directScssStaticAtPreludeText = regex(/(?:[^#()\[\]{}'"\\/]|\\[\s\S]|#(?!\{)|\/(?!\*))+/);
  const DirectScssStaticAtPreludeDoubleQuoted = node<Token>(
    'DirectScssStaticAtPreludeDoubleQuoted',
    sequence(
      literal('"'),
      directDoubleQuotedText,
      literal('"')
    ),
    joinTokenValue
  );
  const DirectScssStaticAtPreludeSingleQuoted = node<Token>(
    'DirectScssStaticAtPreludeSingleQuoted',
    sequence(
      literal('\''),
      directSingleQuotedText,
      literal('\'')
    ),
    joinTokenValue
  );
  const DirectScssStaticAtPreludeParen = node<Token>(
    'DirectScssStaticAtPreludeParen',
    sequence(
      literal('('),
      many(g.DirectScssStaticAtPreludeAtom),
      literal(')')
    ),
    joinTokenValue
  );
  const DirectScssStaticAtPreludeSquare = node<Token>(
    'DirectScssStaticAtPreludeSquare',
    sequence(
      literal('['),
      many(g.DirectScssStaticAtPreludeAtom),
      literal(']')
    ),
    joinTokenValue
  );
  const DirectScssStaticAtPreludeAtom = node<Token>(
    'DirectScssStaticAtPreludeAtom',
    choice(
      g.DirectScssStaticAtPreludeParen,
      g.DirectScssStaticAtPreludeSquare,
      g.DirectScssStaticAtPreludeDoubleQuoted,
      g.DirectScssStaticAtPreludeSingleQuoted,
      g.CssSyntaxBlockComment,
      g.ScssSyntaxLineComment,
      directScssStaticAtPreludeText
    ),
    children => ({ value: requireToken(children[0]).value })
  );
  const DirectScssStaticAtPrelude = node<ValueNode | null>(
    'DirectScssStaticAtPrelude',
    noTrivia(many(g.DirectScssStaticAtPreludeAtom)),
    (children) => {
      const text = children.map(requireToken).map(token => token.value).join('').trim();
      return text.length === 0 ? null : any(text);
    }
  );

  /*
   * Statement headers need the same static nested syntax as block headers but
   * must leave their top-level semicolon to the statement production.
   */
  const directScssStaticStatementPreludeText = regex(/(?:[^#;()\[\]{}'"\\/]|\\[\s\S]|#(?!\{)|\/(?![/*]))+/);
  const DirectScssStaticStatementPrelude = node<ValueNode | null>(
    'DirectScssStaticStatementPrelude',
    noTrivia(many(choice(
      g.DirectScssStaticAtPreludeParen,
      g.DirectScssStaticAtPreludeSquare,
      g.DirectScssStaticAtPreludeDoubleQuoted,
      g.DirectScssStaticAtPreludeSingleQuoted,
      g.CssSyntaxBlockComment,
      g.ScssSyntaxLineComment,
      directScssStaticStatementPreludeText
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
  const DirectScssAtRuleStatement = node<AtRuleStatement>(
    'DirectScssAtRuleStatement',
    sequence(
      regex(/@(?:charset|namespace|layer)(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      DirectScssStaticStatementPrelude,
      literal(';')
    ),
    children => atRuleStatement(
      requireToken(children[0]).value,
      optionalValue(children[1])
    )
  );

  /*
   * `@scope` is an existing CSS at-rule fact: its static header remains a
   * grammar-owned prelude and its SCSS body remains typed statements. Dynamic
   * interpolation is intentionally outside DirectScssStaticAtPrelude.
   */
  const DirectScssScopeBlock = node<AtRuleBlock>(
    'DirectScssScopeBlock',
    sequence(
      scopeAtKeyword,
      g.DirectScssStaticAtPrelude,
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.ScssImport,
        g.VariableDeclaration,
        g.DirectScssMixinDef,
        g.DirectScssMixinCall,
        g.DirectScssEach,
        g.DirectScssFor,
        g.DirectScssIf,
        g.DirectScssConditionalBlock,
        g.DirectScssStartingStyleBlock,
        g.DirectScssLayerBlock,
        g.DirectScssScopeBlock,
        g.DirectScssDocumentBlock,
        g.DirectScssPageBlock,
        g.DirectScssFontFeatureValuesBlock,
        g.DirectScssKeyframes,
        g.DirectScssRule
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
  const DirectScssNestedScopeBlock = node<AtRuleBlock>(
    'DirectScssNestedScopeBlock',
    sequence(
      scopeAtKeyword,
      g.DirectScssStaticAtPrelude,
      literal('{'),
      directScssNestedBody,
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
  const DirectScssConditionalBlock = node<AtRuleBlock>(
    'DirectScssConditionalBlock',
    choice(
      sequence(
        supportsAtKeyword,
        g.DirectScssSupportsPrelude,
        literal('{'),
        directScssConditionalBody,
        literal('}')
      ),
      sequence(
        choice(
          mediaAtKeyword,
          sequence(
            containerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.DirectScssQueryPrelude,
        literal('{'),
        directScssConditionalBody,
        literal('}')
      ),
      sequence(
        choice(
          mediaAtKeyword,
          sequence(
            containerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.DirectScssStaticMediaPrelude,
        literal('{'),
        directScssConditionalBody,
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
  const DirectScssStartingStyleBlock = node<AtRuleBlock>(
    'DirectScssStartingStyleBlock',
    sequence(
      startingStyleAtKeyword,
      g.DirectScssStaticAtPrelude,
      literal('{'),
      directScssStartingLayerBody,
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
  const DirectScssLayerBlock = node<AtRuleBlock>(
    'DirectScssLayerBlock',
    sequence(
      layerAtKeyword,
      g.DirectScssStaticAtPrelude,
      literal('{'),
      directScssStartingLayerBody,
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
  const DirectScssDocumentBlock = node<AtRuleBlock>(
    'DirectScssDocumentBlock',
    sequence(
      documentAtKeyword,
      g.DirectScssStaticAtPrelude,
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssMixinDef,
        g.DirectScssMixinCall,
        g.DirectScssEach,
        g.DirectScssFor,
        g.DirectScssIf,
        g.DirectScssConditionalBlock,
        g.DirectScssStartingStyleBlock,
        g.DirectScssLayerBlock,
        g.DirectScssDocumentBlock,
        g.DirectScssPageBlock,
        g.DirectScssFontFeatureValuesBlock,
        g.DirectScssFontFace,
        g.DirectScssCounterStyle,
        g.DirectScssPropertyAtRule,
        g.DirectScssKeyframes,
        g.DirectScssRule
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
  const DirectScssPageMarginBox = node<AtRuleBlock>(
    'DirectScssPageMarginBox',
    sequence(
      g.CssSyntaxMarginAtKeyword,
      many(g.CssSyntaxBlockComment),
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssDeclaration,
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
   * grammar-owned Any, just as the direct CSS route does. `#{...}` remains
   * excluded by DirectScssStaticAtPrelude rather than being flattened.
   */
  const DirectScssPageBlock = node<AtRuleBlock>(
    'DirectScssPageBlock',
    sequence(
      pageAtKeyword,
      g.DirectScssStaticAtPrelude,
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssDeclaration,
        g.DirectScssPageMarginBox,
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
  const DirectScssFontFeatureValueBlock = node<AtRuleBlock>(
    'DirectScssFontFeatureValueBlock',
    sequence(
      g.CssSyntaxFontFeatureValueAtKeyword,
      many(g.CssSyntaxBlockComment),
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssDeclaration,
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
  const DirectScssFontFeatureValuesBlock = node<AtRuleBlock>(
    'DirectScssFontFeatureValuesBlock',
    sequence(
      fontFeatureValuesAtKeyword,
      g.DirectScssStaticAtPrelude,
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssFontFeatureValueBlock
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
  const DirectScssNestedConditionalBlock = node<AtRuleBlock>(
    'DirectScssNestedConditionalBlock',
    choice(
      sequence(
        supportsAtKeyword,
        g.DirectScssSupportsPrelude,
        literal('{'),
        directScssNestedKeyframesBody,
        literal('}')
      ),
      sequence(
        choice(
          mediaAtKeyword,
          sequence(
            containerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.DirectScssQueryPrelude,
        literal('{'),
        directScssNestedKeyframesBody,
        literal('}')
      ),
      sequence(
        choice(
          mediaAtKeyword,
          sequence(
            containerAtKeyword,
            not(g.CssSyntaxQueryOnly)
          )
        ),
        g.DirectScssStaticMediaPrelude,
        literal('{'),
        directScssNestedKeyframesBody,
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
  const DirectScssNestedStartingStyleBlock = node<AtRuleBlock>(
    'DirectScssNestedStartingStyleBlock',
    sequence(
      startingStyleAtKeyword,
      g.DirectScssStaticAtPrelude,
      literal('{'),
      directScssNestedKeyframesBody,
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
  const DirectScssNestedLayerBlock = node<AtRuleBlock>(
    'DirectScssNestedLayerBlock',
    sequence(
      layerAtKeyword,
      g.DirectScssStaticAtPrelude,
      literal('{'),
      directScssNestedKeyframesBody,
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
  const DirectScssFontFace = node<AtRuleBlock>(
    'DirectScssFontFace',
    sequence(
      regex(/@font-face(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssDeclaration
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
  const DirectScssCounterStyle = node<AtRuleBlock>(
    'DirectScssCounterStyle',
    sequence(
      regex(/@counter-style(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.Keyword,
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssDeclaration
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
  const DirectScssPropertyName = node<Keyword>(
    'DirectScssPropertyName',
    noTrivia(sequence(
      literal('--'),
      g.CssSyntaxKeyword
    )),
    children => keyword(`${requireToken(children[0]).value}${requireToken(children[1]).value}`)
  );
  const DirectScssPropertyAtRule = node<AtRuleBlock>(
    'DirectScssPropertyAtRule',
    sequence(
      regex(/@property(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.DirectScssPropertyName,
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssDeclaration
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
   * Keyframes already fit the canonical AtRuleBlock + Rule model: the at-rule
   * name/prelude and every descriptor block remain structured.  Keep this
   * deliberately static at the header and selector boundary; interpolated
   * keyframe names/selectors need typed selector interpolation rather than raw
   * text capture.
   */
  const DirectScssKeyframeSelector = node<SimpleSelector>(
    'DirectScssKeyframeSelector',
    choice(
      keyframeEndpoint,
      keyframePercent
    ),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const DirectScssKeyframeBlock = node<Rule>(
    'DirectScssKeyframeBlock',
    sequence(
      g.DirectScssKeyframeSelector,

      /*
       * Comments are valid selector-list delimiters.  Keep them as grammar
       * facts (and statement comments only when they are actual body items),
       * matching the direct CSS keyframe list without source recovery.
       */
      many(sequence(
        many(g.DirectScssComment),
        literal(','),
        many(g.DirectScssComment),
        g.DirectScssKeyframeSelector
      )),
      many(g.DirectScssComment),
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssDeclaration,
        literal(';')
      )),
      literal('}')
    ),
    children => rule(
      directScssKeyframeSelectorList(children),
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
   * deliberately keeps `DirectScssStaticQuoted` escape-free. They are ordinary
   * static quoted values, so they reuse the escape-preserving
   * `StaticValueQuoted` production (identical grammar and reducer)
   * while still leaving a real `#{` opener for the rejected dynamic path.
   */
  const DirectScssKeyframes = node<AtRuleBlock>(
    'DirectScssKeyframes',
    sequence(
      g.CssSyntaxKeyframesAtKeyword,
      choice(
        g.Keyword,
        StaticValueQuoted
      ),
      literal('{'),
      many(choice(
        g.DirectScssComment,
        g.DirectScssKeyframeBlock
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
  const DirectScssSimple = node<SimpleSelector>(
    'DirectScssSimple',
    g.CssSyntaxSimple,
    children => simpleSelector(requireToken(children[0]).value)
  );
  const DirectScssInterpolatedSimple = node<SimpleSelector>(
    'DirectScssInterpolatedSimple',
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
  const DirectScssPlaceholder = node<SimpleSelector>(
    'DirectScssPlaceholder',
    regex(/%-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/),
    children => simpleSelector(requireToken(children[0]).value)
  );

  /*
   * This is the static CSS-compatible attribute-selector family. The canonical
   * selector tree represents an attribute as one source-faithful SimpleSelector, just
   * as the CSS direct grammar does. Namespaced and interpolation-bearing
   * attributes stay outside this closed slice because their segments need
   * their own typed representation rather than text flattening.
   */
  const DirectScssAttribute = node<SimpleSelector>(
    'DirectScssAttribute',
    sequence(
      literal('['),
      g.CssSyntaxKeyword,
      optional(sequence(
        g.CssSyntaxAttributeOperator,
        choice(

          /*
           * `noTrivia` on the quoted arms only: the attribute itself re-enters
           * the ambient trivia (see the selector production) so `[a = "b"]`
           * keeps its spacing, but the string body must stay literal bytes so
           * `[href="//host"]` is not swallowed by the `//` trivia arm.
           */
          noTrivia(sequence(
            literal('"'),
            directDoubleQuotedText,
            literal('"')
          )),
          noTrivia(sequence(
            literal('\''),
            directSingleQuotedText,
            literal('\'')
          )),
          g.CssSyntaxKeyword
        ),
        optional(g.CssSyntaxAttributeModifier)
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
  const DirectScssPseudoArgument = node<string>(
    'DirectScssPseudoArgument',

    /*
     * A pseudo's selector-valued argument is carried by its containing
     * SimpleSelector text in AST v2, not as a second selector field. Recognize
     * its static grammar here so it remains accepted without giving a nested
     * DirectScssSelector an interpolation escape hatch.
     */
    sequence(
      not(g.CssSyntaxMalformedPseudoNumericArgument),
      g.DirectScssStaticPseudoArgument
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
  const directScssStaticPseudoChunk = regex(/(?:[^()\[\]'"#\/]|#(?!\{)|\/(?!\*))+/);
  const DirectScssStaticPseudoGroup = node<string>(
    'DirectScssStaticPseudoGroup',
    sequence(
      literal('('),
      many(choice(
        g.DirectScssStaticPseudoGroup,
        g.DirectScssStaticPseudoSquare,
        StaticValueQuoted,
        g.CssSyntaxBlockComment,
        directScssStaticPseudoChunk
      )),
      literal(')')
    ),
    joinSourceText
  );
  const DirectScssStaticPseudoSquare = node<string>(
    'DirectScssStaticPseudoSquare',
    sequence(
      literal('['),
      many(choice(
        g.DirectScssStaticPseudoGroup,
        g.DirectScssStaticPseudoSquare,
        StaticValueQuoted,
        g.CssSyntaxBlockComment,
        directScssStaticPseudoChunk
      )),
      literal(']')
    ),
    joinSourceText
  );
  const DirectScssStaticPseudoArgument = node<string>(
    'DirectScssStaticPseudoArgument',
    oneOrMore(choice(
      g.DirectScssStaticPseudoGroup,
      g.DirectScssStaticPseudoSquare,
      StaticValueQuoted,
      g.CssSyntaxBlockComment,
      directScssStaticPseudoChunk
    )),
    joinSourceText
  );

  /*
   * Selector-valued pseudo arguments are still text inside the containing
   * SimpleSelector, but their top-level commas have the established canonical
   * selector spelling (no following whitespace). Keep that grammar-owned
   * normalization separate from generic functional pseudo arguments.
   */
  const directScssStaticSelectorPseudoChunk = regex(/(?:[^(),\[\]'"#\/]|#(?!\{)|\/(?!\*))+/);
  const DirectScssStaticSelectorPseudoItem = node<string>(
    'DirectScssStaticSelectorPseudoItem',
    oneOrMore(choice(
      g.DirectScssStaticPseudoGroup,
      g.DirectScssStaticPseudoSquare,
      StaticValueQuoted,
      g.CssSyntaxBlockComment,
      directScssStaticSelectorPseudoChunk
    )),
    joinSourceText
  );
  const DirectScssStaticSelectorPseudoTail = node<string>(
    'DirectScssStaticSelectorPseudoTail',
    sequence(
      literal(','),
      optional(space),
      g.DirectScssStaticSelectorPseudoItem
    ),
    children => `,${requireString(children.at(-1))}`
  );
  const DirectScssStaticSelectorPseudoArgument = node<string>(
    'DirectScssStaticSelectorPseudoArgument',
    sequence(
      g.DirectScssStaticSelectorPseudoItem,
      many(g.DirectScssStaticSelectorPseudoTail)
    ),
    joinSourceText
  );

  /*
   * Pseudos share a glued `:name` / `:name(` opener. Route it once, then let the
   * selected branch own that opener through `routed()` so the public
   * `DirectScss...Pseudo` CST labels keep their source span.
   */
  const pseudoIdentOrFunction = token(noTrivia(sequence(
    pseudoColon,
    g.CssSyntaxKeyword,
    optional(literal('('))
  )));

  /*
   * A relative selector (a `:has()` argument) may open with a child/sibling
   * combinator (`:has(> .b)`). The outer selector grammar forbids a leading
   * combinator, so this pseudo-private complex admits an optional relative one and
   * rides it on the ComplexSelector's `leadingComb`. A leading `||`/`|` is
   * namespace syntax, not a relative combinator, so it is excluded (mirrors the
   * css/less landings).
   */
  const scssRelativeSelectorCombinator = choice(
    literal('>'),
    literal('+'),
    literal('~')
  );
  const DirectScssRelativeComplex = node<ComplexSelector>(
    'DirectScssRelativeComplex',
    parser(
      { trivia: whitespace },
      sequence(
        optional(scssRelativeSelectorCombinator),
        g.DirectScssComplex
      )
    ),
    (children) => {
      const complex = children.find(isComplexSelector);
      if (complex === undefined) {
        throw new TypeError('DirectScssRelativeComplex requires a complex selector.');
      }
      if (children.length === 1) {
        return complex;
      }
      const lead = requireToken(children[0]).value;
      if (lead !== '>' && lead !== '+' && lead !== '~') {
        throw new TypeError('DirectScssRelativeComplex produced an invalid leading combinator.');
      }
      return { ...complex, leadingComb: lead };
    }
  );

  /*
   * The selector-argument pseudos (`:is`/`:where`/`:not`/`:has`/`:matches`) take a
   * selector-ONLY argument: a (relative) selector list with no general-any text
   * fallback, so `:not(2n+1)` fails the selector and rejects the whole pseudo. The
   * non-relative shape reduces identically to `g.DirectScssSelector`; the retained
   * `SelectorList` becomes structured `PseudoSelector.args`, never joined at parse.
   */
  const DirectScssSelectorOnlyPseudoArgument = node<SelectorList>(
    'DirectScssSelectorOnlyPseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        DirectScssRelativeComplex,
        many(sequence(
          literal(','),
          DirectScssRelativeComplex
        ))
      )
    ),
    children => selist(...children.filter(isComplexSelector))
  );
  const NthPseudo = node<SimpleSelector>(
    'DirectScssNthPseudo',

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
      g.DirectScssStaticPseudoArgument,
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
    'DirectScssNthTypePseudo',

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
      g.DirectScssStaticPseudoArgument,
      literal(')')
    ),
    children => simpleSelector(`${requireToken(children[0]).value}${requireString(children.find(child => typeof child === 'string')).trim()})`)
  );
  const StructuredPseudo = node<SimpleToken>(
    'DirectScssStructuredPseudo',

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
          g.DirectScssStaticSelectorPseudoArgument,
          literal(')')
        )),
        'static selector pseudo argument'
      ),
      DirectScssSelectorOnlyPseudoArgument,
      optional(space),
      literal(')')
    ),
    children => pseudoSelector(
      scssPseudoName(requireToken(children[0]).value),
      requireSelectorList(children.find(isSelectorList))
    )
  );
  const GlobalLocalPseudo = node<SimpleSelector>(
    'DirectScssGlobalLocalPseudo',

    /*
       * `:global(…)`/`:local(…)` retain the opaque, comma-normalized selector text
       * inside the containing SimpleSelector — they are sealed and never structured.
        */
    sequence(
      routed(),
      g.DirectScssPseudoArgument,
      literal(')')
    ),
    children => simpleSelector(`${requireToken(children[0]).value}${requireString(children[1])})`)
  );
  const GenericFunctionPseudo = node<SimpleSelector>(
    'DirectScssGenericPseudo',

    /*
       * Generic glued functions remain the general-any class. Known selector and
       * nth families are routed before this branch, so malformed arguments stay
       * committed to the known branch and cannot fall through here.
       */
    sequence(
      routed(),
      g.DirectScssPseudoArgument,
      literal(')')
    ),
    children => simpleSelector(`${requireToken(children[0]).value}${requireString(children[1])})`)
  );
  const GenericBarePseudo = node<SimpleSelector>(
    'DirectScssGenericPseudo',
    routed(),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const DirectScssPseudoDispatch = dispatch(
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
  const DirectScssPseudo = node<SimpleToken>(
    'DirectScssPseudo',
    DirectScssPseudoDispatch,
    children => requireSimpleToken(children.find(isSimpleToken))
  );
  const DirectScssNestingSelector = node<SimpleSelector>(
    'DirectScssNestingSelector',
    literal('&'),
    () => simpleSelector('&')
  );
  const DirectScssCompound = node<CompoundSelector>(
    'DirectScssCompound',
    noTrivia(sequence(
      oneOrMore(choice(
        g.DirectScssNestingSelector,
        parser(
          { trivia: whitespace },
          g.DirectScssAttribute
        ),
        g.DirectScssPseudo,
        g.DirectScssPlaceholder,
        g.DirectScssInterpolatedSimple,
        g.DirectScssSimple
      )),
      not(pseudoColon)
    )),
    children => compoundSelectorOf(children.filter(isSimpleToken))
  );
  const directScssCombinator = choice(
    literal('||'),
    literal('>'),
    literal('+'),
    literal('~')
  );
  const DirectScssComplexTail = node<ScssComplexTail>(
    'DirectScssComplexTail',
    sequence(
      optional(directScssCombinator),
      g.DirectScssCompound
    ),
    (children) => {
      const compound = children.find(isCompoundSelector);
      if (compound === undefined) {
        throw new TypeError('DirectScssComplexTail requires a compound.');
      }
      const combinator = children.find(isToken);
      const comb = combinator?.value ?? ' ';
      if (comb !== ' ' && comb !== '>' && comb !== '+' && comb !== '~' && comb !== '||') {
        throw new TypeError('DirectScssComplexTail produced an invalid combinator.');
      }
      return { comb, compound };
    }
  );
  const DirectScssComplex = node<ComplexSelector>(
    'DirectScssComplex',
    sequence(
      g.DirectScssCompound,
      many(g.DirectScssComplexTail)
    ),
    children => complexSelector([
      { compound: requireCompoundSelector(children[0]) },
      ...children.slice(1).map(requireScssComplexTail).map(tail => ({ comb: tail.comb, compound: tail.compound }))
    ])
  );
  const DirectScssSelectorTail = node<ComplexSelector>(
    'DirectScssSelectorTail',
    sequence(
      literal(','),
      g.DirectScssComplex
    ),
    children => requireComplexSelector(children[1])
  );
  const DirectScssSelector = node<SelectorList>(
    'DirectScssSelector',
    sequence(
      not(sequence(
        g.DirectScssPlaceholder,
        literal(',')
      )),
      g.DirectScssComplex,
      many(g.DirectScssSelectorTail)
    ),
    children => selist(...children.filter((child): child is ComplexSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'ComplexSelector'))
  );

  /*
   * SCSS `@extend` is a rule-body instruction, not a synthetic statement node.
   * Its target stays a typed selector list and is hoisted onto the carrying Rule
   * through the existing canonical extendInstructions field. `!optional` has
   * missing-target diagnostic semantics that the canonical instruction does not
   * yet model, so this direct slice rejects it rather than silently dropping it.
   */
  const DirectScssExtend = node<ExtendInstruction>(
    'DirectScssExtend',
    sequence(
      regex(/@extend(?![-_a-zA-Z0-9\u0080-\uffff])/i),
      g.DirectScssSelector,
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
  const DirectScssOpaquePrelude = node<string | null>(
    'DirectScssOpaquePrelude',
    g.ScssAstOpaqueStaticPrelude,
    (children) => {
      const text = children.length === 0 ? '' : requireToken(children[0]).value.trim();
      return text === '' ? null : text;
    }
  );
  const DirectScssOpaqueBody = node<string>(
    'DirectScssOpaqueBody',
    g.ScssAstOpaqueBody,
    children => children.length === 0 ? '' : requireToken(children[0]).value
  );
  const DirectScssOpaqueAtRuleBlock = node<OpaqueAtRuleBlock>(
    'DirectScssOpaqueAtRuleBlock',
    sequence(
      scssGenericAtRuleName,
      noTrivia(sequence(
        g.DirectScssOpaquePrelude,
        literal('{'),
        g.DirectScssOpaqueBody,
        literal('}')
      ))
    ),
    (children) => {
      const prelude = children[1];
      const rawBody = children[3];
      if ((prelude !== null && typeof prelude !== 'string') || typeof rawBody !== 'string') {
        throw new TypeError('Direct SCSS opaque at-rule lost its grammar-owned raw facts.');
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
  const DirectScssOpaqueAtRuleStatement = node<AtRuleStatement>(
    'DirectScssOpaqueAtRuleStatement',
    sequence(
      scssGenericAtRuleName,
      noTrivia(sequence(
        g.DirectScssOpaquePrelude,
        literal(';')
      ))
    ),
    (children) => {
      const prelude = children[1];
      if (prelude !== null && typeof prelude !== 'string') {
        throw new TypeError('Direct SCSS opaque at-rule statement lost its grammar-owned raw facts.');
      }
      return atRuleStatement(
        requireToken(children[0]).value,
        prelude === null ? null : any(prelude)
      );
    }
  );
  const DirectScssRule = node<Rule>(
    'DirectScssRule',
    sequence(
      g.DirectScssSelector,
      literal('{'),
      directScssRuleBody,
      literal('}')
    ),
    (children) => {
      if (children.length < 3 || requireToken(children[1]).value !== '{' || requireToken(children[children.length - 1]).value !== '}') {
        throw new TypeError('DirectScssRule produced unexpected children.');
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
        g.DirectScssComment,
        g.VariableDeclaration,
        g.DirectScssUse,
        g.DirectScssForward
      )),
      many(choice(
        g.DirectScssComment,
        g.ScssImport,
        g.DirectScssAtRuleStatement,
        g.VariableDeclaration,
        g.DirectScssMixinDef,
        g.DirectScssFunction,
        g.DirectScssMixinCall,
        g.DirectScssEach,
        g.DirectScssFor,
        g.DirectScssIf,
        g.DirectScssConditionalBlock,
        g.DirectScssStartingStyleBlock,
        g.DirectScssLayerBlock,
        g.DirectScssScopeBlock,
        g.DirectScssDocumentBlock,
        g.DirectScssPageBlock,
        g.DirectScssFontFeatureValuesBlock,
        g.DirectScssFontFace,
        g.DirectScssCounterStyle,
        g.DirectScssPropertyAtRule,
        g.DirectScssKeyframes,
        g.DirectScssOpaqueAtRuleBlock,
        g.DirectScssOpaqueAtRuleStatement,
        g.DirectScssRule
      ))
    ),
    children => stylesheet(statements(children.flatMap(child => Array.isArray(child) ? child : [child])))
  );

  return {
    Stylesheet,
    VariableDeclaration,
    DirectScssComment,
    DirectScssVarReference,
    SassInterpolation,
    DirectScssQuoted,
    DirectScssStaticQuoted,
    Keyword,
    DirectScssCustomPropertyValue,
    Color,
    DirectScssUnicodeRange,
    Dimension,
    DirectScssInterpolatedUrlValue,
    DirectScssInterpolatedValue,
    DirectScssParen,
    MapEntry,
    Map,
    DirectScssReturn,
    DirectScssFunction,
    DirectScssSquare,
    ScssValueAtom,
    DirectScssMathUnary,
    DirectScssMathProduct,
    DirectScssMathSum,
    DirectScssMathTopProduct,
    DirectScssMathTopSum,
    ValueTerm,
    ValuePair,
    Value,
    DirectScssImportant,
    DirectScssInterpolatedProperty,
    DirectScssCustomPropertyName,
    DirectScssCustomPart,
    DirectScssCustomInnerPart,
    DirectScssCustomParen,
    DirectScssCustomSquare,
    DirectScssCustomCurly,
    DirectScssCustomValue,
    DirectScssCustomDeclaration,
    DirectScssDeclaration,
    DirectScssStaticNestedPropertyLeaf,
    DirectScssStaticNestedProperty,
    ScssImport,
    DirectScssUseAs,
    DirectScssUse,
    DirectScssForward,
    DirectScssStaticImportUrl,
    DirectScssStaticImportLayer,
    DirectScssStaticImportDeclaration,
    DirectScssStaticImportSupports,
    DirectScssStaticImportQualifier,
    DirectScssStaticImportMediaFeature,
    DirectScssStaticImportMediaInParens,
    DirectScssStaticImportMediaCondition,
    DirectScssStaticImportMediaOnlyClause,
    DirectScssStaticImportMediaClause,
    DirectScssStaticImportMediaPrelude,
    DirectScssStaticImportTail,
    DirectScssMixinParam,
    DirectScssMixinParams,
    ScssMixinCallArg,
    DirectScssMixinCall,
    DirectScssMixinDef,
    DirectScssEachName,
    DirectScssEachBinding,
    DirectScssEach,
    DirectScssFor,
    DirectScssIfCondition,
    DirectScssIfAnd,
    DirectScssIfTerm,
    DirectScssIfAtom,
    DirectScssIfComparison,
    DirectScssIfBody,
    DirectScssIfStaticRule,
    DirectScssIfStaticConditionalBlock,
    DirectScssIf,
    DirectScssQueryFeature,
    DirectScssQueryFunction,
    DirectScssQueryInParens,
    DirectScssQueryCondition,
    DirectScssQueryClause,
    DirectScssQueryPreludeTail,
    DirectScssQueryPrelude,
    DirectScssSupportsAtom,
    DirectScssGeneralTemplate,
    DirectScssGeneralTemplateParen,
    DirectScssGeneralTemplateSquare,
    DirectScssGeneralTemplateBrace,
    DirectScssGeneralTemplateDoubleQuoted,
    DirectScssGeneralTemplateSingleQuoted,
    DirectScssGeneralEnclosed,
    DirectScssSupportsFeature,
    DirectScssSupportsInParens,
    DirectScssSupportsNot,
    DirectScssSupportsAndOr,
    DirectScssSupportsCondition,
    DirectScssSupportsPrelude,
    DirectScssStaticMediaPrelude,
    DirectScssStaticAtPrelude,
    DirectScssStaticAtPreludeAtom,
    DirectScssStaticAtPreludeParen,
    DirectScssStaticAtPreludeSquare,
    DirectScssStaticAtPreludeDoubleQuoted,
    DirectScssStaticAtPreludeSingleQuoted,
    DirectScssAtRuleStatement,
    DirectScssScopeBlock,
    DirectScssNestedScopeBlock,
    DirectScssConditionalBlock,
    DirectScssStartingStyleBlock,
    DirectScssLayerBlock,
    DirectScssDocumentBlock,
    DirectScssPageMarginBox,
    DirectScssPageBlock,
    DirectScssFontFeatureValueBlock,
    DirectScssFontFeatureValuesBlock,
    DirectScssNestedConditionalBlock,
    DirectScssNestedStartingStyleBlock,
    DirectScssNestedLayerBlock,
    DirectScssFontFace,
    DirectScssCounterStyle,
    DirectScssPropertyName,
    DirectScssPropertyAtRule,
    DirectScssKeyframeSelector,
    DirectScssKeyframeBlock,
    DirectScssKeyframes,
    DirectScssOpaquePrelude,
    DirectScssOpaqueBody,
    DirectScssOpaqueAtRuleBlock,
    DirectScssOpaqueAtRuleStatement,
    DirectScssSimple,
    DirectScssInterpolatedSimple,
    DirectScssPlaceholder,
    DirectScssAttribute,
    DirectScssPseudoArgument,
    DirectScssStaticSelectorPseudoArgument,
    DirectScssStaticSelectorPseudoItem,
    DirectScssStaticSelectorPseudoTail,
    DirectScssStaticPseudoArgument,
    DirectScssStaticPseudoGroup,
    DirectScssStaticPseudoSquare,
    DirectScssPseudo,
    DirectScssNestingSelector,
    DirectScssCompound,
    DirectScssComplexTail,
    DirectScssComplex,
    DirectScssSelectorTail,
    DirectScssSelector,
    DirectScssExtend,
    DirectScssRule,
    rw: whitespace,
    whitespace
  };
};

export const scssGrammar: Record<keyof ScssRules, FusedRule> = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<ScssRules>(
  { trivia: whitespace, scanSkip: [blockComment, lineComment, scssScanSkipDoubleString, scssScanSkipSingleString] },
  scssFactory
)]);

export const scssAstGrammar = scssGrammar;

export const scssCstGrammar: Record<keyof ScssRules, FusedRule> = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules<ScssRules>(
  { trivia: whitespace, scanSkip: [blockComment, lineComment, scssScanSkipDoubleString, scssScanSkipSingleString], hostMode: 'cst' },
  scssFactory
)]);
