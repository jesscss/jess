import { Node, defineType } from './node'
import type { Context } from '../context'
import { Dimension } from './dimension'

/**
 * The negative sign before a node
 */
export class Negative extends Node<Node> {
  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let value = await this.value.eval(context)
      if (!value.operate) {
        throw new TypeError(`Cannot operate on ${value.type}`)
      }
      value = value.operate(new Dimension([-1]), '*').inherit(this)
      value.evaluated = true
      return value
    })
  }
}

export const negative = defineType(Negative, 'Negative')