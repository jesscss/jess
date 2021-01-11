import { expect } from 'chai'
import 'mocha'
import { decl, spaced, expr } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector
describe('Declaration', () => {
  beforeEach(() => {
    context = new Context
    out = new OutputCollector
  })
  it('should serialize to CSS', () => {
    const rule = decl({ name: expr(['color']), value: spaced(['#eee']) })
    expect(`${rule}`).to.eq('color: #eee;')
  })
  it('should serialize to a module', () => {
    const rule = decl({ name: expr(['color']), value: spaced(['#eee']) })
    rule.toModule(context, out)
    expect(out.toString()).to.eq('_J.decl({\n  name: _J.expr(["color"])\n  value: _J.spaced(["#eee"])\n})')
  })
})