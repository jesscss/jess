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
  interpolation,
  keyword,
  funcCall,
  list,
  operation,
  selectorBranchCanonical,
  spaced,
  selectorTermOf,
  selist
} from './nodes.js';
import { generalEnclosedSourceOf, valueLayoutOf, withGeneralEnclosedSource, withGeneralEnclosedTemplate, withValueLayout } from './provenance.js';
import { isForBinding, isToken, semanticGapText } from './grammar-helpers.js';
import type {
  AnonymousMixin,
  CompoundSelector,
  Block,
  Branch,
  Declaration,
  ExtendInstruction,
  For,
  ForBinding,
  FunctionCall,
  If,
  Interpolation,
  Keyword,
  List,
  MixinCall,
  MixinDefinition,
  Param,
  Quoted,
  Reference,
  Ruleset,
  SelectorBranch,
  SelectorList,
  SelectorTerm,
  SimpleSelector,
  SimpleToken,
  Statement,
  StyleImport,
  ValueNode,
  ValueSlot,
  While
} from './nodes.js';
import type { AtRuleBlock, AtRuleStatement, UnknownAtRuleBlock } from './at-rule.js';
import type { AstSourceSpan } from './provenance.js';
import type { Token } from './grammar-helpers.js';
import type { GuardNode } from './guard.js';

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
 * A dialect's keyword argument (Less `@name: value`), reduced to a call
 * argument: an object carrying a value node but no node type of its own.
 */
function isKeywordArgument(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && !('type' in value) && 'value' in value && typeof value.value === 'object';
}

/*
 * Split an argument list's children into its `;` groups, in one walk over the
 * grammar's own tokens. A comment is one whole trivia token, so a `;` inside
 * one is never read as a separator, and a value is checked first, so a value
 * node is never read as punctuation. Only children in `[from, to)` are read,
 * so a call can leave out its opener and `)`.
 *
 * - `segments`: the values of each group (empty where the author wrote none).
 * - `separators`: each `;`'s authored run — the padding before it (its left
 *   argument's gap), the `;`, and the padding after it.
 * - `commas`: per group, the authored run between each two comma-separated
 *   values — the left argument's gap, the `,`, and the padding after it.
 * - `branches`: a group whose first value is followed by a `:` terminal is a
 *   BRANCH (ledger P38); the run across its `:` is not a comma boundary.
 */
function splitArguments(children: readonly unknown[], from: number, to: number): { segments: ValueSlot[][]; separators: string[]; commas: string[][]; branches: boolean[] } {
  const segments: ValueSlot[][] = [[]];
  const separators: string[] = [];
  const commas: string[][] = [[]];
  const branches: boolean[] = [false];
  let padding = '';
  let afterDelimiter = false;
  for (let index = from; index < to; index++) {
    const child = children[index];
    if (isValueSlotValue(child)) {
      const segment = segments[segments.length - 1]!;
      if (afterDelimiter) {
        separators[separators.length - 1] += padding;
        afterDelimiter = false;
      } else if (segment.length > 0 && !(branches[branches.length - 1] === true && segment.length === 1)) {
        commas[commas.length - 1]!.push(padding);
      }
      padding = '';
      segment.push(child);
    } else if (isKeywordArgument(child)) {
      throw new SyntaxError('A keyword argument cannot be part of a branch list or a `;` group.');
    } else if (isTerminalText(child)) {
      const text = tokenText(child);
      if (text === ';') {
        separators.push(padding + text);
        padding = '';
        afterDelimiter = true;
        segments.push([]);
        commas.push([]);
        branches.push(false);
      } else {
        if (text === ':' && segments[segments.length - 1]!.length === 1) {
          branches[branches.length - 1] = true;
        }
        padding += text;
      }
    }
  }
  if (afterDelimiter) {
    separators[separators.length - 1] += padding;
  }
  return { segments, separators, commas, branches };
}

/** Record `separators` as `value`'s layout when there is one per boundary. */
function withLayoutWhenComplete<T extends object>(value: T, separators: readonly string[], expected: number): T {
  return separators.length === expected ? withValueLayout(value, separators) : value;
}

