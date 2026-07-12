
import {
  iif
} from '../less'

import { Bool, Condition, Context, Dimension } from '@jesscss/core'
import { beforeAll, describe, it, test, expect } from 'vitest'

let context: Context
let dim: Dimension

describe('math', () => {
  beforeAll(() => {
    context = new Context()
    dim = new Dimension([2.4, 'px'])
  })
  /**
   * @todo - refine errors later
   * @see https://github.com/ianstormtaylor/superstruct/issues/1194
   */
  it('rejects a missing trueValue', async () => {
    // @ts-expect-error - missing arg
    await expect(iif(new Condition([new Dimension([1, 'px'])]))).rejects.toThrow() // At path: trueValue -- Expected a `Node` instance, but received: undefined
  })
  it('rejects an invalid condition', async () => {
    // @ts-expect-error - incorrect type
    await expect(iif(new Dimension([1, 'px']))).rejects.toThrow()  // At path: condition -- Expected a `Condition` instance, but received: 1px
  })

  test('iif (true)', async () => {
    await expect(iif.call(context, new Condition([new Dimension([1, 'px'])]), new Dimension([2, 'px']))).resolves.toMatchObject(new Dimension([2, 'px']))
  })

  test('iif (false)', async () => {
    await expect(iif.call(context, new Bool(false), new Dimension([2, 'px']), new Dimension([3, 'px']))).resolves.toMatchObject(new Dimension([3, 'px']))
  })

  /** @todo - add tests to make sure iif lazy evaluates true / false */
})