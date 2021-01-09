import {
  Node,
  ILocationInfo,
  isNodeMap,
  NodeMap
} from '.'

/**
 * A number or dimension
 */
export class Dimension extends Node {
  value: number
  unit: string

  constructor(
    value: number | string | NodeMap,
    location?: ILocationInfo
  ) {
    if (isNodeMap(value)) {
      super(value, location)
      return
    } else if (value.constructor === Number) {
      super({ value }, location)
      return
    }
    const regex = /([0-9]*(?:\.[0-9]+)?)([a-z]*)/
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
    const { value, unit } = this
    return `${value}${unit || ''}`
  }

  toModule() { return '' }
}

export const dim =
  (...args: ConstructorParameters<typeof Dimension>) => new Dimension(...args)