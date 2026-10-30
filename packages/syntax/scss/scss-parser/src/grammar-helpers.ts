/**
 * SCSS grammar reducer helpers, hoisted out of `scss-parser/src/grammar.ts`.
 *
 * These are the module-private helpers the SCSS grammar's `node(...)` reducers
 * call. They lived inside `grammar.ts` as free module scope, which is fine for a
 * standalone `composeLeaf(...)` grammar but not for a COMPOSABLE delta: the
 * parseman compose analyzer can only carry a reducer across a package boundary
 * when every name the reducer reads has import provenance. A free module-private
 * helper has none, so composing `[cssBaseRules, rules(scssDelta)]` refused them.
 * Hoisting them into this importable module gives each one a resolvable import,
 * and the analyzer re-emits those imports into the composing module.
 *
 * These are SCSS's OWN helpers. A helper SCSS shares with another dialect lives
 * in `@jesscss/core/ast` (`css-grammar-helpers.ts`) and is imported from there;
 * the bindings below only supply the SCSS name and value set it is
 * parameterised by.
 */

import { NO_SPAN, any, block, keyword, appendCustomValueParts as appendCustomValuePartsIn, atRuleStatement, branch, callArg, condition, expression, withSourceSpan, isNthArgument, pseudoSelector, simpleSelector, cssBaseMathOutsideParens, importIsCompileTime, importTargetSpelling, sassImportUrlIsPlainCss, spaced, styleImport, customValueFromChildren as customValueFromChildrenIn, funcCall, ifValue, interpolationFromTemplateChildren as interpolationFromTemplateChildrenIn, isAtRuleBlock, isAtRuleStatement, isFor, inParens, isGuardNodeOf, isIf, isInterpolation, isMathOperator, isMixinCall, isMixinDefinition, isModuleImport, isQuoted, isReference, isRuleset, isStaticQuoted, isStyleImport, isToken, isUnknownAtRuleBlock, isValueSlotArray, isValueSlotOf, isWhile, list, operation, quoted, reference, requireForBinding as requireForBindingIn, requireGuardNodeOf, requireInterpolation as requireInterpolationIn, requireSelectorList as requireSelectorListIn, requireString as requireStringIn, requireToken as requireTokenIn, selist, valueLayoutOf, valueSlot, withValueLayout } from '@jesscss/core/ast';
import type { Any, AtRuleStatement, Block, Branch, Operation, CallArg, Collection, CollectionEntry, Color, Comment, Declaration, Dimension, ForBinding, FunctionCall, GuardNode, IfValue, IfValueBranch, Interpolation, Keyword, Lookup, Quoted, Reference, ReferenceStep, SourceSpan, SelectorList, SimpleSelector, SimpleToken, Statement, StyleImport, Token, Url, ValueNode, ValueSlot, VariableDeclaration } from '@jesscss/core/ast';
import { DeprecatedIfFunctionWarning, LeadingSeparatorValueError } from '@jesscss/core/diagnostics';
import { ScssImportPostludeError, type ScssRecoveredError } from './parse-error.js';

export type ScssValuePair = { readonly separator: string; readonly value: ValueSlot };

/** One space-list boundary; `glued` is the operand written straight after a delim (`a=b`'s `b`). */
export type ScssValueTail = { readonly kind: 'space' | 'slash'; readonly value: ValueNode; readonly separator: string; readonly glued: ValueNode | null };

/** One authored call argument. The AST's own {@link CallArg}, not a local
 *  look-alike: a `$name:` argument is the SAME node whether the callee is a
 *  mixin (`@include m($x: 1)`) or a function (`color.adjust($c, $lightness: -10%)`),
 *  and every one is built by `callArg` so the array stays monomorphic. */
export type ScssCallArg = CallArg<ValueSlot>;

/** An argument-list separator carrying the argument it precedes. */
export type ScssArgumentPair = { readonly separator: string; readonly value: ScssCallArg };
export type ScssSegmentCombinator = ' ' | '>' | '+' | '~' | '|' | '||';

/*
 * Core's shared reducer helpers, bound to this grammar: its name is the only
 * part of their error messages that differs between dialects, and
 * `isScssValue` is the value set its guards and value slots accept.
 */
const DIALECT = 'SCSS';
export const requireToken = (value: unknown): Token => requireTokenIn(value, DIALECT);
export const requireString = (value: unknown): string => requireStringIn(value, DIALECT);
export const requireInterpolation = (value: unknown): Interpolation => requireInterpolationIn(value, DIALECT);
export const requireSelectorList = (value: unknown): SelectorList => requireSelectorListIn(value, DIALECT);
export const requireForBinding = (value: unknown): ForBinding => requireForBindingIn(value, DIALECT);
export const requireGuardNode = (value: unknown): GuardNode => requireGuardNodeOf(value, isScssValue, DIALECT);
export const isScssValueSlotValue = (value: unknown): value is ValueSlot => isValueSlotOf(value, isScssValue);
export const interpolationFromTemplateChildren = (children: readonly unknown[]): Interpolation => interpolationFromTemplateChildrenIn(children, DIALECT);

/** A query function's contents: the template when it holds `#{…}`, else the authored text it always was. */
export function queryFunctionContents(child: unknown): ValueNode {
  const template = requireInterpolation(child);
  if (template.parts.some(part => 'ref' in part)) {
    return template;
  }
  let text = '';
  for (const part of template.parts) {
    if ('lit' in part) {
      text += part.lit;
    }
  }
  return any(text);
}
export const customValueFromChildren = (children: readonly unknown[]): Any | Interpolation => customValueFromChildrenIn(children, DIALECT);
export const appendCustomValueParts = (children: readonly unknown[], parts: Interpolation['parts'], seen: { interpolated: boolean }): void => appendCustomValuePartsIn(children, parts, seen, DIALECT);

export const scriptModuleExtensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json'] as const;

export function isScriptModulePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return scriptModuleExtensions.some(extension => normalized.slice(-extension.length) === extension);
}

export function scssSourceText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(scssSourceText).join('');
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null && 'src' in value && typeof value.src === 'string') {
    return value.src;
  }
  return requireToken(value).value;
}

/** Concatenate the authored spelling of every child. The canonical opaque
 *  representation for attribute selectors and non-structured pseudo arguments. */
export function joinSourceText(children: readonly unknown[]): string {
  return children.map(scssSourceText).join('');
}

/** Concatenate every child token value into one opaque static-prelude token. */
export function joinTokenValue(children: readonly unknown[]): Token {
  return { value: children.map(requireToken).map(token => token.value).join('') };
}

/** Shared reducer for a static `"…"` / `'…'` quoted value: the opening quote is
 * `children[0]`, the raw body is `children[1]`, and both the source spelling and
 * decoded body are preserved verbatim (never interpolation). */
export function staticQuoted(children: readonly unknown[]): Quoted {
  const quote = requireToken(children[0]).value;
  const value = requireToken(children[1]).value;
  return quoted(
    `${quote}${value}${quote}`,
    value,
    quote,
    false
  );
}

export function isUrl(value: unknown): value is Url {
  return typeof value === 'object'
    && value !== null
    && 'type' in value && value.type === 'Url'
    && 'value' in value && isScssValue(value.value);
}

export function scssCombinatorText(value: unknown): ' ' | '>' | '+' | '~' | '||' {
  if (isToken(value) && (value.value === '>' || value.value === '+' || value.value === '~' || value.value === '||')) {
    return value.value;
  }
  return ' ';
}

export function scssRelativeCombinator(value: unknown): '>' | '+' | '~' {
  const token = requireToken(value).value;
  if (token === '>' || token === '+') {
    return token;
  }
  return '~';
}

export function isScssImportTarget(value: unknown): value is Quoted | Url | Interpolation {
  return isQuoted(value) || isUrl(value) || isInterpolation(value);
}

/**
 * An `:nth-*()` pseudo from its glued opener (`:nth-child(`) and reduced
 * argument: structured when the argument is an `An+B`, the opaque raw text it
 * always was otherwise.
 */
export function nthPseudoFrom(opener: string, arg: unknown): SimpleToken {
  if (isNthArgument(arg)) {
    return pseudoSelector(opener.slice(0, -1), arg.of, null, null, arg.nth);
  }
  if (typeof arg !== 'string') {
    throw new TypeError('SCSS nth pseudo lost its argument.');
  }
  return simpleSelector(`${opener}${arg.trim()})`);
}

/**
 * `@import "a", "b";` — one at-rule that is several imports (Sass spec
 * `at-rules/import.md`, `ImportRule ::= '@import' ImportArgument (',' ImportArgument)*`).
 * Each argument is its own statement, so the list is carried to the enclosing
 * body as one fact and spread there in source order.
 */
export interface ScssImportListFact {
  readonly kind: 'scss-import-list';
  readonly statements: ReadonlyArray<StyleImport | AtRuleStatement>;
}

export function isScssImportListFact(value: unknown): value is ScssImportListFact {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'scss-import-list';
}

/**
 * `ImportStatement`'s reduction: one import per target. The targets are the
 * run after the at-keyword; a postlude is never a quoted string, `url()` or
 * interpolation (`#{$media}` is rejected there), so the first value after the
 * run is the last target's tail.
 */
export function scssImportStatementFrom(
  children: readonly unknown[],
  span: { readonly start: number; readonly end: number }
): StyleImport | AtRuleStatement | ScssImportListFact {
  let end = 1;
  while (isScssImportTarget(children[end])) {
    end += 1;
  }
  if (end === 1) {
    throw new TypeError('SCSS @import requires a typed target.');
  }
  const tail = children.slice(end).find(isScssValue) ?? null;
  const imports: Array<StyleImport | AtRuleStatement> = [];
  for (let index = 1; index < end; index += 1) {
    const target = children[index];
    if (!isScssImportTarget(target)) {
      continue;
    }
    const postlude = index === end - 1 ? tail : null;
    const spelling = importTargetSpelling(target);
    if (!sassImportUrlIsPlainCss(spelling) && importIsCompileTime('@import', target, null, null, spelling)) {
      if (postlude !== null) {
        throw new ScssImportPostludeError(span.start, span.end);
      }
      imports.push(withSourceSpan(styleImport('@import', target, { mode: 'import' }), span));
    } else {
      imports.push(atRuleStatement('@import', postlude === null ? target : spaced([target, postlude])));
    }
  }
  return imports.length === 1 ? imports[0]! : { kind: 'scss-import-list', statements: imports };
}

export function isVarRef(value: unknown): value is Lookup {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Lookup'
    && 'kind' in value
    && value.kind === 'var'
    && 'name' in value
    && typeof value.name === 'string';
}

export function isColor(value: unknown): value is Color {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Color'
    && 'src' in value
    && typeof value.src === 'string';
}

