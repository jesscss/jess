/**
 * CSS grammar reducer helpers, hoisted out of `css-parser/src/grammar.ts`.
 *
 * These are the module-private helpers the CSS grammar's `node(...)` reducers
 * call — token readers, node-shape guards, and the selector/value/statement
 * folders. They lived inside `grammar.ts` as free module scope, which is fine
 * for a standalone `composeLeaf(...)` grammar but not for a COMPOSABLE base: the
 * parseman compose analyzer can only carry a reducer across a package boundary
 * (into a dialect's fused module) when every name the reducer reads has import
 * provenance. A free module-private helper has none, so `compose([rules(css)])`
 * refused (`unsupported binding(s): tokenText`). Hoisting them here — the module
 * every dialect grammar already imports its AST constructors from — gives each
 * one a resolvable import, and the analyzer re-emits those imports verbatim into
 * the composing dialect.
 *
 * These are CSS's grammar reducers specifically (not the byte-identical
 * cross-dialect set that lives in `grammar-helpers.ts`); a dialect that composes
 * the CSS base inherits them through the base rather than redeclaring them.
 */
import {
  any,
  cssBaseMathOutsideParens,
  operation,
  selectorBranchCanonical,
  selectorTermOf,
  selist
} from './nodes.js';
import { withValueLayout } from './provenance.js';
import { semanticGapText } from './grammar-helpers.js';
import type {
  CompoundSelector,
  Declaration,
  Interpolation,
  Keyword,
  Quoted,
  Ruleset,
  SelectorBranch,
  SelectorList,
  SelectorTerm,
  SimpleSelector,
  SimpleToken,
  Statement,
  ValueNode,
  ValueSlot
} from './nodes.js';
import type { AtRuleBlock, OpaqueAtRuleBlock } from './at-rule.js';

/** The reducer field bag parseman hands a `build(children, fields, span)`. */
type ReducerFields = Record<string, { readonly value: unknown } | ReadonlyArray<{ readonly value: unknown }>>;

export function tokenText(child: unknown): string {
  if (typeof child === 'string') {
    return child;
  }
  if (typeof child === 'object' && child !== null && 'value' in child && typeof child.value === 'string') {
    return child.value;
  }
  throw new Error('CSS AST grammar lost a required token');
}

/*
 * Re-join the parts of a structured opaque at-rule body into the exact bytes
 * the flat capture used to hand over. The parts nest (a `{ … }` group is an
 * array), so this recurses; nothing is trimmed, re-spaced, or re-ordered,
 * which is what makes `rawBody` — and therefore the serialized output — the
 * same string it was before the body gained an interior.
 */
export function opaqueBodyText(children: readonly unknown[]): string {
  let text = '';
  for (const child of children) {
    text += Array.isArray(child) ? opaqueBodyText(child) : tokenText(child);
  }
  return text;
}

export function functionOpenName(child: unknown): string {
  const value = tokenText(child);
  return value.endsWith('(') ? value.slice(0, -1) : value;
}

export function authoredText(child: unknown): string {
  if (child === undefined || child === null) {
    return '';
  }
  return Array.isArray(child) ? child.map(authoredText).join('') : tokenText(child);
}

export function authoredSeparators(fields: ReducerFields | undefined): string[] {
  const capture = fields?.separator;
  if (capture === undefined) {
    return [];
  }
  const captures = Array.isArray(capture) ? capture : [capture];
  return captures.map(item => authoredText(item.value));
}

export function withAuthoredSeparators<T extends object>(value: T, fields: ReducerFields | undefined, expected: number): T {
  const separators = authoredSeparators(fields);
  return separators.length === expected
    ? withValueLayout(
        value,
        separators
      )
    : value;
}

export function sourceText(child: unknown): string {
  if (typeof child === 'object' && child !== null && 'src' in child && typeof child.src === 'string') {
    return child.src;
  }
  return tokenText(child);
}

/*
 * A per-node trivia entry is `[start, end, insertIndex]`, plus a trailing
 * kind index once the scope's arms are labeled. Every CSS trivia scope is
 * `classifiedTrivia()`, so the stride is four and the raw-child insertion
 * boundary sits at offset two. Reading it at the unlabeled stride would treat
 * source offsets as child indices and silently drop prelude gaps.
 */
const CSS_NODE_TRIVIA_STRIDE = 4;

export function semanticTextWithTriviaGaps(children: readonly unknown[], triviaLog: readonly number[]): string {
  const gapBefore = new Set<number>();
  for (let index = 2; index < triviaLog.length; index += CSS_NODE_TRIVIA_STRIDE) {
    gapBefore.add(triviaLog[index] ?? 0);
  }

  let text = '';
  for (let index = 0; index < children.length; index++) {
    if (gapBefore.has(index)) {
      text += ' ';
    }
    text += sourceText(children[index]);
  }
  if (gapBefore.has(children.length)) {
    text += ' ';
  }

  return semanticGapText(text);
}

export function isNodeType<T extends string>(value: unknown, type: T): value is { readonly type: T } {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === type;
}

export function isSimple(value: unknown): value is SimpleSelector {
  return isNodeType(
    value,
    'SimpleSelector'
  );
}

export function isSimpleToken(value: unknown): value is SimpleToken {
  return isNodeType(
    value,
    'SimpleSelector'
  ) || isNodeType(
    value,
    'PseudoSelector'
  );
}

/*
 * Selector-function pseudos whose argument is retained as a structured
 * `SelectorList` (P0). Gated on the pseudo NAME (lowercased, colon-stripped),
 * never on colon count — `::slotted()` takes selector args but is absent here,
 * so it stays opaque text. `crossable` (a narrower set) is decided in core.
 */
export const STRUCTURED_PSEUDOS = new Set(['is', 'where', 'not', 'has', 'matches']);

export function isCompound(value: unknown): value is CompoundSelector {
  return isNodeType(
    value,
    'CompoundSelector'
  );
}

export function isSelectorTerm(value: unknown): value is SelectorTerm {
  return isSimpleToken(value) || isCompound(value);
}

export const selectorTermFromTokens = (tokens: readonly SimpleToken[]): SelectorTerm =>
  selectorTermOf([tokens[0]!, ...tokens.slice(1)]);

export function isComplex(value: unknown): value is Extract<SelectorBranch, { readonly type: 'ComplexSelector' }> {
  return isNodeType(
    value,
    'ComplexSelector'
  );
}

export function isRelative(value: unknown): value is Extract<SelectorBranch, { readonly type: 'RelativeSelector' }> {
  return isNodeType(
    value,
    'RelativeSelector'
  );
}

export function isSelectorBranch(value: unknown): value is SelectorBranch {
  return isSelectorTerm(value) || isComplex(value) || isRelative(value);
}

export function isSelectorList(value: unknown): value is SelectorList {
  return isNodeType(
    value,
    'SelectorList'
  );
}

export function isKeyword(value: unknown): value is Keyword {
  return isNodeType(
    value,
    'Keyword'
  );
}

export function isInterpolation(value: unknown): value is Interpolation {
  return isNodeType(
    value,
    'Interpolation'
  );
}

export function isDeclaration(value: unknown): value is Declaration {
  return isNodeType(
    value,
    'Declaration'
  );
}

export function isRuleset(value: unknown): value is Ruleset {
  return isNodeType(
    value,
    'Ruleset'
  );
}

export function isAtRuleBlock(value: unknown): value is AtRuleBlock {
  return isNodeType(
    value,
    'AtRuleBlock'
  );
}

export function isOpaqueAtRuleBlock(value: unknown): value is OpaqueAtRuleBlock {
  return isNodeType(
    value,
    'OpaqueAtRuleBlock'
  );
}

export function isValue(value: unknown): value is ValueNode {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && (value.type === 'Keyword' || value.type === 'Color' || value.type === 'Dimension'
      || value.type === 'Quoted' || value.type === 'Url' || value.type === 'FunctionCall'
      || value.type === 'Block' || value.type === 'Operation' || value.type === 'Sequence'
      || value.type === 'List' || value.type === 'Any');
}

export function isValueSlotArray(value: unknown): value is readonly ValueSlot[] {
  return Array.isArray(value);
}

export function valueSlot(value: ValueSlot): ValueSlot {
  if (isValueSlotArray(value)) {
    return value;
  }
  if (!isValue(value)) {
    return value;
  }
  if (value.type === 'Sequence') {
    return value.parts;
  }
  if (value.type === 'Block' && isValue(value.value) && value.value.type === 'Sequence') {
    return { ...value, value: value.value.parts };
  }
  return value;
}

