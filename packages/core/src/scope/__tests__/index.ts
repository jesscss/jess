import { e } from 'vitest/dist/types-3c7dbfa5'
import { Scope } from '../index'

let scope: Scope

describe('Scope', () => {
  beforeEach(() => {
    scope = new Scope()
  })

  describe('set / get', () => {
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

    it('will create an endless array of props', () => {
      scope.setProp('one', 'one')
      scope.setProp('one', 'two')
      scope.setProp('one', 'three')
      expect(scope.getProp('one')).toEqual(['one', 'two', 'three'])
    })

    it('will merge arrays with array of props', () => {
      scope.setProp('one', 'one')
      scope.setProp('one', 'two')
      scope.setProp('one', ['three', 'four'])
      expect(scope.getProp('one')).toEqual(['one', 'two', 'three', 'four'])
    })

    it('will exclude an item', () => {
      scope.setProp('one', 'one')
      scope.setProp('one', 'two')
      expect(scope.getProp('one', {
        filter: value => ({ value: value === 'two' ? undefined : value, done: false })
      })).toEqual('one')
    })
  })

  describe('scope inheritance', () => {
    it('inherits values when set before', () => {
      scope.setVar('foo', 'bar')
      const inherited = new Scope(scope)
      expect(inherited.getVar('foo')).toBe('bar')
    })

    it('inherits values when set after', () => {
      const inherited = new Scope(scope)
      scope.setVar('foo', 'bar')
      expect(inherited.getVar('foo')).toBe('bar')
    })

    it('shadows variables', () => {
      const inherited = new Scope(scope)
      scope.setVar('one', 'two')
      inherited.setVar('one', 'three')
      expect(scope.getVar('one')).toBe('two')
      expect(inherited.getVar('one')).toBe('three')
    })

    it('sets existing variables', () => {
      const inherited = new Scope(scope)
      scope.setVar('one', 'two')
      inherited.setVar('one', 'three', { setDefined: true })
      expect(scope.getVar('one')).toBe('three')
      expect(inherited.getVar('one')).toBe('three')
    })

    it('can deeply inherit scope', () => {
      const child = new Scope(scope)
      scope.setVar('one', 'one')
      scope.setVar('root', 'value')
      child.setVar('foo', 'bar')
      child.setVar('one', 'two')
      const grandChild = new Scope(child)
      grandChild.setVar('one', 'three')

      // inherited.setVar('one', 'three', { setDefined: true })
      expect(scope.getVar('one')).toBe('one')
      expect(grandChild.getVar('one')).toBe('three')
      expect(grandChild.getVar('foo')).toBe('bar')
      expect(grandChild.getVar('root')).toBe('value')
    })

    it('can merge child scope into parent scope', () => {
      scope.setVar('one', 'one')
      const child = new Scope()
      child.setVar('one', 'two')
      scope.assign(child)
      expect(scope.getVar('one')).toBe('two')
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