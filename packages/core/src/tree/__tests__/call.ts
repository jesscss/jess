import { call, list, num } from '..'
import { Context } from '../../context'

let context: Context
describe('Call', () => {
  beforeEach(() => {
    context = new Context()
  })

  it('should serialize a CSS function', () => {
    let rule = call({
      ref: 'rgb',
      args: list([num(100), num(100), num(100)])
    })
    expect(`${rule}`).toBe('rgb(100, 100, 100)')
  })

  it('should serialize a mixin call', () => {
    let rule = call({
      ref: 'my-mixin',
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