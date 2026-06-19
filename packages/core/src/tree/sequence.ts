import { Node, F_MAY_ASYNC, F_STATIC, defineType, type NodeLocation } from './node.js';
import { Nil } from './nil.js';
import { List } from './list.js';
import type { Context } from '../context.js';
import { compareNodeArray } from './util/compare.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writeRenderText
} from './util/render-buffer.js';
import { copyWithReusableLeaves } from './util/cloning.js';
import {
  evaluateNodeArrayMaybe,
  evaluateNodeArraySync
} from './util/evaluate-node-array.js';

export type SequenceOptions = {
  /**
   * CSS values are typically spaced,
   * because of how they're parsed.
   */
  // spaced: boolean
  /** Used with custom properties */
  preserveWhitespace?: boolean;
};

function isIdentifierChar(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z_-]/u.test(value));
}

function hasUnemittedTriviaTokens(
  tokens: ReturnType<NonNullable<PrintOptions['trivia']>['lookup']>,
  printOptions: ReturnType<typeof getPrintOptions>
): boolean {
  return Boolean(tokens?.length && !printOptions.emittedTrivia?.has(tokens));
}

function bufferSharesContextWriter(buffer: RenderBuffer, context: Context): boolean {
  const writer = context.printState.writer;
  return buffer.kind === 'flat'
    && (buffer as { shareWriter?: boolean }).shareWriter === true
    && !!writer
    && writer.writesTo(buffer.parts);
}

function canFallbackSpaceAfterEmptyTrivia(prev: Node, node: Node): boolean {
  return isNode(prev, N.Dimension | N.Color)
    && isNode(node, N.Dimension | N.Color);
}

function prepareSequenceBufferPrintState(
  context: Context,
  buffer: RenderBuffer,
  options?: PrintOptions
): ReturnType<typeof getPrintOptions> {
  const writer = bufferSharesContextWriter(buffer, context)
    ? context.printState.writer
    : undefined;
  return writer
    ? prepareRenderPrintState(context, { ...options, writer })
    : prepareBufferPrintState(context, options);
}

function emitRenderedSequenceNode(
  node: Node,
  context: Context,
  options: ReturnType<typeof getPrintOptions>
): void {
  node.render(context, options);
}

function emitRenderedSequenceNodeMaybe(
  node: Node,
  context: Context,
  options: ReturnType<typeof getPrintOptions>
): MaybePromise<void> {
  const renderNode = (renderedNode: Node): MaybePromise<void> => {
    const rendered = renderedNode.render(context, options);
    if (isThenable(rendered)) {
      return rendered.then(() => undefined);
    }
  };
  if (node.hasFlag(F_MAY_ASYNC)) {
    const resolved = node.resolve(context);
    return isThenable(resolved)
      ? resolved.then(renderNode)
      : renderNode(resolved);
  }
  return renderNode(node);
}

function writeRenderedSequenceNode(
  buffer: RenderBuffer,
  rendered: MaybePromise<string>
): MaybePromise<string> {
  return isThenable(rendered)
    ? (rendered as Promise<string>).then(out => writeRenderText(buffer, out))
    : writeRenderText(buffer, rendered as string);
}

function writeSingleSequenceNodeToBuffer(
  buffer: RenderBuffer,
  node: Node,
  context: Context,
  options?: PrintOptions
): MaybePromise<string> {
  const prepared = prepareSequenceBufferPrintState(context, buffer, options);
  const rendered = node.render(context, prepared);
  if (bufferSharesContextWriter(buffer, context)) {
    return rendered;
  }
  return writeRenderedSequenceNode(buffer, rendered);
}

/**
 * A continuous collection of nodes. Historically in Less,
 * these were termed "expressions", but in computer science,
 * an expression will yield a value, and a CSS value can
 * actually be a sequence of values (like for shorthand)
 */
export class Sequence extends Node<Node[], SequenceOptions> {
  static override childKeys = ['items'] as const;

  readonly items: Node[];
  readonly preserveWhitespace: boolean | undefined;

