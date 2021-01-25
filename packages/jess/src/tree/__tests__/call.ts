import { expect } from 'chai'
import 'mocha'
import { call, list, num } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector
describe('Call', () => {
  beforeEach(() => {
    context = new Context
    out = new OutputCollector
  })
  it('should serialize to CSS', () => {
    const rule = call({
      name: 'rgb',
      value: list([num(100), num(100), num(100)])
    })
    expect(`${rule}`).to.eq('rgb(100, 100, 100)')
  })
  it('should serialize to a module', () => {
    const rule = call({
      name: 'rgb',
      value: list([num(100), num(100), num(100)])
    })
    rule.toModule(context, out)
    expect(out.toString()).to.eq('$J.call({\n  name: "rgb",\n  value: $J.list([\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    })\n  ]),\n  ref: () => rgb,\n})')
  })
})