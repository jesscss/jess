import { Node, List, Cast } from '.'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * A function call
 */
export class Call extends Node {
  name: string
  value: Node
  ref: Function

  eval(context: Context) {
    let ref: Function
    try {
      /** Try to get a function reference in the current scope */
      ref = this.ref()
    } catch(e) {
      /** We didn't find it, so output as CSS */
      return this
    }
    const value = this.value
    let args: Node[]
    if (value instanceof List) {
      args = value.value
    } else {
      args = [value]
    }
    const returnVal = ref.call(context, ...args)
    const node = new Cast(returnVal)
    return node.eval(context)
  }

  toCSS(context: Context, out: OutputCollector) {
    out.add(`${this.name}(`, this.location)
    this.value.toCSS(context, out)
    out.add(')')
  }

  toModule(context: Context, out: OutputCollector) {
    const name = this.name
    out.add(`_J.call({\n`, this.location)
    context.indent++
    let pre = context.pre
    out.add(`${pre}name: ${JSON.stringify(name)},\n`)
    out.add(`${pre}value: `)
    this.value.toModule(context, out)
    out.add(`,\n`)
    out.add(`${pre}ref: () => ${name},\n`)
    context.indent--
    pre = context.pre
    out.add(`${pre}})\n`)
  }
}

export const call =
  (...args: ConstructorParameters<typeof Call>) => new Call(...args)