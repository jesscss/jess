import { Dimension } from '@jesscss/core'

const MathHelper = (
  fn: (num: number) => number,
  unit: string | undefined,
  n: Dimension
) => {
  if (!(n instanceof Dimension)) {
    throw new TypeError('argument must be a number')
  }
  return new Dimension([fn(n.number), unit])
}

export default MathHelper