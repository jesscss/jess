import { include, rule, sel, el } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Include', () => {
  beforeEach(() => {
    context = new Context()
    out = new OutputCollector()
  })
  it('should be able to include an object', () => {
    const obj = {
      width: '50px',
      height: '25px'
    }

    const node = rule({
      sels: el('.rule'),
      value: [
        include(obj)
      ]
    })
    const result = node.eval(context)
    expect(`${result}`).toBe('.rule {\n  width: 50px;\n  height: 25px;\n}')
  })

  it('should serialize a module', () => {
    const rule = el('foo')
    rule.toModule(context, out)
    expect(out.toString()).toBe('$J.el($J.anon("foo"))')
  })
})