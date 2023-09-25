import { mixin, mixinbody, ruleset, decl, any, condition, paren, ref } from '..'
import { Context } from '../../context'

let context: Context

describe('Mixin', () => {
  beforeEach(() => {
    context = new Context()
    context.depth = 2
  })

  describe('serialization', () => {
    it('should serialize a mixin', () => {
      const rule = mixin({
        name: 'myMixin',
        value: mixinbody({
          value: ruleset([
            decl({ name: 'color', value: any('black') }),
            decl({ name: 'background-color', value: any('white') })
          ])
        })
      })
      expect(`${rule}`).toBeString(`
        @mixin myMixin {
          color: black;
          background-color: white;
        }
      `)
    })

    it('should serialize a mixin with args', () => {
      const rule = mixin({
        name: 'my-mixin',
        value: mixinbody({
          params: new Map([
            ['a', any('black')],
            ['b', any('white')]
          ]),
          value: ruleset([
            decl({ name: 'color', value: any('black') }),
            decl({ name: 'background-color', value: any('white') })
          ])
        })
      })
      expect(`${rule}`).toBeString(`
        @mixin my-mixin($a: black, $b: white) {
          color: black;
          background-color: white;
        }
      `)
    })

    it('should serialize a guard', () => {
      const rule = mixin({
        name: 'my-mixin',
        value: mixinbody({
          params: new Map([
            ['a', any('black')],
            ['b', any('white')]
          ]),
          guard: condition([paren(condition([ref('a'), '=', ref('b')]))]),
          value: ruleset([
            decl({ name: 'color', value: any('black') }),
            decl({ name: 'background-color', value: any('white') })
          ])
        })
      })
      expect(`${rule}`).toBeString(`
        @mixin my-mixin($a: black, $b: white) when ($a = $b) {
          color: black;
          background-color: white;
        }
      `)
    })
  })

  // it('should serialize to a module', () => {
  //   let rule = mixin({
  //     name: ident('myMixin'),
  //     value: ruleset([
  //       decl({ name: 'color', value: any('black') }),
  //       decl({ name: 'background-color', value: any('white') })
  //     ])
  //   })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     'let myMixin = function() { return $J.ruleset(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.any("color"),\n      value: $J.any("black")\n    }))\n    $OUT.push($J.decl({\n      name: $J.any("background-color"),\n      value: $J.any("white")\n    }))\n    return $OUT\n  })()\n)}'
  //   )
  //   expect(rule.value.obj()).toEqual({
  //     color: 'black',
  //     'background-color': 'white'
  //   })
  // })
})