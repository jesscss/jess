import { defineType, type NodeOptions, type LocationInfo, type TreeContext, F_AMPERSAND, F_IMPLICIT_AMPERSAND, type Node } from './node.js';
import { Nil } from './nil.js';
import type { Context } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { PseudoSelector } from './selector-pseudo.js';
import { SelectorList } from './selector-list.js';
import { BasicSelector } from './selector-basic.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type Selector } from './selector.js';
import { atIndex } from './util/collections.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { F_VISIBLE } from './node.js';
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
export interface Ampersand {
  type: 'Ampersand';
  shortType: 'amp';
}
export class Ampersand extends SimpleSelector<{ appendValue?: string }> {
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

  get appendValue() {
    return this.data.appendValue;
  }

  set appendValue(val: string | undefined) {
    this.setData('appendValue', val as any);
  }

  override get keySet() {
    const stored = this._storedSelector;
    const current = this._selectorContainer?.selector;
    if (!current || isNode(current, N.Nil)) {
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
    if (selector && isNode(selector, N.SelectorList) && this.hasFlag(F_IMPLICIT_AMPERSAND)) {
      const wrapped = PseudoSelector.create({ name: ':is', arg: selector.copy(true) as Selector });
      wrapped.generated = true;
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
    const { appendValue } = this.data;
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

  /**
   * Split a string on commas that aren't inside brackets, parens, or quotes.
   */
  private static splitTopLevelCommas(str: string): string[] {
    const items: string[] = [];
    let depth = 0;
    let inQuote: string | null = null;
    let start = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i]!;
      if (inQuote) {
        if (ch === inQuote && str[i - 1] !== '\\') {
          inQuote = null;
        }
      // eslint-disable-next-line @stylistic/quotes
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
      } else if (ch === ',' && depth === 0) {
        const item = str.slice(start, i).trim();
        if (item) {
          items.push(item);
        }
        start = i + 1;
      }
    }
    const last = str.slice(start).trim();
    if (last) {
      items.push(last);
    }
    return items;
  }

  /** Hmm this should never return Extend */
  override evalNode(context: Context): Selector | Nil {
    const { appendValue } = this.data;
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
      // Never mutate the frame selector in-place for append forms (&-foo / &()).
      if (appendValue !== undefined && !isNode(selector, N.Nil)) {
        selector = selector.clone(true) as Selector;
      }
      /** Remove any surrounding whitespace */
      selector.pre = undefined;
      selector.post = undefined;

      if (appendValue && !isNode(selector, N.Nil)) {
        const isTemplateMerge = appendValue.includes('&');
        if (isTemplateMerge) {
          const isIdentJoinChar = (char: string | undefined): boolean => {
            return !!char && /[a-zA-Z0-9_-]/.test(char);
          };
          const assertValidTemplateJoin = (template: string, replacement: string): void => {
            if (!replacement) {
              return;
            }
            let searchFrom = 0;
            while (true) {
              const idx = template.indexOf('&', searchFrom);
              if (idx === -1) {
                break;
              }
              const before = idx > 0 ? template[idx - 1] : undefined;
              const after = idx < template.length - 1 ? template[idx + 1] : undefined;
              const first = replacement[0];
              const last = replacement[replacement.length - 1];
              const invalidHeadJoin = (first === '.' || first === '#') && isIdentJoinChar(before);
              const invalidTailJoin = (last === '.' || last === '#') && isIdentJoinChar(after);
              if (invalidHeadJoin || invalidTailJoin) {
                throw new SyntaxError(`Invalid ampersand merge template "${template}" with parent selector "${replacement}"`);
              }
              searchFrom = idx + 1;
            }
          };
          const mergeTemplate = (baseSelector: Selector): Selector => {
            const baseSelectors: Selector[] = [];
            if (
              isNode(baseSelector, N.PseudoSelector)
              && baseSelector.data.name === ':is'
              && baseSelector.data.arg
              && isNode(baseSelector.data.arg, N.SelectorList)
            ) {
              baseSelectors.push(...baseSelector.data.arg.data.map(item => item as Selector));
            } else if (isNode(baseSelector, N.SelectorList)) {
              baseSelectors.push(...baseSelector.data.map(item => item as Selector));
            } else {
              // Handle raw comma-separated strings (e.g. from ~'apple, satsuma, banana, pear')
              // by splitting into individual items so the template distributes across all of them.
              const selectorStr = baseSelector.toTrimmedString();
              if (selectorStr.includes(',')) {
                const items = Ampersand.splitTopLevelCommas(selectorStr);
                for (const item of items) {
                  baseSelectors.push(new BasicSelector(item).inherit(baseSelector));
                }
              } else {
                baseSelectors.push(baseSelector);
              }
            }
            const merged = baseSelectors.map((item) => {
              const value = item.toTrimmedString();
              assertValidTemplateJoin(appendValue, value);
              return new BasicSelector(appendValue.split('&').join(value)).inherit(baseSelector);
            });
            if (merged.length === 1) {
              return merged[0]!;
            }
            return new SelectorList(merged).inherit(baseSelector);
          };
          if (isNode(selector, N.SelectorList)) {
            const mergedItems: Selector[] = [];
            for (const item of selector.data) {
              const merged = mergeTemplate(item as Selector);
              if (isNode(merged, N.SelectorList)) {
                mergedItems.push(...merged.data);
              } else {
                mergedItems.push(merged);
              }
            }
            selector = new SelectorList(mergedItems).inherit(selector);
          } else {
            selector = mergeTemplate(selector);
          }
        } else {
          let doAppendValue = (n: Selector) => {
            let appended = false;
            for (let s of n.nodes(true)) {
              /** Find the last simple selector and attempt to append */
              if (isNode(s, N.SimpleSelector)) {
                if (typeof s.data === 'string') {
                  s.setData(s.data + appendValue);
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

          if (isNode(selector, N.SelectorList)) {
            selector.data.forEach(doAppendValue);
          } else {
            doAppendValue(selector);
          }
        }
      }

      let result: Selector | Nil;
      const shouldWrapSelectorList = isNode(selector, N.SelectorList) && (context.opts.collapseNesting || this.hoistToRoot || appendValue !== undefined);
      const shouldWrapComplexSelector = isNode(selector, N.ComplexSelector);

      if (shouldWrapSelectorList || shouldWrapComplexSelector) {
        result = PseudoSelector.create({ name: ':is', arg: selector });
        // When create() is invoked from this eval path, generated is not set on the instance
        // (repro: process-leading-is test "unwraps evaled &[e] with frame * b"). Set explicitly.
        result.generated = true;
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