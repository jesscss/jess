
import {
  abs,
  acos,
  asin,
  atan,
  ceil,
  cos,
  floor,
  sin,
  sqrt,
  tan
} from '../less'

import { Context, Dimension } from '@jesscss/core'
import { beforeAll, describe, it, test, expect } from 'vitest'

let context: Context
let dim: Dimension

describe('math', () => {
  beforeAll(() => {
    context = new Context()
    dim = new Dimension([2.4, 'px'])
  })
  it('rejects a non-dimension', () => {
    // @ts-expect-error - incorrect type
    expect(() => floor('1')).toThrowError('"value" argument must be numeric')
  })

  test('abs', () => {
    expect(abs.call(context, new Dimension([-2.4, 'px']))).toEqual(new Dimension([2.4, 'px']))
  })

  test('acos', () => {
    expect(acos.call(context, new Dimension([0.5, 'px']))).toEqual(new Dimension([1.0471975511965979, 'rad']))
  })

  test('asin', () => {
    expect(asin.call(context, new Dimension([0.5, 'px']))).toEqual(new Dimension([0.5235987755982989, 'rad']))
  })

  test('atan', () => {
    expect(atan.call(context, new Dimension([0.5, 'px']))).toEqual(new Dimension([0.4636476090008061, 'rad']))
  })

  test('ceil', () => {
    expect(ceil.call(context, dim)).toEqual(new Dimension([3, 'px']))
  })

  test('cos', () => {
    expect(cos.call(context, dim)).toEqual(new Dimension([-0.7373937155412454, '']))
  })

  test('floor', () => {
    expect(floor.call(context, dim)).toEqual(new Dimension([2, 'px']))
  })

  test('sin', () => {
    expect(sin.call(context, dim)).toEqual(new Dimension([0.675463180551151, '']))
  })

  test('sqrt', () => {
    expect(sqrt.call(context, dim)).toEqual(new Dimension([1.5491933384829668, 'px']))
  })

  test('tan', () => {
    expect(tan.call(context, dim)).toEqual(new Dimension([-0.9160142896734107, '']))
  })
})