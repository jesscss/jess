import { Dimension } from '@jesscss/core'

export default function floor(n: Dimension) {
  return new Dimension([Math.floor(n.number), n.unit])
}

if (import.meta.vitest) {
  const { it, expect, describe } = import.meta.vitest

  describe('floor', () => {
    it('rejects a non-dimension', () => {
      // @ts-expect-error - incorrect type
      expect(() => floor('1')).toThrow()
    })

    it('floors correctly', () => {
      expect(floor(new Dimension([1.1]))).toEqual(new Dimension([1]))
    })
  })
}