import { decl, spaced, color } from '..'
import { Context } from '../../context'

let context: Context
describe('Declaration', () => {
  beforeEach(() => {
    context = new Context()
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