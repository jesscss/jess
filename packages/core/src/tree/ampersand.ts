import { defineType, type NodeOptions, type LocationInfo, type TreeContext } from './node';
import { Nil } from './nil';
import type { Context } from '../context';
import { SimpleSelector } from './selector-simple';
import { PseudoSelector } from './selector-pseudo';
import { isNode } from './util/is-node';
import { type Selector } from './selector';
import { atIndex } from './util/collections';

export type AmpersandValue = {
  /**
   * The only value that may exist is an anonymous value
   * This is represented as &(). Any &() will signal
   * a forced output (as well as an adjacent ident starting with
   * a dash)
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

  override toTrimmedString(): string {
    let { appendValue } = this.value;
    return appendValue !== undefined ? `&(${appendValue ?? ''})` : '&';
  }

  /** Hmm this should never return Extend */
  override async evalNode(context: Context): Promise<Selector | Nil> {
    const { appendValue } = this.value;
    if ((appendValue ?? context.opts.collapseNesting) || this.options.hoistToRoot) {
      let frame = atIndex(context.rulesetFrames, -1);
      if (frame) {
        let selector = frame.selector.copy(true);
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
        context.opts.collapseNesting = true;
        return PseudoSelector.create({ name: ':is', arg: selector });
      }
      return new Nil();
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