import { expect } from 'chai'
import 'mocha'
import { decl, spaced, expr } from '..'
import { Context } from '../../context'

let context: Context
describe('Declaration', () => {
  beforeEach(() => {
    context = new Context
  })
  it('should serialize to CSS', () => {
    const rule = decl({ name: expr(['color']), value: spaced(['#eee']) })
    expect(`${rule}`).to.eq('color: #eee;')
  })
  it('should serialize to a module', () => {
    const rule = decl({ name: expr(['color']), value: spaced(['#eee']) })
    expect(rule.toModule(context)).to.eq('J.decl({\n  name: J.expr(["color"])\n  value: J.spaced(["#eee"])\n})')
  })
})