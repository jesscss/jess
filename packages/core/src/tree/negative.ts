import { Node, defineType } from './node';
import type { Context } from '../context';
import { Dimension } from './dimension';

/**
 * The negative sign before a node
 */
export class Negative extends Node<Node> {
  declare value: Node;
  type = 'Negative' as const;
  shortType = 'negative' as const;

  override async evalNode(context: Context): Promise<Node> {
    let value = await this.value.eval(context);
    if (!value.operate) {
      throw new TypeError(`Cannot operate on ${value.type}`);
    }
    return value.operate(new Dimension({ number: -1 }), '*', context);
  }
}

export const negative = defineType(Negative, 'Negative');