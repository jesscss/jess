import { Dimension } from '@jesscss/core'

const { isArray } = Array

export function num(values: Dimension | number): number
export function num(values: Array<Dimension | number>): number[]
export function num(values: Dimension | number | Array<Dimension | number>): number | number[] {
  if (isArray(values)) {
    return values.map(n => n instanceof Dimension ? n.number : n)
  }
  return values instanceof Dimension ? values.number : values
}

export const mathHelper = (
  fn: (...nums: number[]) => number,
  params: string[],
  unit: string | undefined,
  ...input: Array<Dimension | number>
) => {
  let key = 0
  for (const n of input) {
    if (!(n instanceof Dimension) && typeof n !== 'number') {
      let name = params[key++]
      name = name ? `"${name}" ` : ''
      throw new TypeError(`${name}argument must be numeric`)
    }
  }
  const val = input[0]
  unit ??= val instanceof Dimension ? val.unit : ''
  return new Dimension([fn(...num(input)), unit])
}