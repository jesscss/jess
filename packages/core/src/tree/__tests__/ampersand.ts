import { root, amp, rule, sel, el, spaced, any, list, ruleset, decl } from '..'
import { Context } from '../../context'
// import { OutputCollector } from '../../output'

let context: Context
// let out: OutputCollector
describe('Ampersand', () => {
  beforeEach(() => {
    context = new Context()
    // out = new OutputCollector()
  })
  it('should inherit selectors', async () => {
    /** We need a root node to bubble rules */
    const initialNode = root([
      rule({
        selector: list([sel([el('.one'), el('.two')])]),
        value: ruleset([
          decl({ name: 'chungus', value: spaced([any('foo'), any('bar')]) }),
          rule({
            selector: sel([amp()]),
            value:
            ruleset([
              decl({ name: 'chungus', value: spaced([any('bar'), any('foo')]) })
            ])
          })
        ])
      })
    ])
    const node = await initialNode.eval(context)
    expect(`${node}`).toBe('.one.two {\n  chungus: foo bar;\n  & {\n    chungus: bar foo;\n  }\n}\n')
    // context = new Context({ collapseNesting: true })
    // node = await initialNode.eval(context)
    // expect(`${node}`).toBe('.one.two {\n  chungus: foo bar;\n}\n.one.two {\n  chungus: bar foo;\n}\n')
  })

  // it.skip('should serialize to a module', () => {
  //   const node = expr([amp()])
  //   node.toModule(context, out)
  //   expect(out.toString()).toBe('$J.expr([$J.amp()])')
  // })
})