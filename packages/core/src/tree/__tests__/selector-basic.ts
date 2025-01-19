import { el, compound, sel } from '..'
import { Context } from '../../context'

let context: Context

describe('BasicSelector', () => {
  beforeEach(() => {
    context = new Context()
  })

  it('should identify a class', () => {
    let rule = el('.foo')
    expect(rule.isClass).toBe(true)
  })
  it('should identify an id', () => {
    let rule = el('#id')
    expect(rule.isId).toBe(true)
  })
  it('should identify a tag', () => {
    let rule = el('foo')
    expect(rule.isTag).toBe(true)
  })
  it('should identify a tag with escapes', () => {
    let rule = el('\\.foo')
    expect(rule.isTag).toBe(true)
  })

  test('keys', () => {
    let rule = el('.foo')
    expect(rule.keySet).toEqual(new Set(['.foo']))
  })

  describe('lists', () => {
    test('basic selectors are part of lists', () => {
      let a = el('a')
      let id = el('#id')
      let one = el('.one')
      let two = el('.two')

      let sel1 = compound([
        a,
        id,
        one,
        two
      ])
      let sel2 = sel([sel1])
      expect([...sel1.nodes()].map(n => n.valueOf())).toEqual(['a#id.one.two', 'a', '#id', '.one', '.two'])
      expect([...a.lists]).toEqual([sel1])
      expect([...a.clone().lists]).toEqual([sel1])
      expect([...sel1.lists]).toEqual([sel2])
      let clone = sel2.clone(true)
      /** Check that cloned nodes have list references */
      expect([...[...clone][0]!.lists][0]?.type).toEqual('ComplexSelector')
    })
  })
  // it('should serialize a module', () => {
  //   let rule = el('foo')
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.el($J.any("foo"))')

  //   rule = el(js('colorBrand'))
  //   out = new OutputCollector()
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe('$J.el(colorBrand)')
  // })
})