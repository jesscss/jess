import { Node, defineType } from './node'

type ColorValues = [number, number, number, number] | number[]

export const enum ColorFormat {
  HEX,
  RGB,
  HSL
}

function clamp(v: number, max: number) {
  return Math.min(Math.max(v, 0), max)
}

/**
 * Color's `value` will either be the parsed value,
 * or, when constructed with a function, the preferred
 * output type.
 */
export class Color extends Node<string | ColorFormat> {
  private _rgb: [number, number, number] | undefined
  private _hsl: [number, number, number] | undefined
  private _alpha: number = 1

  /** Create an rgba map only if we need it */
  get rgba(): ColorValues {
    if (this._rgb) {
      return [...this._rgb, this._alpha]
    }

    let value = this.value
    let rgba: number[] = []

    if (typeof value !== 'string' || value[0] !== '#') {
      throw new TypeError('Only hex string values can be converted to colors.')
    }
    let hex = value.slice(1)

    if (hex.length >= 6) {
      (hex.match(/.{2}/g) as RegExpMatchArray).forEach((c, i) => {
        if (i < 3) {
          rgba.push(parseInt(c, 16))
        } else {
          rgba.push(parseInt(c, 16) / 255)
        }
      })
    } else {
      hex.split('').forEach((c, i) => {
        if (i < 3) {
          rgba.push(parseInt(c + c, 16))
        } else {
          rgba.push(parseInt(c + c, 16) / 255)
        }
      })
    }
    /** Make sure an alpha value is present */
    if (rgba.length === 3) {
      this._rgb = rgba as [number, number, number]
    } else {
      let [r, g, b, a] = rgba
      this._rgb = [r, g, b]
      this._alpha = a
    }
    return rgba as ColorValues
  }

  set rgba(rgba: ColorValues) {
    let [r, g, b, a] = rgba
    this._rgb = [r, g, b]
    this._alpha = a
  }

  get hsla(): ColorValues {
    const a = this._alpha
    if (this._hsl) {
      return [...this._hsl, a]
    }
    let [h, s, l] = this.toHSL()
    return [h, s, l, a]
  }

  set hsla(hsla: ColorValues) {
    let [h, s, l, a] = hsla
    this._hsl = [h, s, l]
    this._alpha = a
  }

  get rgb(): [number, number, number] {
    let [r, g, b] = this.rgba
    return [r, g, b]
  }

  set rgb(rgb: [number, number, number]) {
    this._rgb = rgb
  }

  get alpha(): number {
    return this._alpha
  }

  /**
   * Note - modern browsers support 4 & 8 digit hex values
   */
  toHex() {
    return `#${this.rgba.map(c => {
      c = clamp(Math.round(c), 255)
      return (c < 16 ? '0' : '') + c.toString(16)
    }).join('')}`
  }

  /**
   * @todo add toRBB() function from hsl() function
   */

  toHSL(): [number, number, number] {
    let [r, g, b] = this.rgb
    r /= 255
    g /= 255
    b /= 255

    let max = Math.max(r, g, b)
    let min = Math.min(r, g, b)
    let h: number
    let s: number
    let l = (max + min) / 2
    let d = max - min

    if (max === min) {
      h = s = 0
    } else {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break
        case g: h = (b - r) / d + 2; break
        case b: h = (r - g) / d + 4; break
      }
      h! /= 6
    }
    return [h! * 360, s, l]
  }

  toTrimmedString() {
    let { value } = this
    /** This is a hex value or keyword, output as-is */
    if (typeof value === 'string') {
      return value
    }
    let colorFunction: string | undefined

    if (value === ColorFormat.RGB) {
      if (this.alpha < 1) {
        colorFunction = 'rgba'
      } else {
        colorFunction = 'rgb'
      }
    } else if (value === ColorFormat.HSL) {
      if (this.alpha < 1) {
        colorFunction = 'hsla'
      } else {
        colorFunction = 'hsl'
      }
    } else {
      return this.toHex()
    }

    let alpha = this.alpha
    let args: any[] = []

    switch (colorFunction) {
      case 'rgba':
        args.push(clamp(alpha, 1))
      case 'rgb': // eslint-disable-line no-fallthrough
        args = this.rgb.map(function(c) {
          return clamp(Math.round(c), 255)
        }).concat(args)
        break
      case 'hsla':
        args.push(clamp(alpha, 1))
      case 'hsl': { // eslint-disable-line no-fallthrough
        let [h, s, l] = this.hsla
        args = [
          this.fround(h),
          `${this.fround(s * 100)}%`,
          `${this.fround(l * 100)}%`
        ].concat(args)
      }
    }

    /** @todo - represent with slash syntax? */
    return `${colorFunction}(${args.join(', ')})`
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add(this.toString(), this.location)
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add(`$J.color("${this.value}")`)
  // }
}

export const color = defineType(Color, 'Color')