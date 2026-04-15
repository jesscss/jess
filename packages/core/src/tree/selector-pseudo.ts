import {
  defineType,
  type Node
} from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe } from '@jesscss/awaitable-pipe';

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
  override computeKeySets(): void {
    if (this._keySet && this._visibleKeySet && this._requiredKeySet) {
      return;
    }
    const { name, arg } = this.value;
    const library = this._requireKeySetLibrary();
    if (isNode(arg, N.Selector)) {
      arg.keySetLibrary ??= library;
      if (name === ':is') {
        this._keySet = arg.keySet;
        this._visibleKeySet = arg.visibleKeySet;
        if (isNode(arg, N.SelectorList)) {
          this._requiredKeySet = library.getBitset();
        } else {
          this._requiredKeySet = arg.requiredKeySet;
        }
      } else {
        let pos = library.add(name);
        let keySet = this._keySet = arg.keySet.clone();
        let visibleKeySet = this._visibleKeySet = arg.visibleKeySet.clone();
        keySet.set(pos, 1);
        visibleKeySet.set(pos, 1);
        this._requiredKeySet = arg.requiredKeySet.clone();
        this._requiredKeySet.set(pos, 1);
      }
    } else {
      this._keySet = library.getBitset([this.valueOf()]);
      this._visibleKeySet = this._keySet;
      this._requiredKeySet = this._keySet;
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { name, arg } = this.value;
    const mark = w.mark();
    if (this.generated && name === ':is' && arg && isNode(arg, N.SelectorList)) {
      let out = w.capture(() => arg.toString(options));
      out = out.replace(/\n\s*/g, ' ').trim();
      if (!out.includes(',')) {
        w.add(out, arg);
        return w.getSince(mark);
      }
      w.add(name, this);
      w.add('(');
      w.add(out, arg);
      w.add(')');
      return w.getSince(mark);
    }
    w.add(name, this);
    if (arg) {
      w.add('(');
      if (isNode(arg, N.SelectorList)) {
        let out = w.capture(() => arg.toString(options));
        out = out.replace(/\n\s*/g, ' ').trim();
        w.add(out, arg);
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
  //     if (arg && (arg instanceof Selector || isNode(arg, N.SelectorList))) {
  //       if (isNode(arg, N.SelectorList)) {
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

  override evalNode(context: Context): MaybePromise<PseudoSelector> {
    attachSelectorBitLibrary(this, context.selectorBits);
    const currentArg = this.value.arg;
    if (!currentArg) {
      return this;
    }
    return pipe(
      () => {
        context.parenFrames.push(false);
        return currentArg.eval(context);
      },
      (evaluatedArg) => {
        context.parenFrames.pop();
        if (evaluatedArg === currentArg) {
          return this;
        }
        const node = this.clone();
        node.value.arg = evaluatedArg;
        attachSelectorBitLibrary(node, context.selectorBits);
        return node;
      }
    );
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
