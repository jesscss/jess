import ceil from '../ceil'
import { Context, Dimension } from '@jesscss/core'
import { beforeAll, describe, it, expect } from 'vitest'

let context: Context

describe('ceil', () => {
  beforeAll(() => {
    context = new Context()
  })
  it('rejects a non-dimension', () => {
    // @ts-expect-error - incorrect type
    expect(() => ceil('1')).toThrowError('"value" argument must be numeric')
  })

  it('floors correctly', () => {
    expect(ceil.call(context, new Dimension([1.1]))).toEqual(new Dimension([2, '']))
  })
})