/**
 * A generic call's reduction. Without a `;` the arguments are the comma run,
 * with its authored separator layout — or, left-factored on a first condition
 * followed by a `:`, one branch-list argument. With a `;` (`foo(a; b)`) the
 * body is ONE argument, the `;` List of its groups, so the call carries the
 * separator it was written with instead of a comma it was not.
 */
export function semicolonGroupedCall(children: readonly unknown[]): FunctionCall {
  const name = functionOpenName(children[0]);
  const { segments, separators, commas, branches } = splitArguments(children, 1, children.length - 1);
  if (segments.length === 1) {
    const args = segments[0]!;
    const branchList = withFirstBranchCondition(args);
    if (branchList !== undefined) {
      return funcCall(name, [branchList]);
    }
    return funcCall(name, withLayoutWhenComplete([...args], commas[0]!, Math.max(0, args.length - 1)));
  }
  const groups = semicolonGroups(segments, commas, branches);
  return funcCall(name, [withLayoutWhenComplete(list(groups, ';'), separators, groups.length - 1)]);
}

/**
 * A var() fallback's function call (the permissive fallback reading). Without a
 * `;` or a branch its items are the call's arguments as they always were, an
 * empty item kept as the empty `Any`. A branch (ledger P38) is the same
 * `Branch` a generic call builds — one branch is the call's one argument — and
 * with a `;` (`foo(a; b)`) the body is ONE argument, the `;` List of its
 * groups, as a generic call's is.
 */
export function fallbackCall(children: readonly unknown[]): FunctionCall {
  const name = functionOpenName(children[0]);
  const { segments, separators, commas, branches } = splitArguments(children, 1, children.length - 1);
  if (segments.length === 1 && branches[0] !== true) {
    return funcCall(name, segments[0]!);
  }
  const groups = semicolonGroups(segments, commas, branches);
  return funcCall(name, [groups.length === 1 ? groups[0]! : withLayoutWhenComplete(list(groups, ';'), separators, groups.length - 1)]);
}

/** A whitespace run: one value is itself, several keep their authored separators. */
export function spaceRun(children: readonly unknown[], fields: ReducerFields | undefined): ValueSlot {
  const values = valueSlotChildren(children);
  return values.length === 1 ? values[0]! : withAuthoredSeparators(values, fields, values.length - 1);
}

/**
 * A branch list after its first condition and colon (ledger P38): the first
 * branch's value — the branch still waiting for that condition, which the
 * call's reducer supplies through {@link withFirstBranchCondition} — then each
 * later `;` group, a `Branch` when its first value is followed by a `:`,
 * else a plain group. One group is the branch itself; several (or one with the
 * spec's trailing `;`, kept as an empty slot) are the `;` List they were
 * written as, with each `;`'s authored run as layout.
 */
export function branchRest(children: readonly unknown[]): ValueSlot {
  const { segments, separators, commas, branches } = splitArguments(children, 0, children.length);
  const groups = semicolonGroups(segments, commas, branches);
  const first = branch([], groups[0]!);
  if (groups.length === 1) {
    return first;
  }
  groups[0] = first;
  return withLayoutWhenComplete(list(groups, ';'), separators, groups.length - 1);
}

/* Is this the first branch of a `BranchRest`, still without its condition? */
function isOpenBranch(value: ValueSlot | undefined): value is Branch {
  return value !== undefined && !isValueSlotArray(value) && value.type === 'Branch'
    && isValueSlotArray(value.condition) && value.condition.length === 0;
}

/**
 * Give a branch list its first condition. A call body left-factored on its
 * first argument reduces to `[condition, rest]`, where `rest` is a
 * {@link branchRest} result; this returns the one branch-list argument, or
 * `undefined` when the arguments are not that shape. A parsed condition is never
 * empty, so an empty one only ever marks the branch awaiting it.
 */
