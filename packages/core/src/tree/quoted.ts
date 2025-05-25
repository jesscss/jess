import { type Interpolated } from './interpolated'
import { General } from './general'
import { Node, defineType } from './node'
import type { Context } from '../context'

export type QuotedOptions = {
  quote?: '"' | "'"
  escaped?: boolean
}

/**
 * An quoted value
 */
export class Quoted extends Node<string | Interpolated, QuotedOptions> {
  declare value: string | General | Interpolated
  type = 'Quoted' as const
  shortType = 'quoted' as const

  override toTrimmedString() {
    let { quote = '"', escaped } = this.options ?? {}
    let output = super.toTrimmedString()
    let escapeChar = escaped ? '~' : ''
    return `${escapeChar}${quote}${output}${quote}`
  }

  override valueOf() {
    const { value } = this
    return value instanceof Node ? value.valueOf() : value
  }

  override async evalNode(context: Context): Promise<Node> {
    let { value } = this
    if (value instanceof Node) {
      value = (await value.eval(context))
    }
    if (this.options.escaped) {
      if (value instanceof Node) {
        return value
      }
      return new General<'Anonymous'>(value)
    }
    let quoted = this.maybeClone(context)
    quoted.value = value
    return quoted
  }
}
export const quoted = defineType(Quoted, 'Quoted')