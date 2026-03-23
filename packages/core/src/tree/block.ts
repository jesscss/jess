import type { Context } from '../context.js';
import { Node, defineType, type LocationInfo, type OptionalLocation, type TreeContext } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

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

  value!: Node;

  constructor(value: Node, options?: BlockOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { type } = this.options ?? {};
    let start = type === 'square' ? '[' : '{';
    let end = type === 'square' ? ']' : '}';
    w.add(start);
    super.toTrimmedString(options);
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