export function isDimension(value: unknown): value is Dimension {
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

export function isFunctionCall(value: unknown): value is FunctionCall {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'FunctionCall'
    && 'name' in value
    && typeof value.name === 'string'
    && 'args' in value
    && Array.isArray(value.args);
}

/** A math operator with its padding: the operator, and where the two are written. */
export type MathOperatorFact = Token & { readonly start: number; readonly end: number };

export function isMathOperatorFact(value: unknown): value is MathOperatorFact {
  return isToken(value) && 'start' in value && typeof value.start === 'number' && 'end' in value && typeof value.end === 'number';
}

/** `MathProductOperator` / `MathSumOperator`'s reduction: the one operator among its pads. */
export function mathOperatorFact(children: readonly unknown[], _fields: unknown, span: SourceSpan): MathOperatorFact {
  const operator = children.find(child => isToken(child) && isMathOperator(child.value));
  if (!isToken(operator)) {
    throw new TypeError('SCSS math operator lost its operator.');
  }
  return { value: operator.value, start: span.start, end: span.end };
}

/** Fold a grammar-produced left-associative operator chain. Precedence belongs
 * to the caller's product/sum production, never to a source-text recovery.
 *
 * Operands and operator facts arrive in authored order. An operator fact holds
 * its padding, which can hold a comment whose own `/` and `*` would defeat any
 * attempt to recover the operator from the padded text.
 *
 * An operation's span runs from the chain's first operator to the next
 * operator, or to the end of its own: the operands carry no span, and this one
 * is what places an error in the operation at its operator. The fold reads no
 * span of its own, which every value would pay for (a value is a product). */
export function scssFoldOperation(children: readonly unknown[]): ValueNode {
  const firstIndex = children.findIndex(isScssValue);
  const first = children[firstIndex];
  if (!isScssValue(first)) {
    throw new TypeError('SCSS arithmetic grammar produced no operand.');
  }
  let result = first;
  let operator: MathOperatorFact | undefined;
  let start: number | undefined;
  for (let index = firstIndex + 1; index < children.length; index += 1) {
    const child = children[index];
    if (isScssValue(child)) {
      if (operator === undefined) {
        throw new TypeError('SCSS arithmetic grammar lost an operator operand.');
      }
      const next = children[index + 1];
      result = withSourceSpan(operation(
        operator.value,
        result,
        child,
        false,
        cssBaseMathOutsideParens(operator.value)
      ), { start: start ?? operator.start, end: isMathOperatorFact(next) ? next.start : operator.end });
      start ??= operator.start;
      operator = undefined;
      continue;
    }
    if (isMathOperatorFact(child)) {
      operator = child;
    }
  }
  if (operator !== undefined) {
    throw new TypeError('SCSS arithmetic grammar lost an operator operand.');
  }
  return result;
}

/**
 * A Sass paren value. Parens Dart Sass drops when it writes the value are
 * syntax, not part of it (owner 2026-10-22: *"if they drop parens when
 * rendering, then those should be parsed as "escaped" when parsing .scss"*,
 * ledger J16's `.scss` case), so the group is the curly list a Less `~( … )`
 * builds (owner 2026-10-23: *"none of the languages should be parsing to that,
 * it should be the {} list"*), written without its delimiters and read as what
 * it holds:
 * around a list (a comma list, a space list, a list with a trailing comma,
 * `(1,)`), and, outside a math function's arguments, around one value
 * (`(10px)`, `($l)`). Math in a group (`(1 + 2)`), and a group around one value
 * inside a Sass calculation (`calc(2 * ($k))`) or a CSS `if()` condition
 * (`if(css(1) and (css(2)): c)`), whose parens Dart Sass writes, are the paren
 * group J16 reads.
 */
export function parenValue(children: readonly unknown[], state: unknown): Block {
  const value = requireValueSlot(children.find(isScssValueSlotValue));
  if (children.some(child => isToken(child) && child.value === ',')) {
    const items = !isValueSlotArray(value) && value.type === 'List' && value.sep === ',' ? value : list([value], ',');
    return block(items, 'curly', true);
  }
  if (isValueSlotArray(value) || value.type === 'List') {
    return block(value, 'curly', true);
  }
  if (value.type === 'Block' && value.escaped === true) {
    return value;
  }
  return keepsGroup(state) || GROUP_COMPUTES.has(value.type) ? block(value) : block(value, 'curly', true);
}

/* Where Dart Sass writes a group's parens: a Sass calculation's arguments and a CSS `if()` condition. */
const keepsGroup = (state: unknown): boolean => isInCalculation(state) || isIfTest(state);

/**
 * Sass's empty `()`: the empty list, which Dart Sass also accepts wherever a map
 * is expected (owner 2026-10-23: *"a Sass empty `()` would be `{}` (whilst
 * storing the raw, so that Sass functions still work"*). It is the empty curly
 * list, whose span records the authored `()`; `.jess` spells it `{}`. Written
 * where CSS needs a value it fails the compile, as in Dart Sass ("() isn't a
 * valid CSS value"), a CSS `if()` condition and a calculation included.
 */
export const emptyParenList = (): Block => block([], 'curly', true);

/* What a paren group holds when it is math or a test: the group is J16's, which the math reads and consumes. */
const GROUP_COMPUTES: ReadonlySet<string> = new Set(['Operation', 'Expression', 'Condition']);

export function isScssValue(value: unknown): value is ValueNode {
  /*
   * Dispatch on the node tag once instead of re-testing typeof/null/`type` in a
   * flat `||` chain: this predicate runs on essentially every value child via
   * `.find(isScssValue)`/`.filter(isScssValue)`. Each tag maps to exactly one shape
   * check, so the accepted set is identical to the former ordered disjunction.
   */
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  switch (value.type) {
    case 'Quoted':
      return isQuoted(value);
    case 'Lookup':
      /* `$name`, or `&`, the parent selector. */
      return isVarRef(value) || ('kind' in value && value.kind === 'parent');
    case 'Color':
      return isColor(value);
    case 'Dimension':
      return isDimension(value);
    case 'FunctionCall':
      return isFunctionCall(value);
    case 'Interpolation':
      return isInterpolation(value);
    case 'Any':
      return 'src' in value && typeof value.src === 'string';
    case 'Url':
      return 'value' in value && isScssValue(value.value);
    case 'Sequence':
      return 'parts' in value && Array.isArray(value.parts);
    case 'List':
      return 'value' in value && Array.isArray(value.value);
    case 'Block':
    case 'Expression':
      return 'value' in value && isScssValueSlotValue(value.value);
    case 'Operation':
      return 'left' in value && 'right' in value && isScssValue(value.left) && isScssValue(value.right);
    case 'Keyword':
    case 'Null':
      return 'src' in value && typeof value.src === 'string';
    case 'Collection':
    case 'NestedPropertyBlock':
      return 'entries' in value && Array.isArray(value.entries);
    case 'Reference':
      return 'base' in value && 'steps' in value && Array.isArray(value.steps);
    case 'AnonymousMixin':
      return 'rules' in value && Array.isArray(value.rules);
    case 'IfValue':
      return 'branches' in value && Array.isArray(value.branches) && value.branches.length > 0;
    case 'Branch':
      return 'condition' in value && 'value' in value && isScssValueSlotValue(value.condition) && isScssValueSlotValue(value.value);
    case 'Condition':
      return 'guard' in value && isGuardNodeOf(value.guard, isScssValue) && 'src' in value && typeof value.src === 'string';
    default:
      return false;
  }
}

export function requireValueSlot(value: unknown): ValueSlot {
  return Array.isArray(value) ? value as ValueSlot : valueSlot(requireValue(value));
}

export function isScssDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && (typeof value.name === 'string' || isInterpolation(value.name))
    && 'value' in value
    && isScssValueSlotValue(value.value);
}

export function isCollection(value: unknown): value is Collection {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Collection';
}
export function isCollectionEntry(value: unknown): value is CollectionEntry {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'CollectionEntry'
    && 'key' in value
    && isScssValueSlotValue(value.key)
    && 'value' in value
    && isScssValueSlotValue(value.value);
}

export function isComment(value: unknown): value is Comment {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Comment';
}

export function requireValue(value: unknown): ValueNode {
  if (!isScssValue(value)) {
    throw new TypeError('SCSS grammar produced a non-value child.');
  }
  return value;
}

export function requireKeyword(value: unknown): Keyword {
  const node = requireValue(value);
  if (node.type !== 'Keyword') {
    throw new TypeError('SCSS grammar produced a non-keyword child.');
  }
  return node;
}

/** The best-effort authored spelling of a value node for a Reference `raw`. */
export function referenceKeyRaw(node: ValueNode): string {
  if (node.type === 'Lookup' && node.kind === 'var') {
    return typeof node.name === 'string' ? `$${node.name}` : node.raw;
  }
  if (node.type === 'Quoted') {
    return node.src;
  }
  return 'src' in node && typeof node.src === 'string' ? node.src : '';
}

/** The `.jess` spelling of one `@content(…)` argument, used to build the lowered
 *  `$content(…)` Reference `raw`. Same read as {@link referenceKeyRaw}, plus the
 *  `$name:` prefix a named argument carries. */
export function contentArgRaw(arg: ScssCallArg): string {
  const value = isValueSlotArray(arg.value) ? '' : referenceKeyRaw(arg.value);
  return arg.name === undefined ? value : `$${arg.name}: ${value}`;
}

/** `map.get` is the `sass:map` module spelling of the global `map-get`. Both are
 *  the same function, so both lower to the same tree — a grammar that
 *  accepted only one spelling into the accessor form would emit two different
 *  trees for one semantics. */
export const MAP_GET_SPELLINGS = new Set(['map-get', 'map.get']);

