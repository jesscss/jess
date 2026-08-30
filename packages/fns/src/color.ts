import { Color, Dimension, Node } from 'jess'

type RGBValue = Dimension | number

/**
 * Color functions, imported from Less
 */

export function rgba(...values: [RGBValue, RGBValue, RGBValue, RGBValue]) {
  const rgba = values.map(v => Number(v))
  return new Color({ value: 'rgba', rgba })
}

export function rgb(...values: [RGBValue, RGBValue, RGBValue]) {
  const rgb = values.map(v => Number(v))
  rgb.push(1)
  const color = rgba(rgb[0], rgb[1], rgb[2], rgb[3])
  color.value = 'rgb'
  return color
}

function getHue(h: number, m1: number, m2: number) {
  h = h < 0 ? h + 1 : (h > 1 ? h - 1 : h)
  if (h * 6 < 1) {
    return m1 + (m2 - m1) * h * 6
  }
  else if (h * 2 < 1) {
    return m2
  }
  else if (h * 3 < 2) {
    return m1 + (m2 - m1) * (2 / 3 - h) * 6
  }
  else {
    return m1
  }
}

function clamp(val: number) {
  return Math.min(1, Math.max(0, val))
}

function number(n: RGBValue) {
  if (n instanceof Dimension) {
    return n.unit === '%' ? n.value / 100 : n.value
  } else if (n.constructor === Number) {
    return n
  } else {
    throw {
      type: 'Argument',
      message: 'color functions take numbers as parameters'
    }
  }
}

function toHSL(color: Color) {
  if (color instanceof Color) {
    return color.toHSL()
  } else {
    throw new Error('Argument cannot be evaluated to a color')
  }
}

// Adapted from http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript
function toHSV(color: Color) {
  if (!(color instanceof Color)) {
    throw new Error('Argument cannot be evaluated to a color')
  }

  const r = color.rgb[0] / 255
  const g = color.rgb[1] / 255
  const b = color.rgb[2] / 255
  const a = color.alpha

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h: number
  let s: number
  const v = max

  const d = max - min
  if (max === 0) {
    s = 0
  } else {
    s = d / max
  }

  if (max === min) {
    h = 0
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return { h: h * 360, s, v, a }
}

export function hsla(h: RGBValue, s: RGBValue, l: RGBValue, a: RGBValue) {
  let m1: number
  let m2: number

  const value = `hsla`

  h = (number(h) % 360) / 360
  s = clamp(number(s))
  l = clamp(number(l))
  a = clamp(number(a))

  m2 = l <= 0.5 ? l * (s + 1) : l + s - l * s
  m1 = l * 2 - m2

  const rgba = [
    getHue(h + 1 / 3, m1, m2) * 255,
    getHue(h, m1, m2) * 255,
    getHue(h - 1 / 3, m1, m2) * 255,
    a
  ]
  return new Color({
    value,
    rgba
  })
}

export function hsl(h: RGBValue, s: RGBValue, l: RGBValue) {
  const value = `hsl`
  h = number(h)
  s = number(s)
  l = number(l)
  const color = hsla(h, s, l, 1)
  color.value = value
  return color
}

export function hsva(h: RGBValue, s: RGBValue, v: RGBValue, a: RGBValue) {
  h = ((number(h) % 360) / 360) * 360
  s = number(s)
  v = number(v)
  a = number(a)

  let i = Math.floor((h / 60) % 6)
  let f = (h / 60) - i

  const vs = [
    v,
    v * (1 - s),
    v * (1 - f * s),
    v * (1 - (1 - f) * s)
  ]
  
  const perm = [
    [0, 3, 1],
    [2, 0, 1],
    [1, 0, 3],
    [1, 2, 0],
    [3, 1, 0],
    [0, 1, 2]
  ]

  return rgba(
    vs[perm[i][0]] * 255,
    vs[perm[i][1]] * 255,
    vs[perm[i][2]] * 255,
    a
  )
}

export function hsv(h: RGBValue, s: RGBValue, v: RGBValue) {
  return hsva(h, s, v, 1.0)
}

export function hue(color: Color) {
  return new Dimension(toHSL(color).h)
}

export function saturation(color: Color) {
  return new Dimension({
    value: toHSL(color).s * 100,
    unit: '%'
  })
}

export function lightness(color: Color) {
  return new Dimension({
    value: toHSL(color).l * 100,
    unit: '%'
  })
}

export function hsvhue(color: Color) {
  return new Dimension(toHSV(color).h)
}

export function hsvsaturation(color: Color) {
  return new Dimension({
    value: toHSV(color).s * 100,
    unit: '%'
  })
}
export function hsvvalue(color: Color) {
  return new Dimension({
    value: toHSV(color).v * 100,
    unit: '%'
  })
}
export function red(color: Color) {
  return new Dimension(color.rgb[0])
}
export function green(color: Color) {
  return new Dimension(color.rgb[1])
}
export function blue(color: Color) {
  return new Dimension(color.rgb[2])
}
export function alpha(color: Color) {
  return new Dimension(toHSL(color).a)
}

function getLuma(color: Color) {
  let r = color.rgb[0] / 255
  let g = color.rgb[1] / 255
  let b = color.rgb[2] / 255

  r = (r <= 0.03928) ? r / 12.92 : Math.pow(((r + 0.055) / 1.055), 2.4)
  g = (g <= 0.03928) ? g / 12.92 : Math.pow(((g + 0.055) / 1.055), 2.4)
  b = (b <= 0.03928) ? b / 12.92 : Math.pow(((b + 0.055) / 1.055), 2.4)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function luma(color: Color) {
  return new Dimension({
    value: getLuma(color) * color.alpha * 100,
    unit: '%'
  })
}

export function luminance(color: Color) {
  const luminance =
    (0.2126 * color.rgb[0] / 255) +
    (0.7152 * color.rgb[1] / 255) +
    (0.0722 * color.rgb[2] / 255)

  return new Dimension({
    value: luminance * color.alpha * 100,
    unit: '%'
  })
}

type HSLA = {
  h: number
  s: number
  l: number
  a: number
}

function getHsla(origColor: Color, hsl: HSLA) {
  const color = hsla(hsl.h, hsl.s, hsl.l, hsl.a)
  if (color) {
    if (origColor.value && 
      /^(rgb|hsl)/.test(origColor.value)) {
      color.value = origColor.value
    } else {
      color.value = 'rgb'
    }
    return color
  }
}

/**
 * @note
 * There's a lot of boilerplate code in the following functions. Could
 * they be abstracted / have a generator function? 
 */

export function saturate(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.s +=  hsl.s * amount.value / 100
  }
  else {
    hsl.s += amount.value / 100
  }
  hsl.s = clamp(hsl.s)
  return getHsla(color, hsl)
}

export function desaturate(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.s -=  hsl.s * amount.value / 100
  }
  else {
    hsl.s -= amount.value / 100
  }
  hsl.s = clamp(hsl.s)
  return getHsla(color, hsl)
}

