import { type Context } from '../context.js';
import { defineType, F_MAY_ASYNC, F_STATIC, Node, type NodeLocation } from './node.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { compareNodeArray } from './util/compare.js';
import { type Operator } from './util/calculate.js';
import {
  consumeTrivia,
  emitCommentTriviaBetweenNodes,
  emitTriviaTokens,
  triviaLeadingWhitespace
} from './util/trivia.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { evaluateNodeArrayMaybe, evaluateNodeArraySync } from './util/evaluate-node-array.js';

function emitListItem<T extends Node>(
  item: T,
  options: ReturnType<typeof getPrintOptions>,
  suppressPre = false
): void {
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = suppressPre ? 'both' : 'post';
  try {
    item.toString(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

function emitListItemSyntax<T extends Node>(
  item: T,
  options: FinalPrintOptions,
  suppressPre = false
): void {
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = suppressPre ? 'both' : 'post';
  try {
    item.writeSyntax(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

function emitRenderedListItem<T extends Node>(
  item: T,
  context: Context,
  options: ReturnType<typeof getPrintOptions>,
  suppressPre = false
): void {
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = suppressPre ? 'both' : 'post';
  try {
    item.render(context, options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

function emitRenderedListItemMaybe<T extends Node>(
  item: T,
  context: Context,
  options: ReturnType<typeof getPrintOptions>,
  suppressPre = false
): MaybePromise<void> {
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = suppressPre ? 'both' : 'post';
  const renderNode = (node: Node): MaybePromise<void> => {
    const rendered = node.render(context, options);
    if (isThenable(rendered)) {
      return rendered.then(() => undefined);
    }
  };
  let rendered: MaybePromise<void>;
  try {
    if (item.hasFlag(F_MAY_ASYNC)) {
      const resolved = item.resolve(context);
      rendered = isThenable(resolved)
        ? resolved.then(renderNode)
        : renderNode(resolved);
    } else {
      rendered = renderNode(item);
    }
  } catch (error: unknown) {
    options.suppressBoundaryTrivia = saved;
    throw error;
  }
  if (isThenable(rendered)) {
    return (rendered as Promise<void>).then(
      () => {
        options.suppressBoundaryTrivia = saved;
      },
      (error: unknown) => {
        options.suppressBoundaryTrivia = saved;
        throw error;
      }
    );
  }
  options.suppressBoundaryTrivia = saved;
}

export function renderListValueSyntax<T extends Node>(
  value: T[],
  options: PrintOptions,
  sep: ListOptions['sep'] = ','
): string {
  const printOptions = getPrintOptions(options);
  const w = printOptions.writer;
  let length = value.length;
  const mark = w.mark();
  if (value.length === 0) {
    return '';
  }
  let item = value[0]!;
  emitListItem(item, printOptions);
  for (let i = 1; i < length; i++) {
    const prev = item;
    item = value[i]!;
    emitCommentTriviaBetweenNodes(prev, item, printOptions);
    const leadingTrivia = printOptions.trivia
      ? consumeTrivia(printOptions.trivia, item.location[0], 'before', printOptions)
      : undefined;
    const preserveLeadingWhitespace = /[\r\n]/.test(triviaLeadingWhitespace(leadingTrivia));
    if (sep === '/') {
      w.add(preserveLeadingWhitespace ? ' /' : ' / ');
    } else {
      w.add(preserveLeadingWhitespace ? sep : `${sep} `);
    }
    if (leadingTrivia) {
      emitTriviaTokens(
        leadingTrivia,
        printOptions,
        { skipLeadingWhitespace: !preserveLeadingWhitespace }
      );
    }
    emitListItem(item, printOptions, true);
  }
  return w.getSince(mark);
}

function emitListSeparator(
  prev: Node,
  item: Node,
  options: ReturnType<typeof getPrintOptions>,
  sep: ListOptions['sep']
): void {
  emitCommentTriviaBetweenNodes(prev, item, options);
  const leadingTrivia = options.trivia
    ? consumeTrivia(options.trivia, item.location[0], 'before', options)
    : undefined;
  const preserveLeadingWhitespace = /[\r\n]/.test(triviaLeadingWhitespace(leadingTrivia));
  if (sep === '/') {
    options.writer.add(preserveLeadingWhitespace ? ' /' : ' / ');
  } else {
    const sepStr = sep ?? ',';
    options.writer.add(preserveLeadingWhitespace ? sepStr : `${sepStr} `);
  }
  if (leadingTrivia) {
    emitTriviaTokens(
      leadingTrivia,
      options,
      { skipLeadingWhitespace: !preserveLeadingWhitespace }
    );
  }
}

function renderListValueDirect<T extends Node>(
  context: Context,
  value: T[],
  options: PrintOptions,
  sep: ListOptions['sep'] = ','
): string {
  const printOptions = getPrintOptions(options);
  const w = printOptions.writer;
  const mark = w.mark();
  if (value.length === 0) {
    return '';
  }
  let item = value[0]!;
  emitRenderedListItem(item, context, printOptions);
  for (let i = 1; i < value.length; i++) {
    const prev = item;
    item = value[i]!;
    emitListSeparator(prev, item, printOptions, sep);
    emitRenderedListItem(item, context, printOptions, true);
  }
  return w.getSince(mark);
}

function renderListValueDirectMaybe<T extends Node>(
  context: Context,
  value: T[],
  options: PrintOptions,
  sep: ListOptions['sep'] = ','
): MaybePromise<string> {
  const printOptions = getPrintOptions(options);
  const w = printOptions.writer;
  const mark = w.mark();
  if (value.length === 0) {
    return '';
  }

  const renderRest = async (start: number, previous: T): Promise<string> => {
    let item = previous;
    for (let i = start; i < value.length; i++) {
      const prev = item;
      item = value[i]!;
      emitListSeparator(prev, item, printOptions, sep);
      await emitRenderedListItemMaybe(item, context, printOptions, true);
    }
    return w.getSince(mark);
  };

  let item = value[0]!;
  const first = emitRenderedListItemMaybe(item, context, printOptions);
  if (isThenable(first)) {
    return (first as Promise<void>).then(() => renderRest(1, item));
  }
  for (let i = 1; i < value.length; i++) {
    const prev = item;
    item = value[i]!;
    emitListSeparator(prev, item, printOptions, sep);
    const rendered = emitRenderedListItemMaybe(item, context, printOptions, true);
    if (isThenable(rendered)) {
      return (rendered as Promise<void>).then(() => renderRest(i + 1, item));
    }
  }
  return w.getSince(mark);
}

export type ListOptions = {
  /**
   * Lists can be separated by comma, semi-colon,
   * or slash, depending on the type of list.
   *
   * @todo - Is there a more CSS-y way to define this?
   */
  sep?: ',' | ';' | '/';
};

export interface List<T extends Node = Node> extends Node<T[], ListOptions> {
  eval(context: Context): Promise<this>;
}

/**
 * A list of expressions
 *
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 * or one / two / three
 */
export class List<T extends Node = Node> extends Node<T[], ListOptions> {
  static override childKeys = ['value'] as const;

  declare readonly value: T[];
  readonly sep: ListOptions['sep'];

  constructor(value: T[], options?: ListOptions, location?: NodeLocation, _treeContext?: Context['treeContext']) {
    super(value, options, location);
    this.value = value;
    this.sep = options?.sep;
  }

  private withResolvedValue(value: Node[]): List<Node> {
    return new List<Node>(
      value,
      this._options ? { ...this._options } : undefined
    ).inherit(this);
  }

  private deriveAdditionList(): List<Node> {
    const values = new Array<Node>(this.value.length);
    for (let i = 0; i < this.value.length; i++) {
      values[i] = this.value[i]!.cloneForPlacement();
    }
    return new List<Node>(
      values,
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

  private renderListSyntax(value = this.value, options?: PrintOptions): string {
    return renderListValueSyntax(value, getPrintOptions(options), this.sep ?? ',');
  }

  get length() {
    return this.value.length;
  }

  * [Symbol.iterator]() {
    yield* this.value.entries();
  }

  private _valueOf: string | undefined;

  override valueOf() {
    return (this._valueOf ??= this.value.map(v => v.valueOf()).join(';'));
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderListSyntax(this.value, options);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    if (this.value.length === 0) {
      return;
    }
    let item = this.value[0]!;
    emitListItemSyntax(item, options);
    for (let i = 1; i < this.value.length; i++) {
      const prev = item;
      item = this.value[i]!;
      emitListSeparator(prev, item, options, this.sep ?? ',');
      emitListItemSyntax(item, options, true);
    }
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (this.hasFlag(F_STATIC)) {
      return this.renderResolvedListValue(context, this.value, bufferOrOptions, options);
    }
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.renderDirectListValue(context, bufferOrOptions, options);
    }
    return this.renderDirectListValueMaybe(context, bufferOrOptions, options);
  }

  override compare(other: Node) {
    if (other instanceof List) {
      const equalityMode = this.sourceRoot?._treeContext?.equalityMode ?? 'coerce';
      const result = compareNodeArray(this.value, other.value, equalityMode);
      return result;
    }
    if (other.type === 'Any') {
      const normalize = (s: string) => s.replace(/;\s*/g, ', ').replace(/\s+/g, ' ').trim();
      const left = normalize(this.toString());
      const right = normalize(other.toString());
      return left === right ? 0 : undefined;
    }
    return undefined;
  }

  override operate(b: Node, op: Operator, _context: Context): List<Node> {
    if (op !== '+') {
      throw new Error(`List operation "${op}" not supported`);
    }
    const newList = this.deriveAdditionList();
    if (b instanceof List) {
      for (let i = 0; i < b.value.length; i++) {
        newList.value.push(b.value[i]!.cloneForPlacement());
      }
    } else {
      newList.value.push(b.cloneForPlacement());
    }
    return newList;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  private renderResolvedListValue(
    context: Context,
    value: Node[],
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    // bufferOrOptions is PrintOptions | undefined in the non-buffer branch
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      : prepareRenderPrintState(context, bufferOrOptions as PrintOptions | undefined);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const out = this.renderListSyntax(value as T[], prepared);
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  private renderDirectListValue(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    // bufferOrOptions is PrintOptions | undefined in the non-buffer branch
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      : prepareRenderPrintState(context, bufferOrOptions as PrintOptions | undefined);
    const out = renderListValueDirect(context, this.value, prepared, this.sep ?? ',');
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  private renderDirectListValueMaybe(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    // bufferOrOptions is PrintOptions | undefined in the non-buffer branch
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      : prepareRenderPrintState(context, bufferOrOptions as PrintOptions | undefined);
    const out = renderListValueDirectMaybe(context, this.value, prepared, this.sep ?? ',');
    if (isThenable(out)) {
      return (out as Promise<string>).then(rendered => buffer ? writeRenderText(buffer, rendered) : rendered);
    }
    return buffer
      ? writeRenderText(buffer, out as string)
      : out;
  }

  protected override evalNode(context: Context): MaybePromise<List<Node>> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    const source = this.value;
    const values = this.hasFlag(F_MAY_ASYNC)
      ? evaluateNodeArrayMaybe(context, source)
      : evaluateNodeArraySync(context, source);
    if (isThenable(values)) {
      return (values as Promise<Node[]>).then((resolvedValues) => {
        if (resolvedValues === source) {
          return this;
        }
        for (let i = 0; i < resolvedValues.length; i++) {
          if (resolvedValues[i] !== source[i]) {
            return this.withResolvedValue(resolvedValues);
          }
        }
        return this;
      });
    }
    if (values === source) {
      return this;
    }
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== source[i]) {
        return this.withResolvedValue(values);
      }
    }
    return this;
  }

  /** @todo move to ToCssVisitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add('', this.location)
  //   const length = this.value.length - 1
  //   const cast = context.cast
  //   this.value.forEach((node, i) => {
  //     const val = cast(node)
  //     val.toCSS(context, out)

  //     if (i < length) {
  //       if (context.inSelector) {
  //         out.add(`,\n`)
  //       } else {
  //         out.add(', ')
  //       }
  //     }
  //   })
  // }

  /** @todo move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.list([\n', this.location)
  //   context.indent++
  //   const length = this.value.length - 1
  //   this.value.forEach((node, i) => {
  //     out.add(pre)
  //     if (node instanceof Node) {
  //       node.toModule(context, out)
  //     } else {
  //       out.add(JSON.stringify(node))
  //     }
  //     if (i < length) {
  //       out.add(',\n')
  //     }
  //   })
  //   context.indent--
  //   out.add(`\n])`)
  //   return out
  // }
}

type Params = ConstructorParameters<typeof List>;

export const list = defineType(List, 'List') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2]
) => List;
