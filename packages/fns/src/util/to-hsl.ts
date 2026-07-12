import { type Color } from '@jesscss/core'

export function toHSL(color: Color) {
  const [h, s, l] = color.toHSL()
  const a = color.alpha
  return { h, s, l, a }
}