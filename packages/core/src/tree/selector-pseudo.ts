import {
  defineType,
  type Node
} from './node'
import { SimpleSelector } from './selector-simple'
import { type Context } from '../context'
import { isNode } from './util'

export type PseudoSelectorValue = {
  /**
   * The name of the pseudo-selector
   * @note - this will contain the `:` prefix,
   * to support `::before` and `::after`
   */
  name: string
  arg?: Node
}

const { isArray } = Array

/**
 * A pseudo selector
 * @see https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/Selectors/Pseudo-classes_and_pseudo-elements
 *   e.g. :hover, :focus, :active
*/
export class PseudoSelector extends SimpleSelector<PseudoSelectorValue> {
  toTrimmedString() {
    let { name, arg } = this.value
    let argString = ''
    if (arg) {
      if (isNode(arg, 'SelectorList')) {
        argString = `(${arg.value.map(v => v.toString()).join(', ')})`
      } else {
        argString = `(${arg.toString()})`
      }
    }
    return `${name}${argString}`
  }

  /**
   * @todo - This should be vastly simplifiable. For
   *
   * Also, :is()
   */
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
          keys = arg.keys
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
    let valueOf = this._valueOf
    if (!valueOf) {
      let value = this.data.get('name')
      let arg = this.data.get('arg')
      /** Simplify wrapped :is when it can be */
      if (
        value === ':is'
        && (isNode(arg, 'CompoundSelector') || arg instanceof SimpleSelector)
      ) {
        return arg.valueOf()
      }
      /**
       * Normalizes :nth-child(n + 1) to match :nth-child(n+1)
       * That is, anything that doesn't hold a selector as a value
       * is, by definition, not space-sensitive.
       *
       * @todo 1n === n, 2n + 0 === 2n
       */
      valueOf = `${value}${arg ? `(${arg.toTrimmedString().replace(/\s+/, '')})` : ''}`
      this._valueOf = valueOf
    }
    return valueOf
  }

  async eval(context: Context) {
    return await this.evalIfNot(context, async () => {
      let arg = this.data.get('arg')
      let node = this.clone()
      if (!arg) {
        return node
      }
      let canOperate = context.canOperate
      /** Reset parentheses "state" */
      context.canOperate = false
      arg = await arg.eval(context)
      context.canOperate = canOperate
      node.data.set('arg', arg)
      return node
    })
  }
}

PseudoSelector.prototype.isSelector = true

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