export function withFirstBranchCondition(args: readonly ValueSlot[]): ValueSlot | undefined {
  const [condition, rest] = args;
  if (args.length !== 2 || condition === undefined || rest === undefined) {
    return undefined;
  }
  if (isOpenBranch(rest)) {
    return branch(condition, rest.value);
  }
  if (!isValueSlotArray(rest) && rest.type === 'List' && rest.sep === ';' && isOpenBranch(rest.value[0])) {
    const groups = [branch(condition, rest.value[0].value), ...rest.value.slice(1)];
    const layout = valueLayoutOf(rest);
    return layout === undefined ? list(groups, ';') : withValueLayout(list(groups, ';'), layout);
  }
  return undefined;
}

/*
 * An `<if-test>` call (`media(…)`, `supports(…)`, `style(…)`): the opener the
 * value dispatch read and its one argument, the contents between the call's
 * parentheses. Empty contents are no argument.
 */
export function ifTestCall(children: readonly unknown[]): FunctionCall {
  const argument = generalEnclosedArgument(children.slice(1));
  return funcCall(functionOpenName(children[0]), argument === undefined ? [] : [argument]);
}

/*
 * The contents of a parenthesized query or `<general-enclosed>`, in order: a
 * query value, the words `not`/`and`/`or`, and component values, as one
 * sequence; a top-level comma makes it a comma `List` of such sequences, and
 * an empty item between commas is the empty slot. Parenthesis tokens are the
 * group's own and are not contents.
 */
export function generalEnclosedArgument(children: readonly unknown[]): ValueNode | undefined {
  const items: ValueSlot[] = [];
  let parts: ValueNode[] = [];
  let commas = 0;
  const flush = (): void => {
    items.push(parts.length === 1 ? parts[0]! : parts.length === 0 ? [] : spaced(parts));
    parts = [];
  };
  for (const child of children) {
    if (isCommaList(child)) {
      child.value.forEach((item, index) => {
        if (index > 0) {
          flush();
        }
        parts.push(...slotParts(item));
      });
    } else if (isValueSlotValue(child)) {
      parts.push(...slotParts(child));
    } else if (isTerminalText(child)) {
      const text = tokenText(child);
      if (text === ',') {
        commas++;
        flush();
      } else if (/^(?:not|and|or)$/i.test(text)) {
        parts.push(keyword(text));
      }
    }
  }
  if (commas === 0) {
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0]! : spaced(parts);
  }
  flush();
  return list(items, ',');
}

/*
 * The `<ident> : <declaration-value>` of `supports()`: the name alone, or the
 * `:` Operation over its value list (a multi-part value is one sequence), as
 * Less's supports declaration builds it. A colon with no value is
 * `<general-enclosed>`.
 */
export function supportsDeclaration(children: readonly unknown[]): ValueNode {
  const name = keyword(tokenText(children[0]));
  if (children.length === 1) {
    return name;
  }
  const value = children.find(isValueSlotValue);
  if (value === undefined) {
    return generalEnclosedSequence(children);
  }
  const parts = slotParts(value);
  return operation(':', name, parts.length === 1 ? parts[0]! : spaced(parts), false, cssBaseMathOutsideParens(':'));
}

function isCommaList(value: unknown): value is List {
  return isNodeType(value, 'List') && 'sep' in value && value.sep === ',';
}

/*
 * A style query's `<style-feature>`: the custom property alone, or it, `:`,
 * and its uncomputed value — the same Operation a Less style query builds.
 */
export function styleFeature(children: readonly unknown[]): ValueNode {
  const [name, value] = children.filter(isValue);
  return value === undefined
    ? name!
    : operation(':', name!, value, false, cssBaseMathOutsideParens(':'));
}

/*
 * A function-form or parenthesized `<general-enclosed>`: its grammar-owned
 * content is one `Interpolation`; a leading opener makes it a call.
 */
export function enclosedCall(children: readonly unknown[]): ValueNode {
  const content = children.find((child): child is Interpolation => isNodeType(
    child,
    'Interpolation'
  ));
  if (content === undefined) {
    throw new TypeError('CSS general-enclosed lost its grammar-owned content.');
  }
  const head = children[0];
  return isTerminalText(head) && tokenText(head) !== '('
    ? funcCall(
        functionOpenName(head),
        [content]
      )
    : block(content);
}

