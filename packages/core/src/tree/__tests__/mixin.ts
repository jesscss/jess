import { mixin, expr, coll, decl, anon, ruleset, ident } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Mixin', () => {
  beforeEach(() => {
    context = new Context()
    context.depth = 2
    out = new OutputCollector()
  })

  it('should serialize to a module', () => {
    let rule = mixin({
      name: ident('myMixin'),
      value: ruleset([
        decl({ name: 'color', value: any('black') }),
        decl({ name: 'background-color', value: any('white') })
      ])
    })
    rule.toModule(context, out)
    expect(out.toString()).toBe(
      'let myMixin = function() { return $J.ruleset(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.any("color"),\n      value: $J.any("black")\n    }))\n    $OUT.push($J.decl({\n      name: $J.any("background-color"),\n      value: $J.any("white")\n    }))\n    return $OUT\n  })()\n)}'
    )
    expect(rule.value.obj()).toEqual({
      color: 'black',
      'background-color': 'white'
    })
  })
})