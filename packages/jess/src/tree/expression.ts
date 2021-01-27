import { Node, Anonymous, Nil, List } from '.'
import { LocationInfo, isNodeMap, NodeMap } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'
import combinate from 'combinate'
import { cast } from './util'

/**
 * A continuous collection of nodes
 */
export class Expression extends Node {
  value: any[]

  constructor(
    value: any[] | NodeMap,
    location?: LocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    }
    const values = value.map(v => v.constructor === String ? new Anonymous(<string>v) : v)
    super({
      value: values
    }, location)
  }

  eval(context: Context): Node {
    const node = this.clone()
    /** Convert all values to Nodes */
    node.value = node.value
      .map(n => cast(n).eval(context))
      .filter(n => n && !(n instanceof Nil))

    let lists: { [pos: number]: Node[] }

    node.value.forEach((n, i) => {
      if (n instanceof List) {
        if(!lists) {
          lists = {}
        }
        lists[i] = n.value
      }
    })

    if (lists) {
      const combinations = combinate(lists)
      const returnList = new List([]).inherit(this)
      
      combinations.forEach(combo => {
        const expr = [...node.value]
        for (let pos in combo) {
          expr[pos] = combo[pos]
        }
        returnList.value.push(new Expression(expr))
      })
      return returnList
    }


    if (node.value.length === 1) {
      return node.value[0]
    }
    return node
  }

  toCSS(context: Context, out: OutputCollector): void {
    this.value.forEach(n => {
      const val = cast(n)
      val.toCSS(context, out)
    })
  }

  toModule(context: Context, out: OutputCollector) {
    const loc = this.location
    out.add(`$J.expr([`, loc)
    const length = this.value.length - 1
    this.value.forEach((n, i) => {
      n.toModule(context, out)
      if (i < length) {
        out.add(', ')
      }
    })
    out.add(`])`)
  }
}

export const expr =
  (...args: ConstructorParameters<typeof Expression>) =>
    new Expression(...args)