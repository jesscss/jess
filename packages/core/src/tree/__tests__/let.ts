import { set, expr, coll, keyval, anon } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Let', () => {
  beforeEach(() => {
    context = new Context()
    context.depth = 1
    out = new OutputCollector()
  })

  it('should serialize a @let', () => {
    context.depth = 2
    let rule = set(keyval({
      name: 'brandColor',
      value: expr([any('#eee')])
    }))
    expect(`${rule}`).toBe('@let brandColor: #eee;')
    rule.toModule(context, out)
    expect(out.toString()).toBe('let brandColor = $J.expr([$J.any("#eee")])')
  })

  it('should serialize a @let collection', () => {
    let rule = set(
      keyval({
        name: 'brand',
        value: coll([
          keyval({
            name: 'global',
            value: coll([
              keyval({
                name: 'dark',
                value: any('#000')
              })
            ])
          }),
          keyval({
            name: 'dark',
            value: any('#222')
          }),
          keyval({
            name: 'light',
            value: any('#eee')
          })
        ])
      })
    )
    expect(`${rule}`).toBe(
      '@let brand {\n  global {\n    dark: #000;\n  }\n  dark: #222;\n  light: #eee;\n}'
    )
    rule.toModule(context, out)
    expect(out.toString()).toBe(
      'brand = $J.merge({}, $J.get($VARS, \'brand\'))\nbrand.global = {}\nbrand.global.dark = $J.get($VARS, \'brand.global.dark\', $J.any("#000"))\nbrand.dark = $J.get($VARS, \'brand.dark\', $J.any("#222"))\nbrand.light = $J.get($VARS, \'brand.light\', $J.any("#eee"))\n'
    )
  })
})