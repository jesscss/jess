import { defineType, Node } from './node';
import { type Context } from '../context';
import { Selector } from './selector';
import { Ampersand } from './ampersand';
import { type PrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

export const enum ExtendFlag {
  /** Sass and Jess default */
  All = 0,
  /** Less default - must not be a partial selector match */
  Exact = 1
}

export type ExtendValue = {
  /** The current selector. By default is `&` */
  selector?: Selector;
  /** The target to extend */
  target: Selector;
  flag?: ExtendFlag;
};
/**
 * Extends selectors - parsed by Less as an independent statement
 * at the beginning of rules.
 *
 * @todo - figure out eval -- use Rules lookups
 * @note - there is some pseudo-code somewhere that smartly
 * registers selectors by a string code.
 */
export interface Extend extends Node<ExtendValue> {
  eval(context: Context): MaybePromise<Selector>;
}

export class Extend extends Node<ExtendValue> {
  type = 'Extend' as const;
  shortType = 'extend' as const;
  override state = 0b0000;

  override valueOf() {
    return `$extend ${this.value.target.valueOf()}`;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { target, selector, flag } = this.value;
    const mark = w.mark();
    if (selector) {
      selector.toString(options);
    }
    w.add('$extend ');
    target.toString(options);
    if (flag === ExtendFlag.Exact) {
      w.add(' !exact');
    }
    w.add(';');
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Selector> {
    let { selector, target, flag } = this.value;
    if (!selector) {
      selector = Ampersand.create(undefined);
    }
    // Get current extend root from registry stack
    const extendRoot = context.extendRoots.getCurrentExtendRoot();
    if (!extendRoot) {
      // No extend root available - this shouldn't happen, but handle gracefully
      // Fall back to evaluating selector without registering extend
      return selector.eval(context) as MaybePromise<Selector>;
    }

    const maybeSel = selector.eval(context);
    if (isThenable(maybeSel)) {
      return (maybeSel as Promise<Selector>).then((sel) => {
        // Register extend to context with extend root reference
        context.extends.push([target, sel, flag === ExtendFlag.All, extendRoot]);
        return sel;
      });
    }
    const sel = maybeSel as Selector;
    // Register extend to context with extend root reference
    context.extends.push([target, sel, flag === ExtendFlag.All, extendRoot]);
    return sel;
  }
}
export const extend = defineType(Extend, 'Extend');