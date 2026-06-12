import type { Context } from '../context.js';
import { Node, F_MAY_ASYNC, F_STATIC, defineType } from './node.js';
import { Nil } from './nil.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { consumeTriviaText } from './util/trivia.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writePreparedRenderText,
  type RenderBuffer
} from './util/render-buffer.js';

export type BlockOptions = {
  type: 'curly' | 'square';
};

export interface Block extends Node<Node, BlockOptions> {
  eval(context: Context): Block;
}

/**
 * A block like `{ ... }` or `[ ... ]`. This is used
 * for things like custom properties and unknown at-rules.
 */
export class Block extends Node<Node, BlockOptions> {
  private withValue(value: Node): Block {
    const location = this._location && this._location.length === 6
      ? this._location
      : undefined;
    return new Block(
      value,
      this._options ? { ...this._options } : undefined,
      location
    ).inherit(this);
  }

  private writeBlockSyntax(value: Node, options: FinalPrintOptions): void {
    const w = options.writer;
    const type = this._options?.type;
    let start = type === 'square' ? '[' : '{';
    let end = type === 'square' ? ']' : '}';
    w.add(start);
    const trivia = options.trivia ?? this.sourceRoot?._treeContext?.opts?.trivia;
    if (trivia) {
      value.toString(options);
    } else {
      value.writeSyntax(options);
    }
    if (trivia) {
      w.add(consumeTriviaText(trivia, this.location[3], 'before', options));
    }
    w.add(end);
  }

  private renderBlockSyntax(value = this.value, options?: PrintOptions): string {
    options = getPrintOptions(options);
    const type = this._options?.type;
    const trivia = options.trivia ?? this.sourceRoot?._treeContext?.opts?.trivia;
    if (value instanceof Nil && !trivia) {
      const out = type === 'square' ? '[]' : '{}';
      options.writer.add(out, this);
      return out;
    }
    const mark = options.writer.mark();
    this.writeBlockSyntax(value, options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderBlockSyntax(this.value, options);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    this.writeBlockSyntax(this.value, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options, buffer)
      : prepareRenderPrintState(context, bufferOrOptions);
    const mark = buffer ? prepared.writer.mark() : 0;
    const value = this.hasFlag(F_STATIC)
      ? this.value
      : this.value.hasFlag(F_MAY_ASYNC)
        ? this.value.eval(context)
        : this.value.evalSync(context);
    if (isThenable(value)) {
      return value.then((resolved) => {
        const out = this.renderBlockSyntax(resolved, prepared);
        return buffer
          ? writePreparedRenderText(buffer, prepared, mark, out)
          : out;
      });
    }
    const out = this.renderBlockSyntax(value, prepared);
    return buffer
      ? writePreparedRenderText(buffer, prepared, mark, out)
      : out;
  }

  override evalNode(context: Context): MaybePromise<Block> {
    return this.evaluateValue(context);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context);
  }

  private evaluateValue(context: Context): MaybePromise<Block> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    const value = this.value.hasFlag(F_MAY_ASYNC)
      ? this.value.eval(context)
      : this.value.evalSync(context);
    const finalize = (resolvedValue: Node): Block => {
      if (resolvedValue === this.value) {
        return this;
      }
      return this.withValue(resolvedValue);
    };
    if (isThenable(value)) {
      return value.then(finalize);
    }
    return finalize(value);
  }
}

type BlockParams = ConstructorParameters<typeof Block>;

export const block = defineType(Block, 'Block') as (
  value: BlockParams[0],
  options?: BlockParams[1],
  location?: BlockParams[2]
) => Block;