/** The comparison spellings a call argument may carry (§4.5.2). Named here so
 * the operator token is found by WHAT IT IS rather than by a child index the
 * optional trivia arms would shift. */
export const COMPARISON_OPERATORS = new Set(['==', '!=', '>=', '<=', '>', '<']);

/**
 * `CallArgument`'s reduction: the operand alone, a keyword argument, or a
 * comparison. A comparison one of whose sides is a run holding a delim SCSS
 * gives no meaning (`a = b < c`) is not read: the whole argument is that css
 * run, written as authored (ledger N18).
 */
export function scssCallArgument(children: readonly unknown[]): ScssCallArg {
  if (children.length === 1) {
    return callArg(requireValueSlot(children[0]));
  }

  /*
   * A comparison operator with no operand on one side compares nothing, so it
   * is the CSS delim it is (`type(<length>)`, `foo(a == )`): the argument is
   * the run.
   */
  const last = children.findLast(child => !isArgumentGap(child));
  if (isComparisonToken(children[0]) || isComparisonToken(last)) {
    return callArg(argumentRun(children));
  }
  const left = requireValueSlot(children[0]);

  /*
   * `$name: value` is a KEYWORD argument (§4.5.2) — the same construct
   * `@include m($x: 1)` already spells, so it is the same {@link CallArg}
   * and the function's own parameter names bind it. It shares the operand
   * with the comparison arm rather than opening a second left-factored
   * lane: the operator tail is parsed ONCE and its spelling decides which
   * reading applies, so a positional argument pays nothing.
   *
   * Only a `$`-sigil variable can be a keyword. Any other operand before a
   * colon is a branch's condition (ledger P38, `if(media(print): 1px)`), which
   * {@link reduceScssCall} keeps where a branch may stand.
   */
  if (children.some(child => isToken(child) && child.value === ':')) {
    /*
     * A branch with no value (`else:`) has the empty value css's `Branch`
     * writes as a bare colon; a keyword with none (`$a:`) binds nothing, so it
     * is the run it is.
     */
    const value = isScssValueSlotValue(last) ? last : undefined;
    if (isValueSlotArray(left) || left.type !== 'Lookup' || left.kind !== 'var' || typeof left.name !== 'string') {
      return callArg(branch(left, value ?? []));
    }
    return value === undefined ? callArg(argumentRun(children)) : callArg(value, left.name, false, '$');
  }
  const at = children.findIndex(child => isToken(child) && !isScssValue(child) && COMPARISON_OPERATORS.has(child.value));
  const operator = requireToken(children[at]).value;
  const right = requireValueSlot(children[children.length - 1]);
  if (holdsDelim(left) || holdsDelim(right)) {
    return callArg(argumentRun(children));
  }

  /*
   * `==` / `!=` lower to the named primitive `sass-equal`, NOT to an
   * operator (§5.1) — the SAME lowering `IfComparison` performs, because a
   * comparison must not mean one thing in a guard and another in an
   * argument. `!=` is that comparison under `not`.
   */
  const comparison = {
    g: 'cmp' as const,
    op: operator === '==' || operator === '!=' ? 'sass-equal' : operator,
    left: requireValue(left),
    right: requireValue(right),
    implied: false,
    parens: 0
  };
  return callArg(expression(condition(
    operator === '!=' ? { g: 'not', inner: comparison, word: 'not', gluedAt: NO_SPAN, parens: 0 } : comparison,
    `${scssConditionSource(left)} ${operator} ${scssConditionSource(right)}`
  )));
}

function isComparisonToken(child: unknown): boolean {
  return isToken(child) && !isScssValue(child) && COMPARISON_OPERATORS.has(child.value);
}

/**
 * A call argument read as the css run of its components: each operator a
 * delim, each operand spliced in, with the padding written before it.
 */
/** The padding a call argument's tokens carry between its parts: a token that is no value, comparison or `:`. */
function isArgumentGap(child: unknown): boolean {
  return isToken(child) && !isScssValue(child) && !COMPARISON_OPERATORS.has(child.value) && child.value !== ':';
}

function argumentRun(children: readonly unknown[]): ValueSlot {
  const values: ValueSlot[] = [];
  const layout: string[] = [];
  let gap = '';
  for (const child of children) {
    if (isArgumentGap(child)) {
      gap = requireToken(child).value;
      continue;
    }
    if (isToken(child) && !isScssValue(child)) {
      appendRun(values, layout, any(child.value), gap);
    } else {
      appendRun(values, layout, requireValueSlot(child), gap);
    }
    gap = '';
  }
  return withValueLayout(values, layout);
}

/**
 * Whether the parse is reading a CSS `if()` condition, where `media()`,
 * `supports()` and `style()` are CSS tests (css-values-5 §8.3), read with
 * css's query grammar, rather than Sass function calls.
 */
export function isIfTest(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'ifTest' in state && state.ifTest === true;
}

/** Whether the parse is inside a math function's arguments (`calc()`, `min()`, …), a Sass calculation. */
export function isInCalculation(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'calculation' in state && state.calculation === true;
}

/** The parse state outside a math function's arguments: unchanged when it was not inside one. */
export function leaveCalculation(state: unknown): unknown {
  return isInCalculation(state) && typeof state === 'object' && state !== null ? { ...state, calculation: false } : state;
}

/** The parse state inside a math function's arguments. */
export function enterCalculation(state: unknown): object {
  return typeof state === 'object' && state !== null ? { ...state, calculation: true } : { calculation: true };
}

/** The parse state inside an `if()` call: its conditions are read as CSS `if()` conditions. */
export function enterIfTest(state: unknown): object {
  return typeof state === 'object' && state !== null ? { ...state, ifTest: true } : { ifTest: true };
}

/** The parse state of a value inside an `if()` call that is not a condition: the state it had outside, unchanged when it was not set. */
export function leaveIfTest(state: unknown): unknown {
  return isIfTest(state) && typeof state === 'object' && state !== null ? { ...state, ifTest: false } : state;
}

/**
 * A problem the grammar recovered from (P45), kept on the run's
 * `state.diagnostics`. A raw-grammar run keeps none, and a reducer can run in
 * an attempt the parser abandons (`div:hover & { … }` is tried as a
 * declaration first), so without a sink the report is dropped, never thrown.
 */
function reportRecovered(error: ScssRecoveredError, state: unknown): void {
  const sink: unknown = typeof state === 'object' && state !== null && 'diagnostics' in state ? state.diagnostics : null;
  if (Array.isArray(sink)) {
    sink.push(error);
  }
}

/**
 * A value led by a `/` or `*` (ledger P33): the separator, then the rest of
 * the value as written, and the error at the value it leads (P45).
 */
export function leadingSeparatorValue(children: readonly unknown[], span: { readonly start: number; readonly end: number }, state: unknown): ValueSlot {
  const operator = any(requireToken(children[0]).value);
  reportRecovered(new LeadingSeparatorValueError(span.start, span.end, operator.src, operator), state);
  return [operator, customValueFromChildren(children.slice(1))];
}

