import { expect } from 'chai'
import 'mocha'
import { root, amp, rule, sel, el, expr, list, ruleset, decl } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector
describe('Ampersand', () => {
  beforeEach(() => {
    context = new Context
    out = new OutputCollector
  })
  it('should inherit selectors', () => {
    /** We need a root node to bubble rules */
    let node = root([
      rule({
        sels: list([sel([el('.one'), el('.two')])]),
        value: ruleset([
          decl({ name: 'chungus', value: expr(['foo', ' ', 'bar']) }),
          rule({ sels: expr([amp()]), value:
            ruleset([
              decl({ name: 'chungus', value: expr(['bar', ' ', 'foo']) })
            ])
          })
        ])
      })
    ])
    node = node.eval(context)
    expect(`${node}`).to.eq('.one.two {\n  chungus: foo bar;\n}\n.one.two {\n  chungus: bar foo;\n}\n')
  })

  it('should serialize to a module', () => {
    const node = expr([amp()])
    node.toModule(context, out)
    expect(out.toString()).to.eq('$J.expr([$J.amp()])')
  })
})