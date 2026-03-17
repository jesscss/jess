import { type Combinator } from './combinator.js';
import { type Ampersand, Ampersand as AmpersandClass } from './ampersand.js';
import {
  defineType,
  F_VISIBLE,
  F_IMPLICIT_AMPERSAND
} from './node.js';
import type { Context } from '../context.js';
import { type Nil } from './nil.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import type { CompoundSelector } from './selector-compound.js';
import { getEntries } from './util/collections.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';

// TODO - fix later
export type ComplexSelectorComponent = SimpleSelector | CompoundSelector | Combinator | Ampersand;
// type SelectorValue = Component[]
export type ComplexSelectorValue = ComplexSelectorComponent[];

/**
 * Selectors with combinators.
 *
 * @example
 * #id > .class.class
 *
 * @note A complex selector may not always start with a selector. We also use this for a
 * relative selector, which means it may start with a combinator.
 */
export interface ComplexSelector {
  type: 'ComplexSelector';
  shortType: 'sel';
}
export class ComplexSelector extends Selector<ComplexSelectorValue> {
  static override childKeys = ['value'] as const;

  value!: ComplexSelectorValue;

  constructor(value: ComplexSelectorValue, options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.value = value;
    for (const child of value) {
      if (child instanceof Selector) {
        this.adopt(child);
      }
    }
  }

  get length() {
    return this.value.length;
  }

  /**
   * Essentially, a#id.class === a.class#id as being identical selectors,
   * so we normalize groups and combinators
   *
   */
  override valueOf() {
    if (!Array.isArray(this.value)) {
      this.setData([this.value as unknown as ComplexSelectorComponent]);
    }
    return (this._valueOf ??= this.value.map(n => n.valueOf()).join(''));
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { value } = this;
    let length = value.length;
    const mark = w.mark();
    for (let i = 0; i < length; i++) {
      let component = value[i]!;
      /** Add some combinator spacing */
      if (isNode(component, N.Combinator)) {
        /** Skip spacing if the previous node is a Nil */
        if (isNode(value[i - 1], N.Nil)) {
          continue;
        }
        let co = component.value;
        if (co !== ' ') {
          // For non-space combinators (>, +, ~, etc.), handle spacing explicitly
          // pre spacing (default to single space when no explicit pre)
          let out = w.capture(() => component.toString(options));
          /** Namespace combinator traditionally written without spacing */
          if (out !== '|') {
            w.add(` ${out.trim()} `, component);
          } else {
            w.add(out.trim(), component);
          }
        } else {
          let out = w.capture(() => component.toString(options));
          w.add(` ${out.trim()}`, component);
        }
      } else {
        let out = w.capture(() => component.toString(options));
        w.add(out.trim(), component);
      }
    }
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Selector | Nil> {
    return pipe(
      () => {
        const selector = super.evalNode(context) as ComplexSelector;
        const { value } = selector;
        const maybe = serialForEach(Array.from(getEntries(value)), ([sel, i]) => {
          const out = sel.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Selector | Nil>).then((res) => {
              selector.setData(i, res as ComplexSelectorComponent);
              return undefined;
            });
          }
          selector.setData(i, out as ComplexSelectorComponent);
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => {
            return selector;
          });
        }
        return selector;
      },
      (selector) => {
        const { value } = selector;
        if (value.length === 1) {
          const only = value[0]!.inherit(selector);
          if (selector.hoistToRoot) {
            (only as any).hoistToRoot = true;
          }
          return only;
        }
        return selector;
      }
    );
  }
  // override async evalNode(context: Context): Promise<ComplexSelector | SelectorList | Nil> {
  //   let selector: ComplexSelector = this.maybeClone(context)
  //   let elements = [...selector.value] as ComplexSelectorValue
  //   selector.value = elements

  //   let collapseNesting = context.opts.collapseNesting
  //   if (collapseNesting) {
  //     let hasAmp = elements.find(el => el instanceof Ampersand)
  //     /**
  //      * Try to evaluate all selectors as if they are prepended by `&`
  //      */
  //     if (!hasAmp && context.rulesetFrames.length > 0) {
  //       if (elements[0] instanceof Combinator) {
  //         elements.unshift(new Ampersand())
  //       } else {
  //         elements.unshift(new Ampersand(), new Combinator(' '))
  //       }
  //     }
  //   }

  //   for (let [sel, i] of getEntries(selector.value)) {
  //     selector.value[i] = await sel.eval(context) as ComplexSelectorComponent
  //   }

  //   let cleanElements = (elements: Array<Selector | Combinator | Nil>): ComplexSelectorValue => {
  //     let elementsLength = elements.length
  //     for (let i = 0; i < elementsLength; i++) {
  //       let value = elements[i]!

  //       if (
  //         i === 0
  //         && (
  //           (
  //             value instanceof ComplexSelector
  //             && value.value.length === 0
  //           )
  //           || value instanceof Nil
  //           || (collapseNesting && (value instanceof Ampersand || value instanceof Combinator))
  //         )
  //       ) {
  //         elements.shift()
  //         elementsLength -= 1
  //         i -= 1
  //       /**
  //        * @note The following two can occur because of evaluation of `&`
  //        */
  //       } else if (value instanceof ComplexSelector) {
  //         elements = elements.slice(0, i).concat(value.value).concat(elements.slice(i + 1))
  //         elementsLength += value.value.length - 1
  //       } else if (isNode(value, 'SelectorList') && elementsLength > 1) {
  //         /**
  //          * Wrap returned lists with :is(), if
  //          * there are more elements in the sequence
  //          */
  //         elements[i] = new PseudoSelector({
  //           name: ':is',
  //           arg: value
  //         })
  //       }
  //     }
  //     return elements as ComplexSelectorValue
  //     // This can/should only happen with compound selectors
  //     // elements.sort((a, b) => {
  //     //   const aVal = a instanceof BasicSelector && a.isTag ? -1 : 0
  //     //   const bVal = b instanceof BasicSelector && b.isTag ? -1 : 0
  //     //   return aVal - bVal
  //     // })
  //   }

  //   /** @todo - Selector lists can have basic selectors */
  //   if (isNode(selector, 'SelectorList')) {
  //     selector.value.forEach(sel => { (sel).value = cleanElements(sel.value) })
  //   } else {
  //     selector.value = cleanElements(selector.value)
  //   }

  //   if (elements.length === 0) {
  //     return new Nil()
  //   }
  //   return selector
  // }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.data.forEach(node => node.toCSS(context, out))
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.sel([', this.location)
  //   const length = this.data.length - 1
  //   this.data.forEach((node, i) => {
  //     node.toModule(context, out)
  //     if (i < length) {
  //       out.add(', ')
  //     }
  //   })
  //   out.add('])')
  // }
}


type SelectorParams = ConstructorParameters<typeof ComplexSelector>;

export const sel = defineType<ComplexSelectorValue>(ComplexSelector, 'ComplexSelector', 'sel') as (
  value: ComplexSelectorValue,
  options?: SelectorParams[1],
  location?: SelectorParams[2],
  treeContext?: SelectorParams[3]
) => ComplexSelector;