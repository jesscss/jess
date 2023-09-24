import { Scope } from '../index'
import { decl, mixin, mixinbody, any } from '../../tree'
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

    it('does not return parent mixins if shadowed', () => {
      scope.setMixin('foo', 'mixin')
      expect(scope.getMixin('foo')).toBe('mixin')
      let inherited = new Scope(scope)
      expect(inherited.getMixin('foo')).toBe('mixin')
      inherited.setMixin('foo', 'new one')
      expect(inherited.getMixin('foo')).toBe('new one')
      inherited.setMixin('foo', 'new two')
      expect(inherited.getMixin('foo')).toStrictEqual(['new one', 'new two'])
      expect(scope.getMixin('foo')).toBe('mixin')
    })
  })

  describe('warnings', () => {

  })

  describe('errors', () => {

  })
})