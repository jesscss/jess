import { expect } from 'chai'
import 'mocha'
import { rule, list, sel, el, decl, js, set, spaced, anon, keyval } from '..'
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
    expect(`${node}`).to.eq('foo {\n  border: 1px solid black;\n  color: #eee;\n}')
  })
  it('should serialize to a module', () => {
    const node = rule({
      sels: list([sel([el('foo')])]),
      value: [
        set(keyval({ name: 'brandColor', value: js('area(5)') })),
        decl({ name: 'color', value: js('brandColor') })
      ]
    })
    node.toModule(context, out)
    expect(out.toString()).to.eq(
      '$J.rule({\n  sels: $J.list([\n    $J.sel([$J.el($J.anon("foo"))])\n  ]),\n  value: $J.ruleset(\n    (() => {\n      const $OUT = []\n      let brandColor = area(5)\n      $OUT.push($J.decl({\n        name: $J.anon("color"),\n        value: brandColor\n      }))\n      return $OUT\n    })()\n  )},[])'
    )
  })
})