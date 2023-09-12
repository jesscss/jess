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
  eval(context: Context): Node {
    let replacements = this.data.get('replacements')
    if (!replacements) {
      return super.eval(context)
    }
    replacements = replacements.map(n => n.eval(context))
    const value = this.value.replace(/##/g, _ => String(replacements!.shift()))
    if (this.type === 'Interpolated') {
      const node = new Anonymous(value).inherit(this)
      return node
    }
    const node = this.clone()
    node.value = value
    node.evaluated = true
    return node
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated')