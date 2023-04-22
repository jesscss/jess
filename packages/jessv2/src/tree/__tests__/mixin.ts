import { expect } from 'chai'
import 'mocha'
import { mixin, expr, coll, decl, anon, ruleset, ident } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Mixin', () => {
  beforeEach(() => {
    context = new Context
    context.depth = 2
    out = new OutputCollector
  })

  it('should serialize to a module', () => {
    let rule = mixin({
      name: ident('myMixin'),
      value: ruleset([
        decl({ name: 'color', value: anon('black')}),
        decl({ name: 'background-color', value: anon('white')})
      ])
    })
    rule.toModule(context, out)
    expect(out.toString()).to.eq(
      'let myMixin = function() { return $J.ruleset(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.anon("color"),\n      value: $J.anon("black")\n    }))\n    $OUT.push($J.decl({\n      name: $J.anon("background-color"),\n      value: $J.anon("white")\n    }))\n    return $OUT\n  })()\n)}'
    )
    expect(rule.value.obj()).to.deep.eq({
      "color": "black",
      "background-color": "white"
    })
  })
})