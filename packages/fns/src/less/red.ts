import { type Color, Dimension } from '@jesscss/core'

export default function red(color: Color) {
  return new Dimension([color.rgb[0]])
}