import {
  type Color,
  ColorFormat,
  type Dimension,
  type Node,
  type Context
} from '@jesscss/core'
import { toHSL } from './to-hsl'
import { clamp } from './number'
import hsla from '../hsla'

interface HSLA {
  h: number
  s: number
  l: number
  a?: number
}

export function getHsla(this: Context, origColor: Color, hsl: HSLA) {
  const color = hsla.call(this, hsl.h, hsl.s, hsl.l, hsl.a ?? 1)
  if (color) {
    const value = origColor.value
    if (typeof value === 'number') {
      color.value = value
    } else {
      color.value = ColorFormat.RGB
    }
    return color
  }
}

export function adjustHSL(
  this: Context,
  key: 'h' | 's' | 'l' | 'a',
  dir: '+' | '-',
  color: Color,
  amount: Dimension,
  method?: Node
) {
  const hsl = toHSL(color)
  if (!(amount.unit === '%')) {
    throw new Error('Amount must be a percentage')
  }
  let adjustAmount = amount.number / 100

  if (method && method.value === 'relative') {
    adjustAmount = hsl[key] * adjustAmount
  }
  if (dir === '-') {
    hsl[key] = clamp(hsl[key] - adjustAmount)
  } else {
    hsl[key] = clamp(hsl[key] + adjustAmount)
  }
  return getHsla.call(this, color, hsl)
}