import strict from 'assert/strict'
import { type Context, UnitMode } from '../context'
import { Color, ColorFormat } from './color'
import {
  Node,
  defineType
} from './node'
import { type Operator, calculate } from './util/calculate'

// import type { Context } from '../context'
// import type { OutputCollector } from '../output'

export type DimensionValue = [
  number: number,
  unit?: string
]

type LengthUnit = 'm' | 'cm' | 'mm' | 'in' | 'px' | 'pt' | 'pc'
type DurationUnit = 's' | 'ms'
type AngleUnit = 'rad' | 'deg' | 'grad' | 'turn'
type ConversionUnit = LengthUnit | DurationUnit | AngleUnit
type UnitMapEntries = Array<[ConversionUnit, ConversionGroup]>

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

  operate(b: Node, op: Operator, context?: Context | undefined): Dimension | Color {
    if (!(b instanceof Dimension || b instanceof Color)) {
      throw new TypeError(`Cannot operate on ${b.type}`)
    }
    let unitToGroup = this._unitToGroup
    if (!unitToGroup) {
      const lengthEntries: UnitMapEntries = ['m', 'cm', 'mm', 'in', 'px', 'pt', 'pc'].map((unit) => [unit as LengthUnit, ConversionGroup.Length])
      const durationEntries: UnitMapEntries = ['s', 'ms'].map((unit) => [unit as DurationUnit, ConversionGroup.Duration])
      const angleEntries: UnitMapEntries = ['rad', 'deg', 'grad', 'turn'].map((unit) => [unit as AngleUnit, ConversionGroup.Angle])
      const entries = lengthEntries.concat(durationEntries).concat(angleEntries)
      this._unitToGroup = unitToGroup = new Map(entries)
    }
    if (b instanceof Color) {
      let thisColor = new Color(ColorFormat.RGB).inherit(this)
      thisColor.rgb = [this.number, this.number, this.number]
      return thisColor.operate(b, op, context)
    }
    let [aVal, aUnit] = this.value
    let [bVal, bUnit] = b.value
    let isStrictMode = context?.opts.unitMode === UnitMode.STRICT

    if (bVal === 0 && op === '/') {
      throw new TypeError('Cannot divide by zero')
    }
    if (!aUnit || !bUnit) {
      let outUnit = aUnit ?? bUnit
      /** One or both doesn't have a unit, so just calculate the number */
      if (isStrictMode && bUnit && op === '/') {
        throw new TypeError('Cannot divide a number by a unit')
      }
      return new Dimension([calculate(aVal, op, bVal), outUnit])
    }

    if (aUnit === bUnit) {
      /** Both units match, so the now we have some choices */
      if (op === '+' || op === '-') {
        return new Dimension([calculate(aVal, op, bVal), aUnit])
      }
      if (isStrictMode) {
        if (op === '*') {
          throw new TypeError('Cannot multiply two units together')
        } else {
          /** Cancel units during division */
          return new Dimension([calculate(aVal, op, bVal)])
        }
      } else {
        return new Dimension([calculate(aVal, op, bVal), aUnit])
      }
    }
    const aGroup = unitToGroup.get(aUnit)
    const bGroup = unitToGroup.get(bUnit)

    if (aGroup === undefined || bGroup === undefined || aGroup !== bGroup) {
      if (isStrictMode) {
        /** Units don't match, and can't be converted */
        throw new TypeError('Incompatible units. Change the units or use the unit function')
      }
      /** Just coerce to the left-hand unit */
      return new Dimension([calculate(aVal, op, bVal), aUnit])
    }
    const group = conversions[bGroup]
    // @ts-expect-error - set up proper indexing later
    let atomicUnit = group[aUnit] as number
    // @ts-expect-error - set up proper indexing later
    let targetUnit = group[bUnit] as number

    bVal = bVal / (atomicUnit / targetUnit)
    return new Dimension([calculate(aVal, op, bVal), aUnit])
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
  } satisfies Record<LengthUnit, number>,
  [ConversionGroup.Duration]: {
    s: 1,
    ms: 0.001
  } satisfies Record<DurationUnit, number>,
  [ConversionGroup.Angle]: {
    rad: 1 / (2 * Math.PI),
    deg: 1 / 360,
    grad: 1 / 400,
    turn: 1
  } satisfies Record<AngleUnit, number>
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