/** A space list holding a delim component — the `Any` a `PunctuationValue` builds. */
function holdsDelim(value: ValueSlot): boolean {
  return isValueSlotArray(value) && value.some(item => !isValueSlotArray(item) && item.type === 'Any');
}

/**
 * Append one component to a run after `separator`, splicing a space list in
 * with its own layout so the run is css's flat one.
 */
function appendRun(values: ValueSlot[], layout: string[], value: ValueSlot, separator: string): void {
  if (values.length > 0) {
    layout.push(separator);
  }
  if (!isValueSlotArray(value)) {
    values.push(value);
    return;
  }
  const inner = valueLayoutOf(value);
  value.forEach((item, index) => {
    if (index > 0) {
      layout.push(inner?.[index - 1] ?? ' ');
    }
    values.push(item);
  });
}

/** `valueSequence`'s reduction: space lists joined by a glued `:` (`progid:DX.M`). */
export function gluedRun(children: readonly unknown[]): ValueSlot {
  const values: ValueSlot[] = [];
  const layout: string[] = [];
  for (const child of children) {
    appendRun(values, layout, requireValueSlot(child), '');
  }
  return withValueLayout(values, layout);
}

/**
 * `ValueTail`'s reduction: a delim glued to what precedes it, padding then a
 * component, or a slash group. The operand written straight after a delim
 * rides along as `glued` (`a=b`'s `b`).
 */
export function scssValueTail(children: readonly unknown[]): ScssValueTail {
  const [first, second, third] = children;
  if (isScssValue(first)) {
    return { kind: 'space', value: first, separator: '', glued: isScssValue(second) ? second : null };
  }
  if (isScssValue(second)) {
    return { kind: 'space', value: second, separator: isToken(first) ? first.value : ' ', glued: isScssValue(third) ? third : null };
  }
  const value = children[children.length - 1];
  if (!isScssValue(value)) {
    throw new TypeError('SCSS slash list lost its value.');
  }
  const separators = children.filter(isToken).map(child => child.value).filter(text => text !== '/');
  return { kind: 'slash', value, separator: `${separators[0] ?? ''}/${separators[1] ?? ''}`, glued: null };
}

/**
 * The key of a `map-get($m, k)` that the shared `$[…]` accessor reads with the
 * same meaning: a word or a string with no interpolation, which `.jess` writes
 * `$m[k]` / `$m["k"]` (ledger P14). Any other key keeps the call, which matches
 * the key by value where it is written. In a `[…]` subscript a number is a
 * position (ledger P15), and a variable or an expression may hold one, so
 * `map.get($m, 1px)` and `map.get($m, $k)` are not `$m[…]` reads.
 */
function isMapGetAccessorKey(key: ValueNode): key is Keyword | Quoted {
  return key.type === 'Keyword' || isStaticQuoted(key);
}

/** Lower `map-get($m, k)` to the shared `$[…]` accessor read `$m[k]`: a Reference
 *  whose single member LookupStep carries the key, compared by value. */
export function lowerMapGet(base: ValueNode, key: Keyword | Quoted): Reference {
  const step: ReferenceStep = { type: 'LookupStep', kind: 'member', name: key };
  const baseRaw = base.type === 'Reference' ? base.raw : referenceKeyRaw(base);
  return reference(
    base,
    [step],
    `${baseRaw}[${referenceKeyRaw(key)}]`
  );
}

/**
 * Lower Sass `if(<cond>, a, b)` to the value-position `$if` (§4.5.3b).
 *
 * It wears call parentheses but it is SYNTAX, not a function (§4.5.3a) — it is
 * branch-lazy and its first argument is a condition, neither of which a
 * `sassFns` entry could express. Lowering it here, in the grammar that knows the
 * dialect, is what lets ONE evaluator answer `if(0, T, F)` with `T` for `.scss`
 * and `F` for `.less`: {@link scssTruth} fixes Sass+'s rule (§4.4.6 — falsy iff
 * `false`, `null`, `""` or `()`) at parse time, Less's grammar fixes its own,
 * and core never learns which dialect a guard came from.
 *
 * Anything but the three-argument form is left an ordinary call — plain CSS
 * `if()` is not this construct.
 */
export function lowerSassIf(args: readonly ScssCallArg[]): IfValue | undefined {
  const cond = args[0]?.value;
  const taken = args[1]?.value;
  const otherwise = args[2]?.value;
  if (args.length !== 3 || cond === undefined || taken === undefined || otherwise === undefined) {
    return undefined;
  }
  return ifValue([
    { guard: scssTruth(cond), value: taken },
    { guard: null, value: otherwise }
  ]);
}

/** A call argument built as a branch, `condition: value` (see {@link scssCallArgument}). */
function isBranchArgument(arg: ScssCallArg | undefined): arg is ScssCallArg & { readonly value: Branch } {
  return arg !== undefined && arg.name === undefined && !isValueSlotArray(arg.value) && arg.value.type === 'Branch';
}

/**
 * A branch where no branch may stand — after a call's first argument, or in a
 * `;` group of a call whose first group is not one — is the css run it is: its
 * condition, the `:` delim and its value (`var(--x, a:b)`, `foo(x, a:b)`), which
 * the compile reports as invalid value punctuation (ledger P48).
 */
function unbranched(arg: ScssCallArg): ScssCallArg {
  if (!isBranchArgument(arg)) {
    return arg;
  }
  const values: ValueSlot[] = [];
  const layout: string[] = [];
  appendRun(values, layout, arg.value.condition, '');
  appendRun(values, layout, any(':'), '');
  appendRun(values, layout, arg.value.value, '');
  return callArg(withValueLayout(values, layout));
}

/** One `;` group of a call's arguments: the comma-separated arguments and the separators between them. */
interface ArgumentGroup {
  readonly args: ScssCallArg[];
  readonly separators: string[];
}

/** A group's arguments as one value: its one argument, or the comma list of them with their authored separators. */
function groupValue(values: readonly ValueSlot[], separators: readonly string[]): ValueSlot {
  if (values.length === 1) {
    return values[0]!;
  }
  return withValueLayout(list([...values], ','), [...separators]);
}

/**
 * A call whose arguments are a branch list (ledger P38): each `;` group a
 * `Branch` when its first argument is one, its value the group's comma list,
 * otherwise the group's comma list. The list is the call's one argument, or the
 * branch itself when there is one; css builds the same.
 */
function branchListCall(name: string, groups: readonly ArgumentGroup[]): FunctionCall {
  const branched = isBranchArgument(groups[0]?.args[0]);
  const items = groups.map((group): ValueSlot => {
    const [lead, ...rest] = group.args;
    if (lead === undefined) {
      return [];
    }
    if (branched && isBranchArgument(lead)) {
      return branch(lead.value.condition, groupValue([lead.value.value, ...rest.map(arg => unbranched(arg).value)], group.separators));
    }
    return groupValue(group.args.map(arg => unbranched(arg).value), group.separators);
  });
  return funcCall(name, [items.length === 1 ? items[0]! : list(items, ';')]);
}

/**
 * CSS `if()` (css-values-5 §8.3, ledger P38) as the value-position conditional
 * Sass's `if()` builds too (owner 2026-10-19: "in .scss, in these cases, i
 * think do what sass does, and parse to the equivalent structure that would be
 * intepreted the same way in .jess"). Each `;` group is a branch: `else` has no
 * condition, any other condition is {@link ifCondition}'s. A group that is not
 * a branch (`if(a: 1; b)`) leaves the call the branch list css writes.
 */
function lowerCssIf(groups: readonly ArgumentGroup[], name: string): IfValue | undefined {
  const branches: IfValueBranch[] = [];
  let trailingSemicolon = false;
  for (const [index, group] of groups.entries()) {
    const [lead, ...rest] = group.args;
    if (lead === undefined && index === groups.length - 1 && index > 0) {
      trailingSemicolon = true;
      continue;
    }
    if (!isBranchArgument(lead)) {
      return undefined;
    }
    const { condition, value } = lead.value;
    branches.push({
      guard: isElse(condition) ? null : ifCondition(condition),
      value: groupValue([value, ...rest.map(arg => unbranched(arg).value)], group.separators)
    });
  }
  const [first, ...others] = branches;
  return first === undefined ? undefined : ifValue([first, ...others], null, trailingSemicolon, name);
}

function isElse(condition: ValueSlot): boolean {
  return !isValueSlotArray(condition) && condition.type === 'Keyword' && condition.src.length === 4 && condition.src.toLowerCase() === 'else';
}

/**
 * A CSS `if()` condition (css-values-5 §8.3 `<if-condition>`), read as Dart
 * Sass reads it: `sass(…)` is SassScript, decided when the stylesheet compiles
 * (Sass's truth test, {@link scssTruth}, or the comparison written in it);
 * `and`, `or`, `not` and a paren group are the condition's own; anything else —
 * a `media()`, `supports()` or `style()` test, whose arguments the grammar kept
 * as written, or any other function — is a CSS test the browser answers. The
 * operand was read as a Sass expression because the `:` after it is what makes
 * it a condition, so this maps that reading onto the condition's.
 */
function ifCondition(value: ValueSlot): GuardNode {
  if (!isValueSlotArray(value)) {
    switch (value.type) {
      case 'FunctionCall': {
        const [arg] = value.args;
        if (value.name === 'sass' && value.args.length === 1 && arg !== undefined && arg.name === undefined && !arg.spread) {
          return sassCondition(arg.value);
        }
        break;
      }
      case 'Operation':
        if (value.operator === 'and' || value.operator === 'or') {
          return { g: value.operator, left: ifCondition(value.left), right: ifCondition(value.right), word: value.operator, gluedAt: NO_SPAN, parens: 0 };
        }
        break;

      /* `AND` / `OR` as authored ({@link foldLogicalOperation}): its operands read as this condition's. */
      case 'Condition': {
        const { guard } = value;
        if ((guard.g === 'and' || guard.g === 'or') && guard.left.g === 'truth' && guard.right.g === 'truth') {
          return { ...guard, left: ifCondition(guard.left.value), right: ifCondition(guard.right.value) };
        }
        break;
      }
      case 'Expression': {
        const negated = value.value;
        if (value._asCall === null && !isValueSlotArray(negated) && negated.type === 'Condition' && negated.guard.g === 'not' && negated.guard.inner.g === 'truth') {
          return { g: 'not', inner: ifCondition(negated.guard.inner.value), word: negated.guard.word, gluedAt: NO_SPAN, parens: 0 };
        }
        break;
      }
      case 'Block':
        if (value.delimiter === 'paren' && value.escaped !== true) {
          return inParens(ifCondition(value.value));
        }
        break;
      default:
        break;
    }
  }
  return { g: 'css', value: isValueSlotArray(value) ? juxtaposedTests(value) : value, parens: 0 };
}

/**
 * A condition whose `and` / `or` stands beside other juxtaposed values
 * (`css(1) and css(2) var(--and) css(3)`), which css-values-5 gives no
 * meaning: Sass's expression folded the keyword into an operation inside the
 * space run, so it is unfolded into the run css builds, each operand and the
 * keyword as written.
 */
function juxtaposedTests(run: readonly ValueSlot[]): ValueSlot {
  const isLogical = (part: ValueSlot): part is Operation => !isValueSlotArray(part) && part.type === 'Operation' && (part.operator === 'and' || part.operator === 'or');
  const unfold = (part: ValueSlot): ValueSlot[] => (isLogical(part) ? [...unfold(part.left), keyword(part.operator), ...unfold(part.right)] : [part]);
  return run.some(isLogical) ? run.flatMap(unfold) : run;
}

/** A `sass()` condition: the comparison or negation written in it, or its value's truth. */
function sassCondition(value: ValueSlot): GuardNode {
  if (!isValueSlotArray(value) && value.type === 'Expression' && value._asCall === null) {
    const inner = value.value;
    if (!isValueSlotArray(inner) && inner.type === 'Condition') {
      return inner.guard;
    }
  }
  return scssTruth(value);
}

/**
 * A call's reduction. `if()` with a branch list is CSS `if()` ({@link
 * lowerCssIf}); any other call with one is css's branch list. Otherwise the
 * arguments are positional or `$name:` keyword arguments, `map-get($m, k)` is
 * the accessor read, and `if($condition, $if-true, $if-false)` is Sass's
 * `if()`, which Dart Sass deprecates: it is evaluated, with a warning at the
 * call.
 */
export function reduceScssCall(name: string, children: readonly unknown[], minArgumentIndex: number, span?: { readonly start: number; readonly end: number }, state?: unknown): FunctionCall | Reference | IfValue {
  const lastIndex = children.length - 1;
  const groups: ArgumentGroup[] = [{ args: [], separators: [] }];
  for (let index = minArgumentIndex + 1; index < lastIndex; index += 1) {
    const child = children[index];
    const group = groups[groups.length - 1]!;
    if (isScssCallArg(child)) {
      group.args.push(child);
    } else if (isScssArgumentPair(child)) {
      group.separators.push(String(child.separator));
      group.args.push(child.value);
    } else if (isToken(child) && child.value === ';') {
      groups.push({ args: [], separators: [] });
    }
  }
  const lowerName = name.toLowerCase();
  if (groups.length > 1 || isBranchArgument(groups[0]!.args[0])) {
    return (lowerName === 'if' ? lowerCssIf(groups, name) : undefined) ?? branchListCall(name, groups);
  }
  const args = groups[0]!.args.map(unbranched);
  const separators = groups[0]!.separators;
  if (lowerName === 'if' && span !== undefined) {
    reportRecovered(new DeprecatedIfFunctionWarning(span.start, span.end), state);
  }
  const call = funcCall(
    name,
    args
  );
  if (MAP_GET_SPELLINGS.has(call.name) && args.length === 2 && isScssValue(args[0]!.value) && isScssValue(args[1]!.value)
    && isMapGetAccessorKey(args[1]!.value)) {
    return lowerMapGet(
      args[0]!.value,
      args[1]!.value
    );
  }
  if (lowerName === 'if') {
    const lowered = lowerSassIf(args);
    if (lowered !== undefined) {
      return lowered;
    }
  }
  if (args.length > 0 && separators.length === args.length - 1) {
    withValueLayout(
      call.args,
      separators
    );
  }
  return call;
}

