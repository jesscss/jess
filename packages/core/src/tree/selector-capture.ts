import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { Selector } from './selector.js';
import { SelectorList } from './selector-list.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

export interface SelectorCapture extends Node<Selector> {
  type: 'SelectorCapture';
  shortType: 'selcap';
  eval(context: Context): MaybePromise<Selector>;
}

/**
 * Explicit selector-capture wrapper used by parsers for selector-valued payloads
 * (e.g. Less `*[ ... ]`, Sass `selector.parse(\"...\")`).
 */
export class SelectorCapture extends Node<Selector> {
  get value() {
    return this.data;
  }

  set value(val: Selector) {
    this.data = val;
  }

  override valueOf(): string {
    return String(this.data.valueOf());
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('*[', this);
    this.data.toString(options);
    w.add(']', this);
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Selector> {
    const out = this.data.eval(context);
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
