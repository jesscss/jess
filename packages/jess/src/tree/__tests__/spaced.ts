import { expect } from 'chai'
import 'mocha'
import { num, spaced } from '..'

describe('Spaced', () => {
  it('should serialize a spaced expression', () => {
    const rule = spaced([num(10), num(20), num(30)])
    expect(`${rule}`).to.eq('10 20 30')
  })
})