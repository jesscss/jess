import { decl, spaced, expr, anon } from '..'
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
    let rule = decl({ name: expr(['color']), value: spaced(['#eee']) })
    expect(`${rule}`).toBe('color: #eee;')
  })
  it('should serialize to a module', () => {
    let rule = decl({ name: expr([anon('color')]), value: spaced([anon('#eee')]) })
    rule.toModule(context, out)
    expect(out.toString()).toBe(
      '$J.decl({\n  name: $J.expr([$J.anon("color")]),\n  value: $J.spaced([$J.anon("#eee")])\n})'
    )
  })
})