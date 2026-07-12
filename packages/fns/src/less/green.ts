import { type Color, Dimension } from '@jesscss/core'

export default function green(color: Color) {
  return new Dimension([color.rgb[1]])
}