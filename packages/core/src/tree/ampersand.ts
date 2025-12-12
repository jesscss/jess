import { defineType, type NodeOptions, type LocationInfo, type TreeContext, F_AMPERSAND } from './node';
import { Nil } from './nil';
import type { Context } from '../context';
import { SimpleSelector } from './selector-simple';
import { PseudoSelector } from './selector-pseudo';
import { isNode } from './util/is-node';
import { type Selector } from './selector';
import { atIndex } from './util/collections';
import { type PrintOptions, getPrintOptions } from './util/print';

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
      this._canFastReject = selector.canFastReject;
      return;
    }
    this._keySet = new Set(['&']);
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
    if (appendValue !== undefined) {
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
    if ((appendValue ?? context.opts.collapseNesting) || this.options.hoistToRoot) {
      // Use the stored selector if available, otherwise fall back to frame selector
      let selector = storedSelector ? storedSelector.copy(true) : atIndex(context.rulesetFrames, -1)?.selector.copy(true);
      // #region agent log
      if (selector) {
        const resolvedSelector = selector.valueOf();
        const isResolvingToChips = resolvedSelector === '.chips' || resolvedSelector?.endsWith('.chips');
        if (isResolvingToChips) {
          const topFrame = atIndex(context.rulesetFrames, -1);
          const topFrameSelector = topFrame?.selector?.valueOf();
          const framesInfo = context.rulesetFrames.map((f, i) => ({
            index: i,
            selector: f.selector?.valueOf(),
            rulesetIndex: f.index
          }));
          const { appendFileSync } = require('node:fs');
          const { join } = require('node:path');
          const logPath = join(__dirname, '../../../../.cursor/debug.log');
          appendFileSync(logPath, JSON.stringify({
            location: 'ampersand.ts:140',
            message: 'Ampersand resolving to .chips',
            data: {
              resolvedSelector,
              topFrameSelector,
              storedSelector: storedSelector?.valueOf(),
              framesInfo,
              rulesetFramesLength: context.rulesetFrames.length,
              note: 'tracking if ampersand resolves to .chips causing duplicate'
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'H'
          }) + '\n');
        }
      }
      // #endregion
      if (!selector) {
        return new Nil();
      }

      if (appendValue && !isNode(selector, 'Nil')) {
        let doAppendValue = (n: Selector) => {
          for (let s of n.nodes(true)) {
            /** Find the last simple selector and attempt to append */
            if (isNode(s, 'SimpleSelector')) {
              if (typeof s.value === 'string') {
                s.value += appendValue;
                break;
              }
              throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`);
            }
          }
        };

        if (isNode(selector, 'SelectorList')) {
          selector.value.forEach(doAppendValue);
        } else {
          doAppendValue(selector);
        }
      }

      // Wrap in :is() if the selector is a list (has commas) or a complex selector (has combinators)
      if (isNode(selector, 'SelectorList') || isNode(selector, 'ComplexSelector')) {
        return PseudoSelector.create({ name: ':is', arg: selector });
      } else {
        return selector;
      }
    }

    const amp: Ampersand = this.maybeClone(context);
    let frame = atIndex(context.rulesetFrames, -1);
    /**
     * Attach a pointer to the current context selector,
     * if we need it later, for extends and such.
     */
    if (frame) {
      amp.value.selector = frame.selector;
    }
    return amp;
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp');