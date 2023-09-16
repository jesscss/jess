import { Node, defineType } from './node'
import { Nil } from './nil'
import { List } from './list'
import type { Context } from '../context'
import combinate from 'combinate'

export type SequenceOptions = {
  /**
   * CSS values are typically spaced,
   * because of how they're parsed.
   */
  // spaced: boolean
}

/**
 * A continuous collection of nodes. Historically in Less,
 * these were termed "expressions", but in computer science,
 * an expression will yield a value, and a CSS value can
 * actually be a sequence of values (like for shorthand)
 */
export class Sequence<T extends Node = Node> extends Node<T[], SequenceOptions> {
  toArray() {
    return this.value.filter(n => n instanceof Node)
  }

  // constructor(
  //   value: Array<string | Node> | NodeMap,
  //   location?: LocationInfo,
  //   options?: SequenceOptions
  // ) {
  //   if (isNodeMap(value)) {
  //     super(value, location, options)
  //     return
  //   }
  //   const values = value.map(v => v.constructor === String ? new Anonymous(v) : v)
  //   super({
  //     value: values
  //   }, location)
  // }

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
  async eval(context: Context) {
    const node = this.clone()
    /** Convert all values to Nodes */
    const cast = context.cast
    const valuePromises = node.value
      .map(async n => await cast(n).eval(context))

    node.value = (await Promise.all(valuePromises) as T[])
      .filter(n => n && !(n instanceof Nil))

    let lists: Record<number, Node[]> | undefined

    node.value.forEach((n, i) => {
      if (n instanceof List) {
        if (!lists) {
          lists = {
            [i]: n.value
          }
        } else {
          lists[i] = n.value
        }
      }
    })

    if (lists) {
      /**
       * Create new sequences of the inherited type
       */
      const Class = Object.getPrototypeOf(this).constructor
      const combinations = combinate(lists)
      const returnList = new List([] as T[]).inherit(this)

      /** @todo - create :is() in selector */
      combinations.forEach(combo => {
        const expr = [...node.value]
        for (const pos in combo) {
          if (Object.prototype.hasOwnProperty.call(combo, pos)) {
            expr[pos] = combo[pos] as T
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

    /** Selectors maintain wrappers around elements */
    if (node.type !== 'Selector' && node.value.length === 1) {
      return node.value[0]
    }
    return node
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector): void {
  //   const cast = context.cast
  //   this.value.forEach(n => {
  //     const val = cast(n)
  //     val.toCSS(context, out)
  //   })
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.expr([', loc)
  //   const length = this.value.length - 1
  //   this.value.forEach((n, i) => {
  //     n.toModule(context, out)
  //     if (i < length) {
  //       out.add(', ')
  //     }
  //   })
  //   out.add('])')
  // }
}

export const seq = defineType(Sequence, 'Sequence', 'seq')
