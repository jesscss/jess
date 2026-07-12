import { type Interpolated } from './interpolated'
import { type General } from './general'
import { Node, defineType } from './node'

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
}
export const quoted = defineType(Quoted, 'Quoted')