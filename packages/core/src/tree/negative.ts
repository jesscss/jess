import { Node, defineType, F_VISIBLE, F_NON_STATIC } from './node';
import type { Context } from '../context';
import { Dimension } from './dimension';
import { type MaybePromise, pipe, tryStep } from '@jesscss/awaitable-pipe';

/**
 * The negative sign before a node
 */
export interface Negative extends Node<Node> {
  eval(context: Context): MaybePromise<Node>;
}

export class Negative extends Node<Node> {
  type = 'Negative' as const;
  shortType = 'negative' as const;

  constructor(value: Node, options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
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