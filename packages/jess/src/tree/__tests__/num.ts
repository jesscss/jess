import { expect } from 'chai'
import 'mocha'
import { num } from '..'

describe('Num', () => {
  it('should make a dimension from a string', () => {
    const rule = num('10px')
    const clone = rule.clone()
    expect(rule.value).to.eq(10)
    expect(clone.value).to.eq(10)
    expect(rule.unit).to.eq('px')
    expect(rule.toString()).to.eq('10px')
  })
  it('should make a dimension from a number', () => {
    const rule = num(10)
    expect(rule.toString()).to.eq('10')
  })
})