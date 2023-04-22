import {
  Node,
  LocationInfo,
  isNodeMap,
  NodeMap
} from './node'

import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * A number or dimension
 */
export class Dimension extends Node {
  value: number
  unit: string

  constructor(
    value: number | string | NodeMap,
    location?: LocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    } else if (value.constructor === Number) {
      super({ value }, location)
      return
    }
    const regex = /([-+]?[0-9]*(?:\.[0-9]+)?)(%|[a-z]*)/
    const found = (<string>value).match(regex)
    if (!found) {
      throw { message: 'Not a valid dimension.' }
    }
    super({
      value: parseFloat(found[1]),
      unit: found[2]
    }, location)
  }

  toString() {
    const precision = 100000000
    let { value, unit } = this
    value = Math.round(value * precision) / precision
    return `${value}${unit || ''}`
  }

  toCSS(context: Context, out: OutputCollector) {
    out.add(this.toString(), this.location)
  }

  toModule(context: Context, out: OutputCollector) {
    const pre = context.pre
    out.add(`$J.num({\n`
      + `  ${pre}value: ${this.value},\n`
      + `  ${pre}unit: "${this.unit ?? ''}"\n`
      + `${pre}})`
    , this.location)
  }
}
Dimension.prototype.type = 'Dimension'

export const dimension =
  (...args: ConstructorParameters<typeof Dimension>) => new Dimension(...args)

/** alias */
export const num = dimension