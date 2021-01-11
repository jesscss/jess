import { expect } from 'chai'
import 'mocha'
import { rule, list, sel, el, decl, js, set, spaced, anon } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Rule', () => {
  beforeEach(() => {
    context = new Context
    out = new OutputCollector
  })
  it('should serialize to CSS', () => {
    const node = rule({
      sels: list([sel([el('foo')])]),
      value: [
        decl({ name: 'border', value: spaced(['1px', 'solid', 'black']) }),
        decl({ name: 'color', value: anon('#eee') })
      ]
    })
    expect(`${node}`).to.eq('foo {\n  border: 1px solid black;\n  color: #eee;\n}\n')
  })
  it('should serialize to a module', () => {
    const node = rule({
      sels: list([sel([el('foo')])]),
      value: [
        set({ name: 'brandColor', value: js('area(5)') }),
        decl({ name: 'color', value: js('brandColor') })
      ]
    })
    node.toModule(context, out)
    expect(out.toString()).to.eq('_J.rule({\n  sels: _J.list([\n    _J.sel([_J.el("foo")])\n  ]),\n  value: _J.ruleset(\n    (() => {\n      const __OUT = []\n      let brandColor = _J.cast(area(5))\n      __OUT.push(_J.decl({\n        name: "color"\n        value: _J.cast(brandColor)\n      }))\n      return __OUT\n    )()\n  )')
  })
})