import combine from '../index'
import { expect, describe, it } from 'vitest'

describe('Combine', () => {
  it('combines arrays', () => {
    const combinations = [
      [true, 'red', 'light'],
      [true, 'blue', 'light'],
      [true, 'green', 'light'],
      [false, 'red', 'light'],
      [false, 'blue', 'light'],
      [false, 'green', 'light'],
      [true, 'red', 'dark'],
      [true, 'blue', 'dark'],
      [true, 'green', 'dark'],
      [false, 'red', 'dark'],
      [false, 'blue', 'dark'],
      [false, 'green', 'dark']
    ]
    const combined = [
      [true, false],
      ['red', 'blue', 'green'],
      ['light', 'dark']
    ]
    expect(combine(combinations)).toEqual(combined)
  })
})