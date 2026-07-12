import { Dimension, type Node } from '@jesscss/core'

export type ColorValue = Dimension | number

export function clamp(val: number) {
  return Math.min(1, Math.max(0, val))
}

export function getNumber(n: Node | number) {
  if (n instanceof Dimension) {
    let unit = n.unit
    if (unit === '%') {
      return n.number / 100
    } else if (!unit) {
      return n.number
    }
    throw new Error('color functions take numbers as parameters')
  } else if (n.constructor === Number) {
    return n
  } else {
    throw new Error('color functions take numbers as parameters')
  }
}