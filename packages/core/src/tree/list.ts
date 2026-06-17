import { type Context } from '../context.js';
import { defineType, F_MAY_ASYNC, F_STATIC, Node } from './node.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { compareNodeArray, normalizeComparableText } from './util/compare.js';
import { type Operator } from './util/calculate.js';
import {
  consumeTrivia,
  emitCommentTriviaBetweenNodes,
  emitNodeSourceSyntaxWithTrivia,
  emitTriviaTokens
} from './util/trivia.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writePreparedRenderText,
  writePreparedRenderTextResult,
  type RenderBuffer
} from './util/render-buffer.js';
import { copyWithReusableLeaves } from './util/cloning.js';
import { evaluateNodeArrayMaybe, evaluateNodeArraySync } from './util/evaluate-node-array.js';

function emitListItem<T extends Node>(
  item: T,
  options: ReturnType<typeof getPrintOptions>,
  suppressPre = false
): void {
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = suppressPre ? 'both' : 'post';
  const sourceTrivia = options.trivia ?? item.sourceRoot?._treeContext?.opts?.trivia;
  if (sourceTrivia) {
    emitNodeSourceSyntaxWithTrivia(item, options);
    options.suppressBoundaryTrivia = saved;
  } else {
    item.writeSyntax(options);
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
  let rendered: MaybePromise<void>;
  try {
    if (item.hasFlag(F_MAY_ASYNC)) {
      const resolved = item.resolve(context);
      if (isThenable(resolved)) {
        rendered = resolved.then((node) => {
          const renderedNode = node.render(context, options);
          return isThenable(renderedNode)
            ? renderedNode.then(() => undefined)
            : undefined;
        });
      } else {
        const renderedNode = resolved.render(context, options);
        rendered = isThenable(renderedNode)
          ? renderedNode.then(() => undefined)
          : undefined;
      }
    } else {
      const renderedNode = item.render(context, options);
      rendered = isThenable(renderedNode)
        ? renderedNode.then(() => undefined)
        : undefined;
    }
  } catch (error: unknown) {
    options.suppressBoundaryTrivia = saved;
    throw error;
  }
  if (isThenable(rendered)) {
    return rendered.then(
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

async function renderListValueDirectMaybeRest<T extends Node>(
  context: Context,
  value: T[],
  options: ReturnType<typeof getPrintOptions>,
  sep: ListOptions['sep'],
  mark: number,
  start: number,
  previous: T
): Promise<string> {
  const w = options.writer;
  let item = previous;
  for (let i = start; i < value.length; i++) {
    const prev = item;
    item = value[i]!;
    emitListSeparator(prev, item, options, sep);
    await emitRenderedListItemMaybe(item, context, options, true);
  }
  return w.getSince(mark);
}

export function writeListValueSyntax<T extends Node>(
  value: T[],
  options: FinalPrintOptions,
  sep: ListOptions['sep'] = ','
): void {
  const w = options.writer;
  let length = value.length;
  if (value.length === 0) {
    return;
  }
  let item = value[0]!;
  emitListItem(item, options);
  for (let i = 1; i < length; i++) {
    const prev = item;
    item = value[i]!;
    emitCommentTriviaBetweenNodes(prev, item, options);
    const leadingTrivia = options.trivia
      ? consumeTrivia(options.trivia, item.location[0], 'before', options)
      : undefined;
    const leadingWhitespace = leadingTrivia?.[0]?.tokenType.name === 'WS'
      ? leadingTrivia[0].image
      : '';
    const preserveLeadingWhitespace = /[\r\n]/.test(leadingWhitespace);
    if (sep === '/') {
      w.add(preserveLeadingWhitespace ? ' /' : ' / ');
    } else {
      w.add(preserveLeadingWhitespace ? sep : `${sep} `);
    }
    if (leadingTrivia) {
      emitTriviaTokens(
        leadingTrivia,
        options,
        { skipLeadingWhitespace: !preserveLeadingWhitespace }
      );
    }
    emitListItem(item, options, true);
  }
}

export function renderListValueSyntax<T extends Node>(
  value: T[],
  options: PrintOptions,
  sep: ListOptions['sep'] = ','
): string {
  const printOptions = getPrintOptions(options);
  const mark = printOptions.writer.mark();
  writeListValueSyntax(value, printOptions, sep);
  const w = printOptions.writer;
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
  const leadingWhitespace = leadingTrivia?.[0]?.tokenType.name === 'WS'
    ? leadingTrivia[0].image
    : '';
  const preserveLeadingWhitespace = /[\r\n]/.test(leadingWhitespace);
  if (sep === '/') {
    options.writer.add(preserveLeadingWhitespace ? ' /' : ' / ');
  } else {
    options.writer.add(preserveLeadingWhitespace ? sep : `${sep} `);
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
  sep: ListOptions['sep'] = ',',
  mark?: number
): string {
  const printOptions = getPrintOptions(options);
  const w = printOptions.writer;
  const startMark = mark ?? w.mark();
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
  return w.getSince(startMark);
}

function renderListValueDirectMaybe<T extends Node>(
  context: Context,
  value: T[],
  options: PrintOptions,
  sep: ListOptions['sep'] = ',',
  mark?: number
): MaybePromise<string> {
  const printOptions = getPrintOptions(options);
  const w = printOptions.writer;
  const startMark = mark ?? w.mark();
  if (value.length === 0) {
    return '';
  }

  let item = value[0]!;
  const first = emitRenderedListItemMaybe(item, context, printOptions);
  if (isThenable(first)) {
    return first.then(() => renderListValueDirectMaybeRest(context, value, printOptions, sep, startMark, 1, item));
  }
  for (let i = 1; i < value.length; i++) {
    const prev = item;
    item = value[i]!;
    emitListSeparator(prev, item, printOptions, sep);
    const rendered = emitRenderedListItemMaybe(item, context, printOptions, true);
    if (isThenable(rendered)) {
      return rendered.then(() => renderListValueDirectMaybeRest(context, value, printOptions, sep, startMark, i + 1, item));
    }
  }
  return w.getSince(startMark);
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
  private withResolvedValue(value: Node[]): List<Node> {
    return new List<Node>(
      value,
      this._options ? { ...this._options } : undefined
    ).inherit(this);
  }

  private renderListSyntax(value = this.value, options?: PrintOptions): string {
    if (value.length === 0) {
      return '';
    }
    return renderListValueSyntax(value, getPrintOptions(options), this._options?.sep ?? ',');
  }

  get length() {
    return this.value.length;
  }

  [Symbol.iterator](): IterableIterator<[number, T]> {
    return this.value.entries();
  }

  private _valueOf: string | undefined;

  override valueOf() {
    let valueOf = this._valueOf;
    if (valueOf === undefined) {
      if (this.value.length === 0) {
        valueOf = '';
      } else {
        valueOf = this.value[0]!.valueOf();
        for (let i = 1; i < this.value.length; i++) {
          valueOf += `;${this.value[i]!.valueOf()}`;
        }
      }
      this._valueOf = valueOf;
    }
    return valueOf;
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderListSyntax(this.value, options);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    writeListValueSyntax(this.value, options, this._options?.sep ?? ',');
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
      const left = normalizeComparableText(this.renderListSyntax(this.value));
      const right = normalizeComparableText(other.value);
      return left === right ? 0 : undefined;
    }
    return undefined;
  }

  override operate(b: Node, op: Operator, _context: Context): List<Node> {
    if (op !== '+') {
      throw new Error(`List operation "${op}" not supported`);
    }
    const leftLength = this.value.length;
    if (b instanceof List) {
      const values = new Array<Node>(leftLength + b.value.length);
      for (let i = 0; i < leftLength; i++) {
        values[i] = copyWithReusableLeaves(this.value[i]!);
      }
      for (let i = 0; i < b.value.length; i++) {
        values[leftLength + i] = copyWithReusableLeaves(b.value[i]!);
      }
      return new List<Node>(
        values,
        this._options ? { ...this._options } : undefined,
        this.location.length ? this.location : undefined,
        this.sourceRoot?._treeContext
      ).inherit(this);
    }
    const values = new Array<Node>(leftLength + 1);
    for (let i = 0; i < leftLength; i++) {
      values[i] = copyWithReusableLeaves(this.value[i]!);
    }
    values[leftLength] = copyWithReusableLeaves(b);
    return new List<Node>(
      values,
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
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
    if (value.length === 0) {
      return '';
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const sep = this._options?.sep ?? ',';
    if (buffer) {
      const prepared = prepareBufferPrintState(context, options, buffer);
      const mark = prepared.writer.mark();
      writeListValueSyntax(value, prepared, sep);
      const out = prepared.writer.getSince(mark);
      return writePreparedRenderText(buffer, prepared, mark, out);
    }
    const prepared = prepareRenderPrintState(context, bufferOrOptions);
    return this.renderListSyntax(value, prepared);
  }

  private renderDirectListValue(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    if (this.value.length === 0) {
      return '';
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options, buffer)
      : prepareRenderPrintState(context, bufferOrOptions);
    if (buffer) {
      const mark = prepared.writer.mark();
      const out = renderListValueDirect(context, this.value, prepared, this._options?.sep ?? ',', mark);
      return writePreparedRenderText(buffer, prepared, mark, out);
    }
    return renderListValueDirect(context, this.value, prepared, this._options?.sep ?? ',');
  }

  private renderDirectListValueMaybe(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    if (this.value.length === 0) {
      return '';
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options, buffer)
      : prepareRenderPrintState(context, bufferOrOptions);
    if (!buffer) {
      return renderListValueDirectMaybe(context, this.value, prepared, this._options?.sep ?? ',');
    }
    const mark = prepared.writer.mark();
    const out = renderListValueDirectMaybe(context, this.value, prepared, this._options?.sep ?? ',', mark);
    if (isThenable(out)) {
      return writePreparedRenderTextResult(buffer, prepared, mark, out);
    }
    return writePreparedRenderText(buffer, prepared, mark, out);
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
      return values.then((resolvedValues) => {
        for (let i = 0; i < resolvedValues.length; i++) {
          if (resolvedValues[i] !== source[i]) {
            return this.withResolvedValue(resolvedValues);
          }
        }
        return this;
      });
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
