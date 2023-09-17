import { decl, spaced, expr, anon, color } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector
describe('Declaration', () => {
  beforeEach(() => {
    context = new Context()
    out = new OutputCollector()
  })
  it('should serialize to CSS', () => {
    let rule = decl({ name: 'color', value: color('#eee') })
    expect(`${rule}`).toBe('color: #eee;')
  })
  // it('should serialize to a module', () => {
  //   let rule = decl({ name: expr([any('color')]), value: spaced([any('#eee')]) })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.decl({\n  name: $J.expr([$J.any("color")]),\n  value: $J.spaced([$J.any("#eee")])\n})'
  //   )
  // })
})