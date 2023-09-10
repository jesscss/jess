import { Node, defineType } from './node'

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
  get() {
    const replacements = this.data.get('replacements')
    return this.value.replace(/##/g, _ => String(replacements.shift()))
  }
}

export const interpolated = defineType<InterpolatedValue>(Interpolated, 'Interpolated')