import { defineType, type NodeOptions, type OptionalLocation, type TreeContext, F_AMPERSAND, F_IMPLICIT_AMPERSAND, type Node } from './node.js';
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
import { AMPERSAND_TEMPLATE_CONTENTS_REGEX } from './util/ampersand-template.js';
import { wrapParentSelectorForNestedContext } from './util/selector-utils.js';
import { getField } from './util/field-helpers.js';

const ampersandTemplateInterpolationRegex = /[$@]\{[^}]+\}/g;
const ampersandTemplateRegex = new RegExp(`^(?:${AMPERSAND_TEMPLATE_CONTENTS_REGEX.source})$`);

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

   *
   * `undefined` => plain `&`
   * `''` => `&()` root-hoist while still rendering the parent
   * `string` => `&(template)` / `&-suffix`
   * `Nil` => `&(nil)` and suppress the parent entirely
   *
   * A template without an `&` is shorthand for replacing the parent selector
   * at the same location. So `template: '-1'` means the `&-1` form.
   */
  template?: string | Nil;
  /** @deprecated Use `template` */
  appendValue?: string | Nil;

  /**
   * When set (e.g. by ruleset preEval), returns the current parent ruleset's selector ("pointer").
   * Prefer this over value.selector so extend sees the parent after it has been mutated (e.g. by extend).
   */
  selectorContainer?: {
    selector?: Selector | Nil | undefined;
    getEffectiveSelector?: (collapseNesting?: boolean, context?: Context) => Selector | Nil | undefined;
  };
};

type SelectorContainer = NonNullable<AmpersandValue['selectorContainer']>;

function getSelectorFromContainer(
  selectorContainer: SelectorContainer | undefined,
  context?: Context
): Selector | Nil | undefined {
  if (!selectorContainer) {
    return undefined;
  }
  if (typeof selectorContainer.getEffectiveSelector === 'function') {
    return selectorContainer.getEffectiveSelector(false, context);
  }
  return selectorContainer.selector;
}

/**
 * The '&' selector element
 */
export interface Ampersand {
  type: 'Ampersand';
  shortType: 'amp';
}
export class Ampersand extends SimpleSelector<{ template?: string | Nil }> {
  static override childKeys = null as null;

  template: string | Nil | undefined;

  private _storedSelector: Selector | Nil | undefined;
  private _selectorContainer: SelectorContainer | undefined;

  constructor(
    value?: AmpersandValue | string | Nil,
    options?: NodeOptions,
    location?: OptionalLocation,
    treeContext?: TreeContext
  ) {
    let finalTemplate: string | Nil | undefined;
    if (typeof value === 'string' || value instanceof Nil) {
      finalTemplate = value;
      super(value as any, options, location, treeContext);
    } else {
      finalTemplate = value?.template ?? value?.appendValue;
      super(finalTemplate as any, options, location, treeContext);
      const selectorContainer = value?.selectorContainer;
      if (selectorContainer) {
        this._selectorContainer = selectorContainer;
        this._storedSelector = getSelectorFromContainer(selectorContainer);
      }
    }
    this.template = finalTemplate;
    if (finalTemplate instanceof Nil) {
      this.adopt(finalTemplate as unknown as Node);
    }

    // Set the F_AMPERSAND flag so it bubbles up to parent selectors
    this.addFlag(F_AMPERSAND);
  }

  isPlainAmpersand(): boolean {
    return this.template === undefined;
  }

  omitsParent(): boolean {
    return isNode(this.template as Node | undefined, N.Nil);
  }

  get appendValue(): string | Nil | undefined {
    return this.template;
  }

  set appendValue(value: string | Nil | undefined) {
    this.template = value;
    if (value instanceof Nil) {
      this.adopt(value as unknown as Node);
    }
  }

  override computeKeySets(): void {
    let library = this.keySetLibrary!;
    const stored = this._storedSelector;
    const current = getSelectorFromContainer(this._selectorContainer);
    let keySet = this._keySet;
    /** Ampersands don't participate to the visible key set */
    if (!this._visibleKeySet) {
      this._visibleKeySet = library.getBitset();
    }
    if (!this._requiredKeySet) {
      this._requiredKeySet = library.getBitset();
    }
    if (!current || isNode(current, N.Nil)) {
      if (!keySet) {
        this._keySet = library.getBitset();
      }
      return;
    }
    if (!keySet || stored !== current) {
      this._keySet = current.keySet;
    }
  }

  override getKeySet(context?: Context) {
    if (!context) {
      return this.keySet;
    }

    const current = getSelectorFromContainer(this._selectorContainer, context);
    if (!current || isNode(current, N.Nil)) {
      const library = this.keySetLibrary;
      if (!library) {
        throw new Error('Selector keySet library not found');
      }
      return library.getBitset();
    }

    return current.getKeySet(context);
  }

  /**
   * Returns the current selector from the selector container (live when container is ruleset value).
   * Used by extend, serialization, and matching so nested rules see the parent after extend.
   */
  getResolvedSelector(context?: Context): Selector | Nil | undefined {
    const selector = getSelectorFromContainer(this._selectorContainer, context);
    if (selector && this.hasFlag(F_IMPLICIT_AMPERSAND)) {
      return wrapParentSelectorForNestedContext(selector as Selector);
    }
    return selector;
  }

