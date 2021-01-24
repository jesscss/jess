import { Node, List, Cast } from '.'
import type { Context } from '../context'
import type { OutputCollector } from '../output'
import { JsReservedWords } from './js-key-value'

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
      const call = this.clone()
      call.value = call.value.eval(context)
      return call
    }
    const value = this.value
    let args: Node[]
    if (value instanceof List) {
      args = value.value
    } else {
      args = [value]
    }
    /**
     * @todo
     * Like Less, allow late evaluation?
     */
    args = args.map(arg => arg.eval(context))
    const returnVal = ref.hasOwnProperty('$IS_NODE') ? ref.call(context, args[0], true) : ref.call(context, ...args)
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
    out.add(`$J.call({\n`, this.location)
    context.indent++
    let pre = context.pre
    out.add(`${pre}name: ${JSON.stringify(name)},\n`)
    out.add(`${pre}value: `)
    this.value.toModule(context, out)
    out.add(`,\n`)
    
    /**
     * @todo - in the future, get a list of imported and defined JS idents
     * to determine this part of output. For Alpha, we do a try / catch
     * on the name to determine if it's a JS function call.
     */
    if (!(JsReservedWords.includes(name)) && !(name.includes('-'))) {
      out.add(`${pre}ref: () => ${name},\n`)
    }
    context.indent--
    pre = context.pre
    out.add(`${pre}})\n`)
  }
}

export const call =
  (...args: ConstructorParameters<typeof Call>) => new Call(...args)