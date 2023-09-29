import { Scope } from '../index'
import { decl, mixin, any, ruleset, num } from '../../tree'
import { logger } from '../../logger'

vi.spyOn(logger, 'warn')

let scope: Scope

describe('Scope - Nodes', async () => {
  beforeEach(() => {
    scope = new Scope()
  })

  describe('set / get declaration', () => {
    it('can do a normal get / set of a declaration', () => {
      let node = decl({ name: 'foo', value: any('bar') })
      scope.setProp('foo', node)
      expect(scope.getProp('foo')).toBe(node)
    })

    it('will return the last un-merged declaration', () => {
      scope.setProp('foo', decl({ name: 'prop', value: any('one') }))
      scope.setProp('foo', decl({ name: 'prop', value: any('two') }, { merge: 'list' }))
      scope.setProp('foo', decl({ name: 'prop', value: any('three') }))
      expect(`${scope.getProp('foo')}`).toBe('prop: three;')
    })

    it('will return a merged declaration', () => {
      scope.setProp('prop', decl({ name: 'prop', value: any('one') }, { merge: 'list' }))
      scope.setProp('prop', decl({ name: 'prop', value: any('two') }, { merge: 'list' }))
      expect(`${scope.getProp('prop')}`).toBe('prop: one, two;')
    })

    it('will return a space-merged declaration', () => {
      scope.setProp('prop', decl({ name: 'prop', value: any('one') }, { merge: 'spaced' }))
      scope.setProp('prop', decl({ name: 'prop', value: any('two') }))
      let inherited = new Scope(scope)
      inherited.setProp('prop', decl({ name: 'prop', value: any('three') }, { merge: 'spaced' }))
      expect(`${inherited.getProp('prop')}`).toBe('prop: one three;')
    })

    it('does not return parent mixins if shadowed', async () => {
      const mix = mixin({ name: 'foo', value: ruleset([any('value')]) })
      scope.setMixin('foo', mix)
      expect(scope.getMixin('foo')).toBeTypeOf('function')
      let inherited = new Scope(scope)
      expect(inherited.getMixin('foo')).toBeTypeOf('function')
      inherited.setMixin('foo', mixin({ name: 'foo', value: ruleset([decl({ name: 'one', value: num(1) })]) }))
      expect(inherited.getMixin('foo')).toBeTypeOf('function')
      inherited.setMixin('foo', mixin({ name: 'foo', value: ruleset([decl({ name: 'two', value: num(2) })]) }))

      const mix2 = inherited.getMixin('foo')
      if (mix2) {
        let returnVal = await mix2()
        expect(returnVal).toStrictEqual({
          one: '1',
          two: '2'
        })
      }
    })
  })

  describe('warnings', () => {

  })

  describe('errors', () => {

  })
})