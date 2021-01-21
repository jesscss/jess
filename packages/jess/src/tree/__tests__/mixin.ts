import { expect } from 'chai'
import 'mocha'
import { mixin, expr, coll, decl, anon, ruleset } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Mixin', () => {
  beforeEach(() => {
    context = new Context({ global: true })
    out = new OutputCollector
  })

  it('should serialize to a module', () => {
    let rule = mixin({
      name: 'myMixin',
      value: ruleset([
        decl({ name: 'color', value: anon('black')}),
        decl({ name: 'background-color', value: anon('white')})
      ])
    })
    rule.toModule(context, out)
    expect(out.toString()).to.eq('export let myMixin = () => $J.ruleset(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: "color"\n      value: "black"\n    }))\n    $OUT.push($J.decl({\n      name: "background-color"\n      value: "white"\n    }))\n    return $OUT\n  })()\n)\nlet $BK_myMixin = myMixin')
  })
})