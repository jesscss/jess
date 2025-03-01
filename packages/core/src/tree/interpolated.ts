import { Node, defineType } from './node'
import { General, type GeneralNodeType, type GeneralOptions } from './general'
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
export class Interpolated<
  T extends string = GeneralNodeType
> extends Node<InterpolatedValue, GeneralOptions<T>> {
  declare value: InterpolatedValue
  type = 'Interpolated' as const
  shortType = 'interpolated' as const

  override valueOf(): string {
    return this.value.value
  }

  override async evalNode(context: Context): Promise<General<T>> {
    let { value, replacements } = this.value
    if (!replacements) {
      return new General<T>(value).inherit(this)
    }
    replacements = await Promise.all(replacements.map(async (n: Node) => await n.eval(context)))
    // eslint-disable-next-line no-control-regex
    value = value.replace(/\x00/g, _ => String(replacements.shift()))
    let node = new General<T>(value).inherit(this)
    return node
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated')