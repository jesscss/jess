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
  branch,
  block,
  cssBaseMathOutsideParens,
  funcCall,
  list,
  operation,
  selectorBranchCanonical,
  selectorTermOf,
  selist
} from './nodes.js';
import { withValueLayout } from './provenance.js';
import { semanticGapText } from './grammar-helpers.js';
import type {
  CompoundSelector,
  Block,
  Branch,
  Declaration,
  FunctionCall,
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
import type { AtRuleBlock, UnknownAtRuleBlock } from './at-rule.js';

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
export function unknownBodyText(children: readonly unknown[]): string {
  let text = '';
  for (const child of children) {
    text += Array.isArray(child) ? unknownBodyText(child) : tokenText(child);
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

/*
 * Split a delimited group's children at each `;` terminal. Returns the values between
 * them, one group per side (empty where the author wrote none), and each `;`'s
 * authored run: the padding tokens beside it and the `;` itself. These are the
 * grammar's own tokens — a comment is one whole trivia token, so a `;` inside
 * one is never read as a separator, and a value is checked first, so a value
 * node is never read as punctuation. Only children in `[from, to)` are read,
 * so a call can leave out its opener and `)`.
 */
function splitAtSemicolons(children: readonly unknown[], from: number, to: number): { segments: ValueSlot[][]; separators: string[] } {
  const segments: ValueSlot[][] = [[]];
  const separators: string[] = [];
  let padding = '';
  let afterDelimiter = false;
  for (let index = from; index < to; index++) {
    const child = children[index];
    if (isValueSlotValue(child)) {
      if (afterDelimiter) {
        separators[separators.length - 1] += padding;
        afterDelimiter = false;
      }
      padding = '';
      segments[segments.length - 1]!.push(child);
    } else if (isTerminalText(child)) {
      const text = tokenText(child);
      if (text === ';') {
        separators.push(padding + text);
        padding = '';
        afterDelimiter = true;
        segments.push([]);
      } else {
        padding += text;
      }
    }
  }
  if (afterDelimiter) {
    separators[separators.length - 1] += padding;
  }
  return { segments, separators };
}

/** Does this body carry a `;` terminal of its own (not one inside a value)? */
function hasSemicolon(children: readonly unknown[]): boolean {
  return children.some(child => !isValue(child) && isTerminalText(child) && tokenText(child) === ';');
}

/** Record `separators` as `value`'s layout when there is one per boundary. */
function withLayoutWhenComplete<T extends object>(value: T, separators: readonly string[], expected: number): T {
  return separators.length === expected ? withValueLayout(value, separators) : value;
}

/**
 * A generic call's reduction. Without a `;` the arguments are the comma run,
 * with its authored separator layout, exactly as before. With one — css-values-5
 * §8.3 `if( [ <if-branch> ; ]* <if-branch> ;? )` — the body is ONE argument, the
 * `;` List of its groups, so the call carries the separator it was written with
 * instead of a comma it was not. A group is the empty slot `[]` when it holds
 * nothing (`if(media(print): 1px;)` ends on one), itself when it holds one
 * argument, and the comma `List` it was written as when it holds several. The
 * commas are handed out to their groups in order, one fewer than each group's
 * arguments, so every rung keeps its own authored layout.
 */
export function semicolonGroupedCall(children: readonly unknown[], fields: ReducerFields | undefined): FunctionCall {
  const name = functionOpenName(children[0]);
  if (!hasSemicolon(children)) {
    const args = children.filter(isValueSlotValue);
    return funcCall(name, withAuthoredSeparators(args, fields, Math.max(0, args.length - 1)));
  }
  const { segments, separators } = splitAtSemicolons(children, 1, children.length - 1);
  const commas = authoredSeparators(fields);
  let comma = 0;
  const groups: ValueSlot[] = [];
  for (const group of segments) {
    if (group.length === 0) {
      groups.push([]);
    } else if (group.length === 1) {
      groups.push(group[0]!);
    } else {
      const next = comma + group.length - 1;
      groups.push(withLayoutWhenComplete(list(group, ','), commas.slice(comma, next), group.length - 1));
      comma = next;
    }
  }
  return funcCall(name, [withLayoutWhenComplete(list(groups, ';'), separators, groups.length - 1)]);
}

/** A whitespace run: one value is itself, several keep their authored separators. */
export function spaceRun(children: readonly unknown[], fields: ReducerFields | undefined): ValueSlot {
  const values = valueSlotChildren(children);
  return values.length === 1 ? values[0]! : withAuthoredSeparators(values, fields, values.length - 1);
}

/**
 * One branch (ledger P38): the condition is the first value, and what follows
 * the colon is the value — nothing is the empty slot, several arguments are the
 * comma `List` they were written as.
 */
export function branchOf(children: readonly unknown[], fields: ReducerFields | undefined): Branch {
  let condition: ValueSlot | undefined;
  const values: ValueSlot[] = [];
  for (const child of children) {
    if (!isValueSlotValue(child)) {
      continue;
    }
    if (condition === undefined) {
      condition = child;
    } else {
      values.push(child);
    }
  }
  if (condition === undefined) {
    throw new Error('CSS AST branch lost its condition');
  }
  if (values.length === 0) {
    return branch(condition, []);
  }
  return branch(condition, values.length === 1 ? values[0]! : withAuthoredSeparators(list(values, ','), fields, values.length - 1));
}

/**
 * A branch list: one branch is itself; several (or one with the spec's trailing
 * `;`, kept as an empty slot) are the `;` List they were written as, with each
 * `;`'s authored run as layout.
 */
export function branchList(children: readonly unknown[]): ValueSlot {
  const { segments, separators } = splitAtSemicolons(children, 0, children.length);
  const parts = segments.map(segment => segment[0] ?? []);
  return parts.length === 1 ? parts[0]! : withLayoutWhenComplete(list(parts, ';'), separators, parts.length - 1);
}

/**
 * A parenthesized group that may hold `;`-separated parts (a `var()` fallback
 * `(a; b)`). Without a `;` it is the one value it always was; with one it is the
 * `;` List of its parts, an empty part as the empty slot `[]`.
 */
export function parenGroupBlock(children: readonly unknown[]): Block {
  if (!hasSemicolon(children)) {
    return block(valueSlotChildren(children)[0] ?? any(''));
  }
  const { segments, separators } = splitAtSemicolons(children, 1, children.length - 1);
  const parts = segments.map(segment => segment[0] ?? []);
  return block(withLayoutWhenComplete(list(parts, ';'), separators, parts.length - 1));
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

export function isUnknownAtRuleBlock(value: unknown): value is UnknownAtRuleBlock {
  return isNodeType(
    value,
    'UnknownAtRuleBlock'
  );
}

/*
 * Every value node a dialect can hand a css-owned reducer. The superset
 * dialects reuse css ladders with their own operand slots — Less's `calc()`
 * takes the css math-function ladder with Less atoms (DESIGN-DECISIONS P35) —
 * so a variable read, a reference chain, an interpolation or a computation
 * boundary is an operand here too. The css grammar itself never builds those
 * kinds, so for css this is the same set it always was.
 */
export function isValue(value: unknown): value is ValueNode {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  switch (value.type) {
    case 'Keyword': case 'Color': case 'Dimension': case 'Quoted': case 'Url':
    case 'FunctionCall': case 'Block': case 'Branch': case 'Operation': case 'Sequence': case 'List':
    case 'Any': case 'Null': case 'Lookup': case 'Reference': case 'Interpolation':
    case 'Expression': case 'Condition': case 'IfValue': case 'Important':
    case 'SelectorCapture':
      return true;
    default:
      return false;
  }
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
    || isUnknownAtRuleBlock(value);
}

export const selectorBranches = (children: readonly unknown[]): SelectorBranch[] =>
  children.filter(isSelectorBranch);

export function selectorArgumentText(value: unknown): string {
  if (isSelectorList(value)) {
    return value.selectors.map(selectorBranchCanonical).join(',');
  }
  return tokenText(value);
}

export type ComplexSegment = { combinator?: ' ' | '>' | '+' | '~' | '|' | '||'; term: SelectorTerm };

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
