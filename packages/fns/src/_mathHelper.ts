import { Dimension } from '@jesscss/core'

export const mathHelper = (
  fn: (num: number) => number,
  unit: string | undefined,
  n: Dimension | number
) => {
  if (!(n instanceof Dimension) && typeof n !== 'number') {
    throw new TypeError('"value" argument must be numeric')
  }
  let num = n instanceof Dimension ? n.number : n
  unit ??= n instanceof Dimension ? n.unit : ''
  return new Dimension([fn(num), unit])
}