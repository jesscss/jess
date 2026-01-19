import { defineType, Node, F_VISIBLE } from './node.js';
import { type Context } from '../context.js';
import { Selector } from './selector.js';
import { Ampersand } from './ampersand.js';
import { Nil } from './nil.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable, pipe } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { getImplicitSelector } from './util/selector-utils.js';
import { Ruleset } from './ruleset.js';
import { ComplexSelector } from './selector-complex.js';

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
    w.add('$extend');
    if (selector) {
      let out = w.capture(() => selector.toString(options)).trim();
      w.add(' ');
      w.add(out, selector);
      w.add(' ->');
    }
    let out = w.capture(() => target.toString(options)).trim();
    w.add(' ');
    w.add(out, target);
    if (flag === ExtendFlag.Exact) {
      w.add(' !exact');
    }
    w.add(';');
    return w.getSince(mark);
  }

  // Don't preEval Extend - let it be evaluated in evalNode when the ruleset is in the frame
  // This ensures the ampersand resolves to the correct ruleset selector, not the parent frame

  override evalNode(context: Context): MaybePromise<Nil> {
    let { selector, target, flag } = this.value;
    
    const currentFrame = context.rulesetFrames.at(-1);
    
    // If selector is undefined, convert it to ampersand so it resolves to the ruleset's selector
    // If selector is already set to a non-ampersand (e.g., from a bubbled extend), keep it as-is
    // The parser sets the selector correctly when bubbling extends, so we should preserve it
    if (!selector) {
      // Set selector to ampersand - it will resolve to the current ruleset's selector when evaluated
      // This matches the conceptual model: .c:extend(.ext all) is like { &:extend(.ext all); } inside .c
      // The frame selector should already be :is(.a, .b) .c (the evaluated selector from preEval)
      selector = Ampersand.create(undefined);
      // Make the ampersand visible so it's included in the selector when evaluated
      // This ensures the parent selector is properly included in the extend selector
      selector.addFlag(F_VISIBLE);
    }
    // If selector is already set (e.g., .ext7 from a bubbled extend), use it directly
    // Don't convert non-ampersand selectors to ampersand - they should be used as-is
    // Get current extend root from registry stack
    const extendRoot = context.extendRoots.getCurrentExtendRoot();
    if (!extendRoot) {
      /** Throw error? */
      return new Nil();
    }

    const maybeSel = selector.eval(context);
    if (isThenable(maybeSel)) {
      return (maybeSel as Promise<Selector | Nil>).then((sel) => {
        if (sel instanceof Nil) {
          return new Nil();
        }
        // Resolve ampersand to its stored selector if needed
        let resolvedSel: Selector = sel;
        if (isNode(sel, 'Ampersand') && sel.value.selector && !(sel.value.selector instanceof Nil)) {
          resolvedSel = sel.value.selector;
        }
        // Register extend to context with extend root reference and Extend node for error reporting
        context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, this]);
        return new Nil();
      });
    }
    const sel = maybeSel as Selector | Nil;
    if (sel instanceof Nil) {
      return new Nil();
    }
    // Resolve ampersand to its stored selector if needed
    let resolvedSel: Selector = sel;
    const wasAmpersand = isNode(sel, 'Ampersand');
    const ampersandStoredSelector = wasAmpersand ? sel.value.selector : undefined;
    if (wasAmpersand && ampersandStoredSelector && !(ampersandStoredSelector instanceof Nil)) {
      resolvedSel = ampersandStoredSelector;
    }
    // Register extend to context with extend root reference and Extend node for error reporting
    context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, this]);
    return new Nil();
  }
}
export const extend = defineType(Extend, 'Extend');