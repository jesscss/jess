
import {
  iif
} from '../less'

import { Condition, Context, Dimension } from '@jesscss/core'
import { beforeAll, describe, it, test, expect } from 'vitest'

let context: Context
let dim: Dimension

describe('math', () => {
  beforeAll(() => {
    context = new Context()
    dim = new Dimension([2.4, 'px'])
  })
  it('rejects a non-condition', () => {
    // @ts-expect-error - incorrect type
    expect(() => iif(new Condition([new Dimension([1, 'px'])]))).toThrowError('"value" argument must be numeric')
  })
})