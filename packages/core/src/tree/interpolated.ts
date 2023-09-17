import { Node, defineType, type NodeOptions } from './node'
import { Anonymous } from './anonymous'
import type { Context } from '../context'

export type InterpolatedValue = {
  /** String with ## placeholders */
  value: string
  replacements?: Node[]
}

/**
 * An interpolated value is one that contains
 * references variables, or expressions, but
 * which MUST resolve to a single string
 * when evaluated.
 */
export class Interpolated<O extends NodeOptions = NodeOptions> extends Node<InterpolatedValue, O> {
  async eval(context: Context): Promise<Node> {
    let replacements = this.data.get('replacements')
    if (!replacements) {
      return await super.eval(context)
    }
    replacements = await Promise.all(replacements.map(async n => await n.eval(context)))
    let value = this.value.replace(/##/g, _ => String(replacements!.shift()))
    if (this.type === 'Interpolated') {
      let node = new Anonymous(value).inherit(this)
      return node
    }
    let node = this.clone()
    node.value = value
    node.evaluated = true
    return node
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated')