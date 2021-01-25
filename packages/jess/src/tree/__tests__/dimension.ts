import { expect } from 'chai'
import 'mocha'
import { dimension } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Dimension', () => {
  beforeEach(() => {
    context = new Context
    out = new OutputCollector
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
    rule.toModule(context, out)
    expect(out.toString()).to.eq('$J.num({\n  value: 10,\n  unit: "px"\n})')
  })
})