import type { Context } from '../context.js';
import { Node, F_STATIC, defineType, type NodeLocation } from './node.js';
import { type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { consumeTriviaText } from './util/trivia.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';

export type BlockOptions = {
  type: 'curly' | 'square';
};

export interface Block extends Node<Node, BlockOptions> {
  eval(context: Context): Block;
}

function getWriterTextSincePosition(writer: { position(): number }, position: number): string {
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

/**
 * A block like `{ ... }` or `[ ... ]`. This is used
 * for things like custom properties and unknown at-rules.
 */
export class Block extends Node<Node, BlockOptions> {
  static override childKeys = ['node'] as const;

  readonly node: Node;

  private withValue(value: Node): Block {
    const location = this._location && this._location.length === 6
      ? this._location
      : undefined;
    return new Block(
      value,
      this._options ? { ...this._options } : undefined,
      location,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

  constructor(
    value: Node,
    options?: BlockOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location, false);
    this._treeContext = treeContext;
    this.node = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
  }

  private renderBlockSyntax(value = this.node, options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const position = w.position();
    const type = this._options?.type;
    let start = type === 'square' ? '[' : '{';
    let end = type === 'square' ? ']' : '}';
    w.add(start);
    const trivia = options.trivia ?? this.sourceRoot?._treeContext?.opts?.trivia;
    if (trivia) {
      w.add(consumeTriviaText(trivia, value.location[0], 'before', options));
    }
    value.writeSyntax(options);
    if (trivia) {
      w.add(consumeTriviaText(trivia, this.location[3], 'before', options));
    }
    w.add(end);
    return getWriterTextSincePosition(w, position);
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderBlockSyntax(this.node, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const value = this.hasFlag(F_STATIC) ? this.node : this.node.eval(context);
    if (isThenable(value)) {
      return (value as Promise<Node>).then((resolved) => {
        const out = this.renderBlockSyntax(resolved, prepared);
        return buffer
          ? writeRenderText(buffer, out)
          : out;
      });
    }
    const out = this.renderBlockSyntax(value as Node, prepared);
    return buffer
      ? writeRenderText(buffer, out)
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
    const value = this.node.eval(context);
    const finalize = (resolvedValue: Node): Block => {
      if (resolvedValue === this.node) {
        return this;
      }
      return this.withValue(resolvedValue);
    };
    if (isThenable(value)) {
      return (value as Promise<Node>).then(finalize);
    }
    return finalize(value as Node);
  }
}

type BlockParams = ConstructorParameters<typeof Block>;

export const block = defineType(Block, 'Block') as (
  value: BlockParams[0],
  options?: BlockParams[1],
  location?: BlockParams[2],
  treeContext?: BlockParams[3]
) => Block;
