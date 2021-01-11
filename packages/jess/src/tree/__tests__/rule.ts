import { expect } from 'chai'
import 'mocha'
import { rule, list, sel, el, decl, js, set, spaced, str } from '..'
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
        decl({ name: 'color', value: str('#eee') })
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
    expect(out.toString()).to.eq('J.rule({\n  sels: J.list([\n    J.sel([J.el("foo")])\n  ]),\n  value: (() => {\n    const __OUT = []\n    let brandColor = J.cast(area(5))\n    __OUT.push(J.decl({\n      name: "color"\n      value: J.cast(brandColor)\n    }))\n    return __OUT\n  )()\n})')
  })
})