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
 * This is a pure code motion (B0-scss): every body is byte-identical to its
 * former in-grammar definition and the helpers keep calling each other exactly
 * as before. These are SCSS's OWN helpers — promoting the ones that turn out
 * byte-identical to the css/less/jess helpers into the shared
 * `@jesscss/core/ast` module is a separate, deferred dedup pass (guarded by the
 * open-recursion rule: a helper is only shareable when its whole transitive
 * helper-closure is identical too).
 */

import { any, cssBaseMathOutsideParens, funcCall, ifValue, interpolation, isComplexSelector, isForBinding, isModuleImport, isRelativeSelector, isToken, isValueSlotArray, keyword, operation, quoted, reference, selectorTermOf, selist, withValueLayout } from '@jesscss/core/ast';
import type { AnonymousMixin, AtRuleBlock, AtRuleStatement, CallArg, Collection, CollectionEntry, Color, Comment, CompoundSelector, Declaration, Dimension, ExtendInstruction, For, ForBinding, FunctionCall, GuardNode, If, IfValue, Interpolation, Keyword, Lookup, MixinCall, MixinDefinition, OpaqueAtRuleBlock, Param, Quoted, Reference, ReferenceStep, Ruleset, SelectorBranch, SelectorList, SelectorTerm, SimpleSelector, SimpleToken, Statement, StyleImport, Token, Url, ValueNode, ValueSlot, VariableDeclaration, While } from '@jesscss/core/ast';

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

export const scriptModuleExtensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json'] as const;

export function isScriptModulePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return scriptModuleExtensions.some(extension => normalized.slice(-extension.length) === extension);
}
export function requireToken(value: unknown): Token {
  if (typeof value !== 'object' || value === null || !('value' in value) || typeof value.value !== 'string') {
    throw new TypeError('SCSS grammar produced a non-token child.');
  }
  return { value: value.value };
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

/** Map query/media-prelude children to value nodes, coercing bare keyword tokens
 *  (`and`/`or`/media types) to `Keyword`s while passing structured values through. */
export function keywordizeValues(children: readonly unknown[]): ValueNode[] {
  return children.map(child => isScssValue(child) ? child : keyword(requireToken(child).value));
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

export function isQuoted(value: unknown): value is Quoted {
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

export function isUrl(value: unknown): value is Url {
  return typeof value === 'object'
    && value !== null
    && 'type' in value && value.type === 'Url'
    && 'value' in value && isScssValue(value.value);
}

export function isSimpleSelector(value: unknown): value is SimpleSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'SimpleSelector'
    && 'text' in value && (typeof value.text === 'string' || value.text === null)
    && 'interp' in value && (isScssInterpolation(value.interp) || value.interp === null);
}

export function isCompoundSelector(value: unknown): value is CompoundSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'CompoundSelector'
    && 'value' in value && Array.isArray(value.value)
    && value.value.every(isScssSimpleToken);
}

export function isSelectorTerm(value: unknown): value is SelectorTerm {
  return isScssSimpleToken(value) || isCompoundSelector(value);
}

export function isScssSelectorBranch(value: unknown): value is SelectorBranch {
  return isSelectorTerm(value) || isComplexSelector(value) || isRelativeSelector(value);
}

export function isScssSelectorList(value: unknown): value is SelectorList {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'SelectorList'
    && 'selectors' in value && Array.isArray(value.selectors)
    && value.selectors.every(isScssSelectorBranch);
}

export function requireSelectorList(value: unknown): SelectorList {
  if (!isScssSelectorList(value)) {
    throw new TypeError('SCSS grammar produced a non-selector-list child.');
  }
  return value;
}

export const scssSelectorTermFromTokens = (tokens: readonly SimpleToken[]): SelectorTerm =>
  selectorTermOf([tokens[0]!, ...tokens.slice(1)]);

/*
 * A compound token is either a plain `SimpleSelector` or a structured
 * `PseudoSelector` (`:is(.a, .b)` etc.). The structured pseudo carries its
 * argument as a `SelectorList` in `args` and leaves `text` null; core
 * serialization owns the inline join.
 */
export function isScssSimpleToken(value: unknown): value is SimpleToken {
  return isSimpleSelector(value)
    || (typeof value === 'object' && value !== null && 'type' in value && value.type === 'PseudoSelector');
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

export function scssBranchSegments(branch: SelectorBranch): [{ combinator?: ScssSegmentCombinator; term: SelectorTerm }, ...Array<{ combinator?: ScssSegmentCombinator; term: SelectorTerm }>] {
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

export function isScssImportTarget(value: unknown): value is Quoted | Url | Interpolation {
  return isQuoted(value) || isUrl(value) || isScssInterpolation(value);
}

export function isParam(value: unknown): value is Param {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if ('name' in value && typeof value.name !== 'string') {
    return false;
  }
  if ('default' in value && !isScssValueSlotValue(value.default)) {
    return false;
  }
  if ('pattern' in value && !isScssValueSlotValue(value.pattern)) {
    return false;
  }
  return !('rest' in value) || typeof value.rest === 'boolean';
}

export function isParamArray(value: unknown): value is Param[] {
  return Array.isArray(value) && value.every(isParam);
}

export function isAnonymousMixin(value: unknown): value is AnonymousMixin {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'AnonymousMixin';
}

export function requireForBinding(value: unknown): ForBinding {
  if (!isForBinding(value)) {
    throw new TypeError('SCSS grammar produced an invalid for binding.');
  }
  return value;
}

export function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('SCSS grammar produced a non-string child.');
  }
  return value;
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

export function isScssInterpolation(value: unknown): value is Interpolation {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Interpolation'
    && 'parts' in value
    && Array.isArray(value.parts);
}

export function requireInterpolation(value: unknown): Interpolation {
  if (!isScssInterpolation(value)) {
    throw new TypeError('SCSS grammar produced a non-interpolation child.');
  }
  return value;
}

export function appendLiteral(parts: Interpolation['parts'], text: string): void {
  const previous = parts[parts.length - 1];
  if (previous !== undefined && 'lit' in previous) {
    parts[parts.length - 1] = { lit: previous.lit + text };
  } else {
    parts.push({ lit: text });
  }
}

/** Flatten a grammar-owned raw template without ever reparsing its bytes. */
export function interpolationFromTemplateChildren(children: readonly unknown[]): Interpolation {
  const parts: Interpolation['parts'] = [];
  for (const child of children) {
    if (isScssInterpolation(child)) {
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
export function customValueFromParts(children: readonly unknown[], parts: Interpolation['parts'], seen: { interpolated: boolean }): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      customValueFromParts(
        child,
        parts,
        seen
      );
    } else if (isScssInterpolation(child)) {
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
export function customValue(children: readonly unknown[]): ValueNode {
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

export function isArithmeticOperator(text: string): boolean {
  return text === '+' || text === '-' || text === '*' || text === '/' || text === '%';
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
    if (isArithmeticOperator(text)) {
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
      return isScssInterpolation(value);
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
      return 'entries' in value && Array.isArray(value.entries);
    case 'Reference':
      return 'base' in value && 'steps' in value && Array.isArray(value.steps);
    case 'AnonymousMixin':
      return 'rules' in value && Array.isArray(value.rules);
    case 'IfValue':
      return 'branches' in value && Array.isArray(value.branches) && value.branches.length > 0;
    case 'Condition':
      return 'guard' in value && isGuardNode(value.guard) && 'src' in value && typeof value.src === 'string';
    default:
      return false;
  }
}

export function scssValueSlot(value: ValueNode): ValueSlot {
  if (value.type === 'Sequence') {
    return value.parts;
  }
  if (value.type === 'Block' && isSequence(value.value)) {
    return { ...value, value: value.value.parts };
  }
  return value;
}

export function isSequence(value: ValueSlot): value is Extract<ValueNode, { type: 'Sequence' }> {
  return isScssValue(value) && value.type === 'Sequence';
}

export function isScssValueSlotValue(value: unknown): value is ValueSlot {
  return Array.isArray(value) ? value.every(isScssValueSlotValue) : isScssValue(value);
}

export function requireValueSlot(value: unknown): ValueSlot {
  return Array.isArray(value) ? value as ValueSlot : scssValueSlot(requireValue(value));
}

export function isScssDeclaration(value: unknown): value is Declaration {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Declaration'
    && 'name' in value
    && (typeof value.name === 'string' || isScssInterpolation(value.name))
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

export function isRuleset(value: unknown): value is Ruleset {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Ruleset';
}

export function isMixinDefinition(value: unknown): value is MixinDefinition {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'MixinDefinition';
}

export function isMixinCall(value: unknown): value is MixinCall {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'MixinCall';
}

export function isFor(value: unknown): value is For {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'For';
}

export function isIf(value: unknown): value is If {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'If';
}

export function isWhile(value: unknown): value is While {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'While';
}

export function isAtRuleBlock(value: unknown): value is AtRuleBlock {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'AtRuleBlock';
}

export function isAtRuleStatement(value: unknown): value is AtRuleStatement {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'AtRuleStatement';
}

export function isComment(value: unknown): value is Comment {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Comment';
}
export function isStyleImport(value: unknown): value is StyleImport {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'StyleImport';
}

export function isExtendInstruction(value: unknown): value is ExtendInstruction {
  return typeof value === 'object' && value !== null
    && 'target' in value && value.target !== null && typeof value.target === 'object'
    && 'type' in value.target && value.target.type === 'SelectorList'
    && 'partial' in value && typeof value.partial === 'boolean';
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
  return scssValueSlot(node);
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

export function isGuardNode(value: unknown): value is GuardNode {
  if (typeof value !== 'object' || value === null || !('g' in value)) {
    return false;
  }
  switch (value.g) {
    case 'default':
      return true;
    case 'truth':
      return 'value' in value && isScssValue(value.value);
    case 'cmp':
    case 'match':
      return 'op' in value && typeof value.op === 'string'
        && 'left' in value && isScssValue(value.left)
        && 'right' in value && isScssValue(value.right);
    case 'call':
      return 'name' in value && typeof value.name === 'string'
        && 'args' in value && Array.isArray(value.args) && value.args.every(isScssValue);
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

export function requireGuardNode(value: unknown): GuardNode {
  if (!isGuardNode(value)) {
    throw new TypeError('SCSS grammar produced a non-guard child.');
  }
  return value;
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
    || isOpaqueAtRuleBlock(child)

    /* `$content()` — a statement-position Reference; core's `Statement` already
     * admits one, and this is the only production that puts one here. */
    || isReferenceStatement(child)
    || (allowDeclarations && isScssDeclaration(child));
}

export function isReferenceStatement(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Reference';
}

export function isOpaqueAtRuleBlock(value: unknown): value is OpaqueAtRuleBlock {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'OpaqueAtRuleBlock';
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
    if (isStatementChild(
      child,
      allowDeclarations
    )) {
      result.push(child);
    }
  }
  return result;
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
