// import { Selector } from '../selector-sequence'
import { sel, el, co, pseudo, attr, any, quoted } from '..'
// import type { Class } from 'type-fest'
// import type { Node } from '../node'

/** @todo - move to https://github.com/SamVerschueren/tsd */
// test('Test types', () => {
//   expectTypeOf(Selector).toMatchTypeOf<Class<Node>>()
// })

describe('Selector', () => {
  describe('serialization', () => {
    it('should serialize to a selector', () => {
      let rule = sel([
        el('.foo'),
        co('>'),
        el('#bar')
      ])
      expect(`${rule}`).toBe('.foo>#bar')
      rule = sel([
        el('.foo'),
        el('#bar')
      ])
      expect(`${rule}`).toBe('.foo#bar')
      rule = sel([
        el('.foo'),
        co(' '),
        el('#bar')
      ])
      expect(`${rule}`).toBe('.foo #bar')
    })
  })

  describe('equality', () => {
    test('normalized attribute selectors should be equal', () => {
      const attr1 = attr({
        key: 'foo',
        op: '=',
        value: any('bar')
      })
      const attr2 = attr({
        key: 'foo',
        op: '=',
        value: quoted(any('bar'))
      })
      expect(attr1.compare(attr2)).toBe(0)
    })

    test('equivalent node strings should be equal', () => {
      const attr1 = attr({
        key: 'foo',
        op: '=',
        value: any('bar')
      })
      const attr2 = any('[foo=bar]')
      expect(attr1.compare(attr2)).toBe(0)
    })

    test('sequences should be equal', () => {
      const sel1 = sel([
        el('.foo'),
        co('>'),
        el('#bar')
      ])
      let co2 = co('>')
      co2.pre = 1
      co2.post = 1
      const sel2 = sel([
        el('.foo'),
        co2,
        el('#bar')
      ])
      expect(sel1.compare(sel2)).toBe(0)
    })
  })
})
