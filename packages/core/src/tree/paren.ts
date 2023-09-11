import { type Context } from 'vitest'
import { Node, defineType } from './node'
// import type { Context } from '../context'
// import type { OutputCollector } from '../output'

/**
 * An expression in parenthesis
 */
export class Paren extends Node<Node> {
  toString(): string {
    const output = super.toString()
    return `(${output})`
  }

  eval(context: Context) {

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