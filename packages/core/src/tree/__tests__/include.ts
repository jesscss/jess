import { include, rule, sel, el } from '..'
import { Context } from '../../context'

let context: Context

describe('Include', () => {
  beforeEach(() => {
    context = new Context()
  })
  it('should be able to include an object', () => {
    let obj = {
      width: '50px',
      height: '25px'
    }

    let node = rule({
      selector: el('.rule'),
      value: [
        include(obj)
      ]
    })
    let result = node.eval(context)
    expect(`${result}`).toBe('.rule {\n  width: 50px;\n  height: 25px;\n}')
  })

  it('should serialize a module', () => {
    let rule = el('foo')
    rule.toModule(context, out)
    expect(out.toString()).toBe('$J.el($J.any("foo"))')
  })
})