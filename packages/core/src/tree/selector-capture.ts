import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { Selector } from './selector.js';
import { SelectorList } from './selector-list.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

export type SelectorCaptureValue = {
  selector: Selector | SelectorList;
};

export interface SelectorCapture extends Node<SelectorCaptureValue> {
  eval(context: Context): MaybePromise<SelectorCapture>;
}

/**
 * Explicit selector-capture wrapper used by parsers for selector-valued payloads
 * (e.g. Less `*[ ... ]`, Sass `selector.parse(\"...\")`).
 */
export class SelectorCapture extends Node<SelectorCaptureValue> {
  type = 'SelectorCapture' as const;
  shortType = 'selcap' as const;

  override valueOf(): string {
    return String(this.value.selector.valueOf());
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.value.selector.toString(options);
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<SelectorCapture> {
    const out = this.value.selector.eval(context);
    if (isThenable(out)) {
      return (out as Promise<Selector | SelectorList>).then((selector) => {
        this.value.selector = selector;
        return this;
      });
    }
    this.value.selector = out as Selector | SelectorList;
    return this;
  }
}

type Params = ConstructorParameters<typeof SelectorCapture>;

export const selcap = defineType(SelectorCapture, 'SelectorCapture', 'selcap') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => SelectorCapture;