  constructor(value: Node[], options?: SequenceOptions, location?: NodeLocation, _treeContext?: Context['treeContext']) {
    super(value, options, location, false);
    this.items = value;
    this.preserveWhitespace = options?.preserveWhitespace;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item instanceof Node) {
        this.adopt(item);
      }
    }
  }

  private withValue(value: Node[]): Sequence {
    return new Sequence(
      value,
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined
    ).inherit(this);
  }

  private deriveAdditionSequence(): Sequence {
    const values = new Array<Node>(this.items.length);
    for (let i = 0; i < this.items.length; i++) {
      values[i] = copyWithReusableLeaves(this.items[i]!);
    }
    return new Sequence(
      values,
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined
    ).inherit(this);
  }

  private finalizeValues(values: Node[]): Node {
    let count = 0;
    let only: Node | undefined;
    let hasNil = false;
    let unchanged = values.length === this.items.length;
    for (let i = 0; i < values.length; i++) {
      const node = values[i]!;
      if (!node || node instanceof Nil) {
        hasNil = true;
        unchanged = false;
        continue;
      }
      count++;
      only = node;
      if (unchanged && node !== this.items[i]) {
        unchanged = false;
      }
    }
    if (count === 1 && !this.preserveWhitespace) {
      return only!;
    }
    if (unchanged) {
      return this;
    }
    if (!hasNil) {
      return this.withValue(values);
    }
    const filtered = new Array<Node>(count);
    let outIndex = 0;
    for (let i = 0; i < values.length; i++) {
      const node = values[i]!;
      if (node && !(node instanceof Nil)) {
        filtered[outIndex++] = node;
      }
    }
    return this.withValue(filtered);
  }

  override compare(other: Node) {
    if (other instanceof Sequence) {
      const equalityMode = this.sourceRoot?._treeContext?.equalityMode ?? 'coerce';
      const result = compareNodeArray(this.items, other.items, equalityMode);
      return result;
    }
    if (other.type === 'Any') {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
      const left = normalize(this.renderSequenceSyntax());
      const right = normalize(String(other.valueOf?.() ?? other.value));
      return left === right ? 0 : undefined;
    }
    return undefined;
  }

  private renderSequenceSyntax(value = this.items, options?: PrintOptions, sharedParts?: string[]): string {
    const printOptions = getPrintOptions(options);
    const length = value.length;
    if (length === 0) {
      return '';
    }
    if (printOptions.inCustom) {
      const w = printOptions.writer!;
      const mark = w.mark();
      for (const node of value) {
        if (node instanceof Nil) {
          continue;
        }
        node.writeSyntax(printOptions);
      }
      return sharedParts ? sharedParts.slice(mark).join('') : w.getSince(mark);
    }
    const w = printOptions.writer;
    const mark = w.position();
    let prev: Node | undefined;

    // Serialize subsequent nodes with normalized spacing
    for (let i = 0; i < length; i++) {
      const node = value[i]!;
      if (node instanceof Nil) {
        continue;
      }
      let separatorQueued = false;
      if (prev) {
        separatorQueued = this.emitDirectSeparator(prev, node, printOptions);
      }
      const beforeTriviaPosition = w.position();
      this.emitDirectBeforeTrivia(node, printOptions);
      if (
        prev
        && !separatorQueued
        && w.position() === beforeTriviaPosition
        && w.lastChar() !== ' '
        && canFallbackSpaceAfterEmptyTrivia(prev, node)
      ) {
        w.queueSpacer(' ');
      }
      node.writeSyntax(printOptions);
      prev = node;
    }

    return sharedParts ? sharedParts.slice(mark).join('') : w.getSince(mark);
  }

  private renderSequenceDirect(context: Context, options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    if (!this.hasRenderableItems()) {
      return '';
    }
    const w = printOptions.writer;
    const mark = w.mark();
    let prev: Node | undefined;

    if (printOptions.inCustom) {
      for (let i = 0; i < this.items.length; i++) {
        const node = this.items[i]!;
        if (node instanceof Nil) {
          continue;
        }
        emitRenderedSequenceNode(node, context, printOptions);
      }
      return w.getSince(mark);
    }

    for (let i = 0; i < this.items.length; i++) {
      const node = this.items[i]!;
      if (node instanceof Nil) {
        continue;
      }
      if (prev) {
        const prevLastChar = w.lastChar();
        const prevEndsWithSpace = prevLastChar === ' ';
      const sourceTrivia = Boolean(printOptions.trivia);
        const trivia = sourceTrivia ? printOptions.trivia : undefined;
        const hasTrivia = Boolean(
          trivia
          && (
            hasUnemittedTriviaTokens(trivia.lookup(prev.location[3], 'after'), printOptions)
            || hasUnemittedTriviaTokens(trivia.lookup(node.location[0], 'before'), printOptions)
          )
        );
        const prevEnd = prev.location[3];
        const nodeStart = node.location[0];
        const noSep = Boolean(
          sourceTrivia
          && prevEnd !== undefined
          && nodeStart !== undefined
          && (prevEnd === nodeStart || prevEnd + 1 === nodeStart)
        );
        const needsMergeGuard = noSep && isIdentifierChar(prevLastChar);

        if (
          !prevEndsWithSpace
          && !hasTrivia
          && (!noSep || needsMergeGuard)
        ) {
          w.queueSpacer(' ', needsMergeGuard
            ? nextText => /^[A-Za-z0-9_-]/u.test(nextText)
            : undefined);
        }
      }
      emitRenderedSequenceNode(node, context, printOptions);
      prev = node;
    }

    return w.getSince(mark);
  }

  private renderSequenceDirectMaybe(context: Context, options?: PrintOptions): MaybePromise<string> {
    const printOptions = getPrintOptions(options);
    if (!this.hasRenderableItems()) {
      return '';
    }
    const w = printOptions.writer;
    const mark = w.mark();

    const renderCustomRest = async (start: number): Promise<string> => {
      for (let i = start; i < this.items.length; i++) {
        const node = this.items[i]!;
        if (node instanceof Nil) {
          continue;
        }
        await emitRenderedSequenceNodeMaybe(node, context, printOptions);
      }
      return w.getSince(mark);
    };

    if (printOptions.inCustom) {
      for (let i = 0; i < this.items.length; i++) {
        const node = this.items[i]!;
        if (node instanceof Nil) {
          continue;
        }
        const rendered = emitRenderedSequenceNodeMaybe(node, context, printOptions);
        if (isThenable(rendered)) {
          return (rendered as Promise<void>).then(() => renderCustomRest(i + 1));
        }
      }
      return w.getSince(mark);
    }

    const renderRest = async (start: number, previous: Node | undefined): Promise<string> => {
      let prev = previous;
      for (let i = start; i < this.items.length; i++) {
        const node = this.items[i]!;
        if (node instanceof Nil) {
          continue;
        }
        if (prev) {
          this.emitDirectSeparator(prev, node, printOptions);
        }
        await emitRenderedSequenceNodeMaybe(node, context, printOptions);
        prev = node;
      }
      return w.getSince(mark);
    };

    let prev: Node | undefined;
    for (let i = 0; i < this.items.length; i++) {
      const node = this.items[i]!;
      if (node instanceof Nil) {
        continue;
      }
      if (prev) {
        this.emitDirectSeparator(prev, node, printOptions);
      }
      const rendered = emitRenderedSequenceNodeMaybe(node, context, printOptions);
      if (isThenable(rendered)) {
        return (rendered as Promise<void>).then(() => renderRest(i + 1, node));
      }
      prev = node;
    }

    return w.getSince(mark);
  }

  private emitDirectSeparator(
    prev: Node,
    node: Node,
    printOptions: ReturnType<typeof getPrintOptions>
  ): boolean {
    const w = printOptions.writer;
    const prevLastChar = w.lastChar();
    const prevEndsWithSpace = prevLastChar === ' ';
    const sourceTrivia = Boolean(printOptions.trivia);
    const trivia = sourceTrivia ? printOptions.trivia : undefined;
    const hasTrivia = Boolean(
      trivia
      && (
        hasUnemittedTriviaTokens(trivia.lookup(prev.location[3], 'after'), printOptions)
        || hasUnemittedTriviaTokens(trivia.lookup(node.location[0], 'before'), printOptions)
      )
    );
    const prevEnd = prev.location[3];
    const nodeStart = node.location[0];
    const noSep = Boolean(
      sourceTrivia
      && prevEnd !== undefined
      && nodeStart !== undefined
      && (prevEnd === nodeStart || prevEnd + 1 === nodeStart)
    );
    const needsMergeGuard = noSep && isIdentifierChar(prevLastChar);

    if (
      !prevEndsWithSpace
      && !hasTrivia
      && (!noSep || needsMergeGuard)
    ) {
      w.queueSpacer(' ', needsMergeGuard
        ? nextText => /^[A-Za-z0-9_-]/u.test(nextText)
        : undefined);
      return true;
    }
    return false;
  }

  private emitDirectBeforeTrivia(
    node: Node,
    printOptions: ReturnType<typeof getPrintOptions>
  ): void {
    const trivia = printOptions.trivia;
    if (!trivia) {
      return;
    }
    emitTriviaTokens(
      consumeTrivia(trivia, node.location[0], 'before', printOptions),
      printOptions,
      { skipLeadingWhitespace: false }
    );
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderSequenceSyntax(this.items, options);
  }

  override valueOf(): string {
    return this.renderSequenceSyntax();
  }

  private hasRenderableItems(value = this.items): boolean {
    for (let i = 0; i < value.length; i++) {
      if (!(value[i] instanceof Nil)) {
        return true;
      }
    }
    return false;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (this.hasFlag(F_STATIC)) {
      return this.renderResolvedValue(context, this.items, bufferOrOptions, options);
    }
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.renderDirectValue(context, bufferOrOptions, options);
    }
    return this.renderDirectValueMaybe(context, bufferOrOptions, options);
  }

  private renderResolvedValue(
    context: Context,
    value: Node | Node[],
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    if (value instanceof Node) {
      return buffer
        ? writeSingleSequenceNodeToBuffer(buffer, value, context, options)
        : value.render(context, bufferOrOptions);
    }
    let count = 0;
    let only: Node | undefined;
    let hasNil = false;
    for (let i = 0; i < value.length; i++) {
      const node = value[i]!;
      if (!node || node instanceof Nil) {
        hasNil = true;
        continue;
      }
      count++;
      only = node;
    }
    if (count === 1 && !this.preserveWhitespace) {
      const node = only!;
      return buffer
        ? writeSingleSequenceNodeToBuffer(buffer, node, context, options)
        : node.render(context, bufferOrOptions);
    }
    let renderValue = value;
    if (hasNil) {
      renderValue = new Array<Node>(count);
      let outIndex = 0;
      for (let i = 0; i < value.length; i++) {
        const node = value[i]!;
        if (node && !(node instanceof Nil)) {
          renderValue[outIndex++] = node;
        }
      }
    }
    const prepared = buffer
      ? prepareSequenceBufferPrintState(context, buffer, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = this.renderSequenceSyntax(
      renderValue,
      prepared,
      buffer && bufferSharesContextWriter(buffer, context) && buffer.kind === 'flat'
        ? buffer.parts
        : undefined
    );
    return buffer
      ? (bufferSharesContextWriter(buffer, context) ? out : writeRenderText(buffer, out))
      : out;
  }

  private renderDirectValue(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareSequenceBufferPrintState(context, buffer, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = this.renderSequenceDirect(context, prepared);
    return buffer
      ? (bufferSharesContextWriter(buffer, context) ? out : writeRenderText(buffer, out))
      : out;
  }

  private renderDirectValueMaybe(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareSequenceBufferPrintState(context, buffer, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = this.renderSequenceDirectMaybe(context, prepared);
    if (isThenable(out)) {
      return (out as Promise<string>).then(rendered => buffer ? (bufferSharesContextWriter(buffer, context) ? rendered : writeRenderText(buffer, rendered)) : rendered);
    }
    return buffer
      ? (bufferSharesContextWriter(buffer, context) ? out as string : writeRenderText(buffer, out as string))
      : out;
  }

  override operate(b: Node, op: string, _context: Context): Sequence | List {
    if (op !== '+') {
      throw new Error(`Sequence operation "${op}" not supported`);
    }
    const newSequence = this.deriveAdditionSequence();
    if (b instanceof List) {
      const values = new Array<Node>(b.items.length + 1);
      values[0] = newSequence;
      for (let i = 0; i < b.items.length; i++) {
        values[i + 1] = copyWithReusableLeaves(b.items[i]!);
      }
      return new List(values).inherit(this);
    } else if (isNode(b, N.Sequence)) {
      const values = new Array<Node>(newSequence.items.length + b.items.length);
      for (let i = 0; i < newSequence.items.length; i++) {
        values[i] = newSequence.items[i]!;
      }
      for (let i = 0; i < b.items.length; i++) {
        values[newSequence.items.length + i] = copyWithReusableLeaves(b.items[i]!);
      }
      return new Sequence(
        values,
        newSequence._options ? { ...newSequence._options } : undefined,
        newSequence.location.length ? newSequence.location : undefined
      ).inherit(newSequence);
    } else {
      b = copyWithReusableLeaves(b);
      const values = new Array<Node>(newSequence.items.length + 1);
      for (let i = 0; i < newSequence.items.length; i++) {
        values[i] = newSequence.items[i]!;
      }
      values[newSequence.items.length] = b;
      return new Sequence(
        values,
        newSequence._options ? { ...newSequence._options } : undefined,
        newSequence.location.length ? newSequence.location : undefined
      ).inherit(newSequence);
    }
  }

  /**
   * During evaluation of sequences,
   * Jess may find values that are lists.
   *
   * In this case, we need to create a single
   * list that contains members of the expanded lists.
   *
   * @todo - If this is a selector sequence, and we've
   *         evaluated an expression to an inner sequence,
   *         then we should be inserting white-space combinators?
   *
   * @todo - REWRITE
   */
  override evalNode(context: Context): MaybePromise<Node> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeValues(evaluateNodeArraySync(context, this.items));
    }
    const values = evaluateNodeArrayMaybe(context, this.items);
    return isThenable(values)
      ? (values as Promise<Node[]>).then(resolved => this.finalizeValues(resolved))
      : this.finalizeValues(values as Node[]);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector): void {
  //   const cast = context.cast
  //   this.items.forEach(n => {
  //     const val = cast(n)
  //     val.toCSS(context, out)
  //   })
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.expr([', loc)
  //   const length = this.items.length - 1
  //   this.items.forEach((n, i) => {
  //     n.toModule(context, out)
  //     if (i < length) {
  //       out.add(', ')
  //     }
  //   })
  //   out.add('])')
  // }
}

export const seq = defineType(Sequence, 'Sequence', 'seq');

export const spaced = (
  value: Node[],
  options?: SequenceOptions
) => {
  return new Sequence(value, options);
};
