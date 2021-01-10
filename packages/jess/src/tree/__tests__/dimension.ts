import { expect } from 'chai'
import 'mocha'
import { dimension } from '..'
import { Context } from '../../context'

let context: Context

describe('Dimension', () => {
  beforeEach(() => {
    context = new Context()
  })
  it('should make a dimension from a string', () => {
    const rule = dimension('10px')
    const clone = rule.clone()
    expect(rule.value).to.eq(10)
    expect(clone.value).to.eq(10)
    expect(rule.unit).to.eq('px')
    expect(rule.toString()).to.eq('10px')
  })
  it('should make a dimension from a number', () => {
    const rule = dimension(10)
    expect(rule.value).to.eq(10)
    expect(rule.toString()).to.eq('10')
  })
  it('should serialize to a module', () => {
    const rule = dimension('10px')
    expect(rule.toModule(context)).to.eq('J.decl({\n  value: 10\n  unit: "px"\n})\n')
  })
})