/** A Sass map key stays an authored value node; equality belongs to value-domain
 * map comparison, not to declaration-name stringification. */
export function mapKeyValue(node: ValueNode): ValueSlot {
  return valueSlot(node);
}

/**
 * The SCSS condition lowering (§4.4.2, as revised by §4.4.6): `@if $x` means
 * `$if($x)` — the SAME truth node `.jess` uses.
 *
 * **Sass+ takes §4.4's emptiness rule** (owner, 2026-08-07): falsy iff `false`,
 * `null`, `""` or `()`. It previously spelled Sass's own rule out —
 * `not(($x == false) or ($x == null))` — to keep `""` and `()` truthy. What
 * forced the change was INTERNAL CONTRADICTION, not reference parity: `or`/`and`
 * lower to jess's native operators (§4.5.5), so `.scss "" or 2` already answered
 * `2` under jess truthiness while `@if ""` took the true branch under Sass's.
 * One dialect, one value, two answers, decided by which construct you wrote.
 *
 * This is why `.scss` must mint the value-domain `Null` (§4.3): with
 * `keyword('null')` in the value lane, `$if($x)` would silently take the TRUE
 * branch for `null`.
 *
 * `.less` is unaffected — `when (@x)` still lowers to `$if($x == true)`.
 */
export function scssTruth(value: ValueSlot): GuardNode {
  return { g: 'truth', value, parens: 0 };
}

/**
 * Sass's `not <value>` — the NEGATION of {@link scssTruth}, i.e. "is `$x`
 * falsy". Under §4.4.6 that is exactly jess's `not($x)`, so it is the truth node
 * under a `not` wrapper and cannot drift from the positive form.
 */
export function scssNegation(value: ValueSlot, word: string): GuardNode {
  return { g: 'not', inner: scssTruth(value), word, gluedAt: NO_SPAN, parens: 0 };
}

/**
 * The authored spelling of a `not` operand, kept so the {@link Condition} it
 * lowers to can replay verbatim when no evaluator is injected. Same job — and
 * the same explicit type list — as the Less grammar's condition source: a shape
 * with no known spelling is a recognition defect, not something to guess at.
 */
export function scssConditionSource(value: ValueSlot): string {
  if (Array.isArray(value)) {
    return value.map(part => scssConditionSource(part)).join(' ');
  }
  const node = requireValue(value);
  switch (node.type) {
    case 'Keyword': case 'Null': case 'Color': case 'Quoted': case 'Any': case 'Dimension': return node.src;
    case 'Lookup': return node.raw;
    case 'Reference': return node.raw;
    case 'Condition': return node.src;

    /*
     * The operand of an OUTER `not` when the inner one already lowered: `not
     * not $x` is `not` applied to the `Expression` the inner `not` produced.
     * The boundary is a computation marker, not authored bytes, so it
     * contributes none of its own — the spelling is the inner condition's, and
     * the outer prefix is prepended by the caller. No case is owed to chained
     * unaries beyond this one: `not` recurses at the unary rung already, so the
     * general rule reaches any depth.
     */
    case 'Expression': return scssConditionSource(node.value);
    case 'FunctionCall': return `${node.name}(${node.args.map(argument => `${argument.name === undefined ? '' : `$${argument.name}: `}${scssConditionSource(argument.value)}`).join(', ')})`;
    case 'Operation': return `${scssConditionSource(node.left)} ${node.operator} ${scssConditionSource(node.right)}`;
    case 'Block': return `${node.delimiter === 'square' ? '[' : '('}${scssConditionSource(node.value)}${node.delimiter === 'square' ? ']' : ')'}`;
    case 'Sequence': return node.parts.map(scssConditionSource).join(' ');
    case 'List': return node.value.map(scssConditionSource).join(node.sep === ',' ? ', ' : ' / ');
    default: throw new TypeError(`SCSS condition cannot preserve ${node.type}.`);
  }
}

/** An `and` / `or` keyword of a CSS `if()` condition, as authored (`AND`). */
export interface ConditionWord {
  readonly conditionWord: string;
}

export function conditionWord(children: readonly unknown[]): ConditionWord {
  return { conditionWord: requireToken(children[0]).value.trim() };
}

function isConditionWord(child: unknown): child is ConditionWord {
  return typeof child === 'object' && child !== null && 'conditionWord' in child;
}

/**
 * Fold one logical rung left-associatively onto `Operation` nodes carrying the
 * word itself as the operator. The operator token is kept out of the fold by
 * shape (only values participate), so the rung reduces the same way whether it
 * spelled `and` or `or`.
 *
 * In a CSS `if()` condition the keyword arrives as authored ({@link
 * ConditionWord}); one not in lower case (`AND`) folds to the condition
 * written as authored ({@link Condition}, its `word` kept, ledger J20), which
 * {@link ifCondition} reads as the condition's own `and` / `or` (ledger P38:
 * "in CSS it comes out as written"). Its truth is Sass's `and` / `or`'s, so a
 * Sass `if()` that consumes it decides as before.
 */
export function foldLogicalOperation(children: readonly unknown[]): ValueNode {
  const values = children.filter(isScssValue);
  const words: string[] = [];
  for (const child of children) {
    if (isConditionWord(child)) {
      words.push(child.conditionWord);
    } else if (isToken(child)) {
      const word = child.value.trim().toLowerCase();
      if (word === 'and' || word === 'or') {
        words.push(word);
      }
    }
  }
  let result = requireValue(values[0]);
  for (let index = 1; index < values.length; index += 1) {
    const word = words[index - 1]!;
    const right = values[index]!;
    if (word === 'and' || word === 'or') {
      result = operation(word, result, right, false, cssBaseMathOutsideParens(word));
    } else {
      const guard: GuardNode = { g: word.toLowerCase() === 'and' ? 'and' : 'or', left: scssTruth(result), right: scssTruth(right), word, gluedAt: NO_SPAN, parens: 0 };

      /* Written from its guard (`word`, ledger J20), so no source text is kept: an operand may be one `scssConditionSource` cannot spell (`#{$a}`). */
      result = condition(guard, '');
    }
  }
  return result;
}

