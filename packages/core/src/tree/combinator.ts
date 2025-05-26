import { defineType } from './node'
import { Selector } from './selector'

export class Combinator extends Selector<string> {
  type = 'Combinator' as const
  shortType = 'co' as const

  /** To make forming Sets easier */
  override valueOf() {
    return this.value
  }

  get keySet() {
    return new Set([this.value])
  }

  normalize() {
    return this
  }
  // toTrimmedString() {
  //   let { value } = this
  //   return value === ' ' ? value : ` ${value} `
  // }

  /** @todo move to visitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   const val = this.value
  //   out.add(val === ' ' ? val : ` ${val} `, this.location)
  // }

  /** @todo move to visitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add(`$J.co("${this.value}")`)
  // }
}
export const co = defineType(Combinator, 'Combinator', 'co')