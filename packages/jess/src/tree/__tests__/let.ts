import { expect } from 'chai'
import 'mocha'
import { set, expr, coll, decl, str } from '..'
import { Context } from '../../context'

let context: Context

describe('Let', () => {
  beforeEach(() => {
    context = new Context()
  })

  it('should serialize a @let', () => {
    let rule = set({
      name: 'brandColor',
      value: expr(['#eee'])
    }) 
    expect(`${rule}`).to.eq('@let brandColor: #eee;')
    expect(rule.toModule(context)).to.eq('export let brandColor = J.expr(["#eee"])')
  })

  it('should serialize a @let collection', () => {
    let rule = set({
      name: 'brand',
      value: coll([
        decl({
          name: 'dark',
          value: str('#222')
        }),
        decl({
          name: 'light',
          value: str('#eee')
        })
      ])
    }) 
    expect(`${rule}`).to.eq(
      '@let brand {\n  dark: #222;\n  light: #eee;}'
    )
    expect(rule.toModule(context)).to.eq(
      'export let brand = {\n  "dark": "#222",\n  "light": "#eee"}'
    )
  })
})