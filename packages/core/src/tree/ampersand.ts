import { defineType, type NodeOptions, type LocationInfo, type TreeContext, F_AMPERSAND, F_IMPLICIT_AMPERSAND } from './node.js';
import { Nil } from './nil.js';
import type { Context } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { PseudoSelector } from './selector-pseudo.js';
import { isNode } from './util/is-node.js';
import { type Selector } from './selector.js';
import { SelectorList } from './selector-list.js';
import { ComplexSelector } from './selector-complex.js';
import { atIndex } from './util/collections.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { F_VISIBLE } from './node.js';
import { syncLog } from './util/__tests__/debug-log.js';

export type AmpersandValue = {
  /**
   * The only value that may exist is an anonymous value
   * This is represented as &(). Any &() will signal
   * a forced output (as well as an adjacent ident starting with
   * a dash or numbers)
   *
   * @example
     .rule {
       &-foo {
         color: red;
       }
     }
     // output:
     .rule-foo {
       color: red;
     }

     .rule {
       &(-foo) {
         color: red;
       }
     }
     // output:
     .rule-foo {
       color: red;
     }

    .rule {
       &.foo {
         color: red;
       }
     }
     // output:
     .rule {
       &.foo {
         color: red;
       }
     }

     .rule {
       &().foo {
         color: red;
       }
     }
     // output:
     .rule.foo {
       color: red;
     }

   */
  /** Set to an empty string to hoist to root */
  appendValue?: string;
  /** The evaluated selector */
  selector?: Selector | Nil;
};

/**
 * The '&' selector element
 */
export class Ampersand extends SimpleSelector<AmpersandValue> {
  override type = 'Ampersand' as const;
  shortType = 'amp' as const;

  constructor(
    value?: AmpersandValue | string,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    const finalValue: AmpersandValue = {};
    if (typeof value === 'string') {
      finalValue.appendValue = value;
    } else if (value) {
      finalValue.appendValue = value.appendValue;
      finalValue.selector = value.selector;
    }
    super(finalValue, options, location, treeContext);
    // Set the F_AMPERSAND flag so it bubbles up to parent selectors
    this.addFlag(F_AMPERSAND);
  }

  override get keySet() {
    if (this._keySet === undefined) {
      this._computeKeySetAndFastReject();
    }
    return this._keySet!;
  }

  /** The keys of an ampersand are the keys of the selector it contains */
  protected override _computeKeySetAndFastReject(): void {
    const { selector } = this.value;
    if (selector && 'keySet' in selector) {
      this._keySet = selector.keySet;
      // For visibleKeySet, if this ampersand has a selector value, it's an implicit ampersand
      // (added by getImplicitSelector). For indexing purposes, we want to exclude implicit ampersands
      // regardless of visibility, so always set visibleKeySet to empty when there's a selector value
      if (this.hasFlag(F_VISIBLE) && !selector) {
        // Only include visibleKeySet if visible AND no selector value (explicit ampersand)
        this._visibleKeySet = new Set();
      } else {
        // Implicit ampersand (has selector value) or invisible - exclude from visibleKeySet
        this._visibleKeySet = new Set();
      }
      this._canFastReject = selector.canFastReject;
      return;
    }
    this._keySet = new Set(['&']);
    this._visibleKeySet = new Set();
  }

  override valueOf() {
    const { selector } = this.value;
    if (selector) {
      return selector.valueOf();
    }
    return '&';
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { appendValue } = this.value;
    if (appendValue) {
      w.add('&(');
      if (appendValue) {
        w.add(appendValue, this);
      }
      w.add(')');
    } else {
      w.add('&', this);
    }
    return w.getSince(mark);
  }

  /** Hmm this should never return Extend */
  override evalNode(context: Context): Selector | Nil {
    const { appendValue, selector: storedSelector } = this.value;
    // Check if appendValue is defined (including empty string), or if hoistToRoot/collapseNesting is set
    if (appendValue !== undefined || this.hoistToRoot || context.opts.collapseNesting) {
      // Use the stored selector if available, otherwise fall back to frame selector
      let frame = atIndex(context.rulesetFrames, -1);
      let selector = storedSelector ? storedSelector.copy(true) : frame?.selector?.copy(true);
      if (!selector) {
        return new Nil();
      }
      /** Remove any surrounding whitespace */
      selector.pre = undefined;
      selector.post = undefined;

      if (appendValue && !isNode(selector, 'Nil')) {
        let doAppendValue = (n: Selector) => {
          let appended = false;
          for (let s of n.nodes(true)) {
            /** Find the last simple selector and attempt to append */
            if (isNode(s, 'SimpleSelector')) {
              if (typeof s.value === 'string') {
                s.value += appendValue;
                appended = true;
                break;
              }
              throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`);
            }
          }
          if (!appended) {
            throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`);
          }
        };

        if (isNode(selector, 'SelectorList')) {
          selector.value.forEach(doAppendValue);
        } else {
          doAppendValue(selector);
        }
      }

      let result: Selector | Nil;
      const shouldWrapSelectorList = isNode(selector, 'SelectorList') && (context.opts.collapseNesting || this.hoistToRoot || appendValue !== undefined);
      const shouldWrapComplexSelector = isNode(selector, 'ComplexSelector');

      if (shouldWrapSelectorList || shouldWrapComplexSelector) {
        result = PseudoSelector.create({ name: ':is', arg: selector });
      } else {
        result = selector;
      }

      // If we're appending (e.g. `&-1`), we must hoist this selector out of its parent frames
      // because it materially changes the inherited selector.
      if (appendValue !== undefined) {
        result.hoistToRoot = true;
      }
      // Only set hoistToRoot if we actually wrapped or if it was already set
      if (shouldWrapSelectorList || shouldWrapComplexSelector || this.hoistToRoot) {
        result.hoistToRoot = true;
      }
      return result;
    }

    const amp: Ampersand = this.maybeClone(context);
    let frame = atIndex(context.rulesetFrames, -1);
    /**
     * Attach the current context selector if we need it later, for extends and such.
     * The frame is constant, so we can use the selector directly.
     * BUT: If the ampersand already has a stored selector (from getImplicitSelector),
     * preserve it instead of overwriting with the frame selector.
     */
    // DEBUG: Track ampersand evaluation for extend selectors
    const hasStoredSelector = !!amp.value.selector;
    const frameSelectorStr = frame?.selector?.toString();
    const storedSelectorStr = amp.value.selector?.toString();
    const originalStoredSelector = amp.value.selector;

    // CRITICAL: Only set frame selector if there's no stored selector
    // The stored selector (from getImplicitSelector) should ALWAYS take precedence
    // This ensures extends inside nested rulesets get the correct parent selector
    if (!amp.value.selector && frame && frame.selector) {
      amp.value.selector = frame.selector;
    } else if (amp.value.selector) {
    }
    return amp;
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp');