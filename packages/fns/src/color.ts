import {
  type Node,
  Color,
  Sequence,
  Dimension,
  ColorFormat
} from '@jesscss/core'
import { ExtendedFn } from './util'

type RGBValue = Dimension | number

/**
 * Color functions, imported from Less
 */

export function rgba(...values: [RGBValue, RGBValue, RGBValue, RGBValue]) {
  const rgba = values.map(v => Number(v))
  return new Color(rgba)
}

// function getHue(h: number, m1: number, m2: number) {
//   h = h < 0 ? h + 1 : (h > 1 ? h - 1 : h)
//   if (h * 6 < 1) {
//     return m1 + (m2 - m1) * h * 6
//   } else if (h * 2 < 1) {
//     return m2
//   } else if (h * 3 < 2) {
//     return m1 + (m2 - m1) * (2 / 3 - h) * 6
//   } else {
//     return m1
//   }
// }

function clamp(val: number) {
  return Math.min(1, Math.max(0, val))
}

function number(n: RGBValue) {
  if (n instanceof Dimension) {
    return n.unit === '%' ? n.number / 100 : n.number
  } else if (n.constructor === Number) {
    return n
  } else {
    throw new Error('color functions take numbers as parameters')
  }
}

export function hsla(h: RGBValue, s: RGBValue, l: RGBValue, a: RGBValue) {
  // let m1: number
  // let m2: number

  h = (number(h) % 360) / 360
  s = clamp(number(s))
  l = clamp(number(l))
  a = clamp(number(a))

  // m2 = l <= 0.5 ? l * (s + 1) : l + s - l * s
  // m1 = l * 2 - m2

  // const rgba = [
  //   getHue(h + 1 / 3, m1, m2) * 255,
  //   getHue(h, m1, m2) * 255,
  //   getHue(h - 1 / 3, m1, m2) * 255,
  //   a
  // ]
  const color = new Color(ColorFormat.HSL)
  color.hsla = [h, s, l, a]
  return color
}

export function hsl(h: RGBValue, s: RGBValue, l: RGBValue) {
  h = number(h)
  s = number(s)
  l = number(l)
  return hsla(h, s, l, 1)
}

export function hsva(h: RGBValue, s: RGBValue, v: RGBValue, a: RGBValue) {
  h = ((number(h) % 360) / 360) * 360
  s = number(s)
  v = number(v)
  a = number(a)

  const i = Math.floor((h / 60) % 6)
  const f = (h / 60) - i

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
    vs[perm[i]![0]!]! * 255,
    vs[perm[i]![1]!]! * 255,
    vs[perm[i]![2]!]! * 255,
    a
  )
}

export function hsv(h: RGBValue, s: RGBValue, v: RGBValue) {
  return hsva(h, s, v, 1.0)
}

export function hue(color: Color) {
  return new Dimension([toHSL(color).h])
}

export function saturation(color: Color) {
  return new Dimension([
    toHSL(color).s * 100,
    '%'
  ])
}

export function lightness(color: Color) {
  return new Dimension([
    toHSL(color).l * 100,
    '%'
  ])
}

export function hsvhue(color: Color) {
  return new Dimension([toHSV(color).h])
}

export function hsvsaturation(color: Color) {
  return new Dimension([
    toHSV(color).s * 100,
    '%'
  ])
}
export function hsvvalue(color: Color) {
  return new Dimension([
    toHSV(color).v * 100,
    '%'
  ])
}
export function red(color: Color) {
  return new Dimension([color.rgb[0]])
}
export function green(color: Color) {
  return new Dimension([color.rgb[1]])
}
export function blue(color: Color) {
  return new Dimension([color.rgb[2]])
}
export function alpha(color: Color) {
  return new Dimension([color.alpha])
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
  return new Dimension([
    getLuma(color) * color.alpha * 100,
    '%'
  ])
}

export function luminance(color: Color) {
  const luminance =
    (0.2126 * color.rgb[0] / 255) +
    (0.7152 * color.rgb[1] / 255) +
    (0.0722 * color.rgb[2] / 255)

  return new Dimension([
    luminance * color.alpha * 100,
    '%'
  ])
}

interface HSLA {
  h: number
  s: number
  l: number
  a?: number
}

function getHsla(origColor: Color, hsl: HSLA) {
  const color = hsla(hsl.h, hsl.s, hsl.l, hsl.a ?? 1)
  if (color) {
    const value = origColor.value
    if (typeof value === 'number') {
      color.value = value
    } else {
      color.value = ColorFormat.RGB
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
    hsl.s += hsl.s * amount.number / 100
  } else {
    hsl.s += amount.number / 100
  }
  hsl.s = clamp(hsl.s)
  return getHsla(color, hsl)
}

export function desaturate(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.s -= hsl.s * amount.number / 100
  } else {
    hsl.s -= amount.number / 100
  }
  hsl.s = clamp(hsl.s)
  return getHsla(color, hsl)
}