export function scssOptionalValue(value: unknown): ValueNode | null {
  return value === null || value === undefined ? null : requireValue(value);
}

/** A reduced {@link ScssCallArg} — the payload every argument production yields. */
export function isScssCallArg(value: unknown): value is ScssCallArg {
  return typeof value === 'object'
    && value !== null
    && 'value' in value
    && 'name' in value
    && isScssValueSlotValue(value.value);
}

export function requireScssCallArg(value: unknown): ScssCallArg {
  if (!isScssCallArg(value)) {
    throw new TypeError('SCSS grammar produced an invalid call argument.');
  }
  return value;
}

/** An {@link ScssArgumentPair} — a separator plus the argument it precedes. */
export function isScssArgumentPair(value: unknown): value is ScssArgumentPair {
  return typeof value === 'object'
    && value !== null
    && 'separator' in value
    && typeof value.separator === 'string'
    && 'value' in value
    && isScssCallArg(value.value);
}

export function isScssValuePair(value: unknown): value is ScssValuePair {
  return typeof value === 'object'
    && value !== null
    && 'separator' in value
    && typeof value.separator === 'string'
    && 'value' in value
    && isScssValueSlotValue(value.value);
}

/**
 * `ValueTerm`'s reduction. A slash groups only its DIRECT neighbours
 * (DESIGN-DECISIONS P33 as amended 2026-09-24, P35): comma, then whitespace,
 * then slash. A slash tail joins the item before it — `12px/1.5 Arial` is
 * `[12px / 1.5, Arial]` — and a space tail starts a new item.
 */
export function scssSlashGroupedTerm(children: readonly unknown[]): ValueSlot {
  const items: ValueNode[] = [requireValue(children[0])];
  const grouped: boolean[] = [false];
  const separators: string[] = [];
  for (const child of children.slice(1)) {
    if (!isScssValueTail(child)) {
      throw new TypeError('SCSS value term produced an invalid list boundary.');
    }
    const last = items.length - 1;
    const previous = items[last]!;
    if (child.kind === 'slash') {
      items[last] = grouped[last] === true && previous.type === 'List'
        ? list([...previous.value, child.value], '/')
        : list([previous, child.value], '/');
      grouped[last] = true;
    } else {
      items.push(child.value);
      grouped.push(false);
      separators.push(child.separator);
      if (child.glued !== null) {
        items.push(child.glued);
        grouped.push(false);
        separators.push('');
      }
    }
  }
  return items.length === 1
    ? items[0]!
    : withValueLayout(items, separators);
}

export function isScssValueTail(value: unknown): value is ScssValueTail {
  return typeof value === 'object'
    && value !== null
    && 'kind' in value
    && (value.kind === 'space' || value.kind === 'slash')
    && 'value' in value
    && isScssValue(value.value)
    && 'separator' in value
    && typeof value.separator === 'string'
    && 'glued' in value;
}

export function isVarDeclaration(value: unknown): value is VariableDeclaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'VariableDeclaration'
    && 'name' in value
    && typeof value.name === 'string'
    && 'value' in value
    && isScssValueSlotValue(value.value);
}

/*
 * The single statement-membership predicate behind both body reducers:
 * `statements` throws on the first non-statement child, `statementChildren`
 * silently keeps only the statement children. `allowDeclarations` admits a
 * `Declaration` in declaration-capable bodies.
 */
export function isStatementChild(child: unknown, allowDeclarations: boolean): child is Statement {
  return isComment(child)
    || isStyleImport(child)
    || isModuleImport(child)
    || isAtRuleBlock(child)
    || isAtRuleStatement(child)
    || isVarDeclaration(child)
    || isMixinDefinition(child)
    || isMixinCall(child)
    || isFor(child)
    || isIf(child)
    || isWhile(child)
    || isRuleset(child)
    || isUnknownAtRuleBlock(child)

    /* `$content()` — a statement-position Reference; core's `Statement` already
     * admits one, and this is the only production that puts one here. */
    || isReference(child)
    || (allowDeclarations && isScssDeclaration(child));
}

export function statements(children: readonly unknown[], allowDeclarations = false): Statement[] {
  const result: Statement[] = [];
  for (const child of children) {
    /*
     * `null` is the ONE deliberate non-statement: `@debug`/`@warn`/`@error`
     * reduce to it because they own no AST kind (§12.0). Everything else that is
     * not a statement is a recognition defect and must still throw — dropping
     * unknown shapes silently is how a lowering goes missing without a failure.
     */
    if (child === null) {
      continue;
    }
    if (isScssImportListFact(child)) {
      result.push(...child.statements);
      continue;
    }
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

export function statementChildren(children: readonly unknown[], allowDeclarations = false): Statement[] {
  const result: Statement[] = [];
  for (const child of children) {
    if (isScssImportListFact(child)) {
      result.push(...child.statements);
    } else if (isStatementChild(
      child,
      allowDeclarations
    )) {
      result.push(child);
    }
  }
  return result;
}

/**
 * Retag a control-flow block body's DIRECT `$x:` declarations. A bare `$x:` sitting
 * directly inside an `@if`/`@else`/`@each`/`@for`/`@while` body is an imperative
 * REASSIGNMENT — it writes the nearest existing binding and only shadows block-locally
 * when none exists — which is what a `@for`/`@while` accumulator (`$i: $i + 1`) relies
 * on. It lowers to the optional-shadow write (`reassign-or-declare`, live store, to
 * match the live reads SCSS emits). The same `$x:` at top level or inside a ruleset
 * keeps its plain `declare`, so only bare declares are retagged here (`!default` →
 * if-absent and `!global` → reassign pass through) and nested rulesets are opaque:
 * their own declarations were already lowered as `declare` by the ruleset reducer.
 * The source span is preserved by spreading the original node.
 */
export function controlBlockStatements(statements: Statement[]): Statement[] {
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]!;
    if (statement.type === 'VariableDeclaration' && statement.write.mode === 'declare') {
      statements[i] = { ...statement, write: { mode: 'reassign-or-declare', scope: 'live' } };
    }
  }
  return statements;
}

export function requireStatementList(value: unknown): Statement[] {
  if (!Array.isArray(value)) {
    throw new TypeError('SCSS grammar produced a non-statement list.');
  }
  return statements(
    value,
    true
  );
}

export function keyframeSelectorListFromChildren(children: readonly unknown[]): SelectorList {
  const selectors = children
    .filter((child): child is SimpleSelector => typeof child === 'object' && child !== null && 'type' in child && child.type === 'SimpleSelector');
  if (selectors.length === 0) {
    throw new TypeError('SCSS keyframe block requires a selector.');
  }
  return selist(...selectors);
}

export function scssPseudoName(opener: string): string {
  return opener.slice(-1) === '(' ? opener.slice(0, -1) : opener;
}