  override valueOf(context?: Context) {
    const selector = getSelectorFromContainer(this._selectorContainer, context);
    if (selector) {
      return selector.valueOf();
    }
    return '&';
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { template } = this;
    if (template !== undefined) {
      w.add('&(');
      if (isNode(template as Node, N.Nil)) {
        w.add('nil', this);
      } else if (typeof template === 'string' && template) {
        w.add(template, this);
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
    this.keySetLibrary = context.selectorBits;
    const template = getField<string | Nil | undefined>(this, 'template', context) ?? this.template;
    const hoistToRoot = getField<boolean | undefined>(this, 'hoistToRoot', context) ?? this.hoistToRoot;
    const selectorContainer = this._selectorContainer;
    const storedSelector = getSelectorFromContainer(selectorContainer, context);
    // Check if template is defined (including empty string), or if hoistToRoot/collapseNesting is set
    if (template !== undefined || hoistToRoot || context.opts.collapseNesting) {
      // Use the stored selector if available, otherwise fall back to frame selector
      let frame = atIndex(context.rulesetFrames, -1);
      let selector = storedSelector ?? frame?.getEffectiveSelector?.(false, context) ?? frame?.get('selector');
      if (isNode(template as Node | undefined, N.Nil)) {
        const result = new Nil(undefined, undefined, undefined, this.treeContext);
        result.hoistToRoot = true;
        return result;
      }
      if (!selector) {
        return new Nil();
      }
      // Never mutate a simple parent/frame selector in-place in the collapse/hoist branch.
      // This path normalizes spacing via `pre`/`post`, and for simple selectors that can
      // alias the canonical parent selector directly.
      if (
        !isNode(selector, N.Nil)
        && !isNode(selector, N.SelectorList)
        && !isNode(selector, N.ComplexSelector)
      ) {
        selector = selector.clone(true) as Selector;
      }
      /** Remove any surrounding whitespace */
      selector.pre = undefined;
      selector.post = undefined;

      if (typeof template === 'string' && template && !isNode(selector, N.Nil)) {
        const normalizedTemplate = template.replace(ampersandTemplateInterpolationRegex, 'x');
        if (!ampersandTemplateRegex.test(normalizedTemplate)) {
          throw new SyntaxError(`Invalid ampersand template "${template}"`);
        }
        const isTemplateMerge = template.includes('&');
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
              && baseSelector.get('name') === ':is'
              && baseSelector.get('arg')
              && isNode(baseSelector.get('arg'), N.SelectorList)
            ) {
              baseSelectors.push(...(baseSelector.get('arg') as SelectorList).get('value').map(item => item as Selector));
            } else if (isNode(baseSelector, N.SelectorList)) {
              baseSelectors.push(...(baseSelector as SelectorList).get('value').map(item => item as Selector));
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
              assertValidTemplateJoin(template, value);
              return new BasicSelector(template.split('&').join(value)).inherit(baseSelector);
            });
            if (merged.length === 1) {
              return merged[0]!;
            }
            return new SelectorList(merged).inherit(baseSelector);
          };
          if (isNode(selector, N.SelectorList)) {
            const mergedItems: Selector[] = [];
            for (const item of (selector as SelectorList).get('value')) {
              const merged = mergeTemplate(item as Selector);
              if (isNode(merged, N.SelectorList)) {
                mergedItems.push(...(merged as SelectorList).get('value'));
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
                if (typeof (s as any).value === 'string') {
                  s.setData((s as any).value + template);
                  appended = true;
                  break;
                }
                throw new SyntaxError(`Cannot append "${template}" to this type of selector`);
              }
            }
            if (!appended) {
              throw new SyntaxError(`Cannot append "${template}" to this type of selector`);
            }
          };

          if (isNode(selector, N.SelectorList)) {
            (selector as SelectorList).get('value').forEach(doAppendValue);
          } else {
            doAppendValue(selector);
          }
        }
      }

      let result: Selector | Nil;
      const shouldWrapSelectorList = isNode(selector, N.SelectorList) && (hoistToRoot || template !== undefined);
      const shouldWrapComplexSelector = isNode(selector, N.ComplexSelector);

      if (shouldWrapSelectorList || shouldWrapComplexSelector) {
        result = PseudoSelector.create({ name: ':is', arg: selector });
        result.generated = true;
      } else {
        result = selector;
      }

      if (template !== undefined || shouldWrapSelectorList || shouldWrapComplexSelector || hoistToRoot) {
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
    if (!amp._selectorContainer && frame && frame.get('selector')) {
      amp._selectorContainer = frame as unknown as SelectorContainer;
    }
    return amp;
  }

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    const newNode = super.clone(deep, cloneFn) as this;
    // super.clone() for leaf nodes calls new Ampersand((this as any).value, ...).
    // Ampersand stores its data in the template instance field, not in .value,
    // so we must patch it explicitly on the clone.
    newNode.template = this.template;
    if (newNode.template instanceof Nil) {
      newNode.adopt(newNode.template as unknown as Node);
    }
    // Don't copy _selectorContainer — clones must rebind to the current eval
    // context frame (e.g. call-site for mixin clones, not definition-site).
    return newNode;
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp');
