import {
  Node,
  F_STATIC,
  defineType,
  type LocationInfo
} from './node.js';
import { isNode } from './util/is-node.js';
import { Nil } from './nil.js';
import type { Context } from '../context.js';
import { Interpolated } from './interpolated.js';
import { Any, any, type AnyRole } from './any.js';
import { Reference } from './reference.js';
import { List } from './list.js';
import { Sequence, spaced } from './sequence.js';
import { Operation } from './operation.js';
import { N } from './node-type.js';
import type { Call } from './call.js';
import {
  OutputWriter,
  type PrintOptions,
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
import { consumeTrivia, emitCommentTriviaAfterNode, emitTriviaTokens } from './util/trivia.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function getWriterTextSincePosition(writer: OutputWriter, position: number): string {
  const chunks = Reflect.get(writer as object, 'chunks');
  if (!Array.isArray(chunks) || position >= chunks.length) {
    return '';
  }
  let out = '';
  for (let i = position; i < chunks.length; i++) {
    out += chunks[i] ?? '';
  }
  return out;
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
/** Should be Any<'property'> | Interpolated<'property'> */
type NameValue<T extends AnyRole = 'property'> = Any<T> | Interpolated<T>;
type DeclarationValueSegment = Node | string;

export type DeclarationValue<T extends AnyRole = 'property'> = {
  name: NameValue<T> | string;
  value: Node | string | DeclarationValueSegment[];
  /** The actual string representation of important, if it exists */
  important?: Any<'flag'> | string | boolean;
};

type DeclarationEvalState = {
  output: Node;
  name?: DeclarationValue['name'];
  value?: Node;
  important?: Any<'flag'>;
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
  important?: Any<'flag'>;
  importantText?: string;
  normalizedFromAssign?: AssignmentType;
  output?: Node;
  nil: boolean;
};

function sameConcreteLocation(left: readonly unknown[], right: readonly unknown[] | undefined): boolean {
  if (!right || left.length === 0 || left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

export function finalizeContextualImportantState(
  context: Context,
  important: Any<'flag'> | undefined
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
  important: Any<'flag'> | undefined
): { important?: Any<'flag'>; importantText?: string } {
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
  value: Node;
  important?: Any<'flag'>;
  changed: boolean;
};

type DeclarationRegistrationState = {
  name: DeclarationValue['name'];
  value: DeclarationValue['value'];
  important?: Any<'flag'>;
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
  emitTriviaTokens(consumeTrivia(trivia, source.location[0], 'before', options), options);
};

const inheritCustomInterpolatedValuePlacement = (sourceValue: Node, evaluatedValue: Node): Node => {
  const source = getSingleInterpolatedCustomValue(sourceValue);
  return source ? evaluatedValue.inherit(source) : evaluatedValue;
};

const emitLeadingTriviaForCustomValue = (
  value: Node,
  options: ReturnType<typeof getPrintOptions>
): void => {
  const trivia = options.trivia ?? value.sourceRoot?._treeContext?.opts?.trivia;
  if (!trivia || trivia === true) {
    return;
  }
  emitTriviaTokens(consumeTrivia(trivia, value.location[0], 'before', options), options);
};

const shouldResolveCustomPropertyValue = (node: Node): boolean => {
  if (isNode(node, N.Reference)) {
    return node.options?.type !== 'function';
  }
  if (node.type === 'Interpolated') {
    return true;
  }
  return valueShouldResolveCustomProperty(node.value);
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
  if (node.location.length !== 0 || !node.hasFlag(F_STATIC)) {
    return false;
  }
  const children = isNode(node, N.Sequence) ? node.value : node.value;
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
  const writer = new OutputWriter();
  node.writeSyntax({
    ...printOptions,
    writer
  });
  return writer.toString();
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
  if (
    node.type !== 'Any'
    && node.type !== 'Anonymous'
    && node.type !== 'Keyword'
  ) {
    return undefined;
  }
  if (node._location !== undefined) {
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
  const printableKey = name.value.rawKey ?? name.key;
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

  declare override value: DeclarationValue['value'];
  name: DeclarationValue['name'];
  important: DeclarationValue['important'];

  override allowRuleRoot = true;

  constructor(
    value: DeclarationValue,
    options?: Opts,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super();
    this._location = location;
    this._options = options;
    this.name = this._processNodes(value.name);
    this.value = this._processNodes(value.value);
    this.important = this._processNodes(value.important);
    this._treeContext = treeContext;
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

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    cloneFn ??= n => n.clone(deep);
    const clonePart = <T extends Node | string | undefined>(part: T): T => (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- cloneFn preserves the concrete node field type supplied by this declaration part.
      deep && part instanceof Node ? cloneFn(part) as T : part
    );
    return this.withParts({
      name: clonePart(this.name),
      value: clonePart(this.value),
      important: clonePart(this.important)
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
    if (!(copy instanceof Any) && !(copy instanceof Interpolated)) {
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

  private materializeValueForSemantics(value: DeclarationValue['value']): Node {
    if (value instanceof Node) {
      return value;
    }
    if (typeof value === 'string') {
      return any(value);
    }
    if (value.length === 1) {
      const only = value[0]!;
      return typeof only === 'string' ? any(only) : only;
    }
    const nodes = new Array<Node>(value.length);
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      nodes[i] = typeof item === 'string' ? any(item) : item;
    }
    return spaced(nodes);
  }

  private ownRenderAssignmentInput(node: Node): Node {
    return node.canReuseAsLeaf() || canReuseSourceFreeAssignmentInput(node)
      ? node.reuseAsLeaf()
      : this.copyValueForDerived(node);
  }

  private ownMergedAssignmentOutputItem(node: Node): Node {
    return node.canReuseAsLeaf() ? node.reuseAsLeaf() : this.copyValueForDerived(node);
  }

  private copyImportantForDerived(node: DeclarationValue['important']): DeclarationValue['important'] {
    if (!node) {
      return undefined;
    }
    if (typeof node === 'string') {
      return node;
    }
    if (node.canReuseAsLeaf() || node instanceof Any) {
      return node.reuseAsLeaf();
    }
    const copy = node.cloneForPlacement();
    if (!(copy instanceof Any)) {
      throw new TypeError('Copied important flag must remain an Any node');
    }
    copy.frozen = true;
    return copy;
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
      this._location?.length ? this._location : undefined,
      this._treeContext
    );
    return this.applyDerivedMetadata(node);
  }

  private derive(): this {
    return this.withParts({
      name: this.copyNameForDerived(this.name),
      value: this.copyValueForDerived(this.value),
      important: this.copyImportantForDerived(this.important)
    });
  }

  deriveWithOptions(options: Opts & DeclarationOptions): this {
    const node = this.derive();
    node.options = options;
    return node;
  }

  deriveWithParts(parts: Partial<DeclarationValue>): this {
    const node = this.withParts({
      name: parts.name === undefined
        ? this.copyNameForDerived(this.name)
        : parts.name,
      value: parts.value === undefined
        ? this.copyValueForDerived(this.value)
        : parts.value,
      important: parts.important === undefined
        ? this.copyImportantForDerived(this.important)
        : parts.important
    });
    node.registrationPrepared = this.registrationPrepared;
    return node;
  }

  private formatNonCustomValue(valOut: string, _options: PrintOptions) {
    const trimmedEnd = valOut.replace(/\s+$/g, '');
    if (!trimmedEnd.includes('\n')) {
      return ` ${trimmedEnd.replace(/^[ \t]+/g, '')}`;
    }

    // Authored multiline declaration values keep their line breaks. We normalize
    // only the minimum continuation indent rather than emulating historical
    // Less fixture cases that collapsed some unindented continuations.
    const continuationIndent = '  ';
    const lines = trimmedEnd.split('\n');
    let out = '';
    const [firstLine = '', ...restLines] = lines;
    const firstContent = firstLine.replace(/^[ \t]+/g, '').trimEnd();

    if (firstContent) {
      out = ` ${firstContent}`;
    }

    for (const line of restLines) {
      if (!line.trim()) {
        out += '\n';
        continue;
      }

      const lineIndent = line.match(/^[ \t]*/)?.[0].length ?? 0;
      const content = line.replace(/^[ \t]+/g, '').trimEnd();
      const isClosingLine = /^[}\])]([,;])?$/.test(content);
      const normalizedIndent = ' '.repeat(
        isClosingLine ? lineIndent : Math.max(continuationIndent.length, lineIndent)
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
    options?: PrintOptions,
    renderState?: {
      customInterpolatedValue?: DeclarationRenderState['customInterpolatedValue'];
      mergeAdapter?: DeclarationMergeAdapterState;
      importantText?: string;
      normalizedFromAssign?: AssignmentType;
    }
  ) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const position = w.position();
    this.writeDeclarationValueSyntax(valueParts, options, renderState);
    return getWriterTextSincePosition(w, position);
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
      for (let i = 0; i < value.length; i++) {
        const item = value[i]!;
        if (typeof item === 'string') {
          w.add(item, this);
        } else {
          item.writeSyntax(options);
        }
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
    }
    w.add(a);
    // Custom properties must preserve value text exactly as provided.
    const isCustomProperty = nameText?.startsWith('--') === true;
    if (isCustomProperty) {
      const saved = savePrintState(options, ['inCustom']);
      options.inCustom = true;
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
          emitLeadingTriviaForCustomValue(value, options);
        }
        this.writeDeclarationFieldValueSyntax(value, options);
      } else if (fallbackOut !== undefined) {
        const leading = customValueText === undefined ? '' : leadingHorizontalWhitespace(customValueText);
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
          emitLeadingTriviaForCustomValue(value, options);
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
        this.writeDeclarationFieldValueSyntax(value, options);
        w.replaceSince(valueMark, valOut => this.formatNonCustomValue(valOut, options), value);
      }
      if (!(value instanceof Node) || !isNode(value, N.Collection)) {
        if (important || importantText) {
          w.add(' ');
          if (important) {
            if (important === true) {
              w.add('!important', this);
            } else if (typeof important === 'string') {
              w.add(important, this);
            } else if (important === false) {
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
    }
    if (this.valueRequiresSemi(value)) {
      const triviaSource = important ?? value;
      if (triviaSource instanceof Node) {
        emitCommentTriviaAfterNode(triviaSource, options);
      }
    }
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
        ? Node.prototype.render.call(node, context, bufferOrOptions, options)
        : Node.prototype.render.call(node, context, bufferOrOptions);
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
            name: state.name ?? state.output.name,
            value: state.value,
            important: state.important
          }, options)
        : state.output.renderDeclarationPartsToBuffer(context, buffer, {
            name: state.output.name,
            value: state.output.value,
            important: state.output.important
          }, options);
    }
    const prepared = prepareRenderPrintState(context, bufferOrOptions);
    const out = state.value
      ? this.declValueTrimmedString({
          name: state.name ?? state.output.name,
          value: state.value,
          important: state.important
        }, prepared)
      : state.output.declTrimmedString(prepared);
    return out;
  }

  private renderDeclarationRenderState(
    context: Context,
    state: DeclarationRenderState,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    if (state.nil) {
      const output = state.output ?? state.value;
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
    const prepared = prepareRenderPrintState(context, bufferOrOptions);
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
      for (const item of state.renderAssignment?.value ?? []) {
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
        if (!shouldResolveCustomPropertyValue(state.value)) {
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
            : this.materializeValueForSemantics(state.value).eval(context);
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
        const value = newValue[0] ?? state.value;
        const isList = state.renderAssignment?.sep === ',';
        const { importantText } = finalizeContextualImportantState(context, state.important);
        return {
          name: state.name,
          value,
          mergeAdapter: {
            kind: isList ? 'list' : 'space',
            value: newValue
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
  ): MaybePromise<DeclarationRenderState['customInterpolatedValue']> {
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
    const finish = (): DeclarationRenderState['customInterpolatedValue'] => ({
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
      return {
        output,
        name: output instanceof Declaration ? output.name : undefined,
        value: output instanceof Declaration ? output.value : undefined,
        important: output instanceof Declaration ? output.important : undefined,
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
  ): MaybePromise<Any<'property'>> {
    const { name } = state;
    if (name instanceof Interpolated) {
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return maybeKey.then((key) => {
          state.name = key;
          return key;
        });
      }
      state.name = maybeKey;
      return maybeKey;
    }
    return name;
  }

  private _finishDeclarationRegistrationPrep(
    state: DeclarationRegistrationState,
    name: Any<'property'>
  ): DeclarationRegistrationState {
    if (!state.renderOnly) {
      state.value = this.materializeValueForSemantics(state.value);
    }
    this._normalizeAssignmentValue(state, name);
    return state;
  }

  private _normalizeAssignmentValue(state: DeclarationRegistrationState, key: Any<'property'>): void {
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
        ? this.ownRenderAssignmentInput(this.materializeValueForSemantics(value))
        : value;
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
                && !sameConcreteLocation(n.location, outputNode?.location)
                && !sameConcreteLocation(n.location, this.location);
            },
            requiredDeclarationAssignments: [
              AssignmentType.MergeList,
              AssignmentType.MergeSequence,
              '+,:',
              '+_:'
            ]
          }, undefined, this.sourceRoot?._treeContext);
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
                  && !sameConcreteLocation(n.location, outputNode?.location)
                  && !sameConcreteLocation(n.location, this.location);
              }
            }, undefined, this.sourceRoot?._treeContext);
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
    if (typeof this.value === 'string' || Array.isArray(this.value)) {
      throw new TypeError('String-backed declaration values must be hydrated before evaluation');
    }
    if (this.hasFlag(F_STATIC)) {
      this.evaluated = true;
      return {
        source: this,
        value: this.value,
        important: this.important,
        changed: false
      };
    }
    {
      let node = this;
      const state: DeclarationValueState = {
        source: node,
        value: node.value,
        important: node.important,
        changed: false
      };
      const setVal = (newValue: Node) => {
        if (state.value !== newValue) {
          state.value = newValue;
          state.changed = true;
        }
      };
      const setImportant = (important: Any<'flag'>) => {
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
        setVal(new List(outputItems));
      };
        /** Registration prep already stabilized the name; eval handles the value. */
      if (node.type === 'VarDeclaration') {
        return state;
      }
      const { name, value: value } = node;
      if (value instanceof Node) {
        const isCustomProperty = name.valueOf().startsWith('--');
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
          return node;
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
  //   const loc = this.location
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
) => new Declaration(value, options, location);
