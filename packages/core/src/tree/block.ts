import type { Context } from '../context.js';
import { Node, defineType } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  renderNodeToBuffer,
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
  private withValue(value: Node): this {
    const node = this.clone(false) as this;
    node.value = value;
    return node;
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const type = this._options?.type;
    let start = type === 'square' ? '[' : '{';
    let end = type === 'square' ? ']' : '}';
    w.add(start);
    super.toTrimmedString(options);
    w.add(end);
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return renderNodeToBuffer(this, context, bufferOrOptions, options);
    }
    return super.render(context, bufferOrOptions);
  }

  override resolve(context: Context): MaybePromise<Node> {
    const value = this.value.resolve(context);
    const finalize = (resolvedValue: Node): Node => {
      if (resolvedValue === this.value) {
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
