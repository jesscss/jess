import { type Interpolated } from './interpolated'
import { type General } from './general'
import { Node, defineType } from './node'
import type { Context } from '../context'

export type QuotedOptions = {
  quote?: '"' | "'"
  escaped?: boolean
}

/**
 * An quoted value
 */
export class Quoted extends Node<General | Interpolated, QuotedOptions> {
  toTrimmedString() {
    let { quote = '"', escaped } = this.options ?? {}
    let output = super.toTrimmedString()
    let escapeChar = escaped ? '~' : ''
    return `${escapeChar}${quote}${output}${quote}`
  }

  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let value = await this.value.eval(context)
      if (this.options.escaped) {
        return value
      }
      let quoted = this.clone()
      quoted.value = value
      return quoted
    })
  }
}
export const quoted = defineType(Quoted, 'Quoted')