export function isValueSlotValue(value: unknown): value is ValueSlot {
  return isValueSlotArray(value) ? value.every(isValueSlotValue) : isValue(value);
}

export function isTerminalText(value: unknown): value is string | { readonly value: string } {
  return typeof value === 'string'
    || (typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string');
}

export function queryComparisonOperators(children: readonly unknown[]): string[] {
  return children
    .filter(isTerminalText)
    .map(tokenText)
    .filter(value => value === '<' || value === '<=' || value === '=' || value === '>=' || value === '>');
}

export function chainedQueryComparison(left: ValueNode, children: readonly unknown[]): ValueNode {
  const operators = queryComparisonOperators(children);
  const values = valueChildren(children);
  if (operators.length === 0 || values.length === 0) {
    throw new Error('CSS AST query comparison requires an operator and value');
  }
  let result = operation(
    operators[0]!,
    left,
    values[0]!,
    false,
    cssBaseMathOutsideParens(operators[0]!)
  );
  for (let index = 1; index < operators.length; index++) {
    const right = values[index];
    if (right === undefined) {
      throw new Error('CSS AST query comparison lost its chained value');
    }
    result = operation(
      operators[index]!,
      result,
      right,
      false,
      cssBaseMathOutsideParens(operators[index]!)
    );
  }
  return result;
}

export function isImportTarget(value: unknown): value is Quoted | { readonly type: 'Url'; readonly value: ValueNode } {
  return isNodeType(
    value,
    'Quoted'
  ) || isNodeType(
    value,
    'Url'
  );
}

/** CSS `@import` is an ordinary statement at-rule. Its dedicated grammar only
 * validates the required target and retains its authored prelude; it does not
 * make import loading or resolution part of the AST. */
export function importPrelude(target: Quoted | { readonly type: 'Url'; readonly value: ValueNode }, tail: ValueNode | null): ValueNode {
  const targetText = target.type === 'Url'
    ? `url(${sourceText(target.value)})`
    : target.src;
  const tailText = tail === null ? '' : sourceText(tail);
  return any(tailText === '' ? targetText : `${targetText} ${tailText}`);
}

export function isRulesetStatement(value: unknown): value is Statement {
  return isDeclaration(value) || isDocumentStatement(value);
}

export function isDocumentStatement(value: unknown): value is Statement {
  return isRuleset(value)
    || isNodeType(
      value,
      'AtRuleStatement'
    )
    || isNodeType(
      value,
      'AtRuleBlock'
    )
    || isOpaqueAtRuleBlock(value);
}

export const selectorBranches = (children: readonly unknown[]): SelectorBranch[] =>
  children.filter(isSelectorBranch);

export function selectorArgumentText(value: unknown): string {
  if (isSelectorList(value)) {
    return value.selectors.map(selectorBranchCanonical).join(',');
  }
  return tokenText(value);
}

type ComplexSegment = { combinator?: ' ' | '>' | '+' | '~' | '|' | '||'; term: SelectorTerm };

/*
 * A namespaced type selector (`svg|circle`) is ONE SimpleSelector with a glued
 * namespace prefix (`NamespaceTypeSelector` below), not two compounds joined by
 * a `|` combinator, so parsing no longer produces a `|` combinator token. The
 * core `Combinator` union still admits `|` (a `SelectorBranch` built through the
 * public AST API may carry it), so this reader keeps handling it.
 */
export function selectorCombinator(child: unknown): NonNullable<ComplexSegment['combinator']> {
  const token = tokenText(child);
  if (token === '>' || token === '+' || token === '~' || token === '|' || token === '||') {
    return token;
  }
  return ' ';
}

export function cssRelativeCombinator(child: unknown): '>' | '+' | '~' {
  const token = tokenText(child);
  if (token === '>' || token === '+') {
    return token;
  }
  return '~';
}

export function complexSegments(children: readonly unknown[]): [ComplexSegment, ...ComplexSegment[]] {
  const segments: Array<{ combinator?: ' ' | '>' | '+' | '~' | '|' | '||'; term: SelectorTerm }> = [];
  let combinator: ' ' | '>' | '+' | '~' | '|' | '||' = ' ';
  for (const child of children) {
    if (isSelectorTerm(child)) {
      segments.push(segments.length === 0 ? { term: child } : { combinator, term: child });
      combinator = ' ';
      continue;
    }
    combinator = selectorCombinator(child);
  }
  return [segments[0]!, ...segments.slice(1)];
}

export function branchSegments(branch: SelectorBranch): [ComplexSegment, ...ComplexSegment[]] {
  if (branch.type !== 'ComplexSelector' && branch.type !== 'RelativeSelector') {
    return [{ term: branch }];
  }
  const segments: ComplexSegment[] = [];
  let combinator: ' ' | '>' | '+' | '~' | '|' | '||' = ' ';
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

export function valueChildren(children: readonly unknown[]): ValueNode[] {
  const values = children.filter(isValue);
  if (values.length === 0) {
    throw new Error('CSS AST value grammar lost its value child');
  }
  return values;
}

export function flattenSequences(values: readonly ValueNode[]): ValueNode[] {
  const flattened: ValueNode[] = [];
  for (const value of values) {
    if (value.type === 'Sequence') {
      flattened.push(...value.parts);
      continue;
    }
    flattened.push(value);
  }
  return flattened;
}

/** First structured value child without allocating a filtered array. The
 * component-value reducers only need the leading value; the whole-array
 * `valueChildren` above stays for the math/query reducers that fold every
 * operand. */
export function firstValue(children: readonly unknown[]): ValueNode {
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (isValue(child)) {
      return child;
    }
  }
  throw new Error('CSS AST value grammar lost its value child');
}

export function optionalValue(value: unknown): ValueNode | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (isValue(value)) {
    return value;
  }
  throw new Error('CSS AST grammar produced an invalid optional value.');
}

/** Reduce authored declaration/value children without flattening recursive
 * ValueSlot arrays. Scalar grammar (calc/query operations) intentionally uses
 * valueChildren above; only component-value and call-argument productions use
 * this slot-aware reducer. */
export function valueSlotChildren(children: readonly unknown[]): ValueSlot[] {
  const values = children.filter(isValueSlotValue);
  if (values.length === 0) {
    throw new Error('CSS AST value grammar lost its value child');
  }
  return values;
}

export function isMathOperator(text: string): boolean {
  return text === '+' || text === '-' || text === '*' || text === '/' || text === '%';
}

/*
 * Operands and operator characters, in authored order, with the operators'
 * padding interleaved. The fold reads the shape rather than a fixed stride: the
 * pads are their own terms now, so an operator no longer sits a constant distance
 * from its operand, and a pad can hold a comment whose own `/` and `*` would
 * defeat any attempt to recover the operator from the padded text.
 */
export function foldOperation(children: readonly unknown[]): ValueNode {
  const first = children.find(isValue);
  if (first === undefined) {
    throw new Error('CSS AST math grammar requires an operand');
  }
  let result = first;
  let operator: string | undefined;
  for (let index = children.indexOf(first) + 1; index < children.length; index++) {
    const child = children[index];
    if (isValue(child)) {
      if (operator === undefined) {
        throw new Error('CSS AST math grammar lost an operator operand');
      }

      /*
       * `inMathFunction` is TRUE for every operand pair this fold builds: the
       * ladder is only reachable from a css-values-4 §10 math function, so an
       * operation reaching here was AUTHORED inside one. The flag records that
       * positional fact; whether the operation then folds is decided
       * downstream, together with `unitMode` and `mathMode`.
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
    const text = tokenText(child);
    if (isMathOperator(text)) {
      operator = text;
    }
  }
  if (operator !== undefined) {
    throw new Error('CSS AST math grammar lost an operator operand');
  }
  return result;
}

export function rulesetStatements(children: readonly unknown[]): Statement[] {
  return children.filter(isRulesetStatement);
}

export function documentStatements(children: readonly unknown[]): Statement[] {
  const statements = children.filter(isDocumentStatement);
  if (statements.length !== children.length) {
    throw new Error('Stylesheet has an unexpected child');
  }
  return statements;
}

export function blockStatements(children: readonly unknown[]): Statement[] {
  return children.filter(isDocumentStatement);
}

export function keyframeSelectorList(children: readonly unknown[]): SelectorList {
  const selectors = children.filter(isSimple);
  return selist(...selectors);
}
