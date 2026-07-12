import { Node, defineType, type NodeOptions } from './node'
import { General } from './general'
import type { Context } from '../context'

export type InterpolatedValue = {
  /** String with ## placeholders */
  value: string
  replacements?: Node[]
}

/**
 * An interpolated value is one that contains
 * reference variables, or expressions, but
 * which MUST resolve to a node with a string value
 * (like Anonymous) when evaluated.
 *
 * @example
 *   in Less:
 *     - `@@foo` is an interpolated variable
 *     - `--prop-@{foo}` is an interpolated property
 */
export class Interpolated<O extends NodeOptions = NodeOptions> extends Node<InterpolatedValue, O> {
  async eval(context: Context): Promise<General> {
    let replacements = this.data.get('replacements')
    if (!replacements) {
      return new General(this.value, { type: 'Anonymous' }).inherit(this)
    }
    replacements = await Promise.all(replacements.map(async (n: Node) => await n.eval(context)))
    // eslint-disable-next-line no-control-regex
    let value = this.value.replace(/\x00/g, _ => String(replacements.shift()))
    let node = new General(value, { type: 'Anonymous' }).inherit(this)
    return node
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated')