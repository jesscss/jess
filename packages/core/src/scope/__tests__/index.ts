import { decl, any } from '../../tree'
import { Scope } from '../index'
import { logger } from '../../logger'

vi.spyOn(logger, 'warn')

let scope: Scope

describe('Scope', async () => {
  beforeEach(() => {
    scope = new Scope()
  })

  describe('set / get', () => {
    it('can do a normal get / set of properties', () => {
      scope.setProp('foo', decl({ name: 'foo', value: any('bar') }))
      expect(`${scope.getProp('foo')}`).toBe('foo: bar;')
    })

    it('can do a normal get / set of variables', () => {
      scope.setVar('foo', 'bar')
      expect(scope.getVar('foo')).toBe('bar')
    })

    it('replaces variable values', () => {
      scope.setVar('one', 'one')
      scope.setVar('one', 'two')
      expect(scope.getVar('one')).toBe('two')
    })

    it('will skip normalization', () => {
      scope.setVar('one', 'one', { isNormalized: true, protected: true })
      expect(scope.getVar('one')).toEqual('one')
    })

    it('will not set if defined', () => {
      scope.setVar('one', 'one')
      scope.setVar('one', 'two', { setIfUndefined: true })
      expect(scope.getVar('one')).toEqual('one')
    })

    it('doesn\'t throw error if suppressed', () => {
      expect(scope.getVar('one', { suppressUndefinedError: true })).toBeUndefined()
    })
  })

  describe('scope inheritance', () => {
    it('inherits values when set before', () => {
      scope.setVar('foo', 'bar')
      let inherited = new Scope(scope)
      expect(inherited.getVar('foo')).toBe('bar')
    })

    it('inherits values when set after', () => {
      let inherited = new Scope(scope)
      scope.setVar('foo', 'bar')
      expect(inherited.getVar('foo')).toBe('bar')
    })

    it('shadows variables', () => {
      let inherited = new Scope(scope)
      scope.setVar('one', 'two')
      inherited.setVar('one', 'three')
      expect(scope.getVar('one')).toBe('two')
      expect(inherited.getVar('one')).toBe('three')
    })

    it('sets existing variables', () => {
      let inherited = new Scope(scope)
      scope.setVar('one', 'two')
      inherited.setVar('one', 'three', { setDefined: true })
      expect(scope.getVar('one')).toBe('three')
      expect(inherited.getVar('one')).toBe('three')
    })

    it('can deeply inherit scope', () => {
      let child = new Scope(scope)
      scope.setVar('one', 'one')
      scope.setVar('root', 'value')
      child.setVar('foo', 'bar')
      child.setVar('one', 'two')
      let grandChild = new Scope(child)
      grandChild.setVar('one', 'three')

      // inherited.setVar('one', 'three', { setDefined: true })
      expect(scope.getVar('one')).toBe('one')
      expect(grandChild.getVar('one')).toBe('three')
      expect(grandChild.getVar('foo')).toBe('bar')
      expect(grandChild.getVar('root')).toBe('value')
    })

    it('can merge child scope into parent scope', () => {
      scope.setProp('foo', decl({ name: 'foo', value: any('one') }, { merge: 'list' }))
      let child = new Scope()
      child.setProp('foo', decl({ name: 'foo', value: any('two') }, { merge: 'list' }))
      scope.merge(child)
      expect(`${scope.getProp('foo')}`).toEqual('foo: one, two;')
    })

    it('will leak undefined vars', () => {
      let child = new Scope()
      child.setVar('one', 'two')
      scope.options.leakVariablesIntoScope = true
      scope.merge(child)
      expect(scope.getVar('one')).toEqual('two')
    })

    it('will not leak defined vars', () => {
      let child = new Scope()
      child.setVar('one', 'two')
      scope.options.leakVariablesIntoScope = true
      scope.setVar('one', 'one')
      scope.merge(child)
      expect(scope.getVar('one')).toEqual('one')
    })
  })

  describe('key normalization', () => {
    it('normalizes into camel case', () => {
      expect(scope.normalizeKey('foo-bar')).toBe('fooBar')
    })
    it('changes a starting dash to underscore', () => {
      expect(scope.normalizeKey('-foo-bar')).toBe('_fooBar')
    })
    it('replaces a leading "." or "#"', () => {
      expect(scope.normalizeKey('.foo-bar')).toBe('fooBar')
      expect(scope.normalizeKey('#foo-bar')).toBe('FooBar')
    })
  })

  describe('warnings', () => {
    it('warns if keys are normalized differently', () => {
      scope.setVar('foo-bar', 'one')
      scope.setVar('fooBar', 'one')
      expect(logger.warn).toBeCalled()
    })

    it('warns if keys are normalized differently', () => {
      scope.setVar('.foo-bar', 'one')
      scope.setVar('fooBar', 'one')
      expect(logger.warn).toBeCalled()
    })
  })

  describe('errors', () => {
    it('throws if a variable is not defined', () => {
      expect(() => scope.getVar('foo')).toThrow()
    })

    it('throws if a property is not defined', () => {
      expect(() => scope.getProp('color')).toThrow()
    })

    it('throws if a variable is a reserved word', () => {
      expect(() => scope.setVar('protected', null)).toThrow()
    })

    it('throws if a variable starts with "$"', () => {
      expect(() => scope.setVar('$foo', null)).toThrow()
    })

    it('throws if a variable is not a valid JS identifier', () => {
      expect(() => scope.setVar('foo~~bar', null)).toThrow()
    })

    it('throws if a the variable is marked as protected', () => {
      scope.setVar('foo', 'one', { protected: true })
      expect(() => scope.setVar('foo', 'two')).toThrow()
    })

    it('throws if trying to set a variable which is unset', () => {
      expect(() => scope.setVar('foo', 'one', { setDefined: true })).toThrow()
    })

    it('throws if trying to declare a variable which is already declared', () => {
      scope.setVar('foo', 'one')
      expect(() => scope.setVar('foo', 'two', { throwIfDefined: true })).toThrow()
    })

    it('throws if all items are excluded, so no match found', () => {
      scope.setVar('one', 'one')
      scope.setVar('one', 'two')
      expect(() => scope.getVar('one', {
        filter: () => ({ value: Scope.NONE, done: false })
      })).toThrow()
    })
  })
})