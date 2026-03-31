import { type Context } from '../context.js';
import { Node, defineType, type OptionalLocation, type NodeOptions, type TreeContext } from './node.js';
import { Selector } from './selector.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

export type SelectorCaptureChildData = { value: Selector };

export interface SelectorCapture extends Node<Selector, NodeOptions, SelectorCaptureChildData> {
  type: 'SelectorCapture';
  shortType: 'selcap';
  eval(context: Context): MaybePromise<Selector>;
}

/**
 * Explicit selector-capture wrapper used by parsers for selector-valued payloads
 * (e.g. Less `*[ ... ]`, Sass `selector.parse("...")`).
 */
export class SelectorCapture extends Node<Selector, NodeOptions, SelectorCaptureChildData> {
  static override childKeys = ['value'] as const;

  readonly value!: Selector;

  constructor(value: Selector, options?: NodeOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
  }

  override valueOf(): string {
    return String(this.value.valueOf());
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const value = this.value;
    w.add('*[', this);
    value.toString(options);
    w.add(']', this);
    return w.getSince(mark);
  }

  override preEval(context: Context): MaybePromise<this> {
    if (this.preEvaluated) {
      return this;
    }
    const node = this.clone() as this;
    node.preEvaluated = true;
    const applyValue = (preEvald: Selector): this => {
      if (node.value !== preEvald) {
        node.adopt(preEvald, context);
        (node as unknown as { value: Selector }).value = preEvald;
      }
      return node;
    };
    const out = this.value.preEval(context);
    if (isThenable(out)) {
      return (out as Promise<Selector>).then(applyValue);
    }
    return applyValue(out as Selector);
  }

  override evalNode(context: Context): MaybePromise<Selector> {
    const out = this.value.eval(context);
    if (isThenable(out)) {
      return (out as Promise<Selector>).then((selector) => {
        return selector;
      });
    }
    return out as Selector;
  }
}

type Params = ConstructorParameters<typeof SelectorCapture>;

export const selcap = defineType(SelectorCapture, 'SelectorCapture', 'selcap') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => SelectorCapture;
