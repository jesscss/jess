import { type Context } from '../context'
import { Color } from './color'
import {
  Node,
  NodeOptions,
  defineType
} from './node'

// import type { Context } from '../context'
// import type { OutputCollector } from '../output'

export type DimensionValue = [
  number: number,
  unit?: string
]

/**
 * A number or dimension
 */
export class Dimension extends Node<DimensionValue> {
  _unitToGroup: Map<string, ConversionGroup> | undefined
  get number() {
    return this.data.get('value')[0]
  }

  set number(v: number) {
    const value = this.data.get('value')
    this.data.set('value', [v, value[1]])
  }

  get unit() {
    return this.data.get('value')[1] ?? ''
  }

  set unit(v: string) {
    const value = this.data.get('value')
    this.data.set('value', [value[0], v])
  }

  /** @todo - abstract into calculate() function */
  _operateWithDimension(b: Dimension, op: '+' | '-' | '*' | '/') {

  }

  operate(b: Node, op: '+' | '-' | '*' | '/', context?: Context | undefined) {
    if (!(b instanceof Dimension || b instanceof Color)) {
      throw new Error(`Cannot operate on ${b.type}`)
    }
    let unitToGroup = this._unitToGroup
    if (!unitToGroup) {
      const lengthEntries: Array<[string, ConversionGroup]> = ['m', 'cm', 'mm', 'in', 'px', 'pt', 'pc'].map((unit) => [unit, ConversionGroup.Length])
      const durationEntries: Array<[string, ConversionGroup]> = ['s', 'ms'].map((unit) => [unit, ConversionGroup.Duration])
      const angleEntries: Array<[string, ConversionGroup]> = ['rad', 'deg', 'grad', 'turn'].map((unit) => [unit, ConversionGroup.Angle])
      const entries: Array<[string, ConversionGroup]> = lengthEntries.concat(durationEntries).concat(angleEntries)
      this._unitToGroup = unitToGroup = new Map(entries)
    }
    if (b instanceof Dimension) {
      let [aVal, aUnit] = this.value
      let [bVal, bUnit] = b.value

      if (!aUnit || !bUnit) {
        let outUnit = aUnit ?? bUnit
      }

      if (aUnit && bUnit) {
        if (aUnit === bUnit) {
          return new Dimension([aVal + bVal, aUnit])
        }
        const aGroup = unitToGroup.get(aUnit)
        const bGroup = unitToGroup.get(bUnit)
      }
    }
  }

  toTrimmedString() {
    let precision = 100000000
    let [number, unit = ''] = this.value
    number = Math.round(number * precision) / precision
    return `${number}${unit}`
  }

  unify(b: Dimension) {

  };

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add(this.toString(), this.location)
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const pre = context.pre
  //   out.add('$J.num({\n' +
  //     `  ${pre}value: ${this.value},\n` +
  //     `  ${pre}unit: "${this.unit ?? ''}"\n` +
  //     `${pre}})`
  //   , this.location)
  // }
}

const enum ConversionGroup {
  Length = 0,
  Duration = 1,
  Angle = 2
}

const conversions = {
  [ConversionGroup.Length]: {
    m: 1,
    cm: 0.01,
    mm: 0.001,
    in: 0.0254,
    px: 0.0254 / 96,
    pt: 0.0254 / 72,
    pc: 0.0254 / 72 * 12
  },
  [ConversionGroup.Duration]: {
    s: 1,
    ms: 0.001
  },
  [ConversionGroup.Angle]: {
    rad: 1 / (2 * Math.PI),
    deg: 1 / 360,
    grad: 1 / 400,
    turn: 1
  }
}

export const dimension = defineType(Dimension, 'Dimension')
type DimensionShortParams = Parameters<typeof dimension>
/** alias */
export const num = (
  value: number,
  location?: DimensionShortParams[1],
  options?: DimensionShortParams[2],
  fileInfo?: DimensionShortParams[3]
) => dimension([value], location, options, fileInfo)