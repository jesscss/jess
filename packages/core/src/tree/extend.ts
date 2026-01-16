import { defineType, Node } from './node';
import { type Context } from '../context';
import { Selector } from './selector';
import { Ampersand } from './ampersand';
import { Nil } from './nil';
import { type PrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, isThenable, pipe } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node';
import { syncLog } from './util/__tests__/debug-log';
import { serializeTypes } from './util/serialize-types';
import { getImplicitSelector } from './util/selector-utils';
import { Ruleset } from './ruleset';

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
    
    // DEBUG: Log when Extend.evalNode is called
    const currentFrame = context.rulesetFrames.at(-1);
    syncLog({
      location: 'Extend.evalNode',
      action: 'Starting evalNode',
      frameCount: context.rulesetFrames.length,
      currentFrameSelector: currentFrame?.selector?.valueOf(),
      target: target?.valueOf(),
      originalSelector: selector?.valueOf(),
      originalSelectorType: selector?.type
    });
    
    // If selector is undefined or set to a non-ampersand (parser set it to ruleset selector),
    // convert it to ampersand so it resolves to the ruleset's selector when evaluated
    // (the ruleset should be in the frame at this point)
    if (!selector || (selector && !isNode(selector, 'Ampersand'))) {
      // Set selector to ampersand - it will resolve to the current ruleset's selector when evaluated
      // This matches the conceptual model: .c:extend(.ext all) is like { &:extend(.ext all); } inside .c
      selector = Ampersand.create(undefined);
    }
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
        // IMPORTANT: Copy the selector to avoid it being modified later if it's a reference
        let resolvedSel: Selector = sel;
        if (isNode(sel, 'Ampersand') && sel.value.selector && !(sel.value.selector instanceof Nil)) {
          resolvedSel = sel.value.selector.copy(true);
        }
        // DEBUG: Log target structure when registering extend
        syncLog({
          location: 'Extend.evalNode',
          action: 'Registering extend (async)',
          target: target?.valueOf(),
          targetType: target?.type,
          targetSExpr: serializeTypes(target),
          extendWith: resolvedSel?.valueOf(),
          extendWithType: resolvedSel?.type,
          partial: flag === ExtendFlag.All
        });
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
    // IMPORTANT: Copy the selector to avoid it being modified later if it's a reference
    let resolvedSel: Selector = sel;
    if (isNode(sel, 'Ampersand') && sel.value.selector && !(sel.value.selector instanceof Nil)) {
      // DEBUG: Log what selector is being resolved from ampersand
      syncLog({
        location: 'Extend.evalNode',
        action: 'Resolving ampersand selector',
        ampersandStoredSelector: sel.value.selector.valueOf(),
        ampersandStoredSelectorType: sel.value.selector.type,
        ampersandStoredSelectorSExpr: serializeTypes(sel.value.selector),
        currentFrame: context.rulesetFrames.at(-1)?.selector?.valueOf(),
        currentFrameSExpr: context.rulesetFrames.at(-1)?.selector ? serializeTypes(context.rulesetFrames.at(-1)!.selector) : undefined
      });
      resolvedSel = sel.value.selector.copy(true);
    }
    // Register extend to context with extend root reference and Extend node for error reporting
    context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, this]);
    return new Nil();
  }
}
export const extend = defineType(Extend, 'Extend');