/*
 * The value each `;` group reduces to: nothing is the empty slot `[]`, one
 * argument is itself, and several are the comma `List` they were written as,
 * carrying that group's authored comma runs. A branch group is a `Branch` of
 * its first value (the condition) and the rest (the value, reduced the same
 * way).
 */
function semicolonGroups(segments: readonly ValueSlot[][], commas: readonly string[][], branches: readonly boolean[]): ValueSlot[] {
  const commaRun = (values: readonly ValueSlot[], layout: readonly string[]): ValueSlot => {
    if (values.length === 0) {
      return [];
    }
    if (values.length === 1) {
      return values[0]!;
    }
    return withLayoutWhenComplete(list([...values], ','), layout, values.length - 1);
  };
  return segments.map((group, index) => (branches[index] === true
    ? branch(group[0]!, commaRun(group.slice(1), commas[index]!))
    : commaRun(group, commas[index]!)));
}

/**
 * A parenthesized group that may hold `;`-separated parts (a `var()` fallback
 * `(a; b)`). Without a `;` it is the one value it always was; with one it is the
 * `;` List of its parts, an empty part as the empty slot `[]`.
 */
export function parenGroupBlock(children: readonly unknown[]): Block {
  const { segments, separators } = splitArguments(children, 1, children.length - 1);
  if (segments.length === 1) {
    return block(segments[0]![0] ?? any(''));
  }
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
    case 'SelectorCapture': case 'AnonymousMixin':
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

/** A `<mf-value>`: one value, or a `<ratio>` (`16/9`) as the `/` Operation. */
export function queryValueRatio(children: readonly unknown[]): ValueNode {
  const values = valueChildren(children);
  const numerator = values[0]!;
  const denominator = values[1];
  return denominator === undefined
    ? numerator
    : operation('/', numerator, denominator, false, cssBaseMathOutsideParens('/'));
}

/**
 * A query feature's contents (`QueryFeatureContents`): a name alone, a name
 * with `:` and a value, a name compared with one or two values, or a value
 * compared with the name — the same Operations the four feature forms built.
 */
export function queryFeatureContents(children: readonly unknown[], span: AstSourceSpan, state: unknown): ValueNode {
  const head = children[0];
  if (isValue(head)) {
    /* A lone value is no `<mf-plain>`/`<mf-range>`: the feature is general-enclosed. */
    if (children.length === 1) {
      return withAuthoredGeneralEnclosed(head, span, state);
    }

    /* A value-first range is exactly `value op name [op value]`; anything else read is general-enclosed. */
    const isRange = (children.length === 3 || (children.length === 5 && isValue(children[4])))
      && typeof children[2] === 'string';
    if (!isRange) {
      return withAuthoredGeneralEnclosed(generalEnclosedSequence(children), span, state);
    }
    const property = keyword(tokenText(children[2]));
    const operators = queryComparisonOperators(children);
    let result: ValueNode = operation(operators[0]!, head, property, false, cssBaseMathOutsideParens(operators[0]!));
    if (operators.length > 1) {
      const right = children[4];
      if (!isValue(right)) {
        throw new Error('CSS AST query range lost its trailing value');
      }
      result = operation(operators[1]!, result, right, false, cssBaseMathOutsideParens(operators[1]!));
    }
    return result;
  }
  const name = keyword(tokenText(head));
  if (children.length === 1) {
    return name;
  }

  /* `not <media-in-parens>`: the routed `not` and its parenthesized operand. */
  if (children.length === 2 && isValue(children[1])) {
    return spaced([name, children[1]]);
  }
  if (tokenText(children[1]) === ':') {
    return children.length === 3 && isValue(children[2])
      ? operation(':', name, children[2], false, cssBaseMathOutsideParens(':'))
      : generalEnclosedSequence(children);
  }

  /* A comparison is exactly `name op value [op value]`; anything else read is general-enclosed. */
  const isComparison = (children.length === 3 && isValue(children[2]))
    || (children.length === 5 && isValue(children[2]) && isValue(children[4]));
  return isComparison ? chainedQueryComparison(name, children) : generalEnclosedSequence(children);
}

/*
 * A query feature's parenthesized group. When its contents are a structured
 * `<general-enclosed>`, the whole group — parentheses and padding included —
 * records its source bytes, so the emitter prints it as written.
 */
export function queryFeatureBlock(children: readonly unknown[], span: AstSourceSpan, state: unknown): ValueNode {
  const value = firstValue(children);
  const group = block(value);

  /* Only the group whose own contents are general-enclosed; a group around a marked group is a condition. */
  return generalEnclosedSourceOf(value) === undefined || value.type === 'Block'
    ? group
    : withAuthoredGeneralEnclosed(group, span, state);
}

/*
 * Condition functions a spec defines, which are therefore not
 * `<general-enclosed>`: css-contain-3/5 `style()` and `scroll-state()`,
 * css-conditional-4/5 `selector()`, `font-tech()` and `font-format()`.
 * Each is defined for one at-rule only (`style()` in `@container`,
 * `selector()` in `@supports`), but the exemption is by name in every
 * query prelude: the reducers are shared across at-rules, so `@media
 * style(--x:1)` is normalized too. Ledger N14 records this as an owner-pending
 * scope choice.
 */
const DEFINED_CONDITION_FUNCTIONS = new Set(['style', 'scroll-state', 'selector', 'font-tech', 'font-format']);

/*
 * A function-form or parenthesized `<general-enclosed>` read as a template
 * (`Enclosed`, a query function's scanned payload): it records its source
 * bytes so the emitter prints it as written — unless it is a defined condition
 * function. A template carrying the dialect's interpolation, which P16
 * evaluates, is marked a template instead: substituted, then printed as written.
 */
export function generalEnclosedGroup<T extends ValueNode>(value: T, span: AstSourceSpan, state: unknown): T {
  if (value.type === 'FunctionCall' && DEFINED_CONDITION_FUNCTIONS.has(value.name.toLowerCase())) {
    return value;
  }
  const payload = value.type === 'FunctionCall' ? value.args[0]?.value : value.type === 'Block' ? value.value : undefined;
  if (isInterpolation(payload) && payload.parts.some(part => 'ref' in part)) {
    return withGeneralEnclosedTemplate(value);
  }
  return withAuthoredGeneralEnclosed(value, span, state);
}

/*
 * Record a structured `<general-enclosed>` value's source bytes: the slice of
 * the parse input its span covers. The parse state carries the input; a run
 * without it is a grammar wiring defect, so it throws rather than falling back
 * to normalized, evaluated output.
 */
function withAuthoredGeneralEnclosed<T extends object>(value: T, span: AstSourceSpan, state: unknown): T {
  if (typeof state !== 'object' || state === null || !('source' in state) || typeof state.source !== 'string') {
    throw new TypeError('A general-enclosed query group needs the parse input in its parse state to be emitted as written.');
  }
  return withGeneralEnclosedSource(value, state.source.slice(span.start, span.end));
}

/*
 * `<general-enclosed>` read as a query's contents (media-queries-4 §3.1): what
 * was read, in order, as one sequence. A feature name (the string a `Property`
 * reduces to) stays a keyword and a comparison or colon token the authored
 * delimiter. The query-prelude emitter joins it with single spaces, as it does
 * every structured query feature.
 */
function generalEnclosedSequence(children: readonly unknown[]): ValueNode {
  return spaced(children.flatMap((child) => {
    if (isValueSlotValue(child)) {
      return slotParts(child);
    }
    return [typeof child === 'string' ? keyword(child) : any(tokenText(child))];
  }));
}

/** The values of a component-value slot, in order: a multi-part slot is its parts. */
function slotParts(slot: ValueSlot): ValueNode[] {
  return isValueSlotArray(slot) ? slot.flatMap(slotParts) : [slot];
}

/**
 * A `not`/`and`/`or` chain of parenthesized query operands (media-queries-4
 * `<media-condition>`, css-contain-3 `<container-condition>`): the operands,
 * with each combinator word kept as a keyword. One operand is itself; an
 * operand read as component values contributes its parts.
 */
export function queryConditionChain(children: readonly unknown[]): ValueNode {
  const values: ValueNode[] = [];
  for (const child of children) {
    if (isValueSlotValue(child)) {
      values.push(...slotParts(child));
    } else {
      const normalized = tokenText(child).toLowerCase();
      if (normalized === 'not' || normalized === 'and' || normalized === 'or') {
        values.push(keyword(tokenText(child)));
      }
    }
  }
  return values.length === 1 ? values[0]! : spaced(values);
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

/*
 * Reducer helpers the preprocessor dialects share. Each was written once per
 * dialect in that dialect's own `grammar-helpers.ts`.
 *
 * - A helper that differed only in the dialect name inside its error message
 *   takes that name as `dialect`, so the message an author sees is unchanged.
 * - A helper that differed only in the value predicate it recurses into takes
 *   that predicate as `isOperand`: the dialects' value sets genuinely differ,
 *   so the predicate stays theirs and only the structure is shared.
 * - A type guard checks the node's tag. The dialect copies also re-checked
 *   fields that every core constructor always sets; on the scss and jess
 *   corpora and suites the two checks never disagreed.
 */

export function isAtRuleStatement(value: unknown): value is AtRuleStatement {
  return isNodeType(
    value,
    'AtRuleStatement'
  );
}

export function isMixinDefinition(value: unknown): value is MixinDefinition {
  return isNodeType(
    value,
    'MixinDefinition'
  );
}

export function isMixinCall(value: unknown): value is MixinCall {
  return isNodeType(
    value,
    'MixinCall'
  );
}

export function isStyleImport(value: unknown): value is StyleImport {
  return isNodeType(
    value,
    'StyleImport'
  );
}

export function isAnonymousMixin(value: unknown): value is AnonymousMixin {
  return isNodeType(
    value,
    'AnonymousMixin'
  );
}

export function isReference(value: unknown): value is Reference {
  return isNodeType(
    value,
    'Reference'
  );
}

export function isQuoted(value: unknown): value is Quoted {
  return isNodeType(
    value,
    'Quoted'
  );
}

export function isFor(value: unknown): value is For {
  return isNodeType(
    value,
    'For'
  );
}

export function isIf(value: unknown): value is If {
  return isNodeType(
    value,
    'If'
  );
}

export function isWhile(value: unknown): value is While {
  return isNodeType(
    value,
    'While'
  );
}

/*
 * A mixin parameter is the one param-shaped reduction a grammar produces: it
 * carries no `type` tag, which is what tells it apart from every AST node, and
 * it has at least one of the three fields a `Param` is made of.
 */
export function isParam(value: unknown): value is Param {
  return typeof value === 'object'
    && value !== null
    && !('type' in value)
    && ('name' in value || 'pattern' in value || 'rest' in value);
}

/** A parameter list; an empty list is still one. */
export function isParamArray(value: unknown): value is Param[] {
  return Array.isArray(value) && value.every(isParam);
}

export function isExtendInstruction(value: unknown): value is ExtendInstruction {
  return typeof value === 'object'
    && value !== null
    && 'target' in value
    && isSelectorList(value.target)
    && 'partial' in value
    && typeof value.partial === 'boolean';
}

export function requireToken(value: unknown, dialect: string): Token {
  if (!isToken(value)) {
    throw new TypeError(`${dialect} grammar produced a non-token child.`);
  }
  return { value: value.value };
}

export function requireString(value: unknown, dialect: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${dialect} grammar produced a non-string child.`);
  }
  return value;
}

export function requireForBinding(value: unknown, dialect: string): ForBinding {
  if (!isForBinding(value)) {
    throw new TypeError(`${dialect} grammar produced an invalid for binding.`);
  }
  return value;
}

export function requireInterpolation(value: unknown, dialect: string): Interpolation {
  if (!isInterpolation(value)) {
    throw new TypeError(`${dialect} grammar produced a non-interpolation child.`);
  }
  return value;
}

export function requireSelectorList(value: unknown, dialect: string): SelectorList {
  if (!isSelectorList(value)) {
    throw new TypeError(`${dialect} grammar produced a non-selector-list child.`);
  }
  return value;
}

/** A value slot: one value, or an authored array of slots, each accepted by `isOperand`. */
export function isValueSlotOf(value: unknown, isOperand: (value: unknown) => value is ValueNode): value is ValueSlot {
  if (!Array.isArray(value)) {
    return isOperand(value);
  }
  for (const item of value) {
    if (!isValueSlotOf(
      item,
      isOperand
    )) {
      return false;
    }
  }
  return true;
}

/** A guard tree whose operands `isOperand` accepts. */
export function isGuardNodeOf(value: unknown, isOperand: (value: unknown) => value is ValueNode): value is GuardNode {
  if (typeof value !== 'object' || value === null || !('g' in value)) {
    return false;
  }
  switch (value.g) {
    case 'default':
      return true;
    case 'truth':
      return 'value' in value && isOperand(value.value);
    case 'cmp':
    case 'match':
      return 'op' in value && typeof value.op === 'string'
        && 'left' in value && isOperand(value.left)
        && 'right' in value && isOperand(value.right);
    case 'call':
      return 'name' in value && typeof value.name === 'string'
        && 'args' in value && Array.isArray(value.args) && value.args.every(isOperand);
    case 'not':
      return 'inner' in value && isGuardNodeOf(
        value.inner,
        isOperand
      );
    case 'and':
    case 'or':
      return 'left' in value && isGuardNodeOf(
        value.left,
        isOperand
      )
      && 'right' in value && isGuardNodeOf(
        value.right,
        isOperand
      );
    default:
      return false;
  }
}

export function requireGuardNodeOf(value: unknown, isOperand: (value: unknown) => value is ValueNode, dialect: string): GuardNode {
  if (!isGuardNodeOf(
    value,
    isOperand
  )) {
    throw new TypeError(`${dialect} grammar produced a non-guard child.`);
  }
  return value;
}

/** Append literal text, merging it into a trailing literal part. */
export function appendInterpolationLiteral(parts: Interpolation['parts'], text: string): void {
  const previous = parts[parts.length - 1];
  if (previous !== undefined && 'lit' in previous) {
    parts[parts.length - 1] = { lit: previous.lit + text };
  } else {
    parts.push({ lit: text });
  }
}

/** Flatten a grammar-owned raw template without ever reparsing its bytes. */
export function interpolationFromTemplateChildren(children: readonly unknown[], dialect: string): Interpolation {
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
        requireToken(
          child,
          dialect
        ).value
      );
    }
  }
  return interpolation(parts);
}

/**
 * Flatten the grammar-owned parts of a custom-property value. Custom-property
 * values are never evaluated, so every byte outside a typed interpolation stays
 * literal `<declaration-value>` text and the reduction only joins grammar
 * children — it never rescans source. Nested balanced groups arrive as nested
 * arrays from the paren/square/curly productions.
 */
export function appendCustomValueParts(children: readonly unknown[], parts: Interpolation['parts'], seen: { interpolated: boolean }, dialect: string): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      appendCustomValueParts(
        child,
        parts,
        seen,
        dialect
      );
    } else if (isInterpolation(child)) {
      seen.interpolated = true;
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
        requireToken(
          child,
          dialect
        ).value
      );
    }
  }
}

/** Reduce a whole custom-property value to `Interpolation` (when it carries an
 * interpolation) or to verbatim `Any` text. */
export function customValueFromChildren(children: readonly unknown[], dialect: string): ValueNode {
  const parts: Interpolation['parts'] = [];
  const seen = { interpolated: false };
  appendCustomValueParts(
    children,
    parts,
    seen,
    dialect
  );
  if (seen.interpolated) {
    return interpolation(parts);
  }
  return any(parts.map(part => 'lit' in part ? part.lit : '').join(''));
}
