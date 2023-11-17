import { Color } from '@jesscss/core'

// Color Blending
// ref: http://www.w3.org/TR/compositing-1
export function colorBlend(mode: (c1: number, c2: number) => number, color1: Color, color2: Color) {
  if (!(color1 instanceof Color) || !(color2 instanceof Color)) {
    throw new Error('Both arguments must be colors.')
  }
  // result
  const ab = color1.alpha

  let cb: number // backdrop
  let cs: number // source
  const as = color2.alpha

  let cr: number
  const rgba: number[] = []

  const ar = as + ab * (1 - as)
  for (let i = 0; i < 3; i++) {
    cb = color1.rgb[i]! / 255
    cs = color2.rgb[i]! / 255
    cr = mode(cb, cs)
    if (ar) {
      cr = (as * cs + ab * (cb -
        as * (cb + cs - cr))) / ar
    }
    rgba[i] = cr * 255
  }
  rgba[3] = ar

  return new Color(rgba)
}