import {
  defineType,
  Node,
  type LocationInfo,
  type NodeOptions,
  type TreeContext
} from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Selector } from './selector.js';
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
export interface PseudoSelector {
  type: 'PseudoSelector';
  shortType: 'pseudo';
}
export class PseudoSelector extends SimpleSelector<PseudoSelectorValue> {
  static override childKeys = ['name', 'arg'] as const;

  name!: string;
  arg: Node | undefined;

  constructor(value: PseudoSelectorValue, options?: NodeOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.name = value.name;
    this.arg = value.arg;
    if (this.arg instanceof Node) {
      this.adopt(this.arg);
    }
  }

  override computeKeySets(): void {
    if (this._keySet && this._visibleKeySet && this._requiredKeySet) {
      return;
    }
    let name = this.name;
    let arg: unknown = this.arg;
    let library = this.keySetLibrary;
    if (!library) {
      throw new Error('Selector keySet library not found');
    }
    if (isNode(arg, N.Selector)) {
      if (name === ':is') {
        this._keySet = arg.keySet;
        this._visibleKeySet = arg.visibleKeySet;
        if (isNode(arg, N.SelectorList)) {
          // `:is()` with alternatives — none are individually required
          this._requiredKeySet = library.getBitset();
        } else {
          // `:is()` with a single selector — its keys are required
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
    let { name, arg } = this;
    const mark = w.mark();
    if (this.generated && name === ':is' && arg && isNode(arg, N.SelectorList)) {
      let out = w.capture(() => arg.toString(options));
      out = out.replace(/\n\s*/g, ' ').trimEnd();
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
        out = out.replace(/\n\s*/g, ' ').trimEnd();
        w.add(out, arg);
      } else {
        let out = w.capture(() => arg.toString(options));
        w.add(out.trimEnd(), arg);
      }
      w.add(')');
    }
    return w.getSince(mark);
  }

  override valueOf(): string {
    let valueOf = this._valueOf;
    if (!valueOf) {
      let { name, arg } = this;
      /**
       * Normalizes :nth-child(n + 1) to match :nth-child(n+1)
       * That is, anything that doesn't hold a selector as a value
       * is, by definition, not space-sensitive.
       *
       * @todo 1n === n, 2n + 0 === 2n
       */
      if (name === ':is' && arg && isNode(arg, N.BasicSelector | N.CompoundSelector)) {
        /** Simples and compounds can be normalized */
        valueOf = String(arg.valueOf());
      } else {
        valueOf = `${name}${arg ? `(${arg.valueOf()})` : ''}`;
      }

      this._valueOf = valueOf;
    }
    return valueOf;
  }

  override evalNode(context: Context): MaybePromise<PseudoSelector> {
    const currentArg = this.arg;
    const node = super.evalNode(context) as PseudoSelector;
    if (!currentArg) {
      return node;
    }
    return pipe(
      () => {
        context.parenFrames.push(false);
        return currentArg.eval(context);
      },
      (evaluatedArg) => {
        context.parenFrames.pop();
        node.setData('arg', evaluatedArg);
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