import { type Context } from '../context'
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
  toString(): string {
    const output = super.toString()
    const escapeChar = this.options?.escaped ? '~' : ''
    return `${escapeChar}(${output})`
  }

  eval(context: Context): Node {
    return this.evalIfNot(context, () => {
      let { value } = this
      const isExpression = value instanceof Expression
      value = value.eval(context)
      if (isExpression && !(value instanceof Expression)) {
        return value
      }
      const node = this.clone()
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