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
    const output = super.toString()
    const quote = this.options?.quote
    return `${this.options.quote}${output}${this.options.quote}`
  }
}
export const quoted = defineType(Quoted, 'quoted')