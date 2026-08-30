import { expect } from 'chai'
import 'mocha'
import { root, rule, sel, el, list, ruleset, decl, spaced, call, js } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector
describe('Ruleset', () => {
  beforeEach(() => {
    context = new Context
    context.id = 'testing'
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

  it('should output var() values', () => {
    context.opts.dynamic = true
    let node = ruleset([
      decl({ name: 'a', value: spaced([ js('obj.value'), call({ name: 'func', value: js('foo.bar') }) ])})
    ])
    node.toModule(context, out)
    expect(out.toString()).to.eq(
      '$J.ruleset(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.anon("a"),\n      value: $J.spaced([$J.call({\n        name: "var",\n        value: $J.list([\n          "--vtesting-0",\n          obj.value\n        ]),\n      }), $J.call({\n        name: "var",\n        value: $J.list([\n          "--vtesting-1",\n          $J.call({\n            name: "func",\n            value: foo.bar,\n            ref: () => func,\n          })\n        ]),\n      })])\n    }))\n    return $OUT\n  })()\n)'
    )
  })

  it('should output --var declarations', () => {
    context.opts.dynamic = true
    let node = ruleset([
      decl({ name: 'a', value: spaced([ js('obj.value'), call({ name: 'func', value: js('foo.bar') }) ])})
    ])
    context.isRuntime = true
    node.toModule(context, out)
    expect(out.toString()).to.eq(
      '$J.ruleset(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.anon("--vtesting-0"),\n      value: obj.value\n    }))\n$OUT.push($J.decl({\n      name: $J.anon("--vtesting-1"),\n      value: $J.call({\n        name: "func",\n        value: foo.bar,\n        ref: () => func,\n      })\n    }))\n    return $OUT\n  })()\n)'
    )
  })
})