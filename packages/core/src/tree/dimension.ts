import {
  Node,
  defineType
} from './node'

// import type { Context } from '../context'
// import type { OutputCollector } from '../output'

export type DimensionValue = [
  number: number,
  unit?: string
]

/**
 * A number or dimension
 */
export class Dimension extends Node<DimensionValue> {
  // constructor(
  //   value: number | string | NodeMap,
  //   location?: LocationInfo
  // ) {
  //   if (isNodeMap(value)) {
  //     super(value, location)
  //     return
  //   } else if (value.constructor === Number) {
  //     super({ value }, location)
  //     return
  //   }
  //   const regex = /([-+]?[0-9]*(?:\.[0-9]+)?)(%|[a-z]*)/
  //   const found = (value as string).match(regex)
  //   if (!found) {
  //     throw { message: 'Not a valid dimension.' }
  //   }
  //   super({
  //     value: parseFloat(found[1]),
  //     unit: found[2]
  //   }, location)
  // }

  toString() {
    const precision = 100000000
    let [value, unit] = this.value
    value = Math.round(value * precision) / precision
    return `${value}${unit ?? ''}`
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add(this.toString(), this.location)
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const pre = context.pre
  //   out.add('$J.num({\n' +
  //     `  ${pre}value: ${this.value},\n` +
  //     `  ${pre}unit: "${this.unit ?? ''}"\n` +
  //     `${pre}})`
  //   , this.location)
  // }
}

export const dimension = defineType(Dimension, 'Dimension')
/** alias */
export const num = dimension