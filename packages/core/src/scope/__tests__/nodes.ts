import { Scope } from '../index'
import { decl, mixin, any, rules, num, AssignmentType } from '../../tree'
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
      scope.setProp('foo', decl({ name: 'prop', value: any('two') }, { assign: AssignmentType.MergeList }))
      scope.setProp('foo', decl({ name: 'prop', value: any('three') }))
      expect(`${scope.getProp('foo')}`).toBe('prop: three;')
    })

    it('will return a merged declaration', () => {
      scope.setProp('prop', decl({ name: 'prop', value: any('one') }, { assign: AssignmentType.MergeList }))
      scope.setProp('prop', decl({ name: 'prop', value: any('two') }, { assign: AssignmentType.MergeList }))
      expect(`${scope.getProp('prop')}`).toBe('prop: one, two;')
    })

    it('will return a space-merged declaration', () => {
      scope.setProp('prop', decl({ name: 'prop', value: any('one') }, { assign: AssignmentType.MergeSequence }))
      scope.setProp('prop', decl({ name: 'prop', value: any('two') }))
      let inherited = new Scope(scope)
      inherited.setProp('prop', decl({ name: 'prop', value: any('three') }, { assign: AssignmentType.MergeSequence }))
      expect(`${inherited.getProp('prop')}`).toBe('prop: one three;')
    })

    it('does not return parent mixins if shadowed', async () => {
      const mix = mixin({ name: 'foo', rules: rules([any('value')]) })
      scope.setMixin('foo', mix)
      expect(scope.getMixin('foo')).toBeTypeOf('function')
      let inherited = new Scope(scope)
      expect(inherited.getMixin('foo')).toBeTypeOf('function')
      inherited.setMixin('foo', mixin({ name: 'foo', rules: rules([decl({ name: 'one', value: num(1) })]) }))
      expect(inherited.getMixin('foo')).toBeTypeOf('function')
      inherited.setMixin('foo', mixin({ name: 'foo', rules: rules([decl({ name: 'two', value: num(2) })]) }))

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