import { type Context } from '../context.js';
import { Node, defineType, type LocationInfo, type NodeOptions, type TreeContext } from './node.js';
import { Selector } from './selector.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { sessionGetField } from './util/session-helpers.js';

export interface SelectorCapture extends Node<Selector> {
  type: 'SelectorCapture';
  shortType: 'selcap';
  eval(context: Context): MaybePromise<Selector>;
}

/**
 * Explicit selector-capture wrapper used by parsers for selector-valued payloads
 * (e.g. Less `*[ ... ]`, Sass `selector.parse("...")`).
 */
export class SelectorCapture extends Node<Selector> {
  static override childKeys = ['value'] as const;

  value!: Selector;

  constructor(value: Selector, options?: NodeOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
  }

  private _getValue(context?: Context): Selector {
    return context
      ? sessionGetField<Selector>(this, 'value', context)
      : this.value;
  }

  override valueOf(): string {
    return String(this.value.valueOf());
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const value = this._getValue(options.context);
    w.add('*[', this);
    value.toString(options);
    w.add(']', this);
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Selector> {
    const out = this._getValue(context).eval(context);
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
