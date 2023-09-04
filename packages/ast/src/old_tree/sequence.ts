import type { LocationInfo, NodeMap } from './node'
import { Node, isNodeMap } from './node'
import { Anonymous } from './anonymous'
import { Nil } from './nil'
import { List } from './list'
import type { Context } from '../context'
import type { OutputCollector } from '../output'
import combinate from 'combinate'

export type SequenceOptions = {
  /**
   * CSS values are typically spaced,
   * because of how they're parsed.
   */
  spaced: boolean
}
/**
 * A continuous collection of nodes
 */
export class Sequence extends Node {
  value: Node[]

  toArray() {
    return this.value
  }

  constructor(
    value: Array<string | Node> | NodeMap,
    location?: LocationInfo,
    options?: SequenceOptions
  ) {
    if (isNodeMap(value)) {
      super(value, location, options)
      return
    }
    const values = value.map(v => v.constructor === String ? new Anonymous(v) : v)
    super({
      value: values
    }, location)
  }

  /**
   * During evaluation of sequences,
   * Jess may find values that are lists.
   *
   * In this case, we need to create a single
   * list that contains members of the expanded lists.
   *
   * @todo - If this is a selector sequence, and we've
   *         evaluated an expression to an inner sequence,
   *         then we should be inserting white-space combinators?
   */
  eval(context: Context): Node {
    const node = this.clone()
    /** Convert all values to Nodes */
    const cast = context.cast
    node.value = node.value
      .map(n => cast(n).eval(context))
      .filter(n => n && !(n instanceof Nil))

    let lists: Record<number, Node[]> | undefined

    node.value.forEach((n, i) => {
      if (n instanceof List) {
        if (!lists) {
          lists = {}
        }
        lists[i] = n.value
      }
    })

    if (lists) {
      /**
       * Create new sequences of the inherited type
       */
      const Class = Object.getPrototypeOf(this).constructor
      const combinations = combinate(lists)
      const returnList = new List([]).inherit(this)

      combinations.forEach(combo => {
        const expr = [...node.value]
        for (const pos in combo) {
          if (Object.prototype.hasOwnProperty.call(combo, pos)) {
            expr[pos] = combo[pos]
          }
        }
        returnList.value.push(new Class(expr))
      })
      /**
       * If the created list has a length of 1,
       * then it's still a sequence, in which
       * case we can return the first value
       */
      if (returnList.value.length === 1) {
        return returnList.value[0] as typeof Class
      }
      return returnList
    }

    if (node.value.length === 1) {
      return node.value[0]
    }
    return node
  }

  toCSS(context: Context, out: OutputCollector): void {
    const cast = context.cast
    this.value.forEach(n => {
      const val = cast(n)
      val.toCSS(context, out)
    })
  }

  toModule(context: Context, out: OutputCollector) {
    const loc = this.location
    out.add('$J.expr([', loc)
    const length = this.value.length - 1
    this.value.forEach((n, i) => {
      n.toModule(context, out)
      if (i < length) {
        out.add(', ')
      }
    })
    out.add('])')
  }
}
Sequence.prototype.type = 'Sequence'
Sequence.prototype.shortType = 'seq'

export const seq =
  (...args: ConstructorParameters<typeof Sequence>) =>
    new Sequence(...args)