import { Node, LocationInfo } from '.'
import type { Context } from '../context'
import type { OutputCollector } from '../output'
import { isNodeMap } from './node'

type RGBA = [number, number, number, number] | number[]

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

  toModule(context: Context, out: OutputCollector) {
    out.add(`$J.color("${this.value}")`)
  }
}

export const color =
  (value?: string | { value: string, rgba?: RGBA }, location?: LocationInfo) =>
    new Color(value, location)