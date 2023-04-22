import type { Context } from '../context'
import type { OutputCollector } from '../output'
import { Node, isNodeMap, LocationInfo } from './node'

type RGBA = [number, number, number, number] | number[]

function clamp(v: number, max: number) {
  return Math.min(Math.max(v, 0), max)
}

export class Color extends Node {
  value: string
  _rgba: RGBA

  constructor(
    val?: string | { value: string, rgba?: RGBA },
    location?: LocationInfo
  ) {
    if (isNodeMap(val)) {
      const { value, rgba } = val
      super({ value }, location)
      this._rgba = rgba
      return
    }
    super({ value: val }, location)
  }

  /** Create an rgba map only if we need it */
  get rgba(): RGBA {
    if (!this._rgba) {
      const value = this.value
      const rgba: number[] = []

      if (value.charAt(0) !== '#') {
        throw new Error(`Only hex string values can be converted to colors.`)
      }
      const hex = value.slice(1)

      if (hex.length >= 6) {
        (<RegExpMatchArray>hex.match(/.{2}/g)).map((c, i) => {
          if (i < 3) {
            rgba.push(parseInt(c, 16))
          } else {
            rgba.push(parseInt(c, 16) / 255)
          }
        })
      } else {
        hex.split('').map((c, i) => {
          if (i < 3) {
            rgba.push(parseInt(c + c, 16))
          } else {
            rgba.push(parseInt(c + c, 16) / 255)
          }
        })
      }
      /** Make sure an alpha value is present */
      if (rgba.length === 3) {
        rgba.push(1)
      }
      this._rgba = <RGBA>rgba
      return <RGBA>rgba
    }
    return this._rgba
  }

  get rgb(): [number, number, number] {
    const [r, g, b] = this.rgba
    return [r, g, b]
  }

  get alpha(): number {
    return this.rgba[3]
  }

  toHex() {
    return `#${this.rgb.map(c => {
      c = clamp(Math.round(c), 255)
      return (c < 16 ? '0' : '') + c.toString(16)
    }).join('')}`
  }

  toHSL() {
    const r = this.rgb[0] / 255
    const g = this.rgb[1] / 255
    const b = this.rgb[2] / 255
    const a = this.alpha

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h: number
    let s: number
    const l = (max + min) / 2
    const d = max - min

    if (max === min) {
      h = s = 0
    } else {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break
        case g: h = (b - r) / d + 2;               break
        case b: h = (r - g) / d + 4;               break
      }
      h /= 6
    }
    return { h: h * 360, s, l, a }
  }

  toString() {
    const value = this.value
    let colorFunction: string

    /**
     * If we haven't operated on this value, like with a color
     * function, then value should be the original parsed value
     * 
     * If we used an rgb()-like function, then value is the
     * color function name.
     */
    if (value) {
      if (value.indexOf('rgb') === 0) {
        if (this.alpha < 1) {
          colorFunction = 'rgba'
        } else {
          colorFunction = 'rgb'
        }
      } else if (value.indexOf('hsl') === 0) {
        if (this.alpha < 1) {
          colorFunction = 'hsla'
        } else {
          colorFunction = 'hsl'
        }
      } else {
        return value
      }
    } else {
      if (this.alpha < 1) {
        colorFunction = 'rgba'
      }
    }

    const alpha = this.alpha
    let args: any[] = []

    switch (colorFunction) {
      case 'rgba':
        args.push(clamp(alpha, 1))
      case 'rgb':  // eslint-disable-line no-fallthrough
        args = this.rgb.map(function (c) {
          return clamp(Math.round(c), 255)
        }).concat(args)
        break
      case 'hsla':
        args.push(clamp(alpha, 1))
      case 'hsl': { // eslint-disable-line no-fallthrough
        const color = this.toHSL()
        args = [
          this.fround(color.h),
          `${this.fround(color.s * 100)}%`,
          `${this.fround(color.l * 100)}%`
        ].concat(args)
      }
    }

    if (colorFunction) {
      return `${colorFunction}(${args.join(', ')})`
    }

    return this.toHex()
  }

  toCSS(context: Context, out: OutputCollector) {
    out.add(this.toString(), this.location)
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.color("${this.value}")`)
  }
}
Color.prototype.type = 'Color'

export const color =
  (value?: string | { value: string, rgba?: RGBA }, location?: LocationInfo) =>
    new Color(value, location)