export function lighten(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.l += hsl.l * amount.number / 100
  } else {
    hsl.l += amount.number / 100
  }
  hsl.l = clamp(hsl.l)
  return getHsla(color, hsl)
}

export function darken(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.l -= hsl.l * amount.number / 100
  } else {
    hsl.l -= amount.number / 100
  }
  hsl.l = clamp(hsl.l)
  return getHsla(color, hsl)
}

export function fadein(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.a += hsl.a * amount.number / 100
  } else {
    hsl.a += amount.number / 100
  }
  hsl.a = clamp(hsl.a)
  return getHsla(color, hsl)
}

export function fadeout(color: Color, amount: Dimension, method?: Node) {
  const hsl = toHSL(color)

  if (method && method.value === 'relative') {
    hsl.a -= hsl.a * amount.number / 100
  } else {
    hsl.a -= amount.number / 100
  }
  hsl.a = clamp(hsl.a)
  return getHsla(color, hsl)
}

export function fade(color: Color, amount: Dimension) {
  const hsl = toHSL(color)

  hsl.a = amount.number / 100
  hsl.a = clamp(hsl.a)
  return getHsla(color, hsl)
}

export function spin(color: Color, amount: Dimension) {
  const hsl = toHSL(color)
  const hue = (hsl.h + amount.number) % 360

  hsl.h = hue < 0 ? 360 + hue : hue

  return getHsla(color, hsl)
}

//
// Copyright (c) 2006-2009 Hampton Catlin, Natalie Weizenbaum, and Chris Eppstein
// http://sass-lang.com
//
export function mix(color1: Color, color2: Color, weight?: Dimension) {
  if (!weight) {
    weight = new Dimension([50])
  }
  const p = weight.number / 100.0
  const w = p * 2 - 1
  const a = toHSL(color1).a - toHSL(color2).a

  const w1 = (((w * a === -1) ? w : (w + a) / (1 + w * a)) + 1) / 2.0
  const w2 = 1 - w1

  const rgba = [
    color1.rgb[0] * w1 + color2.rgb[0] * w2,
    color1.rgb[1] * w1 + color2.rgb[1] * w2,
    color1.rgb[2] * w1 + color2.rgb[2] * w2,
    color1.alpha * p + color2.alpha * (1 - p)
  ]

  return new Color(rgba)
}

export function greyscale(color: Color) {
  return desaturate(color, new Dimension([100]))
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

// import Dimension from '../tree/dimension';
// import Color from '../tree/color';
// import Quoted from '../tree/quoted';
// import Anonymous from '../tree/anonymous';
// import Expression from '../tree/expression';
// import Operation from '../tree/operation';
let colorFunctions

function scaled(n, size) {
  if (n instanceof Dimension && n.unit.is('%')) {
    return parseFloat(n.value * size / 100)
  } else {
    return number(n)
  }
}
colorFunctions = {
  rgb: function(r, g, b) {
    let a = 1
    /**
     * Comma-less syntax
     *   e.g. rgb(0 128 255 / 50%)
     */
    if (r instanceof Expression) {
      const val = r.value
      r = val[0]
      g = val[1]
      b = val[2]
      /**
       * @todo - should this be normalized in
       *   function caller? Or parsed differently?
       */
      if (b instanceof Operation) {
        const op = b
        b = op.operands[0]
        a = op.operands[1]
      }
    }
    const color = colorFunctions.rgba(r, g, b, a)
    if (color) {
      color.value = 'rgb'
      return color
    }
  },
  rgba: function(r, g, b, a) {
    try {
      if (r instanceof Color) {
        if (g) {
          a = number(g)
        } else {
          a = r.alpha
        }
        return new Color(r.rgb, a, 'rgba')
      }
      const rgb = [r, g, b].map(c => scaled(c, 255))
      a = number(a)
      return new Color(rgb, a, 'rgba')
    } catch (e) {}
  },
  hsl: function(h, s, l) {
    let a = 1
    if (h instanceof Expression) {
      const val = h.value
      h = val[0]
      s = val[1]
      l = val[2]

      if (l instanceof Operation) {
        const op = l
        l = op.operands[0]
        a = op.operands[1]
      }
    }
    const color = colorFunctions.hsla(h, s, l, a)
    if (color) {
      color.value = 'hsl'
      return color
    }
  },
  hsla: function(h, s, l, a) {
    let m1
    let m2

    function hue(h) {
      h = h < 0 ? h + 1 : (h > 1 ? h - 1 : h)
      if (h * 6 < 1) {
        return m1 + (m2 - m1) * h * 6
      } else if (h * 2 < 1) {
        return m2
      } else if (h * 3 < 2) {
        return m1 + (m2 - m1) * (2 / 3 - h) * 6
      } else {
        return m1
      }
    }

    try {
      if (h instanceof Color) {
        if (s) {
          a = number(s)
        } else {
          a = h.alpha
        }
        return new Color(h.rgb, a, 'hsla')
      }

      h = (number(h) % 360) / 360
      s = clamp(number(s)); l = clamp(number(l)); a = clamp(number(a))

      m2 = l <= 0.5 ? l * (s + 1) : l + s - l * s
      m1 = l * 2 - m2

      const rgb = [
        hue(h + 1 / 3) * 255,
        hue(h) * 255,
        hue(h - 1 / 3) * 255
      ]
      a = number(a)
      return new Color(rgb, a, 'hsla')
    } catch (e) {}
  },

  hsv: function(h, s, v) {
    return colorFunctions.hsva(h, s, v, 1.0)
  },

  hsva: function(h, s, v, a) {
    h = ((number(h) % 360) / 360) * 360
    s = number(s); v = number(v); a = number(a)

    let i
    let f
    i = Math.floor((h / 60) % 6)
    f = (h / 60) - i

    const vs = [v,
      v * (1 - s),
      v * (1 - f * s),
      v * (1 - (1 - f) * s)]
    const perm = [[0, 3, 1],
      [2, 0, 1],
      [1, 0, 3],
      [1, 2, 0],
      [3, 1, 0],
      [0, 1, 2]]

    return colorFunctions.rgba(vs[perm[i][0]] * 255,
      vs[perm[i][1]] * 255,
      vs[perm[i][2]] * 255,
      a)
  },

  hue: function(color) {
    return new Dimension(toHSL(color).h)
  },
  saturation: function(color) {
    return new Dimension(toHSL(color).s * 100, '%')
  },
  lightness: function(color) {
    return new Dimension(toHSL(color).l * 100, '%')
  },
  hsvhue: function(color) {
    return new Dimension(toHSV(color).h)
  },
  hsvsaturation: function(color) {
    return new Dimension(toHSV(color).s * 100, '%')
  },
  hsvvalue: function(color) {
    return new Dimension(toHSV(color).v * 100, '%')
  },
  red: function(color) {
    return new Dimension(color.rgb[0])
  },
  green: function(color) {
    return new Dimension(color.rgb[1])
  },
  blue: function(color) {
    return new Dimension(color.rgb[2])
  },
  alpha: function(color) {
    return new Dimension(toHSL(color).a)
  },
  luma: function(color) {
    return new Dimension(color.luma() * color.alpha * 100, '%')
  },
  luminance: function(color) {
    const luminance =
            (0.2126 * color.rgb[0] / 255) +
                (0.7152 * color.rgb[1] / 255) +
                (0.0722 * color.rgb[2] / 255)

    return new Dimension(luminance * color.alpha * 100, '%')
  },
  saturate: function(color, amount, method) {
    // filter: saturate(3.2);
    // should be kept as is, so check for color
    if (!color.rgb) {
      return null
    }
    const hsl = toHSL(color)

    if (typeof method !== 'undefined' && method.value === 'relative') {
      hsl.s += hsl.s * amount.value / 100
    } else {
      hsl.s += amount.value / 100
    }
    hsl.s = clamp(hsl.s)
    return hsla(color, hsl)
  },
  desaturate: function(color, amount, method) {
    const hsl = toHSL(color)

    if (typeof method !== 'undefined' && method.value === 'relative') {
      hsl.s -= hsl.s * amount.value / 100
    } else {
      hsl.s -= amount.value / 100
    }
    hsl.s = clamp(hsl.s)
    return hsla(color, hsl)
  },
  lighten: function(color, amount, method) {
    const hsl = toHSL(color)

    if (typeof method !== 'undefined' && method.value === 'relative') {
      hsl.l += hsl.l * amount.value / 100
    } else {
      hsl.l += amount.value / 100
    }
    hsl.l = clamp(hsl.l)
    return hsla(color, hsl)
  },
  darken: function(color, amount, method) {
    const hsl = toHSL(color)

    if (typeof method !== 'undefined' && method.value === 'relative') {
      hsl.l -= hsl.l * amount.value / 100
    } else {
      hsl.l -= amount.value / 100
    }
    hsl.l = clamp(hsl.l)
    return hsla(color, hsl)
  },
  fadein: function(color, amount, method) {
    const hsl = toHSL(color)

    if (typeof method !== 'undefined' && method.value === 'relative') {
      hsl.a += hsl.a * amount.value / 100
    } else {
      hsl.a += amount.value / 100
    }
    hsl.a = clamp(hsl.a)
    return hsla(color, hsl)
  },
  fadeout: function(color, amount, method) {
    const hsl = toHSL(color)

    if (typeof method !== 'undefined' && method.value === 'relative') {
      hsl.a -= hsl.a * amount.value / 100
    } else {
      hsl.a -= amount.value / 100
    }
    hsl.a = clamp(hsl.a)
    return hsla(color, hsl)
  },
  fade: function(color, amount) {
    const hsl = toHSL(color)

    hsl.a = amount.value / 100
    hsl.a = clamp(hsl.a)
    return hsla(color, hsl)
  },
  spin: function(color, amount) {
    const hsl = toHSL(color)
    const hue = (hsl.h + amount.value) % 360

    hsl.h = hue < 0 ? 360 + hue : hue

    return hsla(color, hsl)
  },
  //
  // Copyright (c) 2006-2009 Hampton Catlin, Natalie Weizenbaum, and Chris Eppstein
  // http://sass-lang.com
  //
  mix: function(color1, color2, weight) {
    if (!weight) {
      weight = new Dimension(50)
    }
    const p = weight.value / 100.0
    const w = p * 2 - 1
    const a = toHSL(color1).a - toHSL(color2).a

    const w1 = (((w * a == -1) ? w : (w + a) / (1 + w * a)) + 1) / 2.0
    const w2 = 1 - w1

    const rgb = [color1.rgb[0] * w1 + color2.rgb[0] * w2,
      color1.rgb[1] * w1 + color2.rgb[1] * w2,
      color1.rgb[2] * w1 + color2.rgb[2] * w2]

    const alpha = color1.alpha * p + color2.alpha * (1 - p)

    return new Color(rgb, alpha)
  },
  greyscale: function(color) {
    return colorFunctions.desaturate(color, new Dimension(100))
  },
  contrast: function(color, dark, light, threshold) {
    // filter: contrast(3.2);
    // should be kept as is, so check for color
    if (!color.rgb) {
      return null
    }
    if (typeof light === 'undefined') {
      light = colorFunctions.rgba(255, 255, 255, 1.0)
    }
    if (typeof dark === 'undefined') {
      dark = colorFunctions.rgba(0, 0, 0, 1.0)
    }
    // Figure out which is actually light and dark:
    if (dark.luma() > light.luma()) {
      const t = light
      light = dark
      dark = t
    }
    if (typeof threshold === 'undefined') {
      threshold = 0.43
    } else {
      threshold = number(threshold)
    }
    if (color.luma() < threshold) {
      return light
    } else {
      return dark
    }
  },
  // Changes made in 2.7.0 - Reverted in 3.0.0
  // contrast: function (color, color1, color2, threshold) {
  //     // Return which of `color1` and `color2` has the greatest contrast with `color`
  //     // according to the standard WCAG contrast ratio calculation.
  //     // http://www.w3.org/TR/WCAG20/#contrast-ratiodef
  //     // The threshold param is no longer used, in line with SASS.
  //     // filter: contrast(3.2);
  //     // should be kept as is, so check for color
  //     if (!color.rgb) {
  //         return null;
  //     }
  //     if (typeof color1 === 'undefined') {
  //         color1 = colorFunctions.rgba(0, 0, 0, 1.0);
  //     }
  //     if (typeof color2 === 'undefined') {
  //         color2 = colorFunctions.rgba(255, 255, 255, 1.0);
  //     }
  //     var contrast1, contrast2;
  //     var luma = color.luma();
  //     var luma1 = color1.luma();
  //     var luma2 = color2.luma();
  //     // Calculate contrast ratios for each color
  //     if (luma > luma1) {
  //         contrast1 = (luma + 0.05) / (luma1 + 0.05);
  //     } else {
  //         contrast1 = (luma1 + 0.05) / (luma + 0.05);
  //     }
  //     if (luma > luma2) {
  //         contrast2 = (luma + 0.05) / (luma2 + 0.05);
  //     } else {
  //         contrast2 = (luma2 + 0.05) / (luma + 0.05);
  //     }
  //     if (contrast1 > contrast2) {
  //         return color1;
  //     } else {
  //         return color2;
  //     }
  // },
  argb: function(color) {
    return new Anonymous(color.toARGB())
  },
  color: function(c) {
    if ((c instanceof Quoted) &&
            (/^#([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{3,4})$/i.test(c.value))) {
      const val = c.value.slice(1)
      return new Color(val, undefined, `#${val}`)
    }
    if ((c instanceof Color) || (c = Color.fromKeyword(c.value))) {
      c.value = undefined
      return c
    }
    throw {
      type: 'Argument',
      message: 'argument must be a color keyword or 3|4|6|8 digit hex e.g. #FFF'
    }
  },
  tint: function(color, amount) {
    return colorFunctions.mix(colorFunctions.rgb(255, 255, 255), color, amount)
  },
  shade: function(color, amount) {
    return colorFunctions.mix(colorFunctions.rgb(0, 0, 0), color, amount)
  }
}

export default colorFunctions
