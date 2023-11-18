import { type Color, Dimension } from '@jesscss/core'

export default function alpha(color: Color) {
  return new Dimension([color.alpha])
}