import { expect } from 'chai'
import 'mocha'
import { list, spaced, num } from '..'
import { Context } from '../../context'

let context: Context

describe('List', () => {
  beforeEach(() => {
    context = new Context()
  })
  it('should serialize to a list', () => {
    const rule = list([spaced([num(1), '2', '3']), 'four'])
    expect(`${rule}`).to.eq('1 2 3, four')
  })
  it('should serialize to a module', () => {
    const rule = list([spaced(['1', '2', '3']), 'four'])
    expect(rule.toModule(context)).to.eq('J.list([\n  J.spaced(["1", "2", "3"]),\n  "four"\n])')
  })
})