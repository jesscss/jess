import { defineType } from './node';
import { type Context } from '../context';
import { Selector } from './selector';

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
    return `:extend(${this.value.valueOf()})`;
  }

  /** The preceding selector is the keyset */
  get keySet() {
    return this.value.selector.keySet;
  }

  override toTrimmedString(depth?: number | undefined): string {
    let { target, selector } = this.value;
    let output = selector ? `${selector}` : '';
    output += `:extend(${target})`;
    return output;
  }

  override async evalNode(context: Context): Promise<Selector> {
    let { selector, target, flag } = this.value;
    selector = await selector.eval(context) as Selector;
    context.treeRoot?.pendingExtends.add([target, selector, flag === ExtendFlag.All]);
    return selector;
  }
}
export const extend = defineType(Extend, 'Extend');