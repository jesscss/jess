import {
  defineType,
  type Node
  // type NodeValueArg,
  // type NodeOptions,
  // type TypedMap,
  // type NodeValueArray
} from './node'
// import { SimpleSelector } from './selector-simple'
import { type Context } from '../context'
import { Selector } from './selector'
import { isNode } from './util'
// import { BasicSelector } from './selector-basic'
// import { type Class, type TupleToUnion } from 'type-fest'

export type PseudoSelectorValue = {
  /**
   * The name of the pseudo-selector
   * @note - this will contain the `:` prefix,
   * to support `::before` and `::after`
   */
  value: string
  arg?: Node
}

const { isArray } = Array

export interface PseudoSelector<T extends PseudoSelectorValue = PseudoSelectorValue> extends Selector<T> {
  get value(): string
  set value(v: string)
}

/**
 * A pseudo selector
 * @see https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/Selectors/Pseudo-classes_and_pseudo-elements
 *   e.g. :hover, :focus, :active
*/
export class PseudoSelector<T extends PseudoSelectorValue = PseudoSelectorValue> extends Selector<T> {
  get arg(): PseudoSelectorValue['arg'] {
    return this.data.get('arg')
  }

  set arg(v: PseudoSelectorValue['arg']) {
    this.data.set('arg', v)
  }

  toTrimmedString() {
    let { value, arg } = this
    return `${value}${arg ? `(${arg})` : ''}`
  }

  get keys() {
    let keys = this._keys
    if (!keys) {
      let { arg } = this
      if (arg && (arg instanceof Selector || isNode(arg, 'SelectorList'))) {
        if (isNode(arg, 'SelectorList')) {
          /**
           * If an :is starts with an ampersand with no eval'd selector,
           * it's relative, and can't be flattened.
           *
           * @note As far as I can tell, starting with a combinator
           * is allowed / legal for :is() and :where() but won't
           * actually apply to anything.
           */
          if (!relative) {
            /**
             * Push the first selectors of the inner list to an array
             * at the front of the return array.
             */
            const selKeys = arg.value.map(sel => {
              const childKeys = sel.keys
              return isArray(childKeys) ? childKeys.flat(Infinity) : [childKeys]
            }) as string[][]
            const returnKeys: [string[], ...string[]] = [[]]
            selKeys.forEach(keys => {
              const [first, ...rest] = keys
              returnKeys[0].push(first!)
              returnKeys.push(...rest)
            })
            keys = returnKeys
          } else {
            keys = this.valueOf()
          }
        } else if (!relative) {
          keys = arg.keys
        } else {
          keys = this.valueOf()
        }
        Object.defineProperty(this, '_keys', { value: keys })
        return keys
      } else {
        keys = this.valueOf()
      }
      Object.defineProperty(this, '_keys', { value: keys })
    }
    return keys
  }

  valueOf() {
    let valueOf = this._value
    if (!valueOf) {
      let { value, arg } = this
      if (arg && arg instanceof Selector) {
        if (value === ':is') {
          valueOf = arg.valueOf()
        } else {
          valueOf = `${value}(${arg.valueOf()})`
        }
      } else {
        /**
         * Normalizes :nth-child(n + 1) to match :nth-child(n+1)
         * That is, anything that doesn't hold a selector as a value
         * is, by definition, not space-sensitive.
         */
        valueOf = `${value}${arg ? `(${arg.toTrimmedString().replace(/\s+/, '')})` : ''}`
      }
      Object.defineProperty(this, '_value', { value: valueOf })
    }
    return valueOf
  }

  async eval(context: Context) {
    return await this.evalIfNot(context, async () => {
      let { arg } = this
      let node = this.clone()
      if (!arg) {
        return node
      }
      let canOperate = context.canOperate
      /** Reset parentheses "state" */
      context.canOperate = false
      arg = await arg.eval(context)
      context.canOperate = canOperate
      node.arg = arg
      return node
    })
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

export const pseudo = defineType<PseudoSelectorValue, typeof PseudoSelector>(PseudoSelector, 'PseudoSelector', 'pseudo')