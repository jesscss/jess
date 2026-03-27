import type { Context } from '../context.js';
import { Node, defineType, type OptionalLocation, type TreeContext } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { getField, setField } from './util/field-helpers.js';

export type BlockOptions = {
  type: 'curly' | 'square';
};

export interface Block extends Node<Node, BlockOptions> {
  type: 'Block';
  shortType: 'block';
  eval(context: Context): Block;
}

/**
 * A block like `{ ... }` or `[ ... ]`. This is used
 * for things like custom properties and unknown at-rules.
 */
export class Block extends Node<Node, BlockOptions> {
  static override childKeys = ['value'] as const;

  readonly value!: Node;

  constructor(value: Node, options?: BlockOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
  }

  private _getValue(context?: Context): Node {
    return context
      ? getField<Node>(this, 'value', context)
      : this.value;
  }

  override evalNode(context: Context): MaybePromise<Block> {
    const value = this._getValue(context);
    const finish = (nextValue: Node): Block => {
      if (nextValue !== value) {
        if (context.session) {
          setField(this, 'value', nextValue, context);
        } else {
          this.setData('value', nextValue);
        }
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
    const value = this._getValue(options.context);
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
