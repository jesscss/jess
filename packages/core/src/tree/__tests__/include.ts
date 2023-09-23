import { include, rule, sel, ref, any, ruleset, mixin, mixinbody, decl, call } from '..'
import { Context } from '../../context'

let context: Context

describe('Include', () => {
  beforeEach(() => {
    context = new Context()
  })
  it('should include a mixin', async () => {
    let node = ruleset([
      mixin({
        name: 'foo',
        value: mixinbody({
          value: ruleset([
            decl({ name: 'prop1', value: any('value') })
          ])
        })
      }),
      mixin({
        name: 'foo',
        value: mixinbody({
          value: ruleset([
            decl({ name: 'prop2', value: any('value') })
          ])
        })
      }),
      include(call({
        ref: ref('foo', { type: 'mixin' })
      }))
    ])
    let evald = await node.eval(context)
    expect(`${evald}`).toBeString('')
  })
  // it('should be able to include an object', () => {
  //   let obj = {
  //     width: '50px',
  //     height: '25px'
  //   }

  //   let node = rule({
  //     selector: el('.rule'),
  //     value: [
  //       include(obj)
  //     ]
  //   })
  //   let result = node.eval(context)
  //   expect(`${result}`).toBe('.rule {\n  width: 50px;\n  height: 25px;\n}')
  // })

  // it('should serialize a module', () => {
  //   let rule = el('foo')
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.el($J.any("foo"))')
  // })
})