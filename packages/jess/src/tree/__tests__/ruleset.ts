import { expect } from 'chai'
import 'mocha'
import { root, amp, rule, sel, el, expr, list, ruleset, decl, spaced } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector
describe('Ruleset', () => {
  beforeEach(() => {
    context = new Context
    out = new OutputCollector
  })

  it('should merge rulesets into rules', () => {
    /** We need a root node to bubble rules */
    let node = root([
      rule({
        sels: list([sel([el('.collapse')])]),
        value: ruleset([
          decl({ name: 'chungus', value: spaced(['foo', 'bar']) }),
          ruleset([
            decl({ name: 'bird', value: spaced(['in', 'hand']) })
          ])
        ])
      })
    ])
    node = node.eval(context)
    expect(`${node}`).to.eq('.collapse {\n  chungus: foo bar;\n  bird: in hand;\n}\n')
  })
})