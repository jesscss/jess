import { defineType } from './node'
import { Interpolated } from './interpolated'

export type QuotedOptions = {
  quote?: '"' | "'"
  escaped?: boolean
}

/**
 * An quoted value
 */
export class Quoted extends Interpolated<QuotedOptions> {
  toString() {
    let { quote = '"', escaped } = this.options ?? {}
    let output = super.toString()
    let escapeChar = escaped ? '~' : ''
    return `${escapeChar}${quote}${output}${quote}`
  }
}
export const quoted = defineType(Quoted, 'Quoted')