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

import { appendCustomValueParts as appendCustomValuePartsIn, atRuleStatement, isNthArgument, pseudoSelector, simpleSelector, structuredPseudoFrom, cssBaseMathOutsideParens, importIsCompileTime, importTargetSpelling, spaced, styleImport, customValueFromChildren as customValueFromChildrenIn, funcCall, ifValue, interpolationFromTemplateChildren as interpolationFromTemplateChildrenIn, isAtRuleBlock, isAtRuleStatement, isFor, isGuardNodeOf, isIf, isInterpolation, isMathOperator, isMixinCall, isMixinDefinition, isModuleImport, isQuoted, isReference, isRuleset, isStyleImport, isToken, isUnknownAtRuleBlock, isValueSlotArray, isValueSlotOf, isWhile, list, operation, quoted, reference, requireForBinding as requireForBindingIn, requireGuardNodeOf, requireInterpolation as requireInterpolationIn, requireSelectorList as requireSelectorListIn, requireString as requireStringIn, requireToken as requireTokenIn, selist, valueSlot, withValueLayout } from '@jesscss/core/ast';
import type { AtRuleStatement, CallArg, Collection, CollectionEntry, Color, Comment, Declaration, Dimension, ForBinding, FunctionCall, GuardNode, IfValue, Interpolation, Keyword, Lookup, Quoted, Reference, ReferenceStep, SelectorList, SimpleSelector, SimpleToken, Statement, StyleImport, Token, Url, ValueNode, ValueSlot, VariableDeclaration } from '@jesscss/core/ast';
import { ScssImportPostludeError } from './parse-error.js';

export type ScssValuePair = { readonly separator: string; readonly value: ValueSlot };
export type ScssValueTail = { readonly kind: 'space' | 'slash'; readonly value: ValueNode; readonly separator: string };

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
export const customValueFromChildren = (children: readonly unknown[]): ValueNode => customValueFromChildrenIn(children, DIALECT);
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
 * Sass's own URL rule for an `@import` target, exactly as dart-sass applies it
 * (`isPlainImportUrl`, `lib/src/parse/stylesheet.dart`): a protocol-relative
 * `//host/x` or an `http://` / `https://` URL is plain CSS. The tests are
 * case-sensitive — `HTTP://x` is a partial import there — and a target shorter
 * than five characters is never plain. The `.css` test is the shared
 * `importIsCompileTime` rule, not part of this one.
 */
export function sassImportUrlIsPlainCss(spelling: string): boolean {
  return spelling.length >= 5
    && (spelling.startsWith('//') || spelling.startsWith('http://') || spelling.startsWith('https://'));
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

/** A `:lang()` / `:dir()` pseudo from its glued opener and structured argument. */
export function requireStructuredPseudo(opener: string, arg: unknown): SimpleToken {
  const name = opener.slice(0, -1);
  const pseudo = structuredPseudoFrom(name, name.slice(name.startsWith('::') ? 2 : 1), arg);
  if (pseudo === null) {
    throw new TypeError('SCSS pseudo lost its structured argument.');
  }
  return pseudo;
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
      imports.push(styleImport('@import', target, { mode: 'import' }));
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

/** Fold a grammar-produced left-associative operator chain. Precedence belongs
 * to the caller's product/sum production, never to a source-text recovery.
 *
 * Operands and operator characters arrive in authored order with the operators'
 * padding interleaved. The pads are their own terms, so an operator no longer
 * sits a constant distance from its operand and the fold reads the shape rather
 * than a fixed stride — and a pad can hold a comment whose own `/` and `*` would
 * defeat any attempt to recover the operator from the padded text. */
export function scssFoldOperation(children: readonly unknown[]): ValueNode {
  const first = children.find(isScssValue);
  if (first === undefined) {
    throw new TypeError('SCSS arithmetic grammar produced no operand.');
  }
  let result = first;
  let operator: string | undefined;
  for (let index = children.indexOf(first) + 1; index < children.length; index += 1) {
    const child = children[index];
    if (isScssValue(child)) {
      if (operator === undefined) {
        throw new TypeError('SCSS arithmetic grammar lost an operator operand.');
      }
      result = operation(
        operator,
        result,
        child,
        false,
        cssBaseMathOutsideParens(operator)
      );
      operator = undefined;
      continue;
    }
    if (child === undefined || child === null) {
      continue;
    }
    const text = requireToken(child).value;
    if (isMathOperator(text)) {
      operator = text;
    }
  }
  if (operator !== undefined) {
    throw new TypeError('SCSS arithmetic grammar lost an operator operand.');
  }
  return result;
}

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
      return isVarRef(value);
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
 *  the same function, so both lower to the same accessor read — a grammar that
 *  accepted only one spelling into the accessor form would emit two different
 *  trees for one semantics. */
export const MAP_GET_SPELLINGS = new Set(['map-get', 'map.get']);

/** The comparison spellings a call argument may carry (§4.5.2). Named here so
 * the operator token is found by WHAT IT IS rather than by a child index the
 * optional trivia arms would shift. */
export const COMPARISON_OPERATORS = new Set(['==', '!=', '>=', '<=', '>', '<']);

/** Lower `map-get($m, k)` to the shared `$[…]` accessor read `$m[k]`: a Reference
 *  whose single LookupStep carries the key. A `$var` key selects the
 *  variable-namespace lookup; every other key is a value-equality member lookup
 *  (map keys compare by value, never by position, so `index` is never used). */
export function lowerMapGet(base: ValueNode, key: ValueNode): Reference {
  const step: ReferenceStep = key.type === 'Lookup' && key.kind === 'var'
    ? { type: 'LookupStep', kind: 'var', name: key }
    : { type: 'LookupStep', kind: 'member', name: key };
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

export function reduceScssCall(name: string, children: readonly unknown[], minArgumentIndex: number): FunctionCall | Reference | IfValue {
  const lastIndex = children.length - 1;
  const firstIndex = children.findIndex((child, index) => index > minArgumentIndex && index < lastIndex && isScssCallArg(child));
  if (firstIndex === -1) {
    return funcCall(
      name,
      []
    );
  }
  const first = requireScssCallArg(children[firstIndex]);
  const args: ScssCallArg[] = [first];
  const separators: string[] = [];
  for (let index = firstIndex + 1; index < lastIndex; index += 1) {
    const child = children[index];
    if (!isScssArgumentPair(child)) {
      continue;
    }
    separators.push(String(child.separator));
    args.push(child.value);
  }
  const call = funcCall(
    name,
    args
  );
  if (MAP_GET_SPELLINGS.has(call.name) && args.length === 2 && isScssValue(args[0]!.value) && isScssValue(args[1]!.value)) {
    return lowerMapGet(
      args[0]!.value,
      args[1]!.value
    );
  }
  if (call.name.toLowerCase() === 'if') {
    const lowered = lowerSassIf(args);
    if (lowered !== undefined) {
      return lowered;
    }
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
  return { g: 'truth', value };
}

/**
 * Sass's `not <value>` — the NEGATION of {@link scssTruth}, i.e. "is `$x`
 * falsy". Under §4.4.6 that is exactly jess's `not($x)`, so it is the truth node
 * under a `not` wrapper and cannot drift from the positive form.
 */
export function scssNegation(value: ValueSlot): GuardNode {
  return { g: 'not', inner: scssTruth(value) };
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

/**
 * Fold one logical rung left-associatively onto `Operation` nodes carrying the
 * word itself as the operator. The operator token is kept out of the fold by
 * shape (only values participate), so the rung reduces the same way whether it
 * spelled `and` or `or`.
 */
export function foldLogicalOperation(children: readonly unknown[]): ValueNode {
  const values = children.filter(isScssValue);
  const operators = children.filter(isToken).map(token => token.value.trim().toLowerCase()).filter(text => text === 'and' || text === 'or');
  let result = requireValue(values[0]);
  for (let index = 1; index < values.length; index += 1) {
    result = operation(operators[index - 1]!, result, values[index]!, false,
      cssBaseMathOutsideParens(operators[index - 1]!));
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
    && typeof value.separator === 'string';
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