export function lighten(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.l +=  hsl.l * amount.value / 100
  }
  else {
    hsl.l += amount.value / 100
  }
  hsl.l = clamp(hsl.l)
  return getHsla(color, hsl)
}

export function darken(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.l -=  hsl.l * amount.value / 100
  }
  else {
    hsl.l -= amount.value / 100
  }
  hsl.l = clamp(hsl.l)
  return getHsla(color, hsl)
}

export function fadein(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.a +=  hsl.a * amount.value / 100
  }
  else {
    hsl.a += amount.value / 100
  }
  hsl.a = clamp(hsl.a)
  return getHsla(color, hsl)
}

export function fadeout(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.a -=  hsl.a * amount.value / 100
  }
  else {
    hsl.a -= amount.value / 100
  }
  hsl.a = clamp(hsl.a)
  return getHsla(color, hsl)
}

export function fade(color: Color, amount: Dimension) {
  const hsl = toHSL(color)

  hsl.a = amount.value / 100
  hsl.a = clamp(hsl.a)
  return getHsla(color, hsl)
}

export function spin(color: Color, amount: Dimension) {
  const hsl = toHSL(color)
  const hue = (hsl.h + amount.value) % 360

  hsl.h = hue < 0 ? 360 + hue : hue

  return getHsla(color, hsl)
}

//
// Copyright (c) 2006-2009 Hampton Catlin, Natalie Weizenbaum, and Chris Eppstein
// http://sass-lang.com
//
export function mix(color1: Color, color2: Color, weight?: Dimension) {
  if (!weight) {
    weight = new Dimension(50)
  }
  const p = weight.value / 100.0
  const w = p * 2 - 1
  const a = toHSL(color1).a - toHSL(color2).a

  const w1 = (((w * a == -1) ? w : (w + a) / (1 + w * a)) + 1) / 2.0
  const w2 = 1 - w1

  const rgba = [
    color1.rgb[0] * w1 + color2.rgb[0] * w2,
    color1.rgb[1] * w1 + color2.rgb[1] * w2,
    color1.rgb[2] * w1 + color2.rgb[2] * w2,
    color1.alpha * p + color2.alpha * (1 - p)
  ]

  return new Color({
    value: '',
    rgba
  })
}

export function greyscale(color: Color) {
  return desaturate(color, new Dimension(100))
}

export function contrast(
  color: Color,
  dark?: Color,
  light?: Color,
  threshold?: Dimension
) {
  if (!light) {
    light = rgba(255, 255, 255, 1.0)
  }
  if (!dark) {
    dark = rgba(0, 0, 0, 1.0)
  }
  // Figure out which is actually light and dark:
  if (getLuma(dark) > getLuma(light)) {
    const t = light
    light = dark
    dark = t
  }
  let thresholdNum: number
  if (!threshold) {
    thresholdNum = 0.43
  } else {
    thresholdNum = number(threshold)
  }
  if (getLuma(color) < thresholdNum) {
    return light
  } else {
    return dark
  }
}

export function tint(color: Color, amount: Dimension) {
  return mix(rgb(255, 255, 255), color, amount)
}

export function shade(color: Color, amount: Dimension) {
  return mix(rgb(0, 0, 0), color, amount)
}
