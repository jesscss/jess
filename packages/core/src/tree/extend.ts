import { defineType } from './node';
import { type Context } from '../context';
import { Selector } from './selector';
import { type PrintOptions, getPrintOptions } from './util/print';

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
    if (selector) selector.toString(options);
    w.add(':extend(');
    target.toString(options);
    w.add(')');
    return w.getSince(mark);
  }

  override async evalNode(context: Context): Promise<Selector> {
    let { selector, target, flag } = this.value;
    selector = await selector.eval(context) as Selector;
    context.treeRoot?.pendingExtends.add([target, selector, flag === ExtendFlag.All]);
    return selector;
  }
}
export const extend = defineType(Extend, 'Extend');