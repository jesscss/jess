import { expect } from 'chai'
import 'mocha'
import { set, expr, coll, decl, anon } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Let', () => {
  beforeEach(() => {
    context = new Context
    out = new OutputCollector
  })

  it('should serialize a @let', () => {
    let rule = set({
      name: 'brandColor',
      value: expr(['#eee'])
    }) 
    expect(`${rule}`).to.eq('@let brandColor: #eee;')
    rule.toModule(context, out)
    expect(out.toString()).to.eq('export let brandColor = J.expr(["#eee"])')
  })

  it('should serialize a @let collection', () => {
    let rule = set({
      name: 'brand',
      value: coll([
        decl({
          name: 'dark',
          value: anon('#222')
        }),
        decl({
          name: 'light',
          value: anon('#eee')
        })
      ])
    }) 
    expect(`${rule}`).to.eq(
      '@let brand {\n  dark: #222;\n  light: #eee;}'
    )
    rule.toModule(context, out)
    expect(out.toString()).to.eq(
      'export let brand = {\n  "dark": "#222",\n  "light": "#eee"}'
    )
  })
})