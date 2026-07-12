import { expr, any } from '..'
import { Context } from '../../context'

let context: Context
describe('Expression', () => {
  beforeEach(() => {
    context = new Context()
  })

  it('should serialize an expression', () => {
    let rule = expr(any('foo'))
    expect(`${rule}`).toBe('#(foo)')
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