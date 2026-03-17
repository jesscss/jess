import { Node, defineType, F_VISIBLE, F_NON_STATIC, type NodeOptions, type LocationInfo, type TreeContext } from './node.js';
import type { Context } from '../context.js';
import { Dimension } from './dimension.js';
import { type MaybePromise, pipe, tryStep } from '@jesscss/awaitable-pipe';

/**
 * The negative sign before a node
 */
export interface Negative extends Node<Node> {
  type: 'Negative';
  shortType: 'negative';
  eval(context: Context): MaybePromise<Node>;
}

export class Negative extends Node<Node> {
  static override childKeys = ['value'] as const;

  value!: Node;

  constructor(value: Node, options?: NodeOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
    // Negative operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return pipe(
      () => this.value.eval(context),
      tryStep((value: Node) => {
        if (!value.operate) {
          throw new TypeError(`Cannot operate on ${value.type}`);
        }
        return value.operate(new Dimension({ number: -1 }), '*', context);
      }, { rethrow: true })
    );
  }
}


export const negative = defineType(Negative, 'Negative');