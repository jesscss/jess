import { defineType, type NodeOptions, type LocationInfo, type TreeContext, F_AMPERSAND, F_IMPLICIT_AMPERSAND, type Node } from './node.js';
import { Nil } from './nil.js';
import type { Context } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { PseudoSelector } from './selector-pseudo.js';
import { isNode } from './util/is-node.js';
import { type Selector } from './selector.js';
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

  /**
   * When set (e.g. by ruleset preEval), returns the current parent ruleset's selector ("pointer").
   * Prefer this over value.selector so extend sees the parent after it has been mutated (e.g. by extend).
   */
  selectorContainer?: { selector?: Selector | Nil | undefined };
};

/**
 * The '&' selector element
 */
export class Ampersand extends SimpleSelector<{ appendValue?: string }> {
  override type = 'Ampersand' as const;
  shortType = 'amp' as const;

  private _storedSelector: Selector | Nil | undefined;
  private _selectorContainer: { selector?: Selector | Nil | undefined } | undefined;

  constructor(
    value?: AmpersandValue | string,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    let finalValue: AmpersandValue = {};
    if (typeof value === 'string') {
      finalValue.appendValue = value;
      super(finalValue, options, location, treeContext);
    } else {
      finalValue = value ? { appendValue: value.appendValue } : {};
      super(finalValue, options, location, treeContext);
      const selectorContainer = value?.selectorContainer;
      if (selectorContainer) {
        this._selectorContainer = selectorContainer;
        this._storedSelector = selectorContainer?.selector;
      }
    }

    // Set the F_AMPERSAND flag so it bubbles up to parent selectors
    this.addFlag(F_AMPERSAND);
  }

  override get keySet() {
    const stored = this._storedSelector;
    const current = this._selectorContainer?.selector;
    if (!current || isNode(current, 'Nil')) {
      return new Set(['&']);
    }
    let keySet = this._keySet;
    if (!keySet || stored !== current) {
      this._computeKeySetAndFastReject();
      return this._keySet!;
    }
    return keySet;
  }

  /** The keys of an ampersand are the keys of the selector it contains */
  protected override _computeKeySetAndFastReject(): void {
    const selector = this._selectorContainer?.selector;
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

  /**
   * Returns the current selector from the selector container (live when container is ruleset value).
   * Used by extend, serialization, and matching so nested rules see the parent after extend.
   */
  getResolvedSelector(): Selector | Nil | undefined {
    const selector = this._selectorContainer?.selector;
    if (selector && isNode(selector, 'SelectorList') && this.hasFlag(F_IMPLICIT_AMPERSAND)) {
      const wrapped = PseudoSelector.create({ name: ':is', arg: selector.copy(true) as Selector });
      wrapped.generated = true;
      if (process.env.DEBUG_FIXTURE_2A === '1') {
        // #region agent log
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'extend-trace',
          hypothesisId: 'H-implicit-amp',
          location: 'ampersand.ts:getResolvedSelector',
          message: 'wrap-selectorlist-for-implicit-amp',
          data: {
            selector: selector.valueOf(),
            wrapped: wrapped.valueOf()
          },
          timestamp: Date.now()
        });
        // #endregion
      }
      return wrapped;
    }
    return selector;
  }

  override valueOf() {
    const selector = this._selectorContainer?.selector;
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
    const { appendValue } = this.value;
    const selectorContainer = this._selectorContainer;
    const storedSelector = selectorContainer?.selector;
    // Check if appendValue is defined (including empty string), or if hoistToRoot/collapseNesting is set
    if (appendValue !== undefined || this.hoistToRoot || context.opts.collapseNesting) {
      // Use the stored selector if available, otherwise fall back to frame selector
      let frame = atIndex(context.rulesetFrames, -1);
      let selector = storedSelector ?? frame?.selector;
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
      const isImplicitAmp = this.hasFlag(F_IMPLICIT_AMPERSAND);
      const shouldWrapSelectorList = isNode(selector, 'SelectorList') && (context.opts.collapseNesting || this.hoistToRoot || appendValue !== undefined);
      const shouldWrapComplexSelector = isNode(selector, 'ComplexSelector');
      if (process.env.DEBUG_FIXTURE_2A === '1' && isNode(selector, 'SelectorList')) {
        // #region agent log
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'extend-trace',
          hypothesisId: 'H-implicit-amp',
          location: 'ampersand.ts:evalNode',
          message: 'implicit-amp-selectorlist-wrap-decision',
          data: {
            selector: selector.valueOf(),
            isImplicitAmp,
            hasImplicitFlag: this.hasFlag(F_IMPLICIT_AMPERSAND),
            collapseNesting: Boolean(context.opts.collapseNesting),
            hoistToRoot: Boolean(this.hoistToRoot),
            hasAppendValue: appendValue !== undefined,
            shouldWrapSelectorList,
            shouldWrapComplexSelector
          },
          timestamp: Date.now()
        });
        // #endregion
      }

      if (shouldWrapSelectorList || shouldWrapComplexSelector) {
        result = PseudoSelector.create({ name: ':is', arg: selector });
        // When create() is invoked from this eval path, generated is not set on the instance
        // (repro: process-leading-is test "unwraps evaled &[e] with frame * b"). Set explicitly.
        result.generated = true;
        if (process.env.DEBUG_LEADING_IS_GENERATED === 'true') {
          const g = result.generated;
          syncLog({ msg: 'ampersand-after-set', generated: g });
        }
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
     * If the ampersand already has a stored selector (from getImplicitSelector),
     * preserve it instead of overwriting with the frame selector.
     */
    if (!amp._selectorContainer && frame && frame.selector) {
      amp._selectorContainer = frame;
    }
    return amp;
  }

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    const newNode = super.clone(deep, cloneFn) as this;
    if (this._selectorContainer) {
      newNode._selectorContainer = this._selectorContainer;
    }
    return newNode;
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp');