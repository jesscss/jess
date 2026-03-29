import type { Context } from '../context.js';
import { Node, defineType, type OptionalLocation, type TreeContext } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { setField } from './util/field-helpers.js';

export type BlockOptions = {
  type: 'curly' | 'square';
};

export type BlockChildData = { value: Node };

export interface Block extends Node<Node, BlockOptions, BlockChildData> {
  type: 'Block';
  shortType: 'block';
  eval(context: Context): MaybePromise<Block>;
}

/**
 * A block like `{ ... }` or `[ ... ]`. This is used
 * for things like custom properties and unknown at-rules.
 */
export class Block extends Node<Node, BlockOptions, BlockChildData> {
  static override childKeys = ['value'] as const;

  /** @internal */ value!: Node;

  constructor(value: Node, options?: BlockOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
  }

  override evalNode(context: Context): MaybePromise<Block> {
    const value = this.get('value', context);
    const finish = (nextValue: Node): Block => {
      if (nextValue !== value) {
        setField(this, 'value', nextValue, context);
      }
      return this;
    };
    const maybeEvald = value.eval(context);
    if (isThenable(maybeEvald)) {
      return (maybeEvald as Promise<Node>).then(finish);
    }
    return finish(maybeEvald as Node);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const value = this.get('value', options.context);
    let { type } = this.options ?? {};
    let start = type === 'square' ? '[' : '{';
    let end = type === 'square' ? ']' : '}';
    w.add(start);
    value.toString(options);
    w.add(end);
    return w.getSince(mark);
  }
}

type BlockParams = ConstructorParameters<typeof Block>;

export const block = defineType(Block, 'Block') as (
  value: BlockParams[0],
  options?: BlockParams[1],
  location?: BlockParams[2],
  treeContext?: BlockParams[3]
) => Block;
