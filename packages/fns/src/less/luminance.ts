import { type Color, Dimension } from '@jesscss/core'

export default function luminance(color: Color) {
  const luminance =
    (0.2126 * color.rgb[0] / 255) +
    (0.7152 * color.rgb[1] / 255) +
    (0.0722 * color.rgb[2] / 255)

  return new Dimension([
    luminance * color.alpha * 100,
    '%'
  ])
}