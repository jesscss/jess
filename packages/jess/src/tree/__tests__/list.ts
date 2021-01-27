import { expect } from 'chai'
import 'mocha'
import { list, spaced, num, anon } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('List', () => {
  beforeEach(() => {
    context = new Context
    out = new OutputCollector
  })
  it('should serialize to a list', () => {
    const rule = list([spaced([num(1), '2', '3']), 'four'])
    expect(`${rule}`).to.eq('1 2 3, four')
  })
  it('should serialize to a module', () => {
    const rule = list([spaced(['1', '2', '3']), 'four'])
    rule.toModule(context, out)
    expect(out.toString()).to.eq('$J.list([\n  $J.spaced([$J.anon("1"), $J.anon("2"), $J.anon("3")]),\n  "four"\n])')
  })
})