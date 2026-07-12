import { type Color, Dimension } from '@jesscss/core'

export default function blue(color: Color) {
  return new Dimension([color.rgb[2]])
}