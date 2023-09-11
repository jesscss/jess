import type { LocationInfo, NodeMap } from './node'
import { Node, isNodeMap } from './node'
import { Anonymous } from './anonymous'
import { Nil } from './nil'
import { List } from './list'
// import { WS } from './comment'
import type { Context } from '../context'
import type { OutputCollector } from '../output'
import combinate from 'combinate'

/**
 * @todo - replace with something more like Operation
 */
export class Expression extends Node {
  value: any[]

  toArray() {
    return this.value.filter(node => node && !(node instanceof WS))
  }

  constructor(
    value: any[] | NodeMap,
    location?: LocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    }
    const values = value.map(v => v.constructor === String ? new Anonymous(v as string) : v)
    super({
      value: values
    }, location)
  }

  eval(context: Context): Node {
    const node = this.clone()
    /** Convert all values to Nodes */
    const cast = context.cast
    node.value = node.value
      .map(n => cast(n).eval(context))
      .filter(n => n && !(n instanceof Nil))

    let lists: Record<number, Node[]>

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
       * Create new expressions of the inherited type
       */
      const Clazz = Object.getPrototypeOf(this).constructor
      const combinations = combinate(lists)
      const returnList = new List([]).inherit(this)

      combinations.forEach(combo => {
        const expr = [...node.value]
        for (const pos in combo) {
          if (Object.prototype.hasOwnProperty.call(combo, pos)) {
            expr[pos] = combo[pos]
          }
        }
        returnList.value.push(new Clazz(expr))
      })
      if (returnList.value.length === 1) {
        return returnList.value[0] as typeof Clazz
      }
      return returnList
    }

    if (node.value.length === 1) {
      return node.value[0]
    }
    return node
  }

  /** @todo - move to visitors */
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
Expression.prototype.type = 'Expression'

export const expr =
  (...args: ConstructorParameters<typeof Expression>) =>
    new Expression(...args)