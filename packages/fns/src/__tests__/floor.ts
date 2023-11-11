import floor from '../floor'
import { Context, Dimension } from '@jesscss/core'
import { beforeAll, describe, it, expect } from 'vitest'

let context: Context

describe('floor', () => {
  beforeAll(() => {
    context = new Context()
  })
  it('rejects a non-dimension', () => {
    // @ts-expect-error - incorrect type
    expect(() => floor('1')).toThrow()
  })

  it('floors correctly', () => {
    expect(floor.call(context, new Dimension([1.1]))).toEqual(new Dimension([1]))
  })
})