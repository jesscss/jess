import { call, list, num } from '..'
import { Context } from '../../context'
// import { OutputCollector } from '../../output'

let context: Context
// let out: OutputCollector
describe('Call', () => {
  beforeEach(() => {
    context = new Context()
    // out = new OutputCollector()
  })
  it('should serialize to CSS', () => {
    let rule = call({
      ref: 'rgb',
      args: list([num(100), num(100), num(100)])
    })
    expect(`${rule}`).toBe('rgb(100, 100, 100)')
  })
  // it('should serialize to a module', () => {
  //   let rule = call({
  //     name: 'rgb',
  //     value: list([num(100), num(100), num(100)])
  //   })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.call({\n  name: "rgb",\n  value: $J.list([\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    })\n  ]),\n  ref: () => rgb,\n})'
  //   )
  // })
})