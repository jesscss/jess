import { dimension } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Dimension', () => {
  beforeEach(() => {
    context = new Context()
    out = new OutputCollector()
  })
  it('should make a dimension from a string', () => {
    let rule = dimension('10px')
    let clone = rule.clone()
    expect(rule.value).toBe(10)
    expect(clone.value).toBe(10)
    expect(rule.unit).toBe('px')
    expect(rule.toString()).toBe('10px')
  })
  it('should make a dimension from a number', () => {
    let rule = dimension(10)
    expect(rule.value).toBe(10)
    expect(rule.toString()).toBe('10')
  })
  it('should serialize to a module', () => {
    let rule = dimension('10px')
    rule.toModule(context, out)
    expect(out.toString()).toBe('$J.num({\n  value: 10,\n  unit: "px"\n})')
  })
})