import {
  defineType,
  type Node
} from './node';
import { SimpleSelector } from './selector-simple';
import { type Context } from '../context';
import { isNode } from './util/is-node';
import { Selector } from './selector';
import { type PrintOptions, getPrintOptions } from './util/print';

export type PseudoSelectorValue = {
  /**
   * The name of the pseudo-selector
   * @note - this will contain the `:` prefix,
   * to support `::before` and `::after`
   */
  name: string;
  arg?: Node;
};

/**
 * A pseudo selector
 * @see https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/Selectors/Pseudo-classes_and_pseudo-elements
 *   e.g. :hover, :focus, :active
*/
export class PseudoSelector extends SimpleSelector<PseudoSelectorValue> {
  type = 'PseudoSelector';
  shortType = 'pseudo';

  override get keySet(): Set<string> {
    if (this._keySet === undefined) {
      this._computeKeySetAndFastReject();
    }
    return this._keySet!;
  }

  protected override _computeKeySetAndFastReject(): void {
    const { name, arg } = this.value;

    // Check if this is a pseudo-selector that contains selectors
    const hasSelectorArg = arg instanceof Selector;
    const hasSelectorListArg = isNode(arg, 'SelectorList');

    if (hasSelectorArg || hasSelectorListArg) {
      const combinedKeySet = new Set<string>();

      if (hasSelectorListArg) {
        // SelectorList argument - union all selector keySets
        let combinedKeySet = new Set<string>();
        for (const selector of arg.value) {
          combinedKeySet = combinedKeySet.union(selector.keySet);
        }
        // Trust the SelectorList's canFastReject (should be false for alternatives)
        this._keySet = combinedKeySet;
        this._canFastReject = arg.canFastReject;
      } else if (hasSelectorArg) {
        // Single Selector argument - use its keySet
        this._keySet = arg.keySet;
        // Trust the selector's canFastReject
        this._canFastReject = arg.canFastReject;
      }
    } else {
      // For other pseudo-selectors (like :hover, :focus), use valueOf
      this._keySet = new Set([this.valueOf()]);
      // Other pseudo-selectors are safe for fast rejection
      this._canFastReject = true;
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { name, arg } = this.value;
    const mark = w.mark();
    w.add(name, this);
    if (arg) {
      w.add('(');
      if (isNode(arg, 'SelectorList')) {
        const last = arg.value.length - 1;
        for (let i = 0; i <= last; i++) {
          arg.value[i]!.toString(options);
          if (i < last) w.add(', ');
        }
      } else {
        arg.toString(options);
      }
      w.add(')');
    }
    return w.getSince(mark);
  }

  /**
   * @todo - This should be vastly simplifiable. For
   *
   * Also, :is()
   */
  // get keys() {
  //   let keys = this._keys
  //   if (!keys) {
  //     let { arg } = this
  //     if (arg && (arg instanceof Selector || isNode(arg, 'SelectorList'))) {
  //       if (isNode(arg, 'SelectorList')) {
  //         /**
  //          * If an :is starts with an ampersand with no eval'd selector,
  //          * it's relative, and can't be flattened.
  //          *
  //          * @note As far as I can tell, starting with a combinator
  //          * is allowed / legal for :is() and :where() but won't
  //          * actually apply to anything.
  //          */
  //         /**
  //          * Push the first selectors of the inner list to an array
  //          * at the front of the return array.
  //          */
  //         const selKeys = arg.value.map(sel => {
  //           const childKeys = sel.keys
  //           return isArray(childKeys) ? childKeys.flat(Infinity) : [childKeys]
  //         }) as string[][]
  //         const returnKeys: [string[], ...string[]] = [[]]
  //         selKeys.forEach(keys => {
  //           const [first, ...rest] = keys
  //           returnKeys[0].push(first!)
  //           returnKeys.push(...rest)
  //         })
  //         keys = returnKeys
  //       } else {
  //         keys = arg.keys
  //       }
  //       Object.defineProperty(this, '_keys', { value: keys })
  //       return keys
  //     } else {
  //       keys = this.valueOf()
  //     }
  //     Object.defineProperty(this, '_keys', { value: keys })
  //   }
  //   return keys
  // }

  override valueOf(): string {
    let valueOf = this._valueOf;
    if (!valueOf) {
      let { name, arg } = this.value;
      // For :is() with SelectorList, use valueOf() to avoid newlines

      /**
       * Normalizes :nth-child(n + 1) to match :nth-child(n+1)
       * That is, anything that doesn't hold a selector as a value
       * is, by definition, not space-sensitive.
       *
       * @todo 1n === n, 2n + 0 === 2n
       */
      valueOf = `${name}${arg ? `(${arg.valueOf()})` : ''}`;

      this._valueOf = valueOf;
    }
    return valueOf;
  }

  override async evalNode(context: Context) {
    let arg = this.value.arg;
    let node = this.maybeClone(context);
    if (!arg) {
      return node;
    }
    /** Reset parentheses "state" */
    context.parenFrames.push(false);
    arg = await arg.eval(context);
    context.parenFrames.pop();
    node.value.arg = arg;
    return node;
  }
}

// Some experiments with type narrowing
// type SelectorValue = {
//   value: ':is' | ':where'
//   arg: Selector
// }

// type PseudoFunctionValue = {
//   value: string
//   arg: Node
// }

// type GetType<T extends Array<[string, any]>> = TupleToUnion<{
//   [K in keyof T]: T[K][0] extends 'arg'
//     ? T[K][1]
//     : never
// }>

// type PseudoFunctionClass<T extends PseudoFunctionValue = PseudoFunctionValue> =
//   Class<PseudoSelector<T>, ConstructorParameters<typeof PseudoSelector<T>>>

// export const PseudoFunction = PseudoSelector as unknown as (new<const T extends Array<[string, any]>>(value: T, opts?: NodeOptions) => Omit<PseudoFunctionClass, 'arg'> & { arg: GetType<T> }) // Omit<PseudoFunctionClass, 'arg'> & GetType<T>)

// const foo = new PseudoFunction([
//   ['value', ':is'],
//   ['arg', new BasicSelector([['value', 'div']])]
// ])
// foo.arg

export const pseudo = defineType<PseudoSelectorValue, typeof PseudoSelector>(PseudoSelector, 'PseudoSelector', 'pseudo');

/**
 * Convenience function to create a :is() pseudo-selector
 * @param arg The selector that goes inside :is()
 * @returns A PseudoSelector with name ":is" and the provided selector as argument
 */
export function is(arg: Selector): PseudoSelector {
  return pseudo({
    name: ':is',
    arg: arg
  });
}