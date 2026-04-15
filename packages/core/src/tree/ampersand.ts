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
import { WARN, toDiagnostic } from '../jess-error.js';
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

const isSingleAmpersandWrapper = (node: Node | undefined): boolean => {
  if (isNode(node, N.Ampersand)) {
    return true;
  }
  if (isNode(node, N.ComplexSelector) || isNode(node, N.CompoundSelector)) {
    return node.value.length === 1 && isNode(node.value[0], N.Ampersand);
  }
  return false;
};

/**
 * The '&' selector element
 */
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

  override computeKeySets(): void {
    let library = this.keySetLibrary;
    if (!library) {
      library = this._requireKeySetLibrary();
    }
    const stored = this._storedSelector;
    const current = this._selectorContainer?.selector;
    /** Ampersands don't participate to the visible key set */
    if (!this._visibleKeySet) {
      this._visibleKeySet = library.getBitset();
    }
    if (!this._requiredKeySet) {
      this._requiredKeySet = library.getBitset();
    }
    if (!current || isNode(current, N.Nil)) {
      if (!this._keySet) {
        this._keySet = library.getBitset();
      }
      return;
    }
    if ((current as Selector).isSelector && !(current as Selector).keySetLibrary) {
      (current as Selector).keySetLibrary = library;
    }
    if (!this._keySet || stored !== current) {
      this._keySet = current.keySet;
    }
  }

  override getKeySet(context?: Context) {
    if (!context) {
      return this.keySet;
    }

    const current = this._selectorContainer?.selector;
    if (!current || isNode(current, N.Nil)) {
      const library = this.keySetLibrary;
      if (!library) {
        return this._requireKeySetLibrary().getBitset();
      }
      return library.getBitset();
    }

    return current.getKeySet(context);
  }

  /**
   * Returns the raw stored container selector (without any `:is()` wrapping).
   * Used by extend-walk to peek at the container parent for "within-ampersand"
   * matching. Prefer `getResolvedSelector()` when you want the serialization
   * view (SelectorList gets wrapped for implicit-& use).
   */
  getStoredSelector(): Selector | Nil | undefined {
    return this._storedSelector ?? this._selectorContainer?.selector;
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
    const { appendValue } = this.value;
    if (appendValue) {
      w.add('&(');
      w.add(appendValue, this);
      w.add(')');
    } else if (options.collapseNesting && options.composedSelectorStack?.length) {
      // Temporarily pop the top so any nested Ampersand inside the parent
      // resolves to the grandparent (not self — which would infinite-loop).
      const parent = options.composedSelectorStack.pop()!;
      try {
        if (options.ampersandFirst !== false) {
          parent.toString(options);
        } else {
          w.add(':is(');
          parent.toString(options);
          w.add(')');
        }
      } finally {
        options.composedSelectorStack.push(parent);
      }
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
    this.keySetLibrary = context.selectorBits;
    const { appendValue } = this.value;
    const selectorContainer = this._selectorContainer;
    const storedSelector = selectorContainer?.selector;
    if (appendValue !== undefined || this.hoistToRoot) {
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
              && baseSelector.value.name === ':is'
              && baseSelector.value.arg
              && isNode(baseSelector.value.arg, N.SelectorList)
            ) {
              baseSelectors.push(...baseSelector.value.arg.value.map(item => item as Selector));
            } else if (isNode(baseSelector, N.SelectorList)) {
              baseSelectors.push(...baseSelector.value.map(item => item as Selector));
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
            for (const item of selector.value) {
              const merged = mergeTemplate(item as Selector);
              if (isNode(merged, N.SelectorList)) {
                mergedItems.push(...merged.value);
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
                if (typeof s.value === 'string') {
                  s.set(null, s.value + appendValue);
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
            selector.value.forEach(doAppendValue);
          } else {
            doAppendValue(selector);
          }
        }
      }

      // No `:is()` wrapping here: for the append/hoist case, the result is
      // the new top-level selector (marked hoistToRoot so composeSelector
      // won't re-prepend the parent). A SelectorList or ComplexSelector
      // result renders correctly on its own at the top level.
      const result: Selector | Nil = selector;
      if (appendValue !== undefined || this.hoistToRoot) {
        result.hoistToRoot = true;
      }
      return result;
    }

    let frame = atIndex(context.rulesetFrames, -1);
    let amp: Ampersand = this;
    /**
     * Attach the current context selector if we need it later, for extends and such.
     * The frame is constant, so we can use the selector directly.
     * If the ampersand already has a stored selector (from getImplicitSelector),
     * preserve it instead of overwriting with the frame selector.
     */
    if (!amp._selectorContainer && frame && frame.selector) {
      amp = this.clone(false) as Ampersand;
      amp._selectorContainer = frame;
    } else if (!amp._selectorContainer) {
      const parentSelector = amp.parent;
      const isBareWrapperAmp = isSingleAmpersandWrapper(parentSelector);
      if (!isBareWrapperAmp) {
        const file = amp.treeContext?.file;
        const selectorText = String(amp.parent?.valueOf?.() ?? '&');
        context.warnings.push(toDiagnostic(WARN.parentlessAmpersand({
          ctx: file ? { file } : undefined,
          filePath: file?.fullPath,
          line: amp.location?.[1],
          column: amp.location?.[2],
          meta: { selector: selectorText }
        })));
      }
      return new Nil();
    }
    return amp;
  }

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    const newNode = super.clone(deep, cloneFn) as this;
    if (this._selectorContainer) {
      newNode._selectorContainer = this._selectorContainer;
    }
    if (this._storedSelector) {
      newNode._storedSelector = this._storedSelector;
    }
    return newNode;
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp');
