import { type Color } from '@jesscss/core'

export function getLuma(color: Color) {
  let r = color.rgb[0] / 255
  let g = color.rgb[1] / 255
  let b = color.rgb[2] / 255

  r = (r <= 0.03928) ? r / 12.92 : Math.pow(((r + 0.055) / 1.055), 2.4)
  g = (g <= 0.03928) ? g / 12.92 : Math.pow(((g + 0.055) / 1.055), 2.4)
  b = (b <= 0.03928) ? b / 12.92 : Math.pow(((b + 0.055) / 1.055), 2.4)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}