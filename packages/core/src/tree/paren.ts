import { type Context } from '../context'
import { Bool } from './bool'
import { Expression } from './expression'
import { Operation } from './operation'
import { Node, defineType } from './node'
import { Dimension } from './dimension'
// import type { Context } from '../context'
// import type { OutputCollector } from '../output'

export type ParenOptions = {
  escaped: boolean
}

const isOpOrExpression = (node: Node): node is Operation | Expression => {
  return node instanceof Operation || node instanceof Expression
}

/**
 * An expression in parenthesis
 */
export class Paren extends Node<Node | undefined, ParenOptions> {
  toTrimmedString(): string {
    let value = `${this.value ?? ''}`
    let escapeChar = this.options?.escaped ? '~' : ''
    return `${escapeChar}(${value})`
  }

  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let canOperate = context.canOperate
      context.canOperate = true
      let { value } = this
      if (value) {
        let isOp = isOpOrExpression(value)
        value = await value.eval(context)
        while (value instanceof Paren && value.value) {
          value = value.value
        }
        if (value instanceof Bool || value instanceof Dimension) {
          return value
        }
        context.canOperate = canOperate
        if (isOp && !isOpOrExpression(value)) {
          return value
        }
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