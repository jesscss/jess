import { rules, list, sel, el, decl, ruleset, spaced, any } from '..'
import { Context } from '../../context'

let context: Context

describe('Rule', () => {
  beforeEach(() => {
    context = new Context()
  })
  it('should serialize to CSS', () => {
    let node = ruleset({
      selector: list([sel([el('foo')])]),
      rules: rules([
        decl({ name: 'border', value: spaced([any('1px'), any('solid'), any('black')]) }),
        decl({ name: 'color', value: any('#eee') })
      ])
    })
    expect(`${node}`).toBe('foo {\n  border: 1px solid black;\n  color: #eee;\n}')
  })
  // it('should serialize to a module', () => {
  //   let node = rule({
  //     selector: list([sel([el('foo')])]),
  //     value: [
  //       set(keyval({ name: 'brandColor', value: js('area(5)') })),
  //       decl({ name: 'color', value: js('brandColor') })
  //     ]
  //   })
  //   node.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.rule({\n  selector: $J.list([\n    $J.sel([$J.el($J.any("foo"))])\n  ]),\n  value: $J.ruleset(\n    (() => {\n      const $OUT = []\n      let brandColor = area(5)\n      $OUT.push($J.decl({\n        name: $J.any("color"),\n        value: brandColor\n      }))\n      return $OUT\n    })()\n  )},[])'
  //   )
  // })
})