import { Node, defineType } from './node';
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