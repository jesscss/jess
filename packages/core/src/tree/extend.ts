import { defineType } from './node';
import { type Context } from '../context';
import { Selector } from './selector';
import { type PrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

export const enum ExtendFlag {
  All = 1
}

export type ExtendValue = {
  /** The preceding selector */
  selector: Selector;
  /** The selector within () */
  target: Selector;
  flag?: ExtendFlag;
};
/**
 * Extends selectors
 *
 * @todo - figure out eval -- use Rules lookups
 * @note - there is some pseudo-code somewhere that smartly
 * registers selectors by a string code.
 */
export interface Extend extends Selector<ExtendValue> {
  eval(context: Context): MaybePromise<Selector>;
}

export class Extend extends Selector<ExtendValue> {
  type = 'Extend' as const;
  shortType = 'extend' as const;

  override valueOf() {
    return `:-extend(${this.value.valueOf()})`;
  }

  /** The preceding selector is the keyset */
  override get keySet() {
    return this.value.selector.keySet;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { target, selector } = this.value;
    const mark = w.mark();
    if (selector) {
      selector.toString(options);
    }
    w.add(':extend(');
    target.toString(options);
    w.add(')');
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Selector> {
    let { selector, target, flag } = this.value;
    const maybeSel = selector.eval(context);
    if (isThenable(maybeSel)) {
      return (maybeSel as Promise<Selector>).then((sel) => {
        context.treeRoot?.pendingExtends.add([target, sel, flag === ExtendFlag.All]);
        return sel;
      });
    }
    const sel = maybeSel as Selector;
    context.treeRoot?.pendingExtends.add([target, sel, flag === ExtendFlag.All]);
    return sel;
  }
}
export const extend = defineType(Extend, 'Extend');