import { Node, defineType, F_VISIBLE, F_NON_STATIC, type NodeOptions, type OptionalLocation, type TreeContext } from './node.js';
import type { Context } from '../context.js';
import { Dimension } from './dimension.js';
import { type MaybePromise, pipe, tryStep } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type PrintOptions } from './util/print.js';

export type NegativeChildData = { value: Node };

/**
 * The negative sign before a node
 */
export interface Negative extends Node<Node, NodeOptions, NegativeChildData> {
  type: 'Negative';
  shortType: 'negative';
  eval(context: Context): MaybePromise<Node>;
}

export class Negative extends Node<Node, NodeOptions, NegativeChildData> {
  static override childKeys = ['value'] as const;

  /** @internal */ _value!: Node;

  constructor(value: Node, options?: NodeOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this._value = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
    // Negative operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const value = this.get('value', options.context);

    w.add('-', this);
    value.toString(options);

    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return pipe(
      () => this.get('value', context).eval(context),
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
