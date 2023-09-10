import { Scope } from '../index'

let scope: Scope

describe('Scope', () => {
  beforeEach(() => {
    scope = new Scope()
  })

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