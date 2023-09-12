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
    const { quote = '"', escaped } = this.options ?? {}
    const output = super.toString()
    const escapeChar = escaped ? '~' : ''
    return `${escapeChar}${quote}${output}${quote}`
  }
}
export const quoted = defineType(Quoted, 'Quoted')