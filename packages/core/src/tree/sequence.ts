import { Node, F_MAY_ASYNC, F_STATIC, defineType } from './node.js';
import { Nil } from './nil.js';
import { List } from './list.js';
import type { Context } from '../context.js';
import { compareNodeArray } from './util/compare.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
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

function hasNonWhitespaceTrivia(tokens: ReturnType<NonNullable<PrintOptions['trivia']>['lookup']>): boolean {
  return Boolean(tokens?.some(token => token.tokenType.name !== 'WS'));
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

/**
 * A continuous collection of nodes. Historically in Less,
 * these were termed "expressions", but in computer science,
 * an expression will yield a value, and a CSS value can
 * actually be a sequence of values (like for shorthand)
 */
export class Sequence extends Node<Node[], SequenceOptions> {
  private withValue(value: Node[]): Sequence {
    return new Sequence(
      value,
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined
    ).inherit(this);
  }

  private deriveAdditionSequence(): Sequence {
    const values = new Array<Node>(this.value.length);
    for (let i = 0; i < this.value.length; i++) {
      values[i] = copyWithReusableLeaves(this.value[i]!);
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
    let unchanged = values.length === this.value.length;
    for (let i = 0; i < values.length; i++) {
      const node = values[i]!;
      if (!node || node instanceof Nil) {
        hasNil = true;
        unchanged = false;
        continue;
      }
      count++;
      only = node;
      if (unchanged && node !== this.value[i]) {
        unchanged = false;
      }
    }
    if (count === 1 && !this._options?.preserveWhitespace) {
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
      const result = compareNodeArray(this.value, other.value, equalityMode);
      return result;
    }
    if (other.type === 'Any') {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
      const left = normalize(this.toString());
      const right = normalize(other.toString());
      return left === right ? 0 : undefined;
    }
    return undefined;
  }

  private writeSequenceSyntax(value: Node[], printOptions: FinalPrintOptions): void {
    if (printOptions.inCustom) {
      for (const node of value) {
        node.toString(printOptions);
      }
      return;
    }
    const w = printOptions.writer;
    const length = value.length;

    if (length === 0) {
      return;
    }

    value[0]!.toString(printOptions);

    // Serialize subsequent nodes with normalized spacing
    for (let i = 1; i < length; i++) {
      const prev = value[i - 1]!;
      const node = value[i]!;
      const prevLastChar = w.lastChar();
      const prevEndsWithSpace = prevLastChar === ' ';

      const sourceTrivia = (
        printOptions.trivia
        && prev.sourceRoot?._treeContext?.opts?.trivia === printOptions.trivia
        && node.sourceRoot?._treeContext?.opts?.trivia === printOptions.trivia
      );
      const trivia = sourceTrivia ? printOptions.trivia : undefined;
      const hasTrivia = Boolean(
        trivia
        && (
          hasNonWhitespaceTrivia(trivia.lookup(prev.location[3], 'after'))
          || hasNonWhitespaceTrivia(trivia.lookup(node.location[0], 'before'))
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
      node.toString(printOptions);
    }
  }

  private renderSequenceSyntax(value = this.value, options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer;
    const mark = w.mark();
    this.writeSequenceSyntax(value, printOptions);
    return w.getSince(mark);
  }

  private renderSequenceDirect(context: Context, options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer;
    const mark = w.mark();
    let prev: Node | undefined;

    if (printOptions.inCustom) {
      for (let i = 0; i < this.value.length; i++) {
        const node = this.value[i]!;
        if (node instanceof Nil) {
          continue;
        }
        emitRenderedSequenceNode(node, context, printOptions);
      }
      return w.getSince(mark);
    }

    for (let i = 0; i < this.value.length; i++) {
      const node = this.value[i]!;
      if (node instanceof Nil) {
        continue;
      }
      if (prev) {
        const prevLastChar = w.lastChar();
        const prevEndsWithSpace = prevLastChar === ' ';
        const sourceTrivia = (
          printOptions.trivia
          && prev.sourceRoot?._treeContext?.opts?.trivia === printOptions.trivia
          && node.sourceRoot?._treeContext?.opts?.trivia === printOptions.trivia
        );
        const trivia = sourceTrivia ? printOptions.trivia : undefined;
        const hasTrivia = Boolean(
          trivia
          && (
            hasNonWhitespaceTrivia(trivia.lookup(prev.location[3], 'after'))
            || hasNonWhitespaceTrivia(trivia.lookup(node.location[0], 'before'))
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
    const w = printOptions.writer;
    const mark = w.mark();

    const renderCustomRest = async (start: number): Promise<string> => {
      for (let i = start; i < this.value.length; i++) {
        const node = this.value[i]!;
        if (node instanceof Nil) {
          continue;
        }
        await emitRenderedSequenceNodeMaybe(node, context, printOptions);
      }
      return w.getSince(mark);
    };

    if (printOptions.inCustom) {
      for (let i = 0; i < this.value.length; i++) {
        const node = this.value[i]!;
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
      for (let i = start; i < this.value.length; i++) {
        const node = this.value[i]!;
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
    for (let i = 0; i < this.value.length; i++) {
      const node = this.value[i]!;
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
  ): void {
    const w = printOptions.writer;
    const prevLastChar = w.lastChar();
    const prevEndsWithSpace = prevLastChar === ' ';
    const sourceTrivia = (
      printOptions.trivia
      && prev.sourceRoot?._treeContext?.opts?.trivia === printOptions.trivia
      && node.sourceRoot?._treeContext?.opts?.trivia === printOptions.trivia
    );
    const trivia = sourceTrivia ? printOptions.trivia : undefined;
    const hasTrivia = Boolean(
      trivia
      && (
        hasNonWhitespaceTrivia(trivia.lookup(prev.location[3], 'after'))
        || hasNonWhitespaceTrivia(trivia.lookup(node.location[0], 'before'))
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

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderSequenceSyntax(this.value, options);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    this.writeSequenceSyntax(this.value, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (this.hasFlag(F_STATIC)) {
      return this.renderResolvedValue(context, this.value, bufferOrOptions, options);
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
        ? writeRenderedSequenceNode(buffer, value.render(context, options))
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
    if (count === 1 && !this._options?.preserveWhitespace) {
      const node = only!;
      return buffer
        ? writeRenderedSequenceNode(buffer, node.render(context, options))
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
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = this.renderSequenceSyntax(renderValue, prepared);
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  private renderDirectValue(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = this.renderSequenceDirect(context, prepared);
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  private renderDirectValueMaybe(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = this.renderSequenceDirectMaybe(context, prepared);
    if (isThenable(out)) {
      return (out as Promise<string>).then(rendered => buffer ? writeRenderText(buffer, rendered) : rendered);
    }
    return buffer
      ? writeRenderText(buffer, out as string)
      : out;
  }

  override operate(b: Node, op: string, _context: Context): Sequence | List {
    if (op !== '+') {
      throw new Error(`Sequence operation "${op}" not supported`);
    }
    const newSequence = this.deriveAdditionSequence();
    if (b instanceof List) {
      const values = new Array<Node>(b.value.length + 1);
      values[0] = newSequence;
      for (let i = 0; i < b.value.length; i++) {
        values[i + 1] = copyWithReusableLeaves(b.value[i]!);
      }
      return new List(values).inherit(this);
    } else if (isNode(b, N.Sequence)) {
      for (let i = 0; i < b.value.length; i++) {
        newSequence.value.push(copyWithReusableLeaves(b.value[i]!));
      }
    } else {
      b = copyWithReusableLeaves(b);
      newSequence.value.push(b);
    }
    return newSequence;
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
      return this.finalizeValues(evaluateNodeArraySync(context, this.value));
    }
    const values = evaluateNodeArrayMaybe(context, this.value);
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
  //   this.value.forEach(n => {
  //     const val = cast(n)
  //     val.toCSS(context, out)
  //   })
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.expr([', loc)
  //   const length = this.value.length - 1
  //   this.value.forEach((n, i) => {
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
