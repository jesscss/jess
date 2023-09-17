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
 * @todo - replace with something more like Operation?
 */
export class Expression extends Node {
  // toArray() {
  //   return this.value.filter(node => node && !(node instanceof WS))
  // }

  // constructor(
  //   value: any[] | NodeMap,
  //   location?: LocationInfo
  // ) {
  //   if (isNodeMap(value)) {
  //     super(value, location)
  //     return
  //   }
  //   let values = value.map(v => v.constructor === String ? new Anonymous(v as string) : v)
  //   super({
  //     value: values
  //   }, location)
  // }

  /**
   * This was replaced by Sequence
   * @todo - rewrite all of this
  */
  async eval(context: Context): Promise<Node> {
    let node = this.clone()
    /** Convert all values to Nodes */
    let cast = context.cast
    node.value = node.value
      .map(async n => await cast(n).eval(context))
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
      let Clazz = Object.getPrototypeOf(this).constructor
      let combinations = combinate(lists)
      let returnList = new List([]).inherit(this)

      combinations.forEach(combo => {
        let expr = [...node.value]
        for (let pos in combo) {
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