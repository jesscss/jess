import { expect } from 'chai'
import 'mocha'
import { set, expr, coll, keyval, anon } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Let', () => {
  beforeEach(() => {
    context = new Context({ global: true })
    out = new OutputCollector
  })

  it('should serialize a @let', () => {
    let rule = set(keyval({
      name: 'brandColor',
      value: expr(['#eee'])
    })) 
    expect(`${rule}`).to.eq('@let brandColor: #eee;')
    rule.toModule(context, out)
    expect(out.toString()).to.eq('export let brandColor = $J.expr([$J.anon("#eee")])\nlet $BK_brandColor = brandColor')
  })

  it('should serialize a @let collection', () => {
    let rule = set(
      keyval({
        name: 'brand', 
        value: coll([
          keyval({
            name: 'dark',
            value: anon('#222')
          }),
          keyval({
            name: 'light',
            value: anon('#eee')
          })
        ])
      })
    )
    expect(`${rule}`).to.eq(
      '@let brand {\n  dark: #222;\n  light: #eee;\n}'
    )
    rule.toModule(context, out)
    expect(out.toString()).to.eq(
      'export let brand = {\n  "dark": $J.anon("#222"),\n  "light": $J.anon("#eee")\n}\nlet $BK_brand = brand'
    )
  })
})