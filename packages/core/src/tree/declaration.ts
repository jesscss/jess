import { setSourceSpan, spanStartOf, spanEndOf, sourceSpanOf } from './util/provenance.js';
import {
  Node,
  F_ALLOW_ROOT,
  F_STATIC,
  F_NON_STATIC,
  defineType,
  type LocationInfo
} from './node.js';
import { isNode } from './util/is-node.js';
import { Nil } from './nil.js';
import type { Context } from '../context.js';
import { Interpolated } from './interpolated.js';
import { Any, any, keyword, type AnyRole } from './any.js';
import { Reference } from './reference.js';
import { List } from './list.js';
import { Sequence, spaced } from './sequence.js';
import { Operation } from './operation.js';
import { N } from './node-type.js';
import type { Call } from './call.js';
import {
  OutputWriter,
  type PrintOptions,
  type FinalPrintOptions,
  getPrintOptions,
  prepareRenderPrintState,
  savePrintState,
  restorePrintState
} from './util/print.js';
import {
  isRenderBuffer,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { consumeTrivia, emitCommentTriviaAfterNode, emitCommentTriviaAfterOffset, emitCommentTriviaBetweenNodes, emitTriviaTokens, commentRunsWithinSpan, emitNextSpanComment } from './util/trivia.js';
import { fieldSpanAt } from './util/provenance.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isIdentifierChar(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_-]/u.test(value));
}

export const enum AssignmentType {
  Default = ':',
  Add = '+:',              // similar to += in JS, but merges lists / sequences / collections
  // Subtract = '-:',      // math subtraction, like -= in JS
  // Multiply = '*:',      // math multiplication, like *= in JS
  // Divide = '/:',        // math division, like /= in JS
  CondAssign = '?:',       // assign only when no value is already defined
  // CondAdd = '?+:',      // add if defined, otherwise assign
  // CondSubtract = '?-:', // subtract if defined, otherwise assign
  // CondMultiply = '?*:', // multiply if defined, otherwise assign
  // CondDivide = '?/:',   // divide if defined, otherwise assign

  /** Legacy Less flags */
  MergeList = '&,:',    // merge into a list if another prop exists with this flag
  MergeSequence = '&_:' // merge into a sequence if another prop exists with this flag
}

/**
 * A declaration carries a MERGE indicator when its assignment merges into a
 * sibling of the same property (`+:` / `&,:` / `&_:`) or was produced by merge
 * normalization. Such a declaration needs structural COALESCING during the
 * eval-order pass (`Rules._coalesceMergedDeclarations`) before it is renderable,
 * so it is NOT directly renderable and must not carry `F_STATIC`.
 */
export function declarationOptionsMerge(options: DeclarationOptions | undefined): boolean {
  if (options === undefined) {
    return false;
  }
  if (options.normalizedFromAssign !== undefined) {
    return true;
  }
  const assign = options.assign;
  return assign === AssignmentType.Add
    || assign === AssignmentType.MergeList
    || assign === AssignmentType.MergeSequence;
}

export type DeclarationOptions = {
  assign?: AssignmentType;
  /** Tracks that this declaration was created via assignment normalization (e.g. +:, +_:). */
  normalizedFromAssign?: AssignmentType;
  semi?: boolean;
  /**
   * This doesn't prevent shadowing; it prevents declarations like:
   *   ^$overwrite: foo;
   *
   * Written as `!$foo:` in Jess or imported from a readonly context
   */
  readonly?: boolean;
  /**
   * Instead of implicitly declaring or overriding,
   * requires a variable to previously be explicitly
   * declared within scope.
   *
   * Used by SCSS (!global) and Jess's (^$foo:)
   */
  setDefined?: boolean;

  /** Used by SCSS (!default) and Jess (?:) */
  // setIfUndefined?: boolean
  /**
   * Throw if already defined in the immediate scope
   * Will not throw if defined in a parent scope.
   *
   * Used by SCSS in the case of mixins... not Jess?
   */
  throwIfDefined?: boolean;
};
/** Declaration / VarDeclaration names are plain strings or interpolated templates. */
export type DeclarationValue<T extends AnyRole = 'property'> = {
  name: string | Interpolated<T>;
  value: Node | string | DeclarationValueSegment[];
  /** The actual string representation of important, if it exists */
  important?: Any<'flag'> | string | boolean;
};

type DeclarationValueSegment = Node | string;

export type DeclarationName<T extends AnyRole = 'property'> = string | Interpolated<T>;

export function declarationNameKey(name: DeclarationName): string {
  return typeof name === 'string' ? name : String(name.valueOf());
}

type DeclarationEvalState = {
  output: Node;
  name?: DeclarationValue['name'];
  value?: DeclarationValue['value'];
  important?: DeclarationValue['important'];
  nil: boolean;
};

type CustomInterpolatedRenderValue = {
  source: Interpolated;
  replacements: Node[];
};

type DeclarationRenderState = {
  name: DeclarationValue['name'];
  value: DeclarationValue['value'];
  customInterpolatedValue?: CustomInterpolatedRenderValue;
  mergeAdapter?: DeclarationMergeAdapterState;
  important?: DeclarationValue['important'];
  importantText?: string;
  normalizedFromAssign?: AssignmentType;
  output?: Node;
  nil: boolean;
};

function sameConcreteLocation(
  left: { start: number; end: number } | undefined,
  right: { start: number; end: number } | undefined
): boolean {
  return left !== undefined && right !== undefined
    && left.start === right.start && left.end === right.end;
}

export function finalizeContextualImportantState(
  context: Context,
  important: DeclarationValue['important']
): { importantText?: string } {
  const importantText = context.hasImportantSource && !important
    ? '!important'
    : undefined;
  if (context.hasImportantSource) {
    context.popImportantSource();
  }
  return importantText ? { importantText } : {};
}

export function finalizeContextualImportantPublicState(
  context: Context,
  important: DeclarationValue['important']
): { important?: DeclarationValue['important']; importantText?: string } {
  if (!context.hasImportantSource) {
    return important ? { important } : {};
  }
  const sourceImportant = context.popImportantSource();
  if (important) {
    return { important };
  }
  return sourceImportant && sourceImportant !== true
    ? { important: sourceImportant }
    : { important: any('!important', { role: 'flag' }) };
}

export function collectDeclarationMergeAdapterItems(
  value: Node,
  options: { includeSequences?: boolean } = { includeSequences: true }
): Node[] {
  const mergedItems: Node[] = [];
  const collect = (child: Node) => {
    if (isNode(child, N.List)) {
      for (const item of child.value) {
        collect(item);
      }
      return;
    }
    if (options.includeSequences && isNode(child, N.Sequence)) {
      for (const item of child.value) {
        collect(item);
      }
      return;
    }
    const isEmptyPlaceholder = isNode(child, N.Nil)
      || (isNode(child, N.Any) && child.value === '');
    if (!isEmptyPlaceholder) {
      mergedItems.push(child);
    }
  };
  collect(value);
  return mergedItems;
}

type DeclarationMergeAdapterItemsState = {
  kind: 'list' | 'space';
  value: Node[];
};

export type DeclarationMergeAdapterState = DeclarationMergeAdapterItemsState;
type DeclarationMergeAdapterResult = DeclarationMergeAdapterState | Node | undefined;

export function createDeclarationMergeAdapterState(
  value: Node,
  mode: 'list' | 'space'
): DeclarationMergeAdapterResult {
  const canContainMergedItems = mode === 'list'
    ? isNode(value, N.List)
    : isNode(value, N.List | N.Sequence);
  if (!canContainMergedItems) {
    return undefined;
  }
  const mergedItems = collectDeclarationMergeAdapterItems(value, {
    includeSequences: mode === 'space'
  });
  if (mergedItems.length === 0) {
    return undefined;
  }
  if (mergedItems.length === 1) {
    return mergedItems[0]!;
  }
  return { kind: mode, value: mergedItems };
}

type DeclarationValueState<T extends Declaration = Declaration> = {
  source: T;
  value: DeclarationValue['value'];
  important?: DeclarationValue['important'];
  changed: boolean;
};

type DeclarationRegistrationState = {
  name: DeclarationValue['name'];
  value: DeclarationValue['value'];
  important?: DeclarationValue['important'];
  normalizedFromAssign?: AssignmentType;
  renderOnly?: boolean;
  renderAssignment?: {
    items: Node[];
    sep: ',' | ' ';
  };
  bindOutput?: (node: Declaration) => void;
};

type DeclarationRegistrationOptions = {
  reuseCanonical?: boolean;
};

type DeclarationRenderValue =
  | DeclarationValue['value']
  | Nil
  | Node[]
  | CustomInterpolatedRenderValue;

const isCustomInterpolatedRenderValue = (value: DeclarationRenderValue): value is CustomInterpolatedRenderValue => (
  !(value instanceof Node)
  && !Array.isArray(value)
  && typeof value !== 'string'
  && value.source instanceof Interpolated
);

const isDeferredDeclarationValue = (value: DeclarationValue['value']): boolean => (
  typeof value === 'string' || Array.isArray(value)
);

const getSingleInterpolatedCustomValue = (node: Node): Interpolated | undefined => (
  node instanceof Interpolated
    ? node
    : node instanceof Sequence && node.value.length === 1 && node.value[0] instanceof Interpolated
      ? node.value[0]
      : undefined
);

const getSingleInterpolatedDeclarationValue = (
  value: DeclarationValue['value']
): Interpolated | undefined => (
  value instanceof Node ? getSingleInterpolatedCustomValue(value) : undefined
);

const emitLeadingTriviaForSingleInterpolatedCustomValue = (
  value: Node,
  source: Interpolated,
  options: ReturnType<typeof getPrintOptions>
): void => {
  if (!(value instanceof Sequence) || value.value[0] !== source) {
    return;
  }
  const trivia = options.trivia ?? value.sourceRoot?._treeContext?.opts?.trivia;
  if (!trivia || trivia === true) {
    return;
  }
  emitTriviaTokens(consumeTrivia(trivia, spanStartOf(source), 'before', options), options);
};

const inheritCustomInterpolatedValuePlacement = (sourceValue: Node, evaluatedValue: Node): Node => {
  const source = getSingleInterpolatedCustomValue(sourceValue);
  return source ? evaluatedValue.inherit(source) : evaluatedValue;
};

const emitLeadingTriviaForCustomValue = (
  value: Node,
  options: ReturnType<typeof getPrintOptions>,
  fallbackSpanStart?: number
): void => {
  const trivia = options.trivia ?? value.sourceRoot?._treeContext?.opts?.trivia;
  if (!trivia || trivia === true) {
    return;
  }
  // Evaluated values (e.g. an rgba() Call) are re-created without a source span,
  // so fall back to the authored value's original span start — the offset the
  // leading-whitespace run (the space after `:`) is keyed on.
  const offset = spanStartOf(value) ?? fallbackSpanStart;
  emitTriviaTokens(consumeTrivia(trivia, offset, 'before', options), options);
};

const shouldResolveCustomPropertyValue = (node: Node): boolean => {
  if (isNode(node, N.Reference)) {
    return node.options?.type !== 'function';
  }
  if (node.type === 'Interpolated') {
    return true;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return valueShouldResolveCustomProperty('value' in node ? (node as unknown as { value: unknown }).value : undefined);
};

const valueShouldResolveCustomProperty = (value: unknown): boolean => {
  if (isNode(value)) {
    return shouldResolveCustomPropertyValue(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (valueShouldResolveCustomProperty(value[i])) {
        return true;
      }
    }
    return false;
  }
  if (isRecord(value)) {
    for (const key in value) {
      if (valueShouldResolveCustomProperty(value[key])) {
        return true;
      }
    }
  }
  return false;
};

const unwrapAtomicCustomValue = (node: Node): Node => {
  if (isNode(node, N.List) && node.value.length === 1) {
    return unwrapAtomicCustomValue(node.value[0]!);
  }
  if (isNode(node, N.Sequence) && node.value.length === 1) {
    return unwrapAtomicCustomValue(node.value[0]!);
  }
  return node;
};

const canReuseSourceFreeAssignmentInput = (node: Node): boolean => {
  if (!isNode(node, N.Sequence | N.List)) {
    return false;
  }
  if (sourceSpanOf(node) !== undefined || !node.hasFlag(F_STATIC)) {
    return false;
  }
  const children = node instanceof Sequence ? node.value : node instanceof List ? node.value : [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!(child instanceof Node) || !child.canReuseAsLeaf()) {
      return false;
    }
  }
  return true;
};

type LessFunctionFallbackCall = Call & {
  name: Reference;
};

const isLessFunctionFallbackCall = (node: Node): node is LessFunctionFallbackCall => (
  isNode(node, N.Call)
  && isNode(node.name, N.Reference)
  && node.name.options?.type === 'function'
  && node.name.options?.fallbackValue === true
);

const stringifyDetached = (node: Node, options: PrintOptions): string => {
  const printOptions = getPrintOptions(options);
  const writer = printOptions.writer;
  const mark = writer.mark();
  node.writeSyntax(printOptions);
  const frag = writer.getSince(mark);
  writer.restore(mark);
  return frag;
};

const isHorizontalWhitespace = (code: number): boolean => (
  code === 9
  || code === 12
  || code === 13
  || code === 32
);

const needsCustomTrailingNewlineTrim = (text: string): boolean => {
  let index = text.length - 1;
  while (index >= 0 && isHorizontalWhitespace(text.charCodeAt(index))) {
    index--;
  }
  return index >= 0 && text.charCodeAt(index) === 10;
};

const leadingHorizontalWhitespace = (text: string): string => {
  let index = 0;
  while (index < text.length && isHorizontalWhitespace(text.charCodeAt(index))) {
    index++;
  }
  return index === 0 ? '' : text.slice(0, index);
};

const hasTrailingWhitespace = (text: string): boolean => {
  if (text.length === 0) {
    return false;
  }
  const code = text.charCodeAt(text.length - 1);
  return code === 10 || isHorizontalWhitespace(code);
};

const trimCustomTrailingNewline = (text: string): string => {
  if (!needsCustomTrailingNewlineTrim(text)) {
    return text;
  }
  let index = text.length - 1;
  while (index >= 0 && isHorizontalWhitespace(text.charCodeAt(index))) {
    index--;
  }
  index--;
  while (index >= 0 && isHorizontalWhitespace(text.charCodeAt(index))) {
    index--;
  }
  return text.slice(0, index + 1);
};

const nodeValueText = (node: DeclarationValue['value'] | DeclarationValue['name'] | DeclarationValue['important']): string | undefined => {
  if (typeof node === 'string') {
    return node;
  }
  if (Array.isArray(node)) {
    let text = '';
    for (let i = 0; i < node.length; i++) {
      const part = node[i]!;
      const partText = nodeValueText(part);
      if (partText === undefined) {
        return undefined;
      }
      text += partText;
    }
    return text;
  }
  if (typeof node === 'boolean' || node === undefined) {
    return undefined;
  }
  const value = node.valueOf();
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
};

const maybeTrimmedScalarText = (node: Node | string): string | undefined => {
  const text = nodeValueText(node);
  if (text === undefined || text.length === 0) {
    return text;
  }
  const first = text.charCodeAt(0);
  const last = text.charCodeAt(text.length - 1);
  return isHorizontalWhitespace(first)
    || isHorizontalWhitespace(last)
    || first === 10
    || last === 10
    ? undefined
    : text;
};

const maybeDirectSyntheticDeclarationLeafText = (node: DeclarationValue['value'] | DeclarationValue['name'] | DeclarationValue['important']): string | undefined => {
  if (typeof node === 'string') {
    return maybeTrimmedScalarText(node);
  }
  if (Array.isArray(node)) {
    return maybeTrimmedScalarText(nodeValueText(node) ?? '');
  }
  if (typeof node === 'boolean' || node === undefined) {
    return undefined;
  }
  if (
    node.type !== 'Any'
    && node.type !== 'Anonymous'
    && node.type !== 'Keyword'
  ) {
    return undefined;
  }
  if (sourceSpanOf(node) !== undefined) {
    return undefined;
  }
  return maybeTrimmedScalarText(node);
};

const stringifyCustomFallbackFunctionCall = (node: Node, options: PrintOptions): string | undefined => {
  const atomicValue = unwrapAtomicCustomValue(node);
  if (!isLessFunctionFallbackCall(atomicValue)) {
    return undefined;
  }

  const { name, args } = atomicValue;
  const printableKey = name.rawKey ?? name.key;
  let nameText: string;
  if (typeof printableKey === 'string' || typeof printableKey === 'number') {
    nameText = String(printableKey);
  } else if (Array.isArray(printableKey)) {
    let text = '';
    for (let index = 0; index < printableKey.length; index++) {
      text += String(printableKey[index]);
    }
    nameText = text;
  } else {
    nameText = stringifyDetached(printableKey, options).trim();
  }
  let argText = '';
  const values = args?.value ?? [];
  let hasArg = false;
  for (let index = 0; index < values.length; index++) {
    const arg = values[index];
    if (!arg) {
      continue;
    }
    if (hasArg) {
      argText += ', ';
    }
    argText += stringifyDetached(arg, options).trim();
    hasArg = true;
  }

  return `${nameText}(${argText})`;
};

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export class Declaration<Opts extends DeclarationOptions = DeclarationOptions> extends Node<DeclarationValue['value'], Opts> {
  static override childKeys = ['name', 'value', 'important'];

  declare value: DeclarationValue['value'];
  name: DeclarationValue['name'];
  important: DeclarationValue['important'];

  /**
   * Emit a comment authored between a bare-string `name` and the `:`/assign.
   *
   * The string name carries no own span, so instead of a per-slot offset we scan
   * this declaration's own span for comment runs that fall before the value
   * begins — authored whitespace there is normalized away, only the comment
   * round-trips.
   */
  private _emitNameBoundaryComment(options: FinalPrintOptions): void {
    if (!options.trivia) {
      return;
    }
    const value = this.value;
    // Upper bound of the name→`:` gap. Prefer the per-slot `value` fieldSpan
    // start: the value *node*'s own span can be over-broad (a coerced List gets
    // stamped with the whole declaration span, so its start collides with the
    // name and the gap collapses to empty). The fieldSpan pins the authored
    // value start. Fall back to the node's span start when no fieldSpan exists.
    const valueStart = this._valueFieldSpanStart()
      ?? (value instanceof Node ? spanStartOf(value) : undefined);
    const runs = commentRunsWithinSpan(options.trivia, spanStartOf(this), valueStart);
    if (runs.length > 0) {
      emitNextSpanComment(runs, 0, options);
    }
  }

  /** Start offset of the `value` field's per-slot span, or `undefined` when unset. */
  private _valueFieldSpanStart(): number | undefined {
    const valueIdx = (this.constructor as unknown as { childKeys?: readonly string[] })
      .childKeys?.indexOf('value') ?? -1;
    return valueIdx >= 0 ? fieldSpanAt(this, valueIdx)?.start : undefined;
  }

  constructor(
    value: DeclarationValue,
    options?: Opts,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super();
    setSourceSpan(this, location);
    this._options = options;
    // Invariant 7: store, don't adopt. `parentChildren()` (factory) parents.
    this.name = value.name;
    this.value = value.value;
    this.important = value.important;
    this._treeContext = treeContext;
    // Declarations (and Custom/VarDeclaration subclasses) are valid statements.
    this.addFlag(F_ALLOW_ROOT);
    // A merge declaration (`+:` / `&,:` / `&_:` or normalized-from-assign) needs
    // structural coalescing during eval before it is renderable, so it is never
    // render-direct. Mark it non-static up front: F_NON_STATIC is sticky, so no
    // later static child can bubble F_STATIC onto this decl (or its container).
    if (declarationOptionsMerge(options)) {
      this.addFlag(F_NON_STATIC);
    }
  }

  override* walk(deep?: boolean, reverse?: boolean): Generator<Node, void, unknown> {
    const childValues = reverse
      ? [this.important, this.value, this.name]
      : [this.name, this.value, this.important];
    for (let i = 0; i < childValues.length; i++) {
      const child = childValues[i];
      if (child instanceof Node) {
        yield child;
        if (deep) {
          yield* child.walk(deep, reverse);
        }
      }
    }
  }

  override clone(cloneFn?: (n: Node) => Node): this {
    const cloneNode = <T extends Node>(part: T): T => (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- cloneFn preserves the concrete node field type supplied by this declaration part.
      cloneFn ? cloneFn(part) as T : part
    );
    const cloneValue = (part: DeclarationValue['value']): DeclarationValue['value'] => (
      cloneFn && part instanceof Node ? cloneNode(part) : part
    );
    const cloneImportant = (part: DeclarationValue['important']): DeclarationValue['important'] => (
      cloneFn && part instanceof Node ? cloneNode(part) : part
    );
    return this.withParts({
      name: this.name instanceof Node ? cloneNode(this.name) : this.name,
      value: cloneValue(this.value),
      important: cloneImportant(this.important)
    });
  }

  private copyNameForDerived(node: DeclarationValue['name']): DeclarationValue['name'] {
    if (typeof node === 'string') {
      return node;
    }
    if (node.canReuseAsLeaf()) {
      return node.reuseAsLeaf();
    }
    const copy = node.cloneForPlacement();
    if (!(copy instanceof Interpolated)) {
      throw new TypeError('Copied declaration name must remain a declaration name');
    }
    copy.frozen = true;
    return copy;
  }

  private copyValueForDerived(node: DeclarationValue['value']): DeclarationValue['value'] {
    if (typeof node === 'string') {
      return node;
    }
    if (Array.isArray(node)) {
      const copied = new Array<DeclarationValueSegment>(node.length);
      for (let i = 0; i < node.length; i++) {
        const item = node[i]!;
        copied[i] = typeof item === 'string' ? item : this.copyValueNodeForDerived(item);
      }
      return copied;
    }
    return this.copyValueNodeForDerived(node);
  }

  private copyValueNodeForDerived(node: Node): Node {
    return node.canReuseAsLeaf() || canReuseSourceFreeAssignmentInput(node)
      ? node.reuseAsLeaf()
      : node.cloneForPlacement();
  }

  /**
   * Coerce a parser-delivered value (Node | string | array) into a single Node
   * for the assignment-composition machinery (List/Sequence/Operation/Reference
   * inputs), which is structurally node-only. Bare idents become Keyword (never
   * Any); a space-separated array becomes a Sequence, matching the surrounding
   * merge composition. Plain declarations never reach here — only explicit Less
   * assignment operators (`+:`, `?:`, `+_:`, `+,:`).
   */
  private toAssignmentInputNode(value: DeclarationValue['value']): Node {
    if (value instanceof Node) {
      return value;
    }
    if (typeof value === 'string') {
      return keyword(value);
    }
    if (value.length === 1) {
      const only = value[0]!;
      return typeof only === 'string' ? keyword(only) : only;
    }
    const nodes = new Array<Node>(value.length);
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      nodes[i] = typeof item === 'string' ? keyword(item) : item;
    }
    return spaced(nodes);
  }

  /**
   * The declaration value as a single Node. Most values already are a Node; a
   * bare string becomes a Keyword and a flat parser segment array is coalesced
   * into its structured form — a comma `List` of space `Sequence`s — matching
   * the authored `a b, c d` shape. Used where the value must be evaluated as a
   * node (variable binding, iteration source), not just serialized as text.
   */
  valueNode(): Node {
    const value = this.value;
    if (value instanceof Node) {
      return value;
    }
    if (typeof value === 'string') {
      return keyword(value);
    }
    const groups: Node[][] = [[]];
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      const node = typeof item === 'string' ? keyword(item) : item;
      if (`${node.valueOf()}` === ',') {
        groups.push([]);
        continue;
      }
      groups[groups.length - 1]!.push(node);
    }
    const items = groups.map(group => (
      group.length === 1 ? group[0]! : spaced(group)
    ));
    return items.length === 1 ? items[0]! : new List(items, { sep: ',' }).parentChildren();
  }

  private ownRenderAssignmentInput(node: Node): Node {
    return node.canReuseAsLeaf() || canReuseSourceFreeAssignmentInput(node)
      ? node.reuseAsLeaf()
      : this.copyValueNodeForDerived(node);
  }

  private ownMergedAssignmentOutputItem(node: Node): Node {
    return node.canReuseAsLeaf() ? node.reuseAsLeaf() : this.copyValueNodeForDerived(node);
  }

  private copyImportantForDerived(node: DeclarationValue['important']): DeclarationValue['important'] {
    if (!node) {
      return undefined;
    }
    if (typeof node === 'string') {
      return node;
    }
    if (typeof node === 'boolean') {
      return node;
    }
    return node.reuseAsLeaf();
  }

  private applyDerivedMetadata<T extends this>(node: T): T {
    return node.inherit(this);
  }

  private withParts(value: DeclarationValue): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Derived declarations must preserve concrete subclasses such as VarDeclaration and CustomDeclaration.
    const Ctor = this.constructor as unknown as new (
      value: DeclarationValue,
      options?: Opts,
      location?: LocationInfo,
      treeContext?: Context['treeContext']
    ) => this;
    const node = new Ctor(
      value,
      this._options ? { ...this._options } : undefined,
      sourceSpanOf(this),
      this._treeContext
    );
    return this.applyDerivedMetadata(node);
  }

  private derive(): this {
    // Share the parts (immutable templates); the derived node differs only in
    // identity/options/metadata, never in its part values.
    return this.withParts({
      name: this.name,
      value: this.value,
      important: this.important
    });
  }

  deriveWithOptions(options: Opts & DeclarationOptions): this {
    const node = this.derive();
    node.options = options;
    return node;
  }

  deriveWithParts(parts: Partial<DeclarationValue>): this {
    // Share unchanged parts (immutable templates); only substitute what changed.
    // No defensive copy of name/value/important the caller didn't touch.
    const node = this.withParts({
      name: parts.name === undefined ? this.name : parts.name,
      value: parts.value === undefined ? this.value : parts.value,
      important: parts.important === undefined ? this.important : parts.important
    });
    node.registrationPrepared = this.registrationPrepared;
    return node;
  }

  /**
   * The authored column of this declaration's property (0-based). Continuation
   * lines in a multi-line value carry their source-absolute indentation; the
   * leaf serializer re-bases them relative to the property line, so subtract the
   * property's own authored indent first to keep the relationship stable no
   * matter what depth the declaration renders at.
   */
  private authoredPropertyIndent(options: PrintOptions): number {
    const start = spanStartOf(this);
    if (start === undefined) {
      return 0;
    }
    // The source text lives on the trivia runs (the render context is not
    // file-bearing). Any run keyed near this declaration carries the full `src`.
    const trivia = options.trivia ?? undefined;
    const src = trivia?.lookup(start, 'before')?.src
      ?? trivia?.entries('before').next().value?.[1]?.src;
    if (typeof src !== 'string') {
      return 0;
    }
    const lineStart = src.lastIndexOf('\n', start - 1) + 1;
    return start - lineStart;
  }

  /**
   * True when the authored value began on the line after `:` (its leading trivia
   * run carries a newline). less.js preserves that break — e.g. a multi-line
   * `grid-template-areas` keeps its first string on its own line.
   */
  private valueLeadsWithNewline(value: DeclarationValue['value'], options: PrintOptions): boolean {
    const trivia = options.trivia ?? undefined;
    if (!trivia) {
      return false;
    }
    // Descend to the value's first authored token: a List/Sequence carries the
    // whole declaration-value span, so its own span start would pick up the
    // declaration's leading trivia instead of the value's.
    let first: Node | string | undefined = Array.isArray(value) ? value[0] : value;
    while (first instanceof List || first instanceof Sequence) {
      first = first.value[0];
    }
    const start = first instanceof Node ? spanStartOf(first) : undefined;
    // Only trust the value's leading trivia when the value token is authored
    // inside this declaration. A resolved value (e.g. a variable lookup) carries
    // its definition-site span, whose leading trivia belongs to another line.
    const declStart = spanStartOf(this);
    const declEnd = spanEndOf(this);
    if (
      start === undefined
      || declStart === undefined
      || declEnd === undefined
      || start < declStart
      || start > declEnd
    ) {
      return false;
    }
    const run = trivia.lookup(start, 'before');
    return run !== undefined && /[\r\n]/.test(run.src.slice(run.start, run.end));
  }

  private formatNonCustomValue(valOut: string, _options: PrintOptions, leadNewline = false) {
    const trimmedEnd = valOut.replace(/\s+$/g, '');
    if (!trimmedEnd.includes('\n')) {
      return ` ${trimmedEnd.replace(/^[ \t]+/g, '')}`;
    }

    // Authored multiline declaration values keep their line breaks. We normalize
    // only the minimum continuation indent rather than emulating historical
    // Less fixture cases that collapsed some unindented continuations.
    const continuationIndent = '  ';
    const propertyIndent = this.authoredPropertyIndent(_options);
    const lines = trimmedEnd.split('\n');
    let out = '';
    const [firstLine = '', ...restLines] = lines;
    const firstContent = firstLine.replace(/^[ \t]+/g, '').trimEnd();

    if (firstContent) {
      // A value authored on the line after `:` keeps that break; its first token
      // sits at the continuation indent (the leaf adds the property indent back).
      out = leadNewline ? `\n${continuationIndent}${firstContent}` : ` ${firstContent}`;
    }

    for (const line of restLines) {
      if (!line.trim()) {
        out += '\n';
        continue;
      }

      const lineIndent = line.match(/^[ \t]*/)?.[0].length ?? 0;
      const content = line.replace(/^[ \t]+/g, '').trimEnd();
      const isClosingLine = /^[}\])]([,;])?$/.test(content);
      // Continuations are re-based relative to the property line (subtract its
      // authored indent), then floored at the minimum continuation indent. The
      // leaf serializer adds the render-time property indent back on top.
      const relativeIndent = Math.max(0, lineIndent - propertyIndent);
      const normalizedIndent = ' '.repeat(
        isClosingLine ? lineIndent : Math.max(continuationIndent.length, relativeIndent)
      );
      out += `\n${normalizedIndent}${content}`;
    }

    return out || `\n${continuationIndent}`;
  }

  /** If the value has curly braces, a semi-colon is not required */
  override get requiredSemi() {
    return this.valueRequiresSemi(this.value);
  }

  private valueRequiresSemi(value: DeclarationValue['value']): boolean {
    if (typeof value === 'string') {
      return true;
    }
    return !isNode(value, N.Collection) && !isNode(value, N.Mixin);
  }

  protected declTrimmedString(options?: PrintOptions) {
    return this.declValueTrimmedString({
      name: this.name,
      value: this.value,
      important: this.important
    }, options);
  }

  private declValueTrimmedString(
    valueParts: DeclarationValue,
    rawOptions?: PrintOptions,
    renderState?: {
      customInterpolatedValue?: DeclarationRenderState['customInterpolatedValue'];
      mergeAdapter?: DeclarationMergeAdapterState;
      importantText?: string;
      normalizedFromAssign?: AssignmentType;
    }
  ) {
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const position = w.position();
    this.writeDeclarationValueSyntax(valueParts, options, renderState);
    return w.getSince(position);
  }

  /**
   * Separator between two adjacent terms of a flat declaration value array.
   *
   * Two array shapes reach here: verbatim string fragments (whitespace baked
   * into the strings, e.g. `['calc(', '100%', ' - ', '1px', ')']`) which must
   * be concatenated exactly; and string-normalized value terms from the parser
   * (e.g. `[2px, "solid", white]`) whose inter-term whitespace lives in the
   * trivia map. So: emit authored trivia before a source-backed term when we
   * have it, and otherwise insert a space ONLY when omitting it would fuse two
   * identifier-like tokens. Never add an unconditional separator — that would
   * corrupt verbatim fragments.
   */
  private emitValueTermSeparator(
    prev: Node | string,
    node: Node | string,
    options: ReturnType<typeof getPrintOptions>
  ): void {
    const w = options.writer!;
    if (options.trivia && node instanceof Node) {
      if (prev instanceof Node) {
        emitCommentTriviaBetweenNodes(prev, node, options);
      }
      const leadingTrivia = consumeTrivia(options.trivia, spanStartOf(node), 'before', options);
      if (leadingTrivia) {
        emitTriviaTokens(leadingTrivia, options);
        return;
      }
    }
    // Two adjacent value nodes (neither a verbatim string fragment) are
    // space-separated by construction — the boundary whitespace lives in
    // neither term, so emit it here regardless of the surrounding chars
    // (e.g. `"A" "B"`, `"x" counter(page)`, `1px 2px`).
    if (prev instanceof Node && node instanceof Node) {
      if (w.lastChar() !== ' ') {
        w.queueSpacer(' ');
      }
      return;
    }
    // Merge guard: a space only when the previous output ends identifier-like
    // and the next term would begin identifier-like, keeping tokens distinct.
    // A following value Node (e.g. the Quoted in `is "theme1"`) is a real,
    // space-separated term — its leading whitespace lived in neither side, and a
    // quote can never token-merge with a preceding identifier — so include the
    // quote characters in the predicate to keep that authored space.
    if (isIdentifierChar(w.lastChar())) {
      w.queueSpacer(' ', nextText => /^[A-Za-z0-9_.#'"-]/u.test(nextText));
    }
  }

  private writeDeclarationFieldValueSyntax(
    value: DeclarationValue['value'],
    options: ReturnType<typeof getPrintOptions>
  ): void {
    const w = options.writer!;
    if (typeof value === 'string') {
      w.add(value, this);
      return;
    }
    if (Array.isArray(value)) {
      let prev: Node | string | undefined;
      for (let i = 0; i < value.length; i++) {
        const item = value[i]!;
        if (prev !== undefined) {
          this.emitValueTermSeparator(prev, item, options);
        }
        if (typeof item === 'string') {
          w.add(item, this);
        } else {
          item.writeSyntax(options);
        }
        prev = item;
      }
      return;
    }
    value.writeSyntax(options);
  }

  private writeDeclarationValueSyntax(
    valueParts: DeclarationValue,
    options: ReturnType<typeof getPrintOptions>,
    renderState?: {
      customInterpolatedValue?: DeclarationRenderState['customInterpolatedValue'];
      mergeAdapter?: DeclarationMergeAdapterState;
      importantText?: string;
      normalizedFromAssign?: AssignmentType;
    }
  ): void {
    const w = options.writer!;
    const { name, value, important } = valueParts;
    const { mergeAdapter, importantText } = renderState ?? {};
    const customInterpolatedSource = renderState?.customInterpolatedValue?.source;
    const hasCustomInterpolatedRender = Boolean(
      customInterpolatedSource
      && getSingleInterpolatedDeclarationValue(value) === customInterpolatedSource
    );
    const { assign = ':', normalizedFromAssign, setDefined } = this._options ?? {};
    // setDefined uses `:=` with default spacing rules.
    const printedAssign = (normalizedFromAssign || renderState?.normalizedFromAssign)
      ? AssignmentType.Default
      : assign;
    const effAssign = (setDefined && printedAssign === ':') ? ':=' : printedAssign;
    let a = effAssign === ':' ? ':' : ` ${effAssign}`;
    // Normalize property name by trimming trailing whitespace
    const nameText = nodeValueText(name);
    if (typeof name === 'string') {
      w.add(hasTrailingWhitespace(name) ? name.trimEnd() : name, this);
    } else if (nameText !== undefined && !hasTrailingWhitespace(nameText)) {
      name.writeSyntax(options);
    } else {
      const nameMark = w.mark();
      name.writeSyntax(options);
      w.trimEndSince(nameMark);
    }
    if (name instanceof Node) {
      emitCommentTriviaAfterNode(name, options);
    } else {
      // String name: emit any comment authored between the name and the
      // `:`/assign (scanned from this declaration's span, before the value).
      this._emitNameBoundaryComment(options);
    }
    w.add(a);
    // Custom properties must preserve value text exactly as provided.
    const isCustomProperty = nameText?.startsWith('--') === true;
    if (isCustomProperty) {
      const saved = savePrintState(options, ['inCustom']);
      options.inCustom = true;
      // Authored start of the value (before eval re-created it span-less), used
      // to recover the leading-whitespace trivia keyed on that source offset.
      const originalValueSpanStart = this.value instanceof Node
        ? spanStartOf(this.value)
        : undefined;
      // Preserve custom value text, but normalize boundary artifacts:
      // - if capture ended with a line break before declaration termination,
      //   drop that trailing line break so semicolon insertion stays inline.
      const customValueText = nodeValueText(value);
      const fallbackOut = !(value instanceof Node)
        ? undefined
        : stringifyCustomFallbackFunctionCall(value, options);
      if (
        !hasCustomInterpolatedRender
        && fallbackOut === undefined
        && customValueText !== undefined
        && !needsCustomTrailingNewlineTrim(customValueText)
      ) {
        if (value instanceof Node) {
          emitLeadingTriviaForCustomValue(value, options, originalValueSpanStart);
        }
        this.writeDeclarationFieldValueSyntax(value, options);
      } else if (fallbackOut !== undefined) {
        // Emit the authored leading whitespace from trivia (the value node keeps
        // its source span here), falling back to the captured text's leading
        // whitespace when no trivia is available (synthetic values).
        const mark = w.mark();
        if (value instanceof Node) {
          emitLeadingTriviaForCustomValue(value, options, originalValueSpanStart);
        }
        const emittedLeading = w.getSince(mark).length > 0;
        const leading = emittedLeading || customValueText === undefined
          ? ''
          : leadingHorizontalWhitespace(customValueText);
        w.add(`${leading}${fallbackOut}`, value);
      } else if (hasCustomInterpolatedRender) {
        const valueMark = w.mark();
        if (value instanceof Node) {
          emitLeadingTriviaForSingleInterpolatedCustomValue(
            value,
            customInterpolatedSource!,
            options
          );
        }
        customInterpolatedSource!.writeWithReplacements(
          renderState!.customInterpolatedValue!.replacements,
          options
        );
        w.replaceSince(valueMark, valueOut => trimCustomTrailingNewline(valueOut), value);
      } else {
        const valueMark = w.mark();
        if (value instanceof Node) {
          emitLeadingTriviaForCustomValue(value, options, originalValueSpanStart);
        }
        this.writeDeclarationFieldValueSyntax(value, options);
        w.replaceSince(valueMark, (valueOut) => {
          const customOut = fallbackOut === undefined
            ? valueOut
            : `${leadingHorizontalWhitespace(valueOut)}${fallbackOut}`;
          return trimCustomTrailingNewline(customOut);
        }, value);
      }
      restorePrintState(options, saved);
    } else {
      if (mergeAdapter?.kind === 'space') {
        this.renderSpaceValueSyntax(mergeAdapter.value, options);
      } else if (mergeAdapter?.kind === 'list') {
        this.renderCommaValueSyntax(mergeAdapter.value, options);
      } else {
        const valueMark = w.mark();
        // The value's own leading whitespace is decided by `valueLeadsWithNewline`
        // (guarded to authored, in-declaration spans) and re-materialized by
        // `formatNonCustomValue`. Suppress the value node's boundary `before`
        // trivia so a relocated value (e.g. a variable lookup) cannot bleed its
        // definition-site leading newline into this declaration.
        const leadNewline = this.valueLeadsWithNewline(value, options);
        const savedBoundary = savePrintState(options, ['suppressBoundaryTrivia']);
        options.suppressBoundaryTrivia = 'pre';
        this.writeDeclarationFieldValueSyntax(value, options);
        restorePrintState(options, savedBoundary);
        w.replaceSince(valueMark, valOut => this.formatNonCustomValue(valOut, options, leadNewline), value);
      }
      if (important || importantText) {
        w.add(' ');
        if (important) {
          if (important === true) {
            w.add('!important', this);
          } else if (typeof important === 'string') {
            w.add(important, this);
          } else if (typeof important === 'boolean') {
            // False is accepted as an API convenience for no important flag.
          } else {
            const importantText = maybeTrimmedScalarText(important);
            if (importantText !== undefined) {
              w.add(importantText, important);
            } else {
              const importantMark = w.mark();
              important.writeSyntax(options);
              w.trimStartSince(importantMark);
              w.trimEndSince(importantMark);
            }
          }
        } else {
          w.add(importantText!, value);
        }
      }
    }
    if (this.valueRequiresSemi(value)) {
      const triviaSource = important ?? value;
      if (triviaSource instanceof Node) {
        emitCommentTriviaAfterNode(triviaSource, options);
      } else if (!important && typeof value === 'string') {
        // Bare-string keyword value (`a: yes /* comment */`) carries no node
        // identity, so recover its authored end from the per-slot `value`
        // fieldSpan and emit any comment run keyed after it.
        emitCommentTriviaAfterOffset(options.trivia, this._valueFieldSpanEnd(), options);
      }
    }
  }

  /** End offset of the `value` field's per-slot span, or `undefined` when unset. */
  private _valueFieldSpanEnd(): number | undefined {
    const valueIdx = (this.constructor as unknown as { childKeys?: readonly string[] })
      .childKeys?.indexOf('value') ?? -1;
    return valueIdx >= 0 ? fieldSpanAt(this, valueIdx)?.end : undefined;
  }

  private renderSpaceValueSyntax(value: Node[], options: PrintOptions): void {
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer!;
    for (let index = 0; index < value.length; index++) {
      const item = value[index]!;
      w.queueSpacer(' ');
      item.writeSyntax(printOptions);
    }
  }

  private renderCommaValueSyntax(value: Node[], options: PrintOptions): void {
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer!;
    for (let index = 0; index < value.length; index++) {
      if (index !== 0) {
        w.add(',');
      }
      const item = value[index]!;
      w.queueSpacer(' ');
      item.writeSyntax(printOptions);
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.declTrimmedString(options);
  }

  private writeDirectSyntheticScalarSyntax(options: ReturnType<typeof getPrintOptions>): boolean {
    if (options.context !== undefined) {
      return false;
    }
    const nameText = maybeDirectSyntheticDeclarationLeafText(this.name);
    const valueText = maybeDirectSyntheticDeclarationLeafText(this.value);
    if (nameText === undefined || valueText === undefined || nameText.startsWith('--')) {
      return false;
    }
    // A bare-string value with a per-slot fieldSpan may carry an authored
    // trailing comment (`a: yes /* comment */`); that lives in the trivia map,
    // which this synthetic fast path does not consult — defer to the full path.
    if (options.trivia && typeof this.value === 'string' && this._valueFieldSpanEnd() !== undefined) {
      return false;
    }
    const importantText = this.important === undefined
      ? undefined
      : maybeDirectSyntheticDeclarationLeafText(this.important);
    if (this.important !== undefined && importantText === undefined) {
      return false;
    }
    const { assign = ':', normalizedFromAssign, setDefined } = this._options ?? {};
    const printedAssign = normalizedFromAssign ? AssignmentType.Default : assign;
    const effAssign = (setDefined && printedAssign === ':') ? ':=' : printedAssign;
    const w = options.writer!;
    w.add(nameText, this.name instanceof Node ? this.name : this);
    w.add(effAssign === ':' ? ': ' : ` ${effAssign} `);
    w.add(valueText, this.value instanceof Node ? this.value : this);
    if (importantText !== undefined) {
      w.add(` ${importantText}`, this.important instanceof Node ? this.important : this);
    }
    return true;
  }

  override writeSyntax(options: ReturnType<typeof getPrintOptions>): void {
    if (this.writeDirectSyntheticScalarSyntax(options)) {
      return;
    }
    this.writeDeclarationValueSyntax({
      name: this.name,
      value: this.value,
      important: this.important
    }, options);
  }

  private renderDeclarationPartsToBuffer(
    context: Context,
    buffer: RenderBuffer,
    valueParts: DeclarationValue,
    options?: PrintOptions,
    renderState?: Parameters<Declaration['writeDeclarationValueSyntax']>[2]
  ): string {
    const prepared = prepareRenderPrintState(context, {
      ...(options ?? {}),
      writer: new OutputWriter()
    });
    this.writeDeclarationValueSyntax(valueParts, prepared, renderState);
    return writeRenderText(buffer, prepared.writer.toString());
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (this.type !== 'Declaration') {
      const state = this.evalPreparedState(context);
      return isThenable(state)
        ? (state as Promise<DeclarationEvalState>).then(resolved => this.renderEvaluatedDeclaration(context, resolved, bufferOrOptions, options))
        : this.renderEvaluatedDeclaration(context, state as DeclarationEvalState, bufferOrOptions, options);
    }
    const state = this.evalRenderState(context);
    return isThenable(state)
      ? (state as Promise<DeclarationRenderState>).then(resolved => this.renderDeclarationRenderState(context, resolved, bufferOrOptions, options))
      : this.renderDeclarationRenderState(context, state as DeclarationRenderState, bufferOrOptions, options);
  }

  private renderEvaluatedDeclaration(
    context: Context,
    state: DeclarationEvalState,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string | MaybePromise<string> {
    const node = state.output;
    if (isNode(node, N.VarDeclaration)) {
      return isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions);
    }
    if (state.nil || !(node instanceof Declaration)) {
      return isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions);
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    if (buffer) {
      return state.value
        ? this.renderDeclarationPartsToBuffer(context, buffer, {
            name: state.name ?? node.name,
            value: state.value,
            important: state.important
          }, options)
        : node.renderDeclarationPartsToBuffer(context, buffer, {
            name: node.name,
            value: node.value,
            important: node.important
          }, options);
    }
    const printOptions = isRenderBuffer(bufferOrOptions) ? undefined : bufferOrOptions;
    const prepared = prepareRenderPrintState(context, printOptions);
    const out = state.value
      ? this.declValueTrimmedString({
          name: state.name ?? node.name,
          value: state.value,
          important: state.important
        }, prepared)
      : node.declTrimmedString(prepared);
    return out;
  }

  private renderDeclarationRenderState(
    context: Context,
    state: DeclarationRenderState,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    if (state.nil && state.output) {
      const output = state.output;
      return isRenderBuffer(bufferOrOptions)
        ? output.render(context, bufferOrOptions, options)
        : output.render(context, bufferOrOptions);
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const renderState = {
      mergeAdapter: state.mergeAdapter,
      customInterpolatedValue: state.customInterpolatedValue,
      importantText: state.importantText,
      normalizedFromAssign: state.normalizedFromAssign
    };
    if (buffer) {
      return this.renderDeclarationPartsToBuffer(context, buffer, {
        name: state.name,
        value: state.value,
        important: state.important
      }, options, renderState);
    }
    const printOptions = isRenderBuffer(bufferOrOptions) ? undefined : bufferOrOptions;
    const prepared = prepareRenderPrintState(context, printOptions);
    const out = this.declValueTrimmedString({
      name: state.name,
      value: state.value,
      important: state.important
    }, prepared, renderState);
    return out;
  }

  override resolve(context: Context): MaybePromise<Node> {
    const state = this.evalPreparedState(context);
    return isThenable(state)
      ? (state as Promise<DeclarationEvalState>).then(resolved => resolved.output)
      : (state as DeclarationEvalState).output;
  }

  private evalRenderState(context: Context): MaybePromise<DeclarationRenderState> {
    const state = this._prepareDeclarationRegistrationState(context, { ownParts: false });
    return isThenable(state)
      ? (state as Promise<DeclarationRegistrationState>).then(resolved => this.evalRegistrationRenderState(context, resolved))
      : this.evalRegistrationRenderState(context, state as DeclarationRegistrationState);
  }

  private evalRegistrationRenderState(
    context: Context,
    state: DeclarationRegistrationState
  ): MaybePromise<DeclarationRenderState> {
    if (this.hasFlag(F_STATIC) && !state.normalizedFromAssign && !context.hasImportantSource) {
      return {
        name: state.name,
        value: state.value,
        important: state.important,
        nil: false
      };
    }
    const evaluateRenderAssignment = (): MaybePromise<Node[]> => {
      const evaluated: Node[] = [];
      let chain: Promise<void> | undefined;
      const evaluateItem = (item: Node): MaybePromise<void> => {
        const out = item.eval(context);
        if (isThenable(out)) {
          return (out as Promise<Node>).then((node) => {
            if (!(node instanceof Nil)) {
              evaluated.push(node);
            }
          });
        }
        if (!(out instanceof Nil)) {
          evaluated.push(out as Node);
        }
      };
      for (const item of state.renderAssignment?.items ?? []) {
        if (chain) {
          chain = chain.then(() => evaluateItem(item));
          continue;
        }
        const out = evaluateItem(item);
        if (isThenable(out)) {
          chain = out as Promise<void>;
        }
      }
      return chain ? chain.then(() => evaluated) : evaluated;
    };
    const evaluate = (): MaybePromise<DeclarationRenderValue> => {
      if (
        !state.renderAssignment
        && !context.hasImportantSource
        && (
          typeof state.value === 'string'
          || Array.isArray(state.value)
        )
      ) {
        return state.value;
      }
      const stateNameText = nodeValueText(state.name);
      const isCustomProperty = stateNameText?.startsWith('--') === true;
      const previousInCustom = context.inCustom;
      if (isCustomProperty) {
        if (!valueShouldResolveCustomProperty(state.value)) {
          return state.value;
        }
        context.inCustom = true;
      }
      let maybeValue: MaybePromise<DeclarationRenderValue>;
      try {
        const customInterpolatedValue = isCustomProperty && !state.renderAssignment
          ? getSingleInterpolatedDeclarationValue(state.value)
          : undefined;
        maybeValue = customInterpolatedValue
          ? this.evalCustomInterpolatedRenderValue(context, customInterpolatedValue)
          : state.renderAssignment
            ? evaluateRenderAssignment()
            : state.value instanceof Node
              ? state.value.eval(context)
              : state.value;
      } finally {
        if (!isThenable(maybeValue!)) {
          context.inCustom = previousInCustom;
        }
      }
      if (isThenable(maybeValue)) {
        return (maybeValue as Promise<DeclarationRenderValue>).then(
          (value) => {
            context.inCustom = previousInCustom;
            return value;
          },
          (error) => {
            context.inCustom = previousInCustom;
            throw error;
          }
        );
      }
      return maybeValue;
    };
    const finish = (newValue: DeclarationRenderValue): DeclarationRenderState => {
      if (isCustomInterpolatedRenderValue(newValue)) {
        const { importantText } = finalizeContextualImportantState(context, state.important);
        return {
          name: state.name,
          value: state.value,
          customInterpolatedValue: newValue,
          important: state.important,
          importantText,
          normalizedFromAssign: state.normalizedFromAssign,
          nil: false
        };
      }
      if (state.renderAssignment && Array.isArray(newValue)) {
        const rawItems: (Node | string)[] = newValue;
        const nodeItems = rawItems.filter((item): item is Node => item instanceof Node);
        const value = nodeItems[0] ?? state.value;
        const isList = state.renderAssignment?.sep === ',';
        const { importantText } = finalizeContextualImportantState(context, state.important);
        return {
          name: state.name,
          value,
          mergeAdapter: {
            kind: isList ? 'list' : 'space',
            value: nodeItems
          },
          important: state.important,
          importantText,
          normalizedFromAssign: state.normalizedFromAssign,
          nil: false
        };
      }
      if (newValue instanceof Nil) {
        return {
          name: state.name,
          value: newValue,
          important: state.important,
          output: newValue,
          nil: true
        };
      }
      let value = newValue instanceof Node || typeof newValue === 'string' || Array.isArray(newValue)
        ? newValue
        : state.value;
      const normalized = value instanceof Node
        ? this.normalizeMergedLeadingPlaceholderForRender(state, value)
        : undefined;
      value = normalized instanceof Node ? normalized : normalized?.value ?? value;
      let important = state.important;
      const { importantText } = finalizeContextualImportantState(context, important);
      return {
        name: state.name,
        value,
        mergeAdapter: normalized instanceof Node ? undefined : normalized,
        important,
        importantText,
        normalizedFromAssign: state.normalizedFromAssign,
        nil: false
      };
    };
    const maybeValue = evaluate();
    return isThenable(maybeValue)
      ? maybeValue.then(finish)
      : finish(maybeValue);
  }

  private evalCustomInterpolatedRenderValue(
    context: Context,
    node: Interpolated
  ): MaybePromise<CustomInterpolatedRenderValue> {
    const replacements = [...node.replacements];
    let chain: Promise<void> | undefined;
    const evaluateReplacement = (replacement: Node, index: number): MaybePromise<void> => {
      const out = replacement.eval(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((evaluated) => {
          replacements[index] = evaluated;
        });
      }
      replacements[index] = out as Node;
    };
    for (let index = 0; index < replacements.length; index++) {
      const replacement = replacements[index]!;
      if (chain) {
        chain = chain.then(() => evaluateReplacement(replacement, index));
        continue;
      }
      const out = evaluateReplacement(replacement, index);
      if (isThenable(out)) {
        chain = out as Promise<void>;
      }
    }
    const finish = (): CustomInterpolatedRenderValue => ({
      source: node,
      replacements
    });
    return chain ? chain.then(finish) : finish();
  }

  private normalizeMergedLeadingPlaceholderForRender(
    state: DeclarationRegistrationState,
    value: Node
  ): DeclarationMergeAdapterResult {
    const normalizedAssign = state.normalizedFromAssign;
    const isListMergedAssign =
      normalizedAssign === AssignmentType.Add
      || normalizedAssign === AssignmentType.MergeList;
    const isSpaceMergedAssign = normalizedAssign === AssignmentType.MergeSequence;
    const isMergedContainer = (
      (isListMergedAssign && isNode(value, N.List))
      || (isSpaceMergedAssign && isNode(value, N.Sequence))
    );
    if (!isMergedContainer) {
      return undefined;
    }
    let emptyPlaceholder: Node | undefined;
    const collect = (child: Node): void => {
      if (
        (isListMergedAssign && isNode(child, N.List))
        || (isSpaceMergedAssign && isNode(child, N.Sequence))
      ) {
        const childItems = isNode(child, N.Sequence) ? child.value : child.value;
        for (const item of childItems) {
          collect(item);
        }
        return;
      }
      const isEmptyPlaceholder = isNode(child, N.Nil)
        || (isNode(child, N.Any) && child.value === '');
      if (isEmptyPlaceholder) {
        emptyPlaceholder ??= child;
      }
    };
    collect(value);
    const adapter = createDeclarationMergeAdapterState(value, isListMergedAssign ? 'list' : 'space');
    if (!adapter) {
      return emptyPlaceholder;
    }
    return adapter;
  }

  private evalPreparedState(context: Context): MaybePromise<DeclarationEvalState> {
    const valueState = this.evalPreparedValueState(context);
    const finish = (resolved: DeclarationValueState<this> | Nil): DeclarationEvalState => {
      const output = resolved instanceof Nil
        ? resolved
        : this.materializeValueState(resolved);
      const declOutput = output instanceof Declaration ? output : undefined;
      return {
        output,
        name: declOutput?.name,
        value: declOutput?.value,
        important: declOutput?.important,
        nil: output instanceof Nil
      };
    };
    return isThenable(valueState)
      ? (valueState as Promise<DeclarationValueState<this> | Nil>).then(finish)
      : finish(valueState as DeclarationValueState<this> | Nil);
  }

  private evalPreparedValueState(context: Context): MaybePromise<DeclarationValueState<this> | Nil> {
    const node = this.prepareRegistration(context);
    return isThenable(node)
      ? (node as Promise<this>).then(prepared => prepared.evalValueState(context))
      : (node as this).evalValueState(context);
  }

  override prepareRegistration(
    context: Context,
    options: DeclarationRegistrationOptions = {}
  ): MaybePromise<this> {
    const state = this._prepareDeclarationRegistrationState(context, options);
    return isThenable(state)
      ? (state as Promise<DeclarationRegistrationState>).then(resolved => this.materializeRegistrationState(resolved, options))
      : this.materializeRegistrationState(state as DeclarationRegistrationState, options);
  }

  private createRegistrationState(
    options: DeclarationRegistrationOptions = {}
  ): DeclarationRegistrationState {
    if (options.reuseCanonical === true) {
      return {
        name: this.name,
        value: this.value,
        important: this.important
      };
    }
    return {
      name: this.copyNameForDerived(this.name),
      value: isDeferredDeclarationValue(this.value)
        ? this.value
        : this.copyValueForDerived(this.value),
      important: this.copyImportantForDerived(this.important)
    };
  }

  private createRenderRegistrationState(): DeclarationRegistrationState {
    return {
      name: this.name,
      value: this.value,
      important: this.important,
      renderOnly: true
    };
  }

  private _prepareDeclarationRegistrationState(
    context: Context,
    options: { ownParts?: boolean; reuseCanonical?: boolean } = {}
  ): MaybePromise<DeclarationRegistrationState> {
    const state = options.ownParts === false
      ? this.createRenderRegistrationState()
      : this.createRegistrationState(options);
    const preparedName = this._prepareDeclarationNameIdentity(state, context);
    if (isThenable(preparedName)) {
      return preparedName.then(key => this._finishDeclarationRegistrationPrep(state, key));
    }
    return this._finishDeclarationRegistrationPrep(state, preparedName);
  }

  private _prepareDeclarationNameIdentity(
    state: DeclarationRegistrationState,
    context: Context
  ): MaybePromise<string> {
    const { name } = state;
    if (name instanceof Interpolated) {
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return maybeKey.then((key) => {
          if (!(key instanceof Any)) {
            throw new TypeError('Expected evaluated declaration name');
          }
          const resolved = String(key.valueOf());
          state.name = resolved;
          return resolved;
        });
      }
      if (!(maybeKey instanceof Any)) {
        throw new TypeError('Expected evaluated declaration name');
      }
      const resolved = String(maybeKey.valueOf());
      state.name = resolved;
      return resolved;
    }
    if (typeof name === 'string') {
      return name;
    }
    throw new TypeError('Declaration name must be a string or Interpolated');
  }

  private _finishDeclarationRegistrationPrep(
    state: DeclarationRegistrationState,
    name: string
  ): DeclarationRegistrationState {
    // Value is consumed as delivered by the parser (Node | string | array); no
    // lazy string->node materialization. Only assignment composition (below)
    // coerces to a Node where structurally required.
    this._normalizeAssignmentValue(state, name);
    return state;
  }

  private _normalizeAssignmentValue(state: DeclarationRegistrationState, key: string): void {
    let { value } = state;
    const setValue = (newValue: Node) => {
      state.value = newValue;
      value = newValue;
    };
    /** Normalize assignment types */
    let assign = this.options?.assign;
    const rawAssign = assign as string | undefined;
    if (rawAssign === '+,:') {
      assign = AssignmentType.MergeList;
    } else if (rawAssign === '+_:') {
      assign = AssignmentType.MergeSequence;
    }
    if (!assign && this.options?.normalizedFromAssign) {
      state.normalizedFromAssign = this.options.normalizedFromAssign;
      return;
    }
    if (assign) {
      const normalizedAssign = assign;
      const referenceKey = state.renderOnly ? this.copyNameForDerived(key) : key;
      const inputValue = state.renderOnly
        ? this.ownRenderAssignmentInput(this.toAssignmentInputNode(value))
        : this.toAssignmentInputNode(value);
      /** Reference type */
      let type: 'declaration' | 'variable' =
        this.type === 'VarDeclaration' ? 'variable' : 'declaration';
      let outputNode: Declaration | undefined;
      state.bindOutput = (node: Declaration) => {
        outputNode = node;
      };
      switch (assign) {
        case AssignmentType.MergeList:
        case AssignmentType.MergeSequence: {
          const excludedDeclarations: Declaration[] = [this];
          const ref = new Reference({ key: referenceKey }, {
            type,
            fallbackValue: new Nil(),
            excludedDeclarations,
            filter: (n) => {
              const source = n.sourceNode ?? n;
              return n !== outputNode
                && n !== this
                && source !== (outputNode?.sourceNode ?? outputNode)
                && source !== (this.sourceNode ?? this)
                && !sameConcreteLocation(sourceSpanOf(n), outputNode?.location)
                && !sameConcreteLocation(sourceSpanOf(n), sourceSpanOf(this));
            },
            requiredDeclarationAssignments: [
              AssignmentType.MergeList,
              AssignmentType.MergeSequence,
              '+,:',
              '+_:'
            ]
          }, undefined, this.sourceRoot?._treeContext);
          // Positional bound for the prior-value lookup: eval-time nodes don't
          // parent (invariant 7), so carry the referring decl's index directly.
          ref.index = this.index;
          state.bindOutput = (node: Declaration) => {
            outputNode = node;
            excludedDeclarations[1] = node;
          };
          /**
           * @note - It's up to Sequence and List to handle
           *         the merging of the values, if Nil()
           *         or a nested list.
           */
          const isMergeListAssign = assign === AssignmentType.MergeList;
          if (state.renderOnly) {
            state.renderAssignment = {
              items: [ref, inputValue],
              sep: isMergeListAssign ? ',' : ' '
            };
            state.normalizedFromAssign = normalizedAssign;
          } else {
            value = isMergeListAssign
              ? new List([ref, inputValue])
              : spaced([ref, inputValue]);
            setValue(value);
          }
          break;
        }
        case AssignmentType.Add: {
          if (this.type === 'Declaration') {
            // Less property `+:` appends comma-separated items.
            // Use list composition (not generic `Operation +`) so scalar previous values
            // remain distinct list members rather than string-concatenating.
            const excludedDeclarations: Declaration[] = [this];
            const ref = new Reference({ key: referenceKey }, {
              type,
              fallbackValue: new Nil(),
              excludedDeclarations,
              // Prevent self-referential reads while normalizing copied/prepared nodes.
              filter: (n) => {
                const source = n.sourceNode ?? n;
                return n !== outputNode
                  && n !== this
                  && source !== (outputNode?.sourceNode ?? outputNode)
                  && source !== (this.sourceNode ?? this)
                  && !sameConcreteLocation(sourceSpanOf(n), outputNode?.location)
                  && !sameConcreteLocation(sourceSpanOf(n), sourceSpanOf(this));
              }
            }, undefined, this.sourceRoot?._treeContext);
            // The merge ref reads the PRIOR value of this property. Its lookup
            // start comes from `getLookupStartIndex(ref)`, which walks the parent
            // chain — but eval-time nodes don't parent (invariant 7), so carry the
            // referring declaration's source index directly for the positional bound.
            ref.index = this.index;
            state.bindOutput = (node: Declaration) => {
              outputNode = node;
              excludedDeclarations[1] = node;
            };
            if (state.renderOnly) {
              state.renderAssignment = {
                items: [ref, inputValue],
                sep: ','
              };
              state.normalizedFromAssign = normalizedAssign;
            } else {
              setValue(new List([ref, inputValue]));
            }
          } else {
            setValue(
              new Operation([
                new Reference({ key: referenceKey }, { type }, undefined, this.sourceRoot?._treeContext),
                '+',
                inputValue
              ])
            );
          }
          break;
        }
        case AssignmentType.CondAssign: {
          setValue(
            new Reference({ key: referenceKey }, {
              type,
              fallbackValue: inputValue
            }, undefined, this.sourceRoot?._treeContext)
          );
          break;
        }
      }
      state.normalizedFromAssign = normalizedAssign;
    }
  }

  private materializeRegistrationState(
    state: DeclarationRegistrationState,
    options: DeclarationRegistrationOptions = {}
  ): this {
    const changed = (
      state.name !== this.name
      || state.value !== this.value
      || state.important !== this.important
      || state.normalizedFromAssign !== undefined
      || state.bindOutput !== undefined
    );
    if (options.reuseCanonical === true && !changed) {
      this.registrationPrepared = true;
      return this;
    }
    if (
      state.normalizedFromAssign === undefined
      && state.bindOutput === undefined
      && state.name === this.name
      && state.important === this.important
      && isDeferredDeclarationValue(this.value)
      && state.value instanceof Node
    ) {
      this.adopt(state.value);
      this.value = state.value;
      this.registrationPrepared = true;
      return this;
    }
    const node = this.withParts({
      name: state.name === this.name ? this.copyNameForDerived(state.name) : state.name,
      value: state.value === this.value ? this.copyValueForDerived(state.value) : state.value,
      important: state.important === this.important
        ? this.copyImportantForDerived(state.important)
        : state.important
    });
    if (state.normalizedFromAssign) {
      node.options.normalizedFromAssign = state.normalizedFromAssign;
    }
    state.bindOutput?.(node);
    node.registrationPrepared = true;
    return node;
  }

  private evalValueState(context: Context): MaybePromise<DeclarationValueState<this> | Nil> {
    if (this.hasFlag(F_STATIC)) {
      return {
        source: this,
        value: this.value,
        important: this.important,
        changed: false
      };
    }
    {
      let node = this;
      const nodeValue = node.value;
      const state: DeclarationValueState<this> = {
        source: node,
        value: nodeValue,
        important: node.important,
        changed: false
      };
      const setVal = (newValue: DeclarationValue['value']) => {
        if (state.value !== newValue) {
          state.value = newValue;
          state.changed = true;
        }
      };
      const setImportant = (important: DeclarationValue['important']) => {
        if (state.important !== important) {
          state.important = important;
          state.changed = true;
        }
      };
      const normalizeMergedLeadingPlaceholder = () => {
        const normalizedAssign = node.options.normalizedFromAssign;
        const isListMergedAssign =
            normalizedAssign === AssignmentType.Add
            || normalizedAssign === AssignmentType.MergeList;
        if (!isListMergedAssign || !isNode(state.value, N.List)) {
          return;
        }
        const mergedItems = collectDeclarationMergeAdapterItems(state.value, { includeSequences: false });
        if (mergedItems.length === 0) {
          setVal(new Nil());
          return;
        }
        if (mergedItems.length === 1) {
          const item = mergedItems[0]!;
          setVal(this.ownMergedAssignmentOutputItem(item));
          return;
        }
        const outputItems = new Array<Node>(mergedItems.length);
        for (let i = 0; i < mergedItems.length; i++) {
          outputItems[i] = this.ownMergedAssignmentOutputItem(mergedItems[i]!);
        }
        // Eval-time derived container: SHARE the items (no reparent), but crawl
        // them to bubble child flags (F_STATIC/F_NON_STATIC/…) so the merged value
        // is classified correctly — a raw `new List` derives none on its own.
        const merged = new List(outputItems);
        for (let i = 0; i < outputItems.length; i++) {
          merged.propagateFlagsFrom(outputItems[i]!);
        }
        setVal(merged);
      };
        /** Registration prep already stabilized the name; eval handles the value. */
      if (node.type === 'VarDeclaration') {
        return state;
      }
      const { name, value: value } = node;
      if (Array.isArray(value)) {
        // A flat value array mixes verbatim string fragments (kept as-is) with
        // typed value nodes that must be evaluated so e.g. a fallback function
        // Call prints its CSS form rather than its `$name?(...)` source sigil.
        const finalize = (evaluated: Array<Node | string>, changed: boolean) => {
          if (changed) {
            setVal(evaluated);
          }
          const importantState = finalizeContextualImportantPublicState(context, state.important);
          if (importantState.important && importantState.important !== state.important) {
            setImportant(importantState.important);
          }
          return state;
        };
        const out: Array<Node | string> = new Array(value.length);
        let changed = false;
        for (let i = 0; i < value.length; i++) {
          const item = value[i]!;
          if (typeof item === 'string') {
            out[i] = item;
            continue;
          }
          const evald = item.eval(context);
          if (isThenable(evald)) {
            return (async () => {
              let resolved = await evald;
              if (!(resolved instanceof Node)) {
                resolved = item;
              } else if (resolved !== item) {
                resolved.inherit(item);
                changed = true;
              }
              out[i] = resolved;
              for (let j = i + 1; j < value.length; j++) {
                const next = value[j]!;
                if (typeof next === 'string') {
                  out[j] = next;
                  continue;
                }
                let nextEvald = await next.eval(context);
                if (!(nextEvald instanceof Node)) {
                  nextEvald = next;
                } else if (nextEvald !== next) {
                  nextEvald.inherit(next);
                  changed = true;
                }
                out[j] = nextEvald;
              }
              return finalize(out, changed);
            })();
          }
          if (!(evald instanceof Node)) {
            out[i] = item;
            continue;
          }
          if (evald !== item) {
            evald.inherit(item);
            changed = true;
          }
          out[i] = evald;
        }
        return finalize(out, changed);
      }
      if (value instanceof Node) {
        const isCustomProperty = declarationNameKey(name).startsWith('--');
        if (isCustomProperty) {
          if (!shouldResolveCustomPropertyValue(value)) {
            return state;
          }
          context.inCustom = true;
        }
        const maybeNewValue = value.eval(context);
        if (isThenable(maybeNewValue)) {
          return maybeNewValue.then((newValue: Node | Nil) => {
            context.inCustom = false;
            if (newValue instanceof Nil) {
              return newValue.inherit(node);
            }
            if (isCustomProperty) {
              newValue = inheritCustomInterpolatedValuePlacement(value, newValue);
            }
            setVal(newValue);
            normalizeMergedLeadingPlaceholder();
            const importantState = finalizeContextualImportantPublicState(context, state.important);
            if (importantState.important && importantState.important !== state.important) {
              setImportant(importantState.important);
            }
            return state;
          });
        }
        context.inCustom = false;
        if (maybeNewValue instanceof Nil) {
          return maybeNewValue.inherit(node);
        }
        if (!(maybeNewValue instanceof Node)) {
          return state;
        }
        setVal(isCustomProperty ? inheritCustomInterpolatedValuePlacement(value, maybeNewValue) : maybeNewValue);
        normalizeMergedLeadingPlaceholder();
        const importantState = finalizeContextualImportantPublicState(context, state.important);
        if (importantState.important && importantState.important !== state.important) {
          setImportant(importantState.important);
        }
      }
      return state;
    }
  }

  private materializeValueState(state: DeclarationValueState<this>): this {
    const node = state.source;
    if (!state.changed) {
      return node;
    }
    const output = node.withParts({
      name: this.copyNameForDerived(node.name),
      value: state.value === node.value
        ? this.copyValueForDerived(state.value)
        : state.value,
      important: state.important === node.important
        ? this.copyImportantForDerived(state.important)
        : state.important
    });
    output.registrationPrepared = node.registrationPrepared;
    return output;
  }

  override evalNode(context: Context): MaybePromise<this | Nil> {
    const state = this.evalValueState(context);
    return isThenable(state)
      ? (state as Promise<DeclarationValueState<this> | Nil>).then(resolved => resolved instanceof Nil ? resolved : this.materializeValueState(resolved))
      : state instanceof Nil ? state : this.materializeValueState(state as DeclarationValueState<this>);
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.name.toCSS(context, out)
  //   out.add(': ')
  //   context.cast(this.value).toCSS(context, out)
  //   if (this.important) {
  //     out.add(' ')
  //     this.important.toCSS(context, out)
  //   }
  //   out.add(';')
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = sourceSpanOf(this)
  //   out.add('$J.decl({\n', loc)
  //   context.indent++
  //   out.add(`  name: `)
  //   this.name.toModule(context, out)
  //   out.add(`,\n  value: `)
  //   this.value.toModule(context, out)
  //   if (this.important) {
  //     out.add(`,\n  important: `)
  //     this.important.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n})`)
  // }
}

export type DeclarationParams = ConstructorParameters<typeof Declaration>;

defineType<DeclarationValue>(Declaration, 'Declaration', 'decl');

export const decl = (
  value: DeclarationValue,
  options?: DeclarationOptions,
  location?: LocationInfo
) => new Declaration(value, options, location).parentChildren();
