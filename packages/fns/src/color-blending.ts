import { Color } from 'jess'

// Color Blending
// ref: http://www.w3.org/TR/compositing-1

function colorBlend(mode: Function, color1: Color, color2: Color) {
  if (!(color1 instanceof Color) || !(color2 instanceof Color)) {
    throw { message: 'Both arguments must be colors.' }
  }
  // result
  const ab = color1.alpha

  let cb: number  // backdrop
  let cs: number  // source
  const as = color2.alpha

  let cr: number
  const rgba: number[] = []

  let ar = as + ab * (1 - as)
  for (let i = 0; i < 3; i++) {
    cb = color1.rgb[i] / 255
    cs = color2.rgb[i] / 255
    cr = mode(cb, cs)
    if (ar) {
      cr = (as * cs + ab * (cb -
        as * (cb + cs - cr))) / ar
    }
    rgba[i] = cr * 255
  }
  rgba[3] = ar

  return new Color({
    value: '',
    rgba
  })
}

const colorBlendModeFunctions = {
  multiply: function(cb: number, cs: number) {
    return cb * cs
  },
  screen: function(cb: number, cs: number) {
    return cb + cs - cb * cs
  },
  overlay: function(cb: number, cs: number) {
    cb *= 2
    return (cb <= 1) ?
      colorBlendModeFunctions.multiply(cb, cs) :
      colorBlendModeFunctions.screen(cb - 1, cs)
  },
  softlight: function(cb: number, cs: number) {
    let d = 1
    let e = cb
    if (cs > 0.5) {
      e = 1
      d = (cb > 0.25) ? Math.sqrt(cb)
        : ((16 * cb - 12) * cb + 4) * cb
    }
    return cb - (1 - 2 * cs) * e * (d - cb)
  },
  hardlight: function(cb: number, cs: number) {
    return colorBlendModeFunctions.overlay(cs, cb)
  },
  difference: function(cb: number, cs: number) {
    return Math.abs(cb - cs)
  },
  exclusion: function(cb: number, cs: number) {
    return cb + cs - 2 * cb * cs
  },

  // non-w3c functions:
  average: function(cb: number, cs: number) {
    return (cb + cs) / 2
  },
  negation: function(cb: number, cs: number) {
    return 1 - Math.abs(cb + cs - 1)
  }
}

export const multiply = colorBlend.bind(null, colorBlendModeFunctions.multiply)
export const screen = colorBlend.bind(null, colorBlendModeFunctions.screen)
export const overlay = colorBlend.bind(null, colorBlendModeFunctions.overlay)
export const softlight = colorBlend.bind(null, colorBlendModeFunctions.softlight)
export const hardlight = colorBlend.bind(null, colorBlendModeFunctions.hardlight)
export const difference = colorBlend.bind(null, colorBlendModeFunctions.difference)
export const exclusion = colorBlend.bind(null, colorBlendModeFunctions.exclusion)
export const average = colorBlend.bind(null, colorBlendModeFunctions.average)
export const negation = colorBlend.bind(null, colorBlendModeFunctions.negation)

