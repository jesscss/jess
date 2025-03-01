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
  declare value: string | Interpolated
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
    return value instanceof Node ? value.value.value : value
  }

  override async evalNode(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let { value } = this
      if (value instanceof Node) {
        value = await value.eval(context)
      }
      if (this.options.escaped) {
        if (value instanceof Node) {
          return value.inherit(this)
        }
        return new General<'Anonymous'>(value).inherit(this)
      }
      let quoted = this.clone()
      quoted.value = value
      return quoted
    })
  }
}
export const quoted = defineType(Quoted, 'Quoted')