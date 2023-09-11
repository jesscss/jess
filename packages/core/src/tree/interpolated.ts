import { Node, defineType } from './node'
import { Anonymous } from './anonymous'
import type { Context } from '../context'

type InterpolatedValue = {
  /** String with ## placeholders */
  value: string
  replacements: Node[]
}

/**
 * An interpolated value is one that contains
 * references variables, or expressions, but
 * which MUST resolve to a single string
 * when evaluated.
 */
export class Interpolated extends Node<InterpolatedValue> {
  eval(context: Context) {
    const replacements = this.data.get('replacements').map(n => n.eval(context))
    const value = this.value.replace(/##/g, _ => String(replacements.shift()))
    const node = new Anonymous(value).inherit(this)
    return node
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated')