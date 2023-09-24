import { type Context } from '../context'
import { Bool } from './bool'
import { Expression } from './expression'
import { Node, defineType } from './node'
// import type { Context } from '../context'
// import type { OutputCollector } from '../output'

export type ParenOptions = {
  escaped: boolean
}

/**
 * An expression in parenthesis
 */
export class Paren extends Node<Node, ParenOptions> {
  toTrimmedString(): string {
    let output = super.toString()
    let escapeChar = this.options?.escaped ? '~' : ''
    return `${escapeChar}(${output})`
  }

  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let canOperate = context.canOperate
      context.canOperate = true
      let { value } = this
      let isExpression = value instanceof Expression
      value = await value.eval(context)
      if (value instanceof Bool) {
        return value
      }
      context.canOperate = canOperate
      if (isExpression && !(value instanceof Expression)) {
        return value
      }
      let node = this.clone()
      node.value = value
      return node
    })
  }

  // toCSS(context: Context, out: OutputCollector) {
  //   out.add('(')
  //   this.value.toCSS(context, out)
  //   out.add(')')
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.paren(', loc)
  //   this.value.toModule(context, out)
  //   out.add(')')
  // }
}

export const paren = defineType(Paren, 'Paren')