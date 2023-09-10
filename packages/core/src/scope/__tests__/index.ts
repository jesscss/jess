import { Scope } from '../index'

let scope: Scope

describe('Scope', () => {
  beforeEach(() => {
    scope = new Scope()
  })

  describe('success', () => {
    it('can do a normal get / set of properties', () => {
      scope.setProp('foo', 'bar')
      expect(scope.getProp('foo')).toBe('bar')
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

    it('will create an array of props', () => {
      scope.setProp('one', 'one')
      scope.setProp('one', 'two')
      expect(scope.getProp('one')).toEqual(['one', 'two'])
    })

    it('will exclude an item', () => {
      scope.setProp('one', 'one')
      scope.setProp('one', 'two')
      expect(scope.getProp('one', {
        filter: value => ({ value: value === 'two' ? undefined : value, done: false })
      })).toEqual('one')
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

    it('throws if a the variable is marked as protected', () => {
      scope.setVar('foo', 'one', { protected: true })
      expect(() => scope.setVar('foo', 'two')).toThrow()
    })

    it('throws if trying to set a variable which is unset', () => {
      expect(() => scope.setVar('foo', 'one', { setDefined: true })).toThrow()
    })

    it('throws if trying to declare a variable which is already declared', () => {
      scope.setVar('foo', 'one', { throwIfDefined: true })
      expect(() => scope.setVar('foo', 'two', { throwIfDefined: true })).toThrow()
    })
  })
})