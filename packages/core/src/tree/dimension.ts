import {
  Node,
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

  // constructor(
  //   value: number | string | NodeMap,
  //   location?: LocationInfo
  // ) {
  //   if (isNodeMap(value)) {
  //     super(value, location)
  //     return
  //   } else if (value.constructor === Number) {
  //     super({ value }, location)
  //     return
  //   }
  //   const regex = /([-+]?[0-9]*(?:\.[0-9]+)?)(%|[a-z]*)/
  //   const found = (value as string).match(regex)
  //   if (!found) {
  //     throw { message: 'Not a valid dimension.' }
  //   }
  //   super({
  //     value: parseFloat(found[1]),
  //     unit: found[2]
  //   }, location)
  // }

  toTrimmedString() {
    let precision = 100000000
    let [number, unit = ''] = this.value
    number = Math.round(number * precision) / precision
    return `${number}${unit}`
  }

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

export const dimension = defineType(Dimension, 'Dimension')
type DimensionShortParams = Parameters<typeof dimension>
/** alias */
export const num = (
  value: number,
  location?: DimensionShortParams[1],
  options?: DimensionShortParams[2],
  fileInfo?: DimensionShortParams[3]
) => dimension([value])